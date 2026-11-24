import { afterEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { readSheetTurnAnswer } from '@/components/twings/edit-sheet-card';
import {
  DIRECTOR_EDITABLE_SLOTS,
  GEMINI_DIRECTOR_DEFAULT_MODEL,
  NO_LOCKS,
  STAGE1_CHIPS_RESPONSE_SCHEMA,
  STAGE2_REWRITE_RESPONSE_SCHEMA,
  applyDeterministicDirectorSpec,
  compileDirectorPromptDetailed,
  createFlashTemplateDirector,
  editableSlotsFor,
  lockedAskCount,
  negatedAt,
  parseTemplateLocks,
  rawStage1ChatSchema,
  rawStage1SheetSchema,
  rawStage2RewriteSchema,
  renderLockBlock,
  sanitizeRewrittenPrompt,
  toClientDirectorTurnResponse,
  verifyRewrittenPrompt,
  type DirectorChatTurnInput,
  type DirectorRewriteInput,
  type PersonalDirectorSpec,
  type PersonalEditSheet,
  type PersonalSheetState,
} from '@/lib/template-director';

/**
 * The live check of 2026-11-24 (real gemini-4-hydrogen, code at 0061eb02): Stage 2 never parsed (the model answered
 * `{"prompt": …}`), a chips turn did not parse, a negated makeup term was turned into its opposite, a locked request
 * reached the screen as "can't change this scene", and a locked shot kept the old wardrobe.
 */

const CONFIG = { apiKey: 'fake-gemini-key', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: GEMINI_DIRECTOR_DEFAULT_MODEL };
const ON_KEY = { TWINGS_PERSONAL_EDIT_SHEET: 'on', GEMINI_API_KEY: 'fake-gemini-key' } as const;

function geminiJson(payload: unknown) {
  return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(payload) }] } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

type Wire = { system: string; schema: unknown; payload: Record<string, unknown> };
function wire(fetchMock: { mock: { calls: unknown[][] } }, call = 0): Wire {
  const body = JSON.parse(String((fetchMock.mock.calls[call]![1] as RequestInit).body)) as {
    systemInstruction: { parts: Array<{ text: string }> };
    contents: Array<{ parts: Array<{ text: string }> }>;
    generationConfig: { responseJsonSchema?: unknown };
  };
  return {
    system: body.systemInstruction.parts[0]!.text,
    schema: body.generationConfig.responseJsonSchema,
    payload: JSON.parse(body.contents[0]!.parts[0]!.text) as Record<string, unknown>,
  };
}

afterEach(() => vi.restoreAllMocks());

const BASE = `Reference authority:
- @Image 1 supplies ONLY the protagonist's facial identity and hairstyle.

Timeline:
[Shot 1 - Counter, 0.0-3.0s]:
- @Image 1 in an ivory linen shirt picks up the serum bottle. Hard cut.
[Shot 2 - Close-up, 3.0-6.0s]:
- The bottle turns slowly in hand, logo to camera, the ivory linen shirt cuff in frame. Hard cut.
[Shot 3 - Mirror, 6.0-10.0s]:
- @Image 1 in the ivory linen shirt smiles at the mirror.

[Exclusions]
No watermarks.`;

const BLOCK = renderLockBlock([{ kind: 'product' }, { kind: 'slot', slot: 'hair' }, { kind: 'shots', from: 2, to: 2 }]);
const LOCKED = `${BASE}\n\n${BLOCK}`;

// --- A. Output contracts ------------------------------------------------------------------------------------------

/** The zod schema's definition, for walking it (zod 4). */
type Def = { type: string; innerType?: z.ZodType; in?: z.ZodType; out?: z.ZodType; element?: z.ZodType; shape?: Record<string, z.ZodType> };
const defOf = (schema: z.ZodType): Def => (schema as unknown as { _zod: { def: Def } })._zod.def;

