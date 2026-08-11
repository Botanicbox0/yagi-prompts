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
