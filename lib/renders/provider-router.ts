/**
 * Dual-Provider Concurrency Router, Turnaround Speed Telemetry & Sunra Dynamic Pricing Guardrail
 *
 * Solves two production realities:
 * 1. Traffic Surge Concurrency: ByteDance ModelArk enforces a hard 10-concurrent-job ceiling, while
 *    Sunra AI offers unlimited concurrency. During traffic spikes, `selectVideoProvider` overflows
 *    eligible jobs to Sunra before ModelArk hits HTTP 429 throttling.
 * 2. Unannounced Sunra Price Changes & Hold Exhaustion: Continuously compares Sunra's live endpoint
 *    pricing and actual billed units (`units / 1000` USD) against pinned baseline rates. If Sunra
 *    raises prices beyond `maxDriftRatio` (default +10%) or rejects a submission for `$8`/`$18` hold
 *    balance (`INSUFFICIENT_CREDIT`), the circuit breaker trips immediately, routes 100% of traffic
 *    back to ModelArk, and emits a founder alert.
 */

import { createHash } from 'node:crypto';
import { SUNRA_TOPUP_FEE_MULTIPLIER } from '@/lib/sunra/client';

export const MODELARK_HARD_CONCURRENCY_LIMIT = 10 as const;
export const MODELARK_SOFT_OVERFLOW_THRESHOLD = 8 as const;
export const SUNRA_DEFAULT_MAX_PRICE_DRIFT_RATIO = 1.10 as const;
export const MIN_TELEMETRY_SAMPLES_FOR_AUTO = 5 as const;

export type VideoProviderId = 'modelark' | 'sunra';

export type SunraRoutingMode =
  | 'off'
  | 'surge_overflow'
  | 'auto_fastest'
  | 'ab_benchmark'
  | 'sunra_primary';

export type CircuitBreakerState =
  | 'closed'
  | 'open_price_drift'
  | 'open_insufficient_hold'
  | 'open_provider_outage';

export type SunraVideoModelId = 'seedance-2.0' | 'seedance-2.5' | 'magi-2';

/**
 * Pinned baseline display prices (USD per second, before Sunra's 5% top-up fee) from
 * `docs/SUNRA-PROVIDER.md` (verified 2026-10-31) and MAGI-2 provider contract (2026-11-28).
 */
const SUNRA_BASE_USD_PER_SEC: Readonly<Record<SunraVideoModelId, Readonly<Partial<Record<'720p' | '1080p', number>>>>> = {
  'seedance-2.0': {
    '720p': 0.142,   // $0.710 / 5s
    '1080p': 0.3542  // $1.771 / 5s
  },
  'seedance-2.5': {
    '720p': 0.2312,  // $1.156 / 5s
    '1080p': 0.5686  // $2.843 / 5s
  },
  'magi-2': {
    '1080p': 0.08
  }
};

/**
 * The pinned price of one run, or `null` when no baseline is pinned for this model and resolution (MAGI-2 at 720p,
 * or a model this table does not know). Never a guessed figure: the guardrail treats `null` as outside the band.
 */
export function expectedSunraVideoUsd(input: {
  model: SunraVideoModelId;
  resolution: '720p' | '1080p';
  seconds: number;
  includeTopupFee?: boolean;
}): number | null {
  const row = Object.prototype.hasOwnProperty.call(SUNRA_BASE_USD_PER_SEC, input.model) ? SUNRA_BASE_USD_PER_SEC[input.model] : undefined;
  const perSec = row && Object.prototype.hasOwnProperty.call(row, input.resolution) ? row[input.resolution] : undefined;
  if (typeof perSec !== 'number' || !Number.isFinite(perSec) || perSec <= 0) return null;
  const raw = perSec * Math.max(1, input.seconds);
  const multiplier = input.includeTopupFee ? SUNRA_TOPUP_FEE_MULTIPLIER : 1;
  return Math.round(raw * multiplier * 10000) / 10000;
}

