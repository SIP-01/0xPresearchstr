/**
 * Engine-AI proxy logic tests — the security-critical invariants of
 * worker.ts, verified without a server runtime.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import worker from '../../../worker';

import {
  buildPublicStatus,
  validateChatPayload,
  buildUpstreamBody,
  sanitizeProviderError,
  verifyAdminAuth,
  parseAdminAction,
  applyAdminAction,
  readEngineConfig,
  writeEngineConfig,
  DEFAULT_ENGINE_MODEL,
  type EngineAIConfig,
  type KVLike,
} from './engineProxy';

const CONFIG: EngineAIConfig = {
  enabled: true,
  endpoint: 'https://api.ppq.ai/v1',
  model: 'qwen/qwen-2.5-7b-instruct',
  apiKey: 'sk-test-secret-key-1234567890abcdef',
  providerName: 'PPQ.ai',
};

/* ─── Status secrecy (spec #5) ─── */

describe('buildPublicStatus', () => {
  it('never includes the API key — only the masked 4-char tail', () => {
    const status = buildPublicStatus(CONFIG);
    const json = JSON.stringify(status);
    expect(json).not.toContain(CONFIG.apiKey);
    expect(json).not.toContain('apiKey');
    expect(status.keyTail).toBe('cdef'); // last 4 only
    expect(status.configured).toBe(true);
    expect(status.enabled).toBe(true);
    expect(status.model).toBe(CONFIG.model);
  });

  it('reports unconfigured when no config exists (fresh clone)', () => {
    expect(buildPublicStatus(null)).toEqual({ configured: false, enabled: false });
  });
});

/* ─── Chat payload validation ─── */

describe('validateChatPayload', () => {
  it('accepts a normal chat request', () => {
    const out = validateChatPayload({ messages: [{ role: 'user', content: 'hi' }] });
    expect(out).toEqual({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 1200 });
  });

  it('rejects non-object bodies, empty/missing messages, bad roles, oversized content', () => {
    expect(typeof validateChatPayload(null)).toBe('string');
    expect(typeof validateChatPayload({})).toBe('string');
    expect(typeof validateChatPayload({ messages: [] })).toBe('string');
    expect(typeof validateChatPayload({ messages: [{ role: 'root', content: 'x' }] })).toBe('string');
    expect(typeof validateChatPayload({ messages: [{ role: 'user', content: '' }] })).toBe('string');
    expect(typeof validateChatPayload({ messages: [{ role: 'user', content: 'x'.repeat(25_000) }] })).toBe('string');
  });

  it('caps max_tokens at the server ceiling', () => {
    const out = validateChatPayload({ messages: [{ role: 'user', content: 'hi' }], max_tokens: 999_999 });
    expect(typeof out).not.toBe('string');
    if (typeof out !== 'string') expect(out.maxTokens).toBe(2000);
  });
});

/* ─── Upstream body: model forced, no client overrides ─── */

describe('buildUpstreamBody', () => {
  it('forces the operator model and modern token param', () => {
    const body = buildUpstreamBody({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 500 }, CONFIG);
    expect(body.model).toBe(CONFIG.model);
    expect(body.max_completion_tokens).toBe(500);
    expect(body).not.toHaveProperty('max_tokens');
    expect(JSON.stringify(body)).not.toContain(CONFIG.apiKey);
  });
});

/* ─── Provider error sanitation (spec #8 + no-leak) ─── */

describe('sanitizeProviderError', () => {
  it('maps statuses to safe messages with no request details', () => {
    expect(sanitizeProviderError(401)).toMatch(/rejected/i);
    expect(sanitizeProviderError(429)).toMatch(/rate/i);
    expect(sanitizeProviderError(500)).toMatch(/unavailable/i);
    expect(sanitizeProviderError(400)).toMatch(/HTTP 400/);
    // None of them can carry a key or payload echo:
    for (const s of [400, 401, 402, 403, 429, 500, 502]) {
      expect(sanitizeProviderError(s)).not.toContain('sk-');
    }
  });
});

/* ─── Admin auth (NIP-98-style signed events) ─── */

