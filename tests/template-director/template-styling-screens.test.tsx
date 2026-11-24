import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { en } from '@/messages/en';
import { ko } from '@/messages/ko';
import { TemplateDirectorPanel } from '@/components/twings/template-director-panel';
import { TemplatePartsCard } from '@/components/twings/template-parts-card';
import { TemplateFixedStrip } from '@/components/prompts/template-fixed-strip';
import { parseTemplateLocks, publicLocks, renderLockBlock, resolveTemplateBaseline, type PublicTemplateLocks } from '@/lib/template-director';
import {
  orderSpecField,
  ownForOrder,
  partRows,
  templatePartsView,
  withOwnChoice,
  type TemplatePartRow,
  type TemplatePartsCopy,
} from '@/lib/template-director/parts-view';
import type { PersonalDirectorSpec } from '@/lib/template-director/schema';
import { explicitStyleParts, type PublicTemplateStyling } from '@/lib/template-director/styling';

/**
 * docs/PERSONAL-STUDIO.md §3.4.9 (S2) — the buyer's screens for a template that styles the hair or makeup: the parts
 * card above the pay button (the choice, read-only locked and photo rows, the outfit pointer), the order's spec, the
 * director panel without guesses, and the fixed row's states. A template that declares nothing stays as it was.
 */

const TEMPLATE = '2026-11-01-90s-interview-batch';
const BASELINE = resolveTemplateBaseline(TEMPLATE);

const PROP_LOCK: PublicTemplateLocks = publicLocks(parseTemplateLocks(`Body.\n\n${renderLockBlock([{ kind: 'slot', slot: 'prop' }])}`))!;
const HAIR_LOCK: PublicTemplateLocks = publicLocks(parseTemplateLocks(`Body.\n\n${renderLockBlock([{ kind: 'slot', slot: 'hair' }])}`))!;
const STYLED: PublicTemplateStyling = { styled: ['hair', 'makeup'], photo: [] };
const WITH_OUTFIT: PublicTemplateStyling = { styled: ['hair', 'outfit'], photo: ['makeup'] };

function copyFor(dict: typeof ko | typeof en, medium: 'video' | 'image' = 'video'): TemplatePartsCopy {
  const e = dict.editSheet;
  return {
    heading: dict.templates.fixed.heading,
    lockedAll: e.lockedAll,
    locked: dict.templates.fixed.locked,
    styled: dict.templates.fixed.styled,
    photo: dict.templates.fixed.photo,
    choiceLabel: e.styleChoiceLabel,
    template: e.styleTemplate,
    mine: e.styleMine,
    templateNote: medium === 'image' ? e.styleTemplateNoteImage : e.styleTemplateNote,
    mineHair: e.styleMineHair,
    mineMakeup: e.styleMineMakeup,
    overridden: e.styleOverridden,
    outfitPhoto: e.styleOutfitPhoto,
    outfitPhotoCta: e.styleOutfitPhotoCta,
    outfitAttached: e.styleOutfitAttached,
  };
}

const rowsFor = (locks: PublicTemplateLocks | null, styling: PublicTemplateStyling | null, locale: 'ko' | 'en' = 'ko'): TemplatePartRow[] =>
  partRows(templatePartsView({ locks, styling, marks: [], copy: (locale === 'ko' ? ko : en).editSheet, locale }));

const card = (props: Partial<Parameters<typeof TemplatePartsCard>[0]> = {}): string =>
  renderToStaticMarkup(
    <TemplatePartsCard rows={rowsFor(PROP_LOCK, STYLED)} copy={copyFor(ko)} choices={{}} onChoose={() => undefined} {...props} />,
  );

/** The `<li>` of one part. */
function partRow(html: string, key: string): string {
  const start = html.indexOf(`data-template-part="${key}"`);
  expect(start, key).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</li>', start));
}

