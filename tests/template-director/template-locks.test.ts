import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CUSTOM_DIRECTOR_REF_SLOTS,
  DIRECTOR_EDITABLE_SLOTS,
  GEMINI_DIRECTOR_DEFAULT_MODEL,
  NO_LOCKS,
  PERSONAL_NO_BGM_AUDIO_CONTRACT_EN,
  TEMPLATE_LOCK_LIMITS,
  USER_CUSTOMIZATION_HEADER_EN,
  compileDirectorPromptDetailed,
  createFlashTemplateDirector,
  editableSlotsFor,
  enforcePersonalMorphicGuardrails,
  ensureTemplateLocks,
  guardPersonalSheet,
  lockChipsTurn,
  lockSpec,
  lockTextHit,
  lockVerdict,
  parseTemplateLocks,
  planSheetCompile,
  renderLockBlock,
  runHeuristicDirectorTurn,
  sanitizeRewrittenPrompt,
  settleSheetTurn,
  toClientDirectorTurnResponse,
  type DirectorChatTurnInput,
  type DirectorChatTurnResult,
  type PersonalDirectorSpec,
  type PersonalEditSheet,
  type PersonalSheetState,
  type TemplateLock,
} from '@/lib/template-director';

/** docs/PERSONAL-STUDIO.md §3.3 — C1: template locks, the model and compile-time enforcement. */

const CANONICAL = `Template locks:
- Keep exactly as in the template: the product — its shape, colour, label and logo placement, in every shot where it appears. Never replace, restyle, cover or remove it, and take it from no uploaded reference image.
- Keep exactly as in the template: the brand logo — its wording, colour and placement wherever it appears. Never alter, replace, blur or remove it.
- Keep exactly as in the template: the sound — voice, music and effects as written. Add no music and replace nothing.
- Keep exactly as in the template: shots 2–3 — action, framing, timing and what is shown, as written.
- Keep exactly as in the template: the wardrobe.`;

const CANONICAL_LOCKS: TemplateLock[] = [
  { kind: 'product' },
  { kind: 'logo' },
  { kind: 'sound' },
  { kind: 'shots', from: 2, to: 3 },
  { kind: 'slot', slot: 'outfit' },
];

const BODY = `Reference authority:
- @Image 1 supplies ONLY the protagonist's facial identity and hairstyle.
- The product: a slim white serum bottle with a silver cap and the brand logo on the label.

Timeline:
[Shot 1 - Counter, 0.0-3.0s]:
- @Image 1 picks up the serum bottle with background music and upbeat soundtrack.
[Shot 2 - Close-up, 3.0-6.0s]:
- The bottle turns slowly in hand, logo to camera.
[Shot 3 - Mirror, 6.0-10.0s]:
- @Image 1 smiles at the mirror.

[Exclusions]
No watermarks.`;

const withBlock = (block: string, body = BODY) => `${body}\n\n${block}`;
const LOCKED = withBlock(CANONICAL);

const ON = { TWINGS_PERSONAL_EDIT_SHEET: 'on' } as const;
const ON_KEY = { ...ON, GEMINI_API_KEY: 'fake-gemini-key' } as const;
const OFF_KEY = { GEMINI_API_KEY: 'fake-gemini-key' } as const;
const CONFIG = { apiKey: 'fake-gemini-key', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: GEMINI_DIRECTOR_DEFAULT_MODEL };

function geminiJson(payload: unknown) {
  return new Response(
    JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(payload) }] } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const rewriteOf = (rewrittenPrompt: string) => ({
  rewrittenPrompt,
  preservedCameraAndLighting: true,
  preservedAudioRule: true,
  preservedIdentityStrictLock: true,
});

/** A rewrite that echoes what it was sent (block included) and adds a line. */
function echoFetch() {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { contents: Array<{ parts: Array<{ text: string }> }> };
    const payload = JSON.parse(body.contents[0]!.parts[0]!.text) as { basePrompt: string };
    return geminiJson(rewriteOf(`${payload.basePrompt}\n\nWardrobe: a black leather jacket in every shot.`));
  });
}

function wire(fetchMock: { mock: { calls: unknown[][] } }, call = 0) {
  const init = fetchMock.mock.calls[call]![1] as RequestInit;
  const body = JSON.parse(String(init.body)) as {
    systemInstruction: { parts: Array<{ text: string }> };
    contents: Array<{ parts: Array<{ text?: string }> }>;
  };
  return { raw: String(init.body), system: body.systemInstruction.parts[0]!.text, payload: JSON.parse(body.contents[0]!.parts[0]!.text!) };
}

const sheetSpec = (sheet: PersonalEditSheet, extra: Partial<PersonalDirectorSpec> = {}): PersonalDirectorSpec => ({ audioMode: 'ambient', sheet, ...extra });

afterEach(() => {
  vi.restoreAllMocks();
});

// --- 1. Model -----------------------------------------------------------------------------------------------------

