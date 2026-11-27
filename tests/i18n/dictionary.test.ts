import { describe, expect, it } from 'vitest';
import { EN_TERMS, en } from '@/messages/en';
import { KO_TERMS, ko } from '@/messages/ko';
import { fundingCopy } from '@/messages/campaign-funding';
import { collaborationCopy } from '@/messages/campaign-collaboration';

/**
 * PLAN §3.9 — "both locales required", "manual bilingual authoring in v1".
 *
 * `tests/i18n/locale.test.ts` already compares the two dictionaries structurally; this file is the
 * completeness gate M1 adds: every key present in both, every value a non-empty string, and every
 * `{placeholder}` in an English string matched by the same placeholder in the Korean one. Shipping
 * a landing page in one language and a half-translated one in the other is the failure mode.
 */

type Leaf = [string, string];

function flatten(value: unknown, prefix = ''): Leaf[] {
  if (typeof value === 'string') return [[prefix, value]];
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      flatten(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [[prefix, String(value)]];
}

const enLeaves = flatten(en);
const koLeaves = flatten(ko);
const enMap = new Map(enLeaves);
const koMap = new Map(koLeaves);

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
}

describe('dictionary completeness (§3.9)', () => {
  it('has identical key sets — no fallbacks, no orphans', () => {
    const missingInKo = [...enMap.keys()].filter((key) => !koMap.has(key));
    const extraInKo = [...koMap.keys()].filter((key) => !enMap.has(key));
    expect(missingInKo).toEqual([]);
    expect(extraInKo).toEqual([]);
  });

  it('has a non-empty value for every key in both locales', () => {
    for (const [key, value] of enLeaves) expect(value.trim(), `en.${key}`).not.toBe('');
    for (const [key, value] of koLeaves) expect(value.trim(), `ko.${key}`).not.toBe('');
  });

  it('keeps interpolation placeholders in step across locales', () => {
    for (const [key, value] of enLeaves) {
      expect(placeholders(koMap.get(key) ?? ''), key).toEqual(placeholders(value));
    }
    /**
     * The count line is the one templated string M1 added; guard it explicitly.
     *
     * M6 changed WHAT it counts, not that it is guarded: the pivot (§13) made prompt counts the
     * honest headline number, so the placeholders moved from `{prompts}/{playbooks}` to
     * `{yagi}/{community}` — the two rails §13.2 actually renders.
     */
    expect(placeholders(en.pricing.countsLine)).toEqual(['community', 'yagi']);
  });

  it('actually translates the prose rather than copying English into ko', () => {
    // A handful of values are legitimately identical in both locales (brand, ad slate, prices).
    const sharedByDesign = new Set([
      'meta.siteName',
      'nav.localeEn',
      'nav.localeKo',
      'footer.rights',
      'ad.placeholder',
      'ad.contact',
      'pricing.freePrice',
      'pricing.proPrice',
      'howItReads.stepsIndex',
      'howItReads.blocksIndex',
      'howItReads.unlockIndex',
      // The first-run sheet's "1 / 3" — digits and a slash read the same in both languages.
      'firstRun.progress',
      // M6: the studio's own mark. "YAGI" is a name, and a transliteration ("야기") would read as
      // a different brand rather than a translation — the same reason `meta.siteName` is here.
      'featured.badge',
      'admin.sourceYagi',
      // Founder-specified studio attribution is a fixed brand lockup in both locales.
      'admin.byline',
      // M9: "SNS" is the ordinary Korean word for the thing (SNS 계정), borrowed wholesale from
      // English and used unchanged in Korean copy. "소셜 미디어" would be a translation of the
      // English phrase rather than the Korean term for it.
      'admin.colEntrySns',
      // Founder pass: the verified-share stat is a figure, and a figure is locale-invariant.
      'premise.statTestedValue',
      // M10 §15: the cookie table's three display slots are figures (3 / +1 / $4 = 5), and a
      // figure is locale-invariant — the sentences around them are the translated part.
      'pricing.cookieSignupValue',
      'pricing.cookieWeeklyValue',
      'pricing.cookiePackValue',
      // A platform's own name is a proper noun: "X" is written the same in Korean copy.
      'brandWorkspace.performance.platformNames.x',
      // 2026-08-14: the ad rail sets its address row as "CONTACT : HELLO@…" — a latin wayfinding
      // token in front of an email, identical in both locales by design, not an untranslated line.
      'ad.contactLabel',
      // 2026-08-16 (founder: "twings로 그냥 하자"): the product is named TWINGS in both locales,
      // with no descriptor after it. A name is not a sentence, so there is nothing to translate.
      'studio.eyebrow',
      // docs/PLATFORM-2.0.md §17 — "SNS" is the word Korean copy uses too, and the admin queue's empty cell is a dash.
      'social.eyebrow',
      'social.admin.none',
      // Clip versions read "v3" in both locales, like the version marks in other creative tools.
      'brandStudio.revise.version',
      // "Prompt Architect" is the feature's name (founder, 2026-11-16): it reads every reference and designs
      // the prompt for the chosen model, so it is not called "polish"; a name is the same in both locales.
      'brandStudio.dock.enhance',
      'brandStudio.explainer.steps.enhance.title',
      // The same feature in the sound studio (docs/BRAND-SOUND-STUDIO.md §12.2).
      'studioSound.architect.name',
      // And in the partial-edit form (walk finding I-D11, 2026-11-24): the same name as the prompt bar.
      'studioLayers.region.enhanceLabel',
      // PLATFORM-2.0 §14.1 (2026-10-24): the credit is "by @handle" in Korean too — the local idiom.
      'prompts.byAuthor',
      'prompts.cardAuthor',
      // 2026-10-29 brand landing: the right-hand column of each comparison is labelled with the product name.
      'brandLanding.landing.contrast.ours',
      // 2026-11-27 studio polish A: the founder asked for the literal English token "edited" in both locales.
      'brandStudio.gallery.editedMark',
      // 2026-11-27 video studio modes VM-1: founder-specified mode names shared across locales.
      'studioVideoModes.modes.reArchitect',
      'studioVideoModes.modes.motionTransfer',
    ]);

    const untranslated = enLeaves
      .filter(([key, value]) => !sharedByDesign.has(key) && koMap.get(key) === value)
      .map(([key]) => key);
    expect(untranslated).toEqual([]);
  });

  /**
   * M7 — the product is called TWINGS. The repo, the npm package and every internal
   * identifier keep the `playbook` codename on purpose, so a blanket grep would be wrong; what
   * belongs in a test is the USER-FACING half, which is exactly the dictionaries.
   *
   * The allowlist below is the whole point of the test: `library.title` is the one remaining
   * uppercase "PLAYBOOK", and it is the CONTENT TYPE ("every playbook we have published"), not the
   * brand. Any new one has to be justified here before it can ship.
   */
  describe('brand (M7)', () => {
    const contentNoun = new Set(['library.title']);

    it('is TWINGS in both locales', () => {
      expect(en.meta.siteName).toBe('TWINGS');
      expect(ko.meta.siteName).toBe('TWINGS');
      expect(en.admin.brand).toContain('TWINGS');
      expect(ko.admin.brand).toContain('TWINGS');
    });

    it('leaves no old brand token in any user-facing string', () => {
      const stragglers = [...enLeaves, ...koLeaves]
        .filter(([key, value]) => !contentNoun.has(key) && /\bPLAYBOOK\b/.test(value))
        .map(([key]) => key);
      expect(stragglers).toEqual([]);
    });

    it('keeps the brand identical across locales — it is a name, not a translation', () => {
      expect(koMap.get('meta.siteName')).toBe(enMap.get('meta.siteName'));
    });
  });

  it('covers every M1 surface', () => {
    for (const key of [
      'hero.line1',
      'premise.line1',
      'howItReads.unlockBody',
      'marquee.label',
      'featured.emptyTitle',
      'pricing.countsLine',
      'faq.q6',
      'footer.hireLede',
      'ad.pitch',
      'nav.skipToContent',
      'category.pipeline',
      'difficulty.advanced',
      // M10 §15 — the cookies surface.
      'cookies.signinCta',
      'cookies.spendCta',
      'cookies.emptyTitle',
      'cookies.weeklyLine',
      'pricing.cookieRule',
    ]) {
      expect(enMap.has(key), `en.${key}`).toBe(true);
      expect(koMap.has(key), `ko.${key}`).toBe(true);
    }
  });

  it('keeps the brand campaign page copy in brandWorkspace, not in the campaign modules (docs/PLATFORM-2.0.md §16.4)', () => {
    for (const key of [
      'brandWorkspace.wizard.steps.review',
      'brandWorkspace.wizard.schedule.disclosureFixed',
      'brandWorkspace.timeline.stages.settlement',
      'brandWorkspace.applicants.closed',
      'brandWorkspace.applicants.sources.self',
      'brandWorkspace.applicants.preferHint',
      'brandWorkspace.payments.closed',
      'brandWorkspace.payments.buyer',
      'brandWorkspace.paymentStates.paid',
      'brandWorkspace.tabs.applicants',
    ]) {
      expect(enMap.has(key), key).toBe(true);
      expect(koMap.has(key), key).toBe(true);
    }
    // Moved, not copied: the brand-page-only strings left the shared campaign copy.
    for (const locale of ['en', 'ko'] as const) {
      const funding = fundingCopy(locale) as Record<string, unknown>, collaboration = collaborationCopy(locale) as Record<string, unknown>;
      for (const key of ['buyer', 'receipt', 'noReceipt']) expect(funding[key], key).toBeUndefined();
      for (const key of ['participants', 'none', 'invitations']) expect(collaboration[key], key).toBeUndefined();
    }
  });
});