export interface SunraPriceDriftAlert {
  severity: 'warning' | 'critical';
  /** Absent on a measured drift (kept as before); `no_baseline` when nothing was pinned to measure against. */
  reason?: 'no_baseline';
  model: SunraVideoModelId;
  resolution: '720p' | '1080p';
  seconds: number;
  /** 0 when there is no baseline (`reason: 'no_baseline'`). */
  expectedUsd: number;
  actualUsd: number;
  /** Infinity when there is no baseline: any charge is unmeasured, never "within tolerance". */
  driftRatio: number;
  driftPercent: number;
  actionTaken: 'circuit_opened_fallback_modelark' | 'circuit_opened_no_baseline' | 'logged_within_tolerance';
  messageKo: string;
  messageEn: string;
  detectedAt: string;
}

export function evaluateSunraPriceGuardrail(input: {
  model: SunraVideoModelId;
  resolution: '720p' | '1080p';
  seconds: number;
  actualBilledUsd: number;
  maxDriftRatio?: number;
  now?: Date;
}): { withinGuardrail: boolean; alert: SunraPriceDriftAlert | null } {
  const maxDrift = input.maxDriftRatio ?? SUNRA_DEFAULT_MAX_PRICE_DRIFT_RATIO;
  const expected = expectedSunraVideoUsd({
    model: input.model,
    resolution: input.resolution,
    seconds: input.seconds,
    includeTopupFee: false
  });
  const detectedAt = (input.now ?? new Date()).toISOString();
  // Fail safe: with no pinned baseline there is nothing to measure the charge against, so it is outside the
  // guardrail (the circuit opens, exactly as for a drift) — never a ratio of 1 that always passes.
  if (expected === null) {
    return {
      withinGuardrail: false,
      alert: {
        severity: 'critical',
        reason: 'no_baseline',
        model: input.model,
        resolution: input.resolution,
        seconds: input.seconds,
        expectedUsd: 0,
        actualUsd: input.actualBilledUsd,
        driftRatio: Number.POSITIVE_INFINITY,
        driftPercent: Number.POSITIVE_INFINITY,
        actionTaken: 'circuit_opened_no_baseline',
        messageKo: `Sunra AI 기준 단가 없음 (${input.model} ${input.resolution} ${input.seconds}초): 고정된 기준 단가가 없어 실청구 $${input.actualBilledUsd.toFixed(3)}를 검증할 수 없습니다. Sunra 자동 라우팅을 차단했습니다.`,
        messageEn: `Sunra AI has no pinned price baseline (${input.model} ${input.resolution} ${input.seconds}s): billed $${input.actualBilledUsd.toFixed(3)} cannot be checked. Opened circuit breaker.`,
        detectedAt
      }
    };
  }
  const expectedUsd = expected;
  const driftRatio = expectedUsd > 0 ? Math.round((input.actualBilledUsd / expectedUsd) * 1000) / 1000 : 1;
  const driftPercent = Math.round((driftRatio - 1) * 1000) / 10;

  if (driftRatio > maxDrift) {
    return {
      withinGuardrail: false,
      alert: {
        severity: 'critical',
        model: input.model,
        resolution: input.resolution,
        seconds: input.seconds,
        expectedUsd,
        actualUsd: input.actualBilledUsd,
        driftRatio,
        driftPercent,
        actionTaken: 'circuit_opened_fallback_modelark',
        messageKo: `Sunra AI 단가 인상 감지 (${input.model} ${input.resolution} ${input.seconds}초): 기준 $${expectedUsd.toFixed(3)} → 실청구 $${input.actualBilledUsd.toFixed(3)} (+${driftPercent.toFixed(1)}%). Sunra 자동 라우팅을 즉시 차단하고 ByteDance ModelArk로 전환했습니다.`,
        messageEn: `Sunra AI price drift detected (${input.model} ${input.resolution} ${input.seconds}s): expected $${expectedUsd.toFixed(3)} → billed $${input.actualBilledUsd.toFixed(3)} (+${driftPercent.toFixed(1)}%). Opened circuit breaker and routed back to ByteDance ModelArk.`,
        detectedAt
      }
    };
  }

  return { withinGuardrail: true, alert: null };
}

