/**
 * Base payout address linked to a Nostr account.
 *
 * NIP-39 kind 10011 is the external-identity claim. The Base address is one
 * `i` tag. The proof is an EIP-191 personal_sign signature over the NIP-39
 * verification text plus the address and chain, so a pasted address is not
 * enough to redirect a payout.
 *
 * The Nostr key is never reused as an Ethereum key. The nsec stays in the
 * Nostr signer. The Base key stays in the wallet.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import type { NostrEvent } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';

export const BASE_PAYOUT_KIND = 10011;
export const BASE_CHAIN_ID = 8453;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SIGNATURE_RE = /^(?:0x)?[0-9a-fA-F]{130}$/;
const PUBKEY_RE = /^[0-9a-f]{64}$/;
const IDENTITY_PREFIX = `ethereum:${BASE_CHAIN_ID}:address:`;

export interface BasePayoutWallet {
  address: string;
  signature: string;
  chainId: typeof BASE_CHAIN_ID;
  /** True when an EIP-191 proof recovers to this address. */
  verified: boolean;
}

/** Kind 0 profile field for the Base payout address. */
export const PROFILE_BASE_ADDRESS_KEY = 'base_address';

interface RecoveredPoint {
  toBytes(compressed?: boolean): Uint8Array;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function normalizeAddress(value: string): string | null {
  const trimmed = value.trim();
  const address = trimmed.slice(0, 2).toLowerCase() === '0x' ? `0x${trimmed.slice(2)}` : trimmed;
  if (!ADDRESS_RE.test(address)) return null;
  const lowercase = address.toLowerCase();
  if (lowercase === `0x${'0'.repeat(40)}`) return null;
  return lowercase;
}

export function checksumAddress(address: string): string {
  const normalized = normalizeAddress(address);
  if (!normalized) return '';
  const body = normalized.slice(2);
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(body)));
  let checksummed = '0x';
  for (let index = 0; index < body.length; index += 1) {
    const nibble = Number.parseInt(hash[index] ?? '0', 16);
    checksummed += nibble >= 8 ? body[index].toUpperCase() : body[index];
  }
  return checksummed;
}

export function shortPayoutAddress(address: string): string {
  const normalized = normalizeAddress(address);
  if (!normalized) return '';
  return `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
}

/** Explorer URL built only from a validated address. */
export function baseAddressUrl(address: string): string | null {
  const normalized = normalizeAddress(address);
  return normalized ? `https://basescan.org/address/${normalized}` : null;
}

export function payoutProofMessage(npub: string, address: string): string {
  return [
    `Verifying that I control the following Nostr public key: ${npub}`,
    `Base payout address: ${address}`,
    `Chain ID: ${BASE_CHAIN_ID}`,
  ].join('\n');
}

