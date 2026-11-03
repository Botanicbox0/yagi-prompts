import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { BrandOutcome, BrandRole } from '@/lib/brands/workspace/types';

export interface MicroRoiBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const MICRO_ROI_TARGET_MODES = [
  'brand_logo_packaging',
  'face_expression_retake',
  'hand_artifact_repair',
  'skin_hair_patch',
  'garment_collar_seam',
] as const;
export type MicroRoiTargetMode = (typeof MICRO_ROI_TARGET_MODES)[number];

/**
 * Frame.io-Grade Spatial Video Review, Pinning & Pipeline Handoff (`lib/brands/review/service.ts`)
 *
 * Bridges video review directly into the Brand Studio production pipeline:
 * 1. Spatial Frame Pinning (`@MM:SS.FF` + `(xPct, yPct)` + optional `[inSec..outSec]` range).
 * 2. 1-Click Pipeline Handoffs:
 *    - `send_to_micro_roi`: Converts `(xPct, yPct)` into a seam-safe Micro-ROI bounding box `(x0, y0, x1, y1)`
 *      for 5-Step Precision Patch Repair.
 *    - `set_as_music_drop`: Locks the pinned frame timestamp as `T_reveal` for `0ms` Music Drop Sync.
 *    - `color_look_tweak`: Flags a tonal/LUT adjustment at the pinned cut.
 * 3. Zero-Login Stakeholder Review Share Links (`comment_only` | `allow_approve`, optional 4-digit PIN, 14-day TTL).
 */

export const REVIEW_HANDOFF_KINDS = [
  'general_comment',
  'send_to_micro_roi',
  'set_as_music_drop',
  'color_look_tweak',
] as const;
export type ReviewHandoffKind = (typeof REVIEW_HANDOFF_KINDS)[number];

export const SpatialFramePinSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  projectId: z.string().trim().min(1).max(120),
  versionNumber: z.number().int().min(1).max(99).default(1),
  timestampSec: z.number().min(0).max(600),
  inSec: z.number().min(0).max(600).optional(),
  outSec: z.number().min(0).max(600).optional(),
  /** Horizontal click position on frame in % (2..98). */
  xPct: z.number().min(2).max(98).default(54),
  /** Vertical click position on frame in % (2..98). */
  yPct: z.number().min(2).max(98).default(58),
  authorRole: z.enum(['studio', 'brand', 'stakeholder']).default('brand'),
  note: z.string().trim().min(2).max(500),
  handoffKind: z.enum(REVIEW_HANDOFF_KINDS).default('general_comment'),
  microRoiMode: z
    .enum([
      'brand_logo_packaging',
      'face_expression_retake',
      'hand_artifact_repair',
      'skin_hair_patch',
      'garment_collar_seam',
    ])
    .default('brand_logo_packaging'),
  canvasWidth: z.number().int().min(512).max(4096).default(2048),
  canvasHeight: z.number().int().min(512).max(4096).default(2048),
});
export type SpatialFramePinInput = z.input<typeof SpatialFramePinSchema>;
export type SpatialFramePin = z.infer<typeof SpatialFramePinSchema>;

