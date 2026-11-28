import { describe, expect, it, vi } from 'vitest';
import {
  createSunraClient,
  fromSunraTaskId,
  sunraConfigFromEnv,
  sunraVideoEndpoint,
  toSunraTaskId
} from '@/lib/sunra/client';
import {
  MODELARK_SOFT_OVERFLOW_THRESHOLD,
  compareProviderPerformance,
  computeTurnaroundSample,
  createProviderRouterRuntime,
  evaluateSunraPriceGuardrail,
  expectedSunraVideoUsd,
  selectVideoProvider
} from '@/lib/renders/provider-router';

describe('Sunra AI client & task id helpers', () => {
  it('parses environment config and task id prefixes cleanly', () => {
    expect(sunraConfigFromEnv({})).toBeNull();
    expect(sunraConfigFromEnv({ SUNRA_API_KEY: '  sk-sunra-test  ' })).toEqual({
      apiKey: 'sk-sunra-test',
      baseUrl: 'https://api.sunra.ai'
    });

    const wrapped = toSunraTaskId('req_991');
    expect(wrapped).toBe('sunra:req_991');
    expect(fromSunraTaskId(wrapped)).toBe('req_991');
    expect(fromSunraTaskId('cgt-modelark-1')).toBeNull();
    expect(sunraVideoEndpoint('seedance-2.5')).toBe('bytedance/seedance-2.5/text-to-video');
  });

  it('submits queue jobs, extracts actual billed USD (units / 1000) + 5% top-up fee, and probes live pricing', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith('/v1/queue/bytedance/seedance-2.5/text-to-video')) {
        return new Response(JSON.stringify({ request_id: 'sunra_req_1' }), { status: 200 });
      }
      if (u.endsWith('/v1/queue/requests/sunra_req_1/status')) {
        return new Response(JSON.stringify({ status: 'COMPLETED', success: true }), { status: 200 });
      }
      if (u.endsWith('/v1/queue/requests/sunra_req_1')) {
        return new Response(
          JSON.stringify({
            video: { url: 'https://cdn.sunra.ai/out/film.mp4' },
            units: 1156,
            total_tokens: 108000
          }),
          { status: 200 }
        );
      }
      if (u.includes('/v1/pricing/model/')) {
        return new Response(
          JSON.stringify({
            unit_price_usd: 10.7,
            unit_type: 'per_million_tokens'
          }),
          { status: 200 }
        );
      }
      return new Response('not found', { status: 404 });
    });

    const client = createSunraClient(
      { apiKey: 'sk-sunra', baseUrl: 'https://api.sunra.ai' },
      { fetch: fetchMock }
    );

    const submitted = await client.submit('bytedance/seedance-2.5/text-to-video', {
      prompt: 'cinematic blue studio'
    });
    expect(submitted.id).toBe('sunra_req_1');

    const task = await client.getTask('sunra_req_1');
    expect(task.status).toBe('COMPLETED');
    expect(task.url).toBe('https://cdn.sunra.ai/out/film.mp4');
    expect(task.billedUsd).toBe(1.156);
    expect(task.effectiveUsdWithFee).toBe(1.2138);
    expect(task.totalTokens).toBe(108000);

    const pricing = await client.fetchPricing?.('bytedance/seedance-2.5', 'text-to-video');
    expect(pricing?.unitPriceUsd).toBe(10.7);
  });
});

