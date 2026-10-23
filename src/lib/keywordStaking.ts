/**
 * Keyword staking — the platform PRE placement.
 *
 * This is separate from npub staking (historical Nostr keyword stakes in
 * `keywordStakes.ts`). Keyword staking is resolved from PRE community and
 * shown on search. It is on unless an owner or admin publishes this
 * addressable setting as "off". Readers ignore every other author.
 *
 *   kind: 30078 (NIP-78)
 *   d: "presearchstr:keyword-staking"
 *   content: "on" | "off"
 */
import type { NostrEvent } from '@nostrify/nostrify';

import { APP_PROFILE } from '@/lib/appProfile';

export const KEYWORD_STAKING_KIND = 30078;
export const KEYWORD_STAKING_D_TAG = APP_PROFILE.control.keywordStakingDTag;
export const KEYWORD_STAKING_T_TAG = APP_PROFILE.control.settingsTTag;

/** Missing, unsigned, or malformed settings stay on. */
export function parseKeywordStakingEvent(event: NostrEvent, trusted: ReadonlySet<string>): boolean | null {
  if (event.kind !== KEYWORD_STAKING_KIND) return null;
  if (!trusted.has(event.pubkey)) return null;
  const dTag = event.tags.find(([name]) => name === 'd')?.[1];
  if (dTag !== KEYWORD_STAKING_D_TAG) return null;
  if (event.content === 'on') return true;
  if (event.content === 'off') return false;
  return null;
}

/** Latest trusted setting. No valid event means the platform default: on. */
export function latestKeywordStakingEnabled(events: readonly NostrEvent[], trusted: ReadonlySet<string>): boolean {
  let latest: NostrEvent | null = null;
  let enabled: boolean | null = null;

  for (const event of events) {
    const parsed = parseKeywordStakingEvent(event, trusted);
    if (parsed === null) continue;
    if (
      !latest
      || event.created_at > latest.created_at
      || (event.created_at === latest.created_at && event.id < latest.id)
    ) {
      latest = event;
      enabled = parsed;
    }
  }

  return enabled ?? true;
}

export function buildKeywordStakingEvent(enabled: boolean): {
  kind: number;
  content: string;
  tags: string[][];
} {
  return {
    kind: KEYWORD_STAKING_KIND,
    content: enabled ? 'on' : 'off',
    tags: [
      ['d', KEYWORD_STAKING_D_TAG],
      ['t', KEYWORD_STAKING_T_TAG],
      ['alt', 'Presearchstr keyword staking platform setting'],
    ],
  };
}
