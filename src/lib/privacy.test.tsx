/**
 * Privacy regression tests — the guarantees that make this app
 * privacy-oriented, pinned so no future refactor silently breaks them.
 *
 * 1. Query-class routing (audit: "special queries must never leak"):
 *    a NIP-19 id, NIP-05 address, URL, or math expression must NEVER be
 *    sent to clearnet engine providers (SearXNG/DDG/Brave/Wikipedia/HN/
 *    StackOverflow/Tor). Math runs zero providers. Text stays unrestricted.
 *
 * 2. URL sanitization (audit: "harden external URL handling"): only
 *    https/http (+ magnet with an xt hash) may become clickable result
 *    links; javascript:/data:/file:/blob:/chrome:/intent: never may.
 */
import { useState } from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';

import { classifyQuery, providerAllowlistFor } from '@/lib/queryClassify';
import { sanitizeUrl, sanitizeResultUrl, sanitizePublicUrl } from '@/lib/sanitizeUrl';
import { ALL_PROVIDERS, getProvidersForPrivacy } from '@/lib/providers/registry';
import { TestApp } from '@/test/TestApp';
import { UnifiedResultCard } from '@/components/UnifiedResultCard';
import { PrecommunityAdCard, PrecommunityAdInvite } from '@/components/PrecommunityAdCard';
import { PrivacyIndicator } from '@/components/PrivacyIndicator';
import { useAppContext } from '@/hooks/useAppContext';
import { isPrecommunityQueryEligible, usePrecommunityAd } from '@/hooks/usePrecommunityAd';
import type { PrecommunityAd } from '@/lib/precommunity';
import { PRECOMMUNITY_MARKET_URL } from '@/lib/precommunity';
import type { SearchResult } from '@/lib/providers/types';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.removeItem('test-app-config');
});

/** A real, decodable npub (test-only value). */
const TEST_NPUB = 'npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6';

/** Every clearnet engine that must never see a classified query. */
const EXTERNAL_ENGINES = [
  'searxng',
  'duckduckgo',
  'brave',
  'wikipedia',
  'hackernews',
  'stackoverflow',
  'tor',
];

describe('query classification privacy (no leaks to external engines)', () => {
  it('routes NIP-19 identifiers to Nostr-tier providers only', () => {
    expect(classifyQuery(TEST_NPUB)).toBe('nip19');
    const allow = providerAllowlistFor('nip19');
    expect(allow).toBeDefined();
    for (const engine of EXTERNAL_ENGINES) {
      expect(allow!.has(engine), `nip19 must not reach ${engine}`).toBe(false);
    }
  });

  it('routes NIP-05 addresses to Nostr only', () => {
    expect(classifyQuery('alice@example.com')).toBe('nip05');
    const allow = providerAllowlistFor('nip05');
    for (const engine of EXTERNAL_ENGINES) {
      expect(allow!.has(engine), `nip05 must not reach ${engine}`).toBe(false);
    }
  });

  it('routes URLs to the Nostr-tier index providers only', () => {
    expect(classifyQuery('https://example.com/some/page')).toBe('url');
    const allow = providerAllowlistFor('url');
    expect(allow).toBeDefined();
    for (const engine of EXTERNAL_ENGINES) {
      expect(allow!.has(engine), `URL must not reach ${engine}`).toBe(false);
    }
    // The URL lookup path must stay inside the Nostr network.
    for (const id of allow!) {
      const provider = ALL_PROVIDERS.find((p) => p.id === id);
      expect(provider?.privacy, `${id} must be Nostr-tier`).toBe('nostr');
    }
  });

  it('routes math to NO providers at all (the calculator is local)', () => {
    expect(classifyQuery('15% of 80')).toBe('math');
    const allow = providerAllowlistFor('math');
    expect(allow).toBeDefined();
    expect(allow!.size).toBe(0);
  });

  it('leaves plain text unrestricted', () => {
    expect(classifyQuery('best monero wallet')).toBe('text');
    expect(providerAllowlistFor('text')).toBeUndefined();
  });
});

