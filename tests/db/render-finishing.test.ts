import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, coreMigrationFiles, freshDb, glueMigrationFiles } from '../helpers/pglite';

/**
 * 0055 — docs/PLATFORM-2.0.md §3.2-4·5. Two nullable columns on `render_jobs`: when the provider's
 * "done" was seen (the wait's "마무리") and the film's captured share frame. Server-written only.
 */

const CORE = '0055_core_render_finishing.sql';

describe('0055 render finishing (core)', () => {
  it('is a core migration with no glue partner, and says it must be cloud-applied', () => {
    expect(coreMigrationFiles()).toContain(CORE);
    expect(glueMigrationFiles().some((file) => file.startsWith('0055'))).toBe(false);
    const text = readFileSync(join(MIGRATIONS_DIR, CORE), 'utf8');
    expect(text.split('\n')[0]).toMatch(/^-- CLOUD APPLICATION REQUIRED/);
    const statements = text.split('\n').filter((line) => !line.startsWith('--')).join('\n').toLowerCase();
    expect(statements).not.toMatch(/create table|grant |create policy/);
  });

  it('adds finishing_at and poster_key as nullable columns, and only a render-scoped poster key fits', async () => {
    const db = await freshDb();
    const { rows } = await db.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `select column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'render_jobs' and column_name in ('finishing_at', 'poster_key') order by column_name`,
    );
    expect(rows).toEqual([
      { column_name: 'finishing_at', data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null },
      { column_name: 'poster_key', data_type: 'text', is_nullable: 'YES', column_default: null },
    ]);
    const { rows: checks } = await db.query<{ ok: boolean }>(
      `select $1 ~ '^[0-9a-f-]{36}/poster\.jpg$' as ok union all select $2 ~ '^[0-9a-f-]{36}/poster\.jpg$'`,
      ['22222222-2222-4222-8222-222222222222/poster.jpg', '../other/poster.jpg'],
    );
    expect(checks.map((row) => row.ok)).toEqual([true, false]);
    await db.close();
  });
});
