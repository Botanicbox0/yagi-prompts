/**
 * Turning a validated request into a job: the model and its controls, the references resolved inside
 * this organization, the parameters stored on the row, and the estimate the allowance reserves.
 * Everything a customer could get wrong is refused here with a contract code, before any money moves.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { StudioAssetKind, StudioAssetRole, StudioJobCreate, StudioJobKind, StudioReference } from './contracts';
import { StudioDenied } from './access';
import type { StudioMediaStore } from './media-store';
import { finalPrice } from './final-price';
import {
  studioModel,
  type StudioImageModel,
  type StudioImageQuality,
  type StudioLane,
  type StudioModel,
  type StudioVideoModel,
  type StudioVideoResolution,
} from './models';
import { blueprintFit, followsReferenceLength, isDraftRun, normalizeShots, referenceVideoFit, remakeSeconds } from './reference-video';
import { readyAsset, readyOutput } from './repo';
import type { JobRow, StudioJobParams } from './types';
import { billedResolution, imageRunKrw, imageRunUsd, regionEditRun, remixRunUsd, usageKrw, videoRunUsd } from './usage-rate';

export interface ResolvedRef {
  /** Position in the tray (1-based, across kinds). */
  index: number;
  /** Position among references of the same kind (1-based): "이미지 2". */
  ordinal: number;
  kind: StudioAssetKind;
  key: string;
  thumbKey: string | null;
  url: string;
  label: string;
  role?: StudioAssetRole;
  use?: string;
  avoid?: string;
  frame?: 'start' | 'end';
  durationMs: number | null;
  width: number | null;
  height: number | null;
  /** The stored file's type (the account-lane worker uploads a reference video with it). */
  mime?: string | null;
}

const LABELS: Record<'ko' | 'en', Record<StudioAssetKind, string>> = {
  ko: { image: '이미지', video: '영상', audio: '오디오' },
  en: { image: 'Image', video: 'Video', audio: 'Audio' },
};

export async function resolveReferences(
  sql: SqlRunner,
  organizationId: string,
  refs: readonly StudioReference[],
  media: StudioMediaStore,
  locale: 'ko' | 'en',
): Promise<ResolvedRef[]> {
  const seen: Record<StudioAssetKind, number> = { image: 0, video: 0, audio: 0 };
  const out: ResolvedRef[] = [];
  for (const [i, ref] of refs.entries()) {
    let row: { kind: StudioAssetKind; key: string; thumb: string | null; ms: number | null; w: number | null; h: number | null; role: StudioAssetRole | null; mime: string | null } | null = null;
    if (ref.assetId) {
      const a = await readyAsset(sql, organizationId, ref.assetId);
      if (a) row = { kind: a.kind, key: a.storage_key, thumb: a.thumb_key, ms: a.duration_ms, w: a.width, h: a.height, role: a.role, mime: a.mime ?? null };
    } else if (ref.outputId) {
      const o = await readyOutput(sql, organizationId, ref.outputId);
      if (o?.storage_key) row = { kind: o.kind, key: o.storage_key, thumb: o.thumb_key, ms: o.duration_ms, w: o.width, h: o.height, role: null, mime: o.mime ?? null };
    }
    if (!row) throw new StudioDenied('reference_missing');
    seen[row.kind] += 1;
    out.push({
      index: i + 1,
      ordinal: seen[row.kind],
      kind: row.kind,
      key: row.key,
      thumbKey: row.thumb,
      url: media.url(row.key),
      label: `${LABELS[locale][row.kind]} ${seen[row.kind]}`,
      ...(ref.role ?? row.role ? { role: (ref.role ?? row.role)! } : {}),
      ...(ref.use ? { use: ref.use } : {}),
      ...(ref.avoid ? { avoid: ref.avoid } : {}),
      ...(ref.frame ? { frame: ref.frame } : {}),
      durationMs: row.ms,
      width: row.w,
      height: row.h,
      ...(row.mime ? { mime: row.mime } : {}),
    });
  }
  return out;
}

