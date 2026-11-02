import { config as loadEnv } from 'dotenv';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ArkOpenApiError, arkAssetsConfigFromEnv, createArkAssetsClient } from '@/lib/ark/assets';
import { arkConfigFromEnv, createArkClient, isTerminal } from '@/lib/ark/client';
import { createSupabaseRenderStore } from '@/lib/renders/store';
import { assetReference } from '@/lib/identity/service';

/**
 * The virtual-library question (founder, 2026-09-14): does a real, consented selfie pass through an
 * AIGC ("digital character") asset group and into a Seedance render WITHOUT the H5 liveness step?
 * BytePlus's account manager said yes in writing; this is the proof on our own account.
 *
 *   1. upload the photo to the private `renders` bucket, sign a 10-minute URL
 *   2. CreateAssetGroup (GroupType AIGC) → CreateAsset(Image) → poll GetAsset to Active/Failed
 *   3. if Active: one 5-second Seedance 2.0 720p task referencing asset://… → poll to a terminal state
 *   4. delete the asset and the group (unless --keep)
 *
 * Prints statuses and codes only — never a key, never a signed URL.
 *
 *   npx tsx scripts/ark-virtual-smoke.ts <photo path> [--keep] [--no-video]
 */
loadEnv({ path: ['.env.local', '.env'], quiet: true });

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const photoPath = args.find((a) => !a.startsWith('--'));
if (!photoPath) {
  console.error('usage: tsx scripts/ark-virtual-smoke.ts <photo.jpg> [--keep] [--no-video]');
  process.exit(2);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (...a: unknown[]) => console.log(`[${stamp()}]`, ...a);

async function main(): Promise<void> {
  const assetsConfig = arkAssetsConfigFromEnv();
  const videoConfig = arkConfigFromEnv();
  if (assetsConfig === null || videoConfig === null) {
    console.error('ARK_ACCESS_KEY / ARK_SECRET_KEY / ARK_API_KEY must be set in .env.local; nothing called.');
    process.exit(2);
  }
  const assets = createArkAssetsClient(assetsConfig);
  const video = createArkClient(videoConfig);
  const store = createSupabaseRenderStore();

  // 1. photo → private bucket → signed URL (the same path the render pass uses for liveness assets)
  const photo = new Uint8Array(await readFile(photoPath!));
  const key = `${randomUUID()}/virtualsmoke.jpg`;
  await store.put(key, photo, 'image/jpeg');
  const url = await store.url(key, 600);
  if (url === null) throw new Error('the render store did not sign a URL (local store?) — run against the Supabase store');
  log(`photo uploaded (${photo.byteLength} bytes), signed URL issued`);

  // 2. AIGC group + asset
  let groupId: string | null = null;
  let assetId: string | null = null;
  const cleanup = async () => {
    if (flag('keep')) return log('--keep: leaving the group and asset in place', { groupId, assetId });
    try {
      if (assetId) await assets.deleteAsset(assetId);
      if (groupId) await assets.deleteAssetGroup(groupId);
      log('cleanup done (asset + group deleted)');
    } catch (error) {
      log('cleanup failed', error instanceof ArkOpenApiError ? `${error.code}: ${error.message}` : error);
    }
  };

  try {
    const group = await assets.createAssetGroup({ name: `twings-virtual-smoke-${Date.now()}`, description: 'TWINGS virtual-library smoke — consented selfie', groupType: 'AIGC' });
    groupId = group.id;
    log('CreateAssetGroup(AIGC) ok', groupId);
  } catch (error) {
    log('CreateAssetGroup FAILED', error instanceof ArkOpenApiError ? `${error.code}: ${error.message} (http ${error.httpStatus})` : error);
    process.exit(1);
  }

  try {
    const created = await assets.createAsset({ groupId: groupId!, url, assetType: 'Image', name: 'virtual-smoke-selfie' });
    assetId = created.id;
    log('CreateAsset ok', assetId);
  } catch (error) {
    log('CreateAsset FAILED', error instanceof ArkOpenApiError ? `${error.code}: ${error.message} (http ${error.httpStatus})` : error);
    await cleanup();
    process.exit(1);
  }

  let status = 'Processing';
  const assetDeadline = Date.now() + 5 * 60_000;
  try {
    while (Date.now() < assetDeadline) {
      const asset = await assets.getAsset(assetId!);
      status = asset.status;
      log('GetAsset', status);
      if (status !== 'Processing') break;
      await sleep(5000);
    }
  } catch (error) {
    log('GetAsset FAILED', error instanceof Error ? error.message : error);
    await cleanup();
    process.exit(1);
  }
  if (status !== 'Active') {
    log(`RESULT: asset did not become Active (${status}) — the virtual library did not accept the selfie`);
    await cleanup();
    process.exit(1);
  }

  if (flag('no-video')) {
    log('RESULT: asset Active; --no-video, skipping the render');
    await cleanup();
    return;
  }

  // 3. one short film referencing the asset
  let taskId: string;
  try {
    const task = await video.createVideoTask({
      model: 'seedance-2.0',
      content: [
        { type: 'text', text: 'Image 1 is the subject. A calm 1990s Seoul street interview, handheld camcorder look, the subject looks at the camera and smiles slightly. Keep the face exactly as in Image 1.' },
        { type: 'image_url', image_url: { url: assetReference(assetId!) }, role: 'reference_image' },
      ],
      resolution: '720p',
      ratio: '9:16',
      duration: 5,
      generateAudio: false,
      watermark: false,
    });
    taskId = task.id;
    log('createVideoTask ok', taskId);
  } catch (error) {
    log('createVideoTask FAILED', error instanceof Error ? `${error.name}: ${error.message}` : error);
    await cleanup();
    process.exit(1);
  }

  const taskDeadline = Date.now() + 8 * 60_000;
  let final: Awaited<ReturnType<typeof video.getVideoTask>> | null = null;
  while (Date.now() < taskDeadline) {
    final = await video.getVideoTask(taskId);
    log('getVideoTask', final.status, final.error ? `${final.error.code}: ${final.error.message}` : '');
    if (isTerminal(final.status)) break;
    await sleep(8000);
  }
  if (final?.status === 'succeeded' && final.videoUrl) {
    log(`RESULT: SUCCEEDED — a real selfie rendered through the AIGC library with no liveness. tokens=${final.completionTokens ?? '?'}`);
    // The URL is a short-lived provider link, not a secret; saved for the founder to view.
    console.log(`VIDEO_URL=${final.videoUrl}`);
  } else {
    log(`RESULT: render did not succeed — status=${final?.status ?? 'unknown'} error=${final?.error ? `${final.error.code}: ${final.error.message}` : 'none'}`);
  }
  await cleanup();
}

main().catch((error) => {
  console.error('[virtual-smoke] unexpected failure', error instanceof Error ? error.message : error);
  process.exit(1);
});
