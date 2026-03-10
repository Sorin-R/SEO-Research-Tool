import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import KeywordResearch from './pages/KeywordResearch';
import GoogleAdsKeywordResearch from './pages/GoogleAdsKeywordResearch';
import SERPAnalyzer from './pages/SERPAnalyzer';
import ContentAnalyzer from './pages/ContentAnalyzer';
import GoogleTrends from './pages/GoogleTrends';
import RankTracker from './pages/RankTracker';
import ProviderStatus from './pages/ProviderStatus';
import AIProviderStatus from './pages/AIProviderStatus';
import SiteAudit from './pages/SiteAudit';
import CompetitorKeywords from './pages/CompetitorKeywords';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/keywords" element={<KeywordResearch />} />
        <Route path="/competitor-keywords" element={<CompetitorKeywords />} />
        <Route path="/google-ads" element={<GoogleAdsKeywordResearch />} />
        <Route path="/serp" element={<SERPAnalyzer />} />
        <Route path="/analyze" element={<ContentAnalyzer />} />
        <Route path="/trends" element={<GoogleTrends />} />
        <Route path="/rank-tracker" element={<RankTracker />} />
        <Route path="/site-audit" element={<SiteAudit />} />
        <Route path="/providers" element={<ProviderStatus />} />
        <Route path="/ai-providers" element={<AIProviderStatus />} />
      </Route>
    </Routes>
  );
}
