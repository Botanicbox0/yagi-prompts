import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import {
  BrandFeatureDenied,
  assertBrandFeature,
  isMissingTable
} from '@/lib/brands/entitlements';
import {
  confirmedIdentityFor,
  listMemory,
  markConfirmedBrandIdentity,
  twingsDefaultIdentity,
  type ConfirmedBrandIdentity
} from '@/lib/brands/identity/service';
import type { BrandFailureCode, BrandOutcome, BrandRole } from '@/lib/brands/workspace/types';
import type { BrandMemoryContext, CompilerGrammarId } from './compiler';
import {
  DELIVERABLE_MEDIUMS,
  DELIVERABLE_USES,
  PUBLIC_CUT_KIND_CODES,
  SHOT_ASPECTS,
  SHOT_CUT_KINDS,
  SHOT_CUT_KIND_LABELS,
  ShotSpecSchema,
  resolveInternalCutKind,
  type CustomerBriefView,
  type CustomerGrammarCode,
  type DeliverableMedium,
  type DeliverableUse,
  type PublicCutKindCode,
  type ShotAspect,
  type ShotCutKind,
  type ShotSpec
} from './schema';
export {
  PUBLIC_CUT_KIND_CODES,
  SHOT_CUT_KIND_LABELS,
  resolveInternalCutKind,
  type CustomerBriefView,
  type CustomerGrammarCode,
  type PublicCutKindCode
};
import {
  BRIEF_DELTA_AXES,
  BRIEF_LIFECYCLE_STAGES,
  DEFAULT_MAX_BRIEF_ROUNDS,
  approveBrief,
  createDraftBrief,
  promoteBriefToFinal,
  reviseDraftBrief,
  type BrandBriefState,
  type BriefDeltaAxis,
  type BriefTransitionErrorCode
} from './state-machine';

const uuid = z.string().uuid();

class Denied extends Error {
  constructor(readonly code: BrandFailureCode) {
    super(code);
  }
}

async function authorizeBriefActor(
  sql: SqlRunner,
  userId: string,
  organizationId: string,
  allowedRoles: readonly BrandRole[]
): Promise<'admin' | BrandRole> {
  const profile = (
    await sql.query<{ is_admin: boolean }>(
      'select is_admin from profiles where id = $1 for share',
      [userId]
    )
  ).rows[0];
  if (!profile) throw new Denied('sign_in_required');

  const org = (
    await sql.query<{ id: string }>(
      'select id from brand_organizations where id = $1 for share',
      [organizationId]
    )
  ).rows[0];

  if (profile.is_admin === true) {
    if (!org) throw new Denied('not_found');
    return 'admin';
  }

  const membership = (
    await sql.query<{ role: BrandRole }>(
      "select role from brand_memberships where organization_id = $1 and user_id = $2 and status = 'active' for share",
      [organizationId, userId]
    )
  ).rows[0];

  if (!membership || !allowedRoles.includes(membership.role)) {
    throw new Denied('forbidden');
  }
  if (!org) throw new Denied('not_found');
  return membership.role;
}

const GRAMMAR_VIEW_MAP: Record<
  CompilerGrammarId,
  { code: CustomerGrammarCode; ko: string; en: string }
> = {
  'gpt-image-2.5': {
    code: 'G1_structured_blocks',
    ko: '문법 1 · 5블록 디렉팅 명세',
    en: 'Grammar 1 · 5-Block Direction Spec'
  },
  'nano-banana-pro': {
    code: 'G2_identity_composition_lock',
    ko: '문법 2 · 형태·구도 고정 블록',
    en: 'Grammar 2 · Geometry & Composition Lock'
  },
  'seedream-5.0-pro': {
    code: 'G3_reference_paragraphs',
    ko: '문법 3 · 레퍼런스 보존 4단락',
    en: 'Grammar 3 · Reference Preservation 4-Paragraph'
  },
  'flux-kontext': {
    code: 'G4_camera_first_optics',
    ko: '문법 4 · 광학·재질 우선 명세',
    en: 'Grammar 4 · Camera-First Optics Spec'
  },
  'soul-2.0': {
    code: 'G5_editorial_atmosphere',
    ko: '문법 5 · 에디토리얼 무드·색 대역',
    en: 'Grammar 5 · Editorial Atmosphere & Palette'
  },
  'ideogram-recraft': {
    code: 'G6_typography_grid',
    ko: '문법 6 · 타이포그래피·그리드 잠금',
    en: 'Grammar 6 · Typography & Grid Lock'
  },
  'seedance-2.5': {
    code: 'G7_timeline_film',
    ko: '문법 7 · 타임라인 멀티샷 필름',
    en: 'Grammar 7 · Timeline Multi-Shot Film'
  }
};

