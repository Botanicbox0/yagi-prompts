import { randomUUID } from 'node:crypto';
import { AwsClient } from 'aws4fetch';
import type { PublishedBucket } from '@/lib/content/schemas';
import type { PrivateStorageR2Config } from '@/lib/runtime-mode';
import {
  STAGING_BUCKET,
  StorageObjectNotFound,
  type Bucket,
  type CopyOutcome,
  type CopyRequest,
  type StorageDriver,
} from './index';

export type BrandStorageSurface = 'studio' | 'rooms' | 'attachments' | 'deliverables';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT_KEY_RE =
  /^orgs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(studio|rooms|attachments|deliverables)\/(\d{4}-\d{2})\/([A-Za-z0-9._-]+)$/i;

export function assertSafeStorageKey(key: string): void {
  if (
    !key ||
    key.startsWith('/') ||
    key.endsWith('/') ||
    key.includes('\\') ||
    key.includes('//') ||
    /[\u0000-\u001f\u007f]/.test(key)
  ) {
    throw new Error(`illegal storage key: ${key}`);
  }
  for (const segment of key.split('/')) {
    if (!segment || segment === '.' || segment === '..') {
      throw new Error(`illegal storage key: ${key}`);
    }
  }
}

/**
 * Multi-brand tenant-isolated object key inside `twings-private-apac`:
 * `orgs/{organizationId}/{surface}/{YYYY-MM}/{uuid}.{ext}`
 */
export function brandTenantStorageKey(input: {
  organizationId: string;
  surface: BrandStorageSurface;
  ext: string;
  id?: string;
  now?: Date;
}): string {
  const orgId = input.organizationId.trim().toLowerCase();
  if (!UUID_RE.test(orgId)) throw new Error(`illegal organizationId: ${input.organizationId}`);
  const id = (input.id ?? randomUUID()).trim().toLowerCase();
  if (!UUID_RE.test(id)) throw new Error(`illegal object id: ${id}`);
  const cleanExt = input.ext.replace(/^\./, '').trim().toLowerCase();
  if (!/^[a-z0-9]{1,8}$/.test(cleanExt)) throw new Error(`illegal extension: ${input.ext}`);
  const date = input.now ?? new Date();
  const ym = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  return `orgs/${orgId}/${input.surface}/${ym}/${id}.${cleanExt}`;
}

export function parseBrandTenantKey(key: string): {
  organizationId: string;
  surface: BrandStorageSurface;
  yearMonth: string;
  filename: string;
} | null {
  const match = TENANT_KEY_RE.exec(key);
  if (!match) return null;
  return {
    organizationId: match[1]!.toLowerCase(),
    surface: match[2]!.toLowerCase() as BrandStorageSurface,
    yearMonth: match[3]!,
    filename: match[4]!,
  };
}

export const DEFAULT_R2_ALLOWED_ORIGINS = [
  'https://twings.app',
  'https://brand.twings.app',
  'https://admin.twings.app',
  'https://*.vercel.app',
] as const;

export function buildMultiBrandR2CorsXml(origins: readonly string[] = DEFAULT_R2_ALLOWED_ORIGINS): string {
  const originTags = origins.map((o) => `    <AllowedOrigin>${o}</AllowedOrigin>`).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">',
    '  <CORSRule>',
    originTags,
    '    <AllowedMethod>GET</AllowedMethod>',
    '    <AllowedMethod>HEAD</AllowedMethod>',
    '    <AllowedMethod>PUT</AllowedMethod>',
    '    <AllowedHeader>Content-Type</AllowedHeader>',
    '    <AllowedHeader>Range</AllowedHeader>',
    '    <AllowedHeader>If-None-Match</AllowedHeader>',
    '    <ExposeHeader>ETag</ExposeHeader>',
    '    <ExposeHeader>Content-Length</ExposeHeader>',
    '    <ExposeHeader>Content-Range</ExposeHeader>',
    '    <ExposeHeader>Accept-Ranges</ExposeHeader>',
    '    <MaxAgeSeconds>86400</MaxAgeSeconds>',
    '  </CORSRule>',
    '</CORSConfiguration>',
  ].join('\n');
}

export function buildMultiBrandR2LifecycleXml(options?: { includeStagingExpiry?: boolean }): string {
  const rules = [
    [
      '  <Rule>',
      '    <ID>abort-incomplete-multipart-1d</ID>',
      '    <Filter><Prefix></Prefix></Filter>',
      '    <Status>Enabled</Status>',
      '    <AbortIncompleteMultipartUpload>',
      '      <DaysAfterInitiation>1</DaysAfterInitiation>',
      '    </AbortIncompleteMultipartUpload>',
      '  </Rule>',
    ].join('\n'),
  ];

  if (options?.includeStagingExpiry) {
    for (const [id, prefix] of [
      ['expire-staging-prefix-7d', 'staging/'],
      ['expire-prompt-staging-7d', 'content/prompt/'],
      ['expire-staging-root-7d', 'staging/content/prompt/'],
    ] as const) {
      rules.push(
        [
          '  <Rule>',
          `    <ID>${id}</ID>`,
          `    <Filter><Prefix>${prefix}</Prefix></Filter>`,
          '    <Status>Enabled</Status>',
          '    <Expiration><Days>7</Days></Expiration>',
          '  </Rule>',
        ].join('\n'),
      );
    }
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<LifecycleConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">',
    ...rules,
    '</LifecycleConfiguration>',
  ].join('\n');
}

function objectPathForBucket(bucket: Bucket, key: string): string {
  assertSafeStorageKey(key);
  if (bucket === STAGING_BUCKET) return `staging/${key}`;
  return `published/${bucket}/${key}`;
}

