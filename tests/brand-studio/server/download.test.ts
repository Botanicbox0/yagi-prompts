import { describe, expect, it } from 'vitest';
import { downloadResult, downloadableUrl } from '@/lib/brand-studio/provider/download';

/** A file host that serves `bytes`, with or without `Range` support, and counts what it was asked. */
function host(bytes: Uint8Array, options: { ranges?: boolean; failFirst?: number; type?: string } = {}) {
  const calls: Array<{ range: string | null }> = [];
  let failures = options.failFirst ?? 0;
  const doFetch = (async (_url: URL | string, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('range');
    calls.push({ range });
    const type = options.type ?? 'image/png';
    if (options.ranges === false || !range) {
      return new Response(bytes.slice(), { status: 200, headers: { 'content-type': type, 'content-length': String(bytes.byteLength) } });
    }
    const [, a, z] = /bytes=(\d+)-(\d+)/.exec(range)!;
    const start = Number(a);
    const end = Math.min(Number(z), bytes.byteLength - 1);
    // Only later pieces fail here: the first request decides how the file is read.
    if (start > 0 && failures > 0) {
      failures -= 1;
      return new Response('busy', { status: 503 });
    }
    return new Response(bytes.slice(start, end + 1), {
      status: 206,
      headers: { 'content-type': type, 'content-range': `bytes ${start}-${end}/${bytes.byteLength}` },
    });
  }) as typeof fetch;
  return { doFetch, calls };
}

function sample(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = (i * 31 + 7) % 251;
  return bytes;
}

describe('downloadResult', () => {
  it('reads a small file in one ranged answer', async () => {
    const file = sample(40_000);
    const { doFetch, calls } = host(file);
    const got = await downloadResult(doFetch, 'https://files.example.com/a.png');
    expect(Buffer.from(got.bytes).equals(Buffer.from(file))).toBe(true);
    expect(got.mime).toBe('image/png');
    expect(calls).toHaveLength(1);
  });

  it('fetches a large file in parallel pieces and reassembles it exactly', async () => {
    const file = sample(512 * 1024 * 5 + 12_345);
    const { doFetch, calls } = host(file, { type: 'video/mp4' });
    const got = await downloadResult(doFetch, 'https://files.example.com/a.mp4');
    expect(got.bytes.byteLength).toBe(file.byteLength);
    expect(Buffer.from(got.bytes).equals(Buffer.from(file))).toBe(true);
    expect(calls.length).toBe(6);
    expect(calls.every((c) => c.range !== null)).toBe(true);
  });

  it('retries a piece that fails and still returns the whole file', async () => {
    const file = sample(512 * 1024 * 3);
    const { doFetch } = host(file, { failFirst: 2 });
    const got = await downloadResult(doFetch, 'https://files.example.com/a.png');
    expect(Buffer.from(got.bytes).equals(Buffer.from(file))).toBe(true);
  });

  it('falls back to one stream when the host ignores Range', async () => {
    const file = sample(700_000);
    const { doFetch, calls } = host(file, { ranges: false });
    const got = await downloadResult(doFetch, 'https://files.example.com/a.png');
    expect(Buffer.from(got.bytes).equals(Buffer.from(file))).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('refuses a file over the cap before fetching the rest', async () => {
    const file = sample(512 * 1024 * 4);
    const ranged = host(file);
    await expect(downloadResult(ranged.doFetch, 'https://files.example.com/a.png', 1_000_000)).rejects.toThrow('too large');
    expect(ranged.calls).toHaveLength(1);
    const plain = host(file, { ranges: false });
    await expect(downloadResult(plain.doFetch, 'https://files.example.com/a.png', 1_000_000)).rejects.toThrow('too large');
  });

  it('refuses addresses that are not public https hosts', async () => {
    const { doFetch, calls } = host(sample(10));
    for (const url of ['http://files.example.com/a.png', 'https://127.0.0.1/a.png', 'https://localhost/a.png', 'https://intranet/a.png', 'https://user:pw@files.example.com/a.png', 'not a url']) {
      expect(downloadableUrl(url)).toBeNull();
      await expect(downloadResult(doFetch, url)).rejects.toThrow('refused address');
    }
    expect(calls).toHaveLength(0);
  });
});
