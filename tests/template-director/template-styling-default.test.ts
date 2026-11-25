import { afterEach, describe, expect, it, vi } from 'vitest';
import { ko } from '@/messages/ko';
import {
  NO_LOCKS,
  NO_STYLING,
  applyDeterministicDirectorSpec,
  checkStylingBlock,
  compileDirectorPromptDetailed,
  explicitStyleParts,
  ownChoiceFor,
  ownStylePlan,
  parseTemplateLocks,
  parseTemplateStyling,
  publicStyling,
  renderLockBlock,
  renderStylingBlock,
  templateStylingUses,
  type PersonalDirectorSpec,
} from '@/lib/template-director';
import { templateCardStyling } from '@/lib/template-director/compile-prompts';
import { declaredPartKeysOfPrompt, templatePartsView } from '@/lib/template-director/parts-view';
import { styleFacet } from '@/lib/prompts/facets';

/**
 * docs/PERSONAL-STUDIO.md §3.4.9 — rule 3 (founder, 2026-11-25): "템플릿을 만들때 특정하지 않았다면 default는 인물이 넣은
 * 사진의 얼굴, 메이크업, 헤어스타일이 적용되는게 default여야 함." A valid `Template styling:` block that has no line for
 * the hair and/or the makeup reads that part as taken from the photo everywhere the block is read: the parse, the public
 * projection (card, parts, facets, the admin check). The compile behaves as if the line `- Taken from the photo: …`
 * were written, without one byte of it in what is sent: an implied part only changes what the screens show and keeps
 * the rewrite from being told the part is styled. A prompt with no block at all is unchanged (no-styling-parity).
 */

afterEach(() => vi.restoreAllMocks());

const BODY = `Reference authority:
- @Image 1 supplies ONLY the protagonist's facial identity.

Timeline:
[Shot 1 - Booth, 0.0-3.0s]:
- @Image 1, hair in a sleek low bun, sits in a phone booth. Hard cut.
[Shot 2 - Street, 3.0-6.0s]:
- @Image 1 walks out under neon light, smiling at the lens.

[Exclusions]
No watermarks.`;

const HAIR = { part: 'hair', from: 'template', note: 'a sleek low bun.' } as const;
const MAKEUP = { part: 'makeup', from: 'template', note: '1990s smoky plum eyes and lips.' } as const;
const OUTFIT = { part: 'outfit', from: 'template', note: 'a cream cable-knit sweater.' } as const;

const HAIR_ONLY = renderStylingBlock([HAIR]);
const MAKEUP_ONLY = renderStylingBlock([MAKEUP]);
const OUTFIT_ONLY = renderStylingBlock([OUTFIT]);
const WARDROBE_PHOTO = renderStylingBlock([{ part: 'outfit', from: 'photo' }]);
const with_ = (block: string) => `${BODY}\n\n${block}`;

const PHOTO_MAKEUP_LINE = '- Taken from the photo: the makeup.';
const PHOTO_HAIR_LINE = '- Taken from the photo: the hairstyle.';