export function toCustomerBriefView(
  state: BrandBriefState,
  identitySource: 'confirmed' | 'default_fallback'
): CustomerBriefView {
  const gInfo = GRAMMAR_VIEW_MAP[state.compiled.params.grammar];
  const cInfo = SHOT_CUT_KIND_LABELS[state.spec.cutKind];
  return {
    id: state.id,
    organizationId: state.organizationId,
    stage: state.stage,
    round: state.round,
    maxRounds: state.maxRounds,
    lastChangedAxis: state.lastChangedAxis,
    identitySource,
    cutKindCode: cInfo.code,
    cutKindLabel: {
      ko: cInfo.ko,
      en: cInfo.en,
      roleKo: cInfo.roleKo,
      roleEn: cInfo.roleEn
    },
    deliverable: state.spec.deliverable,
    grammarCode: gInfo.code,
    grammarLabel: { ko: gInfo.ko, en: gInfo.en },
    prompt: state.compiled.prompt,
    renderStage: state.compiled.params.stage,
    resolution: state.compiled.params.resolution,
    draftFlag: Boolean(state.compiled.params.draft),
    bitrateMode: state.compiled.params.bitrateMode ?? 'high',
    lint: state.compiled.lint.map((issue) => ({
      rule: issue.rule,
      severity: issue.severity,
      text: issue.text
    })),
    lockedSpecHash: state.lockedSpecHash,
    approvedAt: state.approvedAt,
    finalizedAt: state.finalizedAt,
    updatedAt: state.updatedAt
  };
}

export const QuickBriefInputSchema = z.object({
  organizationId: uuid,
  brief: z.string().trim().min(2).max(500),
  cutKind: z
    .enum([...SHOT_CUT_KINDS, 'opening_keyframe'] as const)
    .default('reference_exact_product')
    .transform((v): ShotCutKind =>
      v === 'opening_keyframe' ? 'seedance_start_frame' : v
    ),
  medium: z.enum(DELIVERABLE_MEDIUMS).optional(),
  aspect: z.enum(SHOT_ASPECTS).default('4:5'),
  use: z.enum(DELIVERABLE_USES).default('feed'),
  productName: z.string().trim().max(160).optional(),
  vesselGeometry: z
    .string()
    .trim()
    .max(240)
    .default('cylindrical glass vessel with clean shoulder'),
  labelLock: z
    .string()
    .trim()
    .max(240)
    .default('front label centered with crisp brand typography'),
  materialFinish: z
    .string()
    .trim()
    .max(240)
    .default('matte glass with brushed metallic cap'),
  spaceMidground: z
    .string()
    .trim()
    .min(2)
    .max(200)
    .default('hero object on architectural stone plinth'),
  spaceBackground: z
    .string()
    .trim()
    .min(2)
    .max(200)
    .default('soft daylight plaster wall with generous negative space'),
  spaceSurface: z
    .string()
    .trim()
    .min(2)
    .max(160)
    .default('honed limestone tabletop'),
  cameraFocalMm: z.number().int().min(14).max(200).default(50),
  lightModifier: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .default('large diffused window softbox'),
  lightColourK: z.number().int().min(2500).max(9000).default(5400),
  durationSeconds: z.number().int().min(3).max(15).default(5)
});

export type QuickBriefInput = z.input<typeof QuickBriefInputSchema>;

