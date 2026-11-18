/**
 * How a generated clip was made, read back from its own history (video versions).
 *
 * Every version of one clip shares `params.revision.rootJobId`. An `edit` version sends the version
 * before it back as its reference video; a `reshoot` version runs the "recipe run" again with every
 * request so far written into its prompt. To know what a reshoot runs, walk upward from the clip being
 * revised through `params.revision.baseJobId` until the first run that is not an edit: that run, its
 * prompt and its references are the recipe, and the edits passed on the way are the history.
 *
 * The walk follows job ids, not outputs, so a deleted earlier version does not break it. A `video_final`
 * (the 1080p finish of a 480p draft) is the same version as its draft, so it is hopped to the draft's job.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { StudioReference } from '../contracts';
import { rewriteReferenceMentions } from '../enhancer/mentions';
import { StudioDenied } from '../access';
import { readyOutput } from '../repo';
import type { JobRow, StudioJobParams } from '../types';

/** The walk gives up after this many edits in a row (the reshoot way then closes; edit stays open). */
export const REVISION_WALK_MAX = 50;

export interface RevisionHistoryItem {
  version: number;
  /** The change that was asked for, in the customer's words. */
  request: string;
  /** The pictures attached for that change (the edit's trailing `revision.added` refs). */
  added: StudioReference[];
  /** The spots that change pointed at (①②③ in `request`), when it pointed at any. */
  marks?: Array<{ label?: string; what?: string }>;
}

export interface RevisionRecipe {
  /** The clip being revised. For a 1080p final, `jobId`/`version` are those of its draft's job; `outputId` stays the final. */
  base: {
    outputId: string;
    jobId: string;
    version: number;
    seconds: number | null;
    width: number | null;
    height: number | null;
    isFinal: boolean;
    /** A 480p draft a final can still be made from (planned as one, with a draft id): `StudioOutputView.draft`. */
    isDraft: boolean;
  };
  /** The job that made `base` (the draft's job for a final). */
  baseJob: JobRow;
  rootJobId: string;
  /** 1 + the highest version in the chain (the root is 1). */
  nextVersion: number;
  /** Nearest run at or above the base that is not an edit: what a reshoot runs again. Null when unreachable. */
  recipeJob: JobRow | null;
  /** What the recipe run actually sent (the topmost reachable run's, when the recipe run is unreachable). */
  madeWith: string;
  /** The edits between the recipe run and the base (the base included when it is an edit), oldest first. */
  history: RevisionHistoryItem[];
  /** Pictures those edits added, oldest first, de-duplicated. */
  addedRefs: StudioReference[];
}

export const versionOf = (job: Pick<JobRow, 'params'>): number => job.params?.revision?.version ?? 1;

/** Identity of a reference for de-duplication. */
export const refKey = (r: StudioReference): string => (r.assetId ? `a:${r.assetId}` : `o:${r.outputId ?? ''}`);

