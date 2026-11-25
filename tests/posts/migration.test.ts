import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { MIGRATIONS_DIR, coreMigrationFiles, expectReject, freshDb, glueMigrationFiles } from '../helpers/pglite';

const CORE = '0196_core_creator_posts.sql';
const GLUE = '0197_glue_creator_posts.sql';

let db: PGlite | null = null;
afterEach(async () => {
  await db?.close();
  db = null;
});

describe('0196 / 0197 — creator_posts migrations', () => {
  it('applies cleanly, is idempotent when run twice, and enforces constraints', async () => {
    db = await freshDb();
    await db.exec(readFileSync(join(MIGRATIONS_DIR, CORE), 'utf8'));

    const user = randomUUID();
    await db.query('insert into auth.users (id) values ($1)', [user]);
    await db.query("insert into profiles (id, email, locale) values ($1, 'blog-mig@example.test', 'ko')", [user]);
    await db.query("insert into platform_creators (user_id, active, contract_version) values ($1, true, 'owl-p-v1')", [
      user,
    ]);

    const id = randomUUID();
    await db.query(
      "insert into creator_posts (id, user_id, slug, title, blocks, status) values ($1, $2, 'first-post', 'First Post', '[]'::jsonb, 'draft')",
      [id, user],
    );

    // Duplicate (user_id, slug) rejected
    expect(
      await expectReject(() =>
        db!.query(
          "insert into creator_posts (id, user_id, slug, title, blocks, status) values ($1, $2, 'first-post', 'Dup Post', '[]'::jsonb, 'draft')",
          [randomUUID(), user],
        ),
      ),
    ).toMatch(/unique|duplicate/i);

    // Invalid status rejected
    expect(
      await expectReject(() =>
        db!.query("update creator_posts set status = 'submitted' where id = $1", [id]),
      ),
    ).toMatch(/status/i);

    // Invalid slug rejected
    expect(
      await expectReject(() =>
        db!.query(
          "insert into creator_posts (id, user_id, slug, title, blocks, status) values ($1, $2, 'BAD_SLUG', 'Bad slug', '[]'::jsonb, 'draft')",
          [randomUUID(), user],
        ),
      ),
    ).toMatch(/slug/i);
  });

  it('locks down both tables in 0197 glue with deny-all RLS and service_role only grants', () => {
    expect(coreMigrationFiles()).toContain(CORE);
    expect(glueMigrationFiles()).toContain(GLUE);
    for (const file of [CORE, GLUE]) {
      expect(readFileSync(join(MIGRATIONS_DIR, file), 'utf8').startsWith('-- 클라우드 적용 필요'), file).toBe(true);
    }
    const glue = readFileSync(join(MIGRATIONS_DIR, GLUE), 'utf8');
    for (const table of ['creator_posts', 'creator_post_templates']) {
      expect(glue, table).toContain(`'${table}'`);
    }
    expect(glue).toContain('enable row level security');
    expect(glue).toContain('force row level security');
    expect(glue).toContain('revoke all on public.%I from public,anon,authenticated');
    expect(glue).toContain('grant select,insert,update,delete on public.%I to service_role');
    expect(glue).not.toMatch(/create\s+policy/i);
    expect(glue.replace(/--[^\n]*/g, '')).not.toMatch(/to\s+(anon|authenticated|public)\b/i);
  });
});
