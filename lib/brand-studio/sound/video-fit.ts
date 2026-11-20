/**
 * Fitting music to a video (docs/BRAND-SOUND-STUDIO.md §12.2 "음악을 붙일 영상", §12.6 SA4). The customer picks a
 * video from the library under "가사 분량 맞추기 › 영상 길이"; its length becomes the target the lyrics are sized for
 * (and the version closest to it is listed first), the structure follows that length, and the Prompt Architect reads
 * the length and where the cuts fall to shape the paragraph in words.
 *
 * Nothing is analyzed anew (§12.2): the length is the stored one, the cuts are the shot starts of a film sheet the
 * library already keeps (lib/brand-studio/film-sheet); without one, the length alone is used. A video outside the
 * organization, deleted or not ready is not found, the same answer as a missing one.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';
import { readCachedFilmSheet } from '../film-sheet';
import type { AssetRow } from '../types';
import { defaultStructure, type LyricStructure } from './lyrics';

/** What a run keeps of the video it was fitted to (`params.music.video`). */
export interface MusicVideoFit {
  assetId: string;
  /** The video's length in tenths of a second. */
  seconds: number;
  /** Where the cuts fall, seconds from the start (the shot starts after the first), at most `CUTS_MAX`. */
  cuts: number[];
}

/** The picker's row: a library video with a known length. */
export interface SoundVideoView {
  assetId: string;
  name: string;
  seconds: number;
  thumbUrl: string | null;
}

export const CUTS_MAX = 24;
/** Longest video the lyrics are sized to (the draft schema's own ceiling). */
export const VIDEO_FIT_MAX_SECONDS = 240;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The target length the lyrics are sized for: the video's, in whole seconds, within 5–240. */
export function videoTargetSeconds(fit: Pick<MusicVideoFit, 'seconds'>): number {
  return Math.min(VIDEO_FIT_MAX_SECONDS, Math.max(5, Math.round(fit.seconds)));
}

export function videoStructure(fit: Pick<MusicVideoFit, 'seconds'>): LyricStructure {
  return defaultStructure(videoTargetSeconds(fit));
}

/** The cuts of a film sheet: shot starts after zero, inside the video, in order, rounded to tenths. */
export function cutsOf(shots: ReadonlyArray<{ start?: number }>, seconds: number): number[] {
  const starts = shots
    .map((shot) => (typeof shot.start === 'number' && Number.isFinite(shot.start) ? round1(shot.start) : null))
    .filter((t): t is number => t !== null && t > 0.2 && t < seconds - 0.2);
  return [...new Set(starts)].sort((a, b) => a - b).slice(0, CUTS_MAX);
}

/** A library video's fit, or null when it is not a ready video of this organization with a known length. */
export async function videoFitOf(
  sql: SqlRunner,
  input: { organizationId: string; assetId: string; locale: 'ko' | 'en'; now?: Date },
): Promise<MusicVideoFit | null> {
  const row = (
    await sql.query<Pick<AssetRow, 'id' | 'kind' | 'duration_ms'>>(
      `select id, kind, duration_ms from brand_studio_assets
        where id = $1 and organization_id = $2 and status = 'ready' and deleted_at is null`,
      [input.assetId, input.organizationId],
    )
  ).rows[0];
  if (!row || row.kind !== 'video' || !row.duration_ms || row.duration_ms <= 0) return null;
  const seconds = round1(row.duration_ms / 1000);
  const other: 'ko' | 'en' = input.locale === 'ko' ? 'en' : 'ko';
  const sheet =
    (await readCachedFilmSheet(sql, { organizationId: input.organizationId, assetId: row.id, locale: input.locale, ...(input.now ? { now: input.now } : {}) })) ??
    (await readCachedFilmSheet(sql, { organizationId: input.organizationId, assetId: row.id, locale: other, ...(input.now ? { now: input.now } : {}) }));
  return { assetId: row.id, seconds, cuts: sheet ? cutsOf(sheet.shots, seconds) : [] };
}

/** The library videos the picker offers: ready, with a length, newest first. */
export function soundVideos(rows: readonly AssetRow[], thumbUrl: (row: AssetRow) => string | null, limit = 30): SoundVideoView[] {
  return rows
    .filter((row) => row.kind === 'video' && row.status === 'ready' && !row.deleted_at && (row.duration_ms ?? 0) > 0)
    .slice(0, limit)
    .map((row) => ({ assetId: row.id, name: row.name, seconds: round1((row.duration_ms ?? 0) / 1000), thumbUrl: thumbUrl(row) }));
}

/**
 * The line the Prompt Architect reads (English, like the rest of its task): the length and where the cuts fall as
 * fractions, so the paragraph can place the hook and the lift in words. The style itself never carries seconds.
 */
export function videoDesignLine(fit: MusicVideoFit): string {
  const where = fit.cuts.length
    ? ` It has ${fit.cuts.length} cut${fit.cuts.length === 1 ? '' : 's'}, at ${fit.cuts.map((t) => `${Math.round((t / fit.seconds) * 100)}%`).join(', ')} of its length${
        fit.cuts.length >= Math.max(4, fit.seconds / 3) ? ' (fast cutting: keep the rhythm driving)' : ''
      }.`
    : '';
  return `The music goes under a video of about ${videoTargetSeconds(fit)} seconds.${where} Shape the structure to it in words (where the hook lands, where it lifts, how it ends), never in seconds.`;
}
