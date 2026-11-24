import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  NO_LOCKS,
  STAGE1_CHIPS_OUTPUT_CONTRACT_LINE,
  STAGE1_CHIPS_RESPONSE_SCHEMA,
  STAGE1_SHEET_EN_SCREEN_NOTE,
  STAGE2_DOCTRINE_MAKEUP_ITEM,
  STAGE2_OUTPUT_CONTRACT_LINE,
  STAGE2_REWRITE_RESPONSE_SCHEMA,
  parseTemplateLocks,
} from '@/lib/template-director';
import { PARITY_BASES, collectCompileOutputs, collectTurnOutputs, digest, type BodyNormalizer } from './no-locks-parity.cases';

/**
 * docs/PERSONAL-STUDIO.md §3.3 (C1) — the invariant: a prompt WITHOUT a `Template locks:` header compiles, rewrites
 * and answers byte-identically to origin/main 10124dc0, with the edit-sheet flag on or off and with or without a key.
 * The goldens were captured on 10124dc0 before the locks code existed (see `no-locks-parity.cases.ts`).
 *
 * Four deliberate changes reach request bodies whether or not the template has locks (live fix 2026-11-24), and are
 * undone here before the comparison, by exact string, so everything else must still match byte for byte:
 *   1. Stage 2 and chips-turn system texts end with an output contract line;
 *   2. doctrine item 3 no longer names a banned makeup term ("zero pink blush/pink eyeshadow");
 *   3. those two calls send `generationConfig.responseJsonSchema`;
 *   4. the English-screen note of a sheet turn also asks for English line texts.
 * The goldens themselves are untouched.
 */
const MAKEUP_ITEM_AT_10124DC0 =
  '3. Makeup & Complexion Override: When makeupOverrideEn is present (e.g. keeping the user photo natural daily makeup instead of heavy 1990s retro smoky/plum makeup), replace the basePrompt makeup instructions accordingly while keeping skin warm and natural (zero pink blush/pink eyeshadow, zero random moles, beauty marks, or blemishes on face/neck per TWINGS IDENTITY.md).';
const EN_SCREEN_NOTE_AT_10124DC0 =
  "The customer's screen is in English: write replyKo and every part of question (point, text, options) in English, even when the customer, the sheet or templateSummaryKo is in Korean. Keep every field name exactly as given.";

const asSentOn10124dc0: BodyNormalizer = (body) => {
  const parsed = JSON.parse(body) as { systemInstruction: { parts: Array<{ text: string }> }; generationConfig: Record<string, unknown> };
  const part = parsed.systemInstruction.parts[0]!;
  for (const line of [STAGE2_OUTPUT_CONTRACT_LINE, STAGE1_CHIPS_OUTPUT_CONTRACT_LINE]) {
    if (part.text.endsWith(`\n${line}`)) part.text = part.text.slice(0, -(line.length + 1));
  }
  part.text = part.text.split(STAGE2_DOCTRINE_MAKEUP_ITEM).join(MAKEUP_ITEM_AT_10124DC0);
  part.text = part.text.split(STAGE1_SHEET_EN_SCREEN_NOTE).join(EN_SCREEN_NOTE_AT_10124DC0);
  const schema = JSON.stringify(parsed.generationConfig.responseJsonSchema);
  if (schema === JSON.stringify(STAGE2_REWRITE_RESPONSE_SCHEMA) || schema === JSON.stringify(STAGE1_CHIPS_RESPONSE_SCHEMA)) {
    delete parsed.generationConfig.responseJsonSchema;
  }
  return JSON.stringify(parsed);
};
const golden = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'no-locks-parity.golden.json'), 'utf8'),
) as { capturedFrom: string; compile: Record<string, string>; turns: Record<string, string> };

function mismatches(expected: Record<string, string>, actual: Record<string, string>): string[] {
  const ids = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  return [...ids].filter((id) => !actual[id] || expected[id] !== `${actual[id]!.length}:${digest(actual[id]!)}`);
}

describe('no-locks parity with origin/main 10124dc0', () => {
  it('the goldens come from 10124dc0 and cover the matrix', () => {
    expect(golden.capturedFrom).toBe('10124dc0');
    expect(Object.keys(golden.compile)).toHaveLength(1710);
    expect(Object.keys(golden.turns)).toHaveLength(264);
  });

  it('no parity base has a header', () => {
    for (const base of Object.values(PARITY_BASES)) expect(parseTemplateLocks(base)).toBe(NO_LOCKS);
  });

  it('compile: prompt, path and rewrite bodies are string-equal to the goldens (flag on/off, key/no key/failing key)', async () => {
    const actual = await collectCompileOutputs(asSentOn10124dc0);
    expect(mismatches(golden.compile, actual).slice(0, 10)).toEqual([]);
  });

  it('Stage 1: request bodies and results are string-equal without `locks`', async () => {
    const actual = await collectTurnOutputs({}, asSentOn10124dc0);
    expect(mismatches(golden.turns, actual).slice(0, 10)).toEqual([]);
  });

  it('Stage 1: request bodies and results are string-equal with `locks: NO_LOCKS`', async () => {
    const actual = await collectTurnOutputs({ locks: NO_LOCKS }, asSentOn10124dc0);
    expect(mismatches(golden.turns, actual).slice(0, 10)).toEqual([]);
  });

  it('the undone changes are real: every rewrite, chips and English sheet body differs without undoing them; Korean sheet turns do not', async () => {
    const compile = await collectCompileOutputs();
    const turns = await collectTurnOutputs();
    const sent = (value: string | undefined): boolean => ((JSON.parse(value ?? '{}') as { bodies?: unknown[] }).bodies?.length ?? 0) > 0;
    const pick = (ids: string[], from: Record<string, string>) => Object.fromEntries(ids.map((id) => [id, from[id]!]));
    const rewrites = Object.keys(compile).filter((id) => /\|(?:key|fail)$/.test(id) && sent(compile[id]));
    expect(rewrites.length).toBeGreaterThan(100);
    expect(mismatches(pick(rewrites, golden.compile), pick(rewrites, compile))).toHaveLength(rewrites.length);
    const chips = Object.keys(turns).filter((id) => id.includes('|chips|') && id.includes('|model|') && sent(turns[id]));
    expect(chips.length).toBeGreaterThan(10);
    expect(mismatches(pick(chips, golden.turns), pick(chips, turns))).toHaveLength(chips.length);
    const enSheets = Object.keys(turns).filter((id) => !id.includes('|chips|') && id.includes('|en|') && id.includes('|model|') && sent(turns[id]));
    expect(enSheets.length).toBeGreaterThan(10);
    expect(mismatches(pick(enSheets, golden.turns), pick(enSheets, turns))).toHaveLength(enSheets.length);
    const koSheets = Object.keys(turns).filter((id) => !id.includes('|chips|') && !id.includes('|en|'));
    expect(mismatches(pick(koSheets, golden.turns), pick(koSheets, turns))).toEqual([]);
  });
});
