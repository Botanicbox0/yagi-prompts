import type { SqlRunner } from '@/lib/db/sql-runner';
import type { AssetRef, BlockKind, Localized } from '@/lib/content/schemas';
import { DEFAULT_POLICY, type DefaultPolicy, type Visibility } from '@/lib/content/visibility';

/**
 * The admin read models (§3.8). Deliberately RAW where the public loaders are shaped:
 * `lib/content/load.ts` collapses `visibility` + `resolved_visibility` into one effective value
 * because that is all a reader may know, but the editor has to show the author BOTH — the override
 * they set and the default it would otherwise inherit. That is the whole point of the
 * effective-visibility table, so this loader keeps the columns apart.
 *
 * Driver-agnostic `SqlRunner`, like every other read model since M0, so the editor's data is
 * exercised against real PGlite in vitest.
 */

export type PlaybookStatus = 'draft' | 'published' | 'archived';
export type RevisionState = 'draft' | 'published' | 'superseded';

export interface AdminListRow {
  id: string;
  slug: string;
  status: PlaybookStatus;
  category: string;
  updatedAt: string | null;
  title: Localized | null;
  publishedRevisionId: string | null;
  publishedRevNo: number | null;
  publishedShowcase: boolean;
  draftRevisionId: string | null;
  draftRevNo: number | null;
  draftShowcase: boolean;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function toNumber(value: string | number | null): number | null {
  if (value === null) return null;
  return typeof value === 'number' ? value : Number(value);
}

/**
 * §3.8 playbook list: "status, updated, has-draft-revision indicator" plus the showcase flag of
 * BOTH revisions — `is_showcase` lives on the revision (R3b), so "showcase" is two facts, not one:
 * what is live now, and what the next publish would make live.
 */
export async function loadAdminList(sql: SqlRunner): Promise<AdminListRow[]> {
  const { rows } = await sql.query<{
    id: string;
    slug: string;
    status: PlaybookStatus;
    category: string;
    updated_at: Date | string | null;
    published_revision_id: string | null;
    published_rev_no: number | null;
    published_title: Localized | null;
    published_showcase: boolean | null;
    draft_revision_id: string | null;
    draft_rev_no: number | null;
    draft_title: Localized | null;
    draft_showcase: boolean | null;
  }>(
    `select p.id, p.slug, p.status, p.category, p.updated_at,
            pub.id  as published_revision_id, pub.rev_no as published_rev_no,
            pub.title as published_title, pub.is_showcase as published_showcase,
            d.id    as draft_revision_id, d.rev_no as draft_rev_no,
            d.title as draft_title, d.is_showcase as draft_showcase
       from playbooks p
       left join playbook_revisions pub
         on pub.id = p.published_revision_id and pub.state = 'published'
       left join lateral (
         select r.id, r.rev_no, r.title, r.is_showcase
           from playbook_revisions r
          where r.playbook_id = p.id and r.state = 'draft'
          order by r.rev_no desc
          limit 1
       ) d on true
      order by p.updated_at desc nulls last, p.slug asc`,
  );

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    status: row.status,
    category: row.category,
    updatedAt: toIso(row.updated_at),
    title: row.published_title ?? row.draft_title ?? null,
    publishedRevisionId: row.published_revision_id,
    publishedRevNo: row.published_rev_no,
    publishedShowcase: row.published_showcase === true,
    draftRevisionId: row.draft_revision_id,
    draftRevNo: row.draft_rev_no,
    draftShowcase: row.draft_showcase === true,
  }));
}

// ---------------------------------------------------------------------------
// editor
// ---------------------------------------------------------------------------

export interface AdminBlock {
  id: string;
  order: number;
  kind: BlockKind;
  content: unknown;
  /** The author's override, verbatim. NULL means "inherit the default policy for this kind". */
  visibility: Visibility | null;
  /** Stamped by prepare_publish; NULL on a never-prepared draft. */
  resolvedVisibility: Visibility | null;
}

export interface AdminStep {
  id: string;
  order: number;
  title: Localized;
  body: Localized | null;
  blocks: AdminBlock[];
}

export interface AdminRevision {
  id: string;
  playbookId: string;
  revNo: number;
  state: RevisionState;
  isShowcase: boolean;
  title: Localized;
  summary: Localized;
  difficulty: string;
  tools: string[];
  models: string[];
  estTimeMin: number | null;
  estCostUsd: number | null;
  hero: AssetRef | null;
  changeNote: Localized | null;
  publishedAt: string | null;
  steps: AdminStep[];
}

