import { describe, expect, it } from 'vitest';
import { FIXTURE_FPS, FIXTURE_SPEECH, fixtureDoc } from '@/lib/brand-studio/editor-v2/fixture';
import type { FrameCaption } from '@/lib/brand-studio/editor-v2/frames';
import { captionFindings, captionsToSrt, type CaptionSettings, type EditorDoc } from '@/lib/brand-studio/editor-v2/model';

/** Captions sit on whole frames of the film (24 fps here). */
const caption = (id: string, start: number, end: number, text: string, position: FrameCaption['position'] = 'bottom'): FrameCaption => ({
  id,
  text,
  start,
  end,
  position,
  size: 'md',
});

function doc(aspect: EditorDoc['sequence']['aspect'], captions: FrameCaption[], settings: Partial<CaptionSettings> = {}) {
  const base = fixtureDoc((id) => id);
  return {
    sequence: { ...base.sequence, aspect, captions },
    captionSettings: { ...base.captionSettings, ...settings },
  };
}

describe('captionFindings', () => {
  const two = [caption('a', 14, 91, 'One'), caption('b', 130, 214, 'Two'), caption('c', 216, 240, 'Top', 'top')];

  it('asks for captions when the film speaks and has none', () => {
    expect(captionFindings(doc('16:9', []), FIXTURE_SPEECH)).toEqual([{ kind: 'no_captions', spoken: FIXTURE_SPEECH.length }]);
    expect(captionFindings(doc('16:9', []), [])).toEqual([]);
  });

  it('warns that bottom captions on a vertical film sit under the platform', () => {
    expect(captionFindings(doc('9:16', two, { safeArea: 'reels', lift: false }), FIXTURE_SPEECH)).toEqual([
      { kind: 'covered', count: 2, platform: 'reels' },
    ]);
    expect(captionFindings(doc('9:16', two, { safeArea: 'tiktok', lift: false }), FIXTURE_SPEECH)).toEqual([
      { kind: 'covered', count: 2, platform: 'tiktok' },
    ]);
  });

  it('says nothing once lifted, on a wide film, without a safe area, or with no bottom captions', () => {
    expect(captionFindings(doc('9:16', two, { safeArea: 'reels', lift: true }), FIXTURE_SPEECH)).toEqual([]);
    expect(captionFindings(doc('16:9', two, { safeArea: 'reels', lift: false }), FIXTURE_SPEECH)).toEqual([]);
    expect(captionFindings(doc('9:16', two, { safeArea: 'none', lift: false }), FIXTURE_SPEECH)).toEqual([]);
    expect(captionFindings(doc('9:16', [caption('c', 24, 48, 'Top', 'top')], { safeArea: 'reels' }), FIXTURE_SPEECH)).toEqual([]);
  });
});

describe('captionsToSrt', () => {
  it('runs at the fixture rate', () => {
    expect(FIXTURE_FPS).toBe(24);
  });

  it('writes SubRip in start order with HH:MM:SS,mmm stamps from frame positions', () => {
    // 84 frames = 3.5 s, 126 = 5.25 s, 30 = 1.25 s at 24 fps.
    const srt = captionsToSrt([caption('b', 84, 126, 'Second'), caption('a', 0, 30, 'First')], 24);
    expect(srt).toBe('1\n00:00:00,000 --> 00:00:01,250\nFirst\n\n2\n00:00:03,500 --> 00:00:05,250\nSecond\n');
  });

  it('rounds a frame that does not fall on a whole millisecond to the nearest one', () => {
    // Frame 1 = 41.67 ms, frame 2 = 83.33 ms at 24 fps; frame 1 at 30 fps = 33.33 ms.
    expect(captionsToSrt([caption('f', 1, 2, 'One frame')], 24)).toBe('1\n00:00:00,042 --> 00:00:00,083\nOne frame\n');
    expect(captionsToSrt([caption('f', 1, 3, 'Thirty')], 30)).toBe('1\n00:00:00,033 --> 00:00:00,100\nThirty\n');
  });

  it('carries hours and minutes and returns nothing for no captions', () => {
    // 87,876 frames = 3,661.5 s; 89,353 frames = 3,723.0417 s.
    expect(captionsToSrt([caption('h', 87876, 89353, 'Late')], 24)).toBe('1\n01:01:01,500 --> 01:02:03,042\nLate\n');
    expect(captionsToSrt([], 24)).toBe('');
  });

  it('does not reorder the input array', () => {
    const input = [caption('b', 72, 96, 'B'), caption('a', 24, 48, 'A')];
    captionsToSrt(input, 24);
    expect(input.map((c) => c.id)).toEqual(['b', 'a']);
  });
});
