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
import { STUDIO_LIMITS, STUDIO_REVISE_MATERIALS_MAX, type ReviseMark, type StudioReference, type StudioReviseMode, type StudioReviseProblem } from '../contracts';
import { StudioDenied } from '../access';
import { pointsPastMarks } from '../enhancer/marks';
import type { StudioMediaStore } from '../media-store';
import { studioModel, type StudioVideoModel } from '../models';
import { mentionsMissing, resolveReferences, type JobPlan, type ResolvedRef } from '../plan';
import { followsReferenceLength, isDraftRun, referenceVideoFit } from '../reference-video';
import type { StudioJobParams } from '../types';
import { billedResolution, remixRunUsd, usageKrw, videoRunUsd } from '../usage-rate';
import { dedupeRefs, loadRevisionRecipe, refKey, type RevisionRecipe } from './recipe';
import { lengthOfSheet, sheetRequest, wayOfSheet, type ReviseDialogueRecord, type ReviseSheet } from './sheet';

export type WayOutcome = { ok: true; plan: JobPlan } | { ok: false; problem: StudioReviseProblem };

/** Whole milliseconds of an exact stored length in seconds (`duration_ms` / 1000), for `remixRunUsd`. */
const msOf = (seconds: number | null): number | null => (seconds === null ? null : Math.round(seconds * 1000));

/**
 * The resolution a revision asks for: that of the version it is made from (owner's rule, 2026-11-18: "a
 * 720p video is edited at 720p and a 1080p video at 1080p"). A final is 1080p; a real draft stays `draft`;
 * any other version keeps its own resolution, and one planned as a draft that is no draft is 480p. A
 * revision never drops back to a draft and never raises the resolution; "draft to final" is its own step.
 * Whether the run can still be a draft is the caller's `isDraftRun` (an edit follows its source, so it is
 * the standard 480p run at the same price).
 */
export function revisionResolution(recipe: Pick<RevisionRecipe, 'base' | 'baseJob'>, model: StudioVideoModel): string {
  const listed = (r: string) => (model.resolutions as readonly string[]).includes(r);
  if (recipe.base.isFinal) return listed('1080p') ? '1080p' : model.defaultResolution;
  if (recipe.base.isDraft && model.supportsDraft) return 'draft';
  const own = recipe.baseJob.params?.resolution ?? model.defaultResolution;
  const plain = own === 'draft' ? billedResolution(own) : own;
  return listed(plain) ? plain : model.defaultResolution;
}

export interface ReviseRequest {
  mode: StudioReviseMode;
  prompt: string;
  references: StudioReference[];
  /** Spots the request points at (①②③), as sent. */
  marks?: readonly ReviseMark[];
  /** Material read for the request (videos); never among the run's references. */
  materials?: ReadonlyArray<{ assetId?: string; outputId?: string }>;
  /** The customer's answer to the one question asked about this request. */
  clarified?: { question: string; answer: string } | null;
  /** Reshoot only: a new total length (a longer clip asked for in the conversation), within `reshootLength`. */
  seconds?: number | null;
  /** Made from the revise conversation: stored with the version (`params.revision.dialogue`). */
  dialogue?: ReviseDialogueRecord | null;
}

/**
 * What length a remake of this clip can take. A text / picture run (`video`) and a remix with a length of
 * its own take any whole length the model allows, on both lanes (provider/requests.ts and the lane mapping
 * send `p.seconds`); an edit, or a remix that follows its reference video's length, cannot change it.
 */
export function reshootLength(recipe: Pick<RevisionRecipe, 'recipeJob' | 'base'>): { current: number | null; min: number; max: number; changeable: boolean } {
  const run = recipe.recipeJob;
  const model = run ? liveVideoModel(run.model) : null;
  const p = run?.params ?? null;
  const current = typeof p?.seconds === 'number' ? p.seconds : recipe.base.seconds !== null ? Math.round(recipe.base.seconds) : null;
  if (!run || !model) return { current, min: 0, max: 0, changeable: false };
  const changeable = run.kind === 'video' || (run.kind === 'video_remix' && (p?.method === 'blueprint' || typeof p?.seconds === 'number'));
  return { current, min: model.minSeconds, max: model.maxSeconds, changeable };
}

/**
 * The way a sheet is made, given which ways are open: look-only sheets are edited when editing is open,
 * anything else (or a look sheet whose edit is closed) is made again. Null when nothing can make it.
 */
