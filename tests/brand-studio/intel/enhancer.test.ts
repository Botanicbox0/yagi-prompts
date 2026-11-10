import { describe, expect, it, vi } from 'vitest';
import { enhancePrompt, type EnhanceInput } from '@/lib/brand-studio/enhancer';
import { ENV, SHEET, geminiAnswer, input, mockGemini, sentBody, sentPayload } from './helpers';

const NOTE = '병의 재질과 빛의 방향을 구체적으로 적었어요.';

interface Case {
  name: string;
  input: EnhanceInput;
  /** What a well-behaved model returns for it. */
  answer: string;
  system: RegExp[];
  request: string;
  /** Lines that must be in the final prompt. */
  final: RegExp[];
  absent?: RegExp[];
}

const CASES: Case[] = [
  {
    name: 'seedream × image',
    input: input({
      prompt: '이미지 1의 병을 이미지 2의 빛으로',
      references: [
        { index: 1, kind: 'image', label: '이미지 1', role: 'product' },
        { index: 2, kind: 'image', label: '이미지 2', role: 'style' },
      ],
    }),
    answer:
      'A clear glass perfume bottle from Figure 1 stands upright on white marble; keep the exact label, proportions and colours of Figure 1. Take only the soft side light and pale palette from Figure 2, not its subject. The camera sits at bottle height, the bottle fills the centre third, the background falls out of focus. Calm and bright.',
    system: [/"Figure N"/, /60 to 140 words/, /new still image/],
    request: 'Figure 1의 병을 Figure 2의 빛으로',
    final: [/Figure 1/, /Figure 2/, /keep the exact label, proportions and colours of Figure 1/],
  },
  {
    name: 'seedream × region_edit',
    input: input({
      kind: 'region_edit',
      prompt: '라벨을 이미지 1 로고로 바꿔 주세요',
      references: [{ index: 1, kind: 'image', label: '이미지 1', role: 'logo' }],
    }),
    answer:
      'In Figure 1, change only the label so it carries the exact mark from Figure 2, printed flat on the curved glass at the same size; do not move or resize anything else. Keep the light, reflections and grain of Figure 1.',
    system: [/In Figure 1, change only/, /do not move or resize anything else/],
    request: '라벨을 Figure 2 로고로 바꿔 주세요',
    final: [/In Figure 1, change only/, /Figure 2/, /do not move or resize anything else/],
  },
  {
    name: 'nano-banana × image',
    input: input({
      profile: 'nano-banana',
      prompt: '이미지 1 병을 대리석 위에',
      references: [{ index: 1, kind: 'image', label: '이미지 1', role: 'product' }],
    }),
    answer:
      'Using image 1, place the bottle upright on a white marble slab in soft morning light from the left. Keep the bottle\'s exact shape, label, proportions and colours.',
    system: [/Using image 1/, /keep-list/],
    request: 'image 1 병을 대리석 위에',
    final: [/^Using image 1/, /Keep/],
  },
  {
    name: 'nano-banana × region_edit (missing guard line is added)',
    input: input({
      profile: 'nano-banana',
      kind: 'region_edit',
      prompt: '흐린 로고를 이미지 1 로고로 선명하게',
      references: [{ index: 1, kind: 'image', label: '이미지 1', role: 'logo' }],
    }),
    answer:
      'Using image 1, change only the blurred mark on the bottle: print the exact mark from image 2 at the same size and angle. Keep the glass, reflections, light direction and grain of image 1.',
    system: [/Using image 1, change only/, /do not move or resize anything else/, /image 2 is a source/],
    request: '흐린 로고를 image 2 로고로 선명하게',
    final: [/image 1/, /image 2/, /do not move or resize anything else/i],
  },
  {
    name: 'seedance × video (ambient line is added)',
    input: input({
      profile: 'seedance',
      kind: 'video',
      prompt: '이미지 1 향수병을 손이 들어 올리는 장면',
      references: [{ index: 1, kind: 'image', label: '이미지 1', role: 'product' }],
      video: { seconds: 8, aspect: '9:16', audio: 'ambient' },
    }),
    answer: [
      '@Image1 supplies only the bottle: its exact shape, label and colours.',
      'Visual style: a pale room in soft daylight from the left, clean picture with light grain.',
      '0.0–3.0s: Close-up, a hand already reaching in lifts the bottle; slow push in from the base to the label. Hard cut.',
      '3.0–8.0s: Medium shot, she turns the bottle toward the window; locked-off. Continuous.',
      'The last frame: the bottle in her hand against the bright window.',
      'Audio: footsteps on wood, a soft spray.',
    ].join('\n'),
    system: [/@Image1/, /"Audio:"/, /Length: 8 seconds/, /no music, only location sound and effects/],
    request: '@Image1 향수병을 손이 들어 올리는 장면',
    final: [/@Image1/, /0\.0–3\.0s/, /no music, only location sound and effects/],
  },
  {
    name: 'seedance × video_remix reference',
    input: input({
      profile: 'seedance',
      kind: 'video_remix',
      prompt: '영상 1처럼, 병은 이미지 1로',
      references: [
        { index: 1, kind: 'video', label: '영상 1' },
        { index: 2, kind: 'image', label: '이미지 1', role: 'product' },
      ],
      video: { seconds: null, aspect: '9:16', audio: 'native', method: 'reference', keep: ['camera', 'timing'], change: '병만 우리 제품으로', sheet: SHEET },
    }),
    answer: [
      'Follow @Video1 for the camera path and the cut timing; replace the bottle with the bottle from @Image1; keep the room and the light.',
      '@Image1 supplies only the bottle: its exact shape, label and colours.',
      'Visual style: pale room, soft daylight from the left.',
      '0.0–2.0s: Close-up, a hand lifts the bottle; slow push in toward it. Hard cut.',
      '2.0–5.0s: Medium shot, she walks to the window; handheld follow from behind. Hard cut.',
      '5.0–8.0s: Wide shot, she sprays and turns away; locked-off.',
      'The last frame: the empty window light.',
      'Audio: footsteps, a soft spray, quiet music that fits the mood.',
    ].join('\n'),
    system: [/Follow @Video1 for the camera path and the cut timing/, /Use exactly these ranges/, /video\.change/],
    request: '@Video1처럼, 병은 @Image1로',
    final: [/Follow @Video1/, /@Image1/, /Audio:/],
  },
  {
    name: 'seedance × video_remix edit (silent drops the sound line)',
    input: input({
      profile: 'seedance',
      kind: 'video_remix',
      prompt: '라벨 색만 파랗게',
      references: [{ index: 1, kind: 'video', label: '영상 1' }],
      video: { seconds: null, aspect: '9:16', audio: 'silent', method: 'edit', keep: [], change: '라벨 색만 파랗게', sheet: SHEET },
    }),
    answer: 'In @Video1, change only the label colour to a deep blue; everything else stays as it is.\nAudio: footsteps.',
    system: [/In @Video1, change only/, /Write no Audio line/],
    request: '라벨 색만 파랗게',
    final: [/In @Video1, change only/, /everything else stays as it is/],
    absent: [/Audio:/],
  },
];

