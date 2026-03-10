import { useEffect, useState } from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorAlert from '../components/ErrorAlert';
import ScoreBadge from '../components/ScoreBadge';
import StatCard from '../components/StatCard';
import {
  analyzeContent,
  deleteContentAnalysisHistoryItem,
  getContentAnalysisHistory,
  getContentAnalysisHistoryItem,
} from '../services/api';

const STORAGE_KEY = 'seo-tool:content-analyzer:last-session';
const HISTORY_LIMIT = 10;

export default function ContentAnalyzer() {
  const [keyword, setKeyword] = useState('');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [metaDescriptionInput, setMetaDescriptionInput] = useState('');
  const [mode, setMode] = useState('url');
  const [compareToSerp, setCompareToSerp] = useState(true);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(null);
  const [loadingHistoryId, setLoadingHistoryId] = useState(null);
  const [deletingHistoryId, setDeletingHistoryId] = useState(null);
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [restoreNotice, setRestoreNotice] = useState(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);

      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored);

      if (typeof parsed.keyword === 'string') setKeyword(parsed.keyword);
      if (typeof parsed.url === 'string') setUrl(parsed.url);
      if (typeof parsed.text === 'string') setText(parsed.text);
      if (typeof parsed.titleInput === 'string') setTitleInput(parsed.titleInput);
      if (typeof parsed.metaDescriptionInput === 'string') setMetaDescriptionInput(parsed.metaDescriptionInput);
      if (parsed.mode === 'url' || parsed.mode === 'text') setMode(parsed.mode);
      if (typeof parsed.compareToSerp === 'boolean') setCompareToSerp(parsed.compareToSerp);

      if (parsed.data) {
        setData(parsed.data);
        setRestoreNotice('Restored your last content analysis from this browser.');
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      setStorageHydrated(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      setHistoryLoading(true);
      setHistoryError(null);

      try {
        const result = await getContentAnalysisHistory(HISTORY_LIMIT);
        if (!cancelled) {
          setHistory(result);
        }
      } catch (err) {
        if (!cancelled) {
          setHistoryError(err.response?.data?.error || err.message);
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    }

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!storageHydrated) {
      return;
    }

    if (
      !data &&
      !keyword.trim() &&
      !url.trim() &&
      !text.trim() &&
      !titleInput.trim() &&
      !metaDescriptionInput.trim()
    ) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          keyword,
          url,
          text,
          titleInput,
          metaDescriptionInput,
          mode,
          compareToSerp,
          data,
          savedAt: new Date().toISOString(),
        })
      );
    } catch {
      // Ignore storage quota issues.
    }
  }, [compareToSerp, data, keyword, metaDescriptionInput, mode, storageHydrated, text, titleInput, url]);

  async function refreshHistory() {
    try {
      const result = await getContentAnalysisHistory(HISTORY_LIMIT);
      setHistory(result);
      setHistoryError(null);
    } catch (err) {
      setHistoryError(err.response?.data?.error || err.message);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!keyword.trim()) return;
    if (mode === 'url' && !url.trim()) return;
    if (mode === 'text' && !text.trim()) return;

    setLoading(true);
    setError(null);
    setRestoreNotice(null);

    try {
      const result = await analyzeContent({
        keyword: keyword.trim(),
        url: mode === 'url' ? url.trim() : undefined,
        text: mode === 'text' ? text.trim() : undefined,
        title: titleInput.trim() || undefined,
        metaDescription: metaDescriptionInput.trim() || undefined,
        compareToSerp,
      });
      setData(result);
      await refreshHistory();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleLoadHistory(id) {
    setLoadingHistoryId(id);
    setError(null);

    try {
      const result = await getContentAnalysisHistoryItem(id);
      setData(result);
      setKeyword(result.keyword || '');
      setUrl(result.url || '');
      setText(result.inputText || '');
      setTitleInput(result.inputTitle || '');
      setMetaDescriptionInput(result.inputMetaDescription || '');
      setMode(result.inputMode === 'text' ? 'text' : 'url');
      setCompareToSerp(!!result.compareToSerp);
      setRestoreNotice('Loaded a saved content analysis from history.');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoadingHistoryId(null);
    }
  }

  async function handleDeleteHistory(id) {
    setDeletingHistoryId(id);
    setHistoryError(null);
    setError(null);

    try {
      await deleteContentAnalysisHistoryItem(id);
      setHistory((current) => current.filter((item) => String(item.id) !== String(id)));

      if (String(data?.historyId) === String(id)) {
        setData(null);
        setRestoreNotice(null);
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch (err) {
      setHistoryError(err.response?.data?.error || err.message);
    } finally {
      setDeletingHistoryId(null);
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Content Analyzer</h2>
      <p className="text-sm text-gray-500 mb-6">
        Audit title tags, meta descriptions, keyword placement, internal links, and readability for a URL or a draft.
      </p>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Target Keyword</label>
          <input
            type="text"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="e.g., vegan cupcakes"
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={mode === 'url'}
              onChange={() => setMode('url')}
              className="accent-indigo-600"
            />
            Analyze URL
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={mode === 'text'}
              onChange={() => setMode('text')}
              className="accent-indigo-600"
            />
            Paste Text
          </label>
        </div>

        {mode === 'url' ? (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">URL</label>
            <input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/article"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Article Text</label>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Paste your article content here..."
              rows={8}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
            />
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">SEO Title</label>
            <input
              type="text"
              value={titleInput}
              onChange={(event) => setTitleInput(event.target.value)}
              placeholder={mode === 'url' ? 'Optional override for the live page title' : 'Recommended for draft analysis'}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              {mode === 'url' ? 'Leave blank to use the live page title.' : 'Add the intended title so page-title scoring is accurate.'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Meta Description</label>
            <textarea
              value={metaDescriptionInput}
              onChange={(event) => setMetaDescriptionInput(event.target.value)}
              placeholder={mode === 'url' ? 'Optional override for the live meta description' : 'Recommended for draft analysis'}
              rows={3}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
            />
            <p className="mt-1 text-xs text-gray-500">
              {mode === 'url' ? 'Leave blank to use the live meta description.' : 'Add the intended meta description for accurate scoring.'}
            </p>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={compareToSerp}
            onChange={(event) => setCompareToSerp(event.target.checked)}
            className="accent-indigo-600"
          />
          Compare against SERP competitors (slower but finds content gaps)
        </label>

        <button
          type="submit"
          disabled={loading || !keyword.trim()}
          className="px-6 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Analyzing...' : 'Analyze Content'}
        </button>
      </form>

      <div className="mt-6 bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold text-gray-900">Recent Saved Content Analyses</h3>
          <p className="text-sm text-gray-500">
            Your last content analysis is restored after refresh in this browser, and recent analyses are also saved to the backend.
          </p>
        </div>

        {historyLoading && <p className="text-sm text-gray-500">Loading saved analyses...</p>}
        {historyError && <ErrorAlert message={historyError} />}

        {!historyLoading && !historyError && history.length === 0 && (
          <p className="text-sm text-gray-500">No saved content analyses yet. Run one and it will appear here.</p>
        )}

        {!historyLoading && history.length > 0 && (
          <div className="space-y-2">
            {history.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 transition-colors hover:border-indigo-300 hover:bg-indigo-50"
              >
                <button
                  type="button"
                  onClick={() => handleLoadHistory(item.id)}
                  disabled={loadingHistoryId === item.id || deletingHistoryId === item.id}
                  className="min-w-0 flex-1 text-left disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="font-medium text-gray-900">{item.keyword}</div>
                      <div className="text-xs text-gray-500">
                        {item.input_mode === 'url'
                          ? item.url || 'URL analysis'
                          : 'Pasted text analysis'}
                        {item.compare_to_serp ? ' · SERP comparison' : ''}
                        {item.seo_score != null ? ` · Score ${item.seo_score}` : ''}
                      </div>
                    </div>
                    <div className="text-xs text-gray-500">
                      {loadingHistoryId === item.id ? 'Loading...' : formatSavedAt(item.updated_at || item.created_at)}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteHistory(item.id)}
                  disabled={loadingHistoryId === item.id || deletingHistoryId === item.id}
                  className="shrink-0 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-gray-500 hover:border-red-300 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label={`Delete saved content analysis for ${item.keyword}`}
                  title="Delete saved analysis"
                >
                  {deletingHistoryId === item.id ? '...' : 'X'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {loading && <LoadingSpinner message="Analyzing content..." />}
      {error && <div className="mt-6"><ErrorAlert message={error} /></div>}

      {data && !loading && (
        <div className="mt-8 space-y-6">
          {restoreNotice && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-5 py-4 text-sm text-emerald-900">
              {restoreNotice}
            </div>
          )}

          <div className="grid gap-4 xl:grid-cols-[280px,1fr]">
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex flex-col items-center text-center">
                <ScoreBadge score={data.seoScore} label="SEO Score" size="lg" />
                <p className="mt-4 text-sm text-gray-600">
                  {data.savedAt ? `Saved ${formatSavedAt(data.savedAt)}.` : 'Fresh analysis.'}
                </p>
                <p className="mt-2 text-sm text-gray-500">
                  Focus keyword: <span className="font-medium text-gray-800">{data.keyword}</span>
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <ScoreSummaryCard
                title="Readability"
                score={data.readabilityScore}
                description={data.readability?.label || 'Readability checks'}
              />
              <ScoreSummaryCard
                title="Page Title"
                score={data.pageTitleScore}
                description={`${data.pageTitleLength || 0}/60 chars`}
              />
              <ScoreSummaryCard
                title="Meta Description"
                score={data.metaDescriptionScore}
                description={`${data.metaDescriptionLength || 0}/160 chars`}
              />
              <ScoreSummaryCard
                title="Content"
                score={data.contentScore}
                description={`${data.wordCount || 0} words`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Word Count" value={data.wordCount} sub={`Target: ${data.recommendedWordCount}`} />
            <StatCard label="Keyword Density" value={`${data.keywordDensity}%`} sub={`${data.keywordCount} occurrences`} />
            <StatCard
              label="Headings"
              value={data.headings.h1 + data.headings.h2 + data.headings.h3}
              sub={`H1:${data.headings.h1} H2:${data.headings.h2} H3:${data.headings.h3}`}
            />
            <StatCard label="Links" value={data.internalLinkCount} sub={`${data.externalLinkCount || 0} external`} />
            <StatCard label="Images" value={data.imageCount} />
            <StatCard
              label="Long Sentences"
              value={`${data.readability?.longSentencePercentage || 0}%`}
              sub="Sentences over 20 words"
            />
            <StatCard
              label="Transition Words"
              value={`${data.readability?.transitionWordPercentage || 0}%`}
              sub="Sentence coverage"
            />
            <StatCard
              label="Passive Voice"
              value={`${data.readability?.passiveVoicePercentage || 0}%`}
              sub="Sentence coverage"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ValueCard
              label="Page Title"
              value={data.pageTitle}
              helper={data.pageTitle ? `${data.pageTitleLength || data.pageTitle.length} characters` : 'No page title found'}
            />
            <ValueCard
              label="Meta Description"
              value={data.metaDescription}
              helper={data.metaDescription ? `${data.metaDescriptionLength || data.metaDescription.length} characters` : 'No meta description found'}
            />
          </div>

          {data.firstParagraph && (
            <ValueCard
              label="First Paragraph"
              value={data.firstParagraph}
              helper={data.keywordInFirstParagraph ? 'Focus keyword found in the first paragraph.' : 'Focus keyword not found in the first paragraph.'}
            />
          )}

          <div className="grid gap-6 xl:grid-cols-2">
            <AuditSection
              title="Page Title Score"
              score={data.audit?.pageTitle?.score || data.pageTitleScore}
              checks={data.audit?.pageTitle?.checks || []}
            />
            <AuditSection
              title="Meta Description Score"
              score={data.audit?.metaDescription?.score || data.metaDescriptionScore}
              checks={data.audit?.metaDescription?.checks || []}
            />
            <AuditSection
              title="Content Score"
              score={data.audit?.content?.score || data.contentScore}
              checks={data.audit?.content?.checks || []}
            />
            <AuditSection
              title="Readability Score"
              score={data.audit?.readability?.score || data.readabilityScore}
              checks={data.audit?.readability?.checks || []}
            />
          </div>

          {data.readability?.subheadingSections?.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                  <h3 className="font-semibold text-gray-900">Subheading Section Lengths</h3>
                  <p className="text-sm text-gray-500">
                    Keep each section below 300 words after a H2 or H3.
                  </p>
                </div>
                <span className="text-xs text-gray-500">
                  {data.readability.subheadingSections.filter((section) => section.wordCount > 300).length} over limit
                </span>
              </div>
              <div className="space-y-2">
                {data.readability.subheadingSections.map((section, index) => (
                  <div
                    key={`${section.level}-${section.heading}-${index}`}
                    className={`flex items-center justify-between rounded-lg border px-4 py-3 text-sm ${
                      section.wordCount > 300
                        ? 'border-red-200 bg-red-50 text-red-900'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium">{section.heading}</div>
                      <div className="text-xs opacity-80">{String(section.level || '').toUpperCase()}</div>
                    </div>
                    <div className="font-semibold">{section.wordCount} words</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.suggestions?.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-3">Improvement Suggestions</h3>
              <ul className="space-y-2">
                {data.suggestions.map((suggestion, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="text-amber-500 mt-0.5">&#9679;</span>
                    {suggestion}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.missingTopics?.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-3">Missing Topics</h3>
              <p className="text-xs text-gray-500 mb-3">
                Topics your competitors cover but your content doesn't mention:
              </p>
              <div className="flex flex-wrap gap-2">
                {data.missingTopics.map((topic) => (
                  <span key={topic} className="bg-red-50 text-red-700 border border-red-200 px-3 py-1 rounded-md text-sm">
                    {topic}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ScoreSummaryCard({ title, score, description }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center gap-4">
        <ScoreBadge score={score} />
        <div>
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <p className="text-sm text-gray-500">{description}</p>
        </div>
      </div>
    </div>
  );
}

function ValueCard({ label, value, helper }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="font-semibold text-gray-900 mb-2">{label}</h3>
      <p className={`text-sm ${value ? 'text-gray-700' : 'text-gray-400 italic'}`}>
        {value || 'Not available'}
      </p>
      {helper && <p className="mt-2 text-xs text-gray-500">{helper}</p>}
    </div>
  );
}

function AuditSection({ title, score, checks }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <p className="text-sm text-gray-500">{checks.length} checks</p>
        </div>
        <ScoreBadge score={score} />
      </div>

      <div className="space-y-3">
        {checks.map((check) => (
          <AuditCheck key={check.id} check={check} />
        ))}
      </div>
    </div>
  );
}

function AuditCheck({ check }) {
  const styles = {
    pass: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    fail: 'border-red-200 bg-red-50 text-red-900',
  };

  const badgeStyles = {
    pass: 'bg-emerald-100 text-emerald-800',
    warn: 'bg-amber-100 text-amber-800',
    fail: 'bg-red-100 text-red-800',
  };

  return (
    <div className={`rounded-lg border px-4 py-3 ${styles[check.status] || styles.fail}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{check.label}</div>
          <p className="mt-1 text-sm">{check.message}</p>
          {check.status !== 'pass' && check.suggestion && (
            <p className="mt-2 text-xs opacity-80">Suggestion: {check.suggestion}</p>
          )}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${badgeStyles[check.status] || badgeStyles.fail}`}>
          {check.status.toUpperCase()}
        </span>
      </div>
    </div>
  );
}

function formatSavedAt(value) {
  if (!value) {
    return 'Saved recently';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Saved recently';
  }

  return date.toLocaleString();
}
