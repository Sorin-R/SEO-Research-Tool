const cron = require('node-cron');
const db = require('../database');
const keywordService = require('./keywordService');
const serpService = require('./serpService');
const websiteService = require('./websiteService');
const rankTrackerSettingsService = require('./rankTrackerSettingsService');

let scheduledTask = null;
let activeScheduleTime = rankTrackerSettingsService.DEFAULT_SCHEDULE_TIME;
let activeSearchDepth = rankTrackerSettingsService.DEFAULT_SEARCH_DEPTH;
let lastProviderRotationIndex = 0;

const CONCURRENCY_LIMIT = 3;

async function createJobRecord(source) {
  try {
    const result = await db.query(
      `INSERT INTO rank_tracker_jobs (source, status) VALUES (?, 'running')`,
      [source]
    );
    return result.insertId;
  } catch {
    return null;
  }
}

async function updateJobRecord(jobId, updates) {
  if (!jobId) return;
  try {
    const sets = [];
    const params = [];
    for (const [key, value] of Object.entries(updates)) {
      sets.push(`${key} = ?`);
      params.push(value);
    }
    params.push(jobId);
    await db.query(`UPDATE rank_tracker_jobs SET ${sets.join(', ')} WHERE id = ?`, params);
  } catch {
    // non-critical
  }
}

async function runWithConcurrencyLimit(tasks, limit) {
  const results = [];
  let index = 0;

  async function next() {
    const currentIndex = index++;
    if (currentIndex >= tasks.length) return;
    try {
      results[currentIndex] = { status: 'fulfilled', value: await tasks[currentIndex]() };
    } catch (err) {
      results[currentIndex] = { status: 'rejected', reason: err };
    }
    await next();
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => next());
  await Promise.all(workers);
  return results;
}

async function runRankTrackerJob(source = 'Cron') {
  const prefix = `[${source}]`;
  console.log(`${prefix} Starting rank check...`);

  const jobId = await createJobRecord(source);

  const keywords = await keywordService.getTrackedKeywords();
  const websites = await websiteService.getActiveWebsites();

  if (websites.length === 0) {
    console.warn(`${prefix} No active websites configured — skipping rank tracking.`);
    await updateJobRecord(jobId, {
      status: 'completed',
      processed_keywords: keywords.length,
      processed_websites: 0,
      finished_at: new Date(),
    });
    return {
      jobId,
      processedKeywords: keywords.length,
      processedWebsites: 0,
      updated: 0,
      matched: 0,
      failed: 0,
    };
  }

  let updated = 0;
  let matched = 0;
  let failed = 0;
  const localTrackingActive = await serpService.isLocalTrackingProviderActive();
  const concurrencyLimit = localTrackingActive ? 1 : CONCURRENCY_LIMIT;

  if (localTrackingActive) {
    console.log(`${prefix} Local PC Agent is active. Running rank checks sequentially for stable local queue processing.`);
  }

  const tasks = [];
  for (const keyword of keywords) {
    const scopedWebsiteId = Number.parseInt(keyword.website_id, 10);
    const targetWebsites = Number.isFinite(scopedWebsiteId) && scopedWebsiteId > 0
      ? websites.filter((website) => Number(website.id) === scopedWebsiteId)
      : websites;

    for (const website of targetWebsites) {
      tasks.push(async () => {
        const result = await serpService.trackRanking(
          keyword.id,
          keyword.keyword,
          website.target_url || website.domain,
          website.id,
          website.country || 'US',
          activeSearchDepth
        );
        console.log(
          `${prefix} Tracked "${keyword.keyword}" for ${website.target_url || website.domain}: position ${result.position ?? 'not found'}`
        );
        return result;
      });
    }
  }

  const results = await runWithConcurrencyLimit(tasks, concurrencyLimit);

  for (const result of results) {
    if (result.status === 'fulfilled') {
      updated += 1;
      if (result.value.position != null) {
        matched += 1;
      }
    } else {
      failed += 1;
      console.error(`${prefix} Tracking failed:`, result.reason?.message);
    }
  }

  // Generate alerts for significant position changes
  try {
    await generateRankingAlerts(websites, keywords);
  } catch (alertErr) {
    console.warn(`${prefix} Alert generation failed:`, alertErr.message);
  }

  await updateJobRecord(jobId, {
    status: 'completed',
    processed_keywords: keywords.length,
    processed_websites: websites.length,
    updated_count: updated,
    matched_count: matched,
    failed_count: failed,
    finished_at: new Date(),
  });

  console.log(`${prefix} Rank check complete. Updated: ${updated}, Matched: ${matched}, Failed: ${failed}`);

  return {
    jobId,
    processedKeywords: keywords.length,
    processedWebsites: websites.length,
    updated,
    matched,
    failed,
  };
}

