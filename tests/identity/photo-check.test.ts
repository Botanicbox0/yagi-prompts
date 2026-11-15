import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  PHOTO_CHECK_SCHEMA, PHOTO_CHECK_SYSTEM, photoCheckConfigFromEnv, photoCheckerFromEnv, photoVerdict, readPhotoFacts, type PhotoFacts,
} from '@/lib/identity/photo-check';
import { parsePhotoCheck } from '@/lib/identity/photo-check-view';

/**
 * The advisory photo check: the model reports photo facts, the server derives the verdict, and any
 * failure is "no result" (null) — never an exception and never a block (AGENTS.md §5).
 */
const GOOD: PhotoFacts = { faceCount: 1, realPerson: true, faceCover: ['none'], angle: 'front', sharpness: 'sharp', lighting: 'even', faceSize: 'ok' };
const facts = (over: Partial<PhotoFacts>): PhotoFacts => ({ ...GOOD, ...over });

describe('photo verdict rules', () => {
  it('a clear single front face is good', () => {
    expect(photoVerdict(GOOD)).toEqual({ status: 'good', issues: [] });
  });

  it('no face reports nothing else', () => {
    expect(photoVerdict(facts({ faceCount: 0, realPerson: false, faceCover: ['mask'], sharpness: 'blurry', angle: 'side', lighting: 'dark', faceSize: 'small' })))
      .toEqual({ status: 'retake', issues: ['no_face'] });
  });

  it.each([
    [{ faceCount: 2 }, 'multiple_faces'],
    [{ faceCount: 5 }, 'multiple_faces'],
    [{ realPerson: false }, 'not_real_person'],
    [{ faceCover: ['mask'] }, 'face_covered'],
    [{ faceCover: ['sunglasses'] }, 'face_covered'],
    [{ faceCover: ['hand'] }, 'face_covered'],
    [{ faceCover: ['object'] }, 'face_covered'],
    [{ sharpness: 'blurry' }, 'blurry'],
  ] as Array<[Partial<PhotoFacts>, string]>)('%o asks for another photo (%s)', (over, issue) => {
    expect(photoVerdict(facts(over))).toEqual({ status: 'retake', issues: [issue] });
  });

  it.each([
    [{ angle: 'side' }, 'side_angle'],
    [{ angle: 'tilted' }, 'side_angle'],
    [{ lighting: 'dark' }, 'dark'],
    [{ lighting: 'backlit' }, 'backlit'],
    [{ faceSize: 'small' }, 'small_face'],
  ] as Array<[Partial<PhotoFacts>, string]>)('%o is worth a look (%s)', (over, issue) => {
    expect(photoVerdict(facts(over))).toEqual({ status: 'check', issues: [issue] });
  });

  it('turned, soft, harsh, close, hair and hat are not issues', () => {
    for (const over of [{ angle: 'turned' }, { sharpness: 'soft' }, { lighting: 'harsh' }, { faceSize: 'close' }, { faceCover: ['hair'] }, { faceCover: ['hat', 'hair'] }] as Partial<PhotoFacts>[]) {
      expect(photoVerdict(facts(over))).toEqual({ status: 'good', issues: [] });
    }
  });

  it('keeps the fixed order and lets one retake issue outrank the softer ones', () => {
    expect(photoVerdict(facts({ faceCount: 2, realPerson: false, faceCover: ['hair', 'sunglasses'], sharpness: 'blurry', angle: 'tilted', lighting: 'backlit', faceSize: 'small' })))
      .toEqual({ status: 'retake', issues: ['multiple_faces', 'not_real_person', 'face_covered', 'blurry', 'side_angle', 'backlit', 'small_face'] });
    expect(photoVerdict(facts({ angle: 'side', lighting: 'dark', faceSize: 'small' }))).toEqual({ status: 'check', issues: ['side_angle', 'dark', 'small_face'] });
    expect(photoVerdict(facts({ lighting: 'dark', sharpness: 'blurry' }))).toEqual({ status: 'retake', issues: ['blurry', 'dark'] });
  });

  it('re-checks stored answers: unknown statuses or issues are no result', () => {
    expect(parsePhotoCheck({ status: 'check', issues: ['dark'] })).toEqual({ status: 'check', issues: ['dark'] });
    for (const bad of [null, 'good', [], { status: 'fine', issues: [] }, { status: 'good' }, { status: 'check', issues: ['wrinkles'] }]) expect(parsePhotoCheck(bad)).toBeNull();
  });
});

