/**
 * Getting a queued job ready to send (docs/BRAND-STUDIO-V2.md §8): resolve the references again (a
 * deleted one fails the job here, not at the provider), read a reference film, cut the region-edit
 * crop, and run the prompt enhancer. Enhancement never blocks a run: a model failure falls back to the
 * deterministic composer, and a composer failure sends the customer's own words.
 */
import { prepareMusic } from './sound/prepare-music';
import { confirmedIdentityFor } from '@/lib/brands/identity/service';
import { promptCharLimit } from '@/lib/engines/prompt-limits';
import type { FilmDepth, FilmSheet, FilmShot, StudioErrorCode, StudioReference } from './contracts';
import { extractStoredFilmSheet, isFilmSheetExpired, readCachedFilmSheet, writeCachedFilmSheet } from './film-sheet';
import { imageInfo, sniffMime, thumbnailWebp } from './files';
import { studioModel, type StudioImageModel, type StudioModel } from './models';
import { resolveReferences, type ResolvedRef } from './plan';
import { StudioDenied } from './access';
import { enhanceMeta } from './enhancer/meta';
import { replaceMarks } from './enhancer/marks';
import { describeSelection, selectionLine } from './region-edit/window';
import { clarifiedOf, withClarified } from './revision/clarify';
import { addedRefsOf, refKey, renumberRequest, revisionChain } from './revision/recipe';
import { renderPresetPrompt } from './workflows/presets';
import type { EnhanceInput, EnhanceResult, JobRow, RegionPlan, StudioDeps, StudioJobParams, StudioJobWork } from './types';

export class PrepareFailure extends Error {
  constructor(readonly code: StudioErrorCode, readonly detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'PrepareFailure';
  }
}

/** Media addresses a provider can fetch: the local gateway path gains the app origin when one is set. */
export function providerUrl(deps: Pick<StudioDeps, 'env'>, url: string): string {
  return url.startsWith('/') && deps.env.appOrigin ? `${deps.env.appOrigin}${url}` : url;
}

/** What is sent when the enhancer is off (or was never asked): the customer's words, then the change note. */
export function sendPrompt(job: Pick<JobRow, 'final_prompt' | 'prompt' | 'params'>): string {
  if (job.final_prompt) return job.final_prompt;
  return [job.prompt, job.params?.change ?? ''].map((s) => s.trim()).filter(Boolean).join('\n');
}

/** Long side of the close-up of the customer's box the prompt writer sees (region edit v2). */
const CLOSE_UP_LONG = 768;

/**
 * Region edit: the plan, the picture the model receives as image 1, and (v2, `params.regionWindow`)
 * what the prompt writer is told about where the customer's box sits in it.
 */
export async function regionEditPlan(
  deps: Pick<StudioDeps, 'intel' | 'log'>,
  original: Uint8Array,
  size: { width: number; height: number },
  params: Pick<StudioJobParams, 'box' | 'regionWindow'>,
  model: StudioImageModel,
): Promise<{ plan: RegionPlan; crop: { bytes: Uint8Array; mime: 'image/png' }; regionWindow: EnhanceInput['regionWindow'] }> {
  const box = params.box!;
  if (!params.regionWindow) {
    const plan = deps.intel.planRegion(size, box, model.aspects);
    return { plan, crop: await deps.intel.cropForEdit(original, plan), regionWindow: null };
  }
  if (!deps.intel.planRegionWindow) throw new PrepareFailure('failed', 'no window planner');
  const plan = deps.intel.planRegionWindow(size, box);
  const crop = await deps.intel.cropForEdit(original, plan);
  // The close-up: the paste zone around the box, small, for the prompt writer only.
  const zone = plan.box;
  const k = Math.min(1, CLOSE_UP_LONG / Math.max(zone.width, zone.height));
  const closeUp = await deps.intel
    .cropForEdit(original, {
      roi: zone,
      box: plan.select ?? zone,
      aspect: plan.aspect,
      work: { width: Math.max(1, Math.round(zone.width * k)), height: Math.max(1, Math.round(zone.height * k)) },
    })
    .catch(() => null);
  deps.log?.('studio_region_window', {
    window: `${plan.roi.width}x${plan.roi.height}`,
    picture: `${size.width}x${size.height}`,
    aspect: plan.aspect,
    work: `${plan.work.width}x${plan.work.height}`,
    downscale: plan.downscale ?? 1,
    ...(plan.stretched ? { stretched: true } : {}),
  });
  return { plan, crop, regionWindow: { ...describeSelection(plan), closeUp } };
}

