import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { deleteStudioOutput } from '@/lib/brand-studio/assets';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { studioEnv } from '@/lib/brand-studio/env';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { laneClaim, laneHeartbeat } from '@/lib/brand-studio/lane-api';
import { STUDIO_MODELS } from '@/lib/brand-studio/models';
import {
  alignEditedRoi,
  compositeRegion,
  computeDiffMask,
  cropForEdit,
  decodeRgba,
  diffMaskAt,
  MAX_RING_RESIDUAL,
  measureImage,
  planRegion,
  type RegionPlan,
} from '@/lib/brand-studio/region-edit';
import { viewsOf } from '@/lib/brand-studio/repo';
import type { JobRow } from '@/lib/brand-studio/types';
import { loadAllowance } from '@/lib/brand-studio/usage';
import { requestId, seedImageAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';

const NANO_ASPECTS = STUDIO_MODELS.find((m) => m.id === 'nano-banana-pro')!.aspects;

/**
 * Synthetic studio photograph with textured backdrop AND a sharp-contoured perfume bottle
 * centered horizontally (`x = 180..300`) whose vertical glass walls cross the customer's region box.
 */
async function makePerfumeBottleScene(width = 480, height = 360): Promise<Buffer> {
  const data = Buffer.alloc(width * height * 3);
  const bottleLeft = Math.round(width * 0.36);
  const bottleRight = Math.round(width * 0.64);
  const bottleTop = Math.round(height * 0.16);
  const bottleBottom = Math.round(height * 0.86);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      const inBottle = x >= bottleLeft && x < bottleRight && y >= bottleTop && y < bottleBottom;
      if (inBottle) {
        // Glass bottle with subtle cylindrical shading + crisp dark glass rim (6px)
        const rim =
          x - bottleLeft < 5 ||
          bottleRight - 1 - x < 5 ||
          y - bottleTop < 5 ||
          bottleBottom - 1 - y < 5;
        const u = (x - bottleLeft) / (bottleRight - bottleLeft);
        const shade = Math.round(215 - 45 * Math.abs(u - 0.45));
        data[i] = rim ? 28 : shade - 10;
        data[i + 1] = rim ? 38 : shade;
        data[i + 2] = rim ? 58 : Math.min(255, shade + 18);
      } else {
        // Textured studio surface so multi-scale pyramid has rich context in the outer ring
        const waveX = Math.sin(x * 0.09) * 18 + Math.cos(y * 0.07) * 14;
        const grain = ((x * 17 + y * 31) % 29) - 14;
        const base = 148 + (y / height) * 36 + waveX + grain * 0.5;
        data[i] = Math.max(0, Math.min(255, Math.round(base)));
        data[i + 1] = Math.max(0, Math.min(255, Math.round(base + 4)));
        data[i + 2] = Math.max(0, Math.min(255, Math.round(base + 10)));
      }
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

/**
 * Simulates a generative edit model that:
 * 1) Paints a new dark-blue emblem inside the center of the crop (the requested local change), AND
 * 2) Drifts in scale (`scaleX`, `scaleY`, e.g. +5% to +8% larger) and shifts by `(shiftPxX, shiftPxY)`
 *    in ROI pixels (causing a contour step if pasted back without alignment).
 */
async function simulateDriftedEdit(
  cropPng: Uint8Array,
  plan: RegionPlan,
  opts: { scaleX: number; scaleY: number; shiftRoiPxX: number; shiftRoiPxY: number; paintEmblem?: boolean },
): Promise<Buffer> {
  const { data: src, info } = await sharp(cropPng).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;

  // Paint emblem at crop center before applying drift
  const painted = Buffer.from(src);
  if (opts.paintEmblem !== false) {
    const cx = w * 0.5;
    const cy = h * 0.5;
    const rx = w * 0.09;
    const ry = h * 0.09;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (Math.abs(x - cx) <= rx && Math.abs(y - cy) <= ry) {
          const idx = (y * w + x) * 3;
          painted[idx] = 32;
          painted[idx + 1] = 78;
          painted[idx + 2] = 168;
        }
      }
    }
  }

  // Forward warp: output appears enlarged by (scaleX, scaleY) around center and shifted by (shiftX, shiftY).
  const dxNorm = opts.shiftRoiPxX / plan.roi.width;
  const dyNorm = opts.shiftRoiPxY / plan.roi.height;
  const out = Buffer.alloc(w * h * 3);
  const cx = (w - 1) * 0.5;
  const cy = (h - 1) * 0.5;

  const sampleBilinear = (fx: number, fy: number, c: number): number => {
    const x0 = Math.max(0, Math.min(w - 1, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(h - 1, Math.floor(fy)));
    const x1 = Math.min(w - 1, x0 + 1);
    const y1 = Math.min(h - 1, y0 + 1);
    const tx = Math.max(0, Math.min(1, fx - x0));
    const ty = Math.max(0, Math.min(1, fy - y0));
    const v00 = painted[(y0 * w + x0) * 3 + c]!;
    const v10 = painted[(y0 * w + x1) * 3 + c]!;
    const v01 = painted[(y1 * w + x0) * 3 + c]!;
    const v11 = painted[(y1 * w + x1) * 3 + c]!;
    return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
  };

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      // Output pixel (x, y) comes from source ((x - cx - shift) / scale + cx)
      const sx = (x - cx - dxNorm * w) / opts.scaleX + cx;
      const sy = (y - cy - dyNorm * h) / opts.scaleY + cy;
      const oi = (y * w + x) * 3;
      for (let c = 0; c < 3; c += 1) {
        out[oi + c] = Math.round(sampleBilinear(sx, sy, c));
      }
    }
  }

  return sharp(out, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

function diffOutsideBox(a: Buffer, b: Buffer, width: number, plan: RegionPlan): number {
  const { box } = plan;
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    const p = i / 4;
    const x = p % width;
    const y = Math.floor(p / width);
    if (x >= box.left && x < box.left + box.width && y >= box.top && y < box.top + box.height) continue;
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) {
      count += 1;
    }
  }
  return count;
}

