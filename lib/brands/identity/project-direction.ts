import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import { contrast } from '@/lib/design/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import {
  BrandFeatureDenied,
  assertBrandFeature,
  isMissingTable
} from '../entitlements';
import {
  BRAND_LOOK_PRESET_IDS,
  type BrandLookPresetId
} from '../finish/color-grading';
import type { BrandOutcome } from '../workspace/types';
import {
  BrandIdentitySchema,
  BrandReferenceRuleSchema,
  ONBOARDING_VIBES,
  markConfirmedBrandIdentity,
  twingsDefaultIdentity,
  type BrandIdentity,
  type ConfirmedBrandIdentity,
  type OnboardingVibe
} from './schema';
import {
  listMemory,
  loadBrandIdentity,
  recordMemory,
  saveBrandIdentity,
  type BrandIdentityRecord,
  type BrandMemoryRecord
} from './service';

/**
 * 2-Tier Brand Inheritance & Project-Scoped Direction Override (`lib/brands/identity/project-direction.ts`):
 *
 * Layer 1 — Brand Base DNA (`brand_identities`, organization-wide):
 *   Hard Locks that NO project override can ever weaken:
 *   1. `rules.consentedFacesOnly === true`
 *   2. `rules.logo` (`minSizePx`, `clearSpace`, `placement`) & base logo reference rules
 *   3. `rules.never` (up to 3 brand-wide strict taboos)
 *   4. `world.skinProtected === true`
 *
 * Layer 2 — Project Direction Override (`project_direction` per `projectId`):
 *   Soft Overrides that allow an individual campaign/project to use a distinct creative logic,
 *   season mood, optical/lighting setup, colour look, and project-specific product/mood assets,
 *   while isolating experimental memory events (`isolateProjectMemory: true`) from other projects.
 */

const ProjectIdKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid project identifier');

const AccentHexOverrideSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Expected #RRGGBB hex colour')
  .transform((hex) => hex.toLowerCase() as `#${string}`)
  .refine(
    (hex) => contrast('#ffffff', hex) >= 4.5,
    'Project accent colour must maintain at least 4.5:1 contrast against #ffffff'
  );

export const ProjectCameraOverrideSchema = z.object({
  focalMm: z.number().int().min(14).max(200).optional(),
  aperture: z.string().trim().min(1).max(24).optional(),
  angle: z.string().trim().min(1).max(120).optional()
});

export const ProjectLightOverrideSchema = z.object({
  modifier: z.string().trim().min(2).max(120).optional(),
  colourK: z.number().int().min(2500).max(9000).optional(),
  contrast: z.enum(['soft', 'medium', 'crisp']).optional()
});

export const ProjectSpaceOverrideSchema = z.object({
  background: z.string().trim().min(2).max(200).optional(),
  surface: z.string().trim().min(2).max(160).optional()
});

export const ProjectDirectionOverrideSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: ProjectIdKeySchema,
  enabled: z.boolean().default(true),
  title: z.string().trim().min(1).max(120),
  moodVibe: z.enum(ONBOARDING_VIBES).optional(),
  lookPresetId: z.enum(BRAND_LOOK_PRESET_IDS).optional(),
  colourAccentOverride: AccentHexOverrideSchema.optional(),
  ownedHueOverride: z
    .tuple([z.number().min(0).max(360), z.number().min(0).max(360)])
    .refine(([lo, hi]) => lo <= hi, 'ownedHue min must not exceed max')
    .optional(),
  cameraOverride: ProjectCameraOverrideSchema.optional(),
  lightOverride: ProjectLightOverrideSchema.optional(),
  spaceOverride: ProjectSpaceOverrideSchema.optional(),
  projectRulePrompt: z.string().trim().max(300).optional(),
  projectProductChecklist: z
    .array(z.string().trim().min(1).max(300))
    .max(10)
    .default([]),
  projectReferences: z.array(BrandReferenceRuleSchema).max(8).default([]),
  isolateProjectMemory: z.boolean().default(true)
});

export type ProjectDirectionOverride = z.infer<
  typeof ProjectDirectionOverrideSchema
