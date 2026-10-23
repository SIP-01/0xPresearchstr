/**
 * Traffic-light privacy indicator — shows, at a glance, who can see
 * the current search before the user hits enter.
 *
 *   🟢 Nostr only — search queries go to Nostr relays
 *   🟡 Mixed — direct APIs (Wikipedia, HN, Algolia…) see the query
 *   🔴 Proxied — a proxy or advertising backend sees the query
 *
 * Clicking opens a popover with an honest per-provider breakdown and
 * a shortcut to the Privacy Mode toggle in Settings.
 */
import { Link } from 'react-router-dom';
import { ShieldCheck, ShieldAlert, ShieldX, Settings2, BookOpen } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { useAppContext } from '@/hooks/useAppContext';
import { getProvidersForPrivacy, getProvidersForSource } from '@/lib/providers/registry';
import type { PrivacyTier, SearchProvider, SearchSource } from '@/lib/providers/types';
import { cn } from '@/lib/utils';

interface PrivacyIndicatorProps {
  /** The active source tab — determines which providers would run. */
  source: SearchSource | 'all';
  /** Whether the submitted query and source permit keyword advertising. */
  precommunityEligible?: boolean;
  className?: string;
}

const TIER_META: Record<PrivacyTier, {
  label: string;
  short: string;
  dot: string;
  text: string;
  border: string;
  icon: React.ReactNode;
  description: string;
}> = {
  nostr: {
    label: 'Nostr',
    short: 'Nostr',
    dot: 'bg-green-500',
    text: 'text-green-600 dark:text-green-500',
    border: 'border-green-500/30',
    icon: <ShieldCheck className="w-3.5 h-3.5" />,
    description: 'Queries go to Nostr relays over WebSocket. Relay operators see the query and your IP address.',
  },
  direct: {
    label: 'Mixed',
    short: 'Mixed',
    dot: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-500',
    border: 'border-amber-500/30',
    icon: <ShieldAlert className="w-3.5 h-3.5" />,
    description: 'Some providers query public APIs directly (Wikipedia, Hacker News, Stack Exchange). Those operators see the query + your IP in standard server logs.',
  },
  proxied: {
    label: 'Proxy active',
    short: 'Proxied',
    dot: 'bg-red-500',
    text: 'text-red-600 dark:text-red-500',
    border: 'border-red-500/30',
    icon: <ShieldX className="w-3.5 h-3.5" />,
    description: 'Some services receive this search through a CORS proxy or deployment backend. That intermediary sees the query in plaintext.',
  },
};

const TIER_RANK: Record<PrivacyTier, number> = { nostr: 0, direct: 1, proxied: 2 };

function worstTier(providers: SearchProvider[]): PrivacyTier {
  let worst: PrivacyTier = 'nostr';
  for (const p of providers) {
    if (TIER_RANK[p.privacy] > TIER_RANK[worst]) worst = p.privacy;
  }
  return worst;
}

export function PrivacyIndicator({ source, precommunityEligible = false, className }: PrivacyIndicatorProps) {
  const { config } = useAppContext();
  const privacyMode = config.privacyMode;

  const active = getProvidersForPrivacy(source, privacyMode)
    .filter((p) => !config.disabledProviders.includes(p.id))
    .filter((p) => p.id !== 'keyword-stakes' || config.npubKeywordStaking);
  const suppressed = privacyMode
    ? getProvidersForSource(source).filter((p) => !config.disabledProviders.includes(p.id) && !active.some((a) => a.id === p.id) && (p.id !== 'keyword-stakes' || config.npubKeywordStaking))
    : [];
  const precommunityActive = precommunityEligible;
  const adException = precommunityActive && privacyMode;

  const tier = precommunityActive ? 'proxied' : worstTier(active);
  const meta = TIER_META[tier];
  const label = adException ? 'Nostr' : meta.label;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors',
            meta.border,
            meta.text,
            'hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
          aria-label={`Privacy status: ${label}. Click for details.`}
        >
          <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', meta.dot, 'animate-search-pulse')} />
          {meta.icon}
          <span className="hidden sm:inline">{label}</span>
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="p-4 pb-3 border-b border-border/50">
          <div className="flex items-center gap-2 mb-1.5">
            <span className={cn('w-2 h-2 rounded-full', meta.dot)} />
            <span className={cn('text-sm font-semibold', meta.text)}>{label}</span>
            {privacyMode && (
              <Badge variant="outline" className="text-[10px] border-green-500/30 text-green-600 dark:text-green-500">
                Privacy Mode
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {adException
              ? 'Nostr handles organic search. AI is off; platform keyword staking (PRE ads) remains enabled.'
              : meta.description}
          </p>
        </div>

        {/* Active providers */}
        <div className="p-3 space-y-1 max-h-56 overflow-y-auto">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 px-1 mb-1.5">
            Who sees this search
          </p>
          {precommunityActive && (
            <div className="flex items-start gap-2 px-1 py-1">
              <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 bg-red-500" />
              <div className="min-w-0">
                <span className="text-xs font-medium text-foreground">Keyword staking (PRE community)</span>
                <p className="text-[11px] text-muted-foreground/80 leading-snug">
                  PRE community, the community around the PRE token, resolves blockchain keyword ads from your query through our backend.
                  No Nostr account or browser cookies are sent. Clicks are counted.
                </p>
              </div>
            </div>
          )}
          {active.map((p) => (
            <div key={p.id} className="flex items-start gap-2 px-1 py-1">
              <span className={cn('w-1.5 h-1.5 rounded-full mt-1.5 shrink-0', TIER_META[p.privacy].dot)} />
              <div className="min-w-0">
                <span className="text-xs font-medium text-foreground">{p.name}</span>
                <p className="text-[11px] text-muted-foreground/80 leading-snug">{p.privacyNote}</p>
              </div>
            </div>
          ))}

          {suppressed.length > 0 && (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 px-1 pt-2 mb-1">
                Blocked by Privacy Mode
              </p>
              {suppressed.map((p) => (
                <div key={p.id} className="flex items-center gap-2 px-1 py-0.5 opacity-50">
                  <ShieldCheck className="w-3 h-3 text-green-600 dark:text-green-500 shrink-0" />
                  <span className="text-xs text-muted-foreground line-through">{p.name}</span>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2 p-3 pt-2 border-t border-border/50">
          <Link
            to="/settings"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Settings2 className="w-3 h-3" />
            {privacyMode ? 'Privacy settings' : 'Enable Privacy Mode'}
          </Link>
          <span className="text-border">·</span>
          <Link
            to="/about"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <BookOpen className="w-3 h-3" />
            Threat model
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