describe('alignEditedRoi & compositeRegion — multi-scale context-ring alignment', () => {
  it('recovers +3% to +8% scale drift and 3–8px translation shift, eliminating bottle contour steps while keeping diffOutside === 0', async () => {
    const original = await makePerfumeBottleScene(480, 360);
    const size = await measureImage(original);
    // Box crosses both left and right walls of the perfume bottle (`x = 0.30..0.70`, `y = 0.34..0.64`)
    const plan = planRegion(size, { x: 0.3, y: 0.34, w: 0.4, h: 0.3 }, NANO_ASPECTS);
    const crop = await cropForEdit(original, plan);

    const driftedEdit = await simulateDriftedEdit(crop.bytes, plan, {
      scaleX: 1.065,
      scaleY: 1.045,
      shiftRoiPxX: 6,
      shiftRoiPxY: -5,
      paintEmblem: true,
    });

    // Measure unaligned outer-ring MAE for comparison
    const unalignedRaw = await sharp(driftedEdit)
      .resize(plan.roi.width, plan.roi.height, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer();
    const origRgba = await decodeRgba(original);
    let unalignedDiffSum = 0;
    let ringCount = 0;
    for (let ry = 0; ry < plan.roi.height; ry += 1) {
      const gy = plan.roi.top + ry;
      for (let rx = 0; rx < plan.roi.width; rx += 1) {
        const gx = plan.roi.left + rx;
        const inBox =
          gx >= plan.box.left &&
          gx < plan.box.left + plan.box.width &&
          gy >= plan.box.top &&
          gy < plan.box.top + plan.box.height;
        if (inBox) continue;
        const oi = (gy * origRgba.width + gx) * 4;
        const ei = (ry * plan.roi.width + rx) * 3;
        unalignedDiffSum +=
          (Math.abs(origRgba.data[oi]! - unalignedRaw[ei]!) +
            Math.abs(origRgba.data[oi + 1]! - unalignedRaw[ei + 1]!) +
            Math.abs(origRgba.data[oi + 2]! - unalignedRaw[ei + 2]!)) /
          3;
        ringCount += 1;
      }
    }
    const unalignedMae = unalignedDiffSum / Math.max(1, ringCount);

    const aligned = await alignEditedRoi({ original, edited: driftedEdit, plan });
    expect(aligned.misaligned).toBe(false);
    expect(aligned.ringResidual).toBeLessThan(12);
    expect(aligned.ringResidual).toBeLessThan(unalignedMae * 0.45);

    // Forward enlargement (1.065, 1.045) + shift (+6px, -5px) maps reference u=0 to edit u = +dxNorm,
    // so aligned.transform.dx * roi.width recovers +6px (within <= 1.5px across ROI).
    const recoveredShiftPxX = aligned.transform.dx * plan.roi.width;
    const recoveredShiftPxY = aligned.transform.dy * plan.roi.height;
    expect(Math.abs(recoveredShiftPxX - 6)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(recoveredShiftPxY - -5)).toBeLessThanOrEqual(1.5);

    const composed = await compositeRegion({ original, edited: driftedEdit, plan });
    expect(composed.misaligned).toBe(false);
    expect(composed.patchPng).toBeInstanceOf(Buffer);
    expect(composed.maskPng).toBeInstanceOf(Buffer);

    const patchMeta = await sharp(composed.patchPng!).metadata();
    const maskMeta = await sharp(composed.maskPng!).metadata();
    expect([patchMeta.width, patchMeta.height]).toEqual([plan.box.width, plan.box.height]);
    expect([maskMeta.width, maskMeta.height]).toEqual([plan.box.width, plan.box.height]);

    const afterRgba = await decodeRgba(composed.bytes);
    expect(diffOutsideBox(origRgba.data, afterRgba.data, origRgba.width, plan)).toBe(0);
  });

  it('widens feather along strong Sobel object contours while keeping mask strictly 0 outside plan.box', async () => {
    const original = await makePerfumeBottleScene(480, 360);
    const size = await measureImage(original);
    // Top edge of box crosses vertical bottle walls (`x ~ 173` and `x ~ 307`), while `x = 150` is flat backdrop
    const plan = planRegion(size, { x: 0.28, y: 0.35, w: 0.44, h: 0.3 }, NANO_ASPECTS);
    const origRgba = await decodeRgba(original);

    // Whole-box colour change so envelope controls the edge falloff directly
    const solidEdit = Buffer.alloc(plan.roi.width * plan.roi.height * 3, 40);
    const mask = await computeDiffMask({ original: origRgba, alignedRoi: solidEdit, plan });

    // Outside plan.box is strictly 0
    expect(diffMaskAt(mask, plan, plan.box.left - 1, plan.box.top + 10)).toBe(0);
    expect(diffMaskAt(mask, plan, plan.box.left + plan.box.width, plan.box.top + 10)).toBe(0);
    expect(diffMaskAt(mask, plan, plan.box.left + 10, plan.box.top - 1)).toBe(0);
    expect(diffMaskAt(mask, plan, plan.box.left + 10, plan.box.top + plan.box.height)).toBe(0);

    // Compare alpha 6px inside top edge at bottle rim (`x = Math.round(480 * 0.36)`) vs away from bottle (`x = plan.box.left + 8`)
    const bottleWallX = Math.round(480 * 0.36);
    const backdropX = plan.box.left + 12;
    const probeY = plan.box.top + 6;
    const alphaAtContour = diffMaskAt(mask, plan, bottleWallX, probeY);
    const alphaAtFlat = diffMaskAt(mask, plan, backdropX, probeY);
    expect(alphaAtContour).toBeLessThan(alphaAtFlat);
  });

  it('flags unrelated / hallucinated edits with high outer-ring residual as misaligned', async () => {
    const original = await makePerfumeBottleScene(480, 360);
    const plan = planRegion({ width: 480, height: 360 }, { x: 0.32, y: 0.32, w: 0.36, h: 0.36 }, NANO_ASPECTS);

    // Completely unrelated high-contrast checkerboard frame
    const { width: w, height: h } = plan.work;
    const garbageRaw = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const checker = ((Math.floor(x / 24) + Math.floor(y / 24)) % 2) === 0;
        const i = (y * w + x) * 3;
        garbageRaw[i] = checker ? 250 : 12;
        garbageRaw[i + 1] = checker ? 15 : 235;
        garbageRaw[i + 2] = checker ? 220 : 20;
      }
    }
    const garbagePng = await sharp(garbageRaw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();

    const aligned = await alignEditedRoi({ original, edited: garbagePng, plan });
    expect(aligned.ringResidual).toBeGreaterThan(28);
    expect(aligned.ringResidual).toBeGreaterThan(MAX_RING_RESIDUAL);
    expect(aligned.misaligned).toBe(true);
  });
});