describe('verifyAdminAuth', () => {
  const URL_ = 'https://example.com/api/ai/admin';
  const now = 1_800_000_000;

  function signedHeader(sk: Uint8Array, overrides: Record<string, unknown> = {}): string {
    const event = finalizeEvent(
      {
        kind: 27235,
        content: '{}',
        tags: [['u', URL_], ['method', 'POST']],
        created_at: now,
        ...overrides,
      } as Parameters<typeof finalizeEvent>[0],
      sk,
    );
    return `Nostr ${btoa(JSON.stringify(event))}`;
  }

  it('accepts a fresh, correctly-signed event from the owner key', async () => {
    const sk = generateSecretKey();
    const env = { OWNER_PUBKEY: getPublicKey(sk) };
    const result = await verifyAdminAuth(signedHeader(sk), URL_, env, now);
    expect(result.ok).toBe(true);
  });

  it('rejects non-owner keys, stale events, wrong URL/method, bad signatures, missing config', async () => {
    const ownerSk = generateSecretKey();
    const otherSk = generateSecretKey();
    const env = { OWNER_PUBKEY: getPublicKey(ownerSk) };

    // Wrong signer
    expect((await verifyAdminAuth(signedHeader(otherSk), URL_, env, now)).ok).toBe(false);
    // Stale
    expect((await verifyAdminAuth(signedHeader(ownerSk, { created_at: now - 1000 }), URL_, env, now)).ok).toBe(false);
    // Wrong URL tag
    expect((await verifyAdminAuth(signedHeader(ownerSk, { tags: [['u', 'https://evil.com'], ['method', 'POST']] }), URL_, env, now)).ok).toBe(false);
    // Wrong method
    expect((await verifyAdminAuth(signedHeader(ownerSk, { tags: [['u', URL_], ['method', 'GET']] }), URL_, env, now)).ok).toBe(false);
    // Tampered content after signing → signature invalid
    const event = JSON.parse(atob(signedHeader(ownerSk).slice(6)));
    event.content = '{"action":"clear"}';
    expect((await verifyAdminAuth(`Nostr ${btoa(JSON.stringify(event))}`, URL_, env, now)).ok).toBe(false);
    // No owner configured on the deployment
    expect((await verifyAdminAuth(signedHeader(ownerSk), URL_, {}, now)).ok).toBe(false);
    // No header at all
    expect((await verifyAdminAuth(null, URL_, env, now)).ok).toBe(false);
  });
});

/* ─── Admin actions ─── */

describe('parseAdminAction', () => {
  it('validates set/clear/set-enabled shapes', () => {
    expect(parseAdminAction('not json')).toBe('Action payload must be JSON');
    expect(parseAdminAction('{"action":"set"}')).toBe('apiKey looks too short');
    expect(parseAdminAction('{"action":"set","apiKey":"sk-long-enough","endpoint":"http://insecure.example.com"}')).toBe('endpoint must be https://');
    expect(parseAdminAction('{"action":"nope"}')).toBe('Unknown action');
    expect(parseAdminAction('{"action":"set-enabled"}')).toBe('enabled must be a boolean');

    const good = parseAdminAction('{"action":"set","apiKey":"sk-long-enough-key","model":"m","endpoint":"https://api.example.com/v1"}');
    expect(typeof good).not.toBe('string');
  });
});

describe('applyAdminAction', () => {
  it('set writes a full config; clear deletes; set-enabled toggles (spec #7)', () => {
    const set = applyAdminAction(null, { action: 'set', apiKey: 'sk-new-key-here' });
    expect(set).not.toBeNull();
    if (set && typeof set !== 'string') {
      expect(set.apiKey).toBe('sk-new-key-here');
      expect(set.model).toBe(DEFAULT_ENGINE_MODEL);
      expect(set.enabled).toBe(true);
    }

    const toggled = applyAdminAction(CONFIG, { action: 'set-enabled', enabled: false });
    expect(toggled).toEqual({ ...CONFIG, enabled: false });

    expect(applyAdminAction(CONFIG, { action: 'clear' })).toBeNull();
    // Clearing → buildPublicStatus reports unconfigured → engine AI off.
    expect(buildPublicStatus(null).configured).toBe(false);

    // Toggle without a config is a graceful error, not a crash.
    expect(typeof applyAdminAction(null, { action: 'set-enabled', enabled: true })).toBe('string');
  });
});

/* ─── Config storage: KV wins over env (and never leaks) ─── */

describe('readEngineConfig / writeEngineConfig', () => {
  function fakeKV(): KVLike & { store: Map<string, string> } {
    const store = new Map<string, string>();
    return {
      store,
      get: async (k) => store.get(k) ?? null,
      put: async (k, v) => void store.set(k, v),
      delete: async (k) => void store.delete(k),
    };
  }

  it('returns null with nothing configured (fresh clone)', async () => {
    expect(await readEngineConfig({})).toBeNull();
  });

  it('env-var config works without KV', async () => {
    const cfg = await readEngineConfig({ AI_API_KEY: 'sk-env-key' });
    expect(cfg?.apiKey).toBe('sk-env-key');
    expect(cfg?.model).toBe(DEFAULT_ENGINE_MODEL);
  });

  it('KV config takes precedence over env vars', async () => {
    const kv = fakeKV();
    await writeEngineConfig(kv, CONFIG);
    const cfg = await readEngineConfig({ AI_CONFIG_KV: kv, AI_API_KEY: 'sk-env-key' });
    expect(cfg?.apiKey).toBe(CONFIG.apiKey);
  });

  it('writeEngineConfig(false-y KV) reports no-op instead of throwing', async () => {
    expect(await writeEngineConfig(undefined, CONFIG)).toBe(false);
  });
});

