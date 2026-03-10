const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { testConnection, ensureSchema } = require('./database');
const apiRoutes = require('./routes');
const { websiteService } = require('./services');
const { startRankTrackerScheduler } = require('./services/rankTrackerScheduler');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3001;

// ---- Middleware ----

// Hostinger sits behind a reverse proxy, so trust one proxy hop for rate limiting and IP detection.
app.set('trust proxy', 1);

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
    await ensureSchema();
    await websiteService.ensureLegacyDefaultWebsite();
  } catch (error) {
    console.warn('[Server] MySQL not available or schema setup failed — DB features will fail. Continuing anyway...');
    if (error?.message) {
      console.warn('[Server] DB startup details:', error.message);
    }
  }

  try {
    const schedulerSettings = await startRankTrackerScheduler();
    console.log(
      `[Server] Rank tracker scheduled daily at ${schedulerSettings.scheduleTime} (${schedulerSettings.serverTimeZone}).`
    );
  } catch (error) {
    console.warn('[Server] Failed to start rank tracker scheduler:', error.message);
  }

  app.listen(PORT, () => {
    console.log(`[Server] SEO Research Tool API running on http://localhost:${PORT}`);
    console.log(`[Server] Health check: http://localhost:${PORT}/health`);
  });
}

start();