describe('enhancePrompt — profile × kind with a well-behaved model', () => {
  it.each(CASES)('$name', async (c) => {
    const fetchMock = mockGemini({ prompt: c.answer, notes: NOTE });
    const result = await enhancePrompt(c.input, { fetch: fetchMock as unknown as typeof fetch, env: ENV });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const system = sentBody(fetchMock).systemInstruction.parts[0]!.text;
    for (const re of c.system) expect(system).toMatch(re);
    expect(system).not.toContain(c.input.prompt);
    expect(sentPayload(fetchMock).request).toBe(c.request);

    expect(result.source).toBe('model');
    expect(result.notes).toBe(NOTE);
    for (const re of c.final) expect(result.prompt).toMatch(re);
    for (const re of c.absent ?? []) expect(result.prompt).not.toMatch(re);
  });
});

describe('enhancePrompt — request', () => {
  it('calls generateContent with JSON output, a schema and the key header', async () => {
    const fetchMock = mockGemini({ prompt: CASES[0]!.answer, notes: NOTE });
    await enhancePrompt(CASES[0]!.input, { fetch: fetchMock as unknown as typeof fetch, env: ENV });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
    const body = sentBody(fetchMock);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseJsonSchema).toMatchObject({ required: ['prompt', 'notes'] });
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
  });

  it('honours BRAND_STUDIO_ENHANCER_MODEL and GEMINI_BASE_URL', async () => {
    const fetchMock = mockGemini({ prompt: CASES[0]!.answer, notes: NOTE });
    await enhancePrompt(CASES[0]!.input, {
      fetch: fetchMock as unknown as typeof fetch,
      env: { ...ENV, BRAND_STUDIO_ENHANCER_MODEL: 'gemini-3.9-flash', GEMINI_BASE_URL: 'https://proxy.example/v1beta/' },
    });
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://proxy.example/v1beta/models/gemini-3.9-flash:generateContent');
  });

  it('sends at most four reference pictures, each labelled with its token', async () => {
    const thumb = { bytes: new Uint8Array([1, 2, 3]), mime: 'image/jpeg' };
    const references = [1, 2, 3, 4, 5].map((i) => ({ index: i, kind: 'image' as const, label: `이미지 ${i}`, thumb }));
    const fetchMock = mockGemini({ prompt: 'Figure 1 to Figure 5 arranged in a row on a table, soft daylight.', notes: NOTE });
    await enhancePrompt(input({ prompt: '다섯 개를 나란히', references }), { fetch: fetchMock as unknown as typeof fetch, env: ENV });
    const parts = sentBody(fetchMock).contents[0]!.parts;
    expect(parts.filter((p) => 'inlineData' in p)).toHaveLength(4);
    expect(parts[1]).toMatchObject({ text: expect.stringContaining('Figure 1') });
  });

  it('gives the remix the reference shots fitted to the output length', async () => {
    const fetchMock = mockGemini({ prompt: CASES[5]!.answer, notes: NOTE });
    const remix = CASES[5]!.input;
    await enhancePrompt({ ...remix, video: { ...remix.video!, seconds: 12 } }, { fetch: fetchMock as unknown as typeof fetch, env: ENV });
    const shots = sentPayload(fetchMock).video!.shots as Array<{ start: number; end: number }>;
    expect(shots[0]!.start).toBe(0);
    expect(shots[shots.length - 1]!.end).toBe(12);
    expect(shots[1]!.start).toBe(shots[0]!.end);
    expect(shots[0]!.end).toBe(3);
  });
});

