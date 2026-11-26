/**
 * The two product paths that reach the reference sites, run end to end on a PGlite database with the
 * live prompt writers (the same wiring as lib/brand-studio/runtime.ts) and a fake model:
 *   - the free 설계 preview `prompt.enhance` (lib/brand-studio/jobs.ts `previewStudioPrompt`), and
 *   - the paid run: `createStudioJob` reserves the allowance, the engine prepares the job
 *     (lib/brand-studio/prepare.ts `prepareJob` → `runEnhancer`), writes `final_prompt` and moves the job on.
 * Everything that differs between two runs by nature (ids, storage keys, task ids, times) is replaced by a
 * placeholder, so two runs that did the same thing record the same bytes.
 */
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { compileDirectorPrompt, composeDirectorFallbackPrompt } from '@/lib/brand-studio/director';
import { composeFallbackPrompt, enhancePrompt } from '@/lib/brand-studio/enhancer';
import { createStudioJob, previewStudioPrompt, resetFreeIntelRateLimits } from '@/lib/brand-studio/jobs';
import type { StudioProviderRequest } from '@/lib/brand-studio/provider/types';
import type { EnhanceInput, JobRow, StudioIntel } from '@/lib/brand-studio/types';
import { loadAllowance } from '@/lib/brand-studio/usage';
import { requestId, seedImageAsset, studioDeps, viewerOf, type StudioFixture } from '../brand-studio/server/helpers';
import { leakingFetch, type AnswerKind } from './leaks';
import type { ReferenceCase } from './reference-cases';

export interface ProductPath {
  id: string;
  /** The studio request (without organization, request id and references). */
  request: Record<string, unknown>;
  withReference: boolean;
  benign: string;
}

export const PRODUCT_PATHS: readonly ProductPath[] = [
  {
    id: 'image-seedream-reference',
    request: { kind: 'image', model: 'seedream-5.5', prompt: '이미지 1 제품을 대리석 위에 놓아줘', aspect: '3:4', resolution: '2K', enhance: true },
    withReference: true,
    benign: 'A red cylindrical glass bottle from Image 1 stands on marble under soft light; keep the exact label, proportions and colours of Image 1.',
  },
  {
    id: 'video-seedance-director',
    request: { kind: 'video', model: 'seedance-2.5', prompt: '대리석 위 향수병을 손이 천천히 들어 올리는 장면', aspect: '9:16', seconds: 5, audio: 'native', resolution: '720p', enhance: true },
    withReference: false,
    benign: [
      'Visual style: pale marble, soft window light from the left and a grounded shadow under the bottle.',
      '0.0s–2.5s: 18° off-axis medium shot, a hand slowly lifts the perfume bottle from the marble; slow push-in. Hard cut.',
      '2.5s–5.0s: close-up on the bottle in the hand as light moves across the glass; the camera settles.',
      'Audio: the glass leaving the stone and quiet room tone.',
    ].join('\n'),
  },
];

function isSeedanceVideo(input: EnhanceInput): boolean {
  return input.profile === 'seedance' && (input.kind === 'video' || input.kind === 'video_remix');
}

/** The live prompt writers, wired exactly as lib/brand-studio/runtime.ts wires them; the rest stays fake. */
export function liveWriters(base: StudioIntel): StudioIntel {
  return {
    ...base,
    enhancePrompt: (input, deps) => (isSeedanceVideo(input) ? compileDirectorPrompt(input, deps) : enhancePrompt(input, deps)),
    composeFallbackPrompt: (input) => (isSeedanceVideo(input) ? composeDirectorFallbackPrompt(input) : composeFallbackPrompt(input)),
  };
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const TASK = /fake_[0-9a-f]{18}/g;
/** Media store keys are random per put (`st/<64 hex>.png`). */
const KEY = /\b[0-9a-f]{64}\b/g;

function stable(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v: unknown) => (typeof v === 'string' ? v.replace(UUID, '<uuid>').replace(TASK, '<task>').replace(KEY, '<key>') : v)),
  );
}

