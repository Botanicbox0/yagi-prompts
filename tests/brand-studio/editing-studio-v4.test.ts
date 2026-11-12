import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VideoComposer } from '@/components/brand-studio/compose/video-composer';
import {
  OPEN_SHARE_REVIEW_EVENT,
  normalizeShareReviewDetail,
  openShareReview,
} from '@/components/brand-studio/share-review-dialog';
import {
  GRADE_PRESETS,
  appendClip,
  applyTimelinePatches,
  cssFilterForColorGrade,
  emptyComposerProject,
  frameStateAtTime,
  parseComposeChatCommand,
  parseStoredProject,
  playheadClipSplitTarget,
  projectDurationSec,
  serializeProjectForStorage,
  splittableCutMediaSecs,
  toColorGradeSpec,
  type ComposerProject,
} from '@/lib/brand-studio/compose';
import { applyProjectColorGradeFrame } from '@/lib/brand-studio/compose/export-client';
import type { LibraryFolderWire, LibraryItemWire } from '@/lib/brand-studio/library-contracts';
import { lintPublicBrandSurface } from '@/lib/brands/qa/hardline-lint';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { allowance, asset, ORG, output } from './ui/fixtures';

const koDict = getDictionary('ko');
const enDict = getDictionary('en');

function sampleProjectWithTwoClips(): ComposerProject {
  let p = emptyComposerProject('9:16');
  p = appendClip(p, {
    id: 'clip_one',
    label: '런웨이 오프닝',
    sourceKind: 'output',
    outputId: '00000000-0000-4000-8000-000000000101',
    srcUrl: `/api/brand-studio/compose?organizationId=${ORG}&source=output&id=00000000-0000-4000-8000-000000000101`,
    thumbUrl: null,
    durationSec: 10,
    trimStartSec: 0,
    trimEndSec: 10,
    volume: 1,
    muted: false,
    cutMarkers: [0.2, 2.8, 6.4, 9.8],
  });
  p = appendClip(p, {
    id: 'clip_two',
    label: '제품 클로즈업',
    sourceKind: 'asset',
    assetId: '00000000-0000-4000-8000-000000000202',
    srcUrl: `/api/brand-studio/compose?organizationId=${ORG}&source=asset&id=00000000-0000-4000-8000-000000000202`,
    thumbUrl: null,
    durationSec: 5,
    trimStartSec: 0,
    trimEndSec: 5,
    volume: 1,
    muted: false,
  });
  return p;
}

function makeFakeCanvasContext(width: number, height: number, fillRgba: [number, number, number, number]) {
  const buffer = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < buffer.length; i += 4) {
    buffer[i] = fillRgba[0];
    buffer[i + 1] = fillRgba[1];
    buffer[i + 2] = fillRgba[2];
    buffer[i + 3] = fillRgba[3];
  }

  const ctx = {
    getImageData(rx: number, ry: number, rw: number, rh: number) {
      const slice = new Uint8ClampedArray(rw * rh * 4);
      for (let y = 0; y < rh; y += 1) {
        for (let x = 0; x < rw; x += 1) {
          const srcIdx = ((ry + y) * width + (rx + x)) * 4;
          const dstIdx = (y * rw + x) * 4;
          slice[dstIdx] = buffer[srcIdx]!;
          slice[dstIdx + 1] = buffer[srcIdx + 1]!;
          slice[dstIdx + 2] = buffer[srcIdx + 2]!;
          slice[dstIdx + 3] = buffer[srcIdx + 3]!;
        }
      }
      return { data: slice, width: rw, height: rh } as ImageData;
    },
    putImageData(img: ImageData, rx: number, ry: number) {
      for (let y = 0; y < img.height; y += 1) {
        for (let x = 0; x < img.width; x += 1) {
          const srcIdx = (y * img.width + x) * 4;
          const dstIdx = ((ry + y) * width + (rx + x)) * 4;
          buffer[dstIdx] = img.data[srcIdx]!;
          buffer[dstIdx + 1] = img.data[srcIdx + 1]!;
          buffer[dstIdx + 2] = img.data[srcIdx + 2]!;
          buffer[dstIdx + 3] = img.data[srcIdx + 3]!;
        }
      }
    },
  } as unknown as CanvasRenderingContext2D;

  const pixelAt = (x: number, y: number): [number, number, number, number] => {
    const idx = (y * width + x) * 4;
    return [buffer[idx]!, buffer[idx + 1]!, buffer[idx + 2]!, buffer[idx + 3]!];
  };

  return { ctx, pixelAt };
}

