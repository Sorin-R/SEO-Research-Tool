/**
 * Simple in-memory rate limiter for outbound scraping requests.
 * Ensures we don't hammer external services.
 */

const DELAY_MS = parseInt(process.env.SCRAPE_DELAY_MS, 10) || 2000;

let lastRequestTime = 0;

/**
 * Wait until enough time has passed since the last scrape request.
 * Serialises outbound requests to respect rate limits.
 */
async function throttle() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;

  if (elapsed < DELAY_MS) {
    const wait = DELAY_MS - elapsed;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }

  lastRequestTime = Date.now();
}

module.exports = { throttle };
