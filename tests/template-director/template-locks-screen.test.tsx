import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { en } from '@/messages/en';
import { ko } from '@/messages/ko';
import {
  EditSheetCard,
  buildSheetDirectorSpec,
  foldPendingForOrder,
  lockedPartsOf,
  pendingFoldNotice,
  readSheetTurnAnswer,
  sheetNoticeText,
  type EditSheetCopy
} from '@/components/twings/edit-sheet-card';
import { TemplateDirectorPanel } from '@/components/twings/template-director-panel';
import {
  emptyPersonalSheet,
  emptyPersonalSheetState,
  parseTemplateLocks,
  publicLocks,
  renderLockBlock,
  resolveTemplateBaseline,
  type PersonalEditSheet,
  type PublicTemplateLocks,
  type TemplateLock
} from '@/lib/template-director';

/** docs/PERSONAL-STUDIO.md §3.3, §3.4.4 (C2) — what the buyer sees of a template's locks, flag on and off. */

const projected = (locks: TemplateLock[]): PublicTemplateLocks =>
  publicLocks(parseTemplateLocks(`Body.\n\n${renderLockBlock(locks)}`))!;

/** Product (closes the prop slot and every photo), logo, hair, shots 2–3. */
const CAMPAIGN = projected([{ kind: 'product' }, { kind: 'logo' }, { kind: 'slot', slot: 'hair' }, { kind: 'shots', from: 2, to: 3 }]);
/** Only the prop slot: closes the prop photo alone. */
const PROP_ONLY = projected([{ kind: 'slot', slot: 'prop' }]);
/** Sound and the wardrobe: closes the outfit photo. */
const SOUND = projected([{ kind: 'sound' }, { kind: 'slot', slot: 'outfit' }]);
const ALL = publicLocks(parseTemplateLocks('Template locks:\n- Keep exactly as in the template: the moon.'))!;

const TEMPLATE = '2026-11-01-90s-interview-batch';
const BASELINE = resolveTemplateBaseline(TEMPLATE);

const count = (html: string, needle: string): number => html.split(needle).length - 1;

/** The `<section data-edit-sheet-block="locked">…</section>` of a card. */
function lockedSection(html: string): string {
  const start = html.indexOf('<section data-edit-sheet-block="locked"');
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</section>', start) + '</section>'.length);
}

// --- The card -----------------------------------------------------------------------------------------------------

