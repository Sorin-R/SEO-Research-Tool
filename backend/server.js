const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const { testConnection } = require('./database');
const apiRoutes = require('./routes');
const { keywordService, serpService } = require('./services');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3001;

// ---- Middleware ----

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Serve frontend static files
const frontendPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendPath));

// Rate limit inbound API requests (per IP)
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30,
  message: { error: 'Too many requests. Please try again shortly.' },
});
app.use('/api', apiLimiter);

// ---- API Routes ----

app.use('/api', apiRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ---- Cron Jobs ----

/**
 * Daily rank tracker.
 * Runs every day at 06:00 and checks SERP positions
 * for all tracked keywords.
 */
cron.schedule('0 6 * * *', async () => {
  console.log('[Cron] Starting daily rank check...');

  try {
    const keywords = await keywordService.getTrackedKeywords();
    const targetDomain = process.env.TARGET_DOMAIN || '';

    if (!targetDomain) {
      console.warn('[Cron] TARGET_DOMAIN not set in .env — skipping rank tracking.');
      return;
    }

    for (const kw of keywords) {
      try {
        const result = await serpService.trackRanking(kw.id, kw.keyword, targetDomain);
        console.log(
          `[Cron] Tracked "${kw.keyword}": position ${result.position ?? 'not found'}`
        );
      } catch (err) {
        console.error(`[Cron] Failed to track "${kw.keyword}":`, err.message);
      }
    }

    console.log('[Cron] Daily rank check complete.');
  } catch (err) {
    console.error('[Cron] Rank check job failed:', err.message);
  }
});

// ---- Error handling ----

// Fallback to index.html for client-side routing
app.use((req, res) => {
  // If it's an API request, return 404
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` });
  }
  // Otherwise serve index.html for React Router
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

// ---- Start ----

async function start() {
  try {
    await testConnection();
  } catch {
    console.warn('[Server] MySQL not available — DB features will fail. Continuing anyway...');
  }

  app.listen(PORT, () => {
    console.log(`[Server] SEO Research Tool API running on http://localhost:${PORT}`);
    console.log(`[Server] Health check: http://localhost:${PORT}/health`);
  });
}

start();
