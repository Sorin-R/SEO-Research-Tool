const db = require('../database');
const localStore = require('../utils/localStore');
const { normalizeCountryCode } = require('../utils/searchCountry');

function createServiceError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeDomain(domain) {
  if (!domain || !domain.trim()) {
    throw createServiceError('Website domain is required.');
  }

  let value = domain.trim().toLowerCase();

  if (!/^https?:\/\//.test(value)) {
    value = `https://${value}`;
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(value);
  } catch {
    throw createServiceError('Enter a valid website domain.');
  }

  const hostname = parsedUrl.hostname.replace(/^www\./, '').trim();

  if (!hostname) {
    throw createServiceError('Enter a valid website domain.');
  }

  return hostname;
}

function normalizeName(name, domain) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed || domain;
}

function sanitizeWebsiteRecord(record) {
  if (!record) {
    return null;
  }

  return {
    ...record,
    country: normalizeCountryCode(record.country),
  };
}

async function getWebsiteById(id) {
  try {
    const rows = await db.query('SELECT * FROM websites WHERE id = ? LIMIT 1', [id]);
    return sanitizeWebsiteRecord(rows[0] || null);
  } catch (err) {
    console.warn('[WebsiteService] DB unavailable, using local store for getWebsiteById:', err.message);
    return localStore.getWebsiteById(id);
  }
}

async function getWebsites() {
  try {
    const rows = await db.query(
      'SELECT * FROM websites ORDER BY is_active DESC, updated_at DESC, created_at DESC'
    );
    return rows.map(sanitizeWebsiteRecord);
  } catch (err) {
    console.warn('[WebsiteService] DB unavailable, using local store for getWebsites:', err.message);
    return localStore.getWebsites();
  }
}

async function getActiveWebsites() {
  try {
    const rows = await db.query(
      'SELECT * FROM websites WHERE is_active = 1 ORDER BY updated_at DESC, created_at DESC'
    );
    return rows.map(sanitizeWebsiteRecord);
  } catch (err) {
    console.warn('[WebsiteService] DB unavailable, using local store for getActiveWebsites:', err.message);
    return localStore.getActiveWebsites();
  }
}

async function createWebsite({ name, domain, country = 'US', isActive = true }) {
  const normalizedDomain = normalizeDomain(domain);
  const normalizedName = normalizeName(name, normalizedDomain);
  const normalizedCountry = normalizeCountryCode(country);

  try {
    const result = await db.query(
      `INSERT INTO websites (name, domain, country, is_active)
       VALUES (?, ?, ?, ?)`,
      [normalizedName, normalizedDomain, normalizedCountry, isActive ? 1 : 0]
    );

    return getWebsiteById(result.insertId);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw createServiceError('This website is already being tracked.', 409);
    }

    console.warn('[WebsiteService] DB unavailable, using local store for createWebsite:', err.message);
    return localStore.saveWebsite({
      name: normalizedName,
      domain: normalizedDomain,
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

  const normalizedDomain = updates.domain != null
    ? normalizeDomain(updates.domain)
    : existing.domain;
  const normalizedName = updates.name != null
    ? normalizeName(updates.name, normalizedDomain)
    : existing.name;
  const normalizedCountry = updates.country != null
    ? normalizeCountryCode(updates.country)
    : normalizeCountryCode(existing.country);
  const isActive = typeof updates.isActive === 'boolean'
    ? updates.isActive
    : Boolean(existing.is_active);

  try {
    await db.query(
      `UPDATE websites
       SET name = ?, domain = ?, country = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [normalizedName, normalizedDomain, normalizedCountry, isActive ? 1 : 0, id]
    );

    return getWebsiteById(id);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw createServiceError('Another tracked website already uses that domain.', 409);
    }

    console.warn('[WebsiteService] DB unavailable, using local store for updateWebsite:', err.message);
    return localStore.updateWebsite(id, {
      name: normalizedName,
      domain: normalizedDomain,
      country: normalizedCountry,
      is_active: !!isActive,
    });
  }
}

async function deleteWebsite(id) {
  try {
    await db.query('DELETE FROM websites WHERE id = ?', [id]);
  } catch (err) {
    console.warn('[WebsiteService] DB unavailable, using local store for deleteWebsite:', err.message);
    await localStore.deleteWebsite(id);
  }
}

async function ensureLegacyDefaultWebsite() {
  const fallbackDomain = process.env.TARGET_DOMAIN;

  if (!fallbackDomain || !fallbackDomain.trim()) {
    return null;
  }

  const websites = await getWebsites();
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
  createWebsite,
  deleteWebsite,
  ensureLegacyDefaultWebsite,
  getActiveWebsites,
  getWebsiteById,
  getWebsites,
  normalizeDomain,
  updateWebsite,
};
