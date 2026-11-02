import { writeFileSync } from 'node:fs';
import { AwsClient } from 'aws4fetch';
import { config as loadEnv } from 'dotenv';
import { createSupabaseStorageDriver } from '@/lib/storage/supabase-driver';
import { renderPublicMediaKeys, syncPublicMedia, type PublicMediaObject, type PublicMediaRead } from '@/lib/storage/public-media-sync';
import { createServiceClient } from '@/lib/supabase/service-client';

/**
 * `npm run r2:sync-public` copies `public-content` to the R2 public bucket, reads every object back
 * from `PUBLIC_MEDIA_BASE_URL`, and rewrites `lib/content/public-media-keys.ts` with the keys that
 * passed. It never deletes anything, on either side. Prints key names and reasons, never a credential.
 *
 * `R2_ENV_FILE` points at another env file, for running from a worktree.
 */
loadEnv({ path: [process.env.R2_ENV_FILE ?? '.env.local', '.env'], quiet: true });

const REQUIRED = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_PUBLIC_BUCKET', 'PUBLIC_MEDIA_BASE_URL'] as const;
const missing = REQUIRED.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  console.error(`Missing: ${missing.join(', ')}`);
  process.exit(1);
}

const env = (name: (typeof REQUIRED)[number]) => process.env[name]!.trim();
const objectUrl = (key: string) => `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com/${env('R2_PUBLIC_BUCKET')}/${key}`;
const mediaBase = env('PUBLIC_MEDIA_BASE_URL').replace(/\/$/, '');
const r2 = new AwsClient({ accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY'), service: 's3', region: 'auto' });

const client = createServiceClient();
const driver = createSupabaseStorageDriver(client);
const PAGE = 500;

async function list(): Promise<PublicMediaObject[]> {
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
}

async function put(key: string, bytes: Uint8Array, meta: { mime: string; cacheControl: string }): Promise<void> {
  const response = await r2.fetch(objectUrl(key), {
    method: 'PUT',
    body: Buffer.from(bytes),
    headers: { 'Content-Type': meta.mime, 'Cache-Control': meta.cacheControl },
  });
  if (!response.ok) throw new Error(`put ${response.status}`);
}

async function publicGet(key: string, range?: { start: number; end: number }): Promise<PublicMediaRead> {
  const response = await fetch(`${mediaBase}/${key}`, range ? { headers: { Range: `bytes=${range.start}-${range.end}` } } : undefined);
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    contentRange: response.headers.get('content-range'),
    cacheControl: response.headers.get('cache-control'),
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
}

async function main(): Promise<void> {
  const report = await syncPublicMedia({ list, read: (key) => driver.read('public-content', key), put, publicGet });
  writeFileSync('lib/content/public-media-keys.ts', renderPublicMediaKeys(report.verified));
  console.log(`verified ${report.verified.length} · failed ${report.failed.length} · left on Supabase ${report.skipped.length}`);
  for (const { key, reason } of report.failed) console.log(`FAILED ${reason} ${key}`);
  for (const key of report.skipped) console.log(`LEFT ${key}`);
  if (report.failed.length > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'sync failed');
  process.exit(1);
});
