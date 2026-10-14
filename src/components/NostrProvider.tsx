import React, { useEffect, useMemo, useState } from 'react';
import { type NostrSigner, NostrEvent, NostrFilter, NPool, NRelay1 } from '@nostrify/nostrify';
import { NostrContext } from '@nostrify/react';
import { NUser, useNostrLogin } from '@nostrify/react/login';
import { useQueryClient } from '@tanstack/react-query';
import { useAppContext } from '@/hooks/useAppContext';
import type { RelayMetadata } from '@/contexts/AppContext';
import { toSecureRelayUrl } from '@/lib/appRelays';

interface NostrProviderProps {
  children: React.ReactNode;
}

function createPoolSession(pubkey: string | undefined, initialMetadata: RelayMetadata) {
  let relayMetadata = initialMetadata;
  let signer: NostrSigner | undefined;
  let closed = false;
  const pool = new NPool({
    open(url: string) {
      if (closed) throw new Error('Nostr account session closed');
      // Chokepoint: EVERY pool connection flows through here (reads, writes,
      // NIP-46 bunker/nostrconnect dials). A ws:// URL on an HTTPS page
      // throws a synchronous SecurityError at WebSocket construction and
      // kills the whole operation — upgrade it to wss:// first.
      return new NRelay1(toSecureRelayUrl(url), {
        // NIP-42: Respond to relay AUTH challenges by signing a kind
        // 22242 ephemeral event with the current user's signer.
        auth: async (challenge: string) => {
          if (closed || !signer) {
            throw new Error('AUTH failed: no signer available (user not logged in)');
          }
          const event = await signer.signEvent({
            kind: 22242,
            content: '',
            tags: [
              ['relay', url],
              ['challenge', challenge],
            ],
            created_at: Math.floor(Date.now() / 1000),
          });
          if (closed) throw new Error('Nostr account session closed');
          return event;
        },
      });
    },
    reqRouter(filters: NostrFilter[]) {
      const routes = new Map<string, NostrFilter[]>();
      if (closed) return routes;

      // Route to all read relays (ws:// upgraded to wss:// on HTTPS pages —
      // a ws:// URL would throw at WebSocket construction and kill the query)
      const readRelays = relayMetadata.relays
        .filter(r => r.read)
        .map(r => toSecureRelayUrl(r.url));

      for (const url of readRelays) {
        routes.set(url, filters);
      }

      return routes;
    },
    eventRouter(_event: NostrEvent) {
      if (closed) throw new Error('Nostr account session closed');
      // Get write relays from metadata (same ws://→wss:// upgrade as reads)
      const writeRelays = relayMetadata.relays
        .filter(r => r.write)
        .map(r => toSecureRelayUrl(r.url));

      const allRelays = new Set<string>(writeRelays);

      return [...allRelays];
    },
    eoseTimeout: 200,
  });

  return {
    pubkey,
    pool,
    setSigner(value: NostrSigner | undefined) { signer = value; },
    setRelayMetadata(value: RelayMetadata) { relayMetadata = value; },
    close() {
      closed = true;
      signer = undefined;
      return pool.close();
    },
  };
}

const NostrProvider: React.FC<NostrProviderProps> = ({ children }) => {
  const { config, accountPubkey } = useAppContext();
  const { logins } = useNostrLogin();
  const queryClient = useQueryClient();
  const [session, setSession] = useState(() => createPoolSession(accountPubkey, config.relayMetadata));
  // Replace account connections without remounting forms or other UI state.
  if (session.pubkey !== accountPubkey) {
    setSession(createPoolSession(accountPubkey, config.relayMetadata));
  }
  const { pool } = session;

  useEffect(() => () => {
    void session.close().catch(() => undefined);
  }, [session]);

  // Derive the current signer from the active login. This mirrors the
  // logic in useCurrentUser but avoids a circular dependency (useCurrentUser
  // depends on NostrContext which we are providing here).
  const currentLogin = logins[0];
  const currentSigner = useMemo(() => {
    if (!currentLogin) return undefined;
    try {
      switch (currentLogin.type) {
        case 'nsec':
          return NUser.fromNsecLogin(currentLogin).signer;
        case 'bunker':
          return NUser.fromBunkerLogin(currentLogin, pool).signer;
        case 'extension':
          return NUser.fromExtensionLogin(currentLogin).signer;
        default:
          return undefined;
      }
    } catch {
      return undefined;
    }
  }, [currentLogin, pool]);

  // Each pool can authenticate only with the signer from its own account session.
  useEffect(() => {
    session.setSigner(currentSigner);
  }, [currentSigner, session]);

  // Invalidate Nostr queries when relay metadata changes.
  useEffect(() => {
    session.setRelayMetadata(config.relayMetadata);
    queryClient.invalidateQueries({ queryKey: ['nostr'] });
  }, [config.relayMetadata, queryClient, session]);

  const contextValue = useMemo(() => ({ nostr: pool }), [pool]);

  return (
    <NostrContext.Provider value={contextValue}>
      {children}
    </NostrContext.Provider>
  );
};

export default NostrProvider;
