const db = require('../database');
const localStore = require('../utils/localStore');
const { normalizeCountryCode } = require('../utils/searchCountry');

function createServiceError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function shouldUseLocalFallback(err) {
  if (!err) {
    return false;
  }

  const fallbackCodes = new Set([
    'ER_ACCESS_DENIED_ERROR',
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'ETIMEDOUT',
    'PROTOCOL_CONNECTION_LOST',
  ]);

  if (fallbackCodes.has(err.code)) {
    return true;
  }

  const message = String(err.message || '').toLowerCase();
  return (
    message.includes('access denied') ||
    message.includes('connection') ||
    message.includes('connect') ||
    message.includes('timeout') ||
    message.includes('not available')
  );
}

function normalizeDomain(domain) {
  if (!domain || !domain.trim()) {
    throw createServiceError('Website domain or URL is required.');
  }

  let value = domain.trim().toLowerCase();

  if (!/^https?:\/\//.test(value)) {
    value = `https://${value}`;
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(value);
  } catch {
    throw createServiceError('Enter a valid website domain or URL.');
  }

  const hostname = parsedUrl.hostname.replace(/^www\./, '').trim();

  if (!hostname) {
    throw createServiceError('Enter a valid website domain or URL.');
  }

  return hostname;
}

function normalizePathname(pathname) {
  const value = String(pathname || '/').trim();
  if (!value || value === '/') {
    return '/';
  }

  const normalized = value.startsWith('/') ? value : `/${value}`;
  return normalized.replace(/\/+$/, '') || '/';
}

function normalizeTargetUrl(targetUrl, fallbackDomain = '') {
  if (!targetUrl || !String(targetUrl).trim()) {
    return null;
  }

  let value = String(targetUrl).trim();

  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(value);
  } catch {
    return null;
  }

  const hostname = parsedUrl.hostname.replace(/^www\./, '').trim().toLowerCase() || fallbackDomain;
  const pathname = normalizePathname(parsedUrl.pathname);

  if (!hostname || pathname === '/') {
    return null;
  }

  return `https://${hostname}${pathname}`;
}

function normalizeGscSiteUrl(gscSiteUrl) {
  if (gscSiteUrl == null) {
    return null;
  }

  const rawValue = String(gscSiteUrl).trim();
  if (!rawValue) {
    return null;
  }

  if (/^sc-domain:/i.test(rawValue)) {
    const domainPart = rawValue.replace(/^sc-domain:/i, '').trim().toLowerCase().replace(/^www\./, '');
    if (!domainPart || domainPart.includes('/')) {
      throw createServiceError('Enter a valid Search Console domain property value.');
    }
    return `sc-domain:${domainPart}`;
  }

  let value = rawValue;
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(value);
  } catch {
    throw createServiceError('Enter a valid Search Console URL-prefix property.');
  }

  const protocol = /^https?:$/i.test(parsedUrl.protocol) ? parsedUrl.protocol.toLowerCase() : 'https:';
  const hostname = parsedUrl.hostname.toLowerCase();
  if (!hostname) {
    throw createServiceError('Enter a valid Search Console URL-prefix property.');
  }

  const pathname = normalizePathname(parsedUrl.pathname || '/');
  const normalizedPath = pathname.endsWith('/') ? pathname : `${pathname}/`;
  return `${protocol}//${hostname}${normalizedPath}`;
}

function normalizeTrackingTarget(domain) {
  if (!domain || !domain.trim()) {
    throw createServiceError('Website domain or URL is required.');
  }

  let value = domain.trim().toLowerCase();

  if (!/^https?:\/\//.test(value)) {
    value = `https://${value}`;
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(value);
  } catch {
    throw createServiceError('Enter a valid website domain or URL.');
  }

  const hostname = parsedUrl.hostname.replace(/^www\./, '').trim();

  if (!hostname) {
    throw createServiceError('Enter a valid website domain or URL.');
  }

  const normalizedPath = normalizePathname(parsedUrl.pathname);

  return {
    domain: hostname,
    targetUrl: normalizedPath === '/' ? null : `https://${hostname}${normalizedPath}`,
  };
}

function normalizeName(name, domain) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed || domain;
}

function normalizeProjectName(projectName, fallbackName) {
  const trimmed = typeof projectName === 'string' ? projectName.trim() : '';
  if (trimmed) {
    return trimmed;
  }

  return normalizeName(fallbackName, fallbackName);
}

function normalizeTags(tags) {
  const raw = Array.isArray(tags)
    ? tags
    : String(tags || '')
      .split(',')
      .map((tag) => tag.trim());

  const cleaned = [...new Set(raw.filter(Boolean).map((tag) => String(tag).trim().toLowerCase()))];
  return cleaned.slice(0, 25);
}

function parseTags(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return normalizeTags(value);
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? normalizeTags(parsed) : normalizeTags(value.split(','));
    } catch {
      return normalizeTags(value.split(','));
    }
  }

  return [];
}

