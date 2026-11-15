import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { loadRevisionRecipe, renumberRequest } from '@/lib/brand-studio/revision/recipe';
import { jobView } from '@/lib/brand-studio/repo';
import type { JobRow, OutputRow } from '@/lib/brand-studio/types';
import { seedImageAsset, studioDeps, studioFixture, type StudioFixture } from './helpers';
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

async function chain() {
  const product = await seedImageAsset(deps, f.orgId, f.ids.owner, { role: 'product' });
  const logo = await seedImageAsset(deps, f.orgId, f.ids.owner, { role: 'logo' });
  const label = await seedImageAsset(deps, f.orgId, f.ids.owner);
  const root = await seedRun(deps, f.orgId, f.ids.owner, {
    prompt: '향수병이 회전한다',
    finalPrompt: '@Image1 a perfume bottle turns slowly on white stone.',
    refs: [{ assetId: product, role: 'product' }],
    params: { change: '' },
  });
  const v2 = await seedRevision(deps, f.orgId, f.ids.owner, { base: root, rootJobId: root.jobId, version: 2, mode: 'edit', request: '병을 파랗게', added: [{ assetId: logo }] });
  const v3 = await seedRevision(deps, f.orgId, f.ids.owner, { base: v2, rootJobId: root.jobId, version: 3, mode: 'edit', request: '이미지 1의 라벨로', added: [{ assetId: label }, { assetId: logo }] });
  const v4 = await seedRevision(deps, f.orgId, f.ids.owner, {
    base: v3, rootJobId: root.jobId, version: 4, mode: 'reshoot', request: '카메라를 왼쪽으로',
    refs: [{ assetId: product, role: 'product' }, { assetId: logo }, { assetId: label }],
    finalPrompt: '@Image1 a blue perfume bottle with @Image3 label, the camera arcs left.',
  });
  const v5 = await seedRevision(deps, f.orgId, f.ids.owner, { base: v4, rootJobId: root.jobId, version: 5, mode: 'edit', request: '배경을 회색으로' });
  return { product, logo, label, root, v2, v3, v4, v5 };
}

