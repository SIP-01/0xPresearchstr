/**
 * NIP-25 votes for Nostr events and external web documents.
 * Native Nostr events use kind 7. External web content uses kind 17 with
 * NIP-73 k/i identifiers. Legacy kind-7/r URL votes remain read-only compatible.
 */
import type { NostrEvent } from '@nostrify/nostrify';
import { normalizeIndexUrl } from '@/lib/webIndex';

export const VOTE_KIND = 7;
export const EXTERNAL_REACTION_KIND = 17;
export type VoteDirection = 1 | -1;

export interface VoteTarget {
  key: string;
  kind: typeof VOTE_KIND | typeof EXTERNAL_REACTION_KIND;
  tags: string[][];
}

export function voteTargetFor(result: {
  url: string;
  source?: string;
  nostrEvent?: { id: string; kind?: number; pubkey?: string; tags?: string[][] };
}): VoteTarget | null {
  if (result.source === 'nostr' && result.nostrEvent?.id) {
    const event = result.nostrEvent;
    const tags: string[][] = [['e', event.id]];
    if (event.pubkey) tags.push(['p', event.pubkey]);
    if (typeof event.kind === 'number') tags.push(['k', String(event.kind)]);
    if (event.kind !== undefined && event.kind >= 30000 && event.kind <= 39999 && event.pubkey) {
      const d = event.tags?.find(([name]) => name === 'd')?.[1];
      if (d !== undefined) tags.push(['a', String(event.kind) + ':' + event.pubkey + ':' + d]);
    }
    return { key: 'e:' + event.id, kind: VOTE_KIND, tags };
  }

  const normalized = normalizeIndexUrl(result.url);
  if (!normalized) return null;
  return { key: 'u:' + normalized, kind: EXTERNAL_REACTION_KIND, tags: [['k', 'web'], ['i', normalized]] };
}

export function buildVoteEvent(target: VoteTarget, direction: VoteDirection): {
  kind: number;
  content: string;
  tags: string[][];
} {
  return {
    kind: target.kind,
    content: direction === 1 ? '+' : '-',
    tags: [...target.tags.map((tag) => [...tag]), ['alt', 'Nostr search ' + (direction === 1 ? 'upvote' : 'downvote')]],
  };
}

export interface VoteTally { up: number; down: number; score: number; }

function urlTargetKey(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeIndexUrl(value);
  return normalized ? 'u:' + normalized : null;
}

function eventTargetKey(event: NostrEvent): string | null {
  if (event.kind === VOTE_KIND) {
    const eventId = event.tags.find(([name]) => name === 'e')?.[1];
    if (eventId) return 'e:' + eventId;
    return urlTargetKey(event.tags.find(([name]) => name === 'r')?.[1]);
  }
  if (event.kind === EXTERNAL_REACTION_KIND) {
    const kinds = event.tags.filter(([name]) => name === 'k').map(([, value]) => value);
    if (!kinds.includes('web')) return null;
    return urlTargetKey(event.tags.find(([name]) => name === 'i')?.[1]);
  }
  return null;
}

function reactionDirection(event: NostrEvent): VoteDirection | null {
  if (event.content === '+' || event.content === '') return 1;
  if (event.content === '-') return -1;
  return null;
}

export function tallyVotes(events: NostrEvent[]): Map<string, VoteTally> {
  const latest = new Map<string, {
    targetKey: string; direction: VoteDirection; createdAt: number; eventId: string;
  }>();
  for (const event of events) {
    if (event.kind !== VOTE_KIND && event.kind !== EXTERNAL_REACTION_KIND) continue;
    const direction = reactionDirection(event);
    const targetKey = eventTargetKey(event);
    if (!direction || !targetKey) continue;
    const compoundKey = targetKey + String.fromCharCode(0) + event.pubkey;
    const existing = latest.get(compoundKey);
    if (
      !existing ||
      event.created_at > existing.createdAt ||
      (event.created_at === existing.createdAt && event.id > existing.eventId)
    ) {
      latest.set(compoundKey, { targetKey, direction, createdAt: event.created_at, eventId: event.id });
    }
  }

  const tallies = new Map<string, VoteTally>();
  for (const vote of latest.values()) {
    const tally = tallies.get(vote.targetKey) ?? { up: 0, down: 0, score: 0 };
    if (vote.direction === 1) tally.up++;
    else tally.down++;
    tally.score = tally.up - tally.down;
    tallies.set(vote.targetKey, tally);
  }
  return tallies;
}

const LS_MY_VOTES = 'presearchstr:votes';

export function getMyVote(targetKey: string): VoteDirection | null {
  try {
    const raw = localStorage.getItem(LS_MY_VOTES);
    const parsed: Record<string, number> = raw ? JSON.parse(raw) : {};
    const value = parsed[targetKey];
    return value === 1 || value === -1 ? value : null;
  } catch {
    return null;
  }
}

export function setMyVote(targetKey: string, direction: VoteDirection | null): void {
  try {
    const raw = localStorage.getItem(LS_MY_VOTES);
    const parsed: Record<string, number> = raw ? JSON.parse(raw) : {};
    if (direction === null) delete parsed[targetKey];
    else parsed[targetKey] = direction;
    localStorage.setItem(LS_MY_VOTES, JSON.stringify(parsed));
  } catch {
    // Storage unavailable — local button state simply will not persist.
  }
}
