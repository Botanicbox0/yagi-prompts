/**
 * Getting a queued job ready to send (docs/BRAND-STUDIO-V2.md §8): resolve the references again (a
 * deleted one fails the job here, not at the provider), read a reference film, cut the region-edit
 * crop, and run the prompt enhancer. Enhancement never blocks a run: a model failure falls back to the
 * deterministic composer, and a composer failure sends the customer's own words.
 */
import { confirmedIdentityFor } from '@/lib/brands/identity/service';
import type { FilmDepth, FilmSheet, FilmShot, StudioErrorCode, StudioReference } from './contracts';
import { extractStoredFilmSheet, isFilmSheetExpired, readCachedFilmSheet, writeCachedFilmSheet } from './film-sheet';
import { imageInfo } from './files';
import { studioModel, type StudioImageModel, type StudioModel } from './models';
import { resolveReferences, type ResolvedRef } from './plan';
import { StudioDenied } from './access';
import type { EnhanceInput, EnhanceResult, JobRow, StudioDeps, StudioJobParams, StudioJobWork } from './types';

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

/** Inputs as sent to the provider (and to the account-lane worker): a blueprint leaves its video out. */
export function sentInputs(deps: Pick<StudioDeps, 'env'>, job: Pick<JobRow, 'kind' | 'params'>, resolved: readonly ResolvedRef[]): NonNullable<StudioJobWork['inputs']> {
  const blueprint = job.kind === 'video_remix' && job.params?.method === 'blueprint';
  return resolved
    .filter((r) => !(blueprint && r.kind === 'video'))
    .map((r) => ({ kind: r.kind, url: providerUrl(deps, r.url), ...(r.frame ? { frame: r.frame } : {}) }));
}

export function enhanceKind(kind: JobRow['kind']): EnhanceInput['kind'] | null {
  return kind === 'video_final' ? null : kind;
}

export function enhanceInputOf(
  job: Pick<JobRow, 'kind' | 'prompt' | 'params'>,
  model: StudioModel,
  references: EnhanceInput['references'],
  brand: EnhanceInput['brand'],
  sheet: FilmSheet | null,
  editCropThumb?: EnhanceInput['editCropThumb'],
): EnhanceInput {
  const p = job.params;
  const kind = enhanceKind(job.kind) ?? 'image';
  const video = kind === 'video' || kind === 'video_remix';
  return {
    kind,
    profile: model.promptProfile,
    locale: p.locale ?? 'ko',
    prompt: job.prompt,
    references,
    brand,
    ...(editCropThumb ? { editCropThumb } : {}),
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

export async function prepareJob(deps: StudioDeps, job: JobRow): Promise<{ finalPrompt: string | null; work: StudioJobWork }> {
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
      await deps.sql.query<{ draft_task_id: string | null }>(
        "select draft_task_id from brand_studio_outputs where id = $1 and organization_id = $2 and status = 'ready'",
        [job.parent_output_id, job.organization_id],
      )
    ).rows[0];
    if (!draft?.draft_task_id) throw new PrepareFailure('reference_missing', 'the draft is gone');
    return { finalPrompt: null, work: { ...work, draftTaskId: draft.draft_task_id, prepared: true } };
  }

  let editCropThumb: EnhanceInput['editCropThumb'] = null;
  if (job.kind === 'region_edit') {
    const source = job.params.source ?? {};
    const row = source.assetId
      ? (await deps.sql.query<{ storage_key: string }>("select storage_key from brand_studio_assets where id = $1 and organization_id = $2 and status = 'ready' and deleted_at is null", [source.assetId, job.organization_id])).rows[0]
      : (await deps.sql.query<{ storage_key: string }>("select storage_key from brand_studio_outputs where id = $1 and organization_id = $2 and status = 'ready' and deleted_at is null", [source.outputId, job.organization_id])).rows[0];
    if (!row?.storage_key || !job.params.box) throw new PrepareFailure('reference_missing', 'the picture to edit is gone');
    const original = await deps.media.read(row.storage_key);
    const size = await imageInfo(original);
    if (!size) throw new PrepareFailure('failed', 'the picture to edit does not decode');
    const plan = deps.intel.planRegion(size, job.params.box, (model as StudioImageModel).aspects);
    const crop = await deps.intel.cropForEdit(original, plan);
    const { key: cropKey } = await deps.media.put(crop.bytes, crop.mime);
    editCropThumb = { bytes: crop.bytes, mime: crop.mime };
    work.region = { ...(work.region ?? {}), plan, cropKey, sourceKey: row.storage_key };
  }

  let sheet: FilmSheet | null = null;
  let toEnhance = resolved;
  if (job.kind === 'video_remix' && job.enhance) {
    const remix = await remixContext(deps, { organizationId: job.organization_id, params: job.params, refs: job.refs ?? [], resolved, locale });
    sheet = remix.sheet;
    toEnhance = remix.resolved;
    work.sheet = sheet;
  }

  if (!job.enhance) return { finalPrompt: null, work: { ...work, prepared: true } };
  const organization = (await deps.sql.query<{ name: string }>('select name from brand_organizations where id = $1', [job.organization_id])).rows[0];
  const input = enhanceInputOf(
    job,
    model,
    await enhanceReferences(deps, toEnhance),
    await brandSummary(deps, job.organization_id, organization?.name ?? ''),
    sheet,
    editCropThumb,
  );
  const result = await runEnhancer({ ...deps, organizationId: job.organization_id }, input);
  return { finalPrompt: result.prompt.slice(0, 8000), work: { ...work, enhanceNotes: result.notes.slice(0, 2000), prepared: true } };
}
