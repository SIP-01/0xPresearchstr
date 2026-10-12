/**
 * On-chain constants for the PRE keyword market integration.
 *
 * Contract: PREKeywordMarketV1 on Base mainnet (chainId 8453).
 * Source of truth: PREcommunity/precommunity.org
 *   - packages/shared/abi/PREKeywordMarketV1.json (artifact ABI)
 *   - packages/shared/src/ads.ts (keyword normalization + keywordId)
 *
 * All values here are public on-chain data — no secrets, no env vars.
 */
import { base } from 'wagmi/chains';

/** The only chain the keyword market lives on. */
export const KEYWORD_MARKET_CHAIN = base;
export const KEYWORD_MARKET_CHAIN_ID = base.id; // 8453

/** PREKeywordMarketV1 deployment on Base mainnet. */
export const KEYWORD_MARKET_ADDRESS = '0xf1176055f53cbd47c7c76515b14315252f57077e' as const;

/**
 * The PRE ERC20 token address is NOT hardcoded here: it is read at runtime
 * from the market contract's `PRE()` view, so this app always approves the
 * exact token the deployed contract pulls (Base mainnet PRE).
 */

/** PRE is an 18-decimal ERC20 (matches PREcommunity PRE_DECIMALS). */
export const PRE_DECIMALS = 18;

/**
 * `bidUsd` on the contract is a per-click USD bid with 6 decimals
 * (matches PREcommunity's parseUnits(bid, 6) / formatUnits(raw, 6)).
 */
export const USD_BID_DECIMALS = 6;

/** Public Base RPC for read calls and wallet fallback. */
export const BASE_MAINNET_RPC_URL = 'https://mainnet.base.org';

/** BaseScan transaction link. */
export function basescanTxUrl(hash: string): string {
  return `https://basescan.org/tx/${hash}`;
}

/** BaseScan address link. */
export function basescanAddressUrl(address: string): string {
  return `https://basescan.org/address/${address}`;
}

/** Fallback link for users without a wallet (managed staking UI). */
export const PRECOMMUNITY_KEYWORD_MARKET_URL = 'https://precommunity.org/keyword-market';
