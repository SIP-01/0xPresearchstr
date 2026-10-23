/**
 * Platform keyword staking switch.
 *
 * On for every visitor unless the owner or an admin has published "off".
 * The publish path refuses anyone else, and readers drop untrusted authors.
 */
import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useAdminAccess, useRoleLists } from '@/hooks/useAdminAccess';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { getModerationRelayUrls, OWNER_PUBKEY } from '@/lib/moderation';
import { publishToRelayPool, queryRelayPool } from '@/lib/searchRelays';
import { buildKeywordStakingEvent, KEYWORD_STAKING_D_TAG, KEYWORD_STAKING_KIND, latestKeywordStakingEnabled } from '@/lib/keywordStaking';

export function keywordStakingQueryKey(authorKey: string): readonly [string, string] {
  return ['keyword-staking', authorKey];
}

export function useKeywordStaking() {
  const { user } = useCurrentUser();
  const { isAdmin } = useAdminAccess();
  const { admins, isLoading: rolesLoading } = useRoleLists();
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);

  const authors = [...new Set([OWNER_PUBKEY, ...admins])];
  const authorKey = [...authors].sort().join(',');
  const queryKey = keywordStakingQueryKey(authorKey);

  const query = useQuery({
    queryKey,
    enabled: !rolesLoading,
    queryFn: async ({ signal }) => {
      const trusted = new Set(authors);
      const settled = await queryRelayPool(
        getModerationRelayUrls(),
        [{
          kinds: [KEYWORD_STAKING_KIND],
          authors,
          '#d': [KEYWORD_STAKING_D_TAG],
          limit: Math.max(authors.length, 1),
        }],
        { signal },
      );

      const events: NostrEvent[] = [];
      for (const batch of settled) events.push(...batch);
      return latestKeywordStakingEnabled(events, trusted);
    },
    staleTime: 60_000,
    retry: 1,
  });

  const setEnabled = useCallback(async (enabled: boolean) => {
    if (!user || !isAdmin) {
      throw new Error('Only an admin can change keyword staking');
    }

    setIsSaving(true);
    try {
      const template = buildKeywordStakingEvent(enabled);
      const event = await user.signer.signEvent({
        kind: template.kind,
        content: template.content,
        tags: template.tags,
        created_at: Math.floor(Date.now() / 1000),
      });

      const accepted = await publishToRelayPool(getModerationRelayUrls(), event, 6000);
      if (accepted === 0) {
        throw new Error('No relay accepted the keyword staking setting');
      }

      queryClient.setQueryData(keywordStakingQueryKey(authorKey), enabled);
      window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['keyword-staking'] });
      }, 2000);
    } finally {
      setIsSaving(false);
    }
  }, [user, isAdmin, queryClient, authorKey]);

  return {
    /** Platform default is on while the setting is loading or unavailable. */
    enabled: query.data ?? true,
    isLoading: rolesLoading || query.isLoading,
    canToggle: isAdmin,
    isSaving,
    setEnabled,
  };
}
