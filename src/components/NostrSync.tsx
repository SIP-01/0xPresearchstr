import { useEffect } from 'react';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { parseBlossomServerList } from '@/lib/appBlossom';
import type { AccountConfig } from '@/contexts/AppContext';

/**
 * NostrSync - Syncs user's Nostr data
 *
 * This component runs globally to sync various Nostr data when the user logs in.
 * Currently syncs:
 * - NIP-65 relay list (kind 10002)
 * - BUD-03 Blossom server list (kind 10063)
 */
export function NostrSync() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { accountPubkey, updateAccountConfig } = useAppContext();
  const pubkey = user?.pubkey;

  useEffect(() => {
    if (!pubkey || accountPubkey !== pubkey) return;
    const controller = new AbortController();

    const syncListsFromNostr = async () => {
      try {
        const events = await nostr.query(
          [
            { kinds: [10002], authors: [pubkey], limit: 1 },
            { kinds: [10063], authors: [pubkey], limit: 1 },
          ],
          { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) },
        );
        if (controller.signal.aborted) return;

        const ownEvents = events.filter((event) => event.pubkey === pubkey)
          .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
        const relayEvent = ownEvents.find((event) => event.kind === 10002);
        const blossomEvent = ownEvents.find((event) => event.kind === 10063);

        updateAccountConfig(pubkey, (current) => {
          if (controller.signal.aborted) return {};
          const patch: Partial<AccountConfig> = {};
          if (relayEvent && relayEvent.created_at > (current.relayMetadata?.updatedAt ?? 0)) {
            const relays = relayEvent.tags
              .filter(([name, , marker]) => name === 'r' && (!marker || marker === 'read' || marker === 'write'))
              .map(([_, url, marker]) => ({
                url,
                read: !marker || marker === 'read',
                write: !marker || marker === 'write',
              }))
              .filter(({ url }) => {
                try { return ['ws:', 'wss:'].includes(new URL(url).protocol); } catch { return false; }
              });
            patch.relayMetadata = { relays, updatedAt: relayEvent.created_at };
          }
          if (blossomEvent && blossomEvent.created_at > (current.blossomServerMetadata?.updatedAt ?? 0)) {
            const servers = parseBlossomServerList(blossomEvent)
              .filter((url) => new URL(url).protocol === 'https:');
            patch.blossomServerMetadata = { servers, updatedAt: blossomEvent.created_at };
          }
          return patch;
        });
      } catch (error) {
        if (!controller.signal.aborted) console.error('Failed to sync account lists from Nostr:', error);
      }
    };

    void syncListsFromNostr();
    return () => controller.abort();
  }, [pubkey, accountPubkey, nostr, updateAccountConfig]);

  return null;
}
