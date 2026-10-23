import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { FirstRunSheet, createOnboardingRecorder, firstRunSelfieHref, shouldShowFirstRun } from '@/components/onboarding/first-run-sheet';

/**
 * The first-run sheet (docs/PLATFORM-2.0.md §3.2-1): once, right after the first sign-in, on the
 * video catalogue. Three cards, skippable, and dismissing it records `profiles.onboarded_at`.
 *
 * The catalogue is a static page, so the sheet is a small client island: its server markup is
 * EMPTY — a visitor, a signed-out reader and an account that has seen it get nothing at all.
 */

describe('the first-run sheet', () => {
  for (const locale of ['ko', 'en'] as const) {
    const copy = getDictionary(locale).firstRun;

    it(`draws nothing on the server, for anyone (${locale})`, () => {
      expect(renderToStaticMarkup(<FirstRunSheet copy={copy} locale={locale} />)).toBe('');
    });

    it(`opens on the first of three cards, as a modal sheet that can be skipped (${locale})`, () => {
      const html = renderToStaticMarkup(<FirstRunSheet copy={copy} locale={locale} initialOpen />);
      expect(html).toContain('data-onboarding-sheet');
      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain('data-onboarding-step="1"');
      expect(html).toContain(copy.step1Title);
      expect(html).toContain('data-onboarding-skip');
      expect(html).toContain(copy.skip);
      // The progress names all three, so a reader knows how long this is.
      expect(html.match(/data-onboarding-dot=/g)).toHaveLength(3);
      expect(html).not.toContain('data-onboarding-upload');
    });

    it(`ends on the photo door and the catalogue (${locale})`, () => {
      const html = renderToStaticMarkup(<FirstRunSheet copy={copy} locale={locale} initialOpen initialStep={2} />);
      expect(html).toContain('data-onboarding-step="3"');
      expect(html).toContain(copy.step3Title);
      expect(html).toContain(`href="${firstRunSelfieHref(locale).replaceAll('&', '&amp;')}"`);
      expect(html).toContain('data-onboarding-upload');
      expect(html).toContain(copy.uploadCta);
      expect(html).toContain('data-onboarding-browse');
      expect(html).toContain(copy.browseCta);
    });
  }

  it('sends "upload my photo" to the photo page and back to the catalogue', () => {
    expect(firstRunSelfieHref('ko')).toBe('/identity/selfie?next=%2Fko%2Fvideo');
    expect(firstRunSelfieHref('en')).toBe('/identity/selfie?next=%2Fen%2Fvideo');
  });

  it('opens only on an explicit yes from the server', () => {
    expect(shouldShowFirstRun({ show: true })).toBe(true);
    for (const answer of [{ show: false }, {}, null, undefined, 'true', { show: 'true' }, { signedIn: true }]) {
      expect(shouldShowFirstRun(answer)).toBe(false);
    }
  });

  it('records the dismissal once, however many ways it is closed', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, recorded: true })));
    const recorder = createOnboardingRecorder('/api/account/onboarding', fetchImpl as unknown as typeof fetch);
    await Promise.all([recorder.record(), recorder.record()]);
    await recorder.record();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('/api/account/onboarding', expect.objectContaining({ method: 'POST', credentials: 'same-origin', keepalive: true }));
  });

  it('never throws when the record cannot be sent — closing still closes', async () => {
    const recorder = createOnboardingRecorder('/api/account/onboarding', (async () => { throw new Error('offline'); }) as unknown as typeof fetch);
    await expect(recorder.record()).resolves.toBeUndefined();
  });
});
