import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DIRECTOR_BUDGET_FROM_SHARE,
  DIRECTOR_BUDGET_MARGIN_CHARS,
  DIRECTOR_EDITABLE_SLOTS,
  DIRECTOR_OVER_ENGINE_LIMIT_LOG_TAG,
  PERSONAL_BGM_MOODS,
  TEMPLATE_KEEP_LINE_PREFIX,
  compileDirectorPromptDetailed,
  deterministicDirectorPrompt,
  parseTemplateLocks,
  parseTemplateStyling,
  renderStylingBlock,
} from '@/lib/template-director';
import { EDIT_HEADROOM_MIN_CHARS, SEEDANCE_25_PROMPT_CHARS, editHeadroom } from '@/lib/engines/prompt-limits';
import { editFit, templateCompileClips, templateEditHeadroom, templateEditRoom, templateEditsClosed } from '@/lib/prompts/prompt-length';
import type { PersonalDirectorSpec } from '@/lib/template-director/schema';
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

  it('the floor is one "내 사진 그대로" switch at its largest (re-measured: 120-character styled lines, solo as the render compiles)', () => {
    const tail = (c: string) => `${c} ${'w'.repeat(117)}.`.slice(0, 120);
    const styled = renderStylingBlock([{ part: 'hair', from: 'template', note: tail('h') }, { part: 'makeup', from: 'template', note: tail('m') }, { part: 'outfit', from: 'template', note: tail('o') }]);
    const short = `Shot 1 (0-3s): @Image 1 walks.\nShot 2 (3-6s): she turns.\n\n${styled}`;
    let most = 0;
    for (const cast of ['solo'] as const) {
      for (const part of ['hair', 'makeup'] as const) {
        const out = deterministicDirectorPrompt({ basePrompt: short, medium: 'video', cast, hasPersonSlot: true, directorSpec: { audioMode: 'ambient', own: [part] } as PersonalDirectorSpec }, {});
        most = Math.max(most, out.length - short.length);
      }
    }
    expect(most).toBeGreaterThan(600);
    expect(most).toBeLessThanOrEqual(EDIT_HEADROOM_MIN_CHARS);
    expect(EDIT_HEADROOM_MIN_CHARS - most).toBeLessThan(150);
  });
});

