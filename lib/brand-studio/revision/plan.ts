/**
 * Planning a new version of a generated clip (`video_revise`). The customer sends only what should
 * change and any pictures added for it; everything else comes from the clip's history
 * (./recipe.ts). The plan is an ordinary `JobPlan`, stored as a `video_remix` edit or as the kind of
 * the run a reshoot makes again, with `params.revision` on top.
 *
 * Both ways are also judged without planning a job (`revise.plan`, ./advise.ts): `editWay` and
 * `reshootWay` return either the plan or the reason the way is closed.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';
import { STUDIO_LIMITS, STUDIO_REVISE_DOCUMENTS_MAX, STUDIO_REVISE_MATERIALS_MAX, type ReviseMark, type StudioReference, type StudioReviseMode, type StudioReviseProblem } from '../contracts';
import { StudioDenied } from '../access';
import { pointsPastMarks } from '../enhancer/marks';
import type { StudioMediaStore } from '../media-store';
import { studioModel, type StudioVideoModel } from '../models';
import { mentionsMissing, resolveReferences, type JobPlan, type ResolvedRef } from '../plan';
import { referenceVideoFit } from '../reference-video';
import type { StudioJobParams } from '../types';
import { remixRunUsd, usageKrw, videoRunUsd } from '../usage-rate';
import { dedupeRefs, loadRevisionRecipe, refKey, type RevisionRecipe } from './recipe';

export type WayOutcome = { ok: true; plan: JobPlan } | { ok: false; problem: StudioReviseProblem };

export interface ReviseRequest {
  mode: StudioReviseMode;
  prompt: string;
  references: StudioReference[];
  /** Spots the request points at (①②③), as sent. */
  marks?: readonly ReviseMark[];
  /** Material read for the request (videos); never among the run's references. */
  materials?: ReadonlyArray<{ assetId?: string; outputId?: string }>;
  /** Documents read for the request; never among the run's references. */
  documents?: ReadonlyArray<{ assetId: string }>;
  /** The customer's answer to the one question asked about this request. */
  clarified?: { question: string; answer: string } | null;
}

type StoredMark = NonNullable<NonNullable<StudioJobParams['revision']>['marks']>[number];

/** The marks as they are stored on the job: geometry, the chip label and the description, nothing else. */
export function storedMarks(marks: readonly ReviseMark[] | undefined): StoredMark[] {
  return (marks ?? []).map((m) => ({
    time: m.time,
    x: m.x,
    y: m.y,
    ...(m.w !== undefined && m.h !== undefined ? { w: m.w, h: m.h } : {}),
    ...(m.label ? { label: m.label } : {}),
    ...(m.what ? { what: m.what } : {}),
  }));
}

/** A request may only point at marks that were sent with it (② needs two marks). */
export function requireMarksBehind(prompt: string, marks: readonly ReviseMark[] | undefined): void {
  if (pointsPastMarks(prompt, marks?.length ?? 0)) throw new StudioDenied('invalid');
}

function liveVideoModel(id: string): StudioVideoModel | null {
  const model = studioModel(id);
  return model && model.availability === 'live' && model.medium === 'video' ? (model as StudioVideoModel) : null;
}

const imageCount = (refs: readonly ResolvedRef[]) => refs.filter((r) => r.kind === 'image').length;

/**
 * The pictures sent with a revision: images of this organization, never an opening/closing frame.
 * Anything else is `invalid` (the request itself is malformed).
 */
export async function resolveAdded(
  sql: SqlRunner,
  organizationId: string,
  references: readonly StudioReference[],
  media: StudioMediaStore,
  locale: 'ko' | 'en',
): Promise<ResolvedRef[]> {
  if (references.some((r) => r.frame)) throw new StudioDenied('invalid');
  let resolved: ResolvedRef[];
  try {
    resolved = await resolveReferences(sql, organizationId, references, media, locale);
  } catch (error) {
    if (error instanceof StudioDenied) throw new StudioDenied('invalid');
    throw error;
  }
  if (resolved.some((r) => r.kind !== 'image')) throw new StudioDenied('invalid');
  return resolved;
}