describe('template locks — render and parse', () => {
  it('renders the canonical block', () => {
    expect(renderLockBlock(CANONICAL_LOCKS)).toBe(CANONICAL);
    expect(renderLockBlock([])).toBe('');
  });

  it('parses the canonical block: named, implied slot and references, shots, block as written', () => {
    const locks = parseTemplateLocks(LOCKED);
    expect(locks).toMatchObject({
      any: true,
      malformed: false,
      named: ['product', 'logo', 'sound'],
      slots: ['outfit', 'prop'],
      shots: [{ from: 2, to: 3 }],
      refs: ['look_ref', 'prop_ref', 'scene_ref'],
      notes: [],
    });
    expect(locks.block).toBe(CANONICAL);
    expect(Object.isFrozen(locks)).toBe(true);
  });

  it('round-trips every lock kind on its own', () => {
    const cases: Array<[TemplateLock, Partial<ReturnType<typeof parseTemplateLocks>>]> = [
      [{ kind: 'product' }, { named: ['product'], slots: ['prop'], refs: ['look_ref', 'prop_ref', 'scene_ref'], shots: [] }],
      [{ kind: 'logo' }, { named: ['logo'], slots: [], refs: [], shots: [] }],
      [{ kind: 'sound' }, { named: ['sound'], slots: [], refs: [], shots: [] }],
      [{ kind: 'slot', slot: 'outfit' }, { named: [], slots: ['outfit'], refs: ['look_ref'] }],
      [{ kind: 'slot', slot: 'makeup' }, { slots: ['makeup'], refs: [] }],
      [{ kind: 'slot', slot: 'hair' }, { slots: ['hair'], refs: [] }],
      [{ kind: 'slot', slot: 'prop' }, { slots: ['prop'], refs: ['prop_ref'] }],
      [{ kind: 'slot', slot: 'shot_action' }, { slots: ['shot_action'], refs: [] }],
      [{ kind: 'slot', slot: 'lighting_mood' }, { slots: ['lighting_mood'], refs: ['scene_ref'] }],
      [{ kind: 'shots', from: 4, to: 4 }, { shots: [{ from: 4, to: 4 }], slots: [] }],
      [{ kind: 'shots', from: 1, to: 12 }, { shots: [{ from: 1, to: 12 }] }],
    ];
    for (const [lock, expected] of cases) {
      const block = renderLockBlock([lock]);
      const locks = parseTemplateLocks(`Some scene.\n\n${block}\n\nMore text.`);
      expect(locks).toMatchObject({ any: true, malformed: false, notes: [], ...expected });
      expect(locks.block).toBe(block);
    }
    expect(renderLockBlock([{ kind: 'shots', from: 4, to: 4 }])).toContain('the template: shot 4 — action');
  });

  it('no header = NO_LOCKS, frozen and empty', () => {
    for (const text of ['', 'A plain prompt.', 'Locks:\n- Keep exactly as in the template: the product.', 'Template locks: the product (inline, not a header)']) {
      expect(parseTemplateLocks(text)).toBe(NO_LOCKS);
    }
    expect(NO_LOCKS).toEqual({ any: false, malformed: false, named: [], slots: [], shots: [], refs: [], block: '', notes: [] });
    expect(Object.isFrozen(NO_LOCKS)).toBe(true);
    expect(Object.isFrozen(NO_LOCKS.slots)).toBe(true);
  });

  it('fails closed: a bad line, no line, a non-keep line, two headers or too many lines lock everything', () => {
    const everything = {
      any: true,
      malformed: true,
      named: ['product', 'logo', 'sound'],
      slots: [...DIRECTOR_EDITABLE_SLOTS],
      refs: [...CUSTOM_DIRECTOR_REF_SLOTS],
    };
    const tooMany = Array.from({ length: TEMPLATE_LOCK_LIMITS.max + 1 }, () => '- Keep exactly as in the template: the wardrobe.').join('\n');
    const tooManyShots = [1, 2, 3, 4, 5].map((n) => `- Keep exactly as in the template: shot ${n}.`).join('\n');
    const blocks = [
      'Template locks:\n- Keep exactly as in the template: the face.',
      'Template locks:\n- Keep exactly as in the template: the product.\n- Keep exactly as in the template: the props.',
      'Template locks:',
      'Template locks:\n\n- Keep exactly as in the template: the product.',
      'Template locks:\n- Keep exactly as in the template: the product.\nAnd also the logo.',
      'Template locks:\n- Keep the product.',
      'Template locks:\n- Keep exactly as in the template: shot 13.',
      'Template locks:\n- Keep exactly as in the template: shots 3–2.',
      `Template locks:\n${tooMany}`,
      `Template locks:\n${tooManyShots}`,
    ];
    for (const block of blocks) {
      const locks = parseTemplateLocks(withBlock(block));
      expect(locks, block).toMatchObject(everything);
      expect(locks.block).toBe(block.split('\n\n')[0]);
      expect(editableSlotsFor(locks)).toEqual([]);
    }
    const twice = parseTemplateLocks(`${withBlock('Template locks:\n- Keep exactly as in the template: the sound.')}\n\nTemplate locks:\n- Keep exactly as in the template: the logo.`);
    expect(twice).toMatchObject(everything);
    expect(twice.block).toBe('Template locks:\n- Keep exactly as in the template: the sound.');
  });

  it('accepts a hyphen or an en dash in a range, and merges and sorts ranges', () => {
    const hyphen = parseTemplateLocks('Template locks:\n- Keep exactly as in the template: shots 2-3.');
    const dash = parseTemplateLocks('Template locks:\n- Keep exactly as in the template: shots 2–3.');
    expect(hyphen.shots).toEqual([{ from: 2, to: 3 }]);
    expect(dash.shots).toEqual(hyphen.shots);
    const merged = parseTemplateLocks(
      ['Template locks:', '- Keep exactly as in the template: shots 5–6.', '- Keep exactly as in the template: shot 9.', '- Keep exactly as in the template: shot 2.', '- Keep exactly as in the template: shots 3-4 — the reveal.'].join('\n'),
    );
    expect(merged.malformed).toBe(false);
    expect(merged.shots).toEqual([
      { from: 2, to: 6 },
      { from: 9, to: 9 },
    ]);
  });

  it('reads a maker-written tail after the key (em dash, hyphen, colon, period) and exposes it as a note', () => {
    const block = [
      'Template locks:',
      '- Keep exactly as in the template: the hairstyle — a bright pink chin-length bob.',
      '- Keep exactly as in the template: the wardrobe - the red satin slip dress.',
      '- Keep exactly as in the template: the makeup: soft coral lips.',
      '- Keep exactly as in the template: the prop. The glass perfume bottle.',
      '- Keep exactly as in the template: shots 2–3 — the bottle reveal.',
      '- Keep exactly as in the template: the product — its shape, colour, label and logo placement, in every shot where it appears. Never replace, restyle, cover or remove it, and take it from no uploaded reference image.',
    ].join('\n');
    const locks = parseTemplateLocks(withBlock(block));
    expect(locks.malformed).toBe(false);
    expect(locks.slots).toEqual(['outfit', 'makeup', 'hair', 'prop']);
    expect(locks.notes).toEqual([
      { key: 'hair', note: 'a bright pink chin-length bob.' },
      { key: 'outfit', note: 'the red satin slip dress.' },
      { key: 'makeup', note: 'soft coral lips.' },
      { key: 'prop', note: 'The glass perfume bottle.' },
      { key: 'shots-2-3', note: 'the bottle reveal.' },
    ]);
    expect(locks.block).toBe(block);
  });

  it('keeps a 200-character Korean tail valid and the block byte-for-byte', () => {
    const tail = `${`가슴까지 오는 밝은 분홍 단발, 앞머리는 눈썹 위에서 일자로 자르고 끝은 안으로 말아 넣은 모양 — keep it exactly; ${'아주 선명한 분홍색 '.repeat(20)}`.slice(0, 199)}.`;
    expect(tail).toHaveLength(200);
    const block = `Template locks:\n- Keep exactly as in the template: the hairstyle — ${tail}`;
    const locks = parseTemplateLocks(withBlock(block));
    expect(locks.malformed).toBe(false);
    expect(locks.slots).toEqual(['hair']);
    expect(locks.notes).toEqual([{ key: 'hair', note: tail.trimEnd() }]);
    expect(locks.block).toBe(block);
    expect(sanitizeRewrittenPrompt(withBlock(block), true)).toContain(block);
  });

  it('round-trips notes: render with notes, parse, same locks and same notes', () => {
    const input: TemplateLock[] = [
      { kind: 'slot', slot: 'hair', note: 'a bright pink chin-length bob.' },
      { kind: 'product', note: 'the blue glass bottle with the gold cap' },
      { kind: 'shots', from: 2, to: 3, note: 'the bottle reveal' },
      { kind: 'logo' },
    ];
    const block = renderLockBlock(input);
    const locks = parseTemplateLocks(block);
    expect(locks).toMatchObject({ malformed: false, named: ['product', 'logo'], slots: ['hair', 'prop'], shots: [{ from: 2, to: 3 }] });
    expect(locks.notes).toEqual([
      { key: 'hair', note: 'a bright pink chin-length bob.' },
      { key: 'product', note: 'the blue glass bottle with the gold cap' },
      { key: 'shots-2-3', note: 'the bottle reveal' },
    ]);
    expect(renderLockBlock([{ kind: 'slot', slot: 'hair', note: 'two\nlines' }])).toBe('Template locks:\n- Keep exactly as in the template: the hairstyle — two lines');
  });

  it('keeps a CRLF block verbatim', () => {
    const prompt = `Scene.\r\n\r\nTemplate locks:\r\n- Keep exactly as in the template: the brand logo.\r\n`;
    const locks = parseTemplateLocks(prompt);
    expect(locks).toMatchObject({ malformed: false, named: ['logo'] });
    expect(prompt).toContain(locks.block);
    expect(locks.block).toBe('Template locks:\r\n- Keep exactly as in the template: the brand logo.');
  });
});

