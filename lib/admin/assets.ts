import { createHash, randomUUID } from 'node:crypto';
import { AssetRefSchema, type AssetRef } from '@/lib/content/schemas';
import { STAGING_BUCKET, type StorageDriver } from '@/lib/storage';

/**
 * PLAN §6 asset lifecycle — the upload half, which M4 owns.
 *
 *   staging key  content/rev/{revision_id}/{uuid}.{ext}   (private, never served)
 *   sha256       computed HERE, server-side, at upload
 *
 * The hash is not optional and cannot be supplied by the client: `prepare_publish` builds the whole
 * `publish_assets` manifest from it (§6 Phase A.3) and the published key IS `{sha256}.{ext}`. An
 * AssetRef without a real hash cannot publish (the RPC rejects it), so computing it anywhere other
 * than over the received bytes would be a lie the database catches later and the author earlier.
 */

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'application/json': 'json',
  'application/zip': 'zip',
  'text/plain': 'txt',
};

/** Extension from the filename when it looks sane, else from the mime, else `bin`. */
export function extensionFor(filename: string, mime: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(filename.trim());
  if (match) return match[1]!.toLowerCase();
  const byMime = EXT_BY_MIME[mime.split(';')[0]!.trim().toLowerCase()];
  return byMime ?? 'bin';
}

export function stagingKey(revisionId: string, ext: string): string {
  return `content/rev/${revisionId}/${randomUUID()}.${ext}`;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface UploadedAsset {
  ref: AssetRef;
  sizeBytes: number;
  filename: string;
}

/** Read the posted File, hash it, stage it, and return an AssetRef the §6.1 schema accepts. */
export async function stageUpload(
  storage: StorageDriver,
  revisionId: string,
  upload: File,
): Promise<UploadedAsset> {
  const bytes = new Uint8Array(await upload.arrayBuffer());
  const mime = upload.type && upload.type.length > 0 ? upload.type : 'application/octet-stream';
  const key = stagingKey(revisionId, extensionFor(upload.name, mime));
  await storage.putStaging(key, bytes, mime);
  const ref = AssetRefSchema.parse({ staging_key: key, sha256: sha256Hex(bytes), mime });
  return { ref, sizeBytes: bytes.byteLength, filename: upload.name || key.split('/').pop()! };
}

/**
 * Re-key an AssetRef into another revision's namespace (revision cloning, §3.8).
 *
 * The BYTES are copied, so the clone owns its own staging object and editing or replacing it can
 * never reach back into the revision it came from. `sha256` is carried over unchanged — same bytes,
 * same hash, and therefore the same content-addressed published key if both ever publish.
 * `published_key`/`bucket` are dropped on purpose: those belong to the SOURCE's publication, and a
 * draft that claimed them would make the shaper emit a public URL for unpublished content.
 */
export async function rekeyAsset(
  storage: StorageDriver,
  ref: AssetRef,
  targetRevisionId: string,
): Promise<AssetRef> {
  const bytes = await storage.read(STAGING_BUCKET, ref.staging_key);
  const ext = extensionFor(ref.staging_key, ref.mime);
  const key = stagingKey(targetRevisionId, ext);
  await storage.putStaging(key, bytes, ref.mime);

  const next: Record<string, unknown> = { ...ref, staging_key: key };
  delete next.published_key;
  delete next.bucket;
  return AssetRefSchema.parse(next);
}
