/**
 * NIP-51/NIP-B0 personal bookmarks.
 *
 * Public web bookmarks are published as NIP-B0 kind 39701 and referenced
 * from the user's NIP-51 kind-10003 global list. Private web URLs are stored
 * only in NIP-51's NIP-44 encrypted JSON tag array. Native Nostr references
 * use NIP-51 e/a/p tags. All signing/encryption stays inside the logged-in
 * user's signer; this hook never reads or handles an nsec.
 */
import { useCallback } from 'react';
import { useNostr } from '@nostrify/react';
import { verifyEvent } from 'nostr-tools/pure';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import type { SearchResult } from '@/lib/providers/types';

export type BookmarkVisibility = 'public' | 'private';

export interface BookmarkSaveInput {
  result: SearchResult;
  visibility: BookmarkVisibility;
}

function isTagArray(value: unknown): value is string[][] {
  return Array.isArray(value) && value.every((tag: unknown) =>
    Array.isArray(tag) && tag.every((part: unknown) => typeof part === 'string'),
  );
}

function addUniqueTag(tags: string[][], tag: string[]): void {
  if (!tags.some((current) => current[0] === tag[0] && current[1] === tag[1])) {
    tags.push([...tag]);
  }
}

function parseWebUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.hostname ? url : null;
  } catch {
    return null;
  }
}

function nip73WebIdentifier(url: URL): string {
  const normalized = new URL(url.href);
  normalized.hash = '';
  return normalized.href;
}

function nipB0DTag(url: URL): string {
  return url.protocol === 'https:' ? url.href.slice('https://'.length) : url.href;
}

function publicNostrReference(result: SearchResult): string[][] {
  const event = result.nostrEvent;
  if (!event) return [];
  if (event.kind === 0 && /^[0-9a-f]{64}$/i.test(event.pubkey)) {
    return [['p', event.pubkey]];
  }
  if (event.kind >= 30000 && event.kind <= 39999) {
    const d = event.tags.find(([name]) => name === 'd')?.[1];
    if (d !== undefined) return [['a', String(event.kind) + ':' + event.pubkey + ':' + d]];
  }
  if (/^[0-9a-f]{64}$/i.test(event.id)) return [['e', event.id]];
  return [];
}

function privateNostrReference(result: SearchResult): string[][] {
  const event = result.nostrEvent;
  if (!event) return [];
  if (event.kind === 0 && /^[0-9a-f]{64}$/i.test(event.pubkey)) {
    return [['p', event.pubkey]];
  }
  if (event.kind >= 30000 && event.kind <= 39999) {
    const d = event.tags.find(([name]) => name === 'd')?.[1];
    if (d !== undefined) return [['a', String(event.kind) + ':' + event.pubkey + ':' + d]];
  }
  if (/^[0-9a-f]{64}$/i.test(event.id)) return [['e', event.id]];
  return [];
}

