import { describe, expect, it, vi } from 'vitest';
import { aspectLabel, probeMp4, readFilm } from '@/lib/brand-studio/film-sheet';
import { normalizeFilmSheet } from '@/lib/brand-studio/film-sheet/schema';
import { downloadVideo, uploadVideoFile } from '@/lib/brand-studio/film-sheet/upload';
import { ENV, geminiAnswer } from './helpers';

/* ------------------------------------------------------- tiny MP4 maker */

function u32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}
function box(type: string, ...body: Array<number[] | Uint8Array>): Uint8Array {
  const flat = body.flatMap((b) => [...b]);
  return new Uint8Array([...u32(flat.length + 8), ...[...type].map((c) => c.charCodeAt(0)), ...flat]);
}
function tkhd(width: number, height: number, rotated = false): Uint8Array {
  const matrix = rotated
    ? [0, 0x10000, 0, 0xffff0000, 0, 0, 0, 0, 0x40000000]
    : [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000];
  return box('tkhd', new Array(4 + 20 + 16).fill(0), matrix.flatMap(u32), u32(width * 65536), u32(height * 65536));
}
function trak(handler: string, width: number, height: number, rotated = false): Uint8Array {
  const hdlr = box('hdlr', new Array(8).fill(0), [...handler].map((c) => c.charCodeAt(0)), new Array(13).fill(0));
  return box('trak', tkhd(width, height, rotated), box('mdia', hdlr));
}
function mp4(seconds: number, width = 1080, height = 1920, rotated = false): Uint8Array<ArrayBuffer> {
  const mvhd = box('mvhd', [0, 0, 0, 0], u32(0), u32(0), u32(1000), u32(Math.round(seconds * 1000)), new Array(80).fill(0));
  return new Uint8Array([
    ...box('ftyp', [...'isom'].map((c) => c.charCodeAt(0)), u32(0)),
    ...box('mdat', new Array(64).fill(7)),
    ...box('moov', mvhd, trak('soun', 0, 0), trak('vide', width, height, rotated)),
  ]);
}

/* ----------------------------------------------------------- answers */

const RAW = {
  seconds: 9.4,
  aspect: '16:9',
  shots: [
    { start: 5, end: 12, framing: 'wide shot', camera: 'locked-off', action: 'she turns away' },
    { start: 0, end: 2.04, framing: 'close-up', camera: 'slow push in', action: 'a hand lifts the bottle' },
    { start: 2.04, end: 5, framing: 'medium shot', camera: 'handheld follow', action: 'she walks' },
    { start: 6, end: 6, framing: '', camera: '', action: '' },
  ],
  look: { lighting: 'soft daylight from the left', palette: 'white and pale blue', texture: 'clean' },
  audio: { music: true, speech: false, effects: 'footsteps' },
  summary: '8초 길이에 컷은 3개예요. 카메라는 천천히 다가가다 손에 들고 따라가요. 음악과 발소리가 있어요.',
};

