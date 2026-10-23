/**
 * Keyword staking settings.
 *
 * PRE keyword staking is a platform placement: on by default, and visitors
 * cannot turn the staking words off. Team admins publish the switch.
 * Nostr keyword staking and npub staking stay available; npubs stay hidden
 * until the visitor turns Show npubs on.
 */
import { Gem, KeyRound } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePlatformKeywordStaking } from '@/hooks/usePlatformKeywordStaking';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

export function KeywordStakingSettings({ variant = 'settings' }: { variant?: 'settings' | 'admin' }) {
  const { config, updateConfig } = useAppContext();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const staking = usePlatformKeywordStaking();
  const showNpub = config.showNpub;

  const onPlatformToggle = async (checked: boolean) => {
    try {
      await staking.setEnabled(checked);
      toast({
        title: checked ? 'Keyword staking is on' : 'Keyword staking is off',
        description: 'Published for every visitor.',
      });
    } catch (error) {
      toast({
        title: 'Could not update keyword staking',
        description: error instanceof Error ? error.message : 'Publish failed',
        variant: 'destructive',
      });
    }
  };

  const platformCopy = staking.canToggle
    ? 'PRE staking words are a platform placement. This switch updates keyword staking for every visitor.'
    : staking.isLoading && user
      ? 'Checking whether this account can change platform keyword staking.'
      : 'PRE staking words are a platform placement. Visitors cannot turn them off. Team admins change this for everyone.';

  return (
    <section className={variant === 'settings' ? 'mb-10' : ''}>
      {variant === 'settings' && (
        <>
          <h2 className="text-sm font-semibold mb-1">Keyword staking</h2>
          <p className="text-xs text-muted-foreground mb-4">
            PRE keyword staking is shown in search. Nostr keyword staking and npub staking stay on Explore.
          </p>
        </>
      )}

      <Card className={cn('transition-colors', staking.enabled ? 'border-primary/30 bg-primary/5' : 'border-border/60')}>
        <CardContent className="py-4 flex items-start gap-4">
          <div className={cn(
            'flex items-center justify-center w-9 h-9 rounded-lg shrink-0 border',
            staking.enabled ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-muted text-muted-foreground border-border',
          )}>
            <Gem className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Keyword staking</span>
              <Switch
                checked={staking.enabled}
                disabled={!staking.canToggle || staking.saving}
                onCheckedChange={(checked) => { void onPlatformToggle(checked); }}
                aria-label="Keyword staking"
                aria-describedby="keyword-staking-platform"
              />
            </div>
            <p id="keyword-staking-platform" className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {staking.enabled
                ? 'On. Eligible Web and All searches show the PRE keyword stake.'
                : 'Off. A team admin turned keyword staking off for the platform.'}
              {' '}
              {platformCopy}
            </p>
            {!staking.canToggle && (
              <Badge variant="outline" className="mt-2 text-[10px] border-primary/30 text-primary">
                Platform · admins only
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {variant === 'settings' && (
        <>
          <Card className="mt-4 border-border/60">
            <CardContent className="py-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">Nostr keyword staking</span>
                <Badge variant="outline" className="text-[10px] border-green-500/30 text-green-600 dark:text-green-500">
                  Remains
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Nostr keyword stakes stay in the Explore archive, signed by the staker&apos;s key.
                They stay separate from PRE keyword staking in search.{' '}
                <Link to="/explore" className="text-primary hover:underline">Browse the archive</Link>.
              </p>
            </CardContent>
          </Card>

          <Card className={cn('mt-4 transition-colors', showNpub ? 'border-primary/30 bg-primary/5' : 'border-border/60')}>
            <CardContent className="py-4 flex items-start gap-4">
              <div className={cn(
                'flex items-center justify-center w-9 h-9 rounded-lg shrink-0 border',
                showNpub ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-muted text-muted-foreground border-border',
              )}>
                <KeyRound className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">Npub staking</span>
                  <Switch
                    checked={showNpub}
                    onCheckedChange={(checked) => updateConfig(() => ({ showNpub: checked }))}
                    aria-label="Show npubs"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  {showNpub
                    ? 'On. Staker npubs and this device\u2019s indexing npub are visible.'
                    : 'Off (default). Npub staking stays active, and npubs stay hidden — including the indexing npub on the Auto Indexer tab.'}
                </p>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}
