/**
 * Platform keyword staking — the operator-owned PRE ads slot.
 *
 * PRE keyword-staking ads are a platform feature: on by default, not
 * removable in user Settings, and only owner/admin keys may flip them.
 * The flag is an addressable kind 30078 event in this engine's control
 * namespace. Readers filter by trusted authors (owner + admin list);
 * the d-tag alone is not a trust boundary.
 */
import type { NostrEvent } from '@nostrify/nostrify';

import { APP_PROFILE } from '@/lib/appProfile';

export const PLATFORM_KEYWORD_STAKING_KIND = 30078;
export const PLATFORM_KEYWORD_STAKING_D_TAG = APP_PROFILE.control.keywordStakingDTag;
export const PLATFORM_KEYWORD_STAKING_T_TAG = APP_PROFILE.control.platformTTag;

/** Default when no trusted event exists — platform ads stay on. */
export const DEFAULT_PRE_ADS_ENABLED = true;

export interface PlatformKeywordStaking {
  /** Whether PRE keyword-staking ads resolve and render. */
  preAds: boolean;
}

export function parsePlatformKeywordStaking(event: NostrEvent): PlatformKeywordStaking | null {
  if (event.kind !== PLATFORM_KEYWORD_STAKING_KIND) return null;
  const d = event.tags.find(([n]) => n === 'd')?.[1];
  if (d !== PLATFORM_KEYWORD_STAKING_D_TAG) return null;
  try {
    const parsed = JSON.parse(event.content) as unknown;
    if (!parsed || typeof parsed !== 'object' || !('preAds' in parsed)) return null;
    if (typeof (parsed as { preAds: unknown }).preAds !== 'boolean') return null;
    return { preAds: (parsed as { preAds: boolean }).preAds };
  } catch {
    return null;
  }
}

export function buildPlatformKeywordStakingEvent(settings: PlatformKeywordStaking): {
  kind: number;
  content: string;
  tags: string[][];
} {
  return {
    kind: PLATFORM_KEYWORD_STAKING_KIND,
    content: JSON.stringify({ preAds: settings.preAds }),
    tags: [
      ['d', PLATFORM_KEYWORD_STAKING_D_TAG],
      ['t', PLATFORM_KEYWORD_STAKING_T_TAG],
      ['alt', `Presearchstr keyword staking: PRE ads ${settings.preAds ? 'on' : 'off'}`],
    ],
  };
}
