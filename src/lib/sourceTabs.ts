import { Layers, Zap, Globe, Shield, Network, BookOpen, Newspaper, Code, Database, type LucideIcon } from 'lucide-react';
import type { SearchSource } from '@/lib/providers/types';

export type SourceTabValue = SearchSource | 'all' | 'index' | 'i2p';

export interface SourceTabMeta {
  id: SourceTabValue;
  label: string;
  icon: LucideIcon;
  color: string;
  activeColor: string;
}

/** All known tabs — display metadata. Order/visibility come from tabConfig. */
export const ALL_SOURCE_TABS: SourceTabMeta[] = [
  {
    id: 'web',
    label: 'Web',
    icon: Globe,
    color: 'text-muted-foreground/70 hover:text-foreground',
    activeColor: 'text-[var(--primary)] bg-[var(--primary)]/10 border-[var(--primary)]/30',
  },
  {
    id: 'index',
    label: 'Index',
    icon: Database,
    color: 'text-muted-foreground/70 hover:text-foreground',
    activeColor: 'text-[var(--primary)] bg-[var(--primary)]/10 border-[var(--primary)]/30',
  },
  {
    id: 'all',
    label: 'All',
    icon: Layers,
    color: 'text-muted-foreground/70 hover:text-foreground',
    activeColor: 'text-[var(--primary)] bg-[var(--primary)]/10 border-[var(--primary)]/30',
  },
  {
    id: 'nostr',
    label: 'Nostr',
    icon: Zap,
    color: 'text-muted-foreground/70 hover:text-foreground',
    activeColor: 'text-[var(--primary)] bg-[var(--primary)]/10 border-[var(--primary)]/30',
  },
  {
    id: 'wiki',
    label: 'Wiki',
    icon: BookOpen,
    color: 'text-muted-foreground/70 hover:text-foreground',
    activeColor: 'text-[var(--primary)] bg-[var(--primary)]/10 border-[var(--primary)]/30',
  },
  {
    id: 'news',
    label: 'News',
    icon: Newspaper,
    color: 'text-muted-foreground/70 hover:text-foreground',
    activeColor: 'text-[var(--primary)] bg-[var(--primary)]/10 border-[var(--primary)]/30',
  },
  {
    id: 'code',
    label: 'Code',
    icon: Code,
    color: 'text-muted-foreground/70 hover:text-foreground',
    activeColor: 'text-[var(--primary)] bg-[var(--primary)]/10 border-[var(--primary)]/30',
  },
  {
    id: 'tor',
    label: 'Tor',
    icon: Shield,
    color: 'text-muted-foreground/70 hover:text-foreground',
    activeColor: 'text-[var(--primary)] bg-[var(--primary)]/10 border-[var(--primary)]/30',
  },
  {
    id: 'i2p',
    label: 'I2P',
    icon: Network,
    color: 'text-muted-foreground/70 hover:text-foreground',
    activeColor: 'text-[var(--primary)] bg-[var(--primary)]/10 border-[var(--primary)]/30',
  },
];

/**
 * Out-of-the-box tab configuration: Web first (community index + clearnet
 * search). Wiki and Code tabs stay on thanks to the Nostr-native providers
 * (NIP-54 wiki pool, NIP-34 git pool); the clearnet engines behind them
 * (Wikipedia, Stack Overflow) stay off until enabled. Dark-net tabs stay
 * off — all restorable in Settings → Search Tabs.
 */
export const DEFAULT_TAB_CONFIG = {
  order: ALL_SOURCE_TABS.map((t) => t.id) as string[],
  hidden: ['tor', 'i2p'],
  defaultTab: 'web',
};
