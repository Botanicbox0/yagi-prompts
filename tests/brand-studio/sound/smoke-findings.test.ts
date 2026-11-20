import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STUDIO_CREDIT_KRW } from '@/lib/brand-studio/credits';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { studioEnv } from '@/lib/brand-studio/env';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { createFakeStudioProvider } from '@/lib/brand-studio/provider/fake';
import { createSunraStudioProvider } from '@/lib/brand-studio/provider/sunra-api';
import type { StudioProvider, StudioTaskStatus } from '@/lib/brand-studio/provider/types';
import { MUSIC_ENGINES, MUSIC_WAIT_CEILING_MS } from '@/lib/brand-studio/sound/engine';
import { brandSoundMaxModeShown } from '@/lib/flags';
import { parseSunraQueueResult, parseSunraQueueState, type SunraClient } from '@/lib/sunra/client';
import { requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';
import { MP3_48K_SECONDS, MP3_48K_TAGGED_BASE64 } from './fixtures/mp3-48k';

/**
 * What the paid smoke test on the real engine showed (2026-11-20, nine calls), held by tests:
 *  1. A failed request also comes back COMPLETED: `success` / `error` decide, never `status`.
 *  2. One request returned two songs; the count is never assumed.
 *  3. `duration` and `lyrics` come back empty: lengths are measured from the file, names are ours.
 *  4. No extend for this model; the engine-side crop never answered.
 *  5. 40–69 s normally; our ceiling is 10 minutes, then the run fails and takes nothing.
 *  6. The charge is `billing.amount`.
 *  7. Files are 48 kHz MP3 with a comment tag: stored byte for byte.
 *  8. "더 고르게 만들기" starts hidden.
 * Response shapes below are the logged ones, with the file addresses replaced.
 */

const REAL_STATUS_OK = {
  status: 'COMPLETED',
  success: true,
  billing: { status: 'paid', usage: '1', unit_amount: '0.1', amount: '0.1', currency: 'USD' },
};
const REAL_STATUS_FAILED = {
  status: 'COMPLETED',
  success: false,
  error: { code: 'service_provider_error', message: 'Predict failed. Please try again.', retryable: true, timestamp: '2026-11-20T12:16:04.336Z' },
};
const realResult = (count: number, amount = '0.1') => ({
  clips: Array.from({ length: count }, (_, i) => ({
    task_id: '2892e9d4-f8f2-46f6-9f90-969b3966211d',
    clip_id: `sunra_clip_${i}`,
    title: `Suno v6 track ${i + 1}`,
    image_url: null,
    audio_url: `https://files.example/${i}.mp3`,
  })),
  billing: { status: 'paid', usage: '1', unit_amount: amount, amount, currency: 'USD' },
});

function stubClient(state: unknown, result: unknown): SunraClient & { resultCalls: number } {
  const client = {
    resultCalls: 0,
    submit: async () => ({ id: 'pd_test' }),
    getTask: async () => {
      throw new Error('unused');
    },
    queueStatus: async () => parseSunraQueueState(state),
    queueResult: async () => {
      client.resultCalls += 1;
      return parseSunraQueueResult(result);
    },
  };
  return client as SunraClient & { resultCalls: number };
}
const live = (client: SunraClient) => createSunraStudioProvider({ apiKey: 'test', baseUrl: 'https://api.example' } as never, { client });

describe('1, 2, 6: reading the real answers', () => {
  it('fails a COMPLETED answer whose success is false, without asking for a result', async () => {
    const client = stubClient(REAL_STATUS_FAILED, {});
    const status = await live(client).status('pd_test');
    expect(status.state).toBe('failed');
    expect(client.resultCalls).toBe(0);
  });

  it('fails a COMPLETED answer that carries an error even without a success field', async () => {
    const { success: _success, ...noSuccess } = REAL_STATUS_FAILED;
    expect((await live(stubClient(noSuccess, {})).status('pd_test')).state).toBe('failed');
  });

  it('fails a result body that is an error, or has no clips', async () => {
    const errorBody = { error: { type: 'invalid_request_error', code: 'PREDICTION_FAILED', message: 'Predict failed. Please try again.' } };
    expect((await live(stubClient(REAL_STATUS_OK, errorBody)).status('pd_test')).state).toBe('failed');
    expect((await live(stubClient(REAL_STATUS_OK, { clips: [], billing: REAL_STATUS_OK.billing })).status('pd_test')).state).toBe('failed');
  });

  it('takes every version that came back (1, 2 or 3), with no length, and the charge from billing.amount', async () => {
    for (const count of [1, 2, 3]) {
      const status = (await live(stubClient(REAL_STATUS_OK, realResult(count))).status('pd_test')) as Extract<StudioTaskStatus, { state: 'succeeded' }>;
      expect(status.state).toBe('succeeded');
      expect(status.outputs).toHaveLength(count);
      expect(status.outputs.every((o) => o.seconds == null)).toBe(true);
      expect(status.costUsd).toBe(0.1);
    }
  });

  it('reads billing.amount from the result when the status has none', async () => {
    const { billing: _billing, ...noBilling } = REAL_STATUS_OK;
    const status = (await live(stubClient(noBilling, realResult(2, '0.2'))).status('pd_test')) as Extract<StudioTaskStatus, { state: 'succeeded' }>;
    expect(status.costUsd).toBe(0.2);
  });

  it('answers in the same shape from the fake provider: two versions, no length, a charge', async () => {
    const fake = createFakeStudioProvider({ pollsBeforeDone: 1 });
    const { taskId } = await fake.submit({ endpoint: 'suno/suno-v6/inspire-mode', body: { prompt: 'calm piano', instrumental: true } });
    const status = (await fake.status(taskId)) as Extract<StudioTaskStatus, { state: 'succeeded' }>;
    expect(status.outputs).toHaveLength(2);
    expect(status.outputs.every((o) => o.seconds == null && o.mime === 'audio/mpeg')).toBe(true);
    expect(status.outputs.map((o) => o.meta?.title)).toEqual(['Suno v6 track 1', 'Suno v6 track 2']);
    expect(status.costUsd).toBe(0.1);
    const max = await fake.submit({ endpoint: 'suno/suno-v6/custom-mode', body: { title: 't', style: 's', lyrics: '', instrumental: true, max_mode: true } });
    expect(((await fake.status(max.taskId)) as Extract<StudioTaskStatus, { state: 'succeeded' }>).costUsd).toBe(0.2);
  });
});

describe('4, 5, 8: what the engine cannot do, and our own limits', () => {
  it('has no extend and a 10-minute ceiling', () => {
    const engine = MUSIC_ENGINES['suno-v6-sunra']!;
    expect(engine.capabilities.extend).toBe(false);
    expect(engine.capabilities.lengthInput).toBe(false);
    expect(MUSIC_WAIT_CEILING_MS).toBe(10 * 60_000);
  });

  it('starts with "더 고르게 만들기" hidden: shown only for exactly "on"', () => {
    for (const value of [undefined, '', 'off', 'ON', 'true', '1']) expect(brandSoundMaxModeShown({ BRAND_SOUND_MAX_MODE: value })).toBe(false);
    expect(brandSoundMaxModeShown({ BRAND_SOUND_MAX_MODE: 'on' })).toBe(true);
    expect(studioEnv({}).soundMaxMode).toBe(false);
  });
});

describe('end to end with the real answer shapes', () => {
  let f: StudioFixture;
  type Script = { status: StudioTaskStatus | 'pending' };
  const script: Script = { status: 'pending' };
  const tagged = new Uint8Array(Buffer.from(MP3_48K_TAGGED_BASE64, 'base64'));
  const scripted: StudioProvider = {
    name: 'sunra_api',
    submit: async () => ({ taskId: `pd_${Math.random().toString(36).slice(2)}` }),
    status: async () => (script.status === 'pending' ? { state: 'pending' } : script.status),
    download: async () => ({ bytes: tagged, mime: 'audio/mpeg' }),
  };
  const env = (extra: Record<string, string> = {}) =>
    studioEnv({ BRAND_STUDIO_PROVIDER: 'live', SUNRA_API_KEY: 'test', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', BRAND_SOUND_STUDIO: 'on', ...extra });
  const music = () => ({ kind: 'music', organizationId: f.orgId, requestId: requestId(), prompt: 'calm piano', vocal: false });
  const job = async (id: string) =>
    (await f.sql.query<{ status: string; usage_krw: number | null; cost_usd: string | null; error_code: string | null }>('select * from brand_studio_jobs where id = $1', [id])).rows[0]!;
  const outputs = async (id: string) =>
    (await f.sql.query<{ idx: number; status: string; duration_ms: number | null; sha256: string | null }>('select * from brand_studio_outputs where job_id = $1 order by idx', [id])).rows;
  const advance = async (deps: ReturnType<typeof studioDeps>, id: string) => {
    for (let i = 0; i < 5; i += 1) await advanceStudioJobsWith(deps, { jobIds: [id] });
  };
  const create = async (deps: ReturnType<typeof studioDeps>) => {
    const created = await createStudioJob(deps, viewerOf(f.ids.owner), music());
    if (!('job' in created)) throw new Error(JSON.stringify(created));
    return created.job.id;
  };

  beforeEach(async () => {
    f = await studioFixture();
    script.status = 'pending';
  });
  afterEach(async () => {
    await f.db.close();
  });

  it('settles a failed COMPLETED request at 0', async () => {
    const deps = studioDeps(f.sql, { env: env(), provider: scripted as never });
    const id = await create(deps);
    script.status = { state: 'failed', code: 'failed', detail: 'service_provider_error: Predict failed.' };
    await advance(deps, id);
    expect(await job(id)).toMatchObject({ status: 'failed', usage_krw: 0 });
  });

  it('stores three versions as delivered (tags kept), measures each, takes the quote once and records billing.amount', async () => {
    const deps = studioDeps(f.sql, { env: env(), provider: scripted as never });
    const id = await create(deps);
    script.status = {
      state: 'succeeded',
      costUsd: 0.1,
      outputs: [0, 1, 2].map((i) => ({ url: `https://files.example/${i}.mp3`, mime: 'audio/mpeg', meta: { clipId: `c${i}`, title: `Suno v6 track ${i + 1}` } })),
    };
    await advance(deps, id);
    expect(await job(id)).toMatchObject({ status: 'succeeded', usage_krw: 16 * STUDIO_CREDIT_KRW });
    expect(Number((await job(id)).cost_usd)).toBe(0.1);
    const rows = await outputs(id);
    expect(rows).toHaveLength(3);
    const sha = createHash('sha256').update(tagged).digest('hex');
    for (const row of rows) {
      expect(row.status).toBe('ready');
      expect(row.sha256).toBe(sha);
      expect(Math.abs(row.duration_ms! - MP3_48K_SECONDS * 1000)).toBeLessThan(100);
    }
  });

  it('fails a run with no answer after 10 minutes, taking nothing; an answer already there when we look still lands', async () => {
    let now = new Date('2026-11-20T12:00:00.000Z');
    const deps = studioDeps(f.sql, { env: env(), provider: scripted as never, now: () => now });
    const late = await create(deps);
    await advance(deps, late);
    expect((await job(late)).status).toBe('running');
    await f.sql.query("update brand_studio_jobs set started_at = $2 where id = $1", [late, now.toISOString()]);
    now = new Date(now.getTime() + 9 * 60_000);
    await advance(deps, late);
    expect((await job(late)).status).toBe('running');
    now = new Date(now.getTime() + 2 * 60_000);
    await advance(deps, late);
    expect(await job(late)).toMatchObject({ status: 'failed', usage_krw: 0 });

    const onTime = await create(deps);
    await advance(deps, onTime);
    await f.sql.query("update brand_studio_jobs set started_at = $2 where id = $1", [onTime, new Date(now.getTime() - 11 * 60_000).toISOString()]);
    script.status = { state: 'succeeded', costUsd: 0.1, outputs: [{ url: 'https://files.example/a.mp3', mime: 'audio/mpeg' }] };
    await advance(deps, onTime);
    expect(await job(onTime)).toMatchObject({ status: 'succeeded', usage_krw: 16 * STUDIO_CREDIT_KRW });
  });
});
