/**
 * Nostr Keyword Stakes provider — npub-signed keyword placements.
 *
 * When a search query exactly matches a staked keyword, the stake shows
 * as a "Community Stake" card. Off by default (Settings → Keyword Staking);
 * PRE Keyword Staking is the platform placement.
 *
 * Exact-match only: a stake buys placement for a specific keyword, not a
 * fuzzy topic. Relay query is a single #d filter.
 */
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { getSearchRelayUrls, getIndexRelayUrls } from '@/lib/appRelays';
import { queryRelayPool } from '@/lib/searchRelays';
import { STAKE_KIND, stakeDTag, parseStakeEvent } from '@/lib/keywordStakes';
import type { SearchProvider, SearchOptions, ProviderSearchResponse } from './types';

/** Max stakes shown for a single keyword. */
const MAX_STAKES = 3;

export const stakesProvider: SearchProvider = {
  id: 'keyword-stakes',
  name: 'Nostr Keyword Staking',
  source: 'web',
  privacy: 'nostr',
  privacyNote: 'Reads community keyword stakes signed by npubs from Nostr relays. Relay operators see the query, but no account is linked.',

  async search({ query, signal }: SearchOptions): Promise<ProviderSearchResponse> {
    const normalized = query.trim();
    if (!normalized) return { results: [] };

    const filter: NostrFilter = {
      kinds: [STAKE_KIND],
      '#d': [stakeDTag(normalized)],
      limit: 25,
    };

    const relayUrls = [...new Set([...getSearchRelayUrls(), ...getIndexRelayUrls()])];
    const settled = await queryRelayPool(relayUrls, [filter], { signal, timeoutMs: 5000 });

    const events = new Map<string, NostrEvent>();
    for (const value of settled) {
      for (const ev of value) {
        if (!events.has(ev.id)) events.set(ev.id, ev);
      }
    }

    const parsed = [...events.values()]
      .map(parseStakeEvent)
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
      .slice(0, MAX_STAKES);

    return { results: parsed };
  },
};
