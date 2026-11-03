import { createHash, randomUUID } from 'node:crypto';
import type { ConfirmedBrandIdentity } from '@/lib/brands/identity/schema';
import {
  compilePrompt,
  type BrandMemoryContext,
  type CompiledPromptResult,
  type CompilerTargetId
} from './compiler';
import { ShotSpecSchema, type ShotSpec } from './schema';

export const BRIEF_LIFECYCLE_STAGES = ['draft', 'approved', 'final'] as const;
export type BriefLifecycleStage = (typeof BRIEF_LIFECYCLE_STAGES)[number];

export const BRIEF_DELTA_AXES = [
  'brief',
  'subject',
  'product',
  'wardrobe',
  'space',
  'camera',
  'light',
  'tone',
  'palette',
  'timeline'
] as const;
export type BriefDeltaAxis = (typeof BRIEF_DELTA_AXES)[number];

export const DEFAULT_MAX_BRIEF_ROUNDS = 3;

export type BriefTransitionErrorCode =
  | 'invalid_stage_transition'
  | 'no_delta'
  | 'too_many_changed_axes'
  | 'round_limit_exceeded'
  | 'aesthetic_gate_required'
  | 'lint_errors_present'
  | 'must_approve_before_final'
  | 'spec_modified_after_approval';

export type BriefTransitionOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; code: BriefTransitionErrorCode; message: string; axes?: BriefDeltaAxis[] };

export interface BrandBriefState {
  id: string;
  organizationId: string;
  stage: BriefLifecycleStage;
  round: number;
  maxRounds: number;
  baselineSpec: ShotSpec;
  spec: ShotSpec;
  lastChangedAxis: BriefDeltaAxis | null;
  target: CompilerTargetId | undefined;
  compiled: CompiledPromptResult;
  lockedSpecHash: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  finalizedAt: string | null;
  updatedAt: string;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
}

export function hashShotSpec(spec: ShotSpec): string {
  return createHash('sha256').update(stableJson(spec)).digest('hex');
}

/**
 * Computes which axes changed between two `ShotSpec` snapshots (BRAND-PRODUCT §10 baseline+delta gate:
 * at most one variable axis per revision round).
 */
export function diffChangedAxes(prev: ShotSpec, next: ShotSpec): BriefDeltaAxis[] {
  const changed: BriefDeltaAxis[] = [];
  for (const axis of BRIEF_DELTA_AXES) {
    if (stableJson(prev[axis]) !== stableJson(next[axis])) {
      changed.push(axis);
    }
  }
  return changed;
}

export interface CreateDraftBriefInput {
  id?: string;
  organizationId: string;
  spec: ShotSpec;
  identity: ConfirmedBrandIdentity;
  memory?: BrandMemoryContext;
  target?: CompilerTargetId;
  maxRounds?: number;
  now?: string;
}

/**
 * Starts a brief in `draft` stage (`480p --draft true --bitrate_mode high` for video, `round = 1`).
 */
export function createDraftBrief(input: CreateDraftBriefInput): BrandBriefState {
  const spec = ShotSpecSchema.parse(input.spec);
  const now = input.now ?? new Date().toISOString();
  const compiled = compilePrompt(spec, input.identity, input.memory, {
    target: input.target,
    stage: 'draft'
  });
  return {
    id: input.id ?? randomUUID(),
    organizationId: input.organizationId,
    stage: 'draft',
    round: 1,
    maxRounds: input.maxRounds ?? DEFAULT_MAX_BRIEF_ROUNDS,
    baselineSpec: spec,
    spec,
    lastChangedAxis: null,
    target: input.target,
    compiled,
    lockedSpecHash: null,
    approvedBy: null,
    approvedAt: null,
    finalizedAt: null,
    updatedAt: now
  };
}

/**
 * Applies a single-axis delta revision in `draft` stage (BRAND-PRODUCT §10: baseline+delta, round <= maxRounds).
 */
