const db = require('../database');
const localStore = require('../utils/localStore');

const DEFAULT_SCHEDULE_TIME = '06:00';

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

function getServerTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Server local time';
}

function mapSettings(row) {
  const scheduleTime = normalizeScheduleTime(row?.schedule_time || DEFAULT_SCHEDULE_TIME);

  return {
    scheduleTime,
    cronExpression: scheduleTimeToCron(scheduleTime),
    updatedAt: row?.updated_at || null,
    serverTimeZone: getServerTimeZone(),
  };
}

async function getRankTrackerSchedule() {
  try {
    const rows = await db.query(
      `SELECT schedule_time, updated_at
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

async function updateRankTrackerSchedule(scheduleTime) {
  const normalizedTime = normalizeScheduleTime(scheduleTime);

  try {
    await db.query(
      `INSERT INTO rank_tracker_settings (id, schedule_time)
       VALUES (1, ?)
       ON DUPLICATE KEY UPDATE
         schedule_time = VALUES(schedule_time),
         updated_at = CURRENT_TIMESTAMP`,
      [normalizedTime]
    );
  } catch (err) {
    console.warn('[RankTrackerSettingsService] DB unavailable, using local store for updateRankTrackerSchedule:', err.message);
    await localStore.updateRankTrackerSettings(normalizedTime);
  }

  return getRankTrackerSchedule();
}

module.exports = {
  DEFAULT_SCHEDULE_TIME,
  getRankTrackerSchedule,
  normalizeScheduleTime,
  scheduleTimeToCron,
  updateRankTrackerSchedule,
};
