import { prerender } from 'react-dom/static';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptCard } from '@/components/admin/prompt-fields';
import { refusalMessage } from '@/components/admin/prompt-create-feedback';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import { loadPromptBySlug } from '@/lib/prompts/repo';
import { loadOverLimitTemplates } from '@/lib/prompts/prompt-length';
import { TEMPLATE_STYLING_DEFAULT_BLOCK, renderStylingBlock } from '@/lib/template-director/styling';
import { adminHarness, upload, type AdminHarness } from '../helpers/admin';
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
import AdminPromptsPage from '@/app/(admin)/admin/prompts/page';

/**
 * Founder, 2026-11-25: Seedance 2.5 takes up to 15,000 characters per clip, and a template over that is not acceptable
 * from now on — checked before it reaches buyers (create, approve, unarchive). An older template over the limit stays on
 * sale untouched and can be shortened step by step; the page shows each clip's length and the list marks the ones over.
 * Filler text only (the repo is public).
 */

/** A person template's text of exactly `total` characters, its styling block (rule 3, required on create) included. */
const fill = (total: number): string => {
  const head = 'A woman walks through a white studio while the camera pushes in slowly on her face. ';
  const tail = `\n\n${TEMPLATE_STYLING_DEFAULT_BLOCK}`;
  return `${head}${'x'.repeat(total - head.length - tail.length)}${tail}`;
};
const dict = getDictionary('ko');
const a = dict.admin;
const refusal = (chars: string) => `promptText: prompt length: clip 1 is ${chars} characters; Seedance 2.5 takes up to 15,000 per clip`;

