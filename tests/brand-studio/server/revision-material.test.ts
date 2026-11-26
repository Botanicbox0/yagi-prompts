import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { enhancePrompt, type EnhanceInput } from '@/lib/brand-studio/enhancer';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { prepareJob } from '@/lib/brand-studio/prepare';
import { MATERIAL_NOTES_MAX, cleanMaterialNotes, readMaterial } from '@/lib/brand-studio/revision/material';
import type { JobRow } from '@/lib/brand-studio/types';
import { ENV, input, mockGemini, sentBody, writerJson, writerParts } from '../intel/helpers';
import { fakeIntel, requestId, seedImageAsset, seedVideoAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';
import { seedRun } from './revision-helpers';

/**
 * Material attached to a revision (lib/brand-studio/revision/material.ts): videos the customer attaches to
 * show what they mean. They are read into notes for the prompt writer and never sent to the video model.
 */
let f: StudioFixture;
beforeEach(async () => {
  f = await studioFixture();
});
afterEach(async () => {
  await f.db.close();
});

const revise = (outputId: string, over: Record<string, unknown> = {}) => ({
  kind: 'video_revise', organizationId: f.orgId, requestId: requestId(), outputId, mode: 'edit', prompt: '제형이 더 걸쭉하게 흐르게', references: [], ...over,
});
const row = async (id: string) => (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [id])).rows[0]!;

describe('job.create video_revise with material', () => {
  it('keeps the material apart from the references: stored on the revision, absent from what the model gets', async () => {
    const deps = studioDeps(f.sql);
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a serum drop falls', seconds: 6 });
    const texture = await seedVideoAsset(deps, f.orgId, f.ids.owner);
    const logo = await seedImageAsset(deps, f.orgId, f.ids.owner, { role: 'logo' });

    const made = await createStudioJob(deps, viewerOf(f.ids.editor), revise(root.outputId, { references: [{ assetId: logo }], materials: [{ assetId: texture }] }));
    if (!made.ok) throw new Error(JSON.stringify(made));
    const stored = await row(made.job.id);
    expect(stored.refs).toEqual([{ outputId: root.outputId }, { assetId: logo }]);
    expect(stored.params.revision).toMatchObject({ version: 2, mode: 'edit', added: 1, materials: [{ assetId: texture }] });
    expect(made.job.revision).toMatchObject({ version: 2, added: 1, materials: [{ assetId: texture }] });
  });

  it('works for a reshoot too, and a revision without material stores none', async () => {
    const deps = studioDeps(f.sql);
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a serum drop falls', seconds: 6 });
    const texture = await seedVideoAsset(deps, f.orgId, f.ids.owner);
    const again = await createStudioJob(deps, viewerOf(f.ids.owner), revise(root.outputId, { mode: 'reshoot', materials: [{ assetId: texture }] }));
    if (!again.ok) throw new Error(JSON.stringify(again));
    expect((await row(again.job.id)).params.revision).toMatchObject({ mode: 'reshoot', materials: [{ assetId: texture }] });

    const plain = await createStudioJob(deps, viewerOf(f.ids.owner), revise(root.outputId));
    if (!plain.ok) throw new Error(JSON.stringify(plain));
    expect((await row(plain.job.id)).params.revision).not.toHaveProperty('materials');
    expect(plain.job.revision).not.toHaveProperty('materials');
  });

  it('refuses a picture as material, a file that is gone, and more than two', async () => {
    const deps = studioDeps(f.sql);
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a serum drop falls', seconds: 6 });
    const picture = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const videos = await Promise.all([1, 2, 3].map(() => seedVideoAsset(deps, f.orgId, f.ids.owner)));
    const send = (materials: unknown) => createStudioJob(deps, viewerOf(f.ids.owner), revise(root.outputId, { materials }));

    expect(await send([{ assetId: picture }])).toEqual({ ok: false, code: 'invalid' });
    expect(await send([{ assetId: '00000000-0000-4000-8000-000000000000' }])).toEqual({ ok: false, code: 'reference_missing' });
    expect(await send(videos.map((assetId) => ({ assetId })))).toEqual({ ok: false, code: 'invalid' });
    expect(await send([{ assetId: videos[0], frame: 'start' }])).toEqual({ ok: false, code: 'invalid' });
  });
});