describe('Editing Studio v4 — 1. Unified 4-Source Media Browser (Recent · Likes · Folders · Uploads)', () => {
  const videoOut = {
    ...output(1, { kind: 'video', seconds: 6, url: '/api/brand-studio/media/st/vid1.mp4' }),
    label: '세럼 런웨이 샷',
  };
  const imageOut = {
    ...output(2, { kind: 'image', url: '/api/brand-studio/media/st/img1.png' }),
    label: '골든아워 무드 스틸',
  };
  const uploadedVideo = asset(10, { kind: 'video', name: 'packshot-upload.mp4', seconds: 8 });
  const uploadedImage = asset(11, { kind: 'image', name: 'brand-look-ref.png' });
  const uploadedAudio = asset(12, { kind: 'audio', name: 'guide-loop.wav', seconds: 16 });

  const folderId = '00000000-0000-4000-8000-000000000901';
  const folders: LibraryFolderWire[] = [
    {
      id: folderId,
      name: '26FW 키컷',
      count: 2,
      covers: [imageOut.url],
      updatedAt: '2026-11-12T12:00:00.000Z',
    },
  ];
  const folderItems: Record<string, LibraryItemWire[]> = {
    [folderId]: [
      {
        key: `o:${videoOut.id}`,
        ref: { outputId: videoOut.id },
        kind: 'video',
        url: videoOut.url,
        thumbUrl: videoOut.thumbUrl,
        name: '폴더 보관 컷',
        width: 1080,
        height: 1920,
        seconds: 6,
        createdAt: '2026-11-12T12:00:00.000Z',
      },
      {
        key: `a:${uploadedImage.id}`,
        ref: { assetId: uploadedImage.id },
        kind: 'image',
        url: uploadedImage.url,
        thumbUrl: uploadedImage.thumbUrl,
        name: uploadedImage.name,
        width: 1080,
        height: 1350,
        seconds: null,
        createdAt: '2026-11-12T12:00:00.000Z',
      },
    ],
  };

  it('renders all 4 media source pills, search input, recent videos, and recent images usable as color references', () => {
    const html = renderToStaticMarkup(
      h(VideoComposer, {
        organizationId: ORG,
        locale: 'ko',
        canCreate: true,
        copy: koDict.studioCompose,
        videoStudioHref: `/brand/studio/video?organizationId=${ORG}`,
        initialAllowance: allowance(),
        initialAssets: [uploadedVideo, uploadedImage, uploadedAudio],
        initialVideoOutputs: [videoOut],
        initialImageOutputs: [imageOut],
        initialFolders: folders,
        initialLikedKeys: [`o:${videoOut.id}`],
        initialFolderItems: folderItems,
      }),
    );

    expect(html).toContain('data-compose-browser-filter="recent"');
    expect(html).toContain('data-compose-browser-filter="likes"');
    expect(html).toContain('data-compose-browser-filter="folders"');
    expect(html).toContain('data-compose-browser-filter="uploads"');
    expect(html).toContain('data-compose-media-search');
    expect(html).toContain('세럼 런웨이 샷');
    expect(html).toContain('골든아워 무드 스틸');
    expect(html).toContain(`data-compose-grade-ref="${imageOut.id}"`);
  });

  it('resolves liked items from initialLikedKeys as well as folders and uploads views cleanly', () => {
    const likesHtml = renderToStaticMarkup(
      h(VideoComposer, {
        organizationId: ORG,
        locale: 'ko',
        canCreate: true,
        copy: koDict.studioCompose,
        videoStudioHref: `/brand/studio/video?organizationId=${ORG}`,
        initialAllowance: allowance(),
        initialAssets: [uploadedVideo, uploadedImage],
        initialVideoOutputs: [videoOut],
        initialImageOutputs: [imageOut],
        initialLikedKeys: [`o:${videoOut.id}`, `a:${uploadedImage.id}`],
        initialBrowserFilter: 'likes',
      }),
    );
    expect(likesHtml).toContain('세럼 런웨이 샷');
    expect(likesHtml).toContain('brand-look-ref.png');

    const foldersHtml = renderToStaticMarkup(
      h(VideoComposer, {
        organizationId: ORG,
        locale: 'ko',
        canCreate: true,
        copy: koDict.studioCompose,
        videoStudioHref: `/brand/studio/video?organizationId=${ORG}`,
        initialAllowance: allowance(),
        initialAssets: [uploadedVideo, uploadedImage],
        initialVideoOutputs: [videoOut],
        initialFolders: folders,
        initialFolderItems: folderItems,
        initialBrowserFilter: 'folders',
      }),
    );
    expect(foldersHtml).toContain('data-compose-folder-list');
    expect(foldersHtml).toContain('26FW 키컷');
    expect(foldersHtml).toContain('폴더 보관 컷');

    const uploadsHtml = renderToStaticMarkup(
      h(VideoComposer, {
        organizationId: ORG,
        locale: 'ko',
        canCreate: true,
        copy: koDict.studioCompose,
        videoStudioHref: `/brand/studio/video?organizationId=${ORG}`,
        initialAllowance: allowance(),
        initialAssets: [uploadedVideo, uploadedImage],
        initialVideoOutputs: [],
        initialBrowserFilter: 'uploads',
      }),
    );
    expect(uploadsHtml).toContain('data-compose-local-input');
    expect(uploadsHtml).toContain('packshot-upload.mp4');
    expect(uploadsHtml).toContain('brand-look-ref.png');
  });
});

