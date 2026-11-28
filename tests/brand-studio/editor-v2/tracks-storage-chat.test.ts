import { describe, expect, it } from 'vitest';
import {
  applyTimelinePatches,
  emptyComposerProject,
  parseStoredProject,
  sanitizeProjectForPersistence,
  serializeProjectForStorage,
  type ComposeOverlayClip,
  type ComposerProject,
} from '@/lib/brand-studio/compose/timeline';
import {
  applyResolvedStepsToSequence,
  applyRulePatchesToSequence,
} from '@/lib/brand-studio/editor-v2/assist-apply';
import { diffFrameSequences } from '@/lib/brand-studio/editor-v2/assist-diff';
import { buildPlannerProject } from '@/lib/brand-studio/editor-v2/assist-project';
import { notIncluded } from '@/lib/brand-studio/editor-v2/export-plan';
import { removeClips, spansOf, wholeFrameViolations, type FrameClip, type FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import { withSequence } from '@/lib/brand-studio/editor-v2/model';
import { realDoc } from '@/lib/brand-studio/editor-v2/real';
import {
  fromStored,
  hasStoredOwnedOverlays,
  legacyOverlayCountOf,
  ownedSignature,
  overlayFrameBlockOf,
  toStored,
  type StoredOverlayClip,
} from '@/lib/brand-studio/editor-v2/stored';
import {
  MAX_OVERLAY_CLIPS,
  allOverlayClips,
  findOverlayClip,
  liftMainCutToOverlay,
  moveClipUpOneTrack,
  overlayTracksOf,
  p1LinkTargetForStart,
  reconcileLinkedOverlays,
  splitOverlayAtFrame,
  type OverlayClip,
} from '@/lib/brand-studio/editor-v2/tracks';
import { composeBgmHandoff, composeSfxHandoff } from '@/lib/brand-studio/sound/send';
import { fill } from '@/components/brand-studio/copy';
import {
  buildSelectionChips,
  chatContextFromChips,
  evaluateBatch1Utterance,
  validChatExamples,
} from '@/components/brand-studio/editor-v2/chat-model';
import { exportBlockOf, exportBlockSentence } from '@/components/brand-studio/editor-v2/export-sheet';
import { studioEditorKo } from '@/messages/studio-editor';
import { studioEditorChatKo } from '@/messages/studio-editor-chat';
import { studioEditorTracksKo } from '@/messages/studio-editor-tracks';

function clip(id: string, frames = 72, overrides: Partial<FrameClip> = {}): FrameClip {
  return {
    id,
    label: id,
    srcUrl: `https://media.example.invalid/${id}.mp4`,
    thumbUrl: null,
    sourceFps: 24,
    sourceFrames: 240,
    inFrame: 0,
    phase: 0,
    frames,
    speedNum: 1,
    speedDen: 1,
    volume: 1,
    muted: false,
    ...overrides,
  };
}

function legacyProjectWithExtras(): ComposerProject {
  const base = emptyComposerProject('9:16');
  return {
    ...base,
    clips: [
      {
        id: 'c1',
        label: 'Cut 1',
        sourceKind: 'asset',
        assetId: 'a1',
        srcUrl: 'https://media.example.invalid/c1.mp4',
        thumbUrl: null,
        durationSec: 5,
        trimStartSec: 0,
        trimEndSec: 3,
        volume: 1,
        muted: false,
      },
      {
        id: 'c2',
        label: 'Cut 2',
        sourceKind: 'asset',
        assetId: 'a2',
        srcUrl: 'https://media.example.invalid/c2.mp4',
        thumbUrl: null,
        durationSec: 5,
        trimStartSec: 0,
        trimEndSec: 3,
        volume: 1,
        muted: false,
      },
    ],
    overlays: [
      {
        id: 'legacy-vid',
        label: 'Legacy Video',
        sourceKind: 'asset',
        assetId: 'a-legacy',
        srcUrl: 'https://media.example.invalid/legacy.mp4',
        mediaKind: 'video',
        startSec: 0.5,
        endSec: 2.5,
        x: 0.3,
        y: 0.4,
        scale: 0.45,
        opacity: 0.9,
      },
      {
        id: 'still-1',
        label: 'Logo',
        sourceKind: 'asset',
        assetId: 'a-img',
        srcUrl: 'https://media.example.invalid/logo.png',
        mediaKind: 'image',
        startSec: 0,
        endSec: 4,
        x: 0.8,
        y: 0.2,
        scale: 0.25,
        opacity: 1,
      },
    ],
    sfxClips: [
      {
        id: 'sfx-1',
        label: 'Whoosh',
        sourceKind: 'asset',
        assetId: 'a-sfx',
        srcUrl: 'https://media.example.invalid/whoosh.mp3',
        startSec: 1.2,
        durationSec: 1.5,
        volume: 0.8,
      },
    ],
  };
}

describe('E-T Batch T1 — storage round trips (C3, C4, C6, C10)', () => {
  it('C3 & C6: legacy video/image overlays and SFX stay byte-identical when closed and when open but unedited', () => {
    const legacy = legacyProjectWithExtras();
    const measured = {
      'https://media.example.invalid/c1.mp4': { fps: 24, frames: 120 },
      'https://media.example.invalid/c2.mp4': { fps: 24, frames: 120 },
    };

    // Closed switch (`loadOverlays: false, writeOverlays: false`)
    const openedClosed = fromStored(legacy, measured, { loadOverlays: false });
    expect(overlayTracksOf(openedClosed.sequence)).toHaveLength(0);
    const savedClosed = toStored(openedClosed.sequence, legacy, { writeOverlays: false });
    expect(savedClosed.overlays).toEqual(legacy.overlays);
    expect(savedClosed.sfxClips).toEqual(legacy.sfxClips);

    // Open switch (`loadOverlays: true, writeOverlays: true`) without editing
    const openedOpen = fromStored(legacy, measured, { loadOverlays: true });
    expect(overlayTracksOf(openedOpen.sequence)).toHaveLength(0); // Legacy video overlay NOT shown as overlay track!
    expect(hasStoredOwnedOverlays(legacy)).toBe(false);
    const savedOpen = toStored(openedOpen.sequence, legacy, { writeOverlays: true });
    expect(savedOpen.overlays).toEqual(legacy.overlays);
    expect(savedOpen.sfxClips).toEqual(legacy.sfxClips);

    // Legacy video overlay keeps today's export notice and does NOT block export (C3)
    expect(notIncluded({ sequence: openedOpen.sequence, extras: savedOpen })).toContain('videoOverlays');
    expect(
      exportBlockOf({
        real: true,
        readOnly: false,
        empty: false,
        supported: true,
        sequence: openedOpen.sequence,
        unknownRates: {},
        missingSources: {},
      }),
    ).toBeNull();
  });

  it('C4: toStored rewrites startSec/endSec and mirror from resolved start; parseStoredProject/sanitizeProjectForPersistence whitelist frameV2', () => {
    const legacy = legacyProjectWithExtras();
    const measured = {
      'https://media.example.invalid/c1.mp4': { fps: 24, frames: 120 },
      'https://media.example.invalid/c2.mp4': { fps: 24, frames: 120 },
    };
    const opened = fromStored(legacy, measured, { loadOverlays: true });
    // Lift c2 onto overlay track 0 at frame 24 (1.0s)
    const lifted = liftMainCutToOverlay(opened.sequence, 1, { kind: 'new-track', insertTrackIndex: 0 }, 24).seq;
    const saved = toStored(lifted, legacy, { writeOverlays: true });
    const serialized = serializeProjectForStorage(saved);
    const reparsed = parseStoredProject(serialized);
    expect(reparsed).not.toBeNull();

    // Legacy video overlay and still image stayed intact alongside the new owned video overlay.
    expect(reparsed!.overlays?.map((o) => o.id)).toEqual(['legacy-vid', 'still-1', 'c2']);
    const owned = reparsed!.overlays!.find((o) => o.id === 'c2') as StoredOverlayClip;
    const block = overlayFrameBlockOf(owned);
    expect(block).not.toBeNull();
    expect(block!.startFrame).toBe(24);
    expect(block!.link).toEqual({ clipId: 'c1', sourceFrame: 24 });
    expect(owned.startSec).toBe(1);
    expect(owned.endSec).toBe(4);
    expect(block!.mirror).toEqual({ startSec: 1, endSec: 4 });

    // Round-trip back via fromStored restores exact frames & link.
    const reloaded = fromStored(reparsed!, measured, { loadOverlays: true });
    expect(wholeFrameViolations(reloaded.sequence)).toEqual([]);
    expect(allOverlayClips(reloaded.sequence)).toHaveLength(1);
    expect(allOverlayClips(reloaded.sequence)[0]!.startFrame).toBe(24);
    expect(allOverlayClips(reloaded.sequence)[0]!.link).toEqual({ clipId: 'c1', sourceFrame: 24 });

    // Export is blocked ONLY because editor-created overlay clips exist (C3).
    const blockReason = exportBlockOf({
      real: true,
      readOnly: false,
      empty: false,
      supported: true,
      sequence: reloaded.sequence,
      unknownRates: {},
      missingSources: {},
    });
    expect(blockReason).toEqual({ as: 'overlay-tracks', clip: null });
    expect(exportBlockSentence(studioEditorKo, blockReason!, studioEditorTracksKo)).toBe(studioEditorTracksKo.export.blocked);
  });

  it('C4: compose/timeline sanitizeProjectForPersistence is byte-identical for films without frameV2 and drops malformed frameV2', () => {
    const legacy = legacyProjectWithExtras();
    const rawJson = JSON.stringify(sanitizeProjectForPersistence(legacy));
    const reparsed = parseStoredProject(rawJson)!;
    expect(JSON.stringify(sanitizeProjectForPersistence(reparsed))).toBe(rawJson);
    expect('frameV2' in (reparsed.overlays![0] as unknown as Record<string, unknown>)).toBe(false);

    const malformedOverlay: ComposeOverlayClip & { frameV2?: unknown } = {
      ...legacy.overlays![0]!,
      frameV2: { fps: -1, bogus: true },
    };
    const cleaned = sanitizeProjectForPersistence({ ...legacy, overlays: [malformedOverlay] });
    expect('frameV2' in (cleaned.overlays![0] as unknown as Record<string, unknown>)).toBe(false);
  });

  it('main-track-only film toStored output is byte-identical (no overlays key added)', () => {
    const base = emptyComposerProject('9:16');
    const proj: ComposerProject = {
      ...base,
      clips: [
        {
          id: 'c1',
          label: 'Cut 1',
          sourceKind: 'asset',
          assetId: 'a1',
          srcUrl: 'https://media.example.invalid/c1.mp4',
          thumbUrl: null,
          durationSec: 5,
          trimStartSec: 0,
          trimEndSec: 3,
          volume: 1,
          muted: false,
        },
      ],
    };
    const measured = { 'https://media.example.invalid/c1.mp4': { fps: 24, frames: 120 } };
    const seq = fromStored(proj, measured).sequence;
    const savedWriteFalse = serializeProjectForStorage(toStored(seq, proj, { writeOverlays: false }));
    const savedWriteTrue = serializeProjectForStorage(toStored(seq, proj, { writeOverlays: true }));
    expect(savedWriteTrue).toBe(savedWriteFalse);
    expect('overlays' in toStored(seq, proj)).toBe(false);
  });

  it('B3: counts ALL stored overlays (legacy + owned) in limits, never slices silently, and preserves original overlay order', () => {
    const legacyEight: ComposeOverlayClip[] = Array.from({ length: 8 }, (_, i) => ({
      id: `still-${i + 1}`,
      label: `Still ${i + 1}`,
      sourceKind: 'asset' as const,
      assetId: `img-${i + 1}`,
      srcUrl: `https://media.example.invalid/s${i + 1}.png`,
      mediaKind: 'image' as const,
      startSec: 0,
      endSec: 2,
      x: 0.5,
      y: 0.5,
      scale: 0.3,
      opacity: 1,
    }));
    const proj: ComposerProject = {
      ...legacyProjectWithExtras(),
      clips: Array.from({ length: 6 }, (_, i) => ({
        id: `c${i + 1}`,
        label: `Cut ${i + 1}`,
        sourceKind: 'asset' as const,
        assetId: `a${i + 1}`,
        srcUrl: `https://media.example.invalid/c${i + 1}.mp4`,
        thumbUrl: null,
        durationSec: 5,
        trimStartSec: 0,
        trimEndSec: 3,
        volume: 1,
        muted: false,
      })),
      overlays: legacyEight,
    };
    const measured = Object.fromEntries(
      proj.clips.map((c) => [c.srcUrl, { fps: 24, frames: 120 }]),
    );
    const opened = fromStored(proj, measured, { loadOverlays: true });
    const legacyCount = legacyOverlayCountOf(proj);
    expect(legacyCount).toBe(8);
    const maxOwned = MAX_OVERLAY_CLIPS - legacyCount; // 4 slots remaining!

    // Lift 4 main cuts into overlay tracks -> succeeds cleanly (8 legacy + 4 owned = 12).
    let seq = opened.sequence;
    for (let k = 0; k < 4; k += 1) {
      const lifted = liftMainCutToOverlay(
        seq,
        seq.clips.length - 1,
        k === 0 ? { kind: 'new-track', insertTrackIndex: 0 } : { kind: 'overlay-row', trackIndex: 0 },
        k * 80,
        { maxOwnedOverlays: maxOwned },
      );
      expect(lifted.ok, `lift ${k}`).toBe(true);
      seq = lifted.seq;
    }
    // 5th lift OR splitting an owned overlay MUST be refused with 'overlay_limit' (no silent drop on save).
    const refusedLift = liftMainCutToOverlay(seq, 1, { kind: 'overlay-row', trackIndex: 0 }, 320, { maxOwnedOverlays: maxOwned });
    expect(refusedLift).toMatchObject({ ok: false, refused: 'overlay_limit' });
    const refusedSplit = splitOverlayAtFrame(seq, 'c6', 24, 'c6-r', maxOwned);
    expect(refusedSplit).toMatchObject({ ok: false, refused: 'overlay_limit' });

    // Interleaved order preservation: [still-1, ownedA, still-2] stays [still-1, ownedA, still-2] after edit + save!
    const saved = toStored(seq, proj, { writeOverlays: true });
    expect(saved.overlays?.length).toBe(12);
    const ownedFirst = saved.overlays!.find((o) => o.id === 'c6')!;
    const interleavedProj: ComposerProject = {
      ...proj,
      overlays: [legacyEight[0]!, ownedFirst, legacyEight[1]!],
    };
    const reopened = fromStored(interleavedProj, measured, { loadOverlays: true });
    const resaved = toStored(reopened.sequence, interleavedProj, { writeOverlays: true });
    expect(resaved.overlays?.map((o) => o.id)).toEqual(['still-1', 'c6', 'still-2']);
  });

  it('W6: 10 legacy image overlays + 2 owned clips at cap refuses 3rd owned lift/split with sentence, drops nothing on save, keeps order', () => {
    const legacyTen: ComposeOverlayClip[] = Array.from({ length: 10 }, (_, i) => ({
      id: `still-${i + 1}`,
      label: `Still ${i + 1}`,
      sourceKind: 'asset' as const,
      assetId: `img-${i + 1}`,
      srcUrl: `https://media.example.invalid/s${i + 1}.png`,
      mediaKind: 'image' as const,
      startSec: 0,
      endSec: 2,
      x: 0.5,
      y: 0.5,
      scale: 0.3,
      opacity: 1,
    }));
    const proj: ComposerProject = {
      ...emptyComposerProject('9:16'),
      clips: Array.from({ length: 4 }, (_, i) => ({
        id: `c${i + 1}`,
        label: `Cut ${i + 1}`,
        sourceKind: 'asset' as const,
        assetId: `a${i + 1}`,
        srcUrl: `https://media.example.invalid/c${i + 1}.mp4`,
        thumbUrl: null,
        durationSec: 5,
        trimStartSec: 0,
        trimEndSec: 3,
        volume: 1,
        muted: false,
      })),
      overlays: legacyTen,
    };
    const measured = Object.fromEntries(proj.clips.map((c) => [c.srcUrl, { fps: 24, frames: 120 }]));
    const opened = fromStored(proj, measured, { loadOverlays: true });
    expect(legacyOverlayCountOf(proj)).toBe(10);
    const maxOwned = MAX_OVERLAY_CLIPS - legacyOverlayCountOf(proj); // 2 slots left
    expect(maxOwned).toBe(2);

    // Lift 2 clips -> reaches 10 + 2 = 12 cap.
    const lift1 = liftMainCutToOverlay(opened.sequence, 3, { kind: 'new-track', insertTrackIndex: 0 }, 0, { maxOwnedOverlays: maxOwned });
    expect(lift1.ok).toBe(true);
    const lift2 = liftMainCutToOverlay(lift1.seq, 2, { kind: 'overlay-row', trackIndex: 0 }, 80, { maxOwnedOverlays: maxOwned });
    expect(lift2.ok).toBe(true);

    // 3rd owned lift AND split of an existing owned clip MUST be refused with 'overlay_limit' + exact refusal sentence.
    const refusedLift = liftMainCutToOverlay(lift2.seq, 1, { kind: 'overlay-row', trackIndex: 0 }, 160, { maxOwnedOverlays: maxOwned });
    expect(refusedLift).toEqual({ ok: false, refused: 'overlay_limit', seq: lift2.seq });
    const refusedSplit = splitOverlayAtFrame(lift2.seq, 'c4', 24, 'c4-r', maxOwned);
    expect(refusedSplit).toEqual({ ok: false, refused: 'overlay_limit', seq: lift2.seq });
    expect(fill(studioEditorTracksKo.toast.overlayLimit, { max: MAX_OVERLAY_CLIPS })).toContain('12');

    // Save through serializeProjectForStorage -> drops NOTHING (all 12 kept) and preserves exact order!
    const saved = toStored(lift2.seq, proj, { writeOverlays: true });
    const reparsed = parseStoredProject(serializeProjectForStorage(saved))!;
    expect(reparsed.overlays?.map((o) => o.id)).toEqual([
      ...legacyTen.map((s) => s.id),
      'c4',
      'c3',
    ]);
  });

  it('B1: serializeProjectForStorage preserves valid overlay speedCurve (leadMedia, tailMedia, 20 points) byte-for-byte across new editor, old editor, and sound studio writes', () => {
    const base = legacyProjectWithExtras();
    const measured = {
      'https://media.example.invalid/c1.mp4': { fps: 24, frames: 240 },
      'https://media.example.invalid/c2.mp4': { fps: 24, frames: 240 },
    };
    const opened = fromStored(base, measured);
    const lifted = liftMainCutToOverlay(opened.sequence, 1, { kind: 'new-track', insertTrackIndex: 0 }, 24).seq;
    const saved = toStored(lifted, base);
    const owned = saved.overlays!.find((o) => o.id === 'c2') as StoredOverlayClip;

    // 20-point curve with leadMedia, tailMedia, and sourceDomain (valid under editor-v2's `isValidSpeedCurve`).
    const points20 = Array.from({ length: 20 }, (_, i) => ({
      pos: i === 19 ? 1 : Number((i / 19).toFixed(6)),
      speed: Number((0.5 + (i % 5) * 0.4).toFixed(2)),
    }));
    const richCurve = {
      startMedia: 24,
      spanMedia: 72,
      leadMedia: 12,
      tailMedia: 12,
      sourceDomain: {
        startMedia: 12,
        spanMedia: 96,
        points: points20,
      },
      points: points20,
    };
    const withRichCurve: StoredOverlayClip = {
      ...owned,
      frameV2: {
        ...owned.frameV2!,
        speedCurve: richCurve,
      },
    };
    const projectWithCurve: ComposerProject = {
      ...saved,
      overlays: [withRichCurve],
    };
    const expectedBlockBytes = JSON.stringify(withRichCurve.frameV2);

    // 1. New editor save (`serializeProjectForStorage` directly on stored project)
    const newEditorJson = serializeProjectForStorage(projectWithCurve);
    const afterNewEditor = parseStoredProject(newEditorJson)!;
    const blockAfterNew = (afterNewEditor.overlays![0] as StoredOverlayClip).frameV2;
    expect(JSON.stringify(blockAfterNew)).toBe(expectedBlockBytes);
    expect(overlayFrameBlockOf(afterNewEditor.overlays![0]!)).not.toBeNull();

    // 2. Old editor save (`parseStoredProject` -> `serializeProjectForStorage`)
    const oldEditorJson = serializeProjectForStorage(afterNewEditor);
    const afterOldEditor = parseStoredProject(oldEditorJson)!;
    expect(JSON.stringify((afterOldEditor.overlays![0] as StoredOverlayClip).frameV2)).toBe(expectedBlockBytes);

    // 3. Sound Studio writes (BGM + SFX handoffs -> `serializeProjectForStorage`)
    const bgmRes = composeBgmHandoff(
      newEditorJson,
      { assetId: 'bgm-9', label: 'Track 9', seconds: 20, srcUrl: 'https://media.example.invalid/bgm9.mp3' },
      true,
    );
    expect(bgmRes.status).toBe('placed');
    if (bgmRes.status !== 'placed') return;
    const sfxRes = composeSfxHandoff(
      bgmRes.stored,
      { assetId: 'sfx-9', label: 'Hit', seconds: 1, srcUrl: 'https://media.example.invalid/hit.wav' },
      'sfx-9',
    );
    expect(sfxRes.status).toBe('placed');
    if (sfxRes.status !== 'placed') return;
    const afterSoundStudio = parseStoredProject(sfxRes.stored)!;
    expect(JSON.stringify((afterSoundStudio.overlays![0] as StoredOverlayClip).frameV2)).toBe(expectedBlockBytes);
    expect(overlayFrameBlockOf(afterSoundStudio.overlays![0]!)).not.toBeNull();

    // 4. S3: Old editor REAL edit path (`applyTimelinePatches`) editing something else (aspect + main clip trim)
    // preserves the 20-point curve with leadMedia/tailMedia byte-for-byte!
    const patched = applyTimelinePatches(afterNewEditor, [
      { op: 'set_aspect', aspect: '16:9' },
      { op: 'trim_clip', clipIndex: 0, trimStartSec: 0.2, trimEndSec: 2.8 },
    ]);
    expect(patched.appliedCount).toBe(2);
    expect(patched.project.aspect).toBe('16:9');
    const afterOldEdit = parseStoredProject(serializeProjectForStorage(patched.project))!;
    expect(JSON.stringify((afterOldEdit.overlays![0] as StoredOverlayClip).frameV2)).toBe(expectedBlockBytes);
    expect(overlayFrameBlockOf(afterOldEdit.overlays![0]!)).not.toBeNull();

    // 5. S4: Sanitizer strips unknown keys on `speedCurve` / `points` / `sourceDomain` AND returns a clean copy (no shared reference).
    const dirtyCurve = {
      ...richCurve,
      extraJunk: 'should-not-persist',
      points: richCurve.points.map((pt, idx) => (idx === 0 ? { ...pt, unknownPtFlag: true } : { ...pt })),
      sourceDomain: {
        ...richCurve.sourceDomain,
        extraDomainKey: 123,
      },
    };
    const dirtyOverlay: StoredOverlayClip = {
      ...withRichCurve,
      frameV2: { ...withRichCurve.frameV2!, speedCurve: dirtyCurve },
    };
    const dirtyProject: ComposerProject = {
      ...saved,
      overlays: [dirtyOverlay],
    };
    const cleaned = sanitizeProjectForPersistence(dirtyProject);
    const cleanedCurve = (cleaned.overlays![0] as StoredOverlayClip).frameV2?.speedCurve as unknown as Record<string, unknown>;
    expect(cleanedCurve).toBeDefined();
    expect('extraJunk' in cleanedCurve).toBe(false);
    expect('unknownPtFlag' in ((cleanedCurve.points as Array<Record<string, unknown>>)[0]!)).toBe(false);
    expect('extraDomainKey' in (cleanedCurve.sourceDomain as Record<string, unknown>)).toBe(false);
    expect(JSON.stringify((cleaned.overlays![0] as StoredOverlayClip).frameV2)).toBe(expectedBlockBytes);
    // Mutating the input curve object must NOT mutate the sanitized copy!
    dirtyCurve.leadMedia = 999;
    dirtyCurve.points[0]!.speed = 9.99;
    expect((cleanedCurve as { leadMedia?: number }).leadMedia).toBe(12);
    expect(((cleanedCurve.points as Array<{ speed: number }>)[0]!).speed).toBe(richCurve.points[0]!.speed);
  });

  it('SMALL: malformed speedCurve on a stored overlay falls back to constant speed without hiding the clip', () => {
    const base = legacyProjectWithExtras();
    const measured = {
      'https://media.example.invalid/c1.mp4': { fps: 24, frames: 120 },
      'https://media.example.invalid/c2.mp4': { fps: 24, frames: 120 },
    };
    const opened = fromStored(base, measured);
    const lifted = liftMainCutToOverlay(opened.sequence, 1, { kind: 'new-track', insertTrackIndex: 0 }, 24).seq;
    const saved = toStored(lifted, base);
    const owned = saved.overlays!.find((o) => o.id === 'c2') as StoredOverlayClip;
    const corrupted: StoredOverlayClip = {
      ...owned,
      frameV2: {
        ...owned.frameV2!,
        // Bad speedCurve (unordered points, negative speed)
        speedCurve: {
          startMedia: 0,
          spanMedia: 72,
          points: [
            { pos: 0.5, speed: -2 },
            { pos: 0.2, speed: 500 },
          ],
        },
      },
    };
    // Both sanitizeProjectForPersistence and overlayFrameBlockOf drop ONLY the bad speedCurve and keep the clip!
    const sanitized = sanitizeProjectForPersistence({ ...saved, overlays: [corrupted] });
    const sanBlock = overlayFrameBlockOf(sanitized.overlays![0]!);
    expect(sanBlock).not.toBeNull();
    expect(sanBlock?.speedCurve).toBeUndefined();
    const directBlock = overlayFrameBlockOf(corrupted);
    expect(directBlock).not.toBeNull();
    expect(directBlock?.speedCurve).toBeUndefined();
    const reloaded = fromStored({ ...saved, overlays: [corrupted] }, measured);
    expect(allOverlayClips(reloaded.sequence).map((c) => c.id)).toEqual(['c2']);
    expect(findOverlayClip(reloaded.sequence, 'c2')?.clip.speedCurve).toBeUndefined();
  });

  it('S5: closed tracks switch still blocks export when stored film carries owned frameV2 overlays', () => {
    const base = legacyProjectWithExtras();
    const measured = {
      'https://media.example.invalid/c1.mp4': { fps: 24, frames: 120 },
      'https://media.example.invalid/c2.mp4': { fps: 24, frames: 120 },
    };
    const lifted = liftMainCutToOverlay(fromStored(base, measured).sequence, 1, { kind: 'new-track', insertTrackIndex: 0 }, 24).seq;
    const storedWithOwned = toStored(lifted, base);
    // Later, the tracks switch is closed -> fromStored loads 0 overlayTracks, but storedHasOwnedOverlays is true!
    const reopenedClosed = fromStored(storedWithOwned, measured, { loadOverlays: false });
    expect(overlayTracksOf(reopenedClosed.sequence)).toHaveLength(0);
    expect(hasStoredOwnedOverlays(storedWithOwned)).toBe(true);
    const block = exportBlockOf({
      real: true,
      readOnly: false,
      empty: false,
      supported: true,
      sequence: reopenedClosed.sequence,
      unknownRates: {},
      missingSources: {},
      storedHasOwnedOverlays: hasStoredOwnedOverlays(storedWithOwned),
    });
    expect(block).toEqual({ as: 'overlay-tracks', clip: null });
    expect(exportBlockSentence(studioEditorKo, block!, null)).toBe(studioEditorTracksKo.export.blocked);
  });

  it('C10: ownedSignature includes owned overlays while ignoring Sound Studio BGM/SFX edits', () => {
    const base = legacyProjectWithExtras();
    const measured = {
      'https://media.example.invalid/c1.mp4': { fps: 24, frames: 120 },
      'https://media.example.invalid/c2.mp4': { fps: 24, frames: 120 },
    };
    const opened = fromStored(base, measured);
    const lifted = liftMainCutToOverlay(opened.sequence, 1, { kind: 'new-track', insertTrackIndex: 0 }, 24).seq;
    const withOwned = toStored(lifted, base);
    const textWithOwned = serializeProjectForStorage(withOwned);

    // Sound Studio adds BGM and another SFX -> ownedSignature stays identical!
    const afterSoundStudio: ComposerProject = {
      ...withOwned,
      bgm: {
        label: 'Beat',
        sourceKind: 'asset',
        assetId: 'bgm-1',
        srcUrl: 'https://media.example.invalid/beat.mp3',
        durationSec: 30,
        trimStartSec: 0,
        volume: 0.4,
      },
      sfxClips: [
        ...(withOwned.sfxClips ?? []),
        {
          id: 'sfx-2',
          label: 'Pop',
          sourceKind: 'asset',
          assetId: 'a-pop',
          srcUrl: 'https://media.example.invalid/pop.mp3',
          startSec: 2,
          durationSec: 0.5,
          volume: 0.7,
        },
      ],
    };
    expect(ownedSignature(serializeProjectForStorage(afterSoundStudio))).toBe(ownedSignature(textWithOwned));

    // Stale tab strips owned overlay -> ownedSignature differs!
    const staleStripped: ComposerProject = {
      ...withOwned,
      overlays: withOwned.overlays?.filter((o) => o.id !== 'c2'),
    };
    expect(ownedSignature(serializeProjectForStorage(staleStripped))).not.toBe(ownedSignature(textWithOwned));
  });
});

describe('E-T Batch T1 — chat C9 honesty', () => {
  const makeMultiTrackSeq = (): FrameSequence => {
    const main = [clip('m1', 72), clip('m2', 72), clip('m3', 72)];
    const base: FrameSequence = { fps: 24, aspect: '9:16', clips: main, captions: [] };
    const ovOnM2: OverlayClip = { ...clip('ov2', 36), startFrame: 80, link: p1LinkTargetForStart(base, 80) };
    const ovOnM3: OverlayClip = { ...clip('ov3', 36), startFrame: 150, link: p1LinkTargetForStart(base, 150) };
    return { ...base, overlayTracks: [{ id: 'ov-1', clips: [ovOnM2, ovOnM3] }] };
  };

  it('C9: planner project, validChatExamples, and selection chips stay main-track-only', () => {
    const seq = makeMultiTrackSeq();
    const plannerProj = buildPlannerProject(seq);
    expect(plannerProj.clips.map((c) => c.id)).toEqual(['m1', 'm2', 'm3']);
    expect(plannerProj.overlays).toBeUndefined();

    const examples = validChatExamples(seq, studioEditorKo, studioEditorChatKo);
    expect(examples.every((e) => !e.text.includes('ov2') && !e.text.includes('ov3'))).toBe(true);

    // Selecting an overlay clip does NOT emit a cut chip or send selectedClipId to the planner.
    const chips = buildSelectionChips({ sequence: seq, selection: ['ov2'], playhead: 24, chatCopy: studioEditorChatKo });
    expect(chips.every((c) => c.kind !== 'cut')).toBe(true);
    expect(chatContextFromChips(chips).selectedClipId).toBeUndefined();
  });

  it('B1 & C9: chat mappers return unadjusted sequence so draft preview and Apply move linked overlays ONCE (exact final frames)', () => {
    // Exact B1 reproduction: cuts A (48f) and B (72f), overlay ovB on B at frame 60, "1번 컷 지워 줘" (linkage ON).
    // Card & draft preview & post-Apply MUST all put ovB at frame 12 (NOT double-moved to 0!).
    const baseMain: FrameSequence = { fps: 24, aspect: '9:16', clips: [clip('A', 48), clip('B', 72)], captions: [] };
    const ovB: OverlayClip = { ...clip('ovB', 30), startFrame: 60, link: p1LinkTargetForStart(baseMain, 60) };
    const seqAB: FrameSequence = { ...baseMain, overlayTracks: [{ id: 'ov-1', clips: [ovB] }] };

    const mappedAB = applyResolvedStepsToSequence(seqAB, [{ do: 'remove', clip: { clipId: 'A' } }], { linkage: true });
    expect(mappedAB.ok).toBe(true);
    if (!mappedAB.ok) return;
    // Mapper returned UNADJUSTED overlay start (still 60) so `withSequence` adjusts ONCE!
    expect(findOverlayClip(mappedAB.sequence, 'ovB')?.clip.startFrame).toBe(60);

    const previewReconciled = reconcileLinkedOverlays(seqAB, mappedAB.sequence, true, mappedAB.inherit).sequence;
    const draftPreviewDoc = withSequence(realDoc(seqAB), mappedAB.sequence, mappedAB.inherit, { linkage: true });
    const appliedDoc = withSequence(realDoc(seqAB), mappedAB.sequence, mappedAB.inherit, { linkage: true });
    expect(findOverlayClip(previewReconciled, 'ovB')?.clip.startFrame).toBe(12);
    expect(findOverlayClip(draftPreviewDoc.sequence, 'ovB')?.clip.startFrame).toBe(12);
    expect(findOverlayClip(appliedDoc.sequence, 'ovB')?.clip.startFrame).toBe(12);

    // Same for local kill-switch fallback (`evaluateBatch1Utterance`).
    const localAB = evaluateBatch1Utterance(
      '첫 번째 컷 지워줘',
      seqAB,
      { selectedClipIds: ['A'] },
      studioEditorKo,
      studioEditorChatKo,
      { linkage: true, tracksCopy: studioEditorTracksKo },
    );
    expect(localAB.kind).toBe('proposal');
    if (localAB.kind === 'proposal') {
      expect(localAB.lines).toContain('오버레이 트랙 클립 1개가 함께 이동해요');
      const localDraft = withSequence(realDoc(seqAB), localAB.nextSequence, [], { linkage: true });
      const localApplied = withSequence(realDoc(seqAB), localAB.nextSequence, [], { linkage: true });
      expect(findOverlayClip(localDraft.sequence, 'ovB')?.clip.startFrame).toBe(12);
      expect(findOverlayClip(localApplied.sequence, 'ovB')?.clip.startFrame).toBe(12);
    }

    // S2: restore sample-path assertion for "오버레이 트랙 클립 1개가 함께 삭제돼요" when removing a cut that owns a linked overlay.
    const sampleSeq = makeMultiTrackSeq();
    const localDeleteOwned = evaluateBatch1Utterance(
      '마지막 컷 지워줘',
      sampleSeq,
      { selectedClipIds: [] },
      studioEditorKo,
      studioEditorChatKo,
      { linkage: true, tracksCopy: studioEditorTracksKo },
    );
    expect(localDeleteOwned.kind).toBe('proposal');
    if (localDeleteOwned.kind === 'proposal') {
      expect(localDeleteOwned.lines).toContain('오버레이 트랙 클립 1개가 함께 삭제돼요');
      // W5: cut removal MUST NOT show `overlaysExtendPastMain` even if overlays extend past the shortened main track.
      expect(localDeleteOwned.lines.some((l) => l.includes('까지 이어져요'))).toBe(false);
    }

    // Also verify 3-cut delete (m2 deletes ov2 and shifts ov3 left once).
    const seq = makeMultiTrackSeq();
    const mapped = applyResolvedStepsToSequence(seq, [{ do: 'remove', clip: { clipId: 'm2' } }], { linkage: true });
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    const reconciled = reconcileLinkedOverlays(seq, mapped.sequence, true, mapped.inherit).sequence;
    const lines = diffFrameSequences(seq, reconciled, studioEditorKo, studioEditorChatKo, mapped.inherit, studioEditorTracksKo);
    expect(lines).toContain('오버레이 트랙 클립 1개가 함께 이동해요');
    expect(lines).toContain('오버레이 트랙 클립 1개가 함께 삭제돼요');
    const committed = withSequence(realDoc(seq), mapped.sequence, mapped.inherit, { linkage: true });
    expect(spansOf(committed.sequence).map((s) => s.clip.id)).toEqual(['m1', 'm3']);
    expect(allOverlayClips(committed.sequence).map((c) => c.id)).toEqual(['ov3']);
    expect(findOverlayClip(committed.sequence, 'ov3')?.clip.startFrame).toBe(150 - 72);

    // Linkage OFF (and default omitted option): neither moved nor deleted summary line appears, ov3 stays at 150.
    const mappedOff = applyResolvedStepsToSequence(seq, [{ do: 'remove', clip: { clipId: 'm2' } }]);
    expect(mappedOff.ok).toBe(true);
    if (!mappedOff.ok) return;
    const reconciledOff = reconcileLinkedOverlays(seq, mappedOff.sequence, false, mappedOff.inherit).sequence;
    const linesOff = diffFrameSequences(seq, reconciledOff, studioEditorKo, studioEditorChatKo, mappedOff.inherit, studioEditorTracksKo);
    expect(linesOff).not.toContain('오버레이 트랙 클립 1개가 함께 이동해요');
    expect(linesOff).not.toContain('오버레이 트랙 클립 1개가 함께 삭제돼요');
    const committedOff = withSequence(realDoc(seq), mappedOff.sequence, mappedOff.inherit, { linkage: false });
    expect(findOverlayClip(committedOff.sequence, 'ov3')?.clip.startFrame).toBe(150);
  });

  it('S8 & W11: chat card reports when overlays extend past main end AND names the moved cut on 2-cut reorder', () => {
    // S8: 2 cuts of 240f (20s total); overlay sits at 360..480 (15s..20s). fit_total to 15s (360f) with linkage OFF.
    const longMain: FrameSequence = {
      fps: 24,
      aspect: '9:16',
      clips: [clip('c1', 240, { sourceFrames: 480 }), clip('c2', 240, { sourceFrames: 480 })],
      captions: [],
    };
    const longOv: OverlayClip = { ...clip('ovTail', 120, { sourceFrames: 240 }), startFrame: 360, link: p1LinkTargetForStart(longMain, 360) };
    const longSeq: FrameSequence = { ...longMain, overlayTracks: [{ id: 'ov-1', clips: [longOv] }] };

    const fit = applyResolvedStepsToSequence(longSeq, [{ do: 'fit_total', seconds: 15 }], { linkage: false });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.affectsFilmLength).toBe(true);
    const fitReconciled = reconcileLinkedOverlays(longSeq, fit.sequence, false, fit.inherit).sequence;
    const fitLines = diffFrameSequences(
      longSeq,
      fitReconciled,
      studioEditorKo,
      studioEditorChatKo,
      fit.inherit,
      studioEditorTracksKo,
      fit.movedClipIds,
      fit.affectsFilmLength,
    );
    expect(fitLines).toContain('오버레이 트랙 클립이 0:20:00까지 이어져요');

    // W5: even_pace also targets overall pacing/length -> shows `overlaysExtendPastMain`; cut REMOVAL does NOT!
    const pace = applyResolvedStepsToSequence(longSeq, [{ do: 'even_pace', secondsPerClip: 5 }], { linkage: false });
    expect(pace.ok).toBe(true);
    if (!pace.ok) return;
    expect(pace.affectsFilmLength).toBe(true);
    const paceReconciled = reconcileLinkedOverlays(longSeq, pace.sequence, false, pace.inherit).sequence;
    const paceLines = diffFrameSequences(
      longSeq,
      paceReconciled,
      studioEditorKo,
      studioEditorChatKo,
      pace.inherit,
      studioEditorTracksKo,
      pace.movedClipIds,
      pace.affectsFilmLength,
    );
    expect(paceLines).toContain('오버레이 트랙 클립이 0:20:00까지 이어져요');

    const removed = applyResolvedStepsToSequence(longSeq, [{ do: 'remove', clip: { clipId: 'c2' } }], { linkage: false });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.affectsFilmLength).toBeUndefined();
    const removedReconciled = reconcileLinkedOverlays(longSeq, removed.sequence, false, removed.inherit).sequence;
    const removedLines = diffFrameSequences(
      longSeq,
      removedReconciled,
      studioEditorKo,
      studioEditorChatKo,
      removed.inherit,
      studioEditorTracksKo,
      removed.movedClipIds,
      removed.affectsFilmLength,
    );
    expect(removedLines.some((l) => l.includes('까지 이어져요'))).toBe(false);

    // W11: "두 번째 컷을 맨 앞으로" (move step targeting c2 -> first) reports "2번 컷을 1번 자리로 옮기기", NOT "1번 컷을 2번 자리로 옮기기"!
    const twoCuts: FrameSequence = { fps: 24, aspect: '9:16', clips: [clip('c1', 72), clip('c2', 72)], captions: [] };
    const movedStep = applyResolvedStepsToSequence(twoCuts, [{ do: 'move', clip: { clipId: 'c2' }, to: 'first' }]);
    expect(movedStep.ok).toBe(true);
    if (!movedStep.ok) return;
    const stepLines = diffFrameSequences(
      twoCuts,
      movedStep.sequence,
      studioEditorKo,
      studioEditorChatKo,
      movedStep.inherit,
      studioEditorTracksKo,
      movedStep.movedClipIds,
    );
    expect(stepLines).toEqual(['2번 컷을 1번 자리로 옮기기']);

    // Same for rule-path `move_clip` patch (fromIndex: 1 -> toIndex: 0).
    const movedPatch = applyRulePatchesToSequence(twoCuts, [{ op: 'move_clip', fromIndex: 1, toIndex: 0 }], twoCuts);
    expect(movedPatch.ok).toBe(true);
    if (!movedPatch.ok) return;
    const patchLines = diffFrameSequences(
      twoCuts,
      movedPatch.sequence,
      studioEditorKo,
      studioEditorChatKo,
      movedPatch.inherit,
      studioEditorTracksKo,
      movedPatch.movedClipIds,
    );
    expect(patchLines).toEqual(['2번 컷을 1번 자리로 옮기기']);
  });

  it('moveClipUpOneTrack followed by toStored persists trackIndex cleanly', () => {
    const base = emptyComposerProject('9:16');
    const seq: FrameSequence = { fps: 24, aspect: '9:16', clips: [clip('a', 48), clip('b', 48)], captions: [] };
    const up = moveClipUpOneTrack(seq, 'b');
    expect(up.ok).toBe(true);
    const stored = toStored(up.seq, base);
    expect(stored.overlays?.length).toBe(1);
    expect(overlayFrameBlockOf(stored.overlays![0]!)?.trackIndex).toBe(0);
  });
});
