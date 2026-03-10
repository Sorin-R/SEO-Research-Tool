const axios = require('axios');
const cheerio = require('cheerio');
const { countWords, clamp } = require('../utils/helpers');
const { throttle } = require('../utils/rateLimiter');

/**
 * Analyze content for SEO quality.
 * Accepts either raw text + keyword or a URL + keyword.
 *
 * @param {Object} options
 * @param {string} [options.text]    - Raw article text
 * @param {string} [options.url]     - URL to fetch and analyze
 * @param {string}  options.keyword  - Target keyword
 * @param {Object} [options.competitorData] - Average metrics from SERP analysis
 * @returns {Promise<Object>} SEO analysis results
 */
async function analyzeContent({ text, url, keyword, competitorData }) {
  let content = text || '';
  let headings = { h1: [], h2: [], h3: [] };
  let title = '';
  let metaDescription = '';
  let imageCount = 0;

  // If URL provided, fetch and parse the page
  if (url && !text) {
    const pageData = await fetchAndParse(url);
    content = pageData.text;
    headings = pageData.headings;
    title = pageData.title;
    metaDescription = pageData.metaDescription;
    imageCount = pageData.imageCount;
  } else if (text) {
    // Extract headings from raw text (markdown-style)
    headings = extractMarkdownHeadings(text);
  }

  const wordCount = countWords(content);
  const keywordLower = keyword.toLowerCase();
  const contentLower = content.toLowerCase();

  // --- Keyword density ---
  const keywordCount = countOccurrences(contentLower, keywordLower);
  const keywordDensity = wordCount > 0 ? (keywordCount / wordCount) * 100 : 0;

  // --- Heading analysis ---
  const keywordInH1 = headings.h1.some((h) =>
    h.toLowerCase().includes(keywordLower)
  );
  const keywordInH2 = headings.h2.some((h) =>
    h.toLowerCase().includes(keywordLower)
  );
  const totalHeadings = headings.h1.length + headings.h2.length + headings.h3.length;

  // --- Competitor-based gap analysis ---
  const recommendedWordCount = competitorData?.avgWordCount
    ? Math.round(competitorData.avgWordCount * 1.1)
    : 1500;

  // --- SEO Score calculation (0-100) ---
  let score = 0;

  // Word count (25 points)
  const wordCountRatio = Math.min(wordCount / recommendedWordCount, 1.5);
  score += Math.min(wordCountRatio * 25, 25);

  // Keyword density — ideal range 1-3% (20 points)
  if (keywordDensity >= 0.5 && keywordDensity <= 3.0) {
    score += 20;
  } else if (keywordDensity > 0 && keywordDensity < 0.5) {
    score += 10;
  } else if (keywordDensity > 3.0 && keywordDensity <= 5.0) {
    score += 10; // Over-optimized
  }

  // Keyword in H1 (15 points)
  if (keywordInH1) score += 15;

  // Keyword in H2 (10 points)
  if (keywordInH2) score += 10;

  // Heading structure (15 points)
  if (headings.h1.length >= 1) score += 5;
  if (headings.h2.length >= 2) score += 5;
  if (headings.h3.length >= 1) score += 5;

  // Meta description (10 points)
  if (metaDescription) {
    score += metaDescription.length >= 120 && metaDescription.length <= 160 ? 10 : 5;
  }

  // Images (5 points)
  if (imageCount >= 3) score += 5;
  else if (imageCount >= 1) score += 2;

  score = clamp(Math.round(score), 0, 100);

  // --- Find missing topics from competitor headings ---
  const missingTopics = competitorData?.commonTopics
    ? findMissingTopics(content, competitorData.commonTopics)
    : [];

  // --- Build improvement suggestions ---
  const suggestions = buildSuggestions({
    wordCount,
    recommendedWordCount,
    keywordDensity,
    keywordInH1,
    totalHeadings,
    imageCount,
    metaDescription,
  });

  return {
    url: url || null,
    keyword,
    seoScore: score,
    wordCount,
    recommendedWordCount,
    keywordDensity: Math.round(keywordDensity * 100) / 100,
    keywordCount,
    headings: {
      h1: headings.h1.length,
      h2: headings.h2.length,
      h3: headings.h3.length,
      keywordInH1,
      keywordInH2,
    },
    metaDescription: metaDescription || null,
    imageCount,
    missingTopics,
    suggestions,
  };
}

/**
 * Fetch a URL and extract text content and structure.
 */
async function fetchAndParse(url) {
  await throttle();

  const { data: html } = await axios.get(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
    timeout: 15000,
  });

  const $ = cheerio.load(html);

  // Remove non-content elements
  $('script, style, nav, footer, header, aside, .sidebar, .menu').remove();

  const headings = { h1: [], h2: [], h3: [] };
  ['h1', 'h2', 'h3'].forEach((tag) => {
    $(tag).each((_, el) => {
      const text = $(el).text().trim();
      if (text) headings[tag].push(text);
    });
  });

  return {
    text: $('body').text().replace(/\s+/g, ' ').trim(),
    headings,
    title: $('title').text().trim(),
    metaDescription:
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      '',
    imageCount: $('img').length,
  };
}

/**
 * Extract headings from markdown-style text.
 */
function extractMarkdownHeadings(text) {
  const headings = { h1: [], h2: [], h3: [] };
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('### ')) headings.h3.push(trimmed.slice(4));
    else if (trimmed.startsWith('## ')) headings.h2.push(trimmed.slice(3));
    else if (trimmed.startsWith('# ')) headings.h1.push(trimmed.slice(2));
  }

  return headings;
}

/**
 * Count non-overlapping occurrences of a substring.
 */
function countOccurrences(text, sub) {
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(sub, pos)) !== -1) {
    count++;
    pos += sub.length;
  }
  return count;
}

/**
 * Find topics present in competitor content but missing from the user's content.
 */
function findMissingTopics(content, competitorTopics) {
  const lower = content.toLowerCase();
  return competitorTopics.filter((topic) => !lower.includes(topic.toLowerCase()));
}

/**
 * Generate actionable improvement suggestions.
 */
function buildSuggestions(metrics) {
  const suggestions = [];

  if (metrics.wordCount < metrics.recommendedWordCount) {
    suggestions.push(
      `Increase word count from ${metrics.wordCount} to at least ${metrics.recommendedWordCount}.`
    );
  }

  if (metrics.keywordDensity < 0.5) {
    suggestions.push('Keyword density is too low. Use the target keyword more naturally throughout the content.');
  } else if (metrics.keywordDensity > 3.0) {
    suggestions.push('Keyword density is too high. Reduce keyword usage to avoid over-optimization.');
  }

  if (!metrics.keywordInH1) {
    suggestions.push('Include the target keyword in your H1 heading.');
  }

  if (metrics.totalHeadings < 4) {
    suggestions.push('Add more subheadings (H2, H3) to improve content structure and readability.');
  }

  if (metrics.imageCount < 3) {
    suggestions.push('Add more images to improve engagement and visual appeal.');
  }

  if (!metrics.metaDescription) {
    suggestions.push('Add a meta description between 120-160 characters including the target keyword.');
  }

  return suggestions;
}

module.exports = { analyzeContent };