describe('prepareJob reads the material for the prompt writer', () => {
  function recording(read: ((request: string, madeWith: string) => Promise<string | null>) | null) {
    const seen: EnhanceInput[] = [];
    const reads: Array<{ request: string; madeWith: string; bytes: number }> = [];
    const intel = fakeIntel();
    const deps = studioDeps(f.sql, {
      intel: {
        ...intel,
        async enhancePrompt(i) {
          seen.push(i as EnhanceInput);
          return intel.enhancePrompt(i, { fetch, env: {} });
        },
        ...(read
          ? {
              async readMaterial(i: { video: { bytes: Uint8Array; mime: string } | { url: string }; request: string; madeWith: string }) {
                reads.push({ request: i.request, madeWith: i.madeWith, bytes: 'bytes' in i.video ? i.video.bytes.byteLength : -1 });
                return read(i.request, i.madeWith);
              },
            }
          : {}),
      },
    });
    return { deps, seen, reads };
  }
  const made = async (deps: ReturnType<typeof studioDeps>, materials: number) => {
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a serum', finalPrompt: 'A serum drop falls onto skin.' });
    const videos = await Promise.all(Array.from({ length: materials }, () => seedVideoAsset(deps, f.orgId, f.ids.owner)));
    const result = await createStudioJob(deps, viewerOf(f.ids.owner), revise(root.outputId, { materials: videos.map((assetId) => ({ assetId })) }));
    if (!result.ok) throw new Error(JSON.stringify(result));
    return row(result.job.id);
  };

  it('hands over one note per video, numbered, with the request and the earlier prompt as context', async () => {
    const { deps, seen, reads } = recording(async () => 'The serum is thick and honey-like; it stretches into a thread before it drops.');
    await prepareJob(deps, await made(deps, 2));
    expect(reads).toEqual([
      { request: '제형이 더 걸쭉하게 흐르게', madeWith: 'A serum drop falls onto skin.', bytes: 12 },
      { request: '제형이 더 걸쭉하게 흐르게', madeWith: 'A serum drop falls onto skin.', bytes: 12 },
    ]);
    expect(seen[0]!.revision).toMatchObject({
      mode: 'edit',
      materials: [
        { n: 1, kind: 'video', notes: 'The serum is thick and honey-like; it stretches into a thread before it drops.' },
        { n: 2, kind: 'video', notes: 'The serum is thick and honey-like; it stretches into a thread before it drops.' },
      ],
    });
    // The material is not a reference: the model still gets the clip alone.
    expect(seen[0]!.references.map((r) => r.kind)).toEqual(['video']);
  });

  it('goes on without notes when the material cannot be read, was deleted, or no reader is wired', async () => {
    const unread = recording(async () => null);
    await prepareJob(unread.deps, await made(unread.deps, 1));
    expect(unread.seen[0]!.revision).not.toHaveProperty('materials');

    const failing = recording(async () => {
      throw new Error('boom');
    });
    await prepareJob(failing.deps, await made(failing.deps, 1));
    expect(failing.seen[0]!.revision).not.toHaveProperty('materials');

    const gone = recording(async () => 'notes');
    const job = await made(gone.deps, 1);
    await f.sql.query("update brand_studio_assets set deleted_at = now() where kind = 'video' and organization_id = $1", [f.orgId]);
    await prepareJob(gone.deps, job);
    expect(gone.reads).toEqual([]);
    expect(gone.seen[0]!.revision).not.toHaveProperty('materials');

    const none = recording(null);
    await prepareJob(none.deps, await made(none.deps, 1));
    expect(none.seen[0]!.revision).not.toHaveProperty('materials');
  });
});

