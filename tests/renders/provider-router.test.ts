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
});
