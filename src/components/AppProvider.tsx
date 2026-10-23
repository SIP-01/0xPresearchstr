import { type ReactNode, useCallback, useEffect } from 'react';
import { z } from 'zod';
import { useNostrLogin } from '@nostrify/react/login';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AppContext, type AccountConfig, type AppConfig, type AppContextType, type Theme, type RelayMetadata, type BlossomServerMetadata } from '@/contexts/AppContext';
import { getBraveApiKey } from '@/lib/providers/brave';
import { getParallelApiKey } from '@/lib/providers/parallel';
import { getEngineSearchStatus } from '@/lib/engineSearch';

interface AppProviderProps {
  children: ReactNode;
  /** Application storage key */
  storageKey: string;
  /** Default app configuration */
  defaultConfig: AppConfig;
}

// Zod schema for RelayMetadata validation
const RelayMetadataSchema = z.object({
  relays: z.array(z.object({
    url: z.url(),
    read: z.boolean(),
    write: z.boolean(),
  })),
  updatedAt: z.number(),
}) satisfies z.ZodType<RelayMetadata>;

// Zod schema for BlossomServerMetadata validation
const BlossomServerMetadataSchema = z.object({
  servers: z.array(z.url()),
  updatedAt: z.number(),
}) satisfies z.ZodType<BlossomServerMetadata>;

// Zod schema for TabConfig validation
const TabConfigSchema = z.object({
  order: z.array(z.string()),
  hidden: z.array(z.string()),
  defaultTab: z.string(),
});

// Zod schema for AppConfig validation
const AppConfigSchema = z.object({
  theme: z.enum(['dark', 'light', 'hacker']),
  relayMetadata: RelayMetadataSchema,
  blossomServerMetadata: BlossomServerMetadataSchema,
  useAppBlossomServers: z.boolean(),
  privacyMode: z.boolean(),
  autoIndex: z.boolean(),
  tabConfig: TabConfigSchema,
  voteWithIdentity: z.boolean(),
  npubKeywordStaking: z.boolean(),
  disabledProviders: z.array(z.string()),
  // Tolerant: normalize + drop invalid codes from stored configs rather
  // than rejecting the whole blob over one bad entry.
  languageFilter: z.array(z.string()).transform((arr) =>
    arr
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^[a-z]{2}$/.test(s)),
  ),
}) satisfies z.ZodType<AppConfig>;

const StoredConfigSchema = AppConfigSchema.partial().extend({
  accountConfigs: z.record(z.string().regex(/^[0-9a-f]{64}$/), AppConfigSchema.pick({
    relayMetadata: true,
    blossomServerMetadata: true,
    useAppBlossomServers: true,
  }).partial()).optional(),
});

type StoredConfig = Partial<AppConfig> & {
  accountConfigs?: Record<string, Partial<AccountConfig>>;
};

function deserializeConfig(value: string): StoredConfig {
  const parsed: unknown = JSON.parse(value);
  if (parsed && typeof parsed === 'object' && 'theme' in parsed
    && (parsed.theme === 'presearch' || parsed.theme === 'system')) {
    parsed.theme = 'dark';
  }
  return StoredConfigSchema.parse(parsed);
}

function configForAccount(stored: StoredConfig, pubkey: string | undefined): Partial<AppConfig> {
  const { accountConfigs, ...global } = stored;
  if (!pubkey) return global;
  // Legacy destinations have no reliable account owner; keep them for logged-out use.
  const { relayMetadata: _relays, blossomServerMetadata: _servers, useAppBlossomServers: _appServers, ...shared } = global;
  return { ...shared, ...accountConfigs?.[pubkey] };
}