export interface ProviderTurnaroundTimestampInput {
  jobId: string;
  provider: VideoProviderId;
  model: string;
  createdAt: string | Date;
  claimedAt?: string | Date | null;
  startedAt?: string | Date | null;
  finishingAt?: string | Date | null;
  finishedAt: string | Date;
  costUsd?: number | null;
  succeeded: boolean;
}

export interface ProviderTurnaroundSample {
  jobId: string;
  provider: VideoProviderId;
  model: string;
  queueWaitMs: number;
  providerRenderMs: number;
  deliveryCopyMs: number;
  totalTurnaroundMs: number;
  costUsd: number | null;
  succeeded: boolean;
}

function toEpochMs(value: string | Date | null | undefined, fallback: number): number {
  if (!value) return fallback;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : fallback;
}

export function computeTurnaroundSample(
  input: ProviderTurnaroundTimestampInput
): ProviderTurnaroundSample {
  const createdMs = toEpochMs(input.createdAt, 0);
  const finishedMs = Math.max(createdMs, toEpochMs(input.finishedAt, createdMs));
  const startedMs = Math.min(
    finishedMs,
    Math.max(createdMs, toEpochMs(input.startedAt ?? input.claimedAt, createdMs))
  );
  const finishingMs = Math.min(
    finishedMs,
    Math.max(startedMs, toEpochMs(input.finishingAt, finishedMs))
  );

  return {
    jobId: input.jobId,
    provider: input.provider,
    model: input.model,
    queueWaitMs: Math.max(0, startedMs - createdMs),
    providerRenderMs: Math.max(0, finishingMs - startedMs),
    deliveryCopyMs: Math.max(0, finishedMs - finishingMs),
    totalTurnaroundMs: Math.max(0, finishedMs - createdMs),
    costUsd: input.costUsd ?? null,
    succeeded: input.succeeded
  };
}

export interface ProviderPerformanceSummary {
  provider: VideoProviderId;
  sampleCount: number;
  successRate: number;
  p50QueueWaitMs: number;
  p50RenderMs: number;
  p50DeliveryCopyMs: number;
  p50TotalTurnaroundMs: number;
  p95TotalTurnaroundMs: number;
  avgCostUsd: number | null;
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[index]!);
}

export function summarizeProviderTurnaround(
  provider: VideoProviderId,
  samples: readonly ProviderTurnaroundSample[]
): ProviderPerformanceSummary {
  const matching = samples.filter((s) => s.provider === provider);
  const succeeded = matching.filter((s) => s.succeeded);
  const count = matching.length;
  const successRate = count > 0 ? Math.round((succeeded.length / count) * 1000) / 1000 : 1;

  const costs = succeeded
    .map((s) => s.costUsd)
    .filter((c): c is number => typeof c === 'number' && Number.isFinite(c));
  const avgCostUsd =
    costs.length > 0
      ? Math.round((costs.reduce((acc, v) => acc + v, 0) / costs.length) * 10000) / 10000
      : null;

  return {
    provider,
    sampleCount: count,
    successRate,
    p50QueueWaitMs: percentile(
      succeeded.map((s) => s.queueWaitMs),
      50
    ),
    p50RenderMs: percentile(
      succeeded.map((s) => s.providerRenderMs),
      50
    ),
    p50DeliveryCopyMs: percentile(
      succeeded.map((s) => s.deliveryCopyMs),
      50
    ),
    p50TotalTurnaroundMs: percentile(
      succeeded.map((s) => s.totalTurnaroundMs),
      50
    ),
    p95TotalTurnaroundMs: percentile(
      succeeded.map((s) => s.totalTurnaroundMs),
      95
    ),
    avgCostUsd
  };
}

