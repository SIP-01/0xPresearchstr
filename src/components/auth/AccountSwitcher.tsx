import { useState } from 'react';
import { ChevronDown, LogOut, ShieldCheck, UserIcon, UserPlus, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { BasePayoutWalletCard } from '@/components/BasePayoutWalletCard';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { useLoggedInAccounts, type Account } from '@/hooks/useLoggedInAccounts';
import { useAdminAccess } from '@/hooks/useAdminAccess';
import { useBasePayoutWallet } from '@/hooks/useBasePayoutWallet';
import { shortPayoutAddress } from '@/lib/basePayoutWallet';

interface AccountSwitcherProps {
  onAddAccountClick: () => void;
}

export function AccountSwitcher({ onAddAccountClick }: AccountSwitcherProps) {
  const { currentUser, otherUsers, isLoading, setLogin, removeLogin } = useLoggedInAccounts();
  // Team members (owner/admin/moderator) get the Admin console link.
  const { isMod } = useAdminAccess();
  const payout = useBasePayoutWallet(currentUser?.pubkey);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const payoutLabel = payout.data
    ? `Base ${shortPayoutAddress(payout.data.address)}`
    : 'Link Base wallet';

  if (!currentUser) return null;

  const getDisplayName = (account: Account): string => {
    return account.metadata.name ?? 'Anonymous';
  }

  // While the metadata query is in-flight and we don't yet have a name,
  // we don't want to flash a generated animal name / its first letter.
  const isCurrentUserPending = isLoading && !currentUser.metadata.name;

  return (
    <>
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button className='flex items-center gap-2 h-10 p-1 pr-2.5 rounded-full hover:bg-accent transition-all text-foreground'>
          <Avatar className='w-8 h-8'>
            <AvatarImage
              src={currentUser.metadata.picture}
              alt={isCurrentUserPending ? '' : getDisplayName(currentUser)}
            />
            <AvatarFallback>
              {isCurrentUserPending ? (
                <Skeleton className='size-full rounded-full' />
              ) : (
                getDisplayName(currentUser).charAt(0)
              )}
            </AvatarFallback>
          </Avatar>
          <ChevronDown className='w-4 h-4 text-muted-foreground' />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className='w-56 p-2 animate-scale-in'>
        <DropdownMenuItem asChild className='flex items-center gap-2 cursor-pointer p-2 rounded-md'>
          <Link to={`/${nip19.npubEncode(currentUser.pubkey)}`}>
            <Avatar className='w-8 h-8'>
              <AvatarImage
                src={currentUser.metadata.picture}
                alt={isCurrentUserPending ? '' : getDisplayName(currentUser)}
              />
              <AvatarFallback>
                {isCurrentUserPending ? (
                  <Skeleton className='size-full rounded-full' />
                ) : (
                  getDisplayName(currentUser)?.charAt(0) || <UserIcon />
                )}
              </AvatarFallback>
            </Avatar>
            <div className='flex-1 truncate'>
              {isCurrentUserPending ? (
                <Skeleton className='h-4 w-24' />
              ) : (
                <p className='text-sm font-medium'>{getDisplayName(currentUser)}</p>
              )}
            </div>
          </Link>
        </DropdownMenuItem>
        {otherUsers.map((user) => {
          const isPending = isLoading && !user.metadata.name;
          return (
            <DropdownMenuItem
              key={user.id}
              onClick={() => setLogin(user.id)}
              className='flex items-center gap-2 cursor-pointer p-2 rounded-md'
            >
              <Avatar className='w-8 h-8'>
                <AvatarImage
                  src={user.metadata.picture}
                  alt={isPending ? '' : getDisplayName(user)}
                />
                <AvatarFallback>
                  {isPending ? (
                    <Skeleton className='size-full rounded-full' />
                  ) : (
                    getDisplayName(user)?.charAt(0) || <UserIcon />
                  )}
                </AvatarFallback>
              </Avatar>
              <div className='flex-1 truncate'>
                {isPending ? (
                  <Skeleton className='h-4 w-24' />
                ) : (
                  <p className='text-sm font-medium'>{getDisplayName(user)}</p>
                )}
              </div>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => setPayoutOpen(true)}
          className='flex items-center gap-2 cursor-pointer p-2 rounded-md'
        >
          <Wallet className='w-4 h-4' />
          <span className='truncate'>{payoutLabel}</span>
        </DropdownMenuItem>
        {isMod && (
          <DropdownMenuItem asChild className='flex items-center gap-2 cursor-pointer p-2 rounded-md text-primary'>
            <Link to="/admin">
              <ShieldCheck className='w-4 h-4' />
              <span>Admin console</span>
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={onAddAccountClick}
          className='flex items-center gap-2 cursor-pointer p-2 rounded-md'
        >
          <UserPlus className='w-4 h-4' />
          <span>Add another account</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => removeLogin(currentUser.id)}
          className='flex items-center gap-2 cursor-pointer p-2 rounded-md text-red-500'
        >
          <LogOut className='w-4 h-4' />
          <span>Log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={payoutOpen} onOpenChange={setPayoutOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Base payout wallet</DialogTitle>
          <DialogDescription>
            Connect a Base wallet to this Nostr login. Payouts use the signed address. The wallet key stays in the wallet.
          </DialogDescription>
        </DialogHeader>
        <BasePayoutWalletCard heading={false} />
      </DialogContent>
    </Dialog>
    </>
  );
}
