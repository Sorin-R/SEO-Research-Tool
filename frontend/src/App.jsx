import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import KeywordResearch from './pages/KeywordResearch';
import GoogleAdsKeywordResearch from './pages/GoogleAdsKeywordResearch';
import SERPAnalyzer from './pages/SERPAnalyzer';
import SimpleSerpSearch from './pages/SimpleSerpSearch';
import AiSerpWorkspace from './pages/AiSerpWorkspace';
import ContentAnalyzer from './pages/ContentAnalyzer';
import GoogleTrends from './pages/GoogleTrends';
import RankTracker from './pages/RankTracker';
import ProviderStatus from './pages/ProviderStatus';
import AIProviderStatus from './pages/AIProviderStatus';
import GSCProviderStatus from './pages/GSCProviderStatus';
import BacklinkProviderStatus from './pages/BacklinkProviderStatus';
import SiteAudit from './pages/SiteAudit';
import CompetitorKeywords from './pages/CompetitorKeywords';
import Websites from './pages/Websites';
import { WebsiteProvider } from './context/WebsiteContext';

export default function App() {
  return (
    <WebsiteProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/websites" element={<Websites />} />
          <Route path="/keywords" element={<KeywordResearch />} />
          <Route path="/competitor-keywords" element={<CompetitorKeywords />} />
          <Route path="/google-ads" element={<GoogleAdsKeywordResearch />} />
          <Route path="/serp" element={<SERPAnalyzer />} />
          <Route path="/search" element={<SimpleSerpSearch />} />
          <Route path="/ai-serp" element={<AiSerpWorkspace />} />
          <Route path="/analyze" element={<ContentAnalyzer />} />
          <Route path="/trends" element={<GoogleTrends />} />
          <Route path="/rank-tracker" element={<RankTracker />} />
          <Route path="/site-audit" element={<SiteAudit />} />
          <Route path="/providers" element={<ProviderStatus />} />
          <Route path="/backlink-providers" element={<BacklinkProviderStatus />} />
          <Route path="/ai-providers" element={<AIProviderStatus />} />
          <Route path="/gsc-providers" element={<GSCProviderStatus />} />
          <Route path="/google-tools" element={<GSCProviderStatus />} />
        </Route>
      </Routes>
    </WebsiteProvider>
  );
}
