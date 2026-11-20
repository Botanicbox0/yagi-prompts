/**
 * `music.design` (docs/BRAND-SOUND-STUDIO.md §12.2): "지금 설계하기" in the music dock. Designs the request the
 * same way the prepare step will, without making anything: free, limited per organization like `prompt.enhance`
 * (FREE_INTEL_LIMITS.enhancePerMinute), and only while this month's allowance is open.
 *
 * Gates as every sound operation: the flag, the seat (membership, hardline, studio policy), the `sound` group,
 * then the role. A description naming a real singer is answered like `job.create` would (`blocked: 'name'`).
 */
import type { Viewer } from '@/lib/auth/identity';
import { assertBrandFeature, BrandFeatureDenied } from '@/lib/brands/entitlements';
import { requireCreate, StudioDenied, studioSeat } from '../access';
import { MusicDesignSchema, type StudioFailure, type StudioMusicDesign } from '../contracts';
import { FREE_INTEL_LIMITS, takeFreeIntelSlot } from '../jobs';
import { failure, guarded } from '../outcome';
import { brandSummary } from '../prepare';
import type { StudioDeps } from '../types';
import { loadAllowance } from '../usage';
import { designInputOf, wordsText } from './music-jobs';
import { namedArtist } from './names';
import { designForDeps } from './prepare-music';
import { videoFitOf, videoStructure } from './video-fit';

export async function designMusicPreview(deps: StudioDeps, viewer: { userId: string | null; locale?: string | null }, raw: unknown): Promise<StudioMusicDesign | (StudioFailure & { blocked?: 'name' | 'lyrics' })> {
  if (!deps.env.soundStudio) return failure('invalid');
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
