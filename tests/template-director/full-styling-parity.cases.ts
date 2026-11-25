/**
 * docs/PERSONAL-STUDIO.md §3.4.9 — the full-block parity matrix (rule 3, founder 2026-11-25: a part a template does
 * not specify follows the buyer's photo).
 *
 * Every live template's `Template styling:` block names the hair, the makeup AND the wardrobe. Reading a missing hair
 * or makeup line as "taken from the photo" must therefore change nothing for such a block: not what the screens read
 * (parse, public projection, card, parts, facets, the admin check) and not one byte of what the compile produces or
 * sends (deterministic, rewrite and fallback paths, every spec, medium, cast and edit-sheet flag).
 *
 * The goldens in `__fixtures__/full-styling-parity.golden.json` were captured from origin/main ead9f230, BEFORE the
 * implied-photo reading existed:
 *   CAPTURE_FULL_STYLING_GOLDENS=1 npx vitest run tests/template-director/full-styling-parity.capture.test.ts
 * This file only uses functions that exist on ead9f230, and the parse record names only the fields that existed there.
 * Synthetic blocks only: the repository is public, no production prompt text.
 */
import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import {
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
  type PersonalEditSheet,
  type StylingEntry,
} from '@/lib/template-director';
import { promptStyling, templateCardStyling } from '@/lib/template-director/compile-prompts';
import { declaredPartKeysOfPrompt, templatePartsView } from '@/lib/template-director/parts-view';
import { styleFacet } from '@/lib/prompts/facets';
import type { Recipe } from '@/lib/recipes/schema';

const BODY = `Reference authority:
- @Image 1 supplies ONLY the protagonist's facial identity.

Timeline:
[Shot 1 - Booth, 0.0-3.0s]:
- @Image 1, hair in a sleek low bun, sits in a phone booth wearing a cream knit. Hard cut.
[Shot 2 - Street, 3.0-6.0s]:
- @Image 1 walks out under neon light. Hard cut.
[Shot 3 - Close-up, 6.0-9.0s]:
- Close-up of @Image 1 smiling at the lens.

[Exclusions]
No watermarks.`;

const HAIR = { part: 'hair', from: 'template', note: 'a sleek low bun.' } as const satisfies StylingEntry;
const MAKEUP = { part: 'makeup', from: 'template', note: '1990s smoky plum eyes and lips.' } as const satisfies StylingEntry;
const OUTFIT = { part: 'outfit', from: 'template', note: 'a cream cable-knit sweater.' } as const satisfies StylingEntry;
const PHOTO = (part: 'hair' | 'makeup' | 'outfit'): StylingEntry => ({ part, from: 'photo' });

/** Full blocks: hair, makeup and wardrobe each declared, in several states and orders. */
export const FULL_BLOCKS: Record<string, string> = {
  allStyled: renderStylingBlock([HAIR, MAKEUP, OUTFIT]),
  lookStyled: renderStylingBlock([HAIR, MAKEUP, PHOTO('outfit')]),
  hairStyled: renderStylingBlock([HAIR, PHOTO('makeup'), PHOTO('outfit')]),
  makeupStyled: renderStylingBlock([PHOTO('hair'), MAKEUP, PHOTO('outfit')]),
  allPhoto: renderStylingBlock([PHOTO('hair'), PHOTO('makeup'), PHOTO('outfit')]),
  reordered: renderStylingBlock([PHOTO('outfit'), MAKEUP, HAIR]),
};

/** Bases: each full block after the body, and one next to a lock block. */
export const FULL_BASES: Record<string, string> = {
  ...Object.fromEntries(Object.entries(FULL_BLOCKS).map(([id, block]) => [id, `${BODY}\n\n${block}`])),
  withLocks: `${BODY}\n\n${renderLockBlock([{ kind: 'product' }, { kind: 'slot', slot: 'prop' }])}\n\n${FULL_BLOCKS.lookStyled}`,
  lockedHair: `${BODY}\n\n${renderLockBlock([{ kind: 'slot', slot: 'shot_action' }])}\n\n${FULL_BLOCKS.hairStyled}`,
};

const SHEET_HAIR: PersonalEditSheet = { change: [{ text: '단발로', slot: 'hair' }], keep: [], exclude: [] };
const SHEET_OUTFIT: PersonalEditSheet = { change: [{ text: '검정 가죽 자켓', slot: 'outfit' }], keep: ['조명'], exclude: ['로고'] };

