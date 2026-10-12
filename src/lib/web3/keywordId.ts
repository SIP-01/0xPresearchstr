/**
 * Keyword → keywordId derivation for PREKeywordMarketV1.
 *
 * Mirrors PREcommunity/precommunity.org packages/shared/src/ads.ts exactly:
 * the on-chain keywordId is keccak256 of the UTF-8 bytes of the NORMALIZED
 * keyword. Normalization: NFKC → lowercase → letter/number tokens
 * (max 5) joined by single spaces, max 64 characters.
 *
 * Staking a keyword here lands on the same on-chain position as staking the
 * same phrase on precommunity.org.
 */
import { keccak256, toBytes } from 'viem';

export const STAKE_MAX_KEYWORD_TOKENS = 5;
export const STAKE_MAX_KEYWORD_CHARACTERS = 64;

export class KeywordValidationError extends Error {}

function characterCount(value: string): number {
  return Array.from(value).length;
}

/** Normalize a raw keyword into the canonical on-chain form. Throws on invalid input. */
export function normalizeStakeKeyword(value: string): string {
  const normalized = value.normalize('NFKC').toLowerCase();
  const tokens = Array.from(normalized.matchAll(/[\p{L}\p{N}]+/gu), (m) => m[0]);
  if (!tokens.length) {
    throw new KeywordValidationError('Keyword must contain a letter or number.');
  }
  if (tokens.length > STAKE_MAX_KEYWORD_TOKENS) {
    throw new KeywordValidationError(`Keyword must be at most ${STAKE_MAX_KEYWORD_TOKENS} words.`);
  }
  const keyword = tokens.join(' ');
  if (characterCount(keyword) > STAKE_MAX_KEYWORD_CHARACTERS) {
    throw new KeywordValidationError(
      `Keyword must be at most ${STAKE_MAX_KEYWORD_CHARACTERS} characters.`,
    );
  }
  return keyword;
}

/** On-chain keyword id: keccak256(bytes(normalizedKeyword)). Throws on invalid input. */
export function keywordIdOf(value: string): `0x${string}` {
  return keccak256(toBytes(normalizeStakeKeyword(value)));
}