/**
 * docs/PLATFORM-2.0.md §14.1 (founder 2026-10-24): one name per object, each spelled ONCE in the
 * dictionary's terms object (`KO_TERMS` / `EN_TERMS`) and composed everywhere else. These tests read
 * the term values instead of repeating them, so a rename edits the terms only.
 */
describe('§14.1 names: one term object per locale', () => {
  // "작가" stays legitimate only where it names an author of a drawing or a story.
  const UNRELATED = /이모티콘 작가|웹툰 작가|웹소설 작가|그림 작가/;

  it('leaves no "작가" in Korean copy outside unrelated contexts', () => {
    const offenders = koLeaves.filter(([, value]) => value.includes('작가') && !UNRELATED.test(value));
    expect(offenders).toEqual([]);
  });

  it('calls a template supplier a maker in English, not a format creator', () => {
    const offenders = enLeaves.filter(([, value]) => /format creators?|creator format/i.test(value));
    expect(offenders).toEqual([]);
  });

  it('composes the program, studio, credits and the creative line from the terms', () => {
    for (const [dict, terms] of [[ko, KO_TERMS], [en, EN_TERMS]] as const) {
      expect(dict.creatorProgram.metaTitle).toBe(terms.makerProgram);
      expect(dict.creatorProgram.footerLink).toBe(terms.makerProgram);
      expect(dict.creatorProgram.workspaceTitle).toBe(terms.makerStudio);
      expect(dict.prompts.byYagi.startsWith(terms.studioCollection.replace(/s$/, ''))).toBe(true);
      expect(dict.brandWorkspace.wizard.format.creators).toBe(terms.makerCollection);
      expect(dict.prompts.cardAuthor).toBe(`${terms.creditPrefix} @{handle}`);
      expect(dict.prompts.byAuthor).toBe(`${terms.creditPrefix} @{handle}`);
      expect(dict.audience.personal).toBe(terms.personal);
    }
    // One feed since 2026-10-30 (§7.5): no origin rails or chips left to name.
    for (const dict of [ko, en]) for (const gone of ['studioRail', 'studioRailLede', 'makerRail', 'makerRailLede', 'originHeading', 'originAll', 'originStudio', 'originMaker']) expect(dict.templates).not.toHaveProperty(gone);
    expect(ko.templates.makerBlockHeading.endsWith(KO_TERMS.maker)).toBe(true);
    expect(ko.creatorProgram.approvedLine.startsWith(KO_TERMS.makerFull)).toBe(true);
    expect(ko.creatorProgram.applyTitle.startsWith(KO_TERMS.maker)).toBe(true);
    // The values fixed on 2026-10-28 (founder: "메이커" → "AI 크리에이티브", PLATFORM-2.0 §20.1) — the one place a test spells them out.
    expect(KO_TERMS).toMatchObject({ maker: 'AI 크리에이티브', makerFull: 'AI 크리에이티브', makerProgram: 'AI 크리에이티브 프로그램', makerStudio: '크리에이티브 스튜디오', studioCollection: 'TWINGS 오리지널', makerCollection: 'AI 크리에이티브 컬렉션', creditPrefix: 'by', personal: '개인' });
    expect(EN_TERMS).toMatchObject({ maker: 'AI creative', makerProgram: 'AI Creative Program', makerStudio: 'Creative Studio', makerCollection: 'By AI Creatives', creditPrefix: 'by', personal: 'Personal' });
    // "메이커" is gone from every Korean value; "an" stands before the English term wherever an article is needed.
    expect(koLeaves.filter(([, value]) => value.includes('메이커')).map(([key]) => key)).toEqual([]);
    expect(Object.values(EN_TERMS).some((value) => /maker/i.test(value))).toBe(false);
  });

  it('keeps 크리에이터 for campaign participants and the personal label for the header switch only', () => {
    expect(ko.audience.creator).toBe('크리에이터');
    // Users are "나/내" in sentences and "회원님" when addressed — the switch label is the only bare "개인".
    expect(koLeaves.filter(([, value]) => value === KO_TERMS.personal).map(([key]) => key)).toEqual(['audience.personal']);
    expect(koLeaves.filter(([, value]) => /유저님|개인님/.test(value))).toEqual([]);
    expect(ko.creatorProfile.fallbackName).toBe('회원님');
  });
});