/**
 * The material sent with a revision: videos of this organization (lib/brand-studio/revision/material.ts).
 * Anything else is `invalid`. Stored as plain ids: what to take from them is the request itself.
 */
export async function resolveMaterials(
  sql: SqlRunner,
  organizationId: string,
  materials: readonly StudioReference[] | undefined,
  media: StudioMediaStore,
  locale: 'ko' | 'en',
): Promise<Array<{ assetId?: string; outputId?: string }>> {
  const list = dedupeRefs([...(materials ?? [])]);
  if (!list.length) return [];
  if (list.length > STUDIO_REVISE_MATERIALS_MAX || list.some((r) => r.frame)) throw new StudioDenied('invalid');
  let resolved: ResolvedRef[];
  try {
    resolved = await resolveReferences(sql, organizationId, list, media, locale);
  } catch (error) {
    if (error instanceof StudioDenied) throw new StudioDenied('reference_missing');
    throw error;
  }
  if (resolved.some((r) => r.kind !== 'video')) throw new StudioDenied('invalid');
  return list.map((r) => (r.assetId ? { assetId: r.assetId } : { outputId: r.outputId! }));
}

/**
 * The documents sent with a revision (§4.7): this organization's ready, live `document` assets, at most
 * `STUDIO_REVISE_DOCUMENTS_MAX`. Only while documents are open; closed, they are ignored as an unknown
 * field always was. Stored as ids; never among the run's references.
 */
export async function resolveDocuments(
  sql: SqlRunner,
  organizationId: string,
  documents: ReadonlyArray<{ assetId: string }> | undefined,
  open: boolean,
): Promise<Array<{ assetId: string }>> {
  if (!open) return [];
  const ids = [...new Set((documents ?? []).map((d) => d.assetId))];
  if (!ids.length) return [];
  if (ids.length > STUDIO_REVISE_DOCUMENTS_MAX) throw new StudioDenied('invalid');
  const found = (
    await sql.query<{ id: string }>(
      "select id from brand_studio_assets where organization_id = $1 and id = any($2::uuid[]) and kind = 'document' and status = 'ready' and deleted_at is null",
      [organizationId, ids],
    )
  ).rows.map((r) => r.id);
  if (found.length !== ids.length) throw new StudioDenied('reference_missing');
  return ids.map((assetId) => ({ assetId }));
}

function revisionParams(
  recipe: RevisionRecipe,
  mode: StudioReviseMode,
  added: number,
  marks?: readonly ReviseMark[],
  materials?: ReadonlyArray<{ assetId?: string; outputId?: string }>,
  documents?: ReadonlyArray<{ assetId: string }>,
  clarified?: { question: string; answer: string } | null,
): NonNullable<StudioJobParams['revision']> {
  const kept = storedMarks(marks);
  return {
    rootJobId: recipe.rootJobId,
    version: recipe.nextVersion,
    baseJobId: recipe.base.jobId,
    baseOutputId: recipe.base.outputId,
    mode,
    added,
    ...(kept.length ? { marks: kept } : {}),
    ...(materials?.length ? { materials: materials.map((m) => ({ ...m })) } : {}),
    ...(documents?.length ? { documents: documents.map((d) => ({ assetId: d.assetId })) } : {}),
    ...(clarified ? { clarified: { question: clarified.question, answer: clarified.answer } } : {}),
  };
}

