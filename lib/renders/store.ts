import { access, mkdir, open, readFile, rm, stat, writeFile, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { AwsClient } from 'aws4fetch';
import type { SupabaseClient } from '@supabase/supabase-js';
import { privateStorageR2Config, selectStorageDriver, type PrivateStorageR2Config } from '@/lib/runtime-mode';

/**
 * Where a render's bytes live — the visitor's photo going in, the finished object coming out.
 *
 * A separate, smaller interface than `lib/storage` on purpose. That one is the PUBLISH pipeline
 * (staging → content-addressed, write-once, no delete, ≤60s capabilities) and its shape encodes
 * doctrine that does not apply here: a render is owned by one person, is retried in place, and
 * is viewed through a link that lives three days. So:
 *
 *   · one private bucket, `renders`, keyed `{jobId}/input.{ext}` and `{jobId}/result.{ext}`;
 *   · `put` upserts, because a retried job rewrites its own key and nothing else's;
 *   · `url()` mints a signed URL for MINUTES (the share page plays a film; a 60s URL would die
 *     mid-seek) — or returns null on the local driver, where the gateway streams the bytes itself.
 *
 * Same mode switch as everything else (`lib/runtime-mode.ts`): local mode writes under
 * `.storage/renders/`, cloud mode writes under `renders/` in `R2_PRIVATE_BUCKET` (`twings-private-apac`)
 * when configured, or falls back to the Supabase `renders` bucket.
 */

export const RENDERS_BUCKET = 'renders';

export interface RenderStore {
  readonly name: 'local' | 'supabase' | 'r2';
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  read(key: string): Promise<Uint8Array>;
  /** Optional for test stores; runtime drivers delete expired private edit references. */
  delete?(key: string): Promise<void>;
  /**
   * Remove every object under one owner folder (`{uuid}` or `social/{uuid}`). Account deletion only
   * (lib/account/deletion.ts); a folder that is already gone is a success.
   */
  deleteFolder?(folder: string): Promise<void>;
  /**
   * An absolute URL an outside host will honour for `ttlSeconds`, or `null` when nothing serves
   * the object over HTTP (local driver) and the gateway must stream it.
   */
  url(key: string, ttlSeconds: number, options?: { download?: string }): Promise<string | null>;
  /** Direct browser-to-object-storage PUT URL (`null` on local driver where body upload is used). */
  signedUploadUrl?(key: string, contentType: string, ttlSeconds?: number): Promise<string | null>;
  /** Lightweight metadata check without buffering object bytes. */
  head?(key: string): Promise<{ bytes: number; contentType: string | null } | null>;
  /** Inclusive byte-range read (`bytes=start-end`) for magic-number header sniffing. */
  readRange?(key: string, start: number, end: number): Promise<Uint8Array>;
}

export class RenderObjectNotFound extends Error {
  constructor(key: string) {
    super(`render object not found: ${RENDERS_BUCKET}/${key}`);
    this.name = 'RenderObjectNotFound';
  }
}

/**
 * Keys are `{uuid}/{name}.{ext}` by construction — or `social/{uuid}/evidence.jpg`, a follower
 * screenshot (docs/PLATFORM-2.0.md §17.1); anything else is refused before it touches a path.
 * A name may carry digits, `-` and `_` after its first letter: a recipe step (`step-sheet`), a carousel
 * frame (`result-2`) or a maker file (`ast_<hex>`) — still no dot, slash or traversal.
 */
export function assertRenderKey(key: string): void {
  if (!/^(?:social\/)?[0-9a-f-]{36}\/[a-z][a-z0-9_-]{0,63}\.[a-z0-9]{2,5}$/i.test(key)) throw new Error(`illegal render key: ${key}`);
}

/** One owner's folder: `{uuid}` or `social/{uuid}`. Nothing broader can be named, so nothing broader can be removed. */
export function assertRenderFolder(folder: string): void {
  if (!/^(?:social\/)?[0-9a-f-]{36}$/i.test(folder)) throw new Error(`illegal render folder: ${folder}`);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function createLocalRenderStore(rootDir?: string): RenderStore {
  const root = resolve(rootDir ?? process.env.STORAGE_LOCAL_ROOT ?? '.storage', RENDERS_BUCKET);
  const pathOf = (key: string) => {
    assertRenderKey(key);
    return join(root, key);
  };
  return {
    name: 'local',
    async put(key, bytes) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    },
    async read(key) {
      const path = pathOf(key);
      if (!(await fileExists(path))) throw new RenderObjectNotFound(key);
      return new Uint8Array(await readFile(path));
    },
    async delete(key) {
      const path = pathOf(key);
      try { await unlink(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    },
    async deleteFolder(folder) {
      assertRenderFolder(folder);
      await rm(join(root, folder), { recursive: true, force: true });
    },
    async url() {
      return null;
    },
    async signedUploadUrl() {
      return null;
    },
    async head(key) {
      const path = pathOf(key);
      if (!(await fileExists(path))) return null;
      const info = await stat(path);
      return { bytes: info.size, contentType: null };
    },
    async readRange(key, start, end) {
      const path = pathOf(key);
      if (!(await fileExists(path))) throw new RenderObjectNotFound(key);
      const length = Math.max(0, end - start + 1);
      if (length === 0) return new Uint8Array(0);
      const fh = await open(path, 'r');
      try {
        const buf = Buffer.allocUnsafe(length);
        const { bytesRead } = await fh.read(buf, 0, length, Math.max(0, start));
        return new Uint8Array(buf.subarray(0, bytesRead));
      } finally {
        await fh.close();
      }
    },
  };
}

function isMissing(error: { message?: string; statusCode?: string; status?: number }): boolean {
  const status = String(error.statusCode ?? error.status ?? '');
  if (status === '404') return true;
  const message = (error.message ?? '').toLowerCase();
  return message.includes('not found') || message.includes('does not exist');
}

export function createSupabaseRenderStore(client?: SupabaseClient): RenderStore {
  let memo: SupabaseClient | null = client ?? null;
  const db = async (): Promise<SupabaseClient> => {
    if (memo === null) {
      const { createServiceClient } = await import('@/lib/supabase/service-client');
      memo = createServiceClient();
    }
    return memo;
  };
  return {
    name: 'supabase',
    async put(key, bytes, contentType) {
      assertRenderKey(key);
      const { error } = await (await db()).storage
        .from(RENDERS_BUCKET)
        .upload(key, new Blob([new Uint8Array(bytes)], { type: contentType }), { contentType, upsert: true });
      if (error) throw new Error(`render upload failed: ${key} — ${error.message}`);
    },
    async read(key) {
      assertRenderKey(key);
      const { data, error } = await (await db()).storage.from(RENDERS_BUCKET).download(key);
      if (error || !data) {
        if (!error || isMissing(error)) throw new RenderObjectNotFound(key);
        throw new Error(`render download failed: ${key} — ${error.message}`);
      }
      return new Uint8Array(await data.arrayBuffer());
    },
    async delete(key) {
      assertRenderKey(key);
      const { error } = await (await db()).storage.from(RENDERS_BUCKET).remove([key]);
      if (error && !isMissing(error)) throw new Error('private edit reference deletion failed');
    },
    async deleteFolder(folder) {
      assertRenderFolder(folder);
      const bucket = (await db()).storage.from(RENDERS_BUCKET);
      // Keys are flat under the folder (`{uuid}/{name}.{ext}`); loop in case a folder ever holds more than one page.
      for (let round = 0; round < 20; round += 1) {
        const { data, error } = await bucket.list(folder, { limit: 100 });
        if (error) { if (isMissing(error)) return; throw new Error('render folder listing failed'); }
        const paths = (data ?? []).filter((entry) => entry.id !== null).map((entry) => `${folder}/${entry.name}`);
        if (paths.length === 0) return;
        const removed = await bucket.remove(paths);
        if (removed.error && !isMissing(removed.error)) throw new Error('render folder deletion failed');
      }
      throw new Error('render folder deletion did not finish');
    },
    async url(key, ttlSeconds, options = {}) {
      assertRenderKey(key);
      const expiresIn = Math.max(1, Math.floor(ttlSeconds));
      const { data, error } = await (await db()).storage
        .from(RENDERS_BUCKET)
        .createSignedUrl(key, expiresIn, options.download ? { download: options.download } : undefined);
      if (error || !data) {
        if (!error || isMissing(error)) throw new RenderObjectNotFound(key);
        throw new Error(`render sign failed: ${key} — ${error.message}`);
      }
      return data.signedUrl;
    },
    async signedUploadUrl(key) {
      assertRenderKey(key);
      const { data, error } = await (await db()).storage.from(RENDERS_BUCKET).createSignedUploadUrl(key, { upsert: true });
      if (error || !data) throw new Error(`render upload sign failed: ${key} — ${error?.message ?? 'no url'}`);
      return data.signedUrl;
    },
    async head(key) {
      assertRenderKey(key);
      const bucket = (await db()).storage.from(RENDERS_BUCKET);
      const slash = key.lastIndexOf('/');
      const folder = slash >= 0 ? key.slice(0, slash) : '';
      const name = slash >= 0 ? key.slice(slash + 1) : key;
      const { data, error } = await bucket.list(folder, { limit: 100, search: name });
      if (error) {
        if (isMissing(error)) return null;
        throw new Error(`render head failed: ${key} — ${error.message}`);
      }
      const entry = (data ?? []).find((item) => item.name === name);
      if (!entry) return null;
      const meta = (entry.metadata ?? {}) as { size?: unknown; mimetype?: unknown };
      const bytes = typeof meta.size === 'number' ? meta.size : Number(meta.size ?? 0);
      return {
        bytes: Number.isFinite(bytes) && bytes > 0 ? bytes : (await this.read(key)).byteLength,
        contentType: typeof meta.mimetype === 'string' ? meta.mimetype : null,
      };
    },
    async readRange(key, start, end) {
      const full = await this.read(key);
      return full.subarray(Math.max(0, start), Math.min(full.byteLength, end + 1));
    },
  };
}

export interface CreateR2RenderStoreOptions {
  fetcher?: typeof fetch;
  legacyFallback?: RenderStore;
}

function encodeRenderPath(key: string): string {
  assertRenderKey(key);
  return `${RENDERS_BUCKET}/${key.split('/').map((part) => encodeURIComponent(part)).join('/')}`;
}

function attachmentDisposition(filename: string): string {
  const ascii = filename.replace(/["\\]/g, '').replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function createR2RenderStore(
  config: PrivateStorageR2Config,
  options: CreateR2RenderStoreOptions = {},
): RenderStore {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const r2 = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
    region: 'auto',
  });
  const baseUrl = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`;

  const urlFor = (key: string, query?: URLSearchParams): string => {
    const encoded = encodeRenderPath(key);
    const qs = query ? `?${query.toString()}` : '';
    return `${baseUrl}/${encoded}${qs}`;
  };

  async function headObject(key: string): Promise<boolean> {
    const signed = await r2.sign(new Request(urlFor(key), { method: 'HEAD' }));
    const res = await fetcher(signed);
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`r2 render head failed: ${key} — status ${res.status}`);
    return true;
  }

  return {
    name: 'r2',
    async put(key, bytes, contentType) {
      const body = Buffer.from(bytes);
      const signed = await r2.sign(
        new Request(urlFor(key), {
          method: 'PUT',
          body,
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'private, no-store',
            'Content-Length': String(body.byteLength),
          },
        }),
      );
      const res = await fetcher(signed);
      if (!res.ok) throw new Error(`render upload failed: ${key} — status ${res.status}`);
    },
    async read(key) {
      const signed = await r2.sign(new Request(urlFor(key), { method: 'GET' }));
      const res = await fetcher(signed);
      if (res.status === 404) {
        if (options.legacyFallback) return options.legacyFallback.read(key);
        throw new RenderObjectNotFound(key);
      }
      if (!res.ok) throw new Error(`render download failed: ${key} — status ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async delete(key) {
      const signed = await r2.sign(new Request(urlFor(key), { method: 'DELETE' }));
      const res = await fetcher(signed);
      if (!res.ok && res.status !== 404) throw new Error('private edit reference deletion failed');
      await options.legacyFallback?.delete?.(key).catch(() => undefined);
    },
    async url(key, ttlSeconds, signOptions = {}) {
      const expiresIn = Math.max(1, Math.min(Math.floor(ttlSeconds), 604800));
      if (!(await headObject(key))) {
        if (options.legacyFallback) return options.legacyFallback.url(key, expiresIn, signOptions);
        throw new RenderObjectNotFound(key);
      }
      const params = new URLSearchParams({ 'X-Amz-Expires': String(expiresIn) });
      if (signOptions.download) {
        params.set('response-content-disposition', attachmentDisposition(signOptions.download));
      }
      const signed = await r2.sign(new Request(urlFor(key, params), { method: 'GET' }), {
        aws: { signQuery: true },
      });
      return signed.url;
    },
    async signedUploadUrl(key, contentType, ttlSeconds = 900) {
      assertRenderKey(key);
      const expiresIn = Math.max(60, Math.min(Math.floor(ttlSeconds), 3600));
      const params = new URLSearchParams({ 'X-Amz-Expires': String(expiresIn) });
      const signed = await r2.sign(
        new Request(urlFor(key, params), { method: 'PUT', headers: { 'Content-Type': contentType } }),
        { aws: { signQuery: true } },
      );
      return signed.url;
    },
    async head(key) {
      const signed = await r2.sign(new Request(urlFor(key), { method: 'HEAD' }));
      const res = await fetcher(signed);
      if (res.status === 404) {
        if (options.legacyFallback?.head) return options.legacyFallback.head(key);
        return null;
      }
      if (!res.ok) throw new Error(`r2 render head failed: ${key} — status ${res.status}`);
      const len = Number(res.headers.get('content-length') ?? '');
      return {
        bytes: Number.isFinite(len) && len >= 0 ? len : 0,
        contentType: res.headers.get('content-type'),
      };
    },
    async readRange(key, start, end) {
      const s = Math.max(0, Math.floor(start));
      const e = Math.max(s, Math.floor(end));
      const signed = await r2.sign(new Request(urlFor(key), { method: 'GET', headers: { Range: `bytes=${s}-${e}` } }));
      const res = await fetcher(signed);
      if (res.status === 404) {
        if (options.legacyFallback?.readRange) return options.legacyFallback.readRange(key, s, e);
        if (options.legacyFallback) return (await options.legacyFallback.read(key)).subarray(s, e + 1);
        throw new RenderObjectNotFound(key);
      }
      if (!res.ok) throw new Error(`r2 render range failed: ${key} — status ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

/** Memoised per process, like the other resolvers (`lib/db/connect.ts`). */
const cache = ((globalThis as Record<string, unknown>).__playbookRenderStore ??= { store: null as RenderStore | null }) as {
  store: RenderStore | null;
};

export async function getRenderStore(): Promise<RenderStore> {
  if (cache.store !== null) return cache.store;
  const mode = selectStorageDriver(process.env);
  if (mode === 'r2') {
    const cfg = privateStorageR2Config(process.env);
    if (cfg) {
      const legacyFallback =
        process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
          ? createSupabaseRenderStore()
          : undefined;
      cache.store = createR2RenderStore(cfg, { legacyFallback });
      return cache.store;
    }
  }
  cache.store = mode === 'supabase' ? createSupabaseRenderStore() : createLocalRenderStore();
  return cache.store;
}

/** Test seam. */
export function resetRenderStore(): void {
  cache.store = null;
}

export function extensionFor(mime: string): string {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/jpeg':
      return 'jpg';
    case 'video/mp4':
      return 'mp4';
    case 'video/quicktime':
      return 'mov';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/wav':
      return 'wav';
    case 'audio/mp4':
      return 'm4a';
    case 'audio/aac':
      return 'aac';
    default:
      return 'bin';
  }
}