>;
export type ProjectDirectionOverrideInput = z.input<
  typeof ProjectDirectionOverrideSchema
>;

export interface DirectionCascadeSummary {
  mode: 'base_inherited' | 'project_override';
  projectId: string | null;
  projectTitle: string | null;
  lockedFromBase: string[];
  overriddenByProject: string[];
  isolateProjectMemory: boolean;
}

export interface EffectiveBrandDirection {
  effectiveIdentity: ConfirmedBrandIdentity;
  shotDefaults: {
    cameraFocalMm: number;
    lightModifier: string;
    lightColourK: number;
    spaceBackground: string;
    spaceSurface: string;
    projectRulePrompt: string | null;
    lookPresetId: BrandLookPresetId;
  };
  cascade: DirectionCascadeSummary;
}

export const PROJECT_DIRECTION_PRESETS = {
  outdoor_golden_hour: {
    title: '시즌 캠페인 · 야외 골든아워 필름',
    moodVibe: 'warm_film' as const,
    lookPresetId: 'kodak-2383-warm' as const,
    cameraOverride: { focalMm: 35, aperture: 'f/2.8', angle: 'low-angle street perspective' },
    lightOverride: {
      modifier: 'natural golden hour sunlight with warm rim reflection',
      colourK: 3900,
      contrast: 'medium' as const
    },
    spaceOverride: {
      background: 'open riverside concrete esplanade under late afternoon sky',
      surface: 'weathered architectural stone pavement'
    },
    projectRulePrompt:
      '야외 자연광 역광 하이라이트와 부드러운 아날로그 필름 결 유지, 스튜디오 정물 배경 배제',
    projectProductChecklist: [
      '야외 역광에서도 의상/제품 본연의 색상과 로고 심볼 선명도 유지'
    ]
  },
  night_neon_capsule: {
    title: '콜라보 드롭 · 나이트 아키텍처 하이콘트라스트',
    moodVibe: 'high_contrast_street' as const,
    lookPresetId: 'editorial-cool-porcelain' as const,
    cameraOverride: { focalMm: 28, aperture: 'f/4', angle: 'dynamic wide editorial framing' },
    lightOverride: {
      modifier: 'crisp overhead architectural key light with cool steel rim',
      colourK: 6200,
      contrast: 'crisp' as const
    },
    spaceOverride: {
      background: 'dark brushed metal and wet basalt courtyard at dusk',
      surface: 'dark honed slate plinth with subtle specular reflection'
    },
    projectRulePrompt:
      '차갑고 선명한 크롬/슬레이트 대비와 광각 공간감 강조, 웜톤 색번짐 배제',
    projectProductChecklist: [
      '어두운 배경에서도 외곽 실루엣과 금속/원단 하이라이트 경계 분리'
    ]
  },
  crisp_studio_drop: {
    title: '신제품 런칭 · 정밀 매크로 스튜디오',
    moodVibe: 'crisp_commercial' as const,
    lookPresetId: 'clean-high-key' as const,
    cameraOverride: { focalMm: 85, aperture: 'f/5.6', angle: 'eye-level precision macro framing' },
    lightOverride: {
      modifier: 'dual diffused strip softboxes with clean negative fill',
      colourK: 5500,
      contrast: 'crisp' as const
    },
    spaceOverride: {
      background: 'seamless pure architectural paper backdrop with zero clutter',
      surface: 'matte anodised aluminium pedestal'
    },
    projectRulePrompt:
      '85mm 망원 압축감으로 왜곡 없는 제품 비례와 라벨 가독성 최우선 확보',
    projectProductChecklist: [
      '전면 라벨 텍스트 100% 수평 정렬 및 광학 왜곡 제로'
    ]
  }
} as const;

export type ProjectDirectionPresetKey = keyof typeof PROJECT_DIRECTION_PRESETS;

/**
 * Resolves the effective `ConfirmedBrandIdentity` and shot defaults by cascading:
 *   `Base Brand DNA (Hard Locks)` ⊕ `Project Direction Override (Soft Overrides)`
 */