export function reviseDraftBrief(
  brief: BrandBriefState,
  nextRawSpec: ShotSpec,
  identity: ConfirmedBrandIdentity,
  memory?: BrandMemoryContext,
  options: { now?: string } = {}
): BriefTransitionOutcome<BrandBriefState> {
  if (brief.stage !== 'draft') {
    return {
      ok: false,
      code: 'invalid_stage_transition',
      message: `Cannot revise a brief in "${brief.stage}" stage (must be "draft").`
    };
  }
  if (brief.round >= brief.maxRounds) {
    return {
      ok: false,
      code: 'round_limit_exceeded',
      message: `Draft revision round limit (${brief.maxRounds}) reached.`
    };
  }
  const nextSpec = ShotSpecSchema.parse(nextRawSpec);
  const axes = diffChangedAxes(brief.spec, nextSpec);
  if (axes.length === 0) {
    return {
      ok: false,
      code: 'no_delta',
      message: 'Revision must change one axis relative to the current spec.'
    };
  }
  if (axes.length > 1) {
    return {
      ok: false,
      code: 'too_many_changed_axes',
      message: `Baseline+delta rule allows changing only 1 axis per round (changed: ${axes.join(', ')}).`,
      axes
    };
  }

  const compiled = compilePrompt(nextSpec, identity, memory, {
    target: brief.target,
    stage: 'draft'
  });
  return {
    ok: true,
    data: {
      ...brief,
      round: brief.round + 1,
      spec: nextSpec,
      lastChangedAxis: axes[0]!,
      compiled,
      updatedAt: options.now ?? new Date().toISOString()
    }
  };
}

export interface ApproveBriefInput {
  approvedBy: string;
  aestheticGatePassed: boolean;
  now?: string;
}

/**
 * Transitions `draft -> approved` after verifying zero error-level lint issues and the human
 * aesthetic gate (`knowhow-corpus.md` f3). Locks the `ShotSpec` hash so `final` cannot drift.
 */
export function approveBrief(
  brief: BrandBriefState,
  input: ApproveBriefInput
): BriefTransitionOutcome<BrandBriefState> {
  if (brief.stage !== 'draft') {
    return {
      ok: false,
      code: 'invalid_stage_transition',
      message: `Only a "draft" brief can be approved (current stage: "${brief.stage}").`
    };
  }
  if (!input.aestheticGatePassed) {
    return {
      ok: false,
      code: 'aesthetic_gate_required',
      message: 'Aesthetic gate approval is required before locking a brief (knowhow-corpus f3).'
    };
  }
  const errors = brief.compiled.lint.filter((i) => i.severity === 'error');
  if (errors.length > 0) {
    return {
      ok: false,
      code: 'lint_errors_present',
      message: `Cannot approve brief with ${errors.length} hardline lint error(s): ${errors.map((e) => e.rule).join(', ')}.`
    };
  }
  const now = input.now ?? new Date().toISOString();
  return {
    ok: true,
    data: {
      ...brief,
      stage: 'approved',
      lockedSpecHash: hashShotSpec(brief.spec),
      approvedBy: input.approvedBy,
      approvedAt: now,
      updatedAt: now
    }
  };
}

export interface PromoteBriefToFinalInput {
  finalResolution?: '720p' | '1080p' | '2k' | '4k';
  now?: string;
}

/**
 * Transitions `approved -> final`, upgrading video render params from `480p --draft true` to
 * `720p|1080p --draft false --bitrate_mode high` (or image `2k|4k`) while verifying the locked spec hash.
 */
export function promoteBriefToFinal(
  brief: BrandBriefState,
  identity: ConfirmedBrandIdentity,
  memory?: BrandMemoryContext,
  input: PromoteBriefToFinalInput = {}
): BriefTransitionOutcome<BrandBriefState> {
  if (brief.stage !== 'approved') {
    return {
      ok: false,
      code: 'must_approve_before_final',
      message: `Brief must be in "approved" stage before promoting to "final" (current stage: "${brief.stage}").`
    };
  }
  if (!brief.lockedSpecHash || hashShotSpec(brief.spec) !== brief.lockedSpecHash) {
    return {
      ok: false,
      code: 'spec_modified_after_approval',
      message: 'ShotSpec was modified after approval; re-approve in draft stage first.'
    };
  }
  const compiled = compilePrompt(brief.spec, identity, memory, {
    target: brief.target,
    stage: 'final',
    finalResolution: input.finalResolution
  });
  const errors = compiled.lint.filter((i) => i.severity === 'error');
  if (errors.length > 0) {
    return {
      ok: false,
      code: 'lint_errors_present',
      message: `Cannot promote brief with lint error(s): ${errors.map((e) => e.rule).join(', ')}.`
    };
  }
  const now = input.now ?? new Date().toISOString();
  return {
    ok: true,
    data: {
      ...brief,
      stage: 'final',
      compiled,
      finalizedAt: now,
      updatedAt: now
    }
  };
}
