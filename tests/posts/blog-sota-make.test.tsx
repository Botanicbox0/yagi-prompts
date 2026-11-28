import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SqlRunner } from '@/lib/db/sql-runner';

let activeSql: SqlRunner | null = null;

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/connect', () => ({
  getSqlRunner: async () => activeSql,
}));
vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
  unstable_cache: <T,>(fn: T) => fn,
}));

import { getDictionary } from '@/lib/i18n/dictionaries';
import { saveSelfie } from '@/lib/identity/selfie-service';
import { isReservedMakerHandle, MakerProfileError, saveMakerProfile } from '@/lib/makers/profile';
import { activateOpenMaker } from '@/lib/makers/self-activate';
import { makerAction } from '@/lib/recipes/maker';
import {
  BLOG_MAKER_WORKS_MAX_BYTES,
  completeMakerWorkUpload,
  MAKER_WORK_VIDEO_MAX_BYTES,
  makerWorkUploadsReady,
  PRESIGN_HOURLY_LIMIT,
  presignMakerWorkUpload,
  resetPresignRateLimits,
  storeMakerWork,
  sweepExpiredMakerWorkUploads,
  sweepOrphanMakerUploads,
  UPLOAD_ID,
  UPLOAD_STORAGE_KEY,
  WORK_ID,
} from '@/lib/makers/works';
import { createUnlistedMakeCard, normalizeBlogMakePrompt, resetMakeCardRateLimits } from '@/lib/posts/make-card';
import { findPrimaryBlogPostForTemplate } from '@/lib/posts/public';
import { PostError } from '@/lib/posts/repo';
import { publishMakerPost, saveMakerPost } from '@/lib/posts/service';
import { loadMakerPublishedCards, loadPromptCardsBySlugs, loadPromptCatalog } from '@/lib/prompts/catalog';
import { PROMPT_CATALOG_CACHE_VERSION } from '@/lib/prompts/public-catalog';
import { loadPublishedPrompts } from '@/lib/prompts/repo';
import {
  assertRenderKey,
  createLocalRenderStore,
  createR2RenderStore,
  resetRenderStore,
  type RenderStore,
} from '@/lib/renders/store';
import { createLocalStorageDriver } from '@/lib/storage/local-driver';
import { BlogMakeCard } from '@/components/posts/blog-make-studio';
import { POST as presignRoute } from '@/app/api/makers/works/presign/route';
import { POST as completeRoute } from '@/app/api/makers/works/complete/route';
import { POST as makeCardRoute } from '@/app/api/makers/posts/make-card/route';
import { GET as creativeMediaRoute } from '@/app/creative-media/[file]/route';
import { GET as makerMediaRoute } from '@/app/api/makers/media/[id]/route';
import { viewerOf } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';

const CREATIVE = viewerOf('free');
const OTHER_CREATIVE = viewerOf('pro');

function makeMp4Bytes(byteLength: number, seed = 1): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  bytes.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]); // ....ftypisom
  bytes[byteLength - 1] = (byteLength + seed) & 0xff;
  bytes[byteLength - 2] = seed & 0xff;
  return bytes;
}

async function makeJpegBytes(width = 64, height = 64): Promise<Uint8Array> {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 50, b: 60 } },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
  return new Uint8Array(buf);
}

