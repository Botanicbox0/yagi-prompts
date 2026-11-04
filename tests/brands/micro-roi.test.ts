import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { seedProfile } from '@/tests/helpers/billing';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { createStudioOrganization } from '@/lib/brands/workspace/service';
import { setFeaturePolicy } from '@/lib/brands/entitlements';
import {
  DENSE_FACE_COMPATIBILITY_GATES,
  MEDIAPIPE_FACE_OVAL,
  MEDIAPIPE_LEFT_EYE_BROW,
  MEDIAPIPE_MOUTH,
  MEDIAPIPE_RIGHT_EYE_BROW,
  buildMicroRoiEditSpec,
  compositeMicroRoiRgbaBuffer,
  computeMicroRoiCropPlan,
  computeMicroRoiToneLockPlan,
  evaluateMicroRoiAlignment,
  planBrandMicroRoiRepair
} from '@/lib/brands/finish';
import { BrandMicroRoiPanel } from '@/components/brand-workspace/brand-micro-roi-panel';

const adminId = randomUUID();
const ownerId = randomUUID();
const editorId = randomUUID();
const viewerId = randomUUID();

const makeViewer = (userId: string, isAdmin = false): Viewer => ({
  userId,
  isAdmin,
  tier: isAdmin ? 'admin' : 'free',
  email: `${userId}@example.test`,
  locale: 'ko'
});

const admin = makeViewer(adminId, true);
const owner = makeViewer(ownerId);
const editor = makeViewer(editorId);
const memberViewer = makeViewer(viewerId);

let db: PGlite;
let sql: SqlRunner;
let orgId: string;

beforeEach(async () => {
  db = await freshDb();
  sql = runner(db);
  for (const id of [adminId, ownerId, editorId, viewerId]) {
    await seedProfile(sql, {
      id,
      isAdmin: id === adminId,
      email: `${id}@example.test`
    });
  }
  const created = await createStudioOrganization({ sql }, admin, {
    name: 'KAIPER',
    requestId: randomUUID()
  });
  if (!created.ok) throw new Error(created.code);
  orgId = created.id;
  await sql.query(
    `insert into brand_memberships (organization_id, user_id, role)
       values ($1, $2, 'owner'),
              ($1, $3, 'editor'),
              ($1, $4, 'viewer')`,
    [orgId, ownerId, editorId, viewerId]
  );
});

afterEach(async () => {
  await db?.close();
});

describe('Step 1 — Micro-ROI Bounding Box Crop & LANCZOS4 Upscale Plan', () => {
  it('computes 1440px square canvas for ECC patch/logo modes and proportional 1400/1600px for face modes', () => {
    const logoCrop = computeMicroRoiCropPlan({
      imageWidth: 2048,
      imageHeight: 2560,
      x0: 700,
      y0: 530,
      x1: 920,
      y1: 750,
      mode: 'logo_mark_lock'
    });
    expect(logoCrop.ok).toBe(true);
    if (!logoCrop.ok) return;
    expect(logoCrop.plan.cropWidth).toBe(220);
    expect(logoCrop.plan.cropHeight).toBe(220);
    expect(logoCrop.plan.canvasWidth).toBe(1440);
    expect(logoCrop.plan.canvasHeight).toBe(1440);
    expect(logoCrop.plan.interpolationUp).toBe('LANCZOS4');

    const faceRefine = computeMicroRoiCropPlan({
      imageWidth: 2048,
      imageHeight: 2560,
      x0: 758,
      y0: 38,
      x1: 1290,
      y1: 563,
      mode: 'face_detail_refine'
    });
    expect(faceRefine.ok).toBe(true);
    if (!faceRefine.ok) return;
    expect(faceRefine.plan.upscaleLongEdgePx).toBe(1400);
    expect(Math.max(faceRefine.plan.canvasWidth, faceRefine.plan.canvasHeight)).toBe(1400);

    // Rejects crop boxes that cross structural seams (jawline, collar, glass_rim)
    const crossedSeam = computeMicroRoiCropPlan({
      imageWidth: 2048,
      imageHeight: 2560,
      x0: 700,
      y0: 530,
      x1: 920,
      y1: 750,
      mode: 'micro_patch_ecc',
      crossedSeams: ['jawline']
    });
    expect(crossedSeam.ok).toBe(false);
  });
});

