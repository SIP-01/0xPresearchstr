import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createHead, UnheadProvider } from '@unhead/react/client';
import { BrowserRouter } from 'react-router-dom';
import { NostrLoginProvider } from '@nostrify/react/login';
import NostrProvider from '@/components/NostrProvider';
import { AppProvider } from '@/components/AppProvider';
import { AppConfig } from '@/contexts/AppContext';
import { DEFAULT_TAB_CONFIG } from '@/lib/sourceTabs';

interface TestAppProps {
  children: React.ReactNode;
}

export function TestApp({ children }: TestAppProps) {
  const head = createHead();

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const defaultConfig: AppConfig = {
    theme: 'light',
    relayMetadata: {
      relays: [
        { url: 'wss://relay.primal.net', read: true, write: true },
      ],
      updatedAt: 0,
    },
    blossomServerMetadata: {
      servers: ['https://blossom.primal.net/'],
      updatedAt: 0,
    },
    useAppBlossomServers: true,
    privacyMode: false,
    autoIndex: false,
    tabConfig: DEFAULT_TAB_CONFIG,
    voteWithIdentity: false,
    showNpub: false,
    disabledProviders: [],
    languageFilter: [],
  };

  return (
    <UnheadProvider head={head}>
      <QueryClientProvider client={queryClient}>
        <NostrLoginProvider storageKey='test-login'>
          <AppProvider storageKey='test-app-config' defaultConfig={defaultConfig}>
            <NostrProvider>
              <BrowserRouter>
                {children}
              </BrowserRouter>
            </NostrProvider>
          </AppProvider>
        </NostrLoginProvider>
      </QueryClientProvider>
    </UnheadProvider>
  );
}

export default TestApp;
