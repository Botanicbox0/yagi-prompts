/**
 * Server-persisted `영상 스튜디오` projects (`docs/STUDIO-PRO-SUITE-V4.md` §1.4).
 *
 * Security chain, identical to every Brand Studio route:
 *   1. `studioSeat(tx, viewer.userId, organizationId, { requireSelfStudio: true })`
 *      -> membership -> Morphic/sandbox hardline (`404`) -> `generative_media` + `self_studio` (`404`)
 *   2. Reject campaign-only room guests (`404`)
 *   3. `requireCreate(seat)` on mutations (`owner` / `editor`; `viewer` -> `403`)
 */
import type { SqlRunner } from '@/lib/db/sql-runner';
import { lockOrganization, requireCreate, StudioDenied, studioSeat } from '@/lib/brand-studio/access';
import { brandProjectFiling, brandProjectForNew, withFilmBrandProjects } from '@/lib/brand-studio/brand-projects';
import {
  clamp,
  COMPOSE_ASPECTS,
  emptyComposerProject,
  extractProjectReferencedAssetIds,
  MAX_COMPOSE_CAPTIONS,
  MAX_COMPOSE_CLIPS,
  MAX_COMPOSE_OVERLAYS,
  MAX_COMPOSE_SFX,
  normalizeClipBounds,
  normalizeColorGradeState,
  normalizeOverlayClip,
  normalizeSfxClip,
  normalizeTakeBounds,
  projectDurationSec,
  type ComposeAspect,
  type ComposeCaption,
  type ComposeClip,
  type ComposeColorGradeState,
  type ComposeOverlayClip,
  type ComposerProject,
  type ComposeSfxClip,
  type TimelineClipTake,
} from '@/lib/brand-studio/compose/timeline';
import type { StudioMediaStore } from '@/lib/brand-studio/media-store';
import { readyAsset } from '@/lib/brand-studio/repo';
import { placeBgm, placeSfx, type SoundSendTrack } from '@/lib/brand-studio/sound/send';
import { trackDisplayName } from '@/lib/brand-studio/sound/library';
import { assertBrandFeature, BrandFeatureDenied } from '@/lib/brands/entitlements';
import { brandSoundStudioOpen } from '@/lib/flags';
import {
  VIDEO_PROJECT_OPERATIONS,
  VIDEO_PROJECT_STATUSES,
  type VideoProjectDetail,
  type VideoProjectListResult,
  type VideoProjectMutationResult,
  type VideoProjectOperation,
  type VideoProjectStatus,
  type VideoProjectSummary,
} from './contracts';

export interface VideoProjectsDeps {
  sql: SqlRunner;
  media: StudioMediaStore;
}

const listedColumn = (alias: string | undefined, name: string): string => (alias ? `${alias}.${name}` : name);

/**
 * A film the films' list shows (`loadVideoProjects`): not deleted, active or completed (archived ones are not
 * listed). The assets page counts and pages films by this same rule (lib/brand-studio/brand-project-files.ts).
 */
export const LISTED_FILMS = (alias?: string): string =>
  `${listedColumn(alias, 'deleted_at')} is null and ${listedColumn(alias, 'status')} in ('active', 'completed')`;

export interface VideoProjectViewer {
  userId: string | null;
}

interface VideoProjectRow {
  id: string;
  organization_id: string;
  title: string;
  status: VideoProjectStatus;
  aspect: ComposeAspect;
  timeline: unknown;
  revision: number | string;
  created_by: string | null;
  request_id: string;
  completed_at: Date | string | null;
  deleted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  /** Migration 0194 (the brand project spine); absent before it is applied. */
  brand_project_id?: string | null;
}

