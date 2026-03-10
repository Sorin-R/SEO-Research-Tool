const db = require('../database');
const localStore = require('../utils/localStore');
const { auditSite } = require('../analyzers/siteAuditor');

const MAX_SITE_AUDIT_HISTORY_ENTRIES = 12;

function clampLimit(limit, min, max) {
  return Math.min(Math.max(Number.parseInt(limit, 10) || min, min), max);
}

function parseStoredPayload(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function persistSiteAuditHistory(payload) {
  try {
    const insertResult = await db.query(
      `INSERT INTO site_audits (url, total_pages, audit_score, result)
       VALUES (?, ?, ?, ?)`,
      [
        payload.url,
        payload.result?.crawledPages ?? null,
        payload.result?.auditScore ?? null,
        JSON.stringify(payload),
      ]
    );

    await db.query(
      `DELETE FROM site_audits
       WHERE id NOT IN (
         SELECT id FROM (
           SELECT id
           FROM site_audits
           ORDER BY created_at DESC
           LIMIT ${MAX_SITE_AUDIT_HISTORY_ENTRIES}
         ) AS recent_site_audits
       )`
    );

    return insertResult.insertId;
  } catch (err) {
    console.warn('[SiteAuditService] DB unavailable, using local store for persistSiteAuditHistory:', err.message);
    return localStore.saveSiteAuditHistory(payload, MAX_SITE_AUDIT_HISTORY_ENTRIES);
  }
}

function mapSiteAuditHistoryRow(row) {
  const payload = parseStoredPayload(row.result);

  return {
    id: row.id,
    url: row.url || payload?.url || '',
    total_pages: row.total_pages ?? payload?.result?.crawledPages ?? null,
    audit_score: row.audit_score ?? payload?.result?.auditScore ?? null,
    max_pages: payload?.maxPages ?? payload?.result?.maxPages ?? null,
    created_at: row.created_at,
    updated_at: row.created_at,
  };
}

async function analyzeAndStoreSiteAudit({ url, maxPages }) {
  const result = await auditSite(url, { maxPages });
  const payload = {
    url: result.url,
    maxPages: result.maxPages,
    result,
  };

  try {
    const historyId = await persistSiteAuditHistory(payload);
    if (historyId) {
      result.historyId = historyId;
    }
  } catch (err) {
    console.warn('[SiteAuditService] Failed to persist site audit history:', err.message);
  }

  return result;
}

async function getSiteAuditHistory(limit = 10) {
  const safeLimit = clampLimit(limit, 1, MAX_SITE_AUDIT_HISTORY_ENTRIES);

  try {
    const rows = await db.query(
      `SELECT id, url, total_pages, audit_score, result, created_at
       FROM site_audits
       ORDER BY created_at DESC
       LIMIT ${safeLimit}`
    );

    return rows.map(mapSiteAuditHistoryRow);
  } catch (err) {
    console.warn('[SiteAuditService] DB unavailable, using local store for getSiteAuditHistory:', err.message);
    return localStore.getSiteAuditHistory(safeLimit);
  }
}

async function getSiteAuditHistoryItem(id) {
  try {
    const rows = await db.query(
      `SELECT id, result, created_at
       FROM site_audits
       WHERE id = ?
       LIMIT 1`,
      [id]
    );

    const row = rows[0];
    if (!row) {
      return null;
    }

    const payload = parseStoredPayload(row.result);
    if (!payload?.result) {
      return null;
    }

    return {
      ...payload.result,
      historyId: row.id,
      savedAt: row.created_at,
    };
  } catch (err) {
    console.warn('[SiteAuditService] DB unavailable, using local store for getSiteAuditHistoryItem:', err.message);
    return localStore.getSiteAuditHistoryItem(id);
  }
}

async function deleteSiteAuditHistoryItem(id) {
  try {
    await db.query('DELETE FROM site_audits WHERE id = ?', [id]);
  } catch (err) {
    console.warn('[SiteAuditService] DB unavailable, using local store for deleteSiteAuditHistoryItem:', err.message);
    await localStore.deleteSiteAuditHistoryItem(id);
  }
}

module.exports = {
  analyzeAndStoreSiteAudit,
  getSiteAuditHistory,
  getSiteAuditHistoryItem,
  deleteSiteAuditHistoryItem,
};
