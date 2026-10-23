/**
 * Platform Keyword Staking (PRE ads) — on by default, admin-only toggle.
 *
 * Readers trust owner + admin-signed kind 30078 events. When no event
 * exists the placement stays on so a fresh deployment shows PRE ads.
 */
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAdminAccess, useRoleLists } from '@/hooks/useAdminAccess';
import { queryRelayPool, publishToRelayPool } from '@/lib/searchRelays';
import { getModerationRelayUrls } from '@/lib/moderation';
import { OWNER_PUBKEY } from '@/lib/moderation';
import {
  PLATFORM_KIND,
  KEYWORD_STAKING_D_TAG,
  KEYWORD_STAKING_DEFAULT,
  parseKeywordStakingEnabled,
  latestTrustedEvent,
  buildKeywordStakingEvent,
} from '@/lib/platformFeatures';

export function usePlatformKeywordStaking() {
  const { user } = useCurrentUser();
  const { isAdmin } = useAdminAccess();
  const { admins, isLoading: rolesLoading } = useRoleLists();
  const queryClient = useQueryClient();

  const trusted = useMemo(
    () => new Set<string>([OWNER_PUBKEY, ...admins]),
    [admins],
  );
  const trustedKey = useMemo(() => [...trusted].sort().join(','), [trusted]);

  const query = useQuery({
    queryKey: ['platform-keyword-staking', trustedKey],
    queryFn: async ({ signal }) => {
      const authors = [...trusted];
      const settled = await queryRelayPool(
        getModerationRelayUrls(),
        [{
          kinds: [PLATFORM_KIND],
          authors,
          '#d': [KEYWORD_STAKING_D_TAG],
          limit: 8,
        }],
        { signal },
      );

      const events = settled.flat();
      const latest = latestTrustedEvent(events, trusted);
      if (!latest) return KEYWORD_STAKING_DEFAULT;
      return parseKeywordStakingEnabled(latest, trusted) ?? KEYWORD_STAKING_DEFAULT;
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const setEnabled = useCallback(async (enabled: boolean) => {
    if (!user || !isAdmin) throw new Error('Only admins can change platform Keyword Staking');
    const template = buildKeywordStakingEvent(enabled);
    const event = await user.signer.signEvent({
      kind: template.kind,
      content: template.content,
      tags: template.tags,
      created_at: Math.floor(Date.now() / 1000),
    });
    const accepted = await publishToRelayPool(getModerationRelayUrls(), event, 6000);
    if (accepted === 0) throw new Error('No moderation relay accepted the event');
    queryClient.setQueryData(['platform-keyword-staking', trustedKey], enabled);
    setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ['platform-keyword-staking'] });
    }, 2000);
  }, [user, isAdmin, queryClient, trustedKey]);

  return {
    /** Platform PRE Keyword Staking placement. Defaults ON. */
    enabled: query.data ?? KEYWORD_STAKING_DEFAULT,
    isLoading: rolesLoading || query.isLoading,
    canToggle: isAdmin,
    setEnabled,
  };
}
