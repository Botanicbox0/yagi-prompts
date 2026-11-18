import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { enhancePrompt, type EnhanceDeps, type EnhanceInput } from '@/lib/brand-studio/enhancer';
import { createStudioJob, previewStudioPrompt } from '@/lib/brand-studio/jobs';
import { enhanceReferences } from '@/lib/brand-studio/prepare';
import { createMemoryMediaStore } from '@/lib/brand-studio/media-store';
import type { ResolvedRef } from '@/lib/brand-studio/plan';
import { submitUpscaleJob } from '@/lib/brand-studio/upscale';
import { pngBytes, requestId, seedImageAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';
import { ENV, input, mockGemini, sentBody, sentPayload } from './helpers';

const NOTE_KO = '참조 이미지의 재질과 빛 방향을 반영해 구체적으로 적었어요.';

describe('image reference visual grounding — multimodal payload & thinking level', () => {
  it('sends role/take/leaveOut captions, visualAttached=true, inspection rules and thinkingLevel=MEDIUM when image bytes are attached', async () => {
    const bottlePng = await pngBytes(96, 128, { r: 220, g: 235, b: 245 });
    const lightWebp = await sharp(await pngBytes(96, 128, { r: 255, g: 240, b: 210 })).webp({ quality: 80 }).toBuffer();

    const profiles = [
      {
        profile: 'seedream' as const,
        answer:
          'A frosted pale-blue cylindrical glass bottle from Image 1 stands upright on honed travertine; keep the exact label, proportions and colours of Image 1. Take only the warm golden side light and soft shadows from Image 2, ignoring its original setting. Eye-level medium shot, calm.',
        tokenRegex: /Image 1/,
      },
      {
        profile: 'nano-banana' as const,
        answer:
          'Using image 1, place the frosted pale-blue bottle on travertine under the warm golden side light from image 2. Keep the exact mark from image 1; do not redraw, mirror, restyle or enlarge it.',
        tokenRegex: /image 1/,
      },
      {
        profile: 'gpt-image' as const,
        answer:
          'Use the frosted pale-blue cylindrical bottle from image 1 only; ignore its background and lighting. Keep the exact label, proportions and colours of image 1. Take the warm golden side light and contact shadow falloff from image 2.',
        tokenRegex: /image 1/,
      },
    ];

    for (const p of profiles) {
      const fetchMock = mockGemini({ prompt: p.answer, notes: NOTE_KO });
      const res = await enhancePrompt(
        input({
          profile: p.profile,
          kind: 'image',
          prompt: '이미지 1 향수병을 이미지 2 조명으로 배치',
          references: [
            {
              index: 1,
              kind: 'image',
              label: '이미지 1',
              role: 'product',
              use: '불투명 유리 실루엣과 라벨만 유지',
              avoid: '원본 배경 제거',
              thumb: { bytes: bottlePng, mime: 'image/png' },
            },
            {
              index: 2,
              kind: 'image',
              label: '이미지 2',
              role: 'style',
              use: '따뜻한 측면광과 그림자',
              thumb: { bytes: new Uint8Array(lightWebp), mime: 'image/webp' },
            },
          ],
        }),
        { fetch: fetchMock as unknown as typeof fetch, env: ENV },
      );

      expect(res.source).toBe('model');
      const body = sentBody(fetchMock);
      const system = body.systemInstruction.parts[0]!.text;
      expect(system).toContain('Inspect every attached reference picture');
      // 2026-11-19: products and logos are bound by what to keep; style and place pictures are described.
      expect(system).toContain('bind each token to what it really shows');
      expect(system).toMatch(/keep the exact label, cap, proportions and colours of <token>/);
      expect(system).toMatch(/style \/ place: describe in concrete words/);
      expect(system).toContain('Optical integration:');
      expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'MEDIUM' });

      const payload = sentPayload(fetchMock) as {
        references: Array<{ token: string | null; role: string | null; take?: string | null; leaveOut?: string | null; visualAttached?: boolean }>;
      };
      expect(payload.references[0]?.visualAttached).toBe(true);
      expect(payload.references[1]?.visualAttached).toBe(true);

      const parts = body.contents[0]!.parts;
      expect(parts.filter((part) => 'inlineData' in part)).toHaveLength(2);
      const caption1 = (parts[1] as { text: string }).text;
      expect(caption1).toMatch(p.tokenRegex);
      expect(caption1).toContain('role: product');
      expect(caption1).toContain('take: "불투명 유리 실루엣과 라벨만 유지"');
      expect(caption1).toContain('leave out: "원본 배경 제거"');
      const caption2 = (parts[3] as { text: string }).text;
      expect(caption2).toContain('role: style');
      expect(caption2).toContain('take: "따뜻한 측면광과 그림자"');
    }
  });

  it('keeps thinkingLevel=LOW and visualAttached=false when no inline image bytes are attached, and upgrades region_edit with inline source visuals', async () => {
    const noThumbFetch = mockGemini({
      prompt: 'A glass bottle from Image 1 on stone in soft side light; keep the exact label, proportions and colours of Image 1.',
      notes: NOTE_KO,
    });
    await enhancePrompt(
      input({
        profile: 'seedream',
        prompt: '이미지 1 병을 돌 위에',
        references: [{ index: 1, kind: 'image', label: '이미지 1', role: 'product' }],
      }),
      { fetch: noThumbFetch as unknown as typeof fetch, env: ENV },
    );
    expect(sentBody(noThumbFetch).generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
    const noThumbPayload = sentPayload(noThumbFetch) as { references: Array<{ visualAttached?: boolean }> };
    expect(noThumbPayload.references[0]?.visualAttached).toBe(false);

    const cropBytes = await pngBytes(80, 80, { r: 230, g: 230, b: 230 });
    const logoBytes = await pngBytes(40, 40, { r: 20, g: 30, b: 90 });
    const regionFetch = mockGemini({
      prompt: 'Using image 1, change only the bottle crest to the navy mark from image 2; do not move or resize anything else.',
      notes: NOTE_KO,
    });
    const regionRes = await enhancePrompt(
      input({
        profile: 'nano-banana',
        kind: 'region_edit',
        prompt: '로고를 이미지 1로 교체',
        editCropThumb: { bytes: cropBytes, mime: 'image/png' },
        references: [{ index: 1, kind: 'image', label: '이미지 1', role: 'logo', thumb: { bytes: logoBytes, mime: 'image/png' } }],
      }),
      { fetch: regionFetch as unknown as typeof fetch, env: ENV },
    );
    expect(regionRes.source).toBe('model');
    const regionBody = sentBody(regionFetch);
    expect(regionBody.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'MEDIUM' });
    expect(regionBody.systemInstruction.parts[0]!.text).toContain('Inspect both image 1');
    expect(regionBody.contents[0]!.parts.filter((p) => 'inlineData' in p)).toHaveLength(2);
  });
});

