import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STAGE2_OUTPUT_CONTRACT_LINE,
  STAGE2_TEMPLATE_STYLING_LINE,
  applyDeterministicDirectorSpec,
  compileDirectorPromptDetailed,
  createFlashTemplateDirector,
  ensureOwnStyle,
  ownStyleRuleEn,
  parseTemplateStyling,
  renderLockBlock,
  sanitizeRewrittenPrompt,
  unwrapServerOnlyPrompt,
  GEMINI_DIRECTOR_DEFAULT_MODEL,
  type PersonalDirectorSpec,
  type PersonalEditSheet,
} from '@/lib/template-director';

/**
 * docs/PERSONAL-STUDIO.md §3.4.9 (S1, test 4) — the compile of a template whose `Template styling:` block styles hair
 * and makeup: the buyer's `own` choice, lock wins, explicit request wins, and the rewrite told to keep the template's
 * style for every other styled part. Edit-sheet flag on and off; no key, a key, a failing key.
 */

afterEach(() => vi.restoreAllMocks());

const STYLED_HAIR = '- Styled by the template: the hairstyle — a sleek low bun.';
const STYLED_MAKEUP = '- Styled by the template: the makeup — 1990s smoky plum eyes and lips.';
const PHOTO_HAIR = '- Taken from the photo: the hairstyle.';
const STYLING = ['Template styling:', STYLED_HAIR, STYLED_MAKEUP].join('\n');
const OWN_HAIR_BLOCK = ['Template styling:', PHOTO_HAIR, STYLED_MAKEUP].join('\n');

const BODY = `Reference authority:
- @Image 1 supplies ONLY the protagonist's facial identity.

Timeline:
[Shot 1 - Booth, 0.0-3.0s]:
- @Image 1, hair in a sleek low bun, 1990s smoky plum eyes and lips, sits in a phone booth. Hard cut.
[Shot 2 - Street, 3.0-6.0s]:
- @Image 1 with the sleek low bun walks out under neon light. Hard cut.
[Shot 3 - Close-up, 6.0-9.0s]:
- Close-up of @Image 1, smoky plum eyes and the low bun, smiling at the lens.

[Exclusions]
No watermarks.`;

const STYLED_BASE = `${BODY}\n\n${STYLING}`;
const SHOT_LOCKS = renderLockBlock([{ kind: 'shots', from: 2, to: 2 }]);
const HAIR_LOCK = renderLockBlock([{ kind: 'slot', slot: 'hair' }]);

const HAIR_RULE = ownStyleRuleEn('hair', { medium: 'video' });
const MAKEUP_RULE = ownStyleRuleEn('makeup', { medium: 'video' });
const HAIR_EXCLUSION = "Never show the template's hairstyle (a sleek low bun).";

const OFF = {} as const;
const ON = { TWINGS_PERSONAL_EDIT_SHEET: 'on' } as const;
const KEY = { GEMINI_API_KEY: 'fake-gemini-key' } as const;
const FLAGS = { off: OFF, on: ON } as const;

function geminiJson(payload: unknown) {
  return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(payload) }] } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** A rewrite that echoes the base it was sent and adds a line. */
function echoRewrite(extra = 'Wardrobe: a white cotton shirt in every shot.') {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { contents: Array<{ parts: Array<{ text: string }> }> };
    const payload = JSON.parse(body.contents[0]!.parts[0]!.text) as { basePrompt: string };
    return geminiJson({
      rewrittenPrompt: `${payload.basePrompt}\n\n${extra}`,
      preservedCameraAndLighting: true,
      preservedAudioRule: true,
      preservedIdentityStrictLock: true,
    });
  });
}

