function normalizeResultUrl(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) {
    return '';
  }

  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }

    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function normalizeSearchResults(rawResults, limit = 10) {
  const seenUrls = new Set();
  const normalizedRows = [];

  for (const row of Array.isArray(rawResults) ? rawResults : []) {
    const url = normalizeResultUrl(row?.url || row?.link || row?.href || '');
    if (!url || seenUrls.has(url)) {
      continue;
    }

    const title = String(row?.title || '').replace(/\s+/g, ' ').trim();
    if (!title) {
      continue;
    }

    seenUrls.add(url);
    normalizedRows.push({
      position: normalizedRows.length + 1,
      title,
      url,
    });

    if (normalizedRows.length >= limit) {
      break;
    }
  }

  return normalizedRows;
}

module.exports = {
  normalizeSearchResults,
};