export interface ProviderComparisonReport {
  modelark: ProviderPerformanceSummary;
  sunra: ProviderPerformanceSummary;
  recommendedPrimary: VideoProviderId;
  speedupPercent: number;
  summaryKo: string;
}

export function compareProviderPerformance(
  samples: readonly ProviderTurnaroundSample[]
): ProviderComparisonReport {
  const modelark = summarizeProviderTurnaround('modelark', samples);
  const sunra = summarizeProviderTurnaround('sunra', samples);

  if (
    sunra.sampleCount >= MIN_TELEMETRY_SAMPLES_FOR_AUTO &&
    modelark.sampleCount >= MIN_TELEMETRY_SAMPLES_FOR_AUTO &&
    sunra.p50TotalTurnaroundMs > 0 &&
    modelark.p50TotalTurnaroundMs > 0 &&
    sunra.successRate >= 0.9
  ) {
    if (sunra.p50TotalTurnaroundMs < modelark.p50TotalTurnaroundMs) {
      const speedupPercent =
        Math.round(
          ((modelark.p50TotalTurnaroundMs - sunra.p50TotalTurnaroundMs) /
            modelark.p50TotalTurnaroundMs) *
            1000
        ) / 10;
      return {
        modelark,
        sunra,
        recommendedPrimary: 'sunra',
        speedupPercent,
        summaryKo: `최근 실측 기준 Sunra AI(중앙값 ${(sunra.p50TotalTurnaroundMs / 1000).toFixed(1)}초, P95 ${(sunra.p95TotalTurnaroundMs / 1000).toFixed(1)}초)가 ModelArk(중앙값 ${(modelark.p50TotalTurnaroundMs / 1000).toFixed(1)}초)보다 전달 속도가 ${speedupPercent}% 빠릅니다.`
      };
    }
  }

  const speedupPercent =
    sunra.p50TotalTurnaroundMs > 0 && modelark.p50TotalTurnaroundMs > 0
      ? Math.round(
          ((sunra.p50TotalTurnaroundMs - modelark.p50TotalTurnaroundMs) /
            sunra.p50TotalTurnaroundMs) *
            1000
        ) / 10
      : 0;

  return {
    modelark,
    sunra,
    recommendedPrimary: 'modelark',
    speedupPercent: Math.max(0, speedupPercent),
    summaryKo: `현재 기본 제공사는 ModelArk(10개 동시 실행 상한)이며, 동시 요청 폭주 시(>=${MODELARK_SOFT_OVERFLOW_THRESHOLD}건) 무제한 동시성을 가진 Sunra AI로 자동 분산됩니다.`
  };
}

export interface SelectProviderInput {
  jobId: string;
  model: SunraVideoModelId;
  mode: SunraRoutingMode;
  sunraConfigured: boolean;
  circuitState: CircuitBreakerState;
  modelarkInFlight: number;
  /** Customer selfie / verified face asset jobs stay on ModelArk unless signed ephemeral input is enabled. */
  hasPersonFace: boolean;
  sunraSignedFaceAllowed?: boolean;
  telemetrySamples?: readonly ProviderTurnaroundSample[];
}

/** A refusal: no provider may take this job (`primary: null`). Only a Sunra-only model (MAGI-2) is ever refused. */
export interface ProviderRouteRefusal {
  primary: null;
  fallback: null;
  reason: 'sunra_disabled' | 'circuit_breaker_open' | 'person_face_privacy_lock';
}