describe('the rows', () => {
  it('one row per part in the declaration order, the choice only on a styled hair or makeup', () => {
    expect(rowsFor(PROP_LOCK, STYLED).map((r) => [r.key, r.state, r.choice])).toEqual([
      ['prop', 'locked', false],
      ['hair', 'styled', true],
      ['makeup', 'styled', true],
    ]);
    expect(rowsFor(null, WITH_OUTFIT).map((r) => [r.key, r.state, r.choice])).toEqual([
      ['hair', 'styled', true],
      ['outfit', 'styled', false],
      ['makeup', 'photo', false],
    ]);
    // A part both locked and styled is locked, with no choice (the lock wins).
    expect(rowsFor(HAIR_LOCK, STYLED).map((r) => [r.key, r.state, r.choice])).toEqual([
      ['hair', 'locked', false],
      ['makeup', 'styled', true],
    ]);
  });

  it('folds a part with two marks into one row, both descriptions', () => {
    const view = templatePartsView({
      locks: null,
      styling: STYLED,
      marks: [
        { index: 0, timeSeconds: 1, endSeconds: 2, part: 'hair', labelKo: '낮은 번' },
        { index: 1, timeSeconds: 5, endSeconds: 6, part: 'hair', labelKo: '잔머리' },
      ],
      copy: ko.editSheet,
      locale: 'ko',
    });
    expect(view.filter((v) => v.key === 'hair')).toHaveLength(2);
    expect(partRows(view).find((r) => r.key === 'hair')!.desc).toBe('낮은 번 · 잔머리');
  });
});

describe('the order', () => {
  const panelSpec: PersonalDirectorSpec = { audioMode: 'bgm', bgmMood: 'cinematic', userMessage: null, summaryChips: [], structuredIntent: null, slotOverrides: [] };

  it('with nothing chosen, the request carries exactly what it carried before — styled template or not', () => {
    for (const spec of [null, panelSpec]) {
      const before = spec ? JSON.stringify(spec) : null;
      // A template without a declaration: no rows.
      expect(orderSpecField(spec, [], {}, [])).toBe(before);
      // A styled template left on the template's style (the default), and one whose choice was set back.
      expect(orderSpecField(spec, rowsFor(PROP_LOCK, STYLED), {}, [])).toBe(before);
      expect(orderSpecField(spec, rowsFor(PROP_LOCK, STYLED), { hair: 'template', makeup: 'template' }, [])).toBe(before);
      expect(withOwnChoice(spec, [])).toBe(spec);
    }
  });

  it('"내 사진 그대로" rides the spec as `own`, alone or with the panel\'s changes', () => {
    const rows = rowsFor(PROP_LOCK, STYLED);
    expect(JSON.parse(orderSpecField(null, rows, { hair: 'mine' }, [])!)).toEqual({ audioMode: 'ambient', own: ['hair'] });
    expect(JSON.parse(orderSpecField(panelSpec, rows, { makeup: 'mine', hair: 'mine' }, [])!)).toEqual({ ...panelSpec, own: ['hair', 'makeup'] });
  });

  it('sends `own` only for a styled, unlocked hair or makeup, and not for a part an edit changes', () => {
    expect(ownForOrder(rowsFor(HAIR_LOCK, STYLED), { hair: 'mine', makeup: 'mine' }, [])).toEqual(['makeup']);
    expect(ownForOrder(rowsFor(null, WITH_OUTFIT), { hair: 'mine', makeup: 'mine' }, [])).toEqual(['hair']);
    expect(ownForOrder(rowsFor(null, null), { hair: 'mine' }, [])).toEqual([]);
    expect(ownForOrder(rowsFor(PROP_LOCK, STYLED), { hair: 'mine', makeup: 'mine' }, ['hair'])).toEqual(['makeup']);
  });

  it('an edit that changes the hair overrides the choice, sheet or chips (the server rule)', () => {
    const sheet = { change: [{ text: '긴 생머리로', slot: 'hair' as const }], keep: [], exclude: [] };
    expect(explicitStyleParts({ audioMode: 'ambient', sheet }, { sheet })).toEqual(['hair']);
    expect(explicitStyleParts({ audioMode: 'ambient', summaryChips: [{ slot: 'makeup', labelKo: '메이크업', summaryKo: '진하게' }] }, { sheet: null })).toEqual(['makeup']);
  });
});

