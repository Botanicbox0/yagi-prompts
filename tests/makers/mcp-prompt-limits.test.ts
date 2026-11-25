import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: <T>(fn: T) => fn }));
import { MCP_PROMPT_LIMIT_TEXT, MCP_TOOLS, recipeGuide } from '@/lib/mcp/server';
import { DEFAULT_PROMPT_CHARS, SEEDANCE_25_PROMPT_CHARS, promptCharLimit } from '@/lib/engines/prompt-limits';
import { MIN_STEP_PROMPT_CHARS } from '@/lib/recipes/schema';

/**
 * Drift guard: the supplier guide once said 4,000 while the editor allowed 8,000. Every number the MCP guide and tool
 * descriptions quote for a step prompt must be one of the constants (founder 2026-11-25: Seedance 2.5 = 15,000 per clip).
 */

const ALLOWED = new Set([MIN_STEP_PROMPT_CHARS, DEFAULT_PROMPT_CHARS, SEEDANCE_25_PROMPT_CHARS]);
const numbers = (text: string): number[] => [...text.matchAll(/\d{1,3}(?:,\d{3})+|\d+/g)].map((m) => Number(m[0].replace(/,/g, '')));

describe('MCP prompt limits', () => {
  it('quotes only the real limits for a step prompt', () => {
    const guide = recipeGuide();
    expect(guide.limits.prompt).toBe(MCP_PROMPT_LIMIT_TEXT);
    // "Seedance 2.5" itself carries a 2 and a 5; the rest must be the constants.
    const quoted = numbers(MCP_PROMPT_LIMIT_TEXT.replace(/Seedance 2\.5/g, ''));
    expect(quoted.length).toBeGreaterThan(0);
    for (const n of quoted) expect([...ALLOWED], String(n)).toContain(n);
    expect(MCP_PROMPT_LIMIT_TEXT).toContain('15,000');
    expect(MCP_PROMPT_LIMIT_TEXT).toContain('8,000');
    expect(MCP_PROMPT_LIMIT_TEXT).toMatch(/per clip/);
  });

  it('gives every engine in the guide its own limit', () => {
    for (const engine of recipeGuide().engines) expect(engine.promptMaxChars, engine.id).toBe(promptCharLimit(engine.id));
    expect(recipeGuide().engines.find((e) => e.id === 'seedance-2.5')?.promptMaxChars).toBe(15_000);
  });

  it('never states the old 4,000 anywhere, and the save tool repeats the rule', () => {
    const everything = JSON.stringify({ guide: recipeGuide(), tools: MCP_TOOLS });
    expect(everything).not.toMatch(/\b4,?000 characters|10–4000/);
    const save = MCP_TOOLS.find((t) => t.name === 'save_template')!;
    expect(JSON.stringify(save.inputSchema)).toContain(MCP_PROMPT_LIMIT_TEXT);
  });
});
