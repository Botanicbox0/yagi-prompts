import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
  unstable_cache: <T>(fn: T) => fn,
}));

import { PGlite } from '@electric-sql/pglite';
import { readMigration } from '@/lib/db/migrations';
import { administerPlatform } from '@/lib/creator-platform/admin';
import { activateOpenMaker } from '@/lib/makers/self-activate';
import { saveMakerProfile } from '@/lib/makers/profile';
import { storeMakerWork } from '@/lib/makers/works';
import {
  countPublicPostsByHandle,
  listPublicPostsByHandle,
  listPublicPostsForSitemap,
  listTemplateStories,
  loadMemberPostBlocks,
  loadPublicPostByHandleAndSlug,
  loadTemplateOriginalInstagram,
} from '@/lib/posts/public';
import { POST_MAX_NEW_PER_DAY, POST_MAX_PER_MAKER } from '@/lib/posts/schema';
import {
  PostError,
  postsReady,
} from '@/lib/posts/repo';
import {
  adminHidePost,
  adminRestorePost,
  deleteMakerPost,
  listMakerPosts,
  loadMakerPost,
  loadMakerTemplatesForImport,
  publishMakerPost,
  saveMakerPost,
  unpublishMakerPost,
} from '@/lib/posts/service';
import { createLocalRenderStore, type RenderStore } from '@/lib/renders/store';
import { ADMIN_VIEWER, viewerOf } from '@/tests/helpers/admin';
import { coreMigrationFiles, runner } from '@/tests/helpers/pglite';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';
import { FIXTURE_USERS } from '../../scripts/fixtures';

const CREATIVE = viewerOf('free');
const OTHER_CREATIVE = FIXTURE_USERS.pro;

async function jpegBytes(w = 120, h = 160): Promise<Uint8Array> {
  const buf = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 100, g: 130, b: 180 } } })
    .jpeg()
    .toBuffer();
  return new Uint8Array(buf);
}

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return error instanceof PostError ? error.code : String(error);
  }
}

