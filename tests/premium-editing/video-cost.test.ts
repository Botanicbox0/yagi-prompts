import { describe, expect, it } from 'vitest';
import type { ArkClient, ArkTask } from '@/lib/ark/client';
import { pollVideoRender } from '@/lib/renders/engines';
import { quoteArkVideo } from '@/lib/ark/pricing';

const task = (completionTokens: number | null): ArkTask => ({ id: 'task', model: 'dreamina-seedance-2-5-260628', status: 'succeeded', videoUrl: 'https://provider.test/output.mp4', error: null, completionTokens, createdAt: null, updatedAt: null });
const deps = (completionTokens: number | null) => ({ ark: { async getVideoTask() { return task(completionTokens); } } as unknown as ArkClient, fetch: async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'video/mp4' } }) });

describe('video cost telemetry', () => {
  it('books the actual provider completion tokens at the official resolution rate', async () => {
    const output = await pollVideoRender({ taskId: 'task', model: 'seedance-2.5', seconds: 10, resolution: '720p', aspect: '4:3' }, deps(123456));
    expect(output.status).toBe('succeeded');
    if (output.status !== 'succeeded') return;
    expect(output.output).toMatchObject({ completionTokens: 123456, costSource: 'provider_usage' });
    expect(output.output.costUsd).toBeCloseTo(123456 * 10.7 / 1_000_000, 10);
  });
  it('labels a missing counter as an estimate using the actual aspect', async () => {
    const output = await pollVideoRender({ taskId: 'task', model: 'seedance-2.5', seconds: 10, resolution: '720p', aspect: '4:3' }, deps(null));
    if (output.status !== 'succeeded') throw Error('missing output');
    expect(output.output).toMatchObject({ completionTokens: null, costSource: 'estimate' });
    expect(output.output.costUsd).toBe(quoteArkVideo({ model: 'seedance-2.5', seconds: 10, resolution: '720p', aspect: '4:3' })!.providerUsd);
  });
  it('keeps legacy 480p polling functional without inventing an unverified tariff', async () => {
    const output = await pollVideoRender({ taskId: 'task', model: 'seedance-2.0-mini', seconds: 10, resolution: '480p', aspect: '4:3' }, deps(123456));
    if (output.status !== 'succeeded') throw Error('missing output');
    expect(output.output).toMatchObject({ completionTokens: 123456, costUsd: null });
    expect(output.output.costSource).toBeUndefined();
  });
});
