import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { coreMigrationFiles, readMigration } from '@/lib/db/migrations';
import { recipeSha256, reviseFormatRecipe } from '@/lib/creator-platform/format-revision';
import { filmRecipe, seedFormatTemplate, type FormatFixture } from '../helpers/format-fixture';
import { freshDb, runner } from '../helpers/pglite';

/**
 * Migration 0192 — `platform_private_format()` in the REAL database (PGlite, every core migration applied). The recipe
 * of a format template changes only when the same transaction has written an audit row ('format.reviseRecipe', this
 * template), a revision row naming it and recording exactly this change, and the setting naming the audit row — and
 * only for a format the company-payout account owns. Everything 0046/0059 froze stays frozen with or without it.
 *
 * Migration 0206 — "the same transaction" is the top-level transaction id the database stamps on both evidence rows
 * (`txid`, BEFORE INSERT, `txid_current()`), on top of 0192's `created_at = transaction_timestamp()`, which stays.
 */

const CONTRACT = 'platform private format contract';
const NEXT_PROMPT = 'A slow push-in on {{selfie}} standing in a rain-lit alley, neon reflections on wet stone.';
const TXID_MIGRATION = '0206_core_format_revision_txid.sql';

interface Evidence {
  auditId?: string;
  action?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  setting?: string | null;
  skipRevision?: boolean;
  /** A SQL expression the WRITER supplies for `txid` on both rows (0206's trigger must overwrite it). */
  txid?: string;
  /** Write each evidence row inside its own nested savepoint (released), as a subtransaction would. */
  savepoints?: boolean;
}

/** Every core migration before 0206 — the cloud database between this deploy and 0206's application. */
async function dbBefore0206(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec('create schema if not exists auth; create table if not exists auth.users (id uuid primary key);');
  for (const file of coreMigrationFiles().filter((name) => Number(name.slice(0, 4)) < 206)) await db.exec(readMigration(file));
  return db;
}

/**
 * TEST-ONLY: make an earlier transaction's evidence rows carry THIS transaction's start time — what two transactions
 * starting in the same instant (or PGlite's coarse clock) produce. The immutability triggers are lifted for these two
 * updates only; `txid` is not touched.
 */
