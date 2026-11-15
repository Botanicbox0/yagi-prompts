/**
 * Seeding finished clips straight into the tables, so the version tests can lay out a whole chain
 * (root -> edit -> edit -> reshoot -> edit) without running the engine for each step.
 */
import { randomUUID } from 'node:crypto';
import type { StudioReference } from '@/lib/brand-studio/contracts';
import type { StudioDeps, StudioJobParams } from '@/lib/brand-studio/types';
import { requestId } from './helpers';

export interface SeededRun {
  jobId: string;
  outputId: string;
}

export interface SeedRunOptions {
  kind?: 'video' | 'video_remix' | 'video_final' | 'image';
  prompt?: string;
  finalPrompt?: string | null;
  params?: Partial<StudioJobParams>;
  refs?: StudioReference[];
  parentOutputId?: string | null;
  model?: string;
  status?: 'succeeded' | 'failed' | 'queued';
  seconds?: number;
  width?: number;
  height?: number;
  isDraft?: boolean;
}

/** A finished run with one ready output. */
export async function seedRun(deps: StudioDeps, orgId: string, by: string, o: SeedRunOptions = {}): Promise<SeededRun> {
  const kind = o.kind ?? 'video';
  const status = o.status ?? 'succeeded';
  const params: StudioJobParams = {
    aspect: '9:16', resolution: '720p', seconds: 6, audio: 'native', count: 1, locale: 'ko',
    ...(o.params ?? {}),
  } as StudioJobParams;
  const job = (
    await deps.sql.query<{ id: string }>(
      `insert into brand_studio_jobs (organization_id, created_by, request_id, kind, status, lane, model, prompt, final_prompt, enhance,
          params, refs, parent_output_id, finished_at)
        values ($1, $2, $3, $4, $5, 'sunra_api', $6, $7, $8, true, $9::jsonb, $10::jsonb, $11, case when $5 in ('succeeded','failed') then now() end)
        returning id`,
      [orgId, by, requestId(), kind, status, o.model ?? (kind === 'image' ? 'seedream-5.5' : 'seedance-2.5'), o.prompt ?? '',
        o.finalPrompt ?? null, JSON.stringify(params), JSON.stringify(o.refs ?? []), o.parentOutputId ?? null],
    )
  ).rows[0]!;
  const media = kind === 'image' ? 'image' : 'video';
  const { key } = await deps.media.put(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, randomUUID().charCodeAt(0)]), media === 'image' ? 'image/png' : 'video/mp4');
  const output = (
    await deps.sql.query<{ id: string }>(
      `insert into brand_studio_outputs (job_id, organization_id, idx, kind, status, storage_key, mime, duration_ms, width, height, is_draft, draft_task_id)
        values ($1, $2, 0, $3, 'ready', $4, $5, $6, $7, $8, $9, $10) returning id`,
      [job.id, orgId, media, key, media === 'image' ? 'image/png' : 'video/mp4', media === 'image' ? null : Math.round((o.seconds ?? 6) * 1000),
        o.width ?? 720, o.height ?? 1280, o.isDraft ?? false, o.isDraft ? `draft_${randomUUID().slice(0, 8)}` : null],
    )
  ).rows[0]!;
  return { jobId: job.id, outputId: output.id };
}

/** A revision already made, as `job.create` would have stored it. */
export async function seedRevision(
  deps: StudioDeps,
  orgId: string,
  by: string,
  o: {
    base: SeededRun;
    rootJobId: string;
    version: number;
    mode: 'edit' | 'reshoot';
    request: string;
    added?: StudioReference[];
    /** reshoot: the refs (recipe + added) and the kind / params copied from the recipe run. */
    refs?: StudioReference[];
    kind?: 'video' | 'video_remix';
    params?: Partial<StudioJobParams>;
    finalPrompt?: string | null;
    seconds?: number;
  },
): Promise<SeededRun> {
  const added = o.added ?? [];
  const revision = { rootJobId: o.rootJobId, version: o.version, baseJobId: o.base.jobId, baseOutputId: o.base.outputId, mode: o.mode, added: added.length };
  if (o.mode === 'edit') {
    return seedRun(deps, orgId, by, {
      kind: 'video_remix',
      prompt: o.request,
      finalPrompt: o.finalPrompt ?? null,
      refs: [{ outputId: o.base.outputId }, ...added],
      parentOutputId: o.base.outputId,
      params: { aspect: null, seconds: null, method: 'edit', keep: [], change: '', revision, ...(o.params ?? {}) },
      ...(o.seconds !== undefined ? { seconds: o.seconds } : {}),
    });
  }
  return seedRun(deps, orgId, by, {
    kind: o.kind ?? 'video',
    prompt: o.request,
    finalPrompt: o.finalPrompt ?? null,
    refs: [...(o.refs ?? []), ...added],
    parentOutputId: o.base.outputId,
    params: { ...(o.params ?? {}), revision },
    ...(o.seconds !== undefined ? { seconds: o.seconds } : {}),
  });
}

/** A 1080p final of a draft output. */
export async function seedFinal(deps: StudioDeps, orgId: string, by: string, draft: SeededRun): Promise<SeededRun> {
  return seedRun(deps, orgId, by, {
    kind: 'video_final',
    prompt: '',
    parentOutputId: draft.outputId,
    params: { resolution: '1080p', draftOutputId: draft.outputId } as Partial<StudioJobParams>,
    width: 1080,
    height: 1920,
  });
}