describe('URL sanitization', () => {
  it('allows http/https only in sanitizeUrl', () => {
    expect(sanitizeUrl('https://example.com/x')).toBe('https://example.com/x');
    expect(sanitizeUrl('http://example.onion/')).toBe('http://example.onion/');
    expect(sanitizeUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(sanitizeUrl('file:///etc/passwd')).toBe('');
    expect(sanitizeUrl('vbscript:msgbox(1)')).toBe('');
    expect(sanitizeUrl('blob:https://example.com/abc')).toBe('');
    expect(sanitizeUrl('chrome://settings')).toBe('');
    expect(sanitizeUrl('intent://scan/#Intent;scheme=zxing;end')).toBe('');
    expect(sanitizeUrl('not a url')).toBe('');
  });

  it('sanitizeResultUrl additionally allows magnet links with an xt hash', () => {
    const magnet = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=test';
    expect(sanitizeResultUrl(magnet)).toBe(magnet);
    expect(sanitizeResultUrl('magnet:?')).toBe(''); // no hash — not a real magnet
    expect(sanitizeResultUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeResultUrl('ipfs://QmSomeHash')).toBe(''); // not browser-navigable
  });

  it('sanitizePublicUrl rejects http and loopback/private hosts', () => {
    expect(sanitizePublicUrl('https://example.com')).toBe('https://example.com/');
    expect(sanitizePublicUrl('http://example.com')).toBe('');
    expect(sanitizePublicUrl('http://127.0.0.1:3000/repo')).toBe('');
    expect(sanitizePublicUrl('https://192.168.1.5/x')).toBe('');
    expect(sanitizePublicUrl('https://10.0.0.2/')).toBe('');
    expect(sanitizePublicUrl('https://localhost:8080/')).toBe('');
  });
});

describe('result card link safety (hostile result data)', () => {
  const base: SearchResult = {
    id: 'test-1',
    title: 'Some result',
    url: 'https://example.com/',
    snippet: 'A snippet',
    source: 'web',
    provider: 'community',
  };

  it('does not render javascript: URLs as links', async () => {
    const { container } = render(
      <TestApp>
        <UnifiedResultCard result={{ ...base, url: 'javascript:alert(1)' }} />
      </TestApp>,
    );
    await waitFor(() => expect(container.textContent).toContain('Some result'));
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    // No anchor at all for an unsafe external URL — the card still renders.
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('Some result');
  });

  it('renders https URLs as links', async () => {
    const { container } = render(
      <TestApp>
        <UnifiedResultCard result={base} />
      </TestApp>,
    );
    await waitFor(() => expect(container.querySelector('a[href="https://example.com/"]')).not.toBeNull());
  });

  it('renders magnet torrent links (NIP-35)', async () => {
    const magnet = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=test';
    const { container } = render(
      <TestApp>
        <UnifiedResultCard result={{ ...base, url: magnet, source: 'nostr' }} />
      </TestApp>,
    );
    await waitFor(() => expect(container.querySelector('a[href^="magnet:"]')).not.toBeNull());
  });
});

const TEST_AD: PrecommunityAd = {
  headline: 'Bitcoin ad',
  description: 'Learn about Bitcoin',
  url: 'https://bitcoin.org/',
  clickUrl: 'https://precommunity.org/api/v1/keyword-market/revisions/test/click?delivery=token',
  reportUrl: 'https://precommunity.org/keyword-market/reports/test',
};

function AdHarness({ initialQuery = 'bitcoin', initialSource = 'web' }: {
  initialQuery?: string;
  initialSource?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [source, setSource] = useState(initialSource);
  const [page, setPage] = useState(1);
  const { config, updateConfig } = useAppContext();
  const eligible = (source === 'web' || source === 'all') && isPrecommunityQueryEligible(query);
  const adQuery = usePrecommunityAd(query, eligible);
  return (
    <>
      <input aria-label="Ad query" value={query} onChange={(event) => setQuery(event.target.value)} />
      <select aria-label="Ad source" value={source} onChange={(event) => setSource(event.target.value)}>
        {['web', 'all', 'nostr', 'index', 'wiki', 'news', 'code', 'tor', 'i2p'].map((value) => (
          <option key={value} value={value}>{value}</option>
        ))}
      </select>
      <button onClick={() => setPage((current) => current + 1)}>Next page</button>
      <output>{page}</output>
      <button onClick={() => updateConfig(() => ({ privacyMode: !config.privacyMode }))}>Toggle privacy</button>
      <button onClick={() => updateConfig(() => ({ disabledProviders: ALL_PROVIDERS.map((provider) => provider.id) }))}>Disable engines</button>
      <PrivacyIndicator source={source === 'all' ? 'all' : 'web'} precommunityEligible={eligible} />
      {eligible && !adQuery.isPending && (
        adQuery.data?.ad
          ? <PrecommunityAdCard ad={adQuery.data.ad} />
          : <PrecommunityAdInvite keyword={query} />
      )}
    </>
  );
}

function mockAdFetch(resolve: (query: string, signal?: AbortSignal | null) => Promise<Response>) {
  const requests: string[] = [];
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'https://test.example');
    if (!url.pathname.endsWith('/ads/precommunity')) return Promise.resolve(Response.json({ brave: false, parallel: false }));
    const query = url.searchParams.get('q') ?? '';
    requests.push(query);
    return resolve(query, init?.signal);
  }));
  return requests;
}