/**
 * Builds a validated `ShotSpec` from a 1-line brief + selector inputs and the organization's identity.
 */
export function buildShotSpecFromQuickInput(
  raw: QuickBriefInput,
  identity: ConfirmedBrandIdentity = markConfirmedBrandIdentity(
    twingsDefaultIdentity()
  )
): ShotSpec {
  const parsed = QuickBriefInputSchema.parse(raw);
  const isVideoCut =
    parsed.cutKind === 'short_film_clip' ||
    parsed.cutKind === 'video_object_replace';
  const medium: DeliverableMedium =
    parsed.medium ??
    (isVideoCut
      ? 'short film'
      : parsed.cutKind === 'typography_layout'
        ? 'typography card'
        : parsed.cutKind === 'editorial_full_body'
          ? 'editorial still'
          : 'product still');

  const cutKind: ShotCutKind =
    medium === 'short film' && !isVideoCut ? 'short_film_clip' : parsed.cutKind;

  const durationS = parsed.durationSeconds ?? 5;
  const midCut = Math.round((durationS * 0.45) * 10) / 10;

  const spec: ShotSpec = ShotSpecSchema.parse({
    brief: parsed.brief,
    cutKind,
    deliverable: {
      medium,
      aspect: parsed.aspect as ShotAspect,
      use: parsed.use as DeliverableUse
    },
    references: [],
    subject:
      cutKind === 'person_portrait' || cutKind === 'editorial_full_body'
        ? {
            kind: 'fictional',
            age_band: '20s',
            hair: 'natural dark editorial styling',
            pose: {
              torso_deg: 15,
              head_tilt: 'neutral',
              gaze: 'camera',
              hands: 'relaxed natural posture'
            }
          }
        : null,
    product: {
      name: parsed.productName?.trim() || 'Brand Hero Product',
      vessel_geometry: parsed.vesselGeometry,
      label_lock: parsed.labelLock,
      material_finish: parsed.materialFinish
    },
    wardrobe: null,
    space: {
      foreground: 'clean unobstructed foreground',
      midground: parsed.spaceMidground,
      background: parsed.spaceBackground,
      surface: parsed.spaceSurface
    },
    camera: {
      focal_mm: parsed.cameraFocalMm,
      distance_m: 1.8,
      tilt_deg: 0,
      height: 'eye-level',
      subject_width_pct: 32,
      margin_pct: 16,
      aperture: 'f/4',
      dof_ratio: 2.0
    },
    light: {
      key: {
        modifier: parsed.lightModifier,
        side: 'camera-left',
        height: 'slightly above eye-level',
        distance: 'medium',
        effect: 'soft directional falloff across the hero surface'
      },
      fill: 'white bounce card camera-right, one stop under',
      colour_k: parsed.lightColourK
    },
    tone: {
      key_classification: 'balanced',
      lifted_black_hex: identity.colour.ink,
      shadow_hex: identity.colour.body,
      mid_hex: identity.colour.accent,
      highlight_hex: identity.colour.paper,
      saturation_pct: 24,
      shadow_share_pct: 32,
      halation: 0.12,
      grain_sigma: 1.4
    },
    palette: {
      world: 'blue',
      hex_values: [
        identity.colour.paper,
        identity.colour.canvas,
        identity.colour.accent
      ],
      warm_notes: ['skin', 'lips']
    },
    ...(medium === 'short film'
      ? {
          duration_s: durationS,
          timeline: [
            {
              shot: 1,
              start: 0,
              end: midCut,
              edit: 'hard cut',
              focal_mm: parsed.cameraFocalMm,
              camera: 'steady eye-level dolly-in across tabletop',
              action: `Establish the architectural space and key light: ${parsed.brief}`
            },
            {
              shot: 2,
              start: midCut,
              end: durationS,
              edit: 'hard cut',
              focal_mm: Math.min(200, parsed.cameraFocalMm + 20),
              camera: 'locked hero reveal frame with clean margin',
              action: `Lock hero composition on ${parsed.productName?.trim() || 'the product'} with crisp label clarity`
            }
          ]
        }
      : {})
  });

  return spec;
}

