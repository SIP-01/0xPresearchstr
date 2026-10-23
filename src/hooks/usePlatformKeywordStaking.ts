/**
 * Read and publish the platform keyword-staking switch.
 *
 * On by default. Only the owner and admins can change it, and the event
 * is trusted only when its pubkey is still on that list.
 */
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useAdminAccess, useRoleLists } from '@/hooks/useAdminAccess';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { OWNER_PUBKEY, getModerationRelayUrls } from '@/lib/moderation';
import {
  PLATFORM_KEYWORD_STAKING_D_TAG,
  PLATFORM_KEYWORD_STAKING_KIND,
  buildPlatformKeywordStakingEvent,
  resolvePlatformKeywordStaking,
  type PlatformKeywordStakingState,
} from '@/lib/platformKeywordStaking';
import { publishToRelayPool, queryRelayPool } from '@/lib/searchRelays';

async function publishControlEvent(
  user: NonNullable<ReturnType<typeof useCurrentUser>['user']>,
  template: { kind: number; content: string; tags: string[][] },
): Promise<void> {
  const event = await user.signer.signEvent({
    kind: template.kind,
    content: template.content,
    tags: template.tags,
    created_at: Math.floor(Date.now() / 1000),
  });
  const accepted = await publishToRelayPool(getModerationRelayUrls(), event, 6000);
  if (accepted === 0) throw new Error('No relay accepted the keyword staking setting');
}

export function usePlatformKeywordStaking() {
  const { user } = useCurrentUser();
  const { admins, isLoading: rolesLoading } = useRoleLists();
  const { isAdmin, isLoading: accessLoading } = useAdminAccess();
  const queryClient = useQueryClient();

  const authors = useMemo(
    () => [...new Set([OWNER_PUBKEY, ...admins])],
    [admins],
  );
  const authorKey = authors.slice().sort().join(',');

  const query = useQuery({
    queryKey: ['platform-keyword-staking', authorKey],
    enabled: !rolesLoading && authors.length > 0,
    queryFn: async ({ signal }) => {
      const trusted = new Set(authors);
      const settled = await queryRelayPool(
        getModerationRelayUrls(),
        [{
          kinds: [PLATFORM_KEYWORD_STAKING_KIND],
          authors,
          '#d': [PLATFORM_KEYWORD_STAKING_D_TAG],
          limit: 25,
        }],
        { signal },
      );
      const events: NostrEvent[] = [];
      for (const batch of settled) events.push(...batch);
      return resolvePlatformKeywordStaking(events, trusted);
    },
    staleTime: 60_000,
    retry: 1,
  });

  const setEnabled = useCallback(async (enabled: boolean) => {
    if (!user || !isAdmin) throw new Error('Only admins can change keyword staking');
    const previous = queryClient.getQueriesData<PlatformKeywordStakingState>({
      queryKey: ['platform-keyword-staking'],
    });
    const next: PlatformKeywordStakingState = {
      enabled,
      updatedAt: Math.floor(Date.now() / 1000),
      author: user.pubkey,
    };
    queryClient.setQueriesData({ queryKey: ['platform-keyword-staking'] }, next);
    try {
      await publishControlEvent(user, buildPlatformKeywordStakingEvent(enabled));
    } catch (error) {
      for (const [key, data] of previous) queryClient.setQueryData(key, data);
      throw error;
    }
    window.setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ['platform-keyword-staking'] });
    }, 2000);
  }, [isAdmin, queryClient, user]);

  return {
    /** Pre staking words are shown. Missing control data stays on. */
    enabled: query.data?.enabled ?? true,
    isLoading: rolesLoading || accessLoading || query.isLoading,
    canToggle: isAdmin && !accessLoading,
    setEnabled,
  };
}
