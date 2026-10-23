/**
 * Unified search hook — runs all providers in parallel, streams results, and auto-indexes.
 *
 * Each provider resolves independently so results appear incrementally:
 *   ✔ Nostr (124ms)
 *   ✔ Wikipedia (230ms)
 *   ⏳ SearXNG...
 *   ⏳ Hacker News...
 *
 * Returns per-provider status so the UI can show live progress indicators.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { SearchResult, SearchSource, ProviderSearchResponse } from '@/lib/providers/types';
import { getProvidersForPrivacy, getProvidersForSource } from '@/lib/providers/registry';
import { classifyQuery, providerAllowlistFor } from '@/lib/queryClassify';
import { parseQuery } from '@/lib/queryParser';
import { applyHardConstraints } from '@/lib/queryEngine';
import { sortByQueryRelevance } from '@/lib/resultRank';
import { normalizeIndexUrl } from '@/lib/webIndex';
import { isHiddenResult } from '@/lib/moderation';
import { useSearchIndexer } from '@/hooks/useSearchIndexer';
import { useModerationSet } from '@/hooks/useModeration';
import { useAppContext } from '@/hooks/useAppContext';

export type ProviderStatus = 'idle' | 'searching' | 'done' | 'error';

export interface ProviderState {
  id: string;
  name: string;
  source: SearchSource;
  status: ProviderStatus;
  resultCount: number;
  latencyMs?: number;
}

export interface UseProviderSearchOptions {
  query: string;
  source: SearchSource | 'all' | 'index';
  enabled?: boolean;
}

export interface UseProviderSearchResult {
  /** All results from all providers, merged and sorted. */
  results: SearchResult[];
  /** Per-provider status for progress indicators. */
  providers: ProviderState[];
  /** Overall loading state (at least one provider still searching). */
  isLoading: boolean;
  /** At least one provider is fetching (initial or refetch). */
  isFetching: boolean;
  /** All providers finished but no results found. */
  isEmpty: boolean;
  /** Search suggestions from web providers. */
  suggestions: string[];
  /** Count of results per source category. */
  counts: Record<SearchSource | 'all', number>;
  /** Whether Privacy Mode is active (Nostr-tier providers only). */
  privacyMode: boolean;
  /** Providers blocked by Privacy Mode for the current source. */
  suppressedProviders: { id: string; name: string }[];
}

const EMPTY_RESULTS: SearchResult[] = [];

