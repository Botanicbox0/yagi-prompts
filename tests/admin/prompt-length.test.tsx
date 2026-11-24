import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptFields } from '@/components/admin/prompt-fields';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import { loadPromptBySlug } from '@/lib/prompts/repo';
import { renderStylingBlock } from '@/lib/template-director/styling';
import { adminHarness, upload, type AdminHarness } from '../helpers/admin';
import { runner } from '../helpers/pglite';

vi.mock('server-only', () => ({}));

/**
 * Founder, 2026-11-25: Seedance 2.5 takes up to 15,000 characters per clip. The admin template forms save such a
 * prompt, keep saving the longer prompts older templates already have (the field's own cap is 40,000), and warn —
 * without blocking — when a Seedance 2.5 template's prompt is over 15,000. Filler text only (the repo is public).
 */

const fill = (total: number): string => {
  const head = 'A woman walks through a white studio while the camera pushes in slowly on her face. ';
  return `${head}${'x'.repeat(total - head.length)}`;
};
const dict = getDictionary('ko');
const WARNING = interpolate(dict.admin.promptOverEngineLimit, { max: '15,000' });

describe('admin template prompts and the Seedance 2.5 limit', () => {
  let harness: AdminHarness;
  const sql = () => runner(harness.db);
  beforeEach(async () => {
    harness = await adminHarness();
  });
  afterEach(async () => harness.close());

  const authoring = (title: string, promptText: string, engine = 'seedance-2.5', runtimeSeconds = 10) => ({
    title,
    titleKo: '길이 테스트',
    promptText,
    useCase: 'brand-ad',
    textVisibility: 'public',
    models: ['seedance-2.5'],
    medium: 'video',
    engine,
    runtimeSeconds,
    poster: upload('poster.png', 'POSTER-BYTES', 'image/png'),
  });
  const fields = async (slug: string) => renderToStaticMarkup(<PromptFields row={(await loadPromptBySlug(sql(), slug))!} dict={dict} />);

  it('saves a 15,000-character Seedance 2.5 prompt and shows no warning', async () => {
    expect(await harness.run('prompt.create', authoring('Exact limit', fill(15_000)))).toMatchObject({ ok: true, code: 'published' });
    const row = (await loadPromptBySlug(sql(), 'exact-limit'))!;
    expect(row.promptText).toHaveLength(15_000);
    expect(row.engine).toBe('seedance-2.5');
    const html = await fields('exact-limit');
    expect(html).not.toContain('data-prompt-over-limit');
    expect(html).not.toContain(WARNING);
  });

  it('keeps saving a longer prompt on create and update, and warns without blocking', async () => {
    expect(await harness.run('prompt.create', authoring('Long one', fill(20_000)))).toMatchObject({ ok: true, code: 'published' });
    const row = (await loadPromptBySlug(sql(), 'long-one'))!;
    expect(row.promptText).toHaveLength(20_000);
    const html = await fields('long-one');
    expect(html).toContain('data-prompt-over-limit="20000"');
    expect(html).toContain(WARNING);

    const edit = {
      id: row.id, slug: row.slug, title: row.title, titleKo: row.titleKo ?? '', promptText: fill(20_500), useCase: 'brand-ad', handle: '',
      textVisibility: row.textVisibility, featured: '', models: row.models, medium: 'video', engine: 'seedance-2.5', runtimeSeconds: 10,
    };
    expect(await harness.run('prompt.update', edit)).toMatchObject({ ok: true, code: 'saved' });
    expect((await loadPromptBySlug(sql(), 'long-one'))!.promptText).toHaveLength(20_500);
  });

  it('warns only for a template that renders on Seedance 2.5', async () => {
    // A 10-second Seedance 2.0 template stays on 2.0 (no verified limit); a 20-second one renders on 2.5.
    await harness.run('prompt.create', authoring('Short two', fill(20_000), 'seedance-2.0', 10));
    await harness.run('prompt.create', authoring('Long two', fill(20_000), 'seedance-2.0', 20));
    expect(await fields('short-two')).not.toContain('data-prompt-over-limit');
    expect(await fields('long-two')).toContain(WARNING);
  });
});

describe('prompt.declareStyling and the Seedance 2.5 limit', () => {
  let harness: AdminHarness;
  const sql = () => runner(harness.db);
  beforeEach(async () => {
    harness = await adminHarness();
  });
  afterEach(async () => harness.close());

  const BLOCK = renderStylingBlock([{ part: 'hair', from: 'template', note: 'a sleek low bun.' }]);
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
    expect(outcome.detail).toMatch(/^declareStyling: with the block the prompt would run to [\d,]+ characters; Seedance 2\.5 takes up to 15,000 per clip$/);
    expect((await loadPromptBySlug(sql(), 'near-limit'))!.promptText).toBe(base);
  });

  it('still declares a block that fits', async () => {
    const id = await template('Room left', fill(14_000));
    expect(await harness.run('prompt.declareStyling', { id, block: BLOCK })).toMatchObject({ ok: true });
    expect((await loadPromptBySlug(sql(), 'room-left'))!.promptText.length).toBeLessThanOrEqual(15_000);
  });
});
