const cron = require('node-cron');
const keywordService = require('./keywordService');
const serpService = require('./serpService');
const websiteService = require('./websiteService');
const rankTrackerSettingsService = require('./rankTrackerSettingsService');

let scheduledTask = null;
let activeScheduleTime = rankTrackerSettingsService.DEFAULT_SCHEDULE_TIME;

async function runRankTrackerJob(source = 'Cron') {
  const prefix = `[${source}]`;
  console.log(`${prefix} Starting rank check...`);

  const keywords = await keywordService.getTrackedKeywords();
  const websites = await websiteService.getActiveWebsites();

  if (websites.length === 0) {
    console.warn(`${prefix} No active websites configured — skipping rank tracking.`);
    return {
      processedKeywords: keywords.length,
      processedWebsites: 0,
      updated: 0,
      matched: 0,
    };
  }

  let updated = 0;
  let matched = 0;

  for (const website of websites) {
    for (const keyword of keywords) {
      try {
        const result = await serpService.trackRanking(
          keyword.id,
          keyword.keyword,
          website.target_url || website.domain,
          website.id,
          website.country || 'US'
        );
        updated += 1;
        if (result.position != null) {
          matched += 1;
        }
        console.log(
          `${prefix} Tracked "${keyword.keyword}" for ${website.target_url || website.domain}: position ${result.position ?? 'not found'}`
        );
      } catch (err) {
        console.error(`${prefix} Failed to track "${keyword.keyword}" for ${website.target_url || website.domain}:`, err.message);
      }
    }
  }

  console.log(`${prefix} Rank check complete.`);

  return {
    processedKeywords: keywords.length,
    processedWebsites: websites.length,
    updated,
    matched,
  };
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

function scheduleRankTrackerJob(scheduleTime) {
  const normalizedTime = rankTrackerSettingsService.normalizeScheduleTime(scheduleTime);
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
  console.log(`[Scheduler] Rank tracker scheduled daily at ${normalizedTime}.`);

  return {
    scheduleTime: normalizedTime,
    cronExpression,
  };
}

async function startRankTrackerScheduler() {
  const settings = await rankTrackerSettingsService.getRankTrackerSchedule();
  scheduleRankTrackerJob(settings.scheduleTime);
  return settings;
}

async function rescheduleRankTrackerScheduler(scheduleTime) {
  const settings = await rankTrackerSettingsService.updateRankTrackerSchedule(scheduleTime);
  scheduleRankTrackerJob(settings.scheduleTime);
  return settings;
}

function getActiveRankTrackerSchedule() {
  return {
    scheduleTime: activeScheduleTime,
    cronExpression: rankTrackerSettingsService.scheduleTimeToCron(activeScheduleTime),
  };
}

module.exports = {
  getActiveRankTrackerSchedule,
  rescheduleRankTrackerScheduler,
  runRankTrackerJob,
  startRankTrackerScheduler,
};
