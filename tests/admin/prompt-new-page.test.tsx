import { prerender } from 'react-dom/static';
import { describe, expect, it, vi } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';

vi.mock('@/lib/i18n/server', () => ({ getLocaleFromHeaders: async () => 'ko' }));
vi.mock('@/lib/routing/request-surface', () => ({
  requestSurface: async () => ({ admin: true, brand: false, workspace: true, origin: 'https://admin.twings.app' }),
  publicHref: (path: string, admin: boolean) => (admin ? `https://twings.app${path}` : path),
}));

vi.mock('@/lib/auth/viewer', () => ({
  requireAdmin: async () => ({ tier: 'admin', userId: 'u', email: null, isAdmin: true, locale: 'ko' }),
  getViewer: async () => ({ tier: 'admin', userId: 'u', email: null, isAdmin: true, locale: 'ko' }),
}));
// No database: the dashboard renders its zero state, which is all the entry-point check needs.
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => null }));

import AdminPromptNewPage from '@/app/(admin)/admin/prompts/new/page';
import AdminHomePage from '@/app/(admin)/admin/page';

/**
 * Admin template upload audit (2026-09-25). `prompt.create` returns a refusal to `back`, which is this
 * page (`?err=upload&detail=video: upload_missing`, `?err=invalid&detail=poster: …`). The page did not
 * read the query at all, so a refused upload came back as a blank form with no reason on it — read by
 * the admin as "the upload does nothing".
 */
async function render(query: Record<string, string>) {
  const page = await AdminPromptNewPage({ searchParams: Promise.resolve(query) });
  const { prelude } = await prerender(page);
  return new Response(prelude).text();
}

describe('/admin/prompts/new outcome', () => {
  const a = getDictionary('ko').admin;

  it('shows why a create was refused, with the operation detail', async () => {
    const html = await render({ err: 'upload', detail: 'video: upload_missing' });
    expect(html).toContain(a.errUpload);
    expect(html).toContain('video: upload_missing');
  });

  it('shows the missing-poster refusal', async () => {
    const html = await render({ err: 'invalid', detail: 'poster: a YAGI prompt needs a poster image' });
    expect(html).toContain(a.errInvalid);
    expect(html).toContain('poster: a YAGI prompt needs a poster image');
  });

  it('shows no banner on a fresh form', async () => {
    const html = await render({});
    expect(html).not.toContain(a.errUpload);
    expect(html).not.toContain(a.detailLabel);
  });
});

/**
 * Discoverability (2026-09-25): the reporting admin had access and a working form, but the dashboard
 * only reached it through the small arrow on the templates card, and the form did not say that a use
 * case and a poster are required or that pressing the button publishes at once.
 */
describe('template registration is discoverable', () => {
  const a = getDictionary('ko').admin;
  const staticHtml = async (node: Awaited<ReturnType<typeof AdminHomePage>>) =>
    new Response((await prerender(node)).prelude).text();

  it('puts the new-template action on the admin home, next to template management', async () => {
    const html = await staticHtml(await AdminHomePage());
    const row = /<div[^>]*data-admin-template-actions[\s\S]*?<\/div>/.exec(html)?.[0] ?? '';
    expect(row).toContain('href="/admin/prompts/new"');
    expect(row).toContain(a.promptsNew);
    expect(row).toContain('href="/admin/prompts"');
  });

  it('states the requirements and immediate publication before the first field', async () => {
    const html = await render({});
    const notice = html.indexOf('data-publish-notice');
    expect(notice).toBeGreaterThan(-1);
    expect(notice).toBeLessThan(html.indexOf('name="title"'));
    expect(html).toContain('data-required-field="useCase"');
    expect(html).toContain(`${a.fieldPromptPoster} · ${a.requiredMark}`);
    expect(html).toMatch(/data-template-publish[^>]*>[^<]*템플릿 게시/);
    // One page heading; the panel does not repeat it.
    expect(html.split(a.authorHeading).length - 1).toBe(1);
  });

  it('names the missing use case in plain words, not only the generic banner', async () => {
    const html = await render({ err: 'invalid', detail: 'useCase: pick at least one use case' });
    expect(html).toContain('data-refused-field="useCase"');
    expect(html).not.toContain('data-refused-field="poster"');
  });

  it('names the missing poster the same way', async () => {
    const html = await render({ err: 'invalid', detail: 'poster: a YAGI prompt needs a poster image' });
    expect(html).toContain('data-refused-field="poster"');
  });
});
