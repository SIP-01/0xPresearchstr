/**
 * Keyword staking settings.
 *
 * Platform PRE placements are named keyword staking and stay on unless an
 * admin publishes the control event. Nostr keyword staking (an npub-signed
 * stake) remains available and is hidden until the visitor opens it. The
 * npub itself stays hidden until they ask to see it.
 */
import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Gem, KeyRound, Loader2 } from 'lucide-react';
import { nip19 } from 'nostr-tools';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePlatformKeywordStaking } from '@/hooks/usePlatformKeywordStaking';
import { useToast } from '@/hooks/useToast';
import { getIndexRelayUrls } from '@/lib/appRelays';
import { buildStakeEvent } from '@/lib/keywordStakes';
import { publishToRelayPool } from '@/lib/searchRelays';
import { cn } from '@/lib/utils';

export function PlatformKeywordStakingCard({ className }: { className?: string }) {
  const { enabled, isLoading, canToggle, setEnabled } = usePlatformKeywordStaking();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const onToggle = (checked: boolean) => {
    if (!canToggle || saving) return;
    setSaving(true);
    void setEnabled(checked)
      .then(() => {
        toast({
          title: checked ? 'Keyword staking is on' : 'Keyword staking is off',
          description: 'Every visitor follows this platform setting.',
        });
      })
      .catch((error: unknown) => {
        toast({
          title: 'Could not update keyword staking',
          description: error instanceof Error ? error.message : 'Publish failed.',
          variant: 'destructive',
        });
      })
      .finally(() => setSaving(false));
  };

  return (
    <Card className={cn(
      'transition-colors',
      enabled ? 'border-primary/30 bg-primary/5' : 'border-border/60',
      className,
    )}>
      <CardContent className="py-4 flex items-start gap-4">
        <div className={cn(
          'flex items-center justify-center w-9 h-9 rounded-lg shrink-0 border',
          enabled ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-muted text-muted-foreground border-border',
        )}>
          <Gem className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="text-sm font-medium">Keyword staking</span>
              <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                {enabled ? 'On' : 'Off'}
              </span>
            </div>
            <Switch
              checked={enabled}
              disabled={!canToggle || isLoading || saving}
              onCheckedChange={onToggle}
              aria-label={canToggle
                ? 'Turn platform keyword staking on or off'
                : 'Platform keyword staking. Only admins can change this.'}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Pre staking words are a platform placement. Visitors cannot take them off.
            Only an admin can turn keyword staking on or off, and it stays on until an admin publishes a change.
          </p>
          {canToggle ? (
            <p className="text-xs text-primary mt-2 leading-relaxed">
              {saving ? 'Publishing the platform setting…' : 'You can change this for every visitor.'}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground/80 mt-2 leading-relaxed">
              Locked. Ask an admin if this placement should change.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function NpubStakingPanel() {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showNpub, setShowNpub] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [pitch, setPitch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const npub = user ? nip19.npubEncode(user.pubkey) : null;

  const publish = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!user) {
      setError('Log in to stake with your npub.');
      return;
    }
    const template = buildStakeEvent({ keyword, url, title, pitch });
    if (!template) {
      setError('Enter a keyword, a title, and an https, magnet, or ipfs link.');
      return;
    }
    setPending(true);
    try {
      const tags = template.tags.map((tag) => [...tag]);
      if (location.protocol === 'https:' && !tags.some(([name]) => name === 'client')) {
        tags.push(['client', location.hostname]);
      }
      const signed = await user.signer.signEvent({
        kind: template.kind,
        content: template.content,
        tags,
        created_at: Math.floor(Date.now() / 1000),
      });
      const accepted = await publishToRelayPool(getIndexRelayUrls(), signed, 6000);
      if (accepted === 0) throw new Error('No index relay accepted the stake');
      toast({
        title: 'Nostr keyword stake published',
        description: 'Signed with your npub. It appears in the Explore archive.',
      });
      setKeyword('');
      setTitle('');
      setUrl('');
      setPitch('');
      window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['recent-stakes'] });
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish the stake.');
    } finally {
      setPending(false);
    }
  };

  return (
    <Card className="mt-3 border-border/60">
      <CardContent className="py-4">
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0 border bg-muted text-muted-foreground border-border">
            <KeyRound className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Nostr keyword staking</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              A stake signed with your npub. It stays in the Explore archive and does not replace the platform keyword staking placement.
            </p>
            {npub ? (
              <div className="mt-3 flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
                  {showNpub ? npub : 'npub hidden'}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={showNpub}
                  onClick={() => setShowNpub((visible) => !visible)}
                >
                  {showNpub ? 'Hide npub' : 'Show npub'}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground mt-3">
                Log in from the account menu to stake with your npub. The npub stays hidden until you reveal it.
              </p>
            )}
          </div>
        </div>

        {user && (
          <form onSubmit={(event) => void publish(event)} className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="npub-stake-keyword">Keyword</Label>
              <Input
                id="npub-stake-keyword"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                maxLength={80}
                autoComplete="off"
                placeholder="bitcoin"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="npub-stake-title">Title</Label>
              <Input
                id="npub-stake-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={120}
                placeholder="Page title"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="npub-stake-url">Link</Label>
              <Input
                id="npub-stake-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                inputMode="url"
                autoComplete="off"
                placeholder="https://"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="npub-stake-pitch">Pitch</Label>
              <Textarea
                id="npub-stake-pitch"
                value={pitch}
                onChange={(event) => setPitch(event.target.value)}
                maxLength={280}
                placeholder="Short description"
              />
            </div>
            {error && (
              <p className="text-xs text-destructive" role="alert">{error}</p>
            )}
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
              Stake with npub
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export function KeywordStakingSection() {
  const [showNpubStaking, setShowNpubStaking] = useState(false);

  return (
    <section className="mb-10">
      <h2 className="text-sm font-semibold mb-1">Keyword staking</h2>
      <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
        Search shows keyword staking from PRE community. Nostr keyword staking, signed with an npub, remains separate and is hidden here by default.
      </p>
      <PlatformKeywordStakingCard />
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => setShowNpubStaking((open) => !open)}
          className="inline-flex items-center gap-1.5 rounded-md text-[11px] text-muted-foreground/70 hover:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={showNpubStaking}
        >
          <KeyRound className="w-3 h-3" />
          {showNpubStaking ? 'Hide npub staking' : 'Nostr keyword staking'}
        </button>
      </div>
      {showNpubStaking && <NpubStakingPanel />}
    </section>
  );
}