describe('50-User Traffic Surge Routing & Dynamic Pricing Circuit Breaker', () => {
  it('absorbs a 50-concurrent-user surge by routing the first 8 jobs to ModelArk and overflowing jobs 9..50 to Sunra AI', () => {
    const router = createProviderRouterRuntime();
    const decisions = [];

    for (let i = 0; i < 50; i++) {
      const decision = router.routeJob({
        jobId: `job-${i + 1}`,
        model: 'seedance-2.5',
        mode: 'surge_overflow',
        sunraConfigured: true,
        modelarkInFlight: Math.min(i, MODELARK_SOFT_OVERFLOW_THRESHOLD),
        hasPersonFace: false
      });
      decisions.push(decision);
    }

    const modelarkCount = decisions.filter((d) => d.primary === 'modelark').length;
    const sunraOverflowCount = decisions.filter(
      (d) => d.primary === 'sunra' && d.reason === 'modelark_concurrency_overflow'
    ).length;

    expect(modelarkCount).toBe(MODELARK_SOFT_OVERFLOW_THRESHOLD);
    expect(sunraOverflowCount).toBe(50 - MODELARK_SOFT_OVERFLOW_THRESHOLD);
  });

  it('keeps customer face jobs locked to ModelArk unless signed ephemeral input is explicitly enabled', () => {
    const decision = selectVideoProvider({
      jobId: 'face-job-1',
      model: 'seedance-2.5',
      mode: 'surge_overflow',
      sunraConfigured: true,
      circuitState: 'closed',
      modelarkInFlight: 9,
      hasPersonFace: true,
      sunraSignedFaceAllowed: false
    });

    expect(decision.primary).toBe('modelark');
    expect(decision.reason).toBe('person_face_privacy_lock');
  });

  it('immediately trips the Pricing Circuit Breaker when Sunra raises prices by >10% and falls back to ModelArk', () => {
    const router = createProviderRouterRuntime({ maxDriftRatio: 1.1 });

    // Baseline Seedance 2.5 720p 5s is $1.156. Simulate Sunra suddenly charging $1.420 (+22.8%).
    const { priceAlert } = router.recordCompletedSample({
      jobId: 'sunra-job-1',
      provider: 'sunra',
      model: 'seedance-2.5',
      resolution: '720p',
      seconds: 5,
      createdAt: '2026-11-04T00:00:00.000Z',
      startedAt: '2026-11-04T00:00:02.000Z',
      finishingAt: '2026-11-04T00:00:40.000Z',
      finishedAt: '2026-11-04T00:00:43.000Z',
      costUsd: 1.42,
      succeeded: true
    });

    expect(priceAlert).not.toBeNull();
    expect(priceAlert?.severity).toBe('critical');
    expect(priceAlert?.driftPercent).toBeGreaterThan(20);
    expect(priceAlert?.messageKo).toContain('Sunra AI 단가 인상 감지');
    expect(router.getCircuitState()).toBe('open_price_drift');

    // Subsequent jobs must automatically route back to ModelArk even under surge!
    const afterSpike = router.routeJob({
      jobId: 'job-after-spike',
      model: 'seedance-2.5',
      mode: 'sunra_primary',
      sunraConfigured: true,
      modelarkInFlight: 9,
      hasPersonFace: false
    });
    expect(afterSpike.primary).toBe('modelark');
    expect(afterSpike.reason).toBe('circuit_breaker_open');
  });

  it('trips temporary hold cooldown on HTTP 412 INSUFFICIENT_CREDIT ($18 hold) and auto-recovers after cooldown', () => {
    const router = createProviderRouterRuntime({ holdCooldownMs: 60_000 });
    const t0 = new Date('2026-11-04T00:00:00.000Z');

    router.recordSunraFailure('INSUFFICIENT_CREDIT', 412, t0);
    expect(router.getCircuitState(t0)).toBe('open_insufficient_hold');

    // 30s later: still open
    const t30 = new Date(t0.getTime() + 30_000);
    expect(router.getCircuitState(t30)).toBe('open_insufficient_hold');

    // 61s later: automatically recovers to closed!
    const t61 = new Date(t0.getTime() + 61_000);
    expect(router.getCircuitState(t61)).toBe('closed');
  });

  it('measures 3-stage turnaround (queueWait + render + deliveryCopy) and picks the faster provider in auto_fastest mode', () => {
    const samples = [];
    for (let i = 0; i < 6; i++) {
      samples.push(
        computeTurnaroundSample({
          jobId: `ma-${i}`,
          provider: 'modelark',
          model: 'seedance-2.5',
          createdAt: '2026-11-04T00:00:00.000Z',
          startedAt: '2026-11-04T00:00:18.000Z',
          finishingAt: '2026-11-04T00:01:18.000Z',
          finishedAt: '2026-11-04T00:01:22.000Z',
          costUsd: expectedSunraVideoUsd({ model: 'seedance-2.5', resolution: '720p', seconds: 5 }),
          succeeded: true
        })
      );
      samples.push(
        computeTurnaroundSample({
          jobId: `sr-${i}`,
          provider: 'sunra',
          model: 'seedance-2.5',
          createdAt: '2026-11-04T00:00:00.000Z',
          startedAt: '2026-11-04T00:00:01.000Z',
          finishingAt: '2026-11-04T00:00:46.000Z',
          finishedAt: '2026-11-04T00:00:49.000Z',
          costUsd: expectedSunraVideoUsd({ model: 'seedance-2.5', resolution: '720p', seconds: 5 }),
          succeeded: true
        })
      );
    }

    const report = compareProviderPerformance(samples);
    expect(report.recommendedPrimary).toBe('sunra');
    expect(report.sunra.p50QueueWaitMs).toBe(1000);
    expect(report.modelark.p50QueueWaitMs).toBe(18000);
    expect(report.speedupPercent).toBeGreaterThan(35);
    expect(report.summaryKo).toContain('Sunra AI');

    const decision = selectVideoProvider({
      jobId: 'auto-1',
      model: 'seedance-2.5',
      mode: 'auto_fastest',
      sunraConfigured: true,
      circuitState: 'closed',
      modelarkInFlight: 2,
      hasPersonFace: false,
      telemetrySamples: samples
    });
    expect(decision.primary).toBe('sunra');
    expect(decision.reason).toBe('auto_fastest_sunra');
  });

  it('validates normal Sunra billing within the 10% drift tolerance without false alarms', () => {
    const check = evaluateSunraPriceGuardrail({
      model: 'seedance-2.0',
      resolution: '720p',
      seconds: 5,
      actualBilledUsd: 0.745 // +5% top-up fee is within 10% tolerance of $0.710
    });
    expect(check.withinGuardrail).toBe(true);
    expect(check.alert).toBeNull();
  });

  it('prices MAGI-2 at $0.08/s (1080p) and guards against >10% drift', () => {
    expect(expectedSunraVideoUsd({ model: 'magi-2', resolution: '1080p', seconds: 10 })).toBe(0.8);
    expect(expectedSunraVideoUsd({ model: 'magi-2', resolution: '1080p', seconds: 10, includeTopupFee: true })).toBe(0.84);
    expect(evaluateSunraPriceGuardrail({ model: 'magi-2', resolution: '1080p', seconds: 10, actualBilledUsd: 0.84 }).withinGuardrail).toBe(true);
    const spike = evaluateSunraPriceGuardrail({ model: 'magi-2', resolution: '1080p', seconds: 10, actualBilledUsd: 0.95 });
    expect(spike.withinGuardrail).toBe(false);
    expect(spike.alert?.model).toBe('magi-2');

    const router = createProviderRouterRuntime();
    const { priceAlert } = router.recordCompletedSample({
      jobId: 'magi-job-1',
      provider: 'sunra',
      model: 'magi-2',
      resolution: '1080p',
      seconds: 10,
      createdAt: '2026-11-28T00:00:00.000Z',
      finishedAt: '2026-11-28T00:02:30.000Z',
      costUsd: 0.95,
      succeeded: true,
    });
    expect(priceAlert).not.toBeNull();
    expect(router.getCircuitState()).toBe('open_price_drift');
  });
});

