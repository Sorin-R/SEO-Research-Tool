const express = require('express');
const {
  claimNextJob,
  completeJob,
  failJob,
  getQueueStats,
  registerAgentHeartbeat,
  getAgentStats,
} = require('../search/localSerpAgentQueue');

const router = express.Router();

const DEFAULT_POLL_AFTER_MS = Number.parseInt(process.env.LOCAL_SERP_POLL_AFTER_MS || '2000', 10);

function getProvidedToken(req) {
  const headerToken = String(req.get('x-local-agent-token') || '').trim();
  if (headerToken) {
    return headerToken;
  }

  const authorization = String(req.get('authorization') || '').trim();
  if (authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim();
  }

  return '';
}

function isAuthorized(req) {
  const expected = String(process.env.LOCAL_SERP_AGENT_TOKEN || '').trim();
  if (!expected) {
    return true;
  }
  return getProvidedToken(req) === expected;
}

function requireAuth(req, res, next) {
  if (!isAuthorized(req)) {
    return res.status(401).json({
      error: 'Unauthorized local agent token.',
    });
  }
  next();
}

router.get('/status', requireAuth, (req, res) => {
  res.json({
    ok: true,
    queue: getQueueStats(),
    agents: getAgentStats(),
    tokenRequired: Boolean(String(process.env.LOCAL_SERP_AGENT_TOKEN || '').trim()),
  });
});

router.post('/poll', requireAuth, (req, res) => {
  const agentId = String(req.body?.agentId || req.query?.agentId || 'local-agent').trim() || 'local-agent';
  registerAgentHeartbeat(agentId);
  const claimed = claimNextJob(agentId);

  if (!claimed) {
    return res.json({
      ok: true,
      job: null,
      pollAfterMs: DEFAULT_POLL_AFTER_MS,
      queue: getQueueStats(),
    });
  }

  return res.json({
    ok: true,
    job: {
      id: claimed.id,
      createdAt: claimed.createdAt,
      payload: claimed.payload,
    },
  });
});

router.post('/jobs/:jobId/complete', requireAuth, (req, res) => {
  const jobId = String(req.params?.jobId || '').trim();
  if (!jobId) {
    return res.status(400).json({ error: 'jobId is required.' });
  }

  const completed = completeJob(jobId, {
    results: Array.isArray(req.body?.results) ? req.body.results : [],
    screenshotImageDataUrl: req.body?.screenshotImageDataUrl || null,
    screenshotUrl: req.body?.screenshotUrl || null,
    blockedByEngine: Boolean(req.body?.blockedByEngine),
    debug: req.body?.debug || null,
  });

  if (!completed) {
    return res.status(404).json({ error: 'Job not found.' });
  }

  return res.json({
    ok: true,
    status: completed.status,
  });
});

router.post('/jobs/:jobId/fail', requireAuth, (req, res) => {
  const jobId = String(req.params?.jobId || '').trim();
  if (!jobId) {
    return res.status(400).json({ error: 'jobId is required.' });
  }

  const failed = failJob(
    jobId,
    req.body?.error || 'Local SERP agent failed.',
    req.body?.meta || null
  );

  if (!failed) {
    return res.status(404).json({ error: 'Job not found.' });
  }

  return res.json({
    ok: true,
    status: failed.status,
  });
});

module.exports = router;