describe('template locks — verdicts', () => {
  const locks = parseTemplateLocks(LOCKED);

  it('lockVerdict: slot, shots, named, ok', () => {
    expect(lockVerdict({ slot: 'outfit', text: '빨간 드레스' }, locks)).toBe('slot');
    expect(lockVerdict({ slot: 'prop', text: '우산' }, locks)).toBe('slot');
    expect(lockVerdict({ slot: 'shot_action', text: '윙크', shots: { from: 3, to: 4 } }, locks)).toBe('shots');
    expect(lockVerdict({ slot: 'hair', text: '단발', shots: { from: 1, to: 2 } }, locks)).toBe('shots');
    expect(lockVerdict({ slot: 'shot_action', text: '윙크', shots: { from: 4, to: 5 } }, locks)).toBe('ok');
    expect(lockVerdict({ slot: 'shot_action', text: '윙크' }, locks)).toBe('ok');
    expect(lockVerdict({ slot: 'shot_action', text: '로고를 가려 줘' }, locks)).toBe('named');
    expect(lockVerdict({ slot: 'lighting_mood', text: 'add upbeat music' }, locks)).toBe('named');
    expect(lockVerdict({ slot: 'outfit', text: '빨간 드레스' }, NO_LOCKS)).toBe('ok');
  });

  it('lockTextHit screens Korean and English, only for the named locks that are active', () => {
    for (const text of ['제품을 바꿔 줘', '상품 빼 줘', 'swap the product', '로고 지워', 'remove the logo', '브랜드 마크 없애', '배경음악 넣어', '목소리 바꿔', 'BGM 추가', 'add music', 'change her voice', 'no sound']) {
      expect(lockTextHit(text, locks), text).toBe(true);
    }
    for (const text of ['빨간 드레스', 'a wink at the camera', '머리 단발로']) expect(lockTextHit(text, locks), text).toBe(false);
    const logoOnly = parseTemplateLocks('Template locks:\n- Keep exactly as in the template: the brand logo.');
    expect(lockTextHit('로고 지워', logoOnly)).toBe(true);
    expect(lockTextHit('제품 바꿔', logoOnly)).toBe(false);
    expect(lockTextHit('배경음악 넣어', logoOnly)).toBe(false);
    expect(lockTextHit('로고 지워', NO_LOCKS)).toBe(false);
    const malformed = parseTemplateLocks('Template locks:\n- Keep exactly as in the template: the face.');
    expect(lockTextHit('a wink', malformed)).toBe(true);
  });

  it('editableSlotsFor leaves out the closed slots', () => {
    expect(editableSlotsFor(locks)).toEqual(['makeup', 'hair', 'shot_action', 'lighting_mood']);
    expect(editableSlotsFor(NO_LOCKS)).toEqual([...DIRECTOR_EDITABLE_SLOTS]);
  });
});