type Wire = { system: string; payload: Record<string, unknown> };
function wire(fetchMock: { mock: { calls: unknown[][] } }, call = 0): Wire {
  const body = JSON.parse(String((fetchMock.mock.calls[call]![1] as RequestInit).body)) as {
    systemInstruction: { parts: Array<{ text: string }> };
    contents: Array<{ parts: Array<{ text: string }> }>;
  };
  return { system: body.systemInstruction.parts[0]!.text, payload: JSON.parse(body.contents[0]!.parts[0]!.text) as Record<string, unknown> };
}

const spec = (extra: Partial<PersonalDirectorSpec>): PersonalDirectorSpec => ({ audioMode: 'ambient', ...extra }) as PersonalDirectorSpec;
const OWN_HAIR = spec({ own: ['hair'] });
const OUTFIT_CHIP = { slot: 'outfit' as const, labelKo: '의상', summaryKo: '흰 셔츠' };
const OUTFIT_SHEET: PersonalEditSheet = { change: [{ text: '흰 셔츠', slot: 'outfit' }], keep: [], exclude: [] };

async function compile(basePrompt: string, directorSpec: PersonalDirectorSpec | null, env: Record<string, string>, extra: Record<string, unknown> = {}) {
  return compileDirectorPromptDetailed({ basePrompt, medium: 'video', directorSpec, ...extra }, { env });
}

async function rewrite(basePrompt: string, directorSpec: PersonalDirectorSpec | null, env: Record<string, string>, extra: Record<string, unknown> = {}) {
  const fetchMock = echoRewrite();
  const result = await compileDirectorPromptDetailed({ basePrompt, medium: 'video', directorSpec, ...extra }, { env: { ...env, ...KEY }, fetch: fetchMock as unknown as typeof fetch });
  return { result, fetchMock, wire: fetchMock.mock.calls.length > 0 ? wire(fetchMock) : null };
}

/** The deterministic result's checks for `own: ['hair']`. */
function expectOwnHair(prompt: string) {
  expect(prompt).toContain(HAIR_RULE);
  expect(prompt).toContain(HAIR_EXCLUSION);
  expect(prompt).toContain(OWN_HAIR_BLOCK);
  expect(prompt).not.toContain(STYLED_HAIR);
  // Makeup stays as the template styles it.
  expect(prompt).toContain(STYLED_MAKEUP);
  expect(prompt).not.toContain(MAKEUP_RULE);
}

