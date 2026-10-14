import { cn } from '@/lib/utils';
import { useAppContext } from '@/hooks/useAppContext';
import { ALL_SOURCE_TABS, type SourceTabValue, type SourceTabMeta } from '@/lib/sourceTabs';
export type { SourceTabValue } from '@/lib/sourceTabs';

interface SourceTabsProps {
  value: SourceTabValue;
  onChange: (source: SourceTabValue) => void;
  className?: string;
  /** Optional result counts to show in badges. */
  counts?: Partial<Record<SourceTabValue, number>>;
}

const TAB_BY_ID = new Map(ALL_SOURCE_TABS.map((t) => [t.id, t]));

/**
 * The tab bar. Renders the user's configured tabs (order + visibility from
 * Settings → Search Tabs; defaults hide Tor/I2P and start on Web).
 */
export function SourceTabs({ value, onChange, className, counts }: SourceTabsProps) {
  const { config } = useAppContext();
  const { order, hidden } = config.tabConfig;

  // Configured order, visible only, metadata-resolved. Unknown ids are skipped;
  // known tabs missing from a stored (older) order append at the end.
  const visible = [
    ...order.filter((id) => !hidden.includes(id)),
    ...ALL_SOURCE_TABS.map((t) => t.id as string).filter((id) => !order.includes(id) && !hidden.includes(id)),
  ]
    .map((id) => TAB_BY_ID.get(id as SourceTabValue))
    .filter((t): t is SourceTabMeta => t !== undefined);

  // Safety: if a stored config hid everything, fall back to the full default set.
  const sources = visible.length > 0
    ? [...visible]
    : ALL_SOURCE_TABS.filter((t) => t.id === 'web' || t.id === 'all');

  // Deep links win: if the active tab is hidden, still render it (highlighted).
  if (!sources.some((s) => s.id === value)) {
    const active = TAB_BY_ID.get(value);
    if (active) sources.push(active);
  }

  return (
    // These are filter buttons, not ARIA tabs (there are no tabpanels), so
    // they keep honest group/toggle-button semantics: every button stays in
    // the tab order and announces its pressed state.
    <div className={cn('flex items-center gap-1.5 flex-wrap', className)} role="group" aria-label="Search source">
      {sources.map((source) => {
        const isActive = value === source.id;
        const count = counts?.[source.id];
        return (
          <button
            key={source.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(source.id)}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-transparent transition-all duration-150',
              isActive ? source.activeColor : cn('text-muted-foreground', source.color),
              !isActive && 'hover:bg-accent',
            )}
          >
            <source.icon className="w-3.5 h-3.5" />
            {source.label}
            {count !== undefined && count > 0 && (
              <span className={cn(
                'text-[10px] font-mono ml-0.5 opacity-70',
                isActive ? '' : 'text-muted-foreground',
              )}>
                {count > 99 ? '99+' : count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
