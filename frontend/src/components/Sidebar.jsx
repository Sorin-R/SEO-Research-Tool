import { NavLink } from 'react-router-dom';
import { useWebsiteContext } from '../context/WebsiteContext';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '📊' },
  { to: '/websites', label: 'Websites', icon: '🌐' },
  { to: '/keywords', label: 'Keyword Research', icon: '🔑' },
  { to: '/competitor-keywords', label: 'Competitor Keywords', icon: '🕵️' },
  { to: '/google-ads', label: 'Google Ads Keywords', icon: '💰' },
  { to: '/serp', label: 'SERP Analyzer', icon: '🔍' },
  { to: '/analyze', label: 'Content Analyzer', icon: '📝' },
  { to: '/site-audit', label: 'Site Audit', icon: '🩺' },
  { to: '/trends', label: 'Google Trends', icon: '📈' },
  { to: '/rank-tracker', label: 'Rank Tracker', icon: '🏆' },
  { to: '/providers', label: 'SERP Providers', icon: '⚙️' },
  { to: '/ai-providers', label: 'AI Providers', icon: '🤖' },
  { to: '/gsc-providers', label: 'GSC Provider', icon: '📡' },
];

export default function Sidebar() {
  const { websites, selectedWebsiteId, setSelectedWebsiteId } = useWebsiteContext();

  return (
    <aside className="sticky top-0 h-screen w-64 bg-gray-900 text-gray-100 flex flex-col shrink-0">
      <div className="px-6 py-5 border-b border-gray-700">
        <h1 className="text-xl font-bold tracking-tight">SEO Research Tool</h1>
        <p className="text-xs text-gray-400 mt-1">Personal SEO Suite</p>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        <div className="px-2 pb-3">
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-gray-400">
            Website Scope
          </label>
          <select
            value={selectedWebsiteId ?? 'all'}
            onChange={(event) => setSelectedWebsiteId(event.target.value)}
            className="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-2 text-xs text-gray-100 focus:border-indigo-500 focus:outline-none"
          >
            <option value="all">All websites</option>
            {websites.map((website) => (
              <option key={website.id} value={website.id}>
                {website.project_name || website.projectName || website.domain}
              </option>
            ))}
          </select>
        </div>

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
