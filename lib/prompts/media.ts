import { createHash, randomUUID } from 'node:crypto';
import { AssetRefSchema, type AssetRef } from '@/lib/content/schemas';
import { extensionFor } from '@/lib/admin/assets';
import type { StorageDriver } from '@/lib/storage';
import {
  AUDIO_MAX_BYTES,
  mediaEntries,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_SECONDS,
  type MediaKind,
  type PromptMedia,
} from './schemas';

/**
 * PLAN §13.1 — "Media lifecycle: uploads → staging; on publish/approve, copy to public keys
 * (posters/videos are card surface = public marketing doctrine §3.1). Same storage interface,
 * small dedicated path; no revisions."
 *
 * "Same storage interface" is the whole design: `StorageDriver.copy()` is still `upsert:false`,
 * keys are still `{sha256}.{ext}`, there is still no delete path, and the local driver and the
 * Supabase driver remain a swap rather than a rewrite. The only thing that differs is the staging
 * namespace — a prompt has no revision to scope one to.
 */

/** `content/prompt/{promptId}/{uuid}.{ext}` — private, never served (cf. `content/rev/...`). */
export function promptStagingKey(promptId: string, ext: string): string {
  return `content/prompt/${promptId}/${randomUUID()}.${ext}`;
}

/**
 * The key for a DIRECT browser upload (2026-08-15), which is minted before a prompt id exists.
 *
 * `content/prompt/upload/{uuid}.{ext}`. The prompt-id folder in the key above is filing, not
 * correctness — a staging object is private, is referenced by the row that points at it, and is
 * copied to a content-addressed public key at publish. A create form has no row yet, so the upload
 * lands in one shared folder rather than in a folder named after an id we would have to invent and
 * then hope the form actually used.
 *
 * Minted SERVER-side from a uuid: a caller cannot choose where in the bucket to write, which is the
 * whole reason handing a signed URL to a browser is safe.
 */