function sanitizeWebsiteRecord(record) {
  if (!record) {
    return null;
  }

  const tags = parseTags(record.tags);
  const projectName = normalizeProjectName(record.project_name, record.name || record.domain);

  let normalizedGscSiteUrl = null;
  try {
    normalizedGscSiteUrl = normalizeGscSiteUrl(record.gsc_site_url || record.gscSiteUrl);
  } catch {
    normalizedGscSiteUrl = null;
  }

  return {
    ...record,
    target_url: normalizeTargetUrl(record.target_url, record.domain),
    gsc_site_url: normalizedGscSiteUrl,
    gscSiteUrl: normalizedGscSiteUrl,
    country: normalizeCountryCode(record.country),
    project_name: projectName,
    projectName,
    tags,
    archived: Boolean(record.archived),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

async function getWebsiteById(id) {
  try {
    const rows = await db.query('SELECT * FROM websites WHERE id = ? LIMIT 1', [id]);
    return sanitizeWebsiteRecord(rows[0] || null);
  } catch (err) {
    if (!shouldUseLocalFallback(err)) {
      throw err;
    }

    console.warn('[WebsiteService] DB unavailable, using local store for getWebsiteById:', err.message);
    return localStore.getWebsiteById(id);
  }
}

async function getWebsites(options = {}) {
  const includeArchived = options.includeArchived === true || options.includeArchived === 'true';
  const archivedOnly = options.archivedOnly === true || options.archivedOnly === 'true';
  const normalizedSearch = String(options.search || '').trim().toLowerCase();
  const normalizedTag = String(options.tag || '').trim().toLowerCase();

  try {
    const params = [];
    let sql = 'SELECT * FROM websites WHERE 1=1';

    if (archivedOnly) {
      sql += ' AND archived = 1';
    } else if (!includeArchived) {
      sql += ' AND archived = 0';
    }

    if (normalizedSearch) {
      sql += ' AND (LOWER(domain) LIKE ? OR LOWER(name) LIKE ? OR LOWER(project_name) LIKE ?)';
      params.push(`%${normalizedSearch}%`, `%${normalizedSearch}%`, `%${normalizedSearch}%`);
    }

    sql += ' ORDER BY updated_at DESC, created_at DESC, id DESC';
    const rows = await db.query(sql, params);
    let websites = rows.map(sanitizeWebsiteRecord);

    if (normalizedTag) {
      websites = websites.filter((website) => website.tags.includes(normalizedTag));
    }

    return websites;
  } catch (err) {
    if (!shouldUseLocalFallback(err)) {
      throw err;
    }

    console.warn('[WebsiteService] DB unavailable, using local store for getWebsites:', err.message);
    return localStore.getWebsites({
      includeArchived,
      archivedOnly,
      search: normalizedSearch,
      tag: normalizedTag,
    });
  }
}

async function getActiveWebsites() {
  try {
    const rows = await db.query(
      'SELECT * FROM websites WHERE is_active = 1 AND archived = 0 ORDER BY updated_at DESC, created_at DESC'
    );
    return rows.map(sanitizeWebsiteRecord);
  } catch (err) {
    if (!shouldUseLocalFallback(err)) {
      throw err;
    }

    console.warn('[WebsiteService] DB unavailable, using local store for getActiveWebsites:', err.message);
    return localStore.getActiveWebsites();
  }
}

async function createWebsite({
  name,
  projectName,
  domain,
  country = 'US',
  tags = [],
  archived = false,
  isActive = true,
  gscSiteUrl = null,
}) {
  const { domain: normalizedDomain, targetUrl: normalizedTargetUrl } = normalizeTrackingTarget(domain);
  const normalizedName = normalizeName(name, normalizedDomain);
  const normalizedProjectName = normalizeProjectName(projectName, normalizedName);
  const normalizedCountry = normalizeCountryCode(country);
  const normalizedTags = normalizeTags(tags);
  const normalizedArchived = Boolean(archived);
  const normalizedGscSiteUrl = normalizeGscSiteUrl(gscSiteUrl);

  try {
    const result = await db.query(
      `INSERT INTO websites (name, project_name, tags, archived, domain, target_url, gsc_site_url, country, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        normalizedName,
        normalizedProjectName,
        JSON.stringify(normalizedTags),
        normalizedArchived ? 1 : 0,
        normalizedDomain,
        normalizedTargetUrl,
        normalizedGscSiteUrl,
        normalizedCountry,
        isActive ? 1 : 0,
      ]
    );

    return getWebsiteById(result.insertId);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw createServiceError('This website is already being tracked.', 409);
    }

    if (!shouldUseLocalFallback(err)) {
      throw err;
    }

    console.warn('[WebsiteService] DB unavailable, using local store for createWebsite:', err.message);
    return localStore.saveWebsite({
      name: normalizedName,
      project_name: normalizedProjectName,
      tags: normalizedTags,
      archived: normalizedArchived,
      domain: normalizedDomain,
      target_url: normalizedTargetUrl,
      gsc_site_url: normalizedGscSiteUrl,
      country: normalizedCountry,
      is_active: !!isActive,
    });
  }
}

async function updateWebsite(id, updates = {}) {
  const existing = await getWebsiteById(id);

  if (!existing) {
    throw createServiceError('Website not found.', 404);
  }

  const nextTrackingTarget = updates.domain != null
    ? normalizeTrackingTarget(updates.domain)
    : {
        domain: existing.domain,
        targetUrl: normalizeTargetUrl(existing.target_url, existing.domain),
      };
  const normalizedDomain = nextTrackingTarget.domain;
  const normalizedTargetUrl = nextTrackingTarget.targetUrl;
  const normalizedName = updates.name != null
    ? normalizeName(updates.name, normalizedDomain)
    : existing.name;
  const normalizedProjectName = updates.projectName != null || updates.project_name != null
    ? normalizeProjectName(updates.projectName ?? updates.project_name, normalizedName)
    : normalizeProjectName(existing.project_name, existing.name || normalizedDomain);
  const normalizedCountry = updates.country != null
    ? normalizeCountryCode(updates.country)
    : normalizeCountryCode(existing.country);
  const normalizedTags = Object.prototype.hasOwnProperty.call(updates, 'tags')
    ? normalizeTags(updates.tags)
    : parseTags(existing.tags);
  const normalizedGscSiteUrl = Object.prototype.hasOwnProperty.call(updates, 'gscSiteUrl')
    || Object.prototype.hasOwnProperty.call(updates, 'gsc_site_url')
    ? normalizeGscSiteUrl(updates.gscSiteUrl ?? updates.gsc_site_url)
    : normalizeGscSiteUrl(existing.gsc_site_url ?? existing.gscSiteUrl);
  const archived = typeof updates.archived === 'boolean'
    ? updates.archived
    : Boolean(existing.archived);
  const isActive = typeof updates.isActive === 'boolean'
    ? updates.isActive
    : Boolean(existing.is_active);

  try {
    await db.query(
      `UPDATE websites
       SET name = ?, project_name = ?, tags = ?, archived = ?, domain = ?, target_url = ?, gsc_site_url = ?, country = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        normalizedName,
        normalizedProjectName,
        JSON.stringify(normalizedTags),
        archived ? 1 : 0,
        normalizedDomain,
        normalizedTargetUrl,
        normalizedGscSiteUrl,
        normalizedCountry,
        isActive ? 1 : 0,
        id,
      ]
    );

    return getWebsiteById(id);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw createServiceError('Another tracked website already uses that domain.', 409);
    }

    if (!shouldUseLocalFallback(err)) {
      throw err;
    }

    console.warn('[WebsiteService] DB unavailable, using local store for updateWebsite:', err.message);
    return localStore.updateWebsite(id, {
      name: normalizedName,
      project_name: normalizedProjectName,
      tags: normalizedTags,
      archived,
      domain: normalizedDomain,
      target_url: normalizedTargetUrl,
      gsc_site_url: normalizedGscSiteUrl,
      country: normalizedCountry,
      is_active: !!isActive,
    });
  }
}

