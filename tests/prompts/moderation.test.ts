import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_OPERATION_NAMES } from '@/lib/admin/operations';
import { PROMPT_OPERATIONS } from '@/lib/admin/prompt-operations';
import { dispatchAdmin } from '@/lib/admin/dispatch';
import { loadPromptById, loadPromptBySlug, loadPublishedPrompts } from '@/lib/prompts/repo';
import { VIDEO_MAX_BYTES, parsePromptMedia, parseStagedUpload } from '@/lib/prompts/schemas';
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

  /** The founder's ask, end to end: two models checked, two chips stored (2026-08-15). */
  it('stores every model the form checked, and lets an edit add one later', async () => {
    const created = await harness.run('prompt.create', {
      ...authoring,
      slug: 'two-models',
      title: 'Two models',
      models: ['seedance-2.5', 'seedance-2.0'],
      poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
    });
    expect(created).toMatchObject({ ok: true });
    const row = (await loadPromptBySlug(sql(), 'two-models'))!;
    expect(row.models).toEqual(['seedance-2.5', 'seedance-2.0']);

    const edited = await harness.run('prompt.update', {
      id: row.id,
      slug: row.slug,
      title: row.title,
      titleKo: row.titleKo ?? '',
      promptText: row.promptText,
      useCase: 'brand-ad',
      handle: '',
      textVisibility: row.textVisibility,
      featured: '',
      models: ['seedance-2.5', 'seedance-2.0', 'kling-3.0'],
    });
    expect(edited).toMatchObject({ ok: true });
    expect((await loadPromptById(sql(), row.id))!.models).toEqual([
      'seedance-2.5',
      'seedance-2.0',
      'kling-3.0',
    ]);
  });

  /** A form that checked nothing still writes a runnable row rather than an empty chip row. */
  it('falls back to the default model when the form checked none', async () => {
    const outcome = await harness.run('prompt.create', {
      ...authoring,
      slug: 'no-model-checked',
      title: 'No model checked',
      models: [],
      poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
    });
    expect(outcome).toMatchObject({ ok: true });
    expect((await loadPromptBySlug(sql(), 'no-model-checked'))!.models).toEqual(['seedance-2.5']);
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
    models: ['seedance-2.5'],
  };

  it('publishes from the title even when an older tab submits an invalid slug', async () => {
    for (const slug of ['Y2K 셀카', 'Y2K Selfie!!', 'y2k--selfie', '']) {
      const outcome = await harness.run('prompt.create', {
        ...authoring, title: 'Y2K Selfie!', slug,
        poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
      });
      expect(outcome).toMatchObject({ ok: true, code: 'published' });
    }
    for (const slug of ['y2k-selfie', 'y2k-selfie-2', 'y2k-selfie-3', 'y2k-selfie-4']) {
      expect(await loadPromptBySlug(sql(), slug)).not.toBeNull();
    }
  });

  it('generates a valid unique address when the title has no Latin characters', async () => {
    const outcome = await harness.run('prompt.create', {
      ...authoring, title: '기억 속 영화', slug: '한글 주소',
      poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
    });
    expect(outcome).toMatchObject({ ok: true, detail: expect.stringMatching(/^prompt-[a-z0-9]+$/) });
  });

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

    // Older tabs may still send an arbitrary slug; creation derives the address anyway.
    const typed = await harness.run('prompt.create', {
      ...authoring,
      slug: 'NOT A SLUG',
      poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
    });
    expect(typed).toMatchObject({ ok: true, detail: 'studio-locked-off' });
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

  it('assigns a free address when the title matches an existing template', async () => {
    const outcome = await harness.run('prompt.create', {
      ...authoring,
      slug: 'neon-alley-dolly',
      title: 'Neon alley dolly',
      poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
    });
    expect(outcome).toMatchObject({ ok: true, detail: 'neon-alley-dolly-2' });
  });

  /**
   * The DIRECT upload path (founder report, 2026-08-15): Vercel refuses a request body over ~4.5MB
   * with its own 413, so a real clip never reaches the operation as a file. The browser PUTs it to
   * storage and the form carries a receipt instead — and the operation has to treat that receipt as
   * a claim to verify, not a fact to trust.
   */
  it('takes a direct-upload receipt instead of the bytes, and checks the object is really there', async () => {
    const key = `content/prompt/upload/${crypto.randomUUID()}.mp4`;
    await harness.storage.putStaging(key, new TextEncoder().encode('mp4 placeholder'), 'video/mp4');

    const live = (await loadPromptBySlug(sql(), 'kitchen-tutorial-overhead'))!;
    const receipt = JSON.stringify({
      key,
      sha256: 'a'.repeat(64),
      mime: 'video/mp4',
      size: 11_600_000,
    });
    const outcome = await harness.run('prompt.update', {
      id: live.id,
      slug: live.slug,
      title: live.title,
      titleKo: live.titleKo ?? '',
      promptText: live.promptText,
      useCase: 'tutorial',
      handle: '',
      textVisibility: live.textVisibility,
      featured: '',
      videoRef: receipt,
    });
    expect(outcome).toMatchObject({ ok: true });

    const media = parsePromptMedia((await loadPromptById(sql(), live.id))!.media);
    expect(media.video?.staging_key).toBe(key);
    expect(media.video?.sha256).toBe('a'.repeat(64));
    // 11.1MB rode past the 4.5MB door as a few hundred bytes of JSON — the whole point.
    expect(receipt.length).toBeLessThan(300);
  });

  it('refuses a receipt whose object is not in storage', async () => {
    const live = (await loadPromptBySlug(sql(), 'kitchen-tutorial-overhead'))!;
    const outcome = await harness.run('prompt.update', {
      id: live.id,
      slug: live.slug,
      title: live.title,
      titleKo: live.titleKo ?? '',
      promptText: live.promptText,
      useCase: 'tutorial',
      handle: '',
      textVisibility: live.textVisibility,
      featured: '',
      videoRef: JSON.stringify({
        key: `content/prompt/upload/${crypto.randomUUID()}.mp4`,
        sha256: 'b'.repeat(64),
        mime: 'video/mp4',
        size: 1000,
      }),
    });
    expect(outcome).toMatchObject({ ok: false, code: 'upload', detail: 'video: upload_missing' });
  });

  /** A receipt is a key the SERVER minted. Anything else is someone naming an object they want. */
  it('refuses a receipt pointing outside the direct-upload namespace', () => {
    expect(parseStagedUpload('')).toBeNull();
    expect(parseStagedUpload('not json')).toBeNull();
    for (const key of [
      'content/prompt/9a000000-0000-4000-8000-000000000001/x.mp4',
      'content/rev/abc/x.mp4',
      '../../../etc/passwd',
      'content/prompt/upload/../../secret.mp4',
    ]) {
      const receipt = JSON.stringify({ key, sha256: 'a'.repeat(64), mime: 'video/mp4', size: 1 });
      expect(parseStagedUpload(receipt), key).toBeNull();
    }
    // …and a digest that is not a digest.
    expect(
      parseStagedUpload(
        JSON.stringify({
          key: `content/prompt/upload/${crypto.randomUUID()}.mp4`,
          sha256: 'nope',
          mime: 'video/mp4',
          size: 1,
        }),
      ),
    ).toBeNull();
  });

  it('refuses an oversized upload with the upload code, before writing a row', async () => {
    const huge = new File([new Uint8Array(VIDEO_MAX_BYTES + 1)], 'big.mp4', { type: 'video/mp4' });
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

  it('saves a 1080p price only for a film, in both currencies, and never below the base price', async () => {
    const live = (await loadPromptBySlug(sql(), 'kitchen-tutorial-overhead'))!;
    const form = (extra: Record<string, string>) => ({
      id: live.id, slug: live.slug, title: live.title, titleKo: live.titleKo ?? '', promptText: live.promptText,
      useCase: live.useCase, handle: '', textVisibility: 'public',
      medium: 'video', priceCents: '400', priceKrw: '5900', runtimeSeconds: '15', ...extra,
    });
    expect(await harness.run('prompt.update', form({ price1080Cents: '900', price1080Krw: '11900' }))).toMatchObject({ ok: true });
    expect(await loadPromptById(sql(), live.id)).toMatchObject({ price1080Cents: 900, price1080Krw: 11900 });
    for (const bad of [
      { price1080Cents: '900', price1080Krw: '0' },
      { price1080Cents: '300', price1080Krw: '11900' },
      { price1080Cents: '900', price1080Krw: '4900' },
    ]) {
      expect(await harness.run('prompt.update', form(bad)), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
    // An image carries no resolution: whatever the form posts, nothing is stored.
    expect(await harness.run('prompt.update', form({ medium: 'image', runtimeSeconds: '', price1080Cents: '900', price1080Krw: '11900' }))).toMatchObject({ ok: true });
    expect(await loadPromptById(sql(), live.id)).toMatchObject({ medium: 'image', price1080Cents: 0, price1080Krw: 0 });
  });

  /**
   * The founder's save, end to end (2026-08-15). A 1994 ENG segment brief — 4,853 characters of
   * shot-by-shot direction — was refused by the admin form with `promptText: Invalid input`, and
   * the schema test alone would not have caught a plumbing failure. So the real operation runs,
   * against the real database, and the text is compared byte for byte on the way out.
   */
  it('saves a full shot-by-shot brief, whole, through the real edit path', async () => {
    const brief = [
      'Create a 15-second Korean archival TV segment. Preserve her exact face, skin tone and age.',
      ...Array.from(
        { length: 60 },
        (_, n) =>
          `${(n * 0.25).toFixed(3)}: servo zoom to off-center chest-up, focus lands late, interlace ` +
          'combing across the highlights; she listens with closed lips, no overlapping reply.',
      ),
    ].join('\n');
    expect(brief.length).toBeGreaterThan(4800);

    const live = (await loadPromptBySlug(sql(), 'kitchen-tutorial-overhead'))!;
    const outcome = await harness.run('prompt.update', {
      id: live.id,
      slug: live.slug,
      title: live.title,
      titleKo: '90년대 서울 사투리 인터뷰',
      promptText: brief,
      useCase: ['cinematic'],
      handle: '',
      textVisibility: 'pro',
      featured: '',
    });
    expect(outcome).toMatchObject({ ok: true, code: 'saved' });
    expect((await loadPromptById(sql(), live.id))!.promptText).toBe(brief);
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
  /** Three screens since 2026-08-15: the board, the new-prompt page, and one prompt's page. */
  const board = read('app', '(admin)', 'admin', 'prompts', 'page.tsx');
  const create = read('app', '(admin)', 'admin', 'prompts', 'new', 'page.tsx');
  const item = read('app', '(admin)', 'admin', 'prompts', '[id]', 'page.tsx');
  const fields = read('components', 'admin', 'prompt-fields.tsx');
  const createSet = read('app', '(admin)', 'admin', 'prompts', 'new', 'set', 'page.tsx');
  const screens = { board, create, createSet, item };
  const surface = Object.values(screens).join('\n');

  it('is dynamic and posts through OpForm only', () => {
    for (const [name, src] of Object.entries(screens)) {
      expect(src, name).toContain("export const dynamic = 'force-dynamic'");
      // The screens never name the door itself — OpForm owns that (`POST /admin/do`).
      expect(src, name).not.toContain('ADMIN_ACTION_PATH');
      expect(src, name).not.toContain('method="post"');
    }
    expect(surface).toContain('OpForm');
  });

  it('offers the whole §13.2/F surface across the three screens', () => {
    for (const op of Object.keys(PROMPT_OPERATIONS)) {
      expect(surface, op).toContain(`op="${op}"`);
    }
  });

  /**
   * The founder's complaint, as an assertion (2026-08-15): "스크롤 계속 내려서 추가 등록해야 해서
   * 불편함." The authoring form sat under every published prompt's inline editor, so the board grew
   * a screenful per prompt. It belongs on its own route, reached by a button in the header.
   */
  it('keeps the authoring form OFF the board', () => {
    expect(board).not.toContain('op="prompt.create"');
    expect(board).not.toContain('op="prompt.update"');
    expect(create).toContain('op="prompt.create"');
    expect(item).toContain('op="prompt.update"');
    // …and the board links to it rather than hiding it further down.
    expect(board).toContain('ADMIN_PROMPT_NEW_PATH');
    expect(board).toContain('data-prompt-new');
  });

  it('defaults YAGI text visibility to pro (§13.3-2)', () => {
    expect(fields).toContain("row?.textVisibility ?? 'pro'");
  });
});
