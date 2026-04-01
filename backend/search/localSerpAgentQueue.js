const crypto = require('crypto');

const DEFAULT_WAIT_POLL_MS = Number.parseInt(process.env.LOCAL_SERP_WAIT_POLL_MS || '500', 10);
const DEFAULT_JOB_TIMEOUT_MS = Number.parseInt(process.env.LOCAL_SERP_JOB_TIMEOUT_MS || '180000', 10);
const DEFAULT_CLAIM_TIMEOUT_MS = Number.parseInt(process.env.LOCAL_SERP_CLAIM_TIMEOUT_MS || '120000', 10);
const DEFAULT_RETENTION_MS = Number.parseInt(process.env.LOCAL_SERP_RETENTION_MS || '600000', 10);
const DEFAULT_AGENT_STALE_MS = Number.parseInt(process.env.LOCAL_SERP_AGENT_STALE_MS || '45000', 10);

const jobs = new Map();
const queue = [];
const agents = new Map();

function now() {
  return Date.now();
}

function isFinalStatus(status) {
  return status === 'completed' || status === 'failed' || status === 'timeout';
}

function toSerializableJob(job) {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    claimedAt: job.claimedAt || null,
    claimedBy: job.claimedBy || null,
    completedAt: job.completedAt || null,
    failedAt: job.failedAt || null,
    payload: job.payload,
    result: job.result || null,
    error: job.error || null,
  };
}

function cleanupJobs() {
  const timestamp = now();

  for (const [id, job] of jobs.entries()) {
    if (job.status === 'claimed' && timestamp - job.claimedAt > DEFAULT_CLAIM_TIMEOUT_MS) {
      job.status = 'pending';
      job.claimedAt = null;
      job.claimedBy = null;
      queue.push(id);
    }

    if (isFinalStatus(job.status) && timestamp - (job.updatedAt || job.createdAt) > DEFAULT_RETENTION_MS) {
      jobs.delete(id);
    }
  }

  for (const [agentId, details] of agents.entries()) {
    if (timestamp - Number(details?.lastSeen || 0) > DEFAULT_RETENTION_MS) {
      agents.delete(agentId);
    }
  }
}

function createJob(payload) {
  cleanupJobs();

  const id = crypto.randomUUID();
  const timestamp = now();

  const job = {
    id,
    status: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
    claimedAt: null,
    claimedBy: null,
    completedAt: null,
    failedAt: null,
    payload,
    result: null,
    error: null,
  };

  jobs.set(id, job);
  queue.push(id);

  return toSerializableJob(job);
}

function claimNextJob(agentId = 'local-agent') {
  cleanupJobs();

  while (queue.length > 0) {
    const nextId = queue.shift();
    const job = jobs.get(nextId);
    if (!job || job.status !== 'pending') {
      continue;
    }

    job.status = 'claimed';
    job.claimedAt = now();
    job.claimedBy = String(agentId || 'local-agent').trim() || 'local-agent';
    job.updatedAt = now();

    return toSerializableJob(job);
  }

  return null;
}

function completeJob(jobId, result) {
  const job = jobs.get(String(jobId || '').trim());
  if (!job) {
    return null;
  }

  if (isFinalStatus(job.status)) {
    return toSerializableJob(job);
  }

  job.status = 'completed';
  job.result = result || null;
  job.completedAt = now();
  job.updatedAt = job.completedAt;

  return toSerializableJob(job);
}

function failJob(jobId, errorMessage, meta = null) {
  const job = jobs.get(String(jobId || '').trim());
  if (!job) {
    return null;
  }

  if (isFinalStatus(job.status)) {
    return toSerializableJob(job);
  }

  job.status = 'failed';
  job.error = {
    message: String(errorMessage || 'Local SERP agent failed.'),
    meta: meta || null,
  };
  job.failedAt = now();
  job.updatedAt = job.failedAt;

  return toSerializableJob(job);
}

async function waitForJob(jobId, timeoutMs = DEFAULT_JOB_TIMEOUT_MS) {
  const startedAt = now();
  const lookupId = String(jobId || '').trim();

  while (now() - startedAt <= timeoutMs) {
    const job = jobs.get(lookupId);
    if (!job) {
      return null;
    }
    if (isFinalStatus(job.status)) {
      return toSerializableJob(job);
    }

    await new Promise((resolve) => setTimeout(resolve, DEFAULT_WAIT_POLL_MS));
  }

  const timedOut = failJob(lookupId, 'Local SERP agent timeout.');
  if (timedOut && timedOut.status === 'failed') {
    const original = jobs.get(lookupId);
    if (original) {
      original.status = 'timeout';
      original.updatedAt = now();
    }
  }
  const timeoutJob = jobs.get(lookupId);
  return timeoutJob ? toSerializableJob(timeoutJob) : null;
}

function getQueueStats() {
  cleanupJobs();

  let pending = 0;
  let claimed = 0;
  let completed = 0;
  let failed = 0;

  for (const job of jobs.values()) {
    if (job.status === 'pending') pending += 1;
    if (job.status === 'claimed') claimed += 1;
    if (job.status === 'completed') completed += 1;
    if (job.status === 'failed' || job.status === 'timeout') failed += 1;
  }

  return {
    total: jobs.size,
    pending,
    claimed,
    completed,
    failed,
  };
}

function registerAgentHeartbeat(agentId = 'local-agent', nextState = null) {
  cleanupJobs();
  const normalizedAgentId = String(agentId || 'local-agent').trim() || 'local-agent';
  const existing = agents.get(normalizedAgentId) || {};
  const state = existing.state && typeof existing.state === 'object' ? { ...existing.state } : {};

  if (nextState && typeof nextState === 'object') {
    if ('captchaPending' in nextState) {
      state.captchaPending = Boolean(nextState.captchaPending);
    }
    if ('captchaUrl' in nextState) {
      state.captchaUrl = nextState.captchaUrl ? String(nextState.captchaUrl).trim() : null;
    }
    if ('status' in nextState) {
      state.status = nextState.status ? String(nextState.status).trim().slice(0, 80) : null;
    }
    state.updatedAt = now();
  }

  agents.set(normalizedAgentId, {
    id: normalizedAgentId,
    lastSeen: now(),
    state,
  });
}

function getAgentStats(maxAgeMs = DEFAULT_AGENT_STALE_MS) {
  cleanupJobs();
  const timestamp = now();
  const ageLimit = Number.parseInt(maxAgeMs, 10) || DEFAULT_AGENT_STALE_MS;

  const list = [...agents.values()].map((entry) => ({
    id: entry.id,
    lastSeen: entry.lastSeen,
    online: timestamp - Number(entry.lastSeen || 0) <= ageLimit,
    state: entry.state || {},
  }));

  return {
    total: list.length,
    online: list.filter((item) => item.online).length,
    maxAgeMs: ageLimit,
    agents: list,
  };
}

function hasRecentAgent(maxAgeMs = DEFAULT_AGENT_STALE_MS) {
  return getAgentStats(maxAgeMs).online > 0;
}

module.exports = {
  createJob,
  claimNextJob,
  completeJob,
  failJob,
  waitForJob,
  getQueueStats,
  registerAgentHeartbeat,
  getAgentStats,
  hasRecentAgent,
};