describe('maker blog service & public readers', () => {
  let h: PromptHarness;
  let root: string;
  let store: RenderStore;
  let publishedSlug: string;
  let publishedId: string;

  beforeEach(async () => {
    h = await promptHarness();
    root = await mkdtemp(join(tmpdir(), 'twings-posts-'));
    store = createLocalRenderStore(root);
    vi.stubEnv('TWINGS_MAKER_BLOG', 'on');
    vi.stubEnv('TWINGS_FORMAT_CREATORS', 'on');

    await activateOpenMaker(h.sql, CREATIVE, { rightsAgreed: true });
    await saveMakerProfile(h.sql, CREATIVE.userId!, { handle: 'alpha_maker', publicProfile: true });

    await activateOpenMaker(h.sql, viewerOf('pro'), { rightsAgreed: true });
    await saveMakerProfile(h.sql, OTHER_CREATIVE.id, { handle: 'beta_maker', publicProfile: true });

    const pub = (
      await h.sql.query<{ id: string; slug: string }>(
        "select id, slug from prompt_items where status='published' and audience='public' limit 1",
      )
    ).rows[0]!;
    publishedId = pub.id;
    publishedSlug = pub.slug;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await h.close();
    await rm(root, { recursive: true, force: true });
  });

  it('refuses every write and returns empty public reads when TWINGS_MAKER_BLOG is not on', async () => {
    const saved = await saveMakerPost(h.sql, CREATIVE.userId!, {
      title: 'Korean film look',
      blocks: [{ type: 'text', text: 'Body paragraph.' }],
    });
    await publishMakerPost(h.sql, CREATIVE.userId!, saved.post.id, { rightsConfirmed: true });

    for (const flagVal of ['', 'off', 'true', '1']) {
      vi.stubEnv('TWINGS_MAKER_BLOG', flagVal);
      expect(await errorCode(saveMakerPost(h.sql, CREATIVE.userId!, { title: 'Blocked', blocks: [] }))).toBe('not_open');
      expect(await errorCode(publishMakerPost(h.sql, CREATIVE.userId!, saved.post.id, { rightsConfirmed: true }))).toBe(
        'not_open',
      );
      expect(await errorCode(unpublishMakerPost(h.sql, CREATIVE.userId!, saved.post.id))).toBe('not_open');
      expect(await errorCode(deleteMakerPost(h.sql, CREATIVE.userId!, saved.post.id))).toBe('not_open');
      expect(await errorCode(listMakerPosts(h.sql, CREATIVE.userId!))).toBe('not_open');

      expect(await listPublicPostsByHandle(h.sql, 'alpha_maker')).toEqual([]);
      expect(await countPublicPostsByHandle(h.sql, 'alpha_maker')).toBe(0);
      expect(await loadPublicPostByHandleAndSlug(h.sql, 'alpha_maker', saved.post.slug)).toBeNull();
      expect(await loadMemberPostBlocks(h.sql, 'alpha_maker', saved.post.slug)).toBeNull();
      expect(await listTemplateStories(h.sql, publishedId)).toEqual([]);
      expect(await listPublicPostsForSitemap(h.sql)).toEqual([]);
    }
  });

  it('enforces creativeGate, ownership, work ownership, and template publish checks', async () => {
    // Non-creator account refused
    const strangerId = FIXTURE_USERS.admin.id;
    expect(await errorCode(saveMakerPost(h.sql, strangerId, { title: 'Stranger', blocks: [] }))).toBe('forbidden');

    // Revoked creator refused
    await administerPlatform(h.sql, ADMIN_VIEWER, {
      action: 'creator',
      id: OTHER_CREATIVE.id,
      active: false,
      contract: 'owl-p-v1',
      reason: 'Suspended for test',
    });
    expect(await errorCode(saveMakerPost(h.sql, OTHER_CREATIVE.id, { title: 'Revoked', blocks: [] }))).toBe('forbidden');

    // Re-activate OTHER_CREATIVE for ownership tests
    await administerPlatform(h.sql, ADMIN_VIEWER, {
      action: 'creator',
      id: OTHER_CREATIVE.id,
      active: true,
      contract: 'owl-p-v1',
      reason: 'Reinstated for test',
    });

    const otherWork = (await storeMakerWork(h.sql, store, { userId: OTHER_CREATIVE.id, bytes: await jpegBytes() })).work;
    const ownWork = (await storeMakerWork(h.sql, store, { userId: CREATIVE.userId!, bytes: await jpegBytes(140, 180) })).work;

    // Using someone else's workId is refused
    expect(
      await errorCode(
        saveMakerPost(h.sql, CREATIVE.userId!, {
          title: 'Stolen cover',
          coverWorkId: otherWork.id,
          blocks: [{ type: 'text', text: 'Body' }],
        }),
      ),
    ).toBe('invalid_work');
    expect(
      await errorCode(
        saveMakerPost(h.sql, CREATIVE.userId!, {
          title: 'Stolen media',
          blocks: [{ type: 'media', workId: otherWork.id }],
        }),
      ),
    ).toBe('invalid_work');

    // Save draft with own work and Korean title (auto hex slug)
    const draft = await saveMakerPost(h.sql, CREATIVE.userId!, {
      title: '서울 야경 조명 정리',
      coverWorkId: ownWork.id,
      blocks: [],
    });
    expect(draft.created).toBe(true);
    expect(draft.post.slug).toMatch(/^p-[0-9a-f]{8}$/);
    expect(draft.post.status).toBe('draft');

    // Empty blocks cannot be published; missing rights refused
    expect(await errorCode(publishMakerPost(h.sql, CREATIVE.userId!, draft.post.id, { rightsConfirmed: false }))).toBe(
      'rights_required',
    );
    expect(await errorCode(publishMakerPost(h.sql, CREATIVE.userId!, draft.post.id, { rightsConfirmed: true }))).toBe(
      'empty_blocks',
    );

    // Other maker cannot edit, publish, unpublish, or delete CREATIVE's post
    expect(
      await errorCode(
        saveMakerPost(h.sql, OTHER_CREATIVE.id, {
          id: draft.post.id,
          title: 'Hijacked',
          blocks: [{ type: 'text', text: 'Mine' }],
        }),
      ),
    ).toBe('not_found');
    expect(await errorCode(publishMakerPost(h.sql, OTHER_CREATIVE.id, draft.post.id, { rightsConfirmed: true }))).toBe(
      'not_found',
    );
    expect(await errorCode(deleteMakerPost(h.sql, OTHER_CREATIVE.id, draft.post.id))).toBe('not_found');

    // Non-existent / non-published template slug refused on publish
    await saveMakerPost(h.sql, CREATIVE.userId!, {
      id: draft.post.id,
      title: '서울 야경 조명 정리',
      coverWorkId: ownWork.id,
      blocks: [{ type: 'template', slug: 'no-such-template-slug' }],
    });
    expect(await errorCode(publishMakerPost(h.sql, CREATIVE.userId!, draft.post.id, { rightsConfirmed: true }))).toBe(
      'invalid_template',
    );
  });

  it('publishes, hides secret prompt fields from public reader, unpublishes, deletes drafts, and enforces hidden lock', async () => {
    const ownWork = (await storeMakerWork(h.sql, store, { userId: CREATIVE.userId!, bytes: await jpegBytes() })).work;
    const saved = await saveMakerPost(h.sql, CREATIVE.userId!, {
      title: 'Rainy Neon Breakdown',
      summary: 'Three camera beats.',
      coverWorkId: ownWork.id,
      blocks: [
        { type: 'heading', text: 'Setup' },
        { type: 'text', text: 'Place the subject under cool signage.' },
        {
          type: 'prompt',
          title: 'Beat 1 — Arrival',
          kind: 'video',
          meta: 'Video · 9:16 · 4s',
          prompt: 'SECRET_FULL_PROMPT_TEXT_that_only_members_read',
          note: 'SECRET_CREATOR_TIP_only_members_read',
        },
        { type: 'template', slug: publishedSlug },
      ],
    });

    // Public reader sees nothing while draft
    expect(await loadPublicPostByHandleAndSlug(h.sql, 'alpha_maker', saved.post.slug)).toBeNull();
    expect(await loadMemberPostBlocks(h.sql, 'alpha_maker', saved.post.slug)).toBeNull();

    // Publish
    const pub = await publishMakerPost(h.sql, CREATIVE.userId!, saved.post.id, { rightsConfirmed: true });
    expect(pub.status).toBe('published');
    expect(pub.publishedAt).not.toBeNull();

    // Published post cannot be deleted directly
    expect(await errorCode(deleteMakerPost(h.sql, CREATIVE.userId!, pub.id))).toBe('not_draft');

    // Public reader omits prompt text, meta, and tip
    const publicView = await loadPublicPostByHandleAndSlug(h.sql, 'alpha_maker', pub.slug);
    expect(publicView).not.toBeNull();
    expect(JSON.stringify(publicView)).not.toContain('SECRET_FULL_PROMPT_TEXT');
    expect(JSON.stringify(publicView)).not.toContain('SECRET_CREATOR_TIP');
    expect(JSON.stringify(publicView)).not.toContain('Video · 9:16 · 4s');
    expect(publicView?.blocks[2]).toEqual({ type: 'prompt', title: 'Beat 1 — Arrival', kind: 'video' });

    // Member reader gets full prompt, meta, and tip
    const memberBlocks = await loadMemberPostBlocks(h.sql, 'alpha_maker', pub.slug);
    expect(memberBlocks?.prompts).toEqual([
      {
        type: 'prompt',
        title: 'Beat 1 — Arrival',
        kind: 'video',
        meta: 'Video · 9:16 · 4s',
        prompt: 'SECRET_FULL_PROMPT_TEXT_that_only_members_read',
        note: 'SECRET_CREATOR_TIP_only_members_read',
      },
    ]);

    // Admin hide locks the post so maker cannot republish or edit
    await adminHidePost(h.sql, ADMIN_VIEWER, { id: pub.id, reason: 'Off-topic spam test' });
    expect(await loadPublicPostByHandleAndSlug(h.sql, 'alpha_maker', pub.slug)).toBeNull();
    expect(await errorCode(publishMakerPost(h.sql, CREATIVE.userId!, pub.id, { rightsConfirmed: true }))).toBe(
      'hidden_locked',
    );
    expect(
      await errorCode(
        saveMakerPost(h.sql, CREATIVE.userId!, {
          id: pub.id,
          title: 'Try bypass',
          blocks: [{ type: 'text', text: 'Bypass attempt' }],
        }),
      ),
    ).toBe('hidden_locked');
    expect(await errorCode(unpublishMakerPost(h.sql, CREATIVE.userId!, pub.id))).toBe('hidden_locked');

    // Admin restore restores published status; maker can unpublish and delete draft
    const restored = await adminRestorePost(h.sql, ADMIN_VIEWER, { id: pub.id, reason: 'Cleared on review' });
    expect(restored.status).toBe('published');
    const unpublished = await unpublishMakerPost(h.sql, CREATIVE.userId!, pub.id);
    expect(unpublished.status).toBe('draft');

    // A post its author took down is not hidden, and restore never publishes it again.
    expect(await errorCode(adminHidePost(h.sql, ADMIN_VIEWER, { id: pub.id, reason: 'Hide a draft' }))).toBe('invalid');
    expect(await errorCode(adminRestorePost(h.sql, ADMIN_VIEWER, { id: pub.id, reason: 'Restore a draft' }))).toBe('invalid');
    expect((await loadMakerPost(h.sql, CREATIVE.userId!, pub.id))?.status).toBe('draft');
    expect(await loadPublicPostByHandleAndSlug(h.sql, 'alpha_maker', pub.slug)).toBeNull();

    await deleteMakerPost(h.sql, CREATIVE.userId!, pub.id);
    expect(await loadMakerPost(h.sql, CREATIVE.userId!, pub.id)).toBeNull();
  });

  it('restricts template stories to posts written by the template owner only', async () => {
    // Assign publishedId to CREATIVE
    await h.sql.query('update prompt_items set author_id = $2 where id = $1', [publishedId, CREATIVE.userId!]);

    const ownerPost = await saveMakerPost(h.sql, CREATIVE.userId!, {
      title: 'Owner Story',
      blocks: [{ type: 'template', slug: publishedSlug }],
    });
    await publishMakerPost(h.sql, CREATIVE.userId!, ownerPost.post.id, { rightsConfirmed: true });

    const otherPost = await saveMakerPost(h.sql, OTHER_CREATIVE.id, {
      title: 'Other Maker Post Linking Same Template',
      blocks: [{ type: 'template', slug: publishedSlug }],
    });
    await publishMakerPost(h.sql, OTHER_CREATIVE.id, otherPost.post.id, { rightsConfirmed: true });

    const stories = await listTemplateStories(h.sql, publishedId, 3);
    expect(stories).toHaveLength(1);
    expect(stories[0]!.handle).toBe('alpha_maker');
    expect(stories[0]!.title).toBe('Owner Story');
  });

  it('enforces daily (5/day) and total (50) post caps', async () => {
    for (let i = 0; i < POST_MAX_NEW_PER_DAY; i += 1) {
      await saveMakerPost(h.sql, CREATIVE.userId!, {
        title: `Post ${i + 1}`,
        blocks: [{ type: 'text', text: 'Body' }],
      });
    }
    expect(
      await errorCode(
        saveMakerPost(h.sql, CREATIVE.userId!, {
          title: 'Post 6 same day',
          blocks: [{ type: 'text', text: 'Body' }],
        }),
      ),
    ).toBe('limit_reached');

    // Backdate existing posts past 24h and fill up to 50 total
    await h.sql.query("update creator_posts set created_at = now() - interval '2 days' where user_id = $1", [
      CREATIVE.userId!,
    ]);
    for (let i = POST_MAX_NEW_PER_DAY; i < POST_MAX_PER_MAKER; i += 1) {
      await h.sql.query(
        `insert into creator_posts(id, user_id, slug, title, blocks, status, created_at)
         values($1, $2, $3, $4, '[]'::jsonb, 'draft', now() - interval '3 days')`,
        [randomUUID(), CREATIVE.userId!, `bulk-${i}`, `Bulk post ${i}`],
      );
    }
    expect(
      await errorCode(
        saveMakerPost(h.sql, CREATIVE.userId!, {
          title: 'Post 51 over total cap',
          blocks: [{ type: 'text', text: 'Body' }],
        }),
      ),
    ).toBe('limit_reached');
  });

  it('imports guide clips from owned published templates with buyer-readable placeholders', async () => {
    const recipe = {
      version: 2,
      slots: { selfie: { kind: 'image', source: 'user', required: true } },
      steps: [
        {
          id: 'still',
          kind: 'image',
          engine: 'gpt-image-2',
          inputs: ['selfie'],
          prompt: 'Studio portrait of {{selfie}} in daylight.',
          params: { aspect: '4:5' },
        },
      ],
      output: { from: 'still' },
      guide: [
        {
          title: 'Beat 1',
          kind: 'video',
          meta: 'Video · 9:16 · 4s',
          prompt: 'Opening shot with {{selfie}} and {{still}}.',
          note: 'Keep light soft.',
        },
      ],
    };
    await h.sql.query('update prompt_items set author_id = $2, recipe = $3::jsonb where id = $1', [
      publishedId,
      CREATIVE.userId!,
      JSON.stringify(recipe),
    ]);

    const templates = await loadMakerTemplatesForImport(h.sql, CREATIVE.userId!, {
      selfie: '내 사진',
      reference: '참조 {n}',
      step: '{n}단계 결과',
    });
    expect(templates).toHaveLength(1);
    expect(templates[0]!.slug).toBe(publishedSlug);
    expect(templates[0]!.clips[0]!.prompt).toBe('Opening shot with [내 사진] and [1단계 결과].');
    expect(templates[0]!.clips[0]!.note).toBe('Keep light soft.');
  });

  it('degrades gracefully when 0198 tables are absent in an older database', async () => {
    const pre = new PGlite();
    await pre.exec('create schema if not exists auth; create table if not exists auth.users (id uuid primary key);');
    for (const file of coreMigrationFiles().filter((f) => f < '0198')) {
      await pre.exec(readMigration(file));
    }
    const preSql = runner(pre);
    try {
      await preSql.query('insert into auth.users (id) values ($1)', [CREATIVE.userId!]);
      await preSql.query(
        'insert into profiles (id, email, display_name, locale, plan, is_admin) values ($1, $2, $3, $4, $5, $6)',
        [CREATIVE.userId!, CREATIVE.email!, 'Pre Creative', 'ko', 'free', false],
      );
      await activateOpenMaker(preSql, CREATIVE, { rightsAgreed: true });

      expect(await postsReady(preSql)).toBe(false);
      expect(await listPublicPostsByHandle(preSql, 'alpha_maker')).toEqual([]);
      expect(await countPublicPostsByHandle(preSql, 'alpha_maker')).toBe(0);
      expect(await loadPublicPostByHandleAndSlug(preSql, 'alpha_maker', 'any-slug')).toBeNull();
      expect(await loadMemberPostBlocks(preSql, 'alpha_maker', 'any-slug')).toBeNull();
      expect(await listTemplateStories(preSql, publishedId)).toEqual([]);
      expect(await listPublicPostsForSitemap(preSql)).toEqual([]);
      expect(await loadTemplateOriginalInstagram(preSql, publishedId)).toBeNull();
      expect(await errorCode(saveMakerPost(preSql, CREATIVE.userId!, { title: 'Test', blocks: [] }))).toBe(
        'unavailable',
      );
    } finally {
      await pre.close();
    }
  });
});