/** The clip itself sent back with the provider's edit task: only what was asked changes. */
export async function editWay(
  sql: SqlRunner,
  organizationId: string,
  recipe: RevisionRecipe,
  request: ReviseRequest,
  media: StudioMediaStore,
  locale: 'ko' | 'en',
): Promise<WayOutcome> {
  const model = liveVideoModel(recipe.baseJob.model);
  if (!model) return { ok: false, problem: 'unsupported' };
  const { base } = recipe;
  const fit = referenceVideoFit(model, { seconds: base.seconds, width: base.width, height: base.height });
  if (fit.problem === 'length') {
    return { ok: false, problem: base.seconds !== null && base.seconds > model.referenceVideoSeconds.max ? 'too_long' : 'too_short' };
  }
  if (fit.problem) return { ok: false, problem: 'unsupported' };
  if (!fit.editable) return { ok: false, problem: 'too_short' };
  const refs: StudioReference[] = [{ outputId: base.outputId }, ...request.references];
  if (refs.length > STUDIO_LIMITS.referencesMax) return { ok: false, problem: 'too_many_references' };
  let resolved: ResolvedRef[];
  try {
    resolved = await resolveReferences(sql, organizationId, refs, media, locale);
  } catch (error) {
    if (error instanceof StudioDenied) return { ok: false, problem: 'references_gone' };
    throw error;
  }
  if (imageCount(resolved) > model.maxReferenceImages) return { ok: false, problem: 'too_many_references' };

  // A final is 1080p; a draft stays a draft (the edit path allows it, and its own final can follow).
  const asked = base.isFinal ? '1080p' : (recipe.baseJob.params?.resolution ?? model.defaultResolution);
  const resolution =
    asked === 'draft' ? (model.supportsDraft ? 'draft' : '480p') : (model.resolutions as readonly string[]).includes(asked) ? asked : model.defaultResolution;
  const audio = recipe.baseJob.params?.audio ?? recipe.recipeJob?.params?.audio ?? 'native';
  const { usd } = remixRunUsd({ model, resolution, method: 'edit', seconds: null, referenceSeconds: base.seconds });
  return {
    ok: true,
    plan: {
      kind: 'video_remix',
      model,
      prompt: request.prompt,
      enhance: true,
      params: {
        aspect: null,
        resolution,
        seconds: null,
        audio,
        count: 1,
        locale,
        method: 'edit',
        keep: [],
        change: '',
        ...(base.seconds !== null ? { referenceVideoSeconds: base.seconds } : {}),
        revision: revisionParams(recipe, 'edit', request.references.length, request.marks, request.materials, request.documents, request.clarified),
      },
      refs,
      resolved,
      parentOutputId: base.outputId,
      estimateUsd: usd,
      estimateKrw: usageKrw(usd, 'video'),
      outputs: { count: 1, kind: 'video', isDraft: resolution === 'draft' },
      stickLane: null,
    },
  };
}

