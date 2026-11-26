import { afterEach, describe, expect, it } from 'vitest';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { enhancePrompt, type EnhanceInput } from '@/lib/brand-studio/enhancer';
import {
  assessRegionBox,
  buildRegionAssistantTask,
  CONTOUR_EDGE_THRESHOLD,
  MAX_RECOMMENDED_BOX_AREA,
  measureBoundaryEdgesFromRgba,
  measureBoxBoundaryEdges,
  REGION_ASSISTANT_TASK_IDS,
} from '@/lib/brand-studio/enhancer/region-assistant';
import { createStudioJob, previewStudioPrompt } from '@/lib/brand-studio/jobs';
import { STUDIO_MODELS } from '@/lib/brand-studio/models';
import { cropForEdit, planRegion } from '@/lib/brand-studio/region-edit';
import { requestId, seedImageAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';
import { ENV, input, mockGemini, sentBody, writerParts } from './helpers';

const NANO_ASPECTS = STUDIO_MODELS.find((m) => m.id === 'nano-banana-pro')!.aspects;

describe('region-assistant — 5 tasks in ko & en, missing-reference warnings & custom preservation', () => {
  it('supports all 5 tasks in ko and en with numbered image 1 / image 2 prompts and zero internal or money words', () => {
    const banned = /slack|슬랙|supabase|sunra|webhook|morphic|모픽|higgsfield|mcp|\bapi\b|\{\{|₩|KRW|\d\s*원/i;

    for (const locale of ['ko', 'en'] as const) {
      for (const task of REGION_ASSISTANT_TASK_IDS) {
        const withoutRef = buildRegionAssistantTask({ task, locale, referenceCount: 0 });
        const withRef = buildRegionAssistantTask({ task, locale, referenceCount: 1 });
        expect(withoutRef.label.length).toBeGreaterThan(0);
        expect(withoutRef.prompt.length).toBeGreaterThan(15);
        expect(withRef.prompt.length).toBeGreaterThan(15);
        expect(withoutRef.prompt).not.toMatch(banned);
        expect(withRef.prompt).not.toMatch(banned);
        if (withoutRef.missingRefWarning) expect(withoutRef.missingRefWarning).not.toMatch(banned);
        if (withoutRef.refAdvisory) expect(withoutRef.refAdvisory).not.toMatch(banned);
      }
    }

    const removeKo = buildRegionAssistantTask({ task: 'remove_mark', locale: 'ko' });
    expect(removeKo.prompt).toContain('1번 이미지');
    expect(removeKo.prompt).toContain('로고·글자만 흔적 없이');
    expect(removeKo.missingRefWarning).toBeNull();

    const detailKo = buildRegionAssistantTask({ task: 'enhance_detail', locale: 'ko' });
    expect(detailKo.prompt).toContain('1번 이미지는 큰 사진에서 잘라 확대한');
    expect(detailKo.prompt).toContain('성형 느낌이나 과한 보정은 하지 마');
  });

  it('flags missing Reference 2 warning on swap_person and advisory note on place_mark when referenceCount === 0', () => {
    const swapNoRef = buildRegionAssistantTask({ task: 'swap_person', locale: 'ko', referenceCount: 0 });
    expect(swapNoRef.requiresRef2).toBe(true);
    expect(swapNoRef.missingRefWarning).toBe('바꿀 인물 사진을 2번 참조 이미지로 먼저 추가해 주세요.');
    expect(swapNoRef.prompt).toContain('2번 이미지의 인물');

    const swapWithRef = buildRegionAssistantTask({ task: 'swap_person', locale: 'ko', referenceCount: 1 });
    expect(swapWithRef.missingRefWarning).toBeNull();

    const placeNoRef = buildRegionAssistantTask({ task: 'place_mark', locale: 'ko', referenceCount: 0 });
    expect(placeNoRef.refAdvisory).toBe('로고 원본 이미지를 2번 참조로 추가하면 모양이 정확히 유지돼요.');
    expect(placeNoRef.prompt).not.toContain('2번 이미지');
    expect(placeNoRef.prompt).toContain('병이나 사물 크기는 절대 키우지 마');

    const placeWithRef = buildRegionAssistantTask({ task: 'place_mark', locale: 'ko', referenceCount: 1 });
    expect(placeWithRef.refAdvisory).toBeNull();
    expect(placeWithRef.prompt).toContain('2번 이미지의 로고 모양만 가져와');
    expect(placeWithRef.prompt).toContain('병이나 사물 크기는 절대 키우지 마');
  });

  it('keeps user-written custom text on custom task while replacing preset templates cleanly', () => {
    const removePreset = buildRegionAssistantTask({ task: 'remove_mark', locale: 'ko' }).prompt;
    const fromPreset = buildRegionAssistantTask({
      task: 'custom',
      locale: 'ko',
      referenceCount: 1,
      currentText: removePreset,
    });
    expect(fromPreset.prompt).toContain('2번 이미지의 요소를');

    const fromUserText = buildRegionAssistantTask({
      task: 'custom',
      locale: 'ko',
      referenceCount: 0,
      currentText: '1번 이미지의 리본 매듭만 프렌치 블루로 바꿔줘',
    });
    expect(fromUserText.prompt).toBe('1번 이미지의 리본 매듭만 프렌치 블루로 바꿔줘');
  });
});

describe('region-assistant — box geometry & contour edge advisor', () => {
  it('warns on oversized boxes (> 28% area) and contour crossings (> threshold)', () => {
    const tightClean = assessRegionBox({ x: 0.4, y: 0.4, w: 0.18, h: 0.18 }, 0.04, 'ko');
    expect(tightClean.tooLarge).toBe(false);
    expect(tightClean.crossesContour).toBe(false);
    expect(tightClean.warnings).toHaveLength(0);

    const wide = assessRegionBox({ x: 0.1, y: 0.1, w: 0.6, h: 0.55 }, 0.05, 'ko');
    expect(wide.area).toBeGreaterThan(MAX_RECOMMENDED_BOX_AREA);
    expect(wide.tooLarge).toBe(true);
    expect(wide.sizeTip).toContain('선택 영역이 넓어요');

    const crossing = assessRegionBox({ x: 0.35, y: 0.35, w: 0.25, h: 0.25 }, CONTOUR_EDGE_THRESHOLD + 0.08, 'ko');
    expect(crossing.crossesContour).toBe(true);
    expect(crossing.contourTip).toContain('상자 테두리가 사물 윤곽선을 가로질러요');
  });

  it('computes high boundary edge contrast when box crosses sharp bottle contours and 0 on flat regions / null image', () => {
    const size = 128;
    const rgba = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const i = (y * size + x) * 4;
        // Sharp dark bottle silhouette in x = 44..84, y = 20..108 against bright white backdrop
        const inBottle = x >= 44 && x <= 84 && y >= 20 && y <= 108;
        const c = inBottle ? 24 : 238;
        rgba[i] = c;
        rgba[i + 1] = c;
        rgba[i + 2] = c;
        rgba[i + 3] = 255;
      }
    }

    // Box completely inside bottle interior (x = 0.42..0.58, y = 0.30..0.60 -> px 53..74, 38..76) -> flat
    const insideScore = measureBoundaryEdgesFromRgba(rgba, size, size, { x: 0.42, y: 0.3, w: 0.16, h: 0.3 });
    expect(insideScore).toBeLessThan(0.05);

    // Box whose top/bottom edges cut across the vertical bottle walls (`x = 0.25..0.75`, `y = 0.35..0.65`)
    const crossingScore = measureBoundaryEdgesFromRgba(rgba, size, size, { x: 0.25, y: 0.35, w: 0.5, h: 0.3 });
    expect(crossingScore).toBeGreaterThan(CONTOUR_EDGE_THRESHOLD);
    expect(assessRegionBox({ x: 0.25, y: 0.35, w: 0.5, h: 0.3 }, crossingScore, 'ko').crossesContour).toBe(true);

    // Safe no-op on null
    expect(measureBoxBoundaryEdges(null, { x: 0.2, y: 0.2, w: 0.2, h: 0.2 })).toBe(0);
  });
});

describe('region_edit enhancer — inline image 1 crop & anti-redraw system rules', () => {
  it('passes editCropThumb as the FIRST inline image (image 1) and forbids cylindrical/scene redraw in system instructions', async () => {
    const cropBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
    const refLogoBytes = new Uint8Array([255, 216, 255, 224, 9, 8, 7]);
    const fetchMock = mockGemini({
      prompt:
        'Using image 1, change only the bottle surface by printing the exact mark from image 2 flat at matching scale; do not move or resize anything else. Keep the exact object scale, outer silhouette, contours, light direction and pixel positions of image 1.',
      notes: '선택한 조각의 병 윤곽과 크기를 고정하고 로고 위치만 다듬었어요.',
    });

    const enhInput: EnhanceInput = {
      ...input({
        profile: 'gpt-image',
        kind: 'region_edit',
        prompt: '로고를 이미지 1로 인쇄해줘',
        references: [{ index: 1, kind: 'image', label: '이미지 2', role: 'logo', thumb: { bytes: refLogoBytes, mime: 'image/jpeg' } }],
      }),
      editCropThumb: { bytes: cropBytes, mime: 'image/png' },
    };

    const res = await enhancePrompt(enhInput, { fetch: fetchMock as unknown as typeof fetch, env: ENV });
    expect(res.source).toBe('model');

    const body = sentBody(fetchMock);
    const system = body.systemInstruction.parts[0]!.text;
    // Must NOT instruct full-scene 6-step generation or "Choose what the request leaves open"
    expect(system).not.toContain('Choose what the request leaves open');
    expect(system).not.toContain('What the picture is: the subject, how many');
    expect(system).toContain('enlarged crop cut out from a larger photograph');
    expect(system).toContain('Never redraw, enlarge, or re-shape the surrounding object (never invent curvature or new geometry)');

    // Inline parts: [0] JSON payload, [1] label for image 1 crop, [2] inlineData of cropBytes, [3] label for image 2, [4] inlineData of refLogoBytes
    const parts = writerParts(body);
    expect(parts[1]).toMatchObject({ text: expect.stringContaining('Picture of image 1') });
    expect(parts[2]).toMatchObject({ inlineData: { mimeType: 'image/png', data: Buffer.from(cropBytes).toString('base64') } });
    expect(parts[3]).toMatchObject({ text: expect.stringContaining('Picture of image 2') });
  });

  let fx: StudioFixture | null = null;
  afterEach(async () => {
    await fx?.db.close();
    fx = null;
  });

  it('prepareJob and previewStudioPrompt both supply editCropThumb (image 1) to enhancePrompt on region_edit', async () => {
    fx = await studioFixture({ capKrw: 500_000 });
    const baseDeps = studioDeps(fx.sql);
    const seenInputs: EnhanceInput[] = [];

    const deps = studioDeps(fx.sql, {
      media: baseDeps.media,
      staging: baseDeps.staging,
      provider: baseDeps.provider,
      intel: {
        ...baseDeps.intel,
        planRegion: (img, box) => planRegion(img, box, NANO_ASPECTS),
        cropForEdit,
        async enhancePrompt(inp) {
          seenInputs.push(inp);
          return {
            prompt: `Using image 1, change only the mark; do not move or resize anything else.`,
            notes: '다듬었어요.',
            source: 'model',
          };
        },
      },
    });

    const assetId = await seedImageAsset(deps, fx.orgId, fx.ids.editor, { width: 320, height: 240 });
    const viewer = viewerOf(fx.ids.editor);

    const preview = await previewStudioPrompt(deps, viewer, {
      kind: 'region_edit',
      organizationId: fx.orgId,
      model: 'gpt-image-1.5-sunburst',
      prompt: '선택한 부분의 로고만 지워줘',
      enhance: true,
      source: { assetId },
      box: { x: 0.3, y: 0.3, w: 0.3, h: 0.3 },
      references: [],
    });
    expect(preview.ok).toBe(true);
    expect(seenInputs).toHaveLength(1);
    expect(seenInputs[0]!.editCropThumb?.mime).toBe('image/png');
    expect(seenInputs[0]!.editCropThumb?.bytes.byteLength).toBeGreaterThan(50);

    const created = await createStudioJob(deps, viewer, {
      kind: 'region_edit',
      organizationId: fx.orgId,
      requestId: requestId(),
      model: 'gpt-image-1.5-sunburst',
      prompt: '선택한 부분의 로고만 지워줘',
      enhance: true,
      source: { assetId },
      box: { x: 0.3, y: 0.3, w: 0.3, h: 0.3 },
      references: [],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await advanceStudioJobsWith(deps, { jobIds: [created.job.id] });
    expect(seenInputs).toHaveLength(2);
    expect(seenInputs[1]!.editCropThumb?.mime).toBe('image/png');
    expect(seenInputs[1]!.editCropThumb?.bytes.byteLength).toBeGreaterThan(50);
  });
});
