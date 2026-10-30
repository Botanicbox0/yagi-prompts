import { describe, expect, it, vi } from 'vitest';
import { pollVideoRender, startVideoRender, type RenderEngineDeps } from '@/lib/renders/engines';
import { VIDEO_ENGINE_IDS } from '@/lib/images/engines';
import { SunraError, type SunraClient, type SunraTask } from '@/lib/sunra/client';
import type { ArkClient } from '@/lib/ark/client';

function fakeSunra(task?: Partial<SunraTask>) {
  const submit = vi.fn(async () => ({ id: 'pd_1' }));
  const client: SunraClient = {
    submit,
    getTask: vi.fn(async () => ({ id: 'pd_1', status: 'COMPLETED', success: true, url: 'https://cdn.example/v.mp4', billedUsd: 0.7, errorCode: null, errorMessage: null, errorRetryable: null, ...task }) as SunraTask),
  };
  return { client, submit };
}

function fakeArk() {
  const createVideoTask = vi.fn(async () => ({ id: 'cgt-1' }));
  return { client: { createVideoTask, getVideoTask: vi.fn() } as unknown as ArkClient, createVideoTask };
}

const base = { engine: 'seedance-2.0' as const, prompt: 'a dancer', aspect: '9:16' as const, seconds: 5, photo: null };
const photo = { bytes: new Uint8Array([1]), mime: 'image/jpeg' as const };

function deps(sunra: SunraClient, ark: ArkClient, backup: boolean): RenderEngineDeps {
  return { sunra, ark, sunraBackup: backup };
}

describe('Sunra backup routing', () => {
  it('stays on ModelArk while the flag is off', async () => {
    const sunra = fakeSunra(); const ark = fakeArk();
    const started = await startVideoRender(base, deps(sunra.client, ark.client, false));
    expect(started.provider).toBe('modelark');
    expect(sunra.submit).not.toHaveBeenCalled();
  });

  it('is off by default when nothing configures it', async () => {
    const sunra = fakeSunra(); const ark = fakeArk();
    await startVideoRender(base, { sunra: sunra.client, ark: ark.client });
    expect(sunra.submit).not.toHaveBeenCalled();
  });

  it('sends a person-free text job to Sunra when the flag is on', async () => {
    const sunra = fakeSunra(); const ark = fakeArk();
    const started = await startVideoRender(base, deps(sunra.client, ark.client, true));
    expect(started).toMatchObject({ provider: 'sunra', taskId: 'sunra:pd_1', model: 'seedance-2.0' });
    expect(sunra.submit).toHaveBeenCalledWith('bytedance/seedance-2.0/text-to-video', { prompt: 'a dancer', resolution: '720p', ratio: '9:16', duration: 5, generate_audio: true });
    expect(ark.createVideoTask).not.toHaveBeenCalled();
  });

  it.each([
    ['photo bytes', { photo }],
    ['a verified asset', { assetId: 'asset-1' }],
    ['fixed references', { fixedReferenceUrls: ['https://x/a.jpg'] }],
    ['recipe references', { references: [{ type: 'image' as const, url: 'https://x/a.jpg' }] }],
  ])('never sends a job with %s to Sunra, even with the flag on', async (_name, extra) => {
    const sunra = fakeSunra(); const ark = fakeArk();
    const started = await startVideoRender({ ...base, ...extra }, deps(sunra.client, ark.client, true));
    expect(started.provider).toBe('modelark');
    expect(sunra.submit).not.toHaveBeenCalled();
  });

  it('adds no engine id a maker or a template could name', () => {
    expect(VIDEO_ENGINE_IDS).toEqual(['seedance-2.0', 'seedance-2.5', 'kling-omni']);
  });

  it('does not fall back by itself when Sunra refuses', async () => {
    const sunra = fakeSunra(); const ark = fakeArk();
    sunra.submit.mockRejectedValueOnce(new SunraError('INSUFFICIENT_CREDIT', 'no balance', 412, false));
    await expect(startVideoRender(base, deps(sunra.client, ark.client, true))).rejects.toMatchObject({ code: 'engine_access', retryable: false });
    expect(ark.createVideoTask).not.toHaveBeenCalled();
  });

  it('fails no_engine_key when the flag is on without a key', async () => {
    const ark = fakeArk();
    await expect(startVideoRender(base, { sunra: null, ark: ark.client, sunraBackup: true })).rejects.toMatchObject({ code: 'no_engine_key' });
  });
});

describe('Sunra poll', () => {
  const args = { taskId: 'sunra:pd_1', model: 'seedance-2.0' as const, seconds: 5, resolution: '720p' as const, aspect: '9:16' };
  const download = (async () => new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'video/mp4' } })) as typeof fetch;

  it('downloads the film and books the billed amount', async () => {
    const polled = await pollVideoRender(args, { sunra: fakeSunra().client, fetch: download });
    expect(polled).toMatchObject({ status: 'succeeded', output: { provider: 'sunra', costUsd: 0.7, costSource: 'provider_usage' } });
  });

  it('falls back to the list estimate when no units are reported', async () => {
    const polled = await pollVideoRender(args, { sunra: fakeSunra({ billedUsd: null }).client, fetch: download });
    expect(polled).toMatchObject({ status: 'succeeded', output: { costSource: 'estimate' } });
  });

  it('is pending while running', async () => {
    const polled = await pollVideoRender(args, { sunra: fakeSunra({ status: 'IN_PROGRESS', success: null, url: null }).client });
    expect(polled.status).toBe('pending');
  });

  it('reports a moderated failure', async () => {
    const polled = await pollVideoRender(args, { sunra: fakeSunra({ success: false, url: null, errorCode: 'unsafe_content', errorMessage: 'unsafe', errorRetryable: false }).client });
    expect(polled).toMatchObject({ status: 'failed', failure: { code: 'moderated', retryable: false } });
  });

  it('polls Sunra by the task id even when the backup flag has since gone off', async () => {
    const sunra = fakeSunra();
    await pollVideoRender(args, { sunra: sunra.client, sunraBackup: false, fetch: download });
    expect(sunra.client.getTask).toHaveBeenCalledWith('pd_1');
  });
});