describe('template locks — the block in a compiled prompt', () => {
  it('survives sanitizeRewrittenPrompt byte-for-byte, with notes that hold banned words', () => {
    expect(sanitizeRewrittenPrompt(LOCKED, true, { cast: 'solo', audioMode: 'ambient' })).toContain(CANONICAL);
    const noted = renderLockBlock([
      { kind: 'slot', slot: 'outfit', note: 'the vibrant Hollywood-CGI sequin dress, shot on a Canon camera with Kodak Portra 400 film stock' },
      { kind: 'slot', slot: 'makeup', note: 'pink makeup with rosy cheeks  and visible pores .' },
    ]);
    const out = sanitizeRewrittenPrompt(`${BODY} A vibrant Canon look.\n\n${noted}`, true, { cast: 'couple', audioMode: 'bgm' });
    expect(out).toContain(noted);
    // The rest is still cleaned.
    expect(out).not.toContain('A vibrant Canon look');
  });

  it('ensureTemplateLocks re-appends once, is idempotent, and replaces an altered copy', () => {
    const locks = parseTemplateLocks(LOCKED);
    const dropped = ensureTemplateLocks(BODY, locks);
    expect(dropped).toBe(`${BODY}\n\n${CANONICAL}`);
    expect(ensureTemplateLocks(dropped, locks)).toBe(dropped);
    expect(ensureTemplateLocks(LOCKED, locks)).toBe(LOCKED);
    const altered = `${BODY}\n\nTemplate locks:\n- Keep exactly as in the template: the product — but make it blue.\n\nEnd.`;
    const fixed = ensureTemplateLocks(altered, locks);
    expect(fixed).not.toContain('make it blue');
    expect(fixed).toContain('End.');
    expect(fixed.endsWith(CANONICAL)).toBe(true);
    expect(fixed.split('Template locks:')).toHaveLength(2);
    expect(ensureTemplateLocks(fixed, locks)).toBe(fixed);
    expect(ensureTemplateLocks(BODY, NO_LOCKS)).toBe(BODY);
  });

  it('re-appends the ORIGINAL block with its notes, not a regenerated one, and sends its lines to the rewrite model', async () => {
    const noted = [
      'Template locks:',
      '- Keep exactly as in the template: the hairstyle — a bright pink chin-length bob.',
      '- Keep exactly as in the template: the wardrobe: the red satin slip dress.',
      '- Keep exactly as in the template: the brand logo.',
    ].join('\n');
    const base = withBlock(noted);
    const locks = parseTemplateLocks(base);
    expect(locks.block).toBe(noted);
    expect(ensureTemplateLocks(BODY, locks)).toBe(`${BODY}\n\n${noted}`);
    expect(ensureTemplateLocks(BODY, locks)).not.toContain(renderLockBlock([{ kind: 'slot', slot: 'hair' }]).split('\n')[1]);

    const fetchMock = vi.fn(async () => geminiJson(rewriteOf(`${BODY}\n\nHair: a long braid.`)));
    const result = await compileDirectorPromptDetailed(
      { basePrompt: base, medium: 'video', directorSpec: sheetSpec({ change: [{ text: '노을빛', slot: 'lighting_mood' }], keep: [], exclude: [] }) },
      { env: ON_KEY, fetch: fetchMock as unknown as typeof fetch },
    );
    expect(result.prompt.endsWith(noted)).toBe(true);
    expect(wire(fetchMock).payload.templateLocks).toEqual(noted.split('\n').slice(1));
  });

  it('the sound lock leaves the template audio wording alone in the guardrails', () => {
    const text = 'A walk with background music and upbeat soundtrack.';
    expect(enforcePersonalMorphicGuardrails(text, { hasPersonSlot: true, audioMode: 'ambient', lockTemplateAudio: true })).toBe(text);
    expect(enforcePersonalMorphicGuardrails(text, { hasPersonSlot: true, audioMode: 'ambient' })).toContain(PERSONAL_NO_BGM_AUDIO_CONTRACT_EN);
  });
});

// --- 2. Sheet -----------------------------------------------------------------------------------------------------

const state = (sheet: PersonalEditSheet, extra: Partial<PersonalSheetState> = {}): PersonalSheetState => ({ sheet, turns: [], question: null, asked: false, ...extra });

