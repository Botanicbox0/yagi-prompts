import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asRole, MIGRATIONS_DIR, coreMigrationFiles, expectReject, freshDb, glueMigrationFiles } from '../helpers/pglite';

/**
 * Brand home news follow-ups (slice N2) — migrations 0204 (core) and 0205 (glue). Pinned:
 *  - 0204 applies after 0196/0202, re-applies cleanly, validates `brand_announcements_slot` for
 *    `'home'` and `'team_home'` only, keeps one live announcement PER slot (`brand_announcements_one_live`),
 *    and preserves every existing `'home'` row;
 *  - 0205 pairs with 0204, keeps deny-all RLS and browser revokes on both tables with zero policies,
 *    and grants ONLY `delete` on `public.brand_announcements` to `service_role`.
 */
const CORE = '0204_core_brand_news_slots.sql';
const GLUE = '0205_glue_brand_news_slots.sql';

let db: PGlite;
let admin: string;

beforeEach(async () => {
  db = await freshDb();
  admin = randomUUID();
  await db.query('insert into auth.users (id) values ($1)', [admin]);
  await db.query('insert into profiles (id, email) values ($1, $2)', [admin, `${admin}@fixture.invalid`]);
});

afterEach(async () => {
  await db.close();
});

const START = '2026-12-01T00:00:00Z';
const END = '2026-12-15T00:00:00Z';

async function insert(over: Record<string, unknown> = {}): Promise<string> {
  const row: Record<string, unknown> = {
    id: randomUUID(),
    title_ko: '새 소식',
    title_en: 'News',
    cta_href: '/brand/home',
    starts_at: START,
    ends_at: END,
    created_by: admin,
    ...over,
  };
  const keys = Object.keys(row);
  await db.query(
    `insert into brand_announcements (${keys.join(', ')}) values (${keys.map((k, i) => (k === 'audience' ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(', ')})`,
    keys.map((k) => row[k]),
  );
  return String(row.id);
}

