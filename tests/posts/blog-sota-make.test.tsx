import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
  unstable_cache: <T,>(fn: T) => fn,
}));

import { getDictionary } from '@/lib/i18n/dictionaries';
import { isReservedMakerHandle, saveMakerProfile } from '@/lib/makers/profile';
import { activateOpenMaker } from '@/lib/makers/self-activate';
import {
  completeMakerWorkUpload,
  MAKER_WORK_VIDEO_MAX_BYTES,
  presignMakerWorkUpload,
  storeMakerWork,
} from '@/lib/makers/works';
import { createUnlistedMakeCard, normalizeBlogMakePrompt } from '@/lib/posts/make-card';
import { findPrimaryBlogPostForTemplate } from '@/lib/posts/public';
import { publishMakerPost, saveMakerPost } from '@/lib/posts/service';
import { loadMakerPublishedCards, loadPromptCardsBySlugs, loadPromptCatalog } from '@/lib/prompts/catalog';
import { createLocalRenderStore, type RenderStore } from '@/lib/renders/store';
import { createLocalStorageDriver } from '@/lib/storage/local-driver';
import { BlogMakeCard } from '@/components/posts/blog-make-studio';
import { viewerOf } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';

const CREATIVE = viewerOf('free');

function makeMp4Bytes(byteLength: number): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  bytes.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]); // ....ftypisom
  bytes[byteLength - 1] = byteLength & 0xff;
  return bytes;
}

describe('Blog SOTA media (50MB presign) & unlisted inline selfie make-card', () => {
  let h: PromptHarness;
  let root: string;
  let store: RenderStore;

  beforeEach(async () => {
    vi.stubEnv('TWINGS_MAKER_BLOG', 'on');
    h = await promptHarness();
    root = await mkdtemp(join(tmpdir(), 'twings-blog-sota-'));
    store = createLocalRenderStore(root);
    await activateOpenMaker(h.sql, CREATIVE, { rightsAgreed: true });
    await saveMakerProfile(h.sql, CREATIVE.userId!, {
      handle: 'yagi',
      displayName: 'Yagi Yun',
      publicProfile: true,
      links: ['https://www.instagram.com/yagi'],
    });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await h.close();
    await rm(root, { recursive: true, force: true });
  });

  it('allows @yagi handle while keeping studio impersonation handles reserved', () => {
    expect(isReservedMakerHandle('yagi')).toBe(false);
    expect(isReservedMakerHandle('twings')).toBe(true);
    expect(isReservedMakerHandle('admin')).toBe(true);
  });

  it('uploads >4.5MB 1080p MP4 via presigned R2 contract and deduplicates identical SHA-256', async () => {
    expect(MAKER_WORK_VIDEO_MAX_BYTES).toBe(50 * 1024 * 1024);

    const presignStore: RenderStore = {
      ...store,
      name: 'r2',
      async signedUploadUrl(key) {
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

    // Simulate browser PUT straight to R2
    await store.put(`${CREATIVE.userId!}/${presigned.uploadId}.mp4`, videoBytes, 'video/mp4');

    const completed = await completeMakerWorkUpload(h.sql, presignStore, {
      userId: CREATIVE.userId!,
      uploadId: presigned.uploadId,
      mime: 'video/mp4',
      title: 'Interstellar 1080p Master',
    });
    expect(completed.unchanged).toBe(false);
    expect(completed.work).toMatchObject({
      id: presigned.uploadId,
      kind: 'video',
      mime: 'video/mp4',
      title: 'Interstellar 1080p Master',
    });

    // Rejects >50MB video on presign
    await expect(
      presignMakerWorkUpload(h.sql, presignStore, {
        userId: CREATIVE.userId!,
        mime: 'video/mp4',
        bytes: MAKER_WORK_VIDEO_MAX_BYTES + 1,
      }),
    ).rejects.toMatchObject({ code: 'too_large' });
  });

  it('mints an unlisted creator make-card from a blog prompt, hides it from official catalog, and links it to the post', async () => {
    expect(normalizeBlogMakePrompt('Scene with [내 사진] walking in rain.')).toBe(
      'Scene with {{selfie}} walking in rain.',
    );
    expect(normalizeBlogMakePrompt('Scene with @Image 1 in cinema light.')).toBe(
      'Scene with {{selfie}} in cinema light.',
    );
    expect(normalizeBlogMakePrompt('Scene without selfie token.')).toBeNull();

    const storage = createLocalStorageDriver(join(root, 'public-storage'));
    const work = await storeMakerWork(h.sql, store, {
      userId: CREATIVE.userId!,
      bytes: makeMp4Bytes(1024),
      title: 'Example scene',
    });

    const created = await createUnlistedMakeCard(
      { sql: h.sql, store, storage },
      CREATIVE.userId!,
      {
        title: 'Interstellar Alley Twist',
        titleKo: '인터스텔라 반전 골목 씬',
        workId: work.work.id,
        kind: 'video',
        prompt: '16:9 35mm cinema scene starring [내 사진] in a gritty Chicago alley.',
        aspect: '16:9',
        duration: 10,
        royaltyKrw: 1000,
        rightsConfirmed: true,
      },
    );
    expect(created.slug).toContain('interstellar-alley-twist');
    expect(created.priceKrw).toBeGreaterThan(1000);

    // 1. Omitted from official storefront catalog (`catalog_listed = false`).
    const publicCatalog = await loadPromptCatalog(h.sql, { publicUrl: (k) => `/media/${k}` });
    expect(publicCatalog.video.some((c) => c.slug === created.slug)).toBe(false);

    // 2. Resolved by slug for blog posts & direct unlisted links, and visible in maker's own editor list.
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

    // 3. Embedded in a published blog post -> primary post lookup resolves @yagi's post for /t/[slug] redirect.
    const savedPost = await saveMakerPost(h.sql, CREATIVE.userId!, {
      title: '인터스텔라 16:9 반전 필름 제작 가이드',
      summary: 'Seedance 2.5 실전 컷 구성과 사운드 마스터링 노트',
      coverWorkId: work.work.id,
      blocks: [
        { type: 'heading', text: '1. 제작 구조' },
        { type: 'media', workId: work.work.id, caption: '최종 마스터' },
        { type: 'template', slug: created.slug },
      ],
    });
    await publishMakerPost(h.sql, CREATIVE.userId!, savedPost.post.id, {
      rightsConfirmed: true,
    });

    const primaryPost = await findPrimaryBlogPostForTemplate(h.sql, created.slug);
    expect(primaryPost).toEqual({
      handle: 'yagi',
      slug: savedPost.post.slug,
    });

    // 4. Inline BlogMakeCard renders no price on card, no autoplay, and #FF58AE CTA with #09090B ink.
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
});