function encodeS3Key(pathKey: string): string {
  return pathKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export interface CreateR2PrivateDriverOptions {
  fetcher?: typeof fetch;
  publicMediaBaseUrl?: string;
  /** Optional read/sign fallback to Supabase `content` for pre-migration brand attachments. */
  legacyFallback?: StorageDriver;
}

/**
 * Full private `StorageDriver` backed by Cloudflare R2 (`twings-private-apac`).
 *
 * Preserves §6 write-once guarantees (no `delete` / `remove` / `unlink` / `destroy` methods on
 * published buckets; `putStaging` and `copy` are `upsert:false`), while exposing `releaseStaging`
 * strictly for ephemeral staging keys once verified in their final destination.
 */
export function createR2PrivateStorageDriver(
  config: PrivateStorageR2Config,
  options: CreateR2PrivateDriverOptions = {},
): StorageDriver {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const r2 = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
    region: 'auto',
  });
  const baseUrl = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`;
  const publicBase = (options.publicMediaBaseUrl ?? 'https://media.twings.app').replace(/\/$/, '');

  const urlFor = (bucket: Bucket, key: string, query?: URLSearchParams): string => {
    const encoded = encodeS3Key(objectPathForBucket(bucket, key));
    const qs = query ? `?${query.toString()}` : '';
    return `${baseUrl}/${encoded}${qs}`;
  };

  async function headObject(bucket: Bucket, key: string): Promise<boolean> {
    const signed = await r2.sign(new Request(urlFor(bucket, key), { method: 'HEAD' }));
    const res = await fetcher(signed);
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`r2 head failed: ${bucket}/${key} — status ${res.status}`);
    return true;
  }

  async function putObject(bucket: Bucket, key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const body = Buffer.from(bytes);
    const signed = await r2.sign(
      new Request(urlFor(bucket, key), {
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
    if (!res.ok) throw new Error(`r2 upload failed: ${bucket}/${key} — status ${res.status}`);
  }

  return {
    name: 'r2',
    servesSignedUrls: true,

    async signedUploadUrl(key: string, contentType: string): Promise<string> {
      const params = new URLSearchParams({ 'X-Amz-Expires': '900' });
      const req = new Request(urlFor(STAGING_BUCKET, key, params), {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
      });
      const signed = await r2.sign(req, { aws: { signQuery: true } });
      return signed.url;
    },

    async signedStagingUrl(key: string, expiresInSeconds: number): Promise<string | null> {
      const expiresIn = Number.isFinite(expiresInSeconds)
        ? Math.max(1, Math.min(Math.floor(expiresInSeconds), 60))
        : 60;
      if (!(await headObject(STAGING_BUCKET, key))) {
        if (options.legacyFallback?.signedStagingUrl) {
          return options.legacyFallback.signedStagingUrl(key, expiresIn);
        }
        throw new StorageObjectNotFound(STAGING_BUCKET, key);
      }
      const params = new URLSearchParams({
        'X-Amz-Expires': String(expiresIn),
        'response-content-disposition': 'attachment',
      });
      const signed = await r2.sign(new Request(urlFor(STAGING_BUCKET, key, params), { method: 'GET' }), {
        aws: { signQuery: true },
      });
      return signed.url;
    },

    async putStaging(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
      // upsert:false — retried uploads never overwrite an existing staging object.
      if (await headObject(STAGING_BUCKET, key)) return;
      await putObject(STAGING_BUCKET, key, bytes, contentType);
    },

    async releaseStaging(key: string): Promise<void> {
      const signed = await r2.sign(new Request(urlFor(STAGING_BUCKET, key), { method: 'DELETE' }));
      const res = await fetcher(signed);
      if (!res.ok && res.status !== 404) {
        throw new Error(`r2 releaseStaging failed: ${key} — status ${res.status}`);
      }
    },

    async exists(bucket: Bucket, key: string): Promise<boolean> {
      if (await headObject(bucket, key)) return true;
      return options.legacyFallback ? options.legacyFallback.exists(bucket, key) : false;
    },

    async read(bucket: Bucket, key: string): Promise<Uint8Array> {
      const signed = await r2.sign(new Request(urlFor(bucket, key), { method: 'GET' }));
      const res = await fetcher(signed);
      if (res.status === 404) {
        if (options.legacyFallback) return options.legacyFallback.read(bucket, key);
        throw new StorageObjectNotFound(bucket, key);
      }
      if (!res.ok) throw new Error(`r2 download failed: ${bucket}/${key} — status ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },

    async copy({ fromKey, toBucket, toKey }: CopyRequest): Promise<CopyOutcome> {
      if (await headObject(toBucket, toKey)) return 'exists';
      const bytes = await this.read(STAGING_BUCKET, fromKey);
      await putObject(toBucket, toKey, bytes, 'application/octet-stream');
      return 'copied';
    },

    async signedUrl(bucket: PublishedBucket, key: string, expiresInSeconds: number): Promise<string> {
      const expiresIn = Math.max(1, Math.min(Math.floor(expiresInSeconds), 60));
      if (!(await headObject(bucket, key))) {
        if (options.legacyFallback) return options.legacyFallback.signedUrl(bucket, key, expiresIn);
        throw new StorageObjectNotFound(bucket, key);
      }
      const params = new URLSearchParams({ 'X-Amz-Expires': String(expiresIn) });
      const signed = await r2.sign(new Request(urlFor(bucket, key, params), { method: 'GET' }), {
        aws: { signQuery: true },
      });
      return signed.url;
    },

    publicUrl(key: string): string {
      assertSafeStorageKey(key);
      return `${publicBase}/${encodeS3Key(key)}`;
    },
  };
}
