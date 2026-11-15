import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { studioModel, type StudioVideoModel } from '@/lib/brand-studio/models';
import type { JobRow } from '@/lib/brand-studio/types';
import { remixRunUsd, usageKrw, videoRunUsd } from '@/lib/brand-studio/usage-rate';
import { requestId, seedImageAsset, seedVideoAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';
import { seedFinal, seedRevision, seedRun } from './revision-helpers';

let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;
beforeEach(async () => {
  f = await studioFixture();
  deps = studioDeps(f.sql);
});
afterEach(async () => {
  await f.db.close();
});

const seedance = studioModel('seedance-2.5') as StudioVideoModel;
const revise = (outputId: string, over: Record<string, unknown> = {}) => ({
  kind: 'video_revise', organizationId: f.orgId, requestId: requestId(), outputId, mode: 'edit', prompt: '병을 파란색으로', references: [], ...over,
});
const row = async (id: string) => (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [id])).rows[0]!;

describe('job.create video_revise: edit', () => {
  it('sends the clip back as the reference video with the edit task, and numbers the versions', async () => {
    const product = await seedImageAsset(deps, f.orgId, f.ids.owner, { role: 'product' });
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle turns', params: { audio: 'ambient', resolution: '720p' }, seconds: 6 });
    const logo = await seedImageAsset(deps, f.orgId, f.ids.owner, { role: 'logo' });

    const first = await createStudioJob(deps, viewerOf(f.ids.editor), revise(root.outputId, { prompt: '이미지 1의 로고를 병에', references: [{ assetId: logo, role: 'logo' }] }));
    if (!first.ok) throw new Error(JSON.stringify(first));
    const stored = await row(first.job.id);
    expect(stored).toMatchObject({ kind: 'video_remix', model: 'seedance-2.5', enhance: true, prompt: '이미지 1의 로고를 병에', parent_output_id: root.outputId });
    expect(stored.refs).toEqual([{ outputId: root.outputId }, { assetId: logo, role: 'logo' }]);
    expect(stored.params).toMatchObject({
      method: 'edit', aspect: null, seconds: null, resolution: '720p', audio: 'ambient', keep: [], change: '', referenceVideoSeconds: 6,
      revision: { rootJobId: root.jobId, version: 2, baseJobId: root.jobId, baseOutputId: root.outputId, mode: 'edit', added: 1 },
    });
    const usd = remixRunUsd({ model: seedance, resolution: '720p', method: 'edit', seconds: null, referenceSeconds: 6 }).usd;
    expect(first.job.estimateKrw).toBe(usageKrw(usd, 'video'));
    expect(first.job.revision).toEqual({ rootJobId: root.jobId, version: 2, baseOutputId: root.outputId, mode: 'edit', added: 1 });
    expect(first.job).toMatchObject({ kind: 'video_remix', method: 'edit' });

    // Another revision of the same clip, made right after: the next number, never the same one.
    const second = await createStudioJob(deps, viewerOf(f.ids.owner), revise(root.outputId, { prompt: '배경을 회색으로' }));
    expect(second).toMatchObject({ ok: true, job: { revision: { version: 3, mode: 'edit', added: 0 } } });
    void product;
  });

  it('gives two concurrent revisions of one clip different version numbers', async () => {
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle turns' });
    const [a, b] = await Promise.all([
      createStudioJob(deps, viewerOf(f.ids.owner), revise(root.outputId)),
      createStudioJob(deps, viewerOf(f.ids.editor), revise(root.outputId, { prompt: 'grey sky' })),
    ]);
    if (!a.ok || !b.ok) throw new Error();
    expect([a.job.revision?.version, b.job.revision?.version].sort()).toEqual([2, 3]);
  });

  it('is idempotent on the request id although the stored kind differs from the request', async () => {
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle turns' });
    const input = revise(root.outputId);
    const first = await createStudioJob(deps, viewerOf(f.ids.owner), input);
    const again = await createStudioJob(deps, viewerOf(f.ids.owner), input);
    expect(first.ok && again.ok && first.job.id === again.job.id).toBe(true);
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), { ...input, kind: 'video', model: 'seedance-2.5', aspect: '9:16', resolution: '720p', seconds: 5, prompt: 'x' })).toEqual({ ok: false, code: 'conflict' });
  });

  it('edits a 1080p final at 1080p and keeps a draft a draft', async () => {
    const draft = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle', params: { resolution: 'draft' }, isDraft: true });
    const final = await seedFinal(deps, f.orgId, f.ids.owner, draft);
    const ofFinal = await createStudioJob(deps, viewerOf(f.ids.owner), revise(final.outputId));
    if (!ofFinal.ok) throw new Error(JSON.stringify(ofFinal));
    const stored = await row(ofFinal.job.id);
    expect(stored.params).toMatchObject({ resolution: '1080p', revision: { baseJobId: draft.jobId, baseOutputId: final.outputId, version: 2 } });
    expect(stored.parent_output_id).toBe(final.outputId);

    const ofDraft = await createStudioJob(deps, viewerOf(f.ids.owner), revise(draft.outputId));
    if (!ofDraft.ok) throw new Error();
    expect((await row(ofDraft.job.id)).params.resolution).toBe('draft');
    expect((await f.sql.query('select is_draft from brand_studio_outputs where job_id = $1', [ofDraft.job.id])).rows[0]).toEqual({ is_draft: true });
  });

  it('refuses a clip shorter than the edit minimum, bad added pictures, and results that are not this organization\'s videos', async () => {
    const short = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'short', seconds: 3 });
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), revise(short.outputId))).toEqual({ ok: false, code: 'invalid' });

    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle' });
    const clip = await seedVideoAsset(deps, f.orgId, f.ids.owner, 6);
    const pic = await seedImageAsset(deps, f.orgId, f.ids.owner);
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), revise(root.outputId, { references: [{ assetId: clip }] }))).toEqual({ ok: false, code: 'invalid' });
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), revise(root.outputId, { references: [{ assetId: pic, frame: 'start' }] }))).toEqual({ ok: false, code: 'invalid' });
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), revise(root.outputId, { references: [{ assetId: randomUUID() }] }))).toEqual({ ok: false, code: 'invalid' });
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), revise(root.outputId, { prompt: '이미지 2를 병에', references: [{ assetId: pic }] }))).toEqual({ ok: false, code: 'reference_missing' });

    const still = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image', prompt: 'a still' });
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), revise(still.outputId))).toEqual({ ok: false, code: 'not_found' });
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), revise(randomUUID()))).toEqual({ ok: false, code: 'not_found' });
    expect(await createStudioJob(deps, viewerOf(f.ids.viewer), revise(root.outputId))).toEqual({ ok: false, code: 'forbidden' });
  });
});

