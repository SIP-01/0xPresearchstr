/**
 * Platform feature flags — owner/admin-signed addressable events.
 *
 * Keyword Staking (PRE ads) is a platform placement: on by default, and
 * only the owner or an admin can turn it off. Regular users cannot hide
 * these results from Settings. The d-tag alone is not a trust boundary —
 * readers filter by owner + admin pubkeys.
 */
import type { NostrEvent } from '@nostrify/nostrify';

import { APP_PROFILE } from '@/lib/appProfile';

export const PLATFORM_KIND = 30078;
export const KEYWORD_STAKING_D_TAG = APP_PROFILE.control.keywordStakingDTag;
export const PLATFORM_T_TAG = APP_PROFILE.control.platformTTag;

/** Missing or unreadable events mean the platform placement stays on. */
export const KEYWORD_STAKING_DEFAULT = true;

/** Parse a trusted platform Keyword Staking event. */
export function parseKeywordStakingEnabled(
  event: NostrEvent,
  trusted: ReadonlySet<string>,
): boolean | null {
  if (event.kind !== PLATFORM_KIND) return null;
  if (!trusted.has(event.pubkey)) return null;
  const d = event.tags.find(([name]) => name === 'd')?.[1];
  if (d !== KEYWORD_STAKING_D_TAG) return null;
  const enabled = event.tags.find(([name]) => name === 'enabled')?.[1];
  if (enabled === '0' || enabled === 'false') return false;
  if (enabled === '1' || enabled === 'true') return true;
  return KEYWORD_STAKING_DEFAULT;
}

/** Pick the newest trusted event (created_at, then id). */
export function latestTrustedEvent(
  events: Iterable<NostrEvent>,
  trusted: ReadonlySet<string>,
): NostrEvent | undefined {
  let latest: NostrEvent | undefined;
  for (const event of events) {
    if (!trusted.has(event.pubkey)) continue;
    if (!latest
      || event.created_at > latest.created_at
      || (event.created_at === latest.created_at && event.id < latest.id)) {
      latest = event;
    }
  }
  return latest;
}

export function buildKeywordStakingEvent(enabled: boolean): {
  kind: number;
  content: string;
  tags: string[][];
} {
  return {
    kind: PLATFORM_KIND,
    content: '',
    tags: [
      ['d', KEYWORD_STAKING_D_TAG],
      ['t', PLATFORM_T_TAG],
      ['enabled', enabled ? '1' : '0'],
      ['alt', `Platform Keyword Staking (PRE ads) ${enabled ? 'on' : 'off'}`],
    ],
  };
}