const MENTIONS: Array<[StudioAssetKind, RegExp]> = [
  ['image', /(?:이미지|사진|image|img|figure)\s*#?\s*(\d{1,2})/gi],
  ['video', /(?:영상|비디오|video)\s*#?\s*(\d{1,2})/gi],
  ['audio', /(?:오디오|음원|audio)\s*#?\s*(\d{1,2})/gi],
];

/** "이미지 3" in the prompt with only two images in the tray: refuse before sending. */
export function mentionsMissing(prompt: string, refs: readonly ResolvedRef[], imageOffset = 0): boolean {
  for (const [kind, pattern] of MENTIONS) {
    const have = refs.filter((r) => r.kind === kind).length + (kind === 'image' ? imageOffset : 0);
    for (const match of prompt.matchAll(pattern)) {
      const n = Number(match[1]);
      if (n >= 1 && n > have) return true;
    }
  }
  return false;
}

export interface JobPlan {
  kind: StudioJobKind;
  model: StudioModel;
  prompt: string;
  enhance: boolean;
  params: StudioJobParams;
  refs: StudioReference[];
  resolved: ResolvedRef[];
  parentOutputId: string | null;
  estimateUsd: number;
  estimateKrw: number;
  outputs: { count: number; kind: 'image' | 'video'; isDraft: boolean };
  stickLane: StudioLane | null;
}

/** A final is planned by `planFinal`, a new version of a clip by `planRevision` (./revision/plan.ts). */
type JobInput = Exclude<StudioJobCreate, { kind: 'video_final' } | { kind: 'video_revise' }>;

function liveModel(id: string, medium: 'image' | 'video'): StudioModel {
  const model = studioModel(id);
  if (!model || model.availability !== 'live' || model.medium !== medium) throw new StudioDenied('invalid');
  return model;
}

/**
 * The quality an image run is made at: refused for a model without qualities, the model's default when
 * the request names none (so the estimate, the request and "설정 다시 쓰기" agree).
 */
function qualityFor(model: StudioImageModel, asked: StudioImageQuality | undefined): StudioImageQuality | undefined {
  if (!model.qualities?.length) {
    if (asked !== undefined) throw new StudioDenied('invalid');
    return undefined;
  }
  if (asked !== undefined && !model.qualities.includes(asked)) throw new StudioDenied('invalid');
  return asked ?? model.defaultQuality ?? model.qualities[0];
}

function count(refs: readonly ResolvedRef[], kind: StudioAssetKind): number {
  return refs.filter((r) => r.kind === kind).length;
}

function videoSecondsOf(model: StudioVideoModel, value: number | undefined): number {
  if (value === undefined) return model.defaultSeconds;
  if (value < model.minSeconds || value > model.maxSeconds) throw new StudioDenied('invalid');
  return value;
}

function videoResolution(model: StudioVideoModel, resolution: string): StudioVideoResolution {
  if (resolution === 'draft') {
    if (!model.supportsDraft) throw new StudioDenied('invalid');
    return '480p';
  }
  if (!(model.resolutions as readonly string[]).includes(resolution)) throw new StudioDenied('invalid');
  return resolution as StudioVideoResolution;
}

/** Server switches that change how a request is planned (read from `StudioEnv`). */
export interface PlanOptions {
  /** `BRAND_STUDIO_REGION_V2`: a partial edit runs on `REGION_V2_MODEL` with a window plan, whatever was picked. */
  regionV2?: boolean;
}

/** Validate and price everything but a final (see `planFinal`). */
export async function planJob(
  sql: SqlRunner,
  organizationId: string,
  input: JobInput,
  media: StudioMediaStore,
  locale: 'ko' | 'en',
  options: PlanOptions = {},
): Promise<JobPlan> {
  const resolved = await resolveReferences(sql, organizationId, input.references, media, locale);
  const imageOffset = input.kind === 'region_edit' && !input.enhance ? 1 : 0;
  if (mentionsMissing(input.prompt, resolved, imageOffset)) throw new StudioDenied('reference_missing');
  const base = { aspect: null, resolution: null, seconds: null, audio: null, count: 1, locale } satisfies StudioJobParams;
  const shared = { prompt: input.prompt, enhance: input.enhance, refs: input.references, resolved, parentOutputId: null, stickLane: null };
  // A sentence the customer already read in the prompt bar is sent as it is: no second rewrite.
  const reviewedPrompt = (input.kind === 'image' || input.kind === 'video') && input.reviewedPrompt && input.reviewedPrompt !== input.prompt ? input.reviewedPrompt : null;
  const reviewed = reviewedPrompt ? { enhance: false, params: { reviewedPrompt } } : null;

  if (input.kind === 'image') {
    const model = liveModel(input.model, 'image') as StudioImageModel;
    if (!(model.aspects as readonly string[]).includes(input.aspect) || !(model.resolutions as readonly string[]).includes(input.resolution)) throw new StudioDenied('invalid');
    if (resolved.some((r) => r.kind !== 'image' || r.frame) || resolved.length > model.maxReferences) throw new StudioDenied('invalid');
    if (input.background !== undefined && !model.supportsTransparentBackground) throw new StudioDenied('invalid');
    const quality = qualityFor(model, input.quality);
    const run = { model: model.id, resolution: input.resolution, references: resolved.length, count: input.count, quality, aspect: input.aspect };
    const usd = imageRunUsd(run);
    return {
      ...shared, kind: 'image', model,
      ...(reviewed ? { enhance: reviewed.enhance } : {}),
      params: {
        ...base,
        aspect: input.aspect,
        resolution: input.resolution,
        count: input.count,
        ...(quality ? { quality } : {}),
        ...(input.background ? { background: input.background } : {}),
        ...reviewed?.params,
      },
      estimateUsd: usd, estimateKrw: imageRunKrw(run),
      outputs: { count: input.count, kind: 'image', isDraft: false },
    };
  }

  if (input.kind === 'region_edit' && options.regionV2) {
    // One engine for every partial edit: the model and quality sent are never trusted. A rerun of an
    // edit made on another model runs on this one; its history keeps the model that actually ran.
    const { model, resolution, usd } = regionEditRun(input.model, resolved.length, null, true);
    if (resolved.some((r) => r.kind !== 'image' || r.frame) || resolved.length + 1 > model.maxReferences) throw new StudioDenied('invalid');
    const source = input.source.assetId
      ? await readyAsset(sql, organizationId, input.source.assetId)
      : await readyOutput(sql, organizationId, input.source.outputId!);
    if (!source || source.kind !== 'image' || !source.width || !source.height) throw new StudioDenied('reference_missing');
    return {
      ...shared, kind: 'region_edit', model,
      parentOutputId: input.source.outputId ?? null,
      params: { ...base, resolution, box: input.box, source: { ...input.source }, regionWindow: true, ...(input.purpose ? { purpose: input.purpose } : {}) },
      estimateUsd: usd, estimateKrw: usageKrw(usd, 'image'),
      outputs: { count: 1, kind: 'image', isDraft: false },
    };
  }

  if (input.kind === 'region_edit') {
    const edit = regionEditRun(input.model, resolved.length);
    const quality = qualityFor(edit.model, input.quality);
    const { model, resolution, usd } = quality ? regionEditRun(input.model, resolved.length, quality) : edit;
    if (resolved.some((r) => r.kind !== 'image' || r.frame) || resolved.length + 1 > model.maxReferences) throw new StudioDenied('invalid');
    const source = input.source.assetId
      ? await readyAsset(sql, organizationId, input.source.assetId)
      : await readyOutput(sql, organizationId, input.source.outputId!);
    if (!source || source.kind !== 'image' || !source.width || !source.height) throw new StudioDenied('reference_missing');
    return {
      ...shared, kind: 'region_edit', model,
      parentOutputId: input.source.outputId ?? null,
      params: { ...base, resolution, box: input.box, source: { ...input.source }, ...(quality ? { quality } : {}), ...(input.purpose ? { purpose: input.purpose } : {}) },
      estimateUsd: usd, estimateKrw: usageKrw(usd, 'image'),
      outputs: { count: 1, kind: 'image', isDraft: false },
    };
  }

  const model = liveModel(input.model, 'video') as StudioVideoModel;
  videoResolution(model, input.resolution);
  if (count(resolved, 'image') > model.maxReferenceImages) throw new StudioDenied('invalid');
  if (resolved.some((r) => r.frame && r.kind !== 'image')) throw new StudioDenied('invalid');
  if (resolved.filter((r) => r.frame === 'start').length > 1 || resolved.filter((r) => r.frame === 'end').length > 1) throw new StudioDenied('invalid');

  if (input.kind === 'video') {
    if (count(resolved, 'video') > 0) throw new StudioDenied('invalid');
    if (!(model.aspects as readonly string[]).includes(input.aspect)) throw new StudioDenied('invalid');
    const secs = videoSecondsOf(model, input.seconds);
    const usd = videoRunUsd({ resolution: input.resolution, seconds: secs });
    return {
      ...shared, kind: 'video', model,
      ...(reviewed ? { enhance: reviewed.enhance } : {}),
      params: { ...base, aspect: input.aspect, resolution: input.resolution, seconds: secs, audio: input.audio, ...reviewed?.params },
      estimateUsd: usd, estimateKrw: usageKrw(usd, 'video'),
      outputs: { count: 1, kind: 'video', isDraft: isDraftRun('video', { resolution: input.resolution, seconds: secs }) },
    };
  }

  // video_remix
  const videos = resolved.filter((r) => r.kind === 'video');
  if (videos.length !== 1 || videos.length > model.maxReferenceVideos) throw new StudioDenied(videos.length === 0 ? 'reference_missing' : 'invalid');
  if (input.method !== 'edit' && !(model.aspects as readonly string[]).includes(input.aspect)) throw new StudioDenied('invalid');
  const refSeconds = videos[0]!.durationMs != null ? videos[0]!.durationMs / 1000 : null;
  const shots = input.method !== 'edit' && input.shots?.length ? normalizeShots(input.shots, refSeconds) : [];

  if (input.method === 'blueprint') {
    // The video is only read (./prepare.ts never sends it), so the provider's limits on an attached video do
    // not apply: only the length the shot plan works with. It is billed as the text/image run it is, with
    // no reference-video input, and it always goes through the prompt writer (the blueprint is the prompt).
    if (!blueprintFit(model, { seconds: refSeconds }).readable) throw new StudioDenied('invalid');
    const secs = input.seconds === undefined ? remakeSeconds(model, refSeconds) : videoSecondsOf(model, input.seconds);
    const usd = videoRunUsd({ resolution: input.resolution, seconds: secs });
    return {
      ...shared, kind: 'video_remix', model, enhance: true,
      params: {
        ...base, aspect: input.aspect, resolution: input.resolution, seconds: secs, audio: input.audio,
        method: 'blueprint', keep: [...new Set(input.keep)], change: input.change,
        ...(shots.length ? { shots } : {}),
      },
      estimateUsd: usd, estimateKrw: usageKrw(usd, 'video'),
      outputs: { count: 1, kind: 'video', isDraft: isDraftRun('video_remix', { resolution: input.resolution, method: 'blueprint', seconds: secs }) },
    };
  }

  // The provider's limits on a reference video (length, size, and the longer minimum for an edit):
  // refused here, before anything is reserved, exactly as the dock warns about them.
  const fit = referenceVideoFit(model, { seconds: refSeconds, width: videos[0]!.width, height: videos[0]!.height });
  if (fit.problem || (input.method === 'edit' && !fit.editable)) throw new StudioDenied('invalid');
  const secs = input.method === 'edit' ? null : input.seconds === undefined ? null : videoSecondsOf(model, input.seconds);
  // A run that follows its reference's length is never a draft (./reference-video.ts `isDraftRun`): asked for
  // as one, it is the standard 480p run at the same price, and its result offers no 1080p final.
  const resolution = followsReferenceLength('video_remix', { method: input.method, seconds: secs }) ? billedResolution(input.resolution) : input.resolution;
  // The exact stored length, as the dock has it too (StudioAssetView.durationMs): the quote is the reserve.
  const { usd } = remixRunUsd({ model, resolution, method: input.method, seconds: secs, referenceSeconds: refSeconds, referenceMs: videos[0]!.durationMs });
  const params: StudioJobParams = {
    ...base, aspect: input.method === 'edit' ? null : input.aspect, resolution, seconds: secs, audio: input.audio,
    method: input.method, keep: [...new Set(input.keep)], change: input.change,
    ...(refSeconds !== null ? { referenceVideoSeconds: refSeconds } : {}),
    ...(shots.length ? { shots } : {}),
  };
  return {
    ...shared, kind: 'video_remix', model,
    params,
    estimateUsd: usd, estimateKrw: usageKrw(usd, 'video'),
    outputs: { count: 1, kind: 'video', isDraft: isDraftRun('video_remix', params) },
  };
}

/** A 1080p final of a ready draft: same model, same lane as the draft (a draft id lives on one account). */
export async function planFinal(
  sql: SqlRunner,
  organizationId: string,
  draftOutputId: string,
  locale: 'ko' | 'en',
): Promise<JobPlan> {
  const draft = await readyOutput(sql, organizationId, draftOutputId);
  if (!draft || draft.kind !== 'video' || !draft.is_draft || !draft.draft_task_id) throw new StudioDenied('not_found');
  const job = (await sql.query<JobRow>('select * from brand_studio_jobs where id = $1 and organization_id = $2', [draft.job_id, organizationId])).rows[0];
  if (!job || (job.kind !== 'video' && job.kind !== 'video_remix') || job.status !== 'succeeded') throw new StudioDenied('not_found');
  const model = studioModel(job.model);
  if (!model || model.medium !== 'video' || !model.supportsDraft) throw new StudioDenied('invalid');
  const already = (
    await sql.query(
      "select 1 from brand_studio_jobs where organization_id = $1 and kind = 'video_final' and parent_output_id = $2 and status not in ('failed','canceled') limit 1",
      [organizationId, draftOutputId],
    )
  ).rows[0];
  if (already) throw new StudioDenied('conflict');
  const p = job.params;
  // The final counts the draft's reference video again, for its real length (docs.sunra.ai, "Draft mode"):
  // the exact length stored when the draft was planned (its `duration_ms` / 1000), not the tenths a screen shows.
  // The same function prices the draft's view (`finalEstimateKrw`), so the button shows this figure.
  const { usd, krw } = finalPrice({ params: p, draftDurationMs: draft.duration_ms, model });
  return {
    kind: 'video_final',
    model,
    prompt: '',
    enhance: false,
    params: { aspect: p.aspect ?? null, resolution: '1080p', seconds: p.seconds ?? null, audio: p.audio ?? null, count: 1, locale, draftOutputId },
    refs: [],
    resolved: [],
    parentOutputId: draftOutputId,
    estimateUsd: usd,
    estimateKrw: krw,
    outputs: { count: 1, kind: 'video', isDraft: false },
    stickLane: job.lane,
  };
}
