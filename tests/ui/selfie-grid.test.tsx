import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { SelfieGrid, SelfieLibraryPanel, selfieCountLabel, selfieName } from '@/components/identity/selfie-grid';
import type { SelfieView } from '@/lib/identity/selfie-service';

/**
 * docs/IDENTITY-SELFIE.md §3 — the saved photos as MARKUP: the account card and `/identity/selfie`
 * manage them (default badge, "make default", delete, note, "M of N"), the studio sheet picks from
 * them. N=1 must read as naturally as N=10: one photo, no counter, no badge, change instead of add.
 */
const id = (n: number) => `10000000-0000-4000-8000-00000000000${n}`;
const view = (n: number, over: Partial<SelfieView> = {}): SelfieView => ({
  id: id(n), width: 320, height: 400, createdAt: '2026-10-22T05:00:00.000Z', imageUrl: `/api/identity/selfie/${id(n)}/image`,
  label: null, isDefault: n === 1, lastUsedAt: null, ...over,
});
const three = [view(1), view(2, { label: '안경' }), view(3)];
const count = (html: string, needle: string) => html.split(needle).length - 1;
/** Every control a thumb has to hit is at least 44px tall (or a 44px square). */
const allButtonsReachable = (html: string) => (html.match(/<button[^>]*>/g) ?? []).every(tag => /min-h-11|min-h-12|size-11|size-12/.test(tag));

describe('selfie grid — manage', () => {
  const copy = getDictionary('ko').selfie;
  it('N=10 with three photos: "10장 중 3장", one default badge, make-default on the others, delete and a note on each', () => {
    const html = renderToStaticMarkup(<SelfieGrid copy={copy} locale="ko" items={three} limit={10} mode="manage" />);
    expect(html).toContain('data-selfie-grid');
    expect(html).toContain('data-selfie-mode="manage"');
    expect(count(html, 'data-selfie-item=')).toBe(3);
    expect(html).toContain('10장 중 3장');
    expect(selfieCountLabel(copy, 3, 10)).toBe('10장 중 3장');
    expect(selfieCountLabel(getDictionary('en').selfie, 3, 10)).toBe('3 of 10 photos');
    expect(count(html, 'data-selfie-default-badge')).toBe(1);
    expect(html).toMatch(new RegExp(`data-selfie-item="${id(1)}" data-selfie-default="true"`));
    expect(count(html, 'data-selfie-make-default')).toBe(2);
    expect(count(html, 'data-selfie-delete')).toBe(3);
    expect(count(html, 'data-selfie-label-edit')).toBe(3);
    expect(html).toContain('안경');
    expect(html).toContain('data-selfie-full="false"');
    expect(allButtonsReachable(html)).toBe(true);
    // Owner-only images straight from the private route; nothing else about the file is exposed.
    for (const item of three) expect(html).toContain(`src="${item.imageUrl}"`);
    expect(html).not.toMatch(/sha256|input_key|selfie\.png/);
  });
  it('N=1 with one photo: no counter, no badge, no make-default — the photo, its note and delete', () => {
    const html = renderToStaticMarkup(<SelfieGrid copy={copy} locale="ko" items={[view(1)]} limit={1} mode="manage" />);
    expect(count(html, 'data-selfie-item=')).toBe(1);
    expect(html).not.toContain('data-selfie-count');
    expect(selfieCountLabel(copy, 1, 1)).toBeNull();
    expect(html).not.toContain('data-selfie-default-badge');
    expect(html).not.toContain('data-selfie-make-default');
    expect(html).toContain('data-selfie-delete');
    expect(html).toContain('data-selfie-full="true"');
  });
  it('a full library says so, and the counter keeps the honest numbers when the limit was lowered', () => {
    const html = renderToStaticMarkup(<SelfieGrid copy={copy} locale="ko" items={three} limit={3} mode="manage" />);
    expect(html).toContain('data-selfie-full="true"');
    expect(html).toContain('3장 중 3장');
    expect(selfieCountLabel(copy, 3, 2)).toBe('2장 중 3장');
  });
});

