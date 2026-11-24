import { afterEach, describe, expect, it, vi } from 'vitest';
import { foldPendingForOrder } from '@/components/twings/edit-sheet-card';
import {
  DIRECTOR_EDITABLE_SLOTS,
  NO_LOCKS,
  compileDirectorPromptDetailed,
  emptyPersonalSheetState,
  guardPersonalSheet,
  heuristicSlotMatch,
  heuristicSlotOf,
  keywordSlotsOf,
  lockChips,
  lockedPartText,
  lockSheet,
  lockSpec,
  lockVerdict,
  parseTemplateLocks,
  planSheetCompile,
  publicLocks,
  runHeuristicDirectorTurn,
  settleSheetTurn,
  type PersonalDirectorSpec,
  type PersonalEditSheet,
  type PersonalSheetState,
} from '@/lib/template-director';

/**
 * docs/PERSONAL-STUDIO.md §3.3 (C2 round 2) — a line filed under an OPEN slot whose text is about a LOCKED slot
 * ("빨간 드레스로 바꿔 줘" filed as an action on a wardrobe-locked template) is refused by `lockVerdict`, so the turn,
 * the sheet guard, the compile and the screen's fold of unsent text all drop it. Only a positive keyword match
 * counts: a text no keyword list matches is judged by its own slot alone.
 */

const BODY = `Reference authority:
- @Image 1 supplies ONLY the protagonist's facial identity and hairstyle.

Timeline:
[Shot 1 - Counter, 0.0-3.0s]:
- @Image 1 picks up a cup and smiles.
[Shot 2 - Mirror, 3.0-6.0s]:
- @Image 1 turns to the mirror.

[Exclusions]
No watermarks.`;

const block = (key: string) => `Template locks:\n- Keep exactly as in the template: ${key}.`;
const WARDROBE = `${BODY}\n\n${block('the wardrobe')}`;
const DIRECTION = `${BODY}\n\n${block('the direction')}`;
const HAIR = `${BODY}\n\n${block('the hairstyle')}`;

const wardrobe = parseTemplateLocks(WARDROBE);
const direction = parseTemplateLocks(DIRECTION);
const hair = parseTemplateLocks(HAIR);

const DRESS = '빨간 드레스로 바꿔 줘';
const DRESS_LINE = { slot: 'shot_action' as const, text: DRESS };

const ON = { TWINGS_PERSONAL_EDIT_SHEET: 'on' } as const;
const ON_KEY = { ...ON, GEMINI_API_KEY: 'fake-gemini-key' } as const;
const OFF = {} as const;
const OFF_KEY = { GEMINI_API_KEY: 'fake-gemini-key' } as const;

const state = (sheet: PersonalEditSheet): PersonalSheetState => ({ ...emptyPersonalSheetState(), sheet });

function geminiJson(payload: unknown) {
  return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(payload) }] } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** A rewrite that echoes the base it was sent and adds a line. */
function echoFetch() {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { contents: Array<{ parts: Array<{ text: string }> }> };
    const payload = JSON.parse(body.contents[0]!.parts[0]!.text) as { basePrompt: string };
    return geminiJson({
      rewrittenPrompt: `${payload.basePrompt}\n\nDirection: a calm glance at the end.`,
      preservedCameraAndLighting: true,
      preservedAudioRule: true,
      preservedIdentityStrictLock: true,
    });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the keyword classifier', () => {
  it('heuristicSlotMatch is null without a keyword; heuristicSlotOf still falls to shot_action', () => {
    expect(heuristicSlotMatch('살짝 웃으며 돌아보기')).toBeNull();
    expect(heuristicSlotOf('살짝 웃으며 돌아보기')).toBe('shot_action');
    expect(heuristicSlotMatch(DRESS)).toBe('outfit');
    expect(heuristicSlotOf(DRESS)).toBe('outfit');
    // First match wins for the classifier; the lock check reads every list that matches.
    expect(heuristicSlotOf('드레스 입고 단발로')).toBe('outfit');
    expect(keywordSlotsOf('드레스 입고 단발로')).toEqual(['outfit', 'hair']);
    expect(keywordSlotsOf('살짝 웃기')).toEqual([]);
  });
});

