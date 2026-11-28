import { describe, expect, it } from 'vitest';
import { personalMagi2Open, personalMagi2OrdersOpen } from '@/lib/flags';
import {
  MAGI2_DEFAULT_SECONDS,
  MAGI2_ENDPOINTS,
  MAGI2_IMAGE_ENDPOINT,
  MAGI2_MAX_REFERENCE_AUDIOS,
  MAGI2_MAX_REFERENCE_IMAGES,
  MAGI2_MAX_REFERENCE_VIDEOS,
  MAGI2_MAX_SECONDS,
  MAGI2_MIN_SECONDS,
  MAGI2_PROMPT_MAX_CHARS,
  MAGI2_RATIOS,
  MAGI2_REFERENCE_ENDPOINT,
  MAGI2_RESOLUTIONS,
  MAGI2_TEXT_ENDPOINT,
  MAGI2_USD_PER_SECOND,
  Magi2RequestError,
  estimateMagi2Usd,
  magi2ReferenceRequest,
  unattachedMagi2References,
  unresolvedPromptTokens,
} from '@/lib/sunra/magi2';

const IMG = 'https://media.example.com/renders/job-1/selfie.png?sig=1';
const VID = 'https://media.example.com/renders/job-1/motion.mp4?sig=2';
const AUD = 'https://media.example.com/renders/job-1/voice.wav?sig=3';

describe('personalMagi2Open flag', () => {
  it('stays off by default and requires BOTH TWINGS_PERSONAL_MAGI2=on and TWINGS_PERSONAL_SUNRA_FACES=on', () => {
    expect(personalMagi2Open({})).toBe(false);
    expect(personalMagi2Open({ TWINGS_PERSONAL_MAGI2: 'on' })).toBe(false);
    expect(personalMagi2Open({ TWINGS_PERSONAL_SUNRA_FACES: 'on' })).toBe(false);
    expect(personalMagi2Open({ TWINGS_PERSONAL_MAGI2: 'on', TWINGS_PERSONAL_SUNRA_FACES: 'off' })).toBe(false);
    for (const junk of ['off', 'ON', 'on ', 'true', '1', '']) {
      expect(personalMagi2Open({ TWINGS_PERSONAL_MAGI2: junk, TWINGS_PERSONAL_SUNRA_FACES: 'on' }), junk).toBe(false);
      expect(personalMagi2Open({ TWINGS_PERSONAL_MAGI2: 'on', TWINGS_PERSONAL_SUNRA_FACES: junk }), junk).toBe(false);
    }
    expect(personalMagi2Open({ TWINGS_PERSONAL_MAGI2: 'on', TWINGS_PERSONAL_SUNRA_FACES: 'on' })).toBe(true);
  });
});

describe('personalMagi2OrdersOpen flag (M1 fix 1: MAGI-2 is sold only once the order wiring exists)', () => {
  const MAGI = { TWINGS_PERSONAL_MAGI2: 'on', TWINGS_PERSONAL_SUNRA_FACES: 'on' };
  it('stays off by default and needs exactly `on` AND personalMagi2Open', () => {
    expect(personalMagi2OrdersOpen({})).toBe(false);
    // The render switches alone never open orders.
    expect(personalMagi2OrdersOpen(MAGI)).toBe(false);
    // The order switch alone, or with only one of the render switches, never opens them either.
    expect(personalMagi2OrdersOpen({ TWINGS_PERSONAL_MAGI2_ORDERS: 'on' })).toBe(false);
    expect(personalMagi2OrdersOpen({ TWINGS_PERSONAL_MAGI2_ORDERS: 'on', TWINGS_PERSONAL_MAGI2: 'on' })).toBe(false);
    expect(personalMagi2OrdersOpen({ TWINGS_PERSONAL_MAGI2_ORDERS: 'on', TWINGS_PERSONAL_SUNRA_FACES: 'on' })).toBe(false);
    for (const junk of ['off', 'ON', 'on ', 'true', '1', '']) {
      expect(personalMagi2OrdersOpen({ ...MAGI, TWINGS_PERSONAL_MAGI2_ORDERS: junk }), junk).toBe(false);
    }
    expect(personalMagi2OrdersOpen({ ...MAGI, TWINGS_PERSONAL_MAGI2_ORDERS: 'on' })).toBe(true);
  });
});

