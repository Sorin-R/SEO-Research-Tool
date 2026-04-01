import { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorAlert from '../components/ErrorAlert';
import LoadingSpinner from '../components/LoadingSpinner';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import KpiCard from '../components/dashboard/KpiCard';
import { DashboardGrid, DashboardSection, DashboardShell } from '../components/dashboard/DashboardLayout';
import SiteHealthModuleView from '../components/dashboard/SiteHealthModuleView';
import { useWebsiteContext } from '../context/WebsiteContext';
import {
  getDashboardAiVisibilityModule,
  getDashboardBacklinksModule,
  getDashboardSiteHealthModule,
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

function hasTrafficSource(trafficModule, sourceId) {
  const sourceList = Array.isArray(trafficModule?.sources)
    ? trafficModule.sources
    : [trafficModule?.source].filter(Boolean);
  return Boolean(trafficModule?.available && sourceList.includes(sourceId));
}

function hasGscData(trafficModule) {
  return Boolean(hasTrafficSource(trafficModule, 'gsc') && trafficModule?.summary);
}

function hasGaData(trafficModule) {
  return Boolean(hasTrafficSource(trafficModule, 'ga4') && trafficModule?.summary);
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
        if (key === 'trafficModule') {
          nextCardErrors.organicTraffic = message;
          nextCardErrors.gscImpressions = message;
          nextCardErrors.gscCtr = message;
          nextCardErrors.gscPosition = message;
          nextCardErrors.gscTopQuery = message;
          nextCardErrors.gscTopPage = message;
          nextCardErrors.gaUsers = message;
          nextCardErrors.gaSessions = message;
          nextCardErrors.gaEngagement = message;
          nextCardErrors.gaAvgSession = message;
          nextCardErrors.gaConversions = message;
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
    const hasRealGsc = hasGscData(data.trafficModule);
    const hasRealGa4 = hasGaData(data.trafficModule);
    const hasRealTraffic = Boolean((hasRealGsc || hasRealGa4) && data.trafficModule?.summary);
    const gscClicks = Number(data.trafficModule?.summary?.clicks || 0);
    const gscImpressions = Number(data.trafficModule?.summary?.impressions || 0);
    const gscCtrPercent = Number(data.trafficModule?.summary?.ctr || 0) * 100;
    const gscAveragePosition = Number(data.trafficModule?.summary?.averagePosition || 0);
    const gscTopQuery = data.trafficModule?.highlights?.topQuery || null;
    const gscTopPage = data.trafficModule?.highlights?.topPage || null;
    const gscTopDevice = data.trafficModule?.highlights?.topDevice || null;
    const gscTopCountry = data.trafficModule?.highlights?.topCountry || null;
    const gaUsers = Number(data.trafficModule?.summary?.users || 0);
    const gaSessions = Number(data.trafficModule?.summary?.sessions || 0);
    const gaEngagedSessions = Number(data.trafficModule?.summary?.engagedSessions || 0);
    const gaEngagementRatePercent = Number(data.trafficModule?.summary?.engagementRate || 0) * 100;
    const gaAvgSessionDuration = Number(data.trafficModule?.summary?.averageSessionDuration || 0);
    const gaConversions = Number(data.trafficModule?.summary?.conversions || 0);
    const gaTopPage = data.trafficModule?.highlights?.gaTopPage || null;
    const gaTopDevice = data.trafficModule?.highlights?.gaTopDevice || null;
    const gaTopCountry = data.trafficModule?.highlights?.gaTopCountry || null;

    const gaAvgSessionFormatted = Number.isFinite(gaAvgSessionDuration) && gaAvgSessionDuration > 0
      ? (() => {
          const totalSeconds = Math.round(gaAvgSessionDuration);
          const minutes = Math.floor(totalSeconds / 60);
          const seconds = String(totalSeconds % 60).padStart(2, '0');
          return `${minutes}:${seconds}`;
        })()
      : null;

    const backlinksSummary = data.backlinksModule?.summary || null;
    const backlinksCount = Number(backlinksSummary?.backlinksCount || 0);
    const backlinksRefDomains = Number(backlinksSummary?.referringDomainsCount || 0);
    const backlinksRows = Number(backlinksSummary?.rowsReturned || 0);
    const hasBacklinksData = Boolean(data.backlinksModule?.available);
    const backlinksSource = String(data.backlinksModule?.source || '').toLowerCase();
    const coveragePercent = totalKeywords > 0
      ? Math.round((top10Keywords / totalKeywords) * 100)
      : null;
    const serpSnapshots = filteredSerpHistory.length;

    return {
      aiVisibilityScore,
      aiVisibilityMetric,
      siteHealthScore: Number.isFinite(siteHealthScore) ? siteHealthScore : null,
      organicTrafficValue: hasRealGsc && gscClicks > 0
        ? gscClicks
        : (hasRealGa4 ? gaSessions : (hasRealGsc ? gscClicks : estimatedTraffic)),
      organicTrafficBadge: hasRealGsc
        ? (hasRealGa4 ? 'GSC+GA4' : 'GSC')
        : (hasRealGa4 ? 'GA4' : 'Estimated'),
      gscImpressionsValue: hasRealGsc ? gscImpressions.toLocaleString() : null,
      gscCtrValue: hasRealGsc ? `${gscCtrPercent.toFixed(2)}%` : null,
      gscAveragePositionValue: hasRealGsc && Number.isFinite(gscAveragePosition)
        ? `#${gscAveragePosition.toFixed(2)}`
        : null,
      gscTopQueryValue: hasRealGsc && gscTopQuery
        ? Number(gscTopQuery.clicks || 0).toLocaleString()
        : null,
      gscTopQuerySubtitle: hasRealGsc && gscTopQuery
        ? `${gscTopQuery.query || '—'} • ${(Number(gscTopQuery.ctr || 0) * 100).toFixed(2)}% CTR`
        : null,
      gscTopPageValue: hasRealGsc && gscTopPage
        ? Number(gscTopPage.clicks || 0).toLocaleString()
        : null,
      gscTopPageSubtitle: hasRealGsc && gscTopPage
        ? `${String(gscTopPage.page || '—').replace(/^https?:\/\//, '')}`
        : null,
      gaUsersValue: hasRealGa4 ? gaUsers.toLocaleString() : null,
      gaSessionsValue: hasRealGa4 ? gaSessions.toLocaleString() : null,
      gaEngagementValue: hasRealGa4 ? `${gaEngagementRatePercent.toFixed(2)}%` : null,
      gaAvgSessionValue: hasRealGa4 ? gaAvgSessionFormatted : null,
      gaConversionsValue: hasRealGa4 ? gaConversions.toLocaleString() : null,
      gaUsersSubtitle: hasRealGa4
        ? `${gaEngagedSessions.toLocaleString()} engaged sessions`
        : null,
      gaSessionsSubtitle: hasRealGa4 && gaTopDevice?.device
        ? `Top device: ${String(gaTopDevice.device).toUpperCase()}`
        : null,
      gaEngagementSubtitle: hasRealGa4 && gaTopCountry?.country
        ? `Top country: ${String(gaTopCountry.country).toUpperCase()}`
        : null,
      gaAvgSessionSubtitle: hasRealGa4 && gaTopPage?.page
        ? `Top landing page: ${String(gaTopPage.page || '').replace(/^https?:\/\//, '') || 'N/A'}`
        : null,
      gaConversionsSubtitle: hasRealGa4 && gaTopPage
        ? `${Number(gaTopPage.conversions || 0).toLocaleString()} conversions on top page`
        : null,
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
      trafficSubtitle: hasRealGsc
        ? `${gscImpressions.toLocaleString()} impressions • ${gscCtrPercent.toFixed(2)}% CTR • ${
          gscTopDevice?.device ? `Top device: ${String(gscTopDevice.device).toUpperCase()}` : 'Search analytics data'
        }`
        : hasRealGa4
          ? `${gaUsers.toLocaleString()} users • ${gaEngagementRatePercent.toFixed(2)}% engagement`
        : (rankedRows.length ? `${rankedRows.length} ranking URLs contributed` : null),
      gscPositionSubtitle: hasRealGsc
        ? `${gscTopCountry?.country ? `Top country: ${String(gscTopCountry.country).toUpperCase()}` : 'Average across selected period'}`
        : null,
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
    data.trackedKeywords.length,
    data.trafficModule?.available,
    data.trafficModule?.summary,
    data.trafficModule?.highlights,
    filteredRankings,
    filteredSerpHistory.length,
  ]);

  const allKpisEmpty = useMemo(() => (
    kpiValues.aiVisibilityScore == null
    && kpiValues.siteHealthScore == null
    && kpiValues.organicTrafficValue == null
    && kpiValues.gscImpressionsValue == null
    && kpiValues.gscCtrValue == null
    && kpiValues.gscAveragePositionValue == null
    && kpiValues.gscTopQueryValue == null
    && kpiValues.gscTopPageValue == null
    && kpiValues.gaUsersValue == null
    && kpiValues.gaSessionsValue == null
    && kpiValues.gaEngagementValue == null
    && kpiValues.gaAvgSessionValue == null
    && kpiValues.gaConversionsValue == null
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
        description="AI Visibility, Site Health, Google traffic metrics (GSC + GA4), Organic Keywords, Backlinks, and SERP Coverage."
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
            title="GSC Impressions"
            value={kpiValues.gscImpressionsValue}
            subtitle={hasGscData(data.trafficModule) ? 'Total impressions in selected range' : null}
            badge={hasGscData(data.trafficModule) ? 'GSC' : null}
            isLoading={loading}
            error={cardErrors.gscImpressions}
            emptyMessage="Connect GSC and set website property to show impressions."
          />
          <KpiCard
            title="GSC CTR"
            value={kpiValues.gscCtrValue}
            subtitle={hasGscData(data.trafficModule) ? 'Average click-through rate' : null}
            badge={hasGscData(data.trafficModule) ? 'GSC' : null}
            isLoading={loading}
            error={cardErrors.gscCtr}
            emptyMessage="Connect GSC and set website property to show CTR."
          />
          <KpiCard
            title="GSC Avg Position"
            value={kpiValues.gscAveragePositionValue}
            subtitle={kpiValues.gscPositionSubtitle}
            badge={hasGscData(data.trafficModule) ? 'GSC' : null}
            isLoading={loading}
            error={cardErrors.gscPosition}
            emptyMessage="Connect GSC and set website property to show average position."
          />
          <KpiCard
            title="Top Query Clicks"
            value={kpiValues.gscTopQueryValue}
            subtitle={kpiValues.gscTopQuerySubtitle}
            badge={hasGscData(data.trafficModule) ? 'GSC' : null}
            isLoading={loading}
            error={cardErrors.gscTopQuery}
            emptyMessage="No top query rows found in this date range."
          />
          <KpiCard
            title="Top Page Clicks"
            value={kpiValues.gscTopPageValue}
            subtitle={kpiValues.gscTopPageSubtitle}
            badge={hasGscData(data.trafficModule) ? 'GSC' : null}
            isLoading={loading}
            error={cardErrors.gscTopPage}
            emptyMessage="No top page rows found in this date range."
          />
          <KpiCard
            title="GA4 Users"
            value={kpiValues.gaUsersValue}
            subtitle={kpiValues.gaUsersSubtitle}
            badge={hasGaData(data.trafficModule) ? 'GA4' : null}
            isLoading={loading}
            error={cardErrors.gaUsers}
            emptyMessage="Connect Google Analytics provider to show users."
          />
          <KpiCard
            title="GA4 Sessions"
            value={kpiValues.gaSessionsValue}
            subtitle={kpiValues.gaSessionsSubtitle}
            badge={hasGaData(data.trafficModule) ? 'GA4' : null}
            isLoading={loading}
            error={cardErrors.gaSessions}
            emptyMessage="Connect Google Analytics provider to show sessions."
          />
          <KpiCard
            title="GA4 Engagement"
            value={kpiValues.gaEngagementValue}
            subtitle={kpiValues.gaEngagementSubtitle}
            badge={hasGaData(data.trafficModule) ? 'GA4' : null}
            isLoading={loading}
            error={cardErrors.gaEngagement}
            emptyMessage="Connect Google Analytics provider to show engagement rate."
          />
          <KpiCard
            title="GA4 Avg Session"
            value={kpiValues.gaAvgSessionValue}
            subtitle={kpiValues.gaAvgSessionSubtitle}
            badge={hasGaData(data.trafficModule) ? 'GA4' : null}
            isLoading={loading}
            error={cardErrors.gaAvgSession}
            emptyMessage="Connect Google Analytics provider to show session duration."
          />
          <KpiCard
            title="GA4 Conversions"
            value={kpiValues.gaConversionsValue}
            subtitle={kpiValues.gaConversionsSubtitle}
            badge={hasGaData(data.trafficModule) ? 'GA4' : null}
            isLoading={loading}
            error={cardErrors.gaConversions}
            emptyMessage="Connect Google Analytics provider to show conversions."
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
          backlinksData={data.backlinksModule}
          loading={loading}
          error={cardErrors.siteHealthModule}
          backlinksError={cardErrors.backlinks}
        />
      </DashboardSection>

      {loading ? <LoadingSpinner message="Loading dashboard metrics..." /> : null}
    </DashboardShell>
  );
}
