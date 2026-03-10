const { analyzeSERP, computeAverages } = require('./serpAnalyzer');
const { calculateDifficulty, estimateDomainAuthority } = require('./keywordDifficulty');
const { analyzeContent } = require('./contentAnalyzer');

module.exports = {
  analyzeSERP,
  computeAverages,
  calculateDifficulty,
  estimateDomainAuthority,
  analyzeContent,
};