async function sameStartTime(tx: SqlRunner, auditId: string): Promise<void> {
  await tx.query('set local session_replication_role = replica');
  await tx.query('update platform_audit set created_at = transaction_timestamp() where id = $1', [auditId]);
  await tx.query('update platform_format_revisions set created_at = transaction_timestamp() where audit_id = $1', [auditId]);
  await tx.query('set local session_replication_role = origin');
  const { rows } = await tx.query<{ audit: boolean; revision: boolean }>(
    `select (select created_at = transaction_timestamp() from platform_audit where id = $1) as audit,
            (select created_at = transaction_timestamp() from platform_format_revisions where audit_id = $1) as revision`,
    [auditId],
  );
  expect(rows[0]).toEqual({ audit: true, revision: true });
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
    const txidColumn = e.txid === undefined ? '' : ', txid';
    const txidValue = e.txid === undefined ? '' : `, ${e.txid}`;
    if (e.savepoints) await tx.query('savepoint evidence_audit');
    if (e.auditId === undefined) {
      await tx.query(
        `insert into platform_audit (id, actor_id, entity_id, action, reason, details${txidColumn}) values ($1, null, $2, $3, 'fixture revision reason', '{}'::jsonb${txidValue})`,
        [auditId, e.entityId ?? f.templateId, e.action ?? 'format.reviseRecipe'],
      );
    }
    if (e.savepoints) await tx.query('savepoint evidence_revision');
    if (!e.skipRevision) {
      const before = e.before ?? (await tx.query<{ recipe: unknown }>('select recipe from prompt_items where id = $1', [f.templateId])).rows[0]!.recipe;
      const after = e.after ?? next;
      await tx.query(
        `insert into platform_format_revisions (format_id, template_id, audit_id, reason, before, after, before_sha256, after_sha256, prompt_text_before, prompt_text_after${txidColumn})
         values ($1, $2, $3, 'fixture revision reason', $4::jsonb, $5::jsonb, $6, $7, 'before', 'after'${txidValue})`,
        [f.formatId, f.templateId, auditId, JSON.stringify(before), JSON.stringify(after), recipeSha256(before), recipeSha256(after)],
      );
    }
    if (e.savepoints) {
      await tx.query('release savepoint evidence_revision');
      await tx.query('release savepoint evidence_audit');
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

  // --- 0206: the same transaction is the stamped top-level transaction id ------------------------------------------

  it('0206 — evidence from an earlier transaction is refused even when its created_at equals this transaction’s start', async () => {
    const f = await seedFormatTemplate(sql);
    const next = filmRecipe(NEXT_PROMPT);
    let stale = '';
    await sql.transaction(async (tx) => {
      stale = await writeEvidence(tx, f, next, { setting: null });
    });
    // 0192's timestamp rule would let this through: both rows now carry this transaction's start time.
    await expect(
      sql.transaction(async (tx) => {
        await sameStartTime(tx, stale);
        await tx.query("select set_config('app.format_revision', $1, true)", [stale]);
        await tx.query('update prompt_items set recipe = $2::jsonb where id = $1', [f.templateId, JSON.stringify(next)]);
      }),
    ).rejects.toThrow(CONTRACT);
    expect(await recipeOf(f.templateId)).toEqual(f.recipe);
  });

  it('0206 — the writer cannot choose txid: a supplied value is overwritten, and one aimed at the next transaction does not open it', async () => {
    const f = await seedFormatTemplate(sql);
    const next = filmRecipe(NEXT_PROMPT);
    // A supplied value is replaced by the inserting transaction's own id, on both tables.
    await sql.transaction(async (tx) => {
      const auditId = await writeEvidence(tx, f, next, { setting: null, txid: '42' });
      const { rows } = await tx.query<{ audit: number; revision: number; top: number }>(
        `select (select txid from platform_audit where id = $1) as audit,
                (select txid from platform_format_revisions where audit_id = $1) as revision,
                txid_current() as top`,
        [auditId],
      );
      expect(rows[0]!.top).not.toBe(42);
      expect(rows[0]).toEqual({ audit: rows[0]!.top, revision: rows[0]!.top, top: rows[0]!.top });
    });
    // Nor can it be rewritten later: both evidence tables refuse every update.
    await expect(sql.query('update platform_audit set txid = txid_current()')).rejects.toThrow('platform immutable record');
    await expect(sql.query('update platform_format_revisions set txid = txid_current()')).rejects.toThrow('platform immutable record');

    // Forged evidence: transaction 1 claims the id the NEXT transaction will get (PGlite has one connection, so it
    // is exactly txid_current() + 1) and keeps the timestamps equal as above.
    let forged = '';
    await sql.transaction(async (tx) => {
      forged = await writeEvidence(tx, f, next, { setting: null, txid: 'txid_current() + 1' });
    });
    await expect(
      sql.transaction(async (tx) => {
        const { rows } = await tx.query<{ top: number; audit: number; revision: number }>(
          `select txid_current() as top, (select txid from platform_audit where id = $1) as audit,
                  (select txid from platform_format_revisions where audit_id = $1) as revision`,
          [forged],
        );
        // The forgery aimed right — had it been stored, it would match this transaction — but the stamp kept tx 1's.
        expect(rows[0]).toEqual({ top: rows[0]!.top, audit: rows[0]!.top - 1, revision: rows[0]!.top - 1 });
        await sameStartTime(tx, forged);
        await tx.query("select set_config('app.format_revision', $1, true)", [forged]);
        await tx.query('update prompt_items set recipe = $2::jsonb where id = $1', [f.templateId, JSON.stringify(next)]);
      }),
    ).rejects.toThrow(CONTRACT);
    expect(await recipeOf(f.templateId)).toEqual(f.recipe);
  });

  it('0206 — evidence written inside savepoints, and the update inside another: still this transaction, allowed', async () => {
    const f = await seedFormatTemplate(sql);
    const next = filmRecipe(NEXT_PROMPT);
    await sql.transaction(async (tx) => {
      const auditId = await writeEvidence(tx, f, next, { savepoints: true });
      const { rows } = await tx.query<{ audit: number; revision: number; audit_xmin: number; revision_xmin: number; top: number }>(
        `select a.txid as audit, r.txid as revision, a.xmin::text::bigint as audit_xmin, r.xmin::text::bigint as revision_xmin, txid_current() as top
           from platform_audit a join platform_format_revisions r on r.audit_id = a.id where a.id = $1`,
        [auditId],
      );
      const row = rows[0]!;
      // The stamp is the top-level id; the rows' xmin is each subtransaction's own (why xmin is not the rule).
      expect([row.audit, row.revision]).toEqual([row.top, row.top]);
      expect(row.audit_xmin).not.toBe(row.top);
      expect(row.revision_xmin).not.toBe(row.top);
      await tx.query('savepoint recipe_update');
      await tx.query('update prompt_items set recipe = $2::jsonb where id = $1', [f.templateId, JSON.stringify(next)]);
      await tx.query('release savepoint recipe_update');
    });
    expect(await recipeOf(f.templateId)).toEqual(next);
  });

  it('0206 — evidence without a txid never counts, even written in this very transaction', async () => {
    const f = await seedFormatTemplate(sql);
    const next = filmRecipe(NEXT_PROMPT);
    await expect(
      sql.transaction(async (tx) => {
        // TEST-ONLY: what a row from before 0206 looks like — the stamp switched off for these two inserts.
        await tx.query('alter table platform_audit disable trigger platform_audit_txid');
        await tx.query('alter table platform_format_revisions disable trigger platform_format_revisions_txid');
        const auditId = await writeEvidence(tx, f, next);
        await tx.query('alter table platform_audit enable trigger platform_audit_txid');
        await tx.query('alter table platform_format_revisions enable trigger platform_format_revisions_txid');
        const { rows } = await tx.query<{ audit: number | null; revision: number | null; same_start: boolean }>(
          `select a.txid as audit, r.txid as revision,
                  a.created_at = transaction_timestamp() and r.created_at = transaction_timestamp() as same_start
             from platform_audit a join platform_format_revisions r on r.audit_id = a.id where a.id = $1`,
          [auditId],
        );
        expect(rows[0]).toEqual({ audit: null, revision: null, same_start: true });
        await tx.query('update prompt_items set recipe = $2::jsonb where id = $1', [f.templateId, JSON.stringify(next)]);
      }),
    ).rejects.toThrow(CONTRACT);
    expect(await recipeOf(f.templateId)).toEqual(f.recipe);
  });

  it('0206 — on a database that already holds evidence: rows stay NULL, apply twice is safe, the operation works before and after', async () => {
    const old = await dbBefore0206();
    try {
      const oldSql = runner(old);
      const f = await seedFormatTemplate(oldSql);
      const next = filmRecipe(NEXT_PROMPT);
      const reason = 'Fixture: the studio rewrites its own format';
      // Before 0206 (the cloud between this deploy and the apply): the operation works under 0192's rule.
      expect(await reviseFormatRecipe(oldSql, null, { id: f.templateId, reviewedSha256: recipeSha256(f.recipe), reason, recipe: next })).toMatchObject({ ok: true });
      // Stale evidence left by a transaction before 0206.
      const stale = randomUUID();
      await oldSql.transaction(async (tx) => {
        await tx.query(
          "insert into platform_audit (id, actor_id, entity_id, action, reason, details) values ($1, null, $2, 'format.reviseRecipe', 'fixture revision reason', '{}'::jsonb)",
          [stale, f.templateId],
        );
        await tx.query(
          `insert into platform_format_revisions (format_id, template_id, audit_id, reason, before, after, before_sha256, after_sha256, prompt_text_before, prompt_text_after)
           values ($1, $2, $3, 'fixture revision reason', $4::jsonb, $5::jsonb, $6, $7, 'before', 'after')`,
          [f.formatId, f.templateId, stale, JSON.stringify(next), JSON.stringify(f.recipe), recipeSha256(next), recipeSha256(f.recipe)],
        );
      });

      await old.exec(readMigration(TXID_MIGRATION));
      await old.exec(readMigration(TXID_MIGRATION));
      const { rows: counts } = await oldSql.query<{ audits: number; revisions: number; triggers: number }>(
        `select (select count(*)::int from platform_audit where txid is not null) as audits,
                (select count(*)::int from platform_format_revisions where txid is not null) as revisions,
                (select count(*)::int from pg_trigger where tgname in ('platform_audit_txid', 'platform_format_revisions_txid')) as triggers`,
      );
      expect(counts[0]).toEqual({ audits: 0, revisions: 0, triggers: 2 });

      // The pre-0206 rows never count, even with this transaction's start time on them.
      await expect(
        oldSql.transaction(async (tx) => {
          await sameStartTime(tx, stale);
          await tx.query("select set_config('app.format_revision', $1, true)", [stale]);
          await tx.query('update prompt_items set recipe = $2::jsonb where id = $1', [f.templateId, JSON.stringify(f.recipe)]);
        }),
      ).rejects.toThrow(CONTRACT);
      // After 0206 the operation works unchanged, and its evidence carries the stamp.
      expect(await reviseFormatRecipe(oldSql, null, { id: f.templateId, reviewedSha256: recipeSha256(next), reason, recipe: f.recipe })).toMatchObject({ ok: true });
      expect((await oldSql.query<{ recipe: unknown }>('select recipe from prompt_items where id = $1', [f.templateId])).rows[0]!.recipe).toEqual(f.recipe);
      const { rows: stamped } = await oldSql.query<{ audits: number; revisions: number }>(
        `select (select count(*)::int from platform_audit where txid is not null and action = 'format.reviseRecipe') as audits,
                (select count(*)::int from platform_format_revisions where txid is not null) as revisions`,
      );
      expect(stamped[0]).toEqual({ audits: 1, revisions: 1 });
    } finally {
      await old.close();
    }
  });
});
