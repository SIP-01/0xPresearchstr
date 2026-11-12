import { useState } from 'react';
import { Bookmark, Lock, Globe, Loader2 } from 'lucide-react';

import { useNostrBookmarks, type BookmarkVisibility } from '@/hooks/useNostrBookmarks';
import { useToast } from '@/hooks/useToast';
import type { SearchResult } from '@/lib/providers/types';
import { cn } from '@/lib/utils';

export function BookmarkButton({ result, className }: {
  result: SearchResult;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<BookmarkVisibility | null>(null);
  const { save, isLoggedIn } = useNostrBookmarks();
  const { toast } = useToast();

  const saveWithVisibility = async (visibility: BookmarkVisibility) => {
    if (pending) return;
    setPending(visibility);
    try {
      await save({ result, visibility });
      toast({
        title: visibility === 'public' ? 'Public bookmark saved' : 'Private bookmark saved',
        description: visibility === 'public'
          ? 'Saved to NIP-51 and, for web pages, published as a NIP-B0 bookmark.'
          : 'Saved in your NIP-44 encrypted NIP-51 bookmark list.',
      });
      setOpen(false);
    } catch (error) {
      toast({
        title: 'Bookmark failed',
        description: error instanceof Error ? error.message : 'Could not save this bookmark.',
        variant: 'destructive',
      });
    } finally {
      setPending(null);
    }
  };

  return (
    <span className={cn('relative inline-flex', className)} onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}>
      <button
        type="button"
        disabled={!isLoggedIn || !!pending}
        onClick={() => setOpen((value) => !value)}
        aria-label="Save bookmark"
        aria-haspopup="menu"
        aria-expanded={open}
        title={isLoggedIn ? 'Save bookmark' : 'Log in to save bookmarks'}
        className="inline-flex items-center gap-1 p-1 rounded-md text-muted-foreground/60 hover:text-foreground disabled:opacity-40 transition-colors"
      >
        {pending
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <Bookmark className="w-3.5 h-3.5" />}
      </button>
      {open && isLoggedIn && (
        <div
          role="menu"
          aria-label="Bookmark visibility"
          className="absolute right-0 bottom-full z-50 mb-2 min-w-44 rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            disabled={!!pending}
            onClick={() => void saveWithVisibility('public')}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs hover:bg-accent disabled:opacity-50"
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Save publicly</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!!pending}
            onClick={() => void saveWithVisibility('private')}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs hover:bg-accent disabled:opacity-50"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Save privately</span>
          </button>
        </div>
      )}
    </span>
  );
}