/** The object (or array element object) a field holds, through optional/nullable/default/catch/pipe wrappers. */
function core(schema: z.ZodType): z.ZodType {
  const def = defOf(schema);
  if (['optional', 'nullable', 'default', 'catch', 'readonly', 'prefault', 'nonoptional'].includes(def.type)) return core(def.innerType!);
  if (def.type === 'pipe') return defOf(def.in!).type === 'transform' ? core(def.out!) : core(def.in!);
  if (def.type === 'array') return core(def.element!);
  return schema;
}

/** Every key of the wire shape a schema parses, nested objects included; `required` = absent fails the parse. */
function wireKeys(schema: z.ZodType): Array<{ key: string; required: boolean }> {
  const obj = core(schema);
  const def = defOf(obj);
  if (def.type !== 'object' || !def.shape) return [];
  return Object.entries(def.shape).flatMap(([key, field]) => [{ key, required: !field.safeParse(undefined).success }, ...wireKeys(field)]);
}

const named = (system: string, key: string): boolean => system.includes(`"${key}"`);

const REWRITE_OK = {
  rewrittenPrompt: `${BASE}\n\nWardrobe: a white cotton shirt in every shot.`,
  preservedCameraAndLighting: true,
  preservedAudioRule: true,
  preservedIdentityStrictLock: true,
};

const INTENT: NonNullable<PersonalDirectorSpec['structuredIntent']> & DirectorRewriteInput['structuredIntent'] = {
  hairOverrideEn: null,
  makeupOverrideEn: null,
  outfitOverrideEn: 'a white cotton shirt',
  propOverrideEn: null,
  shotEdits: [],
  strictExclusionsEn: [],
};

const SHEET: PersonalEditSheet = { change: [{ text: '흰 셔츠', slot: 'outfit' }], keep: [], exclude: [] };
const sheetSpec = (sheet: PersonalEditSheet): PersonalDirectorSpec => ({ audioMode: 'ambient', sheet });

async function stage2System(input: Parameters<typeof compileDirectorPromptDetailed>[0]): Promise<Wire> {
  const fetchMock = vi.fn(async () => geminiJson(REWRITE_OK));
  const result = await compileDirectorPromptDetailed(input, { env: ON_KEY, fetch: fetchMock as unknown as typeof fetch });
  expect(result.path).toBe('rewrite');
  return wire(fetchMock);
}

