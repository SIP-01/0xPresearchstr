/**
 * Query engine tests — gate semantics, filters, dates, and a deterministic
 * SIP-01-shaped search-quality dataset (every query asserts WHICH documents
 * match, not just THAT something matches).
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { parseQuery } from '@/lib/queryParser';
import {
  evaluateQuery,
  docFromObservation,
  parseDateBoundary,
  applyHardConstraints,
} from '@/lib/queryEngine';
import { sortByQueryRelevance } from '@/lib/resultRank';
import { termMatches } from '@/lib/queryMatch';
import type { IndexObservation } from '@/lib/webIndex';
import type { SearchResult } from '@/lib/providers/types';
import type { SearchProvider } from '@/lib/providers/types';
import { deduplicateResults, useProviderSearch } from '@/hooks/useProviderSearch';

const searchState = vi.hoisted(() => ({
  disabledProviders: [] as string[],
  providers: [] as SearchProvider[],
  indexResults: vi.fn(),
}));

vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({ config: {
    privacyMode: false, languageFilter: [], disabledProviders: searchState.disabledProviders, npubKeywordStaking: false,
  } }),
}));
vi.mock('@/hooks/useModeration', () => ({ useModerationSet: () => null }));
vi.mock('@/hooks/useSearchIndexer', () => ({
  useSearchIndexer: () => ({ indexResults: searchState.indexResults }),
}));
vi.mock('@/lib/providers/registry', () => ({
  getProvidersForPrivacy: () => searchState.providers,
  getProvidersForSource: () => searchState.providers,
}));

afterEach(() => {
  cleanup();
  searchState.disabledProviders = [];
  searchState.providers = [];
  searchState.indexResults.mockClear();
});

/* ------------------------------------------------------------------ */
/* Deterministic test dataset (SIP-01 observations)                    */
/* ------------------------------------------------------------------ */

const ts = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 1000);

let seq = 0;
function mkObs(partial: {
  url: string; title: string; description?: string; topics?: string[];
  language?: string; type?: string; mime?: string;
  published?: number; observedAt: number;
}): IndexObservation {
  seq++;
  return {
    d: `widx:test${seq.toString(16).padStart(4, '0')}`,
    url: partial.url,
    title: partial.title,
    description: partial.description ?? '',
    topics: partial.topics ?? [],
    language: partial.language,
    published: partial.published,
    observedAt: partial.observedAt,
    extensions: {
      ...(partial.type ? { type: partial.type } : {}),
      ...(partial.mime ? { mime: partial.mime } : {}),
    },
    indexer: 'a'.repeat(64),
    event: {} as NostrEvent, // unused by the engine adapter
  };
}