describe('the parse reads a part the block leaves out as taken from the photo', () => {
  it('hair only: the makeup is a photo part, implied; the block text is exactly as written', () => {
    const styling = parseTemplateStyling(with_(HAIR_ONLY));
    expect(styling.styled.map((s) => s.part)).toEqual(['hair']);
    expect(styling.photo).toEqual(['makeup']);
    expect(styling.implied).toEqual(['makeup']);
    expect(styling.block).toBe(HAIR_ONLY);
    expect(Object.isFrozen(styling.implied)).toBe(true);
  });

  it('the wardrobe only: hair and makeup both implied, after the declared photo parts', () => {
    expect(parseTemplateStyling(with_(WARDROBE_PHOTO))).toMatchObject({ photo: ['outfit', 'hair', 'makeup'], implied: ['hair', 'makeup'] });
    expect(parseTemplateStyling(with_(OUTFIT_ONLY))).toMatchObject({ photo: ['hair', 'makeup'], implied: ['hair', 'makeup'] });
    expect(parseTemplateStyling(with_(MAKEUP_ONLY))).toMatchObject({ photo: ['hair'], implied: ['hair'] });
  });

  it('a block that names hair, makeup and wardrobe has nothing implied (no field at all), and no block stays NO_STYLING', () => {
    const full = parseTemplateStyling(with_(renderStylingBlock([HAIR, { part: 'makeup', from: 'photo' }, { part: 'outfit', from: 'photo' }])));
    expect(full).not.toHaveProperty('implied');
    expect(full.photo).toEqual(['makeup', 'outfit']);
    expect(parseTemplateStyling(BODY)).toBe(NO_STYLING);
    expect(NO_STYLING).not.toHaveProperty('implied');
    // A malformed block still claims nothing: no implied part either.
    expect(parseTemplateStyling(with_('Template styling:\n- Styled by the template: the shoes — red.'))).toBe(NO_STYLING);
  });

  it('the public projection, the admin check and the card agree; a locked part stays out (the lock wins)', () => {
    expect(publicStyling(parseTemplateStyling(with_(HAIR_ONLY)), NO_LOCKS)).toEqual({ styled: ['hair'], photo: ['makeup'] });
    expect(checkStylingBlock(with_(HAIR_ONLY))).toEqual({ state: 'ok', styling: { styled: ['hair'], photo: ['makeup'] } });
    expect(templateCardStyling({ promptText: with_(HAIR_ONLY) })).toEqual({ styled: ['hair'], photo: ['makeup'] });
    // A hair lock and a block that leaves the hair out: the hair is locked, never "from the photo".
    const locked = `${BODY}\n\n${renderLockBlock([{ kind: 'slot', slot: 'hair' }])}\n\n${MAKEUP_ONLY}`;
    expect(parseTemplateStyling(locked).implied).toEqual(['hair']);
    expect(publicStyling(parseTemplateStyling(locked), parseTemplateLocks(locked))).toEqual({ styled: ['makeup'], photo: [] });
    expect(checkStylingBlock(locked)).toEqual({ state: 'ok', styling: { styled: ['makeup'], photo: [] } });
    // A pet template still claims nothing.
    expect(templateCardStyling({ promptText: with_(HAIR_ONLY), cast: 'pet' })).toBeNull();
  });

  it('two prompts that differ only by the implied line now declare the same thing', () => {
    const explicit = renderStylingBlock([HAIR, { part: 'makeup', from: 'photo' }]);
    expect(templateCardStyling({ promptText: with_(explicit) })).toEqual(templateCardStyling({ promptText: with_(HAIR_ONLY) }));
  });

  it('the template page shows the implied part as "from your photo", read-only; the list puts it under "my look"', () => {
    const card = templateCardStyling({ promptText: with_(HAIR_ONLY) });
    const view = templatePartsView({ locks: null, styling: card, marks: [], copy: ko.editSheet, locale: 'ko' });
    expect(view.map((row) => [row.key, row.state, row.choice])).toEqual([
      ['hair', 'styled', true],
      ['makeup', 'photo', false],
    ]);
    expect(declaredPartKeysOfPrompt(with_(HAIR_ONLY))).toEqual(['hair', 'makeup']);
    const outfit = templateCardStyling({ promptText: with_(OUTFIT_ONLY) })!;
    expect(styleFacet({ medium: 'video', runtimeSeconds: 10, publishedAt: null, useCase: [], styling: outfit })).toBe('mine');
    expect(styleFacet({ medium: 'video', runtimeSeconds: 10, publishedAt: null, useCase: [], styling: card! })).toBe('styled');
  });
});

