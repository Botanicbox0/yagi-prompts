import type { SqlRunner } from '@/lib/db/sql-runner';
import type { AssetRef, BlockKind, Localized } from './schemas';
import type { RevisionBlockInput, RevisionInput, RevisionStepInput } from './shape';
import {
  DEFAULT_POLICY,
  isVisibility,
  resolveVisibility,
  type DefaultPolicy,
  type Visibility,
} from './visibility';

/**
 * The DB half of the shaping gate (PLAN §7). Kept driver-agnostic so the seed acceptance test
 * reads the same rows through PGlite that the M2 façade will read through the service-role client.
 *
 * Invariant this function owns: every block leaves here with a NON-NULL effective visibility.
 *   · published / superseded revisions → the stamped `resolved_visibility`
 *   · draft previews                   → normalised through the shared resolver against current
 *     policy ("preview approximates current policy; prepare/publish stamps it", R3b)
 */

interface RevisionRow {
  id: string;
  playbook_id: string;
  slug: string;
  category: string;
  rev_no: number;
  state: 'draft' | 'published' | 'superseded';
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

interface StepRow {
  id: string;
  order: number;
  title: Localized;
  body: Localized | null;
}

interface BlockRow {
  id: string;
  step_id: string;
  order: number;
  kind: BlockKind;
  content: unknown;
  visibility: Visibility | null;
  resolved_visibility: Visibility | null;
}

const REVISION_COLUMNS = `
  r.id, r.playbook_id, p.slug, p.category, r.rev_no, r.state, r.is_showcase,
  r.title, r.summary, r.difficulty, r.tools, r.models, r.est_time_min, r.est_cost_usd,
  r.hero_asset, r.change_note, r.published_at
`;

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function toNumber(value: string | number | null): number | null {
  if (value === null) return null;
  return typeof value === 'number' ? value : Number(value);
}

async function loadCurrentPolicy(sql: SqlRunner): Promise<DefaultPolicy> {
  const { rows } = await sql.query<{ kind: BlockKind; visibility: Visibility }>(
    'select kind, visibility from default_policy',
  );
  const policy: DefaultPolicy = { ...DEFAULT_POLICY };
  for (const row of rows) policy[row.kind] = row.visibility;
  return policy;
}

async function assemble(sql: SqlRunner, revision: RevisionRow): Promise<RevisionInput> {
  const { rows: stepRows } = await sql.query<StepRow>(
    'select id, "order", title, body from steps where revision_id = $1 order by "order"',
    [revision.id],
  );
  const { rows: blockRows } = await sql.query<BlockRow>(
    `select b.id, b.step_id, b."order", b.kind, b.content, b.visibility, b.resolved_visibility
       from blocks b join steps s on s.id = b.step_id
      where s.revision_id = $1 order by s."order", b."order"`,
    [revision.id],
  );

  const policy = revision.state === 'draft' ? await loadCurrentPolicy(sql) : DEFAULT_POLICY;

  const byStep = new Map<string, RevisionBlockInput[]>();
  for (const block of blockRows) {
    const stamped = block.resolved_visibility;
    const effective: Visibility = isVisibility(stamped)
      ? stamped
      : resolveVisibility(block.visibility, block.kind, policy);
    const list = byStep.get(block.step_id) ?? [];
    list.push({
      id: block.id,
      order: block.order,
      kind: block.kind,
      content: block.content,
      effective_visibility: effective,
    });
    byStep.set(block.step_id, list);
  }

  const steps: RevisionStepInput[] = stepRows.map((step) => ({
    id: step.id,
    order: step.order,
    title: step.title,
    body: step.body,
    blocks: byStep.get(step.id) ?? [],
  }));

  return {
    id: revision.id,
    playbook_id: revision.playbook_id,
    slug: revision.slug,
    category: revision.category,
    rev_no: revision.rev_no,
    state: revision.state,
    is_showcase: revision.is_showcase,
    title: revision.title,
    summary: revision.summary,
    difficulty: revision.difficulty,
    tools: revision.tools ?? [],
    models: revision.models ?? [],
    est_time_min: revision.est_time_min,
    est_cost_usd: toNumber(revision.est_cost_usd),
    hero_asset: revision.hero_asset,
    change_note: revision.change_note,
    published_at: toIso(revision.published_at),
    steps,
  };
}

// ---------------------------------------------------------------------------
// eligibility facts (the cheap query the façade decides on, before loading anything)
// ---------------------------------------------------------------------------

export interface PlaybookGate {
  playbookId: string;
  slug: string;
  status: 'draft' | 'published' | 'archived';
  /** NULL until the first publish; the composite FK guarantees it belongs to this playbook. */
  publishedRevisionId: string | null;
  /** `is_showcase` of the CURRENT published revision — revisioned, never live-flipped (§6). */
  isShowcase: boolean;
}

interface GateRow {
  id: string;
  slug: string;
  status: 'draft' | 'published' | 'archived';
  published_revision_id: string | null;
  is_showcase: boolean | null;
}

/**
 * The facts §3.3 authorizes on, in one round trip and without touching content.
 *
 * The join is deliberately narrowed to `state = 'published'`: a pointer at anything else is not a
 * publication, so `publishedRevisionId` comes back NULL and every non-admin tier reads 404.
 */
export async function loadPlaybookGate(
  sql: SqlRunner,
  slug: string,
): Promise<PlaybookGate | null> {
  const { rows } = await sql.query<GateRow>(
    `select p.id, p.slug, p.status, r.id as published_revision_id, r.is_showcase
       from playbooks p
       left join playbook_revisions r
         on r.id = p.published_revision_id and r.state = 'published'
      where p.slug = $1`,
    [slug],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    playbookId: row.id,
    slug: row.slug,
    status: row.status,
    publishedRevisionId: row.published_revision_id,
    isShowcase: row.is_showcase === true,
  };
}

// ---------------------------------------------------------------------------
// neighbours (§3.3 "bottom of page: next/prev playbook")
// ---------------------------------------------------------------------------

export interface NeighbourCard {
  slug: string;
  title: Localized;
  isShowcase: boolean;
}

export interface Neighbours {
  /** The playbook published just AFTER this one — the card above it in the newest-first list. */
  prev: NeighbourCard | null;
  /** The playbook published just BEFORE this one — the card below it. */
  next: NeighbourCard | null;
}

/**
 * Ordered exactly like the catalog projection (`published_at desc, sort desc, slug asc`) so the
 * detail page's prev/next agrees with the order the reader saw on the landing and in the library.
 */
export async function loadNeighbours(sql: SqlRunner, slug: string): Promise<Neighbours> {
  const { rows } = await sql.query<{ slug: string; title: Localized; is_showcase: boolean }>(
    `select p.slug, r.title, r.is_showcase
       from playbooks p
       join playbook_revisions r on r.id = p.published_revision_id
      where p.status = 'published' and r.state = 'published'
      order by r.published_at desc nulls last, p.sort desc, p.slug asc`,
  );
  const index = rows.findIndex((row) => row.slug === slug);
  if (index === -1) return { prev: null, next: null };
  const toCard = (row: (typeof rows)[number] | undefined): NeighbourCard | null =>
    row ? { slug: row.slug, title: row.title, isShowcase: row.is_showcase } : null;
  return { prev: toCard(rows[index - 1]), next: toCard(rows[index + 1]) };
}

/** The CURRENT published revision of a playbook — the only thing the public read path serves. */
export async function loadPublishedRevisionBySlug(
  sql: SqlRunner,
  slug: string,
): Promise<RevisionInput | null> {
  const { rows } = await sql.query<RevisionRow>(
    `select ${REVISION_COLUMNS}
       from playbooks p
       join playbook_revisions r on r.id = p.published_revision_id
      where p.slug = $1 and r.state = 'published'`,
    [slug],
  );
  const revision = rows[0];
  return revision ? assemble(sql, revision) : null;
}

/** Any revision by id — admin preview path (M4); eligibility is the façade's job, not this one. */
export async function loadRevisionById(
  sql: SqlRunner,
  revisionId: string,
): Promise<RevisionInput | null> {
  const { rows } = await sql.query<RevisionRow>(
    `select ${REVISION_COLUMNS}
       from playbook_revisions r
       join playbooks p on p.id = r.playbook_id
      where r.id = $1`,
    [revisionId],
  );
  const revision = rows[0];
  return revision ? assemble(sql, revision) : null;
}
