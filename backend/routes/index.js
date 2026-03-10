const express = require('express');
const router = express.Router();

const keywordsRouter = require('./keywords');
const serpRouter = require('./serp');
const analyzeRouter = require('./analyze');
const siteAuditRouter = require('./siteAudit');
const trendsRouter = require('./trends');
const googleAdsRouter = require('./googleAds');

router.use('/keywords', keywordsRouter);
router.use('/serp', serpRouter);
router.use('/analyze', analyzeRouter);
router.use('/site-audit', siteAuditRouter);
router.use('/trends', trendsRouter);
router.use('/google-ads', googleAdsRouter);

module.exports = router;