describe("own: ['hair'] alone", () => {
  it.each(Object.entries(FLAGS))('flag %s, no key: not unchanged; authority line, tailed exclusion, no styled hair line', async (_flag, env) => {
    const result = await compile(STYLED_BASE, OWN_HAIR, env);
    expect(result.path).toBe('deterministic');
    expectOwnHair(result.prompt);
    expect(result.prompt).toContain(`- Hair: ${HAIR_RULE}`);
    // The tailed exclusion lands in the template's own [Exclusions] section.
    expect(result.prompt).toMatch(/\[Exclusions\]\nNo watermarks\.\nNever show the template's hairstyle \(a sleek low bun\)\./);
    expect(applyDeterministicDirectorSpec({ basePrompt: STYLED_BASE, medium: 'video', directorSpec: OWN_HAIR }, { env })).toBe(result.prompt);
  });

  it.each(Object.entries(FLAGS))('flag %s, key: reaches the rewrite with use "own" and the photo-form block', async (_flag, env) => {
    const { result, wire: sent } = await rewrite(STYLED_BASE, OWN_HAIR, env);
    expect(result.path).toBe('rewrite');
    expect(sent!.payload.templateStyling).toEqual([
      { part: 'hair', use: 'own', line: STYLED_HAIR },
      { part: 'makeup', use: 'template', line: STYLED_MAKEUP },
    ]);
    expect(sent!.payload.basePrompt).toBe(`${BODY}\n\n${OWN_HAIR_BLOCK}`);
    const intent = sent!.payload.structuredIntent as { hairOverrideEn: string; makeupOverrideEn: string | null; strictExclusionsEn: string[] };
    expect(intent.hairOverrideEn).toBe(HAIR_RULE);
    expect(intent.makeupOverrideEn).toBeNull();
    expect(intent.strictExclusionsEn).toEqual(["the template's hairstyle (a sleek low bun)"]);
    const lines = sent!.system.split('\n');
    expect(lines.at(-1)).toBe(STAGE2_OUTPUT_CONTRACT_LINE);
    expect(lines.at(-2)).toBe(STAGE2_TEMPLATE_STYLING_LINE);
    // The block as sent stays word for word; the rule is added because the rewrite did not keep it.
    expect(result.prompt).toContain(OWN_HAIR_BLOCK);
    expect(result.prompt).not.toContain(STYLED_HAIR);
    expect(result.prompt).toContain(`Hair from the photo: ${HAIR_RULE}.`);
    expect(result.prompt.indexOf('Hair from the photo')).toBeLessThan(result.prompt.indexOf('Template styling:'));
  });

  it.each(Object.entries(FLAGS))('flag %s, failing key: the same deterministic result', async (_flag, env) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failing = vi.fn(async () => new Response('nope', { status: 500 }));
    const result = await compileDirectorPromptDetailed(
      { basePrompt: STYLED_BASE, medium: 'video', directorSpec: OWN_HAIR },
      { env: { ...env, ...KEY }, fetch: failing as unknown as typeof fetch },
    );
    expect(result.path).toBe('deterministic_fallback');
    expect(result.prompt).toBe((await compile(STYLED_BASE, OWN_HAIR, env)).prompt);
    expect((wire(failing).payload.templateStyling as Array<{ use: string }>)[0]!.use).toBe('own');
  });

  it("own: ['hair', 'makeup'] carries both", async () => {
    const both = spec({ own: ['hair', 'makeup'] });
    const offline = await compile(STYLED_BASE, both, OFF);
    expect(offline.prompt).toContain(`- Hair: ${HAIR_RULE}`);
    expect(offline.prompt).toContain(`- Makeup: ${MAKEUP_RULE}`);
    expect(offline.prompt).toContain("Never show the template's makeup (1990s smoky plum eyes and lips).");
    expect(offline.prompt).toContain(['Template styling:', PHOTO_HAIR, '- Taken from the photo: the makeup.'].join('\n'));
    const { wire: sent } = await rewrite(STYLED_BASE, both, OFF);
    expect((sent!.payload.templateStyling as Array<{ use: string }>).map((s) => s.use)).toEqual(['own', 'own']);
  });
});

describe('the sheet path (flag on, a sheet line)', () => {
  const withSheet = spec({ own: ['hair'], sheet: OUTFIT_SHEET, summaryChips: [OUTFIT_CHIP] });

  it('no key: the own part is one more element line and a tailed exclusion', async () => {
    const result = await compile(STYLED_BASE, withSheet, ON);
    expect(result).toMatchObject({ path: 'deterministic', sheet: true });
    expect(result.prompt).toContain(`- Hair in every shot it appears, replacing the template's hairstyle wording: ${HAIR_RULE}`);
    expect(result.prompt).toContain("- Wardrobe in every shot it appears, replacing the template's wardrobe wording: 흰 셔츠");
    expect(result.prompt).toContain(HAIR_EXCLUSION);
    expect(result.prompt).not.toContain("Never show the template's original hairstyle.");
    expect(result.prompt).toContain(OWN_HAIR_BLOCK);
  });

  it('key: editSheet carries the element, the replaced part and the exclusion; templateStyling names makeup as template', async () => {
    const { result, wire: sent } = await rewrite(STYLED_BASE, withSheet, ON);
    expect(result).toMatchObject({ path: 'rewrite', sheet: true });
    const sheet = sent!.payload.editSheet as { elements: Array<{ slot: string; text: string }>; replaced: string[]; exclude: string[] };
    expect(sheet.elements).toEqual([
      { slot: 'outfit', text: '흰 셔츠', ref: null },
      { slot: 'hair', text: HAIR_RULE, ref: null },
    ]);
    expect(sheet.replaced).toEqual(['outfit', 'hair']);
    expect(sheet.exclude).toEqual(["the template's hairstyle (a sleek low bun)"]);
    expect(sent!.payload.templateStyling).toEqual([
      { part: 'hair', use: 'own', line: STYLED_HAIR },
      { part: 'makeup', use: 'template', line: STYLED_MAKEUP },
    ]);
  });
});