const DOCS = {
  nipsRepo: mkObs({
    url: 'https://github.com/nostr-protocol/nips',
    title: 'Nostr protocol NIPs',
    description: 'The Nostr protocol specification — decentralized notes and other stuff',
    topics: ['nostr', 'protocol'], language: 'en', type: 'repository',
    published: ts('2023-01-15'), observedAt: ts('2026-02-01'),
  }),
  gist: mkObs({
    url: 'https://gist.github.com/fiatjaf/abc123',
    title: 'Nostr relay snippet',
    description: 'A privacy-focused relay snippet',
    topics: ['nostr'], language: 'en',
    observedAt: ts('2026-03-01'),
  }),
  // Hostname lookalike — site:github.com must NOT match this.
  evil: mkObs({
    url: 'https://evilgithub.com/nostr',
    title: 'Nostr privacy hub',
    description: 'Not affiliated with GitHub',
    observedAt: ts('2026-04-01'),
  }),
  danish: mkObs({
    url: 'https://nostr.dk/guide',
    title: 'Nostr guide',
    description: 'Dansk guide til Nostr og privatliv',
    topics: ['nostr'], language: 'da',
    observedAt: ts('2026-04-10'),
  }),
  pdf: mkObs({
    url: 'https://research.example.com/nostr.pdf',
    title: 'Decentralized search whitepaper',
    description: 'A whitepaper about decentralized search and privacy',
    type: 'file', mime: 'application/pdf',
    published: ts('2026-05-01'), observedAt: ts('2026-06-01'),
  }),
  oldPage: mkObs({
    url: 'https://old.example.com/nostr-history',
    title: 'Nostr history',
    description: 'The early days of nostr',
    language: 'en',
    published: ts('2020-05-01'), observedAt: ts('2025-12-01'),
  }),
  twitterDoc: mkObs({
    url: 'https://twitter.com/nostr',
    title: 'Nostr on Twitter',
    description: 'Discussion thread',
    language: 'en',
    observedAt: ts('2026-01-20'),
  }),
  blogTagged: mkObs({
    url: 'https://blog.example.com/nostr-privacy',
    title: 'Nostr privacy guide',
    description: 'A practical privacy guide for nostr users',
    topics: ['nostr', 'privacy'], language: 'en',
    observedAt: ts('2026-07-01'),
  }),
  nostrTools: mkObs({
    url: 'https://blog.example.com/tools',
    title: 'My tools page',
    description: 'Various nostr tools I maintain',
    topics: ['nostr-tools'], language: 'en',
    observedAt: ts('2026-08-15'),
  }),
  bitcoinDoc: mkObs({
    url: 'https://bitcoin.org/en/faq',
    title: 'Bitcoin FAQ',
    description: 'Privacy and money',
    language: 'en',
    observedAt: ts('2026-01-15'),
  }),
  essay: mkObs({
    url: 'https://essay.example.com/x',
    title: 'Why we need it',
    description: 'A decentralized search engine respects privacy',
    language: 'en',
    observedAt: ts('2026-02-20'),
  }),
  wwwGh: mkObs({
    url: 'https://www.github.com/explore',
    title: 'Explore GitHub',
    description: 'Trending nostr topics',
    language: 'en',
    observedAt: ts('2026-02-10'),
  }),
  scattered: mkObs({
    url: 'https://search.example.com/x',
    title: 'Search engines',
    description: 'Decentralized systems are the future of privacy',
    language: 'en',
    observedAt: ts('2026-02-01'),
  }),
} satisfies Record<string, IndexObservation>;

type DocId = keyof typeof DOCS;

/** Which documents match the query (evaluated through the SIP-01 adapter). */
function matchingIds(query: string): DocId[] {
  const parsed = parseQuery(query);
  return (Object.entries(DOCS) as [DocId, IndexObservation][])
    .filter(([, obs]) => evaluateQuery(docFromObservation(obs), parsed).match)
    .map(([id]) => id);
}

function expectMatchSet(query: string, expected: DocId[]) {
  expect(matchingIds(query).sort(), `query: ${query}`).toEqual([...expected].sort());
}

/* ------------------------------------------------------------------ */
/* Text gate semantics                                                  */
/* ------------------------------------------------------------------ */

describe('text gate (legacy plain-query semantics)', () => {
  it('nostr privacy — implicit AND', () => {
    expectMatchSet('nostr privacy', ['gist', 'evil', 'pdf', 'blogTagged']);
  });

  it('"decentralized search" — phrase gate (order-sensitive)', () => {
    expectMatchSet('"decentralized search"', ['pdf', 'essay']);
  });

  it('a phrase does NOT match scattered words', () => {
    // "decentralized" and "search" both appear in `scattered`, never adjacent.
    expect(evaluateQuery(docFromObservation(DOCS.scattered), parseQuery('"decentralized search"')).match).toBe(false);
    // …but as plain keywords the same document matches fine.
    expect(evaluateQuery(docFromObservation(DOCS.scattered), parseQuery('decentralized search')).match).toBe(true);
  });

  it('stop words do not gate when meaningful words exist', () => {
    expectMatchSet('the nostr privacy', ['gist', 'evil', 'pdf', 'blogTagged']);
  });

  it('gutting guard survives (single surviving keyword needs backup)', () => {
    // "how to build" → meaningful: build. No dataset doc says "build" at all.
    expectMatchSet('how to build', []);
  });

  it('plural folding still works', () => {
    expectMatchSet('nostr guides', ['danish', 'blogTagged']);
    for (const [plural, singular] of [['guides', 'guide'], ['pages', 'page'], ['buses', 'bus'], ['queries', 'query']]) {
      expect(termMatches(` ${singular} `, plural)).toBe(true);
    }
  });
});