async function generateRankingAlerts(websites, keywords) {
  for (const website of websites) {
    const rankings = await serpService.getLatestRankings(website.id);
    for (const ranking of rankings) {
      if (ranking.previous_position == null || ranking.position == null) continue;
      const delta = ranking.previous_position - ranking.position;
      if (Math.abs(delta) >= 5) {
        const alertType = delta > 0 ? 'improved' : 'dropped';
        const message = delta > 0
          ? `"${ranking.keyword}" improved from #${ranking.previous_position} to #${ranking.position} (+${delta}) on ${website.domain}`
          : `"${ranking.keyword}" dropped from #${ranking.previous_position} to #${ranking.position} (${delta}) on ${website.domain}`;
        try {
          await db.query(
            `INSERT INTO ranking_alerts (keyword_id, website_id, alert_type, old_position, new_position, message)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [ranking.keyword_id, website.id, alertType, ranking.previous_position, ranking.position, message]
          );
        } catch {
          // non-critical
        }
      }
    }
  }
}

function stopScheduledTask() {
  if (!scheduledTask) {
    return;
  }

  scheduledTask.stop();
  if (typeof scheduledTask.destroy === 'function') {
    scheduledTask.destroy();
  }
  scheduledTask = null;
}

function scheduleRankTrackerJob(scheduleTime, searchDepth = rankTrackerSettingsService.DEFAULT_SEARCH_DEPTH) {
  const normalizedTime = rankTrackerSettingsService.normalizeScheduleTime(scheduleTime);
  const normalizedDepth = rankTrackerSettingsService.normalizeSearchDepth(searchDepth);
  const cronExpression = rankTrackerSettingsService.scheduleTimeToCron(normalizedTime);

  stopScheduledTask();

  scheduledTask = cron.schedule(cronExpression, async () => {
    try {
      await runRankTrackerJob('Cron');
    } catch (err) {
      console.error('[Cron] Rank check job failed:', err.message);
    }
  });

  activeScheduleTime = normalizedTime;
  activeSearchDepth = normalizedDepth;
  console.log(`[Scheduler] Rank tracker scheduled daily at ${normalizedTime} with depth ${normalizedDepth}.`);

  return {
    scheduleTime: normalizedTime,
    searchDepth: normalizedDepth,
    cronExpression,
  };
}

async function startRankTrackerScheduler() {
  const settings = await rankTrackerSettingsService.getRankTrackerSchedule();
  scheduleRankTrackerJob(settings.scheduleTime, settings.searchDepth);
  return settings;
}

async function rescheduleRankTrackerScheduler(scheduleTime, searchDepth) {
  const settings = await rankTrackerSettingsService.updateRankTrackerSchedule(scheduleTime, searchDepth);
  scheduleRankTrackerJob(settings.scheduleTime, settings.searchDepth);
  return settings;
}

function getActiveRankTrackerSchedule() {
  return {
    scheduleTime: activeScheduleTime,
    searchDepth: activeSearchDepth,
    cronExpression: rankTrackerSettingsService.scheduleTimeToCron(activeScheduleTime),
  };
}

async function getJobHistory(limit = 20) {
  try {
    const rows = await db.query(
      `SELECT * FROM rank_tracker_jobs ORDER BY started_at DESC LIMIT ?`,
      [Math.min(Math.max(limit, 1), 100)]
    );
    return rows;
  } catch {
    return [];
  }
}

module.exports = {
  getActiveRankTrackerSchedule,
  getJobHistory,
  rescheduleRankTrackerScheduler,
  runRankTrackerJob,
  startRankTrackerScheduler,
};