describe('the compile: as if the photo line were written, without sending it', () => {
  const ON = { TWINGS_PERSONAL_EDIT_SHEET: 'on' } as const;
  const KEY = { GEMINI_API_KEY: 'fake-gemini-key' } as const;

  function geminiJson(payload: unknown) {
    return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(payload) }] } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  const echo = () =>
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { contents: Array<{ parts: Array<{ text: string }> }> };
      const payload = JSON.parse(body.contents[0]!.parts[0]!.text) as { basePrompt: string };
      return geminiJson({ rewrittenPrompt: `${payload.basePrompt}\n\nWardrobe: a black leather jacket in every shot.`, preservedCameraAndLighting: true, preservedAudioRule: true, preservedIdentityStrictLock: true });
    });

  const SPECS: Record<string, PersonalDirectorSpec | null> = {
    none: null,
    ownHair: { audioMode: 'ambient', own: ['hair'] } as PersonalDirectorSpec,
    ownMakeup: { audioMode: 'ambient', own: ['makeup'] } as PersonalDirectorSpec,
    ownBoth: { audioMode: 'ambient', own: ['hair', 'makeup'] } as PersonalDirectorSpec,
    chips: { audioMode: 'ambient', own: ['hair', 'makeup'], summaryChips: [{ slot: 'outfit', labelKo: '의상', summaryKo: '블랙 가죽 자켓' }] } as PersonalDirectorSpec,
    sheet: { audioMode: 'ambient', own: ['hair'], sheet: { change: [{ text: '검정 가죽 자켓', slot: 'outfit' }], keep: [], exclude: [] } } as PersonalDirectorSpec,
  };

  /** `\n<line>` as it reads at each JSON nesting depth (0 = as written), deepest first. */
  const encodings = (line: string): string[] => {
    const out = [`\n${line}`];
    for (let k = 1; k <= 4; k += 1) out.push(JSON.stringify(out[k - 1]).slice(1, -1));
    return out.reverse();
  };

  /** Everything a compile produces or sends, with the explicit photo line taken out (as written and JSON-escaped). */
  async function outputs(basePrompt: string, drop: string | null): Promise<Record<string, string>> {
    const strip = (value: string) => (drop === null ? value : encodings(drop).reduce((acc, enc) => acc.split(enc).join(''), value));
    const out: Record<string, string> = {};
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const [specId, directorSpec] of Object.entries(SPECS)) {
      for (const medium of ['video', 'image'] as const) {
        for (const [flagId, flags] of Object.entries({ off: {}, on: ON })) {
          const input = { basePrompt, medium, cast: 'solo' as const, directorSpec };
          const id = `${specId}|${medium}|${flagId}`;
          out[`${id}|det`] = strip(applyDeterministicDirectorSpec(input, { env: { ...flags } }));
          out[`${id}|nokey`] = strip(JSON.stringify(await compileDirectorPromptDetailed(input, { env: { ...flags } })));
          const fetchMock = echo();
          const result = await compileDirectorPromptDetailed(input, { env: { ...flags, ...KEY }, fetch: fetchMock as unknown as typeof fetch });
          out[`${id}|key`] = strip(JSON.stringify({ result, bodies: fetchMock.mock.calls.map((c) => String((c[1] as RequestInit).body)) }));
        }
      }
    }
    warn.mockRestore();
    return out;
  }

  it('hair only compiles exactly like hair + an explicit makeup photo line, minus that line; it is never added', async () => {
    const implied = await outputs(with_(HAIR_ONLY), null);
    const explicit = await outputs(with_(renderStylingBlock([HAIR, { part: 'makeup', from: 'photo' }])), PHOTO_MAKEUP_LINE);
    expect(Object.keys(implied).length).toBe(24 * 3);
    for (const id of Object.keys(implied)) expect(implied[id], id).toBe(explicit[id]);
    for (const value of Object.values(implied)) expect(value).not.toContain(PHOTO_MAKEUP_LINE);
  });

  it('makeup only, likewise for the hair', async () => {
    const implied = await outputs(with_(MAKEUP_ONLY), null);
    const explicit = await outputs(with_(renderStylingBlock([{ part: 'hair', from: 'photo' }, MAKEUP])), PHOTO_HAIR_LINE);
    for (const id of Object.keys(implied)) expect(implied[id], id).toBe(explicit[id]);
    for (const value of Object.values(implied)) expect(value).not.toContain(PHOTO_HAIR_LINE);
  });

  it('the rewrite is told only about the parts the template styles; an implied part is never "own" or "template"', () => {
    const styling = parseTemplateStyling(with_(HAIR_ONLY));
    for (const own of [[], ['hair'], ['makeup'], ['hair', 'makeup']] as const) {
      const spec = { audioMode: 'ambient', own: [...own] } as PersonalDirectorSpec;
      const parts = ownChoiceFor(spec, styling, NO_LOCKS);
      expect(parts, own.join('+')).toEqual(own.filter((p) => p === 'hair'));
      const uses = templateStylingUses(styling, NO_LOCKS, parts, explicitStyleParts(spec), ownStylePlan(styling, parts, { medium: 'video' }));
      expect(uses.map((u) => u.part)).toEqual(['hair']);
    }
  });
});