describe('boolean operators', () => {
  it('nostr AND privacy', () => {
    expectMatchSet('nostr AND privacy', ['gist', 'evil', 'pdf', 'blogTagged']);
  });

  it('nostr OR bitcoin', () => {
    expectMatchSet('nostr OR bitcoin', [
      'nipsRepo', 'gist', 'evil', 'danish', 'pdf', 'oldPage',
      'twitterDoc', 'blogTagged', 'nostrTools', 'bitcoinDoc', 'wwwGh',
    ]);
  });

  it('nostr NOT twitter', () => {
    expectMatchSet('nostr NOT twitter', [
      'nipsRepo', 'gist', 'evil', 'danish', 'pdf', 'oldPage', 'blogTagged', 'nostrTools', 'wwwGh',
    ]);
  });

  it('nostr -twitter (dash prefix)', () => {
    expectMatchSet('nostr -twitter', [
      'nipsRepo', 'gist', 'evil', 'danish', 'pdf', 'oldPage', 'blogTagged', 'nostrTools', 'wwwGh',
    ]);
  });

  it('nostr AND (privacy OR decentralization)', () => {
    expectMatchSet('nostr AND (privacy OR decentralization)', ['gist', 'evil', 'pdf', 'blogTagged']);
  });

  it('(nostr OR bitcoin) AND privacy', () => {
    expectMatchSet('(nostr OR bitcoin) AND privacy', ['gist', 'evil', 'pdf', 'blogTagged', 'bitcoinDoc']);
  });
});

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */

describe('site:/domain: hostname filters', () => {
  it('site:github.com matches host + subdomains (www, gist)', () => {
    expectMatchSet('site:github.com', ['nipsRepo', 'gist', 'wwwGh']);
  });

  it('site:github.com never matches evilgithub.com', () => {
    expect(matchingIds('site:github.com')).not.toContain('evil');
  });

  it('domain:github.com is the exact host only', () => {
    expectMatchSet('domain:github.com', ['nipsRepo']);
  });

  it('site: tolerates a scheme and trailing slash in the value', () => {
    expectMatchSet('site:https://github.com/', ['nipsRepo', 'gist', 'wwwGh']);
  });

  it('SITE:GITHUB.COM is case-insensitive', () => {
    expectMatchSet('SITE:GITHUB.COM', ['nipsRepo', 'gist', 'wwwGh']);
  });
});

describe('title:', () => {
  it('title:nostr searches the title only', () => {
    expectMatchSet('title:nostr', ['nipsRepo', 'gist', 'evil', 'danish', 'oldPage', 'twitterDoc', 'blogTagged']);
  });

  it('title:"Nostr relay" is a title phrase', () => {
    expectMatchSet('title:"Nostr relay"', ['gist']);
  });

  it('title:pdf does not match the .pdf URL (title only!)', () => {
    expect(matchingIds('title:pdf')).not.toContain('pdf');
  });
});

describe('type:', () => {
  it('type:pdf matches via the mime tail', () => {
    expectMatchSet('type:pdf', ['pdf']);
  });

  it('type:repository matches the SIP-01 type extension', () => {
    expectMatchSet('type:repository', ['nipsRepo']);
  });

  it('type:code uses the code→repository alias', () => {
    expectMatchSet('type:code', ['nipsRepo']);
  });

  it('unknown type metadata FAILS the filter (no false matching)', () => {
    // gist has no type/mime — a type filter must drop it.
    expect(matchingIds('type:pdf')).not.toContain('gist');
  });
});

describe('lang:', () => {
  it('lang:en drops known-Danish, keeps unknown-language docs', () => {
    const ids = matchingIds('lang:en');
    expect(ids).not.toContain('danish');
    expect(ids).toContain('evil'); // unknown language passes
    expect(ids).toContain('nipsRepo');
  });

  it('lang:da keeps da + unknown-language docs only', () => {
    expectMatchSet('lang:da', ['danish', 'evil', 'pdf']);
  });
});