describe('price-drift guardrail without a pinned baseline (M1 fix 1: fail safe, never "fine")', () => {
  /** Main's numbers (7165e399), produced by main's own provider-router.ts: [no fee, with the 5% top-up fee]. */
  const MAIN: Record<string, [number, number]> = {
    'seedance-2.0 720p 0s': [0.142, 0.1491],
    'seedance-2.0 720p 4s': [0.568, 0.5964],
    'seedance-2.0 720p 5s': [0.71, 0.7455],
    'seedance-2.0 720p 10s': [1.42, 1.491],
    'seedance-2.0 720p 15s': [2.13, 2.2365],
    'seedance-2.0 720p 30s': [4.26, 4.473],
    'seedance-2.0 1080p 0s': [0.3542, 0.3719],
    'seedance-2.0 1080p 4s': [1.4168, 1.4876],
    'seedance-2.0 1080p 5s': [1.771, 1.8596],
    'seedance-2.0 1080p 10s': [3.542, 3.7191],
    'seedance-2.0 1080p 15s': [5.313, 5.5787],
    'seedance-2.0 1080p 30s': [10.626, 11.1573],
    'seedance-2.5 720p 0s': [0.2312, 0.2428],
    'seedance-2.5 720p 4s': [0.9248, 0.971],
    'seedance-2.5 720p 5s': [1.156, 1.2138],
    'seedance-2.5 720p 10s': [2.312, 2.4276],
    'seedance-2.5 720p 15s': [3.468, 3.6414],
    'seedance-2.5 720p 30s': [6.936, 7.2828],
    'seedance-2.5 1080p 0s': [0.5686, 0.597],
    'seedance-2.5 1080p 4s': [2.2744, 2.3881],
    'seedance-2.5 1080p 5s': [2.843, 2.9852],
    'seedance-2.5 1080p 10s': [5.686, 5.9703],
    'seedance-2.5 1080p 15s': [8.529, 8.9555],
    'seedance-2.5 1080p 30s': [17.058, 17.9109],
  };

  it('keeps every Seedance row exactly at main’s numbers and main’s verdicts', () => {
    for (const [key, [plain, withFee]] of Object.entries(MAIN)) {
      const [model, resolution, s] = key.split(' ') as ['seedance-2.0' | 'seedance-2.5', '720p' | '1080p', string];
      const seconds = Number.parseInt(s, 10);
      expect(expectedSunraVideoUsd({ model, resolution, seconds }), key).toBe(plain);
      expect(expectedSunraVideoUsd({ model, resolution, seconds, includeTopupFee: true }), key).toBe(withFee);
      // Billed at list price + fee: inside the 10% tolerance, no alert (main's verdict).
      expect(evaluateSunraPriceGuardrail({ model, resolution, seconds, actualBilledUsd: withFee }), key).toEqual({ withinGuardrail: true, alert: null });
      // Billed 20% over: main's alert, field for field.
      const over = Math.round(plain * 1.2 * 10000) / 10000;
      const { withinGuardrail, alert } = evaluateSunraPriceGuardrail({ model, resolution, seconds, actualBilledUsd: over, now: new Date('2026-11-28T00:00:00Z') });
      expect(withinGuardrail, key).toBe(false);
      expect(alert, key).toMatchObject({ severity: 'critical', model, resolution, seconds, expectedUsd: plain, actualUsd: over, driftRatio: 1.2, driftPercent: 20, actionTaken: 'circuit_opened_fallback_modelark' });
      expect(alert?.messageEn, key).toBe(`Sunra AI price drift detected (${model} ${resolution} ${seconds}s): expected $${plain.toFixed(3)} → billed $${over.toFixed(3)} (+20.0%). Opened circuit breaker and routed back to ByteDance ModelArk.`);
    }
  });

  it('has no baseline for MAGI-2 at 720p or for a model it does not know, and says so instead of 0', () => {
    expect(expectedSunraVideoUsd({ model: 'magi-2', resolution: '720p', seconds: 10 })).toBeNull();
    expect(expectedSunraVideoUsd({ model: 'seedance-9' as never, resolution: '720p', seconds: 10 })).toBeNull();
    expect(expectedSunraVideoUsd({ model: 'seedance-2.5', resolution: '480p' as never, seconds: 10 })).toBeNull();
  });

  it('treats a missing baseline as outside the guardrail, whatever was billed', () => {
    const rows: Array<{ model: 'magi-2'; resolution: '720p' | '1080p' }> = [
      { model: 'magi-2', resolution: '720p' },
      { model: 'seedance-9' as never, resolution: '720p' },
      { model: 'seedance-2.5' as never, resolution: '480p' as never },
    ];
    for (const row of rows) {
      for (const billed of [0.01, 0.84, 5, 100]) {
        const { withinGuardrail, alert } = evaluateSunraPriceGuardrail({ ...row, seconds: 10, actualBilledUsd: billed, now: new Date('2026-11-28T00:00:00Z') });
        expect(withinGuardrail, `${row.model} ${row.resolution} $${billed}`).toBe(false);
        expect(alert, `${row.model} ${row.resolution} $${billed}`).toMatchObject({
          severity: 'critical',
          model: row.model,
          resolution: row.resolution,
          seconds: 10,
          actualUsd: billed,
          reason: 'no_baseline',
          actionTaken: 'circuit_opened_no_baseline',
        });
        expect(alert?.messageEn).toMatch(/no pinned price baseline/i);
      }
    }
  });

  it('opens the drift circuit in the router runtime for a sample with no baseline, as it does for a drift', () => {
    const router = createProviderRouterRuntime();
    const { priceAlert } = router.recordCompletedSample({
      jobId: 'magi-job-720',
      provider: 'sunra',
      model: 'magi-2',
      resolution: '720p',
      seconds: 10,
      createdAt: '2026-11-28T00:00:00.000Z',
      finishedAt: '2026-11-28T00:02:30.000Z',
      costUsd: 0.84,
      succeeded: true,
    });
    expect(priceAlert).toMatchObject({ reason: 'no_baseline' });
    expect(router.getCircuitState()).toBe('open_price_drift');
    expect(router.getAlerts()).toHaveLength(1);
  });
});

