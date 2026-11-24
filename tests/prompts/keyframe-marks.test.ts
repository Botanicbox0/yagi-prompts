import { describe, expect, it } from 'vitest';
import {
  KEYFRAMES_MAX,
  VideoBeatsSchema,
  VideoKeyframesSchema,
  VideoMarksSchema,
  formatClock,
  parseVideoKeyframes,
  splitKeyframes,
  type VideoKeyframe,
} from '@/lib/prompts/keyframes';

/**
 * docs/PERSONAL-STUDIO.md §3.4.4 (T1a) — a template's keyframes column carries two kinds of entry: beats (a moment
 * with a name, shown in the keyframe strip, unchanged) and marks (an entry naming a part the template fixes, with an
 * end time and a short description). No migration: the column check is only "is an array" (0088).
 */

const beat = (timeSeconds: number, labelKo?: string): VideoKeyframe => ({ index: 0, timeSeconds, ...(labelKo ? { labelKo } : {}) });

describe('keyframes with marks', () => {
  it('keeps the new fields through a parse round trip', () => {
    const raw = [
      { index: 0, timeSeconds: 1, labelKo: '오프닝' },
      { index: 1, timeSeconds: 3, endSeconds: 6, part: 'hair', labelKo: '핑크 단발', labelEn: 'Pink bob' },
    ];
    const parsed = parseVideoKeyframes(JSON.parse(JSON.stringify(raw)));
    expect(parsed).toEqual([
      { index: 0, timeSeconds: 1, labelKo: '오프닝' },
      { index: 1, timeSeconds: 3, endSeconds: 6, part: 'hair', labelKo: '핑크 단발', labelEn: 'Pink bob' },
    ]);
  });

  it('parses 7 to 12 entries and refuses 13 (so a rollback to 6 falls back to the default beats)', () => {
    for (let n = 7; n <= KEYFRAMES_MAX; n += 1) {
      const rows = Array.from({ length: n }, (_, i) => ({ index: i, timeSeconds: i }));
      expect(parseVideoKeyframes(rows), String(n)).toHaveLength(n);
    }
    expect(KEYFRAMES_MAX).toBe(12);
    expect(parseVideoKeyframes(Array.from({ length: 13 }, (_, i) => ({ index: i, timeSeconds: i })))).toBeNull();
    expect(VideoKeyframesSchema.safeParse([]).success).toBe(false);
  });

  it('leaves an existing beats-only row exactly as before', () => {
    const rows = [
      { index: 0, timeSeconds: 4.5, labelKo: '하이라이트' },
      { index: 1, timeSeconds: 0.8, labelKo: '오프닝' },
    ];
    const parsed = parseVideoKeyframes(rows)!;
    expect(parsed).toEqual([
      { index: 0, timeSeconds: 0.8, labelKo: '오프닝' },
      { index: 1, timeSeconds: 4.5, labelKo: '하이라이트' },
    ]);
    const { beats, marks } = splitKeyframes(parsed);
    expect(beats).toEqual(parsed);
    expect(marks).toEqual([]);
  });

  it('splits beats from marks, numbering the beats from 0 in time order', () => {
    const all = parseVideoKeyframes([
      { index: 0, timeSeconds: 2, endSeconds: 4, part: 'product', labelKo: '세럼 병' },
      beat(1, '오프닝'),
      beat(5, '피날레'),
      { index: 3, timeSeconds: 0.5, endSeconds: 9, part: 'sound' },
    ])!;
    const { beats, marks } = splitKeyframes(all);
    expect(beats).toEqual([
      { index: 0, timeSeconds: 1, labelKo: '오프닝' },
      { index: 1, timeSeconds: 5, labelKo: '피날레' },
    ]);
    expect(marks.map((m) => [m.part, m.timeSeconds, m.endSeconds])).toEqual([
      ['sound', 0.5, 9],
      ['product', 2, 4],
    ]);
    expect(splitKeyframes([])).toEqual({ beats: [], marks: [] });
  });

  it('refuses a part key that is not a plain identifier, and keeps old readers safe', () => {
    expect(parseVideoKeyframes([{ index: 0, timeSeconds: 1, part: 'Hair Style' }])).toBeNull();
    expect(parseVideoKeyframes([{ index: 0, timeSeconds: 1, part: 'shots-2-3' }])).toHaveLength(1);
    expect(parseVideoKeyframes([{ index: 0, timeSeconds: 1, part: 'lighting_mood' }])).toHaveLength(1);
  });

  it('the maker route schema is the old one: beats only, at most six, new keys stripped', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ index: i, timeSeconds: i }));
    expect(VideoBeatsSchema.safeParse(six).success).toBe(true);
    expect(VideoBeatsSchema.safeParse([...six, { index: 6, timeSeconds: 7 }]).success).toBe(false);
    expect(VideoBeatsSchema.safeParse([{ index: 6, timeSeconds: 1 }]).success).toBe(false);
    const stripped = VideoBeatsSchema.parse([{ index: 0, timeSeconds: 1, part: 'hair', endSeconds: 3, labelKo: '오프닝' }]);
    expect(stripped).toEqual([{ index: 0, timeSeconds: 1, labelKo: '오프닝' }]);
  });

  it('a mark for saving needs a part and an end time', () => {
    expect(VideoMarksSchema.safeParse([]).success).toBe(true);
    expect(VideoMarksSchema.safeParse([{ index: 0, timeSeconds: 1, endSeconds: 2, part: 'hair' }]).success).toBe(true);
    expect(VideoMarksSchema.safeParse([{ index: 0, timeSeconds: 1, part: 'hair' }]).success).toBe(false);
    expect(VideoMarksSchema.safeParse([{ index: 0, timeSeconds: 1, endSeconds: 2 }]).success).toBe(false);
    expect(VideoMarksSchema.safeParse([{ index: 0, timeSeconds: 1, endSeconds: 2, part: 'hair', labelKo: 'x'.repeat(41) }]).success).toBe(false);
  });

  it('formats a clock time in whole seconds', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(3.9)).toBe('0:03');
    expect(formatClock(65.2)).toBe('1:05');
    expect(formatClock(Number.NaN)).toBe('0:00');
  });
});