describe('Editing Studio v4 — 2. Auto Scene-Cut Detection & Playhead Split', () => {
  it('splits a clip at playhead (`split_clip_at`) into two contiguous clips preserving total duration', () => {
    const initial = sampleProjectWithTwoClips();
    const totalBefore = projectDurationSec(initial);

    const target = playheadClipSplitTarget(initial, 3.7);
    expect(target).toEqual({ clipIndex: 0, atMediaSec: 3.7 });

    // Edge guard (< 0.3s from clip start) refuses split
    expect(playheadClipSplitTarget(initial, 0.1)).toBeNull();

    const { project: after, appliedCount } = applyTimelinePatches(initial, [
      { op: 'split_clip_at', clipIndex: target!.clipIndex, atMediaSec: target!.atMediaSec },
    ]);
    expect(appliedCount).toBe(1);
    expect(after.clips).toHaveLength(3);
    expect(after.clips[0]!.trimStartSec).toBe(0);
    expect(after.clips[0]!.trimEndSec).toBe(3.7);
    expect(after.clips[1]!.trimStartSec).toBe(3.7);
    expect(after.clips[1]!.trimEndSec).toBe(10);
    expect(projectDurationSec(after)).toBe(totalBefore);
  });

  it('auto-splits across detected scene cuts strictly inside (trimStartSec + 0.4, trimEndSec - 0.4)', () => {
    const initial = sampleProjectWithTwoClips();
    const clip0 = initial.clips[0]!;
    // 0.2 and 9.8 are within 0.4s of [0, 10] edges, so only [2.8, 6.4] are splittable
    const valid = splittableCutMediaSecs(clip0, clip0.cutMarkers ?? []);
    expect(valid).toEqual([2.8, 6.4]);

    const { project: splitProject, appliedCount } = applyTimelinePatches(initial, [
      { op: 'split_clip_cuts', clipIndex: 0, cutMediaSecs: clip0.cutMarkers ?? [] },
    ]);
    expect(appliedCount).toBe(1);
    expect(splitProject.clips).toHaveLength(4);
    expect(splitProject.clips.slice(0, 3).map((c) => [c.trimStartSec, c.trimEndSec])).toEqual([
      [0, 2.8],
      [2.8, 6.4],
      [6.4, 10],
    ]);
    expect(projectDurationSec(splitProject)).toBe(15);
  });

  it('renders cut-detection toolbar, detected cut count badge, timeline ticks, and 1-click auto-split CTA', () => {
    const html = renderToStaticMarkup(
      h(VideoComposer, {
        organizationId: ORG,
        locale: 'ko',
        canCreate: true,
        copy: koDict.studioCompose,
        videoStudioHref: `/brand/studio/video?organizationId=${ORG}`,
        initialAllowance: allowance(),
        initialAssets: [],
        initialVideoOutputs: [],
        initialProject: sampleProjectWithTwoClips(),
      }),
    );

    expect(html).toContain('data-compose-detect-cuts');
    expect(html).toContain('data-compose-split-playhead');
    expect(html).toContain('data-compose-detected-cuts-badge');
    expect(html).toContain('2개 컷 전환 감지됨');
    expect(html).toContain('data-compose-apply-auto-cuts');
    expect(html).toContain('감지된 3개 컷으로 자동 나누기');
    expect(html).toContain('data-compose-cut-ticks="0"');
  });
});