/** The recipe run made again, with every request so far written into its prompt. */
export async function reshootWay(
  sql: SqlRunner,
  organizationId: string,
  recipe: RevisionRecipe,
  request: ReviseRequest,
  media: StudioMediaStore,
  locale: 'ko' | 'en',
): Promise<WayOutcome> {
  const run = recipe.recipeJob;
  if (!run || (run.kind !== 'video' && run.kind !== 'video_remix')) return { ok: false, problem: 'references_gone' };
  const model = liveVideoModel(run.model);
  if (!model) return { ok: false, problem: 'unsupported' };
  // The recipe's own refs stay exactly as they were (its prompt's tokens count on their order);
  // `addedRefs` is already free of them.
  const earlier = [...(Array.isArray(run.refs) ? run.refs : []), ...recipe.addedRefs];
  const known = new Set(earlier.map(refKey));
  const fresh = dedupeRefs(request.references).filter((r) => !known.has(refKey(r)));
  const refs = [...earlier, ...fresh];
  let resolved: ResolvedRef[];
  try {
    resolved = await resolveReferences(sql, organizationId, earlier, media, locale);
  } catch (error) {
    if (error instanceof StudioDenied) return { ok: false, problem: 'references_gone' };
    throw error;
  }
  if (refs.length > STUDIO_LIMITS.referencesMax) return { ok: false, problem: 'too_many_references' };
  const freshResolved = fresh.length ? await resolveReferences(sql, organizationId, refs, media, locale) : resolved;
  if (imageCount(freshResolved) > model.maxReferenceImages) return { ok: false, problem: 'too_many_references' };

  const p = run.params ?? ({} as StudioJobParams);
  const resolution = p.resolution ?? model.defaultResolution;
  const seconds = p.seconds ?? null;
  const shared = {
    model,
    prompt: request.prompt,
    enhance: true,
    refs,
    resolved: freshResolved,
    parentOutputId: recipe.base.outputId,
    outputs: { count: 1, kind: 'video' as const, isDraft: resolution === 'draft' },
    stickLane: null,
  };
  const params: StudioJobParams = {
    aspect: p.aspect ?? null,
    resolution,
    seconds,
    audio: p.audio ?? 'native',
    count: 1,
    locale,
    revision: revisionParams(recipe, 'reshoot', fresh.length, request.marks, request.materials, request.documents, request.clarified),
  };
  if (run.kind === 'video') {
    const usd = videoRunUsd({ resolution, seconds: seconds ?? model.defaultSeconds });
    return { ok: true, plan: { ...shared, kind: 'video', params, estimateUsd: usd, estimateKrw: usageKrw(usd, 'video') } };
  }
  const video = freshResolved.find((r) => r.kind === 'video');
  if (!video) return { ok: false, problem: 'references_gone' };
  const method = p.method ?? 'reference';
  const referenceSeconds = video.durationMs != null ? video.durationMs / 1000 : (p.referenceVideoSeconds ?? null);
  const usd =
    method === 'blueprint'
      ? videoRunUsd({ resolution, seconds: seconds ?? model.defaultSeconds })
      : remixRunUsd({ model, resolution, method, seconds, referenceSeconds }).usd;
  return {
    ok: true,
    plan: {
      ...shared,
      kind: 'video_remix',
      params: {
        ...params,
        method,
        keep: [...(p.keep ?? [])],
        change: p.change ?? '',
        ...(p.referenceVideoSeconds !== undefined ? { referenceVideoSeconds: p.referenceVideoSeconds } : {}),
        ...(p.shots?.length ? { shots: p.shots.map((s) => ({ ...s })) } : {}),
      },
      estimateUsd: usd,
      estimateKrw: usageKrw(usd, 'video'),
    },
  };
}

const DENIED: Record<StudioReviseProblem, 'invalid' | 'reference_missing'> = {
  too_short: 'invalid',
  too_long: 'invalid',
  unsupported: 'invalid',
  too_many_references: 'invalid',
  references_gone: 'reference_missing',
};

/**
 * `job.create` with `video_revise`. Call it inside the organization lock `createStudioJob` takes: the
 * version number is read there, so two revisions of one clip made close together never share one.
 */
export async function planRevision(
  sql: SqlRunner,
  organizationId: string,
  input: {
    outputId: string;
    mode: StudioReviseMode;
    prompt: string;
    references: StudioReference[];
    marks?: ReviseMark[];
    materials?: StudioReference[];
    documents?: Array<{ assetId: string }>;
    clarified?: { question: string; answer: string };
  },
  media: StudioMediaStore,
  locale: 'ko' | 'en',
  documentsOpen = false,
): Promise<JobPlan> {
  requireMarksBehind(input.prompt, input.marks);
  const recipe = await loadRevisionRecipe(sql, organizationId, input.outputId);
  const added = await resolveAdded(sql, organizationId, input.references, media, locale);
  // The customer numbers the pictures they attached for this request from 1, whatever the way, and the
  // clip itself is "영상 1".
  const clip = { kind: 'video' } as ResolvedRef;
  if (mentionsMissing(input.prompt, [clip, ...added])) throw new StudioDenied('reference_missing');
  const materials = await resolveMaterials(sql, organizationId, input.materials, media, locale);
  const documents = await resolveDocuments(sql, organizationId, input.documents, documentsOpen);
  const request = {
    mode: input.mode,
    prompt: input.prompt,
    references: [...input.references],
    marks: input.marks ?? [],
    materials,
    documents,
    clarified: input.clarified ?? null,
  };
  const way = input.mode === 'edit'
    ? await editWay(sql, organizationId, recipe, request, media, locale)
    : await reshootWay(sql, organizationId, recipe, request, media, locale);
  if (!way.ok) throw new StudioDenied(DENIED[way.problem]);
  return way.plan;
}