async function resolveBrandIdentityAndMemory(
  sql: SqlRunner,
  organizationId: string
): Promise<{
  identity: ConfirmedBrandIdentity;
  identitySource: 'confirmed' | 'default_fallback';
  memory: BrandMemoryContext;
}> {
  const [confirmed, memoryRows] = await Promise.all([
    confirmedIdentityFor(sql, organizationId),
    listMemory(sql, organizationId, 50)
  ]);
  const identity =
    confirmed ?? markConfirmedBrandIdentity(twingsDefaultIdentity());
  const identitySource = confirmed ? 'confirmed' : 'default_fallback';

  const approvedFrames: string[] = [];
  const bannedPhrases: string[] = [];
  const savedLooks: string[] = [];

  for (const row of memoryRows) {
    const summary =
      typeof row.payload.summary === 'string' ? row.payload.summary.trim() : '';
    if (!summary) continue;
    if (row.kind === 'approved_cut') approvedFrames.push(summary);
    else if (row.kind === 'banned_phrase') bannedPhrases.push(summary);
    else if (row.kind === 'saved_look') savedLooks.push(summary);
  }

  return {
    identity,
    identitySource,
    memory: { approvedFrames, bannedPhrases, savedLooks }
  };
}

const CompileBriefOperationSchema = z.object({
  organizationId: uuid,
  spec: ShotSpecSchema.optional(),
  quick: QuickBriefInputSchema.omit({ organizationId: true }).optional()
});

export interface BrandBriefServiceResult {
  id: string;
  brief: BrandBriefState;
  view: CustomerBriefView;
}

/**
 * Compiles a new `draft` brief (`480p --draft true`, `round = 1`) for `/brand/studio`.
 * Enforces `generative_media` feature policy and `owner | editor` membership.
 */
export async function compileBrandBrief(
  deps: { sql: SqlRunner },
  viewer: Viewer,
  input: unknown
): Promise<BrandOutcome<BrandBriefServiceResult>> {
  if (!uuid.safeParse(viewer.userId).success) {
    return { ok: false, code: 'sign_in_required' };
  }
  const parsed = CompileBriefOperationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid',
      field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') || 'spec'
    };
  }
  const { organizationId } = parsed.data;

  try {
    return await deps.sql.transaction(async (sql) => {
      await authorizeBriefActor(sql, viewer.userId!, organizationId, [
        'owner',
        'editor'
      ]);
      await assertBrandFeature(sql, organizationId, 'generative_media');

      const { identity, identitySource, memory } =
        await resolveBrandIdentityAndMemory(sql, organizationId);

      const spec = parsed.data.spec
        ? parsed.data.spec
        : parsed.data.quick
          ? buildShotSpecFromQuickInput(
              { ...parsed.data.quick, organizationId },
              identity
            )
          : null;

      if (!spec) {
        return { ok: false as const, code: 'invalid' as const, field: 'brief' };
      }

      const state = createDraftBrief({
        organizationId,
        spec,
        identity,
        memory
      });

      return {
        ok: true as const,
        id: state.id,
        brief: state,
        view: toCustomerBriefView(state, identitySource)
      };
    });
  } catch (error) {
    if (error instanceof Denied) return { ok: false, code: error.code };
    if (error instanceof BrandFeatureDenied) {
      return { ok: false, code: 'feature_unavailable' };
    }
    throw error;
  }
}

const BriefStateSnapshotSchema = z.object({
  id: uuid,
  organizationId: uuid,
  stage: z.enum(BRIEF_LIFECYCLE_STAGES),
  round: z.number().int().min(1).max(10),
  maxRounds: z.number().int().min(1).max(10).default(DEFAULT_MAX_BRIEF_ROUNDS),
  baselineSpec: ShotSpecSchema,
  spec: ShotSpecSchema,
  lastChangedAxis: z.enum(BRIEF_DELTA_AXES).nullable().default(null),
  lockedSpecHash: z.string().nullable().default(null),
  approvedBy: z.string().nullable().default(null),
  approvedAt: z.string().nullable().default(null),
  finalizedAt: z.string().nullable().default(null),
  updatedAt: z.string()
});

