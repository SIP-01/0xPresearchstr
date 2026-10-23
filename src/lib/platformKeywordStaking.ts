/**
 * Platform keyword staking — the PRE community placement shown on search.
 *
 * This is a platform control, not a personal preference. Visitors cannot
 * turn pre staking words off. Owner and admin keys publish one addressable
 * kind 30078 event; every client reads the newest event from those pubkeys.
 * No event, an unreadable event, or a signer who is no longer an admin
 * leaves keyword staking on.
 */
import type { NostrEvent } from '@nostrify/nostrify';

import { APP_PROFILE } from '@/lib/appProfile';

export const PLATFORM_KEYWORD_STAKING_KIND = 30078;
export const PLATFORM_KEYWORD_STAKING_D_TAG = APP_PROFILE.control.keywordStakingDTag;
export const PLATFORM_KEYWORD_STAKING_T_TAG = APP_PROFILE.control.platformTTag;

export interface PlatformKeywordStakingState {
  /** True when pre staking words are shown. The platform default is on. */
  enabled: boolean;
  /** Unix seconds of the winning event. Null when using the default. */
  updatedAt: number | null;
  /** Pubkey that signed the winning event. Null when using the default. */
  author: string | null;
}

const DEFAULT_STATE: PlatformKeywordStakingState = {
  enabled: true,
  updatedAt: null,
  author: null,
};

/** Build the owner/admin control event. */
export function buildPlatformKeywordStakingEvent(enabled: boolean): {
  kind: number;
  content: string;
  tags: string[][];
} {
  return {
    kind: PLATFORM_KEYWORD_STAKING_KIND,
    content: JSON.stringify({ enabled }),
    tags: [
      ['d', PLATFORM_KEYWORD_STAKING_D_TAG],
      ['t', PLATFORM_KEYWORD_STAKING_T_TAG],
      ['alt', enabled
        ? 'Presearchstr keyword staking is on'
        : 'Presearchstr keyword staking is off'],
    ],
  };
}

/** Parse one control event. Returns null unless the signer is trusted. */
export function parsePlatformKeywordStakingEvent(
  event: NostrEvent,
  trustedAuthors: ReadonlySet<string>,
): PlatformKeywordStakingState | null {
  if (event.kind !== PLATFORM_KEYWORD_STAKING_KIND) return null;
  if (!trustedAuthors.has(event.pubkey)) return null;

  const dTag = event.tags.find(([name]) => name === 'd')?.[1];
  if (dTag !== PLATFORM_KEYWORD_STAKING_D_TAG) return null;
  if (!event.tags.some(([name, value]) => name === 't' && value === PLATFORM_KEYWORD_STAKING_T_TAG)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(event.content) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || !('enabled' in parsed)) return null;
  if (typeof parsed.enabled !== 'boolean') return null;

  return {
    enabled: parsed.enabled,
    updatedAt: event.created_at,
    author: event.pubkey,
  };
}

function preferState(
  candidate: PlatformKeywordStakingState,
  current: PlatformKeywordStakingState,
): boolean {
  const candidateAt = candidate.updatedAt ?? 0;
  const currentAt = current.updatedAt ?? 0;
  if (candidateAt !== currentAt) return candidateAt > currentAt;
  return (candidate.author ?? '') < (current.author ?? '');
}

/**
 * Newest trusted control wins. Clients with the same author set agree,
 * including when two admins publish in the same second.
 */
export function resolvePlatformKeywordStaking(
  events: readonly NostrEvent[],
  trustedAuthors: ReadonlySet<string>,
): PlatformKeywordStakingState {
  let winner: PlatformKeywordStakingState | null = null;
  const seen = new Set<string>();

  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    const parsed = parsePlatformKeywordStakingEvent(event, trustedAuthors);
    if (!parsed) continue;
    if (!winner || preferState(parsed, winner)) winner = parsed;
  }

  return winner ?? DEFAULT_STATE;
}
