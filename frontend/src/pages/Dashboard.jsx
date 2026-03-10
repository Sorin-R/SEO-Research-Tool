import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import StatCard from '../components/StatCard';
import LoadingSpinner from '../components/LoadingSpinner';
import { getTrackedKeywords, getLatestRankings } from '../services/api';

export default function Dashboard() {
  const [keywords, setKeywords] = useState([]);
  const [rankings, setRankings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [kws, ranks] = await Promise.all([
          getTrackedKeywords().catch(() => []),
          getLatestRankings().catch(() => []),
        ]);
        setKeywords(kws);
        setRankings(ranks);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const top10Count = rankings.filter((r) => r.position && r.position <= 10).length;
  const avgPosition = rankings.length > 0
    ? Math.round(rankings.reduce((sum, r) => sum + (r.position || 100), 0) / rankings.length)
    : null;

  if (loading) return <LoadingSpinner message="Loading dashboard..." />;

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Dashboard</h2>
      <p className="text-sm text-gray-500 mb-8">Overview of your SEO research activity.</p>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <StatCard label="Tracked Keywords" value={keywords.length} />
        <StatCard label="Top 10 Rankings" value={top10Count} />
        <StatCard
          label="Avg Position"
          value={avgPosition != null ? `#${avgPosition}` : '—'}
        />
        <StatCard label="Rankings Recorded" value={rankings.length} />
      </div>

      {/* Quick actions */}
      <h3 className="font-semibold text-gray-900 mb-4">Quick Actions</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
        <QuickAction
          to="/keywords"
          title="Keyword Research"
          description="Discover new keyword opportunities with Google Autocomplete."
        />
        <QuickAction
          to="/google-ads"
          title="Google Ads Keywords"
          description="Get PPC metrics: search volume, competition, CPC."
        />
        <QuickAction
          to="/serp"
          title="SERP Analysis"
          description="Analyze top 10 results for any keyword."
        />
        <QuickAction
          to="/analyze"
          title="Content Analyzer"
          description="Score your content against competitors."
        />
        <QuickAction
          to="/trends"
          title="Google Trends"
          description="Explore search interest over time."
        />
        <QuickAction
          to="/rank-tracker"
          title="Rank Tracker"
          description="Monitor your keyword positions daily."
        />
        <QuickAction
          to="/providers"
          title="SERP Providers"
          description="Manage and configure SERP API providers."
        />
      </div>

      {/* Recent tracked keywords */}
      {keywords.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <h3 className="font-semibold text-gray-900 px-5 py-4 border-b border-gray-200">
            Recently Tracked Keywords
          </h3>
          <div className="divide-y divide-gray-100">
            {keywords.slice(0, 10).map((kw) => {
              const rank = rankings.find((r) => r.keyword_id === kw.id || r.keyword === kw.keyword);
              return (
                <div key={kw.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{kw.keyword}</p>
                    <p className="text-xs text-gray-400">
                      Added {new Date(kw.created_at).toLocaleDateString()}
                      {kw.difficulty != null && ` · Difficulty: ${kw.difficulty}`}
                    </p>
                  </div>
                  {rank?.position && (
                    <span className={`text-sm font-bold ${rank.position <= 3 ? 'text-green-600' : rank.position <= 10 ? 'text-indigo-600' : 'text-gray-500'}`}>
                      #{rank.position}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function QuickAction({ to, title, description }) {
  return (
    <Link
      to={to}
      className="block bg-white rounded-lg border border-gray-200 p-5 hover:border-indigo-300 hover:shadow-sm transition-all"
    >
      <h4 className="text-sm font-semibold text-gray-900 mb-1">{title}</h4>
      <p className="text-xs text-gray-500">{description}</p>
    </Link>
  );
}