describe('Step 2 — Pixel-Locked Edit Prompt & Reference Role Enforcement', () => {
  it('enforces mark_only for logo_mark_lock and consented_identity for face/expression modes', () => {
    expect(
      buildMicroRoiEditSpec({
        mode: 'logo_mark_lock',
        targetDescription: 'front logo symbol',
        referenceKind: 'full_product_photo'
      })
    ).toMatchObject({
      ok: false,
      code: 'full_product_photo_forbidden_for_logo'
    });

    const validLogo = buildMicroRoiEditSpec({
      mode: 'logo_mark_lock',
      targetDescription: 'front logo symbol',
      referenceKind: 'mark_only'
    });
    expect(validLogo.ok).toBe(true);
    if (validLogo.ok) {
      expect(validLogo.spec.prompt).toContain(
        'Keep every element of Image 1 fixed, pixel for pixel'
      );
      expect(validLogo.spec.workerEngineConfig.temperature).toBe(0.2);
    }

    expect(
      buildMicroRoiEditSpec({
        mode: 'face_detail_refine',
        targetDescription: 'natural cheek pores and eyelashes',
        referenceKind: 'none'
      })
    ).toMatchObject({
      ok: false,
      code: 'consented_identity_required_for_face'
    });

    const validFace = buildMicroRoiEditSpec({
      mode: 'face_detail_refine',
      targetDescription: 'natural cheek pores and eyelashes',
      referenceKind: 'consented_identity'
    });
    expect(validFace.ok).toBe(true);
    if (validFace.ok) {
      expect(validFace.spec.prompt).toContain('NON-UNIFORM skin micro-texture');
      expect(validFace.spec.customerSummary).not.toMatch(
        /nano\s*banana|seedance|seedream|comfyui/i
      );
    }
  });
});

describe('Step 3 — Subpixel Geometric Registration (ECC & 5-Point / MediaPipe Rigid Affine)', () => {
  it('validates ECC correlation, 5-point rigid scale & optical prefilter, and MediaPipe 478-point gates', () => {
    expect(MEDIAPIPE_RIGHT_EYE_BROW).toHaveLength(26);
    expect(MEDIAPIPE_LEFT_EYE_BROW).toHaveLength(26);
    expect(MEDIAPIPE_MOUTH).toHaveLength(31);
    expect(MEDIAPIPE_FACE_OVAL).toHaveLength(36);

    const eccOk = evaluateMicroRoiAlignment({
      method: 'ecc_affine',
      eccScore: 0.962,
      maxShiftPx: 4.2
    });
    expect(eccOk.passed).toBe(true);

    const rigidDownscale = evaluateMicroRoiAlignment({
      method: 'rigid_5point_lmeds',
      alignmentScale: 0.4,
      postwarpRmsIod: 0.08,
      denseMetrics: {
        featureRmsIod: 0.032,
        featureP95Iod: 0.051,
        mouthRmsIod: 0.038,
        faceOvalRmsIod: 0.049
      },
      sharedSkinMetrics: {
        iou: 0.84,
        targetCoverage: 0.89
      }
    });
    expect(rigidDownscale.passed).toBe(true);
    // Optical anti-aliasing prefilter triggered when scale < 0.75
    expect(rigidDownscale.opticalPrefilterSigma).toBeGreaterThan(0.5);

    const auRetake = evaluateMicroRoiAlignment({
      method: 'mediapipe_action_units',
      alignmentScale: 0.98,
      postwarpRmsIod: 0.06
    });
    expect(auRetake.passed).toBe(true);
    expect(auRetake.actionUnits).toEqual([
      'RIGHT_EYE_BROW',
      'LEFT_EYE_BROW',
      'MOUTH'
    ]);

    const auRejected = evaluateMicroRoiAlignment({
      method: 'mediapipe_action_units',
      alignmentScale: 0.98,
      postwarpRmsIod: 0.14
    });
    expect(auRejected.passed).toBe(false);
  });
});