/**
 * Region edit v2: the words sent end with where the part is, since the engine gets no mask. The line counts
 * inside `limit` (the run's whole text, `promptCharLimit` of its model).
 */
export function withSelectionLine(prompt: string, plan: RegionPlan, limit: number): string {
  const line = selectionLine(describeSelection(plan));
  return `${prompt.trim().slice(0, limit - line.length - 1)}\n${line}`;
}

/** The confirmed brand identity in the enhancer's words; null when there is none or brand learning is closed. */
export async function brandSummary(deps: Pick<StudioDeps, 'sql'>, organizationId: string, name: string): Promise<EnhanceInput['brand']> {
  try {
    const identity = await confirmedIdentityFor(deps.sql, organizationId);
    if (!identity) return { name };
    const c = identity.colour;
    return {
      name,
      tone: identity.voice.tone,
      palette: [c.accent, c.ink, c.paper, c.canvas, c.sky],
      rules: [
        ...identity.rules.never,
        ...identity.rules.forbiddenTerms.map((t) => `never write "${t}"`),
        ...identity.rules.competitorExclusions.map((t) => `never show ${t}`),
      ].slice(0, 12),
    };
  } catch {
    return { name };
  }
}

const ENHANCER_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function enhanceReferences(deps: Pick<StudioDeps, 'media'>, refs: readonly ResolvedRef[]): Promise<EnhanceInput['references']> {
  const out: EnhanceInput['references'] = [];
  for (const r of refs) {
    let thumb: { bytes: Uint8Array; mime: string } | undefined;
    if (r.thumbKey) {
      try {
        thumb = { bytes: await deps.media.read(r.thumbKey), mime: 'image/webp' };
      } catch {
        thumb = undefined;
      }
    }
    if (!thumb && r.kind === 'image' && r.key) {
      try {
        const rawBytes = await deps.media.read(r.key);
        if (rawBytes.byteLength > 0) {
          try {
            thumb = { bytes: await thumbnailWebp(rawBytes, 768), mime: 'image/webp' };
          } catch {
            const sniffed = sniffMime(rawBytes);
            if (sniffed && ENHANCER_IMAGE_MIMES.has(sniffed)) {
              thumb = { bytes: rawBytes, mime: sniffed };
            }
          }
        }
      } catch {
        thumb = undefined;
      }
    }
    out.push({
      index: r.index,
      kind: r.kind,
      label: r.label,
      ...(r.role ? { role: r.role } : {}),
      ...(r.use ? { use: r.use } : {}),
      ...(r.avoid ? { avoid: r.avoid } : {}),
      ...(r.frame ? { frame: r.frame } : {}),
      ...(thumb ? { thumb } : {}),
    });
  }
  return out;
}

