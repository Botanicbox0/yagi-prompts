import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_OPERATION_NAMES } from '@/lib/admin/operations';
import { PROMPT_OPERATIONS } from '@/lib/admin/prompt-operations';
import { dispatchAdmin } from '@/lib/admin/dispatch';
import { loadPromptById, loadPromptBySlug, loadPublishedPrompts } from '@/lib/prompts/repo';
import { parsePromptMedia } from '@/lib/prompts/schemas';
import { seedPrompts } from '../../scripts/seed';
import { FIXTURE_USERS } from '../../scripts/fixtures';
import { adminHarness, formOf, upload, viewerOf, type AdminHarness } from '../helpers/admin';
import { runner } from '../helpers/pglite';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

/**
 * PLAN §13.2/F — moderation and authoring, through the M4 dispatcher.
 *
 * The operations were added to the EXISTING registry rather than to a second one, so
 * `tests/admin/auth.test.ts` already refuses every one of them for a non-admin without being told
 * they exist. This file covers what that test cannot: that they do the right thing when an admin
 * runs them, and that the right cache tag moves.
 */
describe('prompt moderation operations (§13.2/F)', () => {
  let harness: AdminHarness;

  beforeEach(async () => {
    harness = await adminHarness();
    const sql = runner(harness.db);
    for (const user of Object.values(FIXTURE_USERS)) {
      await sql.query('insert into auth.users (id) values ($1) on conflict (id) do nothing', [user.id]);
      await sql.query(
        `insert into profiles (id, email, display_name, locale, plan, is_admin)
         values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing`,
        [user.id, user.email, user.displayName, user.locale, user.plan, user.isAdmin],
      );
    }
    await seedPrompts({ sql, storage: harness.storage });
  });

  afterEach(async () => harness.close());

  const sql = () => runner(harness.db);

  it('joins the ONE registry the auth matrix enumerates', () => {
    for (const name of Object.keys(PROMPT_OPERATIONS)) {
      expect(ADMIN_OPERATION_NAMES, name).toContain(name);
    }
    expect(ADMIN_OPERATION_NAMES.length).toBeGreaterThanOrEqual(27);
  });

  // --- approval -----------------------------------------------------------

  it('approves a pending submission, publishes its media, and moves the prompts tag', async () => {
    const pending = (await loadPromptBySlug(sql(), 'pending-underwater-drift'))!;
    const before = parsePromptMedia(pending.media);
    expect(before.video?.published_key).toBeUndefined();

    const outcome = await harness.run('prompt.approve', {
      id: pending.id,
      slug: 'underwater-drift',
      handle: '@hana',
      useCase: ['cinematic', 'mv'],
      featured: 'on',
    });
    expect(outcome).toMatchObject({ ok: true, code: 'approved', detail: 'underwater-drift' });

    const after = (await loadPromptById(sql(), pending.id))!;
    expect(after.status).toBe('published');
    expect(after.slug).toBe('underwater-drift');
    expect(after.authorHandle).toBe('hana');
    expect(after.useCase.sort()).toEqual(['cinematic', 'mv']);
    expect(after.featured).toBe(true);

    // §13.1: the copy to public keys happens AT APPROVAL, never before.
    const media = parsePromptMedia(after.media);
    expect(media.video?.bucket).toBe('public-content');
    expect(await harness.storage.exists('public-content', media.video!.published_key!)).toBe(true);

    expect(harness.promptsRevalidated).toBe(1);
    expect(harness.revalidated).toBe(0);
  });

  it('drops a use case that is not in the vocabulary rather than storing it', async () => {
    const pending = (await loadPromptBySlug(sql(), 'pending-underwater-drift'))!;
    await harness.run('prompt.approve', {
      id: pending.id,
      slug: 'underwater-drift',
      handle: '',
      useCase: ['cinematic', 'deepfake'],
      featured: '',
    });
    expect((await loadPromptById(sql(), pending.id))!.useCase).toEqual(['cinematic']);
  });

  // --- rejection ----------------------------------------------------------

  it('rejects with a reason, and does NOT touch the prompts cache', async () => {
    const pending = (await loadPromptBySlug(sql(), 'pending-underwater-drift'))!;
    const outcome = await harness.run('prompt.reject', {
      id: pending.id,
      reason: 'The clip does not match the prompt.',
    });
    expect(outcome).toMatchObject({ ok: true, code: 'rejected' });

    const after = (await loadPromptById(sql(), pending.id))!;
    expect(after.status).toBe('rejected');
    expect(after.rejectReason).toBe('The clip does not match the prompt.');
    // A rejected item was never visible, so nothing cached can be stale.
    expect(harness.promptsRevalidated).toBe(0);
  });

  it('refuses a rejection with no reason', async () => {
    const pending = (await loadPromptBySlug(sql(), 'pending-underwater-drift'))!;
    const outcome = await harness.run('prompt.reject', { id: pending.id, reason: '' });
    expect(outcome).toMatchObject({ ok: false, code: 'invalid' });
    expect((await loadPromptById(sql(), pending.id))!.status).toBe('pending');
  });

  // --- YAGI authoring -----------------------------------------------------

  const authoring = {
    slug: 'studio-locked-off',
    title: 'Studio locked off',
    titleKo: '스튜디오 고정 샷',
    promptText: 'Locked-off wide on a seamless backdrop, single softbox, no camera move.',
    useCase: ['brand-ad'],
    textVisibility: 'pro',
    featured: 'on',
    model: 'seedance-2.5',
  };

  it('authors a YAGI prompt, published immediately, with its media already public', async () => {
    const outcome = await harness.run('prompt.create', {
      ...authoring,
      poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
    });
    expect(outcome).toMatchObject({ ok: true, code: 'published' });

    const row = (await loadPromptBySlug(sql(), 'studio-locked-off'))!;
    expect(row.source).toBe('yagi');
    expect(row.status).toBe('published');
    expect(row.textVisibility).toBe('pro');
    expect(row.authorId).toBeNull();
    expect(row.publishedAt).not.toBeNull();
    expect(parsePromptMedia(row.media).poster?.bucket).toBe('public-content');
    expect(harness.promptsRevalidated).toBe(1);
  });

  /**
   * Founder direction (2026-08-14) — the slug follows the EN title. A blank field derives
   * `lowercase-words-joined-by-hyphens`, and a collision walks to `-2` instead of refusing:
   * publishing is the act, naming is the default.
   */
  it('derives the slug from the EN title when the field is left blank', async () => {
    const outcome = await harness.run('prompt.create', {
      ...authoring,
      slug: '',
      title: 'Golden Hour Rooftop Sprint',
      poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
    });
    expect(outcome).toMatchObject({ ok: true, code: 'published', detail: 'golden-hour-rooftop-sprint' });
    expect(await loadPromptBySlug(sql(), 'golden-hour-rooftop-sprint')).not.toBeNull();

    // Same title again: the derive walks to -2 rather than bouncing off the unique index.
    const second = await harness.run('prompt.create', {
      ...authoring,
      slug: '',
      title: 'Golden Hour Rooftop Sprint',
      poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
    });
    expect(second).toMatchObject({ ok: true, detail: 'golden-hour-rooftop-sprint-2' });

    // A TYPED slug still validates — the founder can be deliberate when they want to be.
    const typed = await harness.run('prompt.create', {
      ...authoring,
      slug: 'NOT A SLUG',
      poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
    });
    expect(typed).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('refuses a YAGI prompt with no poster (§13.3-4 media required)', async () => {
    const outcome = await harness.run('prompt.create', authoring);
    expect(outcome).toMatchObject({ ok: false, code: 'invalid' });
    expect(await loadPromptBySlug(sql(), 'studio-locked-off')).toBeNull();
  });

  it('refuses a YAGI prompt with no Korean title', async () => {
    const outcome = await harness.run('prompt.create', {
      ...authoring,
      titleKo: '',
      poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
    });
    expect(outcome).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('refuses a duplicate slug at the database, not in a second copy of the rule', async () => {
    const outcome = await harness.run('prompt.create', {
      ...authoring,
      slug: 'neon-alley-dolly',
      poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
    });
    expect(outcome).toMatchObject({ ok: false, code: 'duplicateSlug' });
  });

  it('refuses an oversized upload with the upload code, before writing a row', async () => {
    const huge = new File([new Uint8Array(33 * 1024 * 1024)], 'big.mp4', { type: 'video/mp4' });
    const outcome = await harness.run('prompt.create', {
      ...authoring,
      poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
      video: huge,
    });
    expect(outcome).toMatchObject({ ok: false, code: 'upload' });
    expect(await loadPromptBySlug(sql(), 'studio-locked-off')).toBeNull();
  });

  // --- published list -----------------------------------------------------

  it('edits in place (§13.1 — no revisions) and moves the prompts tag', async () => {
    const live = (await loadPromptBySlug(sql(), 'kitchen-tutorial-overhead'))!;
    const outcome = await harness.run('prompt.update', {
      id: live.id,
      slug: 'kitchen-overhead',
      title: 'Kitchen overhead',
      titleKo: '주방 오버헤드',
      promptText: 'Top-down locked frame, two hands in shot, soft north-window light.',
      useCase: ['tutorial'],
      handle: '',
      textVisibility: 'public',
      featured: 'on',
    });
    expect(outcome).toMatchObject({ ok: true, code: 'saved' });

    const after = (await loadPromptById(sql(), live.id))!;
    expect(after.slug).toBe('kitchen-overhead');
    expect(after.title).toBe('Kitchen overhead');
    expect(after.textVisibility).toBe('public');
    expect(after.featured).toBe(true);
    expect(harness.promptsRevalidated).toBe(1);
  });

  /** §13.3-1 in the operations layer: the request is normalised, and the CHECK backs it up. */
  it('cannot paywall a community prompt, however the form is posted', async () => {
    const community = (await loadPromptBySlug(sql(), 'skate-park-golden-hour'))!;
    const outcome = await harness.run('prompt.update', {
      id: community.id,
      slug: community.slug,
      title: community.title,
      titleKo: '',
      promptText: community.promptText,
      useCase: community.useCase,
      handle: community.authorHandle ?? '',
      textVisibility: 'pro',
      featured: '',
    });
    expect(outcome.ok).toBe(true);
    expect((await loadPromptById(sql(), community.id))!.textVisibility).toBe('public');
  });

  it('features and unfeatures', async () => {
    const live = (await loadPromptBySlug(sql(), 'kitchen-tutorial-overhead'))!;
    expect(await harness.run('prompt.feature', { id: live.id, featured: 'true' })).toMatchObject({
      ok: true,
    });
    expect((await loadPromptById(sql(), live.id))!.featured).toBe(true);
    await harness.run('prompt.feature', { id: live.id, featured: 'false' });
    expect((await loadPromptById(sql(), live.id))!.featured).toBe(false);
  });

  /**
   * Founder direction (2026-08-13): free presets are ONE press on the list. The fast path walks
   * public↔pro on YAGI rows only — a community row is always public (§13.3-1), so the guard
   * answers notFound rather than pretending a toggle exists there.
   */
  it('flips a YAGI original public and back with one press', async () => {
    const live = (await loadPromptBySlug(sql(), 'neon-alley-dolly'))!;
    expect(
      await harness.run('prompt.visibility', { id: live.id, textVisibility: 'public' }),
    ).toMatchObject({ ok: true });
    expect((await loadPromptById(sql(), live.id))!.textVisibility).toBe('public');

    await harness.run('prompt.visibility', { id: live.id, textVisibility: 'pro' });
    expect((await loadPromptById(sql(), live.id))!.textVisibility).toBe('pro');

    const community = (await loadPromptBySlug(sql(), 'skate-park-golden-hour'))!;
    expect(
      await harness.run('prompt.visibility', { id: community.id, textVisibility: 'pro' }),
    ).toMatchObject({ ok: false, code: 'notFound' });
    expect((await loadPromptById(sql(), community.id))!.textVisibility).toBe('public');
  });

  it('unpublishes to archived — never a delete — and restores', async () => {
    const live = (await loadPromptBySlug(sql(), 'neon-alley-dolly'))!;
    expect(await harness.run('prompt.archive', { id: live.id, archived: 'true' })).toMatchObject({
      ok: true,
      code: 'archived',
    });
    expect((await loadPromptById(sql(), live.id))!.status).toBe('archived');
    expect((await loadPublishedPrompts(sql())).map((r) => r.slug)).not.toContain('neon-alley-dolly');

    expect(await harness.run('prompt.archive', { id: live.id, archived: 'false' })).toMatchObject({
      ok: true,
      code: 'unarchived',
    });
    expect((await loadPromptById(sql(), live.id))!.status).toBe('published');
  });

  it('answers notFound for an id that no longer exists', async () => {
    const gone = '11111111-2222-4333-8444-555555555555';
    for (const op of ['prompt.feature', 'prompt.archive'] as const) {
      expect(await harness.run(op, { id: gone, featured: 'true', archived: 'true' })).toMatchObject({
        ok: false,
        code: 'notFound',
      });
    }
  });

  it('refuses every prompt operation for a non-admin, payload or not', async () => {
    const live = (await loadPromptBySlug(sql(), 'neon-alley-dolly'))!;
    for (const name of Object.keys(PROMPT_OPERATIONS)) {
      const outcome = await dispatchAdmin(
        name,
        formOf(name, { id: live.id, featured: 'true' }),
        harness.ctx(viewerOf('pro')),
      );
      expect(outcome, name).toEqual({ ok: false, code: 'forbidden' });
    }
    expect((await loadPromptById(sql(), live.id))!.featured).toBe(true);
  });
});

/**
 * The `/admin/prompts` screen posts to the ONE guarded server action like every other admin form.
 * Source-level, because the page itself is `server-only` and cannot be imported into vitest.
 */
describe('admin prompts screen contract (§3.8 / §13.2)', () => {
  const page = read('app', '(admin)', 'admin', 'prompts', 'page.tsx');

  it('is dynamic and posts through OpForm only', () => {
    expect(page).toContain("export const dynamic = 'force-dynamic'");
    expect(page).toContain('OpForm');
    expect(page).not.toContain('runAdminOperation');
  });

  it('offers the whole §13.2/F surface', () => {
    for (const op of Object.keys(PROMPT_OPERATIONS)) {
      expect(page, op).toContain(`op="${op}"`);
    }
  });

  it('defaults YAGI text visibility to pro (§13.3-2)', () => {
    expect(page).toContain('defaultValue="pro"');
  });
});
