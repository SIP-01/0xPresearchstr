/**
 * Stake PRE on a Keyword — native UI for the PREKeywordMarketV1 contract
 * (Base mainnet). Users stake PRE + set a per-click USD bid directly from
 * Presearchstr instead of only linking out to precommunity.org (kept as a
 * fallback for users without a wallet).
 *
 * Flow: connect injected wallet → (switch to Base) → approve PRE spend
 * (only if allowance is insufficient) → stake(keywordId, amountPre, bidUsd).
 * The keywordId is keccak256 of the normalized keyword, matching the
 * PREcommunity derivation exactly, so stakes land on the same positions.
 *
 * Safety: amount/bid validation, minimum-stake hint, insufficient-balance
 * check, user-rejection handling, wrong-network prompt, BaseScan links.
 * Nothing sensitive is ever logged — all inputs are public on-chain data.
 */
import { useState } from 'react';
import { erc20Abi, formatUnits, parseUnits, zeroAddress } from 'viem';
import {
  useAccount,
  useChainId,
  useConnect,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from 'wagmi';
import { ExternalLink, Gem, Loader2, Wallet } from 'lucide-react';

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/useToast';
import {
  KEYWORD_MARKET_ADDRESS,
  KEYWORD_MARKET_CHAIN_ID,
  PRECOMMUNITY_KEYWORD_MARKET_URL,
  PRE_DECIMALS,
  USD_BID_DECIMALS,
  basescanTxUrl,
} from '@/lib/web3/contracts';
import { preKeywordMarketAbi } from '@/lib/web3/preKeywordMarketAbi';
import { keywordIdOf, normalizeStakeKeyword } from '@/lib/web3/keywordId';

type TxStep = 'idle' | 'approving' | 'staking' | 'done';

interface StakePreKeywordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Keyword to prefill (usually the active search query). */
  initialKeyword?: string;
}

/** Friendly message for common wallet/contract failures. */
function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? (('shortMessage' in err && typeof err.shortMessage === 'string') ? err.shortMessage : err.message) : '';
  const first = (raw || 'Transaction failed.').split('\n')[0]!;
  if (/user rejected|user denied|rejected the request/i.test(first)) {
    return 'Transaction rejected in your wallet.';
  }
  if (/insufficient funds/i.test(first)) {
    return 'Insufficient funds for gas.';
  }
  if (/StakeBelowMinimum/i.test(raw)) return 'Stake is below the contract minimum.';
  if (/EnforcedPause/i.test(raw)) return 'The keyword market is currently paused.';
  return first.length > 140 ? `${first.slice(0, 140)}…` : first;
}

