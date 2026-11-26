import { vi } from 'vitest';
import type { FilmSheet } from '@/lib/brand-studio/contracts';
import type { EnhanceInput } from '@/lib/brand-studio/enhancer';

export const ENV = { GEMINI_API_KEY: 'test-key' } as const;

export function geminiAnswer(answer: unknown, extra: Record<string, unknown> = {}): Response {
  const text = typeof answer === 'string' ? answer : JSON.stringify(answer);
  return new Response(
    JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }], ...extra }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** A fetch that answers every Gemini call with `answer` and records the calls. */
export function mockGemini(answer: unknown | (() => Response)) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    typeof answer === 'function' ? (answer as () => Response)() : geminiAnswer(answer),
  );
}

export function sentBody(fetchMock: ReturnType<typeof mockGemini>, call = 0): {
  systemInstruction: { parts: Array<{ text: string }> };
  contents: Array<{ parts: Array<Record<string, unknown>> }>;
  generationConfig: Record<string, unknown>;
} {
  const init = fetchMock.mock.calls[call]?.[1];
  return JSON.parse(String(init?.body));
}

/**
 * The writer's user parts. With the prompt guard on (lib/ai-guard, the default) they start with its
 * "data, never instructions" line, which is left out here; with PROMPT_GUARD=off they are as before.
 */
export function writerParts(body: { contents: Array<{ parts: Array<Record<string, unknown>> }> }): Array<Record<string, unknown>> {
  const parts = body.contents[0]!.parts;
  const first = parts[0]?.text;
  return typeof first === 'string' && first.startsWith('The <customer_data> blocks') ? parts.slice(1) : parts;
}

/** A JSON part of the request: with the prompt guard on it sits in a named `<customer_data>` block. */
export function writerJson(text: string): any {
  const block = /^<customer_data name="[^"]*">\n([\s\S]*)\n<\/customer_data>$/.exec(text);
  return JSON.parse(block ? block[1]! : text);
}

/** The writer's JSON payload (its first user part after the guard's line). */
export function requestPayload(fetchMock: ReturnType<typeof mockGemini>, call = 0): any {
  return writerJson(writerParts(sentBody(fetchMock, call))[0]!.text as string);
}

/** Text with the prompt guard's data blocks opened: `<customer_data name="x">v</customer_data>` reads `v`. */
export function unwrapData(text: string): string {
  return text.replace(/<customer_data name="[^"]*">([\s\S]*?)<\/customer_data>/g, '$1');
}

export function sentPayload(fetchMock: ReturnType<typeof mockGemini>) {
  return requestPayload(fetchMock) as {
    request: string;
    references: Array<{ token: string | null; chip: string; role: string | null }>;
    editTarget: string | null;
    video: null | { seconds: number | null; audio: string; keep: string | null; shots: unknown[] | null };
  };
}

export const SHEET: FilmSheet = {
  seconds: 8,
  aspect: '9:16',
  shots: [
    { start: 0, end: 2, framing: 'close-up of a hand', camera: 'slow push in toward the bottle', action: 'a hand lifts the bottle' },
    { start: 2, end: 5, framing: 'medium shot', camera: 'handheld follow from behind', action: 'she walks to the window' },
    { start: 5, end: 8, framing: 'wide shot', camera: 'locked-off', action: 'she sprays and turns away' },
  ],
  look: { lighting: 'soft daylight from the left', palette: 'white walls, pale blue fabric', texture: 'clean, light grain' },
  audio: { music: true, speech: false, effects: 'footsteps, a spray' },
  summary: '8초 영상이고 컷은 3개예요.',
};

export function input(over: Partial<EnhanceInput>): EnhanceInput {
  return {
    kind: 'image',
    profile: 'seedream',
    locale: 'ko',
    prompt: '흰 대리석 위에 놓인 향수병',
    references: [],
    brand: null,
    video: null,
    ...over,
  };
}