describe('region_edit server lifecycle — retry, DB constraint, 0-credit refund & laneClaim aspect', () => {
  let fx: StudioFixture | null = null;
  afterEach(async () => {
    await fx?.db.close();
    fx = null;
  });

  it('retries a misaligned region edit once, then settles failed with errorCode="region_misaligned" and usage_krw=0 without violating brand_studio_jobs_error', async () => {
    fx = await studioFixture({ capKrw: 500_000 });
    const baseDeps = studioDeps(fx.sql);
    let compositeCalls = 0;

    const deps = studioDeps(fx.sql, {
      media: baseDeps.media,
      staging: baseDeps.staging,
      provider: baseDeps.provider,
      intel: {
        ...baseDeps.intel,
        planRegion: (img, box) => planRegion(img, box, NANO_ASPECTS),
        cropForEdit,
        async compositeRegion(input) {
          compositeCalls += 1;
          const res = await baseDeps.intel.compositeRegion(input);
          return { ...res, misaligned: true, ringResidual: 39.4 };
        },
      },
    });

    const sourceAssetId = await seedImageAsset(deps, fx.orgId, fx.ids.editor, { width: 480, height: 360 });
    const viewer = viewerOf(fx.ids.editor);

    const created = await createStudioJob(deps, viewer, {
      kind: 'region_edit',
      organizationId: fx.orgId,
      requestId: requestId(),
      model: 'nano-banana-pro',
      prompt: '로고를 지워줘 [[fake:misalign]]',
      enhance: false,
      source: { assetId: sourceAssetId },
      box: { x: 0.3, y: 0.3, w: 0.35, h: 0.35 },
      references: [],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Advance until settled (queued -> running -> finishing -> retry queued -> running -> finishing -> failed)
    for (let pass = 0; pass < 8; pass += 1) {
      await advanceStudioJobsWith(deps, { jobIds: [created.job.id] });
      const row = (await fx.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [created.job.id])).rows[0]!;
      if (row.status === 'failed' || row.status === 'succeeded') break;
    }

    expect(compositeCalls).toBe(2); // initial attempt + 1 automatic retry

    const dbRow = (await fx.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [created.job.id])).rows[0]!;
    expect(dbRow.status).toBe('failed');
    // SQL column satisfies `brand_studio_jobs_error` CHECK constraint (`'failed'`), while `work.region.misaligned` is true
    expect(dbRow.error_code).toBe('failed');
    expect(dbRow.work.region?.misaligned).toBe(true);
    expect(dbRow.usage_krw).toBe(0);

    const [view] = await viewsOf(fx.sql, [dbRow], deps.media);
    expect(view!.status).toBe('failed');
    expect(view!.errorCode).toBe('region_misaligned');
    expect(view!.estimateKrw).toBe(0);

    const allowance = await loadAllowance(fx.sql, fx.orgId, deps.env, new Date());
    expect(allowance.usedKrw).toBe(0);
  });

  it('stores patchPng & maskPng on aligned region_edit, exposes regionPatch on StudioOutputView, and cleans them up on deleteStudioOutput', async () => {
    fx = await studioFixture({ capKrw: 500_000 });
    const baseDeps = studioDeps(fx.sql);
    const sceneBytes = new Uint8Array(await makePerfumeBottleScene(320, 240));
    const { key: sourceKey } = await baseDeps.media.put(sceneBytes, 'image/png');
    const assetId = (
      await fx.sql.query<{ id: string }>(
        `insert into brand_studio_assets (organization_id, kind, name, mime, size_bytes, width, height, storage_key, source, status, created_by, sha256)
          values ($1, 'image', 'bottle.png', 'image/png', $2, 320, 240, $3, 'upload', 'ready', $4, $5) returning id`,
        [fx.orgId, sceneBytes.byteLength, sourceKey, fx.ids.editor, 'a'.repeat(64)],
      )
    ).rows[0]!.id;

    const deps = studioDeps(fx.sql, {
      media: baseDeps.media,
      staging: baseDeps.staging,
      provider: baseDeps.provider,
      intel: {
        ...baseDeps.intel,
        planRegion: (img, box) => planRegion(img, box, NANO_ASPECTS),
        cropForEdit,
        async compositeRegion(input) {
          // Use the real compositeRegion with a clean painted edit derived from input.original's crop
          const crop = await cropForEdit(input.original, input.plan);
          const cleanEdited = await simulateDriftedEdit(crop.bytes, input.plan, {
            scaleX: 1.03,
            scaleY: 1.03,
            shiftRoiPxX: 3,
            shiftRoiPxY: 2,
          });
          return compositeRegion({ original: input.original, edited: cleanEdited, plan: input.plan });
        },
      },
    });

    const viewer = viewerOf(fx.ids.editor);
    const created = await createStudioJob(deps, viewer, {
      kind: 'region_edit',
      organizationId: fx.orgId,
      requestId: requestId(),
      model: 'nano-banana-pro',
      prompt: '로고 넣어줘',
      enhance: false,
      source: { assetId },
      box: { x: 0.3, y: 0.3, w: 0.4, h: 0.35 },
      references: [],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    for (let pass = 0; pass < 6; pass += 1) {
      await advanceStudioJobsWith(deps, { jobIds: [created.job.id] });
      const row = (await fx.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [created.job.id])).rows[0]!;
      if (row.status === 'succeeded' || row.status === 'failed') break;
    }

    const dbRow = (await fx.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [created.job.id])).rows[0]!;
    expect(dbRow.status).toBe('succeeded');
    const patchInfo = dbRow.work.region?.patches?.['0'];
    expect(patchInfo?.patchKey).toBeTruthy();
    expect(patchInfo?.maskKey).toBeTruthy();
    // Working crop was dropped, but patch & mask remain in media store
    expect(deps.media.objects.has(dbRow.work.region!.cropKey)).toBe(false);
    expect(deps.media.objects.has(patchInfo!.patchKey)).toBe(true);
    expect(deps.media.objects.has(patchInfo!.maskKey!)).toBe(true);

    const [view] = await viewsOf(fx.sql, [dbRow], deps.media);
    const outView = view!.outputs[0]!;
    expect(outView.regionPatch).toBeTruthy();
    expect(outView.regionPatch?.url).toContain(patchInfo!.patchKey);
    expect(outView.regionPatch?.maskUrl).toContain(patchInfo!.maskKey!);
    expect(outView.sourceRef).toEqual({ assetId });

    // Deleting the output also cleans up patchKey and maskKey
    const deleted = await deleteStudioOutput(deps, viewer, { organizationId: fx.orgId, outputId: outView.id });
    expect(deleted.ok).toBe(true);
    expect(deps.media.objects.has(patchInfo!.patchKey)).toBe(false);
    expect(deps.media.objects.has(patchInfo!.maskKey!)).toBe(false);
  });

  it('laneClaim preserves work.region.plan.aspect ("3:2") on region_edit jobs where job.params.aspect is null (production bug f3138609)', async () => {
    fx = await studioFixture({ capKrw: 500_000 });
    const mcpEnv = studioEnv({
      BRAND_STUDIO_PROVIDER: 'none',
      BRAND_STUDIO_DEFAULT_LANE: 'sunra_mcp',
    });
    const baseDeps = studioDeps(fx.sql, { env: mcpEnv, provider: null });
    const deps = {
      ...baseDeps,
      intel: {
        ...baseDeps.intel,
        planRegion: (img: { width: number; height: number }, box: { x: number; y: number; w: number; h: number }) =>
          planRegion(img, box, NANO_ASPECTS),
        cropForEdit,
      },
    };

    await laneHeartbeat(deps, { worker: 'test-worker' });
    // 600x400 image + `{ w: 0.45, h: 0.45 }` -> 270x180 box (1.5:1) -> `plan.aspect === '3:2'` while `job.params.aspect === null`
    const sourceAssetId = await seedImageAsset(deps, fx.orgId, fx.ids.editor, { width: 600, height: 400 });
    const created = await createStudioJob(deps, viewerOf(fx.ids.editor), {
      kind: 'region_edit',
      organizationId: fx.orgId,
      requestId: requestId(),
      model: 'nano-banana-pro',
      prompt: '병 라벨 정리',
      enhance: false,
      source: { assetId: sourceAssetId },
      box: { x: 0.25, y: 0.25, w: 0.45, h: 0.45 },
      references: [],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Prepare the queued job so `work.region.plan.aspect` is computed (`'3:2'`)
    await advanceStudioJobsWith(deps, { jobIds: [created.job.id] });

    const rawRow = (await fx.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [created.job.id])).rows[0]!;
    expect(rawRow.params.aspect).toBeNull();
    expect(rawRow.work.region?.plan.aspect).toBe('3:2');

    const claimed = await laneClaim(deps, { limit: 1 });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(claimed.jobs).toHaveLength(1);
    expect(claimed.jobs[0]!.jobId).toBe(created.job.id);
    expect(claimed.jobs[0]!.params.aspect).toBe('3:2');
  });
});