describe('the parts card', () => {
  it('names every part with its state; the styled hair and makeup get a two-option choice, the template\'s by default', () => {
    const html = card();
    expect(html).toContain('data-template-parts');
    expect(html).toContain(ko.templates.fixed.heading);
    expect(partRow(html, 'prop')).toContain(ko.templates.fixed.locked);
    expect(partRow(html, 'prop')).not.toContain('type="radio"');
    for (const part of ['hair', 'makeup']) {
      const row = partRow(html, part);
      expect(row).toContain(`data-part-choice="template"`);
      expect(row.match(/type="radio"/g)).toHaveLength(2);
      expect(row).toMatch(/<input type="radio"(?=[^>]*value="template")(?=[^>]*checked="")[^>]*>/);
      expect(row).toContain(ko.editSheet.styleTemplate);
      expect(row).toContain(ko.editSheet.styleMine);
      expect(row).toContain(ko.editSheet.styleTemplateNote);
      expect(row).toContain(`<legend class="sr-only">${ko.editSheet.styleChoiceLabel.replace('{part}', ko.editSheet.slots[part as 'hair'])}</legend>`);
      // 44px targets.
      expect(row).toContain('min-h-11');
    }
  });

  it('"내 사진 그대로" changes the line under the row, never promising a match', () => {
    const html = card({ choices: { hair: 'mine', makeup: 'mine' } });
    expect(partRow(html, 'hair')).toContain('data-part-choice="mine"');
    expect(partRow(html, 'hair')).toContain(ko.editSheet.styleMineHair);
    expect(partRow(html, 'makeup')).toContain(ko.editSheet.styleMineMakeup);
    expect(partRow(html, 'hair')).toMatch(/<input type="radio"(?=[^>]*value="mine")(?=[^>]*checked="")[^>]*>/);
    expect(partRow(html, 'hair')).not.toContain(ko.editSheet.styleTemplateNote);
  });

  it('an edit that changes the hair shows the row as overridden instead of a second, disagreeing control', () => {
    const html = card({ choices: { hair: 'mine' }, overridden: ['hair'] });
    const row = partRow(html, 'hair');
    expect(row).toContain('data-part-choice="overridden"');
    expect(row).toContain(ko.editSheet.styleOverridden);
    expect(row).toMatch(/<fieldset disabled=""/);
    expect(row).not.toContain(ko.editSheet.styleMineHair);
    expect(partRow(html, 'makeup')).toContain('data-part-choice="template"');
  });

  it('subscription mode: no choice — styled parts read "template style"', () => {
    const html = card({ onChoose: undefined });
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain('data-part-choice');
    expect(partRow(html, 'hair')).toContain(ko.templates.fixed.styled);
    expect(partRow(html, 'hair')).toContain(ko.editSheet.styleTemplateNote);
  });

  it('a styled wardrobe points to the outfit photo, a photo part is read-only', () => {
    const rows = rowsFor(null, WITH_OUTFIT);
    const open = renderToStaticMarkup(
      <TemplatePartsCard rows={rows} copy={copyFor(ko)} choices={{}} onChoose={() => undefined} outfitPhoto={{ open: true, attached: false, onAdd: () => undefined }} />,
    );
    const outfit = partRow(open, 'outfit');
    expect(outfit).toContain(ko.templates.fixed.styled);
    expect(outfit).not.toContain('type="radio"');
    expect(outfit).toContain(ko.editSheet.styleOutfitPhoto);
    expect(outfit).toContain('data-part-outfit-photo-cta');
    expect(partRow(open, 'makeup')).toContain(ko.templates.fixed.photo);
    expect(partRow(open, 'makeup')).not.toContain('type="radio"');

    const attached = renderToStaticMarkup(
      <TemplatePartsCard rows={rows} copy={copyFor(ko)} choices={{}} onChoose={() => undefined} outfitPhoto={{ open: true, attached: true }} />,
    );
    expect(partRow(attached, 'outfit')).toContain(ko.editSheet.styleOutfitAttached);
    expect(partRow(attached, 'outfit')).not.toContain('data-part-outfit-photo-cta');

    const closed = renderToStaticMarkup(<TemplatePartsCard rows={rows} copy={copyFor(ko)} choices={{}} outfitPhoto={{ open: false, attached: false }} />);
    expect(partRow(closed, 'outfit')).not.toContain('data-part-outfit-photo');
  });

  it('everything fixed: one line; nothing declared: nothing at all', () => {
    expect(renderToStaticMarkup(<TemplatePartsCard rows={[]} all copy={copyFor(ko)} choices={{}} />)).toContain(ko.editSheet.lockedAll);
    expect(renderToStaticMarkup(<TemplatePartsCard rows={[]} copy={copyFor(ko)} choices={{}} />)).toBe('');
  });

  it('English, and quiet: no emoji, no pink in the card (pink stays on the pay button)', () => {
    const html = renderToStaticMarkup(<TemplatePartsCard rows={rowsFor(PROP_LOCK, STYLED, 'en')} copy={copyFor(en)} choices={{ hair: 'mine' }} onChoose={() => undefined} />);
    expect(html).toContain('Template style');
    expect(html).toContain('From my photo');
    expect(html).toContain('Follows the hair in your photo.');
    expect(html).not.toMatch(/[가-힣]/);
    expect(html).not.toMatch(/FF58AE|FF389F/i);
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(html).toContain('ring-[#09090B]');
  });
});

