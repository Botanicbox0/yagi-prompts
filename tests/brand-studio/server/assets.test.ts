import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assetFromOutput, completeStudioAsset, deleteStudioAsset, deleteStudioOutput, reserveStudioAsset, updateStudioAsset } from '@/lib/brand-studio/assets';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { checkUpload, sniffMime, videoInfo } from '@/lib/brand-studio/files';
import { handoffToCampaign } from '@/lib/brand-studio/handoff';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { fakeClipBytes } from '@/lib/brand-studio/provider/fake';
import { loadStudioState } from '@/lib/brand-studio/service';
import { STUDIO_LIMITS } from '@/lib/brand-studio/contracts';
import { pngBytes, requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';

let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;
beforeEach(async () => {
  f = await studioFixture();
  deps = studioDeps(f.sql);
});
afterEach(async () => {
  await f.db.close();
});

const owner = () => viewerOf(f.ids.owner);

/** reserve -> put bytes into staging (what the browser does) -> complete. */
async function upload(bytes: Uint8Array, mime: string, name = 'bottle.png', declared = bytes.byteLength) {
  const reserved = await reserveStudioAsset(deps, owner(), { organizationId: f.orgId, requestId: requestId(), name, mime, sizeBytes: declared });
  if (!reserved.ok) return reserved;
  const key = (await f.sql.query<{ storage_key: string }>('select storage_key from brand_studio_assets where id = $1', [reserved.id])).rows[0]!.storage_key;
  await deps.staging.putStaging(key, bytes, mime);
  return completeStudioAsset(deps, owner(), { organizationId: f.orgId, assetId: reserved.id });
}

describe('file checks', () => {
  it('reads types from magic bytes and video size and length from the moov box', async () => {
    expect(sniffMime(await pngBytes())).toBe('image/png');
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMime(fakeClipBytes())).toBe('video/mp4');
    expect(sniffMime(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(videoInfo(fakeClipBytes())).toEqual({ width: 160, height: 90, durationMs: 1000 });
    expect(checkUpload(fakeClipBytes(), { mime: 'video/quicktime', sizeBytes: fakeClipBytes().byteLength })).toEqual({ ok: true, mime: 'video/mp4', kind: 'video' });
    expect(checkUpload(await pngBytes(), { mime: 'video/mp4', sizeBytes: (await pngBytes()).byteLength })).toEqual({ ok: false, code: 'unsupported_file' });
  });
});

describe('upload', () => {
  it('reserves a local upload (POST to the studio gateway), checks, measures, thumbnails and stores it', async () => {
    const bytes = await pngBytes(800, 600);
    const reserved = await reserveStudioAsset(deps, owner(), { organizationId: f.orgId, requestId: requestId(), name: 'bottle.png', mime: 'image/png', sizeBytes: bytes.byteLength, role: 'product' });
    expect(reserved).toEqual({ ok: true, id: expect.any(String), direct: false, url: expect.stringMatching(/^\/api\/brand-studio\/assets\/[0-9a-f-]{36}$/) });
    const saved = await upload(bytes, 'image/png');
    expect(saved).toMatchObject({ ok: true, asset: { kind: 'image', width: 800, height: 600, source: 'upload', tags: [] } });
    if (!saved.ok) throw new Error();
    expect(saved.asset.url).toMatch(/^\/api\/brand-studio\/media\/st\/[0-9a-f]{64}\.png$/);
    expect(saved.asset.thumbUrl).toMatch(/\.webp$/);
    const video = await upload(fakeClipBytes(), 'video/mp4', 'film.mp4');
    expect(video).toMatchObject({ ok: true, asset: { kind: 'video', width: 160, height: 90, seconds: 1, thumbUrl: null } });
  });

  it('refuses wrong magic bytes, a size that differs from the reservation, an unsupported type and a file over the limit', async () => {
    expect(await upload(new TextEncoder().encode('GIF89a not a png at all'), 'image/png')).toEqual({ ok: false, code: 'unsupported_file' });
    const png = await pngBytes();
    expect(await upload(png, 'image/png', 'a.png', png.byteLength + 1)).toEqual({ ok: false, code: 'unsupported_file' });
    expect(await reserveStudioAsset(deps, owner(), { organizationId: f.orgId, requestId: requestId(), name: 'a.gif', mime: 'image/gif', sizeBytes: 10 })).toEqual({ ok: false, code: 'unsupported_file' });
    expect(await reserveStudioAsset(deps, owner(), { organizationId: f.orgId, requestId: requestId(), name: 'big.png', mime: 'image/png', sizeBytes: STUDIO_LIMITS.imageBytesMax + 1 })).toEqual({ ok: false, code: 'file_too_large' });
    expect(await reserveStudioAsset(deps, viewerOf(f.ids.viewer), { organizationId: f.orgId, requestId: requestId(), name: 'a.png', mime: 'image/png', sizeBytes: 10 })).toEqual({ ok: false, code: 'forbidden' });
    // Nothing half-done reaches the library.
    const state = await loadStudioState(deps, owner(), f.orgId);
    expect(state.ok && state.assets).toEqual([]);
  });

  it('folds the same bytes into one library entry', async () => {
    const bytes = await pngBytes(120, 90);
    const first = await upload(bytes, 'image/png', 'one.png');
    const second = await upload(bytes, 'image/png', 'two.png');
    expect(first.ok && second.ok && second.asset.id === first.asset.id).toBe(true);
    const state = await loadStudioState(deps, owner(), f.orgId);
    expect(state.ok && state.assets.map((a) => a.name)).toEqual(['one.png']);
  });

  it('enforces the library size', async () => {
    await f.sql.query(
      `insert into brand_studio_assets (organization_id, kind, name, mime, size_bytes, storage_key, status)
        select $1, 'image', 'x', 'image/png', 1, 'brand-studio/fill/' || g, 'pending' from generate_series(1, $2::int) g`,
      [f.orgId, STUDIO_LIMITS.assetsPerOrganization],
    );
    expect(await reserveStudioAsset(deps, owner(), { organizationId: f.orgId, requestId: requestId(), name: 'a.png', mime: 'image/png', sizeBytes: 10 })).toEqual({ ok: false, code: 'asset_limit' });
  });
});

describe('library and results', () => {
  async function oneResult() {
    const created = await createStudioJob(deps, owner(), { kind: 'image', organizationId: f.orgId, requestId: requestId(), model: 'seedream-5-pro', prompt: 'a blue bottle', aspect: '1:1', resolution: '1K' });
    if (!created.ok) throw new Error(created.code);
    await advanceStudioJobsWith(deps, { jobIds: [created.job.id] });
    const state = await loadStudioState(deps, owner(), f.orgId);
    if (!state.ok) throw new Error();
    return state.jobs[0]!.outputs[0]!;
  }

  it('saves a result into the library once, renames and tags it, and deletes objects only when nothing live uses them', async () => {
    const output = await oneResult();
    const saved = await assetFromOutput(deps, owner(), { organizationId: f.orgId, outputId: output.id, role: 'product' });
    expect(saved).toMatchObject({ ok: true, asset: { source: 'generation', role: 'product', name: 'a blue bottle', url: output.url } });
    if (!saved.ok) throw new Error();
    expect(await assetFromOutput(deps, owner(), { organizationId: f.orgId, outputId: output.id })).toMatchObject({ ok: true, asset: { id: saved.asset.id } });
    expect(await updateStudioAsset(deps, owner(), { organizationId: f.orgId, assetId: saved.asset.id, name: '파란 병', tags: ['봄', '봄', '병'], role: null })).toMatchObject({ ok: true, asset: { name: '파란 병', tags: ['봄', '병'], role: null } });
    const key = output.url.replace('/api/brand-studio/media/', '');
    expect(await deleteStudioOutput(deps, owner(), { organizationId: f.orgId, outputId: output.id })).toEqual({ ok: true });
    expect(deps.media.objects.has(key)).toBe(true); // the library entry still shows it
    expect(await deleteStudioAsset(deps, owner(), { organizationId: f.orgId, assetId: saved.asset.id })).toEqual({ ok: true });
    expect(deps.media.objects.has(key)).toBe(false);
    expect(await deleteStudioAsset(deps, owner(), { organizationId: f.orgId, assetId: saved.asset.id })).toEqual({ ok: false, code: 'not_found' });
  });

  it('will not delete what an open job is using', async () => {
    const saved = await upload(await pngBytes(), 'image/png');
    if (!saved.ok) throw new Error();
    const created = await createStudioJob(deps, owner(), { kind: 'image', organizationId: f.orgId, requestId: requestId(), model: 'seedream-5-pro', prompt: 'x', aspect: '1:1', resolution: '1K', references: [{ assetId: saved.asset.id }] });
    expect(created.ok).toBe(true);
    expect(await deleteStudioAsset(deps, owner(), { organizationId: f.orgId, assetId: saved.asset.id })).toEqual({ ok: false, code: 'conflict' });
  });

  it('sends a result to a new campaign request through the workspace attachment flow, and to an existing one', async () => {
    const output = await oneResult();
    const input = { organizationId: f.orgId, requestId: requestId(), outputId: output.id, newProject: { title: 'Blue bottle launch', objective: 'Introduce the blue bottle' } };
    const sentNew = await handoffToCampaign(deps, owner(), input);
    expect(sentNew).toMatchObject({ ok: true, href: expect.stringMatching(/^\/brand\/projects\/[0-9a-f-]{36}$/) });
    if (!sentNew.ok) throw new Error();
    // Retrying the same request does not create a second campaign.
    expect(await handoffToCampaign(deps, owner(), input)).toMatchObject({ ok: true, projectId: sentNew.projectId });
    const files = (await f.sql.query<{ project_id: string; status: string; mime: string }>('select project_id, status, mime from brand_attachments order by created_at')).rows;
    expect(files).toEqual([{ project_id: sentNew.projectId, status: 'ready', mime: 'image/png' }]);
    expect(await handoffToCampaign(deps, owner(), { organizationId: f.orgId, requestId: requestId(), outputId: output.id, projectId: f.projectId })).toMatchObject({ ok: true, projectId: f.projectId });
    expect(await handoffToCampaign(deps, viewerOf(f.ids.viewer), { ...input, requestId: requestId() })).toEqual({ ok: false, code: 'forbidden' });
  });
});
