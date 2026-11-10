/**
 * The YAGI team delivers a file into a project room (docs/BRAND-ROOMS.md §6): a film up to 200 MB or an
 * image up to 50 MB. The browser (or the command line) never sends the bytes through a function:
 *
 *   1. ask for an upload address (`/api/brand-rooms/reviews/upload` from /admin, `review.push` from the
 *      command line): the key is minted here, `brand-rooms/deliveries/<64 hex>.<ext>`, in the private
 *      staging bucket; cloud storage answers with a signed URL, local mode with this app's own address;
 *   2. put the file there;
 *   3. deliver (`brand_rooms.delivery.add` through /admin/do, `review.finish` from the command line):
 *      the bytes are re-read, their type checked by magic bytes, measured, thumbnailed (images) and moved
 *      into the studio media store under a fresh unguessable key; then lib/brand-studio/review.ts
 *      `staffDeliver` makes the studio asset (`source = 'delivery'`) and the review item.
 */
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { STAGING_BUCKET } from '@/lib/storage';
import type { StudioStaging } from '@/lib/brand-studio/types';
import { imageInfo, sniffMime, thumbnailWebp, videoInfo } from '@/lib/brand-studio/files';
import { checkDeliveryGate, staffDeliver, type DeliveryActor, type DeliveryOutcome, type ReviewDeps } from '@/lib/brand-studio/review';
import { roomReviewHref, type ReviewFailure } from '@/lib/brand-studio/review-contracts';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { IngestHandler, IngestResult } from './ingest';

export const DELIVERY_LIMITS = {
  imageBytesMax: 50_000_000,
  videoBytesMax: 200_000_000,
  /** Ten minutes is the studio's longest film. */
  videoMsMax: 600_000,
} as const;

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};
export const DELIVERY_MIMES = Object.keys(EXTENSIONS);

export const DELIVERY_STAGING_KEY = /^brand-rooms\/deliveries\/[0-9a-f]{64}\.(?:png|jpg|webp|mp4|mov)$/;
export const isDeliveryKey = (key: unknown): key is string => typeof key === 'string' && DELIVERY_STAGING_KEY.test(key);

export type DeliveryRefusal = 'too_large' | 'bad_type';

const kindOf = (mime: string): 'image' | 'video' | null => (mime.startsWith('image/') && EXTENSIONS[mime] ? 'image' : mime.startsWith('video/') && EXTENSIONS[mime] ? 'video' : null);

/** What the person holding the file is told before any byte moves. */
export function deliveryRefusal(mime: string, sizeBytes: number): DeliveryRefusal | null {
  const kind = kindOf(mime);
  if (!kind || !Number.isInteger(sizeBytes) || sizeBytes <= 0) return 'bad_type';
  return sizeBytes > (kind === 'image' ? DELIVERY_LIMITS.imageBytesMax : DELIVERY_LIMITS.videoBytesMax) ? 'too_large' : null;
}

export function newDeliveryKey(mime: string): string {
  const ext = EXTENSIONS[mime];
  if (!ext) throw new Error('delivery: unsupported type');
  return `brand-rooms/deliveries/${randomBytes(32).toString('hex')}.${ext}`;
}

/** Local mode: the browser or the command line PUTs the bytes here (`?key=`). */
export const DELIVERY_LOCAL_UPLOAD_ROUTE = '/api/brand-rooms/reviews/upload';

export interface UploadAddress {
  key: string;
  direct: boolean;
  url: string;
}

export async function deliveryUploadAddress(staging: StudioStaging, mime: string): Promise<UploadAddress> {
  const key = newDeliveryKey(mime);
  const url = await staging.signedUploadUrl(key, mime);
  if (url) return { key, direct: true, url };
  if (staging.servesSignedUrls) throw new Error('delivery: no upload address');
  return { key, direct: false, url: `${DELIVERY_LOCAL_UPLOAD_ROUTE}?${new URLSearchParams({ key })}` };
}

export interface DeliveryDeps extends ReviewDeps {
  staging: StudioStaging;
  log?: (event: string, detail?: Record<string, unknown>) => void;
}

export type DeliveryResult = DeliveryOutcome | ReviewFailure | { ok: false; code: 'file_too_large' | 'unsupported_file' };

/**
 * Turn an uploaded staging object into a deliverable. Authorization comes first (no bytes are read for
 * someone who may not deliver here); a stored copy that ends up unused is removed again.
 */