describe('EditSheetCard — "can\'t be changed"', () => {
  it('shows the locked parts on an empty sheet, above everything the customer changes', () => {
    const html = renderToStaticMarkup(<EditSheetCard copy={ko.editSheet} sheet={emptyPersonalSheet()} locks={CAMPAIGN} />);
    const section = lockedSection(html);
    expect(section).toContain(ko.editSheet.lockedHeading);
    expect(section).toContain(ko.editSheet.lockedNote);
    expect([...section.matchAll(/data-edit-sheet-locked="([^"]+)"/g)].map((m) => m[1])).toEqual([
      'product',
      'logo',
      'hair',
      'shots-2-3'
    ]);
    expect(section).toContain(`>${ko.editSheet.locks.product}<`);
    expect(section).toContain(`>${ko.editSheet.slots.hair}<`);
    expect(section).toContain('2~3번째 컷');
    // The prop is part of the product: not listed twice.
    expect(section).not.toContain('data-edit-sheet-locked="prop"');
    // The invitation to ask for a change still stands, under the locked parts.
    expect(html.indexOf('data-edit-sheet-empty')).toBeGreaterThan(html.indexOf('data-edit-sheet-block="locked"'));
  });

  it('sits above the change block when the sheet has lines', () => {
    const sheet: PersonalEditSheet = { change: [{ text: '블랙 실크 원피스', slot: 'outfit' }], keep: ['내 머리 길이'], exclude: [] };
    const html = renderToStaticMarkup(<EditSheetCard copy={ko.editSheet} sheet={sheet} locks={CAMPAIGN} />);
    expect(html.indexOf('data-edit-sheet-block="locked"')).toBeLessThan(html.indexOf('data-edit-sheet-block="change"'));
    expect(count(html, 'data-edit-sheet-block=')).toBe(3);
  });

  it('a locked item is not an editable line: no remove or revert button, no line marker, one lock glyph', () => {
    const section = lockedSection(
      renderToStaticMarkup(<EditSheetCard copy={ko.editSheet} sheet={emptyPersonalSheet()} locks={CAMPAIGN} />)
    );
    expect(section).not.toContain('<button');
    expect(section).not.toContain('data-edit-sheet-remove');
    expect(section).not.toContain('data-edit-sheet-revert');
    expect(section).not.toContain('data-edit-sheet-line');
    expect(count(section, '<svg')).toBe(1);
    expect(section).toContain('aria-hidden="true"');
  });

  it('names the parts with the dictionary in English', () => {
    const section = lockedSection(
      renderToStaticMarkup(<EditSheetCard copy={en.editSheet} sheet={emptyPersonalSheet()} locks={CAMPAIGN} />)
    );
    const escaped = (text: string) => text.replace(/'/g, '&#x27;');
    for (const label of ['Product', 'Logo', 'Hair', 'Shots 2–3', en.editSheet.lockedHeading, en.editSheet.lockedNote]) {
      expect(section).toContain(escaped(label));
    }
    expect(section).not.toMatch(/[가-힣]/);
  });

  it('lists the prop when the product is not locked, and a single shot as one shot', () => {
    const parts = lockedPartsOf(projected([{ kind: 'slot', slot: 'prop' }, { kind: 'shots', from: 4, to: 4 }]), ko.editSheet);
    expect(parts).toEqual([
      { key: 'prop', label: ko.editSheet.slots.prop },
      { key: 'shots-4-4', label: '4번째 컷' }
    ]);
  });

  it('a malformed block shows one "everything is fixed" line and no item', () => {
    const section = lockedSection(
      renderToStaticMarkup(<EditSheetCard copy={ko.editSheet} sheet={emptyPersonalSheet()} locks={ALL} />)
    );
    expect(section).toContain('data-edit-sheet-locked-all');
    expect(section).toContain(ko.editSheet.lockedAll);
    expect(section).not.toContain('data-edit-sheet-locked=');
    expect(lockedPartsOf(ALL, ko.editSheet)).toEqual([]);
  });

  it('adds nothing without locks', () => {
    const sheet: PersonalEditSheet = { change: [{ text: '블랙 실크 원피스', slot: 'outfit' }], keep: [], exclude: [] };
    for (const s of [sheet, emptyPersonalSheet()]) {
      const plain = renderToStaticMarkup(<EditSheetCard copy={ko.editSheet} sheet={s} />);
      expect(renderToStaticMarkup(<EditSheetCard copy={ko.editSheet} sheet={s} locks={null} />)).toBe(plain);
      expect(plain).not.toContain('data-edit-sheet-block="locked"');
      expect(plain).not.toContain(ko.editSheet.lockedHeading);
    }
  });

  it('draws no words of its own in the locked section', () => {
    const sentinel = (value: unknown, path: string): unknown =>
      typeof value === 'string'
        ? `@${path}@`
        : Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sentinel(v, `${path}.${k}`)]));
    const copy = sentinel(en.editSheet, 'es') as EditSheetCopy;
    for (const locks of [CAMPAIGN, ALL]) {
      const section = lockedSection(renderToStaticMarkup(<EditSheetCard copy={copy} sheet={emptyPersonalSheet()} locks={locks} />));
      const visible = section.replace(/<[^>]+>/g, ' ').replace(/@es\.[\w.]+@/g, '');
      expect(visible.replace(/[\s\d]/g, '')).toBe('');
    }
  });
});

// --- Notices ------------------------------------------------------------------------------------------------------

