import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_POLICY,
  canView,
  resolveVisibility,
  tierRank,
  visibilityRank,
  VISIBILITY_ORDER,
  TIER_ORDER,
} from '@/lib/content/visibility';
import { BLOCK_KINDS } from '@/lib/content/schemas';
import { MIGRATIONS_DIR } from '../helpers/pglite';

describe('shared visibility resolver (PLAN §6)', () => {
  it('orders gates public < free < pro < hidden and tiers anon < free < pro < admin', () => {
    expect(VISIBILITY_ORDER.map(visibilityRank)).toEqual([0, 1, 2, 3]);
    expect(TIER_ORDER.map(tierRank)).toEqual([0, 1, 2, 3]);
  });

  it('is coalesce(override, default_policy[kind])', () => {
    for (const kind of BLOCK_KINDS) {
      expect(resolveVisibility(null, kind)).toBe(DEFAULT_POLICY[kind]);
      expect(resolveVisibility(undefined, kind)).toBe(DEFAULT_POLICY[kind]);
      expect(resolveVisibility('hidden', kind)).toBe('hidden');
    }
  });

  it('accepts an alternate policy (the DB is authoritative at publish time)', () => {
    expect(resolveVisibility(null, 'prompt', { ...DEFAULT_POLICY, prompt: 'free' })).toBe('free');
  });

  it('keeps the TS default policy in lockstep with the migration seed rows', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '0002_core_schema.sql'), 'utf8');
    for (const kind of BLOCK_KINDS) {
      expect(sql, `default_policy seed for ${kind}`).toContain(`('${kind}','${DEFAULT_POLICY[kind]}')`);
    }
  });

  it('gates viewing by rank, exhaustively', () => {
    const table = TIER_ORDER.flatMap((tier) =>
      VISIBILITY_ORDER.map((visibility) => `${tier}/${visibility}=${canView(tier, visibility)}`),
    );
    expect(table).toEqual([
      'anon/public=true',
      'anon/free=false',
      'anon/pro=false',
      'anon/hidden=false',
      'free/public=true',
      'free/free=true',
      'free/pro=false',
      'free/hidden=false',
      'pro/public=true',
      'pro/free=true',
      'pro/pro=true',
      'pro/hidden=false',
      'admin/public=true',
      'admin/free=true',
      'admin/pro=true',
      'admin/hidden=true',
    ]);
  });
});