describe('Editing Studio v4 — 3. Reference Color Grading (Full · Selected Clip · Region + Live & Export)', () => {
  it('tracks color grade state across scopes, persists cleanly to storage, and drives CSS & Canvas grading', () => {
    const base = sampleProjectWithTwoClips();

    // 1. Selected-clip preset grade
    const { project: clipScoped } = applyTimelinePatches(base, [
      {
        op: 'set_color_grade',
        enabled: true,
        scope: 'selected_clip',
        clipIndex: 0,
        presetId: 'kodak-2383-warm',
        intensity: 0.9,
        skinProtect: 0.75,
        grain: 2.5,
        halation: 0.06,
      },
    ]);

    const fClip0 = frameStateAtTime(clipScoped, 2.0);
    const fClip1 = frameStateAtTime(clipScoped, 11.5);
    expect(fClip0.activeColorGrade?.presetId).toBe('kodak-2383-warm');
    expect(fClip1.activeColorGrade).toBeNull();
    expect(cssFilterForColorGrade(toColorGradeSpec(fClip0.activeColorGrade))).toContain('sepia(');

    // Canvas export helper modifies clip 0 pixels and leaves clip 1 pixels untouched
    const c0 = makeFakeCanvasContext(20, 20, [120, 120, 120, 255]);
    expect(applyProjectColorGradeFrame(c0.ctx, 20, 20, clipScoped, fClip0.activeClip)).toBe(true);
    expect(c0.pixelAt(10, 10)).not.toEqual([120, 120, 120, 255]);

    const c1 = makeFakeCanvasContext(20, 20, [120, 120, 120, 255]);
    expect(applyProjectColorGradeFrame(c1.ctx, 20, 20, clipScoped, fClip1.activeClip)).toBe(false);
    expect(c1.pixelAt(10, 10)).toEqual([120, 120, 120, 255]);

    // 2. Region mask grade modifies inside the box while leaving outside corners untouched
    const { project: regionScoped } = applyTimelinePatches(base, [
      {
        op: 'set_color_grade',
        enabled: true,
        scope: 'region',
        region: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
        presetId: 'twings-french-blue',
        intensity: 1,
        grain: 0,
        halation: 0,
      },
    ]);

    const fRegion = frameStateAtTime(regionScoped, 1.0);
    const cReg = makeFakeCanvasContext(40, 40, [128, 128, 128, 255]);
    expect(applyProjectColorGradeFrame(cReg.ctx, 40, 40, regionScoped, fRegion.activeClip)).toBe(true);
    expect(cReg.pixelAt(2, 2)).toEqual([128, 128, 128, 255]); // outside region
    expect(cReg.pixelAt(20, 20)).not.toEqual([128, 128, 128, 255]); // center of region

    // Round-trips through localStorage serializer without losing colorGrade or cutMarkers
    const roundTripped = parseStoredProject(serializeProjectForStorage(regionScoped));
    expect(roundTripped?.colorGrade?.scope).toBe('region');
    expect(roundTripped?.colorGrade?.presetId).toBe('twings-french-blue');
    expect(roundTripped?.clips[0]?.cutMarkers).toEqual([0.2, 2.8, 6.4, 9.8]);
  });

  it('renders Color Grading panel with 3 scopes, interactive region overlay, 6 presets, 4 sliders, and master button', () => {
    const { project: regionProject } = applyTimelinePatches(sampleProjectWithTwoClips(), [
      {
        op: 'set_color_grade',
        enabled: true,
        scope: 'region',
        region: { x: 0.2, y: 0.15, w: 0.6, h: 0.65 },
        presetId: 'twings-french-blue',
      },
    ]);

    const html = renderToStaticMarkup(
      h(VideoComposer, {
        organizationId: ORG,
        locale: 'ko',
        canCreate: true,
        copy: koDict.studioCompose,
        videoStudioHref: `/brand/studio/video?organizationId=${ORG}`,
        initialAllowance: allowance(),
        initialAssets: [],
        initialVideoOutputs: [],
        initialToolTab: 'color',
        initialProject: regionProject,
      }),
    );

    expect(html).toContain('data-compose-color-panel');
    expect(html).toContain('data-compose-color-scope="full_timeline"');
    expect(html).toContain('data-compose-color-scope="selected_clip"');
    expect(html).toContain('data-compose-color-scope="region"');
    expect(html).toContain('data-compose-region-controls');
    expect(html).toContain('data-compose-grade-region-box');
    for (const preset of GRADE_PRESETS) {
      expect(html).toContain(`data-compose-grade-preset="${preset.id}"`);
    }
    expect(html).toContain('data-compose-grade-intensity');
    expect(html).toContain('data-compose-grade-skin');
    expect(html).toContain('data-compose-grade-grain');
    expect(html).toContain('data-compose-grade-halation');
    expect(html).toContain('data-compose-grade-master');
  });
});

