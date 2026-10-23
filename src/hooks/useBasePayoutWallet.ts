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
  profileContentWithBaseAddress,
  profilePayoutWallet,
  readProfileBaseAddress,
  type BasePayoutWallet,
} from '@/lib/basePayoutWallet';
import type { NostrEvent } from '@nostrify/nostrify';

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
        [
          { kinds: [BASE_PAYOUT_KIND], authors: [pubkey], limit: 5 },
          { kinds: [0], authors: [pubkey], limit: 1 },
        ],
        { signal },
      );
      return payoutFromEvents(events, pubkey);
    },
  });

  const remember = (next: BasePayoutWallet | null) => {
    if (!pubkey) return;
    queryClient.setQueryData(['base-payout-wallet', pubkey], next);
  };

  const loadEvents = async () => {
    if (!user) throw new Error('Log in before saving a Base address to your profile.');
    return nostr.query(
      [
        { kinds: [BASE_PAYOUT_KIND], authors: [user.pubkey], limit: 5 },
        { kinds: [0], authors: [user.pubkey], limit: 1 },
      ],
      { signal: AbortSignal.timeout(5000) },
    );
  };

  const writeProfile = async (events: NostrEvent[], address: string | null) => {
    const profile = events.find((event) => event.kind === 0);
    const content = profileContentWithBaseAddress(profile?.content ?? '{}', address);
    const tags = (profile?.tags ?? []).map((tag) => [...tag]);
    await publish.mutateAsync({ kind: 0, content, tags });
    if (user) void queryClient.invalidateQueries({ queryKey: ['nostr', 'author', user.pubkey] });
  };

  const saveToProfile = async (raw: string): Promise<BasePayoutWallet> => {
    if (!user || user.pubkey !== pubkey) throw new Error('Log in before saving a Base address to your profile.');
    const address = profilePayoutWallet(raw)?.address;
    if (!address) throw new Error('Enter a Base address: 0x followed by 40 hex characters.');
    const events = await loadEvents();
    const proof = parseBasePayoutWallet(
      latestReplaceable(events.filter((event) => event.kind === BASE_PAYOUT_KIND)),
      user.pubkey,
    );
    if (proof && proof.address !== address) {
      const tags = basePayoutTagsWithoutWallet(latestReplaceable(events.filter((event) => event.kind === BASE_PAYOUT_KIND))?.tags ?? []);
      await publish.mutateAsync({ kind: BASE_PAYOUT_KIND, content: '', tags });
    }
    await writeProfile(events, address);
    const wallet = proof?.address === address ? proof : profilePayoutWallet(address);
    if (!wallet) throw new Error('Enter a Base address: 0x followed by 40 hex characters.');
    remember(wallet);
    return wallet;
  };

  const link = async (provider: Eip1193Provider): Promise<BasePayoutWallet> => {
    if (!user || user.pubkey !== pubkey) throw new Error('Log in before saving a Base address to your profile.');
    const proof = await requestBasePayoutProof(provider, user.pubkey);
    const events = await loadEvents();
    const claim = latestReplaceable(events.filter((event) => event.kind === BASE_PAYOUT_KIND));
    const tags = buildBasePayoutTags(claim?.tags ?? [], proof.address, proof.signature);
    const event = await publish.mutateAsync({ kind: BASE_PAYOUT_KIND, content: '', tags });
    const wallet = parseBasePayoutWallet(event, user.pubkey);
    if (!wallet) throw new Error('The payout proof could not be published.');
    await writeProfile(events, wallet.address);
    remember(wallet);
    return wallet;
  };

  const unlink = async (): Promise<void> => {
    if (!user || user.pubkey !== pubkey) throw new Error('Log in before removing a Base address from your profile.');
    const events = await loadEvents();
    const claim = latestReplaceable(events.filter((event) => event.kind === BASE_PAYOUT_KIND));
    const tags = basePayoutTagsWithoutWallet(claim?.tags ?? []);
    await publish.mutateAsync({ kind: BASE_PAYOUT_KIND, content: '', tags });
    await writeProfile(events, null);
    remember(null);
  };

  return {
    ...query,
    data: pubkey ? query.data ?? null : null,
    canEdit: Boolean(user && pubkey && user.pubkey === pubkey),
    saveToProfile,
    link,
    unlink,
  };
}

function payoutFromEvents(events: NostrEvent[], pubkey: string): BasePayoutWallet | null {
  const proof = parseBasePayoutWallet(
    latestReplaceable(events.filter((event) => event.kind === BASE_PAYOUT_KIND)),
    pubkey,
  );
  if (proof) return proof;
  const profile = events.find((event) => event.kind === 0);
  const address = readProfileBaseAddress(profile?.content);
  return address ? profilePayoutWallet(address) : null;
}
