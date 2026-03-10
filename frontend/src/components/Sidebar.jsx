import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '📊' },
  { to: '/keywords', label: 'Keyword Research', icon: '🔑' },
  { to: '/google-ads', label: 'Google Ads Keywords', icon: '💰' },
  { to: '/serp', label: 'SERP Analyzer', icon: '🔍' },
  { to: '/analyze', label: 'Content Analyzer', icon: '📝' },
  { to: '/site-audit', label: 'Site Audit', icon: '🩺' },
  { to: '/trends', label: 'Google Trends', icon: '📈' },
  { to: '/rank-tracker', label: 'Rank Tracker', icon: '🏆' },
  { to: '/providers', label: 'SERP Providers', icon: '⚙️' },
  { to: '/ai-providers', label: 'AI Providers', icon: '🤖' },
];

export default function Sidebar() {
  return (
    <aside className="w-64 bg-gray-900 text-gray-100 min-h-screen flex flex-col shrink-0">
      <div className="px-6 py-5 border-b border-gray-700">
        <h1 className="text-xl font-bold tracking-tight">SEO Research Tool</h1>
        <p className="text-xs text-gray-400 mt-1">Personal SEO Suite</p>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            <span className="text-lg">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="px-6 py-4 border-t border-gray-700 text-xs text-gray-500">
        v1.0.0 &middot; Local Tool
      </div>
    </aside>
  );
}
