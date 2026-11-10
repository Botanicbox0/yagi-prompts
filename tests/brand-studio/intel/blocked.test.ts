import { describe, expect, it } from 'vitest';
import { rewriteBlockedPrompt } from '@/lib/brand-studio/enhancer/blocked';

const env = { GEMINI_API_KEY: 'test-key' };
const input = { kind: 'video_remix' as const, profile: 'seedance' as const, prompt: 'Follow @Video1 for the camera path; the model shows bare shoulders, shoot it like a killer ad with @Image1.' };

/** A Gemini endpoint that answers with `answer` as its JSON text and records the request. */
function gemini(answer: unknown, status = 200) {
  const calls: Array<{ system: string; user: string }> = [];
  const doFetch = (async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ system: body.systemInstruction.parts[0].text, user: body.contents[0].parts[0].text });
    if (status !== 200) return new Response('no', { status });
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(answer) }] } }] }), { status: 200 });
  }) as typeof fetch;
  return { doFetch, calls };
}

describe('rewriteBlockedPrompt', () => {
  it('returns the rewritten wording when the references are intact', async () => {
    const rewritten = 'Follow @Video1 for the camera path; the model wears a sleeveless top, film it like a striking ad with @Image1.';
    const { doFetch, calls } = gemini({ decision: 'rewrite', prompt: rewritten });
    expect(await rewriteBlockedPrompt(input, { fetch: doFetch, env })).toEqual({ action: 'retry', prompt: rewritten, source: 'model' });
    // The prompt travels as data in the user turn, never inside the rules.
    expect(calls[0]!.system).not.toContain('bare shoulders');
    expect(JSON.parse(calls[0]!.user).prompt).toBe(input.prompt);
  });

  it('does not retry what the review exists to stop', async () => {
    const { doFetch } = gemini({ decision: 'stop', prompt: '' });
    expect(await rewriteBlockedPrompt(input, { fetch: doFetch, env })).toEqual({ action: 'stop' });
  });

  it('keeps the original when a rewrite drops or renumbers a reference', async () => {
    for (const prompt of ['The model wears a sleeveless top in a striking ad.', 'Follow @Video2 for the camera path with @Image1.']) {
      const { doFetch } = gemini({ decision: 'rewrite', prompt });
      expect(await rewriteBlockedPrompt(input, { fetch: doFetch, env })).toEqual({ action: 'retry', prompt: input.prompt, source: 'same' });
    }
  });

  it('tries the same words again when Gemini is unreachable, answers badly, or no key is set', async () => {
    const same = { action: 'retry', prompt: input.prompt, source: 'same' };
    const reasons: string[] = [];
    expect(await rewriteBlockedPrompt(input, { fetch: gemini({}, 503).doFetch, env, onFallback: (r) => reasons.push(r) })).toEqual(same);
    expect(reasons).toEqual(['gemini_http_503']);
    expect(await rewriteBlockedPrompt(input, { fetch: gemini({ decision: 'maybe' }).doFetch, env })).toEqual(same);
    expect(await rewriteBlockedPrompt(input, { fetch: gemini({ decision: 'rewrite', prompt: '' }).doFetch, env })).toEqual(same);
    const offline = gemini({ decision: 'stop', prompt: '' });
    expect(await rewriteBlockedPrompt(input, { fetch: offline.doFetch, env: {} })).toEqual(same);
    expect(offline.calls).toHaveLength(0);
  });

  it('never tells the model to disguise anything', async () => {
    const { doFetch, calls } = gemini({ decision: 'rewrite', prompt: input.prompt });
    await rewriteBlockedPrompt(input, { fetch: doFetch, env });
    const rules = calls[0]!.system;
    expect(rules).toContain('Never disguise anything');
    expect(rules).toContain('will be reviewed again');
    expect(rules).toContain('Never change anyone\'s age');
  });

  it('has nothing to retry for an empty prompt', async () => {
    const { doFetch, calls } = gemini({ decision: 'rewrite', prompt: 'x' });
    expect(await rewriteBlockedPrompt({ ...input, prompt: '   ' }, { fetch: doFetch, env })).toEqual({ action: 'stop' });
    expect(calls).toHaveLength(0);
  });
});
