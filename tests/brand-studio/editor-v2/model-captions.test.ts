import { describe, expect, it } from 'vitest';
import type { ComposeCaption } from '@/lib/brand-studio/compose/timeline';
import { FIXTURE_SPEECH, fixtureDoc } from '@/lib/brand-studio/editor-v2/fixture';
import { captionFindings, captionsToSrt, type CaptionSettings, type EditorDoc } from '@/lib/brand-studio/editor-v2/model';

const caption = (id: string, startSec: number, endSec: number, text: string, position: ComposeCaption['position'] = 'bottom'): ComposeCaption => ({
  id,
  text,
  startSec,
  endSec,
  position,
  size: 'md',
});

function doc(aspect: EditorDoc['project']['aspect'], captions: ComposeCaption[], settings: Partial<CaptionSettings> = {}) {
  const base = fixtureDoc((id) => id);
  return {
    project: { ...base.project, aspect, captions },
    captionSettings: { ...base.captionSettings, ...settings },
  };
}

describe('captionFindings', () => {
  const two = [caption('a', 0.6, 3.8, 'One'), caption('b', 5.4, 8.9, 'Two'), caption('c', 9, 10, 'Top', 'top')];

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
    expect(captionFindings(doc('9:16', [caption('c', 1, 2, 'Top', 'top')], { safeArea: 'reels' }), FIXTURE_SPEECH)).toEqual([]);
  });
});

describe('captionsToSrt', () => {
  it('writes SubRip in start order with HH:MM:SS,mmm stamps', () => {
    const srt = captionsToSrt([caption('b', 3.5, 5.25, 'Second'), caption('a', 0, 1.2, 'First')]);
    expect(srt).toBe('1\n00:00:00,000 --> 00:00:01,200\nFirst\n\n2\n00:00:03,500 --> 00:00:05,250\nSecond\n');
  });

  it('carries hours and minutes and returns nothing for no captions', () => {
    expect(captionsToSrt([caption('h', 3661.5, 3723.007, 'Late')])).toBe('1\n01:01:01,500 --> 01:02:03,007\nLate\n');
    expect(captionsToSrt([])).toBe('');
  });

  it('does not reorder the input array', () => {
    const input = [caption('b', 3, 4, 'B'), caption('a', 1, 2, 'A')];
    captionsToSrt(input);
    expect(input.map((c) => c.id)).toEqual(['b', 'a']);
  });
});
