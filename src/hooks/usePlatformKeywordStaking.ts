/**
 * Platform keyword-staking flag — PRE ads on/off for every visitor.
 *
 * Reads the latest owner- or admin-signed kind 30078 event. Missing or
 * unreadable events fail open (ads on). Only owner/admin keys may publish.
 */
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAdminAccess, useRoleLists } from '@/hooks/useAdminAccess';
import { queryRelayPool, publishToRelayPool } from '@/lib/searchRelays';
import { getModerationRelayUrls, OWNER_PUBKEY } from '@/lib/moderation';
import {
  PLATFORM_KEYWORD_STAKING_KIND,
  PLATFORM_KEYWORD_STAKING_D_TAG,
  DEFAULT_PRE_ADS_ENABLED,
  parsePlatformKeywordStaking,
  buildPlatformKeywordStakingEvent,
} from '@/lib/platformKeywordStaking';

const QUERY_KEY = 'platform-keyword-staking';

export function usePlatformKeywordStaking(): {
  preAdsEnabled: boolean;
  isLoading: boolean;
} {
  const { admins, isLoading: rolesLoading } = useRoleLists();
  const trusted = [OWNER_PUBKEY, ...admins];

  const { data, isLoading } = useQuery({
    queryKey: [QUERY_KEY, ...trusted],
    queryFn: async ({ signal }) => {
      const settled = await queryRelayPool(
        getModerationRelayUrls(),
        [{
          kinds: [PLATFORM_KEYWORD_STAKING_KIND],
          authors: trusted,
          '#d': [PLATFORM_KEYWORD_STAKING_D_TAG],
          limit: 10,
        }],
        { signal },
      );

      let latest: NostrEvent | undefined;
      for (const value of settled) {
        for (const ev of value) {
          if (ev.kind !== PLATFORM_KEYWORD_STAKING_KIND) continue;
          if (!trusted.includes(ev.pubkey)) continue;
          const parsed = parsePlatformKeywordStaking(ev);
          if (!parsed) continue;
          if (!latest || ev.created_at > latest.created_at
            || (ev.created_at === latest.created_at && ev.id < latest.id)) {
            latest = ev;
          }
        }
      }

      return latest ? parsePlatformKeywordStaking(latest) : { preAds: DEFAULT_PRE_ADS_ENABLED };
    },
    staleTime: 60_000,
    retry: 1,
  });

  return {
    preAdsEnabled: data?.preAds ?? DEFAULT_PRE_ADS_ENABLED,
    isLoading: rolesLoading || isLoading,
  };
}

export function usePlatformKeywordStakingActions() {
  const { user } = useCurrentUser();
  const { isAdmin } = useAdminAccess();
  const queryClient = useQueryClient();

  const setPreAdsEnabled = useCallback(async (enabled: boolean) => {
    if (!user || !isAdmin) throw new Error('Only admins can change platform keyword staking');

    const template = buildPlatformKeywordStakingEvent({ preAds: enabled });
    const event = await user.signer.signEvent({
      kind: template.kind,
      content: template.content,
      tags: template.tags,
      created_at: Math.floor(Date.now() / 1000),
    });

    const accepted = await publishToRelayPool(getModerationRelayUrls(), event, 6000);
    if (accepted === 0) {
      throw new Error('No control relay accepted the event');
    }

    queryClient.setQueriesData({ queryKey: [QUERY_KEY] }, { preAds: enabled });
    setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    }, 2000);
  }, [user, isAdmin, queryClient]);

  return { isAdmin, setPreAdsEnabled };
}