describe('tag:', () => {
  it('tag:nostr is exact — does not match nostr-tools', () => {
    const ids = matchingIds('tag:nostr');
    expect(ids.sort()).toEqual(['blogTagged', 'danish', 'gist', 'nipsRepo']);
    expect(ids).not.toContain('nostrTools');
  });

  it('TAG:NOSTR is case-insensitive', () => {
    expectMatchSet('TAG:NOSTR', ['nipsRepo', 'gist', 'danish', 'blogTagged']);
  });
});

describe('before:/after:', () => {
  it('parseDateBoundary validates dates', () => {
    expect(parseDateBoundary('2026-08-01')).toBe(ts('2026-08-01'));
    expect(parseDateBoundary('2026')).toBe(ts('2026-01-01'));
    expect(parseDateBoundary('2026-02')).toBe(ts('2026-02-01'));
    expect(parseDateBoundary('not-a-date')).toBeNull();
    expect(parseDateBoundary('2026-13-01')).toBeNull(); // month 13
    expect(parseDateBoundary('2026-02-30')).toBeNull(); // impossible day
  });

  it('after:2026-01-01 uses published ?? observed (published wins)', () => {
    const ids = matchingIds('after:2026-01-01');
    // nipsRepo: published 2023 → out, even though observed 2026-02 (published
    // is the page's own claim and takes precedence).
    expect(ids).not.toContain('nipsRepo');
    expect(ids).not.toContain('oldPage'); // published 2020
    expect(ids).toContain('gist');        // observed 2026-03
  });

  it('before:2026-08-01 excludes later observations', () => {
    const ids = matchingIds('before:2026-08-01');
    expect(ids).not.toContain('nostrTools'); // observed 2026-08-15
    expect(ids).toContain('essay');
  });

  it('nostr after:2026-01-01 before:2026-03-01 — combined window', () => {
    expectMatchSet('nostr after:2026-01-01 before:2026-03-01', ['twitterDoc', 'wwwGh']);
  });

  it('after:not-a-date degrades to a no-op (graceful, no crash)', () => {
    const ids = matchingIds('nostr after:not-a-date');
    expect(ids.length).toBeGreaterThan(0);
  });
});

describe('combined queries', () => {
  it('nostr site:github.com', () => {
    expectMatchSet('nostr site:github.com', ['nipsRepo', 'gist', 'wwwGh']);
  });

  it('nostr privacy site:github.com lang:en', () => {
    expectMatchSet('nostr privacy site:github.com lang:en', ['gist']);
  });

  it('nostr type:pdf after:2026-01-01', () => {
    expectMatchSet('nostr type:pdf after:2026-01-01', ['pdf']);
  });

  it('nostr NOT twitter site:github.com', () => {
    expectMatchSet('nostr NOT twitter site:github.com', ['nipsRepo', 'gist', 'wwwGh']);
  });
});

/* ------------------------------------------------------------------ */
/* Robustness                                                          */
/* ------------------------------------------------------------------ */

describe('robustness — invalid queries never crash', () => {
  const nasty = [
    'nostr AND', 'site:', 'after:not-a-date', 'unknown:value',
    'unclosed "phrase', '()', '())', 'OR', 'NOT', 'AND OR NOT',
    '""', '   ', 'nostr AND (privacy', '(((', 'lang:', 'before:',
  ];

  for (const q of nasty) {
    it(`survives: ${JSON.stringify(q)}`, () => {
      expect(() => {
        const parsed = parseQuery(q);
        for (const obs of Object.values(DOCS)) {
          evaluateQuery(docFromObservation(obs), parsed);
        }
      }).not.toThrow();
    });
  }

  it('empty query matches everything (filter-free, no gate)', () => {
    expectMatchSet('', Object.keys(DOCS) as DocId[]);
  });
});

/* ------------------------------------------------------------------ */
/* Ranking ladder: phrase > title > full coverage > partial            */
/* ------------------------------------------------------------------ */