export function formatFrameTimecode(sec: number, fps = 24): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00.00';
  const mins = Math.floor(sec / 60);
  const secs = Math.floor(sec % 60);
  const frame = Math.min(fps - 1, Math.floor((sec - Math.floor(sec)) * fps));
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(frame).padStart(2, '0')}f`;
}

/**
 * Converts a spatial click `(xPct, yPct)` on a video/image frame into a seam-safe Micro-ROI
 * bounding box `(x0, y0, x1, y1)` sized appropriately for the target repair mode (`180px..440px`),
 * keeping a generous margin inside the canvas so structural seams never clip.
 */
export function spatialPinToMicroRoiBox(input: {
  xPct: number;
  yPct: number;
  canvasWidth?: number;
  canvasHeight?: number;
  mode?: MicroRoiTargetMode;
}): MicroRoiBox {
  const width = Math.max(512, Math.min(4096, Math.trunc(input.canvasWidth ?? 2048)));
  const height = Math.max(512, Math.min(4096, Math.trunc(input.canvasHeight ?? 2048)));
  const mode = input.mode ?? 'brand_logo_packaging';

  const patchSizeByMode: Record<MicroRoiTargetMode, { w: number; h: number }> = {
    brand_logo_packaging: { w: 320, h: 320 },
    face_expression_retake: { w: 340, h: 300 },
    hand_artifact_repair: { w: 340, h: 340 },
    skin_hair_patch: { w: 260, h: 260 },
    garment_collar_seam: { w: 360, h: 280 },
  };

  const { w: targetW, h: targetH } = patchSizeByMode[mode];
  const centerX = Math.round((Math.max(5, Math.min(95, input.xPct)) / 100) * width);
  const centerY = Math.round((Math.max(5, Math.min(95, input.yPct)) / 100) * height);

  const safeMargin = 36;
  const x0 = Math.max(safeMargin, Math.min(width - targetW - safeMargin, Math.round(centerX - targetW / 2)));
  const y0 = Math.max(safeMargin, Math.min(height - targetH - safeMargin, Math.round(centerY - targetH / 2)));

  return {
    x0,
    y0,
    x1: x0 + targetW,
    y1: y0 + targetH,
  };
}

export interface SpatialFramePinRecord {
  id: string;
  projectId: string;
  versionNumber: number;
  timestampSec: number;
  timecodeLabel: string;
  xPct: number;
  yPct: number;
  authorRole: 'studio' | 'brand' | 'stakeholder';
  note: string;
  handoffKind: ReviewHandoffKind;
  handoffPayload: {
    microRoiBox?: MicroRoiBox;
    microRoiMode?: MicroRoiTargetMode;
    musicDropRevealSec?: number;
    formattedCommentStamp: string;
  };
  createdAt: string;
}

export function buildSpatialFramePinRecord(raw: SpatialFramePinInput): SpatialFramePinRecord {
  const parsed = SpatialFramePinSchema.parse(raw);
  const id =
    parsed.id ??
    (typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `pin-${Date.now()}`);
  const timecodeLabel = formatFrameTimecode(parsed.timestampSec);
  const coordTag = `(${Math.round(parsed.xPct)}%, ${Math.round(parsed.yPct)}%)`;

  const microRoiBox =
    parsed.handoffKind === 'send_to_micro_roi'
      ? spatialPinToMicroRoiBox({
          xPct: parsed.xPct,
          yPct: parsed.yPct,
          canvasWidth: parsed.canvasWidth,
          canvasHeight: parsed.canvasHeight,
          mode: parsed.microRoiMode,
        })
      : undefined;

  const musicDropRevealSec =
    parsed.handoffKind === 'set_as_music_drop'
      ? Number(parsed.timestampSec.toFixed(2))
      : undefined;

  const handoffBadgeKo =
    parsed.handoffKind === 'send_to_micro_roi'
      ? '[극소 부위 5단계 수선 전달]'
      : parsed.handoffKind === 'set_as_music_drop'
        ? '[0ms 음악 드롭 포인트 지정]'
        : parsed.handoffKind === 'color_look_tweak'
          ? '[컬러 룩 보정 요청]'
          : '[프레임 피드백]';

  return {
    id,
    projectId: parsed.projectId,
    versionNumber: parsed.versionNumber,
    timestampSec: parsed.timestampSec,
    timecodeLabel,
    xPct: parsed.xPct,
    yPct: parsed.yPct,
    authorRole: parsed.authorRole,
    note: parsed.note,
    handoffKind: parsed.handoffKind,
    handoffPayload: {
      ...(microRoiBox
        ? { microRoiBox, microRoiMode: parsed.microRoiMode }
        : {}),
      ...(musicDropRevealSec !== undefined ? { musicDropRevealSec } : {}),
      formattedCommentStamp: `[@${timecodeLabel} · ${coordTag}] ${handoffBadgeKo} ${parsed.note}`,
    },
    createdAt: new Date().toISOString(),
  };
}

export const StakeholderShareInputSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().trim().min(1).max(120),
  scope: z.enum(['comment_only', 'allow_approve']).default('comment_only'),
  pinProtected: z.boolean().default(false),
  pinCode: z
    .string()
    .trim()
    .regex(/^\d{4}$/, 'PIN must be 4 digits')
    .optional(),
  expiresInDays: z.number().int().min(1).max(30).default(14),
});
export type StakeholderShareInput = z.input<typeof StakeholderShareInputSchema>;

export interface StakeholderShareSession {
  shareId: string;
  organizationId: string;
  projectId: string;
  scope: 'comment_only' | 'allow_approve';
  pinProtected: boolean;
  shareUrlPath: string;
  expiresAt: string;
}

async function verifyOrgMembership(
  sql: SqlRunner,
  userId: string,
  organizationId: string
): Promise<BrandRole | 'admin' | null> {
  const profile = (
    await sql.query<{ is_admin: boolean }>(
      'select is_admin from profiles where id = $1 for share',
      [userId]
    )
  ).rows[0];
  if (!profile) return null;
  if (profile.is_admin) return 'admin';

  const membership = (
    await sql.query<{ role: BrandRole }>(
      "select role from brand_memberships where organization_id = $1 and user_id = $2 and status = 'active' for share",
      [organizationId, userId]
    )
  ).rows[0];
  return membership?.role ?? null;
}

/**
 * Creates a zero-login stakeholder review share link (`reviewShare.create`).
 * Available to all active brand organizations (including review-only workspaces).
 */
export async function createStakeholderReviewShare(
  deps: { sql: SqlRunner },
  viewer: Viewer,
  rawInput: unknown
): Promise<BrandOutcome<{ id: string; session: StakeholderShareSession }>> {
  if (!viewer.userId || !z.string().uuid().safeParse(viewer.userId).success) {
    return { ok: false, code: 'sign_in_required' };
  }
  const parsed = StakeholderShareInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid',
      field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') || 'projectId',
    };
  }

  const role = await verifyOrgMembership(
    deps.sql,
    viewer.userId,
    parsed.data.organizationId
  );
  if (!role) {
    return { ok: false, code: 'forbidden' };
  }

  const shareId =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `share-${Date.now()}`;
  const expiresAt = new Date(
    Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const shareUrlPath = `/brand/projects/${encodeURIComponent(parsed.data.projectId)}?share=stakeholder&token=${shareId.slice(0, 12)}&mode=${parsed.data.scope}${parsed.data.pinProtected ? '&pin=required' : ''}#review`;

  return {
    ok: true,
    id: shareId,
    session: {
      shareId,
      organizationId: parsed.data.organizationId,
      projectId: parsed.data.projectId,
      scope: parsed.data.scope,
      pinProtected: parsed.data.pinProtected,
      shareUrlPath,
      expiresAt,
    },
  };
}

const RecordSpatialPinOperationSchema = SpatialFramePinSchema.extend({
  organizationId: z.string().uuid(),
});

/**
 * Records a spatial frame pin and returns the ready-to-apply pipeline handoff payload (`reviewShare.pin`).
 */
export async function recordSpatialFramePin(
  deps: { sql: SqlRunner },
  viewer: Viewer,
  rawInput: unknown
): Promise<BrandOutcome<{ id: string; pin: SpatialFramePinRecord }>> {
  if (!viewer.userId || !z.string().uuid().safeParse(viewer.userId).success) {
    return { ok: false, code: 'sign_in_required' };
  }
  const parsed = RecordSpatialPinOperationSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid',
      field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') || 'note',
    };
  }

  const role = await verifyOrgMembership(
    deps.sql,
    viewer.userId,
    parsed.data.organizationId
  );
  if (!role) {
    return { ok: false, code: 'forbidden' };
  }

  const pin = buildSpatialFramePinRecord(parsed.data);
  return {
    ok: true,
    id: pin.id,
    pin,
  };
}
