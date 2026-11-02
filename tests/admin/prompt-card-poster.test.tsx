import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PromptCard } from '@/components/admin/prompt-fields';
import { getDictionary } from '@/lib/i18n/dictionaries';
import type { PromptRow } from '@/lib/prompts/repo';

/**
 * Staff report (2026-11-02): a 16:9 and 9:16 mix made the admin wall uneven. Every card now shows a
 * 1:1 thumbnail, cropped at the position staff chose in the editor, or at the centre by default.
 */
describe('admin wall poster', () => {
  const dict = getDictionary('ko');

  function card(poster: { w?: number; h?: number } | null, posterFocus?: { x: number; y: number }) {
    const row = {
      id: '00000000-0000-4000-8000-000000000001',
      slug: 'a-template',
      source: 'yagi',
      status: 'pending',
      title: 'A template',
      titleKo: null,
      textVisibility: 'public',
      featured: false,
      aspectDefault: null,
      createdAt: null,
      publishedAt: null,
      media: poster === null ? {} : { poster: { staging_key: 'k', sha256: 'a'.repeat(64), mime: 'image/png', ...poster }, ...(posterFocus ? { posterFocus } : {}) },
    } as unknown as PromptRow;
    return renderToStaticMarkup(<PromptCard row={row} dict={dict} href="/admin/prompts/x" locale="ko" />);
  }

  it('shows a landscape and a portrait poster in the same 1:1 frame', () => {
    for (const html of [card({ w: 1600, h: 900 }), card({ w: 1080, h: 1920 }), card({})]) {
      expect(html).toContain('data-poster-frame="square"');
      expect(html).toContain('aspect-square');
      expect(html).toContain('object-cover');
      expect(html).not.toContain('aspect-video');
      expect(html).not.toContain('aspect-[9/16]');
    }
  });

  it('crops at the saved position, and at the centre without one', () => {
    expect(card({ w: 1600, h: 900 }, { x: 20, y: 50 })).toContain('object-position:20% 50%');
    expect(card({ w: 1600, h: 900 })).toContain('object-position:50% 50%');
  });

  it('keeps the slug placeholder in the same 1:1 frame when there is no poster', () => {
    const html = card(null);
    expect(html).toContain('a-template');
    expect(html).toContain('aspect-square');
    expect(html).not.toContain('<img');
  });
});
