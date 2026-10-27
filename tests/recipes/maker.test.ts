import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ANON_VIEWER } from '@/lib/auth/identity';
import { administerPlatform } from '@/lib/creator-platform/admin';
import { saveSelfie } from '@/lib/identity/selfie-service';
import { loadMakerDraft, makerAction, MAKER_TEST_RENDERS, RecipeRejected, uploadMakerFile } from '@/lib/recipes/maker';
import { MAKER_FILE_MAX_BYTES, sniffMakerFile } from '@/lib/recipes/assets';
import { loadJobRecipe } from '@/lib/recipes/repo';
import { makerFileObject, recipeRenderOutput } from '@/lib/recipes/media';
import { listMyRenders } from '@/lib/renders/service';
import { createLocalRenderStore, type RenderStore } from '@/lib/renders/store';
import { ADMIN_VIEWER, viewerOf } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';

/** The recipe editor's server half (lib/recipes/maker.ts): gates, ownership, limits, bounded files. */

const maker = viewerOf('free'), stranger = viewerOf('pro'), open = { creators: true };
const selfie = { kind: 'image', source: 'user', required: true } as const;
const recipe = (asset?: string) => ({
  version: 2,
  slots: asset ? { selfie, prop: { kind: 'image', source: 'creator', asset } } : { selfie },
  steps: [{ id: 'step1', kind: 'image', engine: 'gpt-image-2', inputs: asset ? ['selfie', 'prop'] : ['selfie'], prompt: asset ? 'A still of {{selfie}} holding {{prop}}.' : 'A still of {{selfie}} in a diner.', params: { aspect: '4:5' } }],
  output: { from: 'step1' },
});
const save = (id: string, extra: Record<string, unknown> = {}) => ({ action: 'save', id, title: 'Diner still', titleKo: '다이너 스틸', recipe: recipe(), example: '', disclosure: { prompts: true, assets: false }, presentation: 'make-first', royalty: 1500, ...extra });
const png = (side = 320) => sharp({ create: { width: side, height: side, channels: 3, background: { r: 200, g: 120, b: 80 } } }).png().toBuffer().then((b) => new Uint8Array(b));

