import { randomUUID } from 'node:crypto';
import { AssetRefSchema, type AssetRef } from '@/lib/content/schemas';
import type { AdminContext } from './context';
import { rekeyAsset } from './assets';
import { findDraftRevisionId } from './repo';

/**
 * PLAN §3.8 — "Editing a published playbook clones it into a draft revision".
 *
 * What a clone must and must not carry:
 *   · steps and blocks are recreated with NEW ids, in the same order, with the same content;
 *   · `visibility` overrides come across (they are authorship); `resolved_visibility` does NOT —
 *     stamping belongs to `prepare_publish`, and the trigger in 0003 rejects an INSERT that carries
 *     a stamp from anyone but the `publisher` role anyway;
 *   · every AssetRef is RE-KEYED into the new revision's staging namespace (bytes copied, sha256
 *     preserved, `published_key`/`bucket` dropped) so the draft can never mutate — or serve — the
 *     objects the live revision depends on;
 *   · `change_note` starts empty: republishing requires a NEW note (§3.8, enforced by the RPC), and
 *     inheriting the previous one would let a stale note satisfy that gate.
 *
 * The source revision is not touched at all. `tests/admin/clone.test.ts` byte-compares it.
 */

export interface CloneResult {
  revisionId: string;
  revNo: number;
  steps: number;
  blocks: number;
  assets: number;
}

interface SourceRow {
  playbook_id: string;
  is_showcase: boolean;
  title: unknown;
  summary: unknown;
  difficulty: string;
  tools: string[] | null;
  models: string[] | null;
  est_time_min: number | null;
  est_cost_usd: string | number | null;
  hero_asset: unknown;
}

async function rekeyIfAsset(
  ctx: AdminContext,
  content: unknown,
  targetRevisionId: string,
): Promise<{ content: unknown; copied: boolean }> {
  if (content === null || typeof content !== 'object') return { content, copied: false };
  const record = content as Record<string, unknown>;
  const parsed = AssetRefSchema.safeParse(record.asset);
  if (!parsed.success) return { content, copied: false };
  const ref = await rekeyAsset(ctx.storage, parsed.data, targetRevisionId);
  return { content: { ...record, asset: ref }, copied: true };
}

export async function cloneRevision(
  ctx: AdminContext,
  sourceRevisionId: string,
): Promise<CloneResult> {
  const { sql } = ctx;

  const { rows: sourceRows } = await sql.query<SourceRow>(
    `select playbook_id, is_showcase, title, summary, difficulty, tools, models,
            est_time_min, est_cost_usd, hero_asset
       from playbook_revisions where id = $1`,
    [sourceRevisionId],
  );
  const source = sourceRows[0];
  if (!source) throw new Error(`revision ${sourceRevisionId} not found`);

  const { rows: maxRows } = await sql.query<{ next: number }>(
    'select coalesce(max(rev_no), 0) + 1 as next from playbook_revisions where playbook_id = $1',
    [source.playbook_id],
  );
  const revNo = maxRows[0]?.next ?? 1;
  const revisionId = randomUUID();

  let assets = 0;
  let hero: AssetRef | null = null;
  const parsedHero = AssetRefSchema.safeParse(source.hero_asset);
  if (parsedHero.success) {
    hero = await rekeyAsset(ctx.storage, parsedHero.data, revisionId);
    assets += 1;
  }

  await sql.query(
    `insert into playbook_revisions
       (id, playbook_id, rev_no, state, is_showcase, title, summary, difficulty,
        tools, models, est_time_min, est_cost_usd, hero_asset, change_note)
     values ($1, $2, $3, 'draft', $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12::jsonb, null)`,
    [
      revisionId,
      source.playbook_id,
      revNo,
      source.is_showcase,
      JSON.stringify(source.title),
      JSON.stringify(source.summary),
      source.difficulty,
      source.tools ?? [],
      source.models ?? [],
      source.est_time_min,
      source.est_cost_usd,
      hero === null ? null : JSON.stringify(hero),
    ],
  );

  const { rows: steps } = await sql.query<{
    id: string;
    order: number;
    title: unknown;
    body: unknown;
  }>('select id, "order", title, body from steps where revision_id = $1 order by "order"', [
    sourceRevisionId,
  ]);

  let blockCount = 0;
  for (const step of steps) {
    const stepId = randomUUID();
    await sql.query(
      `insert into steps (id, revision_id, "order", title, body)
       values ($1, $2, $3, $4::jsonb, $5::jsonb)`,
      [
        stepId,
        revisionId,
        step.order,
        JSON.stringify(step.title),
        step.body === null ? null : JSON.stringify(step.body),
      ],
    );

    const { rows: blocks } = await sql.query<{
      order: number;
      kind: string;
      content: unknown;
      visibility: string | null;
    }>('select "order", kind, content, visibility from blocks where step_id = $1 order by "order"', [
      step.id,
    ]);

    for (const block of blocks) {
      const next = await rekeyIfAsset(ctx, block.content, revisionId);
      if (next.copied) assets += 1;
      await sql.query(
        `insert into blocks (id, step_id, "order", kind, content, visibility)
         values ($1, $2, $3, $4, $5::jsonb, $6::visibility)`,
        [randomUUID(), stepId, block.order, block.kind, JSON.stringify(next.content), block.visibility],
      );
      blockCount += 1;
    }
  }

  return { revisionId, revNo, steps: steps.length, blocks: blockCount, assets };
}

/**
 * The editor's entry point: open the existing draft, or clone the published revision into one.
 *
 * A playbook always has at most one draft — "New playbook" creates rev 1 as a draft, and this only
 * ever clones when there is none. Without that invariant the list's has-draft indicator and the
 * "which revision am I editing" banner would both become ambiguous.
 */
export async function ensureDraftRevision(
  ctx: AdminContext,
  playbookId: string,
): Promise<{ revisionId: string; cloned: boolean }> {
  const existing = await findDraftRevisionId(ctx.sql, playbookId);
  if (existing !== null) return { revisionId: existing, cloned: false };

  const { rows: pointer } = await ctx.sql.query<{ published_revision_id: string | null }>(
    'select published_revision_id from playbooks where id = $1',
    [playbookId],
  );
  const source = pointer[0]?.published_revision_id ?? null;
  if (source === null) {
    throw new Error(`playbook ${playbookId} has neither a draft nor a publication`);
  }

  const clone = await cloneRevision(ctx, source);
  return { revisionId: clone.revisionId, cloned: true };
}