export function resolveEffectiveBrandDirection(
  baseIdentity: ConfirmedBrandIdentity = markConfirmedBrandIdentity(
    twingsDefaultIdentity()
  ),
  override?: ProjectDirectionOverride | null
): EffectiveBrandDirection {
  const lockedFromBase = [
    'consented_faces_only',
    'logo_geometry_and_clearspace',
    'base_never_taboos',
    'skin_tone_protection'
  ];

  const defaultShotSetup = {
    cameraFocalMm: 50,
    lightModifier: 'large diffused window softbox',
    lightColourK: 5400,
    spaceBackground: 'soft daylight plaster wall with generous negative space',
    spaceSurface: 'honed limestone tabletop',
    projectRulePrompt: null as string | null,
    lookPresetId: 'twings-french-blue' as BrandLookPresetId
  };

  if (!override || !override.enabled) {
    return {
      effectiveIdentity: baseIdentity,
      shotDefaults: defaultShotSetup,
      cascade: {
        mode: 'base_inherited',
        projectId: override?.projectId ?? null,
        projectTitle: override?.title ?? null,
        lockedFromBase,
        overriddenByProject: [],
        isolateProjectMemory: false
      }
    };
  }

  const overriddenByProject: string[] = [];

  const nextColour = { ...baseIdentity.colour };
  if (override.colourAccentOverride) {
    nextColour.accent = override.colourAccentOverride;
    overriddenByProject.push('colour_accent');
  }

  const nextWorld = {
    ...baseIdentity.world,
    skinProtected: true as const
  };
  if (override.ownedHueOverride) {
    nextWorld.ownedHue = override.ownedHueOverride;
    overriddenByProject.push('owned_hue_band');
  }

  // Merge productChecklist: project items first, then base items, preserving all base locks.
  const nextChecklist =
    override.projectProductChecklist.length > 0
      ? Array.from(
          new Set([
            ...override.projectProductChecklist,
            ...baseIdentity.productChecklist
          ])
        ).slice(0, 20)
      : baseIdentity.productChecklist;
  if (override.projectProductChecklist.length > 0) {
    overriddenByProject.push('product_checklist');
  }

  // Merge references: keep base logo locks first, then project references, then remaining base references (cap 14).
  const baseLogoRefs = baseIdentity.references.filter((r) =>
    r.lend.includes('로고') || r.lend.toLowerCase().includes('logo')
  );
  const baseOtherRefs = baseIdentity.references.filter(
    (r) => !baseLogoRefs.includes(r)
  );
  const nextReferences =
    override.projectReferences.length > 0
      ? [
          ...baseLogoRefs,
          ...override.projectReferences,
          ...baseOtherRefs
        ].slice(0, 14)
      : baseIdentity.references;
  if (override.projectReferences.length > 0) {
    overriddenByProject.push('project_references');
  }

  const nextVoice = { ...baseIdentity.voice };
  if (override.projectRulePrompt && override.projectRulePrompt.trim().length > 0) {
    nextVoice.tone = `${baseIdentity.voice.tone} [프로젝트 전용 연출: ${override.projectRulePrompt.trim()}]`.slice(
      0,
      400
    );
    overriddenByProject.push('project_rule_prompt');
  }

  const cameraFocalMm =
    override.cameraOverride?.focalMm ?? defaultShotSetup.cameraFocalMm;
  if (override.cameraOverride?.focalMm !== undefined) {
    overriddenByProject.push('camera_optics');
  }

  const lightModifier =
    override.lightOverride?.modifier ?? defaultShotSetup.lightModifier;
  const lightColourK =
    override.lightOverride?.colourK ?? defaultShotSetup.lightColourK;
  if (
    override.lightOverride?.modifier !== undefined ||
    override.lightOverride?.colourK !== undefined
  ) {
    overriddenByProject.push('lighting_setup');
  }

  const spaceBackground =
    override.spaceOverride?.background ?? defaultShotSetup.spaceBackground;
  const spaceSurface =
    override.spaceOverride?.surface ?? defaultShotSetup.spaceSurface;
  if (
    override.spaceOverride?.background !== undefined ||
    override.spaceOverride?.surface !== undefined
  ) {
    overriddenByProject.push('space_environment');
  }

  const lookPresetId =
    override.lookPresetId ?? defaultShotSetup.lookPresetId;
  if (override.lookPresetId !== undefined) {
    overriddenByProject.push('look_preset');
  }

  // Re-validate through BrandIdentitySchema while guaranteeing Hard Locks remain untouched.
  const merged = BrandIdentitySchema.parse({
    ...baseIdentity,
    colour: nextColour,
    world: nextWorld,
    rules: {
      ...baseIdentity.rules,
      // Hard Locks: never overridden by any project setting
      consentedFacesOnly: true,
      logo: baseIdentity.rules.logo,
      never: baseIdentity.rules.never
    },
    references: nextReferences,
    productChecklist: nextChecklist,
    voice: nextVoice
  });

  return {
    effectiveIdentity: markConfirmedBrandIdentity(merged),
    shotDefaults: {
      cameraFocalMm,
      lightModifier,
      lightColourK,
      spaceBackground,
      spaceSurface,
      projectRulePrompt: override.projectRulePrompt?.trim() || null,
      lookPresetId
    },
    cascade: {
      mode: 'project_override',
      projectId: override.projectId,
      projectTitle: override.title,
      lockedFromBase,
      overriddenByProject,
      isolateProjectMemory: override.isolateProjectMemory
    }
  };
}