export function wayForSheet(sheet: Pick<ReviseSheet, 'change'>, open: { edit: boolean; reshoot: boolean }): StudioReviseMode | null {
  const wanted = wayOfSheet(sheet);
  if (!wanted) return null;
  if (wanted === 'edit') return open.edit ? 'edit' : open.reshoot ? 'reshoot' : null;
  return open.reshoot ? 'reshoot' : null;
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

function revisionParams(
  recipe: RevisionRecipe,
  mode: StudioReviseMode,
  added: number,
  marks?: readonly ReviseMark[],
  materials?: ReadonlyArray<{ assetId?: string; outputId?: string }>,
  clarified?: { question: string; answer: string } | null,
  dialogue?: ReviseDialogueRecord | null,
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
    ...(clarified ? { clarified: { question: clarified.question, answer: clarified.answer } } : {}),
    ...(dialogue ? { dialogue: structuredClone(dialogue) } : {}),
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

  // The version's own resolution (`revisionResolution`). A draft is edited at 480p as the standard run at the
  // same price: an edit follows its source's length, and such a run is never a draft (../reference-video.ts
  // `isDraftRun`), so its result offers no 1080p final. To get one, finish the draft and edit the final.
  const resolution = billedResolution(revisionResolution(recipe, model));
  const audio = recipe.baseJob.params?.audio ?? recipe.recipeJob?.params?.audio ?? 'native';
  // `base.seconds` is the clip's exact stored length (recipe.ts: duration_ms / 1000), priced as such.
  const { usd } = remixRunUsd({ model, resolution, method: 'edit', seconds: null, referenceSeconds: base.seconds, referenceMs: msOf(base.seconds) });
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
        revision: revisionParams(recipe, 'edit', request.references.length, request.marks, request.materials, request.clarified, request.dialogue),
      },
      refs,
      resolved,
      parentOutputId: base.outputId,
      estimateUsd: usd,
      estimateKrw: usageKrw(usd, 'video'),
      outputs: { count: 1, kind: 'video', isDraft: isDraftRun('video_remix', { resolution, method: 'edit', seconds: null }) },
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
  // A longer clip asked for in the conversation, when this recipe can take a length of its own.
  const length = reshootLength(recipe);
  const longer = typeof request.seconds === 'number' ? request.seconds : null;
  if (longer !== null && (!length.changeable || longer < length.min || longer > length.max)) return { ok: false, problem: 'unsupported' };
  const seconds = longer ?? p.seconds ?? null;
  // The version's own resolution, not the recipe run's: a reshoot of a 1080p final (whose recipe is its draft)
  // is made at 1080p, and one of a 480p version that is no draft is no draft either (`revisionResolution`).
  const asked = revisionResolution(recipe, model);
  // The same rule as a first run (../plan.ts): one that follows its reference's length is never a draft.
  const resolution = followsReferenceLength(run.kind, { method: p.method, seconds }) ? billedResolution(asked) : asked;
  const shared = {
    model,
    prompt: request.prompt,
    enhance: true,
    refs,
    resolved: freshResolved,
    parentOutputId: recipe.base.outputId,
    outputs: { count: 1, kind: 'video' as const, isDraft: isDraftRun(run.kind, { resolution, method: p.method, seconds }) },
    stickLane: null,
  };
  const params: StudioJobParams = {
    aspect: p.aspect ?? null,
    resolution,
    seconds,
    audio: p.audio ?? 'native',
    count: 1,
    locale,
    revision: revisionParams(recipe, 'reshoot', fresh.length, request.marks, request.materials, request.clarified, request.dialogue),
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
      : remixRunUsd({ model, resolution, method, seconds, referenceSeconds, referenceMs: msOf(referenceSeconds) }).usd;
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
    clarified?: { question: string; answer: string };
    /** Only when `BRAND_STUDIO_REVISE_V2` is on (the caller drops it otherwise). */
    dialogue?: ReviseDialogueRecord;
  },
  media: StudioMediaStore,
  locale: 'ko' | 'en',
): Promise<JobPlan> {
  const dialogue = input.dialogue ?? null;
  // From the conversation the sheet is the request: its changes, one per line, and its length.
  const prompt = dialogue ? sheetRequest(dialogue.sheet) : input.prompt;
  if (dialogue && !prompt.trim()) throw new StudioDenied('invalid');
  requireMarksBehind(prompt, input.marks);
  const recipe = await loadRevisionRecipe(sql, organizationId, input.outputId);
  const added = await resolveAdded(sql, organizationId, input.references, media, locale);
  // The customer numbers the pictures they attached for this request from 1, whatever the way, and the
  // clip itself is "영상 1".
  const clip = { kind: 'video' } as ResolvedRef;
  if (mentionsMissing(prompt, [clip, ...added])) throw new StudioDenied('reference_missing');
  const materials = await resolveMaterials(sql, organizationId, input.materials, media, locale);
  const seconds = dialogue ? lengthOfSheet(dialogue.sheet) : null;
  const request = {
    mode: input.mode,
    prompt,
    references: [...input.references],
    marks: input.marks ?? [],
    materials,
    clarified: dialogue ? null : (input.clarified ?? null),
    ...(seconds !== null ? { seconds } : {}),
    ...(dialogue ? { dialogue } : {}),
  };
  if (dialogue) {
    // The way follows from the sheet, never from the caller: a sheet that changes motion, framing or
    // length is made again (a longer clip only so), a look-only sheet is edited unless editing is closed.
    const wanted = wayOfSheet(dialogue.sheet);
    if (wanted === 'reshoot' && input.mode !== 'reshoot') throw new StudioDenied('invalid');
    // Only a longer clip is booked here; shortening is the editing studio's (free).
    const current = reshootLength(recipe).current;
    if (seconds !== null && current !== null && seconds <= current) throw new StudioDenied('invalid');
    if (wanted === 'edit' && input.mode === 'reshoot' && (await editWay(sql, organizationId, recipe, { ...request, mode: 'edit' }, media, locale)).ok) {
      throw new StudioDenied('invalid');
    }
  }
  const way = input.mode === 'edit'
    ? await editWay(sql, organizationId, recipe, request, media, locale)
    : await reshootWay(sql, organizationId, recipe, request, media, locale);
  if (!way.ok) throw new StudioDenied(DENIED[way.problem]);
  return way.plan;
}