describe('loadRevisionRecipe', () => {
  it('walks edits up to the nearest run that is not an edit', async () => {
    const c = await chain();

    const ofV3 = await loadRevisionRecipe(f.sql, f.orgId, c.v3.outputId);
    expect(ofV3.base).toMatchObject({ outputId: c.v3.outputId, jobId: c.v3.jobId, version: 3, seconds: 6, isFinal: false });
    expect(ofV3.rootJobId).toBe(c.root.jobId);
    expect(ofV3.recipeJob?.id).toBe(c.root.jobId);
    expect(ofV3.madeWith).toBe('@Image1 a perfume bottle turns slowly on white stone.');
    expect(ofV3.history.map((h) => [h.version, h.request])).toEqual([[2, '병을 파랗게'], [3, '이미지 1의 라벨로']]);
    // logo added twice, label once: oldest first, once each.
    expect(ofV3.addedRefs).toEqual([{ assetId: c.logo }, { assetId: c.label }]);
    expect(ofV3.nextVersion).toBe(6);

    // A reshoot is itself a recipe run: the edit on top of it walks one step.
    const ofV5 = await loadRevisionRecipe(f.sql, f.orgId, c.v5.outputId);
    expect(ofV5.recipeJob?.id).toBe(c.v4.jobId);
    expect(ofV5.madeWith).toContain('camera arcs left');
    expect(ofV5.history.map((h) => h.request)).toEqual(['배경을 회색으로']);
    expect(ofV5.addedRefs).toEqual([]);

    // The reshoot itself: nothing between.
    const ofV4 = await loadRevisionRecipe(f.sql, f.orgId, c.v4.outputId);
    expect(ofV4.recipeJob?.id).toBe(c.v4.jobId);
    expect(ofV4.history).toEqual([]);
    expect(ofV4.base.version).toBe(4);

    const ofRoot = await loadRevisionRecipe(f.sql, f.orgId, c.root.outputId);
    expect(ofRoot).toMatchObject({ rootJobId: c.root.jobId, nextVersion: 6, history: [], base: { version: 1 } });
  });

  it('uses the prompt and the change note when nothing was enhanced', async () => {
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle', params: { change: 'make it red' } });
    expect((await loadRevisionRecipe(f.sql, f.orgId, root.outputId)).madeWith).toBe('a bottle\nmake it red');
  });

  it('treats a 1080p final as the same version as its draft', async () => {
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle', params: { resolution: 'draft' }, isDraft: true });
    const v2 = await seedRevision(deps, f.orgId, f.ids.owner, { base: root, rootJobId: root.jobId, version: 2, mode: 'edit', request: 'blue', params: { resolution: 'draft' } });
    const final = await seedFinal(deps, f.orgId, f.ids.owner, v2);
    const recipe = await loadRevisionRecipe(f.sql, f.orgId, final.outputId);
    expect(recipe.base).toMatchObject({ outputId: final.outputId, jobId: v2.jobId, version: 2, isFinal: true, width: 1080 });
    expect(recipe.recipeJob?.id).toBe(root.jobId);
    expect(recipe.history.map((h) => h.request)).toEqual(['blue']);
    expect(recipe.nextVersion).toBe(3);

    // An edit made on the final hops through it to the draft's job.
    const v3 = await seedRevision(deps, f.orgId, f.ids.owner, { base: { jobId: v2.jobId, outputId: final.outputId }, rootJobId: root.jobId, version: 3, mode: 'edit', request: 'grey sky' });
    const ofV3 = await loadRevisionRecipe(f.sql, f.orgId, v3.outputId);
    expect(ofV3.recipeJob?.id).toBe(root.jobId);
    expect(ofV3.history.map((h) => h.request)).toEqual(['blue', 'grey sky']);
  });

  it('counts versions of any status, so a failed version keeps its number', async () => {
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle' });
    await seedRevision(deps, f.orgId, f.ids.owner, { base: root, rootJobId: root.jobId, version: 2, mode: 'edit', request: 'x' });
    await f.sql.query("update brand_studio_jobs set status = 'failed' where params -> 'revision' ->> 'version' = '2'");
    expect((await loadRevisionRecipe(f.sql, f.orgId, root.outputId)).nextVersion).toBe(3);
  });

  it('closes the reshoot way when an edit ancestor is gone, but still reads the edit', async () => {
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle', finalPrompt: 'A bottle.' });
    const v2 = await seedRevision(deps, f.orgId, f.ids.owner, { base: root, rootJobId: root.jobId, version: 2, mode: 'edit', request: 'blue', finalPrompt: 'In @Video1, change only the bottle colour to blue.' });
    await f.sql.query('delete from brand_studio_jobs where id = $1', [root.jobId]);
    const recipe = await loadRevisionRecipe(f.sql, f.orgId, v2.outputId);
    expect(recipe.recipeJob).toBeNull();
    expect(recipe.madeWith).toContain('blue');
    expect(recipe.history.map((h) => h.request)).toEqual(['blue']);
  });

  it('is not_found for another organization, an image, a deleted or unknown result', async () => {
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle' });
    const other = await studioFixture();
    try {
      await expect(loadRevisionRecipe(other.sql, other.orgId, root.outputId)).rejects.toMatchObject({ code: 'not_found' });
    } finally {
      await other.db.close();
    }
    const otherOrg = randomUUID();
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [otherOrg, 'Other', f.ids.outsider, randomUUID()]);
    const theirs = await seedRun(deps, otherOrg, f.ids.outsider, { prompt: 'theirs' });
    await expect(loadRevisionRecipe(f.sql, f.orgId, theirs.outputId)).rejects.toMatchObject({ code: 'not_found' });
    const picture = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image', prompt: 'a still' });
    await expect(loadRevisionRecipe(f.sql, f.orgId, picture.outputId)).rejects.toMatchObject({ code: 'not_found' });
    await expect(loadRevisionRecipe(f.sql, f.orgId, randomUUID())).rejects.toMatchObject({ code: 'not_found' });
    await f.sql.query('update brand_studio_outputs set deleted_at = now() where id = $1', [root.outputId]);
    await expect(loadRevisionRecipe(f.sql, f.orgId, root.outputId)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('renumberRequest', () => {
  it('moves the request\'s own picture numbers to their place in the tray', () => {
    const tray = new Map([['a:p', 1], ['a:l', 2], ['a:n', 3]]);
    expect(renumberRequest('이미지 1의 라벨을 붙이고 영상 1은 그대로', [{ assetId: 'n' }], tray, 'ko')).toBe('이미지 3의 라벨을 붙이고 영상 1은 그대로');
    expect(renumberRequest('use image 2 here', [{ assetId: 'n' }], tray, 'en')).toBe('use image 2 here');
    expect(renumberRequest('no pictures', [], tray, 'ko')).toBe('no pictures');
  });
});

describe('jobView.revision', () => {
  it('shows the version and the base, which turns null once the base is deleted', async () => {
    const c = await chain();
    const rows = async (id: string) => ({
      job: (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [id])).rows[0]!,
      outputs: (await f.sql.query<OutputRow>('select * from brand_studio_outputs where job_id = $1', [id])).rows,
    });
    const v3 = await rows(c.v3.jobId);
    expect(jobView(v3.job, v3.outputs, deps.media).revision).toEqual({ rootJobId: c.root.jobId, version: 3, baseOutputId: c.v2.outputId, mode: 'edit', added: 2 });
    const root = await rows(c.root.jobId);
    expect(jobView(root.job, root.outputs, deps.media).revision).toBeUndefined();
    await f.sql.query('delete from brand_studio_outputs where id = $1', [c.v2.outputId]);
    const after = await rows(c.v3.jobId);
    expect(jobView(after.job, after.outputs, deps.media).revision).toMatchObject({ version: 3, baseOutputId: null });
  });
});