describe('selectVideoProvider for MAGI-2 (M1 fix 1: Sunra or nothing, never ModelArk or Kling)', () => {
  const base = {
    jobId: 'magi-job-1',
    model: 'magi-2' as const,
    mode: 'sunra_primary' as const,
    sunraConfigured: true,
    circuitState: 'closed' as const,
    modelarkInFlight: 0,
    hasPersonFace: true,
    sunraSignedFaceAllowed: true,
  };

  it('answers Sunra with no fallback when Sunra may take it, in every routing mode and at any ModelArk load', () => {
    for (const mode of ['surge_overflow', 'auto_fastest', 'ab_benchmark', 'sunra_primary'] as const) {
      for (const modelarkInFlight of [0, 7, 8, 10]) {
        for (const jobId of ['magi-job-1', 'job-that-hashes-to-modelark-3', 'x']) {
          for (const hasPersonFace of [true, false]) {
            const decision = selectVideoProvider({ ...base, mode, modelarkInFlight, jobId, hasPersonFace, telemetrySamples: [] });
            expect(decision, `${mode} ${modelarkInFlight} ${jobId} ${hasPersonFace}`).toEqual({ primary: 'sunra', fallback: null, reason: 'sunra_only_model' });
          }
        }
      }
    }
  });

  it('refuses (no provider) when Sunra is not configured or routing is off', () => {
    expect(selectVideoProvider({ ...base, sunraConfigured: false })).toEqual({ primary: null, fallback: null, reason: 'sunra_disabled' });
    expect(selectVideoProvider({ ...base, mode: 'off' })).toEqual({ primary: null, fallback: null, reason: 'sunra_disabled' });
  });

  it('refuses (no provider) while any circuit is open', () => {
    for (const circuitState of ['open_price_drift', 'open_insufficient_hold', 'open_provider_outage'] as const) {
      expect(selectVideoProvider({ ...base, circuitState }), circuitState).toEqual({ primary: null, fallback: null, reason: 'circuit_breaker_open' });
    }
  });

  it('refuses (no provider) a person-face job unless signed face input is allowed', () => {
    for (const sunraSignedFaceAllowed of [false, undefined]) {
      expect(selectVideoProvider({ ...base, sunraSignedFaceAllowed }), String(sunraSignedFaceAllowed)).toEqual({ primary: null, fallback: null, reason: 'person_face_privacy_lock' });
    }
  });

  it('never names ModelArk or Kling for MAGI-2, in any combination', () => {
    for (const sunraConfigured of [true, false])
      for (const mode of ['off', 'surge_overflow', 'auto_fastest', 'ab_benchmark', 'sunra_primary'] as const)
        for (const circuitState of ['closed', 'open_price_drift', 'open_insufficient_hold', 'open_provider_outage'] as const)
          for (const hasPersonFace of [true, false])
            for (const sunraSignedFaceAllowed of [true, false, undefined])
              for (const modelarkInFlight of [0, 9]) {
                const d = selectVideoProvider({ jobId: 'j', model: 'magi-2', mode, sunraConfigured, circuitState, hasPersonFace, sunraSignedFaceAllowed, modelarkInFlight });
                expect([d.primary, d.fallback].some((p) => p === 'modelark' || (p as string) === 'kling')).toBe(false);
                expect(d.fallback).toBeNull();
              }
  });

  it('runtime: after a drift the router refuses MAGI-2 instead of sending it to ModelArk', () => {
    const router = createProviderRouterRuntime();
    router.recordCompletedSample({
      jobId: 'magi-job-1', provider: 'sunra', model: 'magi-2', resolution: '1080p', seconds: 10,
      createdAt: '2026-11-28T00:00:00.000Z', finishedAt: '2026-11-28T00:02:30.000Z', costUsd: 0.95, succeeded: true,
    });
    expect(router.routeJob({ jobId: 'magi-job-2', model: 'magi-2', mode: 'sunra_primary', sunraConfigured: true, modelarkInFlight: 0, hasPersonFace: true, sunraSignedFaceAllowed: true }))
      .toEqual({ primary: null, fallback: null, reason: 'circuit_breaker_open' });
  });

  it('leaves every Seedance answer as main gives it', () => {
    const seedance = { jobId: 'job-1', model: 'seedance-2.5' as const, mode: 'sunra_primary' as const, sunraConfigured: true, circuitState: 'closed' as const, modelarkInFlight: 0, hasPersonFace: false };
    expect(selectVideoProvider({ ...seedance, sunraConfigured: false })).toEqual({ primary: 'modelark', fallback: null, reason: 'sunra_disabled' });
    expect(selectVideoProvider({ ...seedance, mode: 'off' })).toEqual({ primary: 'modelark', fallback: null, reason: 'sunra_disabled' });
    expect(selectVideoProvider({ ...seedance, circuitState: 'open_price_drift' })).toEqual({ primary: 'modelark', fallback: null, reason: 'circuit_breaker_open' });
    expect(selectVideoProvider({ ...seedance, hasPersonFace: true })).toEqual({ primary: 'modelark', fallback: null, reason: 'person_face_privacy_lock' });
    expect(selectVideoProvider({ ...seedance, modelarkInFlight: 8, mode: 'surge_overflow' })).toEqual({ primary: 'sunra', fallback: 'modelark', reason: 'modelark_concurrency_overflow' });
    expect(selectVideoProvider({ ...seedance })).toEqual({ primary: 'sunra', fallback: 'modelark', reason: 'sunra_primary_mode' });
    expect(selectVideoProvider({ ...seedance, mode: 'surge_overflow' })).toEqual({ primary: 'modelark', fallback: 'sunra', reason: 'modelark_within_capacity' });
    expect(selectVideoProvider({ ...seedance, model: 'seedance-2.0', hasPersonFace: true, sunraSignedFaceAllowed: true })).toEqual({ primary: 'sunra', fallback: 'modelark', reason: 'sunra_primary_mode' });
  });
});
