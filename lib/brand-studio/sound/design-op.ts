/**
 * `music.design` (docs/BRAND-SOUND-STUDIO.md §12.2): "지금 설계하기" in the music dock. Designs the request the
 * same way the prepare step will, without making anything: free, limited per organization like `prompt.enhance`
 * (FREE_INTEL_LIMITS.enhancePerMinute), and only while this month's allowance is open.
 *
 * Gates as every sound operation: the flag, the seat (membership, hardline, studio policy), the `sound` group,
 * then the role. A description naming a real singer is answered like `job.create` would (`blocked: 'name'`).
 *
 * Sound Studio composer v2 (`BRAND_SOUND_COMPOSER_V2_ORGS`): when a listed organization sends any v2 field
 * (`model`, `composerMode`, `durationSeconds`, `title`, `readings`), validates with `MusicDesignV2Schema` and
 * runs `designForDepsV2` for the chosen model. Closed organizations (or requests without v2 fields) continue
 * through `MusicDesignSchema` and `designForDeps` unchanged.
 */
import { assertBrandFeature, BrandFeatureDenied } from '@/lib/brands/entitlements';
import { brandSoundComposerV2For } from '@/lib/flags';
import { requireCreate, StudioDenied, studioSeat } from '../access';
import { MusicDesignSchema, MusicDesignV2Schema, type StudioFailure, type StudioMusicDesign } from '../contracts';
import { FREE_INTEL_LIMITS, takeFreeIntelSlot } from '../jobs';
import { failure, guarded } from '../outcome';
import { brandSummary } from '../prepare';
import type { StudioDeps } from '../types';
import { loadAllowance } from '../usage';
import { resolveMinimaxDurationSeconds } from './architect';
import { ownLyrics } from './lyrics';
import { designInputOf, V2_MUSIC_FIELDS, wordsText } from './music-jobs';
import { namedArtist } from './names';
import { designForDeps, designForDepsV2 } from './prepare-music';
import { parseRequestedSeconds } from './requested-seconds';
import { videoFitOf, videoStructure, videoTargetSeconds } from './video-fit';

export const V2_MUSIC_DESIGN_FIELDS = [...V2_MUSIC_FIELDS, 'readings'] as const;

export function hasV2MusicDesignFields(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  return V2_MUSIC_DESIGN_FIELDS.some((field) => field in raw);
}

function isV2MusicDesignRequest(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const orgId = (raw as { organizationId?: unknown }).organizationId;
  return typeof orgId === 'string' && brandSoundComposerV2For(orgId, process.env) && hasV2MusicDesignFields(raw);
}

function readingsText(readings: { audio?: string; voice?: string; inspo?: string[] } | undefined, vocal: boolean): string {
  if (!readings) return '';
  return [readings.audio ?? '', ...(vocal && readings.voice ? [readings.voice] : []), ...(readings.inspo ?? [])].join('\n');
}

async function designMusicPreviewV2(
  deps: StudioDeps,
  viewer: { userId: string | null; locale?: string | null },
  raw: unknown,
): Promise<StudioMusicDesign | (StudioFailure & { blocked?: 'name' | 'lyrics' })> {
  const parsed = MusicDesignV2Schema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const now = deps.now?.() ?? new Date();
  const gate = await guarded(() =>
    deps.sql.transaction(async (sql) => {
      try {
        const seat = await studioSeat(sql, viewer.userId, v.organizationId, { requireSelfStudio: true });
        if (seat.role === 'guest') throw new StudioDenied('not_found');
        try {
          await assertBrandFeature(sql, v.organizationId, 'sound');
        } catch (error) {
          if (error instanceof BrandFeatureDenied) throw new StudioDenied('feature_unavailable');
          throw error;
        }
        requireCreate(seat);
        const allowance = await loadAllowance(sql, v.organizationId, deps.env, now);
        if (allowance.capKrw <= 0) throw new StudioDenied('allowance_closed');
        const video = v.videoAssetId
          ? await videoFitOf(sql, {
              organizationId: v.organizationId,
              assetId: v.videoAssetId,
              locale: viewer.locale === 'en' ? 'en' : 'ko',
              now,
            })
          : null;
        if (v.videoAssetId && !video) throw new StudioDenied('invalid');
        return { ok: true as const, name: seat.organizationName, video };
      } catch (error) {
        if (
          error instanceof StudioDenied &&
          error.code !== 'feature_unavailable' &&
          error.code !== 'allowance_closed'
        ) {
          throw new StudioDenied('invalid');
        }
        throw error;
      }
    }),
  );
  if (!('name' in gate)) return gate;
  if (namedArtist(v.prompt)) return { ok: false, code: 'invalid', blocked: 'name' };
  if (v.title && namedArtist(v.title)) return { ok: false, code: 'invalid', blocked: 'name' };
  if (v.vocal && v.lyrics && namedArtist(v.lyrics)) return { ok: false, code: 'invalid', blocked: 'lyrics' };
  if (v.words && namedArtist(wordsText(v.words))) return { ok: false, code: 'invalid', blocked: 'name' };
  if (v.readings && namedArtist(readingsText(v.readings, v.vocal))) return { ok: false, code: 'invalid', blocked: 'name' };
  if (v.careful === true && (v.model === 'minimax-music-3' || deps.env.soundMaxMode !== true)) return failure('invalid');
  if (!takeFreeIntelSlot(`music-design:${v.organizationId}`, FREE_INTEL_LIMITS.enhancePerMinute, now.getTime())) {
    return failure('too_many_running');
  }

  const locale: 'ko' | 'en' = viewer.locale === 'en' ? 'en' : 'ko';
  const brand = await brandSummary(deps, v.organizationId, gate.name);
  const sentenceSeconds = parseRequestedSeconds(v.prompt);

  const resolvedSunoTarget =
    v.targetSeconds ??
    (gate.video ? videoTargetSeconds(gate.video) : sentenceSeconds !== null ? Math.min(240, Math.max(5, sentenceSeconds)) : undefined);
  const resolvedMinimaxDuration = resolveMinimaxDurationSeconds({
    durationSeconds: v.durationSeconds,
    video: gate.video,
    prompt: v.prompt,
  });

  const baseInput = designInputOf(
    {
      ...v,
      targetSeconds: v.model === 'minimax-music-3' ? undefined : resolvedSunoTarget,
    },
    locale,
  );

  const design = await designForDepsV2(deps, v.model, {
    ...baseInput,
    ...(v.model === 'minimax-music-3' ? { plan: null, durationSeconds: resolvedMinimaxDuration } : { targetSeconds: resolvedSunoTarget ?? null }),
    ...(v.composerMode ? { composerMode: v.composerMode } : {}),
    ...(v.readings ? { readings: v.readings } : {}),
    ...(v.avoid ? { avoid: true } : {}),
    ...(gate.video ? { video: gate.video, structure: v.structure ?? videoStructure(gate.video) } : {}),
    customerLyrics: Boolean(v.vocal && ownLyrics(v.lyrics)),
    organizationId: v.organizationId,
    brand: brand ? { name: brand.name ?? null, tone: brand.tone ?? null, rules: brand.rules ?? [] } : null,
  });

  const explicitTitle = v.title?.trim() ?? '';
  const finalTitle = explicitTitle || design.title;

  return {
    ok: true,
    design: {
      mode: design.mode,
      style: design.style,
      ...(v.model === 'minimax-music-3' ? { prompt: design.prompt ?? design.style } : {}),
      title: finalTitle,
      notes: design.notes,
      source: design.source === 'model' ? 'model' : 'fallback',
    },
  };
}

