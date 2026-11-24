import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { recipeSha256 } from '@/lib/creator-platform/format-revision';
import { filmRecipe, seedFormatTemplate, type FormatFixture } from '../helpers/format-fixture';
import { freshDb, runner } from '../helpers/pglite';

/**
 * Migration 0192 — `platform_private_format()` in the REAL database (PGlite, every core migration applied). The recipe
 * of a format template changes only when the same transaction has written an audit row ('format.reviseRecipe', this
 * template), a revision row naming it and recording exactly this change, and the setting naming the audit row — and
 * only for a format the company-payout account owns. Everything 0046/0059 froze stays frozen with or without it.
 */

const CONTRACT = 'platform private format contract';
const NEXT_PROMPT = 'A slow push-in on {{selfie}} standing in a rain-lit alley, neon reflections on wet stone.';

interface Evidence {
  auditId?: string;
  action?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  setting?: string | null;
  skipRevision?: boolean;
}

describe('0192 — platform_private_format: the audited door for the studio’s own formats', () => {
  let db: PGlite;
  let sql: SqlRunner;
  beforeEach(async () => {
    db = await freshDb();
    sql = runner(db);
  });
  afterEach(async () => db.close());

  const recipeOf = async (id: string) => (await sql.query<{ recipe: unknown }>('select recipe from prompt_items where id = $1', [id])).rows[0]!.recipe;

  /** Writes the evidence in `tx` (audit row, revision row, setting) as the operation would, with any part bent. */
  async function writeEvidence(tx: SqlRunner, f: FormatFixture, next: unknown, e: Evidence = {}): Promise<string> {
    const auditId = e.auditId ?? randomUUID();
    if (e.auditId === undefined) {
      await tx.query(
        "insert into platform_audit (id, actor_id, entity_id, action, reason, details) values ($1, null, $2, $3, 'fixture revision reason', '{}'::jsonb)",
        [auditId, e.entityId ?? f.templateId, e.action ?? 'format.reviseRecipe'],
      );
    }
    if (!e.skipRevision) {
      const before = e.before ?? (await tx.query<{ recipe: unknown }>('select recipe from prompt_items where id = $1', [f.templateId])).rows[0]!.recipe;
      const after = e.after ?? next;
      await tx.query(
        `insert into platform_format_revisions (format_id, template_id, audit_id, reason, before, after, before_sha256, after_sha256, prompt_text_before, prompt_text_after)
         values ($1, $2, $3, 'fixture revision reason', $4::jsonb, $5::jsonb, $6, $7, 'before', 'after')`,
        [f.formatId, f.templateId, auditId, JSON.stringify(before), JSON.stringify(after), recipeSha256(before), recipeSha256(after)],
      );
    }
    const setting = e.setting === undefined ? auditId : e.setting;
    if (setting !== null) await tx.query("select set_config('app.format_revision', $1, true)", [setting]);
    return auditId;
  }

  async function revise(f: FormatFixture, next: unknown, e: Evidence = {}): Promise<void> {
    await sql.transaction(async (tx) => {
      await writeEvidence(tx, f, next, e);
      await tx.query('update prompt_items set recipe = $2::jsonb where id = $1', [f.templateId, JSON.stringify(next)]);
    });
  }

  it('without the setting, a random uuid or a non-uuid: the same exception as before 0192, nothing changed', async () => {
    const f = await seedFormatTemplate(sql);
    const next = filmRecipe(NEXT_PROMPT);
    await expect(sql.query('update prompt_items set recipe = $2::jsonb where id = $1', [f.templateId, JSON.stringify(next)])).rejects.toThrow(CONTRACT);
    await expect(revise(f, next, { setting: null })).rejects.toThrow(CONTRACT);
    await expect(revise(f, next, { setting: randomUUID() })).rejects.toThrow(CONTRACT);
    await expect(revise(f, next, { setting: 'not-a-uuid' })).rejects.toThrow(CONTRACT);
    await expect(revise(f, next, { setting: '' })).rejects.toThrow(CONTRACT);
    expect(await recipeOf(f.templateId)).toEqual(f.recipe);
    // Each refused transaction rolled back whole: no evidence was left behind either.
    expect((await sql.query<{ n: number }>('select count(*)::int as n from platform_format_revisions')).rows[0]!.n).toBe(0);
  });

  it('a valid same-transaction audit + revision for a company-payout format: allowed, exactly that change', async () => {
    const f = await seedFormatTemplate(sql, { payout: 'company' });
    const next = filmRecipe(NEXT_PROMPT);
    await revise(f, next);
    expect(await recipeOf(f.templateId)).toEqual(next);
    // The setting was transaction-local: the next transaction is back behind the guard.
    await expect(sql.query('update prompt_items set recipe = $2::jsonb where id = $1', [f.templateId, JSON.stringify(f.recipe)])).rejects.toThrow(CONTRACT);
    // A second revision can restore the first text.
    await revise(f, f.recipe);
    expect(await recipeOf(f.templateId)).toEqual(f.recipe);
  });

  it('an external creative’s format: refused even with perfect evidence', async () => {
    const f = await seedFormatTemplate(sql, { payout: 'external' });
    await expect(revise(f, filmRecipe(NEXT_PROMPT))).rejects.toThrow(CONTRACT);
    expect(await recipeOf(f.templateId)).toEqual(f.recipe);
  });

  it('evidence from an earlier transaction (stale audit and revision, or a stale audit with a fresh revision): refused', async () => {
    const f = await seedFormatTemplate(sql);
    const next = filmRecipe(NEXT_PROMPT);
    // Transaction 1 writes the audit and revision rows and commits WITHOUT touching the recipe.
    let staleAudit = '';
    await sql.transaction(async (tx) => {
      staleAudit = await writeEvidence(tx, f, next, { setting: null });
    });
    // Transaction 2 names them.
    await expect(
      sql.transaction(async (tx) => {
        await tx.query("select set_config('app.format_revision', $1, true)", [staleAudit]);
        await tx.query('update prompt_items set recipe = $2::jsonb where id = $1', [f.templateId, JSON.stringify(next)]);
      }),
    ).rejects.toThrow(CONTRACT);

    // A stale audit row alone, with a revision row written now that names it.
    let lonelyAudit = '';
    await sql.transaction(async (tx) => {
      lonelyAudit = randomUUID();
      await tx.query(
        "insert into platform_audit (id, actor_id, entity_id, action, reason, details) values ($1, null, $2, 'format.reviseRecipe', 'fixture revision reason', '{}'::jsonb)",
        [lonelyAudit, f.templateId],
      );
    });
    await expect(revise(f, next, { auditId: lonelyAudit })).rejects.toThrow(CONTRACT);
    expect(await recipeOf(f.templateId)).toEqual(f.recipe);
  });

  it('an audit row for another action or another template, or a revision row that records something else: refused', async () => {
    const f = await seedFormatTemplate(sql);
    const other = await seedFormatTemplate(sql, { ownerId: f.ownerId });
    const next = filmRecipe(NEXT_PROMPT);
    await expect(revise(f, next, { action: 'prompt.declareStyling' })).rejects.toThrow(CONTRACT);
    await expect(revise(f, next, { entityId: other.templateId })).rejects.toThrow(CONTRACT);
    await expect(revise(f, next, { after: filmRecipe(`${NEXT_PROMPT} Different.`) })).rejects.toThrow(CONTRACT);
    await expect(revise(f, next, { before: filmRecipe(`${NEXT_PROMPT} Not what was there.`) })).rejects.toThrow(CONTRACT);
    await expect(revise(f, next, { skipRevision: true })).rejects.toThrow(CONTRACT);
    // Clearing the recipe is never a revision (the revision's `after` is an object).
    await expect(
      sql.transaction(async (tx) => {
        await writeEvidence(tx, f, next);
        await tx.query('update prompt_items set recipe = null where id = $1', [f.templateId]);
      }),
    ).rejects.toThrow(CONTRACT);
    expect(await recipeOf(f.templateId)).toEqual(f.recipe);
  });

  it('disclosure, visibility, source and author stay frozen even with a valid revision in the same transaction', async () => {
    const f = await seedFormatTemplate(sql);
    const intruder = randomUUID();
    await sql.query('insert into auth.users (id) values ($1)', [intruder]);
    await sql.query('insert into profiles (id, email) values ($1, $2)', [intruder, 'intruder@example.test']);
    const next = filmRecipe(NEXT_PROMPT);
    const bent = [
      `update prompt_items set recipe = $2::jsonb, disclosure = '{"prompts":false,"assets":false}'::jsonb where id = $1`,
      `update prompt_items set recipe = $2::jsonb, text_visibility = 'public' where id = $1`,
      `update prompt_items set recipe = $2::jsonb, source = 'community', text_visibility = 'public' where id = $1`,
      `update prompt_items set recipe = $2::jsonb, author_id = '${intruder}' where id = $1`,
    ];
    for (const statement of bent) {
      await expect(
        sql.transaction(async (tx) => {
          await writeEvidence(tx, f, next);
          await tx.query(statement, [f.templateId, JSON.stringify(next)]);
        }),
      ).rejects.toThrow(CONTRACT);
    }
    // …and on their own, with the setting in place and the recipe untouched.
    await expect(
      sql.transaction(async (tx) => {
        await writeEvidence(tx, f, next);
        await tx.query(`update prompt_items set disclosure = '{"prompts":false,"assets":false}'::jsonb where id = $1`, [f.templateId]);
      }),
    ).rejects.toThrow(CONTRACT);
    const { rows } = await sql.query<{ recipe: unknown; disclosure: unknown; text_visibility: string; source: string; author_id: string }>(
      'select recipe, disclosure, text_visibility::text, source, author_id from prompt_items where id = $1',
      [f.templateId],
    );
    expect(rows[0]).toEqual({ recipe: f.recipe, disclosure: { prompts: true, assets: false }, text_visibility: 'hidden', source: 'yagi', author_id: f.ownerId });
  });

  it('a template with no format is not this guard’s business; the revision record is append-only and server-shaped', async () => {
    const f = await seedFormatTemplate(sql);
    // A studio original (no platform_formats row): its recipe changes as before, no setting needed.
    const plainId = randomUUID();
    await sql.query(
      `insert into prompt_items (id, slug, source, status, models, title, prompt_text, text_visibility, use_case, featured, medium)
       values ($1, 'studio-original-fixture', 'yagi', 'pending', '{seedance-2.5}', 'Studio original', 'Plain text prompt here.', 'hidden', '{}', false, 'video')`,
      [plainId],
    );
    await sql.query('update prompt_items set recipe = $2::jsonb where id = $1', [plainId, JSON.stringify(filmRecipe())]);

    await revise(f, filmRecipe(NEXT_PROMPT));
    await expect(sql.query('update platform_format_revisions set reason = $1', ['rewritten history'])).rejects.toThrow('platform immutable record');
    await expect(sql.query('delete from platform_format_revisions')).rejects.toThrow('platform immutable record');
    // A revision must change something and name a real reason.
    await expect(
      sql.query(
        `insert into platform_format_revisions (format_id, template_id, audit_id, reason, before, after, before_sha256, after_sha256, prompt_text_before, prompt_text_after)
         values ($1, $2, gen_random_uuid(), 'short', '{}'::jsonb, '{}'::jsonb, $3, $3, 'a', 'a')`,
        [f.formatId, f.templateId, 'a'.repeat(64)],
      ),
    ).rejects.toThrow();
  });
});
