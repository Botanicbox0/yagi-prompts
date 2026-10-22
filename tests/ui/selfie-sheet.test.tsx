import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { SelfieSheet, sheetKeyAction, trapFocusIndex } from '@/components/identity/selfie-sheet';
import type { SelfieView } from '@/lib/identity/selfie-service';

/**
 * docs/IDENTITY-SELFIE.md §3 — "이 얼굴로 만들까요?" (founder, 2026-10-22: "해당 얼굴을 활용해서
 * 제작할까요?"). With a saved photo the studio asks first, big and one-handed; "another photo"
 * opens a modal sheet (bottom sheet on a phone, the same panel centred on a desktop) with the
 * saved photos and a way to add — or, at the limit, only to change.
 */
const id = (n: number) => `10000000-0000-4000-8000-00000000000${n}`;
const view = (n: number, over: Partial<SelfieView> = {}): SelfieView => ({
  id: id(n), width: 320, height: 400, createdAt: '2026-10-22T05:00:00.000Z', imageUrl: `/api/identity/selfie/${id(n)}/image`,
  label: null, isDefault: n === 1, lastUsedAt: null, ...over,
});
const noop = () => {};
const allButtonsReachable = (html: string) => (html.match(/<button[^>]*>/g) ?? []).every(tag => /min-h-11|min-h-12|size-11|size-12/.test(tag));

describe('selfie sheet — a saved photo asks first', () => {
  for (const locale of ['ko', 'en'] as const) {
    const copy = getDictionary(locale).selfie;
    it(`shows the suggested face big with the question and two answers (${locale})`, () => {
      const html = renderToStaticMarkup(<SelfieSheet copy={copy} locale={locale} suggested={view(1)} chosen={null} onChoose={noop} />);
      expect(html).toContain('data-selfie-sheet');
      expect(html).toContain('data-selfie-sheet-state="confirm"');
      expect(html).toContain(`src="${view(1).imageUrl}"`);
      expect(html).toContain(copy.useThisFace);
      expect(html).toMatch(new RegExp(`data-selfie-use[^>]*>${copy.useThisPhoto}<`));
      expect(html).toMatch(new RegExp(`data-selfie-other[^>]*>${copy.otherPhotos}<`));
      expect(allButtonsReachable(html)).toBe(true);
      // Closed until asked: no dialog in the page, nothing modal yet.
      expect(html).not.toContain('role="dialog"');
      expect(html).not.toContain('aria-modal');
    });
  }
  it('keeps the founder’s question in ONE dictionary key, easy to reword', () => {
    expect(getDictionary('ko').selfie.useThisFace).toBe('이 얼굴로 만들까요?');
    expect(getDictionary('en').selfie.useThisFace).toBe('Make it with this face?');
  });
  it('once answered, says which face it will use and keeps the way to another', () => {
    const copy = getDictionary('ko').selfie;
    const chosen = view(2, { label: '안경', isDefault: false });
    const html = renderToStaticMarkup(<SelfieSheet copy={copy} locale="ko" suggested={view(1)} chosen={chosen} onChoose={noop} />);
    expect(html).toContain('data-selfie-sheet-state="chosen"');
    expect(html).toContain(`src="${chosen.imageUrl}"`);
    expect(html).toContain(copy.chosenTitle);
    expect(html).toContain('안경');
    expect(html).not.toContain('data-selfie-use');
    expect(html).toContain('data-selfie-other');
  });
});