// --- The panel ----------------------------------------------------------------------------------------------------

function panel(props: Partial<Parameters<typeof TemplateDirectorPanel>[0]> = {}): string {
  return renderToStaticMarkup(
    <TemplateDirectorPanel locale="ko" templateId={TEMPLATE} medium="video" videoResolutionSpec={{ runtimeSeconds: 10, aspect: '9:16' }} initialExpanded={true} {...props} />,
  );
}

describe('the director panel on a styled template', () => {
  it('styling alone makes the template declared: no guessed cards, title or preset pills', () => {
    const html = panel({ styling: STYLED, lockCopy: ko.editSheet });
    expect(html).toContain('data-template-baseline-card="declared"');
    expect(html).not.toContain(BASELINE.titleKo);
    expect(html).not.toContain('data-baseline-slot=');
    expect(html).not.toContain('data-predictive-preset=');
    for (const guessed of BASELINE.lockedElementsKo) expect(html).not.toContain(guessed);
    expect(html).toContain(ko.editSheet.skeleton);
    // Nothing is locked: every photo picker and quick pill stays.
    for (const slot of ['outfit', 'prop', 'scene']) expect(html).toContain(`data-director-slot="${slot}"`);
    expect(html).toContain('data-director-preset="hair"');
  });

  it('a template that declares nothing is byte-identical, whatever the new props say', () => {
    for (const props of [{}, { initialExpanded: false }, { locale: 'en' as const, medium: 'image' as const }, { editSheet: ko.editSheet }]) {
      expect(panel({ ...props, styling: null })).toBe(panel(props));
      expect(panel({ ...props, styling: null, outfitPhotoRequest: 0 })).toBe(panel(props));
    }
  });
});

describe('the fixed row under the example video', () => {
  const fixedCopy = { heading: ko.templates.fixed.heading, hint: ko.templates.fixed.hint, wholeVideo: ko.templates.fixed.wholeVideo, locked: ko.templates.fixed.locked, styled: ko.templates.fixed.styled, photo: ko.templates.fixed.photo, lockedAll: ko.editSheet.lockedAll };

  it('lists locked, styled and photo parts, each with its state', () => {
    const parts = templatePartsView({ locks: PROP_LOCK, styling: WITH_OUTFIT, marks: [{ index: 0, timeSeconds: 1, endSeconds: 2, part: 'hair', labelKo: '낮은 번' }], copy: ko.editSheet, locale: 'ko' });
    const html = renderToStaticMarkup(<TemplateFixedStrip parts={parts} copy={fixedCopy} videoSrc="/clip.mp4" onSelect={() => undefined} />);
    for (const [key, state] of [['prop', 'locked'], ['hair', 'styled'], ['outfit', 'styled'], ['makeup', 'photo']] as const) {
      const start = html.indexOf(`data-fixed-part="${key}"`);
      const row = html.slice(start, html.indexOf('</li>', start));
      expect(row, key).toContain(`data-fixed-state="${state}"`);
    }
    expect(html).toContain(ko.templates.fixed.styled);
    expect(html).toContain(ko.templates.fixed.photo);
    // A styled part with a range loops like a locked one.
    expect(html).toMatch(/<button[^>]*data-fixed-item="hair"/);
  });
});
