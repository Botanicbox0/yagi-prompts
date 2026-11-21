import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  activeColorGradeForFrame,
  applyTimelinePatches,
  emptyComposerProject,
  parseStoredProject,
  serializeProjectForStorage,
  type ComposeClip,
  type ComposerProject,
} from '@/lib/brand-studio/compose/timeline';
import { ExportSheet } from '@/components/brand-studio/editor-v2/export-sheet';
import { useEditor, type RealFilmOptions } from '@/components/brand-studio/editor-v2/use-editor';
import { notIncluded, soundShiftSec, storedCutFor } from '@/lib/brand-studio/editor-v2/export-plan';
import { splitAtFrame, type FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import { MAX_LINEAGE, fromStored, inheritClip, lineageOf, toStored } from '@/lib/brand-studio/editor-v2/stored';
import { studioEditorKo, type StudioEditorCopy } from '@/messages/studio-editor';

/**
 * Integration of the frame-exact export with the organization's own film (V1, part C).
 *
 * In real mode the export carries the stored film (captions, colour grade, music, effects, still
 * overlays made in the current editor). The current editor scopes a colour grade and a sound offset by
 * clip id; a cut v2 makes by splitting (or copying) gets a new id, so the stored-film bridge copies the
 * parent's fields onto it and records the parent in its line (`frameV2.from`). These tests hold that a
 * v2 split piece keeps the parent's sound offset and stays inside a grade scoped to the parent, through
 * the current editor's own load and save, and that the sheet says nothing of the sample film.
 */
const SRC_A = '/api/brand-studio/compose?organizationId=org&source=asset&id=a';
const SRC_B = '/api/brand-studio/compose?organizationId=org&source=asset&id=b';

function storedClip(id: string, srcUrl: string, extra: Partial<ComposeClip> = {}): ComposeClip {
  return { id, label: id, sourceKind: 'asset', srcUrl, durationSec: 6, trimStartSec: 0, trimEndSec: 6, volume: 1, muted: false, ...extra };
}

/** A film from the current editor: two clips, the first with a sound offset, a grade scoped to it. */
function currentEditorFilm(): ComposerProject {
  const base: ComposerProject = {
    ...emptyComposerProject('9:16'),
    clips: [storedClip('clip-a', SRC_A, { audioOffsetSec: 0.25 }), storedClip('clip-b', SRC_B)],
  };
  return applyTimelinePatches(base, [{ op: 'set_color_grade', enabled: true, scope: 'selected_clip', clipIndex: 0, presetId: 'kodak-2383-warm' }]).project;
}

const measured = { [SRC_A]: { fps: 24, frames: 144 }, [SRC_B]: { fps: 24, frames: 144 } };

/** What use-editor does on a v2 split: the right half takes `newId`, its stored clip inherits from the parent. */
function splitInV2(sequence: FrameSequence, stored: ComposerProject, frame: number, newId: string, known: Record<string, ComposeClip>) {
  const span = sequence.clips.reduce<{ at: number; id: string | null }>(
    (acc, clip) => (acc.id ? acc : frame < acc.at + clip.frames ? { at: acc.at, id: clip.id } : { at: acc.at + clip.frames, id: null }),
    { at: 0, id: null },
  );
  const parent = known[span.id!] ?? stored.clips.find((clip) => clip.id === span.id)!;
  return { sequence: splitAtFrame(sequence, frame, newId), known: { ...known, [newId]: inheritClip(parent, newId) } };
}

const graded = (extras: ComposerProject, sequence: FrameSequence, cutId: string) => {
  const index = sequence.clips.findIndex((clip) => clip.id === cutId);
  return activeColorGradeForFrame(extras, storedCutFor(extras, sequence.clips[index]!, index)) !== null;
};

describe('a v2 split piece keeps what its parent carried into the file', () => {
  const film = currentEditorFilm();
  const opened = fromStored(film, measured).sequence;

  it('the current editor’s grade is scoped to the first clip by id', () => {
    expect(film.colorGrade).toMatchObject({ scope: 'selected_clip', clipId: 'clip-a' });
    expect(opened.clips.map((clip) => clip.id)).toEqual(['clip-a', 'clip-b']);
  });

  it('both halves of a split stay graded and keep the sound offset; the other clip does not', () => {
    const { sequence, known } = splitInV2(opened, film, 60, 'piece-1', {});
    const extras = toStored(sequence, film, { known });
    expect(sequence.clips.map((clip) => clip.id)).toEqual(['clip-a', 'piece-1', 'clip-b']);
    expect(lineageOf(extras.clips[1]!)).toEqual(['clip-a']);
    expect(graded(extras, sequence, 'clip-a')).toBe(true);
    expect(graded(extras, sequence, 'piece-1')).toBe(true);
    expect(graded(extras, sequence, 'clip-b')).toBe(false);
    expect(soundShiftSec(extras, 'clip-a')).toBe(0.25);
    expect(soundShiftSec(extras, 'piece-1')).toBe(0.25);
    expect(soundShiftSec(extras, 'clip-b')).toBe(0);
    // Before this change the piece fell back: matched by its own id, it was neither graded nor shifted.
    const index = sequence.clips.findIndex((clip) => clip.id === 'piece-1');
    expect(extras.clips[index]!.id).toBe('piece-1');
  });

  it('it survives the current editor’s own load and save, and a second save by v2', () => {
    const { sequence, known } = splitInV2(opened, film, 60, 'piece-1', {});
    const throughCurrent = parseStoredProject(serializeProjectForStorage(toStored(sequence, film, { known })))!;
    expect(lineageOf(throughCurrent.clips[1]!)).toEqual(['clip-a']);
    expect(graded(throughCurrent, sequence, 'piece-1')).toBe(true);
    expect(soundShiftSec(throughCurrent, 'piece-1')).toBe(0.25);
    // Reopened in v2 and saved again with no catalogue: the stored clip keeps its own line.
    const again = toStored(fromStored(throughCurrent, measured).sequence, throughCurrent);
    expect(lineageOf(again.clips[1]!)).toEqual(['clip-a']);
    expect(graded(again, sequence, 'piece-1')).toBe(true);
  });

  it('a piece of a piece stays inside the grade; a grade on a piece does not spread to its parent’s other pieces', () => {
    const first = splitInV2(opened, film, 60, 'piece-1', {});
    const second = splitInV2(first.sequence, film, 90, 'piece-2', first.known);
    const extras = toStored(second.sequence, film, { known: second.known });
    expect(lineageOf(extras.clips.find((clip) => clip.id === 'piece-2')!)).toEqual(['piece-1', 'clip-a']);
    expect(graded(extras, second.sequence, 'piece-2')).toBe(true);

    // The current editor moves the grade onto piece-1; then v2 splits clip-a again.
    const onPiece = { ...extras, colorGrade: { ...extras.colorGrade!, clipId: 'piece-1', clipIndex: 1 } };
    const third = splitInV2(second.sequence, onPiece, 20, 'piece-3', second.known);
    const later = toStored(third.sequence, onPiece, { known: third.known });
    expect(graded(later, third.sequence, 'piece-1')).toBe(true);
    expect(graded(later, third.sequence, 'piece-2')).toBe(true);
    expect(graded(later, third.sequence, 'piece-3')).toBe(false);
    expect(graded(later, third.sequence, 'clip-a')).toBe(false);
  });

  it('a new cut of the same footage that was not split from it carries no line', () => {
    const added: FrameSequence = { ...opened, clips: [...opened.clips, { ...opened.clips[0]!, id: 'from-bin' }] };
    const extras = toStored(added, film);
    const fresh = extras.clips.find((clip) => clip.id === 'from-bin')!;
    expect(lineageOf(fresh)).toEqual([]);
    expect(graded(extras, added, 'from-bin')).toBe(false);
  });

  it('the line is bounded', () => {
    let parent: ComposeClip = storedClip('root', SRC_A);
    for (let i = 0; i < MAX_LINEAGE + 10; i += 1) parent = inheritClip(parent, `p${i}`);
    expect(lineageOf(parent)).toHaveLength(MAX_LINEAGE);
    expect(lineageOf(parent)[0]).toBe(`p${MAX_LINEAGE + 8}`);
  });

  it('video overlays and transitions are named as not in the file; the rest of the stored film is', () => {
    const rich: ComposerProject = {
      ...film,
      clips: film.clips.map((clip, index) => (index === 1 ? { ...clip, transitionIn: 'fade' as ComposeClip['transitionIn'] } : clip)),
      overlays: [
        { id: 'o1', label: 'logo', mediaKind: 'image', srcUrl: '/media/logo.png', startSec: 0, endSec: 2, x: 50, y: 50, scale: 30, opacity: 1 } as NonNullable<ComposerProject['overlays']>[number],
        { id: 'o2', label: 'pip', mediaKind: 'video', srcUrl: '/media/pip.mp4', startSec: 0, endSec: 2, x: 50, y: 50, scale: 30, opacity: 1 } as NonNullable<ComposerProject['overlays']>[number],
      ],
    };
    expect(notIncluded({ sequence: opened, doc: null, extras: rich })).toEqual(['videoOverlays', 'transitions']);
    expect(notIncluded({ sequence: opened, doc: null, extras: film })).toEqual([]);
  });
});

describe('the export sheet on the organization’s film', () => {
  const ORG = '00000000-0000-4000-8000-0000000000aa';
  const real = (canEdit: boolean): RealFilmOptions => ({ organizationId: ORG, canEdit, sources: [], sampleBase: `/brand/studio/editor?sample=1&organizationId=${ORG}` });

  function sheet(copy: StudioEditorCopy, film: RealFilmOptions | null): string {
    let api: ReturnType<typeof useEditor> | null = null;
    function Probe() {
      api = useEditor(copy, { real: film, initialWorkspace: 'cut' });
      return null;
    }
    renderToStaticMarkup(h(Probe));
    return renderToStaticMarkup(h(ExportSheet, { api: api! }));
  }

  it('says nothing of the sample film: no findings section, no sample-only rows', () => {
    const html = sheet(studioEditorKo, real(true));
    expect(html).toContain('data-editor-export-sheet');
    expect(html).not.toContain(studioEditorKo.export.checks);
    expect(html).not.toContain(studioEditorKo.export.clear);
    expect(html).not.toContain(studioEditorKo.export.missing.captionLook);
    expect(html).not.toContain(studioEditorKo.notice.body);
  });

  it('people who may only look cannot export, and are told why', () => {
    const html = sheet(studioEditorKo, real(false));
    expect(html).toContain('data-editor-export-blocked="read-only"');
    expect(html).toContain(studioEditorKo.real.readOnly);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-editor-export-start/);
  });

  it('the sample film keeps its checks and can export', () => {
    const html = sheet(studioEditorKo, null);
    expect(html).toContain(studioEditorKo.export.checks);
    expect(html).not.toContain('data-editor-export-blocked');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*data-editor-export-start/);
  });
});
