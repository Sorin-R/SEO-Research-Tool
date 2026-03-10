import { useEffect, useState } from 'react';

export default function SearchBar({
  onSearch,
  placeholder = 'Enter a keyword...',
  loading = false,
  initialValue = '',
}) {
  const [query, setQuery] = useState(initialValue);

  useEffect(() => {
    setQuery(initialValue || '');
  }, [initialValue]);

  function handleSubmit(e) {
    e.preventDefault();
    if (query.trim() && !loading) {
      onSearch(query.trim());
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-3">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        disabled={loading}
      />
      <button
        type="submit"
        disabled={loading || !query.trim()}
        className="px-6 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? 'Searching...' : 'Search'}
      </button>
    </form>
  );
}
