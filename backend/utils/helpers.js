/**
 * Shared helper utilities.
 */

/**
 * Extract the root domain from a URL string.
 * e.g. "https://www.example.com/page" → "example.com"
 */
function extractDomain(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Count words in a block of text.
 */
function countWords(text) {
  if (!text) return 0;
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean).length;
}

/**
 * Clamp a number between min and max.
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Safely parse JSON, returning null on failure.
 */
function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

module.exports = { extractDomain, countWords, clamp, sleep, safeJsonParse };
