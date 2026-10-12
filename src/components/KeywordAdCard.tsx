/**
 * Keyword ad card — renders a contract-backed PRE keyword-market ad
 * (resolved via /api/ads/resolve) with a clearly-labeled "Ad" badge.
 *
 * Styling mirrors StakeResultCard (top-of-page placement treatment) but
 * uses an amber tint + "Ad" label so paid placement is visually distinct
 * from the blue "Staked" community keyword stakes. Links go through the
 * one-time clickUrl (records the click, then redirects to the destination);
 * reportUrl is always exposed as a "Report ad" link.
 */
import { ExternalLink, Flag, Gem, Megaphone } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { KeywordAd } from '@/lib/keywordAds';
import { cn } from '@/lib/utils';

interface KeywordAdCardProps {
  ad: KeywordAd;
  className?: string;
}

function displayHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export function KeywordAdCard({ ad, className }: KeywordAdCardProps) {
  return (
    <div
      className={cn(
        'p-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.04]',
        'hover:border-amber-500/40 hover:bg-amber-500/[0.07] transition-all duration-200',
        className,
      )}
    >
      {/* URL line */}
      <div className="flex items-center gap-2 mb-1.5">
        <Megaphone className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
        <a
          href={ad.clickUrl}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="text-xs text-muted-foreground font-mono truncate hover:text-foreground transition-colors"
        >
          {displayHost(ad.url)}
        </a>
        <ExternalLink className="w-3 h-3 text-muted-foreground/40 shrink-0" />
        <span className="flex items-center gap-1.5 ml-auto shrink-0">
          <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-500">
            Ad
          </Badge>
        </span>
      </div>

      {/* Headline + description — click through the one-time clickUrl */}
      <a href={ad.clickUrl} target="_blank" rel="noopener noreferrer sponsored" className="block group">
        <h3 className="font-semibold text-foreground group-hover:text-amber-600 dark:group-hover:text-amber-500 transition-colors mb-1 line-clamp-2 text-sm">
          {ad.headline}
        </h3>
        {ad.description && (
          <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">
            {ad.description}
          </p>
        )}
      </a>

      {/* Report link — always exposed, opens the public report form. The
          "Stake this keyword" link cross-links the PREcommunity keyword
          market so users can discover the staking/DAO side of the ad. */}
      <div className="flex items-center gap-2 mt-2.5 text-xs text-muted-foreground/70">
        <span>keyword ad · PRE keyword market</span>
        <span className="ml-auto inline-flex items-center gap-3 shrink-0">
          <a
            href="https://precommunity.org/keyword-market"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-muted-foreground/70 hover:text-foreground transition-colors"
          >
            <Gem className="w-3 h-3" />
            Stake this keyword →
          </a>
          <a
            href={ad.reportUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-muted-foreground/70 hover:text-foreground transition-colors"
          >
            <Flag className="w-3 h-3" />
            Report ad
          </a>
        </span>
      </div>
    </div>
  );
}