describe('Editing Studio v4 — 4. Detail Upscaling & 5. Reference Non-Commercial Guide Music', () => {
  it('renders Upscale panel with 1080p/1440p/4K pills, scope selector, LAB/Wavelet modes, and tabular credit badge', () => {
    const html = renderToStaticMarkup(
      h(VideoComposer, {
        organizationId: ORG,
        locale: 'ko',
        canCreate: true,
        copy: koDict.studioCompose,
        videoStudioHref: `/brand/studio/video?organizationId=${ORG}`,
        initialAllowance: allowance(),
        initialAssets: [],
        initialVideoOutputs: [],
        initialToolTab: 'upscale',
        initialProject: sampleProjectWithTwoClips(),
      }),
    );

    expect(html).toContain('data-compose-upscale-panel');
    expect(html).toContain('data-compose-upscale-res="1080"');
    expect(html).toContain('data-compose-upscale-res="1440"');
    expect(html).toContain('data-compose-upscale-res="2160"');
    expect(html).toContain('data-compose-upscale-scope="selected_clip"');
    expect(html).toContain('data-compose-upscale-scope="full_timeline"');
    expect(html).toContain('data-compose-upscale-color="lab"');
    expect(html).toContain('data-compose-upscale-color="wavelet"');
    expect(html).toContain('data-compose-upscale-cost');
    expect(html).toContain('data-compose-upscale-submit');
  });

  it('renders Music & Sound panel with library audio, CC BY-NC 4.0 notice, ref_audio picker, BPM, and cut-drop sync', () => {
    const audioAsset = asset(21, { kind: 'audio', name: 'reference-groove.mp3', seconds: 18 });
    const html = renderToStaticMarkup(
      h(VideoComposer, {
        organizationId: ORG,
        locale: 'ko',
        canCreate: true,
        copy: koDict.studioCompose,
        videoStudioHref: `/brand/studio/video?organizationId=${ORG}`,
        initialAllowance: allowance(),
        initialAssets: [audioAsset],
        initialVideoOutputs: [],
        initialToolTab: 'music',
        initialProject: sampleProjectWithTwoClips(),
      }),
    );

    expect(html).toContain('data-compose-music-panel');
    expect(html).toContain('data-compose-music-gen');
    expect(html).toContain('data-compose-music-license-notice');
    expect(html).toContain('CC BY-NC 4.0');
    expect(html).toContain(`data-compose-pick-ref-audio="${audioAsset.id}"`);
    expect(html).toContain('data-compose-ref-audio-input');
    expect(html).toContain('data-compose-music-mode="instrumental"');
    expect(html).toContain('data-compose-music-mode="vocal_guide"');
    expect(html).toContain('data-compose-music-bpm');
    expect(html).toContain('data-compose-music-dropsync');
    expect(html).toContain('-14 LUFS');
    // Auto-synced to clip_one's first internal cut marker (2.8s)!
    expect(html).toContain('2.8초');
    expect(html).toContain('data-compose-music-submit');
  });
});

