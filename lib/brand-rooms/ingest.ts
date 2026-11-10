/**
 * The team's command-line door into project rooms (docs/BRAND-ROOMS.md §5, §9-2): `POST
 * /api/brand-rooms/ingest`, authenticated only by the server secret `BRAND_ROOM_INGEST_SECRET`
 * (`Authorization: Bearer …`). A missing or wrong secret, the flag off, or a sandboxed organization all
 * answer 404: the door does not confirm it exists. scripts/twings-room.mjs is its client.
 *
 * Dispatch: one map, `INGEST_OPERATIONS`. Another slice adds its operation with one line there
 * (`'message.post': postMessageFromCli,`); a handler gets the shared context and the raw input, and
 * answers `{ ok: true, … }` or `{ ok: false, code }`. Handlers never print or return the secret.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { StudioMediaStore } from '@/lib/brand-studio/media-store';
import type { StudioStaging } from '@/lib/brand-studio/types';
import { ingestFinishStoryboard, ingestPushStoryboard } from './storyboards';
import { ingestReviewFinish, ingestReviewPush } from './deliveries';
import { STORYBOARD_LIMITS, STORYBOARD_UPLOAD_MIMES, storyboardAdminHref, storyboardRoomHref } from './storyboard-contracts';

export const INGEST_SECRET_ENV = 'BRAND_ROOM_INGEST_SECRET';
/** A shorter configured secret is treated as missing (the door stays shut). */
const SECRET_MIN = 16;

/** Constant-time comparison of what was presented with the configured secret (digests, so length leaks nothing). */
export function ingestSecretMatches(configured: string | undefined, presented: string | null | undefined): boolean {
  const expected = configured?.trim();
  if (!expected || expected.length < SECRET_MIN || !presented) return false;
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(presented.trim()).digest();
  return timingSafeEqual(a, b);
}

export function presentedSecret(headers: Headers): string | null {
  const bearer = headers.get('authorization');
  if (!bearer) return null;
  const match = /^Bearer\s+(.+)$/i.exec(bearer.trim());
  return match ? match[1]! : null;
}

export interface IngestContext {
  sql: SqlRunner;
  media: StudioMediaStore;
  staging: StudioStaging;
  log?: (event: string, detail?: Record<string, unknown>) => void;
}

/** A success carries whatever the operation answers (sent as JSON); a failure carries only its code. */
export type IngestResult = ({ ok: true } & Record<string, unknown>) | { ok: false; code: string };
export type IngestHandler = (ctx: IngestContext, input: unknown) => Promise<IngestResult>;

/* --------------------------------------------------------------- storyboards */

const PushSchema = z.object({
  projectId: z.uuid(),
  title: z.string().max(400),
  versionOf: z.uuid().nullish(),
  cuts: z
    .array(
      z.object({
        scene: z.union([z.string(), z.number()]).nullish(),
        shot: z.union([z.string(), z.number()]).nullish(),
        description: z.string().nullish(),
        camera: z.string().nullish(),
        audio: z.string().nullish(),
        seconds: z.number().nullish(),
        mime: z.enum(STORYBOARD_UPLOAD_MIMES),
        sizeBytes: z.number().int().min(1),
      }),
    )
    .min(1)
    .max(STORYBOARD_LIMITS.framesPerBoard),
});

const label = (v: string | number | null | undefined) => (v == null ? null : String(v));

const pushStoryboard: IngestHandler = async (ctx, raw) => {
  const parsed = PushSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: 'invalid' };
  const v = parsed.data;
  const result = await ingestPushStoryboard(ctx, {
    projectId: v.projectId,
    title: v.title,
    versionOf: v.versionOf ?? null,
    cuts: v.cuts.map((c) => ({
      mime: c.mime,
      sizeBytes: c.sizeBytes,
      text: {
        scene: label(c.scene),
        shot: label(c.shot),
        description: c.description ?? '',
        camera: c.camera ?? null,
        audio: c.audio ?? null,
        seconds: c.seconds ?? null,
      },
    })),
  });
  if (!result.ok) return result;
  return {
    ...result,
    adminPath: storyboardAdminHref(result.storyboardId),
    brandPath: storyboardRoomHref(result.organizationId, result.projectId, result.storyboardId),
  };
};

const FinishSchema = z.object({ storyboardId: z.uuid(), share: z.boolean().optional() });

const finishStoryboard: IngestHandler = async (ctx, raw) => {
  const parsed = FinishSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: 'invalid' };
  const result = await ingestFinishStoryboard(ctx, parsed.data);
  return result.ok ? { ...result } : result;
};

/* --------------------------------------------------------------- dispatch */

/** Every command-line operation. One line per operation; slices M and R add theirs here. */
export const INGEST_OPERATIONS: Readonly<Record<string, IngestHandler>> = {
  'storyboard.push': pushStoryboard,
  'storyboard.finish': finishStoryboard,
  'review.push': ingestReviewPush,
  'review.finish': ingestReviewFinish,
};

export function isIngestOperation(value: unknown): value is string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(INGEST_OPERATIONS, value);
}

export async function runIngest(ctx: IngestContext, operation: unknown, input: unknown): Promise<IngestResult> {
  if (!isIngestOperation(operation)) return { ok: false, code: 'invalid' };
  return INGEST_OPERATIONS[operation]!(ctx, input);
}

/* --------------------------------------------------------------- bytes */

/** Read a request body of at most `max` bytes, exactly `max` when `exact`. */
export async function readCappedBody(
  request: Request,
  max: number,
  exact = true,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; code: 'file_too_large' | 'invalid' }> {
  if (Number(request.headers.get('content-length') ?? 0) > max) return { ok: false, code: 'file_too_large' };
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, code: 'invalid' };
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > max) {
      await reader.cancel();
      return { ok: false, code: 'file_too_large' };
    }
    chunks.push(next.value);
  }
  if (exact && length !== max) return { ok: false, code: 'invalid' };
  return { ok: true, bytes: Buffer.concat(chunks) };
}