describe('notices for a locked request', () => {
  const prior = emptyPersonalSheetState();
  const answer = (turn: Record<string, unknown>, status = 200) =>
    readSheetTurnAnswer({ prior, message: '핑크 단발로', status, payload: { ok: true, turn }, locale: 'ko' });
  const base = { approved: true, refusal: 'none', replyKo: '담았어요.', guardrailAdjustmentKo: null, question: null, asked: false };

  it('nothing changed: "that part is fixed"', () => {
    const out = answer({ ...base, sheet: emptyPersonalSheet(), changed: false, lockedHit: true });
    expect(out.notice).toEqual({ key: 'refusedLocked' });
    expect(sheetNoticeText(out.notice, ko.editSheet)).toBe(ko.editSheet.refusedLocked);
    expect(out.accepted).toBe(true);
  });

  it('something else changed: "added, fixed parts stay"', () => {
    const sheet: PersonalEditSheet = { change: [{ text: '블랙 원피스', slot: 'outfit' }], keep: [], exclude: [] };
    const out = answer({ ...base, sheet, changed: true, lockedHit: true });
    expect(out.notice).toEqual({ key: 'updatedLocked' });
    expect(sheetNoticeText(out.notice, en.editSheet)).toBe(en.editSheet.updatedLocked);
    expect(out.state.sheet).toEqual(sheet);
  });

  it('a question does not hide the lock notice', () => {
    const out = answer({
      ...base,
      sheet: emptyPersonalSheet(),
      changed: false,
      lockedHit: true,
      question: { point: '범위', text: '모든 컷에서 바꿀까요?', options: ['모든 컷'] }
    });
    expect(out.notice).toEqual({ key: 'refusedLocked' });
  });

  it('a closed photo refused by the route reads as the lock refusal, the sheet unchanged', () => {
    const out = readSheetTurnAnswer({ prior, message: '', status: 400, payload: { ok: false, code: 'locked_slot_photo' }, locale: 'ko' });
    expect(out.notice).toEqual({ key: 'refusedLocked' });
    expect(out.state).toBe(prior);
  });

  it('without `lockedHit` the notices are as before', () => {
    expect(answer({ ...base, sheet: emptyPersonalSheet(), changed: false }).notice).toEqual({ key: 'unchanged' });
    expect(answer({ ...base, sheet: { change: [{ text: 'a', slot: 'hair' }], keep: [], exclude: [] }, changed: true }).notice).toEqual({ key: 'updated' });
  });
});

// --- What the order carries -----------------------------------------------------------------------------------------

describe('unsent text that a lock would drop', () => {
  const empty = emptyPersonalSheet();

  it('is shown as locked instead of being folded in', () => {
    for (const text of ['핑크 단발로 바꿔 줘', '제품을 다른 걸로', '로고를 빼 줘']) {
      const fold = foldPendingForOrder(empty, text, CAMPAIGN);
      expect(fold, text).toEqual({ sheet: empty, status: 'blocked', pendingIndex: null, blockedAs: 'locked' });
      expect(pendingFoldNotice(fold, ko.editSheet)).toBe(ko.editSheet.refusedLocked);
    }
  });

  it('folds open requests as before, and everything is locked under a malformed block', () => {
    expect(foldPendingForOrder(empty, '배경을 바다로', CAMPAIGN).status).toBe('folded');
    expect(foldPendingForOrder(empty, '배경을 바다로', ALL)).toMatchObject({ status: 'blocked', blockedAs: 'locked' });
    expect(foldPendingForOrder(empty, '배경을 바다로', null)).toEqual(foldPendingForOrder(empty, '배경을 바다로'));
    expect(foldPendingForOrder(empty, '핑크 단발로 바꿔 줘')).toMatchObject({ status: 'folded' });
  });

  it('the order leaves out locked unsent text, closed photos and BGM under a sound lock', () => {
    const { spec, fold } = buildSheetDirectorSpec({
      sheet: { change: [{ text: '블랙 원피스', slot: 'makeup' }], keep: [], exclude: [] },
      pendingNote: '핑크 단발로',
      audioMode: 'bgm',
      bgmMood: 'trendy_beat',
      slotOverrides: ['look_ref', 'scene_ref'],
      locks: SOUND
    });
    // '단발' names the hair, which this template leaves open: it folds. The outfit photo is closed.
    expect(fold.status).toBe('folded');
    expect(spec).toMatchObject({ audioMode: 'ambient', bgmMood: null, slotOverrides: ['scene_ref'] });
    expect(spec!.sheet!.change.map((l) => l.text)).toEqual(['블랙 원피스', '핑크 단발로']);

    const blocked = buildSheetDirectorSpec({
      sheet: emptyPersonalSheet(),
      pendingNote: '빨간 드레스로',
      audioMode: 'ambient',
      bgmMood: null,
      slotOverrides: [],
      locks: SOUND
    });
    expect(blocked.fold).toMatchObject({ status: 'blocked', blockedAs: 'locked' });
    expect(blocked.spec).toBeNull();
  });

  it('without locks the order is exactly as before', () => {
    const input = {
      sheet: { change: [{ text: '블랙 원피스', slot: 'outfit' as const }], keep: [], exclude: [] },
      pendingNote: '핑크 단발로',
      audioMode: 'bgm' as const,
      bgmMood: 'trendy_beat' as const,
      slotOverrides: ['look_ref' as const]
    };
    expect(buildSheetDirectorSpec({ ...input, locks: null })).toEqual(buildSheetDirectorSpec(input));
  });
});