/**
 * Filters `brand_memory_events` so that:
 * 1. Internal `project_direction` configuration notes are excluded from prompt injection.
 * 2. When `projectId` is active, base organization memories (`!payload.projectId`) + matching
 *    project memories (`payload.projectId === projectId`) are included, while other projects'
 *    isolated memories are excluded.
 * 3. When no `projectId` is active, only base organization memories (`!payload.projectId` or
 *    `payload.isolateProjectMemory === false`) are included.
 */
export function filterMemoryForProjectScope(
  events: readonly BrandMemoryRecord[],
  projectId?: string | null
): BrandMemoryRecord[] {
  return events.filter((event) => {
    const scope = event.payload?.scope;
    if (scope === 'project_direction' || scope === 'onboarding_ingest') {
      return false;
    }
    const eventProjectId =
      typeof event.payload?.projectId === 'string'
        ? event.payload.projectId
        : null;
    const isolated = event.payload?.isolateProjectMemory !== false;

    if (!eventProjectId) return true;
    if (projectId && eventProjectId === projectId) return true;
    return !isolated;
  });
}

/**
 * Loads the latest saved `ProjectDirectionOverride` per `projectId` for an organization.
 */
export async function loadProjectDirectionOverrides(
  sql: SqlRunner,
  organizationId: string
): Promise<Record<string, ProjectDirectionOverride>> {
  try {
    await assertBrandFeature(sql, organizationId, 'brand_learning');
    await assertBrandFeature(sql, organizationId, 'generative_media');
  } catch (err) {
    if (err instanceof BrandFeatureDenied) return {};
    throw err;
  }

  let rows: BrandMemoryRecord[] = [];
  try {
    rows = await listMemory(sql, organizationId, 200);
  } catch (err) {
    if (isMissingTable(err)) return {};
    throw err;
  }

  const byProject: Record<string, ProjectDirectionOverride> = {};
  // `listMemory` returns newest first (`order by created_at desc`), so the first match per projectId wins.
  for (const row of rows) {
    if (row.payload?.scope !== 'project_direction') continue;
    const candidate = row.payload?.override;
    const parsed = ProjectDirectionOverrideSchema.safeParse(candidate);
    if (parsed.success && !byProject[parsed.data.projectId]) {
      byProject[parsed.data.projectId] = parsed.data;
    }
  }
  return byProject;
}

export async function loadProjectDirectionForProject(
  sql: SqlRunner,
  organizationId: string,
  projectId: string
): Promise<ProjectDirectionOverride | null> {
  const all = await loadProjectDirectionOverrides(sql, organizationId);
  return all[projectId] ?? null;
}

/**
 * Saves or updates a project-specific direction override (`owner`, `editor`, or `admin`).
 */