describe('selfie grid — pick', () => {
  for (const locale of ['ko', 'en'] as const) {
    const copy = getDictionary(locale).selfie;
    it(`every photo is one 44px button that says which one is chosen and names itself (${locale})`, () => {
      const html = renderToStaticMarkup(<SelfieGrid copy={copy} locale={locale} items={three} limit={10} mode="pick" selectedId={id(2)} />);
      expect(html).toContain('data-selfie-mode="pick"');
      expect(count(html, 'data-selfie-pick=')).toBe(3);
      expect(html).toMatch(new RegExp(`data-selfie-pick="${id(2)}"[^>]*aria-pressed="true"`));
      expect(count(html, 'aria-pressed="false"')).toBe(2);
      expect(html).not.toContain('data-selfie-delete');
      expect(html).not.toContain('data-selfie-make-default');
      expect(allButtonsReachable(html)).toBe(true);
      // The name a screen reader hears: the note (or the photo's place), "default", and the saved date —
      // never an empty button, and never two buttons that sound the same.
      expect(html).toContain(`aria-label="${selfieName(copy, three[1]!, locale, 1)}"`);
      expect(selfieName(copy, three[0]!, locale)).toContain(copy.defaultBadge);
      expect(selfieName(copy, three[1]!, locale, 1).startsWith('안경')).toBe(true);
      const names = (html.match(/data-selfie-pick="[^"]+"[^>]*aria-label="([^"]+)"/g) ?? []).map(tag => tag.replace(/.*aria-label="([^"]+)"/, '$1'));
      expect(names).toHaveLength(3);
      expect(new Set(names).size).toBe(3);
      expect(names[2]).toContain(locale === 'ko' ? '사진 3' : 'Photo 3');
    });
  }
});

describe('selfie library panel', () => {
  const copy = getDictionary('ko').selfie;
  const library = (items: SelfieView[], limit: number) => ({ limit, defaultId: items.find(item => item.isDefault)?.id ?? null, items });
  it('account card under the limit: the grid and a way to add a photo', () => {
    const html = renderToStaticMarkup(<SelfieLibraryPanel copy={copy} locale="ko" variant="account" initial={library(three, 10)} manageHref="/identity/selfie" />);
    expect(html).toContain('data-selfie-library');
    expect(html).toContain('data-selfie-variant="account"');
    expect(html).toContain('data-selfie-grid');
    expect(html).toMatch(/data-selfie-add-link[^>]*href="\/identity\/selfie\?add=1"|href="\/identity\/selfie\?add=1"[^>]*data-selfie-add-link/);
    expect(html).toContain(copy.addPhoto);
    expect(html).toMatch(/role="status"[^>]*aria-live="polite"/);
  });
  it('account card at N=1: change, not add; and the empty account invites the first upload', () => {
    const one = renderToStaticMarkup(<SelfieLibraryPanel copy={copy} locale="ko" variant="account" initial={library([view(1)], 1)} manageHref="/identity/selfie" />);
    expect(one).toContain('href="/identity/selfie?change=1"');
    expect(one).toContain(copy.change);
    expect(one).not.toContain(copy.addPhoto);
    const empty = renderToStaticMarkup(<SelfieLibraryPanel copy={copy} locale="ko" variant="account" initial={library([], 1)} manageHref="/identity/selfie" />);
    expect(empty).toContain(copy.accountEmpty);
    expect(empty).toContain('href="/identity/selfie"');
    expect(empty).not.toContain('data-selfie-grid');
  });
  it('the page with no photo is the uploader alone', () => {
    const html = renderToStaticMarkup(<SelfieLibraryPanel copy={copy} locale="ko" variant="page" initial={library([], 10)} continueHref="/ko/video" continueLabel={copy.browse} />);
    expect(html).toContain('data-selfie-state="empty"');
    expect(html).not.toContain('data-selfie-grid');
  });
  it('the page with photos: the grid plus add (under the limit) or change (at N=1), and the way onward', () => {
    const under = renderToStaticMarkup(<SelfieLibraryPanel copy={copy} locale="ko" variant="page" initial={library(three, 10)} continueHref="/ko/t/tpl#make" continueLabel={copy.continue} />);
    expect(under).toContain('data-selfie-grid');
    expect(under).toContain('data-selfie-add');
    expect(under).not.toContain('data-selfie-uploader');
    expect(under).toContain('data-selfie-continue');
    expect(under).toContain(copy.onlyYou);
    const full = renderToStaticMarkup(<SelfieLibraryPanel copy={copy} locale="ko" variant="page" initial={library([view(1)], 1)} />);
    expect(full).toContain('data-selfie-change');
    expect(full).not.toContain('data-selfie-add=');
    // `?change=1` opens straight on the uploader, replacing the default, with a way back.
    const changing = renderToStaticMarkup(<SelfieLibraryPanel copy={copy} locale="ko" variant="page" initial={library([view(1)], 1)} startEditing />);
    expect(changing).toContain('data-selfie-state="changing"');
    expect(changing).toContain(copy.replaceNote);
    expect(changing).toContain('data-selfie-cancel');
  });
});