describe('template locks — the sheet functions', () => {
  const locks = parseTemplateLocks(LOCKED);

  it('settleSheetTurn drops locked prior and new lines, overlapping ranged lines and locked exclusions, and counts this reading', () => {
    const prior = state({
      change: [
        { text: '검정 자켓', slot: 'outfit' },
        { text: '단발', slot: 'hair' },
        { text: '2컷 윙크', slot: 'shot_action', shots: { from: 2, to: 2 } },
        { text: '로고 가리기', slot: 'shot_action' },
      ],
      keep: ['앞머리'],
      exclude: ['안경', '로고'],
    });
    const out = settleSheetTurn({
      prior,
      reading: {
        set: [
          { text: '빨간 드레스', slot: 'outfit' },
          { text: '제품을 파란 병으로', slot: 'prop' },
          { text: '3~4컷 손 흔들기', slot: 'shot_action', shots: { from: 3, to: 4 } },
          { text: '손 흔들기', slot: 'shot_action' },
        ],
        keep: ['조명'],
        exclude: ['상품 라벨', '모자'],
      },
      attachedRefs: [],
      editableSlots: DIRECTOR_EDITABLE_SLOTS,
      locks,
    });
    expect(out.sheet).toEqual({
      change: [
        { text: '단발', slot: 'hair' },
        { text: '손 흔들기', slot: 'shot_action' },
      ],
      keep: ['앞머리', '조명'],
      exclude: ['안경', '모자'],
    });
    expect(out.locked).toBe(4);
    expect(out.changed).toBe(true);
  });

  it('settleSheetTurn unbinds a closed reference photo and counts it; NO_LOCKS changes nothing', () => {
    const lightLocked = parseTemplateLocks('Template locks:\n- Keep exactly as in the template: the look and light.');
    const out = settleSheetTurn({
      prior: state({ change: [], keep: [], exclude: [] }),
      reading: { set: [{ text: '사진 속 노을빛', slot: 'shot_action', ref: 'scene_ref' }] },
      attachedRefs: ['scene_ref'],
      editableSlots: DIRECTOR_EDITABLE_SLOTS,
      locks: lightLocked,
    });
    expect(out.sheet.change).toEqual([{ text: '사진 속 노을빛', slot: 'shot_action' }]);
    expect(out.locked).toBe(1);

    const input = {
      prior: state({ change: [{ text: '자켓', slot: 'outfit' as const }], keep: [], exclude: ['로고'] }),
      reading: { set: [{ text: '제품 바꾸기', slot: 'prop', ref: 'prop_ref' }], exclude: ['로고 2'] },
      attachedRefs: ['prop_ref' as const],
      editableSlots: DIRECTOR_EDITABLE_SLOTS,
    };
    const plain = settleSheetTurn(input);
    expect(settleSheetTurn({ ...input, locks: NO_LOCKS })).toEqual(plain);
    expect(plain.locked).toBe(0);
  });

  it('guardPersonalSheet(sheet, locks) also drops locked lines and exclusions, counted in dropped', () => {
    const sheet: PersonalEditSheet = {
      change: [
        { text: '빨간 드레스', slot: 'outfit' },
        { text: '단발', slot: 'hair' },
        { text: '@Image 2 자켓', slot: 'hair' },
      ],
      keep: ['앞머리'],
      exclude: ['로고', '안경'],
    };
    expect(guardPersonalSheet(sheet, locks)).toEqual({
      sheet: { change: [{ text: '단발', slot: 'hair' }], keep: ['앞머리'], exclude: ['안경'] },
      dropped: 3,
    });
    expect(guardPersonalSheet(sheet, NO_LOCKS)).toEqual(guardPersonalSheet(sheet));
    const clean: PersonalEditSheet = { change: [{ text: '단발', slot: 'hair' }], keep: [], exclude: [] };
    expect(guardPersonalSheet(clean, locks).sheet).toBe(clean);
  });

  it('planSheetCompile skips locked lines, closed references, and adds `locks` only when the template has some', () => {
    const sheet: PersonalEditSheet = {
      change: [
        { text: '빨간 드레스', slot: 'outfit', ref: 'look_ref' },
        { text: '단발', slot: 'hair', ref: 'scene_ref' },
        { text: '2컷 윙크', slot: 'shot_action', shots: { from: 2, to: 2 } },
      ],
      keep: [],
      exclude: ['로고', '안경'],
    };
    const plan = planSheetCompile(sheet, { look: true, prop: true, scene: true }, locks);
    expect(plan).toEqual({
      elements: [{ slot: 'hair', text: '단발', ref: null }],
      style: [],
      actions: [],
      ranged: [],
      unboundRefs: [],
      replaced: ['hair'],
      keep: [],
      exclude: ['안경'],
      locks: ['the product', 'the brand logo', 'the sound', 'the wardrobe', 'the prop', 'shots 2–3'],
    });
    const open = planSheetCompile(sheet, { look: true, prop: false, scene: true });
    expect(open).not.toHaveProperty('locks');
    expect(planSheetCompile(sheet, { look: true, prop: false, scene: true }, NO_LOCKS)).toEqual(open);
  });
});

// --- 3. Compile, sheet path (flag on) -------------------------------------------------------------------------------

const LOCKED_SHEET: PersonalEditSheet = {
  change: [
    { text: 'LOCKED_OUTFIT_LINE', slot: 'outfit', ref: 'look_ref' },
    { text: '로고 지우기', slot: 'shot_action' },
    { text: '2컷 윙크', slot: 'shot_action', shots: { from: 2, to: 2 } },
    { text: '단발', slot: 'hair' },
    { text: '손 흔들기', slot: 'shot_action' },
  ],
  keep: ['앞머리'],
  exclude: ['상품 라벨', '안경'],
};

