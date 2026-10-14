import { useState } from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { finalizeEvent, generateSecretKey, nip19, getPublicKey } from 'nostr-tools';
import { useNostr } from '@nostrify/react';
import { useNostrLogin } from '@nostrify/react/login';

import { TestApp } from '@/test/TestApp';
import { useLoginActions } from './useLoginActions';
import { useAppContext } from './useAppContext';

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Regression test: adding a second login while one is already logged in
 * must switch the current user to the new login (logins[0]). Without the
 * fix, addLogin appends the new login to the end of the array and
 * logins[0] remains the previously-logged-in user — leading to the
 * destructive bug where the signup profile step signs kind 0 metadata
 * with the *original* user's signer, overwriting their profile.
 */
describe('useLoginActions auto-switch', () => {
  it('promotes the newly added nsec login to logins[0]', async () => {
    const sk1 = generateSecretKey();
    const nsec1 = nip19.nsecEncode(sk1);
    const sk2 = generateSecretKey();
    const nsec2 = nip19.nsecEncode(sk2);
    const pubkey2 = getPublicKey(sk2);

    const { result } = renderHook(
      () => {
        const [step, setStep] = useState('secure');
        return {
          actions: useLoginActions(),
          login: useNostrLogin(),
          app: useAppContext(),
          nostr: useNostr().nostr,
          step,
          setStep,
        };
      },
      { wrapper: TestApp },
    );

    // NostrLoginProvider renders null while it reads logins from storage,
    // so wait for the provider to mount.
    await waitFor(() => expect(result.current).not.toBeNull());

    const anonymousPool = result.current.nostr;
    const closeAnonymousPool = vi.spyOn(anonymousPool, 'close');

    act(() => {
      result.current.actions.nsec(nsec1);
      result.current.setStep('profile');
    });

    expect(result.current.login.logins).toHaveLength(1);
    expect(result.current.step).toBe('profile');
    expect(result.current.nostr).not.toBe(anonymousPool);
    expect(closeAnonymousPool).toHaveBeenCalledOnce();
    const firstLogin = result.current.login.logins[0];
    const firstPool = result.current.nostr;
    const closeFirstPool = vi.spyOn(firstPool, 'close');
    act(() => result.current.app.updateConfig(() => ({
      relayMetadata: { relays: [{ url: 'wss://account-a.example', read: true, write: true }], updatedAt: 200 },
      blossomServerMetadata: { servers: ['https://account-a.example'], updatedAt: 200 },
      useAppBlossomServers: false,
    })));

    act(() => {
      result.current.actions.nsec(nsec2);
    });

    expect(result.current.login.logins).toHaveLength(2);
    // The newly added login MUST be at index 0 (current user).
    expect(result.current.login.logins[0].pubkey).toBe(pubkey2);
    expect(result.current.app.config.relayMetadata.relays[0].url).toBe('wss://relay.primal.net');
    expect(result.current.app.config.blossomServerMetadata.servers).toEqual(['https://blossom.primal.net/']);
    expect(result.current.app.config.useAppBlossomServers).toBe(true);
    expect(result.current.step).toBe('profile');
    expect(result.current.nostr).not.toBe(firstPool);
    expect(closeFirstPool).toHaveBeenCalledOnce();
    expect(() => firstPool.relay('wss://late-account-a.example')).toThrow('Nostr account session closed');
    await expect(firstPool.query([{ kinds: [1], limit: 1 }])).resolves.toEqual([]);
    await expect(firstPool.event(finalizeEvent({ kind: 1, content: 'test', tags: [], created_at: 0 }, sk1)))
      .rejects.toThrow('Nostr account session closed');

    act(() => result.current.app.updateConfig(() => ({
      relayMetadata: { relays: [{ url: 'wss://account-b.example', read: true, write: true }], updatedAt: 100 },
      blossomServerMetadata: { servers: ['https://account-b.example'], updatedAt: 100 },
    })));
    act(() => result.current.app.updateAccountConfig(firstLogin.pubkey, () => ({
      blossomServerMetadata: { servers: ['https://late-account-a.example'], updatedAt: 300 },
    })));
    expect(result.current.app.config.blossomServerMetadata.servers).toEqual(['https://account-b.example']);

    const secondLogin = result.current.login.logins[0];
    act(() => result.current.login.setLogin(firstLogin.id));
    expect(result.current.app.config.relayMetadata.relays[0].url).toBe('wss://account-a.example');
    expect(result.current.app.config.blossomServerMetadata.servers).toEqual(['https://late-account-a.example']);
    expect(result.current.app.config.useAppBlossomServers).toBe(false);
    act(() => result.current.login.setLogin(secondLogin.id));
    expect(result.current.app.config.relayMetadata.relays[0].url).toBe('wss://account-b.example');
    expect(result.current.app.config.blossomServerMetadata.updatedAt).toBe(100);
  });
});