export async function saveProjectDirectionOverride(
  deps: { sql: SqlRunner },
  viewer: Viewer,
  raw: unknown
): Promise<
  BrandOutcome<{
    override: ProjectDirectionOverride;
    cascade: DirectionCascadeSummary;
  }>
> {
  if (!viewer.userId) return { ok: false, code: 'sign_in_required' };
  const parsed = ProjectDirectionOverrideSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid',
      field: (parsed.error.issues[0]?.path ?? []).map(String).join('.')
    };
  }

  const { organizationId, projectId } = parsed.data;

  try {
    await assertBrandFeature(deps.sql, organizationId, 'brand_learning');
    await assertBrandFeature(deps.sql, organizationId, 'generative_media');
  } catch (err) {
    if (err instanceof BrandFeatureDenied) {
      return { ok: false, code: 'feature_unavailable' };
    }
    throw err;
  }

  // If projectId is a UUID, verify it does not belong to a different organization.
  if (z.string().uuid().safeParse(projectId).success) {
    try {
      const projectRow = (
        await deps.sql.query<{ organization_id: string }>(
          'select organization_id from brand_projects where id = $1 for share',
          [projectId]
        )
      ).rows[0];
      if (projectRow && projectRow.organization_id !== organizationId) {
        return { ok: false, code: 'not_found' };
      }
    } catch (err) {
      if (!isMissingTable(err)) throw err;
    }
  }

  const recorded = await recordMemory(deps, viewer, {
    organizationId,
    kind: 'note',
    payload: {
      scope: 'project_direction',
      projectId,
      override: parsed.data,
      updatedAt: new Date().toISOString()
    }
  });
  if (!recorded.ok) return recorded;

  const baseRecord = await loadBrandIdentity(deps.sql, organizationId);
  const baseIdentity = markConfirmedBrandIdentity(
    baseRecord?.identity ?? twingsDefaultIdentity()
  );
  const resolved = resolveEffectiveBrandDirection(baseIdentity, parsed.data);

  return {
    ok: true,
    override: parsed.data,
    cascade: resolved.cascade
  };
}

const PromoteProjectDirectionInputSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: ProjectIdKeySchema,
  expectedRevision: z.number().int().min(0).optional()
});

/**
 * Promotes a successful project direction's soft overrides (accent colour, hue band,
 * product checklist, and reference rules) into the organization's Base Brand DNA (`owner` or `admin`).
 */
export async function promoteProjectDirectionToBase(
  deps: { sql: SqlRunner },
  viewer: Viewer,
  raw: unknown
): Promise<
  BrandOutcome<{
    id: string;
    revision: number;
    status: 'draft' | 'confirmed';
    identity: BrandIdentity;
  }>
> {
  if (!viewer.userId) return { ok: false, code: 'sign_in_required' };
  const parsed = PromoteProjectDirectionInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: 'invalid' };

  const { organizationId, projectId } = parsed.data;

  try {
    await assertBrandFeature(deps.sql, organizationId, 'brand_learning');
    await assertBrandFeature(deps.sql, organizationId, 'generative_media');
  } catch (err) {
    if (err instanceof BrandFeatureDenied) {
      return { ok: false, code: 'feature_unavailable' };
    }
    throw err;
  }

  const override = await loadProjectDirectionForProject(
    deps.sql,
    organizationId,
    projectId
  );
  if (!override) {
    return {
      ok: false,
      code: 'not_found'
    };
  }

  const existing = await loadBrandIdentity(deps.sql, organizationId);
  const baseIdentity = markConfirmedBrandIdentity(
    existing?.identity ?? twingsDefaultIdentity()
  );
  const resolved = resolveEffectiveBrandDirection(baseIdentity, {
    ...override,
    enabled: true
  });

  const expectedRevision =
    parsed.data.expectedRevision !== undefined
      ? parsed.data.expectedRevision
      : (existing?.revision ?? 0);

  return saveBrandIdentity(deps, viewer, {
    organizationId,
    expectedRevision,
    identity: resolved.effectiveIdentity
  });
}