function route(handlers: Record<string, (init?: RequestInit) => Response | Promise<Response>>) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(url)}`;
    const hit = Object.entries(handlers).find(([pattern]) => key.startsWith(pattern));
    if (!hit) throw new Error(`unexpected ${key}`);
    return hit[1](init);
  });
}
const GENERATE = 'POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent';

describe('probeMp4', () => {
  it('reads length and the video track size, skipping the sound track', () => {
    expect(probeMp4(mp4(8))).toEqual({ seconds: 8, width: 1080, height: 1920 });
  });
  it('turns a quarter-rotated track upright', () => {
    expect(probeMp4(mp4(4.5, 1920, 1080, true))).toEqual({ seconds: 4.5, width: 1080, height: 1920 });
  });
  it('returns nulls for garbage', () => {
    expect(probeMp4(new Uint8Array([0, 0, 0, 3, 1, 2, 3]))).toEqual({ seconds: null, width: null, height: null });
  });
  it('names common aspects', () => {
    expect(aspectLabel(1080, 1920)).toBe('9:16');
    expect(aspectLabel(1440, 1080)).toBe('4:3');
    expect(aspectLabel(1000, 300)).toBe('10:3');
  });
});

describe('normalizeFilmSheet', () => {
  it('uses the file length, clamps and sorts shots, drops empty ones', () => {
    const sheet = normalizeFilmSheet(RAW, probeMp4(mp4(8)), 'ko')!;
    expect(sheet.seconds).toBe(8);
    expect(sheet.aspect).toBe('9:16');
    expect(sheet.shots.map((s) => [s.start, s.end])).toEqual([[0, 2], [2, 5], [5, 8]]);
    expect(sheet.audio).toEqual({ music: true, speech: false, effects: 'footsteps' });
  });

  it('falls back to the reported length without a probe', () => {
    const sheet = normalizeFilmSheet(RAW, { seconds: null, width: null, height: null }, 'ko')!;
    expect(sheet.seconds).toBe(9.4);
    expect(sheet.aspect).toBe('16:9');
    expect(sheet.shots[sheet.shots.length - 1]!.end).toBe(9.4);
  });

  it.each([
    ['a summary in the wrong language', { ...RAW, summary: 'Eight seconds, three cuts.' }],
    ['no shots', { ...RAW, shots: [] }],
    ['no summary', { ...RAW, summary: '' }],
    ['an internal word in the summary', { ...RAW, summary: 'Sunra로 읽은 8초 영상이에요.' }],
    ['not an object', 'nope'],
  ])('rejects %s', (_label, raw) => {
    expect(normalizeFilmSheet(raw, probeMp4(mp4(8)), 'ko')).toBeNull();
  });
});

describe('readFilm', () => {
  it('sends a small file inline with denser sampling, QuickTime as video/mov', async () => {
    const fetchMock = route({ [GENERATE]: () => geminiAnswer(RAW) });
    const sheet = await readFilm({ video: { bytes: mp4(8), mime: 'video/quicktime' }, locale: 'ko' }, {
      fetch: fetchMock as unknown as typeof fetch,
      env: ENV,
    });
    expect(sheet?.seconds).toBe(8);
    expect(sheet?.summary).toContain('컷은 3개');
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body.contents[0].parts[0]).toMatchObject({ inlineData: { mimeType: 'video/mov' }, videoMetadata: { fps: 4 } });
    expect(body.systemInstruction.parts[0].text).toContain('Korean');
    expect(body.generationConfig.responseJsonSchema.required).toContain('shots');
  });

  it('fetches a URL first', async () => {
    const fetchMock = route({
      'GET https://media.example/st/abc.mp4': () => new Response(mp4(8), { headers: { 'content-type': 'video/mp4' } }),
      [GENERATE]: () => geminiAnswer({ ...RAW, summary: 'Eight seconds with three cuts. The camera pushes in, then follows by hand.' }),
    });
    const sheet = await readFilm({ video: { url: 'https://media.example/st/abc.mp4' }, locale: 'en' }, {
      fetch: fetchMock as unknown as typeof fetch,
      env: ENV,
    });
    expect(sheet?.summary).toMatch(/^Eight seconds/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses a URL over the cap without asking the model', async () => {
    const fetchMock = route({
      'GET https://media.example/big.mp4': () =>
        new Response('x', { headers: { 'content-type': 'video/mp4', 'content-length': String(60_000_000) } }),
    });
    expect(await readFilm({ video: { url: 'https://media.example/big.mp4' }, locale: 'ko' }, { fetch: fetchMock as unknown as typeof fetch, env: ENV })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uploads a large file through the Files API, reads it by URI, then deletes it', async () => {
    const big = new Uint8Array(15_000_000);
    big.set(mp4(8));
    const fetchMock = route({
      'POST https://generativelanguage.googleapis.com/upload/v1beta/files': (init) => {
        const headers = init?.headers as Record<string, string>;
        expect(headers['X-Goog-Upload-Protocol']).toBe('resumable');
        expect(headers['X-Goog-Upload-Header-Content-Length']).toBe('15000000');
        return new Response(null, { status: 200, headers: { 'x-goog-upload-url': 'https://upload.example/session/1' } });
      },
      'POST https://upload.example/session/1': (init) => {
        expect((init?.headers as Record<string, string>)['X-Goog-Upload-Command']).toBe('upload, finalize');
        return Response.json({ file: { name: 'files/abc', uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc', state: 'ACTIVE' } });
      },
      [GENERATE]: () => geminiAnswer(RAW),
      'DELETE https://generativelanguage.googleapis.com/v1beta/files/abc': () => new Response(null, { status: 200 }),
    });
    const sheet = await readFilm({ video: { bytes: big, mime: 'video/mp4' }, locale: 'ko' }, {
      fetch: fetchMock as unknown as typeof fetch,
      env: ENV,
    });
    expect(sheet?.shots).toHaveLength(3);
    const generate = fetchMock.mock.calls.find(([url]) => String(url).includes(':generateContent'))!;
    const part = JSON.parse(String(generate[1]!.body)).contents[0].parts[0];
    expect(part.fileData).toEqual({ mimeType: 'video/mp4', fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc' });
    expect(part.inlineData).toBeUndefined();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
  });

  it.each([
    ['no key', {}, () => geminiAnswer(RAW), { bytes: mp4(8), mime: 'video/mp4' }],
    ['http 500', ENV, () => new Response('', { status: 500 }), { bytes: mp4(8), mime: 'video/mp4' }],
    ['bad JSON', ENV, () => geminiAnswer('not json'), { bytes: mp4(8), mime: 'video/mp4' }],
    ['unsupported type', ENV, () => geminiAnswer(RAW), { bytes: mp4(8), mime: 'video/x-matroska' }],
    ['empty file', ENV, () => geminiAnswer(RAW), { bytes: new Uint8Array(0), mime: 'video/mp4' }],
    ['network error', ENV, () => Promise.reject(new TypeError('fetch failed')), { bytes: mp4(8), mime: 'video/mp4' }],
  ] as const)('returns null on %s', async (_label, env, respond, video) => {
    const fetchMock = vi.fn(async () => respond());
    const sheet = await readFilm({ video: { ...video }, locale: 'ko' }, { fetch: fetchMock as unknown as typeof fetch, env: { ...env } });
    expect(sheet).toBeNull();
  });
});

describe('Files API helpers', () => {
  const config = { apiKey: 'k', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'm' };

  it('polls until the file is ACTIVE', async () => {
    const fetchMock = route({
      'POST https://generativelanguage.googleapis.com/upload/v1beta/files': () =>
        new Response(null, { headers: { 'x-goog-upload-url': 'https://upload.example/s' } }),
      'POST https://upload.example/s': () => Response.json({ file: { name: 'files/x', uri: 'u', state: 'PROCESSING' } }),
      'GET https://generativelanguage.googleapis.com/v1beta/files/x': () => Response.json({ name: 'files/x', uri: 'u', state: 'ACTIVE' }),
    });
    const file = await uploadVideoFile(config, fetchMock as unknown as typeof fetch, { bytes: new Uint8Array(10), mime: 'video/mp4' }, { pollMs: 1 });
    expect(file).toEqual({ name: 'files/x', uri: 'u' });
  });

  it('throws when processing fails', async () => {
    const fetchMock = route({
      'POST https://generativelanguage.googleapis.com/upload/v1beta/files': () =>
        new Response(null, { headers: { 'x-goog-upload-url': 'https://upload.example/s' } }),
      'POST https://upload.example/s': () => Response.json({ file: { name: 'files/x', uri: 'u', state: 'FAILED' } }),
    });
    await expect(
      uploadVideoFile(config, fetchMock as unknown as typeof fetch, { bytes: new Uint8Array(10), mime: 'video/mp4' }, { pollMs: 1 }),
    ).rejects.toThrow('gemini_upload_failed');
  });

  it('stops reading a download past the cap', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(500), { headers: { 'content-type': 'video/mp4' } }));
    expect(await downloadVideo('https://media.example/a.mp4', fetchMock as unknown as typeof fetch, 100)).toBeNull();
    expect(await downloadVideo('file:///etc/passwd', fetchMock as unknown as typeof fetch, 100)).toBeNull();
  });
});