describe('MAGI-2 prompt checks before submit (refuse only what is certainly wrong, never rewrite)', () => {
  it('finds unresolved {{…}} tokens and stray double braces', () => {
    expect(unresolvedPromptTokens('Image 1 walks through neon rain.')).toEqual([]);
    expect(unresolvedPromptTokens('A {single} brace pair is text.')).toEqual([]);
    expect(unresolvedPromptTokens('{{selfie}} walks through neon rain.')).toEqual(['{{selfie}}']);
    expect(unresolvedPromptTokens('{{ selfie }} and {{product}}')).toEqual(['{{ selfie }}', '{{product}}']);
    // A token inside dialogue quotes is still an unresolved token, never words to say.
    expect(unresolvedPromptTokens('She says "{{selfie}}".')).toEqual(['{{selfie}}']);
    // A lone `{{` or `}}` is a broken token: recipe and set-prompt validation refuse it too.
    expect(unresolvedPromptTokens('Image 1 {{ walks')).toEqual(['{{']);
    expect(unresolvedPromptTokens('Image 1 }} walks')).toEqual(['}}']);
  });

  it('names only the references this request does not carry, counted per kind, outside quotes', () => {
    const one = { images: 1, videos: 0, audios: 0 };
    expect(unattachedMagi2References('Image 1 walks.', one)).toEqual([]);
    expect(unattachedMagi2References('@Image1 walks.', one)).toEqual([]);
    expect(unattachedMagi2References('Image 1 and Image 2 dance.', one)).toEqual(['Image 2']);
    expect(unattachedMagi2References('@Image2 dances.', one)).toEqual(['@Image2']);
    expect(unattachedMagi2References('Image 0 dances.', one)).toEqual(['Image 0']);
    expect(unattachedMagi2References('Image 1 moves like Video 1.', one)).toEqual(['Video 1']);
    expect(unattachedMagi2References('Image 1 sings over Audio 1.', one)).toEqual(['Audio 1']);
    const all = { images: 2, videos: 1, audios: 1 };
    expect(unattachedMagi2References('Image 1, Image 2 move like Video 1 over Audio 1.', all)).toEqual([]);
    expect(unattachedMagi2References('Image 3 moves like Video 2 over Audio 2.', all)).toEqual(['Image 3', 'Video 2', 'Audio 2']);
    // Dialogue or on-screen text is words, not a reference (the Seedance lane reads quotes the same way).
    expect(unattachedMagi2References('Image 1 holds a sign reading "Image 7".', one)).toEqual([]);
    // Not tokens: lower case, joined to a word.
    expect(unattachedMagi2References('image 4 and xImage 5', one)).toEqual([]);
  });

  it('the request builder refuses both, and sends the prompt exactly as written', () => {
    const base = { prompt: 'Image 1 walks; Video 1 sets the motion.', aspectRatio: '9:16', seconds: 10, referenceImages: [IMG], referenceVideos: [VID] };
    expect(magi2ReferenceRequest(base).body.prompt).toBe('Image 1 walks; Video 1 sets the motion.');
    expect(() => magi2ReferenceRequest({ ...base, prompt: '{{selfie}} walks.' })).toThrow(Magi2RequestError);
    expect(() => magi2ReferenceRequest({ ...base, prompt: 'Image 1 walks }} on.' })).toThrow(Magi2RequestError);
    expect(() => magi2ReferenceRequest({ ...base, prompt: 'Image 2 walks.' })).toThrow(/Image 2/);
    expect(() => magi2ReferenceRequest({ ...base, referenceVideos: [] })).toThrow(/Video 1/);
    expect(() => magi2ReferenceRequest({ ...base, prompt: 'Image 1 sings over Audio 1.' })).toThrow(/Audio 1/);
    expect(magi2ReferenceRequest({ ...base, prompt: 'Image 1 sings over Audio 1.', referenceAudios: [AUD] }).body).toMatchObject({
      prompt: 'Image 1 sings over Audio 1.',
      reference_audios: [AUD],
    });
  });
});

