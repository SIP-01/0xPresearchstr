import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { ProviderSearchResponse, SearchOptions, SearchResult } from '@/lib/providers/types';
import type { AIAnswer, AIAnswerRequest } from '@/lib/ai/types';
import { setAIConfig } from '@/lib/aiConfig';

import App from './App';
import { useAppContext } from '@/hooks/useAppContext';
import { TestApp } from '@/test/TestApp';

const mocks = vi.hoisted(() => ({
  fast: vi.fn<(options: SearchOptions) => Promise<ProviderSearchResponse>>(),
  slow: vi.fn<(options: SearchOptions) => Promise<ProviderSearchResponse>>(),
  answer: vi.fn<(endpoint: string, key: string, request: AIAnswerRequest) => Promise<AIAnswer>>(),
  indexResults: vi.fn(),
}));

vi.mock('@/lib/providers/registry', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/providers/registry')>(),
  getProvidersForPrivacy: () => [
    { id: 'test-fast', name: 'Fast provider', source: 'web', privacy: 'direct', search: mocks.fast },
    { id: 'test-slow', name: 'Slow provider', source: 'web', privacy: 'direct', search: mocks.slow },
  ],
}));
vi.mock('@/lib/ai/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/registry')>();
  return {
    ...actual,
    getAIProvider: (id: string) => {
      const provider = actual.getAIProvider(id);
      return provider ? { ...provider, answer: mocks.answer } : undefined;
    },
  };
});
vi.mock('@/hooks/useEngineAIStatus', () => ({ useEngineAIStatus: () => ({ status: null, isLoading: false }) }));
vi.mock('@/hooks/useSearchIndexer', () => ({ useSearchIndexer: () => ({ indexResults: mocks.indexResults }) }));
vi.mock('@/hooks/useModeration', () => ({ useModerationSet: () => undefined }));
vi.mock('@/hooks/usePlatformKeywordStaking', () => ({ usePlatformKeywordStaking: () => ({ enabled: true }) }));
vi.mock('@/components/NostrSync', () => ({ NostrSync: () => null }));
vi.mock('@/components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@/components/TrendingQueries', () => ({ TrendingQueries: () => null }));
vi.mock('@/components/VoteButtons', () => ({ VoteTalliesProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/UnifiedResultCard', () => ({ UnifiedResultCard: ({ result }: { result: SearchResult }) => <article>{result.title}</article> }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function result(title: string): SearchResult {
  return { id: title, title, url: `https://example.com/${title}`, snippet: title, source: 'web', provider: 'test-fast' };
}

async function submit(query: string) {
  const input = await screen.findByRole('textbox', { name: 'Search query' });
  fireEvent.change(input, { target: { value: query } });
  fireEvent.submit(input.closest('form')!);
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  window.history.replaceState({}, '', import.meta.env.BASE_URL);
  mocks.fast.mockImplementation(() => new Promise(() => {}));
  mocks.slow.mockImplementation(() => new Promise(() => {}));
  mocks.answer.mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(() => new Promise(() => {})));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.removeItem('test-app-config');
  window.history.replaceState(null, '', '/');
});

test('renders the home page at the configured deployment base', async () => {
  window.history.replaceState(null, '', import.meta.env.BASE_URL);
  render(<App />);
  expect(await screen.findByRole('textbox', { name: 'Search query' })).toBeInTheDocument();
});

