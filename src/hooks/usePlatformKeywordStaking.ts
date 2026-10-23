/**
 * Platform keyword staking switch.
 *
 * On unless the latest owner- or admin-signed event says otherwise.
 * Publishing is limited to team admins (owner or the admin role list).
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAdminAccess, useRoleLists } from '@/hooks/useAdminAccess';
import { publishTeamEvent } from '@/hooks/useModeration';
import { getModerationRelayUrls, OWNER_PUBKEY } from '@/lib/moderation';
import { queryRelayPool } from '@/lib/searchRelays';
import {
  KEYWORD_STAKING_D_TAG,
  KEYWORD_STAKING_KIND,
  buildKeywordStakingEvent,
  resolveKeywordStakingEnabled,
} from '@/lib/keywordStaking';

export function usePlatformKeywordStaking() {
  const { user } = useCurrentUser();
  const { admins, isLoading: rolesLoading } = useRoleLists();
  const { isAdmin, isLoading: accessLoading } = useAdminAccess();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const authors = useMemo(
    () => [...new Set([OWNER_PUBKEY, ...admins].map((pubkey) => pubkey.toLowerCase()))],
    [admins],
  );

  const query = useQuery({
    queryKey: ['platform-keyword-staking', authors],
    queryFn: async ({ signal }) => {
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
      const events = settled.flat();
      return resolveKeywordStakingEnabled(events, authors);
    },
    enabled: !rolesLoading,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const enabled = query.data ?? true;
  const queryKey = ['platform-keyword-staking', authors] as const;

  const setEnabled = async (next: boolean) => {
    if (!user || !isAdmin) throw new Error('Only admins can change keyword staking');
    const previous = queryClient.getQueryData<boolean>(queryKey);
    setSaving(true);
    await queryClient.cancelQueries({ queryKey });
    queryClient.setQueryData(queryKey, next);
    try {
      await publishTeamEvent(user, buildKeywordStakingEvent(next));
    } catch (error) {
      queryClient.setQueryData(queryKey, previous ?? true);
      throw error;
    } finally {
      setSaving(false);
    }
  };

  return {
    /** Platform placement. True while the control event is missing or still loading. */
    enabled,
    canToggle: Boolean(user) && isAdmin && !accessLoading,
    isLoading: rolesLoading || query.isLoading || accessLoading,
    saving,
    setEnabled,
  };
}
