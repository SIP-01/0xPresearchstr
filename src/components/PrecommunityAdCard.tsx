import { ExternalLink, Flag, Gem, Globe } from 'lucide-react';

import type { PrecommunityAd, PublicKeywordStake } from '@/lib/precommunity';
import { PRECOMMUNITY_MARKET_URL, shortStakeAddress } from '@/lib/precommunity';
import { cn } from '@/lib/utils';

interface PrecommunityAdCardProps {
  ad: PrecommunityAd;
  stake?: PublicKeywordStake | null;
  className?: string;
}

function StakeFacts({ stake }: { stake: PublicKeywordStake }) {
  return (
    <p className="mt-2 break-words text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{stake.keyword}</span>
      {' · '}
      {stake.stakePre} PRE staked · rank #{stake.rank} · {stake.bidUsd} per click
      {stake.synced ? ' · chain synced on Base' : ''}
    </p>
  );
}

export function PrecommunityAdCard({ ad, stake = null, className }: PrecommunityAdCardProps) {
  const domain = new URL(ad.url).hostname.replace(/^www\./, '');

  return (
    <article
      aria-label="Keyword staking result"
      className={cn(
        'rounded-xl border border-primary/25 bg-primary/[0.04] p-4',
        'motion-safe:transition-colors motion-safe:duration-200 hover:border-primary/40',
        className,
      )}
    >
      <a
        href={ad.clickUrl}
        target="_blank"
        rel="noopener noreferrer sponsored"
        className="group block min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
      >
        <div className="mb-2 flex items-center gap-2 flex-wrap">
          <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{domain}</span>
          <span className="shrink-0 rounded-md border border-primary/30 px-2 py-0.5 text-xs font-medium text-primary">
            Keyword staking
          </span>
        </div>
        <h3 className="mb-1 flex items-start gap-2 font-semibold text-sm text-foreground group-hover:text-primary">
          <span className="min-w-0 break-words line-clamp-2">{ad.headline}</span>
          <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </h3>
        <p className="break-words text-sm text-muted-foreground line-clamp-3 leading-relaxed">{ad.description}</p>
        {stake && <StakeFacts stake={stake} />}
      </a>
      <div className="mt-3 flex justify-end">
        <a
          href={ad.reportUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:underline decoration-2 underline-offset-4"
          aria-label="Report this ad to Precommunity"
        >
          <Flag className="h-3.5 w-3.5" aria-hidden="true" />
          Report
        </a>
      </div>
    </article>
  );
}

export function PublicKeywordStakeCard({ stake, className }: { stake: PublicKeywordStake; className?: string }) {
  const href = stake.txUrl || PRECOMMUNITY_MARKET_URL;
  const staker = shortStakeAddress(stake.stakerAddress);

  return (
    <article
      aria-label="Keyword staking result"
      className={cn(
        'rounded-xl border border-primary/25 bg-primary/[0.04] p-4',
        'motion-safe:transition-colors motion-safe:duration-200 hover:border-primary/40',
        className,
      )}
    >
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="group block min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
      >
        <div className="mb-2 flex items-center gap-2 flex-wrap">
          <Gem className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
            {staker || 'PRE keyword'}
          </span>
          <span className="shrink-0 rounded-md border border-primary/30 px-2 py-0.5 text-xs font-medium text-primary">
            Keyword staking
          </span>
        </div>
        <h3 className="mb-1 flex items-start gap-2 font-semibold text-sm text-foreground group-hover:text-primary">
          <span className="min-w-0 break-words line-clamp-2">{stake.keyword}</span>
          <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </h3>
        <p className="break-words text-sm text-muted-foreground leading-relaxed">
          {stake.stakePre} PRE staked · rank #{stake.rank} · {stake.bidUsd} per click
          {stake.synced ? '. Chain synced on Base.' : '.'}
        </p>
      </a>
    </article>
  );
}

export function PrecommunityAdInvite({ keyword, className }: { keyword: string; className?: string }) {
  return (
    <aside
      aria-label="Keyword staking"
      className={cn('rounded-xl border border-dashed border-primary/25 bg-primary/[0.04] p-4', className)}
    >
      <div className="flex items-start gap-3">
        <Gem className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="mb-1 text-sm font-semibold text-foreground">Stake this keyword</h3>
          <p className="break-words text-sm text-muted-foreground leading-relaxed">
            Promote your website for &ldquo;{keyword}&rdquo; with keyword staking.
          </p>
          <a
            href={PRECOMMUNITY_MARKET_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:underline decoration-2 underline-offset-4"
          >
            Keyword staking
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </a>
        </div>
      </div>
    </aside>
  );
}