test.each([0, 1])('Stop button %i retains partial results and permits the same query again', async (stopIndex) => {
  const late = deferred<ProviderSearchResponse>();
  mocks.fast.mockResolvedValue({ results: [result('partial result')] });
  mocks.slow.mockReturnValueOnce(late.promise);
  render(<App />);
  const query = `partial${stopIndex}`;
  await submit(query);

  expect(await screen.findByText('partial result')).toBeInTheDocument();
  const signal = mocks.slow.mock.calls[0][0].signal;
  const stops = await screen.findAllByRole('button', { name: 'Stop search' });
  expect(stops).toHaveLength(2);
  for (const stop of stops) {
    expect(stop).toHaveAttribute('type', 'button');
    expect(stop.textContent).toBe('');
    expect(stop.querySelector('.lucide-loader-circle')).toBeInTheDocument();
    expect(stop.querySelector('.lucide-square')).toBeInTheDocument();
  }
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(stops[stopIndex]).toBeEnabled();
  fireEvent.click(stops[stopIndex]);

  expect(signal?.aborted).toBe(true);
  expect(await screen.findByText('Search stopped.')).toBeInTheDocument();
  expect(screen.getByText('partial result')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Search query' })).toHaveFocus();
  expect(screen.queryByRole('button', { name: 'Stop search' })).not.toBeInTheDocument();
  expect(mocks.indexResults).not.toHaveBeenCalled();

  await submit(query);
  await waitFor(() => expect(mocks.slow).toHaveBeenCalledTimes(2));
  expect(mocks.slow.mock.calls[1][0].signal?.aborted).toBe(false);
  await act(async () => { late.resolve({ results: [result('late result')] }); });
  expect(screen.queryByText('late result')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Stop search' })).toHaveLength(2);
});

test('a new submission cancels the old search immediately and ignores its completion', async () => {
  const old = deferred<ProviderSearchResponse>();
  mocks.fast.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ results: [result('replacement result')] });
  render(<App />);
  await submit('replaceold');
  await waitFor(() => expect(mocks.fast).toHaveBeenCalledTimes(1));
  const oldSignal = mocks.fast.mock.calls[0][0].signal;

  await submit('replacement');
  expect(oldSignal?.aborted).toBe(true);
  expect(await screen.findByText('replacement result')).toBeInTheDocument();
  await act(async () => { old.resolve({ results: [result('obsolete result')] }); });
  expect(screen.queryByText('obsolete result')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Stop search' })).toHaveLength(2);
});

test('stopping before any response shows cancellation instead of an empty search', async () => {
  render(<App />);
  await submit('emptycancel');
  fireEvent.click((await screen.findAllByRole('button', { name: 'Stop search' }))[0]);
  expect(await screen.findByText('Search stopped.')).toBeInTheDocument();
  expect(screen.queryByText(/No results found/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Stop search' })).not.toBeInTheDocument();
  expect(mocks.indexResults).not.toHaveBeenCalled();
});

test('switching tabs restarts a stopped search', async () => {
  render(<App />);
  await submit('tabrestart');
  fireEvent.click((await screen.findAllByRole('button', { name: 'Stop search' }))[0]);
  expect(await screen.findByText('Search stopped.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'All' }));
  await waitFor(() => expect(mocks.slow).toHaveBeenCalledTimes(2));
  expect(mocks.slow.mock.calls[1][0].signal?.aborted).toBe(false);
  expect(screen.queryByText('Search stopped.')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Stop search' })).toHaveLength(2);
});

test('Stop also cancels pending instant and AI answers after providers finish', async () => {
  setAIConfig({ enabled: true });
  mocks.fast.mockResolvedValue({ results: [result('answers first'), result('answers second')] });
  mocks.slow.mockResolvedValue({ results: [] });
  render(<App />);
  await submit('answers');
  await waitFor(() => expect(mocks.answer).toHaveBeenCalledTimes(1));
  const aiSignal = mocks.answer.mock.calls[0][2].signal;
  const fetchMock = vi.mocked(fetch);
  const wikiRequest = fetchMock.mock.calls.find(([url]) => String(url).startsWith('https://en.wikipedia.org/'));
  expect(wikiRequest).toBeDefined();
  const placementRequests = fetchMock.mock.calls.filter(([url]) => String(url).includes('/precommunity?')
    || String(url).includes('/keyword-market/keywords/'));
  expect(placementRequests).toHaveLength(2);

  fireEvent.click((await screen.findAllByRole('button', { name: 'Stop search' }))[0]);
  expect(aiSignal?.aborted).toBe(true);
  expect(wikiRequest?.[1]?.signal?.aborted).toBe(true);
  for (const [, options] of placementRequests) expect(options?.signal?.aborted).toBe(true);
  expect(await screen.findByText('Search stopped.')).toBeInTheDocument();
  expect(screen.queryByText('AI is synthesizing an answer…')).not.toBeInTheDocument();
  expect(screen.queryByText(/AI answer unavailable/)).not.toBeInTheDocument();
});

test('Stop preserves completed answers and keyword placement', async () => {
  setAIConfig({ enabled: true });
  mocks.fast.mockResolvedValue({ results: [result('completed first'), result('completed second')] });
  mocks.answer.mockResolvedValue({ text: 'Completed AI answer', model: 'test-model', provider: 'test' });
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (String(url).includes('/precommunity?')) {
      return Response.json({ ad: {
        headline: 'Completed placement', description: 'Keyword placement', url: 'https://example.com/',
        clickUrl: 'https://precommunity.org/click', reportUrl: 'https://precommunity.org/report',
      } });
    }
    if (String(url).includes('list=search')) {
      return Response.json({ query: { search: [{ title: 'Completed' }] } });
    }
    return Response.json({ query: { pages: { '1': { title: 'Completed', extract: 'Completed instant answer' } } } });
  });
  render(<App />);
  await submit('completed');
  expect(await screen.findByText('Completed AI answer')).toBeInTheDocument();
  expect(await screen.findByText('Completed instant answer')).toBeInTheDocument();
  expect(await screen.findByText('Completed placement')).toBeInTheDocument();

  fireEvent.click((await screen.findAllByRole('button', { name: 'Stop search' }))[0]);
  expect(await screen.findByText('Search stopped.')).toBeInTheDocument();
  expect(screen.getByText('Completed AI answer')).toBeInTheDocument();
  expect(screen.getByText('Completed instant answer')).toBeInTheDocument();
  expect(screen.getByText('Completed placement')).toBeInTheDocument();
});

test.each(['QuotaExceededError', 'SecurityError'])('keeps session settings and warns when storage fails with %s', async (errorName) => {
  localStorage.removeItem('test-app-config');
  const { result } = renderHook(useAppContext, { wrapper: TestApp });
  await waitFor(() => expect(result.current).not.toBeNull());

  const originalSetItem = Storage.prototype.setItem;
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === 'test-app-config') throw new DOMException('Storage unavailable', errorName);
    originalSetItem.call(this, key, value);
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  act(() => result.current.updateConfig(() => ({ privacyMode: true })));
  expect(result.current.config.privacyMode).toBe(true);
  expect(localStorage.getItem('test-app-config')).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent('Settings could not be saved');
  expect(screen.getByRole('alert')).toHaveTextContent('Changes apply for this session only');

  write.mockRestore();
  act(() => result.current.updateConfig((current) => ({ autoIndex: current.privacyMode })));
  expect(result.current.config.autoIndex).toBe(true);
  expect(JSON.parse(localStorage.getItem('test-app-config')!)).toMatchObject({ privacyMode: true, autoIndex: true });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