// --- The panel ----------------------------------------------------------------------------------------------------

function panel(props: Partial<Parameters<typeof TemplateDirectorPanel>[0]> = {}): string {
  return renderToStaticMarkup(
    <TemplateDirectorPanel
      locale="ko"
      templateId={TEMPLATE}
      medium="video"
      videoResolutionSpec={{ runtimeSeconds: 10, aspect: '9:16' }}
      initialExpanded={true}
      {...props}
    />
  );
}

describe('TemplateDirectorPanel with template locks (flag off: no editSheet)', () => {
  // docs/PERSONAL-STUDIO.md §3.4.9 (S2): a declared template shows no guess by address at all, and its parts are listed
  // once, on the make card's parts card (components/twings/template-parts-card.tsx), not again in the panel.
  it('replaces every guess by address with the skeleton line; the locked parts are left to the make card', () => {
    const html = panel({ locks: CAMPAIGN, lockCopy: ko.editSheet });
    const start = html.indexOf('data-template-locked-elements');
    const row = html.slice(start, html.indexOf('</section>', start));
    for (const guessed of BASELINE.lockedElementsKo) expect(html).not.toContain(guessed);
    expect(html).not.toContain('템플릿 고정 (변경 불가)');
    expect(html).not.toContain(BASELINE.titleKo);
    expect(html).toContain('data-template-baseline-card="declared"');
    expect(row).toContain(ko.editSheet.lockedHeading);
    expect(row).toContain(ko.editSheet.skeleton);
    expect(html).not.toContain('data-template-lock-part=');
  });

  it('hides every closed photo picker and leaves the open ones', () => {
    const campaign = panel({ locks: CAMPAIGN, lockCopy: ko.editSheet });
    for (const slot of ['outfit', 'prop', 'scene']) expect(campaign).not.toContain(`data-director-slot="${slot}"`);
    expect(campaign).not.toContain('data-direct-upload-mode');
    expect(campaign).not.toContain('type="file"');

    const propOnly = panel({ locks: PROP_ONLY, lockCopy: ko.editSheet });
    expect(propOnly).toContain('data-director-slot="outfit"');
    expect(propOnly).toContain('data-director-slot="scene"');
    expect(propOnly).not.toContain('data-director-slot="prop"');
    expect(count(propOnly, 'type="file"')).toBe(2);
  });

  it('hides the audio option when the sound is locked, and keeps it otherwise', () => {
    expect(panel({ locks: SOUND, lockCopy: ko.editSheet })).not.toContain('data-director-audio-toggle');
    expect(panel({ locks: CAMPAIGN, lockCopy: ko.editSheet })).toContain('data-director-audio-toggle');
  });

  it('offers no preset or slot card chosen by address, and no quick pill whose part or photo is closed', () => {
    const html = panel({ locks: CAMPAIGN, lockCopy: ko.editSheet });
    expect(html).not.toContain('data-director-predictive-presets');
    for (const preset of BASELINE.predictivePresets) expect(html.includes(`data-predictive-preset="${preset.id}"`), preset.id).toBe(false);
    // The quick pills: a closed part, or a pill that works from a closed photo (outfit and prop pills ask for one).
    for (const slot of ['hair', 'prop', 'outfit']) expect(html).not.toContain(`data-director-preset="${slot}"`);
    for (const slot of ['makeup', 'shot_action']) expect(html).toContain(`data-director-preset="${slot}"`);
    const propOnly = panel({ locks: PROP_ONLY, lockCopy: ko.editSheet });
    expect(propOnly).toContain('data-director-preset="outfit"');
    expect(propOnly).not.toContain('data-director-preset="prop"');
    for (const slot of BASELINE.baselineSlots) expect(html.includes(`data-baseline-slot="${slot.slot}"`), slot.slot).toBe(false);
  });

  it('a malformed block: one "everything is fixed" line, nothing to pick or change', () => {
    const html = panel({ locks: ALL, lockCopy: ko.editSheet });
    expect(html).toContain('data-template-lock-all');
    expect(html).toContain(ko.editSheet.lockedAll);
    expect(html).not.toContain('data-template-lock-part=');
    expect(html).not.toContain('data-predictive-preset=');
    expect(html).not.toContain('data-director-preset=');
    expect(html).not.toContain('data-baseline-slot=');
    expect(html).not.toContain('data-director-slot=');
    expect(html).not.toContain('data-director-audio-toggle');
  });

  it('is unchanged without locks (and with `locks={null}`)', () => {
    for (const props of [{}, { initialExpanded: false }, { locale: 'en' as const, medium: 'image' as const }]) {
      expect(panel({ ...props, locks: null, lockCopy: ko.editSheet })).toBe(panel(props));
    }
    const plain = panel();
    expect(plain).toContain('템플릿 고정 (변경 불가)');
    expect(plain).not.toContain('data-template-lock-part');
  });

  it('the request box suggests nothing a lock forbids: the locked example, or none when the direction is fixed', () => {
    const placeholder = (html: string) => html.match(/<textarea[^>]*placeholder="([^"]*)"/)?.[1];
    const escaped = (text: string) => text.replace(/'/g, '&#x27;');
    expect(placeholder(panel({ locks: CAMPAIGN, lockCopy: ko.editSheet }))).toBe(ko.editSheet.lockedPlaceholder);
    expect(placeholder(panel({ locale: 'en', locks: SOUND, lockCopy: en.editSheet }))).toBe(escaped(en.editSheet.lockedPlaceholder));
    expect(placeholder(panel({ editSheet: ko.editSheet, locks: PROP_ONLY }))).toBe(ko.editSheet.lockedPlaceholder);
    const direction = projected([{ kind: 'slot', slot: 'shot_action' }]);
    expect(placeholder(panel({ locks: direction, lockCopy: ko.editSheet }))).toBe('');
    expect(placeholder(panel({ locks: ALL, lockCopy: ko.editSheet }))).toBe('');
    // Without locks it is the example it always was.
    expect(placeholder(panel())).toBe('예: 2번째 컷에서 컵 대신 내 향수를 들고 정면을 보며 살짝 웃게 해줘');
  });

  it('English says the skeleton in English', () => {
    const html = panel({ locale: 'en', locks: CAMPAIGN, lockCopy: en.editSheet });
    const start = html.indexOf('data-template-locked-elements');
    const row = html.slice(start, html.indexOf('</section>', start));
    expect(row).toContain(en.editSheet.lockedHeading);
    expect(row).toContain(en.editSheet.skeleton);
    expect(row).not.toMatch(/[가-힣]/);
  });
});

