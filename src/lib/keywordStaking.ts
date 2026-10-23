/**
 * Platform keyword staking — the PRE community ad placement.
 *
 * Visitors always see keyword staking unless a team admin turns it off.
 * The switch is an addressable kind 30078 event. Readers trust the owner
 * and owner-listed admins only; a missing or untrusted event means on.
 *
 * Nostr keyword staking (kind 30078, `0xsearchstr:stake:*`) and the npub
 * that signs those stakes stay a separate archive. This event does not
 * replace them.
 */
import type { NostrEvent } from '@nostrify/nostrify';

import { APP_PROFILE } from '@/lib/appProfile';

export const KEYWORD_STAKING_KIND = 30078;
export const KEYWORD_STAKING_D_TAG = APP_PROFILE.control.keywordStakingDTag;
export const KEYWORD_STAKING_T_TAG = APP_PROFILE.control.keywordStakingTTag;

/** Build the admin-signed platform switch. */
export function buildKeywordStakingEvent(enabled: boolean): {
  kind: number;
  content: string;
  tags: string[][];
} {
  return {
    kind: KEYWORD_STAKING_KIND,
    content: JSON.stringify({ enabled }),
    tags: [
      ['d', KEYWORD_STAKING_D_TAG],
      ['t', KEYWORD_STAKING_T_TAG],
      ['alt', enabled ? 'Keyword staking is on' : 'Keyword staking is off'],
    ],
  };
}

function readEnabled(event: NostrEvent): boolean | null {
  try {
    const parsed: unknown = JSON.parse(event.content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('enabled' in parsed)) return null;
    const enabled = parsed.enabled;
    return typeof enabled === 'boolean' ? enabled : null;
  } catch {
    return null;
  }
}

function isTrustedSwitch(event: NostrEvent, trusted: Set<string>): boolean {
  if (event.kind !== KEYWORD_STAKING_KIND) return false;
  if (!trusted.has(event.pubkey.toLowerCase())) return false;
  const d = event.tags.find(([name]) => name === 'd')?.[1];
  if (d !== KEYWORD_STAKING_D_TAG) return false;
  return readEnabled(event) !== null;
}

/**
 * Latest trusted switch wins. No trusted event, or only junk, stays on.
 */
export function resolveKeywordStakingEnabled(
  events: readonly NostrEvent[],
  trustedAuthors: readonly string[],
): boolean {
  const trusted = new Set(trustedAuthors.map((pubkey) => pubkey.toLowerCase()));
  let latest: NostrEvent | null = null;

  for (const event of events) {
    if (!isTrustedSwitch(event, trusted)) continue;
    if (
      !latest
      || event.created_at > latest.created_at
      || (event.created_at === latest.created_at && event.id < latest.id)
    ) {
      latest = event;
    }
  }

  if (!latest) return true;
  return readEnabled(latest) ?? true;
}
