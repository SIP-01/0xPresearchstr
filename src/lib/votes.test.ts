import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import { EXTERNAL_REACTION_KIND, VOTE_KIND, tallyVotes, voteTargetFor } from './votes';

function event(input: Partial<NostrEvent> & Pick<NostrEvent, 'id' | 'pubkey' | 'kind' | 'created_at' | 'content' | 'tags'>): NostrEvent {
  return input as NostrEvent;
}

describe('NIP-25 external web reaction URL identity', () => {
  it('uses NIP-73 URL normalization for new kind-17 events and keeps a legacy tally alias', () => {
    const target = voteTargetFor({ url: 'https://www.example.com/page?utm_source=client#section' });
    expect(target?.kind).toBe(EXTERNAL_REACTION_KIND);
    expect(target?.key).toBe('u:https://www.example.com/page?utm_source=client');
    expect(target?.legacyKey).toBe('u:https://example.com/page');
    expect(target?.tags).toEqual([
      ['k', 'web'],
      ['i', 'https://www.example.com/page?utm_source=client'],
    ]);
  });

  it('keeps native Nostr event reactions on kind 7', () => {
    const target = voteTargetFor({
      url: '',
      source: 'nostr',
      nostrEvent: { id: 'a'.repeat(64), pubkey: 'b'.repeat(64), kind: 1 },
    });
    expect(target?.kind).toBe(VOTE_KIND);
    expect(target?.tags[0]).toEqual(['e', 'a'.repeat(64)]);
  });

  it('reads old kind-7/r reactions under the legacy canonical key', () => {
    const reaction = event({
      id: 'c'.repeat(64),
      pubkey: 'd'.repeat(64),
      kind: 7,
      created_at: 1,
      content: '+',
      tags: [['r', 'https://example.com/page']],
    });
    expect(tallyVotes([reaction]).get('u:https://example.com/page')).toEqual({
      up: 1,
      down: 0,
      score: 1,
    });
  });
});