describe('the lock wins', () => {
  it('a locked hairstyle ignores own: nothing else asked = unchanged; with a change the hair line stays styled', async () => {
    const base = `${BODY}\n\n${HAIR_LOCK}\n\n${STYLING}`;
    for (const env of [OFF, ON]) {
      expect(await compile(base, OWN_HAIR, env)).toEqual({ prompt: base, path: 'unchanged' });
      expect(await compile(base, OWN_HAIR, { ...env, ...KEY })).toEqual({ prompt: base, path: 'unchanged' });
    }
    const asked = spec({ own: ['hair'], summaryChips: [OUTFIT_CHIP] });
    const offline = await compile(base, asked, OFF);
    expect(offline.prompt).toContain(STYLED_HAIR);
    expect(offline.prompt).not.toContain(HAIR_RULE);
    expect(offline.prompt).not.toContain(HAIR_EXCLUSION);
    const { wire: sent } = await rewrite(base, asked, OFF);
    expect(sent!.payload.templateStyling).toEqual([{ part: 'makeup', use: 'template', line: STYLED_MAKEUP }]);
    expect((sent!.payload.structuredIntent as { hairOverrideEn: string | null }).hairOverrideEn).toBeNull();
  });

  it('a malformed lock block locks everything: own is ignored and nothing is sent about styling', async () => {
    const base = `${BODY}\n\nTemplate locks:\n- Keep exactly as in the template: the shoes.\n\n${STYLING}`;
    expect(await compile(base, OWN_HAIR, OFF)).toEqual({ prompt: base, path: 'unchanged' });
  });
});

describe('an explicit request wins over own', () => {
  it.each([
    ['a hair chip', spec({ own: ['hair'], summaryChips: [{ slot: 'hair', labelKo: '헤어', summaryKo: '단발' }] }), OFF],
    [
      'an intent override',
      spec({
        own: ['hair'],
        structuredIntent: { hairOverrideEn: 'a chin-length bob', makeupOverrideEn: null, outfitOverrideEn: null, propOverrideEn: null, shotEdits: [], strictExclusionsEn: [] },
      }),
      OFF,
    ],
    ['a sheet hair line', spec({ own: ['hair'], sheet: { change: [{ text: '단발', slot: 'hair' }], keep: [], exclude: [] } }), ON],
  ] as const)('%s', async (_name, asked, env) => {
    const offline = await compile(STYLED_BASE, asked, env);
    expect(offline.path).toBe('deterministic');
    expect(offline.prompt).not.toContain(HAIR_RULE);
    expect(offline.prompt).not.toContain(HAIR_EXCLUSION);
    expect(offline.prompt).toContain(STYLING);
    const { wire: sent } = await rewrite(STYLED_BASE, asked, env);
    // The customer's own hair change is applied as before; the rewrite is told about makeup only.
    expect(sent!.payload.templateStyling).toEqual([{ part: 'makeup', use: 'template', line: STYLED_MAKEUP }]);
    expect(sent!.payload.basePrompt).toBe(STYLED_BASE);
  });
});

