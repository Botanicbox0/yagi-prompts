import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DIRECTOR_OVER_ENGINE_LIMIT_LOG_TAG,
  DIRECTOR_REWRITE_FALLBACK_LOG_TAG,
  TEMPLATE_KEEP_LINE_PREFIX,
  compileDirectorPromptDetailed,
  renderStylingBlock,
} from '@/lib/template-director';
import { SEEDANCE_25_PROMPT_CHARS } from '@/lib/engines/prompt-limits';

/**
 * Founder, 2026-11-25: Seedance 2.5 takes up to 15,000 characters per clip. What the personal compile hands over for a
 * clip must fit: a rewrite over the limit counts as a failed verification (retry, then the fallback), and a fallback
 * that still does not fit gives the template's own text back whole (`over_limit`), with one warning. Never cut, never without its
 * lock block. Filler text only (the repo is public).
 */

const KEY = { GEMINI_API_KEY: 'k' } as const;
const NOTE = 'Give her a black leather jacket in every shot.';
const LOCKS = ['Template locks:', `${TEMPLATE_KEEP_LINE_PREFIX}the product.`].join('\n');
const STYLING = renderStylingBlock([{ part: 'hair', from: 'template', note: 'a sleek low bun.' }]);

/** A film prompt of exactly `total` characters: shot lines of filler, then the template's lock and styling blocks. */
function base(total: number): string {
  const tail = `\n\n${LOCKS}\n\n${STYLING}`;
  const line = 'Shot: the camera holds on her as she walks down a quiet street at dusk.\n';
  const body = line.repeat(Math.ceil(total / line.length)).slice(0, total - tail.length).trimEnd();
  return `${body}${'.'.repeat(total - tail.length - body.length)}${tail}`;
}

const input = (basePrompt: string, extra: Record<string, unknown> = {}) => ({
  basePrompt,
  medium: 'video' as const,
  directorSpec: { userMessage: NOTE, audioMode: 'ambient' as const },
  ...extra,
});

function geminiJson(payload: unknown) {
  return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(payload) }] } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
const rewrite = (chars: number) => ({
  rewrittenPrompt: `Shot 1: she walks down a quiet street at dusk in a black leather jacket.\n${'Shot: the camera holds on her.\n'.repeat(Math.ceil(chars / 31))}`.slice(0, chars),
  preservedCameraAndLighting: true,
  preservedAudioRule: true,
  preservedIdentityStrictLock: true,
});

const overWarnings = (warn: { mock: { calls: unknown[][] } }) => warn.mock.calls.filter((call) => call[0] === DIRECTOR_OVER_ENGINE_LIMIT_LOG_TAG);

afterEach(() => vi.restoreAllMocks());

describe('the personal compile fits the clip it is for', () => {
  it('a 14,900-character template whose customised text would pass 15,000 goes whole with its blocks (over_limit)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const template = base(14_900);
    expect(template).toHaveLength(14_900);
    // Without a verified limit (Seedance 2.0 names none) the same compile is longer than Seedance 2.5 takes.
    const unguarded = await compileDirectorPromptDetailed(input(template, { engine: 'seedance-2.0' }), { env: {} });
    expect(unguarded.path).toBe('deterministic');
    expect(unguarded.prompt.length).toBeGreaterThan(SEEDANCE_25_PROMPT_CHARS);
    expect(overWarnings(warn)).toHaveLength(0);

    for (const engine of [{ engine: 'seedance-2.5' }, {}]) {
      warn.mockClear();
      const result = await compileDirectorPromptDetailed(input(template, engine), { env: {} });
      expect(result).toEqual({ prompt: template, path: 'over_limit' });
      expect(result.prompt).toContain(LOCKS);
      expect(result.prompt).toContain(STYLING);
      expect(overWarnings(warn)).toHaveLength(1);
      expect(overWarnings(warn)[0]![1]).toEqual({ engine: 'engine' in engine ? 'seedance-2.5' : null, chars: unguarded.prompt.length });
    }
  });

  it('treats a rewrite over the limit as a failed verification: tries again, then the fallback', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const template = base(2_000);
    const fetchMock = vi.fn(async () => geminiJson(rewrite(SEEDANCE_25_PROMPT_CHARS + 200)));
    const result = await compileDirectorPromptDetailed(input(template, { engine: 'seedance-2.5' }), { env: KEY, fetch: fetchMock as unknown as typeof fetch });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.path).toBe('deterministic_fallback');
    expect(result.prompt.length).toBeLessThanOrEqual(SEEDANCE_25_PROMPT_CHARS);
    expect(result.prompt).toContain(LOCKS);
    const fallbackLine = warn.mock.calls.map((call) => call.map(String).join(' ')).find((line) => line.startsWith(DIRECTOR_REWRITE_FALLBACK_LOG_TAG));
    expect(fallbackLine).toContain('stage2_prompt_verification_failed:over_engine_limit');
    expect(overWarnings(warn)).toHaveLength(0);
  });

  it('keeps a rewrite that fits', async () => {
    const fetchMock = vi.fn(async () => geminiJson(rewrite(3_000)));
    const result = await compileDirectorPromptDetailed(input(base(2_000)), { env: KEY, fetch: fetchMock as unknown as typeof fetch });
    expect(result.path).toBe('rewrite');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.prompt.length).toBeLessThanOrEqual(SEEDANCE_25_PROMPT_CHARS);
  });

  it('gives the template back whole (over_limit) when neither the rewrite nor the fallback fits', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const template = base(14_900);
    const fetchMock = vi.fn(async () => geminiJson(rewrite(SEEDANCE_25_PROMPT_CHARS + 200)));
    const result = await compileDirectorPromptDetailed(input(template), { env: KEY, fetch: fetchMock as unknown as typeof fetch });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ prompt: template, path: 'over_limit' });
    expect(overWarnings(warn)).toHaveLength(1);
  });

  it('holds no image, and no engine without a verified limit, to Seedance 2.5', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const template = base(14_900);
    const image = await compileDirectorPromptDetailed({ ...input(template), medium: 'image' }, { env: {} });
    expect(image.path).toBe('deterministic');
    const other = await compileDirectorPromptDetailed(input(template, { engine: 'kling-omni' }), { env: {} });
    expect(other.path).toBe('deterministic');
    expect(other.prompt.length).toBeGreaterThan(SEEDANCE_25_PROMPT_CHARS);
  });
});