/** A seeded generator, so the property run is the same every time. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe('the per-request fit check', () => {
  const template = (chars: number) => ({ promptText: base(chars), medium: 'video', engine: 'seedance-2.5', runtimeSeconds: 10, cast: 'solo' as const });
  const SHEET_ON = { TWINGS_PERSONAL_EDIT_SHEET: 'on' } as const;
  const t = (n: number, c: string) => `${c} ${'w'.repeat(Math.max(0, n - 2))}`.slice(0, n);

  function spec(next: () => number): { spec: PersonalDirectorSpec; refs: { hasOutfitRef: boolean; hasPropRef: boolean; hasSceneRef: boolean }; env: Record<string, string> } {
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
    const own = (['hair', 'makeup'] as const).filter(() => next() < 0.4);
    const bgm = next() < 0.3;
    const audio = { audioMode: bgm ? 'bgm' : 'ambient', bgmMood: bgm ? pick(PERSONAL_BGM_MOODS) : null } as const;
    const refs = { hasOutfitRef: next() < 0.2, hasPropRef: next() < 0.2, hasSceneRef: next() < 0.2 };
    const kind = pick(['sheet', 'note', 'chips', 'own'] as const);
    if (kind === 'sheet') {
      const sheet = {
        change: Array.from({ length: Math.floor(next() * 7) }, (_, i) => ({ text: t(1 + Math.floor(next() * 120), `c${i}`), slot: pick(DIRECTOR_EDITABLE_SLOTS) })),
        keep: Array.from({ length: Math.floor(next() * 7) }, (_, i) => t(1 + Math.floor(next() * 120), `k${i}`)),
        exclude: Array.from({ length: Math.floor(next() * 5) }, (_, i) => t(1 + Math.floor(next() * 120), `e${i}`)),
      };
      return { spec: { ...audio, sheet, own } as PersonalDirectorSpec, refs, env: SHEET_ON };
    }
    if (kind === 'note') return { spec: { ...audio, userMessage: t(1 + Math.floor(next() * 1000), 'n'), own } as PersonalDirectorSpec, refs, env: {} };
    if (kind === 'chips') {
      const chips = DIRECTOR_EDITABLE_SLOTS.filter(() => next() < 0.5).map((slot) => ({ slot, labelKo: slot, summaryKo: t(1 + Math.floor(next() * 200), 's') }));
      return { spec: { ...audio, summaryChips: chips, own } as PersonalDirectorSpec, refs, env: {} };
    }
    return { spec: { ...audio, own: own.length ? own : ['hair'] } as PersonalDirectorSpec, refs, env: {} };
  }

  it('any edit it accepts compiles, on the deterministic path and after a failed rewrite, to the same text within the limit', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const next = rng(20261125);
    const failing = vi.fn(async () => new Response('down', { status: 500 }));
    let accepted = 0, refused = 0;
    for (const chars of [13_854, 14_000, 14_300, 14_600, 14_879, 14_920, 9_000]) {
      const input = template(chars);
      const clip = templateCompileClips(input)[0]!;
      for (let i = 0; i < 40; i += 1) {
        const { spec: s, refs, env } = spec(next);
        const fit = editFit(input, s, refs, env);
        if (templateEditsClosed(input) || !fit.fits) { refused += 1; continue; }
        accepted += 1;
        const render = { basePrompt: clip.base, medium: 'video' as const, cast: 'solo' as const, hasPersonSlot: true, ...refs, directorSpec: s };
        const deterministic = await compileDirectorPromptDetailed(render, { env });
        const fallback = await compileDirectorPromptDetailed(render, { env: { ...env, ...KEY }, fetch: failing as unknown as typeof fetch });
        for (const out of [deterministic, fallback]) {
          expect(out.path).not.toBe('over_limit');
          expect(out.prompt.length).toBeLessThanOrEqual(SEEDANCE_25_PROMPT_CHARS);
          expect(out.prompt.length).toBe(fit.clips[0]!.chars);
          expect(out.prompt).toContain(LOCKS);
        }
      }
    }
    expect(accepted).toBeGreaterThan(20);
    expect(refused).toBeGreaterThan(20);
  });

  it('measures what an edit adds: a short one fits a 13,854-character template, a long one does not', () => {
    const input = template(13_854);
    expect(editFit(input, { audioMode: 'ambient', userMessage: 'Give her a black leather jacket.' } as PersonalDirectorSpec).fits).toBe(true);
    expect(editFit(input, { audioMode: 'bgm', bgmMood: 'cinematic', userMessage: t(1000, 'n') } as PersonalDirectorSpec).fits).toBe(false);
  });
});

describe('the three templates the founder named (a three-line styling block)', () => {
  const three = renderStylingBlock([
    { part: 'hair', from: 'template', note: 'a sleek low bun with a centre part.' },
    { part: 'makeup', from: 'template', note: 'soft rosy cheeks and a glossy lip.' },
    { part: 'outfit', from: 'template', note: 'a cream knit cardigan over a white tee.' },
  ]);
  const text = (chars: number, namesPhoto: boolean) => {
    const head = namesPhoto ? 'Shot 1 (0-3s): @Image 1 walks down a quiet street at dusk.\n' : 'Shot 1 (0-3s): she walks down a quiet street at dusk.\n';
    const tail = `\n\n${three}`;
    return `${head}${'x'.repeat(chars - head.length - tail.length)}${tail}`;
  };
  it.each([14_879, 14_920, 13_854])('%i characters', (chars) => {
    for (const namesPhoto of [false, true]) {
      const input = { promptText: text(chars, namesPhoto), medium: 'video', engine: 'seedance-2.5', runtimeSeconds: 10, cast: 'solo' as const };
      const room = templateEditRoom(input)!;
      const closed = templateEditsClosed(input);
      const hairFits = editFit(input, { audioMode: 'ambient', own: ['hair'] } as PersonalDirectorSpec).fits;
      console.log(`FOUNDER ${chars} namesPhoto=${namesPhoto} headroom=${room.headroom} closed=${closed} own=${JSON.stringify(room.own)} hairSwitchFits=${hairFits}`);
      expect(closed).toBe(room.headroom < EDIT_HEADROOM_MIN_CHARS);
    }
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
    expect('editRoom' in open).toBe(false);
  });

  it('carries the room numbers only when not every "내 사진 그대로" switch fits together', () => {
    const tight = toPromptCard(row(base(13_854)));
    expect('editsClosed' in tight).toBe(false);
    const room = tight.editRoom!;
    expect(room.headroom).toBe(SEEDANCE_25_PROMPT_CHARS - templateCompileClips({ promptText: base(13_854), medium: 'video', engine: 'seedance-2.5', runtimeSeconds: 10 })[0]!.base.length);
    expect(room.own.hair! + room.own.makeup!).toBeGreaterThan(room.headroom);
    expect(Math.min(room.own.hair!, room.own.makeup!)).toBeLessThanOrEqual(room.headroom);
    // Names and numbers only.
    expect(JSON.stringify(room)).not.toMatch(/bun|cheeks|Shot/);
  });
});