export async function runEnhancer(
  deps: Pick<StudioDeps, 'intel' | 'intelDeps' | 'log'> & { sql?: StudioDeps['sql']; organizationId?: string },
  input: EnhanceInput,
): Promise<EnhanceResult> {
  const intelDeps =
    deps.sql || deps.organizationId
      ? {
          ...deps.intelDeps,
          ...(deps.sql ? { sql: deps.sql } : {}),
          ...(deps.organizationId ? { organizationId: deps.organizationId } : {}),
        }
      : deps.intelDeps;
  try {
    const result = await deps.intel.enhancePrompt(input, intelDeps);
    if (result && typeof result.prompt === 'string' && result.prompt.trim()) return result;
  } catch (error) {
    deps.log?.('studio_enhance_failed', { message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
  }
  try {
    return deps.intel.composeFallbackPrompt(input);
  } catch {
    return { prompt: input.prompt, notes: '', source: 'fallback' };
  }
}

export async function readSheet(
  deps: Pick<StudioDeps, 'intel' | 'intelDeps' | 'media' | 'env'>,
  ref: ResolvedRef,
  locale: 'ko' | 'en',
  depth: FilmDepth = 'basic',
): Promise<FilmSheet | null> {
  try {
    const video =
      deps.media.kind === 'r2'
        ? { url: providerUrl(deps, ref.url) }
        : { bytes: await deps.media.read(ref.key), mime: ref.key.endsWith('.mov') ? 'video/quicktime' : 'video/mp4' };
    return await deps.intel.readFilm(depth === 'basic' ? { video, locale } : { video, locale, depth }, deps.intelDeps);
  } catch {
    return null;
  }
}

/* A library video is read once per language and depth: the sheet is kept on the asset (`film_sheets`,
 * migration 0077 + 0087 14-day sliding TTL, keyed "ko" / "en" for the basic reading and
 * "blueprint:ko" / "blueprint:en" for the deeper one) and reused by the remix panel, the prompt preview
 * and the job. A failed reading is not kept, so a later call may try again. */
export function storedSheet(
  row: { film_sheets?: unknown; film_sheets_expires_at?: unknown } | null | undefined,
  locale: 'ko' | 'en',
  depth: FilmDepth = 'basic',
  now: Date = new Date(),
): FilmSheet | null {
  if (isFilmSheetExpired(row?.film_sheets_expires_at, now)) return null;
  return extractStoredFilmSheet(row?.film_sheets, locale, depth);
}

async function cachedSheet(
  sql: StudioDeps['sql'],
  organizationId: string,
  assetId: string,
  locale: 'ko' | 'en',
  depth: FilmDepth,
  now?: Date,
): Promise<FilmSheet | null> {
  return readCachedFilmSheet(sql, { organizationId, assetId, locale, depth, ...(now ? { now } : {}) });
}

export async function keepSheet(
  sql: StudioDeps['sql'],
  organizationId: string,
  assetId: string,
  locale: 'ko' | 'en',
  sheet: FilmSheet,
  depth: FilmDepth = 'basic',
  now?: Date,
): Promise<void> {
  await writeCachedFilmSheet(sql, { organizationId, assetId, locale, sheet, depth, ...(now ? { now } : {}) });
}

/** The sheet of a reference video: the asset's kept reading when there is one, else a fresh reading (kept for next time). */
export async function filmSheetFor(
  deps: Pick<StudioDeps, 'sql' | 'intel' | 'intelDeps' | 'media' | 'env' | 'now'>,
  input: { organizationId: string; assetId: string | null; ref: ResolvedRef; locale: 'ko' | 'en'; depth?: FilmDepth },
): Promise<FilmSheet | null> {
  const depth = input.depth ?? 'basic';
  const now = deps.now?.();
  if (input.assetId) {
    const kept = await cachedSheet(deps.sql, input.organizationId, input.assetId, input.locale, depth, now);
    if (kept) return kept;
  }
  const sheet = await readSheet(deps, input.ref, input.locale, depth);
  if (sheet && input.assetId) await keepSheet(deps.sql, input.organizationId, input.assetId, input.locale, sheet, depth, now);
  return sheet;
}

/**
 * The reading with the customer's own shot table laid over it: their rows replace the read shots (a
 * reading that failed becomes a sheet of those rows alone). Without rows, the reading as it is.
 */
export function withShots(sheet: FilmSheet | null, shots: readonly FilmShot[] | undefined): FilmSheet | null {
  if (!shots?.length) return sheet;
  const rows = shots.map((s) => ({ ...s }));
  const lastEnd = Math.max(...rows.map((s) => s.end));
  return {
    seconds: sheet && sheet.seconds > 0 ? sheet.seconds : lastEnd,
    aspect: sheet?.aspect ?? '',
    shots: rows,
    look: sheet?.look ?? { lighting: '', palette: '', texture: '' },
    audio: sheet?.audio ?? { music: false, speech: false, effects: '' },
    summary: sheet?.summary ?? '',
    ...(sheet?.subjects ? { subjects: sheet.subjects } : {}),
    ...(sheet?.setting ? { setting: sheet.setting } : {}),
  };
}

/**
 * What the prompt writer gets for a remix: the film sheet (the deeper reading for a blueprint) with the
 * customer's shot table over it, and the references the provider will actually receive. A blueprint
 * never sends its video, so the video is not among them and the prompt names no video token.
 */
export async function remixContext(
  deps: Pick<StudioDeps, 'sql' | 'intel' | 'intelDeps' | 'media' | 'env'>,
  input: { organizationId: string; params: Pick<StudioJobParams, 'method' | 'shots'>; refs: readonly StudioReference[]; resolved: readonly ResolvedRef[]; locale: 'ko' | 'en' },
): Promise<{ sheet: FilmSheet | null; resolved: ResolvedRef[] }> {
  const blueprint = input.params.method === 'blueprint';
  const film = input.resolved.find((r) => r.kind === 'video');
  const read = film
    ? await filmSheetFor(deps, {
        organizationId: input.organizationId,
        assetId: input.refs[film.index - 1]?.assetId ?? null,
        ref: film,
        locale: input.locale,
        depth: blueprint ? 'blueprint' : 'basic',
      })
    : null;
  const sheet = input.params.method === 'edit' ? read : withShots(read, input.params.shots);
  return { sheet, resolved: blueprint ? input.resolved.filter((r) => r.kind !== 'video') : [...input.resolved] };
}

/**
 * Inputs as sent to the provider (and to the account-lane worker): a blueprint leaves its video out. A video
 * keeps its stored type, which the worker uploads it with (the account lane takes no outside video URL).
 */
export function sentInputs(deps: Pick<StudioDeps, 'env'>, job: Pick<JobRow, 'kind' | 'params'>, resolved: readonly ResolvedRef[]): NonNullable<StudioJobWork['inputs']> {
  const blueprint = job.kind === 'video_remix' && job.params?.method === 'blueprint';
  return resolved
    .filter((r) => !(blueprint && r.kind === 'video'))
    .map((r) => ({ kind: r.kind, url: providerUrl(deps, r.url), ...(r.frame ? { frame: r.frame } : {}), ...(r.kind === 'video' && r.mime ? { mime: r.mime } : {}) }));
}

export function enhanceKind(kind: JobRow['kind']): EnhanceInput['kind'] | null {
  return kind === 'video_final' || kind === 'music' || kind === 'sound_effect' ? null : kind;
}

export function enhanceInputOf(
  job: Pick<JobRow, 'kind' | 'prompt' | 'params'>,
  model: StudioModel,
  references: EnhanceInput['references'],
  brand: EnhanceInput['brand'],
  sheet: FilmSheet | null,
  editCropThumb?: EnhanceInput['editCropThumb'],
  revision?: EnhanceInput['revision'],
  regionWindow?: EnhanceInput['regionWindow'],
): EnhanceInput {
  const p = job.params;
  const kind = enhanceKind(job.kind) ?? 'image';
  const video = kind === 'video' || kind === 'video_remix';
  return {
    kind,
    profile: model.promptProfile,
    model: model.id,
    locale: p.locale ?? 'ko',
    prompt: job.prompt,
    references,
    brand,
    ...(editCropThumb ? { editCropThumb } : {}),
    ...(regionWindow ? { regionWindow } : {}),
    ...(revision ? { revision } : {}),
    video: video
      ? {
          seconds: p.seconds ?? null,
          aspect: p.aspect ?? 'adaptive',
          audio: p.audio ?? 'native',
          ...(p.method ? { method: p.method } : {}),
          ...(p.keep ? { keep: p.keep } : {}),
          ...(p.change ? { change: p.change } : {}),
          sheet,
        }
      : null,
  };
}

/**
 * What the prompt writer needs to know about a new version of a clip: the prompt the run being revised
 * was made from and the changes asked for since. Read again from the clip's history (by job id, so a
 * deleted earlier result does not lose it); null when there is no revision or the history is gone.
 *
 * For a reshoot the pictures each request attached sit later in the tray than the customer numbered
 * them ("이미지 1" of a request is the recipe's images + n), so the request and the history are
 * renumbered to the tray here; the job keeps the customer's own words.
 */
/** A job's stored marks as the prompt writer reads them: numbered from 1 in the order they were sent. */
export function enhanceMarks(stored: NonNullable<StudioJobParams['revision']>['marks']): NonNullable<NonNullable<EnhanceInput['revision']>['marks']> {
  return (Array.isArray(stored) ? stored : []).map((m, i) => ({
    n: i + 1,
    time: m.time,
    what: m.what ?? null,
    x: m.x,
    y: m.y,
    ...(m.w !== undefined && m.h !== undefined ? { w: m.w, h: m.h } : {}),
    label: m.label ?? null,
  }));
}

export async function revisionInput(
  deps: Pick<StudioDeps, 'sql'>,
  job: Pick<JobRow, 'organization_id' | 'prompt' | 'params' | 'refs'>,
  resolved: readonly ResolvedRef[],
): Promise<{ revision: NonNullable<EnhanceInput['revision']>; prompt: string } | null> {
  const r = job.params?.revision;
  if (!r) return null;
  try {
    const base = (
      await deps.sql.query<JobRow>('select * from brand_studio_jobs where id = $1 and organization_id = $2', [r.baseJobId, job.organization_id])
    ).rows[0];
    if (!base) return null;
    const chain = await revisionChain(deps.sql, job.organization_id, base);
    const locale = job.params.locale ?? 'ko';
    const marks = enhanceMarks(r.marks);
    const clarified = clarifiedOf(r);
    // Earlier requests pointed at their own marks: those are written out here, so only this request's
    // ①②③ reach the prompt writer, with `marks` beside them. An earlier answer follows its request.
    const earlier = chain.history.map((h) => ({ ...h, request: withClarified(replaceMarks(h.request, h.marks ?? []), h.clarified) }));
    // Made from the revise conversation: the settled sheet and the run's exact length go to the writer.
    const dialogue = r.dialogue
      ? {
          sheet: { change: r.dialogue.sheet.change.map((c) => c.text), keep: [...r.dialogue.sheet.keep], exclude: [...r.dialogue.sheet.exclude] },
          seconds: r.mode === 'edit' ? null : (job.params?.seconds ?? null),
        }
      : null;
    const extra = { ...(marks.length ? { marks } : {}), ...(clarified ? { clarified } : {}), ...(dialogue ?? {}) };
    if (r.mode === 'edit') {
      return {
        revision: { mode: 'edit', version: r.version, madeWith: chain.madeWith, history: earlier.map((h) => h.request), ...extra },
        prompt: job.prompt,
      };
    }
    const tray = new Map<string, number>();
    let images = 0;
    for (const ref of resolved) {
      if (ref.kind !== 'image') continue;
      images += 1;
      const own = job.refs?.[ref.index - 1];
      if (own && !tray.has(refKey(own))) tray.set(refKey(own), images);
    }
    return {
      revision: {
        mode: 'reshoot',
        version: r.version,
        madeWith: chain.madeWith,
        history: earlier.map((h) => renumberRequest(h.request, h.added, tray, locale)),
        ...extra,
        // The answer names pictures the way the request does, so it is renumbered with it.
        ...(clarified ? { clarified: { ...clarified, answer: renumberRequest(clarified.answer, addedRefsOf(job), tray, locale) } } : {}),
        // So do the sheet's changes.
        ...(dialogue ? { sheet: { ...dialogue.sheet, change: dialogue.sheet.change.map((c) => renumberRequest(c, addedRefsOf(job), tray, locale)) } } : {}),
      },
      prompt: renumberRequest(job.prompt, addedRefsOf(job), tray, locale),
    };
  } catch {
    return null;
  }
}

/**
 * What the material attached to a revision shows, read for its request (lib/brand-studio/revision/
 * material.ts). Material that is gone or cannot be read is left out: the revision goes on without it.
 */
export async function materialNotes(
  deps: Pick<StudioDeps, 'sql' | 'media' | 'env' | 'intel' | 'intelDeps'>,
  job: Pick<JobRow, 'organization_id' | 'prompt' | 'params'>,
  madeWith: string,
): Promise<NonNullable<NonNullable<EnhanceInput['revision']>['materials']>> {
  const stored = job.params?.revision?.materials ?? [];
  const read = deps.intel.readMaterial;
  if (!stored.length || !read) return [];
  const request = replaceMarks(job.prompt, job.params?.revision?.marks ?? []);
  const notes = await Promise.all(
    stored.map(async (material) => {
      try {
        const [ref] = await resolveReferences(deps.sql, job.organization_id, [material], deps.media, job.params.locale ?? 'ko');
        if (!ref || ref.kind !== 'video') return null;
        const video =
          deps.media.kind === 'r2'
            ? { url: providerUrl(deps, ref.url) }
            : { bytes: await deps.media.read(ref.key), mime: ref.key.endsWith('.mov') ? 'video/quicktime' : 'video/mp4' };
        return await read({ video, request, madeWith }, deps.intelDeps);
      } catch {
        return null;
      }
    }),
  );
  return notes.flatMap((text) => (text ? [text] : [])).map((text, i) => ({ n: i + 1, kind: 'video' as const, notes: text }));
}

export async function prepareJob(deps: StudioDeps, job: JobRow): Promise<{ finalPrompt: string | null; work: StudioJobWork }> {
  // Music has no references: its Prompt Architect designs the request (docs/BRAND-SOUND-STUDIO.md §12.2).
  if (job.kind === 'music') return prepareMusic(deps, job);
  const model = studioModel(job.model);
  if (!model) throw new PrepareFailure('failed', `unknown model ${job.model}`);
  const locale = job.params?.locale ?? 'ko';
  let resolved: ResolvedRef[];
  try {
    resolved = await resolveReferences(deps.sql, job.organization_id, job.refs ?? [], deps.media, locale);
  } catch (error) {
    if (error instanceof StudioDenied) throw new PrepareFailure(error.code, 'a reference is gone');
    throw error;
  }
  const work: StudioJobWork = {
    ...job.work,
    inputs: sentInputs(deps, job, resolved),
  };

  if (job.kind === 'video_final') {
    const draft = (
      await deps.sql.query<{ draft_task_id: string | null; final_prompt: string | null; prompt: string; params: StudioJobParams }>(
        `select o.draft_task_id, j.final_prompt, j.prompt, j.params
           from brand_studio_outputs o join brand_studio_jobs j on j.id = o.job_id
          where o.id = $1 and o.organization_id = $2 and o.status = 'ready'`,
        [job.parent_output_id, job.organization_id],
      )
    ).rows[0];
    if (!draft?.draft_task_id) throw new PrepareFailure('reference_missing', 'the draft is gone');
    // The API lane finishes a draft by its id alone; the account lane's `create_video` also requires a prompt,
    // so the final carries the text its draft was made from (the API lane never reads it).
    return { finalPrompt: sendPrompt(draft) || null, work: { ...work, draftTaskId: draft.draft_task_id, prepared: true } };
  }

  let editCropThumb: EnhanceInput['editCropThumb'] = null;
  let regionWindow: EnhanceInput['regionWindow'] = null;
  if (job.kind === 'region_edit') {
    const source = job.params.source ?? {};
    const row = source.assetId
      ? (await deps.sql.query<{ storage_key: string }>("select storage_key from brand_studio_assets where id = $1 and organization_id = $2 and status = 'ready' and deleted_at is null", [source.assetId, job.organization_id])).rows[0]
      : (await deps.sql.query<{ storage_key: string }>("select storage_key from brand_studio_outputs where id = $1 and organization_id = $2 and status = 'ready' and deleted_at is null", [source.outputId, job.organization_id])).rows[0];
    if (!row?.storage_key || !job.params.box) throw new PrepareFailure('reference_missing', 'the picture to edit is gone');
    const original = await deps.media.read(row.storage_key);
    const size = await imageInfo(original);
    if (!size) throw new PrepareFailure('failed', 'the picture to edit does not decode');
    const planned = await regionEditPlan(deps, original, size, job.params, model as StudioImageModel);
    const { plan, crop } = planned;
    regionWindow = planned.regionWindow;
    const { key: cropKey } = await deps.media.put(crop.bytes, crop.mime);
    editCropThumb = { bytes: crop.bytes, mime: crop.mime };
    work.region = { ...(work.region ?? {}), plan, cropKey, sourceKey: row.storage_key };
  }
  const windowPlan = job.kind === 'region_edit' && job.params.regionWindow ? work.region?.plan ?? null : null;
  // The longest text one run may send, appended lines included (lib/engines/prompt-limits.ts): Seedance 2.5
  // takes 15,000 characters per clip (founder, 2026-11-25); every other engine keeps the previous 8,000 until
  // its provider limit is recorded there. No structural trimmer runs on this path, so a longer text is cut at
  // the limit as the last resort.
  const limit = promptCharLimit(model.id);

  let sheet: FilmSheet | null = null;
  let toEnhance = resolved;
  if (job.kind === 'video_remix' && job.enhance) {
    const remix = await remixContext(deps, { organizationId: job.organization_id, params: job.params, refs: job.refs ?? [], resolved, locale });
    sheet = remix.sheet;
    toEnhance = remix.resolved;
    work.sheet = sheet;
  }

  // A preset run (lib/brand-studio/workflows/presets): its text is assembled here from the server-only original.
  if (job.params?.preset) {
    const text = renderPresetPrompt(job.params.preset);
    if (!text) throw new PrepareFailure('failed', 'unknown preset');
    return { finalPrompt: text, work: { ...work, prepared: true } };
  }

  // Enhancement off: the customer's words go as they are, or the rewritten sentence they already read.
  if (!job.enhance) {
    const words = job.params?.reviewedPrompt?.trim() || null;
    return { finalPrompt: windowPlan ? withSelectionLine(words ?? job.prompt, windowPlan, limit) : words, work: { ...work, prepared: true } };
  }
  const organization = (await deps.sql.query<{ name: string }>('select name from brand_organizations where id = $1', [job.organization_id])).rows[0];
  const history = await revisionInput(deps, job, resolved);
  // A blueprint never sends its video: the reading, the customer's table or (a reshoot) the earlier prompt it
  // remakes is all that carries the reference. With none of them the run would ignore the reference, so it is
  // not made; a failed run settles at nothing (finish.ts `failJob`).
  if (job.kind === 'video_remix' && job.params?.method === 'blueprint' && !sheet && !history) {
    throw new PrepareFailure('reference_unreadable', 'the reference video could not be read');
  }
  const materials = history ? await materialNotes(deps, job, history.revision.madeWith) : [];
  const revised = history && materials.length ? { ...history, revision: { ...history.revision, materials } } : history;
  // Without the clip's history the marks and the answer cannot travel as context: their words go into the request.
  const loose = job.params?.revision;
  const stillMarked =
    !revised && loose && (loose.marks?.length || clarifiedOf(loose))
      ? withClarified(loose.marks?.length ? replaceMarks(job.prompt, loose.marks) : job.prompt, clarifiedOf(loose))
      : null;
  const input = enhanceInputOf(
    revised ? { ...job, prompt: revised.prompt } : stillMarked !== null ? { ...job, prompt: stillMarked } : job,
    model,
    await enhanceReferences(deps, toEnhance),
    await brandSummary(deps, job.organization_id, organization?.name ?? ''),
    sheet,
    editCropThumb,
    revised?.revision ?? null,
    regionWindow,
  );
  const result = await runEnhancer({ ...deps, organizationId: job.organization_id }, input);
  const finalPrompt = windowPlan ? withSelectionLine(result.prompt, windowPlan, limit) : result.prompt.slice(0, limit);
  // Which rules wrote the prompt (profile version, writer, fallback, skin rules): internal, never shown.
  const enhancer = result.meta ?? enhanceMeta(input, result.source, { env: deps.intelDeps.env });
  return { finalPrompt, work: { ...work, enhanceNotes: result.notes.slice(0, 2000), enhancer, prepared: true } };
}