describe('template locks — compile with the edit sheet (flag on)', () => {
  it('deterministic: no locked line, the block, "except shots 2–3", product and logo exclusions, no customer photo', async () => {
    for (const medium of ['video', 'image'] as const) {
      const result = await compileDirectorPromptDetailed(
        { basePrompt: LOCKED, medium, hasOutfitRef: true, hasPropRef: true, hasSceneRef: true, directorSpec: sheetSpec(LOCKED_SHEET) },
        { env: ON },
      );
      const prompt = result.prompt;
      expect(result.path).toBe('deterministic');
      expect(prompt).toContain(CANONICAL);
      expect(prompt.split('Template locks:')).toHaveLength(2);
      for (const gone of ['LOCKED_OUTFIT_LINE', '로고 지우기', '2컷 윙크', '상품 라벨']) expect(prompt).not.toContain(gone);
      expect(prompt).toContain('단발');
      expect(prompt).toContain('- Direction in every shot except shots 2–3: 손 흔들기');
      const exclusions = prompt.slice(prompt.indexOf('[Exclusions]'), prompt.indexOf('Template locks:'));
      expect(exclusions).toContain('No replacement, restyling or removal of the product.');
      expect(exclusions).toContain('No replacement, restyling or removal of the brand logo.');
      expect(exclusions).toContain('Never show 안경.');
      // Customer reference photos are refused on a product-locked template.
      expect(prompt).not.toMatch(/uploaded [\w/]+ reference/);
      expect(prompt).not.toContain('Custom ');
    }
  });

  it('sound lock: no audio contract is appended and the template audio wording is untouched', async () => {
    const result = await compileDirectorPromptDetailed(
      { basePrompt: LOCKED, medium: 'video', directorSpec: sheetSpec(LOCKED_SHEET, { audioMode: 'bgm', bgmMood: 'cinematic' }) },
      { env: ON },
    );
    expect(result.prompt).toContain('with background music and upbeat soundtrack');
    expect(result.prompt).not.toContain('Strict No-BGM Personal Audio Rule');
    expect(result.prompt).not.toContain('Cohesive Scene BGM Audio Rule');
    // Without the sound lock the same base gets today's audio handling.
    const soundless = withBlock('Template locks:\n- Keep exactly as in the template: the brand logo.');
    const open = await compileDirectorPromptDetailed({ basePrompt: soundless, medium: 'video', directorSpec: sheetSpec(LOCKED_SHEET) }, { env: ON });
    expect(open.prompt).toContain('Strict No-BGM Personal Audio Rule');
    expect(open.prompt).not.toContain('with background music and upbeat soundtrack');
  });

  it('rewrite: no locked line in the body, templateLocks and one doctrine line, the block kept', async () => {
    const fetchMock = echoFetch();
    const result = await compileDirectorPromptDetailed(
      { basePrompt: LOCKED, medium: 'video', hasOutfitRef: true, directorSpec: sheetSpec(LOCKED_SHEET) },
      { env: ON_KEY, fetch: fetchMock as unknown as typeof fetch },
    );
    expect(result.path).toBe('rewrite');
    expect(result.prompt).toContain(CANONICAL);
    const { raw, system, payload } = wire(fetchMock);
    for (const gone of ['LOCKED_OUTFIT_LINE', '로고 지우기', '2컷 윙크', '상품 라벨']) expect(raw).not.toContain(gone);
    expect(payload.templateLocks).toEqual(CANONICAL.split('\n').slice(1));
    expect(payload.editSheet.locks).toEqual(['the product', 'the brand logo', 'the sound', 'the wardrobe', 'the prop', 'shots 2–3']);
    expect(payload.referenceSlots).toEqual([{ index: 1, slotName: 'selfie', role: 'person' }]);
    expect(payload.audioMode).toBe('ambient');
    expect(system).toMatch(/Template locks:.*unchanged.*wins over every edit/);
    expect(system.split('\n').filter((l) => /TEMPLATE LOCKS/.test(l))).toHaveLength(1);
  });

  it('rewrite: re-appends the block when the rewrite drops it and replaces an altered copy', async () => {
    for (const rewritten of [`${BODY}\n\nWardrobe: unchanged.`, `${BODY}\n\nTemplate locks:\n- Keep exactly as in the template: the product — recoloured blue.`]) {
      const fetchMock = vi.fn(async () => geminiJson(rewriteOf(rewritten)));
      const result = await compileDirectorPromptDetailed(
        { basePrompt: LOCKED, medium: 'video', directorSpec: sheetSpec(LOCKED_SHEET) },
        { env: ON_KEY, fetch: fetchMock as unknown as typeof fetch },
      );
      expect(result.path).toBe('rewrite');
      expect(result.prompt.endsWith(CANONICAL)).toBe(true);
      expect(result.prompt).not.toContain('recoloured blue');
    }
  });

  it('fallback after two failures still carries the block and drops locked lines', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => new Response('nope', { status: 500 }));
    const result = await compileDirectorPromptDetailed(
      { basePrompt: LOCKED, medium: 'video', directorSpec: sheetSpec(LOCKED_SHEET) },
      { env: ON_KEY, fetch: fetchMock as unknown as typeof fetch },
    );
    expect(result.path).toBe('deterministic_fallback');
    expect(result.prompt).toContain(CANONICAL);
    expect(result.prompt).not.toContain('LOCKED_OUTFIT_LINE');
  });

  it('a sheet with only locked content returns the base unchanged', async () => {
    const onlyLocked: PersonalEditSheet = { change: [{ text: '빨간 드레스', slot: 'outfit' }], keep: [], exclude: ['로고'] };
    for (const env of [ON, ON_KEY]) {
      const result = await compileDirectorPromptDetailed(
        { basePrompt: LOCKED, medium: 'video', hasPropRef: true, directorSpec: sheetSpec(onlyLocked, { userMessage: '자켓', audioMode: 'bgm' }) },
        { env },
      );
      expect(result).toEqual({ prompt: LOCKED, path: 'unchanged' });
    }
  });

  it('a malformed block locks everything (a keep line still stands; it changes nothing)', async () => {
    const malformed = withBlock('Template locks:\n- Keep exactly as in the template: the face.');
    const input = { basePrompt: malformed, medium: 'video' as const, hasOutfitRef: true };
    const none = await compileDirectorPromptDetailed({ ...input, directorSpec: sheetSpec({ ...LOCKED_SHEET, keep: [] }) }, { env: ON });
    expect(none).toEqual({ prompt: malformed, path: 'unchanged' });
    const kept = await compileDirectorPromptDetailed({ ...input, directorSpec: sheetSpec(LOCKED_SHEET) }, { env: ON });
    expect(kept.prompt).toContain('Template locks:\n- Keep exactly as in the template: the face.');
    for (const gone of ['LOCKED_OUTFIT_LINE', '로고 지우기', '2컷 윙크', '단발', '손 흔들기', '안경', 'Custom ']) expect(kept.prompt).not.toContain(gone);
  });
});