describe('the template style (no own)', () => {
  it('with an outfit change, the rewrite is told to keep hair and makeup as the template styles them', async () => {
    const asked = spec({ summaryChips: [OUTFIT_CHIP] });
    const { result, wire: sent } = await rewrite(STYLED_BASE, asked, OFF);
    expect(result.path).toBe('rewrite');
    expect(sent!.payload.templateStyling).toEqual([
      { part: 'hair', use: 'template', line: STYLED_HAIR },
      { part: 'makeup', use: 'template', line: STYLED_MAKEUP },
    ]);
    expect(sent!.system).toContain(STAGE2_TEMPLATE_STYLING_LINE);
    expect(STAGE2_TEMPLATE_STYLING_LINE).toMatch(/do NOT take that part from @Image 1 or synchronize it to @Image 1/);
    expect(sent!.payload.basePrompt).toBe(STYLED_BASE);
    expect(result.prompt).toContain(STYLING);
    expect(result.prompt).not.toContain('from the photo');
  });

  it('an outfit photo alone takes the wardrobe out of "template" use', async () => {
    const outfitStyled = `${BODY}\n\nTemplate styling:\n${STYLED_HAIR}\n- Styled by the template: the wardrobe — a black slip dress.`;
    const { wire: sent } = await rewrite(outfitStyled, spec({ slotOverrides: ['look_ref'] }), OFF, { hasOutfitRef: true });
    expect(sent!.payload.templateStyling).toEqual([{ part: 'hair', use: 'template', line: STYLED_HAIR }]);
  });

  it('no spec: unchanged, the block exactly as written', async () => {
    for (const env of [OFF, ON, KEY]) expect(await compile(STYLED_BASE, null, env)).toEqual({ prompt: STYLED_BASE, path: 'unchanged' });
  });
});

describe('who and what it is for', () => {
  it('a pet cast ignores own', async () => {
    expect(await compile(STYLED_BASE, OWN_HAIR, OFF, { cast: 'pet', hasPersonSlot: false })).toEqual({ prompt: STYLED_BASE, path: 'unchanged' });
    expect(await compile(STYLED_BASE, OWN_HAIR, OFF, { hasPersonSlot: false })).toEqual({ prompt: STYLED_BASE, path: 'unchanged' });
  });

  it('an image step says "the reference photo", never a handle, in the own rule', async () => {
    const result = await compileDirectorPromptDetailed({ basePrompt: STYLED_BASE, medium: 'image', directorSpec: OWN_HAIR }, { env: { ...KEY } });
    expect(result.path).toBe('deterministic');
    const rule = ownStyleRuleEn('hair', { medium: 'image' });
    expect(rule).toContain('exactly as in the reference photo');
    expect(rule).not.toContain('@Image');
    expect(result.prompt).toContain(`- Hair: ${rule}`);
    expect(result.prompt).not.toContain(HAIR_RULE);
  });

  it('two people: each person keeps their own', async () => {
    const result = await compile(STYLED_BASE, OWN_HAIR, OFF, { cast: 'couple' });
    expect(result.prompt).toContain("- Hair: each person's own hairstyle exactly as in their own photo");
  });
});

describe("own follows #339's locked-shot rule: a styling change reaches the locked shots too", () => {
  const base = `${BODY}\n\n${SHOT_LOCKS}\n\n${STYLING}`;

  it('chips, offline: the hair line also applies in the locked shot', async () => {
    const result = await compile(base, OWN_HAIR, OFF);
    expect(result.prompt).toContain(`- Hair: ${HAIR_RULE}`);
    expect(result.prompt).toContain('- The hair above also applies in shot 2; everything else there stays as written.');
    expect(result.prompt).toContain(SHOT_LOCKS);
    expect(result.prompt).toContain(OWN_HAIR_BLOCK);
  });

  it('sheet, offline: the element line names the locked shot', async () => {
    const result = await compile(base, spec({ own: ['hair'], sheet: OUTFIT_SHEET }), ON);
    expect(result.prompt).toContain(
      `- Hair in every shot it appears (shot 2 included; that shot keeps everything else as written), replacing the template's hairstyle wording: ${HAIR_RULE}`,
    );
  });

  it('rewrite: the lock line and the styling line both say the person changes in locked shots too', async () => {
    const { wire: sent } = await rewrite(base, OWN_HAIR, OFF);
    const lines = sent!.system.split('\n');
    expect(lines.at(-3)).toMatch(/^TEMPLATE LOCKS:.*locked shots included/);
    expect(lines.at(-2)).toBe(STAGE2_TEMPLATE_STYLING_LINE);
    expect(STAGE2_TEMPLATE_STYLING_LINE).toContain('in EVERY shot, locked shots included like any styling change the customer makes');
  });
});