describe('the prompt writer with material notes', () => {
  const base = (over: Partial<EnhanceInput> = {}): EnhanceInput =>
    input({
      kind: 'video_remix',
      profile: 'seedance',
      prompt: '제형이 더 걸쭉하게 흐르게',
      references: [{ index: 1, kind: 'video', label: '영상 1' }],
      video: { seconds: null, aspect: 'adaptive', audio: 'native', method: 'edit', keep: [], change: '', sheet: null },
      revision: { mode: 'edit', version: 2, madeWith: 'A serum drop falls onto skin.', history: [] },
      ...over,
    });

  it('gets the notes in the request and a rule that keeps the material itself out of the prompt', async () => {
    const fetchMock = mockGemini({ prompt: 'In @Video1, change only the serum so it is thick and honey-like; everything else stays as it is.', notes: '제형만 바꿨어요.' });
    const materials = [{ n: 1, kind: 'video' as const, notes: 'Thick, honey-like, stretches into a thread.' }];
    await enhancePrompt(base({ revision: { mode: 'edit', version: 2, madeWith: 'A serum drop falls onto skin.', history: [], materials } }), { fetch: fetchMock as unknown as typeof fetch, env: ENV });
    const body = sentBody(fetchMock);
    const system = body.systemInstruction.parts[0]!.text;
    expect(system).toContain('"revision.materials" are notes on videos the customer attached');
    expect(system).toContain('never write a token for one');
    expect(writerJson(writerParts(body)[0]!.text as string).revision.materials).toEqual(materials);
  });

  it('says nothing about material when there is none', async () => {
    const fetchMock = mockGemini({ prompt: 'In @Video1, change only the serum; everything else stays as it is.', notes: 'ok' });
    await enhancePrompt(base(), { fetch: fetchMock as unknown as typeof fetch, env: ENV });
    const body = sentBody(fetchMock);
    expect(body.systemInstruction.parts[0]!.text).not.toContain('revision.materials');
    expect(writerJson(writerParts(body)[0]!.text as string).revision).not.toHaveProperty('materials');
  });
});

describe('readMaterial', () => {
  const video = { bytes: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]), mime: 'video/mp4' };

  it('sends the video with the request and the earlier prompt, and returns the notes trimmed', async () => {
    const fetchMock = mockGemini({ notes: '  The serum is thick.\n It stretches into a thread before it drops.  ' });
    const notes = await readMaterial({ video, request: '제형이 더 걸쭉하게', madeWith: 'A serum drop falls.' }, { fetch: fetchMock as unknown as typeof fetch, env: ENV });
    expect(notes).toBe('The serum is thick. It stretches into a thread before it drops.');
    const body = sentBody(fetchMock);
    expect(body.systemInstruction.parts[0]!.text).toContain('the video model will not receive it');
    const parts = body.contents[0]!.parts as Array<Record<string, unknown>>;
    expect(parts[0]).toHaveProperty('inlineData');
    expect(JSON.parse(parts[1]!.text as string)).toEqual({ request: '제형이 더 걸쭉하게', madeWith: 'A serum drop falls.' });
  });

  it('returns null without a key, without a request, for an empty file or when the call fails', async () => {
    const ok = mockGemini({ notes: 'The serum is thick and slow.' });
    expect(await readMaterial({ video, request: 'x', madeWith: '' }, { fetch: ok as unknown as typeof fetch, env: {} })).toBeNull();
    expect(await readMaterial({ video, request: '  ', madeWith: '' }, { fetch: ok as unknown as typeof fetch, env: ENV })).toBeNull();
    expect(await readMaterial({ video: { bytes: new Uint8Array(), mime: 'video/mp4' }, request: 'x', madeWith: '' }, { fetch: ok as unknown as typeof fetch, env: ENV })).toBeNull();
    const failing = mockGemini(() => new Response('no', { status: 500 }));
    expect(await readMaterial({ video, request: 'x', madeWith: '' }, { fetch: failing as unknown as typeof fetch, env: ENV })).toBeNull();
  });

  it('keeps notes short and drops an empty answer', () => {
    expect(cleanMaterialNotes({ notes: 'a'.repeat(2000) })).toHaveLength(MATERIAL_NOTES_MAX);
    expect(cleanMaterialNotes({ notes: 'ok' })).toBeNull();
    expect(cleanMaterialNotes({})).toBeNull();
    expect(cleanMaterialNotes(null)).toBeNull();
  });
});