export function directUploadKey(filename: string, mime: string): string {
  return `content/prompt/upload/${randomUUID()}.${extensionFor(filename, mime)}`;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** `{sha256}.{ext}` — content-addressed, mirroring the `asset_ext()` SQL helper exactly. */
export function publishedKeyFor(sha256: string, stagingKey: string): string {
  const match = /\.[A-Za-z0-9]+$/.exec(stagingKey);
  return `${sha256}${match ? match[0].toLowerCase() : ''}`;
}

// ---------------------------------------------------------------------------
// upload validation (§13.1 caps)
// ---------------------------------------------------------------------------

export const ALLOWED_POSTER_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/avif'] as const;
export const ALLOWED_VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;
/** The formats music/TTS models actually emit. `audio/mp4` is m4a — ISO-BMFF, so the mvhd probe
 *  reads its duration for free; the rest carry no cap beyond size (human moderation, as WebM). */
export const ALLOWED_AUDIO_MIMES = [
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/aac',
  'audio/ogg',
  'audio/flac',
] as const;

export type UploadRejection =
  | 'too_large'
  | 'too_long'
  | 'bad_type';

export interface UploadCheckInput {
  kind: MediaKind;
  mime: string;
  sizeBytes: number;
  /** `null` when the container's duration could not be read — see `probeMp4DurationSeconds`. */
  durationSeconds: number | null;
}

/**
 * The server-side caps. Size and type are absolute; duration is enforced **where it is knowable**.
 *
 * Interpretation logged for the Director: §13.1 says "video ≤ 60s/32MB". 32MB is measured over the
 * received bytes and is unconditional. Duration needs a container parser — mp4/mov carry it in
 * `mvhd` and are read below with no new dependency; WebM stores it in an EBML float that would take
 * a real parser, so an unreadable duration is ACCEPTED and left to moderation (every community
 * submission is reviewed by a human before it is ever visible). The alternative — refusing every
 * WebM — would be a stricter rule than the plan asks for, dressed up as the same one.
 */
export function checkUpload(input: UploadCheckInput): UploadRejection | null {
  const mime = input.mime.split(';')[0]!.trim().toLowerCase();
  const allowed: readonly string[] =
    input.kind === 'video'
      ? ALLOWED_VIDEO_MIMES
      : input.kind === 'audio'
        ? ALLOWED_AUDIO_MIMES
        : ALLOWED_POSTER_MIMES;
  if (!allowed.includes(mime)) return 'bad_type';
  const maxBytes = input.kind === 'audio' ? AUDIO_MAX_BYTES : VIDEO_MAX_BYTES;
  if (input.sizeBytes > maxBytes) return 'too_large';
  if (
    input.kind === 'video' &&
    input.durationSeconds !== null &&
    input.durationSeconds > VIDEO_MAX_SECONDS
  ) {
    return 'too_long';
  }
  return null;
}

// ---------------------------------------------------------------------------
// mp4 / mov duration, without a dependency
// ---------------------------------------------------------------------------

const TEXT = new TextDecoder('latin1');

function boxType(bytes: Uint8Array, at: number): string {
  return TEXT.decode(bytes.subarray(at, at + 4));
}

/**
 * Walk ISO-BMFF boxes at `[start, end)` looking for `type`, returning its PAYLOAD range.
 *
 * Defensive by construction: a malformed size (0, negative after the header, or past the end)
 * terminates the walk instead of looping. This reads a file an anonymous user uploaded.
 */
function findBox(
  bytes: Uint8Array,
  start: number,
  end: number,
  type: string,
): { start: number; end: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = start;
  while (cursor + 8 <= end) {
    let size = view.getUint32(cursor);
    let header = 8;
    if (size === 1) {
      if (cursor + 16 > end) return null;
      // 64-bit largesize: the high word is beyond anything we would parse, so cap at 2^32.
      const high = view.getUint32(cursor + 8);
      const low = view.getUint32(cursor + 12);
      if (high !== 0) return null;
      size = low;
      header = 16;
    } else if (size === 0) {
      size = end - cursor;
    }
    if (size < header || cursor + size > end) return null;
    if (boxType(bytes, cursor + 4) === type) {
      return { start: cursor + header, end: cursor + size };
    }
    cursor += size;
  }
  return null;
}

/** Seconds from `moov/mvhd`, or `null` when the container is not ISO-BMFF or is truncated. */
export function probeMp4DurationSeconds(bytes: Uint8Array): number | null {
  if (bytes.byteLength < 16) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const moov = findBox(bytes, 0, bytes.byteLength, 'moov');
  if (!moov) return null;
  const mvhd = findBox(bytes, moov.start, moov.end, 'mvhd');
  if (!mvhd) return null;
  if (mvhd.start + 4 > mvhd.end) return null;

  const version = view.getUint8(mvhd.start);
  // version+flags(4) then: v0 → created(4) modified(4) timescale(4) duration(4)
  //                        v1 → created(8) modified(8) timescale(4) duration(8)
  const at = mvhd.start + 4;
  if (version === 1) {
    if (at + 28 > mvhd.end) return null;
    const timescale = view.getUint32(at + 16);
    const high = view.getUint32(at + 20);
    const low = view.getUint32(at + 24);
    if (timescale === 0 || high !== 0) return null;
    return low / timescale;
  }
  if (at + 16 > mvhd.end) return null;
  const timescale = view.getUint32(at + 8);
  const duration = view.getUint32(at + 12);
  if (timescale === 0) return null;
  return duration / timescale;
}

export function probeVideoDurationSeconds(bytes: Uint8Array, mime: string): number | null {
  const type = mime.split(';')[0]!.trim().toLowerCase();
  if (type === 'video/mp4' || type === 'video/quicktime') return probeMp4DurationSeconds(bytes);
  return null;
}

// ---------------------------------------------------------------------------
// staging
// ---------------------------------------------------------------------------

export interface StagedPromptAsset {
  ref: AssetRef;
  sizeBytes: number;
  durationSeconds: number | null;
}

export type StageResult =
  | { ok: true; value: StagedPromptAsset }
  | { ok: false; reason: UploadRejection };

/** Validate, hash and stage one uploaded file. The hash is computed HERE, over the real bytes. */
export async function stagePromptUpload(
  storage: StorageDriver,
  promptId: string,
  kind: MediaKind,
  upload: File,
): Promise<StageResult> {
  const bytes = new Uint8Array(await upload.arrayBuffer());
  const mime = upload.type && upload.type.length > 0 ? upload.type : 'application/octet-stream';
  // m4a is ISO-BMFF too — the same mvhd walk answers, so the duration rides the ref for the UI.
  const durationSeconds =
    kind === 'video'
      ? probeVideoDurationSeconds(bytes, mime)
      : kind === 'audio' && mime.split(';')[0]!.trim().toLowerCase() === 'audio/mp4'
        ? probeMp4DurationSeconds(bytes)
        : null;

  const rejection = checkUpload({
    kind,
    mime,
    sizeBytes: bytes.byteLength,
    durationSeconds,
  });
  if (rejection !== null) return { ok: false, reason: rejection };

  const key = promptStagingKey(promptId, extensionFor(upload.name, mime));
  await storage.putStaging(key, bytes, mime);

  const ref = AssetRefSchema.parse({
    staging_key: key,
    sha256: sha256Hex(bytes),
    mime,
    ...(durationSeconds === null ? {} : { duration_s: Math.round(durationSeconds * 100) / 100 }),
  });
  return { ok: true, value: { ref, sizeBytes: bytes.byteLength, durationSeconds } };
}

// ---------------------------------------------------------------------------
// publication (§13.1 — copy to public keys on publish/approve)
// ---------------------------------------------------------------------------

export interface PromptCopyReport {
  copied: number;
  alreadyPresent: number;
}

/**
 * Copy every staged asset into `public-content` and stamp the published key back onto the ref.
 *
 * Idempotent in both directions: `copy()` is `upsert:false`, so an identical content-addressed key
 * already present is SUCCESS, and re-running over an already-stamped ref recomputes the same key
 * from the same hash. That is what makes "approve" safe to press twice.
 */
export async function publishPromptMedia(
  storage: StorageDriver,
  media: PromptMedia,
): Promise<{ media: PromptMedia; report: PromptCopyReport }> {
  const report: PromptCopyReport = { copied: 0, alreadyPresent: 0 };
  const next: PromptMedia = {};

  const publish = async (ref: AssetRef): Promise<AssetRef> => {
    const toKey = publishedKeyFor(ref.sha256, ref.staging_key);
    const outcome = await storage.copy({
      fromKey: ref.staging_key,
      toBucket: 'public-content',
      toKey,
    });
    if (outcome === 'copied') report.copied += 1;
    else report.alreadyPresent += 1;

    return AssetRefSchema.parse({
      ...ref,
      published_key: toKey,
      bucket: 'public-content',
    });
  };

  for (const [kind, ref] of mediaEntries(media)) {
    next[kind] = await publish(ref);
  }
  // A set's example frames ride along, in order — an `/admin` edit must never drop them.
  if (media.gallery) {
    const gallery: AssetRef[] = [];
    for (const ref of media.gallery) gallery.push(await publish(ref));
    next.gallery = gallery;
  }

  return { media: next, report };
}