describe('fails quiet and stays the author\'s words', () => {
  it('a malformed styling block is plain text: own is ignored and the compile is as without own', async () => {
    const broken = `${BODY}\n\nTemplate styling:\n- Styled by the template: the hairstyle.\n${STYLED_MAKEUP}`;
    expect(parseTemplateStyling(broken).any).toBe(false);
    expect(await compile(broken, OWN_HAIR, OFF)).toEqual({ prompt: broken, path: 'unchanged' });
    const asked = spec({ own: ['hair'], summaryChips: [OUTFIT_CHIP] });
    const { own: _own, ...without } = asked;
    expect(await compile(broken, asked, OFF)).toEqual(await compile(broken, without as PersonalDirectorSpec, OFF));
    const { wire: sent } = await rewrite(broken, asked, OFF);
    expect(sent!.payload).not.toHaveProperty('templateStyling');
    expect(sent!.system).not.toContain('TEMPLATE STYLING');
  });

  it('the sanitizer leaves the block exactly as written (a banned makeup term in its tail stays there only)', () => {
    const block = 'Template styling:\n- Styled by the template: the makeup — glossy pink lips and heavy blush.';
    const prompt = `Shot 1: @Image 1 with glossy pink lips smiles.\n\n${block}`;
    const out = sanitizeRewrittenPrompt(prompt, true, 'solo');
    expect(out).toContain(block);
    expect(out).toContain('Shot 1: @Image 1 with natural lip colour smiles.');
  });

  it('a rewrite that alters the block or keeps a styled own line is put back', async () => {
    const config = { apiKey: 'k', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: GEMINI_DIRECTOR_DEFAULT_MODEL };
    const altered = `${BODY}\n\nTemplate styling:\n${STYLED_HAIR}\n${STYLED_MAKEUP}\n\n${STYLED_HAIR}`;
    const fetchMock = vi.fn(async () =>
      geminiJson({ rewrittenPrompt: altered, preservedCameraAndLighting: true, preservedAudioRule: true, preservedIdentityStrictLock: true }),
    );
    const director = createFlashTemplateDirector(config, { fetch: fetchMock as unknown as typeof fetch });
    const out = await director.rewritePrompt({
      basePrompt: `${BODY}\n\n${OWN_HAIR_BLOCK}`,
      structuredIntent: { hairOverrideEn: HAIR_RULE, makeupOverrideEn: null, outfitOverrideEn: null, propOverrideEn: null, shotEdits: [], strictExclusionsEn: [] },
      referenceSlots: [{ index: 1, slotName: 'selfie', role: 'person' }],
      styling: [
        { part: 'hair', use: 'own', line: STYLED_HAIR, rule: HAIR_RULE },
        { part: 'makeup', use: 'template', line: STYLED_MAKEUP },
      ],
    });
    const prompt = unwrapServerOnlyPrompt(out.compiledPrompt);
    expect(prompt).not.toContain(STYLED_HAIR);
    expect(prompt).toContain(OWN_HAIR_BLOCK);
    expect(prompt.match(/Template styling:/g)).toHaveLength(1);
    expect(prompt).toContain(`Hair from the photo: ${HAIR_RULE}.`);
    // The rule is not added twice.
    expect(ensureOwnStyle(prompt, [{ part: 'hair', rule: HAIR_RULE }])).toBe(prompt);
  });
});