export function StakePreKeywordDialog({ open, onOpenChange, initialKeyword = '' }: StakePreKeywordDialogProps) {
  const { toast } = useToast();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: KEYWORD_MARKET_CHAIN_ID });

  const [keyword, setKeyword] = useState(initialKeyword);
  const [amount, setAmount] = useState('');
  const [bidUsd, setBidUsd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<TxStep>('idle');
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  // Sync the prefill whenever the dialog opens with a new keyword
  // (render-phase state adjustment — no effect, no cascading render).
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setKeyword(initialKeyword);
  }

  // Derived + validated inputs.
  const normalized = (() => {
    try { return keyword.trim() ? normalizeStakeKeyword(keyword) : ''; } catch { return null; }
  })();
  const keywordId = (() => {
    try { return keyword.trim() ? keywordIdOf(keyword) : null; } catch { return null; }
  })();

  // ─── On-chain reads ───
  const { data: preToken } = useReadContract({
    address: KEYWORD_MARKET_ADDRESS,
    abi: preKeywordMarketAbi,
    functionName: 'PRE',
    chainId: KEYWORD_MARKET_CHAIN_ID,
  });
  const { data: minimumStake } = useReadContract({
    address: KEYWORD_MARKET_ADDRESS,
    abi: preKeywordMarketAbi,
    functionName: 'minimumStake',
    chainId: KEYWORD_MARKET_CHAIN_ID,
  });
  const { data: marketPaused } = useReadContract({
    address: KEYWORD_MARKET_ADDRESS,
    abi: preKeywordMarketAbi,
    functionName: 'paused',
    chainId: KEYWORD_MARKET_CHAIN_ID,
  });
  const { data: topStake } = useReadContract({
    address: KEYWORD_MARKET_ADDRESS,
    abi: preKeywordMarketAbi,
    functionName: 'topStakeOf',
    args: keywordId ? [keywordId] : undefined,
    chainId: KEYWORD_MARKET_CHAIN_ID,
    query: { enabled: Boolean(keywordId) },
  });
  const { data: preBalance } = useReadContract({
    address: preToken,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: KEYWORD_MARKET_CHAIN_ID,
    query: { enabled: Boolean(preToken && address) },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: preToken,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address ? [address, KEYWORD_MARKET_ADDRESS] : undefined,
    chainId: KEYWORD_MARKET_CHAIN_ID,
    query: { enabled: Boolean(preToken && address) },
  });

  const wrongNetwork = isConnected && chainId !== KEYWORD_MARKET_CHAIN_ID;
  const busy = step === 'approving' || step === 'staking';

  const amountRaw = (() => {
    try { return amount.trim() ? parseUnits(amount.trim(), PRE_DECIMALS) : 0n; } catch { return null; }
  })();
  const bidUsdRaw = (() => {
    try { return bidUsd.trim() ? parseUnits(bidUsd.trim(), USD_BID_DECIMALS) : null; } catch { return null; }
  })();

  const hasTopStake = Boolean(topStake && topStake.staker !== zeroAddress && topStake.amount > 0n);

  const reset = () => {
    setAmount('');
    setBidUsd('');
    setError(null);
    setStep('idle');
    setTxHash(null);
  };

  const validate = (): boolean => {
    if (normalized === null || !keywordId) {
      setError(normalized === null ? 'Invalid keyword — 1–5 words, letters/numbers only.' : 'A keyword is required.');
      return false;
    }
    if (amountRaw === null || amountRaw < 0n) {
      setError('Enter a valid PRE amount (0 to only update the bid on an existing position).');
      return false;
    }
    if (bidUsdRaw === null || bidUsdRaw <= 0n) {
      setError('Enter a valid positive USD bid per click (max 6 decimals).');
      return false;
    }
    if (marketPaused) {
      setError('The keyword market contract is currently paused.');
      return false;
    }
    if (amountRaw > 0n) {
      if (preBalance !== undefined && preBalance < amountRaw) {
        setError('Insufficient PRE balance on Base.');
        return false;
      }
      if (minimumStake !== undefined && amountRaw < minimumStake) {
        setError(`A new position requires at least ${formatUnits(minimumStake, PRE_DECIMALS)} PRE.`);
        return false;
      }
    }
    return true;
  };

  const handleStake = async () => {
    setError(null);
    setTxHash(null);
    if (!validate()) return;
    if (!isConnected || !address || !preToken || !publicClient || !keywordId || amountRaw === null || bidUsdRaw === null) return;
    if (wrongNetwork) {
      try { await switchChainAsync({ chainId: KEYWORD_MARKET_CHAIN_ID }); } catch (err) { setError(errorMessage(err)); }
      return;
    }

    try {
      // Step 1 — approve PRE spend when the existing allowance is too low.
      if (amountRaw > 0n && (allowance === undefined || allowance < amountRaw)) {
        setStep('approving');
        const approveHash = await writeContractAsync({
          address: preToken,
          abi: erc20Abi,
          functionName: 'approve',
          args: [KEYWORD_MARKET_ADDRESS, amountRaw],
          chainId: KEYWORD_MARKET_CHAIN_ID,
        });
        setTxHash(approveHash);
        const receipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
        if (receipt.status !== 'success') throw new Error('PRE approval transaction failed.');
        await refetchAllowance();
      }

      // Step 2 — stake.
      setStep('staking');
      const stakeHash = await writeContractAsync({
        address: KEYWORD_MARKET_ADDRESS,
        abi: preKeywordMarketAbi,
        functionName: 'stake',
        args: [keywordId, amountRaw, bidUsdRaw],
        chainId: KEYWORD_MARKET_CHAIN_ID,
      });
      setTxHash(stakeHash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: stakeHash });
      if (receipt.status !== 'success') throw new Error('Stake transaction reverted.');

      setStep('done');
      toast({
        title: 'PRE staked',
        description: `"${normalized}" — ${formatUnits(amountRaw, PRE_DECIMALS)} PRE at $${formatUnits(bidUsdRaw, USD_BID_DECIMALS)}/click.`,
      });
    } catch (err) {
      setError(errorMessage(err));
      setStep('idle');
    }
  };

  const needsApproval = Boolean(
    amountRaw !== null && amountRaw > 0n && (allowance === undefined || allowance < amountRaw),
  );

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) { if (!next) reset(); onOpenChange(next); } }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gem className="w-5 h-5 text-amber-600 dark:text-amber-500" />
            Stake PRE on a Keyword
          </DialogTitle>
          <DialogDescription>
            Stake PRE and set a per-click USD bid on the PREcommunity keyword market
            (PREKeywordMarketV1, Base). The top bidder&apos;s approved ad shows for that
            search phrase.{' '}
            <a
              href={PRECOMMUNITY_KEYWORD_MARKET_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Manage creatives on precommunity.org
            </a>
          </DialogDescription>
        </DialogHeader>

        {!isConnected ? (
          <div className="py-6 text-center space-y-4">
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              Connect an injected wallet (MetaMask, Rabby, …) on Base to stake PRE.
            </p>
            <Button
              onClick={() => connectors[0] && connect({ connector: connectors[0] })}
              disabled={isConnecting || connectors.length === 0}
            >
              {isConnecting ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Wallet className="w-4 h-4 mr-1.5" />
              )}
              Connect wallet
            </Button>
            {connectors.length === 0 && (
              <p className="text-xs text-muted-foreground/70">
                No injected wallet detected.{' '}
                <a
                  href={PRECOMMUNITY_KEYWORD_MARKET_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Use precommunity.org instead →
                </a>
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {wrongNetwork && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm flex items-center justify-between gap-3">
                <span>Wrong network — the keyword market lives on Base.</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void switchChainAsync({ chainId: KEYWORD_MARKET_CHAIN_ID }).catch((err) => setError(errorMessage(err)))}
                >
                  Switch to Base
                </Button>
              </div>
            )}

            {/* Keyword */}
            <div className="space-y-1.5">
              <Label htmlFor="pre-stake-keyword">Keyword *</Label>
              <Input
                id="pre-stake-keyword"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="e.g. monero wallet"
                maxLength={256}
                disabled={busy}
              />
              <p className="text-[11px] text-muted-foreground/60">
                {normalized === null
                  ? 'Invalid — 1–5 words, letters and numbers only.'
                  : normalized
                    ? <>On-chain keyword: <span className="font-mono">{normalized}</span></>
                    : '1–5 words, letters and numbers. Same phrase = same on-chain position.'}
              </p>
            </div>

            {/* Current top stake */}
            {hasTopStake && topStake && (
              <p className="text-xs text-muted-foreground">
                Current top stake:{' '}
                <span className="font-medium text-foreground">
                  {formatUnits(topStake.amount, PRE_DECIMALS)} PRE
                </span>{' '}
                at ${formatUnits(topStake.bidUsd, USD_BID_DECIMALS)}/click by{' '}
                <span className="font-mono">
                  {topStake.staker.slice(0, 6)}…{topStake.staker.slice(-4)}
                </span>
              </p>
            )}

            {/* PRE amount */}
            <div className="space-y-1.5">
              <Label htmlFor="pre-stake-amount">PRE amount</Label>
              <Input
                id="pre-stake-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                disabled={busy}
              />
              <p className="text-[11px] text-muted-foreground/60">
                {preBalance !== undefined
                  ? `Balance: ${formatUnits(preBalance, PRE_DECIMALS)} PRE`
                  : 'Your PRE balance on Base.'}
                {minimumStake !== undefined && ` · Minimum new position: ${formatUnits(minimumStake, PRE_DECIMALS)} PRE`}
              </p>
            </div>

            {/* USD bid */}
            <div className="space-y-1.5">
              <Label htmlFor="pre-stake-bid">Bid per click (USD) *</Label>
              <Input
                id="pre-stake-bid"
                inputMode="decimal"
                value={bidUsd}
                onChange={(e) => setBidUsd(e.target.value)}
                placeholder="0.10"
                disabled={busy}
              />
              <p className="text-[11px] text-muted-foreground/60">
                Highest bid wins the ad slot; clicks are settled from your stake by the market operator.
              </p>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            {/* Tx status */}
            {txHash && (
              <a
                href={basescanTxUrl(txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline underline-offset-2"
              >
                {step === 'done' ? 'View stake on BaseScan' : step === 'staking' ? 'View stake tx on BaseScan' : 'View approval on BaseScan'}
                <ExternalLink className="w-3 h-3" />
              </a>
            )}

            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="text-[11px] text-muted-foreground/50 font-mono">
                Base · {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : ''}
              </span>
              {step === 'done' ? (
                <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
              ) : (
                <Button
                  onClick={() => void handleStake()}
                  disabled={busy || wrongNetwork || !keyword.trim() || !bidUsd.trim() || amountRaw === null}
                >
                  {busy && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                  {step === 'approving'
                    ? 'Approving PRE…'
                    : step === 'staking'
                      ? 'Staking…'
                      : needsApproval
                        ? 'Approve & stake'
                        : 'Stake'}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
