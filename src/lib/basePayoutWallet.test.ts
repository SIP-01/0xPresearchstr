import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import type { NostrEvent } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';
import { describe, expect, it } from 'vitest';

import {
  basePayoutTagsWithoutWallet,
  buildBasePayoutTags,
  checksumAddress,
  parseBasePayoutWallet,
  payoutProofMessage,
  profileContentWithBaseAddress,
  readProfileBaseAddress,
  recoverPayoutAddress,
} from '@/lib/basePayoutWallet';

const NOSTR_PUBKEY = '11'.repeat(32);

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function addressOf(secret: Uint8Array): string {
  const pub = secp256k1.getPublicKey(secret, false);
  return `0x${hex(keccak_256(pub.subarray(1))).slice(-40)}`;
}

function signProof(secret: Uint8Array, pubkey: string, address: string): string {
  const message = payoutProofMessage(nip19.npubEncode(pubkey), address);
  const body = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\u0019Ethereum Signed Message:\n${body.length}`);
  const digest = keccak_256(concat([prefix, body]));
  const noble = secp256k1.sign(digest, secret, { prehash: false, format: 'recovered', lowS: true });
  return `${hex(noble.subarray(1))}${((noble[0] ?? 0) + 27).toString(16).padStart(2, '0')}`;
}

function claim(pubkey: string, address: string, signature: string, extra: string[][] = []): NostrEvent {
  return {
    id: 'b'.repeat(64),
    pubkey,
    kind: 10011,
    created_at: 10,
    sig: 'c'.repeat(128),
    content: '',
    tags: buildBasePayoutTags(extra, address, signature),
  };
}

describe('Base payout wallet', () => {
  const secret = secp256k1.utils.randomSecretKey();
  const address = addressOf(secret);
  const signature = signProof(secret, NOSTR_PUBKEY, address);

  it('checksums a known mainnet address', () => {
    expect(checksumAddress('0xd8da6bf26964af9d7eed9e03e53415d37aa96045'))
      .toBe('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
  });

  it('accepts a wallet signature over this Nostr account and keeps other identities', () => {
    const event = claim(NOSTR_PUBKEY, address, signature, [['i', 'github:alice', 'gist']]);
    expect(parseBasePayoutWallet(event, NOSTR_PUBKEY)?.address).toBe(address);
    expect(event.tags.some((tag) => tag[1] === 'github:alice')).toBe(true);
    expect(recoverPayoutAddress(NOSTR_PUBKEY, address, signature)).toBe(address);
  });

  it('rejects a proof signed for a different account, address, or chain marker', () => {
    const event = claim(NOSTR_PUBKEY, address, signature);
    expect(parseBasePayoutWallet(event, '22'.repeat(32))).toBeNull();
    expect(recoverPayoutAddress(NOSTR_PUBKEY, `0x${'ab'.repeat(20)}`, signature)).toBeNull();
    expect(parseBasePayoutWallet({
      ...event,
      tags: [['i', `ethereum:8453:address:${address}`, signature, 'javascript:alert(1)']],
    }, NOSTR_PUBKEY)).toBeNull();
    expect(parseBasePayoutWallet({
      ...event,
      tags: [['i', 'ethereum:1:address:0xd8da6bf26964af9d7eed9e03e53415d37aa96045', signature, 'eip191']],
    }, NOSTR_PUBKEY)).toBeNull();
  });

  it('saves a Base address on the profile and leaves the rest of the metadata', () => {
    const content = profileContentWithBaseAddress(
      JSON.stringify({ name: 'alice', about: 'search' }),
      address.toUpperCase(),
    );
    expect(JSON.parse(content)).toMatchObject({ name: 'alice', about: 'search', base_address: address });
    expect(readProfileBaseAddress(content)).toBe(address);
    expect(readProfileBaseAddress(profileContentWithBaseAddress(content, null))).toBeNull();
    expect(readProfileBaseAddress(JSON.stringify({ base_address: 'javascript:alert(1)' }))).toBeNull();
  });

  it('removes only the Base payout tag', () => {
    const tags = buildBasePayoutTags([['i', 'github:alice', 'gist']], address, signature);
    expect(basePayoutTagsWithoutWallet(tags)).toEqual([['i', 'github:alice', 'gist']]);
  });
});