describe('maker recipe editor — server', () => {
  let h: PromptHarness, root: string, store: RenderStore, deps: { sql: PromptHarness['sql']; store: RenderStore };
  beforeEach(async () => {
    h = await promptHarness();
    root = await mkdtemp(join(tmpdir(), 'twings-maker-'));
    store = createLocalRenderStore(root);
    deps = { sql: h.sql, store };
  });
  afterEach(async () => { await h.close(); await rm(root, { recursive: true, force: true }); });
  const approve = () => administerPlatform(h.sql, ADMIN_VIEWER, { action: 'creator', id: maker.userId, active: true, contract: 'pilot-v1', reason: 'Owner-approved invitation' });

  it('refuses the anonymous, a closed flag, an unapproved account and unknown fields', async () => {
    const id = randomUUID();
    await expect(makerAction(deps, ANON_VIEWER, save(id), open)).rejects.toThrow('sign_in_required');
    await expect(makerAction(deps, maker, save(id), { creators: false })).rejects.toThrow('not_open');
    await expect(makerAction(deps, maker, save(id), open)).rejects.toThrow('forbidden');
    await approve();
    await expect(makerAction(deps, maker, { ...save(id), status: 'accepted' }, open)).rejects.toThrow('invalid');
    await expect(makerAction(deps, maker, { ...save(id), royalty: 6000 }, open)).rejects.toThrow('invalid');
    await expect(makerAction(deps, maker, save(id, { example: 'https://evil.test/x' }), open)).rejects.toThrow('bad_example');
  });

  it('saves and updates only the owner’s own draft; drafts are never in the studio queue', async () => {
    await approve();
    const id = randomUUID();
    await makerAction(deps, maker, save(id), open);
    await makerAction(deps, maker, save(id, { title: 'Diner still v2' }), open);
    const draft = await loadMakerDraft(h.sql, maker, id, open);
    expect(draft).toMatchObject({ status: 'draft', title: 'Diner still v2', royaltyKrw: 1500, disclosure: { prompts: true, assets: false } });
    await administerPlatform(h.sql, ADMIN_VIEWER, { action: 'creator', id: stranger.userId, active: true, contract: 'pilot-v1', reason: 'Second maker' });
    await expect(makerAction(deps, stranger, save(id, { title: 'Hijack' }), open)).rejects.toThrow('not_found');
    expect(await loadMakerDraft(h.sql, stranger, id, open)).toBeNull();
    await expect(administerPlatform(h.sql, ADMIN_VIEWER, { action: 'format', id, accept: true, reason: 'Not submitted yet' })).rejects.toThrow('conflict');
  });

  it('submits only a recipe that passes every rule, with an example and its own files', async () => {
    await approve();
    const id = randomUUID();
    await makerAction(deps, maker, save(id, { recipe: { ...recipe(), steps: [{ ...recipe().steps[0], prompt: 'No face here, just a diner.' , inputs: [] }] } }), open);
    await expect(makerAction(deps, maker, { action: 'submit', id, rights: true }, open)).rejects.toBeInstanceOf(RecipeRejected);
    await makerAction(deps, maker, save(id), open);
    await expect(makerAction(deps, maker, { action: 'submit', id, rights: true }, open)).rejects.toThrow('example_required');
    // A handle that is not this draft's file is refused.
    await makerAction(deps, maker, save(id, { recipe: recipe(`ast_${'f'.repeat(32)}`), example: 'https://www.instagram.com/reel/abc123/' }), open);
    await expect(makerAction(deps, maker, { action: 'submit', id, rights: true }, open)).rejects.toBeInstanceOf(RecipeRejected);
    const file = await uploadMakerFile(deps, maker, { formatId: id, role: 'reference', bytes: await png() }, open);
    await makerAction(deps, maker, save(id, { recipe: recipe(file.id), example: 'https://www.instagram.com/reel/abc123/' }), open);
    await makerAction(deps, maker, { action: 'submit', id, rights: true }, open);
    expect((await loadMakerDraft(h.sql, maker, id, open))!.status).toBe('submitted');
    // Submitted is read-only: no save, no new file.
    await expect(makerAction(deps, maker, save(id), open)).rejects.toThrow('conflict');
    await expect(uploadMakerFile(deps, maker, { formatId: id, role: 'reference', bytes: await png(330) }, open)).rejects.toThrow('conflict');
  });

  it('keeps files bounded: size, type by bytes, count, owner, metadata stripped', async () => {
    await approve();
    const id = randomUUID();
    await makerAction(deps, maker, save(id), open);
    await expect(uploadMakerFile(deps, maker, { formatId: id, role: 'reference', bytes: new Uint8Array(MAKER_FILE_MAX_BYTES + 1) }, open)).rejects.toThrow('too_large');
    await expect(uploadMakerFile(deps, maker, { formatId: id, role: 'reference', bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>') }, open)).rejects.toThrow('bad_file');
    await expect(uploadMakerFile(deps, stranger, { formatId: id, role: 'reference', bytes: await png() }, open)).rejects.toThrow('forbidden');
    const withExif = new Uint8Array(await sharp(await png()).withMetadata({ exif: { IFD0: { Copyright: 'GPS-CANARY' } } }).jpeg().toBuffer());
    const stored = await uploadMakerFile(deps, maker, { formatId: id, role: 'reference', bytes: withExif }, open);
    expect(stored).toMatchObject({ role: 'reference', kind: 'image', mime: 'image/jpeg' });
    const key = (await h.sql.query<{ storage_key: string }>('select storage_key from platform_format_assets where id=$1', [stored.id])).rows[0]!.storage_key;
    expect(Buffer.from(await store.read(key)).toString('latin1')).not.toContain('GPS-CANARY');
    for (let i = 1; i < 6; i += 1) await uploadMakerFile(deps, maker, { formatId: id, role: 'reference', bytes: await png(300 + i) }, open);
    await expect(uploadMakerFile(deps, maker, { formatId: id, role: 'reference', bytes: await png(400) }, open)).rejects.toThrow('limit_reached');
    expect(sniffMakerFile(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]))).toBe('video/mp4');
    // The file is the owner's and the studio's; a stranger never sees an undisclosed file.
    expect(await makerFileObject(h.sql, maker, stored.id)).toMatchObject({ publicCache: false });
    expect(await makerFileObject(h.sql, ADMIN_VIEWER, stored.id)).not.toBeNull();
    expect(await makerFileObject(h.sql, stranger, stored.id)).toBeNull();
    expect(await makerFileObject(h.sql, ANON_VIEWER, stored.id)).toBeNull();
  });

  it('test-renders with the maker’s own saved photo, three times a format, results for the maker only', async () => {
    await approve();
    const id = randomUUID();
    await makerAction(deps, maker, save(id), open);
    await expect(makerAction(deps, maker, { action: 'test', id }, open)).rejects.toThrow('selfie_required');
    // The refused attempt did not spend a render (the whole transaction rolled back).
    expect((await loadMakerDraft(h.sql, maker, id, open))!.testRendersUsed).toBe(0);
    expect(await saveSelfie({ sql: h.sql, store }, maker.userId, { bytes: await png(), mime: 'image/png', consent: true })).toMatchObject({ ok: true });
    const renders: string[] = [];
    for (let i = 0; i < MAKER_TEST_RENDERS; i += 1) renders.push((await makerAction(deps, maker, { action: 'test', id }, open)).renderId!);
    await expect(makerAction(deps, maker, { action: 'test', id }, open)).rejects.toThrow('test_limit');
    const job = await loadJobRecipe(h.sql, renders[0]!);
    expect(job).toMatchObject({ purpose: 'maker_test', formatId: id });
    expect((await loadMakerDraft(h.sql, maker, id, open))!.tests).toHaveLength(3);
    expect((await listMyRenders(h.sql, maker.userId!)).map((v) => v.job.id)).toEqual([]);
    // Outputs go to the job's owner; a maker test is not even the studio's to open.
    await h.sql.query("update render_jobs set status='succeeded',result_key=$2,result_mime='image/jpeg',share_token=id::text,share_expires_at=now(),finished_at=now() where id=$1", [renders[0], `${renders[0]}/result.jpg`]);
    await h.sql.query("insert into render_job_outputs(render_id,position,step_id,storage_key,mime,bytes) values($1,0,'step1',$2,'image/jpeg',3)", [renders[0], `${renders[0]}/result.jpg`]);
    expect(await recipeRenderOutput(h.sql, maker, renders[0]!, 0)).not.toBeNull();
    expect(await recipeRenderOutput(h.sql, stranger, renders[0]!, 0)).toBeNull();
    expect(await recipeRenderOutput(h.sql, ADMIN_VIEWER, renders[0]!, 0)).toBeNull();
  });
});
