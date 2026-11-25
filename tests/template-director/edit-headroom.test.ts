import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DIRECTOR_BUDGET_FROM_SHARE,
  DIRECTOR_BUDGET_MARGIN_CHARS,
  DIRECTOR_EDITABLE_SLOTS,
  DIRECTOR_OVER_ENGINE_LIMIT_LOG_TAG,
  PERSONAL_BGM_MOODS,
  TEMPLATE_KEEP_LINE_PREFIX,
  compileDirectorPromptDetailed,
  parseTemplateLocks,
  parseTemplateStyling,
  renderStylingBlock,
} from '@/lib/template-director';
import { EDIT_HEADROOM_MIN_CHARS, SEEDANCE_25_PROMPT_CHARS, editHeadroom } from '@/lib/engines/prompt-limits';
import { templateEditHeadroom, templateEditsClosed } from '@/lib/prompts/prompt-length';
import { toPromptCard } from '@/lib/prompts/catalog';
import type { PromptRow } from '@/lib/prompts/repo';

/**
 * Founder 2026-11-25: a buyer's paid edit must never be dropped for length. The rewrite is told its budget near the
 * engine's limit; a compile that still cannot fit says `over_limit` (never cut, never without its blocks); and a
 * template that leaves less room than the fullest edit takes no change requests at all (`editsClosed`). Filler only.
 */

const KEY = { GEMINI_API_KEY: 'k' } as const;
const LOCKS = ['Template locks:', `${TEMPLATE_KEEP_LINE_PREFIX}the product.`].join('\n');
const STYLING = renderStylingBlock([{ part: 'hair', from: 'template', note: 'a sleek low bun.' }, { part: 'makeup', from: 'template', note: 'soft rosy cheeks.' }]);

/** A film prompt of exactly `total` characters: shot lines, then the template's lock and styling blocks. */
function base(total: number): string {
  const tail = `\n\n${LOCKS}\n\n${STYLING}`;
  const line = 'Shot: the camera holds on her as she walks down a quiet street at dusk.\n';
  const body = line.repeat(Math.ceil(total / line.length)).slice(0, total - tail.length).trimEnd();
  return `${body}${'.'.repeat(total - tail.length - body.length)}${tail}`;
}
const note = { userMessage: 'Give her a black leather jacket in every shot.', audioMode: 'ambient' as const };
function geminiJson(payload: unknown) {
  return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(payload) }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
}
const rewrite = (chars: number) => ({
  rewrittenPrompt: `Shot 1: she walks in a black leather jacket.\n${'Shot: the camera holds on her.\n'.repeat(Math.ceil(chars / 31))}`.slice(0, chars),
  preservedCameraAndLighting: true, preservedAudioRule: true, preservedIdentityStrictLock: true,
});
function wire(fetchMock: { mock: { calls: unknown[][] } }, call = 0) {
  const body = JSON.parse(String((fetchMock.mock.calls[call]![1] as RequestInit).body)) as { systemInstruction: { parts: Array<{ text: string }> }; contents: Array<{ parts: Array<{ text: string }> }> };
  return { system: body.systemInstruction.parts[0]!.text, payload: JSON.parse(body.contents[0]!.parts[0]!.text) as Record<string, unknown> };
}

afterEach(() => vi.restoreAllMocks());

describe('the rewrite is told its budget only near the limit', () => {
  const threshold = DIRECTOR_BUDGET_FROM_SHARE * SEEDANCE_25_PROMPT_CHARS;

  it('a base over 80% of the limit sends the budget: the limit less the blocks put back and the margin', async () => {
    const template = base(threshold + 1);
    const fetchMock = vi.fn(async () => geminiJson(rewrite(3_000)));
    await compileDirectorPromptDetailed({ basePrompt: template, medium: 'video', directorSpec: note }, { env: KEY, fetch: fetchMock as unknown as typeof fetch });
    const { system, payload } = wire(fetchMock);
    const expected = SEEDANCE_25_PROMPT_CHARS - parseTemplateLocks(template).block.length - parseTemplateStyling(template).block.length - DIRECTOR_BUDGET_MARGIN_CHARS;
    expect(payload.promptBudgetChars).toBe(expected);
    expect(system).toContain(`LENGTH: the whole rewrittenPrompt must be at most ${expected} characters`);
    expect(system).toMatch(/never drop a shot, a timing, a camera move, wardrobe, the audio rule or the identity rules/);
    // The output contract stays the last line.
    expect(system.trimEnd().split('\n').pop()).toMatch(/^OUTPUT:/);
  });

  it('a base at or under 80% (and a 9,000-character base) sends exactly what it sent before', async () => {
    for (const chars of [threshold, 9_000]) {
      const fetchMock = vi.fn(async () => geminiJson(rewrite(3_000)));
      const result = await compileDirectorPromptDetailed({ basePrompt: base(chars), medium: 'video', directorSpec: note }, { env: KEY, fetch: fetchMock as unknown as typeof fetch });
      expect(result.path).toBe('rewrite');
      const { system, payload } = wire(fetchMock);
      expect('promptBudgetChars' in payload).toBe(false);
      expect(system).not.toContain('LENGTH:');
    }
  });
});