describe('Editing Studio v4 — 6. ChatCut Natural-Language Commands & Share/Review Bridge', () => {
  it('parses Korean & English auto-cut, timestamp split, playhead split, and color-grade commands', () => {
    const project = sampleProjectWithTwoClips();

    // Auto scene-cut split
    const autoCutKo = parseComposeChatCommand('컷 전환 자동으로 나눠줘', project, 'ko');
    expect(autoCutKo.kind).toBe('patches');
    if (autoCutKo.kind === 'patches') {
      expect(autoCutKo.patches[0]).toMatchObject({ op: 'split_clip_cuts', clipIndex: 0 });
    }

    const autoCutAlt = parseComposeChatCommand('장면 전환 분할', project, 'ko');
    expect(autoCutAlt.kind).toBe('patches');

    // Timestamp & playhead split
    const splitAt = parseComposeChatCommand('2.5초에서 잘라줘', project, 'ko');
    expect(splitAt).toMatchObject({
      kind: 'patches',
      patches: [{ op: 'split_clip_at', clipIndex: 0, atMediaSec: 2.5 }],
    });

    const splitPlayhead = parseComposeChatCommand('현재 위치 분할', project, 'ko', { playheadSec: 4.2 });
    expect(splitPlayhead).toMatchObject({
      kind: 'patches',
      patches: [{ op: 'split_clip_at', clipIndex: 0, atMediaSec: 4.2 }],
    });

    // Color grading commands
    const warmFull = parseComposeChatCommand('전체 영상 웜 필름 색감 입혀줘', project, 'ko');
    expect(warmFull).toMatchObject({
      kind: 'patches',
      patches: [
        {
          op: 'set_color_grade',
          enabled: true,
          scope: 'full_timeline',
          presetId: 'kodak-2383-warm',
        },
      ],
    });

    const blueClip = parseComposeChatCommand('첫 번째 클립 프렌치 블루 색보정', project, 'ko');
    expect(blueClip).toMatchObject({
      kind: 'patches',
      patches: [
        {
          op: 'set_color_grade',
          enabled: true,
          scope: 'selected_clip',
          clipIndex: 0,
          presetId: 'twings-french-blue',
        },
      ],
    });

    const resetGrade = parseComposeChatCommand('색보정 해제', project, 'ko');
    expect(resetGrade).toMatchObject({
      kind: 'patches',
      patches: [{ op: 'set_color_grade', enabled: false }],
    });

    // Compound command (`자르고` + color grade)
    const compound = parseComposeChatCommand('2.5초에서 자르고 전체 영상 웜 필름 색감 입혀줘', project, 'ko');
    expect(compound.kind).toBe('patches');
    if (compound.kind === 'patches') {
      expect(compound.patches.map((p) => p.op)).toEqual(['split_clip_at', 'set_color_grade']);
    }

    // English command parity
    const enGrade = parseComposeChatCommand('Apply warm film color grade to full video', project, 'en');
    expect(enGrade).toMatchObject({
      kind: 'patches',
      patches: [{ op: 'set_color_grade', enabled: true, scope: 'full_timeline', presetId: 'kodak-2383-warm' }],
    });
  });

  it('dispatches twings:open-share-review event and normalizes share-review target details', () => {
    const received: unknown[] = [];
    const prevWindow = (globalThis as { window?: unknown }).window;
    const fakeWindow = new EventTarget();
    (globalThis as { window?: unknown }).window = fakeWindow;
    try {
      fakeWindow.addEventListener(OPEN_SHARE_REVIEW_EVENT, (ev) => {
        received.push((ev as CustomEvent).detail);
      });
      openShareReview({
        organizationId: ORG,
        outputId: '00000000-0000-4000-8000-000000000101',
        title: '편집 스튜디오',
      });
    } finally {
      if (prevWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = prevWindow;
      }
    }

    expect(received).toHaveLength(1);
    expect(normalizeShareReviewDetail(received[0], ORG)).toEqual({
      organizationId: ORG,
      reviewId: null,
      assetId: null,
      outputId: '00000000-0000-4000-8000-000000000101',
      title: '편집 스튜디오',
    });
  });
});