describe('cross-origin admin writes', () => {
  it('includes CORS on a successful authenticated save after the preflight', async () => {
    const url = 'https://engine.example/api/ai/admin';
    const origin = 'https://presearchstr.com';
    const secret = generateSecretKey();
    const store = new Map<string, string>();
    const env = {
      OWNER_PUBKEY: getPublicKey(secret),
      AI_CONFIG_KV: {
        get: async (key: string) => store.get(key) ?? null,
        put: async (key: string, value: string) => { store.set(key, value); },
        delete: async (key: string) => { store.delete(key); },
      },
    };
    const event = finalizeEvent({
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['u', url], ['method', 'POST']],
      content: JSON.stringify({ action: 'set', apiKey: CONFIG.apiKey, endpoint: CONFIG.endpoint, model: CONFIG.model }),
    }, secret);

    const preflight = await worker.fetch(new Request(url, {
      method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
    }), env);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(origin);

    const response = await worker.fetch(new Request(url, {
      method: 'POST', headers: { Origin: origin, Authorization: `Nostr ${btoa(JSON.stringify(event))}` },
    }), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(store.size).toBe(1);
    expect(await response.json()).toMatchObject({ ok: true, status: { configured: true } });
  });
});

describe('Precommunity keyword ads proxy', () => {
  const env = { KEYWORD_MARKET_API_KEY: 'pkm-fake-server-secret' };
  const ad = {
    headline: 'Bitcoin community',
    description: 'Learn about Bitcoin.',
    url: 'https://bitcoin.org/',
    clickUrl: 'https://precommunity.org/api/v1/keyword-market/revisions/test/click?delivery=opaque-token',
    reportUrl: 'https://precommunity.org/keyword-market/reports/test',
  };
  let requestNumber = 0;

  function request(q: string | null = 'bitcoin', init: RequestInit = {}): Request {
    const url = new URL('https://engine.example/api/ads/precommunity');
    if (q !== null) url.searchParams.set('q', q);
    const headers = new Headers(init.headers);
    if (!headers.has('CF-Connecting-IP')) headers.set('CF-Connecting-IP', `ads-test-${++requestNumber}`);
    return new Request(url, { ...init, headers });
  }

  function mockResponse(body: unknown = { ad }, status = 200) {
    const upstream = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal('fetch', upstream);
    return upstream;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('forwards only encoded q to the fixed endpoint with a server-only key and no redirects', async () => {
    const upstream = mockResponse({ ad, apiKey: env.KEYWORD_MARKET_API_KEY });
    const origin = 'https://presearchstr.com';
    const incoming = request('  bitcoin & lightning/#ą  ', { headers: { Origin: origin } });
    const response = await worker.fetch(incoming, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ad });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(response.headers.get('Vary')).toBe('Origin');
    expect(upstream).toHaveBeenCalledOnce();
    const [target, init] = upstream.mock.calls[0];
    expect(String(target)).toBe('https://precommunity.org/api/v1/keyword-market/resolve?q=bitcoin+%26+lightning%2F%23%C4%85');
    expect(new Headers(init?.headers).get('X-API-Key')).toBe(env.KEYWORD_MARKET_API_KEY);
    expect(new Headers(init?.headers).get('Accept')).toBe('application/json');
    expect(init?.redirect).toBe('manual');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([null, '', '   ', 'x'.repeat(401), 'nsec1never-send-a-secret'])('rejects invalid query %j before an upstream call', async (q) => {
    const upstream = mockResponse();
    const response = await worker.fetch(request(q), env);
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('accepts exactly 400 query characters', async () => {
    const upstream = mockResponse({ ad: null });
    const response = await worker.fetch(request('x'.repeat(400)), env);
    expect(response.status).toBe(200);
    expect(new URL(String(upstream.mock.calls[0][0])).searchParams.get('q')).toHaveLength(400);
  });

  it('returns no ad when the provider has no match', async () => {
    mockResponse({ ad: null });
    const response = await worker.fetch(request(), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ad: null });
  });

  it('does not call upstream when the server secret is absent', async () => {
    const upstream = mockResponse();
    const response = await worker.fetch(request(), {});
    expect(response.status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain(env.KEYWORD_MARKET_API_KEY);
  });

  it.each([
    {},
    { ad: { ...ad, headline: 123 } },
    { ad: { ...ad, url: 'javascript:alert(1)' } },
    { ad: { ...ad, url: 'http://bitcoin.org/' } },
    { ad: { ...ad, url: 'https://127.0.0.1/' } },
    { ad: { ...ad, clickUrl: 'https://precommunity.org.evil.example/click' } },
    { ad: { ...ad, reportUrl: 'https://evil.example/report' } },
    { ad: { ...ad, clickUrl: 'https://username:password@precommunity.org/click' } },
    { ad: { ...ad, headline: env.KEYWORD_MARKET_API_KEY } },
  ])('rejects invalid or secret-bearing ad payloads', async (body) => {
    mockResponse(body);
    const response = await worker.fetch(request(), env);
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).not.toContain(env.KEYWORD_MARKET_API_KEY);
    expect(text).not.toContain('javascript:');
    expect(text).not.toContain('evil.example');
  });

  it('handles invalid provider JSON without echoing it', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(env.KEYWORD_MARKET_API_KEY)));
    const response = await worker.fetch(request(), env);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(env.KEYWORD_MARKET_API_KEY);
  });

  it.each([301, 302, 303, 307, 308, 401, 403, 429, 500, 502])('sanitizes provider HTTP %i errors', async (status) => {
    mockResponse({ error: `provider echoed ${env.KEYWORD_MARKET_API_KEY}` }, status);
    const response = await worker.fetch(request(), env);
    expect(response.status).toBe(status === 429 ? 429 : 502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).not.toContain(env.KEYWORD_MARKET_API_KEY);
  });

  it('sanitizes network failures', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error(env.KEYWORD_MARKET_API_KEY)));
    const response = await worker.fetch(request(), env);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(env.KEYWORD_MARKET_API_KEY);
  });

  it.each(['timeout', 'request'] as const)('cancels upstream on %s abort', async (reason) => {
    const timeout = new AbortController();
    const incoming = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    let forwardedSignal: AbortSignal | null | undefined;
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      forwardedSignal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }));
    const pending = worker.fetch(request('bitcoin', { signal: incoming.signal }), env);
    (reason === 'timeout' ? timeout : incoming).abort();
    const response = await pending;
    expect(timeoutSpy).toHaveBeenCalledWith(5_000);
    expect(forwardedSignal?.aborted).toBe(true);
    expect(response.status).toBe(502);
  });

  it('limits ad lookups independently of search requests', async () => {
    const upstream = mockResponse({ ad: null });
    const ip = `rate-test-${++requestNumber}`;
    for (let i = 0; i < 20; i++) {
      const response = await worker.fetch(request('bitcoin', { headers: { 'CF-Connecting-IP': ip } }), env);
      expect(response.status).toBe(200);
    }
    const response = await worker.fetch(request('bitcoin', { headers: { 'CF-Connecting-IP': ip } }), env);
    expect(response.status).toBe(429);
    expect(upstream).toHaveBeenCalledTimes(20);

    const searchResponse = await worker.fetch(new Request('https://engine.example/api/search/brave?q=bitcoin', {
      headers: { 'CF-Connecting-IP': ip },
    }), { BRAVE_API_KEY: 'brave-fake-key' });
    expect(searchResponse.status).toBe(200);
  });

  it('rejects unapproved origins before contacting the provider', async () => {
    const upstream = mockResponse();
    for (const method of ['GET', 'OPTIONS']) {
      const response = await worker.fetch(request('bitcoin', { method, headers: { Origin: 'https://evil.example' } }), env);
      expect(response.status).toBe(403);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it('allows same-origin requests and approved CORS preflights', async () => {
    const upstream = mockResponse();
    const sameOrigin = await worker.fetch(request('bitcoin', { headers: { Origin: 'https://engine.example' } }), env);
    expect(sameOrigin.status).toBe(200);
    const preflight = await worker.fetch(request('bitcoin', {
      method: 'OPTIONS', headers: { Origin: 'https://presearchstr.com', 'Access-Control-Request-Method': 'GET' },
    }), env);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('https://presearchstr.com');
    expect(upstream).toHaveBeenCalledOnce();
  });

  it('rejects unsupported methods instead of returning the SPA', async () => {
    const upstream = mockResponse();
    const response = await worker.fetch(request('bitcoin', { method: 'POST', headers: { Origin: 'https://presearchstr.com' } }), env);
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://presearchstr.com');
    expect(upstream).not.toHaveBeenCalled();
  });
});