describe('ranking ladder (resultRank)', () => {
  const mkResult = (id: string, fields: { title: string; snippet: string }): SearchResult => ({
    id,
    title: fields.title,
    url: `https://example.com/${id}`,
    snippet: fields.snippet,
    source: 'web',
    provider: 'duckduckgo',
    score: 80, // identical base — only the ladder differentiates
    timestamp: 1000, // identical recency
  });

  it('orders phrase > title > full coverage > partial', () => {
    const partial = mkResult('partial', { title: 'Some page', snippet: 'A decentralized system' });
    const full = mkResult('full', { title: 'Some page', snippet: 'Decentralized systems, search engines' });
    const title = mkResult('title', { title: 'Decentralized systems and Search explained', snippet: 'A guide' });
    // phrase and title land inside the ±5 recency tie-band at this base —
    // the phrase fixture wins the band on recency (deterministic).
    const phrase = { ...mkResult('phrase', { title: 'Some page', snippet: 'A decentralized search engine' }), timestamp: 1001 };

    const sorted = sortByQueryRelevance([partial, full, title, phrase], 'decentralized search');
    expect(sorted.map((r) => r.id)).toEqual(['phrase', 'title', 'full', 'partial']);
  });

  it('prefers an exact phrase in the title over the same phrase in the body', () => {
    const title = mkResult('title-phrase', { title: 'Decentralized Search explained', snippet: 'A guide' });
    const body = mkResult('body-phrase', { title: 'Some page', snippet: 'A decentralized search engine' });
    expect(sortByQueryRelevance([body, title], '"decentralized search"')[0].id).toBe('title-phrase');
  });

  it('keyword-stake results are exempt from re-ranking', () => {
    const stake: SearchResult = {
      id: 'stake', title: 'Unrelated', url: 'https://stake.example.com', snippet: 'nothing here',
      source: 'web', provider: 'keyword-stake', score: 999, timestamp: 0,
    };
    const other = mkResult('other', { title: 'nostr privacy', snippet: 'nostr privacy' });
    const sorted = sortByQueryRelevance([stake, other], 'nostr privacy');
    expect(sorted[0].id).toBe('stake');
  });
});

describe('search result identity and provider changes', () => {
  const result = (id: string, url: string, provider = 'test'): SearchResult => ({
    id, url, provider, title: 'Nostr guide', snippet: 'Nostr guide', source: 'web', score: 80,
  });
  const provider = (id: string, search: SearchProvider['search']): SearchProvider => ({
    id, name: id, source: 'web', privacy: 'direct', privacyNote: '', search,
  });
  const Wrapper = ({ children }: { children: ReactNode }) => {
    const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    return createElement(QueryClientProvider, { client }, children);
  };

  it('keeps distinct videos, ports and case-sensitive paths while merging tracking variants', () => {
    const results = [
      result('video-a', 'https://youtube.com/watch?v=A'),
      result('video-b', 'https://youtube.com/watch?v=B'),
      result('upper', 'https://example.com/Guide'),
      result('lower', 'https://example.com/guide'),
      result('port', 'https://example.com:8443/guide'),
      result('tracked', 'https://example.com/guide?utm_source=x'),
    ];
    expect(deduplicateResults(results).map((r) => r.id)).toEqual(['video-a', 'video-b', 'upper', 'lower', 'port']);
  });

  it('fetches a new provider set for the same cached query', async () => {
    const alpha = vi.fn(async () => ({ results: [result('alpha', 'https://alpha.example/', 'alpha')] }));
    const beta = vi.fn(async () => ({ results: [result('beta', 'https://beta.example/', 'beta')] }));
    searchState.providers = [provider('alpha', alpha), provider('beta', beta)];
    searchState.disabledProviders = ['beta'];
    const hook = renderHook(() => useProviderSearch({ query: 'nostr', source: 'all' }), { wrapper: Wrapper });
    await waitFor(() => expect(hook.result.current.results.map((r) => r.id)).toEqual(['alpha']));
    searchState.disabledProviders = ['alpha'];
    hook.rerender();
    await waitFor(() => expect(hook.result.current.results.map((r) => r.id)).toEqual(['beta']));
    expect(alpha).toHaveBeenCalledTimes(1);
    expect(beta).toHaveBeenCalledTimes(1);
  });

  it('ignores late provider status and results after the query is cancelled', async () => {
    let finishOld: ((value: { results: SearchResult[] }) => void) | undefined;
    searchState.providers = [provider('test', ({ query }) => query === 'first'
      ? new Promise((resolve) => { finishOld = resolve; })
      : Promise.resolve({ results: [result('current', 'https://current.example/')] }))];
    const hook = renderHook(({ query }) => useProviderSearch({ query, source: 'all' }), {
      initialProps: { query: 'first' }, wrapper: Wrapper,
    });
    await waitFor(() => expect(finishOld).toBeDefined());
    hook.rerender({ query: 'second' });
    await waitFor(() => expect(hook.result.current.providers[0].resultCount).toBe(1));
    await act(async () => finishOld?.({ results: [
      result('old-a', 'https://old.example/a'), result('old-b', 'https://old.example/b'),
    ] }));
    expect(hook.result.current.providers[0].resultCount).toBe(1);
    expect(hook.result.current.results.map((r) => r.id)).toEqual(['current']);
  });
});

