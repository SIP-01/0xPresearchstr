import { sanitizePublicUrl } from './sanitizeUrl';

export const PRECOMMUNITY_MARKET_URL = 'https://precommunity.org/keyword-market';
export const PRECOMMUNITY_RESOLVE_URL = 'https://precommunity.org/api/v1/keyword-market/resolve';
/** Public on-chain keyword ledger. No API key. CORS allows browser reads. */
export const PRECOMMUNITY_KEYWORD_URL = 'https://precommunity.org/api/v1/keyword-market/keywords/';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const TX_RE = /^0x[0-9a-fA-F]{64}$/;
const DIGITS_RE = /^\d{1,78}$/;

/** Winning on-chain PRE keyword stake with an eligible ad. */
export interface PublicKeywordStake {
  keyword: string;
  chainId: number;
  contractAddress: string;
  synced: boolean;
  rank: number;
  /** Human PRE amount, trailing zeros removed. */
  stakePre: string;
  /** USD per click, like `$0.01`. */
  bidUsd: string;
  stakerAddress: string;
  /** Basescan transaction URL on Base. Empty on any other chain. */
  txUrl: string;
}

/**
 * PRE uses 18 decimals. The keyword market rounds half-up at 14 digits,
 * then shows 4 decimal places.
 */
export function formatPreAmount(raw: string): string {
  const value = BigInt(raw);
  const unit = 10n ** 14n;
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const rounded = (magnitude + unit / 2n) / unit;
  const whole = rounded / 10000n;
  const fraction = (rounded % 10000n).toString().padStart(4, '0').replace(/0+$/, '');
  const body = fraction ? `${whole.toString()}.${fraction}` : whole.toString();
  return negative ? `-${body}` : body;
}

/** `bidUsdRaw` is USD with 6 decimal places. */
export function formatBidUsd(raw: string): string {
  const value = BigInt(raw);
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `$${whole.toString()}.${fraction}` : `$${whole.toString()}`;
}

function hasControlChar(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export function shortStakeAddress(address: string): string {
  return ADDRESS_RE.test(address) ? shortAddress(address) : '';
}

/** Parse the public keyword ledger. Positions without an eligible ad are ignored. */
export function parsePublicKeyword(value: unknown): PublicKeywordStake | null {
  if (!value || typeof value !== 'object') return null;
  if (!('keyword' in value) || !('positions' in value) || !('chainId' in value) || !('contractAddress' in value)) {
    return null;
  }
  const keyword = typeof value.keyword === 'string' ? value.keyword.trim() : '';
  if (!keyword || keyword.length > 80 || hasControlChar(keyword)) return null;
  if (typeof value.chainId !== 'number' || !Number.isInteger(value.chainId) || value.chainId <= 0) return null;
  if (typeof value.contractAddress !== 'string' || !ADDRESS_RE.test(value.contractAddress)) return null;
  if (!Array.isArray(value.positions)) return null;

  let winner: {
    rank: number;
    stakeRaw: string;
    bidUsdRaw: string;
    stakerAddress: string;
    txHash: string;
  } | null = null;

  for (const position of value.positions) {
    if (!position || typeof position !== 'object') continue;
    if (!('eligible' in position) || position.eligible !== true) continue;
    if (!('hasEligibleAd' in position) || position.hasEligibleAd !== true) continue;
    if (!('rank' in position) || typeof position.rank !== 'number' || !Number.isInteger(position.rank) || position.rank < 1) continue;
    if (!('stakeRaw' in position) || typeof position.stakeRaw !== 'string' || !DIGITS_RE.test(position.stakeRaw)) continue;
    if (!('bidUsdRaw' in position) || typeof position.bidUsdRaw !== 'string' || !DIGITS_RE.test(position.bidUsdRaw)) continue;
    if (!('stakerAddress' in position) || typeof position.stakerAddress !== 'string' || !ADDRESS_RE.test(position.stakerAddress)) continue;
    if (!('positionTxHash' in position) || typeof position.positionTxHash !== 'string' || !TX_RE.test(position.positionTxHash)) continue;
    if (!winner || position.rank < winner.rank) {
      winner = {
        rank: position.rank,
        stakeRaw: position.stakeRaw,
        bidUsdRaw: position.bidUsdRaw,
        stakerAddress: position.stakerAddress,
        txHash: position.positionTxHash,
      };
    }
  }
  if (!winner) return null;

  return {
    keyword,
    chainId: value.chainId,
    contractAddress: value.contractAddress,
    synced: 'chainStatus' in value && value.chainStatus === 'SYNCED',
    rank: winner.rank,
    stakePre: formatPreAmount(winner.stakeRaw),
    bidUsd: formatBidUsd(winner.bidUsdRaw),
    stakerAddress: winner.stakerAddress,
    txUrl: value.chainId === 8453 ? `https://basescan.org/tx/${winner.txHash}` : '',
  };
}

export interface PrecommunityAd {
  headline: string;
  description: string;
  url: string;
  clickUrl: string;
  reportUrl: string;
}

export interface PrecommunityResponse {
  ad: PrecommunityAd | null;
}

/** Whitelist the delivery fields at both the server and browser boundaries. */
export function parsePrecommunityResponse(value: unknown): PrecommunityResponse | undefined {
  if (!value || typeof value !== 'object' || !('ad' in value)) return undefined;
  const { ad } = value;
  if (ad === null) return { ad: null };
  if (!ad || typeof ad !== 'object') return undefined;
  if (
    !('headline' in ad) || typeof ad.headline !== 'string' || !ad.headline.trim()
    || !('description' in ad) || typeof ad.description !== 'string'
    || !('url' in ad) || typeof ad.url !== 'string'
    || !('clickUrl' in ad) || typeof ad.clickUrl !== 'string'
    || !('reportUrl' in ad) || typeof ad.reportUrl !== 'string'
  ) return undefined;

  const url = sanitizePublicUrl(ad.url);
  const clickUrl = sanitizePublicUrl(ad.clickUrl);
  const reportUrl = sanitizePublicUrl(ad.reportUrl);
  if (!url || !clickUrl || !reportUrl) return undefined;

  const destination = new URL(url);
  const click = new URL(clickUrl);
  const report = new URL(reportUrl);
  if (
    destination.username || destination.password
    || click.username || click.password || click.origin !== 'https://precommunity.org'
    || report.username || report.password || report.origin !== 'https://precommunity.org'
  ) return undefined;

  return {
    ad: { headline: ad.headline, description: ad.description, url, clickUrl, reportUrl },
  };
}
