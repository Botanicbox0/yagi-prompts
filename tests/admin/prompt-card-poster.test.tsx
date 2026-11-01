import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PromptCard } from '@/components/admin/prompt-fields';
import { getDictionary } from '@/lib/i18n/dictionaries';
import type { PromptRow } from '@/lib/prompts/repo';

/**
 * Staff report (2026-11-02): a landscape thumbnail showed black lines on the admin wall. The wall
 * letterboxed every poster into a black 16:9 box, so anything but exactly 16:9 had bars. A poster now
 * fills a 16:9 or a 9:16 frame, whichever matches its shape, the way the staff member asked.
 */
describe('admin wall poster', () => {
  const dict = getDictionary('ko');

  function card(poster: { w?: number; h?: number } | null, aspectDefault: string | null = null) {
    const row = {
      id: '00000000-0000-4000-8000-000000000001',
      slug: 'a-template',
      source: 'yagi',
      status: 'pending',
      title: 'A template',
      titleKo: null,
      textVisibility: 'public',
      featured: false,
      aspectDefault,
      createdAt: null,
      publishedAt: null,
      media: poster === null ? {} : { poster: { staging_key: 'k', sha256: 'a'.repeat(64), mime: 'image/png', ...poster } },
    } as unknown as PromptRow;
    return renderToStaticMarkup(<PromptCard row={row} dict={dict} href="/admin/prompts/x" locale="ko" />);
  }

  it('fills the frame instead of letterboxing', () => {
    const html = card({ w: 1600, h: 1200 });
    expect(html).toContain('object-cover');
    expect(html).not.toContain('object-contain');
  });

  it('uses 16:9 for a landscape poster and 9:16 for a portrait one', () => {
    expect(card({ w: 1600, h: 1200 })).toContain('data-poster-frame="landscape"');
    expect(card({ w: 1600, h: 1200 })).toContain('aspect-video');
    expect(card({ w: 1080, h: 1350 })).toContain('data-poster-frame="portrait"');
    expect(card({ w: 1080, h: 1350 })).toContain('aspect-[9/16]');
  });

  it("falls back on the template's aspect when the upload was not measured", () => {
    expect(card({}, '9:16')).toContain('data-poster-frame="portrait"');
    expect(card({}, '4:3')).toContain('data-poster-frame="landscape"');
    expect(card({})).toContain('data-poster-frame="landscape"');
  });

  it('keeps the slug placeholder when there is no poster', () => {
    const html = card(null);
    expect(html).toContain('a-template');
    expect(html).not.toContain('<img');
  });
});
