import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { SelfieUploader } from '@/components/identity/selfie-uploader';
import { selfieSavedOn } from '@/lib/identity/selfie-format';

/**
 * The uploader as MARKUP (docs/IDENTITY-SELFIE.md): what the person sees before any interaction,
 * in both its states, and the invariants the studio and the sweep lean on.
 */
const selfie = { id: '10000000-0000-4000-8000-000000000001', width: 320, height: 400, createdAt: '2026-10-22T20:30:00.000Z', imageUrl: '/api/identity/selfie/10000000-0000-4000-8000-000000000001/image' };

describe('selfie uploader — empty', () => {
  for (const locale of ['ko', 'en'] as const) {
    const copy = getDictionary(locale).selfie;
    const html = renderToStaticMarkup(<SelfieUploader copy={copy} locale={locale} initial={null} />);
    it(`offers the picker, the guide and the consent before any file (${locale})`, () => {
      expect(html).toContain('data-selfie-state="empty"');
      expect(html).toContain('data-selfie-dropzone');
      expect(html).toContain(copy.choosePhoto);
      expect(html).toContain(copy.dropHint);
      expect(html).toContain(copy.guideSummary);
      expect(html).toContain(copy.consent);
      // The camera button is decided on the client (touch + mediaDevices); SSR never promises a camera.
      expect(html).not.toContain('data-selfie-camera');
      // File inputs are reached through the buttons, never by tabbing onto an invisible control.
      expect(html.match(/type="file"[^>]*tabindex="-1"/g)).toHaveLength(2);
      // Save waits for a file; consent is asked inline, not by a dead button.
      expect(html).toMatch(/data-selfie-save[^>]*disabled=""/);
      expect(html).not.toContain('data-selfie-cancel');
      // One live region exists from the first render so later advice is announced.
      expect(html).toMatch(/role="status" aria-live="polite"/);
      expect(html).not.toContain('data-selfie-error');
    });
  }
});

describe('selfie uploader — saved', () => {
  const copy = getDictionary('ko').selfie;
  it('shows the photo, when it was saved on the Korean clock, and the one way to change it', () => {
    const html = renderToStaticMarkup(<SelfieUploader copy={copy} locale="ko" initial={selfie} continueHref="/ko/t/tpl#make" />);
    expect(html).toContain('data-selfie-state="saved"');
    expect(html).toContain(`src="${selfie.imageUrl}"`);
    expect(html).toContain('data-selfie-change');
    expect(html).toContain('data-selfie-continue');
    expect(html).toContain(copy.savedNote);
    // 20:30Z is 05:30 KST the next day: the label says the 23rd, not the server's 22nd.
    expect(html).toContain('2026년 10월 23일');
    expect(selfieSavedOn(copy.savedOn, 'not-a-date', 'ko')).toBeNull();
    expect(selfieSavedOn(getDictionary('en').selfie.savedOn, selfie.createdAt, 'en')).toBe('Saved Oct 22, 2026');
  });
  it('opens straight on the chooser when asked to change, keeping a way back to the current photo', () => {
    const html = renderToStaticMarkup(<SelfieUploader copy={copy} locale="ko" initial={selfie} startEditing />);
    expect(html).toContain('data-selfie-state="changing"');
    expect(html).toContain('data-selfie-cancel');
    expect(html).toContain(copy.cancelChange);
  });
});