/** The job columns that carry money, allowance and state (ids and times left out). */
function jobState(row: JobRow): Record<string, unknown> {
  return {
    kind: row.kind,
    status: row.status,
    lane: row.lane,
    model: row.model,
    prompt: row.prompt,
    final_prompt: row.final_prompt,
    enhance: row.enhance,
    estimate_usd: String(row.estimate_usd),
    cost_usd: row.cost_usd === null ? null : String(row.cost_usd),
    estimate_krw: row.estimate_krw,
    usage_krw: row.usage_krw,
    error_code: row.error_code,
    error_detail: row.error_detail,
    attempts: row.attempts,
    finished: row.finished_at !== null,
    work: row.work,
  };
}

export interface PathRecord {
  calls: string[];
  preview: unknown;
  job: Record<string, unknown>;
  outputs: unknown[];
  sent: Array<{ endpoint: string; body: unknown }>;
  allowance: { capKrw: number; usedKrw: number };
  logs: Array<{ event: string; detail: unknown }>;
}

/**
 * Runs the preview and one paid run of `path` in organization `f.orgId` with the model answering `kind`.
 * `env` is the model writers' environment (the place `PROMPT_GUARD` is read from).
 */
export async function runProductPath(f: StudioFixture, path: ProductPath, kind: AnswerKind, env: Record<string, string | undefined>): Promise<PathRecord> {
  resetFreeIntelRateLimits();
  const { calls, fetchImpl } = leakingFetch(kind, { benign: path.benign } as ReferenceCase);
  const logs: PathRecord['logs'] = [];
  const deps = studioDeps(f.sql, { intelDeps: { fetch: fetchImpl, env }, log: (event, detail) => logs.push({ event, detail: detail ?? null }) });
  deps.intel = liveWriters(deps.intel) as typeof deps.intel;
  const sent: StudioProviderRequest[] = [];
  const submit = deps.provider.submit.bind(deps.provider);
  deps.provider.submit = (request, options) => {
    sent.push(request);
    return submit(request, options);
  };
  const viewer = viewerOf(f.ids.owner);
  const references = path.withReference ? [{ assetId: await seedImageAsset(deps, f.orgId, f.ids.owner, { role: 'product', width: 900, height: 700 }), role: 'product' }] : [];
  const preview = await previewStudioPrompt(deps, viewer, { ...path.request, organizationId: f.orgId, references });
  const usedBefore = (await loadAllowance(f.sql, f.orgId, deps.env)).usedKrw;
  const made = await createStudioJob(deps, viewer, { ...path.request, organizationId: f.orgId, requestId: requestId(), references });
  if (!made.ok) throw new Error(`create failed: ${JSON.stringify(made)}`);
  let row: JobRow | undefined;
  for (let i = 0; i < 8; i += 1) {
    await advanceStudioJobsWith(deps, { jobIds: [made.job.id] });
    row = (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [made.job.id])).rows[0]!;
    if (!['queued', 'running', 'finishing', 'held'].includes(row.status)) break;
  }
  const outputs = (
    await f.sql.query<{ idx: number; kind: string; status: string; is_draft: boolean }>(
      'select idx, kind, status, is_draft from brand_studio_outputs where job_id = $1 order by idx',
      [made.job.id],
    )
  ).rows;
  const allowance = await loadAllowance(f.sql, f.orgId, deps.env);
  return stable({
    calls: calls.map((c) => c.body),
    preview,
    job: jobState(row!),
    outputs,
    sent: sent.map((r) => ({ endpoint: r.endpoint, body: r.body })),
    // What this run added to the organization's month (earlier runs in the same fixture are left out).
    allowance: { capKrw: allowance.capKrw, usedKrw: allowance.usedKrw - usedBefore },
    logs,
  }) as PathRecord;
}