describe('a compile that cannot fit says over_limit', () => {
  it('a rewrite over budget is tried again, then the fallback; still over: the template whole, its blocks kept, one warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const template = base(14_879);
    const fetchMock = vi.fn(async () => geminiJson(rewrite(SEEDANCE_25_PROMPT_CHARS + 200)));
    const result = await compileDirectorPromptDetailed({ basePrompt: template, medium: 'video', directorSpec: note }, { env: KEY, fetch: fetchMock as unknown as typeof fetch });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ prompt: template, path: 'over_limit' });
    expect(result.prompt).toContain(LOCKS);
    expect(result.prompt).toContain(STYLING);
    expect(warn.mock.calls.filter((call) => call[0] === DIRECTOR_OVER_ENGINE_LIMIT_LOG_TAG)).toHaveLength(1);
  });

  it('the deterministic paths say over_limit too, and `unchanged` still means nothing was asked', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const template = base(14_879);
    expect(await compileDirectorPromptDetailed({ basePrompt: template, medium: 'video', directorSpec: note }, { env: {} })).toEqual({ prompt: template, path: 'over_limit' });
    expect(await compileDirectorPromptDetailed({ basePrompt: template, medium: 'video' }, { env: {} })).toEqual({ prompt: template, path: 'unchanged' });
  });
});

describe('edit headroom', () => {
  it('is the verified limit less the compiled length, or nothing without a verified limit', () => {
    expect(editHeadroom('seedance-2.5', 14_000)).toBe(1_000);
    expect(editHeadroom('seedance-2.0', 14_000)).toBeNull();
    expect(editHeadroom('gpt-image-2', 100)).toBeNull();
  });

  it('closes edits on a 14,879-character template and leaves a 9,000-character one open', () => {
    const film = (chars: number) => ({ promptText: base(chars), medium: 'video', engine: 'seedance-2.5', runtimeSeconds: 10, cast: 'solo' as const });
    expect(templateEditsClosed(film(14_879))).toBe(true);
    expect(templateEditsClosed(film(9_000))).toBe(false);
    // The text the compile receives carries the render's identity line (the base names no photo).
    expect(templateEditHeadroom(film(9_000))[0]!.compiledChars).toBeGreaterThan(9_000);
    expect(templateEditsClosed({ ...film(14_879), engine: 'seedance-2.0' })).toBe(false);
  });

  it('is at least what the fullest edit adds on either deterministic path (re-measured from the caps)', async () => {
    const short = `Shot 1 (0-3s): she walks.\nShot 2 (3-6s): she turns.\n\n${STYLING}`;
    const t = (n: number, c: string) => `${c} ${'w'.repeat(n - 2)}`.slice(0, n);
    const refs = { hasOutfitRef: true, hasPropRef: true, hasSceneRef: true };
    let most = 0;
    for (const cast of ['solo', 'couple'] as const) {
      for (const bgmMood of PERSONAL_BGM_MOODS) {
        const sheet = {
          change: DIRECTOR_EDITABLE_SLOTS.map((slot, i) => ({ text: t(120, `c${i}`), slot, shots: { from: 1, to: 12 } })),
          keep: Array.from({ length: 6 }, (_, i) => t(120, `k${i}`)),
          exclude: Array.from({ length: 4 }, (_, i) => t(120, `e${i}`)),
        };
        const intent = {
          hairOverrideEn: t(400, 'h'), makeupOverrideEn: t(400, 'm'), outfitOverrideEn: t(600, 'o'), propOverrideEn: t(400, 'p'),
          shotEdits: [1, 2, 3, 4].map((n) => ({ shotIndex: n, actionEn: t(500, `s${n}`) })),
          strictExclusionsEn: Array.from({ length: 12 }, (_, i) => t(120, `x${i}`)),
        };
        const own = ['hair', 'makeup'] as ('hair' | 'makeup')[];
        const runs = [
          await compileDirectorPromptDetailed({ basePrompt: short, medium: 'video', cast, engine: 'seedance-2.0', directorSpec: { audioMode: 'bgm', bgmMood, sheet, own }, ...refs }, { env: { TWINGS_PERSONAL_EDIT_SHEET: 'on' } }),
          await compileDirectorPromptDetailed({ basePrompt: short, medium: 'video', cast, engine: 'seedance-2.0', directorSpec: { audioMode: 'bgm', bgmMood, structuredIntent: intent, own }, ...refs }, { env: {} }),
          await compileDirectorPromptDetailed({ basePrompt: short, medium: 'video', cast, engine: 'seedance-2.0', directorSpec: { audioMode: 'bgm', bgmMood, userMessage: t(1000, 'n'), own }, ...refs }, { env: {} }),
        ];
        for (const run of runs) most = Math.max(most, run.prompt.length - short.length);
      }
    }
    expect(most).toBeGreaterThan(3_000);
    expect(most).toBeLessThanOrEqual(EDIT_HEADROOM_MIN_CHARS);
  });
});

describe('the catalogue card', () => {
  const row = (promptText: string): PromptRow => ({
    audience: 'public', id: '11111111-1111-4111-8111-111111111111', slug: 'long-walk', source: 'yagi', authorId: null, authorHandle: null,
    status: 'published', models: ['seedance-2.5'], title: 'Long walk', titleKo: null, promptText, processMd: null, processMdKo: null,
    sourceUrl: null, textVisibility: 'pro', media: null, useCase: [], featured: false, medium: 'video', cast: 'solo', priceCents: 0, priceKrw: 0,
    price1080Cents: 0, price1080Krw: 0, runtimeSeconds: 10, engine: 'seedance-2.5', aspectDefault: '9:16', rejectReason: null, announcedAt: null,
    createdAt: null, publishedAt: null,
  }) as PromptRow;

  it('marks a template with no room for edits, and only that one', () => {
    expect(toPromptCard(row(base(14_879))).editsClosed).toBe(true);
    const open = toPromptCard(row(base(9_000)));
    expect('editsClosed' in open).toBe(false);
  });
});
