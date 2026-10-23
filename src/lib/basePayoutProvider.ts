/**
 * Browser wallet discovery. The page asks an injected EIP-1193 provider to
 * sign the payout proof. It never sees the Base private key.
 */
import {
  BASE_CHAIN_ID,
  checksumAddress,
  normalizeAddress,
  payoutProofMessage,
  recoverPayoutAddress,
} from '@/lib/basePayoutWallet';
import { nip19 } from 'nostr-tools';

export interface Eip1193Provider {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
}

export interface DiscoveredWallet {
  name: string;
  provider: Eip1193Provider;
}

interface Eip6963Detail {
  info?: { uuid?: string; name?: string; rdns?: string };
  provider?: Eip1193Provider;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider & { providers?: Eip1193Provider[] };
  }
}

const BASE_CHAIN_HEX = `0x${BASE_CHAIN_ID.toString(16)}`;

function walletName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  let cleaned = '';
  for (const char of value.trim()) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) continue;
    cleaned += char;
  }
  return cleaned.slice(0, 40) || fallback;
}

function isUserRejected(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 4001;
}

function hexMessage(message: string): string {
  const bytes = new TextEncoder().encode(message);
  let hex = '0x';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

async function ensureBaseChain(provider: Eip1193Provider): Promise<void> {
  try {
    await walletRequest(provider, 'wallet_switchEthereumChain', [{ chainId: BASE_CHAIN_HEX }]);
  } catch (error) {
    if (error instanceof Error && error.message === 'The wallet request was dismissed.') throw error;
    try {
      await walletRequest(provider, 'wallet_addEthereumChain', [{
          chainId: BASE_CHAIN_HEX,
          chainName: 'Base',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: ['https://mainnet.base.org'],
          blockExplorerUrls: ['https://basescan.org'],
        }],
      );
    } catch (addError) {
      if (addError instanceof Error && addError.message === 'The wallet request was dismissed.') throw addError;
    }
  }
}

function readableWalletError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }
  return '';
}

async function walletRequest(provider: Eip1193Provider, method: string, params?: readonly unknown[]): Promise<unknown> {
  try {
    return await provider.request(params ? { method, params } : { method });
  } catch (error) {
    if (isUserRejected(error)) throw new Error('The wallet request was dismissed.', { cause: error });
    const message = readableWalletError(error);
    throw new Error(message || 'The wallet could not return a Base address.', { cause: error });
  }
}

function firstAddress(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    if (typeof item === 'string') {
      const address = normalizeAddress(item);
      if (address) return address;
    }
  }
  return null;
}

export function discoverWallets(): Promise<DiscoveredWallet[]> {
  if (typeof window === 'undefined') return Promise.resolve([]);
  return new Promise((resolve) => {
    const found = new Map<string, DiscoveredWallet>();
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<Eip6963Detail>).detail;
      if (!detail?.provider || typeof detail.provider.request !== 'function') return;
      const name = walletName(detail.info?.name, 'Wallet');
      const key = detail.info?.uuid || detail.info?.rdns || name;
      if (!found.has(key)) found.set(key, { name, provider: detail.provider });
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    window.setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      const announced = [...found.values()];
      if (announced.length > 0) {
        resolve(announced);
        return;
      }
      const injected = window.ethereum;
      if (!injected || typeof injected.request !== 'function') {
        resolve([]);
        return;
      }
      const providers = injected.providers?.filter((provider) => typeof provider.request === 'function') ?? [];
      const list = providers.length > 0 ? providers : [injected];
      resolve(list.map((provider, index) => ({
        name: list.length > 1 ? `Wallet ${index + 1}` : 'Browser wallet',
        provider,
      })));
    }, 200);
  });
}

/**
 * Ask the wallet to switch to Base and sign the NIP-39 proof.
 * Returns only after the signature recovers to the selected address.
 */
export async function requestBasePayoutProof(
  provider: Eip1193Provider,
  nostrPubkey: string,
): Promise<{ address: string; signature: string }> {
  const requested = firstAddress(await walletRequest(provider, 'eth_requestAccounts'));
  if (!requested) throw new Error('The wallet did not return a Base address.');
  await ensureBaseChain(provider);
  const selected = firstAddress(await walletRequest(provider, 'eth_accounts')) ?? requested;
  let npub: string;
  try {
    npub = nip19.npubEncode(nostrPubkey);
  } catch (error) {
    throw new Error('This Nostr account cannot be linked.', { cause: error });
  }
  const message = payoutProofMessage(npub, selected);
  const signed = await walletRequest(provider, 'personal_sign', [hexMessage(message), checksumAddress(selected)]);
  if (typeof signed !== 'string') throw new Error('The wallet did not return a signature.');
  const signature = signed.toLowerCase().replace(/^0x/, '');
  if (recoverPayoutAddress(nostrPubkey, selected, signature) !== selected) {
    throw new Error('That signature does not match this Base address.');
  }
  return { address: selected, signature };
}