describe('Blog SOTA media (50MB presign) & unlisted inline selfie make-card', () => {
  let h: PromptHarness;
  let root: string;
  let store: RenderStore;

  beforeEach(async () => {
    vi.stubEnv('TWINGS_MAKER_BLOG', 'on');
    h = await promptHarness();
    activeSql = h.sql;
    root = await mkdtemp(join(tmpdir(), 'twings-blog-sota-'));
    store = createLocalRenderStore(root);

    await activateOpenMaker(h.sql, CREATIVE, { rightsAgreed: true });
    // Provision @yagi for founder account in DB (same as production), keeping 'yagi' reserved for everyone else.
    await h.sql.query(
      `update platform_creators set handle = 'yagi', public_profile = true, payout = 'company' where user_id = $1`,
      [CREATIVE.userId],
    );
    await saveMakerProfile(h.sql, CREATIVE.userId!, {
      handle: 'yagi',
      displayName: 'Yagi Yun',
      bio: 'AI Film Director',
      publicProfile: true,
      links: ['https://www.instagram.com/yagi'],
    });

    await activateOpenMaker(h.sql, OTHER_CREATIVE, { rightsAgreed: true });
    await saveMakerProfile(h.sql, OTHER_CREATIVE.userId!, {
      handle: 'other_maker',
      displayName: 'Other Maker',
      publicProfile: true,
    });
  });

  afterEach(async () => {
    activeSql = null;
    resetPresignRateLimits();
    resetMakeCardRateLimits();
    resetRenderStore();
    vi.unstubAllEnvs();
    await h.close();
    await rm(root, { recursive: true, force: true });
  });

  it('keeps @yagi reserved against impersonation while allowing the existing owner to edit their profile', async () => {
    expect(isReservedMakerHandle('yagi')).toBe(true);
    expect(isReservedMakerHandle('twings')).toBe(true);
    expect(isReservedMakerHandle('admin')).toBe(true);

    // Another creative cannot claim 'yagi'
    await expect(
      saveMakerProfile(h.sql, OTHER_CREATIVE.userId!, {
        handle: 'yagi',
        publicProfile: true,
      }),
    ).rejects.toBeInstanceOf(MakerProfileError);
    await expect(
      saveMakerProfile(h.sql, OTHER_CREATIVE.userId!, {
        handle: 'yagi',
        publicProfile: true,
      }),
    ).rejects.toMatchObject({ code: 'reserved_handle' });

    // Existing owner of 'yagi' can update bio/links without losing the handle
    const updated = await saveMakerProfile(h.sql, CREATIVE.userId!, {
      handle: 'yagi',
      displayName: 'Yagi Studio',
      bio: 'Updated bio',
      publicProfile: true,
    });
    expect(updated.handle).toBe('yagi');
    expect(updated.bio).toBe('Updated bio');
  });

  it('signs Content-Length + Content-Type on ephemeral upl_* keys, copies to immutable wrk_* keys, and sweeps orphans', async () => {
    expect(MAKER_WORK_VIDEO_MAX_BYTES).toBe(50 * 1024 * 1024);

    // Render-key regex keeps strict {0,47} bound
    expect(() => assertRenderKey(`${CREATIVE.userId}/upl_${'a'.repeat(32)}.mp4`)).not.toThrow();
    expect(() => assertRenderKey(`${CREATIVE.userId}/a${'b'.repeat(48)}.mp4`)).toThrow(/illegal render key/);

    // Real aws4fetch signature check: binds Content-Length + Content-Type + Host and 300s TTL
    const r2Store = createR2RenderStore({
      accountId: 'testaccount1234567890',
      accessKeyId: 'test-r2-access-key',
      secretAccessKey: 'test-r2-secret-key',
      bucket: 'twings-private-apac',
    });
    const signedPut = await r2Store.signedUploadUrl!(
      `${CREATIVE.userId}/upl_${'f'.repeat(32)}.mp4`,
      'video/mp4',
      6 * 1024 * 1024,
    );
    expect(signedPut).toBeTruthy();
    const parsedUrl = new URL(signedPut!);
    expect(parsedUrl.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(parsedUrl.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');

    const capturedSignArgs: Array<{ key: string; mime: string; len: number; ttl?: number }> = [];
    const presignStore: RenderStore = {
      ...store,
      name: 'r2',
      async signedUploadUrl(key, mime, len, ttl) {
        capturedSignArgs.push({ key, mime, len, ttl });
        return `https://r2.example.test/upload/${encodeURIComponent(key)}`;
      },
    };

    const videoBytes = makeMp4Bytes(6 * 1024 * 1024); // 6 MB > Vercel 4.5 MB limit
    const presigned = await presignMakerWorkUpload(h.sql, presignStore, {
      userId: CREATIVE.userId!,
      mime: 'video/mp4',
      bytes: videoBytes.byteLength,
    });
    expect(presigned.mode).toBe('presigned');
    if (presigned.mode !== 'presigned') throw new Error('expected presigned');
    expect(UPLOAD_ID.test(presigned.uploadId)).toBe(true);
    expect(WORK_ID.test(presigned.uploadId)).toBe(false);
    expect(capturedSignArgs[0]).toMatchObject({
      mime: 'video/mp4',
      len: videoBytes.byteLength,
      ttl: 300,
    });

    const rawUploadKey = `${CREATIVE.userId!}/${presigned.uploadId}.mp4`;
    await store.put(rawUploadKey, videoBytes, 'video/mp4');

    // Rejects wrk_* passed as uploadId
    await expect(
      completeMakerWorkUpload(h.sql, presignStore, {
        userId: CREATIVE.userId!,
        uploadId: `wrk_${'0'.repeat(32)}`,
        mime: 'video/mp4',
      }),
    ).rejects.toMatchObject({ code: 'invalid' });

    const completed = await completeMakerWorkUpload(h.sql, presignStore, {
      userId: CREATIVE.userId!,
      uploadId: presigned.uploadId,
      mime: 'video/mp4',
      title: 'Interstellar 1080p Master',
    });
    expect(completed.unchanged).toBe(false);
    expect(WORK_ID.test(completed.work.id)).toBe(true);
    expect(completed.work.id).not.toBe(presigned.uploadId);

    // Ephemeral upl_* key is deleted immediately; final wrk_* key holds exact verified bytes
    expect(await store.head!(rawUploadKey)).toBeNull();
    const finalKey = `${CREATIVE.userId!}/${completed.work.id}.mp4`;
    expect((await store.head!(finalKey))?.bytes).toBe(videoBytes.byteLength);

    // Replaying PUT to rawUploadKey cannot alter finalKey, and orphan sweep deletes abandoned upl_* & orphan wrk_*
    const tamperedBytes = makeMp4Bytes(2048, 99);
    await store.put(rawUploadKey, tamperedBytes, 'video/mp4');
    const orphanWrkKey = `${CREATIVE.userId!}/wrk_${'e'.repeat(32)}.mp4`;
    await store.put(orphanWrkKey, tamperedBytes, 'video/mp4');

    const swept = await sweepOrphanMakerUploads(h.sql, store, CREATIVE.userId!, {
      now: Date.now() + 20 * 60 * 1000,
      maxAgeMs: 15 * 60 * 1000,
    });
    expect(swept.swept).toBe(2);
    expect(await store.head!(rawUploadKey)).toBeNull();
    expect(await store.head!(orphanWrkKey)).toBeNull();
    // Legitimate committed work remains untouched, and platform_rate_limits is never polluted by presigns
    expect((await store.head!(finalKey))?.bytes).toBe(videoBytes.byteLength);
    const rateRows = await h.sql.query<{ n: number }>('select count(*)::int as n from platform_rate_limits');
    expect(rateRows.rows[0]!.n).toBe(0);

    // Unknown updatedAt is treated as fresh (never deleted prematurely)
    const unknownTsStore: RenderStore = {
      ...store,
      async listFolder() {
        return [{ key: `${CREATIVE.userId!}/upl_${'c'.repeat(32)}.mp4`, bytes: 128, updatedAt: null }];
      },
    };
    const deletedKeys: string[] = [];
    unknownTsStore.delete = async (k) => {
      deletedKeys.push(k);
    };
    const unknownSweep = await sweepOrphanMakerUploads(h.sql, unknownTsStore, CREATIVE.userId!);
    expect(unknownSweep).toEqual({ swept: 0, pendingUploads: 1, pendingBytes: 128 });
    expect(deletedKeys).toHaveLength(0);
  });

  it('routes createUnlistedMakeCard through selfPublishFormat with kill switch, media-kind check, test gate, and 3/day cap', async () => {
    expect(PROMPT_CATALOG_CACHE_VERSION).toBe('v19-catalog-listed');
    expect(normalizeBlogMakePrompt('Scene with [내 사진] walking in rain.')).toBe(
      'Scene with {{selfie}} walking in rain.',
    );
    expect(normalizeBlogMakePrompt('Scene with [My photo] in cinema light.')).toBe(
      'Scene with {{selfie}} in cinema light.',
    );
    expect(normalizeBlogMakePrompt('Scene without selfie token.')).toBeNull();

    // Creative-facing copy never exposes internal {{selfie}} token
    for (const locale of ['ko', 'en'] as const) {
      const blogDict = JSON.stringify(getDictionary(locale).makerBlog);
      expect(blogDict).not.toContain('{{selfie}}');
    }

    const storage = createLocalStorageDriver(join(root, 'public-storage'));
    const videoWork = await storeMakerWork(h.sql, store, {
      userId: CREATIVE.userId!,
      bytes: makeMp4Bytes(1024, 1),
      title: 'Example film',
    });
    const imageWork = await storeMakerWork(h.sql, store, {
      userId: CREATIVE.userId!,
      bytes: await makeJpegBytes(),
      title: 'Example still',
    });

    // 1. Respects TWINGS_MAKER_SELF_PUBLISH=off kill switch
    vi.stubEnv('TWINGS_MAKER_SELF_PUBLISH', 'off');
    await expect(
      createUnlistedMakeCard({ sql: h.sql, store, storage }, CREATIVE.userId!, {
        title: 'Blocked When Self-Publish Off',
        workId: videoWork.work.id,
        kind: 'video',
        prompt: '16:9 35mm cinema scene starring [내 사진] in rain.',
        rightsConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: 'not_open' });
    vi.stubEnv('TWINGS_MAKER_SELF_PUBLISH', 'on');

    // 2. Rejects media kind mismatch (video recipe + image work, or image recipe + video work)
    await expect(
      createUnlistedMakeCard({ sql: h.sql, store, storage }, CREATIVE.userId!, {
        title: 'Mismatched Kind Video',
        workId: imageWork.work.id,
        kind: 'video',
        prompt: '16:9 35mm cinema scene starring [내 사진] in rain.',
        rightsConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: 'invalid_work' });

    // 3. Image make-card uses valid maker engine (not studio-only nano-banana-pro) and enforces test_required
    await expect(
      createUnlistedMakeCard({ sql: h.sql, store, storage }, CREATIVE.userId!, {
        title: 'Untested Image Scene',
        workId: imageWork.work.id,
        kind: 'image',
        prompt: 'Editorial portrait starring [내 사진] under studio key light.',
        aspect: '4:5',
        rightsConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: 'test_required' });

    // With a succeeded maker_test render on an existing draft format, image make-card publishes cleanly
    const testedFormatId = randomUUID();
    await makerAction(
      { sql: h.sql, store, storage },
      CREATIVE,
      {
        action: 'save',
        id: testedFormatId,
        title: 'Tested Image Scene',
        titleKo: '테스트 완료 이미지',
        example: '',
        disclosure: { prompts: true, assets: false },
        presentation: 'story-first',
        royalty: 500,
        recipe: {
          version: 2,
          slots: { selfie: { kind: 'image', source: 'user', required: true } },
          steps: [
            {
              id: 'still',
              kind: 'image',
              engine: 'gpt-image-2.5-flare',
              inputs: ['selfie'],
              prompt: 'Editorial portrait starring {{selfie}} under studio key light.',
              params: { aspect: '4:5' },
            },
          ],
          output: { from: 'still' },
        },
      },
      { creators: true },
    );
    await saveSelfie(
      { sql: h.sql, store },
      CREATIVE.userId!,
      { bytes: await makeJpegBytes(320, 320), mime: 'image/jpeg', consent: true },
    );
    const { renderId } = await makerAction(
      { sql: h.sql, store, storage },
      CREATIVE,
      { action: 'test', id: testedFormatId },
      { creators: true },
    );
    await h.sql.query(
      "update render_jobs set status='succeeded', result_key=$2, result_mime='image/jpeg', share_token=id::text, share_expires_at=now(), finished_at=now() where id=$1",
      [renderId, `${renderId}/result.jpg`],
    );

    // Attempting to swap the tested draft's prompt while publishing via formatId is rejected with test_required
    await expect(
      createUnlistedMakeCard({ sql: h.sql, store, storage }, CREATIVE.userId!, {
        formatId: testedFormatId,
        title: 'Tested Image Scene',
        workId: imageWork.work.id,
        kind: 'image',
        prompt: 'Completely different untested prompt starring [내 사진] in snow.',
        aspect: '4:5',
        royaltyKrw: 500,
        rightsConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: 'test_required' });

    const publishedImageCard = await createUnlistedMakeCard(
      { sql: h.sql, store, storage },
      CREATIVE.userId!,
      {
        formatId: testedFormatId,
        title: 'Tested Image Scene',
        workId: imageWork.work.id,
        kind: 'image',
        prompt: 'Editorial portrait starring [내 사진] under studio key light.',
        aspect: '4:5',
        royaltyKrw: 500,
        rightsConfirmed: true,
      },
    );
    expect(publishedImageCard.slug).toContain('tested-image-scene');

    // 4. Mints unlisted video make-card #2 and #3 (consuming remaining 2 of 3 daily new formats; testedFormatId was #1)
    const created = await createUnlistedMakeCard(
      { sql: h.sql, store, storage },
      CREATIVE.userId!,
      {
        title: 'Interstellar Alley Twist',
        titleKo: '인터스텔라 반전 골목 씬',
        workId: videoWork.work.id,
        kind: 'video',
        prompt: '16:9 35mm cinema scene starring [내 사진] in a gritty Chicago alley.',
        aspect: '16:9',
        duration: 10,
        royaltyKrw: 1000,
        rightsConfirmed: true,
      },
    );
    expect(created.slug).toContain('interstellar-alley-twist');

    const third = await createUnlistedMakeCard(
      { sql: h.sql, store, storage },
      CREATIVE.userId!,
      {
        title: 'Third Daily Format',
        workId: videoWork.work.id,
        kind: 'video',
        prompt: '16:9 cinema scene starring [내 사진] walking through neon mist.',
        aspect: '16:9',
        duration: 8,
        royaltyKrw: 0,
        rightsConfirmed: true,
      },
    );
    expect(third.slug).toContain('third-daily-format');

    // 5. Enforces 3-per-day MAKER_DRAFTS_PER_DAY cap on 4th format within 24h
    await expect(
      createUnlistedMakeCard({ sql: h.sql, store, storage }, CREATIVE.userId!, {
        title: 'Fourth Over Daily Cap',
        workId: videoWork.work.id,
        kind: 'video',
        prompt: '16:9 cinema scene starring [내 사진] over the daily limit.',
        rightsConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: 'limit_reached', detail: 'make_limit_reached' });

    // Verify rights_at is stamped and catalog_listed = false on both tables
    const formatCheck = (
      await h.sql.query<{ status: string; rights_at: unknown; catalog_listed: boolean }>(
        'select status, rights_at, catalog_listed from platform_formats where id = $1',
        [created.formatId],
      )
    ).rows[0]!;
    expect(formatCheck.status).toBe('accepted');
    expect(formatCheck.rights_at).toBeTruthy();
    expect(formatCheck.catalog_listed).toBe(false);

    // Direct column filter (partial index predicate) used in loadPublishedPrompts
    const queriesSeen: string[] = [];
    const spySql = {
      query: async (text: string, params?: unknown[]) => {
        queriesSeen.push(text);
        return h.sql.query(text, params as never);
      },
    };
    await loadPublishedPrompts(spySql as never);
    expect(queriesSeen.some((q) => q.includes('and catalog_listed = true') && !q.includes("'catalog_listed'"))).toBe(
      true,
    );

    const publicCatalog = await loadPromptCatalog(h.sql, { publicUrl: (k) => `/media/${k}` });
    expect(publicCatalog.video.some((c) => c.slug === created.slug)).toBe(false);
    expect(publicCatalog.image.some((c) => c.slug === publishedImageCard.slug)).toBe(false);

    const bySlug = await loadPromptCardsBySlugs(h.sql, [created.slug], { publicUrl: (k) => `/media/${k}` });
    expect(bySlug).toHaveLength(1);
    expect(bySlug[0]).toMatchObject({
      slug: created.slug,
      authorHandle: 'yagi',
      medium: 'video',
      aspectDefault: '16:9',
    });

    const ownCards = await loadMakerPublishedCards(h.sql, CREATIVE.userId!, { publicUrl: (k) => `/media/${k}` });
    expect(ownCards.some((c) => c.slug === created.slug)).toBe(true);

    // 6. Blocks third-party unlisted template embedding & redirect hijacking
    const otherSaved = await saveMakerPost(h.sql, OTHER_CREATIVE.userId!, {
      title: 'Attempted Hijack Post',
      summary: null,
      coverWorkId: null,
      blocks: [
        { type: 'heading', text: 'Hijack' },
        { type: 'template', slug: created.slug },
      ],
    });
    await expect(
      publishMakerPost(h.sql, OTHER_CREATIVE.userId!, otherSaved.post.id, { rightsConfirmed: true }),
    ).rejects.toMatchObject({ code: 'invalid_template' } satisfies Partial<PostError>);

    // Even if another creative embeds a LISTED template they do not own, findPrimaryBlogPostForTemplate ignores them
    const listedSlug = publicCatalog.video[0]!.slug;
    const otherListedPost = await saveMakerPost(h.sql, OTHER_CREATIVE.userId!, {
      title: 'Other Maker Referencing Studio Template',
      summary: null,
      coverWorkId: null,
      blocks: [
        { type: 'heading', text: 'Reference' },
        { type: 'template', slug: listedSlug },
      ],
    });
    await publishMakerPost(h.sql, OTHER_CREATIVE.userId!, otherListedPost.post.id, { rightsConfirmed: true });
    expect(await findPrimaryBlogPostForTemplate(h.sql, listedSlug)).toBeNull();

    // Author's own post resolves as primary post for redirect
    const savedPost = await saveMakerPost(h.sql, CREATIVE.userId!, {
      title: '인터스텔라 16:9 반전 필름 제작 가이드',
      summary: 'Seedance 2.5 실전 컷 구성과 사운드 마스터링 노트',
      coverWorkId: videoWork.work.id,
      blocks: [
        { type: 'heading', text: '1. 제작 구조' },
        { type: 'media', workId: videoWork.work.id, caption: '최종 마스터' },
        { type: 'template', slug: created.slug },
      ],
    });
    await publishMakerPost(h.sql, CREATIVE.userId!, savedPost.post.id, {
      rightsConfirmed: true,
    });

    expect(await findPrimaryBlogPostForTemplate(h.sql, created.slug)).toEqual({
      handle: 'yagi',
      slug: savedPost.post.slug,
    });

    const dict = getDictionary('ko');
    const cardHtml = renderToStaticMarkup(
      <BlogMakeCard
        item={{
          slug: created.slug,
          title: '인터스텔라 반전 골목 씬',
          authorHandle: 'yagi',
          mediumLabel: '영상',
          runtimeLabel: '10초',
          aspect: '16:9',
          posterSrc: null,
          videoSrc: '/media/example.mp4',
        }}
        subtitle={dict.makerBlog.makeCardSubtitle}
        ctaLabel={dict.makerBlog.makeCardCta}
      />,
    );
    expect(cardHtml).toContain(`data-maker-blog-make-card="${created.slug}"`);
    expect(cardHtml).toContain(dict.makerBlog.makeCardCta);
    expect(cardHtml).not.toContain('autoplay');
    expect(cardHtml).not.toContain(String(created.priceKrw));
  });

  it('preserves full flag-off parity when TWINGS_MAKER_BLOG is off', async () => {
    const videoBytes = makeMp4Bytes(1024, 7);
    const work = await storeMakerWork(h.sql, store, {
      userId: CREATIVE.userId!,
      bytes: videoBytes,
      title: 'Flag Parity Film',
    });

    // Inject a store whose url() WOULD return a signed R2 URL if called
    const r2LikeStore: RenderStore = {
      ...store,
      name: 'r2',
      async url(key) {
        return `https://r2-signed.example.test/${encodeURIComponent(key)}`;
      },
    };
    const storeCache = ((globalThis as Record<string, unknown>).__playbookRenderStore ??= {
      store: null,
    }) as { store: RenderStore | null };
    storeCache.store = r2LikeStore;

    // With TWINGS_MAKER_BLOG=on -> 307 redirect to signed R2 URL
    const onRes = await creativeMediaRoute(new Request(`https://twings.app/creative-media/${work.work.id}.mp4`), {
      params: Promise.resolve({ file: `${work.work.id}.mp4` }),
    });
    expect(onRes.status).toBe(307);

    // Flip TWINGS_MAKER_BLOG off -> presign, complete, make-card, and makerAction(catalogListed:false) are gated off
    vi.stubEnv('TWINGS_MAKER_BLOG', 'off');

    await expect(
      makerAction(
        { sql: h.sql, store, storage: createLocalStorageDriver(join(root, 'pub2')) },
        CREATIVE,
        { action: 'publish', id: randomUUID(), rights: true, catalogListed: false },
        { creators: true },
      ),
    ).rejects.toMatchObject({ code: 'not_open' });

    const reqInit = {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    };
    expect((await presignRoute(new Request('http://localhost:3000/api/makers/works/presign', reqInit))).status).toBe(
      404,
    );
    expect((await completeRoute(new Request('http://localhost:3000/api/makers/works/complete', reqInit))).status).toBe(
      404,
    );
    expect(
      (await makeCardRoute(new Request('http://localhost:3000/api/makers/posts/make-card', reqInit))).status,
    ).toBe(404);

    const offPublicRes = await creativeMediaRoute(
      new Request(`https://twings.app/creative-media/${work.work.id}.mp4`),
      { params: Promise.resolve({ file: `${work.work.id}.mp4` }) },
    );
    expect(offPublicRes.status).toBe(200);
    expect(offPublicRes.headers.get('Accept-Ranges')).toBe('bytes');
    expect((await offPublicRes.arrayBuffer()).byteLength).toBe(videoBytes.byteLength);

    const offStudioRes = await makerMediaRoute(
      new Request(`https://twings.app/api/makers/media/${work.work.id}`, {
        headers: { Range: 'bytes=0-15' },
      }),
      { params: Promise.resolve({ id: work.work.id }) },
    );
    expect(offStudioRes.status).toBe(206);
    expect((await offStudioRes.arrayBuffer()).byteLength).toBe(16);
  });

  it('enforces durable maker_work_uploads leases, 30/hr cap, retryable time-bounded sweep, and fail-closed 0210 check', async () => {
    expect(await makerWorkUploadsReady(h.sql)).toBe(true);
    expect(BLOG_MAKER_WORKS_MAX_BYTES).toBe(500 * 1024 * 1024);
    expect(PRESIGN_HOURLY_LIMIT).toBe(30);
    expect(UPLOAD_STORAGE_KEY.test(`${CREATIVE.userId!}/upl_${'a'.repeat(32)}.mp4`)).toBe(true);
    expect(UPLOAD_STORAGE_KEY.test(`${CREATIVE.userId!}/wrk_${'a'.repeat(32)}.mp4`)).toBe(false);
    expect(UPLOAD_STORAGE_KEY.test(`${CREATIVE.userId!}/result.mp4`)).toBe(false);

    const presignStore: RenderStore = {
      ...store,
      name: 'r2',
      async signedUploadUrl(key) {
        return `https://r2.example.test/upload/${encodeURIComponent(key)}`;
      },
    };

    // 1. Mint 10 unuploaded 1 MB leases (PRESIGN_PENDING_MAX = 10) with zero objects uploaded yet
    const oneMb = 1024 * 1024;
    const leases: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const res = await presignMakerWorkUpload(h.sql, presignStore, {
        userId: CREATIVE.userId!,
        mime: 'video/mp4',
        bytes: oneMb,
      });
      expect(res.mode).toBe('presigned');
      if (res.mode === 'presigned') leases.push(res.uploadId);
    }
    expect(leases).toHaveLength(10);

    // Simulate a fresh serverless instance cold start: DB ledger still blocks the 11th unuploaded presign
    resetPresignRateLimits();
    await expect(
      presignMakerWorkUpload(h.sql, presignStore, {
        userId: CREATIVE.userId!,
        mime: 'video/mp4',
        bytes: oneMb,
      }),
    ).rejects.toMatchObject({ code: 'limit_reached' });

    // 2. Failed /complete calls (before uploading or with mismatched mime) never release active lease slots
    await expect(
      completeMakerWorkUpload(h.sql, presignStore, {
        userId: CREATIVE.userId!,
        uploadId: leases[0]!,
        mime: 'video/mp4',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      completeMakerWorkUpload(h.sql, presignStore, {
        userId: CREATIVE.userId!,
        uploadId: leases[0]!,
        mime: 'image/jpeg',
      }),
    ).rejects.toMatchObject({ code: 'bad_file' });
    await expect(
      presignMakerWorkUpload(h.sql, presignStore, {
        userId: CREATIVE.userId!,
        mime: 'video/mp4',
        bytes: oneMb,
      }),
    ).rejects.toMatchObject({ code: 'limit_reached' });

    // 3. Rejects unrecorded uploadId, cross-user uploadId, and byte-length mismatch
    const unrecordedId = `upl_${'9'.repeat(32)}`;
    await store.put(`${CREATIVE.userId!}/${unrecordedId}.mp4`, makeMp4Bytes(1024, 11), 'video/mp4');
    await expect(
      completeMakerWorkUpload(h.sql, presignStore, {
        userId: CREATIVE.userId!,
        uploadId: unrecordedId,
        mime: 'video/mp4',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });

    const firstRawKey = `${CREATIVE.userId!}/${leases[0]!}.mp4`;
    await store.put(firstRawKey, makeMp4Bytes(oneMb + 512, 12), 'video/mp4');
    await expect(
      completeMakerWorkUpload(h.sql, presignStore, {
        userId: CREATIVE.userId!,
        uploadId: leases[0]!,
        mime: 'video/mp4',
      }),
    ).rejects.toMatchObject({ code: 'bad_file' });
    expect(await store.head!(firstRawKey)).toBeNull();

    // Upload exact leased byte length: other creative is rejected, owner consumes lease once
    await store.put(firstRawKey, makeMp4Bytes(oneMb, 13), 'video/mp4');
    await expect(
      completeMakerWorkUpload(h.sql, presignStore, {
        userId: OTHER_CREATIVE.userId!,
        uploadId: leases[0]!,
        mime: 'video/mp4',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });

    const done = await completeMakerWorkUpload(h.sql, presignStore, {
      userId: CREATIVE.userId!,
      uploadId: leases[0]!,
      mime: 'video/mp4',
      title: 'Leased 1MB Clip',
    });
    expect(WORK_ID.test(done.work.id)).toBe(true);
    expect(await store.head!(firstRawKey)).toBeNull();

    // Second /complete on the same uploadId is rejected even if bytes are re-uploaded
    await store.put(firstRawKey, makeMp4Bytes(oneMb, 14), 'video/mp4');
    await expect(
      completeMakerWorkUpload(h.sql, presignStore, {
        userId: CREATIVE.userId!,
        uploadId: leases[0]!,
        mime: 'video/mp4',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });

    // 4. Transient store.delete errors do NOT stamp swept_at, preserving retry; budgetMs bounds each pass
    const abandonedKey = `${CREATIVE.userId!}/${leases[1]!}.mp4`;
    await store.put(abandonedKey, makeMp4Bytes(2048, 15), 'video/mp4');
    await h.sql.query(`update maker_work_uploads set expires_at = now() - interval '10 minutes'`);

    const failingStore: RenderStore = {
      ...store,
      async delete() {
        throw new Error('transient R2 503');
      },
    };
    const failedSweep = await sweepExpiredMakerWorkUploads(h.sql, failingStore, { graceSeconds: 60 });
    expect(failedSweep).toEqual({ swept: 0, pruned: 0 });
    expect((await store.head!(abandonedKey))?.bytes).toBe(2048);

    // Wall-clock budgetMs stops early after 1 deletion when clock advances past deadline
    let fakeNow = 1_000;
    const budgetedStore: RenderStore = {
      ...store,
      async delete(k) {
        await store.delete!(k);
        fakeNow += 6_000;
      },
    };
    const partialSweep = await sweepExpiredMakerWorkUploads(h.sql, budgetedStore, {
      graceSeconds: 60,
      budgetMs: 5_000,
      now: () => fakeNow,
    });
    expect(partialSweep).toEqual({ swept: 1, pruned: 0 });

    // Next tick drains the remaining 9 expired rows
    const sweepRes = await sweepExpiredMakerWorkUploads(h.sql, store, { graceSeconds: 60 });
    expect(sweepRes).toEqual({ swept: 9, pruned: 0 });
    expect(await store.head!(abandonedKey)).toBeNull();
    expect(await store.head!(firstRawKey)).toBeNull();
    expect((await store.head!(`${CREATIVE.userId!}/${done.work.id}.mp4`))?.bytes).toBe(oneMb);

    // Swept rows older than 7 days are pruned cleanly
    await h.sql.query(`update maker_work_uploads set created_at = now() - interval '8 days'`);
    const pruneRes = await sweepExpiredMakerWorkUploads(h.sql, store, { graceSeconds: 60 });
    expect(pruneRes).toEqual({ swept: 0, pruned: 10 });

    // 5. Cumulative byte cap (maker_works + active unuploaded leases <= 500 MB) enforced atomically
    const fiftyMb = 50 * 1024 * 1024;
    for (let i = 0; i < 9; i += 1) {
      const res = await presignMakerWorkUpload(h.sql, presignStore, {
        userId: CREATIVE.userId!,
        mime: 'video/mp4',
        bytes: fiftyMb,
      });
      expect(res.mode).toBe('presigned');
    }
    // 1 MB committed + 9 * 50 MB active = 451 MB; 10th 50 MB lease (501 MB > 500 MB) is blocked despite active = 9 < 10
    await expect(
      presignMakerWorkUpload(h.sql, presignStore, {
        userId: CREATIVE.userId!,
        mime: 'video/mp4',
        bytes: fiftyMb,
      }),
    ).rejects.toMatchObject({ code: 'limit_reached' });

    // 6. Enforces 30/hour PRESIGN_HOURLY_LIMIT even when active leases expire (9 already minted in this hour -> mint 21 more = 30)
    await h.sql.query(`update maker_work_uploads set expires_at = now() - interval '10 minutes'`);
    for (let batch = 0; batch < 3; batch += 1) {
      const countInBatch = batch < 2 ? 10 : 1;
      for (let i = 0; i < countInBatch; i += 1) {
        const res = await presignMakerWorkUpload(h.sql, presignStore, {
          userId: CREATIVE.userId!,
          mime: 'video/mp4',
          bytes: 1024,
        });
        expect(res.mode).toBe('presigned');
      }
      await h.sql.query(`update maker_work_uploads set expires_at = now() - interval '10 minutes'`);
    }
    // 31st presign within the hour is blocked even though active = 0
    await expect(
      presignMakerWorkUpload(h.sql, presignStore, {
        userId: CREATIVE.userId!,
        mime: 'video/mp4',
        bytes: 1024,
      }),
    ).rejects.toMatchObject({ code: 'limit_reached' });

    // 7. Fails closed (WorkError 'unavailable' -> HTTP 503) if 0210 has not been applied yet
    await h.sql.query('drop table public.maker_work_uploads');
    expect(await makerWorkUploadsReady(h.sql)).toBe(false);
    expect(await sweepExpiredMakerWorkUploads(h.sql, store)).toEqual({ swept: 0, pruned: 0 });
    await expect(
      presignMakerWorkUpload(h.sql, presignStore, {
        userId: OTHER_CREATIVE.userId!,
        mime: 'video/mp4',
        bytes: 1024,
      }),
    ).rejects.toMatchObject({ code: 'unavailable' });
    await expect(
      completeMakerWorkUpload(h.sql, presignStore, {
        userId: OTHER_CREATIVE.userId!,
        uploadId: `upl_${'1'.repeat(32)}`,
        mime: 'video/mp4',
      }),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });
});