describe('MAGI-2 pure request builder', () => {
  it('exposes the three Sand.ai endpoints and documented limits', () => {
    expect(MAGI2_REFERENCE_ENDPOINT).toBe('sand/magi-2/reference-to-video');
    expect(MAGI2_IMAGE_ENDPOINT).toBe('sand/magi-2/image-to-video');
    expect(MAGI2_TEXT_ENDPOINT).toBe('sand/magi-2/text-to-video');
    expect(MAGI2_ENDPOINTS).toEqual({
      reference: 'sand/magi-2/reference-to-video',
      image: 'sand/magi-2/image-to-video',
      text: 'sand/magi-2/text-to-video',
    });
    expect(MAGI2_RATIOS).toEqual(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']);
    expect(MAGI2_RESOLUTIONS).toEqual(['1080p']);
    expect(MAGI2_MIN_SECONDS).toBe(4);
    expect(MAGI2_MAX_SECONDS).toBe(30);
    expect(MAGI2_DEFAULT_SECONDS).toBe(5);
    expect(MAGI2_PROMPT_MAX_CHARS).toBe(15_000);
    expect(MAGI2_MAX_REFERENCE_IMAGES).toBe(10);
    expect(MAGI2_MAX_REFERENCE_VIDEOS).toBe(5);
    expect(MAGI2_MAX_REFERENCE_AUDIOS).toBe(5);
    expect(MAGI2_USD_PER_SECOND).toBe(0.08);
  });

  it('builds the reference-to-video request with default 5s, 1080p and audio enabled', () => {
    const built = magi2ReferenceRequest({
      prompt: 'A portrait walks through neon rain.',
      aspectRatio: '9:16',
      referenceImages: [IMG],
    });
    expect(built).toEqual({
      endpoint: 'sand/magi-2/reference-to-video',
      body: {
        prompt: 'A portrait walks through neon rain.',
        duration: 5,
        aspect_ratio: '9:16',
        resolution: '1080p',
        generate_audio: true,
        reference_images: [IMG],
      },
    });
  });

  it('accepts all six aspect ratios, durations 4..30, prompt 1..15,000, and up to 10 images / 5 videos / 5 audios', () => {
    for (const aspectRatio of ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const) {
      expect(magi2ReferenceRequest({ prompt: 'a', aspectRatio, seconds: 4, referenceImages: [IMG] }).body.aspect_ratio).toBe(aspectRatio);
    }
    const maxReq = magi2ReferenceRequest({
      prompt: 'x'.repeat(15_000),
      aspectRatio: '16:9',
      seconds: 30,
      resolution: '1080p',
      generateAudio: false,
      referenceImages: Array.from({ length: 10 }, (_, i) => `${IMG}&i=${i}`),
      referenceVideos: Array.from({ length: 5 }, (_, i) => `${VID}&v=${i}`),
      referenceAudios: Array.from({ length: 5 }, (_, i) => `${AUD}&a=${i}`),
    });
    expect(maxReq.body).toMatchObject({
      duration: 30,
      resolution: '1080p',
      generate_audio: false,
    });
    expect(maxReq.body.reference_images).toHaveLength(10);
    expect(maxReq.body.reference_videos).toHaveLength(5);
    expect(maxReq.body.reference_audios).toHaveLength(5);
  });

  it('refuses invalid prompt, duration, aspect ratio, resolution, reference counts, or non-public-https URLs', () => {
    const base = { prompt: 'hello', aspectRatio: '9:16', seconds: 10, resolution: '1080p' as const, referenceImages: [IMG] };
    expect(() => magi2ReferenceRequest({ ...base, prompt: '' })).toThrow(Magi2RequestError);
    expect(() => magi2ReferenceRequest({ ...base, prompt: '   \n\t ' })).toThrow(Magi2RequestError);
    expect(() => magi2ReferenceRequest({ ...base, prompt: 'x'.repeat(15_001) })).toThrow(Magi2RequestError);
    for (const badSeconds of [3, 31, 7.5, 0, -5, NaN]) {
      expect(() => magi2ReferenceRequest({ ...base, seconds: badSeconds }), String(badSeconds)).toThrow(Magi2RequestError);
    }
    for (const badAspect of ['4:5', 'adaptive', '2:3', '']) {
      expect(() => magi2ReferenceRequest({ ...base, aspectRatio: badAspect }), badAspect).toThrow(Magi2RequestError);
    }
    for (const badRes of ['720p', '480p', '4k'] as const) {
      expect(() => magi2ReferenceRequest({ ...base, resolution: badRes as never }), badRes).toThrow(Magi2RequestError);
    }
    expect(() => magi2ReferenceRequest({ ...base, referenceImages: [] })).toThrow(Magi2RequestError);
    expect(() => magi2ReferenceRequest({ ...base, referenceImages: Array.from({ length: 11 }, (_, i) => `${IMG}&i=${i}`) })).toThrow(Magi2RequestError);
    expect(() => magi2ReferenceRequest({ ...base, referenceVideos: Array.from({ length: 6 }, (_, i) => `${VID}&v=${i}`) })).toThrow(Magi2RequestError);
    expect(() => magi2ReferenceRequest({ ...base, referenceAudios: Array.from({ length: 6 }, (_, i) => `${AUD}&a=${i}`) })).toThrow(Magi2RequestError);

    for (const badUrl of [
      'data:image/png;base64,AAAA',
      'asset://asset-123',
      'http://media.example.com/a.png',
      'https://127.0.0.1/a.png',
      'https://2130706433/a.png',
      'https://[::1]/a.png',
      'https://user:pw@media.example.com/a.png',
      'https://localhost/a.png',
      'https://media.internal/a.png',
      'https://media.local/a.png',
      'not-a-url',
      '',
    ]) {
      expect(() => magi2ReferenceRequest({ ...base, referenceImages: [badUrl] }), `img:${badUrl}`).toThrow(Magi2RequestError);
      expect(() => magi2ReferenceRequest({ ...base, referenceVideos: [badUrl] }), `vid:${badUrl}`).toThrow(Magi2RequestError);
      expect(() => magi2ReferenceRequest({ ...base, referenceAudios: [badUrl] }), `aud:${badUrl}`).toThrow(Magi2RequestError);
    }
  });

  it('estimates list price at $0.08/s before the 5% top-up fee', () => {
    expect(estimateMagi2Usd(4)).toBe(0.32);
    expect(estimateMagi2Usd(5)).toBe(0.4);
    expect(estimateMagi2Usd(10)).toBe(0.8);
    expect(estimateMagi2Usd(29)).toBe(2.32);
    expect(estimateMagi2Usd(30)).toBe(2.4);
    expect(estimateMagi2Usd(0)).toBe(0);
  });
});