export async function deliverFile(
  deps: DeliveryDeps,
  actor: DeliveryActor,
  input: { organizationId: string; projectId: string; title: string; stackReviewId?: string | null; stagingKey: string; name?: string | null },
): Promise<DeliveryResult> {
  if (!isDeliveryKey(input.stagingKey)) return { ok: false, code: 'invalid' };
  const gate = await checkDeliveryGate(deps, actor, input.organizationId, input.projectId);
  if (!gate.ok) return gate;
  let bytes: Uint8Array;
  try {
    bytes = await deps.staging.read(STAGING_BUCKET, input.stagingKey);
  } catch {
    return { ok: false, code: 'not_found' };
  }
  const mime = sniffMime(bytes);
  const kind = mime ? kindOf(mime) : null;
  if (!mime || !kind) return { ok: false, code: 'unsupported_file' };
  if (bytes.byteLength > (kind === 'image' ? DELIVERY_LIMITS.imageBytesMax : DELIVERY_LIMITS.videoBytesMax)) return { ok: false, code: 'file_too_large' };
  let width: number | null = null;
  let height: number | null = null;
  let durationMs: number | null = null;
  const stored: string[] = [];
  let thumbKey: string | null = null;
  try {
    if (kind === 'image') {
      const size = await imageInfo(bytes);
      if (!size) return { ok: false, code: 'unsupported_file' };
      ({ width, height } = size);
      thumbKey = (await deps.media.put(await thumbnailWebp(bytes), 'image/webp')).key;
      stored.push(thumbKey);
    } else {
      const info = videoInfo(bytes);
      width = info?.width ?? null;
      height = info?.height ?? null;
      durationMs = info?.durationMs ?? null;
      if (durationMs !== null && durationMs > DELIVERY_LIMITS.videoMsMax) return { ok: false, code: 'unsupported_file' };
    }
    const { key } = await deps.media.put(bytes, mime);
    stored.push(key);
    const outcome = await staffDeliver(deps, actor, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      title: input.title,
      stackReviewId: input.stackReviewId ?? null,
      file: {
        key,
        thumbKey,
        kind,
        mime,
        sizeBytes: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        width,
        height,
        durationMs,
        name: (input.name ?? '').replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/\s+/g, ' ').trim(),
      },
    });
    const drop = outcome.ok ? outcome.unusedKeys : stored;
    for (const k of drop) await deps.media.delete(k).catch((error) => deps.log?.('delivery_media_delete_failed', { message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }));
    return outcome;
  } catch (error) {
    for (const k of stored) await deps.media.delete(k).catch(() => undefined);
    throw error;
  }
}

/* --------------------------------------------------------------- command line (lib/brand-rooms/ingest.ts) */

const PushSchema = z.object({ projectId: z.uuid(), mime: z.string().max(40), sizeBytes: z.number().int().positive() });
const FinishSchema = z.object({
  projectId: z.uuid(),
  title: z.string().max(400),
  stagingKey: z.string().regex(DELIVERY_STAGING_KEY),
  versionOf: z.uuid().nullish(),
  name: z.string().max(200).nullish(),
});

/**
 * `review.push`: where to put a deliverable's bytes. A signed URL in the cloud; locally this app's own
 * `PUT /api/brand-rooms/reviews/upload?key=…` (relative; send the same Bearer secret).
 */
export const ingestReviewPush: IngestHandler = async (ctx, raw) => {
  const parsed = PushSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: 'invalid' };
  const organizationId = await organizationOfProject(ctx.sql, parsed.data.projectId);
  if (!organizationId) return { ok: false, code: 'not_found' };
  const gate = await checkDeliveryGate({ sql: ctx.sql, media: ctx.media }, { ingest: true }, organizationId, parsed.data.projectId);
  if (!gate.ok) return { ok: false, code: gate.code === 'feature_unavailable' ? 'not_found' : gate.code };
  const refusal = deliveryRefusal(parsed.data.mime, parsed.data.sizeBytes);
  if (refusal) return { ok: false, code: refusal === 'too_large' ? 'file_too_large' : 'unsupported_file' };
  return { ok: true, ...(await deliveryUploadAddress(ctx.staging, parsed.data.mime)) } as IngestResult;
};

/** `review.finish`: the uploaded file becomes the project's deliverable (or the next version of `versionOf`'s stack). */
export const ingestReviewFinish: IngestHandler = async (ctx, raw) => {
  const parsed = FinishSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: 'invalid' };
  const v = parsed.data;
  const organizationId = await organizationOfProject(ctx.sql, v.projectId);
  if (!organizationId) return { ok: false, code: 'not_found' };
  const result = await deliverFile({ sql: ctx.sql, media: ctx.media, staging: ctx.staging, log: ctx.log }, { ingest: true }, {
    organizationId,
    projectId: v.projectId,
    title: v.title,
    stackReviewId: v.versionOf ?? null,
    stagingKey: v.stagingKey,
    name: v.name ?? null,
  });
  if (!result.ok) return { ok: false, code: result.code === 'feature_unavailable' ? 'not_found' : result.code };
  const review = result.created.review;
  return {
    ok: true,
    reviewId: review.id,
    version: review.version ?? 1,
    existing: result.created.existing,
    adminPath: `/admin/brand-studio/reviews/${review.id}`,
    brandPath: roomReviewHref(organizationId, v.projectId, review.id),
  } as IngestResult;
};

/** The organization a project belongs to (the command line names only the project). */
export async function organizationOfProject(sql: SqlRunner, projectId: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return null;
  const row = (await sql.query<{ organization_id: string }>('select organization_id from brand_projects where id = $1', [projectId])).rows[0];
  return row ? String(row.organization_id) : null;
}
