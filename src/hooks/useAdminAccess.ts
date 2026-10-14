/**
 * Access control hook — resolves the current user's team role.
 *
 *   1. pubkey === OWNER_PUBKEY           → 'owner'
 *  2. in owner-signed admin role list   → 'admin'
 *   3. in owner-signed mod role list    → 'moderator'
 *   4. otherwise                        → 'user'
 *
 * Role lists are kind 30078 addressable events published by the owner
 * (see src/lib/moderation.ts). Adapted from 0xNostr-Relay-Finder's
 * useAdminAccess.
 */
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { queryRelayPool } from '@/lib/searchRelays';
import {
  OWNER_PUBKEY,
  ROLES_KIND,
  ADMIN_ROLES_D_TAG,
  MOD_ROLES_D_TAG,
  getModerationRelayUrls,
  parseRoleList,
  type AppRole,
} from '@/lib/moderation';
import { useCurrentUser } from '@/hooks/useCurrentUser';

/** Public moderation depends on these lists, including for logged-out visitors. */
export function useRoleLists(): { admins: string[]; mods: string[]; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-roles'],
    queryFn: async ({ signal }) => {
      const settled = await queryRelayPool(
        getModerationRelayUrls(),
        [{
          kinds: [ROLES_KIND],
          authors: [OWNER_PUBKEY], // trust boundary: owner-signed only
          '#d': [ADMIN_ROLES_D_TAG, MOD_ROLES_D_TAG],
          limit: 2,
        }],
        { signal },
      );

      const latest = new Map<string, NostrEvent>();

      for (const value of settled) {
        for (const ev of value) {
          if (ev.kind !== ROLES_KIND || ev.pubkey !== OWNER_PUBKEY) continue;
          const d = ev.tags.find(([n]) => n === 'd')?.[1];
          if (d !== ADMIN_ROLES_D_TAG && d !== MOD_ROLES_D_TAG) continue;
          const previous = latest.get(d);
          if (!previous || ev.created_at > previous.created_at
            || (ev.created_at === previous.created_at && ev.id < previous.id)) {
            latest.set(d, ev);
          }
        }
      }

      const admins = latest.get(ADMIN_ROLES_D_TAG);
      const mods = latest.get(MOD_ROLES_D_TAG);
      return {
        admins: admins ? parseRoleList(admins) : [],
        mods: mods ? parseRoleList(mods) : [],
      };
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });

  return { admins: data?.admins ?? [], mods: data?.mods ?? [], isLoading };
}

/** The set of pubkeys trusted to moderate (owner + admins + mods). */
export function useTrustedModerators(): Set<string> {
  const { admins, mods } = useRoleLists();
  return new Set([OWNER_PUBKEY, ...admins, ...mods]);
}

export function useAdminAccess() {
  const { user } = useCurrentUser();
  const { admins, mods, isLoading } = useRoleLists();

  const pubkey = user?.pubkey ?? '';

  const role: AppRole = (() => {
    if (pubkey === OWNER_PUBKEY) return 'owner';
    if (admins.includes(pubkey)) return 'admin';
    if (mods.includes(pubkey)) return 'moderator';
    return 'user';
  })();

  return {
    role,
    isOwner: role === 'owner',
    /** Admin = owner or admin list. */
    isAdmin: role === 'owner' || role === 'admin',
    /** Mod = any team member (owner, admin, moderator). */
    isMod: role === 'owner' || role === 'admin' || role === 'moderator',
    /** Roles tab (add/remove team members) — owner only. */
    canManageRoles: role === 'owner',
    isLoading,
    adminList: admins,
    modList: mods,
  };
}