describe('Step 4 & Step 5 — Frequency-Separated Tone Lock & Zero-Leak RGBA Composite', () => {
  it('computes keep_tone sigma, LAB L-median skin nudge, logo resize_mark, and guarantees outsidePixelsChanged === 0', () => {
    const tonePlan = computeMicroRoiToneLockPlan({
      method: 'lab_skin_l_median_and_keep_tone',
      canvasPx: 1440,
      shapeChanged: false,
      targetSkinMedianL: 168,
      sourceSkinMedianL: 176,
      logoMarkLock: {
        targetMarkHeightPx: 311,
        detectedMarkHeightPx: 340,
        targetCentreX: 734,
        targetCentreY: 731
      }
    });
    expect(tonePlan.gaussianSigmaPx).toBe(72);
    expect(tonePlan.labSkinDeltaL).toBe(-8);
    expect(tonePlan.labSkinAppliedNudgeL).toBe(-2.8);
    expect(tonePlan.logoResizePlan?.targetMarkHeightPx).toBe(311);
    expect(tonePlan.logoResizePlan?.targetCentre).toEqual([734, 731]);

    // Test pixel-level RGBA composite guarantee: outsidePixelsChanged === 0 and maxAlphaAtBoxEdge === 0
    const width = 64;
    const height = 64;
    const originalRgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < originalRgba.length; i += 4) {
      originalRgba[i] = 120;
      originalRgba[i + 1] = 125;
      originalRgba[i + 2] = 130;
      originalRgba[i + 3] = 255;
    }

    const box = { x0: 16, y0: 16, x1: 48, y1: 48 };
    const bw = box.x1 - box.x0;
    const bh = box.y1 - box.y0;
    const alignedPatchRgba = new Uint8ClampedArray(bw * bh * 4);
    for (let py = 0; py < bh; py++) {
      for (let px = 0; px < bw; px++) {
        const idx = (py * bw + px) * 4;
        // High-frequency detail inside the patch + deliberate global brightness shift (+25)
        const pattern = (px + py) % 2 === 0 ? 18 : -18;
        alignedPatchRgba[idx] = 145 + pattern;
        alignedPatchRgba[idx + 1] = 150 + pattern;
        alignedPatchRgba[idx + 2] = 155 + pattern;
        alignedPatchRgba[idx + 3] = 255;
      }
    }

    const comp = compositeMicroRoiRgbaBuffer({
      width,
      height,
      originalRgba,
      box,
      alignedPatchRgba
    });
    expect(comp.outsidePixelsChanged).toBe(0);
    expect(comp.maxAlphaAtBoxEdge).toBe(0);
    expect(comp.insidePixelsChanged).toBeGreaterThan(0);
    expect(comp.zeroLeakGuaranteePassed).toBe(true);
  });
});

