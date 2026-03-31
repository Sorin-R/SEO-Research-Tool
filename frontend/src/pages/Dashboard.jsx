import { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorAlert from '../components/ErrorAlert';
import LoadingSpinner from '../components/LoadingSpinner';
import AiVisibilityModuleView from '../components/dashboard/AiVisibilityModuleView';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import KpiCard from '../components/dashboard/KpiCard';
import { DashboardGrid, DashboardSection, DashboardShell } from '../components/dashboard/DashboardLayout';
import SiteHealthModuleView from '../components/dashboard/SiteHealthModuleView';
import SerpKeywordTable from '../components/dashboard/SerpKeywordTable';
import SerpOpportunityCards from '../components/dashboard/SerpOpportunityCards';
import SerpSnapshotView from '../components/dashboard/SerpSnapshotView';
import { useWebsiteContext } from '../context/WebsiteContext';
import {
  getDashboardAiVisibilityModule,
  getDashboardBacklinksModule,
  getDashboardSiteHealthModule,
  getDashboardSerpModule,
  getDashboardTrafficModule,
  getLatestRankings,
  getRankingTrendsSummary,
  getSERPAnalysisHistory,
  getTrackedKeywords,
} from '../services/api';

function getRangeStartDate(dateRange, customStartDate) {
  if (dateRange === 'custom') {
    return customStartDate ? new Date(`${customStartDate}T00:00:00`) : null;
  }

  const daysByRange = {
    '7d': 7,
    '30d': 30,
    '90d': 90,
    '180d': 180,
    '365d': 365,
  };

  const days = daysByRange[dateRange];
  if (!days) {
    return null;
  }

  const start = new Date();
  start.setDate(start.getDate() - days);
  return start;
}

function filterRowsByDate(rows, field, startDate, customEndDate) {
  if (!startDate) {
    return rows;
  }

  const endDate = customEndDate ? new Date(`${customEndDate}T23:59:59`) : null;

  return rows.filter((row) => {
    const dateValue = row?.[field];
    if (!dateValue) {
      return false;
    }

    const parsed = new Date(dateValue);
    if (Number.isNaN(parsed.getTime())) {
      return false;
    }

    if (parsed < startDate) {
      return false;
    }

    if (endDate && parsed > endDate) {
      return false;
    }

    return true;
  });
}

function toDateParam(value) {
  if (!value) {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

export default function Dashboard() {
  const { websites, selectedWebsiteId, selectedWebsite, setSelectedWebsiteId } = useWebsiteContext();

  const [dateRange, setDateRange] = useState('30d');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [country, setCountry] = useState('US');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [cardErrors, setCardErrors] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);
  const [data, setData] = useState({
    trackedKeywords: [],
    rankings: [],
    rankingSummary: null,
    serpHistory: [],
    siteHealthModule: {
      available: false,
      source: 'site-audit',
      score: null,
      issueCounts: null,
      checks: [],
      topIssues: [],
      affectedPages: [],
      metadata: null,
      insights: [],
    },
    trafficModule: {
      available: false,
      source: 'estimate',
      summary: null,
    },
    backlinksModule: {
      available: false,
      source: 'dataforseo',
      summary: null,
    },
    aiVisibilityModule: {
      metadata: null,
      score: null,
      trend: [],
      topPages: [],
      competitorComparison: null,
      missingTopics: [],
      opportunities: [],
    },
    serpModule: {
      metadata: null,
      table: [],
      opportunities: {
        missingKeywords: [],
        rank6to10Opportunities: [],
        bingVsGoogleGaps: [],
      },
      snapshots: [],
    },
  });

  useEffect(() => {
    if (selectedWebsite?.country) {
      setCountry(selectedWebsite.country);
    }
  }, [selectedWebsite]);

  const loadDashboard = useCallback(async ({ silent = false, forceSerpRefresh = false } = {}) => {
    const rangeStartDate = getRangeStartDate(dateRange, customStartDate);
    const rangeEndDate = customEndDate ? new Date(`${customEndDate}T23:59:59`) : new Date();
    const dateFrom = toDateParam(rangeStartDate);
    const dateTo = toDateParam(rangeEndDate);

    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError(null);

    const requests = {
      trackedKeywords: getTrackedKeywords(selectedWebsiteId),
      rankings: getLatestRankings(selectedWebsiteId),
      rankingSummary: getRankingTrendsSummary(selectedWebsiteId),
      serpHistory: getSERPAnalysisHistory(50),
      siteHealthModule: getDashboardSiteHealthModule({
        websiteId: selectedWebsiteId,
        dateFrom,
        dateTo,
      }),
      trafficModule: getDashboardTrafficModule({
        websiteId: selectedWebsiteId,
        country,
        dateFrom,
        dateTo,
      }),
      backlinksModule: getDashboardBacklinksModule({
        websiteId: selectedWebsiteId,
        country,
        refresh: forceSerpRefresh,
      }),
      aiVisibilityModule: getDashboardAiVisibilityModule({
        websiteId: selectedWebsiteId,
        country,
        dateFrom,
        dateTo,
      }),
      serpModule: getDashboardSerpModule({
        websiteId: selectedWebsiteId,
        country,
        refresh: forceSerpRefresh,
      }),
    };

    const keys = Object.keys(requests);
    const settled = await Promise.allSettled(Object.values(requests));
    const nextData = {
      trackedKeywords: [],
      rankings: [],
      rankingSummary: null,
      serpHistory: [],
      siteHealthModule: {
        available: false,
        source: 'site-audit',
        score: null,
        issueCounts: null,
        checks: [],
        topIssues: [],
        affectedPages: [],
        metadata: null,
        insights: [],
      },
      trafficModule: {
        available: false,
        source: 'estimate',
        summary: null,
      },
      backlinksModule: {
        available: false,
        source: 'dataforseo',
        summary: null,
      },
      aiVisibilityModule: {
        metadata: null,
        score: null,
        trend: [],
        topPages: [],
        competitorComparison: null,
        missingTopics: [],
        opportunities: [],
      },
      serpModule: {
        metadata: null,
        table: [],
        opportunities: {
          missingKeywords: [],
          rank6to10Opportunities: [],
          bingVsGoogleGaps: [],
        },
        snapshots: [],
      },
    };

    const nextCardErrors = {};
    let successCount = 0;

    settled.forEach((entry, index) => {
      const key = keys[index];
      if (entry.status === 'fulfilled') {
        nextData[key] = entry.value ?? nextData[key];
        successCount += 1;
      } else {
        const message = entry.reason?.response?.data?.error || entry.reason?.message || 'Failed to load.';
        if (key === 'siteHealthModule') {
          nextCardErrors.siteHealth = message;
          nextCardErrors.siteHealthModule = message;
        }
        if (key === 'backlinksModule') nextCardErrors.backlinks = message;
        if (key === 'aiVisibilityModule') {
          nextCardErrors.aiVisibility = message;
          nextCardErrors.aiVisibilityModule = message;
        }
        if (key === 'rankingSummary' || key === 'rankings' || key === 'trackedKeywords') {
          nextCardErrors.organicKeywords = message;
          nextCardErrors.serpCoverage = message;
        }
        if (key === 'serpModule') {
          nextCardErrors.serpModule = message;
          nextCardErrors.serpCoverage = message;
        }
      }
    });

    setCardErrors(nextCardErrors);
    setData(nextData);

    if (successCount === 0) {
      setError('Failed to load dashboard data.');
    } else {
      setLastUpdated(new Date().toISOString());
    }

    if (silent) {
      setRefreshing(false);
    } else {
      setLoading(false);
    }
  }, [country, customEndDate, customStartDate, dateRange, selectedWebsiteId]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const rangeStart = useMemo(
    () => getRangeStartDate(dateRange, customStartDate),
    [customStartDate, dateRange]
  );

  const filteredRankings = useMemo(
    () => filterRowsByDate(data.rankings, 'date', rangeStart, customEndDate),
    [customEndDate, data.rankings, rangeStart]
  );

  const filteredSerpHistory = useMemo(() => {
    const byDate = filterRowsByDate(data.serpHistory, 'updated_at', rangeStart, customEndDate);
    return byDate.filter((item) => !country || String(item.country || '').toUpperCase() === String(country || '').toUpperCase());
  }, [country, customEndDate, data.serpHistory, rangeStart]);

  const kpiValues = useMemo(() => {
    const trackedKeywordCount = Array.isArray(data.trackedKeywords) ? data.trackedKeywords.length : 0;
    const fallbackKeywordCountFromSummary = Number(data.rankingSummary?.totalKeywords) || 0;
    const fallbackKeywordCountFromRows = Array.isArray(filteredRankings) ? filteredRankings.length : 0;
    const summaryRanked = Number(data.rankingSummary?.ranked) || 0;
    const summaryTop10 = Number(data.rankingSummary?.top10) || 0;
    const trackedKeywordSet = new Set(
      (Array.isArray(data.trackedKeywords) ? data.trackedKeywords : [])
        .map((item) => String(item?.keyword || '').trim().toLowerCase())
        .filter(Boolean)
    );
    const rankingRowsForTracked = trackedKeywordSet.size > 0
      ? filteredRankings.filter((item) => trackedKeywordSet.has(String(item?.keyword || '').trim().toLowerCase()))
      : filteredRankings;
    const rowRanked = rankingRowsForTracked.filter((item) => item.position != null).length;
    const rowTop10 = rankingRowsForTracked.filter((item) => (item.position || 999) <= 10).length;
    const rankedKeywords = Math.max(summaryRanked, rowRanked, summaryTop10, rowTop10);
    const top10Keywords = Math.min(Math.max(summaryTop10, rowTop10), rankedKeywords);
    const totalKeywords = Math.max(
      trackedKeywordCount || fallbackKeywordCountFromSummary || fallbackKeywordCountFromRows,
      rankedKeywords,
      top10Keywords
    );
    const siteHealthScore = Number(data.siteHealthModule?.score?.value);
    const siteHealthIssueCounts = data.siteHealthModule?.issueCounts || null;
    const siteHealthCheckedAt = data.siteHealthModule?.metadata?.checkedAt || null;
    const aiVisibilityScore = data.aiVisibilityModule?.score?.value ?? null;
    const aiVisibilityMetric = String(data.aiVisibilityModule?.metadata?.metric || '');

    const rankedRows = filteredRankings.filter((item) => item.position != null);
    const estimatedTraffic = rankedRows.length
      ? Math.round(rankedRows.reduce((sum, row) => {
          if (row.position <= 3) return sum + 220;
          if (row.position <= 10) return sum + 90;
          if (row.position <= 20) return sum + 35;
          if (row.position <= 50) return sum + 8;
          return sum + 2;
        }, 0))
      : null;
    const hasRealTraffic = Boolean(data.trafficModule?.available && data.trafficModule?.summary);
    const gscClicks = Number(data.trafficModule?.summary?.clicks || 0);
    const gscImpressions = Number(data.trafficModule?.summary?.impressions || 0);
    const gscCtrPercent = Number(data.trafficModule?.summary?.ctr || 0) * 100;

    const serpModuleSnapshots = Array.isArray(data.serpModule?.snapshots) ? data.serpModule.snapshots : [];
    const backlinksSummary = data.backlinksModule?.summary || null;
    const backlinksCount = Number(backlinksSummary?.backlinksCount || 0);
    const backlinksRefDomains = Number(backlinksSummary?.referringDomainsCount || 0);
    const backlinksRows = Number(backlinksSummary?.rowsReturned || 0);
    const hasBacklinksData = Boolean(data.backlinksModule?.available);
    const backlinksSource = String(data.backlinksModule?.source || '').toLowerCase();
    const coveragePercent = totalKeywords > 0
      ? Math.round((top10Keywords / totalKeywords) * 100)
      : null;
    const serpSnapshots = serpModuleSnapshots.length || filteredSerpHistory.length;

    return {
      aiVisibilityScore,
      aiVisibilityMetric,
      siteHealthScore: Number.isFinite(siteHealthScore) ? siteHealthScore : null,
      organicTrafficValue: hasRealTraffic ? gscClicks : estimatedTraffic,
      organicTrafficBadge: hasRealTraffic ? 'GSC' : 'Estimated',
      organicKeywordsValue: totalKeywords > 0 ? `${rankedKeywords} / ${totalKeywords}` : null,
      backlinksValue: hasBacklinksData ? backlinksCount.toLocaleString() : null,
      backlinksSubtitle: hasBacklinksData
        ? `${backlinksRefDomains} referring domains${backlinksRows ? ` • ${backlinksRows} rows fetched` : ''}`
        : null,
      backlinksBadge: hasBacklinksData
        ? (backlinksSource === 'dataforseo' ? 'DataForSEO' : 'Backlinks')
        : null,
      serpCoverageValue: coveragePercent == null ? null : `${coveragePercent}%`,
      serpCoverageSubtitle: totalKeywords > 0
        ? `${top10Keywords} keywords in top 10 • ${serpSnapshots} SERP snapshots`
        : `${serpSnapshots} SERP snapshots`,
      organicKeywordsSubtitle: totalKeywords > 0
        ? `${top10Keywords} keywords in top 10`
        : null,
      siteHealthSubtitle: siteHealthCheckedAt
        ? `Latest check: ${new Date(siteHealthCheckedAt).toLocaleDateString()} • ${siteHealthIssueCounts?.failingChecks || 0} failing checks`
        : null,
      trafficSubtitle: hasRealTraffic
        ? `${gscImpressions.toLocaleString()} impressions • ${gscCtrPercent.toFixed(2)}% CTR`
        : (rankedRows.length ? `${rankedRows.length} ranking URLs contributed` : null),
      aiVisibilitySubtitle: data.aiVisibilityModule?.metadata?.sampleSize
        ? (() => {
            const sampleSize = data.aiVisibilityModule.metadata.sampleSize || {};
            const serpRows = Number(sampleSize.serpRows || 0);
            const contentAnalyses = Number(sampleSize.contentAnalyses || 0);
            const aiSerpCitations = Number(sampleSize.aiSerpCitations || 0);
            const aiSerpPrompts = Number(sampleSize.aiSerpPrompts || 0);

            if (aiVisibilityMetric === 'average-position') {
              return `AI SERP citations: ${aiSerpCitations} across ${aiSerpPrompts} prompts (lower position is better)`;
            }

            if (aiSerpCitations > 0 && serpRows === 0 && contentAnalyses === 0) {
              return `AI SERP only: ${aiSerpCitations} citations across ${aiSerpPrompts} prompts`;
            }

            return `SERP rows: ${serpRows} • Content analyses: ${contentAnalyses} • AI citations: ${aiSerpCitations}`;
          })()
        : aiVisibilityMetric === 'average-position'
          ? 'Average citation position from AI SERP runs'
          : 'AI visibility score from AI SERP citations',
    };
  }, [
    data.aiVisibilityModule?.metadata?.sampleSize,
    data.aiVisibilityModule?.metadata?.metric,
    data.aiVisibilityModule?.score?.value,
    data.backlinksModule?.available,
    data.backlinksModule?.source,
    data.backlinksModule?.summary,
    data.siteHealthModule?.issueCounts,
    data.siteHealthModule?.metadata?.checkedAt,
    data.siteHealthModule?.score?.value,
    data.rankingSummary,
    data.serpModule?.snapshots,
    data.serpModule?.table,
    data.trackedKeywords.length,
    data.trafficModule?.available,
    data.trafficModule?.summary,
    filteredRankings,
    filteredSerpHistory.length,
  ]);

  const allKpisEmpty = useMemo(() => (
    kpiValues.aiVisibilityScore == null
    && kpiValues.siteHealthScore == null
    && kpiValues.organicTrafficValue == null
    && kpiValues.organicKeywordsValue == null
    && kpiValues.backlinksValue == null
    && kpiValues.serpCoverageValue == null
  ), [kpiValues]);

  return (
    <DashboardShell>
      <DashboardHeader
        websites={websites}
        selectedWebsiteId={selectedWebsiteId}
        onWebsiteChange={setSelectedWebsiteId}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        customStartDate={customStartDate}
        customEndDate={customEndDate}
        onCustomStartDateChange={setCustomStartDate}
        onCustomEndDateChange={setCustomEndDate}
        country={country}
        onCountryChange={setCountry}
        refreshing={refreshing}
        onRefresh={() => loadDashboard({ silent: true, forceSerpRefresh: true })}
        lastUpdated={lastUpdated}
      />

      {error ? <ErrorAlert message={error} onRetry={() => loadDashboard()} /> : null}

      <DashboardSection
        title="KPI Cards"
        description="AI Visibility, Site Health, Organic Traffic, Organic Keywords, Backlinks, and SERP Coverage."
      >
        <DashboardGrid>
          <KpiCard
            title="AI Visibility"
            value={kpiValues.aiVisibilityScore != null
              ? (kpiValues.aiVisibilityMetric === 'average-position'
                ? `#${Number(kpiValues.aiVisibilityScore).toFixed(2)}`
                : `${kpiValues.aiVisibilityScore}/100`)
              : null}
            subtitle={kpiValues.aiVisibilitySubtitle}
            badge={data.aiVisibilityModule?.metadata?.modeled ? 'Modeled' : 'AI SERP'}
            isLoading={loading}
            error={cardErrors.aiVisibility}
            emptyMessage="No AI visibility data yet. Run AI SERP Workspace scans first."
          />
          <KpiCard
            title="Site Health"
            value={kpiValues.siteHealthScore != null ? `${kpiValues.siteHealthScore}/100` : null}
            subtitle={kpiValues.siteHealthSubtitle}
            isLoading={loading}
            error={cardErrors.siteHealth}
            emptyMessage="No site audits in this period."
          />
          <KpiCard
            title="Organic Traffic"
            value={kpiValues.organicTrafficValue != null ? kpiValues.organicTrafficValue.toLocaleString() : null}
            subtitle={kpiValues.trafficSubtitle}
            badge={kpiValues.organicTrafficBadge}
            isLoading={loading}
            error={cardErrors.organicTraffic}
            emptyMessage="No ranking data to estimate traffic."
          />
          <KpiCard
            title="Organic Keywords"
            value={kpiValues.organicKeywordsValue}
            subtitle={kpiValues.organicKeywordsSubtitle}
            isLoading={loading}
            error={cardErrors.organicKeywords}
            emptyMessage="No tracked keywords for this website."
          />
          <KpiCard
            title="Backlinks"
            value={kpiValues.backlinksValue}
            subtitle={kpiValues.backlinksSubtitle}
            badge={kpiValues.backlinksBadge}
            isLoading={loading}
            error={cardErrors.backlinks}
            emptyMessage="No backlink snapshot yet. Configure DataForSEO and click refresh."
          />
          <KpiCard
            title="SERP Coverage"
            value={kpiValues.serpCoverageValue}
            subtitle={kpiValues.serpCoverageSubtitle}
            isLoading={loading}
            error={cardErrors.serpCoverage}
            emptyMessage="No SERP coverage data for this scope."
          />
        </DashboardGrid>

        {!loading && allKpisEmpty ? (
          <div className="mt-4 rounded-md border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600">
            Empty state: add a website, track keywords, run SERP analysis, and run site audits to populate this dashboard.
          </div>
        ) : null}
      </DashboardSection>

      <DashboardSection
        title="Site Health Module"
        description="Actionable technical SEO checks: broken links, redirects, missing metadata, canonical issues, robots.txt, sitemap, and noindex."
      >
        <SiteHealthModuleView
          moduleData={data.siteHealthModule}
          loading={loading}
          error={cardErrors.siteHealthModule}
        />
      </DashboardSection>

      <DashboardSection
        title="AI Visibility Module"
        description="Modeled AI-era visibility using brand/domain/page mentions, content structure, and topical coverage proxies."
      >
        <AiVisibilityModuleView
          moduleData={data.aiVisibilityModule}
          loading={loading}
          error={cardErrors.aiVisibilityModule}
        />
      </DashboardSection>

      <DashboardSection
        title="SERP Dashboard Module"
        description="Top 10 keyword extraction from Google and Bing, opportunity cards, and SERP snapshot view."
      >
        {data.serpModule?.metadata ? (
          <div className="mb-4 grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 md:grid-cols-4">
            <div>Queries: <span className="font-medium text-gray-800">{data.serpModule.metadata.queryCount || 0}</span></div>
            <div>Google Rows: <span className="font-medium text-gray-800">{data.serpModule.metadata.googleResultCount || 0}</span></div>
            <div>Bing Rows: <span className="font-medium text-gray-800">{data.serpModule.metadata.bingResultCount || 0}</span></div>
            <div>Keyword Overlap: <span className="font-medium text-gray-800">{data.serpModule.metadata.overlapRate || 0}%</span></div>
          </div>
        ) : null}

        <SerpOpportunityCards
          opportunities={data.serpModule?.opportunities}
          loading={loading}
          error={cardErrors.serpModule}
        />

        <div className="mt-4">
          <SerpKeywordTable
            rows={data.serpModule?.table || []}
            loading={loading}
            error={cardErrors.serpModule}
          />
        </div>

        <div className="mt-4">
          <SerpSnapshotView
            snapshots={data.serpModule?.snapshots || []}
            loading={loading}
            error={cardErrors.serpModule}
          />
        </div>
      </DashboardSection>

      {loading ? <LoadingSpinner message="Loading dashboard metrics..." /> : null}
    </DashboardShell>
  );
}