export const FULL_SPECS: Record<string, { spec: PersonalDirectorSpec | null; refs?: { hasOutfitRef?: boolean } }> = {
  none: { spec: null },
  ownHair: { spec: { audioMode: 'ambient', own: ['hair'] } as PersonalDirectorSpec },
  ownMakeup: { spec: { audioMode: 'ambient', own: ['makeup'] } as PersonalDirectorSpec },
  ownBoth: { spec: { audioMode: 'ambient', own: ['hair', 'makeup'] } as PersonalDirectorSpec },
  chipsOutfit: {
    spec: { audioMode: 'ambient', own: ['makeup'], summaryChips: [{ slot: 'outfit', labelKo: '의상', summaryKo: '블랙 가죽 자켓' }] } as PersonalDirectorSpec,
  },
  intentHair: {
    spec: {
      audioMode: 'ambient',
      own: ['makeup'],
      structuredIntent: { hairOverrideEn: 'a short bob', makeupOverrideEn: null, outfitOverrideEn: null, propOverrideEn: null, shotEdits: [], strictExclusionsEn: [] },
    } as unknown as PersonalDirectorSpec,
  },
  sheetHair: { spec: { audioMode: 'ambient', own: ['hair', 'makeup'], sheet: SHEET_HAIR } as PersonalDirectorSpec },
  sheetOutfitRef: { spec: { audioMode: 'ambient', own: ['hair'], sheet: SHEET_OUTFIT } as PersonalDirectorSpec, refs: { hasOutfitRef: true } },
};

const CASTS: Record<string, { cast: 'solo' | 'couple' | 'pet'; hasPersonSlot?: boolean }> = {
  solo: { cast: 'solo' },
  couple: { cast: 'couple' },
  pet: { cast: 'pet', hasPersonSlot: false },
};

const ON = { TWINGS_PERSONAL_EDIT_SHEET: 'on' } as const;
const KEY = { GEMINI_API_KEY: 'fake-gemini-key' } as const;

function geminiJson(payload: unknown) {
  return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(payload) }] } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** A rewrite that echoes the base it was sent and adds a line (so the output depends on the input). */
function echoRewriteFetch() {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { contents: Array<{ parts: Array<{ text: string }> }> };
    const payload = JSON.parse(body.contents[0]!.parts[0]!.text) as { basePrompt: string };
    return geminiJson({
      rewrittenPrompt: `${payload.basePrompt}\n\nWardrobe: a black leather jacket in every shot.`,
      preservedCameraAndLighting: true,
      preservedAudioRule: true,
      preservedIdentityStrictLock: true,
    });
  });
}

const bodiesOf = (fetchMock: { mock: { calls: unknown[][] } }): string[] => fetchMock.mock.calls.map((call) => String((call[1] as RequestInit).body));

export const digest = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32);

/** Every compile case: id → the exact string of everything the compile produced or sent. */
export async function collectFullCompileOutputs(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    for (const [baseId, basePrompt] of Object.entries(FULL_BASES)) {
      for (const [specId, { spec, refs }] of Object.entries(FULL_SPECS)) {
        for (const medium of ['video', 'image'] as const) {
          for (const [castId, cast] of Object.entries(CASTS)) {
            for (const [flagId, flagEnv] of Object.entries({ off: {}, on: ON })) {
              const input = { basePrompt, medium, ...cast, ...(refs ?? {}), directorSpec: spec };
              const id = `${baseId}|${specId}|${medium}|${castId}|${flagId}`;
              out[`${id}|nokey`] = JSON.stringify(await compileDirectorPromptDetailed(input, { env: { ...flagEnv } }));
              const ok = echoRewriteFetch();
              const rewritten = await compileDirectorPromptDetailed(input, { env: { ...flagEnv, ...KEY }, fetch: ok as unknown as typeof fetch });
              out[`${id}|key`] = JSON.stringify({ result: rewritten, bodies: bodiesOf(ok) });
              const failing = vi.fn(async () => new Response('nope', { status: 500 }));
              const fallback = await compileDirectorPromptDetailed(input, { env: { ...flagEnv, ...KEY }, fetch: failing as unknown as typeof fetch });
              out[`${id}|fail`] = JSON.stringify({ result: fallback, bodies: bodiesOf(failing) });
              out[`${id}|det`] = applyDeterministicDirectorSpec(input, { env: { ...flagEnv } });
            }
          }
        }
      }
    }
  } finally {
    warn.mockRestore();
  }
  return out;
}

