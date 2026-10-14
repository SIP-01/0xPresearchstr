import { sanitizePublicUrl } from './sanitizeUrl';

export const PRECOMMUNITY_MARKET_URL = 'https://precommunity.org/keyword-market';
export const PRECOMMUNITY_RESOLVE_URL = 'https://precommunity.org/api/v1/keyword-market/resolve';

export interface PrecommunityAd {
  headline: string;
  description: string;
  url: string;
  clickUrl: string;
  reportUrl: string;
}

export interface PrecommunityResponse {
  ad: PrecommunityAd | null;
}

/** Whitelist the delivery fields at both the server and browser boundaries. */
export function parsePrecommunityResponse(value: unknown): PrecommunityResponse | undefined {
  if (!value || typeof value !== 'object' || !('ad' in value)) return undefined;
  const { ad } = value;
  if (ad === null) return { ad: null };
  if (!ad || typeof ad !== 'object') return undefined;
  if (
    !('headline' in ad) || typeof ad.headline !== 'string' || !ad.headline.trim()
    || !('description' in ad) || typeof ad.description !== 'string'
    || !('url' in ad) || typeof ad.url !== 'string'
    || !('clickUrl' in ad) || typeof ad.clickUrl !== 'string'
    || !('reportUrl' in ad) || typeof ad.reportUrl !== 'string'
  ) return undefined;

  const url = sanitizePublicUrl(ad.url);
  const clickUrl = sanitizePublicUrl(ad.clickUrl);
  const reportUrl = sanitizePublicUrl(ad.reportUrl);
  if (!url || !clickUrl || !reportUrl) return undefined;

  const destination = new URL(url);
  const click = new URL(clickUrl);
  const report = new URL(reportUrl);
  if (
    destination.username || destination.password
    || click.username || click.password || click.origin !== 'https://precommunity.org'
    || report.username || report.password || report.origin !== 'https://precommunity.org'
  ) return undefined;

  return {
    ad: { headline: ad.headline, description: ad.description, url, clickUrl, reportUrl },
  };
}
