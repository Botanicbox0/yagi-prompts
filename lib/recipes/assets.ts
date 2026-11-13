import { createHash, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { extensionFor, type RenderStore } from '@/lib/renders/store';
import { ASSET_HANDLE } from './schema';

/**
 * A maker's reference files and uploaded example (0059 platform_format_assets), private in the
 * renders bucket as `{formatId}/ast_<hex>.{ext}`. Bounded by construction:
 *
 *   · 4 MB a file (under the 4.5 MB a Vercel function accepts), six reference files and one example
 *     a format, 20 MB a format in all;
 *   · the type is the BYTES' type (magic numbers), never the client's header: JPEG/PNG/WebP images,
 *     MP4/MOV films;
 *   · images are decoded and re-encoded (orientation applied, every metadata byte — GPS included —
 *     dropped), so what the bucket holds is what the engines receive.
 */

export const MAKER_FILE_MAX_BYTES = 4 * 1024 * 1024;
export const MAKER_AV_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const MAKER_REFERENCE_FILES = 6;
export const MAKER_FORMAT_MAX_BYTES = 60 * 1024 * 1024;
const IMAGE_MAX_SIDE = 2048;

export type MakerFileMime =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'video/mp4'
  | 'video/quicktime'
  | 'audio/mpeg'
  | 'audio/wav'
  | 'audio/mp4'
  | 'audio/aac';
export type MakerAssetKind = 'image' | 'video' | 'audio';
export type MakerAssetRole = 'reference' | 'example';
export interface MakerAsset {
  id: string;
  role: MakerAssetRole;
  kind: MakerAssetKind;
  mime: MakerFileMime;
  bytes: number;
  createdAt: string;
  containsPerson?: boolean;
}

/** What the bytes are, from their first bytes alone; null for anything else. */
export function sniffMakerFile(bytes: Uint8Array): MakerFileMime | null {
  const at = (offset: number, ascii: string) => ascii.split('').every((char, i) => bytes[offset + i] === char.charCodeAt(0));
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && at(1, 'PNG')) return 'image/png';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
  if (at(0, 'RIFF') && at(8, 'WAVE')) return 'audio/wav';
  if (at(0, 'ID3')) return 'audio/mpeg';
  if (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) {
    // ADTS AAC (layer === 00 and sync FFFx) vs MPEG Layer I-III frame sync
    const layer = (bytes[1]! & 0x06) >> 1;
    const versionBits = (bytes[1]! & 0x18) >> 3;
    if (layer === 0 && (bytes[1]! & 0xf0) === 0xf0) return 'audio/aac';
    if (layer !== 0 && versionBits !== 1) return 'audio/mpeg';
  }
  if (at(4, 'ftyp')) {
    if (at(8, 'M4A ') || at(8, 'M4B ')) return 'audio/mp4';
    return at(8, 'qt  ') ? 'video/quicktime' : 'video/mp4';
  }
  return null;
}

export function newAssetHandle(): string {
  return `ast_${randomBytes(16).toString('hex')}`;
}

async function cleanImage(bytes: Uint8Array): Promise<{ bytes: Uint8Array; mime: 'image/jpeg' | 'image/png' }> {
  const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'warning' });
  const meta = await image.metadata();
  if (!['png', 'jpeg', 'webp'].includes(meta.format ?? '') || (meta.pages ?? 1) > 1 || !meta.width || !meta.height) throw Error('bad_file');
  const resized = image.rotate().resize({ width: IMAGE_MAX_SIDE, height: IMAGE_MAX_SIDE, fit: 'inside', withoutEnlargement: true });
  // PNG keeps transparency (a product cut-out); everything else becomes a quality JPEG.
  const out = meta.format === 'png' && meta.hasAlpha ? await resized.png().toBuffer() : await resized.jpeg({ quality: 92 }).toBuffer();
  if (out.byteLength > MAKER_FILE_MAX_BYTES) throw Error('too_large');
  return { bytes: new Uint8Array(out), mime: meta.format === 'png' && meta.hasAlpha ? 'image/png' : 'image/jpeg' };
}

export type StoreMakerFileResult = { ok: true; asset: MakerAsset; unchanged: boolean } | { ok: false; code: 'too_large' | 'bad_file' | 'limit_reached' };

