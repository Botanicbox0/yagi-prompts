import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { BrandFeatureDenied, assertBrandFeature } from '@/lib/brands/entitlements';
import type { BrandFeature } from '@/lib/brands/features';
import type { BrandOutcome } from '@/lib/brands/workspace/types';

/**
 * S4 Workstation GPU Pull-Worker Contract (`BRAND-PRODUCT.md` §7.2, `repo-engines-pipeline.md` §4).
 *
 * Vercel serverless functions never hold long-lived connections to the local RTX PRO 6000 96GB workstation.
 * Instead, finishing jobs are queued with `provider = 'workstation'` and claimed by the local pull-worker
 * respecting `gpu-arbiter.service` priority (`ComfyUI > Qwen3.8(BF16) > other`).
 */

export const WORKSTATION_PROVIDER = 'workstation' as const;

export const FINISH_WORKER_OPS = [
  'upscale',
  'grade',
  'audio_mix',
  'inpaint',
  'reframe'
] as const;

export type FinishWorkerOp = (typeof FINISH_WORKER_OPS)[number];

export const GPU_ARBITER_PRIORITY = [
  'comfyui',
  'qwen3.8_bf16',
  'ollama_other'
] as const;

export const WORKSTATION_WORKER_LIMITS = {
  /** Maximum hold time while waiting for gpu-arbiter slot (`30m = 1800s`). */
  holdMaxSeconds: 1800,
  /** Maximum active execution time per finishing task (`20m = 1200s`). */
  jobTimeoutSeconds: 1200,
  /** Worker heartbeat interval (`20s`). */
  heartbeatIntervalSeconds: 20,
  /** Stale claim threshold when worker stops sending heartbeats (`90s`). */
  staleClaimSeconds: 90
} as const;

/**
 * Maps each finishing worker operation to the organization feature policies it requires.
 */
export function requiredFeaturesForFinishOp(
  op: FinishWorkerOp
): readonly BrandFeature[] {
  switch (op) {
    case 'grade':
      return ['color_grading'];
    case 'audio_mix':
      return ['sound'];
    case 'upscale':
    case 'inpaint':
    case 'reframe':
      return ['generative_media'];
  }
}

export const WorkstationFinishTaskSchema = z.object({
  id: z.string().uuid().optional(),
  organizationId: z.string().uuid(),
  op: z.enum(FINISH_WORKER_OPS),
  inputStorageKey: z.string().trim().min(1).max(400),
  outputStoragePrefix: z.string().trim().min(1).max(400),
  params: z.record(z.string(), z.unknown()).default({})
});

export type WorkstationFinishTaskInput = z.infer<
  typeof WorkstationFinishTaskSchema
>;

export interface WorkstationFinishTask {
  id: string;
  provider: typeof WORKSTATION_PROVIDER;
  organizationId: string;
  op: FinishWorkerOp;
  requiredFeatures: readonly BrandFeature[];
  gpuArbiterSlot: 'comfyui' | 'ffmpeg_cpu_gpu';
  inputStorageKey: string;
  outputStoragePrefix: string;
  params: Record<string, unknown>;
  limits: typeof WORKSTATION_WORKER_LIMITS;
  createdAt: string;
}

/**
 * Creates a validated workstation finishing task after verifying the organization's feature policy
 * (`generative_media`, `color_grading`, or `sound`).
 */
export async function createWorkstationFinishTask(
  deps: { sql: SqlRunner },
  rawInput: unknown
): Promise<BrandOutcome<{ id: string; task: WorkstationFinishTask }>> {
  const parsed = WorkstationFinishTaskSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid',
      field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') || 'op'
    };
  }
  const v = parsed.data;
  const requiredFeatures = requiredFeaturesForFinishOp(v.op);

  try {
    for (const feature of requiredFeatures) {
      await assertBrandFeature(deps.sql, v.organizationId, feature);
    }
  } catch (error) {
    if (error instanceof BrandFeatureDenied) {
      return { ok: false, code: 'feature_unavailable' };
    }
    throw error;
  }

  const id = v.id ?? randomUUID();
  const gpuArbiterSlot =
    v.op === 'upscale' || v.op === 'inpaint' ? 'comfyui' : 'ffmpeg_cpu_gpu';

  return {
    ok: true,
    id,
    task: {
      id,
      provider: WORKSTATION_PROVIDER,
      organizationId: v.organizationId,
      op: v.op,
      requiredFeatures,
      gpuArbiterSlot,
      inputStorageKey: v.inputStorageKey,
      outputStoragePrefix: v.outputStoragePrefix,
      params: v.params,
      limits: WORKSTATION_WORKER_LIMITS,
      createdAt: new Date().toISOString()
    }
  };
}

export type FinishFallbackDisposition =
  | {
      disposition: 'deliver_cloud_original';
      badge: 'finishing_pending';
      reason: string;
    }
  | {
      disposition: 'hold_for_pd';
      badge: 'pd_review_required';
      reason: string;
    };

/**
 * Deterministic fallback policy when the local workstation worker is offline or exceeds `holdMaxSeconds`
 * (`BRAND-PRODUCT.md` §7.2):
 * - `upscale | grade | reframe`: delivers the cloud original with a `"마감 대기"` (`finishing_pending`) badge.
 * - `inpaint | audio_mix`: holds the job (`hold_for_pd`) and alerts the PD rather than delivering an unfixed cut.
 */
export function resolveFinishWorkerFallback(
  op: FinishWorkerOp,
  elapsedHoldSeconds: number
): FinishFallbackDisposition {
  if (op === 'upscale' || op === 'grade' || op === 'reframe') {
    return {
      disposition: 'deliver_cloud_original',
      badge: 'finishing_pending',
      reason: `Workstation worker unavailable after ${elapsedHoldSeconds}s; serving cloud output with finishing_pending badge.`
    };
  }
  return {
    disposition: 'hold_for_pd',
    badge: 'pd_review_required',
    reason: `Workstation worker unavailable after ${elapsedHoldSeconds}s for ${op}; holding cut for PD completion.`
  };
}