describe('selfie sheet — the chooser', () => {
  const copy = getDictionary('ko').selfie;
  const library = (items: SelfieView[], limit: number) => ({ limit, defaultId: items.find(item => item.isDefault)?.id ?? null, items });
  it('opens as a labelled modal sheet with a close button and the saved photos to pick from', () => {
    const html = renderToStaticMarkup(<SelfieSheet copy={copy} locale="ko" suggested={view(1)} chosen={null} onChoose={noop} initialOpen initialLibrary={library([view(1), view(2)], 10)} />);
    expect(html).toMatch(/role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="([^"]+)"/);
    const labelledBy = html.match(/aria-labelledby="([^"]+)"/)![1]!;
    expect(html).toContain(`id="${labelledBy}"`);
    expect(html).toContain(copy.chooserTitle);
    expect(html).toMatch(new RegExp(`data-selfie-close[^>]*aria-label="${copy.close}"|aria-label="${copy.close}"[^>]*data-selfie-close`));
    expect(html).toContain('data-selfie-chooser-view="grid"');
    expect(html).toContain('data-selfie-mode="pick"');
    expect(html).toMatch(new RegExp(`data-selfie-pick="${id(1)}"[^>]*aria-pressed="true"`));
    // A phone gets a bottom sheet; a desktop the same panel, centred.
    expect(html).toMatch(/data-selfie-chooser[^>]*class="[^"]*bottom-0[^"]*sm:/);
    expect(allButtonsReachable(html)).toBe(true);
    // "Only photos of you": said, never judged by a face matcher.
    expect(html).toContain(copy.onlyYou);
  });
  it('under the limit offers a new photo; at the limit only "change" — N=1 included', () => {
    const under = renderToStaticMarkup(<SelfieSheet copy={copy} locale="ko" suggested={view(1)} chosen={null} onChoose={noop} initialOpen initialLibrary={library([view(1), view(2)], 10)} />);
    expect(under).toMatch(new RegExp(`data-selfie-add="file"[^>]*>[^<]*(<svg[^]*?</svg>)?${copy.uploadNew}`));
    expect(under).toContain('data-selfie-count');
    expect(under).not.toContain('data-selfie-replace');
    // The camera button is the phone's (decided on the client), never promised by the server markup.
    expect(under).not.toContain('data-selfie-add="camera"');
    const full = renderToStaticMarkup(<SelfieSheet copy={copy} locale="ko" suggested={view(1)} chosen={view(2, { isDefault: false })} onChoose={noop} initialOpen initialLibrary={library([view(1), view(2, { isDefault: false })], 2)} />);
    expect(full).not.toContain('data-selfie-add=');
    expect(full).toContain('data-selfie-replace');
    expect(full).toContain('사진은 2장까지 둘 수 있어요.');
    // At the limit the chosen photo is the one a new upload replaces, and the sheet says which.
    expect(full).toMatch(new RegExp(`data-selfie-pick="${id(2)}"[^>]*aria-pressed="true"`));
    const one = renderToStaticMarkup(<SelfieSheet copy={copy} locale="ko" suggested={view(1)} chosen={null} onChoose={noop} initialOpen initialLibrary={library([view(1)], 1)} />);
    expect(one).toContain('data-selfie-replace');
    expect(one).toContain(copy.replaceNote);
    expect(one).toContain(copy.change);
    expect(one).not.toContain('data-selfie-count');
  });
  it('waits for the library politely, and offers a retry when it cannot load', () => {
    const loading = renderToStaticMarkup(<SelfieSheet copy={copy} locale="ko" suggested={view(1)} chosen={null} onChoose={noop} initialOpen />);
    expect(loading).toContain('data-selfie-chooser-view="loading"');
    expect(loading).toMatch(/role="status"[^>]*>[^<]*사진을 불러오고 있어요/);
  });
});

describe('selfie sheet — keyboard', () => {
  it('Escape closes; Tab is kept inside the sheet in both directions', () => {
    expect(sheetKeyAction('Escape')).toBe('close');
    expect(sheetKeyAction('Esc')).toBe('close');
    expect(sheetKeyAction('Tab')).toBe('trap');
    for (const key of ['Enter', ' ', 'ArrowDown', 'a']) expect(sheetKeyAction(key)).toBeNull();
    // From the last control forward wraps to the first; from the first backward to the last.
    expect(trapFocusIndex(2, 3, false)).toBe(0);
    expect(trapFocusIndex(0, 3, true)).toBe(2);
    // In the middle the browser's own order is right: nothing to do.
    expect(trapFocusIndex(1, 3, false)).toBeNull();
    expect(trapFocusIndex(1, 3, true)).toBeNull();
    // Focus that escaped the sheet comes back to its edge.
    expect(trapFocusIndex(-1, 3, false)).toBe(0);
    expect(trapFocusIndex(-1, 3, true)).toBe(2);
    expect(trapFocusIndex(0, 0, false)).toBeNull();
  });
});