interface MediaKeyRow {
  id: string;
  storage_key: string | null;
  thumb_key: string | null;
  duration_ms: number | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TITLE_MAX = 120;
const REQ_ID_MAX = 120;

function iso(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
}

function secondsFromMs(ms: number | null | undefined): number | null {
  if (ms == null || !Number.isFinite(Number(ms)) || Number(ms) <= 0) return null;
  return Math.round(Number(ms) / 100) / 10;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isComposeAspect(value: unknown): value is ComposeAspect {
  return typeof value === 'string' && (COMPOSE_ASPECTS as readonly string[]).includes(value);
}

function isVideoProjectStatus(value: unknown): value is VideoProjectStatus {
  return typeof value === 'string' && (VIDEO_PROJECT_STATUSES as readonly string[]).includes(value);
}

export function deriveVideoProjectTitle(input: {
  title?: unknown;
  firstPrompt?: unknown;
  timeline?: Partial<ComposerProject> | null;
  locale?: unknown;
}): string {
  const cleanCandidate = (raw: string, maxLen = TITLE_MAX): string => {
    const collapsed = raw
      .replace(/@(?:image|video|audio)\d+\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!collapsed) return '';
    return collapsed.slice(0, maxLen).trim();
  };

  if (typeof input.title === 'string') {
    const explicit = input.title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX).trim();
    if (explicit.length >= 1) return explicit;
  }

  if (typeof input.firstPrompt === 'string') {
    const fromPrompt = cleanCandidate(input.firstPrompt, 48);
    if (fromPrompt.length >= 1) return fromPrompt;
  }

  const firstClipLabel = input.timeline?.clips?.[0]?.label;
  if (typeof firstClipLabel === 'string') {
    const fromClip = cleanCandidate(firstClipLabel, 48);
    if (fromClip.length >= 1) return fromClip;
  }

  return input.locale === 'en' ? 'New project' : '새 프로젝트';
}

export function normalizeStoredTimeline(raw: unknown, fallbackAspect: ComposeAspect = '9:16'): ComposerProject {
  const parsed =
    typeof raw === 'string'
      ? (() => {
          try {
            return JSON.parse(raw) as Record<string, unknown>;
          } catch {
            return null;
          }
        })()
      : raw && typeof raw === 'object'
        ? (raw as Record<string, unknown>)
        : null;

  if (!parsed) return emptyComposerProject(fallbackAspect);

  const aspect: ComposeAspect = isComposeAspect(parsed.aspect) ? parsed.aspect : fallbackAspect;

  const rawClips = Array.isArray(parsed.clips) ? parsed.clips : [];
  const clips: ComposeClip[] = [];
  for (const item of rawClips) {
    if (clips.length >= MAX_COMPOSE_CLIPS) break;
    if (!item || typeof item !== 'object') continue;
    const c = item as Partial<ComposeClip>;
    if (typeof c.id !== 'string' || !c.id.trim()) continue;
    const hasAsset = typeof c.assetId === 'string' && UUID.test(c.assetId);
    const hasOutput = typeof c.outputId === 'string' && UUID.test(c.outputId);
    const rawSrc = typeof c.srcUrl === 'string' && !c.srcUrl.startsWith('blob:') ? c.srcUrl : '';
    if (!hasAsset && !hasOutput && !rawSrc) continue;

    const rawTakes = Array.isArray(c.takes) ? c.takes : [];
    const takes: TimelineClipTake[] = [];
    for (const tItem of rawTakes) {
      if (!tItem || typeof tItem !== 'object') continue;
      const t = tItem as Partial<TimelineClipTake>;
      if (typeof t.id !== 'string' || !t.id.trim()) continue;
      const takeHasAsset = typeof t.assetId === 'string' && UUID.test(t.assetId);
      const takeHasOutput = typeof t.outputId === 'string' && UUID.test(t.outputId);
      const takeSrc = typeof t.srcUrl === 'string' && !t.srcUrl.startsWith('blob:') ? t.srcUrl : '';
      if (!takeHasAsset && !takeHasOutput && !takeSrc) continue;
      takes.push(
        normalizeTakeBounds({
          id: t.id.trim(),
          label: typeof t.label === 'string' && t.label.trim() ? t.label.trim().slice(0, 120) : 'Clip',
          sourceKind: t.sourceKind === 'output' || t.sourceKind === 'asset' ? t.sourceKind : takeHasOutput ? 'output' : 'asset',
          ...(takeHasOutput ? { outputId: t.outputId!.trim() } : {}),
          ...(takeHasAsset ? { assetId: t.assetId!.trim() } : {}),
          srcUrl: takeSrc,
          thumbUrl: typeof t.thumbUrl === 'string' && !t.thumbUrl.startsWith('blob:') ? t.thumbUrl : null,
          durationSec: typeof t.durationSec === 'number' && Number.isFinite(t.durationSec) ? t.durationSec : 5,
          trimStartSec: typeof t.trimStartSec === 'number' && Number.isFinite(t.trimStartSec) ? t.trimStartSec : 0,
          trimEndSec:
            typeof t.trimEndSec === 'number' && Number.isFinite(t.trimEndSec)
              ? t.trimEndSec
              : typeof t.durationSec === 'number' && Number.isFinite(t.durationSec)
                ? t.durationSec
                : 5,
          ...(typeof t.createdAt === 'string' ? { createdAt: t.createdAt } : {}),
        }),
      );
    }

    const durationSec = typeof c.durationSec === 'number' && Number.isFinite(c.durationSec) ? c.durationSec : 5;
    // Speed, J/L offset and incoming transition: only readable values pass; `normalizeClipBounds`
    // clamps them and omits the neutral ones (rate 1, offset 0, no transition).
    const playbackRate = finiteNumber(c.playbackRate);
    const audioOffsetSec = finiteNumber(c.audioOffsetSec);
    const transitionIn =
      c.transitionIn === 'cross_dissolve' || c.transitionIn === 'dip_to_black' ? c.transitionIn : undefined;
    const transitionDurationSec = transitionIn ? finiteNumber(c.transitionDurationSec) : undefined;
    clips.push(
      normalizeClipBounds({
        id: c.id.trim(),
        label: typeof c.label === 'string' && c.label.trim() ? c.label.trim().slice(0, 120) : 'Clip',
        sourceKind: c.sourceKind === 'output' || c.sourceKind === 'asset' ? c.sourceKind : hasOutput ? 'output' : 'asset',
        ...(hasAsset ? { assetId: c.assetId!.trim() } : {}),
        ...(hasOutput ? { outputId: c.outputId!.trim() } : {}),
        srcUrl: rawSrc,
        thumbUrl: typeof c.thumbUrl === 'string' && !c.thumbUrl.startsWith('blob:') ? c.thumbUrl : null,
        durationSec,
        trimStartSec: typeof c.trimStartSec === 'number' && Number.isFinite(c.trimStartSec) ? c.trimStartSec : 0,
        trimEndSec: typeof c.trimEndSec === 'number' && Number.isFinite(c.trimEndSec) ? c.trimEndSec : durationSec,
        volume: typeof c.volume === 'number' && Number.isFinite(c.volume) ? c.volume : 1,
        muted: Boolean(c.muted),
        ...(playbackRate !== undefined ? { playbackRate } : {}),
        ...(audioOffsetSec !== undefined ? { audioOffsetSec } : {}),
        ...(transitionIn
          ? { transitionIn, ...(transitionDurationSec !== undefined ? { transitionDurationSec } : {}) }
          : {}),
        ...(Array.isArray(c.cutMarkers) ? { cutMarkers: c.cutMarkers } : {}),
        ...(takes.length > 0
          ? {
              takes,
              activeTakeIndex: typeof c.activeTakeIndex === 'number' ? c.activeTakeIndex : takes.length - 1,
            }
          : {}),
      }),
    );
  }

  const rawCaptions = Array.isArray(parsed.captions) ? parsed.captions : [];
  const captions: ComposeCaption[] = rawCaptions
    .filter(
      (c): c is ComposeCaption =>
        Boolean(c) &&
        typeof c === 'object' &&
        typeof (c as ComposeCaption).id === 'string' &&
        typeof (c as ComposeCaption).text === 'string' &&
        typeof (c as ComposeCaption).startSec === 'number' &&
        typeof (c as ComposeCaption).endSec === 'number',
    )
    .slice(0, MAX_COMPOSE_CAPTIONS)
    .map((c) => ({
      id: c.id,
      text: c.text.slice(0, 120),
      startSec: Math.max(0, c.startSec),
      endSec: Math.max(c.startSec + 0.3, c.endSec),
      position: c.position === 'top' || c.position === 'center' ? c.position : 'bottom',
      size: c.size === 'sm' || c.size === 'lg' ? c.size : 'md',
    }));

  let bgm: ComposerProject['bgm'] = null;
  if (parsed.bgm && typeof parsed.bgm === 'object') {
    const rawBgm = parsed.bgm as NonNullable<ComposerProject['bgm']>;
    const bgmHasAsset = typeof rawBgm.assetId === 'string' && UUID.test(rawBgm.assetId);
    const bgmSrc = typeof rawBgm.srcUrl === 'string' && !rawBgm.srcUrl.startsWith('blob:') ? rawBgm.srcUrl : '';
    if (bgmHasAsset || bgmSrc) {
      const dur = Math.max(0.5, Number.isFinite(Number(rawBgm.durationSec)) ? Number(rawBgm.durationSec) : 15);
      bgm = {
        label: typeof rawBgm.label === 'string' && rawBgm.label.trim() ? rawBgm.label.trim().slice(0, 120) : 'Music',
        sourceKind: 'asset',
        ...(bgmHasAsset ? { assetId: rawBgm.assetId!.trim() } : {}),
        srcUrl: bgmSrc,
        durationSec: dur,
        trimStartSec: clamp(Number(rawBgm.trimStartSec ?? 0), 0, Math.max(0, dur - 0.5)),
        volume: clamp(Number(rawBgm.volume ?? 0.5), 0, 1),
        ...(rawBgm.nonCommercialGuide ? { nonCommercialGuide: true } : {}),
        ...(typeof rawBgm.dropSyncSec === 'number' && Number.isFinite(rawBgm.dropSyncSec)
          ? { dropSyncSec: rawBgm.dropSyncSec }
          : {}),
      };
    }
  }

  let colorGrade: ComposeColorGradeState | null = null;
  if (parsed.colorGrade && typeof parsed.colorGrade === 'object') {
    const rawGrade = parsed.colorGrade as ComposeColorGradeState;
    colorGrade = normalizeColorGradeState({
      ...rawGrade,
      referenceUrl:
        typeof rawGrade.referenceUrl === 'string' && !rawGrade.referenceUrl.startsWith('blob:')
          ? rawGrade.referenceUrl
          : null,
    });
  }

  // Overlay (V2) track: same source rule as clips — a `blob:` URL never persists, an item needs an
  // asset id, an output id or a non-blob URL, and the browser-only `local` kind becomes `asset`/`output`.
  const rawOverlays = Array.isArray(parsed.overlays) ? parsed.overlays : [];
  const overlays: ComposeOverlayClip[] = [];
  for (const item of rawOverlays) {
    if (overlays.length >= MAX_COMPOSE_OVERLAYS) break;
    if (!item || typeof item !== 'object') continue;
    const o = item as Partial<ComposeOverlayClip>;
    if (typeof o.id !== 'string' || !o.id.trim()) continue;
    if (o.mediaKind !== 'image' && o.mediaKind !== 'video') continue;
    const startSec = finiteNumber(o.startSec);
    const endSec = finiteNumber(o.endSec);
    if (startSec === undefined || endSec === undefined) continue;
    const hasAsset = typeof o.assetId === 'string' && UUID.test(o.assetId);
    const hasOutput = typeof o.outputId === 'string' && UUID.test(o.outputId);
    const rawSrc = typeof o.srcUrl === 'string' && !o.srcUrl.startsWith('blob:') ? o.srcUrl : '';
    if (!hasAsset && !hasOutput && !rawSrc) continue;
    overlays.push(
      normalizeOverlayClip({
        id: o.id.trim(),
        label: typeof o.label === 'string' ? o.label : '',
        sourceKind: o.sourceKind === 'output' || o.sourceKind === 'asset' ? o.sourceKind : hasOutput ? 'output' : 'asset',
        ...(hasAsset ? { assetId: o.assetId!.trim() } : {}),
        ...(hasOutput ? { outputId: o.outputId!.trim() } : {}),
        srcUrl: rawSrc,
        thumbUrl: typeof o.thumbUrl === 'string' && !o.thumbUrl.startsWith('blob:') ? o.thumbUrl : null,
        mediaKind: o.mediaKind,
        startSec,
        endSec,
        x: finiteNumber(o.x) ?? 0.5,
        y: finiteNumber(o.y) ?? 0.5,
        scale: finiteNumber(o.scale) ?? 0.45,
        opacity: finiteNumber(o.opacity) ?? 1,
      }),
    );
  }

  // Sound-effect (A2) track: same source rule as BGM — stored as `asset`, needs an asset id or a non-blob URL.
  const rawSfx = Array.isArray(parsed.sfxClips) ? parsed.sfxClips : [];
  const sfxClips: ComposeSfxClip[] = [];
  for (const item of rawSfx) {
    if (sfxClips.length >= MAX_COMPOSE_SFX) break;
    if (!item || typeof item !== 'object') continue;
    const s = item as Partial<ComposeSfxClip>;
    if (typeof s.id !== 'string' || !s.id.trim()) continue;
    const startSec = finiteNumber(s.startSec);
    const sfxDurationSec = finiteNumber(s.durationSec);
    if (startSec === undefined || sfxDurationSec === undefined) continue;
    const sfxHasAsset = typeof s.assetId === 'string' && UUID.test(s.assetId);
    const sfxSrc = typeof s.srcUrl === 'string' && !s.srcUrl.startsWith('blob:') ? s.srcUrl : '';
    if (!sfxHasAsset && !sfxSrc) continue;
    sfxClips.push(
      normalizeSfxClip({
        id: s.id.trim(),
        label: typeof s.label === 'string' ? s.label : '',
        sourceKind: 'asset',
        ...(sfxHasAsset ? { assetId: s.assetId!.trim() } : {}),
        srcUrl: sfxSrc,
        startSec,
        durationSec: sfxDurationSec,
        volume: finiteNumber(s.volume) ?? 0.85,
      }),
    );
  }

  const referenceAssetIds = Array.isArray(parsed.referenceAssetIds)
    ? [...new Set(parsed.referenceAssetIds.filter((id): id is string => typeof id === 'string' && UUID.test(id.trim())).map((id) => id.trim()))]
    : [];

  return {
    version: 1,
    aspect,
    clips,
    captions,
    bgm,
    colorGrade,
    ...(overlays.length > 0 ? { overlays } : {}),
    ...(sfxClips.length > 0 ? { sfxClips } : {}),
    ...(referenceAssetIds.length > 0 ? { referenceAssetIds } : {}),
  };
}

export function collectMediaRefs(timelines: readonly ComposerProject[]): { assetIds: string[]; outputIds: string[] } {
  const assetIds = new Set<string>();
  const outputIds = new Set<string>();
  const addAsset = (id: unknown) => {
    if (typeof id === 'string' && UUID.test(id)) assetIds.add(id);
  };
  const addOutput = (id: unknown) => {
    if (typeof id === 'string' && UUID.test(id)) outputIds.add(id);
  };
  for (const timeline of timelines) {
    for (const clip of timeline.clips) {
      addAsset(clip.assetId);
      addOutput(clip.outputId);
      if (clip.takes) {
        for (const take of clip.takes) {
          addAsset(take.assetId);
          addOutput(take.outputId);
        }
      }
    }
    if (timeline.bgm) addAsset(timeline.bgm.assetId);
    if (timeline.colorGrade) {
      addAsset(timeline.colorGrade.referenceAssetId);
      addOutput(timeline.colorGrade.referenceOutputId);
    }
    for (const overlay of timeline.overlays ?? []) {
      addAsset(overlay.assetId);
      addOutput(overlay.outputId);
    }
    for (const sfx of timeline.sfxClips ?? []) {
      addAsset(sfx.assetId);
    }
  }
  return { assetIds: [...assetIds], outputIds: [...outputIds] };
}

async function fetchMediaMaps(
  sql: SqlRunner,
  media: StudioMediaStore,
  organizationId: string,
  refs: { assetIds: string[]; outputIds: string[] },
): Promise<{
  assets: Map<string, { srcUrl: string; thumbUrl: string | null; durationSec: number | null }>;
  outputs: Map<string, { srcUrl: string; thumbUrl: string | null; durationSec: number | null }>;
}> {
  const assets = new Map<string, { srcUrl: string; thumbUrl: string | null; durationSec: number | null }>();
  const outputs = new Map<string, { srcUrl: string; thumbUrl: string | null; durationSec: number | null }>();

  if (refs.assetIds.length > 0) {
    const rows = (
      await sql.query<MediaKeyRow>(
        `select id, storage_key, thumb_key, duration_ms
           from brand_studio_assets
          where organization_id = $1
            and id = any($2::uuid[])
            and deleted_at is null`,
        [organizationId, refs.assetIds],
      )
    ).rows;
    for (const row of rows) {
      if (!row.storage_key) continue;
      assets.set(row.id, {
        srcUrl: media.url(row.storage_key),
        thumbUrl: row.thumb_key ? media.url(row.thumb_key) : null,
        durationSec: secondsFromMs(row.duration_ms),
      });
    }
  }

  if (refs.outputIds.length > 0) {
    const rows = (
      await sql.query<MediaKeyRow>(
        `select id, storage_key, thumb_key, duration_ms
           from brand_studio_outputs
          where organization_id = $1
            and id = any($2::uuid[])
            and deleted_at is null
            and storage_key is not null`,
        [organizationId, refs.outputIds],
      )
    ).rows;
    for (const row of rows) {
      if (!row.storage_key) continue;
      outputs.set(row.id, {
        srcUrl: media.url(row.storage_key),
        thumbUrl: row.thumb_key ? media.url(row.thumb_key) : null,
        durationSec: secondsFromMs(row.duration_ms),
      });
    }
  }

  return { assets, outputs };
}

function hydrateTimelineWithMaps(
  timeline: ComposerProject,
  maps: {
    assets: Map<string, { srcUrl: string; thumbUrl: string | null; durationSec: number | null }>;
    outputs: Map<string, { srcUrl: string; thumbUrl: string | null; durationSec: number | null }>;
  },
): ComposerProject {
  const resolveRef = (assetId?: string, outputId?: string) => {
    if (outputId && maps.outputs.has(outputId)) return maps.outputs.get(outputId)!;
    if (assetId && maps.assets.has(assetId)) return maps.assets.get(assetId)!;
    return null;
  };

  const clips = timeline.clips.map((clip) => {
    const hydratedTakes = clip.takes?.map((take) => {
      const resolved = resolveRef(take.assetId, take.outputId);
      if (!resolved) return take;
      return normalizeTakeBounds({
        ...take,
        srcUrl: resolved.srcUrl,
        thumbUrl: resolved.thumbUrl ?? take.thumbUrl ?? null,
      });
    });

    const activeTake =
      hydratedTakes && hydratedTakes.length > 0
        ? hydratedTakes[clamp(clip.activeTakeIndex ?? hydratedTakes.length - 1, 0, hydratedTakes.length - 1)]
        : null;

    const resolvedClip = activeTake
      ? resolveRef(activeTake.assetId, activeTake.outputId)
      : resolveRef(clip.assetId, clip.outputId);

    return normalizeClipBounds({
      ...clip,
      srcUrl: resolvedClip?.srcUrl ?? activeTake?.srcUrl ?? clip.srcUrl,
      thumbUrl: resolvedClip?.thumbUrl ?? activeTake?.thumbUrl ?? clip.thumbUrl ?? null,
      ...(hydratedTakes ? { takes: hydratedTakes } : {}),
    });
  });

  let bgm = timeline.bgm;
  if (bgm?.assetId && maps.assets.has(bgm.assetId)) {
    const resolvedBgm = maps.assets.get(bgm.assetId)!;
    bgm = {
      ...bgm,
      srcUrl: resolvedBgm.srcUrl,
    };
  }

  let colorGrade = timeline.colorGrade ?? null;
  if (colorGrade) {
    const resolvedGrade = resolveRef(
      colorGrade.referenceAssetId ?? undefined,
      colorGrade.referenceOutputId ?? undefined,
    );
    if (resolvedGrade) {
      colorGrade = {
        ...colorGrade,
        referenceUrl: resolvedGrade.srcUrl,
      };
    }
  }

  const overlays = timeline.overlays?.map((overlay) => {
    const resolved = resolveRef(overlay.assetId, overlay.outputId);
    if (!resolved) return overlay;
    return {
      ...overlay,
      srcUrl: resolved.srcUrl,
      thumbUrl: resolved.thumbUrl ?? overlay.thumbUrl ?? null,
    };
  });

  const sfxClips = timeline.sfxClips?.map((sfx) => {
    if (!sfx.assetId || !maps.assets.has(sfx.assetId)) return sfx;
    return { ...sfx, srcUrl: maps.assets.get(sfx.assetId)!.srcUrl };
  });

  return {
    ...timeline,
    clips,
    bgm,
    colorGrade,
    ...(overlays ? { overlays } : {}),
    ...(sfxClips ? { sfxClips } : {}),
  };
}

function toSummary(row: VideoProjectRow, hydratedTimeline: ComposerProject): VideoProjectSummary {
  const firstClip = hydratedTimeline.clips[0];
  return {
    id: row.id,
    organizationId: row.organization_id,
    title: row.title,
    status: row.status,
    aspect: row.aspect,
    revision: Number(row.revision),
    clipCount: hydratedTimeline.clips.length,
    durationSec: projectDurationSec(hydratedTimeline),
    thumbUrl: firstClip?.thumbUrl ?? (firstClip?.srcUrl ? firstClip.srcUrl : null),
    completedAt: iso(row.completed_at),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    // Never `brandProjectId` here: it is opt-in (../brand-projects.ts withFilmBrandProjects), members' answers only.
  };
}

/**
 * Summaries of this organization's listed films (`LISTED_FILMS`) among `ids`, in the order of `ids`, built exactly
 * as `loadVideoProjects` builds its list (one media lookup for all). Unknown, deleted or archived ids are left out.
 * No seat check here: the caller has seated the member. Never adds `brandProjectId` (opt-in, `withFilmBrandProjects`).
 */
export async function filmSummariesByIds(
  sql: SqlRunner,
  media: StudioMediaStore,
  organizationId: string,
  ids: readonly string[],
): Promise<VideoProjectSummary[]> {
  if (ids.length === 0) return [];
  const rows = (
    await sql.query<VideoProjectRow>(
      `select * from brand_studio_video_projects where organization_id = $1 and id = any($2::uuid[]) and ${LISTED_FILMS()}`,
      [organizationId, [...ids]],
    )
  ).rows;
  const timelines = new Map(rows.map((row) => [String(row.id).toLowerCase(), normalizeStoredTimeline(row.timeline, row.aspect)]));
  const maps = await fetchMediaMaps(sql, media, organizationId, collectMediaRefs([...timelines.values()]));
  const byId = new Map(rows.map((row) => [String(row.id).toLowerCase(), toSummary(row, hydrateTimelineWithMaps(timelines.get(String(row.id).toLowerCase())!, maps))]));
  return ids.flatMap((id) => {
    const summary = byId.get(id.toLowerCase());
    return summary ? [summary] : [];
  });
}

async function hydrateSingleRow(
  sql: SqlRunner,
  media: StudioMediaStore,
  row: VideoProjectRow,
): Promise<VideoProjectDetail> {
  const normalized = normalizeStoredTimeline(row.timeline, row.aspect);
  const refs = collectMediaRefs([normalized]);
  const maps = await fetchMediaMaps(sql, media, row.organization_id, refs);
  const hydrated = hydrateTimelineWithMaps(normalized, maps);
  return {
    ...toSummary(row, hydrated),
    timeline: hydrated,
  };
}

/**
 * Purges `film_sheets`, `film_sheets_updated_at`, and `film_sheets_expires_at` on `brand_studio_assets`
 * for any asset referenced by `closedTimeline` unless another active (`status = 'active' and deleted_at is null`)
 * video project in the same organization still references that `assetId`.
 */
async function purgeOrphanedShotSheets(
  tx: SqlRunner,
  organizationId: string,
  closedProjectId: string,
  closedTimeline: unknown,
): Promise<string[]> {
  const candidateAssetIds = extractProjectReferencedAssetIds(
    normalizeStoredTimeline(closedTimeline),
  );
  if (candidateAssetIds.length === 0) return [];

  const activeRows = (
    await tx.query<{ timeline: unknown }>(
      `select timeline
         from brand_studio_video_projects
        where organization_id = $1
          and status = 'active'
          and deleted_at is null
          and id <> $2`,
      [organizationId, closedProjectId],
    )
  ).rows;

  const stillReferenced = new Set<string>();
  for (const row of activeRows) {
    for (const id of extractProjectReferencedAssetIds(normalizeStoredTimeline(row.timeline))) {
      stillReferenced.add(id.toLowerCase());
    }
  }

  const purgeTargets = candidateAssetIds.filter((id) => !stillReferenced.has(id.toLowerCase()));
  if (purgeTargets.length === 0) return [];

  const updated = (
    await tx.query<{ id: string }>(
      `update brand_studio_assets
          set film_sheets = null,
              film_sheets_updated_at = null,
              film_sheets_expires_at = null
        where organization_id = $1
          and id = any($2::uuid[])
          and (
            film_sheets is not null
            or film_sheets_updated_at is not null
            or film_sheets_expires_at is not null
          )
        returning id`,
      [organizationId, purgeTargets],
    )
  ).rows;

  return updated.map((r) => r.id);
}

async function assertSelfStudioMember(
  sql: SqlRunner,
  userId: string | null,
  organizationId: string,
) {
  const seat = await studioSeat(sql, userId, organizationId, { requireSelfStudio: true });
  if (seat.role === 'guest') throw new StudioDenied('not_found');
  return seat;
}

export async function loadVideoProjects(
  deps: VideoProjectsDeps,
  viewer: VideoProjectViewer,
  organizationId: string,
  projectId?: string | null,
): Promise<VideoProjectListResult> {
  try {
    const seat = await assertSelfStudioMember(deps.sql, viewer.userId, organizationId);
    if (projectId !== undefined && projectId !== null && projectId !== '' && !UUID.test(projectId)) {
      return { ok: false, code: 'invalid' };
    }

    let listRows: VideoProjectRow[] = [];
    try {
      listRows = (
        await deps.sql.query<VideoProjectRow>(
          `select *
             from brand_studio_video_projects
            where organization_id = $1
              and ${LISTED_FILMS()}
            order by updated_at desc, id desc
            limit 100`,
          [organizationId],
        )
      ).rows;
    } catch (err) {
      if ((err as { code?: string } | null)?.code === '42P01') {
        return {
          ok: true,
          projects: [],
          project: null,
          canCreate: seat.canCreate,
        };
      }
      throw err;
    }

    let targetRow: VideoProjectRow | null = null;
    if (projectId) {
      targetRow =
        listRows.find((r) => r.id === projectId) ??
        (
          await deps.sql.query<VideoProjectRow>(
            `select *
               from brand_studio_video_projects
              where id = $1
                and organization_id = $2
                and deleted_at is null`,
            [projectId, organizationId],
          )
        ).rows[0] ??
        null;
      if (!targetRow) {
        return { ok: false, code: 'not_found' };
      }
    }

    const normalizedByRowId = new Map<string, ComposerProject>();
    for (const row of listRows) {
      normalizedByRowId.set(row.id, normalizeStoredTimeline(row.timeline, row.aspect));
    }
    if (targetRow && !normalizedByRowId.has(targetRow.id)) {
      normalizedByRowId.set(targetRow.id, normalizeStoredTimeline(targetRow.timeline, targetRow.aspect));
    }

    const refs = collectMediaRefs([...normalizedByRowId.values()]);
    const maps = await fetchMediaMaps(deps.sql, deps.media, organizationId, refs);

    const projects: VideoProjectSummary[] = listRows.map((row) => {
      const hydrated = hydrateTimelineWithMaps(normalizedByRowId.get(row.id)!, maps);
      return toSummary(row, hydrated);
    });

    let project: VideoProjectDetail | null = null;
    if (targetRow) {
      const hydrated = hydrateTimelineWithMaps(normalizedByRowId.get(targetRow.id)!, maps);
      project = {
        ...toSummary(targetRow, hydrated),
        timeline: hydrated,
      };
    }

    // Members only reach here (guests and non-members are refused above): the films' brand projects, opt-in.
    return {
      ok: true,
      projects: await withFilmBrandProjects(deps.sql, organizationId, projects),
      project: project ? (await withFilmBrandProjects(deps.sql, organizationId, [project]))[0]! : null,
      canCreate: seat.canCreate,
    };
  } catch (error) {
    if (error instanceof StudioDenied) return { ok: false, code: error.code };
    throw error;
  }
}

/**
 * `bgm.set` / `sfx.add` (docs/BRAND-SOUND-STUDIO.md §7.3). Runs inside the seated transaction, after the
 * membership, hardline, studio policy and role checks; then the `sound` group, then the asset: it must be a
 * ready audio file of this organization (another organization's id answers `not_found`, a picture or film
 * `invalid`). The slot is single: other music already there is replaced only with `replace: true`.
 */
async function placeSound(
  tx: SqlRunner,
  media: StudioMediaStore,
  organizationId: string,
  projectId: string,
  op: 'bgm.set' | 'sfx.add',
  input: Record<string, unknown>,
): Promise<VideoProjectMutationResult> {
  await assertBrandFeature(tx, organizationId, 'sound');
  const assetId = typeof input.assetId === 'string' ? input.assetId : '';
  if (!UUID.test(assetId)) return { ok: false, code: 'invalid' };
  const asset = await readyAsset(tx, organizationId, assetId);
  if (!asset) return { ok: false, code: 'not_found' };
  if (asset.kind !== 'audio') return { ok: false, code: 'invalid' };

  const current = (
    await tx.query<VideoProjectRow>(
      `select *
         from brand_studio_video_projects
        where id = $1
          and organization_id = $2
          and deleted_at is null
        for update`,
      [projectId, organizationId],
    )
  ).rows[0];
  if (!current) return { ok: false, code: 'not_found' };

  const label =
    (typeof input.label === 'string' && input.label.trim() ? input.label.trim() : trackDisplayName(String(asset.name))) ??
    String(asset.name).slice(0, 80);
  const track: SoundSendTrack = {
    assetId,
    label,
    seconds: secondsFromMs(asset.duration_ms),
    srcUrl: media.url(String(asset.storage_key)),
  };
  const timeline = normalizeStoredTimeline(current.timeline, current.aspect);
  let next: ComposerProject;
  if (op === 'bgm.set') {
    const placed = placeBgm(timeline, track, input.replace === true);
    if (placed.status === 'replace_needed') return { ok: false, code: 'conflict', currentBgmLabel: placed.currentLabel };
    next = placed.timeline;
  } else {
    const startSec = finiteNumber(input.startSec) ?? 0;
    const placed = placeSfx(timeline, track, `sfx_${Date.now().toString(36)}_${assetId.slice(0, 8)}`, startSec);
    if (placed.status === 'full') return { ok: false, code: 'invalid', sfxFull: true };
    next = placed.timeline;
  }

  const updated = (
    await tx.query<VideoProjectRow>(
      `update brand_studio_video_projects
          set timeline = $3::jsonb,
              revision = revision + 1,
              updated_at = now()
        where id = $1
          and organization_id = $2
        returning *`,
      [projectId, organizationId, JSON.stringify(next)],
    )
  ).rows[0]!;
  return { ok: true, project: await hydrateSingleRow(tx, media, updated) };
}

export async function runVideoProjectOperation(
  deps: VideoProjectsDeps,
  viewer: VideoProjectViewer,
  rawOp: unknown,
  rawInput: unknown,
): Promise<VideoProjectMutationResult> {
  if (
    typeof rawOp !== 'string' ||
    !(VIDEO_PROJECT_OPERATIONS as readonly string[]).includes(rawOp) ||
    !rawInput ||
    typeof rawInput !== 'object'
  ) {
    return { ok: false, code: 'invalid' };
  }
  const op = rawOp as VideoProjectOperation;
  // The sound studio's two operations do not exist while its flag is off: same answer as an unknown one.
  if ((op === 'bgm.set' || op === 'sfx.add') && !brandSoundStudioOpen()) return { ok: false, code: 'invalid' };
  const input = rawInput as Record<string, unknown>;
  const organizationId = typeof input.organizationId === 'string' ? input.organizationId : '';
  // The brand project spine (../brand-projects.ts), `create` only: closed for the organization, `brandProjectId`
  // is not even read; open, it is judged after the seat, inside the transaction.
  const filing = op === 'create' ? await brandProjectFiling(deps.sql, organizationId, input) : ({ open: false } as const);

  try {
    const result = await deps.sql.transaction(async (tx): Promise<VideoProjectMutationResult> => {
      const seat = await assertSelfStudioMember(tx, viewer.userId, organizationId);
      requireCreate(seat);

      if (op === 'create') {
        const requestId = typeof input.requestId === 'string' ? input.requestId.trim() : '';
        if (!requestId || requestId.length > REQ_ID_MAX) {
          return { ok: false, code: 'invalid' };
        }
        await lockOrganization(tx, organizationId);

        const existing = (
          await tx.query<VideoProjectRow>(
            `select *
               from brand_studio_video_projects
              where organization_id = $1
                and request_id = $2`,
            [organizationId, requestId],
          )
        ).rows[0];
        if (existing && !existing.deleted_at) {
          return {
            ok: true,
            created: false,
            project: await hydrateSingleRow(tx, deps.media, existing),
          };
        }

        const fallbackAspect: ComposeAspect = isComposeAspect(input.aspect) ? input.aspect : '9:16';
        const timeline = normalizeStoredTimeline(input.timeline, fallbackAspect);
        const aspect: ComposeAspect = isComposeAspect(input.aspect) ? input.aspect : timeline.aspect;
        const normalizedTimeline: ComposerProject = { ...timeline, aspect };
        const title = deriveVideoProjectTitle({
          title: input.title,
          firstPrompt: input.firstPrompt,
          timeline: normalizedTimeline,
          locale: input.locale,
        });
        // The spine's project for the new film (a project that cannot take new work is `not_found`).
        const brandProjectId = filing.open
          ? await brandProjectForNew(tx, organizationId, { requested: filing.requested, parentOutputId: null, fill: false })
          : null;

        const made = existing
          ? (
              await tx.query<VideoProjectRow>(
                `update brand_studio_video_projects
                    set title = $3,
                        status = 'active',
                        aspect = $4,
                        timeline = $5::jsonb,
                        revision = revision + 1,
                        completed_at = null,
                        deleted_at = null,
                        updated_at = now()
                  where organization_id = $1
                    and request_id = $2
                  returning *`,
                [organizationId, requestId, title, aspect, JSON.stringify(normalizedTimeline)],
              )
            ).rows[0]!
          : (
              await tx.query<VideoProjectRow>(
                `insert into brand_studio_video_projects
                   (organization_id, title, status, aspect, timeline, revision, created_by, request_id)
                 values ($1, $2, 'active', $3, $4::jsonb, 1, $5, $6)
                 returning *`,
                [organizationId, title, aspect, JSON.stringify(normalizedTimeline), seat.userId, requestId],
              )
            ).rows[0]!;
        // Written apart from the statements above, so they stay exactly as they were; only while open.
        const inserted = filing.open
          ? (
              await tx.query<VideoProjectRow>(
                'update brand_studio_video_projects set brand_project_id = $3 where id = $1 and organization_id = $2 returning *',
                [made.id, organizationId, brandProjectId],
              )
            ).rows[0]!
          : made;

        return {
          ok: true,
          created: true,
          project: await hydrateSingleRow(tx, deps.media, inserted),
        };
      }

      const projectId = typeof input.projectId === 'string' ? input.projectId : '';
      if (!UUID.test(projectId)) {
        return { ok: false, code: 'invalid' };
      }

      if (op === 'bgm.set' || op === 'sfx.add') {
        return await placeSound(tx, deps.media, organizationId, projectId, op, input);
      }

      if (op === 'save') {
        const current = (
          await tx.query<VideoProjectRow>(
            `select *
               from brand_studio_video_projects
              where id = $1
                and organization_id = $2
                and deleted_at is null
              for update`,
            [projectId, organizationId],
          )
        ).rows[0];
        if (!current) return { ok: false, code: 'not_found' };

        if (input.expectedRevision !== undefined && input.expectedRevision !== null) {
          const expected = Number(input.expectedRevision);
          if (!Number.isInteger(expected) || expected < 1) {
            return { ok: false, code: 'invalid' };
          }
          if (Number(current.revision) !== expected) {
            return {
              ok: false,
              code: 'conflict',
              currentRevision: Number(current.revision),
            };
          }
        }

        const nextAspect: ComposeAspect = isComposeAspect(input.aspect)
          ? input.aspect
          : input.timeline && typeof input.timeline === 'object' && isComposeAspect((input.timeline as ComposerProject).aspect)
            ? (input.timeline as ComposerProject).aspect
            : current.aspect;

        const nextTimeline =
          input.timeline !== undefined
            ? { ...normalizeStoredTimeline(input.timeline, nextAspect), aspect: nextAspect }
            : { ...normalizeStoredTimeline(current.timeline, nextAspect), aspect: nextAspect };

        const nextTitle =
          typeof input.title === 'string' && input.title.trim().length > 0
            ? deriveVideoProjectTitle({ title: input.title })
            : current.title;

        const updated = (
          await tx.query<VideoProjectRow>(
            `update brand_studio_video_projects
                set title = $3,
                    aspect = $4,
                    timeline = $5::jsonb,
                    revision = revision + 1,
                    updated_at = now()
              where id = $1
                and organization_id = $2
              returning *`,
            [projectId, organizationId, nextTitle, nextAspect, JSON.stringify(nextTimeline)],
          )
        ).rows[0]!;

        return {
          ok: true,
          project: await hydrateSingleRow(tx, deps.media, updated),
        };
      }

      if (op === 'status') {
        if (!isVideoProjectStatus(input.status)) {
          return { ok: false, code: 'invalid' };
        }
        await lockOrganization(tx, organizationId);
        const current = (
          await tx.query<VideoProjectRow>(
            `select *
               from brand_studio_video_projects
              where id = $1
                and organization_id = $2
                and deleted_at is null
              for update`,
            [projectId, organizationId],
          )
        ).rows[0];
        if (!current) return { ok: false, code: 'not_found' };

        const nextStatus = input.status;
        const nextCompletedAt =
          nextStatus === 'completed'
            ? iso(current.completed_at) ?? new Date().toISOString()
            : nextStatus === 'active'
              ? null
              : iso(current.completed_at);

        const updated = (
          await tx.query<VideoProjectRow>(
            `update brand_studio_video_projects
                set status = $3,
                    completed_at = $4,
                    revision = revision + 1,
                    updated_at = now()
              where id = $1
                and organization_id = $2
              returning *`,
            [projectId, organizationId, nextStatus, nextCompletedAt],
          )
        ).rows[0]!;

        const purgedShotSheetAssetIds =
          nextStatus === 'completed' || nextStatus === 'archived'
            ? await purgeOrphanedShotSheets(tx, organizationId, projectId, updated.timeline)
            : [];

        return {
          ok: true,
          project: await hydrateSingleRow(tx, deps.media, updated),
          purgedShotSheetAssetIds,
        };
      }

      // op === 'delete'
      await lockOrganization(tx, organizationId);
      const current = (
        await tx.query<VideoProjectRow>(
          `select *
             from brand_studio_video_projects
            where id = $1
              and organization_id = $2
              and deleted_at is null
            for update`,
          [projectId, organizationId],
        )
      ).rows[0];
      if (!current) return { ok: false, code: 'not_found' };

      await tx.query(
        `update brand_studio_video_projects
            set deleted_at = now(),
                updated_at = now()
          where id = $1
            and organization_id = $2`,
        [projectId, organizationId],
      );

      const purgedShotSheetAssetIds = await purgeOrphanedShotSheets(
        tx,
        organizationId,
        projectId,
        current.timeline,
      );

      return {
        ok: true,
        deletedProjectId: projectId,
        purgedShotSheetAssetIds,
      };
    });
    // Members only reach here (the seat above refuses guests and non-members): the film's brand project, opt-in.
    if (!result.ok || !result.project) return result;
    return { ...result, project: (await withFilmBrandProjects(deps.sql, organizationId, [result.project]))[0]! };
  } catch (error) {
    if (error instanceof StudioDenied) return { ok: false, code: error.code };
    if (error instanceof BrandFeatureDenied) return { ok: false, code: 'feature_unavailable' };
    throw error;
  }
}
