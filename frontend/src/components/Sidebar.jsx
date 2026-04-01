import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useWebsiteContext } from '../context/WebsiteContext';

const TOP_LEVEL_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '📊' },
  { to: '/websites', label: 'Websites', icon: '🌐' },
  { to: '/rank-tracker', label: 'Rank Tracker', icon: '📈' },
  { to: '/analyze', label: 'Content Analyzer', icon: '📝' },
  { to: '/site-audit', label: 'Site Audit', icon: '🩺' },
];

const DROPDOWN_GROUPS = [
  {
    key: 'keywords',
    label: 'Keywords Tools',
    icon: '🔑',
    items: [
      { to: '/keywords', label: 'Keyword Research' },
      { to: '/competitor-keywords', label: 'Competitor Keywords' },
      { to: '/google-ads', label: 'Google Ads Keywords' },
      { to: '/trends', label: 'Google Trends' },
    ],
  },
  {
    key: 'serp',
    label: 'SERP Tools',
    icon: '🔍',
    items: [
      { to: '/serp', label: 'SERP Analyzer' },
      { to: '/search', label: 'SERP Screenshot' },
      { to: '/ai-serp', label: 'SERP AI Ranking' },
    ],
  },
  {
    key: 'providers',
    label: 'Providers',
    icon: '⚙️',
    items: [
      { to: '/providers', label: 'SERP Providers' },
      { to: '/backlink-providers', label: 'Backlink Providers' },
      { to: '/ai-providers', label: 'AI Providers' },
      { to: '/google-tools', label: 'Google Tools' },
    ],
  },
];

export default function Sidebar() {
  const location = useLocation();
  const { websites, selectedWebsiteId, setSelectedWebsiteId } = useWebsiteContext();
  const [openGroups, setOpenGroups] = useState({
    keywords: false,
    serp: false,
    providers: false,
  });

  function toggleGroup(key) {
    setOpenGroups((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  function isGroupActive(group) {
    return group.items.some((item) => item.to === location.pathname);
  }

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

        {TOP_LEVEL_ITEMS.map((item) => (
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

        {DROPDOWN_GROUPS.map((group) => {
          const isOpen = openGroups[group.key];
          const active = isGroupActive(group);
          const isHighlighted = active || isOpen;
          return (
            <div key={group.key} className="pt-1">
              <button
                type="button"
                onClick={() => toggleGroup(group.key)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isHighlighted
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-3">
                  <span className="text-lg">{group.icon}</span>
                  {group.label}
                </span>
                <span className="text-xs text-gray-400">{isOpen ? '▾' : '▸'}</span>
              </button>

              {isOpen && (
                <div className="mt-1 space-y-1 pl-5">
                  {group.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) =>
                        `block rounded-md px-3 py-2 text-sm transition-colors ${
                          isActive
                            ? 'bg-indigo-600 text-white'
                            : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                        }`
                      }
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="px-6 py-4 border-t border-gray-700 text-xs text-gray-500">
        v1.0.0 &middot; Local Tool
      </div>
    </aside>
  );
}
