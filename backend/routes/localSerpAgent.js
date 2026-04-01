const express = require('express');
const {
  createJob,
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

function normalizeEngine(value) {
  return String(value || '').trim().toLowerCase() === 'bing' ? 'bing' : 'google';
}

function normalizeCountry(value) {
  return String(value || '').trim().toUpperCase() === 'GB' ? 'GB' : 'US';
}

function normalizeSearchDomain(engine, domain, country, searchDomain) {
  const explicit = String(searchDomain || '').trim().toLowerCase();
  if (explicit) {
    return explicit;
  }

  const normalizedDomain = String(domain || '').trim().toLowerCase();
  if (engine === 'bing') {
    if (normalizedDomain === 'co.uk') return 'bing.co.uk';
    return 'bing.com';
  }

  if (normalizedDomain === 'co.uk') return 'google.co.uk';
  if (normalizedDomain === 'com') return 'google.com';
  return country === 'GB' ? 'google.co.uk' : 'google.com';
}

function summarizeAgentStatus() {
  const agentStats = getAgentStats();
  const onlineAgents = Array.isArray(agentStats.agents)
    ? agentStats.agents.filter((agent) => agent.online)
    : [];
  const pendingCaptchaAgents = onlineAgents.filter((agent) => agent?.state?.captchaPending);

  return {
    queue: getQueueStats(),
    agents: agentStats,
    captchaPending: pendingCaptchaAgents.length > 0,
    captchaAgents: pendingCaptchaAgents.map((agent) => ({
      id: agent.id,
      captchaUrl: agent?.state?.captchaUrl || null,
      status: agent?.state?.status || null,
      lastSeen: agent.lastSeen,
    })),
  };
}

router.get('/status', requireAuth, (req, res) => {
  res.json({
    ok: true,
    ...summarizeAgentStatus(),
    tokenRequired: Boolean(String(process.env.LOCAL_SERP_AGENT_TOKEN || '').trim()),
  });
});

router.get('/public-status', (_req, res) => {
  res.json({
    ok: true,
    ...summarizeAgentStatus(),
  });
});

router.post('/heartbeat', requireAuth, (req, res) => {
  const agentId = String(req.body?.agentId || req.query?.agentId || 'local-agent').trim() || 'local-agent';
  const state = req.body?.state && typeof req.body.state === 'object' ? req.body.state : null;
  registerAgentHeartbeat(agentId, state);
  return res.json({
    ok: true,
  });
});

router.post('/poll', requireAuth, (req, res) => {
  const agentId = String(req.body?.agentId || req.query?.agentId || 'local-agent').trim() || 'local-agent';
  const state = req.body?.state && typeof req.body.state === 'object' ? req.body.state : null;
  registerAgentHeartbeat(agentId, state);
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

router.post('/captcha/open', (req, res) => {
  const engine = normalizeEngine(req.body?.engine);
  const country = normalizeCountry(req.body?.country);
  const searchDomain = normalizeSearchDomain(engine, req.body?.domain, country, req.body?.searchDomain);
  const keyword = String(req.body?.keyword || 'google').replace(/\s+/g, ' ').trim() || 'google';
  const location = String(req.body?.location || '').replace(/\s+/g, ' ').trim() || null;

  const job = createJob({
    type: 'captcha-helper',
    keyword,
    engine,
    searchDomain,
    country,
    location,
    requestedAt: new Date().toISOString(),
    source: 'captcha-helper',
  });

  return res.json({
    ok: true,
    jobId: job.id,
    message: 'Captcha helper job queued for Local PC Agent.',
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