describe('photo check configuration', () => {
  it('is off unless TWINGS_PHOTO_CHECK=on and GEMINI_API_KEY is set', () => {
    expect(photoCheckConfigFromEnv({})).toBeNull();
    expect(photoCheckConfigFromEnv({ GEMINI_API_KEY: 'k' })).toBeNull();
    expect(photoCheckConfigFromEnv({ GEMINI_API_KEY: 'k', TWINGS_PHOTO_CHECK: 'true' })).toBeNull();
    expect(photoCheckConfigFromEnv({ TWINGS_PHOTO_CHECK: 'on' })).toBeNull();
    expect(photoCheckConfigFromEnv({ TWINGS_PHOTO_CHECK: 'on', GEMINI_API_KEY: ' ' })).toBeNull();
    expect(photoCheckerFromEnv({ GEMINI_API_KEY: 'k' })).toBeNull();
    expect(photoCheckConfigFromEnv({ TWINGS_PHOTO_CHECK: 'on', GEMINI_API_KEY: 'k' })).toEqual({ apiKey: 'k', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-4-hydrogen' });
    expect(photoCheckConfigFromEnv({ TWINGS_PHOTO_CHECK: 'on', GEMINI_API_KEY: 'k', GEMINI_PHOTO_CHECK_MODEL: 'gemini-x', GEMINI_BASE_URL: 'https://proxy.test/v1/' }))
      .toEqual({ apiKey: 'k', baseUrl: 'https://proxy.test/v1', model: 'gemini-x' });
    expect(photoCheckConfigFromEnv({ TWINGS_PHOTO_CHECK: 'on', GEMINI_API_KEY: 'k', GEMINI_PHOTO_CHECK_MODEL: '../evil' })?.model).toBe('gemini-4-hydrogen');
  });
});

describe('reading photo facts from the model', () => {
  const config = { apiKey: 'test-key', baseUrl: 'https://gemini.test/v1beta', model: 'gemini-4-hydrogen' };
  const photo = async () => new Uint8Array(await sharp({ create: { width: 2000, height: 1500, channels: 3, background: '#c8b4a0' } }).png().toBuffer());
  const answer = (text: string, status = 200) => vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text }] } }] }), { status }));

  it('sends one downscaled JPEG with the schema, no text about the person, and parses the answer', async () => {
    const fetchImpl = answer(JSON.stringify(GOOD));
    expect(await readPhotoFacts(config, fetchImpl as unknown as typeof fetch, await photo())).toEqual(GOOD);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gemini.test/v1beta/models/gemini-4-hydrogen:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(init.body));
    expect(body.systemInstruction.parts[0].text).toBe(PHOTO_CHECK_SYSTEM);
    expect(body.generationConfig).toEqual({ temperature: 0, responseMimeType: 'application/json', responseSchema: PHOTO_CHECK_SCHEMA, thinkingConfig: { thinkingLevel: 'low' } });
    // The user turn is the picture alone: no name, label, account or any words about who it is.
    const parts = body.contents[0].parts as Array<Record<string, unknown>>;
    expect(parts).toHaveLength(1);
    expect(Object.keys(parts[0]!)).toEqual(['inlineData']);
    const inline = parts[0]!.inlineData as { mimeType: string; data: string };
    expect(inline.mimeType).toBe('image/jpeg');
    const meta = await sharp(Buffer.from(inline.data, 'base64')).metadata();
    expect(meta).toMatchObject({ format: 'jpeg', width: 1024, height: 768 });
  });

  it('accepts a ```json fenced answer', async () => {
    const fetchImpl = answer('```json\n' + JSON.stringify(facts({ lighting: 'dark' })) + '\n```');
    expect(await readPhotoFacts(config, fetchImpl as unknown as typeof fetch, await photo())).toEqual(facts({ lighting: 'dark' }));
  });

  it('answers null for an HTTP error, malformed JSON, an enum outside the schema, a missing field, a thrown fetch or a bad image', async () => {
    const bytes = await photo();
    const cases = [
      answer(JSON.stringify(GOOD), 500),
      answer('{"faceCount": 1, '),
      answer(JSON.stringify({ ...GOOD, angle: 'upside-down' })),
      answer(JSON.stringify({ ...GOOD, faceCover: ['scarf'] })),
      answer(JSON.stringify({ ...GOOD, sharpness: undefined })),
      answer(''),
      vi.fn(async () => { throw new DOMException('timed out', 'TimeoutError'); }),
    ];
    for (const fetchImpl of cases) expect(await readPhotoFacts(config, fetchImpl as unknown as typeof fetch, bytes)).toBeNull();
    const untouched = answer(JSON.stringify(GOOD));
    expect(await readPhotoFacts(config, untouched as unknown as typeof fetch, new Uint8Array([1, 2, 3]))).toBeNull();
    expect(untouched).not.toHaveBeenCalled();
  });

  it('the checker turns facts into the verdict', async () => {
    const fetchImpl = answer(JSON.stringify(facts({ faceCount: 2 })));
    const check = photoCheckerFromEnv({ TWINGS_PHOTO_CHECK: 'on', GEMINI_API_KEY: 'k' }, fetchImpl as unknown as typeof fetch);
    expect(await check!(await photo())).toEqual({ status: 'retake', issues: ['multiple_faces'] });
  });
});
