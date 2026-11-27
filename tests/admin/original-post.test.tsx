import { randomUUID } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { prerender } from 'react-dom/static';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OriginalPostPanel } from '@/components/admin/original-post-panel';
import { ADMIN_OPERATION_NAMES, ADMIN_OPERATIONS } from '@/lib/admin/operations';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { ADMIN_VIEWER, adminHarness, formOf, viewerOf, type AdminHarness } from '../helpers/admin';
import { seedFormatTemplate } from '../helpers/format-fixture';
import { runner } from '../helpers/pglite';

const state = vi.hoisted(() => ({ sql: null as unknown }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/i18n/server', () => ({ getLocaleFromHeaders: async () => 'ko' }));
vi.mock('@/lib/routing/request-surface', () => ({
  requestSurface: async () => ({ admin: true, brand: false, workspace: true, origin: 'https://admin.twings.app' }),
  publicHref: (path: string, admin: boolean) => (admin ? `https://twings.app${path}` : path),
}));
vi.mock('@/lib/auth/viewer', () => ({
  requireAdmin: async () => ({ tier: 'admin', userId: 'u', email: null, isAdmin: true, locale: 'ko' }),
  getViewer: async () => ({ tier: 'admin', userId: 'u', email: null, isAdmin: true, locale: 'ko' }),
}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => state.sql }));

import AdminPromptItemPage from '@/app/(admin)/admin/prompts/[id]/page';

describe('format.setOriginalPost admin operation & panel', () => {
  let harness: AdminHarness;
  const sql = () => runner(harness.db);
  const dict = getDictionary('ko');

  beforeEach(async () => {
    harness = await adminHarness();
  });

  afterEach(async () => harness.close());

  it('registers format.setOriginalPost in ADMIN_OPERATIONS and parses form inputs', () => {
    expect(ADMIN_OPERATION_NAMES).toContain('format.setOriginalPost');
    const op = ADMIN_OPERATIONS['format.setOriginalPost'];
    const id = randomUUID();

    expect(
      op.parse(formOf('format.setOriginalPost', { id, url: 'https://www.instagram.com/reel/C9AbCdEf123/' })),
    ).toEqual({
      ok: true,
      value: { id, url: 'https://www.instagram.com/reel/C9AbCdEf123/' },
    });

    expect(op.parse(formOf('format.setOriginalPost', { id, url: '' }))).toEqual({
      ok: true,
      value: { id, url: '' },
    });

    expect(op.parse(formOf('format.setOriginalPost', { id }))).toEqual({
      ok: false,
      detail: 'originalPost:input',
    });

    expect(op.parse(formOf('format.setOriginalPost', { id: 'not-a-uuid', url: '' }))).toEqual({
      ok: false,
      detail: 'originalPost:input',
    });
  });

  it('dispatches saves, revalidates prompts, refuses invalid updates without revalidation, and blocks non-admins', async () => {
    const f = await seedFormatTemplate(sql());
    const promptsBefore = harness.promptsRevalidated;

    const saved = await harness.run('format.setOriginalPost', {
      id: f.templateId,
      url: 'https://instagram.com/reels/C9AbCdEf123/?igsh=test',
    });
    expect(saved).toMatchObject({ ok: true, code: 'saved', detail: f.slug });
    expect(harness.promptsRevalidated).toBe(promptsBefore + 1);

    const stored = await sql().query<{ example_url: string | null }>(
      'select example_url from platform_formats where id = $1',
      [f.formatId],
    );
    expect(stored.rows[0]?.example_url).toBe('https://www.instagram.com/reel/C9AbCdEf123/');

    const unchanged = await harness.run('format.setOriginalPost', {
      id: f.templateId,
      url: 'https://www.instagram.com/reel/C9AbCdEf123/',
    });
    expect(unchanged).toEqual({ ok: false, code: 'invalid', detail: 'originalPost:unchanged' });

    const notPost = await harness.run('format.setOriginalPost', {
      id: f.templateId,
      url: 'https://www.instagram.com/twings_studio/',
    });
    expect(notPost).toEqual({ ok: false, code: 'invalid', detail: 'originalPost:not_post' });

    const external = await seedFormatTemplate(sql(), { payout: 'external' });
    const notCompany = await harness.run('format.setOriginalPost', {
      id: external.templateId,
      url: 'https://www.instagram.com/reel/C9AbCdEf123/',
    });
    expect(notCompany).toEqual({ ok: false, code: 'invalid', detail: 'originalPost:not_company' });

    const missing = await harness.run('format.setOriginalPost', {
      id: randomUUID(),
      url: 'https://www.instagram.com/reel/C9AbCdEf123/',
    });
    expect(missing).toEqual({ ok: false, code: 'notFound', detail: 'originalPost:not_found' });

    expect(harness.promptsRevalidated).toBe(promptsBefore + 1);

    const nonAdmin = await harness.run(
      'format.setOriginalPost',
      { id: f.templateId, url: '' },
      viewerOf('pro'),
    );
    expect(nonAdmin).toEqual({ ok: false, code: 'forbidden' });
    expect(ADMIN_VIEWER.isAdmin).toBe(true);
  });

  it('renders all three status states and refusal messages in OriginalPostPanel', () => {
    const id = randomUUID();
    const back = `/admin/prompts/${id}`;

    const visibleHtml = renderToStaticMarkup(
      <OriginalPostPanel
        op="format.setOriginalPost"
        templateId={id}
        view={{
          formatId: randomUUID(),
          exampleUrl: 'https://www.instagram.com/reel/C9AbCdEf123/',
          status: 'visible',
        }}
        dict={dict}
        back={back}
      />,
    );
    expect(visibleHtml).toContain('원본 게시물 주소');
    expect(visibleHtml).toContain('href="https://www.instagram.com/reel/C9AbCdEf123/"');
    expect(visibleHtml).toContain('data-original-post-status="visible"');
    expect(visibleHtml).toContain('템플릿 페이지에 보임');
    expect(visibleHtml).toContain('type="url"');
    expect(visibleHtml).toContain('name="url"');
    expect(visibleHtml).toContain('빈 값으로 저장하면 지워집니다');
    expect(visibleHtml).toContain('data-original-post-save');

    const notPostHtml = renderToStaticMarkup(
      <OriginalPostPanel
        op="format.setOriginalPost"
        templateId={id}
        view={{
          formatId: randomUUID(),
          exampleUrl: 'https://www.instagram.com/twings_studio/',
          status: 'not_post',
        }}
        dict={dict}
        back={back}
        detail="originalPost:not_post"
      />,
    );
    expect(notPostHtml).toContain('href="https://www.instagram.com/twings_studio/"');
    expect(notPostHtml).toContain('data-original-post-status="not_post"');
    expect(notPostHtml).toContain('프로필 주소라 템플릿 페이지에 보이지 않음');
    expect(notPostHtml).toContain('data-original-post-refusal="not_post"');
    expect(notPostHtml).toContain(dict.admin.originalPost.refusals.not_post);

    const emptyHtml = renderToStaticMarkup(
      <OriginalPostPanel
        op="format.setOriginalPost"
        templateId={id}
        view={{
          formatId: randomUUID(),
          exampleUrl: null,
          status: 'empty',
        }}
        dict={dict}
        back={back}
      />,
    );
    expect(emptyHtml).toContain('data-original-post-status="empty"');
    expect(emptyHtml).toContain('없음');
    expect(emptyHtml).not.toContain('target="_blank"');
  });

  it('renders OriginalPostPanel on the admin prompt page ONLY for accepted company-payout formats', async () => {
    state.sql = sql();
    const company = await seedFormatTemplate(sql(), { payout: 'company' });
    const companyHtml = await page(company.templateId);
    expect(companyHtml).toContain('data-original-post-panel');
    expect(companyHtml).toContain('원본 게시물 주소');
    expect(companyHtml).toContain('name="url"');
    expect(companyHtml).toContain('value="format.setOriginalPost"');

    const refusedHtml = await page(company.templateId, { err: 'invalid', detail: 'originalPost:not_post' });
    expect(refusedHtml).toContain('data-original-post-refusal="not_post"');

    const external = await seedFormatTemplate(sql(), { payout: 'external' });
    expect(await page(external.templateId)).not.toContain('data-original-post-panel');

    const originalId = randomUUID();
    await sql().query(
      `insert into prompt_items (id, slug, source, status, models, title, prompt_text, text_visibility, use_case, featured, medium, published_at)
       values ($1, 'studio-original-admin-page', 'yagi', 'published', '{seedance-2.5}', 'Studio original', 'Plain text prompt here.', 'hidden', '{}', false, 'video', now())`,
      [originalId],
    );
    expect(await page(originalId)).not.toContain('data-original-post-panel');
  });

  async function page(id: string, query: Record<string, string> = {}): Promise<string> {
    const element = await AdminPromptItemPage({
      params: Promise.resolve({ id }),
      searchParams: Promise.resolve(query),
    });
    const { prelude } = await prerender(element);
    return new Response(prelude).text();
  }
});