const PART_COPY = {
  locks: { product: 'product', logo: 'logo', sound: 'sound' },
  slots: { outfit: 'outfit', makeup: 'makeup', hair: 'hair', prop: 'prop', shot_action: 'shot_action', lighting_mood: 'lighting_mood' },
  shotOne: 'shot {n}',
  shotRange: 'shots {from}-{to}',
};

const carousel = (prompt: string): Recipe =>
  ({
    version: 2,
    slots: { selfie: { kind: 'image', source: 'user', required: true } },
    steps: [
      { id: 'frame1', kind: 'image', engine: 'gpt-image-2', inputs: ['selfie'], prompt: `Frame one of {{selfie}}.\n\n${prompt}`, params: { aspect: '4:5' } },
      { id: 'frame2', kind: 'image', engine: 'gpt-image-2', inputs: ['selfie'], prompt: `Frame two of {{selfie}}.\n\n${prompt}`, params: { aspect: '4:5' } },
    ],
    output: { frames: ['frame1', 'frame2'] },
  }) as Recipe;

/** What every screen and the rewrite's styling input read from a full block: id → JSON. */
export function collectFullReadOutputs(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [baseId, text] of Object.entries(FULL_BASES)) {
    const styling = parseTemplateStyling(text);
    const locks = parseTemplateLocks(text);
    // Only the fields that existed on ead9f230.
    out[`${baseId}|parse`] = JSON.stringify({ any: styling.any, styled: styling.styled, photo: styling.photo, block: styling.block });
    out[`${baseId}|public`] = JSON.stringify(publicStyling(styling, locks));
    out[`${baseId}|promptStyling`] = JSON.stringify(promptStyling(text));
    out[`${baseId}|check`] = JSON.stringify(checkStylingBlock(text));
    const block = styling.block;
    for (const cast of ['solo', 'couple', 'pet', null] as const) {
      out[`${baseId}|card|text|${cast}`] = JSON.stringify(templateCardStyling({ promptText: text, cast }));
      out[`${baseId}|card|recipe|${cast}`] = JSON.stringify(templateCardStyling({ promptText: 'Main text.', recipe: carousel(block), recipeReady: true, cast }));
    }
    const card = templateCardStyling({ promptText: text });
    out[`${baseId}|declared`] = JSON.stringify(declaredPartKeysOfPrompt(text));
    out[`${baseId}|declared|card`] = JSON.stringify(declaredPartKeysOfPrompt(text, card));
    for (const locale of ['ko', 'en'] as const) {
      out[`${baseId}|parts|${locale}`] = JSON.stringify(
        templatePartsView({
          locks: null,
          styling: card,
          marks: [{ index: 0, timeSeconds: 1, endSeconds: 2, part: 'hair', labelKo: '머리', labelEn: 'hair' }],
          copy: PART_COPY,
          locale,
        }),
      );
    }
    for (const medium of ['video', 'image'] as const) {
      out[`${baseId}|facet|${medium}`] = JSON.stringify(
        styleFacet({ medium, runtimeSeconds: 10, publishedAt: null, useCase: [], ...(card ? { styling: card } : {}) }),
      );
    }
    for (const [specId, { spec, refs }] of Object.entries(FULL_SPECS)) {
      for (const [castId, cast] of Object.entries(CASTS)) {
        const sheet = spec?.sheet ?? null;
        const ctx = { sheet, cast: cast.cast, hasPersonSlot: cast.hasPersonSlot, hasOutfitRef: refs?.hasOutfitRef };
        const own = ownChoiceFor(spec, styling, locks, ctx);
        const explicit = explicitStyleParts(spec, { sheet, hasOutfitRef: refs?.hasOutfitRef });
        const plans = ownStylePlan(styling, own, { medium: 'video', cast: cast.cast });
        out[`${baseId}|uses|${specId}|${castId}`] = JSON.stringify({ own, explicit, plans, uses: templateStylingUses(styling, locks, own, explicit, plans) });
      }
    }
  }
  return out;
}