describe('enhancePrompt — output checks', () => {
  const base = CASES[0]!;
  const run = async (prompt: string, over: Partial<EnhanceInput> = {}, notes = NOTE) => {
    const reasons: string[] = [];
    const fetchMock = mockGemini({ prompt, notes });
    const result = await enhancePrompt(
      { ...base.input, ...over },
      { fetch: fetchMock as unknown as typeof fetch, env: ENV, onFallback: (r) => reasons.push(r) },
    );
    return { result, reasons };
  };

  it('removes filler praise and names light by its look, not its equipment', async () => {
    const { result } = await run(`${base.answer} A stunning 8k masterpiece lit by a large softbox on the left.`);
    expect(result.source).toBe('model');
    expect(result.prompt).not.toMatch(/stunning|8k|masterpiece|softbox/i);
    expect(result.prompt).toMatch(/broad soft light on the left/);
  });

  it.each([
    ['an internal word', `${base.answer} Rendered through Sunra.`, 'internal_term'],
    ['a template slot', `${base.answer} {{selfie}}`, 'internal_term'],
    ['a camera brand', `${base.answer} Shot on Kodak Portra.`, 'brand_name'],
    ['a reference that does not exist', `${base.answer} Add the cup from Figure 5.`, 'unknown_token'],
    ['no reference at all', 'A glass bottle on marble in soft light, calm.', 'lost_references'],
    ['a dropped mention', 'A glass bottle from Figure 1 on marble; keep the exact label, proportions and colours of Figure 1.', 'lost_mentioned_reference'],
    ['too short', 'Figure 1', 'too_short'],
    ['too long', `${base.answer} ${'x'.repeat(6100)}`, 'too_long'],
  ])('falls back on %s', async (_label, prompt, reason) => {
    const { result, reasons } = await run(prompt);
    expect(result.source).toBe('fallback');
    expect(reasons).toEqual([reason]);
    expect(result.prompt).toContain('Figure 1');
  });

  it('lets a word through when the customer wrote it', async () => {
    const { result } = await run(`${base.answer} The Gemini Coffee cup sits beside it.`, {
      prompt: '이미지 1의 병을 이미지 2의 빛으로, Gemini Coffee 컵 옆에',
    });
    expect(result.source).toBe('model');
  });

  it('keeps one sentence of notes in the customer language', async () => {
    const two = await run(base.answer, {}, `${NOTE} 그리고 배경도 정리했어요.`);
    expect(two.result.notes).toBe(NOTE);
    const english = await run(base.answer, {}, 'Made the light specific.');
    expect(english.result.notes).toMatch(/[가-힣]/);
    const en = await run(base.answer, { locale: 'en' }, 'Made the light and the marble specific.');
    expect(en.result.notes).toBe('Made the light and the marble specific.');
  });

  it('refuses music written into an ambient video', async () => {
    const reasons: string[] = [];
    const fetchMock = mockGemini({ prompt: `${CASES[4]!.answer}\nSoft piano music rises at the end.`, notes: NOTE });
    const result = await enhancePrompt(CASES[4]!.input, {
      fetch: fetchMock as unknown as typeof fetch,
      env: ENV,
      onFallback: (r) => reasons.push(r),
    });
    expect(result.source).toBe('fallback');
    expect(reasons).toEqual(['music_in_ambient']);
    expect(result.prompt).toMatch(/no music, only location sound and effects/);
  });

  it('refuses a remix that no longer names the reference video', async () => {
    const reasons: string[] = [];
    const fetchMock = mockGemini({ prompt: '@Image1 supplies only the bottle.\nA hand lifts the bottle by the window.\nAudio: footsteps.', notes: NOTE });
    const result = await enhancePrompt(CASES[5]!.input, {
      fetch: fetchMock as unknown as typeof fetch,
      env: ENV,
      onFallback: (r) => reasons.push(r),
    });
    expect(reasons).toEqual(['lost_reference_video']);
    expect(result.prompt).toMatch(/^Follow @Video1/);
  });

  it('writes tokens one way and enhances a remix whose words are all in "change"', async () => {
    const remix = CASES[5]!.input;
    const fetchMock = mockGemini({ prompt: CASES[5]!.answer.replace('@Image1;', '@image 1;'), notes: NOTE });
    const result = await enhancePrompt(
      { ...remix, prompt: '', video: { ...remix.video!, change: '병을 이미지 1 제품으로' } },
      { fetch: fetchMock as unknown as typeof fetch, env: ENV },
    );
    expect(result.source).toBe('model');
    expect(result.prompt).not.toMatch(/@image 1/);
    expect(result.prompt).toContain('from @Image1;');
    expect((sentPayload(fetchMock).video as unknown as { change: string }).change).toBe('병을 @Image1 제품으로');
  });

  it('refuses tokens on a video with only an opening frame (no reference endpoint)', async () => {
    const reasons: string[] = [];
    const fetchMock = mockGemini({ prompt: '@Image1 opens; the hand lifts the bottle.\nAudio: a soft spray.', notes: NOTE });
    const result = await enhancePrompt(
      input({
        profile: 'seedance',
        kind: 'video',
        prompt: '병을 들어 올린다',
        references: [{ index: 1, kind: 'image', label: '이미지 1', frame: 'start' }],
        video: { seconds: 5, aspect: '9:16', audio: 'native' },
      }),
      { fetch: fetchMock as unknown as typeof fetch, env: ENV, onFallback: (r) => reasons.push(r) },
    );
    expect(reasons).toEqual(['token_without_reference']);
    expect(result.prompt).not.toMatch(/@Image/);
  });
});