describe('the 15,000-character gate on admin templates', () => {
  let harness: AdminHarness;
  const sql = () => runner(harness.db);
  beforeEach(async () => {
    harness = await adminHarness();
    state.sql = runner(harness.db);
  });
  afterEach(async () => harness.close());

  const authoring = (title: string, promptText: string, engine = 'seedance-2.5', runtimeSeconds = 10) => ({
    title, titleKo: '길이 테스트', promptText, useCase: 'brand-ad', textVisibility: 'public', models: ['seedance-2.5'],
    medium: 'video', engine, runtimeSeconds, poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
  });
  const slugOf = (title: string) => title.toLowerCase().replace(/ /g, '-');
  async function created(title: string, promptText: string): Promise<string> {
    expect(await harness.run('prompt.create', authoring(title, promptText))).toMatchObject({ ok: true, code: 'published' });
    return (await loadPromptBySlug(sql(), slugOf(title)))!.id;
  }
  /** An older template saved before the gate (or by direct SQL): over the limit and on sale. */
  async function legacy(title: string, chars: number): Promise<string> {
    const id = await created(title, fill(14_000));
    await sql().query('update prompt_items set prompt_text = $2 where id = $1', [id, fill(chars)]);
    return id;
  }
  const edit = async (id: string, promptText: string, title?: string) => {
    const row = (await loadPromptBySlug(sql(), (await sql().query<{ slug: string }>('select slug from prompt_items where id = $1', [id])).rows[0]!.slug))!;
    return harness.run('prompt.update', {
      id, slug: row.slug, title: title ?? row.title, titleKo: row.titleKo ?? '', promptText, useCase: 'brand-ad', handle: '',
      textVisibility: row.textVisibility, featured: '', models: row.models, medium: 'video', engine: 'seedance-2.5', runtimeSeconds: 10,
    });
  };
  const textOf = async (id: string) => (await sql().query<{ prompt_text: string; status: string }>('select prompt_text, status::text as status from prompt_items where id = $1', [id])).rows[0]!;
  async function page(id: string, query: Record<string, string> = {}) {
    const { prelude } = await prerender(await AdminPromptItemPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(query) }));
    return new Response(prelude).text();
  }

  it('publishes a 15,000-character Seedance 2.5 prompt and refuses 15,001, writing nothing', async () => {
    const id = await created('Exact limit', fill(15_000));
    expect((await textOf(id)).prompt_text).toHaveLength(15_000);
    expect(await harness.run('prompt.create', authoring('One over', fill(15_001)))).toEqual({ ok: false, code: 'invalid', detail: refusal('15,001') });
    expect(await loadPromptBySlug(sql(), 'one-over')).toBeNull();
    // A 10-second Seedance 2.0 template has no verified limit; a 20-second one renders on 2.5 and is held to it.
    expect(await harness.run('prompt.create', authoring('Short two', fill(20_000), 'seedance-2.0', 10))).toMatchObject({ ok: true });
    expect(await harness.run('prompt.create', authoring('Long two', fill(15_001), 'seedance-2.0', 20))).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('says the refusal in a sentence on the create form and on the template page', async () => {
    const said = interpolate(a.promptLengthRefusal, { n: '1', chars: '15,480', max: '15,000' });
    expect(said).toBe('1번째 클립 프롬프트가 15,480자예요. Seedance 2.5는 클립당 15,000자까지 받습니다. 줄인 뒤 다시 저장해 주세요.');
    const labels = { useCase: 'u', poster: 'p', invalid: a.errInvalid, upload: 'up', session: 's', uncertain: 'x', retained: 'r', publishing: 'pb', lengthCopy: a.promptLengthRefusal };
    expect(refusalMessage({ ok: false, code: 'invalid', field: 'promptText', detail: refusal('15,480') }, labels).message).toBe(said);
    const id = await created('Page refusal', fill(14_000));
    const html = await page(id, { err: 'invalid', detail: refusal('15,480') });
    expect(html).toContain('data-prompt-length-refusal');
    expect(html).toContain(said);
  });

  it('shows each clip against its limit on the template page, flagged when over', async () => {
    const fits = await page(await created('Fits fine', fill(12_340)));
    expect(fits).toContain(interpolate(a.promptLengthLine, { chars: '12,340', max: '15,000' }));
    expect(fits).not.toContain('data-over="true"');
    const over = await page(await legacy('Old long', 20_000));
    expect(over).toContain(interpolate(a.promptLengthLine, { chars: '20,000', max: '15,000' }));
    expect(over).toContain('data-over="true"');
    expect(over).toContain(interpolate(a.promptOverEngineLimit, { max: '15,000' }));
  });

  it('lets an older over-limit template be shortened, never lengthened, and keeps it on sale untouched', async () => {
    const id = await legacy('Old long', 20_000);
    expect((await textOf(id)).status).toBe('published');
    expect(await edit(id, fill(20_500))).toEqual({ ok: false, code: 'invalid', detail: refusal('20,500') });
    expect((await textOf(id)).prompt_text).toHaveLength(20_000);
    expect(await edit(id, fill(19_000))).toMatchObject({ ok: true, code: 'saved' });
    expect((await textOf(id)).prompt_text).toHaveLength(19_000);
    // A save that keeps the text (a new title here) is never refused for its length.
    expect(await edit(id, fill(19_000), 'Old long renamed')).toMatchObject({ ok: true, code: 'saved' });
    expect(await edit(id, fill(15_000))).toMatchObject({ ok: true, code: 'saved' });
    // Once within the limit, it stays within it.
    expect(await edit(id, fill(15_001))).toEqual({ ok: false, code: 'invalid', detail: refusal('15,001') });
  });

  it('refuses to approve or unarchive a template over the limit', async () => {
    const pending = await created('Pending long', fill(14_000));
    await sql().query("update prompt_items set status = 'pending', published_at = null, prompt_text = $2 where id = $1", [pending, fill(15_500)]);
    const approve = () => harness.run('prompt.approve', { id: pending, slug: 'pending-long', useCase: 'brand-ad', featured: '' });
    expect(await approve()).toEqual({ ok: false, code: 'invalid', detail: refusal('15,500') });
    expect((await textOf(pending)).status).toBe('pending');
    await sql().query('update prompt_items set prompt_text = $2 where id = $1', [pending, fill(15_000)]);
    expect(await approve()).toMatchObject({ ok: true, code: 'approved' });

    const archived = await created('Archived long', fill(14_000));
    expect(await harness.run('prompt.archive', { id: archived, archived: 'true' })).toMatchObject({ ok: true, code: 'archived' });
    await sql().query('update prompt_items set prompt_text = $2 where id = $1', [archived, fill(15_500)]);
    expect(await harness.run('prompt.archive', { id: archived, archived: '' })).toEqual({ ok: false, code: 'invalid', detail: refusal('15,500') });
    expect((await textOf(archived)).status).toBe('archived');
  });

  it('marks the published templates over the limit on the list, from lengths only', async () => {
    const old = await legacy('Old long', 20_000);
    const fine = await created('Fits fine', fill(14_000));
    const archived = await legacy('Archived long', 20_000);
    await harness.run('prompt.archive', { id: archived, archived: 'true' });
    const over = await loadOverLimitTemplates(sql(), true);
    expect([...over.entries()]).toEqual([[old, 15_000]]);
    expect(over.has(fine)).toBe(false);

    const row = (await loadPromptBySlug(sql(), 'old-long'))!;
    const card = await new Response((await prerender(<ul><PromptCard row={row} dict={dict} href="/admin/prompts/x" locale="ko" overLimit={15_000} /></ul>)).prelude).text();
    expect(card).toContain('data-prompt-over-limit-chip="15000"');
    expect(card).toContain('15,000자 초과');
    const { prelude } = await prerender(await AdminPromptsPage({ searchParams: Promise.resolve({}) }));
    const list = await new Response(prelude).text();
    expect(list.match(/data-prompt-over-limit-chip=/g)).toHaveLength(1);
  });
});

