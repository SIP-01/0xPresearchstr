import { describe, expect, it } from 'vitest';
import { keccak256, toBytes } from 'viem';

import { keywordIdOf, normalizeStakeKeyword, KeywordValidationError } from './keywordId';

describe('normalizeStakeKeyword', () => {
  it('lowercases and collapses to single-space letter/number tokens', () => {
    expect(normalizeStakeKeyword('  Monero   WALLET! ')).toBe('monero wallet');
  });

  it('applies NFKC + lowercase (matches PREcommunity normalizeAdKeyword)', () => {
    expect(normalizeStakeKeyword('ＢＴＣ')).toBe('btc');
  });

  it('rejects empty / punctuation-only input', () => {
    expect(() => normalizeStakeKeyword('   ')).toThrow(KeywordValidationError);
    expect(() => normalizeStakeKeyword('!!!')).toThrow(KeywordValidationError);
  });

  it('rejects more than 5 tokens', () => {
    expect(() => normalizeStakeKeyword('one two three four five six')).toThrow(KeywordValidationError);
  });
});

describe('keywordIdOf', () => {
  it('is keccak256 of the normalized keyword bytes', () => {
    const normalized = normalizeStakeKeyword('Bitcoin');
    expect(keywordIdOf('Bitcoin')).toBe(keccak256(toBytes(normalized)));
  });

  it('is case- and whitespace-insensitive', () => {
    expect(keywordIdOf('  Monero Wallet ')).toBe(keywordIdOf('monero wallet'));
  });
});