describe('lockVerdict reads the text, not only the slot it is filed under', () => {
  it('an action-filed dress line on a wardrobe-locked template is a slot hit; without locks nothing changes', () => {
    expect(lockVerdict(DRESS_LINE, wardrobe)).toBe('slot');
    expect(lockVerdict({ slot: 'hair', text: '드레스 입고 단발로' }, wardrobe)).toBe('slot');
    expect(lockVerdict({ slot: 'hair', text: '단발로' }, wardrobe)).toBe('ok');
    expect(lockVerdict(DRESS_LINE, NO_LOCKS)).toBe('ok');
  });

  it('on a direction-locked template an unclassified line is judged by its own slot alone', () => {
    expect(direction.slots).toEqual(['shot_action']);
    expect(lockVerdict({ slot: 'hair', text: '살짝 웃으며 돌아보기' }, direction)).toBe('ok');
    expect(lockVerdict({ slot: 'lighting_mood', text: '노을빛으로' }, direction)).toBe('ok');
    expect(lockVerdict({ slot: 'shot_action', text: '살짝 웃으며 돌아보기' }, direction)).toBe('slot');
    // A free text without a keyword never counts as the action slot.
    expect(lockedPartText('자막 없이', direction)).toBe(false);
    expect(lockSheet({ change: [], keep: [], exclude: ['자막'] }, direction).dropped).toBe(0);
  });

  it('the turn drops it (counted as a lock hit)', () => {
    const out = settleSheetTurn({
      prior: state({ change: [], keep: [], exclude: [] }),
      reading: { set: [DRESS_LINE, { text: '단발로', slot: 'hair' }] },
      attachedRefs: [],
      editableSlots: DIRECTOR_EDITABLE_SLOTS,
      locks: wardrobe,
    });
    expect(out.sheet.change).toEqual([{ text: '단발로', slot: 'hair' }]);
    expect(out.locked).toBe(1);

    const heuristic = runHeuristicDirectorTurn({
      templateId: 'tpl',
      templateSummaryKo: '카운터',
      editableSlots: DIRECTOR_EDITABLE_SLOTS,
      userMessage: DRESS,
      sheetState: state({ change: [], keep: [], exclude: [] }),
      locks: wardrobe,
    });
    expect(heuristic.sheet!.change).toEqual([]);
    expect(heuristic.lockedHit).toBe(true);
  });

  it('the sheet guard and the compile plan drop it', () => {
    const sheet: PersonalEditSheet = { change: [DRESS_LINE, { text: '단발로', slot: 'hair' }], keep: [], exclude: [] };
    expect(guardPersonalSheet(sheet, wardrobe)).toEqual({ sheet: { change: [{ text: '단발로', slot: 'hair' }], keep: [], exclude: [] }, dropped: 1 });
    const plan = planSheetCompile(sheet, { look: false, prop: false, scene: false }, wardrobe);
    expect(JSON.stringify(plan)).not.toContain('드레스');
    expect(plan.elements).toEqual([{ slot: 'hair', text: '단발로', ref: null }]);
  });

  it('never reaches the prompt or the rewrite body (sheet path, deterministic and rewrite)', async () => {
    const spec: PersonalDirectorSpec = { audioMode: 'ambient', sheet: { change: [DRESS_LINE, { text: '단발로', slot: 'hair' }], keep: [], exclude: [] } };
    const det = await compileDirectorPromptDetailed({ basePrompt: WARDROBE, medium: 'video', directorSpec: spec }, { env: ON });
    expect(det.path).toBe('deterministic');
    expect(det.prompt).not.toContain('드레스');
    expect(det.prompt).toContain('단발로');

    const fetchMock = echoFetch();
    const rew = await compileDirectorPromptDetailed(
      { basePrompt: WARDROBE, medium: 'video', directorSpec: spec },
      { env: ON_KEY, fetch: fetchMock as unknown as typeof fetch },
    );
    expect(rew.path).toBe('rewrite');
    expect(String((fetchMock.mock.calls[0]![1] as RequestInit).body)).not.toContain('드레스');
    expect(rew.prompt).not.toContain('드레스');
  });

  it('never reaches the prompt or the rewrite body (chips path: an action chip, a shot edit and a note line)', async () => {
    const spec: PersonalDirectorSpec = {
      audioMode: 'ambient',
      userMessage: `${DRESS}\n단발로`,
      summaryChips: [
        { slot: 'shot_action', labelKo: '연출', summaryKo: DRESS },
        { slot: 'hair', labelKo: '헤어', summaryKo: '단발로' },
      ],
      structuredIntent: {
        hairOverrideEn: 'a short bob',
        makeupOverrideEn: null,
        outfitOverrideEn: null,
        propOverrideEn: null,
        shotEdits: [{ shotIndex: 1, actionEn: 'She changes into a red dress.' }],
        strictExclusionsEn: [],
      },
    };
    const locked = lockSpec(spec, wardrobe)!;
    expect(locked.summaryChips).toEqual([{ slot: 'hair', labelKo: '헤어', summaryKo: '단발로' }]);
    expect(locked.userMessage).toBe('단발로');
    expect(locked.structuredIntent!.shotEdits).toEqual([]);
    expect(lockChips(spec.summaryChips!, wardrobe)).toEqual(locked.summaryChips);

    const det = await compileDirectorPromptDetailed({ basePrompt: WARDROBE, medium: 'video', directorSpec: spec }, { env: OFF });
    expect(det.prompt).not.toContain('드레스');
    expect(det.prompt).not.toMatch(/red dress/i);
    const fetchMock = echoFetch();
    await compileDirectorPromptDetailed({ basePrompt: WARDROBE, medium: 'video', directorSpec: spec }, { env: OFF_KEY, fetch: fetchMock as unknown as typeof fetch });
    const body = String((fetchMock.mock.calls[0]![1] as RequestInit).body);
    expect(body).not.toContain('드레스');
    expect(body).not.toMatch(/red dress/i);
  });

  it('a note line keeps its old rule (filed under the classifier slot) and adds the keyword one', () => {
    const spec: PersonalDirectorSpec = { audioMode: 'ambient', userMessage: '살짝 웃기\n드레스 입고 단발로\n노을빛' };
    // Direction-locked: an unclassified line is filed as an action and is dropped, as before.
    expect(lockSpec(spec, direction)!.userMessage).toBe('드레스 입고 단발로');
    // Hair-locked: the line about the dress AND the hair is dropped, though its first keyword is the outfit.
    expect(lockSpec(spec, hair)!.userMessage).toBe('살짝 웃기\n노을빛');
  });
});