/** De-duplicates by asset / output, keeping the first occurrence and the order. */
export function dedupeRefs(refs: readonly StudioReference[]): StudioReference[] {
  const seen = new Set<string>();
  const out: StudioReference[] = [];
  for (const r of refs) {
    const key = refKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** The pictures a revision attached: its trailing `revision.added` refs. */
export function addedRefsOf(job: Pick<JobRow, 'refs' | 'params'>): StudioReference[] {
  const refs = Array.isArray(job.refs) ? job.refs : [];
  const n = Math.max(0, Math.min(refs.length, job.params?.revision?.added ?? 0));
  return n === 0 ? [] : refs.slice(refs.length - n);
}

/** What a run sent: the enhanced prompt, else the customer's words and the change note as the pipeline joins them. */
export function madeWithOf(job: Pick<JobRow, 'final_prompt' | 'prompt' | 'params'>): string {
  if (job.final_prompt?.trim()) return job.final_prompt;
  return [job.prompt ?? '', job.params?.change ?? ''].map((s) => s.trim()).filter(Boolean).join('\n');
}

async function jobById(sql: SqlRunner, organizationId: string, id: string): Promise<JobRow | null> {
  return (await sql.query<JobRow>('select * from brand_studio_jobs where id = $1 and organization_id = $2', [id, organizationId])).rows[0] ?? null;
}

/** The job a version belongs to: a final's draft job, else the job itself. */
async function versionJobOf(sql: SqlRunner, organizationId: string, job: JobRow): Promise<JobRow | null> {
  if (job.kind !== 'video_final') return job;
  const draftOutputId = job.parent_output_id ?? job.params?.draftOutputId ?? null;
  if (!draftOutputId) return null;
  const draft = (
    await sql.query<{ job_id: string }>('select job_id from brand_studio_outputs where id = $1 and organization_id = $2', [draftOutputId, organizationId])
  ).rows[0];
  return draft ? jobById(sql, organizationId, draft.job_id) : null;
}

export interface RevisionChain {
  recipeJob: JobRow | null;
  madeWith: string;
  history: RevisionHistoryItem[];
  addedRefs: StudioReference[];
}

/** Walks upward from `start` (a version's job) to its recipe run. */
export async function revisionChain(sql: SqlRunner, organizationId: string, start: JobRow): Promise<RevisionChain> {
  const history: RevisionHistoryItem[] = [];
  let current: JobRow | null = start;
  let topmost: JobRow = start;
  let recipeJob: JobRow | null = null;
  const visited = new Set<string>();
  for (let hops = 0; current && hops <= REVISION_WALK_MAX; hops++) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    topmost = current;
    const revision: StudioJobParams['revision'] = current.params?.revision;
    if (revision?.mode !== 'edit') {
      recipeJob = current;
      break;
    }
    const marks = Array.isArray(revision.marks) && revision.marks.length ? revision.marks.map((m) => ({ ...m })) : null;
    history.unshift({ version: revision.version, request: current.prompt ?? '', added: addedRefsOf(current), ...(marks ? { marks } : {}) });
    const parent: JobRow | null = revision.baseJobId ? await jobById(sql, organizationId, revision.baseJobId) : null;
    current = parent ? await versionJobOf(sql, organizationId, parent) : null;
  }
  return {
    recipeJob,
    madeWith: madeWithOf(recipeJob ?? topmost),
    history,
    addedRefs: dedupeRefs(history.flatMap((h) => h.added)).filter(
      (r) => !(recipeJob?.refs ?? []).some((own) => refKey(own) === refKey(r)),
    ),
  };
}

/** 1 + the highest version among every job of the chain (any status, so two revisions never share a number). */
export async function nextVersionOf(sql: SqlRunner, organizationId: string, rootJobId: string): Promise<number> {
  const row = (
    await sql.query<{ v: number | null }>(
      `select max(case when id = $2::uuid then 1 else coalesce((params -> 'revision' ->> 'version')::int, 1) end)::int as v
         from brand_studio_jobs
        where organization_id = $1 and (id = $2::uuid or params -> 'revision' ->> 'rootJobId' = $2::text)`,
      [organizationId, rootJobId],
    )
  ).rows[0];
  return Math.max(1, Number(row?.v ?? 1)) + 1;
}

/**
 * The recipe of a ready, live video result of this organization. Anything else (another organization's
 * result, an image, a deleted or unfinished one) is `not_found`.
 */
export async function loadRevisionRecipe(sql: SqlRunner, organizationId: string, outputId: string): Promise<RevisionRecipe> {
  const output = await readyOutput(sql, organizationId, outputId);
  if (!output || output.kind !== 'video' || !output.storage_key) throw new StudioDenied('not_found');
  const own = await jobById(sql, organizationId, output.job_id);
  if (!own) throw new StudioDenied('not_found');
  const baseJob = await versionJobOf(sql, organizationId, own);
  if (!baseJob || (baseJob.kind !== 'video' && baseJob.kind !== 'video_remix')) throw new StudioDenied('not_found');
  const chain = await revisionChain(sql, organizationId, baseJob);
  const rootJobId = baseJob.params?.revision?.rootJobId ?? baseJob.id;
  return {
    base: {
      outputId: output.id,
      jobId: baseJob.id,
      version: versionOf(baseJob),
      seconds: output.duration_ms != null ? Number(output.duration_ms) / 1000 : null,
      width: output.width,
      height: output.height,
      isFinal: own.kind === 'video_final',
      isDraft: own.kind !== 'video_final' && output.is_draft && Boolean(output.draft_task_id),
    },
    baseJob,
    rootJobId,
    nextVersion: await nextVersionOf(sql, organizationId, rootJobId),
    ...chain,
  };
}

/**
 * A request's picture mentions renumbered for a reshoot's tray. The customer numbers the pictures they
 * attached for one request from 1 ("이미지 1"), but in a reshoot those pictures come after the recipe's
 * own, so "이미지 1" must become the tray number of that picture. `trayImageOrdinal` maps a reference
 * key to its 1-based place among the tray's images. Mentions of other kinds, or past the pictures the
 * request attached, are left as written.
 */
export function renumberRequest(
  text: string,
  attached: readonly StudioReference[],
  trayImageOrdinal: ReadonlyMap<string, number>,
  locale: 'ko' | 'en',
): string {
  if (!text || attached.length === 0) return text;
  const word = locale === 'en' ? 'image' : '이미지';
  return rewriteReferenceMentions(text, (kind, number) => {
    if (kind !== 'image' && kind !== 'any') return null;
    const ref = attached[number - 1];
    const ordinal = ref ? trayImageOrdinal.get(refKey(ref)) : undefined;
    return ordinal ? `${word} ${ordinal}` : null;
  });
}