describe('job.create video_revise: reshoot', () => {
  it('runs the recipe again with its refs, the earlier pictures and the new ones', async () => {
    const product = await seedImageAsset(deps, f.orgId, f.ids.owner, { role: 'product' });
    const logo = await seedImageAsset(deps, f.orgId, f.ids.owner, { role: 'logo' });
    const label = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const fresh = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const root = await seedRun(deps, f.orgId, f.ids.owner, {
      prompt: '향수병', finalPrompt: '@Image1 turns.', refs: [{ assetId: product, role: 'product' }],
      params: { aspect: '9:16', resolution: '1080p', seconds: 8, audio: 'silent' },
    });
    const v2 = await seedRevision(deps, f.orgId, f.ids.owner, { base: root, rootJobId: root.jobId, version: 2, mode: 'edit', request: 'logo', added: [{ assetId: logo }] });
    const v3 = await seedRevision(deps, f.orgId, f.ids.owner, { base: v2, rootJobId: root.jobId, version: 3, mode: 'edit', request: 'label', added: [{ assetId: label }, { assetId: logo }] });

    const made = await createStudioJob(deps, viewerOf(f.ids.owner), revise(v3.outputId, { mode: 'reshoot', prompt: '카메라를 왼쪽으로, 이미지 1 추가', references: [{ assetId: fresh }, { assetId: logo }] }));
    if (!made.ok) throw new Error(JSON.stringify(made));
    const stored = await row(made.job.id);
    expect(stored.kind).toBe('video');
    expect(stored.refs).toEqual([{ assetId: product, role: 'product' }, { assetId: logo }, { assetId: label }, { assetId: fresh }]);
    expect(stored.params).toMatchObject({
      aspect: '9:16', resolution: '1080p', seconds: 8, audio: 'silent',
      revision: { rootJobId: root.jobId, version: 4, baseJobId: v3.jobId, baseOutputId: v3.outputId, mode: 'reshoot', added: 1 },
    });
    expect(stored).toMatchObject({ enhance: true, prompt: '카메라를 왼쪽으로, 이미지 1 추가', parent_output_id: v3.outputId });
    expect(made.job.estimateKrw).toBe(usageKrw(videoRunUsd({ resolution: '1080p', seconds: 8 }), 'video'));
  });

  it('copies a remix recipe: method, keep, change, shots and the reference video', async () => {
    const film = await seedVideoAsset(deps, f.orgId, f.ids.owner, 8);
    const shots = [{ start: 0, end: 4, framing: 'wide', camera: 'push in', action: 'walks' }, { start: 4, end: 8, framing: 'close', camera: 'locked', action: 'smiles' }];
    const root = await seedRun(deps, f.orgId, f.ids.owner, {
      kind: 'video_remix', prompt: 'swap the bottle', refs: [{ assetId: film }],
      params: { method: 'reference', keep: ['camera', 'timing'], change: 'a blue bottle', shots, referenceVideoSeconds: 8, seconds: 8 },
    });
    const made = await createStudioJob(deps, viewerOf(f.ids.owner), revise(root.outputId, { mode: 'reshoot', prompt: 'slower' }));
    if (!made.ok) throw new Error(JSON.stringify(made));
    const stored = await row(made.job.id);
    expect(stored.kind).toBe('video_remix');
    expect(stored.refs).toEqual([{ assetId: film }]);
    expect(stored.params).toMatchObject({ method: 'reference', keep: ['camera', 'timing'], change: 'a blue bottle', shots, referenceVideoSeconds: 8, seconds: 8, revision: { mode: 'reshoot', version: 2, added: 0 } });
    const usd = remixRunUsd({ model: seedance, resolution: '720p', method: 'reference', seconds: 8, referenceSeconds: 8 }).usd;
    expect(made.job.estimateKrw).toBe(usageKrw(usd, 'video'));
  });

  it('is reference_missing when a recipe reference is deleted, and invalid past the picture limit', async () => {
    const product = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle', refs: [{ assetId: product }] });
    await f.sql.query('update brand_studio_assets set deleted_at = now() where id = $1', [product]);
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), revise(root.outputId, { mode: 'reshoot' }))).toEqual({ ok: false, code: 'reference_missing' });
    // The edit way does not need the recipe's references.
    expect((await createStudioJob(deps, viewerOf(f.ids.owner), revise(root.outputId, { mode: 'edit' }))).ok).toBe(true);

    const many = await Promise.all(Array.from({ length: 9 }, () => seedImageAsset(deps, f.orgId, f.ids.owner)));
    const full = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'nine', refs: many.slice(0, 5).map((assetId) => ({ assetId })) });
    const extra = many.slice(5).concat([await seedImageAsset(deps, f.orgId, f.ids.owner)]).map((assetId) => ({ assetId }));
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), revise(full.outputId, { mode: 'reshoot', references: extra }))).toEqual({ ok: false, code: 'invalid' });
  });
});