describe('image reference grounding across storage, preview, prepareJob & upscale', () => {
  let fx: StudioFixture | null = null;

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fx?.db.close();
    fx = null;
  });

  it('enhanceReferences falls back to storage_key and resizes >768px images to <=768px image/webp when thumbKey is null or missing', async () => {
    const media = createMemoryMediaStore();
    const bigPng = await pngBytes(1024, 900, { r: 45, g: 90, b: 140 });
    const storedBig = await media.put(bigPng, 'image/png');

    const smallPng = await pngBytes(120, 80, { r: 10, g: 180, b: 90 });
    const storedSmall = await media.put(smallPng, 'image/png');

    const refs: ResolvedRef[] = [
      {
        index: 1,
        ordinal: 1,
        kind: 'image',
        key: storedBig.key,
        thumbKey: null,
        url: media.url(storedBig.key),
        label: '이미지 1',
        role: 'product',
        durationMs: null,
        width: 1024,
        height: 900,
      },
      {
        index: 2,
        ordinal: 2,
        kind: 'image',
        key: storedSmall.key,
        thumbKey: 'missing-thumb-key',
        url: media.url(storedSmall.key),
        label: '이미지 2',
        role: 'style',
        durationMs: null,
        width: 120,
        height: 80,
      },
      {
        index: 3,
        ordinal: 3,
        kind: 'image',
        key: 'missing-original-key',
        thumbKey: null,
        url: '/missing',
        label: '이미지 3',
        durationMs: null,
        width: null,
        height: null,
      },
    ];

    const out = await enhanceReferences({ media }, refs);
    expect(out).toHaveLength(3);
    expect(out[0]?.thumb?.mime).toBe('image/webp');
    const meta0 = await sharp(out[0]!.thumb!.bytes).metadata();
    expect(Math.max(meta0.width ?? 0, meta0.height ?? 0)).toBeLessThanOrEqual(768);
    expect(out[1]?.thumb?.mime).toBe('image/webp');
    expect(out[1]!.thumb!.bytes.byteLength).toBeGreaterThan(0);
    expect(out[2]?.thumb).toBeUndefined();
  });

  it('previewStudioPrompt and prepareJob both deliver inline reference visuals and organizationId playbooks to enhancePrompt', async () => {
    fx = await studioFixture({ capKrw: 500_000 });
    await fx.sql.query(
      `insert into brand_studio_playbooks (organization_id, title, body_md, tags, inject_director, status, created_by, request_id)
       values ($1, 'Visual glass rule', 'Never alter frosted glass proportions.', array['glass'], true, 'published', $2, $3)`,
      [fx.orgId, fx.ids.owner, requestId()],
    );

    const captured: Array<{ input: EnhanceInput; deps: EnhanceDeps }> = [];
    const baseDeps = studioDeps(fx.sql);
    const deps = studioDeps(fx.sql, {
      media: baseDeps.media,
      staging: baseDeps.staging,
      provider: baseDeps.provider,
      intel: {
        ...baseDeps.intel,
        async enhancePrompt(inp, intelDeps) {
          captured.push({ input: inp, deps: intelDeps });
          return enhancePrompt(inp, {
            ...intelDeps,
            fetch: mockGemini({
              prompt:
                'A red cylindrical glass bottle from Image 1 stands on marble under soft light; keep the exact label, proportions and colours of Image 1.',
              notes: NOTE_KO,
            }) as unknown as typeof fetch,
            env: { GEMINI_API_KEY: 'test-key' },
          });
        },
      },
    });

    // seedImageAsset inserts with thumb_key = null; previewStudioPrompt + prepareJob must still attach image bytes
    const assetId = await seedImageAsset(deps, fx.orgId, fx.ids.editor, { role: 'product', width: 900, height: 700 });
    const viewer = viewerOf(fx.ids.editor);

    const preview = await previewStudioPrompt(deps, viewer, {
      kind: 'image',
      organizationId: fx.orgId,
      model: 'seedream-5.5',
      prompt: '이미지 1 제품을 대리석 위에 놓아줘',
      enhance: true,
      aspect: '3:4',
      resolution: '2K',
      references: [{ assetId, role: 'product' }],
    });
    expect(preview.ok).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.deps.organizationId).toBe(fx.orgId);
    expect(captured[0]!.input.references[0]?.thumb?.mime).toBe('image/webp');
    expect(captured[0]!.input.references[0]?.thumb?.bytes.byteLength).toBeGreaterThan(0);

    const jobRes = await createStudioJob(deps, viewer, {
      kind: 'image',
      organizationId: fx.orgId,
      requestId: requestId(),
      model: 'seedream-5.5',
      prompt: '이미지 1 제품을 대리석 위에 놓아줘',
      enhance: true,
      aspect: '3:4',
      resolution: '2K',
      references: [{ assetId, role: 'product' }],
    });
    expect(jobRes.ok).toBe(true);
    if (!jobRes.ok) return;

    await advanceStudioJobsWith(deps, { jobIds: [jobRes.job.id] });
    expect(captured).toHaveLength(2);
    expect(captured[1]!.deps.organizationId).toBe(fx.orgId);
    expect(captured[1]!.input.references[0]?.thumb?.mime).toBe('image/webp');
  });

  it('stores thumb_key on upscaled image assets so references attach directly without missing thumbnails', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_STUDIO_PROVIDER', 'fake');
    fx = await studioFixture({ capKrw: 250_000 });
    const realPng = await pngBytes(240, 180, { r: 120, g: 160, b: 200 });
    const deps = studioDeps(fx.sql);
    const sourceAssetId = await seedImageAsset(deps, fx.orgId, fx.ids.owner, { width: 240, height: 180 });

    const upscale = await submitUpscaleJob(
      deps,
      viewerOf(fx.ids.owner),
      {
        organizationId: fx.orgId,
        requestId: `upscale_thumb_${randomUUID().slice(0, 8)}`,
        assetId: sourceAssetId,
        kind: 'image',
        resolution: 1440,
      },
      {
        provider: {
          id: 'fake',
          async submit() {
            return {
              ok: true,
              status: 'succeeded',
              bytes: realPng,
              mime: 'image/png',
              width: 1920,
              height: 1440,
            };
          },
          async poll() {
            return {
              ok: true,
              status: 'succeeded',
              bytes: realPng,
              mime: 'image/png',
              width: 1920,
              height: 1440,
            };
          },
        },
      },
    );

    expect(upscale.ok).toBe(true);
    if (!upscale.ok || !upscale.assetId) throw new Error('expected upscaled assetId');
    const row = (
      await fx.sql.query<{ thumb_key: string | null }>('select thumb_key from brand_studio_assets where id = $1', [upscale.assetId])
    ).rows[0];
    expect(row?.thumb_key).toBeTruthy();
    const thumbBytes = await deps.media.read(row!.thumb_key!);
    const meta = await sharp(thumbBytes).metadata();
    expect(meta.format).toBe('webp');
  });
});
