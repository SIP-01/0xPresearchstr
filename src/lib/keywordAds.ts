/**
 * Keyword Ads — Presearch-style keyword ads backed by the on-chain PRE
 * keyword market (PREKeywordMarketV1 on Base), resolved through the
 * PREcommunity resolver and the same-origin worker proxy:
 *
 *   browser → GET /api/ads/resolve?q=…  (worker injects X-API-Key)
 *           → https://precommunity.org/api/v1/keyword-market/resolve
 *
 * The integration key lives only in the worker secret
 * (PRECOMMUNITY_ADS_API_KEY) — it never touches the bundle.
 *
 * COEXISTENCE / PRECEDENCE with Nostr keyword stakes (keywordStakes.ts):
 * these are two independent keyword-placement systems. Nostr stakes
 * (provider 'keyword-stake', kind 'Staked') are community-signed UGC read
 * from relays; contract-backed ads are paid placement settled on-chain.
 * Both may match the same query — the UI renders the contract ad ABOVE
 * the Nostr stakes (see Index.tsx), and either renders alone when the
 * other is absent. This module never touches stake results.
 *
 * Degradation: no ad, 503 (unconfigured worker route — e.g. GitHub Pages
 * deploys), rate limit, network error → `null`. Callers render nothing.
 */
import { sanitizeUrl } from '@/lib/sanitizeUrl';

/** The documented resolver ad payload (see precommunity.org keyword-market docs). */
export interface KeywordAd {
  headline: string;
  description: string;
  /** One-time click URL — records the click, then 302s to `url`. Link through this. */
  clickUrl: string;
  /** The ad's final HTTPS destination (display only). */
  url: string;
  /** Public "Report ad" form on precommunity.org. */
  reportUrl: string;
}

interface ResolveResponse {
  ad?: unknown;
}

/** Validate + sanitize the worker/upstream payload into a renderable ad. */
function parseAd(raw: unknown): KeywordAd | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const a = raw as Record<string, unknown>;
  const headline = typeof a.headline === 'string' ? a.headline.trim() : '';
  const description = typeof a.description === 'string' ? a.description.trim() : '';
  const clickUrl = typeof a.clickUrl === 'string' ? sanitizeUrl(a.clickUrl) : '';
  const url = typeof a.url === 'string' ? sanitizeUrl(a.url) : '';
  const reportUrl = typeof a.reportUrl === 'string' ? sanitizeUrl(a.reportUrl) : '';
  if (!headline || !clickUrl || !url || !reportUrl) return null;
  return { headline, description, clickUrl, url, reportUrl };
}

/**
 * Resolve a contract-backed keyword ad for a search query.
 * Returns null (never throws) when there is no ad or the route is
 * unavailable — ads are an enhancement, never a blocker for search.
 */
export async function resolveKeywordAd(query: string, signal?: AbortSignal): Promise<KeywordAd | null> {
  const q = query.trim().slice(0, 200);
  if (!q) return null;

  let res: Response;
  try {
    res = await fetch(`/api/ads/resolve?q=${encodeURIComponent(q)}`, {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6_000)]) : AbortSignal.timeout(6_000),
      headers: { Accept: 'application/json' },
    });
  } catch {
    return null;
  }

  // 503 = worker route not configured (no key / static-only deploy),
  // 429 = rate limited, 404 = route absent (GitHub Pages). All silent.
  if (!res.ok) return null;

  try {
    const data = (await res.json()) as ResolveResponse;
    return parseAd(data.ad);
  } catch {
    return null;
  }
}
