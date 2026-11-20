/**
 * `output.waveform` (docs/BRAND-SOUND-STUDIO.md §7.4): the first browser that decodes an audio result keeps
 * its peaks on the result row, so every later visit draws the list from stored values. Written once (a value
 * already there is kept), only for a ready audio result of this organization, behind the same gates as the
 * sound studio itself. Viewers may write it: they play results too, and the values are only a drawing.
 */
import type { Viewer } from '@/lib/auth/identity';
import { assertBrandFeature, BrandFeatureDenied } from '@/lib/brands/entitlements';
import { StudioDenied, studioSeat } from '../access';
import { OutputWaveformSchema, type StudioDone, type StudioFailure } from '../contracts';
import { failure, guarded } from '../outcome';
import { readyOutput } from '../repo';
import type { StudioDeps } from '../types';
import { cleanPeaks } from './waveform';

export async function saveOutputWaveform(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioDone | StudioFailure> {
  if (!deps.env.soundStudio) return failure('invalid');
  const parsed = OutputWaveformSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const peaks = cleanPeaks(v.peaks);
  if (!peaks) return failure('invalid');
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await studioSeat(sql, viewer.userId, v.organizationId, { requireSelfStudio: true });
      if (seat.role === 'guest') throw new StudioDenied('not_found');
      try {
        await assertBrandFeature(sql, v.organizationId, 'sound');
      } catch (error) {
        if (error instanceof BrandFeatureDenied) throw new StudioDenied('feature_unavailable');
        throw error;
      }
      const output = await readyOutput(sql, v.organizationId, v.outputId);
      if (!output) throw new StudioDenied('not_found');
      if (output.kind !== 'audio') throw new StudioDenied('invalid');
      await sql.query('update brand_studio_outputs set waveform = $2::jsonb where id = $1 and waveform is null', [output.id, JSON.stringify(peaks)]);
      return { ok: true as const };
    }),
  );
}
