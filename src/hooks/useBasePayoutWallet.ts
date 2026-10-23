import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import type { Eip1193Provider } from '@/lib/basePayoutProvider';
import { requestBasePayoutProof } from '@/lib/basePayoutProvider';
import {
  BASE_PAYOUT_KIND,
  basePayoutTagsWithoutWallet,
  buildBasePayoutTags,
  latestReplaceable,
  parseBasePayoutWallet,
  type BasePayoutWallet,
} from '@/lib/basePayoutWallet';

export function useBasePayoutWallet(pubkey: string | undefined) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const publish = useNostrPublish();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['base-payout-wallet', pubkey ?? ''],
    enabled: Boolean(pubkey),
    staleTime: 60_000,
    retry: 1,
    queryFn: async ({ signal }) => {
      if (!pubkey) return null;
      const events = await nostr.query(
        [{ kinds: [BASE_PAYOUT_KIND], authors: [pubkey], limit: 5 }],
        { signal },
      );
      return parseBasePayoutWallet(latestReplaceable(events), pubkey);
    },
  });

  const remember = (next: BasePayoutWallet | null) => {
    if (!pubkey) return;
    queryClient.setQueryData(['base-payout-wallet', pubkey], next);
  };

  const link = async (provider: Eip1193Provider): Promise<BasePayoutWallet> => {
    if (!user || user.pubkey !== pubkey) throw new Error('Log in with Nostr before linking a Base wallet.');
    const proof = await requestBasePayoutProof(provider, user.pubkey);
    const existing = await nostr.query(
      [{ kinds: [BASE_PAYOUT_KIND], authors: [user.pubkey], limit: 5 }],
      { signal: AbortSignal.timeout(5000) },
    );
    const tags = buildBasePayoutTags(latestReplaceable(existing)?.tags ?? [], proof.address, proof.signature);
    const event = await publish.mutateAsync({ kind: BASE_PAYOUT_KIND, content: '', tags });
    const wallet = parseBasePayoutWallet(event, user.pubkey);
    if (!wallet) throw new Error('The payout proof could not be published.');
    remember(wallet);
    return wallet;
  };

  const unlink = async (): Promise<void> => {
    if (!user || user.pubkey !== pubkey) throw new Error('Log in with Nostr before removing a Base wallet.');
    const existing = await nostr.query(
      [{ kinds: [BASE_PAYOUT_KIND], authors: [user.pubkey], limit: 5 }],
      { signal: AbortSignal.timeout(5000) },
    );
    const tags = basePayoutTagsWithoutWallet(latestReplaceable(existing)?.tags ?? []);
    const event = await publish.mutateAsync({ kind: BASE_PAYOUT_KIND, content: '', tags });
    remember(parseBasePayoutWallet(event, user.pubkey));
  };

  return {
    ...query,
    data: pubkey ? query.data ?? null : null,
    canEdit: Boolean(user && pubkey && user.pubkey === pubkey),
    link,
    unlink,
  };
}