const ReviseBriefOperationSchema = z.object({
  organizationId: uuid,
  current: BriefStateSnapshotSchema,
  nextSpec: ShotSpecSchema
});

export type BriefOperationOutcome =
  | ({ ok: true } & BrandBriefServiceResult)
  | {
      ok: false;
      code: BrandFailureCode;
      field?: string;
      briefError?: BriefTransitionErrorCode;
      message?: string;
      axes?: BriefDeltaAxis[];
    };

/**
 * Applies a 1-axis baseline+delta revision in `draft` stage (`round <= maxRounds = 3`).
 */
export async function reviseBrandBrief(
  deps: { sql: SqlRunner },
  viewer: Viewer,
  input: unknown
): Promise<BriefOperationOutcome> {
  if (!uuid.safeParse(viewer.userId).success) {
    return { ok: false, code: 'sign_in_required' };
  }
  const parsed = ReviseBriefOperationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid',
      field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') || 'nextSpec'
    };
  }
  const { organizationId, current, nextSpec } = parsed.data;
  if (current.organizationId !== organizationId) {
    return { ok: false, code: 'invalid', field: 'organizationId' };
  }

  try {
    return await deps.sql.transaction(async (sql) => {
      await authorizeBriefActor(sql, viewer.userId!, organizationId, [
        'owner',
        'editor'
      ]);
      await assertBrandFeature(sql, organizationId, 'generative_media');

      const { identity, identitySource, memory } =
        await resolveBrandIdentityAndMemory(sql, organizationId);

      const hydratedCurrent: BrandBriefState = {
        ...current,
        target: undefined,
        compiled: createDraftBrief({
          id: current.id,
          organizationId,
          spec: current.spec,
          identity,
          memory,
          maxRounds: current.maxRounds,
          now: current.updatedAt
        }).compiled
      };

      const outcome = reviseDraftBrief(
        hydratedCurrent,
        nextSpec,
        identity,
        memory
      );
      if (!outcome.ok) {
        return {
          ok: false as const,
          code: 'invalid' as const,
          briefError: outcome.code,
          message: outcome.message,
          axes: outcome.axes
        };
      }

      return {
        ok: true as const,
        id: outcome.data.id,
        brief: outcome.data,
        view: toCustomerBriefView(outcome.data, identitySource)
      };
    });
  } catch (error) {
    if (error instanceof Denied) return { ok: false, code: error.code };
    if (error instanceof BrandFeatureDenied) {
      return { ok: false, code: 'feature_unavailable' };
    }
    throw error;
  }
}

const ApproveBriefOperationSchema = z.object({
  organizationId: uuid,
  current: BriefStateSnapshotSchema,
  aestheticGatePassed: z.boolean()
});

/**
 * Locks a `draft` brief into `approved` stage after checking the aesthetic gate and zero lint errors,
 * and records the approved cut summary into `brand_memory_events` when `brand_learning` is open.
 */