describe('Precommunity ads', () => {
  it('never forwards identifiers, private keys, URLs, math, blank or oversized queries', async () => {
    localStorage.setItem('test-app-config', JSON.stringify({ privacyMode: true }));
    for (const query of ['', '   ', TEST_NPUB, 'nsec1privatekey', 'alice@example.com', 'https://bitcoin.org/', '2 + 2', 'a'.repeat(401)]) {
      expect(isPrecommunityQueryEligible(query), query).toBe(false);
    }
    expect(isPrecommunityQueryEligible(' bitcoin ')).toBe(true);
    const requests = mockAdFetch(() => Promise.resolve(Response.json({ ad: TEST_AD })));
    const view = render(<TestApp><AdHarness initialQuery="nsec1privatekey" /></TestApp>);
    await waitFor(() => expect(view.getByLabelText('Ad query')).toBeInTheDocument());
    expect(requests).toEqual([]);
    expect(view.queryByRole('article')).toBeNull();
  });

  it('opens the delivery click link and keeps reporting separate with escaped text', () => {
    const view = render(<PrecommunityAdCard ad={{ ...TEST_AD, headline: '<img src=x onerror=alert(1)>' }} />);
    expect(view.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(view.container.querySelector('img')).toBeNull();
    expect(view.getByText('Keyword Staking')).toBeInTheDocument();
    expect(view.getByText('bitcoin.org')).toBeInTheDocument();
    const links = view.getAllByRole('link');
    expect(links[0]).toHaveAttribute('href', TEST_AD.clickUrl);
    expect(links[1]).toHaveAttribute('href', TEST_AD.reportUrl);
    expect(view.container.querySelector('a a')).toBeNull();
  });

  it('fetches only for Web/All and reuses the delivery across tabs and pagination', async () => {
    const requests = mockAdFetch(() => Promise.resolve(Response.json({ ad: TEST_AD })));
    const view = render(<TestApp><AdHarness initialSource="nostr" /></TestApp>);
    await waitFor(() => expect(view.getByLabelText('Ad source')).toBeInTheDocument());
    expect(requests).toEqual([]);
    fireEvent.change(view.getByLabelText('Ad source'), { target: { value: 'web' } });
    await waitFor(() => expect(view.getByRole('article')).toBeInTheDocument());
    fireEvent.click(view.getByText('Next page'));
    fireEvent.change(view.getByLabelText('Ad source'), { target: { value: 'all' } });
    expect(requests).toEqual(['bitcoin']);
    expect(view.getByRole('article')).toBeInTheDocument();
    fireEvent.change(view.getByLabelText('Ad source'), { target: { value: 'index' } });
    expect(view.queryByRole('article')).toBeNull();
    expect(requests).toEqual(['bitcoin']);
  });

  it('drops a previous query and ignores its late delivery', async () => {
    let completeFirst: ((value: Response) => void) | undefined;
    let firstSignal: AbortSignal | null | undefined;
    const requests = mockAdFetch((query, signal) => {
      if (query === 'bitcoin') {
        firstSignal = signal;
        return new Promise<Response>((resolve) => { completeFirst = resolve; });
      }
      return Promise.resolve(Response.json({ ad: { ...TEST_AD, headline: 'Tesla ad' } }));
    });
    const view = render(<TestApp><AdHarness /></TestApp>);
    await waitFor(() => expect(requests).toEqual(['bitcoin']));
    fireEvent.change(view.getByLabelText('Ad query'), { target: { value: 'tesla' } });
    await waitFor(() => expect(view.getByText('Tesla ad')).toBeInTheDocument());
    expect(firstSignal?.aborted).toBe(true);
    await act(async () => { completeFirst?.(Response.json({ ad: TEST_AD })); });
    expect(view.queryByText('Bitcoin ad')).toBeNull();
    expect(view.getByText('Tesla ad')).toBeInTheDocument();
  });

  it.each(['web', 'all'] as const)('resolves ads in %s with Privacy Mode initially enabled and discloses the exception', async (source) => {
    localStorage.setItem('test-app-config', JSON.stringify({ privacyMode: true }));
    const requests = mockAdFetch(() => Promise.resolve(Response.json({ ad: TEST_AD })));
    const view = render(<TestApp><AdHarness initialSource={source} /></TestApp>);
    await waitFor(() => expect(view.getByRole('article')).toBeInTheDocument());
    expect(requests).toEqual(['bitcoin']);
    fireEvent.click(view.getByLabelText('Privacy status: Nostr. Click for details.'));
    expect(view.getByText('Nostr handles organic search. AI is off; Keyword Staking remains enabled.')).toBeInTheDocument();
    expect(view.getAllByText('Keyword Staking').length).toBeGreaterThanOrEqual(1);
    expect(view.getByText(/Platform Keyword Staking resolves PRE community keyword ads from your query through our backend/)).toBeInTheDocument();
    expect(view.getByText(/No Nostr account or browser cookies are sent/)).toBeInTheDocument();
    expect(view.queryByText(/It sees your query and IP/)).toBeNull();
    expect(view.getByText('Blocked by Privacy Mode')).toBeInTheDocument();
    const providerIds = getProvidersForPrivacy(source, true).map((provider) => provider.id);
    for (const engine of EXTERNAL_ENGINES) expect(providerIds).not.toContain(engine);
    expect(providerIds).not.toContain('parallel');
  });

  it('keeps cached ads when toggling Privacy Mode and discloses the exception even with engines off', async () => {
    const requests = mockAdFetch(() => Promise.resolve(Response.json({ ad: TEST_AD })));
    const view = render(<TestApp><AdHarness /></TestApp>);
    await waitFor(() => expect(view.getByRole('article')).toBeInTheDocument());
    fireEvent.click(view.getByText('Disable engines'));
    expect(view.getByLabelText('Privacy status: Proxy active. Click for details.')).toBeInTheDocument();
    fireEvent.click(view.getByText('Toggle privacy'));
    expect(view.getByRole('article')).toBeInTheDocument();
    expect(view.getByLabelText('Privacy status: Nostr. Click for details.')).toBeInTheDocument();
    fireEvent.click(view.getByText('Toggle privacy'));
    expect(view.getByRole('article')).toBeInTheDocument();
    expect(requests).toEqual(['bitcoin']);
  });

  it('keeps a pending ad request when Privacy Mode is enabled and displays its delivery', async () => {
    let pendingSignal: AbortSignal | null | undefined;
    let finish: ((value: Response) => void) | undefined;
    const requests = mockAdFetch((_query, signal) => {
      pendingSignal = signal;
      return new Promise<Response>((resolve) => { finish = resolve; });
    });
    const view = render(<TestApp><AdHarness /></TestApp>);
    await waitFor(() => expect(requests).toEqual(['bitcoin']));
    fireEvent.click(view.getByText('Toggle privacy'));
    expect(pendingSignal?.aborted).toBe(false);
    await act(async () => { finish?.(Response.json({ ad: TEST_AD })); });
    await waitFor(() => expect(view.getByRole('article')).toBeInTheDocument());
    expect(view.getByLabelText('Privacy status: Nostr. Click for details.')).toBeInTheDocument();
    expect(requests).toEqual(['bitcoin']);
  });

  it('invites advertising after a no-match response in Privacy Mode, but not while loading or on other sources', async () => {
    localStorage.setItem('test-app-config', JSON.stringify({ privacyMode: true }));
    let finish: ((value: Response) => void) | undefined;
    const requests = mockAdFetch(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const view = render(<TestApp><AdHarness initialQuery="tesla" /></TestApp>);
    await waitFor(() => expect(requests).toEqual(['tesla']));
    expect(view.queryByRole('complementary')).toBeNull();
    await act(async () => { finish?.(Response.json({ ad: null })); });
    await waitFor(() => expect(view.getByRole('complementary', { name: 'Stake this keyword' })).toBeInTheDocument());
    expect(view.getByText('Your site could appear for “tesla” through Keyword Staking.')).toBeInTheDocument();
    expect(view.getByRole('link', { name: 'Stake this keyword' })).toHaveAttribute('href', PRECOMMUNITY_MARKET_URL);
    fireEvent.click(view.getByText('Next page'));
    fireEvent.change(view.getByLabelText('Ad source'), { target: { value: 'all' } });
    expect(requests).toEqual(['tesla']);
    expect(view.getByRole('complementary')).toBeInTheDocument();
    fireEvent.click(view.getByText('Toggle privacy'));
    expect(view.getByRole('complementary')).toBeInTheDocument();
    fireEvent.click(view.getByText('Toggle privacy'));
    expect(view.getByRole('complementary')).toBeInTheDocument();
    fireEvent.change(view.getByLabelText('Ad source'), { target: { value: 'nostr' } });
    expect(view.queryByRole('complementary')).toBeNull();
    expect(requests).toEqual(['tesla']);
  });

  it('escapes the keyword in the invitation and uses a fixed marketplace link', () => {
    const keyword = '<img src=x onerror=alert(1)>';
    const view = render(<PrecommunityAdInvite keyword={keyword} />);
    expect(view.getByText(`Your site could appear for “${keyword}” through Keyword Staking.`)).toBeInTheDocument();
    expect(view.container.querySelector('img')).toBeNull();
    expect(view.getByRole('link')).toHaveAttribute('href', PRECOMMUNITY_MARKET_URL);
    expect(view.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('offers the marketplace on malformed responses and backend failures without retrying', async () => {
    const requests = mockAdFetch((query) => Promise.resolve(query === 'bitcoin'
      ? Response.json({ ad: { ...TEST_AD, clickUrl: 'javascript:alert(1)' } })
      : new Response('', { status: 503 })));
    const view = render(<TestApp><AdHarness /></TestApp>);
    await waitFor(() => expect(requests).toEqual(['bitcoin']));
    await waitFor(() => expect(view.getByRole('complementary')).toBeInTheDocument());
    expect(view.queryByRole('article')).toBeNull();
    fireEvent.change(view.getByLabelText('Ad query'), { target: { value: 'tesla' } });
    await waitFor(() => expect(requests).toEqual(['bitcoin', 'tesla']));
    await waitFor(() => expect(view.getByRole('complementary')).toBeInTheDocument());
    expect(view.queryByRole('article')).toBeNull();
  });
});