export async function designMusicPreview(
  deps: StudioDeps,
  viewer: { userId: string | null; locale?: string | null },
  raw: unknown,
): Promise<StudioMusicDesign | (StudioFailure & { blocked?: 'name' | 'lyrics' })> {
  if (!deps.env.soundStudio) return failure('invalid');
  if (isV2MusicDesignRequest(raw)) return designMusicPreviewV2(deps, viewer, raw);
  const parsed = MusicDesignSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const now = deps.now?.() ?? new Date();
  const gate = await guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await studioSeat(sql, viewer.userId, v.organizationId, { requireSelfStudio: true });
      if (seat.role === 'guest') throw new StudioDenied('not_found');
      try {
        await assertBrandFeature(sql, v.organizationId, 'sound');
      } catch (error) {
        if (error instanceof BrandFeatureDenied) throw new StudioDenied('feature_unavailable');
        throw error;
      }
      requireCreate(seat);
      const allowance = await loadAllowance(sql, v.organizationId, deps.env, now);
      if (allowance.capKrw <= 0) throw new StudioDenied('allowance_closed');
      const video = v.videoAssetId ? await videoFitOf(sql, { organizationId: v.organizationId, assetId: v.videoAssetId, locale: viewer.locale === 'en' ? 'en' : 'ko', now }) : null;
      if (v.videoAssetId && !video) throw new StudioDenied('invalid');
      return { ok: true as const, name: seat.organizationName, video };
    }),
  );
  if (!('name' in gate)) return gate;
  if (namedArtist(v.prompt)) return { ok: false, code: 'invalid', blocked: 'name' };
  if (v.vocal && v.lyrics && namedArtist(v.lyrics)) return { ok: false, code: 'invalid', blocked: 'lyrics' };
  if (v.words && namedArtist(wordsText(v.words))) return { ok: false, code: 'invalid', blocked: 'name' };
  if (v.careful === true && deps.env.soundMaxMode !== true) return failure('invalid');
  if (!takeFreeIntelSlot(`music-design:${v.organizationId}`, FREE_INTEL_LIMITS.enhancePerMinute, now.getTime())) return failure('too_many_running');
  const locale: 'ko' | 'en' = viewer.locale === 'en' ? 'en' : 'ko';
  const brand = await brandSummary(deps, v.organizationId, gate.name);
  const design = await designForDeps(deps, {
    ...designInputOf(v, locale),
    ...(v.avoid ? { avoid: true } : {}),
    ...(gate.video ? { video: gate.video, structure: v.structure ?? videoStructure(gate.video) } : {}),
    brand: brand ? { name: brand.name ?? null, tone: brand.tone ?? null, rules: brand.rules ?? [] } : null,
  });
  return {
    ok: true,
    design: {
      mode: design.mode,
      style: design.style,
      title: design.title,
      notes: design.notes,
      source: design.source === 'model' ? 'model' : 'fallback',
    },
  };
}
