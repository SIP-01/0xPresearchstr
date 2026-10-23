import { useState } from 'react';
import { ExternalLink, Wallet } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useBasePayoutWallet } from '@/hooks/useBasePayoutWallet';
import { useToast } from '@/hooks/useToast';
import { discoverWallets, type DiscoveredWallet } from '@/lib/basePayoutProvider';
import { baseAddressUrl, checksumAddress, shortPayoutAddress } from '@/lib/basePayoutWallet';

function statusMessage(error: unknown): string {
  let message = '';
  if (error instanceof Error) message = error.message;
  else if (typeof error === 'string') message = error;
  else if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') message = error.message;
  const cleaned = message.replace(/\s+/g, ' ').trim();
  if (cleaned.length > 0 && cleaned.length <= 180) return cleaned;
  return 'The Base address could not be saved.';
}

export function BasePayoutWalletCard({ heading = true }: { heading?: boolean }) {
  const { user } = useCurrentUser();
  const wallet = useBasePayoutWallet(user?.pubkey);
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<DiscoveredWallet[] | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const fieldId = heading ? 'base-payout-address' : 'base-payout-address-dialog';
  const helpId = `${fieldId}-help`;
  const linked = wallet.data;
  const explorer = linked ? baseAddressUrl(linked.address) : null;
  const addressValue = draft ?? (linked ? checksumAddress(linked.address) : '');

  const save = async () => {
    setBusy(true);
    try {
      const next = await wallet.saveToProfile(addressValue);
      setDraft(null);
      toast({
        title: 'Base address saved on your profile',
        description: `${shortPayoutAddress(next.address)} can receive payouts.`,
      });
    } catch (error) {
      toast({
        title: 'Could not save the Base address',
        description: statusMessage(error),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const connect = async (provider?: DiscoveredWallet['provider']) => {
    setBusy(true);
    try {
      let chosen = provider;
      if (!chosen) {
        const found = await discoverWallets();
        if (found.length === 0) {
          toast({
            title: 'No Base wallet found',
            description: 'Open Presearchstr in MetaMask, Coinbase Wallet, or Rainbow, then connect.',
            variant: 'destructive',
          });
          return;
        }
        if (found.length > 1) {
          setChoices(found);
          return;
        }
        chosen = found[0].provider;
      }
      const next = await wallet.link(chosen);
      setChoices(null);
      toast({
        title: 'Base wallet linked',
        description: `${shortPayoutAddress(next.address)} can receive payouts.`,
      });
    } catch (error) {
      toast({
        title: 'Could not link the Base wallet',
        description: statusMessage(error),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await wallet.unlink();
      toast({ title: 'Base wallet removed', description: 'Payouts no longer have an address for this account.' });
    } catch (error) {
      toast({
        title: 'Could not remove the Base wallet',
        description: statusMessage(error),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id={heading ? 'payout-wallet' : undefined} className={heading ? 'mb-10' : ''}>
      {heading && (
        <>
          <h2 className="text-sm font-semibold mb-1">Base payout wallet</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Add the Base address that should receive payouts. It is saved on your Nostr profile.
          </p>
        </>
      )}
      <Card className="border-border/60">
        <CardContent className="py-4 flex items-start gap-4">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0 border bg-primary/10 border-primary/30 text-primary">
            <Wallet className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0 space-y-3">
            {!user && (
              <p className="text-sm text-muted-foreground leading-relaxed">
                Log in, then paste a Base address here. It is saved on your Nostr profile. Connecting a wallet can also sign the proof. The wallet key stays in the wallet.
              </p>
            )}
            {user && wallet.isPending && (
              <div className="space-y-2" aria-hidden="true">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-full" />
              </div>
            )}
            {user && !wallet.isPending && (
              <div className="space-y-2">
                <Label htmlFor={fieldId}>Base address</Label>
                <Input
                  id={fieldId}
                  value={addressValue}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="0x…"
                  autoComplete="off"
                  spellCheck={false}
                  inputMode="text"
                  aria-describedby={helpId}
                  className="font-mono"
                />
                <p id={helpId} className="text-xs text-muted-foreground leading-relaxed">
                  {linked
                    ? linked.verified
                      ? 'Signed by this wallet and saved on your profile.'
                      : 'Saved on your Nostr profile.'
                    : 'Paste the address from your Base wallet, then save it to your profile.'}
                </p>
                {linked && explorer && (
                  <a
                    href={explorer}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline focus-visible:outline-none focus-visible:underline decoration-2 underline-offset-4"
                  >
                    View on Base
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                )}
              </div>
            )}
            {user && choices && choices.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {choices.map((choice) => (
                  <Button
                    key={choice.name}
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => { void connect(choice.provider); }}
                  >
                    {choice.name}
                  </Button>
                ))}
              </div>
            )}
            {user && !wallet.isPending && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={busy} onClick={() => { void save(); }}>
                  Save to profile
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { void connect(); }}>
                  Connect wallet
                </Button>
                {linked && (
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { void remove(); }}>
                    Remove
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
