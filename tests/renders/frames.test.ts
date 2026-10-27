import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GptImageResult, OpenAiImageClient } from '@/lib/images/openai';
import { insertPrompt } from '@/lib/prompts/repo';
import { loadRenderJob, type RenderJob } from '@/lib/renders/repo';
import { createRenderJob, runRenderPass, type RenderPassDeps } from '@/lib/renders/service';
import { createLocalRenderStore, type RenderStore } from '@/lib/renders/store';
import { loadRenderFrames, renderFilename } from '@/lib/renders/frames';
import type { RenderNotifyInput } from '@/lib/renders/notify';
import { renderFrameParam, renderMediaHref } from '@/lib/renders/share';
import { parseRecipe } from '@/lib/recipes/schema';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { ADMIN_VIEWER } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';

/**
 * A set render's pictures through the gateway (lib/renders/frames.ts, `GET /api/renders/media/{id}?frame=N`):
 * every frame, in order, behind the same door as the result — the token that opens frame 1 opens
 * frames 2…N of that render and nothing else. Engines faked; real render pass on PGlite.
 */

const gateway = vi.hoisted(() => ({ sql: null as SqlRunner | null, store: null as RenderStore | null }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => gateway.sql }));
vi.mock('@/lib/renders/store', async (orig) => ({ ...(await orig<typeof import('@/lib/renders/store')>()), getRenderStore: async () => gateway.store }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => ({ userId: null, email: null, isAdmin: false, tier: 'anon', locale: 'ko' }) }));

import { GET } from '@/app/api/renders/media/[id]/route';

const PHOTO = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), mime: 'image/jpeg' };
const NOW = new Date('2026-10-28T12:00:00.000Z');
const frameBytes = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xdb, n, n, n]);

function fakeOpenAi(): OpenAiImageClient {
  let call = 0;
  const answer = async (): Promise<GptImageResult> => {
    call += 1;
    return { b64: Buffer.from(frameBytes(call)).toString('base64'), outputFormat: 'jpeg', size: '1024x1280', quality: 'high', usage: null, usd: 0.19 };
  };
  return { generate: answer, edit: answer } as unknown as OpenAiImageClient;
}