describe('prompt.createSet holds each frame to its image engine', () => {
  // An image set has no Seedance clip: its frames render on image engines, whose 8,000-character cap the set has always
  // checked (the recipe stores "Image 1" as {{selfie}}, three characters longer).
  let harness: AdminHarness;
  const sql = () => runner(harness.db);
  beforeEach(async () => {
    harness = await adminHarness();
  });
  afterEach(async () => harness.close());

  const frame = (chars: number) => {
    const head = 'Image 1 is the person. Keep their face. ', tail = `\n\n${TEMPLATE_STYLING_DEFAULT_BLOCK}`;
    return `${head}${'x'.repeat(chars - head.length - tail.length)}${tail}`;
  };
  const fields = (second: string) => ({
    title: 'Long Frames', titleKo: '긴 컷', engine: 'nano-banana-pro', aspect: '4:5', frameCount: '2', thumbnail: '0',
    frame0Prompt: frame(200), frame1Prompt: second, frame0Size: '1856x2304', frame1Size: '1856x2304',
    frame0: upload('one.webp', 'ONE', 'image/webp'), frame1: upload('two.webp', 'TWO', 'image/webp'),
  });

  it('refuses a frame over the limit, naming it, and takes one at the limit', async () => {
    const over = await harness.run('prompt.createSet', fields(frame(7_998)));
    expect(over).toMatchObject({ ok: false, code: 'invalid' });
    expect(over.detail).toMatch(/shot2: the prompt is over 8000 characters/);
    expect(await loadPromptBySlug(sql(), 'long-frames')).toBeNull();
    expect(await harness.run('prompt.createSet', fields(frame(7_997)))).toMatchObject({ ok: true, code: 'published' });
  });
});

describe('prompt.declareStyling and the Seedance 2.5 limit', () => {
  let harness: AdminHarness;
  const sql = () => runner(harness.db);
  beforeEach(async () => {
    harness = await adminHarness();
  });
  afterEach(async () => harness.close());

  // Longer than the default block the template is created with, so declaring it adds characters.
  const BLOCK = renderStylingBlock([
    { part: 'hair', from: 'template', note: 'a sleek low bun with a centre part and two loose strands.' },
    { part: 'makeup', from: 'template', note: 'soft rosy cheeks, a glossy lip and fine brown liner.' },
  ]);
  async function template(title: string, promptText: string): Promise<string> {
    expect(await harness.run('prompt.create', {
      title, titleKo: '스타일 길이', promptText, useCase: 'brand-ad', textVisibility: 'public', models: ['seedance-2.5'],
      medium: 'video', engine: 'seedance-2.5', runtimeSeconds: 10, poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
    })).toMatchObject({ ok: true });
    return (await loadPromptBySlug(sql(), title.toLowerCase().replace(/ /g, '-')))!.id;
  }

  it('refuses a block that would push a Seedance 2.5 prompt past 15,000, and writes nothing', async () => {
    const base = fill(15_000 - 20);
    const id = await template('Near limit', base);
    const outcome = await harness.run('prompt.declareStyling', { id, block: BLOCK });
    expect(outcome).toMatchObject({ ok: false, code: 'invalid' });
    expect(outcome.detail).toMatch(/^declareStyling: block: prompt length: clip 1 is [\d,]+ characters; Seedance 2\.5 takes up to 15,000 per clip$/);
    expect((await loadPromptBySlug(sql(), 'near-limit'))!.promptText).toBe(base);
  });

  it('still declares a block that fits', async () => {
    const id = await template('Room left', fill(14_000));
    expect(await harness.run('prompt.declareStyling', { id, block: BLOCK })).toMatchObject({ ok: true });
    expect((await loadPromptBySlug(sql(), 'room-left'))!.promptText.length).toBeLessThanOrEqual(15_000);
  });
});