export type ProviderRouteDecision =
  | {
      primary: VideoProviderId;
      fallback: VideoProviderId | null;
      reason:
        | 'sunra_disabled'
        | 'circuit_breaker_open'
        | 'person_face_privacy_lock'
        | 'modelark_within_capacity'
        | 'modelark_concurrency_overflow'
        | 'sunra_primary_mode'
        | 'ab_benchmark_sunra'
        | 'ab_benchmark_modelark'
        | 'auto_fastest_sunra'
        | 'auto_fastest_modelark'
        | 'sunra_only_model';
    }
  | ProviderRouteRefusal;

/** Models only Sunra serves: no other provider renders them, so there is never a fallback to name. */
function sunraOnlyModel(model: SunraVideoModelId): boolean {
  return model === 'magi-2';
}

export function selectVideoProvider(input: SelectProviderInput): ProviderRouteDecision {
  // MAGI-2 renders on Sunra or not at all: each gate that would send a Seedance job to ModelArk refuses it instead.
  if (sunraOnlyModel(input.model)) {
    if (!input.sunraConfigured || input.mode === 'off') return { primary: null, fallback: null, reason: 'sunra_disabled' };
    if (input.circuitState !== 'closed') return { primary: null, fallback: null, reason: 'circuit_breaker_open' };
    if (input.hasPersonFace && input.sunraSignedFaceAllowed !== true) return { primary: null, fallback: null, reason: 'person_face_privacy_lock' };
    return { primary: 'sunra', fallback: null, reason: 'sunra_only_model' };
  }
  if (!input.sunraConfigured || input.mode === 'off') {
    return { primary: 'modelark', fallback: null, reason: 'sunra_disabled' };
  }
  if (input.circuitState !== 'closed') {
    return { primary: 'modelark', fallback: null, reason: 'circuit_breaker_open' };
  }
  if (input.hasPersonFace && input.sunraSignedFaceAllowed !== true) {
    return { primary: 'modelark', fallback: null, reason: 'person_face_privacy_lock' };
  }

  // Always overflow to Sunra when ModelArk is at or near its 10-concurrent ceiling.
  if (input.modelarkInFlight >= MODELARK_SOFT_OVERFLOW_THRESHOLD) {
    return {
      primary: 'sunra',
      fallback: 'modelark',
      reason: 'modelark_concurrency_overflow'
    };
  }

  if (input.mode === 'sunra_primary') {
    return { primary: 'sunra', fallback: 'modelark', reason: 'sunra_primary_mode' };
  }

  if (input.mode === 'ab_benchmark') {
    const hashByte = createHash('sha256').update(input.jobId).digest()[0] ?? 0;
    const chooseSunra = hashByte % 2 === 0;
    return chooseSunra
      ? { primary: 'sunra', fallback: 'modelark', reason: 'ab_benchmark_sunra' }
      : { primary: 'modelark', fallback: 'sunra', reason: 'ab_benchmark_modelark' };
  }

  if (input.mode === 'auto_fastest' && input.telemetrySamples) {
    const comparison = compareProviderPerformance(input.telemetrySamples);
    if (comparison.recommendedPrimary === 'sunra') {
      return { primary: 'sunra', fallback: 'modelark', reason: 'auto_fastest_sunra' };
    }
    return { primary: 'modelark', fallback: 'sunra', reason: 'auto_fastest_modelark' };
  }

  return {
    primary: 'modelark',
    fallback: 'sunra',
    reason: 'modelark_within_capacity'
  };
}

export interface ProviderRouterRuntime {
  getCircuitState(now?: Date): CircuitBreakerState;
  getAlerts(): readonly SunraPriceDriftAlert[];
  recordCompletedSample(
    sample: ProviderTurnaroundTimestampInput & {
      resolution?: '720p' | '1080p';
      seconds?: number;
    }
  ): { sample: ProviderTurnaroundSample; priceAlert: SunraPriceDriftAlert | null };
  recordSunraFailure(code: string, status: number, now?: Date): CircuitBreakerState;
  resetCircuit(): void;
  routeJob(
    input: Omit<SelectProviderInput, 'circuitState' | 'telemetrySamples'> & { now?: Date }
  ): ProviderRouteDecision;
  getComparisonReport(): ProviderComparisonReport;
}