describe('0204 — brand_announcements slot extension', () => {
  it('applies after 0196 and 0202, and is re-runnable without error', async () => {
    const files = coreMigrationFiles();
    expect(files).toContain(CORE);
    expect(files.indexOf(CORE)).toBeGreaterThan(files.indexOf('0196_core_brand_news.sql'));
    expect(files.indexOf(CORE)).toBeGreaterThan(files.indexOf('0202_core_brand_send_invite.sql'));

    await db.exec(readFileSync(join(MIGRATIONS_DIR, CORE), 'utf8'));

    const { rows: checks } = await db.query<{ conname: string; valid: boolean }>(
      `select conname, convalidated as valid from pg_constraint
        where conrelid = 'public.brand_announcements'::regclass and conname = 'brand_announcements_slot'`,
    );
    expect(checks).toEqual([{ conname: 'brand_announcements_slot', valid: true }]);
  });

  it('says on the first line that the cloud needs it applied', () => {
    for (const file of [CORE, GLUE]) {
      expect(readFileSync(join(MIGRATIONS_DIR, file), 'utf8').startsWith('-- 클라우드 적용 필요'), file).toBe(true);
    }
  });

  it('accepts home and team_home, rejects unknown slots, and preserves existing rows', async () => {
    const homeDraft = await insert({ slot: 'home' });
    const teamDraft = await insert({ slot: 'team_home' });

    expect(
      (await db.query<{ slot: string }>('select slot from brand_announcements where id = $1', [homeDraft])).rows[0]!.slot,
    ).toBe('home');
    expect(
      (await db.query<{ slot: string }>('select slot from brand_announcements where id = $1', [teamDraft])).rows[0]!.slot,
    ).toBe('team_home');

    for (const bad of ['studio', 'admin', 'team', '']) {
      expect(await expectReject(() => insert({ slot: bad })), bad).toMatch(/brand_announcements_slot/);
    }
  });

  it('allows one live announcement per slot at the same time (home + team_home) and rejects a second live in team_home', async () => {
    const liveHome = await insert({ slot: 'home', status: 'live', published_at: START });
    const liveTeam = await insert({ slot: 'team_home', status: 'live', published_at: START });

    expect(liveHome).not.toBe(liveTeam);
    expect(
      await expectReject(() => insert({ slot: 'team_home', status: 'live', published_at: START })),
    ).toMatch(/brand_announcements_one_live|duplicate key/);
    expect(
      await expectReject(() => insert({ slot: 'home', status: 'live', published_at: START })),
    ).toMatch(/brand_announcements_one_live|duplicate key/);
  });

  it('refuses direct SQL deletion of live or ended rows via trigger while allowing draft deletion without dismissal DELETE grant', async () => {
    const coreSql = readFileSync(join(MIGRATIONS_DIR, CORE), 'utf8');
    expect(coreSql).not.toMatch(/^\s*begin\s*;/im);
    expect(coreSql).toMatch(/before delete on brand_announcements/i);
    expect(coreSql).toMatch(/set search_path = public, pg_temp/i);
    expect(coreSql).not.toMatch(/security definer/i);

    const draftId = await insert({ slot: 'team_home', status: 'draft' });
    const liveId = await insert({ slot: 'home', status: 'live', published_at: START });
    const endedId = await insert({ slot: 'team_home', status: 'ended', published_at: START, ended_at: END });
    await db.query('insert into brand_announcement_dismissals (announcement_id, user_id) values ($1, $2)', [draftId, admin]);

    // Direct owner SQL delete is refused on live and ended rows by the trigger.
    expect(
      await expectReject(() => db.query('delete from brand_announcements where id = $1', [liveId])),
    ).toMatch(/brand_announcements: only a draft can be deleted/);
    expect(
      await expectReject(() => db.query('delete from brand_announcements where id = $1', [endedId])),
    ).toMatch(/brand_announcements: only a draft can be deleted/);

    // Under glue 0197 + 0205, service_role has NO DELETE grant on dismissals yet draft cascade still succeeds.
    await db.exec(
      'create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;',
    );
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '0197_glue_brand_news.sql'), 'utf8'));
    await db.exec(readFileSync(join(MIGRATIONS_DIR, GLUE), 'utf8'));

    const priv = async (table: string, op: string) =>
      (await db.query<{ allowed: boolean }>("select has_table_privilege('service_role', $1, $2) as allowed", [table, op])).rows[0]!
        .allowed;
    expect(await priv('brand_announcements', 'DELETE')).toBe(true);
    expect(await priv('brand_announcement_dismissals', 'DELETE')).toBe(false);
    expect(await priv('brand_announcement_dismissals', 'UPDATE')).toBe(false);
    expect(
      (
        await db.query<{ allowed: boolean }>(
          "select has_function_privilege('service_role', 'brand_announcements_draft_delete_only()', 'EXECUTE') as allowed",
        )
      ).rows[0]!.allowed,
    ).toBe(false);

    await asRole(db, 'service_role', async () => {
      expect(
        await expectReject(() => db.query('delete from brand_announcements where id = $1', [liveId])),
      ).toMatch(/brand_announcements: only a draft can be deleted/);
      expect(
        await expectReject(() => db.query('delete from brand_announcements where id = $1', [endedId])),
      ).toMatch(/brand_announcements: only a draft can be deleted/);

      await db.query('delete from brand_announcements where id = $1', [draftId]);
    });

    expect((await db.query('select 1 from brand_announcements where id = $1', [draftId])).rows).toEqual([]);
    expect((await db.query('select 1 from brand_announcement_dismissals where announcement_id = $1', [draftId])).rows).toEqual([]);
    expect((await db.query('select 1 from brand_announcements where id in ($1, $2)', [liveId, endedId])).rows).toHaveLength(2);
  });
});

describe('0205 — glue', () => {
  const glue = readFileSync(join(MIGRATIONS_DIR, GLUE), 'utf8');
  const statements = glue.replace(/--[^\n]*/g, '');

  it('pairs with 0204 as a glue file and keeps deny-all RLS without any policy', () => {
    expect(glueMigrationFiles()).toContain(GLUE);
    for (const table of ['brand_announcements', 'brand_announcement_dismissals']) {
      expect(glue, table).toContain(`'${table}'`);
    }
    expect(glue).toContain('enable row level security');
    expect(glue).toContain('force row level security');
    expect(glue).toContain('revoke all on public.%I from public,anon,authenticated');
    expect(statements).not.toMatch(/create\s+policy/i);
    expect(statements).not.toMatch(/to\s+(anon|authenticated|public)\b/i);
  });

  it('grants ONLY delete on brand_announcements to service_role and never delete on dismissals or update on slot', () => {
    const grants = statements.match(/grant[^;]*;/gi)!.map((g) => g.replace(/\s+/g, ' ').trim());
    expect(grants).toEqual(['grant delete on public.brand_announcements to service_role;']);
    expect(statements).not.toMatch(/brand_announcement_dismissals[^;]*delete/i);
    expect(statements).not.toMatch(/grant\s+update/i);
  });
});