describe('a set render through the gateway', () => {
  let h: PromptHarness, root: string, store: RenderStore;
  beforeEach(async () => {
    h = await promptHarness();
    root = await mkdtemp(join(tmpdir(), 'twings-frames-'));
    store = createLocalRenderStore(root);
    gateway.sql = h.sql;
    gateway.store = store;
  });
  afterEach(async () => { await h.close(); await rm(root, { recursive: true, force: true }); });

  async function finished(frames: number, notifier: RenderPassDeps['notifier'] = null): Promise<RenderJob> {
    const raw = {
      version: 2, slots: { selfie: { kind: 'image', source: 'user', required: true } },
      steps: Array.from({ length: frames }, (_, i) => ({ id: `f${i + 1}`, kind: 'image', engine: 'gpt-image-2', inputs: ['selfie'], prompt: `Frame ${i + 1} of {{selfie}} by a window.`, params: { aspect: '4:5' } })),
      output: frames > 1 ? { frames: Array.from({ length: frames }, (_, i) => `f${i + 1}`) } : { from: 'f1' },
    };
    const checked = parseRecipe(raw);
    if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
    const id = randomUUID(), slug = `set-${id.slice(0, 8)}`;
    await insertPrompt(h.sql, { id, slug, source: 'yagi', authorId: null, authorHandle: null, status: 'published', publishedAt: 'now', models: ['gpt-image-2'], title: 'Set', titleKo: null, promptText: 'legacy', textVisibility: 'hidden', media: null, useCase: [], featured: false, medium: 'image', engine: 'gpt-image-2', aspectDefault: '4:5', runtimeSeconds: null, priceCents: 500, priceKrw: 6900 });
    await h.sql.query('update prompt_items set recipe=$2::jsonb where id=$1', [id, JSON.stringify(checked.recipe)]);
    const created = await createRenderJob({ sql: h.sql, store, mode: 'virtual' }, ADMIN_VIEWER, { templateSlug: slug, aspect: '4:5', photo: PHOTO, locale: 'ko' });
    if (!created.ok) throw new Error(created.code);
    const deps: RenderPassDeps = { sql: h.sql, store, now: NOW, mode: 'virtual', engines: { openai: fakeOpenAi() }, notifier, siteUrl: 'https://twings.test' };
    expect((await runRenderPass(deps, { jobId: created.id })).succeeded).toBe(1);
    return (await loadRenderJob(h.sql, created.id))!;
  }

  const get = (id: string, query: string) => GET(new Request(`https://twings.test/api/renders/media/${id}?${query}`), { params: Promise.resolve({ id }) });

  it('lists every frame in order, behind the token it was asked with', async () => {
    const job = await finished(3);
    const frames = await loadRenderFrames(h.sql, job, job.shareToken!);
    expect(frames.map((f) => f.frame)).toEqual([1, 2, 3]);
    expect(frames[1]).toEqual({
      frame: 2,
      view: renderMediaHref(job.id, { share: job.shareToken!, frame: 2 }),
      download: renderMediaHref(job.id, { share: job.shareToken!, frame: 2, download: true }),
      filename: renderFilename(job, 'image/jpeg', 2),
    });
    expect(frames[1]!.filename).toMatch(new RegExp(`^twings-${job.templateSlug}-${job.id.slice(0, 8)}-2\\.jpg$`));
    // One result is not a set; a film is not a set.
    expect(await loadRenderFrames(h.sql, await finished(1), 'x')).toEqual([]);
    expect(await loadRenderFrames(h.sql, { ...job, resultMime: 'video/mp4' }, 'x')).toEqual([]);
  });

  it('serves the Nth picture with the share token, as an attachment when asked, and refuses what is not there', async () => {
    const job = await finished(3);
    const token = job.shareToken!;
    for (const n of [1, 2, 3]) {
      const response = await get(job.id, `s=${token}&frame=${n}`);
      expect(response.status, `frame ${n}`).toBe(200);
      expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(Array.from(frameBytes(n)));
    }
    const download = await get(job.id, `s=${token}&frame=3&download=1`);
    expect(download.headers.get('content-disposition')).toContain(`twings-${job.templateSlug}-${job.id.slice(0, 8)}-3.jpg`);
    expect(download.headers.get('cache-control')).toBe('private, no-store');

    expect((await get(job.id, `s=${token}&frame=4`)).status).toBe(404);
    expect((await get(job.id, `s=${token}&frame=0`)).status).toBe(404);
    expect((await get(job.id, `s=${token}&frame=2&poster=1`)).status).toBe(404);
    // The token names one render: another render's token opens none of this one's frames.
    const other = await finished(2);
    expect((await get(job.id, `s=${other.shareToken}&frame=2`)).status).toBe(404);
    // No token, no session: nothing.
    expect((await get(job.id, 'frame=2')).status).toBe(401);
  });

  it('hands the completion message every frame, behind the link it carries', async () => {
    const sent: RenderNotifyInput[] = [];
    const notifier = { channel: 'email', kind: 'fake', async send(input: RenderNotifyInput) { sent.push(input); return { ok: true as const, id: 'm1' }; } } as unknown as RenderPassDeps['notifier'];
    const job = await finished(3, notifier);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.frames?.map((f) => f.view)).toEqual([1, 2, 3].map((frame) => renderMediaHref(job.id, { share: job.shareToken!, frame })));
  });

  it('reads ?frame= strictly', () => {
    expect(renderFrameParam(null)).toBeNull();
    expect(renderFrameParam('1')).toBe(1);
    expect(renderFrameParam('6')).toBe(6);
    for (const bad of ['0', '7', '01', '2.0', '', 'x', '-1']) expect(renderFrameParam(bad), bad).toBe('invalid');
    expect(renderMediaHref('r', { share: 't', frame: 2, download: true })).toBe('/api/renders/media/r?s=t&frame=2&download=1');
    expect(renderMediaHref('r')).toBe('/api/renders/media/r');
  });
});
