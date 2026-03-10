const db = require('../database');
const { analyzeContent } = require('../analyzers/contentAnalyzer');
const localStore = require('../utils/localStore');

const MAX_CONTENT_HISTORY_ENTRIES = 12;

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

async function persistContentAnalysisHistory(payload) {
  try {
    const insertResult = await db.query(
      `INSERT INTO content_analyses (url, keyword, word_count, seo_score, analysis_data)
       VALUES (?, ?, ?, ?, ?)`,
      [
        payload.url || null,
        payload.keyword,
        payload.result?.wordCount ?? null,
        payload.result?.seoScore ?? null,
        JSON.stringify(payload),
      ]
    );

    await db.query(
      `DELETE FROM content_analyses
       WHERE id NOT IN (
         SELECT id FROM (
           SELECT id
           FROM content_analyses
           ORDER BY created_at DESC
           LIMIT ${MAX_CONTENT_HISTORY_ENTRIES}
         ) AS recent_content_history
       )`
    );

    return insertResult.insertId;
  } catch (err) {
    console.warn('[ContentAnalysisService] DB unavailable, using local store for persistContentAnalysisHistory:', err.message);
    return localStore.saveContentAnalysisHistory(payload, MAX_CONTENT_HISTORY_ENTRIES);
  }
}

function mapContentHistoryRow(row) {
  const payload = parseStoredPayload(row.analysis_data);

  return {
    id: row.id,
    keyword: row.keyword || payload?.keyword || '',
    url: row.url || payload?.url || null,
    input_mode: payload?.inputMode || (row.url ? 'url' : 'text'),
    compare_to_serp: !!payload?.compareToSerp,
    seo_score: row.seo_score ?? payload?.result?.seoScore ?? null,
    word_count: row.word_count ?? payload?.result?.wordCount ?? null,
    created_at: row.created_at,
    updated_at: row.created_at,
  };
}

async function analyzeAndStoreContent({
  keyword,
  text,
  url,
  compareToSerp,
  competitorData,
}) {
  const result = await analyzeContent({
    text,
    url,
    keyword,
    competitorData,
  });

  const payload = {
    keyword,
    url: url || null,
    inputMode: text ? 'text' : 'url',
    inputText: text || '',
    compareToSerp: !!compareToSerp,
    result,
  };

  try {
    const historyId = await persistContentAnalysisHistory(payload);
    if (historyId) {
      result.historyId = historyId;
    }
  } catch (err) {
    console.warn('[ContentAnalysisService] Failed to persist content analysis history:', err.message);
  }

  return {
    ...result,
    inputMode: payload.inputMode,
    inputText: payload.inputText,
    compareToSerp: payload.compareToSerp,
  };
}

async function getContentAnalysisHistory(limit = 10) {
  const safeLimit = clampLimit(limit, 1, MAX_CONTENT_HISTORY_ENTRIES);

  try {
    const rows = await db.query(
      `SELECT id, keyword, url, word_count, seo_score, analysis_data, created_at
       FROM content_analyses
       ORDER BY created_at DESC
       LIMIT ${safeLimit}`
    );

    return rows.map(mapContentHistoryRow);
  } catch (err) {
    console.warn('[ContentAnalysisService] DB unavailable, using local store for getContentAnalysisHistory:', err.message);
    return localStore.getContentAnalysisHistory(safeLimit);
  }
}

async function getContentAnalysisHistoryItem(id) {
  try {
    const rows = await db.query(
      `SELECT id, keyword, url, analysis_data, created_at
       FROM content_analyses
       WHERE id = ?
       LIMIT 1`,
      [id]
    );

    const row = rows[0];
    if (!row) {
      return null;
    }

    const payload = parseStoredPayload(row.analysis_data);
    if (!payload?.result) {
      return null;
    }

    return {
      ...payload.result,
      historyId: row.id,
      savedAt: row.created_at,
      inputMode: payload.inputMode || (row.url ? 'url' : 'text'),
      inputText: payload.inputText || '',
      compareToSerp: !!payload.compareToSerp,
      url: payload.url || row.url || null,
      keyword: payload.keyword || row.keyword || payload.result.keyword,
    };
  } catch (err) {
    console.warn('[ContentAnalysisService] DB unavailable, using local store for getContentAnalysisHistoryItem:', err.message);
    return localStore.getContentAnalysisHistoryItem(id);
  }
}

async function deleteContentAnalysisHistoryItem(id) {
  try {
    await db.query('DELETE FROM content_analyses WHERE id = ?', [id]);
  } catch (err) {
    console.warn('[ContentAnalysisService] DB unavailable, using local store for deleteContentAnalysisHistoryItem:', err.message);
    await localStore.deleteContentAnalysisHistoryItem(id);
  }
}

module.exports = {
  analyzeAndStoreContent,
  getContentAnalysisHistory,
  getContentAnalysisHistoryItem,
  deleteContentAnalysisHistoryItem,
};
