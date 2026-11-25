import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { TwingsStudio, type StudioLabels, type StudioLive, type StudioStyle } from '@/components/twings/studio';

/**
 * Founder 2026-11-25 — a template whose text leaves no room for edits (`PromptCard.editsClosed`) shows one line where
 * the director panel would be, and its parts card offers no "템플릿 스타일 / 내 사진 그대로" choice. Without the flag
 * the make card is exactly as before.
 */
const dict = getDictionary('ko');
const e = dict.editSheet;
const labels: StudioLabels = {
  stepPhoto: dict.studio.stepPhoto, stepStyle: dict.studio.stepStyle, stepPay: dict.studio.stepPay, stepResult: dict.studio.stepResult,
  dropZone: dict.studio.dropZone, dropHint: dict.studio.dropHint, changePhoto: dict.studio.changePhoto, chooseStyle: dict.studio.chooseStyle,
  payCta: dict.studio.payCta, payNote: dict.studio.payNote, closedTitle: dict.studio.closedTitle, closedBody: dict.studio.closedBody,
  closedCta: dict.studio.closedCta, closedDone: dict.studio.closedDone, runtimeLabel: dict.studio.runtimeLabel, needPhoto: dict.studio.needPhoto,
  noStyles: dict.studio.noStyles, moreTemplates: dict.studio.moreTemplates, aspectLabel: dict.studio.aspectLabel, pending: dict.studio.pending,
};
const live: StudioLive = {
  endpoint: '/api/renders', accessEndpoint: '/api/renders/access', interestEndpoint: '/api/notify/interest',
  template: 'long-walk', locale: 'ko', signinHref: '/auth/signin', identityHref: '/identity/verify',
  labels: {
    badge: dict.renders.studio.badge, operatorBadge: dict.renders.studio.operatorBadge, freeCta: dict.renders.studio.freeCta,
    submitting: dict.renders.studio.submitting, identityNotice: dict.renders.studio.identityNotice, identityPending: dict.renders.studio.identityPending,
    identityCta: dict.renders.studio.identityCta, errors: dict.renders.studio.errors,
  },
  parts: {
    rows: [{ key: 'hair', state: 'styled', label: '헤어', desc: null, choice: true }],
    all: false,
    copy: {
      heading: dict.templates.fixed.heading, lockedAll: e.lockedAll, locked: dict.templates.fixed.locked, styled: dict.templates.fixed.styled,
      photo: dict.templates.fixed.photo, choiceLabel: e.styleChoiceLabel, template: e.styleTemplate, mine: e.styleMine, templateNote: e.styleTemplateNote,
      mineHair: e.styleMineHair, mineMakeup: e.styleMineMakeup, overridden: e.styleOverridden, outfitPhoto: e.styleOutfitPhoto,
      outfitPhotoCta: e.styleOutfitPhotoCta, outfitAttached: e.styleOutfitAttached,
    },
  },
};
const style: StudioStyle = {
  id: 'long-walk', title: 'Long walk', price: '₩24,900', runtime: '10초', blurb: '', posterSrc: '/p.jpg', videoSrc: '/v.mp4',
  moreHref: '/ko', aspects: [{ id: '9:16', label: '9:16' }], defaultAspect: '9:16',
};
const studio = (extra: Partial<StudioLive>) => renderToStaticMarkup(
  <TwingsStudio styles={[style]} labels={labels} initialStyleId="long-walk" live={{ ...live, ...extra }} initialAccess={{ open: true, live: true, signedIn: true }} />,
);

describe('the make card of a template with no room for edits', () => {
  it('shows one line instead of the director, and no own-style choice', () => {
    const open = studio({});
    const closed = studio({ editsClosed: dict.templates.editsClosed });
    expect(open).not.toContain('data-edits-closed');
    expect(open).toContain('data-template-director-panel');
    expect(closed).not.toContain('data-template-director-panel');
    expect(open).toContain('data-part-choice');
    expect(open).toContain(e.styleMine);
    expect(closed).toContain('data-edits-closed');
    expect(closed).toContain('이 템플릿은 길이가 꽉 차 있어 수정 요청을 받지 않아요.');
    expect(closed).not.toContain('data-part-choice');
    expect(closed).not.toContain(e.styleMine);
    // The parts card itself (what the template decides) still shows.
    expect(closed).toContain('data-template-parts');
  });
});

describe('the make card of a template with little room', () => {
  it('disables a "내 사진 그대로" switch that would not fit, with the too-long line, and leaves the one that fits', () => {
    const parts = {
      ...live.parts!,
      rows: [
        { key: 'hair', state: 'styled' as const, label: '헤어', desc: null, choice: true },
        { key: 'makeup', state: 'styled' as const, label: '메이크업', desc: null, choice: true },
      ],
      copy: { ...live.parts!.copy, tooLong: e.tooLong },
    };
    const html = studio({ parts, editRoom: { headroom: 850, own: { hair: 896, makeup: 814 } } });
    expect(html).toContain('data-style-blocked="hair"');
    expect(html).not.toContain('data-style-blocked="makeup"');
    expect(html).toContain(e.tooLong);
    const hairMine = /data-style-option="hair:mine"[^>]*>\s*(<input[^>]*>)/.exec(html)?.[1] ?? '';
    const makeupMine = /data-style-option="makeup:mine"[^>]*>\s*(<input[^>]*>)/.exec(html)?.[1] ?? '';
    expect(hairMine).toMatch(/ disabled=""/);
    expect(makeupMine).toMatch(/^<input/);
    expect(makeupMine).not.toMatch(/ disabled=""/);
    // With room for both, nothing is disabled and nothing extra is said.
    const roomy = studio({ parts, editRoom: { headroom: 5_000, own: { hair: 896, makeup: 814 } } });
    expect(roomy).not.toContain('data-style-blocked');
    expect(roomy).not.toContain(e.tooLong);
  });
});
