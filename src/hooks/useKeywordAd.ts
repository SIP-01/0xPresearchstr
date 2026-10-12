/**
 * Hook: resolve the contract-backed keyword ad for the active query.
 * Runs alongside the normal provider search; silently returns null when
 * there is no ad or the /api/ads/resolve route is unavailable.
 */
import { useQuery } from '@tanstack/react-query';

import { resolveKeywordAd, type KeywordAd } from '@/lib/keywordAds';

export function useKeywordAd(query: string, enabled: boolean): {
  ad: KeywordAd | null;
} {
  const { data } = useQuery({
    queryKey: ['keyword-ad', query.trim()],
    queryFn: ({ signal }) => resolveKeywordAd(query, signal),
    enabled: enabled && query.trim().length > 0,
    // Match the worker-side cache TTL — ads are per-delivery (one-time
    // clickUrl), so refetch on a fresh search rather than serving long-stale
    // billing links.
    staleTime: 30_000,
    retry: 0,
  });

  return { ad: data ?? null };
}
