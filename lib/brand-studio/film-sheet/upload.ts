/**
 * Getting a reference video to Gemini.
 *
 * Source: https://aistudio.google.com/docs/video-understanding (checked 2026-11-10; the old
 * ai.google.dev/gemini-api/docs/video-understanding redirects there) and
 * https://aistudio.google.com/docs/file-input-methods. That page says to "always use the Files API
 * when the total request size … is larger than 20 MB" (the input-methods page allows 100 MB inline;
 * we keep to the stricter figure). Base64 adds a third, so files up to 14 MB go inline and larger
 * ones go through the resumable Files API upload (start → upload, finalize → poll until ACTIVE),
 * then the part is `fileData { mimeType, fileUri }`. Uploads expire after 48 h; we delete ours
 * right after the read. Supported video types: video/mp4, mpeg, mov, avi, x-flv, mpg, webm, wmv,
 * 3gpp — so QuickTime's `video/quicktime` is sent as `video/mov`.
 */
import type { GeminiConfig } from '@/lib/brand-studio/enhancer/gemini';

/** Raw bytes sent inline: 14 MB × 4/3 base64 ≈ 18.7 MB, under the 20 MB request guidance. */
export const INLINE_VIDEO_MAX_BYTES = 14_000_000;
/** Same cap as a studio upload (STUDIO_LIMITS.videoBytesMax). */
export const FILM_VIDEO_MAX_BYTES = 50_000_000;

const GEMINI_VIDEO_MIMES = new Set([
  'video/mp4', 'video/mpeg', 'video/mov', 'video/avi', 'video/x-flv', 'video/mpg', 'video/webm', 'video/wmv', 'video/3gpp',
]);
const EXTENSION_MIMES: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mov', webm: 'video/webm', mpeg: 'video/mpeg', mpg: 'video/mpg',
};

/** The type Gemini accepts for this file, or null when it does not take it. */
export function geminiVideoMime(mime: string | null | undefined, url?: string): string | null {
  const base = (mime ?? '').split(';')[0]!.trim().toLowerCase();
  const mapped = base === 'video/quicktime' ? 'video/mov' : base === 'video/x-m4v' ? 'video/mp4' : base;
  if (GEMINI_VIDEO_MIMES.has(mapped)) return mapped;
  const ext = url ? /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase() : undefined;
  return ext ? (EXTENSION_MIMES[ext] ?? null) : null;
}

/** Fetches a video with a hard byte cap. Null on any failure or when it is too large. */
export async function downloadVideo(
  url: string,
  fetchImpl: typeof fetch,
  maxBytes = FILM_VIDEO_MAX_BYTES,
): Promise<{ bytes: Uint8Array; mime: string | null } | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    return await readCapped(await fetchImpl(url, { method: 'GET', signal: controller.signal }), maxBytes);
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; mime: string | null } | null> {
  if (!response.ok) return null;
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const mime = response.headers.get('content-type');
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    return buffer.byteLength > maxBytes ? null : { bytes: buffer, mime };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return { bytes, mime };
}

function uploadBase(baseUrl: string): string {
  const url = new URL(baseUrl);
  return `${url.origin}/upload${url.pathname.replace(/\/+$/, '')}/files`;
}

interface UploadedFile {
  name: string;
  uri: string;
  state?: string;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fileFrom(body: unknown): UploadedFile | null {
  const file = (body as { file?: unknown } | null)?.file ?? body;
  if (!file || typeof file !== 'object') return null;
  const { name, uri, state } = file as Record<string, unknown>;
  if (typeof name !== 'string' || typeof uri !== 'string') return null;
  return { name, uri, state: typeof state === 'string' ? state : undefined };
}

/** Resumable upload to the Files API; resolves once the file is ACTIVE. Throws on any failure. */
export async function uploadVideoFile(
  config: GeminiConfig,
  fetchImpl: typeof fetch,
  video: { bytes: Uint8Array; mime: string },
  options: { pollMs?: number; maxWaitMs?: number } = {},
): Promise<{ name: string; uri: string }> {
  const start = await fetchImpl(uploadBase(config.baseUrl), {
    method: 'POST',
    headers: {
      'x-goog-api-key': config.apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(video.bytes.byteLength),
      'X-Goog-Upload-Header-Content-Type': video.mime,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: 'studio-reference' } }),
  });
  const uploadUrl = start.ok ? start.headers.get('x-goog-upload-url') : null;
  if (!uploadUrl) throw new Error('gemini_upload_start');

  const sent = await fetchImpl(uploadUrl, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: new Blob([video.bytes as Uint8Array<ArrayBuffer>], { type: video.mime }),
  });
  if (!sent.ok) throw new Error('gemini_upload_send');
  let file = fileFrom(await sent.json());
  if (!file) throw new Error('gemini_upload_shape');

  const pollMs = options.pollMs ?? 2_000;
  const deadline = Date.now() + (options.maxWaitMs ?? 60_000);
  const created = file.name;
  try {
    while (file.state !== undefined && file.state !== 'ACTIVE') {
      if (file.state === 'FAILED') throw new Error('gemini_upload_failed');
      if (Date.now() > deadline) throw new Error('gemini_upload_timeout');
      await wait(pollMs);
      const check = await fetchImpl(`${config.baseUrl}/${file.name}`, {
        method: 'GET',
        headers: { 'x-goog-api-key': config.apiKey },
      });
      if (!check.ok) throw new Error('gemini_upload_poll');
      const next: UploadedFile | null = fileFrom(await check.json());
      if (!next) throw new Error('gemini_upload_shape');
      file = next;
    }
  } catch (error) {
    // The file exists on Google's side but never became usable: remove it now rather than in 48 h.
    await deleteVideoFile(config, fetchImpl, created);
    throw error;
  }
  return { name: file.name, uri: file.uri };
}

/** Best effort; the file expires on its own after 48 h. */
export async function deleteVideoFile(config: GeminiConfig, fetchImpl: typeof fetch, name: string): Promise<void> {
  try {
    await fetchImpl(`${config.baseUrl}/${name}`, { method: 'DELETE', headers: { 'x-goog-api-key': config.apiKey } });
  } catch {
    // ignore
  }
}