function personalDigest(message: string): Uint8Array {
  const body = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\u0019Ethereum Signed Message:\n${body.length}`);
  return keccak_256(concatBytes([prefix, body]));
}

function addressFromPublicKey(uncompressed: Uint8Array): string | null {
  if (uncompressed.length !== 65 || uncompressed[0] !== 0x04) return null;
  const hash = keccak_256(uncompressed.subarray(1));
  return `0x${bytesToHex(hash).slice(-40)}`;
}

/** Recover the Base address that signed the canonical payout message. */
export function recoverPayoutAddress(pubkey: string, address: string, signature: string): string | null {
  const normalized = normalizeAddress(address);
  if (!normalized || !PUBKEY_RE.test(pubkey) || !SIGNATURE_RE.test(signature)) return null;
  const raw = signature.toLowerCase().replace(/^0x/, '');
  const bytes = hexToBytes(raw);
  if (!bytes || bytes.length !== 65) return null;
  let recovery = bytes[64] ?? 0;
  if (recovery >= 27) recovery -= 27;
  if (recovery !== 0 && recovery !== 1) return null;

  let npub: string;
  try {
    npub = nip19.npubEncode(pubkey);
  } catch {
    return null;
  }

  try {
    const digest = personalDigest(payoutProofMessage(npub, normalized));
    const noble = concatBytes([Uint8Array.of(recovery), bytes.subarray(0, 64)]);
    const point = secp256k1.Signature.fromBytes(noble, 'recovered').recoverPublicKey(digest) as RecoveredPoint;
    const recovered = addressFromPublicKey(point.toBytes(false));
    return recovered === normalized ? recovered : null;
  } catch {
    return null;
  }
}

function isBasePayoutIdentity(value: string): boolean {
  return value.startsWith(IDENTITY_PREFIX);
}

export function basePayoutIdentity(address: string): string {
  return `${IDENTITY_PREFIX}${normalizeAddress(address) ?? ''}`;
}

export function buildBasePayoutTags(
  existing: readonly (readonly string[])[],
  address: string,
  signature: string,
): string[][] {
  const normalized = normalizeAddress(address);
  const proof = signature.toLowerCase().replace(/^0x/, '');
  if (!normalized || !SIGNATURE_RE.test(proof)) return existing.map((tag) => [...tag]);
  const kept = existing
    .filter((tag) => tag[0] !== 'i' || !isBasePayoutIdentity(tag[1] ?? ''))
    .map((tag) => [...tag]);
  return [...kept, ['i', `${IDENTITY_PREFIX}${normalized}`, proof, 'eip191']];
}

export function basePayoutTagsWithoutWallet(existing: readonly (readonly string[])[]): string[][] {
  return existing
    .filter((tag) => tag[0] !== 'i' || !isBasePayoutIdentity(tag[1] ?? ''))
    .map((tag) => [...tag]);
}

export function latestReplaceable(events: readonly NostrEvent[]): NostrEvent | undefined {
  return events.reduce<NostrEvent | undefined>((best, event) => {
    if (!best) return event;
    if (event.created_at !== best.created_at) return event.created_at > best.created_at ? event : best;
    return event.id < best.id ? event : best;
  }, undefined);
}

/** Accept the claim only when the event author matches and the wallet signature recovers. */
export function parseBasePayoutWallet(event: NostrEvent | undefined, pubkey: string): BasePayoutWallet | null {
  if (!event || event.kind !== BASE_PAYOUT_KIND || event.pubkey !== pubkey || !PUBKEY_RE.test(pubkey)) return null;
  for (const tag of event.tags) {
    if (tag[0] !== 'i' || tag[3] !== 'eip191') continue;
    const identity = tag[1] ?? '';
    if (!identity.startsWith(IDENTITY_PREFIX)) continue;
    const address = normalizeAddress(identity.slice(IDENTITY_PREFIX.length));
    const signature = (tag[2] ?? '').toLowerCase();
    if (!address || recoverPayoutAddress(pubkey, address, signature) !== address) continue;
    return { address, signature: signature.replace(/^0x/, ''), chainId: BASE_CHAIN_ID, verified: true };
  }
  return null;
}

function profileRecord(content: string | undefined): Record<string, unknown> {
  if (!content) return {};
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...(parsed as Record<string, unknown>) };
    }
  } catch {
    return {};
  }
  return {};
}

/** Read the Base address stored on a kind 0 profile. */
export function readProfileBaseAddress(content: string | undefined): string | null {
  const raw = profileRecord(content)[PROFILE_BASE_ADDRESS_KEY];
  return typeof raw === 'string' ? normalizeAddress(raw) : null;
}

/** Merge a Base address into kind 0 content without dropping the rest of the profile. */
export function profileContentWithBaseAddress(content: string, address: string | null): string {
  const meta = profileRecord(content);
  const normalized = address ? normalizeAddress(address) : null;
  if (normalized) meta[PROFILE_BASE_ADDRESS_KEY] = normalized;
  else delete meta[PROFILE_BASE_ADDRESS_KEY];
  return JSON.stringify(meta);
}

export function profilePayoutWallet(address: string): BasePayoutWallet | null {
  const normalized = normalizeAddress(address);
  if (!normalized) return null;
  return { address: normalized, signature: '', chainId: BASE_CHAIN_ID, verified: false };
}