describe('A. every key the parser needs is named in the instruction that is sent', () => {
  it('Stage 2: chips, sheet and locked variants name all four keys, last line, with the response schema', async () => {
    const keys = wireKeys(rawStage2RewriteSchema);
    expect(keys.map((k) => k.key)).toEqual(['rewrittenPrompt', 'preservedCameraAndLighting', 'preservedAudioRule', 'preservedIdentityStrictLock']);
    expect(keys.every((k) => k.required)).toBe(true);
    const variants = [
      await stage2System({ basePrompt: BASE, medium: 'video', directorSpec: { audioMode: 'ambient', structuredIntent: INTENT } }),
      await stage2System({ basePrompt: BASE, medium: 'video', directorSpec: sheetSpec(SHEET) }),
      await stage2System({ basePrompt: LOCKED, medium: 'video', directorSpec: sheetSpec(SHEET) }),
    ];
    for (const { system, schema } of variants) {
      for (const { key } of keys) expect(named(system, key), key).toBe(true);
      expect(system.split('\n').at(-1)).toMatch(/^OUTPUT: Return only one JSON object/);
      expect(schema).toEqual(STAGE2_REWRITE_RESPONSE_SCHEMA);
    }
  });

  it('Stage 2 response schema: same keys as the parser, all four required', () => {
    const keys = wireKeys(rawStage2RewriteSchema);
    expect(Object.keys(STAGE2_REWRITE_RESPONSE_SCHEMA.properties)).toEqual(keys.map((k) => k.key));
    expect([...STAGE2_REWRITE_RESPONSE_SCHEMA.required]).toEqual(keys.filter((k) => k.required).map((k) => k.key));
  });

  it('chips turn: every key, nested ones too, is named; the response schema has the same keys', async () => {
    const keys = wireKeys(rawStage1ChatSchema);
    expect(keys.filter((k) => k.required).map((k) => k.key)).toEqual(
      expect.arrayContaining(['approved', 'refusal', 'replyKo', 'guardrailAdjustmentKo', 'readyToRender', 'summaryChips', 'structuredIntent', 'shotIndex', 'actionEn']),
    );
    const fetchMock = vi.fn(async () =>
      geminiJson({ approved: true, refusal: 'none', replyKo: '반영했어요.', guardrailAdjustmentKo: null, readyToRender: true, summaryChips: [], structuredIntent: null }),
    );
    await createFlashTemplateDirector(CONFIG, { fetch: fetchMock as unknown as typeof fetch }).runChatTurn({
      templateId: 'tpl',
      templateSummaryKo: '1컷: 카운터. 2컷: 병 클로즈업.',
      editableSlots: DIRECTOR_EDITABLE_SLOTS,
      userMessage: '흰 셔츠로 바꿔 줘',
    });
    const { system, schema } = wire(fetchMock);
    for (const { key } of keys) expect(named(system, key), key).toBe(true);
    expect(schema).toEqual(STAGE1_CHIPS_RESPONSE_SCHEMA);
    const top = STAGE1_CHIPS_RESPONSE_SCHEMA;
    expect(Object.keys(top.properties).sort()).toEqual(Object.keys(rawStage1ChatSchema.shape).sort());
    for (const k of keys.filter((x) => x.required && x.key in top.properties)) expect(top.required as readonly string[]).toContain(k.key);
    expect(Object.keys(top.properties.structuredIntent.properties).sort()).toEqual(
      ['hairOverrideEn', 'makeupOverrideEn', 'outfitOverrideEn', 'propOverrideEn', 'shotEdits', 'strictExclusionsEn'].sort(),
    );
  });

  it('sheet turn: every required key is named in ko and en; with locks every key, lockedAsked included', async () => {
    const keys = wireKeys(rawStage1SheetSchema);
    const required = keys.filter((k) => k.required).map((k) => k.key);
    expect(required).toEqual(expect.arrayContaining(['approved', 'refusal', 'replyKo']));
    const reading = { approved: true, refusal: 'none', replyKo: '담았어요.', set: [], remove: [], revert: [], keep: [], exclude: [], question: null };
    const empty: PersonalSheetState = { sheet: { change: [], keep: [], exclude: [] }, turns: [], question: null, asked: false };
    const turn = (extra: Partial<DirectorChatTurnInput>): DirectorChatTurnInput => ({
      templateId: 'tpl',
      templateSummaryKo: '요약',
      editableSlots: DIRECTOR_EDITABLE_SLOTS,
      userMessage: '흰 셔츠로',
      sheetState: empty,
      ...extra,
    });
    for (const extra of [{ locale: 'ko' as const }, { locale: 'en' as const }]) {
      const fetchMock = vi.fn(async () => geminiJson(reading));
      await createFlashTemplateDirector(CONFIG, { fetch: fetchMock as unknown as typeof fetch }).runChatTurn(turn(extra));
      const { system, schema } = wire(fetchMock);
      for (const key of required) expect(named(system, key), key).toBe(true);
      expect(named(system, 'lockedAsked')).toBe(false);
      expect(schema).toBeUndefined();
    }
    const locks = parseTemplateLocks(LOCKED);
    const fetchMock = vi.fn(async () => geminiJson(reading));
    await createFlashTemplateDirector(CONFIG, { fetch: fetchMock as unknown as typeof fetch }).runChatTurn(turn({ locks, editableSlots: editableSlotsFor(locks) }));
    const { system } = wire(fetchMock);
    for (const { key } of keys.filter((k) => !['point', 'text', 'options'].includes(k.key))) expect(named(system, key), key).toBe(true);
  });

  it('the parser stays strict: `{"prompt": …}` and a missing attestation still fail, twice, to the fallback', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const reply of [{ prompt: REWRITE_OK.rewrittenPrompt }, { ...REWRITE_OK, preservedAudioRule: undefined }]) {
      const fetchMock = vi.fn(async () => geminiJson(reply));
      const result = await compileDirectorPromptDetailed(
        { basePrompt: BASE, medium: 'video', directorSpec: sheetSpec(SHEET) },
        { env: ON_KEY, fetch: fetchMock as unknown as typeof fetch },
      );
      expect(result.path).toBe('deterministic_fallback');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('a rewrite that collapses a multi-line base onto one line is refused (retried, then the fallback)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const flat = { ...REWRITE_OK, rewrittenPrompt: REWRITE_OK.rewrittenPrompt.replace(/\n+/g, ' ') };
    const fetchMock = vi.fn(async () => geminiJson(flat));
    const result = await compileDirectorPromptDetailed(
      { basePrompt: BASE, medium: 'video', directorSpec: sheetSpec(SHEET) },
      { env: ON_KEY, fetch: fetchMock as unknown as typeof fetch },
    );
    expect(result.path).toBe('deterministic_fallback');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // A one-line base may come back on one line.
    const oneLine = vi.fn(async () => geminiJson({ ...flat, rewrittenPrompt: `A night street arrival following @Image 1 in a white cotton shirt, tracking.` }));
    const ok = await compileDirectorPromptDetailed(
      { basePrompt: 'A night street arrival following @Image 1 in sharp three-quarter tracking motion.', medium: 'video', directorSpec: sheetSpec(SHEET) },
      { env: ON_KEY, fetch: oneLine as unknown as typeof fetch },
    );
    expect(ok.path).toBe('rewrite');
  });

  it('the doctrine names no banned makeup term any more', async () => {
    const { system } = await stage2System({ basePrompt: BASE, medium: 'video', directorSpec: sheetSpec(SHEET) });
    expect(system).not.toMatch(/pink eyeshadow|pink blush|heavy blush|visible blush|rosy cheeks|pink makeup|glossy pink lips/i);
  });
});