export function AppProvider(props: AppProviderProps) {
  const {
    children,
    storageKey,
    defaultConfig,
  } = props;
  const { logins } = useNostrLogin();
  const accountPubkey = logins[0]?.pubkey;

  // App configuration state with localStorage persistence
  const [rawConfig, setConfig, hasStorageError] = useLocalStorage<StoredConfig>(
    storageKey,
    {},
    {
      serialize: JSON.stringify,
      deserialize: deserializeConfig,
    }
  );

  // Generic config updater with callback pattern.
  // The updater returns the fields to change — they are MERGED into the
  // current stored config (never replace it), so callers can't wipe
  // unrelated settings by omitting them from the returned object.
  const updateConfig = useCallback((updater: (currentConfig: Partial<AppConfig>) => Partial<AppConfig>) => {
    setConfig((current) => {
      const patch = updater(configForAccount(current, accountPubkey));
      if (!accountPubkey) return { ...current, ...patch };
      const { relayMetadata, blossomServerMetadata, useAppBlossomServers, ...shared } = patch;
      const accountPatch = {
        ...(relayMetadata ? { relayMetadata } : {}),
        ...(blossomServerMetadata ? { blossomServerMetadata } : {}),
        ...(useAppBlossomServers !== undefined ? { useAppBlossomServers } : {}),
      };
      return {
        ...current,
        ...shared,
        accountConfigs: {
          ...current.accountConfigs,
          [accountPubkey]: { ...current.accountConfigs?.[accountPubkey], ...accountPatch },
        },
      };
    });
  }, [accountPubkey, setConfig]);

  const updateAccountConfig = useCallback((pubkey: string, updater: (current: Partial<AccountConfig>) => Partial<AccountConfig>) => {
    setConfig((current) => {
      const account = current.accountConfigs?.[pubkey] ?? {};
      return {
        ...current,
        accountConfigs: { ...current.accountConfigs, [pubkey]: { ...account, ...updater(account) } },
      };
    });
  }, [setConfig]);

  const config = { ...defaultConfig, ...configForAccount(rawConfig, accountPubkey) };

  // Migration: Brave and Parallel are off by default, but a stored API key is
  // an explicit past opt-in. Users who never touched the engine list get the
  // keyed engines re-enabled automatically; an explicitly stored list wins.
  if (rawConfig.disabledProviders === undefined) {
    if (config.disabledProviders.includes('brave') && getBraveApiKey()) {
      config.disabledProviders = config.disabledProviders.filter((id) => id !== 'brave');
    }
    if (config.disabledProviders.includes('parallel') && getParallelApiKey()) {
      config.disabledProviders = config.disabledProviders.filter((id) => id !== 'parallel');
    }
  }

  // Engine-provided search keys (worker /api/search/*): when the DEPLOYMENT
  // offers an engine (server-side key) and the user never customized the
  // engine list, un-park it so everyone gets it without BYOK setup.
  const userCustomizedEngines = rawConfig.disabledProviders !== undefined;
  useEffect(() => {
    if (userCustomizedEngines || config.privacyMode) return;
    let cancelled = false;
    void getEngineSearchStatus().then((status) => {
      if (cancelled) return;
      const unpark: string[] = [];
      if (status.brave || getBraveApiKey()) unpark.push('brave');
      if (status.parallel || getParallelApiKey()) unpark.push('parallel');
      if (unpark.length === 0) return;
      updateConfig((cur) => cur.disabledProviders !== undefined ? {} : ({
        disabledProviders: defaultConfig.disabledProviders.filter((id) => !unpark.includes(id)),
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [userCustomizedEngines, config.privacyMode, defaultConfig.disabledProviders, updateConfig]);

  const appContextValue: AppContextType = {
    config,
    updateConfig,
    accountPubkey,
    updateAccountConfig,
  };

  // Apply theme effects to document
  useApplyTheme(config.theme);

  return (
    <AppContext.Provider value={appContextValue}>
      {children}
      {hasStorageError && (
        <Alert variant="destructive" className="fixed inset-x-4 bottom-4 z-50 w-auto shadow-sm sm:left-auto sm:w-96">
          <AlertTitle className="text-lg">Settings could not be saved</AlertTitle>
          <AlertDescription className="text-lg">
            Changes apply for this session only. Reloading may restore your previous settings.
          </AlertDescription>
        </Alert>
      )}
    </AppContext.Provider>
  );
}

/**
 * Hook to apply theme changes to the document root.
 * Two core themes (light/dark, both Presearch-branded) + hidden hacker.
 */
function useApplyTheme(theme: Theme) {
  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove('light', 'dark', 'hacker', 'presearch');

    // Hacker theme is dark-based, so we add both classes
    // so that dark-variant styles also apply.
    if (theme === 'hacker') {
      root.classList.add('dark', 'hacker');
      return;
    }

    root.classList.add(theme);
  }, [theme]);
}