export async function approveBrandBrief(
  deps: { sql: SqlRunner },
  viewer: Viewer,
  input: unknown
): Promise<BriefOperationOutcome> {
  if (!uuid.safeParse(viewer.userId).success) {
    return { ok: false, code: 'sign_in_required' };
  }
  const parsed = ApproveBriefOperationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid',
      field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') || 'current'
    };
  }
  const { organizationId, current, aestheticGatePassed } = parsed.data;
  if (current.organizationId !== organizationId) {
    return { ok: false, code: 'invalid', field: 'organizationId' };
  }

  try {
    return await deps.sql.transaction(async (sql) => {
      await authorizeBriefActor(sql, viewer.userId!, organizationId, [
        'owner',
        'editor'
      ]);
      await assertBrandFeature(sql, organizationId, 'generative_media');

      const { identity, identitySource, memory } =
        await resolveBrandIdentityAndMemory(sql, organizationId);

      const hydratedCurrent: BrandBriefState = {
        ...current,
        target: undefined,
        compiled: createDraftBrief({
          id: current.id,
          organizationId,
          spec: current.spec,
          identity,
          memory,
          maxRounds: current.maxRounds,
          now: current.updatedAt
        }).compiled
      };

      const outcome = approveBrief(hydratedCurrent, {
        approvedBy: viewer.userId!,
        aestheticGatePassed
      });
      if (!outcome.ok) {
        return {
          ok: false as const,
          code: 'invalid' as const,
          briefError: outcome.code,
          message: outcome.message
        };
      }

      try {
        await assertBrandFeature(sql, organizationId, 'brand_learning');
        await sql.query(
          `insert into brand_memory_events (organization_id, kind, payload, created_by)
             values ($1, 'approved_cut', $2::jsonb, $3)`,
          [
            organizationId,
            JSON.stringify({
              summary: `[${SHOT_CUT_KIND_LABELS[outcome.data.spec.cutKind].code}] ${outcome.data.spec.brief}`,
              briefId: outcome.data.id
            }),
            viewer.userId
          ]
        );
      } catch (memErr) {
        if (
          !(memErr instanceof BrandFeatureDenied) &&
          !isMissingTable(memErr)
        ) {
          throw memErr;
        }
      }

      return {
        ok: true as const,
        id: outcome.data.id,
        brief: outcome.data,
        view: toCustomerBriefView(outcome.data, identitySource)
      };
    });
  } catch (error) {
    if (error instanceof Denied) return { ok: false, code: error.code };
    if (error instanceof BrandFeatureDenied) {
      return { ok: false, code: 'feature_unavailable' };
    }
    throw error;
  }
}

const PromoteBriefOperationSchema = z.object({
  organizationId: uuid,
  current: BriefStateSnapshotSchema,
  finalResolution: z.enum(['720p', '1080p', '2k', '4k']).optional()
});

/**
 * Promotes an `approved` brief to `final` (`720p|1080p --draft false --bitrate_mode high` or `2k|4k` still),
 * verifying that `lockedSpecHash` has not drifted since approval.
 */
export async function promoteBrandBrief(
  deps: { sql: SqlRunner },
  viewer: Viewer,
  input: unknown
): Promise<BriefOperationOutcome> {
  if (!uuid.safeParse(viewer.userId).success) {
    return { ok: false, code: 'sign_in_required' };
  }
  const parsed = PromoteBriefOperationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid',
      field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') || 'current'
    };
  }
  const { organizationId, current, finalResolution } = parsed.data;
  if (current.organizationId !== organizationId) {
    return { ok: false, code: 'invalid', field: 'organizationId' };
  }

  try {
    return await deps.sql.transaction(async (sql) => {
      await authorizeBriefActor(sql, viewer.userId!, organizationId, [
        'owner',
        'editor'
      ]);
      await assertBrandFeature(sql, organizationId, 'generative_media');

      const { identity, identitySource, memory } =
        await resolveBrandIdentityAndMemory(sql, organizationId);

      const hydratedCurrent: BrandBriefState = {
        ...current,
        target: undefined,
        compiled: createDraftBrief({
          id: current.id,
          organizationId,
          spec: current.spec,
          identity,
          memory,
          maxRounds: current.maxRounds,
          now: current.updatedAt
        }).compiled
      };

      const outcome = promoteBriefToFinal(hydratedCurrent, identity, memory, {
        finalResolution
      });
      if (!outcome.ok) {
        return {
          ok: false as const,
          code: 'invalid' as const,
          briefError: outcome.code,
          message: outcome.message
        };
      }

      return {
        ok: true as const,
        id: outcome.data.id,
        brief: outcome.data,
        view: toCustomerBriefView(outcome.data, identitySource)
      };
    });
  } catch (error) {
    if (error instanceof Denied) return { ok: false, code: error.code };
    if (error instanceof BrandFeatureDenied) {
      return { ok: false, code: 'feature_unavailable' };
    }
    throw error;
  }
}