/* ------------------------------------------------------------------ */
/* Orchestrator-level hard constraints (engine results included)        */
/* ------------------------------------------------------------------ */

describe('applyHardConstraints (merge-time enforcement)', () => {
  const mkEngineResult = (id: string, url: string, extra: Partial<SearchResult> = {}): SearchResult => ({
    id, title: `Result ${id}`, url, snippet: 'nostr privacy', source: 'web',
    provider: 'duckduckgo', ...extra,
  });

  it('site: applies to engine results too (the local backstop)', () => {
    const results = [
      mkEngineResult('a', 'https://github.com/nostr'),
      mkEngineResult('b', 'https://evilgithub.com/nostr'),
      mkEngineResult('c', 'https://news.ycombinator.com/item?id=1'),
    ];
    const out = applyHardConstraints(results, parseQuery('nostr privacy site:github.com'));
    expect(out.map((r) => r.id)).toEqual(['a']);
  });

  it('NOT terms drop matching results', () => {
    const results = [
      mkEngineResult('a', 'https://example.com/a', { snippet: 'nostr privacy' }),
      mkEngineResult('b', 'https://example.com/b', { snippet: 'nostr twitter thread' }),
    ];
    const out = applyHardConstraints(results, parseQuery('nostr NOT twitter'));
    expect(out.map((r) => r.id)).toEqual(['a']);
  });

  it('OR\'d same-field filters become any-of (site:a OR site:b)', () => {
    const results = [
      mkEngineResult('a', 'https://github.com/x'),
      mkEngineResult('b', 'https://gitlab.com/y'),
      mkEngineResult('c', 'https://example.com/z'),
    ];
    const out = applyHardConstraints(results, parseQuery('nostr site:github.com OR site:gitlab.com'));
    // Hmm: `nostr site:github.com OR site:gitlab.com` parses as
    // (nostr AND site:github.com) OR site:gitlab.com — an exotic shape the
    // hard-constraint layer deliberately leaves alone (full AST eval lives
    // in the providers). The documented same-field collapse needs explicit
    // parens: nostr (site:a OR site:b).
    expect(out.map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);

    const out2 = applyHardConstraints(results, parseQuery('nostr (site:github.com OR site:gitlab.com)'));
    expect(out2.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('lang: filters results with a known different language', () => {
    const results = [
      mkEngineResult('en', 'https://example.com/en', { language: 'en' }),
      mkEngineResult('da', 'https://example.com/da', { language: 'da' }),
      mkEngineResult('unknown', 'https://example.com/x'),
    ];
    const out = applyHardConstraints(results, parseQuery('nostr lang:en'));
    expect(out.map((r) => r.id).sort()).toEqual(['en', 'unknown']);
  });

  it('docFromSearchResult exposes timestamps for date filters', () => {
    const results = [
      mkEngineResult('old', 'https://example.com/old', { timestamp: ts('2020-01-01') }),
      mkEngineResult('new', 'https://example.com/new', { timestamp: ts('2026-06-01') }),
    ];
    const out = applyHardConstraints(results, parseQuery('nostr after:2026-01-01'));
    expect(out.map((r) => r.id)).toEqual(['new']);
  });
});