/** Stores one file for a format the caller has already authorised (owner, draft). */
export async function storeMakerFile(sql: SqlRunner, store: RenderStore, input: { formatId: string; userId: string; role: MakerAssetRole; bytes: Uint8Array; containsPerson?: boolean }): Promise<StoreMakerFileResult> {
  if (!input.bytes.byteLength || input.bytes.byteLength > MAKER_AV_FILE_MAX_BYTES) return { ok: false, code: 'too_large' };
  const sniffed = sniffMakerFile(input.bytes);
  if (!sniffed) return { ok: false, code: input.bytes.byteLength > MAKER_FILE_MAX_BYTES ? 'too_large' : 'bad_file' };
  if (sniffed.startsWith('image/') && input.bytes.byteLength > MAKER_FILE_MAX_BYTES) return { ok: false, code: 'too_large' };
  if (input.role === 'example' && sniffed.startsWith('audio/')) return { ok: false, code: 'bad_file' };
  let file: { bytes: Uint8Array; mime: MakerFileMime };
  try { file = sniffed.startsWith('image/') ? await cleanImage(input.bytes) : { bytes: input.bytes, mime: sniffed }; }
  catch (error) { return { ok: false, code: error instanceof Error && error.message === 'too_large' ? 'too_large' : 'bad_file' }; }
  const kind: MakerAssetKind = file.mime.startsWith('image/') ? 'image' : file.mime.startsWith('audio/') ? 'audio' : 'video';
  const sha = createHash('sha256').update(file.bytes).digest('hex');
  const existing = await sql.query<AssetRow>('select id,role,kind,mime,bytes,created_at from platform_format_assets where format_id=$1 and role=$2 and sha256=$3', [input.formatId, input.role, sha]);
  if (existing.rows[0]) {
    if (typeof input.containsPerson === 'boolean') {
      try { await sql.query('update platform_format_assets set contains_person=$2 where id=$1', [existing.rows[0].id, input.containsPerson]); } catch { /* pre-0087 */ }
    }
    return { ok: true, asset: { ...toAsset(existing.rows[0]), containsPerson: input.containsPerson ?? existing.rows[0].contains_person ?? false }, unchanged: true };
  }
  const totals = await sql.query<{ n: number; total: string; examples: number }>(`select count(*) filter (where role='reference')::int n,coalesce(sum(bytes),0)::text total,count(*) filter (where role='example')::int examples from platform_format_assets where format_id=$1`, [input.formatId]);
  const t = totals.rows[0]!;
  if ((input.role === 'reference' && t.n >= MAKER_REFERENCE_FILES) || Number(t.total) + file.bytes.byteLength > MAKER_FORMAT_MAX_BYTES) return { ok: false, code: 'limit_reached' };
  // One example per format: a new one replaces the old.
  if (input.role === 'example' && t.examples) await deleteMakerFiles(sql, store, input.formatId, 'example');
  const id = newAssetHandle();
  const key = `${input.formatId}/${id}.${extensionFor(file.mime)}`;
  await store.put(key, file.bytes, file.mime);
  const { rows } = await sql.query<AssetRow>(`insert into platform_format_assets(id,format_id,user_id,role,kind,storage_key,mime,bytes,sha256) values($1,$2,$3,$4,$5,$6,$7,$8,$9)
    returning id,role,kind,mime,bytes,created_at`, [id, input.formatId, input.userId, input.role, kind, key, file.mime, file.bytes.byteLength, sha]);
  const containsPerson = Boolean(input.containsPerson);
  if (containsPerson) {
    try { await sql.query('update platform_format_assets set contains_person=$2 where id=$1', [id, true]); } catch { /* pre-0087 */ }
  }
  return { ok: true, asset: { ...toAsset(rows[0]!), containsPerson }, unchanged: false };
}

interface AssetRow { id: string; role: MakerAssetRole; kind: MakerAssetKind; mime: MakerFileMime; bytes: number; created_at: unknown; contains_person?: boolean }
function toAsset(row: AssetRow): MakerAsset {
  return {
    id: row.id,
    role: row.role,
    kind: row.kind,
    mime: row.mime,
    bytes: row.bytes,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    ...(row.contains_person !== undefined ? { containsPerson: Boolean(row.contains_person) } : {}),
  };
}

export async function listMakerFiles(sql: SqlRunner, formatId: string): Promise<MakerAsset[]> {
  try {
    const { rows } = await sql.query<AssetRow>(
      "select id,role,kind,mime,bytes,created_at,coalesce((to_jsonb(a.*)->>'contains_person')::boolean, false) as contains_person from platform_format_assets a where format_id=$1 order by created_at",
      [formatId],
    );
    return rows.map(toAsset);
  } catch {
    const { rows } = await sql.query<AssetRow>('select id,role,kind,mime,bytes,created_at from platform_format_assets where format_id=$1 order by created_at', [formatId]);
    return rows.map(toAsset);
  }
}

export async function deleteMakerFiles(sql: SqlRunner, store: RenderStore, formatId: string, role: MakerAssetRole, id?: string): Promise<number> {
  const { rows } = await sql.query<{ storage_key: string }>(`delete from platform_format_assets where format_id=$1 and role=$2 and ($3::text is null or id=$3) returning storage_key`, [formatId, role, id ?? null]);
  for (const row of rows) { try { await store.delete?.(row.storage_key); } catch { /* The row is gone; an orphaned private object is harmless. */ } }
  return rows.length;
}

/** The pass's reader: a file by handle, wherever its format stands (an accepted template keeps its files). */
export async function readMakerFile(sql: SqlRunner, store: RenderStore, handle: string): Promise<{ key: string; mime: string; kind: MakerAssetKind; bytes: Uint8Array } | null> {
  if (!ASSET_HANDLE.test(handle)) return null;
  const { rows } = await sql.query<{ storage_key: string; mime: string; kind: MakerAssetKind }>("select storage_key,mime,kind from platform_format_assets where id=$1 and role='reference'", [handle]);
  const row = rows[0];
  if (!row) return null;
  return { key: row.storage_key, mime: row.mime, kind: row.kind, bytes: await store.read(row.storage_key) };
}
