import { createContext } from "react";

export type Theme = "dark" | "light" | "hacker";

export interface RelayMetadata {
  /** List of relays with read/write permissions */
  relays: { url: string; read: boolean; write: boolean }[];
  /** Unix timestamp of when the relay list was last updated */
  updatedAt: number;
}

/** Blossom server list metadata (BUD-03 / kind 10063), mirroring RelayMetadata for parity. */
export interface BlossomServerMetadata {
  /** Ordered list of Blossom server URLs (most trusted/reliable first per BUD-03). */
  servers: string[];
  /** Unix timestamp of when the server list was last updated (from kind 10063 created_at). */
  updatedAt: number;
}

export type AccountConfig = Pick<AppConfig, 'relayMetadata' | 'blossomServerMetadata' | 'useAppBlossomServers'>;

export interface AppConfig {
  /** Current theme */
  theme: Theme;
  /** NIP-65 relay list metadata */
  relayMetadata: RelayMetadata;
  /** User's kind 10063 Blossom server list. */
  blossomServerMetadata: BlossomServerMetadata;
  /**
   * When true, the app's default Blossom servers are merged with the user's
   * servers (app servers first, deduped). When false, only the user's servers
   * are used.
   */
  useAppBlossomServers: boolean;
  /**
   * Privacy Mode — organic search uses Nostr-tier providers and AI stays off.
   * PRE community advertising is an exception: eligible Web/All text queries
   * still go through the backend to PRE community.
   */
  privacyMode: boolean;
  /**
   * Automatic indexing — when true, useful web results discovered during
   * searches are anonymously contributed to the shared Nostr index as
   * kind 39697 document observations, signed by this device's dedicated
   * indexing identity (never the personal Nostr identity, never the query).
   */
  autoIndex: boolean;
  /**
   * Search tab customization — fully modular: which tabs are visible, in
   * what order, and which one a fresh visit starts on.
   */
  tabConfig: TabConfig;
  /**
   * Vote identity — when false (default), 👍/👎 votes are anonymous: signed
   * by this device's built-in SIP-01 indexing identity. When true, votes are
   * signed with the logged-in Nostr key (attributable, like keyword stakes).
   */
  voteWithIdentity: boolean;
  /**
   * Nostr / npub keyword staking — off by default. When true, exact-match
   * community stakes signed by npubs are placed above organic results and
   * the "Stake this keyword" dialog is offered. Platform PRE keyword-staking
   * ads are a separate admin-gated slot and are not controlled here.
   */
  npubKeywordStaking: boolean;
  /** Search engines (provider ids) the user has turned off in Settings. */
  disabledProviders: string[];
  /**
   * Result language filter — ISO 639-1 codes, lowercase, in priority order.
   * Empty = off (any language). Engines that support it get the filter as a
   * request parameter (SearXNG `language`, Brave `search_lang`); SIP-01
   * index observations are filtered by their `l` tag (unknown-language
   * pages pass through); the SearXNG instance pool prefers instances that
   * have proven they serve these languages.
   */
  languageFilter: string[];
}

export interface TabConfig {
  /** All tabs in display order (visible + hidden). */
  order: string[];
  /** Tab ids currently hidden from the tab bar (e.g. tor/i2p by default). */
  hidden: string[];
  /** Tab a fresh visit starts on (when no ?source= URL param). */
  defaultTab: string;
}

export interface AppContextType {
  /** Current application configuration */
  config: AppConfig;
  /** Update configuration using a callback that receives current config and returns new config */
  updateConfig: (updater: (currentConfig: Partial<AppConfig>) => Partial<AppConfig>) => void;
  /** Account whose destinations are currently exposed in config. */
  accountPubkey: string | undefined;
  /** Store an asynchronous sync result for the account that requested it. */
  updateAccountConfig: (pubkey: string, updater: (current: Partial<AccountConfig>) => Partial<AccountConfig>) => void;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);
