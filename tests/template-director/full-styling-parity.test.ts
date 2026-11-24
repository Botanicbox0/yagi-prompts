import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { collectFullCompileOutputs, collectFullReadOutputs, digest } from './full-styling-parity.cases';

/**
 * docs/PERSONAL-STUDIO.md §3.4.9 — rule 3 (a hair or makeup line a block leaves out reads as "taken from the photo")
 * changes nothing for a block that names the hair, the makeup and the wardrobe: every read and every compile output
 * matches the goldens captured on origin/main ead9f230 before the rule existed (golden file untouched).
 */
const GOLDEN = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'full-styling-parity.golden.json'), 'utf8'),
) as { capturedFrom: string; compile: Record<string, string>; read: Record<string, string> };

const differing = (golden: Record<string, string>, now: Record<string, string>): string[] =>
  [...new Set([...Object.keys(golden), ...Object.keys(now)])].filter((id) => golden[id] !== (now[id] === undefined ? undefined : `${now[id]!.length}:${digest(now[id]!)}`));

describe('full-block styling parity (hair, makeup and wardrobe all declared)', () => {
  it('the goldens were captured before the rule', () => {
    expect(GOLDEN.capturedFrom).toBe('ead9f230');
  });

  it('every screen read is as before', () => {
    const now = collectFullReadOutputs();
    expect(Object.keys(now).length).toBe(Object.keys(GOLDEN.read).length);
    expect(differing(GOLDEN.read, now).slice(0, 10)).toEqual([]);
  });

  it('every compile output and request body is as before, byte for byte', async () => {
    const now = await collectFullCompileOutputs();
    expect(Object.keys(now).length).toBe(Object.keys(GOLDEN.compile).length);
    expect(differing(GOLDEN.compile, now).slice(0, 10)).toEqual([]);
  }, 600_000);
});
