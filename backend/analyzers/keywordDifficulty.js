const { clamp } = require('../utils/helpers');

/**
 * Well-known high-authority domains used as a proxy for domain authority.
 * Since we don't have access to paid DA APIs, we estimate based on domain recognition.
 */
const HIGH_AUTHORITY_DOMAINS = new Set([
  'wikipedia.org', 'amazon.com', 'youtube.com', 'reddit.com',
  'quora.com', 'medium.com', 'forbes.com', 'nytimes.com',
  'bbc.com', 'cnn.com', 'healthline.com', 'webmd.com',
  'nih.gov', 'gov', 'edu', 'mayoclinic.org', 'allrecipes.com',
  'food.com', 'epicurious.com', 'tasty.co', 'delish.com',
]);

/**
 * Estimate a rough domain authority score (0-100) for a URL.
 * This is a heuristic proxy — real DA requires paid data from Moz/Ahrefs.
 *
 * @param {string} url
 * @returns {number} Estimated DA 0-100
 */
function estimateDomainAuthority(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');

    // Check if domain or TLD is in the high-authority set
    if (HIGH_AUTHORITY_DOMAINS.has(hostname)) return 90;
    if (hostname.endsWith('.gov') || hostname.endsWith('.edu')) return 85;

    // Check partial matches (e.g., "en.wikipedia.org")
    for (const domain of HIGH_AUTHORITY_DOMAINS) {
      if (hostname.includes(domain)) return 80;
    }

    // Heuristic: shorter domains with common TLDs tend to have higher DA
    const parts = hostname.split('.');
    if (parts.length <= 2 && hostname.endsWith('.com')) return 50;
    if (parts.length <= 2) return 40;

    return 30; // Default for unknown domains
  } catch {
    return 30;
  }
}

/**
 * Calculate keyword difficulty score (0-100) based on competitor page analysis.
 *
 * Formula:
 *   difficulty = (avg_word_count_score × 0.3)
 *              + (keyword_in_title_ratio × 0.3)
 *              + (avg_domain_authority × 0.4)
 *
 * @param {Object} serpAnalysis - Output from serpAnalyzer.analyzeSERP()
 * @returns {Object} { score, breakdown, level }
 */
function calculateDifficulty(serpAnalysis) {
  const { results, averages, keyword } = serpAnalysis;

  if (!averages || results.length === 0) {
    return { score: 0, breakdown: null, level: 'unknown' };
  }

  // --- Factor 1: Average word count score (0-100) ---
  // Higher word count = more competitive / more effort required
  const wordCountScore = clamp(averages.avgWordCount / 30, 0, 100);

  // --- Factor 2: Keyword in title ratio (0-100) ---
  // Already a percentage from averages
  const titleOptimizationScore = averages.keywordInTitleRatio;

  // --- Factor 3: Average domain authority of top results (0-100) ---
  const daScores = results
    .filter((r) => !r.error)
    .map((r) => estimateDomainAuthority(r.url));
  const avgDA = daScores.length > 0
    ? daScores.reduce((sum, da) => sum + da, 0) / daScores.length
    : 50;

  // --- Weighted difficulty ---
  const rawScore =
    wordCountScore * 0.3 +
    titleOptimizationScore * 0.3 +
    avgDA * 0.4;

  const score = Math.round(clamp(rawScore, 0, 100));

  // Difficulty level label
  let level;
  if (score <= 20) level = 'very_easy';
  else if (score <= 40) level = 'easy';
  else if (score <= 60) level = 'medium';
  else if (score <= 80) level = 'hard';
  else level = 'very_hard';

  return {
    score,
    level,
    breakdown: {
      wordCountScore: Math.round(wordCountScore),
      titleOptimizationScore: Math.round(titleOptimizationScore),
      avgDomainAuthority: Math.round(avgDA),
    },
    recommendation: getDifficultyRecommendation(score, averages),
  };
}

/**
 * Provide actionable recommendations based on the difficulty score.
 */
function getDifficultyRecommendation(score, averages) {
  if (score <= 30) {
    return `Low competition. Target ${averages.avgWordCount + 200}+ words with the keyword in your title.`;
  }
  if (score <= 60) {
    return `Moderate competition. Aim for ${averages.avgWordCount + 500}+ words, include ${averages.avgImages + 3}+ images, and build quality backlinks.`;
  }
  return `High competition. You'll need ${averages.avgWordCount + 1000}+ words of expert content, strong backlinks, and comprehensive topic coverage to rank.`;
}

module.exports = { calculateDifficulty, estimateDomainAuthority };
