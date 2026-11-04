import type { SupabaseClient } from '@supabase/supabase-js';
import { AwsClient } from 'aws4fetch';
import type { PublicMediaR2Config } from '@/lib/runtime-mode';
import type { PublicMediaStore } from './public-media-direct';
import type { PublicMediaObject, PublicMediaRead, PublicMediaSyncDeps } from './public-media-sync';
import { createSupabaseStorageDriver } from './supabase-driver';

const PAGE = 500;

/**
 * The R2 S3 endpoint for writes and the public media host for the read back. The read back goes through
 * the same address a visitor uses, because that is the address being vouched for. `has` asks the S3
 * endpoint: the public host caches a 404 for a few minutes, which would hide a file about to be written.
 */
export function createR2PublicMediaStore(config: PublicMediaR2Config): PublicMediaStore {
  const objectUrl = (key: string) => `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${key}`;
  const mediaBase = config.mediaBaseUrl.replace(/\/$/, '');
  const r2 = new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, service: 's3', region: 'auto' });

  return {
    async has(key) {
      const response = await r2.fetch(objectUrl(key), { method: 'HEAD', cache: 'no-store' });
      if (response.status === 404) return false;
      if (!response.ok) throw new Error(`head ${response.status}`);
      return true;
    },

    async put(key, bytes, meta) {
      const body = Buffer.from(bytes);
      const response = await r2.fetch(objectUrl(key), {
        method: 'PUT',
        body,
        cache: 'no-store',
        headers: {
          'Content-Type': meta.mime,
          'Cache-Control': meta.cacheControl,
          'Content-Length': String(body.byteLength),
        },
      });
      if (!response.ok) throw new Error(`put ${response.status}`);
    },

    async publicGet(key, range): Promise<PublicMediaRead> {
      const response = await fetch(`${mediaBase}/${key}`, {
        cache: 'no-store',
        ...(range ? { headers: { Range: `bytes=${range.start}-${range.end}` } } : {}),
      });
      return {
        status: response.status,
        contentType: response.headers.get('content-type'),
        contentRange: response.headers.get('content-range'),
        cacheControl: response.headers.get('cache-control'),
        bytes: new Uint8Array(await response.arrayBuffer()),
      };
    },
  };
}

/** `lib/storage/public-media-sync.ts` with Supabase as the source of a by-hand run. */
export function createR2PublicMediaDeps(config: PublicMediaR2Config, client: SupabaseClient): PublicMediaSyncDeps {
  const driver = createSupabaseStorageDriver(client);
  const store = createR2PublicMediaStore(config);

  return {
    async list() {
      const objects: PublicMediaObject[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await client.storage.from('public-content').list('', { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
        if (error) throw new Error(`list failed: ${error.message}`);
        for (const item of data) {
          // A folder has no id and no metadata. It is reported by name and never copied.
          objects.push({ key: item.name, size: Number(item.metadata?.size ?? 0), mime: String(item.metadata?.mimetype ?? 'application/octet-stream') });
        }
        if (data.length < PAGE) return objects;
      }
    },

    read: (key) => driver.read('public-content', key),
    put: store.put,
    publicGet: store.publicGet,
  };
}