describe('enhancePrompt — never throws, always falls back', () => {
  const c = CASES[0]!;
  const failing: Array<[string, () => Response | Promise<Response>, string]> = [
    ['http 500', () => new Response('nope', { status: 500 }), 'gemini_http_500'],
    ['http 429', () => new Response('slow down', { status: 429 }), 'gemini_http_429'],
    ['not JSON', () => geminiAnswer('this is not json'), 'bad_json'],
    ['wrong shape', () => geminiAnswer({ text: 'hello' }), 'bad_shape'],
    ['blocked', () => geminiAnswer({ prompt: c.answer, notes: NOTE }, { promptFeedback: { blockReason: 'SAFETY' } }), 'gemini_blocked'],
    [
      'cut off',
      () =>
        new Response(JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"prompt":"A' }] } }] }), {
          status: 200,
        }),
      'gemini_finish_max_tokens',
    ],
    ['no candidates', () => new Response(JSON.stringify({ candidates: [] }), { status: 200 }), 'gemini_no_candidate'],
    ['network error', () => Promise.reject(new TypeError('fetch failed')), 'request_failed'],
  ];

  it.each(failing)('%s', async (_label, respond, reason) => {
    const reasons: string[] = [];
    const fetchMock = vi.fn(async () => respond());
    const result = await enhancePrompt(c.input, {
      fetch: fetchMock as unknown as typeof fetch,
      env: ENV,
      onFallback: (r) => reasons.push(r),
    });
    expect(result.source).toBe('fallback');
    expect(reasons).toEqual([reason]);
    expect(result.prompt).toContain('Figure 1');
    expect(result.notes).toMatch(/[가-힣]/);
  });

  it('does not call the network without a key', async () => {
    const fetchMock = vi.fn();
    const result = await enhancePrompt(c.input, { fetch: fetchMock as unknown as typeof fetch, env: {} });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.source).toBe('fallback');
  });

  it('survives a throwing logger', async () => {
    const result = await enhancePrompt(c.input, {
      fetch: vi.fn() as unknown as typeof fetch,
      env: {},
      onFallback: () => {
        throw new Error('logger down');
      },
    });
    expect(result.source).toBe('fallback');
  });
});