export interface ManifestState {
  total: number;
  pending: number;
}

export interface AdminEditor {
  playbook: {
    id: string;
    slug: string;
    status: PlaybookStatus;
    category: string;
    publishedRevisionId: string | null;
    updatedAt: string | null;
  };
  /** The revision being EDITED. Null when the playbook has no draft (published-only). */
  draft: AdminRevision | null;
  /** Present when the playbook has ever published — the banner's "what is live" half. */
  published: { id: string; revNo: number; publishedAt: string | null; isShowcase: boolean } | null;
  policy: DefaultPolicy;
  manifest: ManifestState;
}

const REVISION_COLUMNS = `
  r.id, r.playbook_id, r.rev_no, r.state, r.is_showcase, r.title, r.summary, r.difficulty,
  r.tools, r.models, r.est_time_min, r.est_cost_usd, r.hero_asset, r.change_note, r.published_at
`;

interface RevisionRow {
  id: string;
  playbook_id: string;
  rev_no: number;
  state: RevisionState;
  is_showcase: boolean;
  title: Localized;
  summary: Localized;
  difficulty: string;
  tools: string[] | null;
  models: string[] | null;
  est_time_min: number | null;
  est_cost_usd: string | number | null;
  hero_asset: AssetRef | null;
  change_note: Localized | null;
  published_at: Date | string | null;
}

async function assemble(sql: SqlRunner, row: RevisionRow): Promise<AdminRevision> {
  const { rows: stepRows } = await sql.query<{
    id: string;
    order: number;
    title: Localized;
    body: Localized | null;
  }>('select id, "order", title, body from steps where revision_id = $1 order by "order"', [row.id]);

  const { rows: blockRows } = await sql.query<{
    id: string;
    step_id: string;
    order: number;
    kind: BlockKind;
    content: unknown;
    visibility: Visibility | null;
    resolved_visibility: Visibility | null;
  }>(
    `select b.id, b.step_id, b."order", b.kind, b.content, b.visibility, b.resolved_visibility
       from blocks b join steps s on s.id = b.step_id
      where s.revision_id = $1 order by s."order", b."order"`,
    [row.id],
  );

  const byStep = new Map<string, AdminBlock[]>();
  for (const block of blockRows) {
    const list = byStep.get(block.step_id) ?? [];
    list.push({
      id: block.id,
      order: block.order,
      kind: block.kind,
      content: block.content,
      visibility: block.visibility,
      resolvedVisibility: block.resolved_visibility,
    });
    byStep.set(block.step_id, list);
  }

  return {
    id: row.id,
    playbookId: row.playbook_id,
    revNo: row.rev_no,
    state: row.state,
    isShowcase: row.is_showcase,
    title: row.title,
    summary: row.summary,
    difficulty: row.difficulty,
    tools: row.tools ?? [],
    models: row.models ?? [],
    estTimeMin: row.est_time_min,
    estCostUsd: toNumber(row.est_cost_usd),
    hero: row.hero_asset,
    changeNote: row.change_note,
    publishedAt: toIso(row.published_at),
    steps: stepRows.map((step) => ({
      id: step.id,
      order: step.order,
      title: step.title,
      body: step.body,
      blocks: byStep.get(step.id) ?? [],
    })),
  };
}

export async function loadRevision(
  sql: SqlRunner,
  revisionId: string,
): Promise<AdminRevision | null> {
  const { rows } = await sql.query<RevisionRow>(
    `select ${REVISION_COLUMNS} from playbook_revisions r where r.id = $1`,
    [revisionId],
  );
  const row = rows[0];
  return row ? assemble(sql, row) : null;
}

/** At most one draft per playbook is the invariant the editor maintains (see `ensureDraft`). */
export async function findDraftRevisionId(
  sql: SqlRunner,
  playbookId: string,
): Promise<string | null> {
  const { rows } = await sql.query<{ id: string }>(
    `select id from playbook_revisions
      where playbook_id = $1 and state = 'draft' order by rev_no desc limit 1`,
    [playbookId],
  );
  return rows[0]?.id ?? null;
}