export const OUTAGE_COOLDOWN_MS = 5 * 60 * 1000;
export const HOLD_COOLDOWN_MS = 15 * 60 * 1000;

export function createProviderRouterRuntime(options?: {
  maxDriftRatio?: number;
  maxSamples?: number;
  outageCooldownMs?: number;
  holdCooldownMs?: number;
}): ProviderRouterRuntime {
  const maxDriftRatio = options?.maxDriftRatio ?? SUNRA_DEFAULT_MAX_PRICE_DRIFT_RATIO;
  const maxSamples = options?.maxSamples ?? 200;
  const outageCooldownMs = options?.outageCooldownMs ?? OUTAGE_COOLDOWN_MS;
  const holdCooldownMs = options?.holdCooldownMs ?? HOLD_COOLDOWN_MS;

  let circuitState: CircuitBreakerState = 'closed';
  let circuitOpenedAtMs = 0;
  const samples: ProviderTurnaroundSample[] = [];
  const alerts: SunraPriceDriftAlert[] = [];

  function resolveEffectiveCircuitState(now: Date = new Date()): CircuitBreakerState {
    if (circuitState === 'closed' || circuitState === 'open_price_drift') {
      return circuitState;
    }
    const elapsed = now.getTime() - circuitOpenedAtMs;
    if (circuitState === 'open_provider_outage' && elapsed >= outageCooldownMs) {
      circuitState = 'closed';
      return 'closed';
    }
    if (circuitState === 'open_insufficient_hold' && elapsed >= holdCooldownMs) {
      circuitState = 'closed';
      return 'closed';
    }
    return circuitState;
  }

  return {
    getCircuitState(now = new Date()) {
      return resolveEffectiveCircuitState(now);
    },

    getAlerts() {
      return alerts;
    },

    recordCompletedSample(input) {
      const sample = computeTurnaroundSample(input);
      samples.push(sample);
      if (samples.length > maxSamples) {
        samples.splice(0, samples.length - maxSamples);
      }

      let priceAlert: SunraPriceDriftAlert | null = null;
      if (
        input.provider === 'sunra' &&
        typeof input.costUsd === 'number' &&
        input.costUsd > 0 &&
        (input.model === 'seedance-2.0' || input.model === 'seedance-2.5' || input.model === 'magi-2')
      ) {
        const guardrail = evaluateSunraPriceGuardrail({
          model: input.model,
          resolution: input.resolution ?? (input.model === 'magi-2' ? '1080p' : '720p'),
          seconds: input.seconds ?? 5,
          actualBilledUsd: input.costUsd,
          maxDriftRatio
        });
        if (!guardrail.withinGuardrail && guardrail.alert) {
          circuitState = 'open_price_drift';
          circuitOpenedAtMs = Date.now();
          priceAlert = guardrail.alert;
          alerts.push(guardrail.alert);
        } else if (circuitState !== 'open_price_drift') {
          circuitState = 'closed';
        }
      }

      return { sample, priceAlert };
    },

    recordSunraFailure(code, status, now = new Date()) {
      if (code === 'INSUFFICIENT_CREDIT' || status === 412) {
        circuitState = 'open_insufficient_hold';
        circuitOpenedAtMs = now.getTime();
      } else if (status >= 500 || status === 429) {
        circuitState = 'open_provider_outage';
        circuitOpenedAtMs = now.getTime();
      }
      return circuitState;
    },

    resetCircuit() {
      circuitState = 'closed';
      circuitOpenedAtMs = 0;
    },

    routeJob(input) {
      const activeCircuit = resolveEffectiveCircuitState(input.now);
      return selectVideoProvider({
        ...input,
        circuitState: activeCircuit,
        telemetrySamples: samples
      });
    },

    getComparisonReport() {
      return compareProviderPerformance(samples);
    }
  };
}
