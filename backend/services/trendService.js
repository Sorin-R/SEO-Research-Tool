const googleTrends = require('google-trends-api');

const ALLOWED_PROPERTIES = new Set(['', 'images', 'news', 'youtube', 'froogle']);

function normalizeGeo(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeCategory(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeProperty(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ALLOWED_PROPERTIES.has(normalized) ? normalized : '';
}

function toValidDate(value) {
  if (!value) {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseTimeframeWindow(timeframe) {
  const value = String(timeframe || '').trim();
  if (!value) {
    return null;
  }

  const now = Date.now();
  const byPreset = {
    'now 1-H': now - 1 * 60 * 60 * 1000,
    'now 4-H': now - 4 * 60 * 60 * 1000,
    'now 1-d': now - 24 * 60 * 60 * 1000,
    'now 7-d': now - 7 * 24 * 60 * 60 * 1000,
    'today 1-m': now - 30 * 24 * 60 * 60 * 1000,
    'today 3-m': now - 90 * 24 * 60 * 60 * 1000,
    'today 12-m': now - 365 * 24 * 60 * 60 * 1000,
    'today 5-y': now - 5 * 365 * 24 * 60 * 60 * 1000,
    all: new Date('2004-01-01T00:00:00.000Z').getTime(),
  };

  const timestamp = byPreset[value];
  if (!timestamp) {
    return null;
  }

  return {
    startTime: new Date(timestamp),
    endTime: new Date(now),
  };
}

function resolveDateWindow(options = {}) {
  const explicitStart = toValidDate(options.startTime);
  const explicitEnd = toValidDate(options.endTime);
  if (explicitStart && explicitEnd && explicitStart <= explicitEnd) {
    return {
      startTime: explicitStart,
      endTime: explicitEnd,
    };
  }

  const fromTimeframe = parseTimeframeWindow(options.timeframe);
  if (fromTimeframe) {
    return fromTimeframe;
  }

  const months = Number.parseInt(options.months, 10);
  const monthsBack = Number.isFinite(months) && months > 0 ? months : 12;
  const endTime = explicitEnd || new Date();
  const startTime = new Date(endTime.getTime() - monthsBack * 30 * 24 * 60 * 60 * 1000);
  return {
    startTime,
    endTime,
  };
}

function buildTrendRequestOptions(options = {}) {
  const { startTime, endTime } = resolveDateWindow(options);
  return {
    geo: normalizeGeo(options.geo),
    category: normalizeCategory(options.category),
    property: normalizeProperty(options.property),
    startTime,
    endTime,
  };
}

function labelGeo(geo) {
  return geo || 'Worldwide';
}

function safeParseJson(raw) {
  if (typeof raw === 'object' && raw != null) {
    return raw;
  }
  try {
    return JSON.parse(String(raw || '{}'));
  } catch {
    return null;
  }
}

function normalizeResolution(value) {
  const normalized = String(value || 'COUNTRY').trim().toUpperCase();
  const allowed = new Set(['COUNTRY', 'REGION', 'CITY', 'DMA']);
  return allowed.has(normalized) ? normalized : 'COUNTRY';
}

/**
 * Get interest-over-time data for a keyword from Google Trends.
 *
 * @param {string} keyword
 * @param {Object} [options]
 * @param {string} [options.geo]       - Country code (e.g., "US")
 * @param {string} [options.timeframe] - e.g., "today 12-m", "today 3-m", "now 7-d"
 * @returns {Promise<Object>}
 */
async function getInterestOverTime(keyword, options = {}) {
  const requestOptions = buildTrendRequestOptions(options);

  const raw = await googleTrends.interestOverTime({
    keyword,
    ...requestOptions,
  });

  const data = JSON.parse(raw);
  const timeline = data.default?.timelineData || [];

  return {
    keyword,
    geo: labelGeo(requestOptions.geo),
    request: {
      startTime: requestOptions.startTime?.toISOString() || null,
      endTime: requestOptions.endTime?.toISOString() || null,
      category: requestOptions.category,
      property: requestOptions.property || 'web',
    },
    timelineData: timeline.map((point) => ({
      date: point.formattedTime,
      timestamp: point.time,
      value: point.value?.[0] ?? 0,
    })),
  };
}

/**
 * Get related queries for a keyword.
 *
 * @param {string} keyword
 * @param {Object} [options]
 * @returns {Promise<Object>} { top, rising }
 */
async function getRelatedQueries(keyword, options = {}) {
  const requestOptions = buildTrendRequestOptions(options);

  const raw = await googleTrends.relatedQueries({
    keyword,
    ...requestOptions,
  });

  const data = JSON.parse(raw);
  const queryData = data.default?.rankedList || [];

  const top = queryData[0]?.rankedKeyword?.map((item) => ({
    query: item.query,
    value: item.value,
  })) || [];

  const rising = queryData[1]?.rankedKeyword?.map((item) => ({
    query: item.query,
    value: item.value,
    formattedValue: item.formattedValue,
  })) || [];

  return {
    keyword,
    geo: labelGeo(requestOptions.geo),
    request: {
      startTime: requestOptions.startTime?.toISOString() || null,
      endTime: requestOptions.endTime?.toISOString() || null,
      category: requestOptions.category,
      property: requestOptions.property || 'web',
    },
    top,
    rising,
  };
}

/**
 * Get related topics for a keyword.
 *
 * @param {string} keyword
 * @param {Object} [options]
 * @returns {Promise<Object>} { top, rising }
 */
async function getRelatedTopics(keyword, options = {}) {
  const requestOptions = buildTrendRequestOptions(options);

  const raw = await googleTrends.relatedTopics({
    keyword,
    ...requestOptions,
  });

  const data = JSON.parse(raw);
  const topicData = data.default?.rankedList || [];

  const top = topicData[0]?.rankedKeyword?.map((item) => ({
    title: item.topic?.title,
    type: item.topic?.type,
    value: item.value,
  })) || [];

  const rising = topicData[1]?.rankedKeyword?.map((item) => ({
    title: item.topic?.title,
    type: item.topic?.type,
    value: item.value,
    formattedValue: item.formattedValue,
  })) || [];

  return {
    keyword,
    geo: labelGeo(requestOptions.geo),
    request: {
      startTime: requestOptions.startTime?.toISOString() || null,
      endTime: requestOptions.endTime?.toISOString() || null,
      category: requestOptions.category,
      property: requestOptions.property || 'web',
    },
    top,
    rising,
  };
}

/**
 * Compare interest between multiple keywords.
 *
 * @param {string[]} keywords - Array of keywords (max 5)
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
async function compareKeywords(keywords, options = {}) {
  if (keywords.length > 5) {
    throw new Error('Google Trends comparison supports a maximum of 5 keywords.');
  }

  const requestOptions = buildTrendRequestOptions(options);

  const raw = await googleTrends.interestOverTime({
    keyword: keywords,
    ...requestOptions,
  });

  const data = JSON.parse(raw);
  const timeline = data.default?.timelineData || [];

  return {
    keywords,
    geo: labelGeo(requestOptions.geo),
    request: {
      startTime: requestOptions.startTime?.toISOString() || null,
      endTime: requestOptions.endTime?.toISOString() || null,
      category: requestOptions.category,
      property: requestOptions.property || 'web',
    },
    timelineData: timeline.map((point) => ({
      date: point.formattedTime,
      values: point.value,
    })),
    averages: data.default?.averages || [],
  };
}

async function getInterestByRegion(keyword, options = {}) {
  const requestOptions = buildTrendRequestOptions(options);
  const requestedResolution = normalizeResolution(options.resolution);
  const resolutionAttemptOrder = [];
  const warnings = [];
  const addResolutionAttempt = (value) => {
    if (!value) {
      return;
    }
    if (!resolutionAttemptOrder.includes(value)) {
      resolutionAttemptOrder.push(value);
    }
  };

  if (!requestOptions.geo && requestedResolution !== 'COUNTRY') {
    warnings.push('Requested resolution is not supported for Worldwide geo. Fallback to COUNTRY.');
    addResolutionAttempt('COUNTRY');
  } else {
    switch (requestedResolution) {
      case 'COUNTRY':
        addResolutionAttempt('COUNTRY');
        if (requestOptions.geo) {
          addResolutionAttempt('REGION');
          addResolutionAttempt('CITY');
        }
        break;
      case 'REGION':
        addResolutionAttempt('REGION');
        addResolutionAttempt('CITY');
        addResolutionAttempt('COUNTRY');
        break;
      case 'CITY':
        addResolutionAttempt('CITY');
        addResolutionAttempt('REGION');
        addResolutionAttempt('COUNTRY');
        break;
      case 'DMA':
        addResolutionAttempt('DMA');
        addResolutionAttempt('REGION');
        addResolutionAttempt('COUNTRY');
        break;
      default:
        addResolutionAttempt('COUNTRY');
        break;
    }
  }

  let selectedResolution = resolutionAttemptOrder[0];
  let rows = [];
  let lastErrorMessage = '';

  for (const resolution of resolutionAttemptOrder) {
    try {
      const raw = await googleTrends.interestByRegion({
        keyword,
        ...requestOptions,
        resolution,
      });

      const data = safeParseJson(raw);
      if (!data?.default?.geoMapData || !Array.isArray(data.default.geoMapData)) {
        if (typeof raw === 'string' && raw.trim().startsWith('<')) {
          throw new Error(`Google Trends returned a non-JSON response for resolution ${resolution}.`);
        }
        throw new Error(`Unexpected response shape from Google Trends for resolution ${resolution}.`);
      }

      rows = data.default.geoMapData;
      if (rows.length === 0 && resolution !== resolutionAttemptOrder[resolutionAttemptOrder.length - 1]) {
        throw new Error(`No region rows returned for resolution ${resolution}.`);
      }
      selectedResolution = resolution;
      if (resolution !== requestedResolution) {
        warnings.push(`Fallback applied: ${requestedResolution} -> ${resolution}.`);
      }
      lastErrorMessage = '';
      break;
    } catch (error) {
      lastErrorMessage = String(error?.message || 'Interest by region fetch failed.');
      if (resolution === resolutionAttemptOrder[resolutionAttemptOrder.length - 1]) {
        warnings.push('Regional data is temporarily unavailable from Google Trends. Returning empty regional results.');
      }
    }
  }

  return {
    keyword,
    geo: labelGeo(requestOptions.geo),
    resolution: selectedResolution,
    requestedResolution,
    request: {
      startTime: requestOptions.startTime?.toISOString() || null,
      endTime: requestOptions.endTime?.toISOString() || null,
      category: requestOptions.category,
      property: requestOptions.property || 'web',
    },
    warnings,
    errors: lastErrorMessage ? [lastErrorMessage] : [],
    regions: rows.map((row) => ({
      location: row.geoName || row.geoCode || '',
      code: row.geoCode || '',
      value: Array.isArray(row.value) ? (row.value[0] ?? 0) : 0,
      formattedValue: Array.isArray(row.formattedValue)
        ? (row.formattedValue[0] ?? '')
        : (row.formattedValue || ''),
    })),
  };
}

module.exports = {
  getInterestOverTime,
  getRelatedQueries,
  getRelatedTopics,
  compareKeywords,
  getInterestByRegion,
};