async function archiveWebsite(id, archived = true) {
  return updateWebsite(id, { archived: Boolean(archived), isActive: archived ? false : undefined });
}

async function deleteWebsite(id) {
  try {
    await db.query('DELETE FROM websites WHERE id = ?', [id]);
  } catch (err) {
    if (!shouldUseLocalFallback(err)) {
      throw err;
    }

    console.warn('[WebsiteService] DB unavailable, using local store for deleteWebsite:', err.message);
    await localStore.deleteWebsite(id);
  }
}

async function ensureLegacyDefaultWebsite() {
  const fallbackDomain = process.env.TARGET_DOMAIN;

  if (!fallbackDomain || !fallbackDomain.trim()) {
    return null;
  }

  const websites = await getWebsites({ includeArchived: true });
  if (websites.length > 0) {
    return websites[0];
  }

  try {
    return await createWebsite({
      name: fallbackDomain.trim(),
      domain: fallbackDomain.trim(),
      country: process.env.TARGET_COUNTRY || 'US',
      isActive: true,
    });
  } catch (error) {
    console.warn('[WebsiteService] Failed to seed legacy default website:', error.message);
    return null;
  }
}

module.exports = {
  archiveWebsite,
  createWebsite,
  deleteWebsite,
  ensureLegacyDefaultWebsite,
  getActiveWebsites,
  getWebsiteById,
  getWebsites,
  normalizeDomain,
  normalizeGscSiteUrl,
  normalizeTargetUrl,
  updateWebsite,
};