export function useProviderSearch({
  query,
  source,
  enabled = true,
}: UseProviderSearchOptions): UseProviderSearchResult {
  const { config } = useAppContext();
  const privacyMode = config.privacyMode;
  // Result language filter (Settings → General) — forwarded to every
  // provider; engines that support it filter server-side.
  const languageFilter = config.languageFilter;
  const activeProviders = useMemo(() => {
    let providers = getProvidersForPrivacy(source, privacyMode);
    // User-disabled engines never run (Settings → Search Engines).
    if (config.disabledProviders.length > 0) {
      providers = providers.filter((p) => !config.disabledProviders.includes(p.id));
    }
    // Nostr (npub) keyword staking is off by default — a dedicated setting,
    // not an engines-list toggle.
    if (!config.npubStaking) {
      providers = providers.filter((p) => p.id !== 'keyword-stakes');
    }
    // Skip providers that can't possibly answer this query class
    // (a bare npub to SearXNG is pure waste + a privacy leak).
    const allowlist = providerAllowlistFor(classifyQuery(query));
    if (allowlist) providers = providers.filter((p) => allowlist.has(p.id));
    return providers;
  }, [source, privacyMode, query, config.disabledProviders, config.npubStaking]);
  /**
   * The parsed structured query — computed once per query string (memoized
   * in the parser too). Providers get it for operator translation/local
   * evaluation; the merge layer applies hard constraints to every result.
   */
  const parsedQuery = useMemo(() => parseQuery(query), [query]);
  /** Providers that exist for this source but are blocked by Privacy Mode. */
  const suppressedProviders = useMemo(() => {
    if (!privacyMode) return [];
    const active = new Set(activeProviders.map((p) => p.id));
    return getProvidersForSource(source).filter((p) => !active.has(p.id));
  }, [source, privacyMode, activeProviders]);
  const { indexResults } = useSearchIndexer();
  // Owner-signed moderation list — hidden URLs/event ids are filtered for everyone.
  const moderationSet = useModerationSet();

  const providerIds = useMemo(() => activeProviders.map((p) => p.id), [activeProviders]);

  // ─── Result streaming ──────────────────────────────────────────────
  // Results render as each provider resolves instead of waiting for the
  // slowest one (SearXNG via proxy can take seconds; the Nostr index
  // answers in ~100ms). The final complete set still lands in the query
  // cache as `data`.
  const streamKey = JSON.stringify([query, source, privacyMode, languageFilter, providerIds]);
  const [progress, setProgress] = useState<{
    key: string;
    results: SearchResult[];
    providers: Map<string, ProviderState>;
  }>({ key: '', results: [], providers: new Map() });

  /** Append a provider's results to the visible stream (dedupe + constraints + coverage rank). */
  const appendStreamed = useCallback((key: string, fresh: SearchResult[], query: string, signal: AbortSignal) => {
    if (fresh.length === 0) return;
    setProgress((prev) => {
      if (signal.aborted || prev.key !== key) return prev;
      // Hard constraints (filters + NOT) apply to EVERY provider's results —
      // an engine that misunderstood site: can't leak a wrong result through.
      const constrained = applyHardConstraints(fresh, parseQuery(query));
      const merged = deduplicateResults([...prev.results, ...constrained]);
      return { ...prev, results: sortByQueryRelevance(merged, query) };
    });
  }, []);

  const updateProviderState = useCallback((key: string, id: string, update: Partial<ProviderState>, signal: AbortSignal) => {
    setProgress((prev) => {
      if (signal.aborted || prev.key !== key) return prev;
      const next = new Map(prev.providers);
      const existing = next.get(id);
      if (existing) {
        next.set(id, { ...existing, ...update });
      }
      return { ...prev, providers: next };
    });
  }, []);

  // Main query — runs all providers in parallel.
  const { data, isFetching } = useQuery<{
    results: SearchResult[];
    suggestions: string[];
  }>({
    queryKey: ['provider-search', query, source, privacyMode, languageFilter, providerIds],
    queryFn: async ({ signal }) => {
      if (!query.trim()) return { results: [], suggestions: [] };
      signal.throwIfAborted();

      // Initialize provider states.
      const initialStates = new Map<string, ProviderState>();
      for (const p of activeProviders) {
        initialStates.set(p.id, {
          id: p.id,
          name: p.name,
          source: p.source,
          status: 'searching',
          resultCount: 0,
        });
      }
      setProgress({ key: streamKey, results: [], providers: initialStates });

      // Run all providers in parallel.
      const results: SearchResult[] = [];
      const allSuggestions: string[] = [];

      const settled = await Promise.allSettled(
        activeProviders.map(async (provider) => {
          const start = performance.now();
          try {
            const response: ProviderSearchResponse = await provider.search({
              query: query.trim(),
              signal,
              languages: languageFilter,
              parsed: parsedQuery,
            });

            const latencyMs = Math.round(performance.now() - start);

            updateProviderState(streamKey, provider.id, {
              status: 'done',
              resultCount: response.results.length,
              latencyMs,
            }, signal);

            // Stream: show this provider's results immediately — the UI
            // re-renders per provider completion, not at the very end.
            appendStreamed(streamKey, response.results, query, signal);
            return response;
          } catch {
            const latencyMs = Math.round(performance.now() - start);
            updateProviderState(streamKey, provider.id, {
              status: 'error',
              resultCount: 0,
              latencyMs,
            }, signal);
            return { results: [], suggestions: [] } as ProviderSearchResponse;
          }
        }),
      );

      for (const s of settled) {
        if (s.status === 'fulfilled') {
          results.push(...s.value.results);
          if (s.value.suggestions) allSuggestions.push(...s.value.suggestions);
        }
      }

      // Deduplicate by URL (prefer the result with the higher score).
      const deduped = deduplicateResults(results);

      // Apply the query's hard constraints (structured filters + NOT) across
      // ALL providers — the local backstop that makes operators authoritative.
      const constrained = applyHardConstraints(deduped, parsedQuery);

      // Sort by coverage-adjusted score, then recency inside the tie band —
      // results matching all/most query words outrank loose engine hits.
      sortByQueryRelevance(constrained, query);

      return {
        results: constrained,
        suggestions: [...new Set(allSuggestions)].slice(0, 8),
      };
    },
    enabled: enabled && query.trim().length > 0,
    staleTime: 30_000,
    retry: 0,
    // No placeholderData — a new query streams fresh results instead of
    // showing the previous query's stale set.
  });

  // The visible result set: the completed (cached) data once available,
  // the live stream while providers are still resolving.
  const baseResults = data?.results ?? (progress.key === streamKey ? progress.results : EMPTY_RESULTS);

  // Apply owner-signed moderation filtering to whatever is visible.
  // (Additive: until the moderation list loads, nothing is filtered.)
  const allResults = useMemo(() => {
    if (!moderationSet) return baseResults;
    return baseResults.filter((r) => !isHiddenResult(r, moderationSet));
  }, [baseResults, moderationSet]);
  const suggestions = data?.suggestions ?? [];

  // Reset provider states when query clears.
  const providers = useMemo(() => {
    if (!query.trim()) return [];
    return activeProviders.map<ProviderState>((p) => (progress.key === streamKey ? progress.providers.get(p.id) : undefined) ?? {
      id: p.id,
      name: p.name,
      source: p.source,
      status: isFetching ? 'searching' : data ? 'done' : 'idle',
      resultCount: 0,
    });
  }, [activeProviders, progress, streamKey, query, isFetching, data]);

  const isLoading = providers.some((p) => p.status === 'searching');
  const isEmpty = query.trim().length > 0 && !isLoading && allResults.length === 0;

  // Auto-index: contribute surfaced pages (SIP-01 kind 39697) + a hashed
  // term signal (kind 30078, no plaintext) to the shared Nostr index.
  const indexedQueryRef = useRef('');
  useEffect(() => {
    if (
      allResults.length > 0 &&
      query.trim() &&
      enabled &&
      !isFetching &&
      !isLoading &&
      indexedQueryRef.current !== streamKey
    ) {
      indexedQueryRef.current = streamKey;
      void indexResults(query, allResults);
    }
  }, [allResults, query, enabled, isFetching, isLoading, streamKey, indexResults]);

  // Counts per source.
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: allResults.length };
    for (const r of allResults) {
      c[r.source] = (c[r.source] ?? 0) + 1;
    }
    return c as Record<SearchSource | 'all', number>;
  }, [allResults]);

  return {
    results: allResults,
    providers,
    isLoading,
    isFetching,
    isEmpty,
    suggestions,
    counts,
    privacyMode,
    suppressedProviders,
  };
}

/** Deduplicate results by normalized URL. Prefer higher-scored versions. */
export function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const map = new Map<string, SearchResult>();

  for (const r of results) {
    const key = normalizeIndexUrl(r.url) ?? (r.url || r.id);
    const existing = map.get(key);
    if (!existing || (r.score ?? 0) > (existing.score ?? 0)) {
      map.set(key, r);
    }
  }

  return [...map.values()];
}