export function useNostrBookmarks() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutateAsync: publishEvent } = useNostrPublish();

  const save = useCallback(async ({ result, visibility }: BookmarkSaveInput) => {
    if (!user) throw new Error('Log in with Nostr before saving bookmarks.');

    const listEvents = await nostr.query([{
      kinds: [10003],
      authors: [user.pubkey],
      limit: 100,
    }], { signal: AbortSignal.timeout(8000) });

    const existing = listEvents
      .filter((event) => event.kind === 10003 && event.pubkey === user.pubkey && verifyEvent(event))
      .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))[0];

    const publicTags = existing ? existing.tags.map((tag) => [...tag]) : [];
    let privateTags: string[][] = [];

    if (existing?.content) {
      const nip44 = user.signer.nip44;
      const legacyNip04 = user.signer.nip04;
      try {
        // NIP-51 allows reading historical NIP-04 ciphertext identified by
        // ?iv=. New list writes below always re-encrypt with NIP-44.
        const plaintext = existing.content.includes('?iv=')
          ? await (legacyNip04
            ? legacyNip04.decrypt(user.pubkey, existing.content)
            : Promise.reject(new Error('Your signer cannot decrypt this legacy NIP-04 bookmark list.')))
          : await (nip44
            ? nip44.decrypt(user.pubkey, existing.content)
            : Promise.reject(new Error('Your signer does not support NIP-44 decryption.')));
        const parsed: unknown = JSON.parse(plaintext);
        if (!isTagArray(parsed)) throw new Error('Private bookmark content is not a Nostr tag array.');
        privateTags = parsed;
      } catch (error) {
        throw new Error(
          error instanceof Error
            ? 'Could not decrypt your existing private bookmarks. Nothing was overwritten. ' + error.message
            : 'Could not decrypt your existing private bookmarks. Nothing was overwritten.',
          { cause: error },
        );
      }

      if (!nip44) {
        throw new Error('Your signer must support NIP-44 to write updated private bookmark lists. Existing private content was preserved.');
      }
    }

    let bookmarkEventId: string | undefined;
    const isNativeNostr = result.source === 'nostr' && !!result.nostrEvent;
    const existingB0 = result.nostrEvent?.kind === 39701 ? result.nostrEvent : undefined;
    const url = !isNativeNostr ? parseWebUrl(result.url) : null;

    if (isNativeNostr) {
      const references = visibility === 'public'
        ? publicNostrReference(result)
        : privateNostrReference(result);
      if (references.length === 0) throw new Error('This Nostr result has no supported NIP-51 reference.');
      for (const reference of references) {
        if (visibility === 'public') addUniqueTag(publicTags, reference);
        else addUniqueTag(privateTags, reference);
      }
    } else if (!url) {
      // Non-http(s) result (e.g. magnet or IPFS) can still be saved if it is a
      // real Nostr event; it cannot be published as a NIP-B0 web bookmark.
      if (result.nostrEvent) {
        const references = visibility === 'public'
          ? publicNostrReference(result)
          : privateNostrReference(result);
        if (references.length === 0) throw new Error('This result cannot be represented as a NIP-51 reference.');
        for (const reference of references) {
          if (visibility === 'public') addUniqueTag(publicTags, reference);
          else addUniqueTag(privateTags, reference);
        }
      } else {
        throw new Error('Only http(s) pages and Nostr events can be saved as bookmarks.');
      }
    } else if (visibility === 'public') {
      if (existingB0) {
        const d = existingB0.tags.find(([name]) => name === 'd')?.[1];
        if (!d) throw new Error('The existing NIP-B0 bookmark is missing its d tag.');
        addUniqueTag(publicTags, ['a', '39701:' + existingB0.pubkey + ':' + d]);
        addUniqueTag(publicTags, ['i', nip73WebIdentifier(url)]);
        addUniqueTag(publicTags, ['k', 'web']);
      } else {
        // Publish the individual public bookmark record first.
        const d = nipB0DTag(url);
        const title = result.title.trim();
        const description = result.snippet.trim();
        const b0Tags: string[][] = [['d', d]];
        // NIP-B0 published_at is the first bookmark publication time,
        // not the source page's own publication timestamp.
        b0Tags.push(['published_at', String(Math.floor(Date.now() / 1000))]);
        if (title) b0Tags.push(['title', title]);
        for (const topic of [...new Set(result.tags ?? [])].slice(0, 20)) {
          const normalized = topic.toLowerCase().trim();
          if (/^[a-z0-9][a-z0-9-]{0,99}$/.test(normalized)) b0Tags.push(['t', normalized]);
        }
        const publishedB0 = await publishEvent({
          kind: 39701,
          content: description,
          tags: b0Tags,
        });
        bookmarkEventId = publishedB0.id;
        addUniqueTag(publicTags, ['a', '39701:' + publishedB0.pubkey + ':' + d]);
        addUniqueTag(publicTags, ['i', nip73WebIdentifier(url)]);
        addUniqueTag(publicTags, ['k', 'web']);
      }
    } else {
      // Private web reference exists only inside NIP-44 encrypted kind-10003 content.
      if (!user.signer.nip44) throw new Error('Your signer must support NIP-44 to save private bookmarks.');
      addUniqueTag(privateTags, ['i', nip73WebIdentifier(url)]);
      addUniqueTag(privateTags, ['k', 'web']);
    }

    const content = privateTags.length > 0
      ? await (async () => {
          const nip44 = user.signer.nip44;
          if (!nip44) throw new Error('Your signer must support NIP-44 to preserve private bookmarks.');
          return nip44.encrypt(user.pubkey, JSON.stringify(privateTags));
        })()
      : '';

    const now = Math.floor(Date.now() / 1000);
    const createdAt = Math.max(now, (existing?.created_at ?? 0) + 1);
    try {
      const publishedList = await publishEvent({
        kind: 10003,
        created_at: createdAt,
        content,
        tags: publicTags,
      });
      return { bookmarkEventId, listEventId: publishedList.id, visibility };
    } catch (error) {
      if (bookmarkEventId) {
        throw new Error(
          'The public web bookmark was published, but updating your NIP-51 list failed. ' +
          (error instanceof Error ? error.message : 'Unknown publishing error.'),
          { cause: error },
        );
      }
      throw error;
    }
  }, [nostr, user, publishEvent]);

  return { save, isLoggedIn: !!user };
}
