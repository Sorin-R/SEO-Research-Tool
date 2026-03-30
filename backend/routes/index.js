const express = require('express');
const router = express.Router();

const keywordsRouter = require('./keywords');
const serpRouter = require('./serp');
const analyzeRouter = require('./analyze');
const siteAuditRouter = require('./siteAudit');
const trendsRouter = require('./trends');
const googleAdsRouter = require('./googleAds');
const aiProvidersRouter = require('./aiProviders');
const gscProvidersRouter = require('./gscProviders');
const websitesRouter = require('./websites');
const dashboardRouter = require('./dashboard');
const searchRouter = require('./search');
const localSerpAgentRouter = require('./localSerpAgent');

router.use('/keywords', keywordsRouter);
router.use('/serp', serpRouter);
router.use('/analyze', analyzeRouter);
router.use('/site-audit', siteAuditRouter);
router.use('/trends', trendsRouter);
router.use('/google-ads', googleAdsRouter);
router.use('/ai-providers', aiProvidersRouter);
router.use('/gsc-providers', gscProvidersRouter);
router.use('/websites', websitesRouter);
router.use('/dashboard', dashboardRouter);
router.use('/search', searchRouter);
router.use('/local-serp-agent', localSerpAgentRouter);

module.exports = router;