describe('exclusions about a locked slot', () => {
  const sheet: PersonalEditSheet = { change: [], keep: ['머리 길이 그대로'], exclude: ['머리핀', '안경', '자막'] };

  it('a hair-locked template drops an exclude mentioning hair; keep lines are never dropped', () => {
    expect(lockSheet(sheet, hair)).toEqual({ sheet: { change: [], keep: ['머리 길이 그대로'], exclude: ['자막'] }, dropped: 2 });
    expect(guardPersonalSheet(sheet, hair).sheet).toEqual({ change: [], keep: ['머리 길이 그대로'], exclude: ['자막'] });
    expect(planSheetCompile(sheet, { look: false, prop: false, scene: false }, hair).exclude).toEqual(['자막']);
    expect(planSheetCompile(sheet, { look: false, prop: false, scene: false }, hair).keep).toEqual(['머리 길이 그대로']);
    const out = settleSheetTurn({
      prior: state({ change: [], keep: [], exclude: [] }),
      reading: { exclude: ['헤어핀', '자막'], keep: ['앞머리 그대로'] },
      attachedRefs: [],
      editableSlots: DIRECTOR_EDITABLE_SLOTS,
      locks: hair,
    });
    expect(out.sheet.exclude).toEqual(['자막']);
    expect(out.sheet.keep).toEqual(['앞머리 그대로']);
    expect(out.locked).toBe(1);
  });

  it('the chips path drops the same exclusion; without locks nothing is dropped', () => {
    const intent = { hairOverrideEn: null, makeupOverrideEn: null, outfitOverrideEn: null, propOverrideEn: null, shotEdits: [], strictExclusionsEn: ['no hair clips', 'no subtitles'] };
    expect(lockSpec({ audioMode: 'ambient', structuredIntent: intent }, hair)!.structuredIntent!.strictExclusionsEn).toEqual(['no subtitles']);
    expect(lockSheet(sheet, NO_LOCKS)).toEqual({ sheet, dropped: 0 });
  });
});

describe("the screen's fold of unsent text", () => {
  it('reports `blockedAs: locked` for the same text', () => {
    const empty = { change: [], keep: [], exclude: [] };
    expect(foldPendingForOrder(empty, DRESS, publicLocks(wardrobe))).toEqual({ sheet: empty, status: 'blocked', pendingIndex: null, blockedAs: 'locked' });
    expect(foldPendingForOrder(empty, '단발로', publicLocks(wardrobe)).status).toBe('folded');
    // It would be filed as an action line, which a direction lock closes.
    expect(foldPendingForOrder(empty, '살짝 웃기', publicLocks(direction))).toMatchObject({ status: 'blocked', blockedAs: 'locked' });
    expect(foldPendingForOrder(empty, DRESS, null).status).toBe('folded');
  });
});
