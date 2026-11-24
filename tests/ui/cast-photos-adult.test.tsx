import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { birthYearChoices } from '@/lib/account/adult-age';
import { CastPhotoFields, castPhotoHint, castPhotosReady, EMPTY_CAST_PHOTOS } from '@/components/twings/cast-photos';
import { TwingsStudio, type StudioAccessSnapshot, type StudioLabels, type StudioLive, type StudioStyle } from '@/components/twings/studio';

/**
 * docs/PERSONAL-STUDIO.md §6.1 (P2 PR B) — the make card asks for a birth year and one "19 or older" box
 * ONLY when all three hold: the Sunra face switch is on (the access call then carries `adultConfirmed`),
 * the template has a partner slot, and this account is not confirmed yet. The server refuses on its own;
 * this is only where the question is asked.
 */
const dict = getDictionary('ko');
const copy = dict.cast.photo;
const labels: StudioLabels = {
  stepPhoto: dict.studio.stepPhoto, stepStyle: dict.studio.stepStyle, stepPay: dict.studio.stepPay, stepResult: dict.studio.stepResult,
  dropZone: dict.studio.dropZone, dropHint: dict.studio.dropHint, changePhoto: dict.studio.changePhoto, chooseStyle: dict.studio.chooseStyle,
  payCta: dict.studio.payCta, payNote: dict.studio.payNote, closedTitle: dict.studio.closedTitle, closedBody: dict.studio.closedBody,
  closedCta: dict.studio.closedCta, closedDone: dict.studio.closedDone, runtimeLabel: dict.studio.runtimeLabel, needPhoto: dict.studio.needPhoto,
  noStyles: dict.studio.noStyles, moreTemplates: dict.studio.moreTemplates, aspectLabel: dict.studio.aspectLabel, pending: dict.studio.pending,
};
const live: StudioLive = {
  endpoint: '/api/renders', accessEndpoint: '/api/renders/access', interestEndpoint: '/api/notify/interest',
  template: 'rainy-umbrella', locale: 'ko', signinHref: '/auth/signin', identityHref: '/identity/verify', cast: copy,
  labels: {
    badge: dict.renders.studio.badge, operatorBadge: dict.renders.studio.operatorBadge, freeCta: dict.renders.studio.freeCta,
    submitting: dict.renders.studio.submitting, identityNotice: dict.renders.studio.identityNotice, identityPending: dict.renders.studio.identityPending,
    identityCta: dict.renders.studio.identityCta, errors: dict.renders.studio.errors,
  },
};
const style: StudioStyle = {
  id: 'rainy-umbrella', title: 'Rainy umbrella', price: '₩6,900', runtime: '', blurb: '', posterSrc: '/p.jpg', videoSrc: null,
  moreHref: '/ko/couple', aspects: [{ id: '4:5', label: '4:5' }], defaultAspect: '4:5',
};
const COUPLE = { selfie: true, pet: false, partner: true };
const studio = (castInputs: StudioStyle['castInputs'], access: StudioAccessSnapshot) => renderToStaticMarkup(
  <TwingsStudio styles={[{ ...style, castInputs }]} labels={labels} initialStyleId="rainy-umbrella" live={live} initialAccess={access} />,
);
const signedIn = { open: true, live: true, signedIn: true };

describe('the age question on the make card', () => {
  it('switch on, couple template, not confirmed: a year picker and one box, beside the existing partner consent', () => {
    const html = studio(COUPLE, { ...signedIn, adultConfirmed: false });
    expect(html).toContain('data-adult-birth-year');
    expect(html).toContain('data-adult-attest');
    expect(html).toContain(copy.birthYearLabel);
    expect(html).toContain(copy.adultAttest);
    // The partner's consent stays exactly as it was: one existing box, its own words.
    expect(html).toContain('data-partner-consent');
    expect(html).toContain(copy.partnerConsent);
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
  });

  it('switch on but already confirmed: nothing new', () => {
    const html = studio(COUPLE, { ...signedIn, adultConfirmed: true });
    expect(html).toContain('data-partner-consent');
    expect(html).not.toContain('data-adult-birth-year');
    expect(html).not.toContain('data-adult-attest');
  });

  it('switch off (the access call carries no age field): nothing new, even for a couple template', () => {
    const html = studio(COUPLE, signedIn);
    expect(html).toContain('data-cast-photo="partner"');
    expect(html).not.toContain('data-adult-birth-year');
  });

  it('a template without a partner slot never asks, whatever the access call says', () => {
    expect(studio(undefined, { ...signedIn, adultConfirmed: false })).not.toContain('data-adult-birth-year');
    expect(studio({ selfie: true, pet: true, partner: false }, { ...signedIn, adultConfirmed: false })).not.toContain('data-adult-birth-year');
    expect(studio({ selfie: false, pet: true, partner: false }, { ...signedIn, adultConfirmed: false })).not.toContain('data-adult-birth-year');
  });

  it('the year picker lists the years newest first after an empty choice, and every target is at least 44px tall', () => {
    const html = renderToStaticMarkup(<CastPhotoFields need={{ pet: false, partner: true }} value={EMPTY_CAST_PHOTOS} onChange={() => {}} copy={copy} adult />);
    const options = [...html.matchAll(/<option value="(\d*)"/g)].map((match) => match[1]);
    expect(options[0]).toBe('');
    expect(options.slice(1).map(Number)).toEqual(birthYearChoices(new Date()));
    expect(html).toMatch(/<select[^>]*data-adult-birth-year[^>]*class="[^"]*min-h-11/);
    expect(html).toMatch(/<label[^>]*class="[^"]*min-h-11[^"]*"[^>]*><input[^>]*data-adult-attest/);
    expect(html).not.toMatch(/red-|#ED1E1E/i);
  });

  it('the pay button waits for the year and the box; the hint says what is missing', () => {
    const need = { pet: false, partner: true };
    const photo = new File([new Uint8Array([1])], 'p.jpg', { type: 'image/jpeg' });
    const withPartner = { ...EMPTY_CAST_PHOTOS, partner: photo, partnerConsent: true };
    expect(castPhotosReady(need, withPartner)).toBe(true);
    expect(castPhotosReady(need, withPartner, true)).toBe(false);
    expect(castPhotoHint(need, withPartner, copy, true)).toBe(copy.needAdult);
    expect(castPhotosReady(need, { ...withPartner, birthYear: '1994' }, true)).toBe(false);
    expect(castPhotosReady(need, { ...withPartner, birthYear: '1994', adultAttested: true }, true)).toBe(true);
    expect(castPhotoHint(need, { ...withPartner, birthYear: '1994', adultAttested: true }, copy, true)).toBeNull();
    // A pet template ignores the age answer entirely.
    expect(castPhotosReady({ pet: true, partner: false }, { ...EMPTY_CAST_PHOTOS, pet: photo }, true)).toBe(true);
  });
});
