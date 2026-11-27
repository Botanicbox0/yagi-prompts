import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlRunner } from '@/lib/db/sql-runner';
import {
  ORIGINAL_POST_ACTION,
  loadOriginalPostView,
  setFormatOriginalPost,
} from '@/lib/creator-platform/original-post';
import { loadTemplateOriginalInstagram } from '@/lib/posts/public';
import { seedFormatTemplate, type FormatFixture } from '../helpers/format-fixture';
import { freshDb, runner } from '../helpers/pglite';

const ACTOR_ID = 'f0000000-0000-4000-8000-000000000099';

describe('format.setOriginalPost (studio company formats)', () => {
  let db: PGlite;
  let sql: SqlRunner;

  beforeEach(async () => {
    db = await freshDb();
    sql = runner(db);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await db.close();
  });

  const exampleUrlOf = async (formatId: string) =>
    (await sql.query<{ example_url: string | null }>('select example_url from platform_formats where id = $1', [formatId]))
      .rows[0]?.example_url ?? null;

  const auditsOf = async (templateId: string) =>
    (
      await sql.query<{
        actor_id: string | null;
        entity_id: string;
        action: string;
        details: { formatId?: string; slug?: string; before?: string | null; after?: string | null };
      }>(
        'select actor_id, entity_id, action, details from platform_audit where entity_id = $1 and action = $2 order by created_at, id',
        [templateId, ORIGINAL_POST_ACTION],
      )
    ).rows;

  async function seedActor() {
    await sql.query('insert into auth.users (id) values ($1) on conflict (id) do nothing', [ACTOR_ID]);
    await sql.query('insert into profiles (id, email) values ($1, $2) on conflict (id) do nothing', [
      ACTOR_ID,
      'admin-op@example.test',
    ]);
  }

  async function seedAll(options?: Parameters<typeof seedFormatTemplate>[1]): Promise<FormatFixture> {
    await seedActor();
    return seedFormatTemplate(sql, options);
  }

  it('saves and canonicalizes Instagram reel and post URLs and writes one audit row per change', async () => {
    const f = await seedAll();

    const reelRes = await setFormatOriginalPost(sql, ACTOR_ID, {
      id: f.templateId,
      url: '  https://instagram.com/reels/C9AbCdEf123/?igsh=xyz  ',
    });
    expect(reelRes).toEqual({ ok: true, slug: f.slug });
    expect(await exampleUrlOf(f.formatId)).toBe('https://www.instagram.com/reel/C9AbCdEf123/');

    const postRes = await setFormatOriginalPost(sql, ACTOR_ID, {
      id: f.templateId,
      url: 'https://www.instagram.com/p/XyZ987654/?utm_source=ig_web_copy_link',
    });
    expect(postRes).toEqual({ ok: true, slug: f.slug });
    expect(await exampleUrlOf(f.formatId)).toBe('https://www.instagram.com/p/XyZ987654/');

    const audits = await auditsOf(f.templateId);
    expect(audits).toHaveLength(2);
    expect(audits[0]).toEqual({
      actor_id: ACTOR_ID,
      entity_id: f.templateId,
      action: 'format.setOriginalPost',
      details: {
        formatId: f.formatId,
        slug: f.slug,
        before: null,
        after: 'https://www.instagram.com/reel/C9AbCdEf123/',
      },
    });
    expect(audits[1]).toEqual({
      actor_id: ACTOR_ID,
      entity_id: f.templateId,
      action: 'format.setOriginalPost',
      details: {
        formatId: f.formatId,
        slug: f.slug,
        before: 'https://www.instagram.com/reel/C9AbCdEf123/',
        after: 'https://www.instagram.com/p/XyZ987654/',
      },
    });
  });

  it('makes loadTemplateOriginalInstagram return the saved URL and clears back to null when emptied', async () => {
    vi.stubEnv('TWINGS_MAKER_BLOG', 'on');
    const f = await seedAll({ status: 'published' });
    await sql.query('update platform_formats set example_url = $2 where id = $1', [
      f.formatId,
      'https://www.instagram.com/twings_studio/',
    ]);

    expect(await loadTemplateOriginalInstagram(sql, f.templateId)).toBeNull();

    const saved = await setFormatOriginalPost(sql, ACTOR_ID, {
      id: f.templateId,
      url: 'https://instagram.com/reels/C9AbCdEf123/?igsh=abc',
    });
    expect(saved).toEqual({ ok: true, slug: f.slug });

    expect(await loadTemplateOriginalInstagram(sql, f.templateId)).toEqual({
      kind: 'reel',
      id: 'C9AbCdEf123',
      url: 'https://www.instagram.com/reel/C9AbCdEf123/',
      embedUrl: 'https://www.instagram.com/reel/C9AbCdEf123/embed',
    });

    expect(await setFormatOriginalPost(sql, ACTOR_ID, { id: f.templateId, url: '' })).toEqual({
      ok: true,
      slug: f.slug,
    });
    expect(await loadTemplateOriginalInstagram(sql, f.templateId)).toBeNull();
  });

  it('clears an existing profile or post URL when saved with an empty or whitespace string', async () => {
    const f = await seedAll();
    await sql.query('update platform_formats set example_url = $2 where id = $1', [
      f.formatId,
      'https://www.instagram.com/twings_studio/',
    ]);

    const cleared = await setFormatOriginalPost(sql, ACTOR_ID, { id: f.templateId, url: '   ' });
    expect(cleared).toEqual({ ok: true, slug: f.slug });
    expect(await exampleUrlOf(f.formatId)).toBeNull();

    const audits = await auditsOf(f.templateId);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.details).toEqual({
      formatId: f.formatId,
      slug: f.slug,
      before: 'https://www.instagram.com/twings_studio/',
      after: null,
    });
  });

  it('refuses profile URLs and non-Instagram or non-post URLs without writing or auditing', async () => {
    const f = await seedAll();
    const initialProfile = 'https://www.instagram.com/twings_studio/';
    await sql.query('update platform_formats set example_url = $2 where id = $1', [f.formatId, initialProfile]);

    const badUrls = [
      'https://www.instagram.com/yagi_studio/',
      'https://www.instagram.com/stories/yagi_studio/12345/',
      'https://www.tiktok.com/@yagi/video/7123456789012345678',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://evil.example/reel/C9AbCdEf123/',
      'not-a-url',
    ];

    for (const url of badUrls) {
      expect(await setFormatOriginalPost(sql, ACTOR_ID, { id: f.templateId, url }), url).toEqual({
        ok: false,
        code: 'not_post',
      });
    }

    expect(await exampleUrlOf(f.formatId)).toBe(initialProfile);
    expect(await auditsOf(f.templateId)).toHaveLength(0);
  });

  it('refuses non-company formats without writing or auditing', async () => {
    const external = await seedAll({ payout: 'external' });
    const res = await setFormatOriginalPost(sql, ACTOR_ID, {
      id: external.templateId,
      url: 'https://www.instagram.com/reel/C9AbCdEf123/',
    });
    expect(res).toEqual({ ok: false, code: 'not_company' });
    expect(await exampleUrlOf(external.formatId)).toBeNull();
    expect(await auditsOf(external.templateId)).toHaveLength(0);
  });

  it('refuses non-accepted formats without writing or auditing', async () => {
    const f = await seedAll();
    // 0046 enforces check ((status='accepted')=(template_id is not null)) on platform_formats.
    // Drop only that check in this isolated PGlite instance so we can exercise the application guard.
    await db.exec(`
      do $$
      declare c text;
      begin
        select conname into c
          from pg_constraint
         where conrelid = 'platform_formats'::regclass
           and contype = 'c'
           and pg_get_constraintdef(oid) like '%template_id%';
        if c is not null then
          execute format('alter table platform_formats drop constraint %I', c);
        end if;
      end $$;
    `);
    await sql.query("update platform_formats set status = 'submitted' where id = $1", [f.formatId]);

    const res = await setFormatOriginalPost(sql, ACTOR_ID, {
      id: f.templateId,
      url: 'https://www.instagram.com/reel/C9AbCdEf123/',
    });
    expect(res).toEqual({ ok: false, code: 'not_accepted' });
    expect(await exampleUrlOf(f.formatId)).toBeNull();
    expect(await auditsOf(f.templateId)).toHaveLength(0);
  });

  it('refuses missing templates and non-format studio originals without auditing', async () => {
    await seedActor();
    const missingId = randomUUID();
    expect(
      await setFormatOriginalPost(sql, ACTOR_ID, {
        id: missingId,
        url: 'https://www.instagram.com/reel/C9AbCdEf123/',
      }),
    ).toEqual({ ok: false, code: 'not_found' });
    expect(await auditsOf(missingId)).toHaveLength(0);

    const studioOriginalId = randomUUID();
    await sql.query(
      `insert into prompt_items (id, slug, source, status, models, title, prompt_text, text_visibility, use_case, featured, medium, published_at)
       values ($1, 'studio-original-no-format', 'yagi', 'published', '{seedance-2.5}', 'Studio original', 'Plain text prompt here.', 'hidden', '{}', false, 'video', now())`,
      [studioOriginalId],
    );
    expect(
      await setFormatOriginalPost(sql, ACTOR_ID, {
        id: studioOriginalId,
        url: 'https://www.instagram.com/reel/C9AbCdEf123/',
      }),
    ).toEqual({ ok: false, code: 'not_found' });
    expect(await auditsOf(studioOriginalId)).toHaveLength(0);
  });

  it('refuses unchanged values (null to empty, or same canonical post URL) with no audit row', async () => {
    const f = await seedAll();

    expect(await setFormatOriginalPost(sql, ACTOR_ID, { id: f.templateId, url: '' })).toEqual({
      ok: false,
      code: 'unchanged',
    });
    expect(await setFormatOriginalPost(sql, ACTOR_ID, { id: f.templateId, url: '  ' })).toEqual({
      ok: false,
      code: 'unchanged',
    });
    expect(await auditsOf(f.templateId)).toHaveLength(0);

    expect(
      await setFormatOriginalPost(sql, ACTOR_ID, {
        id: f.templateId,
        url: 'https://www.instagram.com/reel/C9AbCdEf123/',
      }),
    ).toEqual({ ok: true, slug: f.slug });

    expect(
      await setFormatOriginalPost(sql, ACTOR_ID, {
        id: f.templateId,
        url: 'https://instagram.com/reels/C9AbCdEf123/?utm_source=ig',
      }),
    ).toEqual({ ok: false, code: 'unchanged' });
    expect(await auditsOf(f.templateId)).toHaveLength(1);
  });

  it('loadOriginalPostView returns null for non-company/non-format and reports the three display statuses', async () => {
    const external = await seedAll({ payout: 'external' });
    expect(await loadOriginalPostView(sql, external.templateId)).toBeNull();
    expect(await loadOriginalPostView(sql, randomUUID())).toBeNull();

    const company = await seedAll({ payout: 'company' });
    expect(await loadOriginalPostView(sql, company.templateId)).toEqual({
      formatId: company.formatId,
      exampleUrl: null,
      status: 'empty',
    });

    await sql.query('update platform_formats set example_url = $2 where id = $1', [
      company.formatId,
      'https://www.instagram.com/twings_studio/',
    ]);
    expect(await loadOriginalPostView(sql, company.templateId)).toEqual({
      formatId: company.formatId,
      exampleUrl: 'https://www.instagram.com/twings_studio/',
      status: 'not_post',
    });

    await setFormatOriginalPost(sql, ACTOR_ID, {
      id: company.templateId,
      url: 'https://www.instagram.com/reel/C9AbCdEf123/',
    });
    expect(await loadOriginalPostView(sql, company.templateId)).toEqual({
      formatId: company.formatId,
      exampleUrl: 'https://www.instagram.com/reel/C9AbCdEf123/',
      status: 'visible',
    });
  });
});
