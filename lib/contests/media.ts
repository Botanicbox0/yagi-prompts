import { randomUUID } from 'node:crypto';
import { AssetRefSchema, type AssetRef } from '@/lib/content/schemas';
import { extensionFor } from '@/lib/admin/assets';
import {
  checkUpload,
  publishedKeyFor,
  probeVideoDurationSeconds,
  sha256Hex,
  type UploadRejection,
} from '@/lib/prompts/media';
import type { StorageDriver } from '@/lib/storage';
import {
  CONTEST_MEDIA_KINDS,
  contestMediaPath,
  contestMediaRef,
  type ContestMediaKind,
} from './links';
import { parseContestMedia, type ContestMedia } from './schemas';

/**
 * PLAN §14 media, on the §13.1 lifecycle verbatim: private staging on upload, content-addressed
 * copy into `public-content` at PUBLISH, `upsert:false`, no delete path.
 *
 * **This is the decision the brief left open, and the reason it went this way.** The alternative —
 * "contests are admin-only, so write the poster straight to `public-content`" — would be simpler
 * and would break the §6 disclosure doctrine: *anything ever served from `public-content` is
 * permanently disclosed*. A DRAFT contest is precisely the thing that must not be disclosed; §14.1
 * makes publishing the founder's act because "a prize is a public commitment", and a poster
 * announcing an unannounced prize is the same commitment leaking a day early through a CDN. So the
 * poster follows the prompt lifecycle: staged privately, visible to the admin preview only, copied
 * at the moment the contest becomes public — and, because the copy is idempotent and
 * content-addressed, republishing is free.
 *
 * The validation, hashing and duration-probe helpers are IMPORTED from `lib/prompts/media.ts`
 * rather than re-declared: the caps are the same caps, and a second copy of an ISO-BMFF parser is a
 * second thing to get wrong.
 */

/** `content/contest/{contestId}/{uuid}.{ext}` — private, never served (cf. `content/prompt/...`). */
export function contestStagingKey(contestId: string, ext: string): string {
  return `content/contest/${contestId}/${randomUUID()}.${ext}`;
}

export interface StagedContestAsset {
  ref: AssetRef;
  sizeBytes: number;
}

export type ContestStageResult =
  | { ok: true; value: StagedContestAsset }
  | { ok: false; reason: UploadRejection };

/** Validate, hash and stage one uploaded file. The hash is computed HERE, over the real bytes. */
export async function stageContestUpload(
  storage: StorageDriver,
  contestId: string,
  kind: ContestMediaKind,
  upload: File,
): Promise<ContestStageResult> {
  const bytes = new Uint8Array(await upload.arrayBuffer());
  const mime = upload.type && upload.type.length > 0 ? upload.type : 'application/octet-stream';
  const durationSeconds = kind === 'video' ? probeVideoDurationSeconds(bytes, mime) : null;

  // A logo is an image with a poster's caps — `checkUpload` speaks the prompt vocabulary.
  const capKind = kind === 'logo' ? 'poster' : kind;
  const rejection = checkUpload({ kind: capKind, mime, sizeBytes: bytes.byteLength, durationSeconds });
  if (rejection !== null) return { ok: false, reason: rejection };

  const key = contestStagingKey(contestId, extensionFor(upload.name, mime));
  await storage.putStaging(key, bytes, mime);

  const ref = AssetRefSchema.parse({
    staging_key: key,
    sha256: sha256Hex(bytes),
    mime,
    ...(durationSeconds === null ? {} : { duration_s: Math.round(durationSeconds * 100) / 100 }),
  });
  return { ok: true, value: { ref, sizeBytes: bytes.byteLength } };
}

export interface ContestCopyReport {
  copied: number;
  alreadyPresent: number;
}

/**
 * Copy every staged asset into `public-content` and stamp the published key back onto the ref.
 *
 * Idempotent in both directions, which is what makes "publish" safe to press twice: `copy()` is
 * `upsert:false` so an identical content-addressed key already present is SUCCESS, and re-running
 * over an already-stamped ref recomputes the same key from the same hash.
 */
export async function publishContestMedia(
  storage: StorageDriver,
  media: ContestMedia,
): Promise<{ media: ContestMedia; report: ContestCopyReport }> {
  const report: ContestCopyReport = { copied: 0, alreadyPresent: 0 };
  const next: ContestMedia = {};

  for (const kind of CONTEST_MEDIA_KINDS) {
    const ref = media[kind];
    if (!ref) continue;
    const toKey = publishedKeyFor(ref.sha256, ref.staging_key);
    const outcome = await storage.copy({ fromKey: ref.staging_key, toBucket: 'public-content', toKey });
    if (outcome === 'copied') report.copied += 1;
    else report.alreadyPresent += 1;

    next[kind] = AssetRefSchema.parse({ ...ref, published_key: toKey, bucket: 'public-content' });
  }

  return { media: next, report };
}

// ---------------------------------------------------------------------------
// shaping — the same two rules as lib/prompts/shape.ts
// ---------------------------------------------------------------------------

export interface ShapedContestMedia {
  /** 'public' = CDN object in `public-content`; 'route' = the public contest-media route. */
  source: 'public' | 'route';
  src: string;
  mime: string;
  w?: number;
  h?: number;
  duration_s?: number;
}

export interface ContestMediaOptions {
  /** `public-content` key → servable URL, or `null` when no CDN is configured (§11). */
  publicUrl?: (key: string) => string | null;
  mediaUrl?: (ref: string) => string;
}

function shapeAsset(
  ref: AssetRef,
  mediaRef: string,
  opts: Required<ContestMediaOptions>,
): ShapedContestMedia | null {
  // Not copied to the public bucket yet ⇒ not servable. `null` is the honest answer: the card falls
  // back to its typographic poster rather than emitting a URL that 404s, and a staging key can
  // never be the thing that leaks — this function has no branch that returns one.
  const published = ref.bucket === 'public-content' && Boolean(ref.published_key);
  if (!published) return null;

  const publicSrc = opts.publicUrl(ref.published_key as string);
  const shaped: ShapedContestMedia = publicSrc
    ? { source: 'public', src: publicSrc, mime: ref.mime }
    : { source: 'route', src: opts.mediaUrl(mediaRef), mime: ref.mime };
  if (ref.w !== undefined) shaped.w = ref.w;
  if (ref.h !== undefined) shaped.h = ref.h;
  if (ref.duration_s !== undefined) shaped.duration_s = ref.duration_s;
  return shaped;
}

export function shapeContestMedia(
  id: string,
  media: unknown,
  options: ContestMediaOptions = {},
): {
  poster: ShapedContestMedia | null;
  video: ShapedContestMedia | null;
  logo: ShapedContestMedia | null;
} {
  const opts: Required<ContestMediaOptions> = {
    publicUrl: options.publicUrl ?? (() => null),
    mediaUrl: options.mediaUrl ?? contestMediaPath,
  };
  const parsed = parseContestMedia(media);
  const shape = (kind: ContestMediaKind, ref: AssetRef | undefined) =>
    ref === undefined ? null : shapeAsset(ref, contestMediaRef(id, kind), opts);
  return {
    poster: shape('poster', parsed.poster),
    video: shape('video', parsed.video),
    logo: shape('logo', parsed.logo),
  };
}
