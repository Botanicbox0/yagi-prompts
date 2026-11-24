import { z } from 'zod';
import type { SqlRunner } from '@/lib/db/sql-runner';

/**
 * A template's keyframes (`prompt_items.keyframes`, `platform_formats.keyframes`, 0088 — the column check is only "is
 * an array"). Two kinds share the column:
 *
 * - a BEAT: a moment with a name, shown in the keyframe strip under the example video (as before);
 * - a MARK (docs/PERSONAL-STUDIO.md §3.4.4, T1a): an entry with `part`, naming a part the template's prompt declares
 *   (a `Template locks:` key such as 'hair', 'product', 'shots-2-3'), with an end time; `labelKo`/`labelEn` are its
 *   short description. Marks are shown in the template's "what it decides" row, never as beats.
 *
 * Old code strips the new keys, and a row with more than six entries falls back to the default beats there.
 */
export const KEYFRAMES_MAX = 12;
/** The maker route's limit, unchanged: beats only. */
export const BEATS_MAX = 6;
/** Ranges shown per part. */
export const MARKS_PER_PART_MAX = 2;
/** A part key: the lock keys ('product', 'lighting_mood', 'shots-2-3'). Never prompt words. */
export const PART_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

export const VideoKeyframeSchema = z.object({
  index: z.number().int().min(0).max(KEYFRAMES_MAX - 1),
  timeSeconds: z.number().min(0).max(120),
  /** A mark's end (seconds). */
  endSeconds: z.number().min(0).max(120).optional(),
  /** Present = a mark for this declared part. */
  part: z.string().regex(PART_KEY_PATTERN).optional(),
  labelKo: z.string().trim().max(40).optional(),
  labelEn: z.string().trim().max(40).optional(),
  thumbUrl: z.string().trim().max(500).optional(),
});

export type VideoKeyframe = z.infer<typeof VideoKeyframeSchema>;

export const VideoKeyframesSchema = z.array(VideoKeyframeSchema).min(1).max(KEYFRAMES_MAX);

/** The maker route's body (`/api/makers/formats/[id]/keyframes`): exactly the old schema, beats only. */
export const VideoBeatsSchema = z
  .array(VideoKeyframeSchema.omit({ endSeconds: true, part: true }).extend({ index: z.number().int().min(0).max(BEATS_MAX - 1) }))
  .min(1)
  .max(BEATS_MAX);

/** What the admin saves (`prompt.marks`): marks only, each with a part and an end; may be empty (clears them). */
export const VideoMarksSchema = z
  .array(VideoKeyframeSchema.extend({ part: z.string().regex(PART_KEY_PATTERN), endSeconds: z.number().min(0).max(120) }))
  .max(KEYFRAMES_MAX);

export type VideoMark = VideoKeyframe & { part: string };

export function isMark(keyframe: VideoKeyframe): keyframe is VideoMark {
  return typeof keyframe.part === 'string' && keyframe.part !== '';
}

/** Beats (numbered from 0 in time order, as the strip always had them) and marks (time order). */
export function splitKeyframes(all: readonly VideoKeyframe[]): { beats: VideoKeyframe[]; marks: VideoMark[] } {
  const sorted = [...all].sort((a, b) => a.timeSeconds - b.timeSeconds);
  return {
    beats: sorted.filter((kf) => !isMark(kf)).map((kf, index) => ({ ...kf, index })),
    marks: sorted.filter(isMark),
  };
}

/** "0:03", "1:05": whole seconds, for ranges on the page. */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

const BEAT_RATIOS: Record<number, readonly number[]> = {
  3: [0.1, 0.5, 0.88],
  4: [0.1, 0.35, 0.62, 0.88],
  5: [0.08, 0.28, 0.5, 0.72, 0.9],
};

const BEAT_LABELS: ReadonlyArray<{ ko: string; en: string }> = [
  { ko: '오프닝', en: 'Opening' },
  { ko: '전환', en: 'Transition' },
  { ko: '하이라이트', en: 'Highlight' },
  { ko: '피날레', en: 'Finale' },
  { ko: '엔딩', en: 'Ending' },
];

export function parseVideoKeyframes(raw: unknown): VideoKeyframe[] | null {
  if (!Array.isArray(raw)) return null;
  const parsed = VideoKeyframesSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data
    .slice()
    .sort((a, b) => a.timeSeconds - b.timeSeconds)
    .map((kf, idx) => ({ ...kf, index: idx }));
}

export function defaultTimelineKeyframes(
  runtimeSeconds: number | null | undefined,
  count = 4,
): VideoKeyframe[] {
  const safeCount = Math.max(3, Math.min(5, Math.round(count)));
  const duration = Math.max(4, Math.min(120, Number(runtimeSeconds ?? 10) || 10));
  const ratios = BEAT_RATIOS[safeCount] ?? BEAT_RATIOS[4]!;
  return ratios.map((ratio, index) => {
    const timeSeconds = Math.round(duration * ratio * 10) / 10;
    const label = BEAT_LABELS[index] ?? { ko: `장면 ${index + 1}`, en: `Beat ${index + 1}` };
    return {
      index,
      timeSeconds: Math.min(duration, Math.max(0, timeSeconds)),
      labelKo: label.ko,
      labelEn: label.en,
    };
  });
}

export function formatKeyframeSeconds(seconds: number): string {
  const clamped = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return `${clamped.toFixed(1)}s`;
}

export async function loadPromptKeyframesBySlug(
  sql: SqlRunner,
  slug: string,
): Promise<VideoKeyframe[] | null> {
  try {
    const { rows } = await sql.query<{ keyframes: unknown }>(
      "select coalesce(to_jsonb(p.*)->'keyframes', 'null'::jsonb) as keyframes from prompt_items p where slug = $1",
      [slug],
    );
    return parseVideoKeyframes(rows[0]?.keyframes ?? null);
  } catch {
    return null;
  }
}