describe('TemplateDirectorPanel with template locks (flag on: editSheet)', () => {
  it('shows the card with its locked section from the start, even collapsed', () => {
    const html = panel({ initialExpanded: false, editSheet: ko.editSheet, locks: CAMPAIGN });
    expect(html).toContain('data-edit-sheet-block="locked"');
    expect(html).toContain('data-edit-sheet-empty');
    // Without locks a collapsed empty panel shows no card, as before.
    expect(panel({ initialExpanded: false, editSheet: ko.editSheet })).not.toContain('data-edit-sheet');
  });

  it('uses the sheet words when no separate lock words are given; the sheet card keeps its fixed block', () => {
    const html = panel({ editSheet: ko.editSheet, locks: PROP_ONLY });
    expect(html).toContain('data-template-baseline-card="declared"');
    expect(html).toContain('data-edit-sheet-locked="prop"');
    expect(html).not.toContain('data-template-lock-part=');
  });

  it('is unchanged without locks', () => {
    expect(panel({ editSheet: ko.editSheet, locks: null })).toBe(panel({ editSheet: ko.editSheet }));
  });
});

// --- Copy -----------------------------------------------------------------------------------------------------------

describe('lock copy', () => {
  const keys = ['lockedHeading', 'lockedNote', 'lockedAll', 'skeleton', 'refusedLocked', 'updatedLocked', 'lockedPlaceholder'] as const;

  it('exists in both languages, with the three named parts', () => {
    for (const dict of [ko, en]) {
      for (const key of keys) expect(dict.editSheet[key].trim().length, key).toBeGreaterThan(0);
      for (const part of ['product', 'logo', 'sound'] as const) expect(dict.editSheet.locks[part].trim().length).toBeGreaterThan(0);
    }
  });

  it('is the confirmed wording (founder, 2026-11-27)', () => {
    expect({ ...pick(ko.editSheet), locks: ko.editSheet.locks }).toEqual({
      lockedHeading: '고정된 부분',
      lockedNote: '이 템플릿에서는 바꿀 수 없어요.',
      lockedAll: '모든 부분이 고정된 템플릿이에요.',
      skeleton: '카메라 연출, 컷 리듬, 조명과 색감, 장면 타이밍',
      refusedLocked: '고정된 부분이라 바꿀 수 없어요.',
      updatedLocked: '바꿀 수 있는 것만 고칠 내용에 담았어요. 고정된 부분은 그대로 둬요.',
      lockedPlaceholder: '예: 마지막에 카메라를 보며 살짝 웃게 해 주세요',
      locks: { product: '제품', logo: '로고', sound: '소리' },
    });
    expect({ ...pick(en.editSheet), locks: en.editSheet.locks }).toEqual({
      lockedHeading: 'Fixed parts',
      lockedNote: "These can't be changed in this template.",
      lockedAll: 'Everything in this template is fixed.',
      skeleton: 'Camera work, cut rhythm, light and colour, scene timing',
      refusedLocked: "That part is fixed and can't be changed.",
      updatedLocked: 'Added what can be changed. Fixed parts stay as they are.',
      lockedPlaceholder: 'e.g. Have me smile softly at the camera at the end',
      locks: { product: 'Product', logo: 'Logo', sound: 'Sound' },
    });
  });

  function pick(copy: EditSheetCopy) {
    return Object.fromEntries(keys.map((key) => [key, copy[key]]));
  }

  it('never mentions campaigns, brands, models, providers or prompts', () => {
    const banned = /campaign|brand|model|provider|prompt|engine|gemini|seedance|캠페인|브랜드|모델|프롬프트|엔진|제공사/i;
    for (const dict of [ko, en]) {
      for (const value of [...keys.map((k) => dict.editSheet[k]), ...Object.values(dict.editSheet.locks)]) {
        expect(value).not.toMatch(banned);
      }
    }
  });
});