// --- B. The makeup sanitizer and check agree on negations ---------------------------------------------------------

describe('B. a negated banned makeup term is never turned into its opposite', () => {
  const wrap = (sentence: string) => `[Shot 1 - Mirror, 0.0-4.0s]:\n- @Image 1 smiles at the mirror. ${sentence}`;

  it.each([
    ['Keep skin warm and natural (zero pink blush/pink eyeshadow, zero moles).', 'pink eyeshadow'],
    ['Natural daily makeup with no heavy smoky makeup, pink blush, or pink eyeshadow.', 'pink eyeshadow'],
    ['Never apply pink eyeshadow or glossy pink lips.', 'glossy pink lips'],
    ['Makeup stays clean, without rosy cheeks.', 'rosy cheeks'],
    ['Do not add heavy blush.', 'heavy blush'],
  ])('leaves "%s" as written and the check passes', (sentence, term) => {
    const out = sanitizeRewrittenPrompt(wrap(sentence), true, 'solo');
    expect(out).toContain(term);
    expect(out).not.toMatch(/(?:zero|no|never|without|not)\b[^.]*natural lip colour/i);
    expect(verifyRewrittenPrompt(out)).toEqual({ ok: true });
  });

  it('a term in the [Exclusions] section is negated too', () => {
    const out = sanitizeRewrittenPrompt(`${wrap('She smiles.')}\n\n[Exclusions]\nWatermarks, pink eyeshadow, text.`, true, 'solo');
    expect(out).toContain('Watermarks, pink eyeshadow, text.');
    expect(verifyRewrittenPrompt(out).ok).toBe(true);
  });

  it.each([
    ['She wears soft pink eyeshadow.', 'pink eyeshadow'],
    ['No hesitation: glossy pink lips and rosy cheeks.', 'glossy pink lips'],
    ['She does not smile, wearing pink eyeshadow.', 'pink eyeshadow'],
    ['No hat, only pink eyeshadow.', 'pink eyeshadow'],
    ['Zero props, she wears heavy blush.', 'heavy blush'],
  ])('still rewrites a term that asks for the look: "%s"', (sentence, term) => {
    const out = sanitizeRewrittenPrompt(wrap(sentence), true, 'solo');
    expect(out).not.toContain(term);
    expect(out).toContain('natural lip colour');
    expect(verifyRewrittenPrompt(out).ok).toBe(true);
    // Unsanitized, the check refuses it.
    expect(verifyRewrittenPrompt(`${wrap(sentence)} ${'x'.repeat(40)}`)).toMatchObject({ ok: false, reason: expect.stringMatching(/^banned_pink_makeup:/) });
  });

  it('negatedAt reads clauses, not the whole line', () => {
    const text = 'No watermarks. She wears pink eyeshadow.';
    expect(negatedAt(text, text.indexOf('pink'))).toBe(false);
    const listed = 'zero pink blush/pink eyeshadow';
    expect(negatedAt(listed, listed.lastIndexOf('pink'))).toBe(true);
  });
});

