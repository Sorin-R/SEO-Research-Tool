const puppeteer = require('puppeteer');
const { throttle } = require('../utils/rateLimiter');

/**
 * Scrape "People Also Ask" questions from Google for a keyword.
 * Requires Puppeteer because PAA boxes are dynamically loaded.
 *
 * @param {string} keyword
 * @returns {Promise<string[]>} Array of question strings
 */
async function getPeopleAlsoAsk(keyword) {
  await throttle();

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(keyword)}&hl=en`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // Extract PAA questions from various selectors Google uses
    const questions = await page.evaluate(() => {
      const results = [];

      // Primary selector: the "related questions" block
      const paaElements = document.querySelectorAll(
        '[data-sgrd] [role="heading"], .related-question-pair [role="heading"], div.xpc span'
      );

      paaElements.forEach((el) => {
        const text = el.textContent.trim();
        if (text && text.includes('?') && !results.includes(text)) {
          results.push(text);
        }
      });

      // Fallback: look for jsname-based PAA containers
      if (results.length === 0) {
        document.querySelectorAll('[jsname] [role="button"]').forEach((el) => {
          const text = el.textContent.trim();
          if (text && text.endsWith('?') && !results.includes(text)) {
            results.push(text);
          }
        });
      }

      return results;
    });

    return questions;
  } finally {
    await browser.close();
  }
}

module.exports = { getPeopleAlsoAsk };