// --- 4. Compile, chips path (flag off) ------------------------------------------------------------------------------

describe('template locks — compile without the sheet (flag off)', () => {
  const INTENT = {
    hairOverrideEn: 'a sleek low bun',
    makeupOverrideEn: null,
    outfitOverrideEn: 'LOCKED_OUTFIT_INTENT',
    propOverrideEn: 'LOCKED_PROP_INTENT',
    shotEdits: [
      { shotIndex: 2, actionEn: 'LOCKED_SHOT_EDIT waves' },
      { shotIndex: 1, actionEn: 'turns to the window' },
    ],
    strictExclusionsEn: ['the product label', 'sunglasses'],
  };
  const SPEC: PersonalDirectorSpec = {
    audioMode: 'bgm',
    bgmMood: 'trendy_beat',
    userMessage: '머리는 단발로\n로고는 빼 줘\nLOCKED_OUTFIT_NOTE 자켓으로',
    summaryChips: [
      { slot: 'outfit', labelKo: '의상', summaryKo: 'LOCKED_CHIP' },
      { slot: 'hair', labelKo: '헤어', summaryKo: '단발' },
    ],
    structuredIntent: INTENT,
    slotOverrides: ['look_ref', 'prop_ref', 'scene_ref'],
  };

  it('lockSpec drops locked chips, overrides, shot edits, note lines, references and BGM; NO_LOCKS is identity', () => {
    const locks = parseTemplateLocks(LOCKED);
    expect(lockSpec(SPEC, NO_LOCKS)).toBe(SPEC);
    expect(lockSpec(null, locks)).toBeNull();
    expect(lockSpec(SPEC, locks)).toEqual({
      audioMode: 'ambient',
      bgmMood: null,
      userMessage: '머리는 단발로',
      summaryChips: [{ slot: 'hair', labelKo: '헤어', summaryKo: '단발' }],
      structuredIntent: {
        hairOverrideEn: 'a sleek low bun',
        makeupOverrideEn: null,
        outfitOverrideEn: null,
        propOverrideEn: null,
        shotEdits: [{ shotIndex: 1, actionEn: 'turns to the window' }],
        strictExclusionsEn: ['sunglasses'],
      },
      slotOverrides: [],
    });
  });

  it('deterministic and rewrite: locked chip, override, note line and reference never reach the prompt or the body; BGM becomes ambient as written', async () => {
    const offline = await compileDirectorPromptDetailed({ basePrompt: LOCKED, medium: 'video', hasOutfitRef: true, directorSpec: SPEC }, { env: {} });
    expect(offline.path).toBe('deterministic');
    expect(offline.prompt).toContain(CANONICAL);
    for (const gone of ['LOCKED_', '로고는 빼', 'Custom Outfit Authority', 'Cohesive Scene BGM', 'Strict No-BGM Personal Audio Rule']) expect(offline.prompt).not.toContain(gone);
    expect(offline.prompt).toContain('a sleek low bun');
    expect(offline.prompt).toContain('with background music and upbeat soundtrack');

    const fetchMock = echoFetch();
    const rewritten = await compileDirectorPromptDetailed(
      { basePrompt: LOCKED, medium: 'video', hasOutfitRef: true, directorSpec: SPEC },
      { env: OFF_KEY, fetch: fetchMock as unknown as typeof fetch },
    );
    expect(rewritten.path).toBe('rewrite');
    expect(rewritten.prompt).toContain(CANONICAL);
    const { raw, payload } = wire(fetchMock);
    expect(raw).not.toContain('LOCKED_');
    expect(payload.audioMode).toBe('ambient');
    expect(payload.bgmMood).toBeNull();
    expect(payload.userNoteRaw).toBe('머리는 단발로');
    expect(payload.referenceSlots).toEqual([{ index: 1, slotName: 'selfie', role: 'person' }]);
    expect(payload.templateLocks).toEqual(CANONICAL.split('\n').slice(1));
    expect(payload).not.toHaveProperty('editSheet');
  });

  it('a spec with only locked content returns the base unchanged', async () => {
    const onlyLocked: PersonalDirectorSpec = {
      audioMode: 'bgm',
      userMessage: '로고 빼 줘',
      summaryChips: [{ slot: 'outfit', labelKo: '의상', summaryKo: '자켓' }],
      structuredIntent: { hairOverrideEn: null, makeupOverrideEn: null, outfitOverrideEn: 'a jacket', propOverrideEn: null, shotEdits: [], strictExclusionsEn: [] },
      slotOverrides: ['look_ref'],
    };
    for (const env of [{}, OFF_KEY]) {
      for (const medium of ['video', 'image'] as const) {
        const result = await compileDirectorPromptDetailed({ basePrompt: LOCKED, medium, hasOutfitRef: true, hasSceneRef: true, directorSpec: onlyLocked }, { env });
        expect(result).toEqual({ prompt: LOCKED, path: 'unchanged' });
      }
    }
  });
});

// --- 5. lockChipsTurn -----------------------------------------------------------------------------------------------