// --- C. A locked request reaches the screen ----------------------------------------------------------------------

describe('C. locked requests: the model reports them, the server counts them', () => {
  const locks = parseTemplateLocks(LOCKED);
  const empty: PersonalSheetState = { sheet: { change: [], keep: [], exclude: [] }, turns: [], question: null, asked: false };
  const TURN: DirectorChatTurnInput = {
    templateId: 'tpl',
    templateSummaryKo: '1컷: 세럼을 든다. 2컷: 병 클로즈업. 3컷: 거울.',
    editableSlots: editableSlotsFor(locks),
    userMessage: '제품을 향수로 바꿔 줘',
    sheetState: empty,
    locks,
    locale: 'ko',
  };
  const reading = (extra: Record<string, unknown>) => ({
    approved: true,
    refusal: 'none',
    replyKo: '제품은 템플릿 그대로 둬요.',
    guardrailAdjustmentKo: null,
    set: [],
    remove: [],
    revert: [],
    keep: [],
    exclude: [],
    question: null,
    ...extra,
  });
  async function run(extra: Record<string, unknown>, input: DirectorChatTurnInput = TURN) {
    const fetchMock = vi.fn(async () => geminiJson(reading(extra)));
    const res = await createFlashTemplateDirector(CONFIG, { fetch: fetchMock as unknown as typeof fetch }).runChatTurn(input);
    const client = toClientDirectorTurnResponse(res);
    const screen = readSheetTurnAnswer({ prior: empty, message: input.userMessage, status: 200, payload: { ok: true, turn: client }, locale: 'ko' });
    return { res, client, screen, system: wire(fetchMock).system };
  }

  it('the locked line asks for lockedAsked and the styling exception, in one line', async () => {
    const { system } = await run({ lockedAsked: ['the product'] });
    const lines = system.split('\n').filter((l) => l.includes('lockedParts'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"lockedAsked":[string]');
    expect(lines[0]).toMatch(/not a request about a locked shot unless that part itself is in lockedParts/);
  });

  it('only-locked request: sheet unchanged, lockedHit, "that part is fixed"', async () => {
    const { res, client, screen } = await run({ lockedAsked: ['the product'] });
    expect(res.sheet).toEqual(empty.sheet);
    expect(res.changed).toBe(false);
    expect(client.lockedHit).toBe(true);
    expect(screen.notice).toEqual({ key: 'refusedLocked' });
  });

  it('only-locked request answered as a refusal: still "that part is fixed"', async () => {
    const { client, screen } = await run({ approved: false, refusal: 'unsupported', lockedAsked: ['the product'] });
    expect(client.lockedHit).toBe(true);
    expect(screen.notice).toEqual({ key: 'refusedLocked' });
  });

  it('mixed request: the allowed part lands, lockedHit, and the screen says both (added; fixed part stays)', async () => {
    const { res, client, screen } = await run(
      { set: [{ text: '흰 셔츠', slot: 'outfit' }], lockedAsked: ['the product'] },
      { ...TURN, userMessage: '제품은 향수로, 옷은 흰 셔츠로' },
    );
    expect(res.sheet!.change).toEqual([{ text: '흰 셔츠', slot: 'outfit' }]);
    expect(client.lockedHit).toBe(true);
    expect(screen.notice).toEqual({ key: 'updatedLocked' });
    expect(screen.state.sheet.change).toEqual([{ text: '흰 셔츠', slot: 'outfit' }]);
  });

  it('allowed request: no lockedHit, "added"', async () => {
    const { client, screen } = await run({ set: [{ text: '흰 셔츠', slot: 'outfit' }], lockedAsked: [] }, { ...TURN, userMessage: '옷은 흰 셔츠로' });
    expect(client).not.toHaveProperty('lockedHit');
    expect(screen.notice).toEqual({ key: 'updated' });
  });

  it('a line the model writes for a locked part anyway is still dropped by the keyword backstop', async () => {
    const { res, client } = await run({ set: [{ text: '제품을 향수로', slot: 'shot_action' }] });
    expect(res.sheet!.change).toEqual([]);
    expect(client.lockedHit).toBe(true);
  });

  it('lockedAskCount: only entries that name a real lock count; nothing without locks', () => {
    expect(lockedAskCount(['the product'], locks)).toBe(1);
    expect(lockedAskCount(['Product', 'The Hairstyle', 'shot 2', 'shots 2-2'], locks)).toBe(4);
    expect(lockedAskCount(['the wardrobe', 'shot 3', '', 'the weather'], locks)).toBe(0);
    expect(lockedAskCount(['the product'], NO_LOCKS)).toBe(0);
  });

  it('without locks a stray lockedAsked changes nothing', async () => {
    const { locks: _drop, ...open } = TURN;
    const { client } = await run({ set: [{ text: '흰 셔츠', slot: 'outfit' }], lockedAsked: ['the product'] }, { ...open, editableSlots: DIRECTOR_EDITABLE_SLOTS });
    expect(client).not.toHaveProperty('lockedHit');
  });
});

// --- D. A locked shot follows the customer's styling ---------------------------------------------------------------

describe('D. a styling change reaches the locked shots; the rest of a locked shot stays', () => {
  it('Stage 2 lock line states the rule', async () => {
    const { system } = await stage2System({ basePrompt: LOCKED, medium: 'video', directorSpec: sheetSpec(SHEET) });
    const line = system.split('\n').find((l) => l.startsWith('TEMPLATE LOCKS:'))!;
    expect(line).toMatch(/Template locks:.*unchanged.*wins over every edit/);
    expect(line).toContain('applies to the person in EVERY shot, locked shots included');
    expect(line).toContain('leave every other word of the shot as written');
  });

  it('deterministic sheet compile names the locked shot in the wardrobe line; without locks the line is as before', () => {
    const locked = applyDeterministicDirectorSpec({ basePrompt: LOCKED, medium: 'video', directorSpec: sheetSpec(SHEET) }, { env: { TWINGS_PERSONAL_EDIT_SHEET: 'on' } });
    expect(locked).toContain("- Wardrobe in every shot it appears (shot 2 included; that shot keeps everything else as written), replacing the template's wardrobe wording: 흰 셔츠");
    expect(locked).toContain(BLOCK);
    const open = applyDeterministicDirectorSpec({ basePrompt: BASE, medium: 'video', directorSpec: sheetSpec(SHEET) }, { env: { TWINGS_PERSONAL_EDIT_SHEET: 'on' } });
    expect(open).toContain("- Wardrobe in every shot it appears, replacing the template's wardrobe wording: 흰 셔츠");
  });

  it('deterministic chips compile adds the same rule only with locked shots', () => {
    const spec: PersonalDirectorSpec = { audioMode: 'ambient', structuredIntent: INTENT };
    const locked = applyDeterministicDirectorSpec({ basePrompt: LOCKED, medium: 'video', directorSpec: spec }, { env: {} });
    expect(locked).toContain('- The wardrobe above also applies in shot 2; everything else there stays as written.');
    const open = applyDeterministicDirectorSpec({ basePrompt: BASE, medium: 'video', directorSpec: spec }, { env: {} });
    expect(open).not.toContain('also applies in');
  });
});
