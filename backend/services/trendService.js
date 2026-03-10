const googleTrends = require('google-trends-api');

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
  const geo = options.geo || '';
  const startTime = options.startTime || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

  const raw = await googleTrends.interestOverTime({
    keyword,
    geo,
    startTime,
  });

  const data = JSON.parse(raw);
  const timeline = data.default?.timelineData || [];

  return {
    keyword,
    geo: geo || 'Worldwide',
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
  const geo = options.geo || '';
  const startTime = options.startTime || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

  const raw = await googleTrends.relatedQueries({
    keyword,
    geo,
    startTime,
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

  return { keyword, geo: geo || 'Worldwide', top, rising };
}

/**
 * Get related topics for a keyword.
 *
 * @param {string} keyword
 * @param {Object} [options]
 * @returns {Promise<Object>} { top, rising }
 */
async function getRelatedTopics(keyword, options = {}) {
  const geo = options.geo || '';
  const startTime = options.startTime || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

  const raw = await googleTrends.relatedTopics({
    keyword,
    geo,
    startTime,
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

  return { keyword, geo: geo || 'Worldwide', top, rising };
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

  const geo = options.geo || '';
  const startTime = options.startTime || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

  const raw = await googleTrends.interestOverTime({
    keyword: keywords,
    geo,
    startTime,
  });

  const data = JSON.parse(raw);
  const timeline = data.default?.timelineData || [];

  return {
    keywords,
    geo: geo || 'Worldwide',
    timelineData: timeline.map((point) => ({
      date: point.formattedTime,
      values: point.value,
    })),
    averages: data.default?.averages || [],
  };
}

module.exports = {
  getInterestOverTime,
  getRelatedQueries,
  getRelatedTopics,
  compareKeywords,
};
