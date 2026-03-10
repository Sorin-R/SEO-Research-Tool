const db = require('../database');
const localStore = require('../utils/localStore');

const DEFAULT_SCHEDULE_TIME = '06:00';
const DEFAULT_SEARCH_DEPTH = 10;
const ALLOWED_SEARCH_DEPTHS = [10, 20, 50, 100];

function createServiceError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeScheduleTime(scheduleTime) {
  const value = String(scheduleTime || '').trim();

  if (!/^\d{2}:\d{2}$/.test(value)) {
    throw createServiceError('Schedule time must use HH:MM format.', 400);
  }

  const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10));

  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    throw createServiceError('Schedule time must be a valid 24-hour time.', 400);
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function scheduleTimeToCron(scheduleTime) {
  const [hours, minutes] = normalizeScheduleTime(scheduleTime).split(':');
  return `${minutes} ${hours} * * *`;
}

function normalizeSearchDepth(searchDepth) {
  const value = Number.parseInt(searchDepth, 10);

  if (!ALLOWED_SEARCH_DEPTHS.includes(value)) {
    throw createServiceError(
      `Search depth must be one of: ${ALLOWED_SEARCH_DEPTHS.join(', ')}.`,
      400
    );
  }

  return value;
}

function getServerTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Server local time';
}

function mapSettings(row) {
  const scheduleTime = normalizeScheduleTime(row?.schedule_time || DEFAULT_SCHEDULE_TIME);
  const searchDepth = normalizeSearchDepth(row?.search_depth || DEFAULT_SEARCH_DEPTH);

  return {
    scheduleTime,
    searchDepth,
    cronExpression: scheduleTimeToCron(scheduleTime),
    updatedAt: row?.updated_at || null,
    serverTimeZone: getServerTimeZone(),
  };
}

async function getRankTrackerSchedule() {
  try {
    const rows = await db.query(
      `SELECT schedule_time, search_depth, updated_at
       FROM rank_tracker_settings
       WHERE id = 1
       LIMIT 1`
    );

    return mapSettings(rows[0]);
  } catch (err) {
    console.warn('[RankTrackerSettingsService] DB unavailable, using local store for getRankTrackerSchedule:', err.message);
    const fallback = await localStore.getRankTrackerSettings();
    return mapSettings(fallback);
  }
}

async function updateRankTrackerSchedule(scheduleTime, searchDepth = null) {
  const normalizedTime = normalizeScheduleTime(scheduleTime);
  const existingSettings = searchDepth == null ? await getRankTrackerSchedule() : null;
  const normalizedDepth = normalizeSearchDepth(
    searchDepth == null ? existingSettings?.searchDepth || DEFAULT_SEARCH_DEPTH : searchDepth
  );

  try {
    await db.query(
      `INSERT INTO rank_tracker_settings (id, schedule_time, search_depth)
       VALUES (1, ?, ?)
       ON DUPLICATE KEY UPDATE
         schedule_time = VALUES(schedule_time),
         search_depth = VALUES(search_depth),
         updated_at = CURRENT_TIMESTAMP`,
      [normalizedTime, normalizedDepth]
    );
  } catch (err) {
    console.warn('[RankTrackerSettingsService] DB unavailable, using local store for updateRankTrackerSchedule:', err.message);
    await localStore.updateRankTrackerSettings(normalizedTime, normalizedDepth);
  }

  return getRankTrackerSchedule();
}

module.exports = {
  ALLOWED_SEARCH_DEPTHS,
  DEFAULT_SCHEDULE_TIME,
  DEFAULT_SEARCH_DEPTH,
  getRankTrackerSchedule,
  normalizeSearchDepth,
  normalizeScheduleTime,
  scheduleTimeToCron,
  updateRankTrackerSchedule,
};
