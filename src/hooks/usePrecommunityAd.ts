import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { ENGINE_ADS_BASE } from '@/lib/aiConfig';
import { parsePrecommunityResponse } from '@/lib/precommunity';
import { classifyQuery } from '@/lib/queryClassify';

export function isPrecommunityQueryEligible(query: string): boolean {
  const normalized = query.trim();
  return normalized.length > 0 && normalized.length <= 400
    && !/^nsec1/i.test(normalized) && classifyQuery(normalized) === 'text';
}

/** Ads stay separate from organic ranking, indexing, votes, and AI evidence. */
export function usePrecommunityAd(query: string, enabled = true) {
  const queryClient = useQueryClient();
  const normalized = query.trim();
  const canFetch = enabled && isPrecommunityQueryEligible(normalized);
  const result = useQuery({
    queryKey: ['precommunity-ad', normalized],
    queryFn: async ({ signal }) => {
      const response = await fetch(`${ENGINE_ADS_BASE}/precommunity?q=${encodeURIComponent(normalized)}`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]),
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return { ad: null };
      const data: unknown = await response.json();
      return parsePrecommunityResponse(data) ?? { ad: null };
    },
    enabled: canFetch,
    staleTime: Infinity,
    gcTime: 0,
    retry: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (!canFetch) {
      void queryClient.cancelQueries({ queryKey: ['precommunity-ad', normalized], exact: true });
    }
  }, [canFetch, normalized, queryClient]);

  return { ...result, data: canFetch ? result.data : undefined };
}