export async function loadPolicy(sql: SqlRunner): Promise<DefaultPolicy> {
  const { rows } = await sql.query<{ kind: BlockKind; visibility: Visibility }>(
    'select kind, visibility from default_policy',
  );
  const policy: DefaultPolicy = { ...DEFAULT_POLICY };
  for (const row of rows) policy[row.kind] = row.visibility;
  return policy;
}

export async function loadManifestState(
  sql: SqlRunner,
  revisionId: string,
): Promise<ManifestState> {
  const { rows } = await sql.query<{ total: number; pending: number }>(
    `select count(*)::int as total,
            count(*) filter (where copied_at is null)::int as pending
       from publish_assets where revision_id = $1`,
    [revisionId],
  );
  return { total: rows[0]?.total ?? 0, pending: rows[0]?.pending ?? 0 };
}

export async function loadEditor(
  sql: SqlRunner,
  playbookId: string,
): Promise<AdminEditor | null> {
  const { rows } = await sql.query<{
    id: string;
    slug: string;
    status: PlaybookStatus;
    category: string;
    published_revision_id: string | null;
    updated_at: Date | string | null;
  }>(
    `select id, slug, status, category, published_revision_id, updated_at
       from playbooks where id = $1`,
    [playbookId],
  );
  const playbook = rows[0];
  if (!playbook) return null;

  const draftId = await findDraftRevisionId(sql, playbookId);
  const draft = draftId === null ? null : await loadRevision(sql, draftId);

  let published: AdminEditor['published'] = null;
  if (playbook.published_revision_id !== null) {
    const { rows: pub } = await sql.query<{
      id: string;
      rev_no: number;
      published_at: Date | string | null;
      is_showcase: boolean;
    }>(
      `select id, rev_no, published_at, is_showcase from playbook_revisions
        where id = $1 and state = 'published'`,
      [playbook.published_revision_id],
    );
    const row = pub[0];
    if (row) {
      published = {
        id: row.id,
        revNo: row.rev_no,
        publishedAt: toIso(row.published_at),
        isShowcase: row.is_showcase,
      };
    }
  }

  return {
    playbook: {
      id: playbook.id,
      slug: playbook.slug,
      status: playbook.status,
      category: playbook.category,
      publishedRevisionId: playbook.published_revision_id,
      updatedAt: toIso(playbook.updated_at),
    },
    draft,
    published,
    policy: await loadPolicy(sql),
    manifest: draft === null ? { total: 0, pending: 0 } : await loadManifestState(sql, draft.id),
  };
}

/** Both parents the mutations need to resolve before they can write. */
export async function revisionIdOfStep(sql: SqlRunner, stepId: string): Promise<string | null> {
  const { rows } = await sql.query<{ revision_id: string }>(
    'select revision_id from steps where id = $1',
    [stepId],
  );
  return rows[0]?.revision_id ?? null;
}

export async function blockParents(
  sql: SqlRunner,
  blockId: string,
): Promise<{ stepId: string; revisionId: string; kind: BlockKind; content: unknown } | null> {
  const { rows } = await sql.query<{
    step_id: string;
    revision_id: string;
    kind: BlockKind;
    content: unknown;
  }>(
    `select b.step_id, s.revision_id, b.kind, b.content
       from blocks b join steps s on s.id = b.step_id where b.id = $1`,
    [blockId],
  );
  const row = rows[0];
  return row
    ? { stepId: row.step_id, revisionId: row.revision_id, kind: row.kind, content: row.content }
    : null;
}

/**
 * "Has this playbook ever been live?" — the one input to §3.5's notify-kind derivation.
 *
 * Read BEFORE `publish_revision` runs: the RPC swaps `published_revision_id` in the same
 * transaction, after which every publication would look like a republication.
 */
export async function hasPublishedRevision(
  sql: SqlRunner,
  playbookId: string,
): Promise<boolean> {
  const { rows } = await sql.query<{ published_revision_id: string | null }>(
    'select published_revision_id from playbooks where id = $1',
    [playbookId],
  );
  return rows[0]?.published_revision_id != null;
}

export async function playbookIdOfRevision(
  sql: SqlRunner,
  revisionId: string,
): Promise<string | null> {
  const { rows } = await sql.query<{ playbook_id: string }>(
    'select playbook_id from playbook_revisions where id = $1',
    [revisionId],
  );
  return rows[0]?.playbook_id ?? null;
}
