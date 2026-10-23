/**
 * Stake a Keyword — Nostr (npub) keyword staking.
 *
 * Separate from platform Keyword Staking (PRE ads). One stake per keyword
 * per pubkey: re-staking the same keyword replaces the previous entry.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Gem, Loader2, Link2 } from 'lucide-react';

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LoginArea } from '@/components/auth/LoginArea';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { buildStakeEvent } from '@/lib/keywordStakes';
import { isValidSubmissionUrl } from '@/lib/contentType';

interface StakeKeywordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Keyword to prefill (usually the active search query). */
  initialKeyword?: string;
}

export function StakeKeywordDialog({ open, onOpenChange, initialKeyword = '' }: StakeKeywordDialogProps) {
  const { user } = useCurrentUser();
  const { mutate: createEvent, isPending } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [keyword, setKeyword] = useState(initialKeyword);
  const [prefill, setPrefill] = useState(initialKeyword);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [pitch, setPitch] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (open && initialKeyword !== prefill) {
    setPrefill(initialKeyword);
    setKeyword(initialKeyword);
  }

  const reset = () => {
    setKeyword('');
    setPrefill('');
    setUrl('');
    setTitle('');
    setPitch('');
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!keyword.trim()) {
      setError('A keyword is required.');
      return;
    }
    if (!title.trim()) {
      setError('A title is required.');
      return;
    }
    if (!isValidSubmissionUrl(url)) {
      setError('Enter a valid https://, magnet:, or ipfs:// link.');
      return;
    }

    const template = buildStakeEvent({ keyword, url, title, pitch });
    if (!template) {
      setError('Invalid stake — check the keyword, title, and link.');
      return;
    }

    createEvent(template, {
      onSuccess: () => {
        toast({
          title: 'Keyword staked',
          description: `"${keyword.trim()}" now shows your link to everyone who enabled Nostr Keyword Staking.`,
        });
        void queryClient.invalidateQueries({ queryKey: ['provider-search'] });
        reset();
        onOpenChange(false);
      },
      onError: (err) => {
        setError(err.message || 'Failed to publish. Try again.');
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gem className="w-5 h-5 text-primary" />
            Stake a keyword with your npub
          </DialogTitle>
          <DialogDescription>
            Bind a search keyword to a URL with your Nostr key. This is Nostr
            Keyword Staking — separate from platform Keyword Staking (PRE ads).
            One stake per keyword per npub.
          </DialogDescription>
        </DialogHeader>

        {!user ? (
          <div className="py-6 text-center space-y-4">
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              Log in with your Nostr key to stake keywords. Stakes are signed
              and attributable to you.
            </p>
            <LoginArea className="max-w-56 mx-auto" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="stake-keyword">Keyword *</Label>
              <Input
                id="stake-keyword"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="e.g. monero wallet"
                maxLength={80}
                required
              />
              <p className="text-[11px] text-muted-foreground/60">
                Exact match: your link appears when someone searches this keyword
                and has Nostr Keyword Staking enabled.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="stake-url">Link *</Label>
              <div className="relative">
                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                <Input
                  id="stake-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://your-site.example"
                  className="pl-9 font-mono text-sm"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="stake-title">Title *</Label>
              <Input
                id="stake-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What searchers will see"
                maxLength={120}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="stake-pitch">Pitch</Label>
              <Textarea
                id="stake-pitch"
                value={pitch}
                onChange={(e) => setPitch(e.target.value)}
                placeholder="One or two sentences on why this link is the best answer."
                rows={3}
                maxLength={280}
                className="resize-none"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="text-[11px] text-muted-foreground/50 font-mono">kind 30078 · 1 stake / keyword / npub</span>
              <Button type="submit" disabled={isPending || !keyword.trim() || !title.trim() || !url.trim()}>
                {isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    Staking…
                  </>
                ) : (
                  <>
                    <Gem className="w-4 h-4 mr-1.5" />
                    Stake it
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
