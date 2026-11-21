import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExportStatus } from '@/components/brand-studio/editor-v2/export-sheet';
import { parseStoredProject, serializeProjectForStorage, type ComposeClip, type ComposerProject } from '@/lib/brand-studio/compose/timeline';
import { picturePlace } from '@/lib/brand-studio/editor-v2/export-plan';
import { framesFromPlayback, sourceFramesOf } from '@/lib/brand-studio/editor-v2/fps';
import { totalFrames, type FrameClip, type FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import { fromStored, toStored, type FrameV2Block } from '@/lib/brand-studio/editor-v2/stored';
import { studioEditorEn, studioEditorKo } from '@/messages/studio-editor';

/**
 * Spec E addendum C3 (production, 2026-11-21): an export stopped on a cut's last frame. The source was a
 * 4.06 s file at 24 fps: 97 pictures (0–96). The playback measurement had stored 98, the cut ran to the
 * 98th, and the export asked for a picture that does not exist.
 */
describe('the number of pictures is never rounded up', () => {
  it('a length that is not a whole number of frames: 4.06 s and 4.08 s at 24 fps hold 97 pictures', () => {
    expect(sourceFramesOf(4.06, 24)).toBe(97);
    expect(sourceFramesOf(4.08, 24)).toBe(97); // 97.92 frames of time: still 97 pictures
    expect(sourceFramesOf(5.06, 24)).toBe(121);
    // Lengths written from a rounded rate keep their last picture.
    expect(sourceFramesOf(5.005, 23.976)).toBe(120);
    expect(sourceFramesOf(10, 24)).toBe(240);
  });

  it('a length written to the millisecond keeps its last picture (WebM states its length that way)', () => {
    // 119 pictures at 24 fps last 4.958333 s; written as 4.958 s that is 118.992 frames of time.
    expect(sourceFramesOf(4.958, 24)).toBe(119);
    // 299 pictures at 60 fps last 4.983333 s → 4.983 s (298.98 frames of time).
    expect(sourceFramesOf(4.983, 60)).toBe(299);
    // 91 pictures at 29.97 fps last 3.036370 s → 3.036 s.
    expect(sourceFramesOf(3.036, 29.97)).toBe(91);
    // Nothing is invented: almost a whole frame short is still the smaller count.
    expect(sourceFramesOf(4.95, 24)).toBe(118);
  });

  it('playback: the first and last pictures shown give the count, never more than the length gives', () => {
    // The container (its sound) runs to 4.1 s; the last picture is shown at 4.000 s.
    expect(framesFromPlayback({ fps: 24, durationSec: 4.1, firstSec: 0, lastSec: 4.0 })).toBe(97);
    expect(framesFromPlayback({ fps: 24, durationSec: 4.06, firstSec: 0, lastSec: 4.0 })).toBe(97);
    // A file whose first picture is at 0.5 s.
    expect(framesFromPlayback({ fps: 24, durationSec: 4.56, firstSec: 0.5, lastSec: 4.5 })).toBe(97);
    // Ends not seen: the length, rounded down.
    expect(framesFromPlayback({ fps: 24, durationSec: 4.06 })).toBe(97);
  });
});

const SRC = '/api/brand-studio/compose?organizationId=org&source=output&id=v1';

/** A cut v2 stored from the old playback measurement: 98 pictures counted, the cut to the last of them. */
function phantomFilm(frames = 98): ComposerProject {
  const block: FrameV2Block = {
    fps: 24,
    inFrame: 0,
    phase: 0,
    frames,
    speedNum: 1,
    speedDen: 1,
    sourceFps: 24,
    sourceFrames: 98,
    srcUrl: SRC,
    durationSec: 4.1,
    mirror: { trimStartSec: 0, trimEndSec: frames === 98 ? 4.1 : 2, playbackRate: 1 },
  };
  const clip = { id: 'cut-1', label: '영상 스튜디오 1', sourceKind: 'output', outputId: 'v1', srcUrl: SRC, thumbUrl: null, durationSec: 4.1, trimStartSec: 0, trimEndSec: block.mirror.trimEndSec, volume: 1, muted: false, frameV2: block } as ComposeClip;
  return parseStoredProject(serializeProjectForStorage({ version: 1, aspect: '9:16', clips: [clip, { ...clip, id: 'cut-2', frameV2: { ...block } } as ComposeClip], captions: [], bgm: null, colorGrade: null }))!;
}

describe('films stored with a picture too many are corrected on open', () => {
  const counted = { [SRC]: { fps: 24, frames: 97, counted: true } };

  it('the footage gets its real count; a cut that ran into the missing picture ends at the real last one', () => {
    const film = fromStored(phantomFilm(), counted);
    expect(film.corrected).toEqual(['cut-1', 'cut-2']);
    const [first] = film.sequence.clips as [FrameClip, FrameClip];
    expect(first).toMatchObject({ sourceFrames: 97, inFrame: 0, frames: 97 });
    // The timeline is one frame shorter per such cut: what follows moves up by it.
    expect(totalFrames(film.sequence)).toBe(97 * 2);
  });

  it('stored corrected at the next write; the seconds the current editor reads agree with the frames', () => {
    const film = fromStored(phantomFilm(), counted);
    const stored = toStored(film.sequence, phantomFilm());
    const block = (stored.clips[0] as ComposeClip & { frameV2: FrameV2Block }).frameV2;
    expect(block).toMatchObject({ sourceFrames: 97, frames: 97 });
    // 97 / 24 = 4.0417 s, normalised to the current editor's tenths.
    expect(stored.clips[0]!.trimEndSec).toBe(4);
    expect(block.mirror.trimEndSec).toBe(4);
    // Opening it again changes nothing more.
    const again = fromStored(stored, counted);
    expect(again.corrected).toEqual([]);
    expect(again.exact).toEqual(['cut-1', 'cut-2']);
    expect((again.sequence.clips[0] as FrameClip).frames).toBe(97);
  });

  it('a cut that did not reach the missing picture keeps its length and its seconds', () => {
    const film = fromStored(phantomFilm(48), counted);
    expect((film.sequence.clips[0] as FrameClip).frames).toBe(48);
    const stored = toStored(film.sequence, phantomFilm(48));
    expect(stored.clips[0]!.trimEndSec).toBe(2);
    expect((stored.clips[0] as ComposeClip & { frameV2: FrameV2Block }).frameV2.sourceFrames).toBe(97);
  });

  it('only the file’s own count corrects a block; a playback measurement does not', () => {
    const film = fromStored(phantomFilm(), { [SRC]: { fps: 24, frames: 97 } });
    expect(film.corrected).toEqual([]);
    expect((film.sequence.clips[0] as FrameClip).frames).toBe(98);
  });
});

describe('a picture asked for past the footage’s end is filled; a failed one inside it still stops the export', () => {
  const base = { frameSec: 1 / 24, expectedSec: 97 / 24, lastSeenSec: 96 / 24 };

  it('count known: at or past it is past the end, before it is inside or failed', () => {
    expect(picturePlace({ ...base, sourceFrame: 97, knownFrames: 97, confirmed: false, atEnd: true })).toBe('past-end');
    expect(picturePlace({ ...base, sourceFrame: 120, knownFrames: 97, confirmed: false, atEnd: false })).toBe('past-end');
    expect(picturePlace({ ...base, sourceFrame: 96, knownFrames: 97, confirmed: true, atEnd: true })).toBe('inside');
    // A picture inside the footage that never arrives, even with the element at its end: the export stops.
    expect(picturePlace({ ...base, sourceFrame: 96, knownFrames: 97, confirmed: false, atEnd: true })).toBe('failed');
  });

  it('count unknown: past the end only when the element reached its end and its last picture is before the one asked for', () => {
    expect(picturePlace({ ...base, sourceFrame: 97, knownFrames: null, confirmed: false, atEnd: true })).toBe('past-end');
    expect(picturePlace({ ...base, sourceFrame: 97, knownFrames: null, confirmed: false, atEnd: false })).toBe('failed');
    // At its end but showing a picture at or after the one asked for: something else is wrong.
    expect(picturePlace({ ...base, sourceFrame: 97, knownFrames: null, confirmed: false, atEnd: true, lastSeenSec: 97 / 24 })).toBe('failed');
    expect(picturePlace({ ...base, sourceFrame: 97, knownFrames: null, confirmed: false, atEnd: true, lastSeenSec: null })).toBe('failed');
    // Mid-footage, a wrong picture: stops.
    expect(picturePlace({ frameSec: 1 / 24, sourceFrame: 40, knownFrames: null, confirmed: false, atEnd: false, expectedSec: 40 / 24, lastSeenSec: 39 / 24 })).toBe('failed');
    expect(picturePlace({ frameSec: 1 / 24, sourceFrame: 40, knownFrames: null, confirmed: true, atEnd: false, expectedSec: 40 / 24, lastSeenSec: 40 / 24 })).toBe('inside');
  });
});

describe('the sheet says it after the export, quietly', () => {
  const done = {
    status: 'done' as const,
    url: 'blob:x',
    filename: 'twings-edit.mp4',
    bytes: 1000,
    frames: 317,
    fps: 24,
    elapsedMs: 1000,
    captionFile: null,
    warnings: [{ kind: 'lastFrame' as const, clip: '영상 스튜디오 1', frames: 1 }],
  };

  it('names the cut and how many frames repeat its last picture, as a note, not an alert', () => {
    const html = renderToStaticMarkup(h(ExportStatus, { job: done, copy: studioEditorKo.export }));
    expect(html).toContain('data-editor-export-warning="lastFrame"');
    expect(html).toContain('data-editor-export-filled="1"');
    expect(html).toContain('&quot;영상 스튜디오 1&quot; 클립 끝의 1프레임');
    expect(html).not.toMatch(/role="alert"[^>]*data-editor-export-warning="lastFrame"/);
    expect(studioEditorEn.export.warnLastFrame).toContain('{count}');
  });
});

/** Keeps the sequence type in use (a film is a FrameSequence). */
export type Film = FrameSequence;
