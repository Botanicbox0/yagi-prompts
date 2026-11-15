import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, coreMigrationFiles, freshDb, glueMigrationFiles } from '../helpers/pglite';

/**
 * 0091 — one nullable column on `render_jobs`: the passes that are copying a film the provider has
 * finished (lib/renders/collect.ts). Server-written only.
 */

const CORE = '0091_core_render_collecting.sql';

describe('0091 render collecting (core)', () => {
  it('is a core migration with no glue partner, and says it must be cloud-applied', () => {
    expect(coreMigrationFiles()).toContain(CORE);
    expect(glueMigrationFiles().some((file) => file.startsWith('0091'))).toBe(false);
    const text = readFileSync(join(MIGRATIONS_DIR, CORE), 'utf8');
    expect(text.split('\n')[0]).toMatch(/^-- CLOUD APPLICATION REQUIRED/);
    const statements = text.split('\n').filter((line) => !line.startsWith('--')).join('\n').toLowerCase();
    expect(statements).not.toMatch(/create table|grant |create policy/);
  });

  it('adds collecting as a nullable jsonb column with no default', async () => {
    const db = await freshDb();
    const { rows } = await db.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `select column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'render_jobs' and column_name = 'collecting'`,
    );
    expect(rows).toEqual([{ column_name: 'collecting', data_type: 'jsonb', is_nullable: 'YES', column_default: null }]);
    await db.close();
  });
});