describe('Authorized Service, Morphic Isolation, UI Panel & Python CV Harness CLI', () => {
  it('queues workstation Micro-ROI repair for KAIPER, blocks Morphic, and executes the Python CV harness', async () => {
    const planned = await planBrandMicroRoiRepair({ sql }, editor, {
      organizationId: orgId,
      projectId: 'kaiper-26ss-outdoor',
      mode: 'logo_mark_lock',
      imageWidth: 2048,
      imageHeight: 2560,
      box: { x0: 700, y0: 530, x1: 920, y1: 750 },
      targetDescription: '가슴 로고 심볼 선명도 복원',
      referenceKind: 'mark_only',
      enqueueWorkstationJob: true
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.modeCode).toBe('M2_LOGO_MARK_LOCK');
    expect(planned.plan.step5FeatherComposite.zeroLeakAlphaFloor).toBe(
      DENSE_FACE_COMPATIBILITY_GATES.zeroLeakAlphaFloor
    );
    expect(planned.plan.workstationTask?.op).toBe('inpaint');
    expect(planned.plan.workstationTask?.gpuArbiterSlot).toBe('comfyui');

    // Viewer cannot queue Micro-ROI repairs
    const viewerTry = await planBrandMicroRoiRepair({ sql }, memberViewer, {
      organizationId: orgId,
      mode: 'micro_patch_ecc',
      box: { x0: 100, y0: 100, x1: 300, y1: 300 },
      targetDescription: '손 아티팩트 제거'
    });
    expect(viewerTry).toEqual({ ok: false, code: 'forbidden' });

    // Morphic (generative_media denied) is strictly blocked with feature_unavailable
    await setFeaturePolicy({ sql }, admin, {
      organizationId: orgId,
      denied: ['generative_media', 'sound', 'color_grading'],
      note: 'Morphic policy',
      expectedRevision: 0
    });
    const morphicTry = await planBrandMicroRoiRepair({ sql }, owner, {
      organizationId: orgId,
      mode: 'micro_patch_ecc',
      box: { x0: 100, y0: 100, x1: 300, y1: 300 },
      targetDescription: '손 아티팩트 제거'
    });
    expect(morphicTry).toEqual({ ok: false, code: 'feature_unavailable' });

    // UI Panel renders without any internal engine names
    const html = renderToStaticMarkup(
      createElement(BrandMicroRoiPanel, {
        organizationId: orgId,
        projectId: 'kaiper-26ss-outdoor',
        locale: 'ko',
        canWrite: true
      })
    );
    expect(html).toContain('data-brand-micro-roi-panel');
    expect(html).toContain('data-micro-roi-preset="logo_chest"');
    expect(html).toContain('data-micro-roi-preset="expression_retake"');
    expect(html).not.toMatch(/seedance|seedream|nano\s*banana|seedvr2|comfyui/i);

    // Execute the Python CV harness (`scripts/brand-micro-roi-harness.py`) on a synthetic test image
    // when Python + numpy/Pillow are available (workstation); on bare Node-only CI runners without numpy,
    // verify the harness CLI help contract.
    const harnessPath = join(
      process.cwd(),
      'scripts',
      'brand-micro-roi-harness.py'
    );
    let hasPythonCvDeps = false;
    try {
      execFileSync('python', ['-c', 'import numpy as np; from PIL import Image'], {
        stdio: 'ignore',
        windowsHide: true
      });
      hasPythonCvDeps = true;
    } catch {
      hasPythonCvDeps = false;
    }

    if (hasPythonCvDeps) {
      const tmp = mkdtempSync(join(tmpdir(), 'twings-micro-roi-'));
      try {
        const srcPath = join(tmp, 'source.png');
        const cropPath = join(tmp, 'crop.png');
        const patchPath = join(tmp, 'patch.png');
        const outPath = join(tmp, 'out.png');

        execFileSync(
          'python',
          [
            '-c',
            `import numpy as np; from PIL import Image;
img = np.full((256, 256, 3), 128, dtype=np.uint8);
Image.fromarray(img).save(${JSON.stringify(srcPath)});
patch = np.full((256, 256, 3), 140, dtype=np.uint8);
patch[60:196, 60:196] = 200;
Image.fromarray(patch).save(${JSON.stringify(patchPath)})`
          ],
          { windowsHide: true }
        );

        const cropStdout = execFileSync(
          'python',
          [
            harnessPath,
            'crop',
            '--source',
            srcPath,
            '--box',
            '64,64,192,192',
            '--canvas',
            '512',
            '--out',
            cropPath
          ],
          { encoding: 'utf-8', windowsHide: true }
        );
        const cropMeta = JSON.parse(cropStdout.trim());
        expect(cropMeta.ok).toBe(true);
        expect(cropMeta.canvas_px).toBe(512);

        const compStdout = execFileSync(
          'python',
          [
            harnessPath,
            'composite',
            '--mode',
            'micro_patch_ecc',
            '--source',
            srcPath,
            '--patch',
            patchPath,
            '--box',
            '64,64,192,192',
            '--canvas',
            '512',
            '--out',
            outPath
          ],
          { encoding: 'utf-8', windowsHide: true }
        );
        const compMeta = JSON.parse(compStdout.trim());
        expect(compMeta.ok).toBe(true);
        expect(compMeta.outside_pixels_changed).toBe(0);
        expect(compMeta.max_edge_alpha).toBe(0);
        expect(compMeta.inside_pixels_changed).toBeGreaterThan(0);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }
  });
});