describe('lockChipsTurn', () => {
  const locks = parseTemplateLocks(LOCKED);
  const TURN: DirectorChatTurnResult = {
    approved: true,
    refusal: 'none',
    replyKo: '바꿨어요.',
    guardrailAdjustmentKo: null,
    readyToRender: true,
    summaryChips: [
      { slot: 'outfit', labelKo: '의상', summaryKo: '자켓' },
      { slot: 'hair', labelKo: '헤어', summaryKo: '단발' },
    ],
    structuredIntent: { hairOverrideEn: 'a bob', makeupOverrideEn: null, outfitOverrideEn: 'a jacket', propOverrideEn: null, shotEdits: [], strictExclusionsEn: [] },
  };

  it('drops locked chips and overrides and marks the hit', () => {
    expect(lockChipsTurn(TURN, locks)).toEqual({
      ...TURN,
      summaryChips: [{ slot: 'hair', labelKo: '헤어', summaryKo: '단발' }],
      structuredIntent: { ...TURN.structuredIntent!, outfitOverrideEn: null },
      lockedHit: true,
    });
  });

  it('refuses as unsupported when nothing is left, keeping the reply', () => {
    const only = { ...TURN, summaryChips: [TURN.summaryChips[0]!], structuredIntent: { ...TURN.structuredIntent!, hairOverrideEn: null } };
    expect(lockChipsTurn(only, locks)).toEqual({
      ...only,
      approved: false,
      refusal: 'unsupported',
      readyToRender: false,
      summaryChips: [],
      structuredIntent: null,
      lockedHit: true,
    });
  });

  it('returns the turn itself when nothing is locked, it was refused, or there are no locks', () => {
    const open = { ...TURN, summaryChips: [TURN.summaryChips[1]!], structuredIntent: { ...TURN.structuredIntent!, outfitOverrideEn: null } };
    expect(lockChipsTurn(open, locks)).toBe(open);
    const refused = { ...TURN, approved: false, refusal: 'unsafe' as const };
    expect(lockChipsTurn(refused, locks)).toBe(refused);
    expect(lockChipsTurn(TURN, NO_LOCKS)).toBe(TURN);
  });
});

// --- Stage 1 with locks -------------------------------------------------------------------------------------------

describe('template locks — Stage 1 sheet turns', () => {
  const locks = parseTemplateLocks(LOCKED);
  const TURN: DirectorChatTurnInput = {
    templateId: 'tpl-1',
    templateSummaryKo: '1컷: 세럼을 든다. 2컷: 병 클로즈업.',
    editableSlots: editableSlotsFor(locks),
    userMessage: '드레스로 바꾸고 단발로 해 줘',
    sheetState: state({ change: [], keep: [], exclude: [] }),
    locks,
  };

  it('model turn: lockedParts and one system line, locked lines dropped, lockedHit in the client projection', async () => {
    const fetchMock = vi.fn(async () =>
      geminiJson({
        approved: true,
        refusal: 'none',
        replyKo: '바꿨어요.',
        guardrailAdjustmentKo: null,
        set: [
          { text: '빨간 드레스', slot: 'outfit' },
          { text: '단발', slot: 'hair' },
        ],
        remove: [],
        revert: [],
        keep: [],
        exclude: ['로고'],
        question: null,
      }),
    );
    const director = createFlashTemplateDirector(CONFIG, { fetch: fetchMock as unknown as typeof fetch });
    const res = await director.runChatTurn(TURN);
    const { system, payload } = wire(fetchMock);
    expect(payload.lockedParts).toEqual(['the product', 'the brand logo', 'the sound', 'the wardrobe', 'the prop', 'shots 2–3']);
    expect(system.split('\n').filter((l) => l.includes('lockedParts'))).toHaveLength(1);
    expect(res.sheet!.change).toEqual([{ text: '단발', slot: 'hair' }]);
    expect(res.sheet!.exclude).toEqual([]);
    expect(res.lockedHit).toBe(true);
    expect(toClientDirectorTurnResponse(res).lockedHit).toBe(true);

    const clean = vi.fn(async () =>
      geminiJson({ approved: true, refusal: 'none', replyKo: '바꿨어요.', guardrailAdjustmentKo: null, set: [{ text: '단발', slot: 'hair' }], remove: [], revert: [], keep: [], exclude: [], question: null }),
    );
    const ok = await createFlashTemplateDirector(CONFIG, { fetch: clean as unknown as typeof fetch }).runChatTurn(TURN);
    expect(ok).not.toHaveProperty('lockedHit');
    expect(toClientDirectorTurnResponse(ok)).not.toHaveProperty('lockedHit');
  });

  it('heuristic turn: a locked request and a closed photo report the hit', () => {
    const res = runHeuristicDirectorTurn({ ...TURN, userMessage: '빨간 드레스로', editableSlots: DIRECTOR_EDITABLE_SLOTS });
    expect(res.sheet!.change).toEqual([]);
    expect(res.lockedHit).toBe(true);
    const photo = runHeuristicDirectorTurn({
      ...TURN,
      userMessage: '단발로',
      references: [{ slotName: 'scene_ref', role: 'scene', bytes: new Uint8Array([1]), mime: 'image/jpeg' }],
    });
    expect(photo.sheet!.change).toEqual([{ text: '단발로', slot: 'hair' }]);
    expect(photo.lockedHit).toBe(true);
    const open = runHeuristicDirectorTurn({ ...TURN, userMessage: '단발로' });
    expect(open).not.toHaveProperty('lockedHit');
  });

  it('chips turn (no sheet) is unchanged by locks in C1', () => {
    const { sheetState: _omit, ...chipsTurn } = TURN;
    const withLocks = runHeuristicDirectorTurn({ ...chipsTurn, userMessage: '빨간 드레스로' });
    const without = runHeuristicDirectorTurn({ ...chipsTurn, locks: undefined, userMessage: '빨간 드레스로' });
    expect(withLocks).toEqual(without);
  });
});

// The no-locks wording of the customization header is untouched.
it('keeps the customization header text', () => {
  expect(USER_CUSTOMIZATION_HEADER_EN).toMatch(/^User customization/);
});
