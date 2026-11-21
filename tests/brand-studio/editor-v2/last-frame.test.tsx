import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExportStatus } from '@/components/brand-studio/editor-v2/export-sheet';
import { parseStoredProject, serializeProjectForStorage, timelineSpans, type ComposeClip, type ComposerProject } from '@/lib/brand-studio/compose/timeline';
import { effectStartSec, overlayFrames, storedSecToFrame } from '@/lib/brand-studio/editor-v2/cut-anchor';
import { picturePlace } from '@/lib/brand-studio/editor-v2/export-plan';
import { framesFromPlayback, sourceFramesOf } from '@/lib/brand-studio/editor-v2/fps';
import { totalFrames, type FrameClip, type FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import { fromStored, mergeFilmText, ownedSignature, storedFilmView, toStored, type FrameV2Block, type MeasuredSources } from '@/lib/brand-studio/editor-v2/stored';
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

  it('stored corrected at the next write, and the seconds the current editor reads do not move', () => {
    // Review round 1 of part E, item 1: taking away end pictures the file does not have changes nothing
    // the person set. The current editor still ends the cut at 4.1 s (it holds the last picture there).
    const before = phantomFilm();
    const film = fromStored(before, counted);
    const stored = toStored(film.sequence, before);
    const block = (stored.clips[0] as ComposeClip & { frameV2: FrameV2Block }).frameV2;
    expect(block).toMatchObject({ sourceFrames: 97, frames: 97, inFrame: 0 });
    const seconds = (project: ComposerProject) => project.clips.map((c) => [c.trimStartSec, c.trimEndSec, c.playbackRate ?? 1, c.durationSec]);
    expect(seconds(stored)).toEqual(seconds(before));
    expect(block.mirror).toEqual({ trimStartSec: 0, trimEndSec: 4.1, playbackRate: 1 });
    // The current editor's layout is the same before, on open, and after the write.
    const layout = (project: ComposerProject) => timelineSpans(project).map((span) => [span.timelineStartSec, span.timelineEndSec]);
    expect(layout(storedFilmView(film.sequence, before).film)).toEqual(layout(before));
    expect(layout(stored)).toEqual(layout(before));
    // Opening it again finds nothing to correct.
    const again = fromStored(stored, counted);
    expect(again.corrected).toEqual([]);
    expect(again.exact).toEqual(['cut-1', 'cut-2']);
    expect((again.sequence.clips[0] as FrameClip).frames).toBe(97);
    // And a write after that changes nothing either.
    expect(toStored(again.sequence, stored)).toEqual(stored);
  });

  it('a caption, an effect and a still overlay in a later cut stay on the same cut at the same point', () => {
    const before: ComposerProject = {
      ...phantomFilm(),
      captions: [{ id: 'cap', text: 'cap', startSec: 5.0, endSec: 5.5, position: 'bottom', size: 'md' }],
      sfxClips: [{ id: 'fx', label: 'fx', sourceKind: 'asset', srcUrl: '/fx.wav', startSec: 5.0, durationSec: 0.2, volume: 1 }],
      overlays: [{ id: 'ov', label: 'ov', sourceKind: 'asset', srcUrl: '/ov.png', mediaKind: 'image', startSec: 5.0, endSec: 5.5, x: 0.5, y: 0.5, scale: 0.2, opacity: 1 }],
    };
    // Before the correction (the cuts as stored: 98 + 98 frames) and after it (97 + 97).
    const uncorrected = fromStored(before, {}).sequence;
    const corrected = fromStored(before, counted).sequence;
    const place = (frame: number, cutStart: number) => frame - cutStart;
    const viewBefore = storedFilmView(uncorrected, before);
    const viewAfter = storedFilmView(corrected, before);
    // 5.0 s is 0.9 s into cut 2 in the current editor's layout (it starts at 4.1 s): 22 pictures in.
    expect(place(storedSecToFrame(viewBefore.anchor, 5.0), 98)).toBe(22);
    expect(place(storedSecToFrame(viewAfter.anchor, 5.0), 97)).toBe(22);
    expect(place(viewAfter.sequence.captions[0]!.start, 97)).toBe(place(viewBefore.sequence.captions[0]!.start, 98));
    expect(place(overlayFrames(viewAfter.anchor, before.overlays![0]!).first, 97)).toBe(place(overlayFrames(viewBefore.anchor, before.overlays![0]!).first, 98));
    expect(effectStartSec(viewAfter.anchor, before.sfxClips![0]!) - 97 / 24).toBeCloseTo(effectStartSec(viewBefore.anchor, before.sfxClips![0]!) - 98 / 24, 12);
    // After the write, too.
    const written = toStored(corrected, before);
    const reopened = fromStored(written, counted).sequence;
    expect(place(storedFilmView(reopened, written).sequence.captions[0]!.start, 97)).toBe(22);
  });

  it('the healed write is not a foreign change: the current editor’s load and save keep what v2 owns', () => {
    const before = phantomFilm();
    const film = fromStored(before, counted);
    const text = mergeFilmText(serializeProjectForStorage(before), film.sequence);
    const throughCurrentEditor = serializeProjectForStorage(parseStoredProject(text)!);
    expect(ownedSignature(throughCurrentEditor)).toBe(ownedSignature(text));
    expect(fromStored(parseStoredProject(throughCurrentEditor)!, counted).corrected).toEqual([]);
  });

  it('a cut that did not reach the missing picture keeps its length and its seconds', () => {
    const film = fromStored(phantomFilm(48), counted);
    expect((film.sequence.clips[0] as FrameClip).frames).toBe(48);
    const stored = toStored(film.sequence, phantomFilm(48));
    expect(stored.clips[0]!.trimEndSec).toBe(2);
    expect((stored.clips[0] as ComposeClip & { frameV2: FrameV2Block }).frameV2.sourceFrames).toBe(97);
  });

  it('the file’s count corrects a block only at the block’s own rate; at another rate the cut is rebuilt from its seconds', () => {
    // Review round 1 of part E, item 5: a block measured by playback at 30 fps for a 60 fps clip must not
    // keep 30 fps with the file's 60 fps count (the footage's length would double).
    const at30 = phantomFilm(48);
    for (const clip of at30.clips) Object.assign((clip as ComposeClip & { frameV2: FrameV2Block }).frameV2, { sourceFps: 30, fps: 24 });
    const sixty: MeasuredSources = { [SRC]: { fps: 60, frames: 242, counted: true } };
    const film = fromStored(at30, sixty);
    expect(film.corrected).toEqual([]);
    expect(film.derived).toEqual(['cut-1', 'cut-2']);
    expect(film.sequence.clips[0]).toMatchObject({ sourceFps: 60, sourceFrames: 242, frames: 48 });
    // Its seconds stay what they were.
    expect(toStored(film.sequence, at30).clips[0]!.trimEndSec).toBe(2);
    // A block from the old playback measurement says 23.976 where the file says 24000/1001: the same rate.
    const ntsc = phantomFilm();
    for (const clip of ntsc.clips) Object.assign((clip as ComposeClip & { frameV2: FrameV2Block }).frameV2, { sourceFps: 23.976 });
    const corrected = fromStored(ntsc, { [SRC]: { fps: 24000 / 1001, frames: 97, counted: true } });
    expect(corrected.corrected).toEqual(['cut-1', 'cut-2']);
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