describe('Editing Studio v4 — 7. Strict Studio UI v4 Aesthetic & Customer Surface Hardline', () => {
  it('enforces single #0033FF Primary CTA, zero pastel blue, zero KRW strings, and zero internal tool leaks across all 5 tabs', () => {
    for (const tab of ['clips', 'color', 'music', 'captions', 'upscale'] as const) {
      const html = renderToStaticMarkup(
        h(VideoComposer, {
          organizationId: ORG,
          locale: 'ko',
          canCreate: true,
          copy: koDict.studioCompose,
          videoStudioHref: `/brand/studio/video?organizationId=${ORG}`,
          initialAllowance: allowance(),
          initialAssets: [asset(31, { kind: 'audio', name: 'loop.wav', seconds: 12 })],
          initialVideoOutputs: [],
          initialToolTab: tab,
          initialProject: sampleProjectWithTwoClips(),
        }),
      );

      // Top-bar Review & Share button always present alongside single solid Primary CTA (`data-compose-export`)
      expect(html).toContain('data-compose-share-review');
      expect(html).toContain('data-compose-export');
      expect(html.match(/data-variant="solid"/g)).toHaveLength(1);

      // Zero pastel blue, zero currency leaks, zero internal tool/engine names
      expect(html).not.toMatch(/#ebf5ff/i);
      expect(html).not.toMatch(/₩|KRW|\d\s*원/);
      expect(lintPublicBrandSurface(html)).toEqual({ clean: true, violations: [] });
    }

    // Dictionary leaf audit (both Korean & English)
    expect(lintPublicBrandSurface(JSON.stringify(koDict.studioCompose))).toEqual({ clean: true, violations: [] });
    expect(lintPublicBrandSurface(JSON.stringify(enDict.studioCompose))).toEqual({ clean: true, violations: [] });

    // CSS module token purity audit
    const css = readFileSync(
      join(process.cwd(), 'components/brand-studio/compose/video-composer.module.css'),
      'utf8',
    );
    expect(css).not.toMatch(/#ebf5ff/i);
    expect(css).not.toMatch(/#ef4444|#dc2626|#ed1e1e/i);
    expect((css.match(/var\(--ys-accent\)/g) ?? []).length).toBe(1);
  });
});
