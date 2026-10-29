import { createHash, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { extensionFor, type RenderStore } from '@/lib/renders/store';
import { sniffMakerFile, MAKER_FILE_MAX_BYTES, type MakerFileMime } from '@/lib/recipes/assets';
import { lineOf, linkOf } from './fields';
import { creativeCoverReady, creativeProfilesReady } from './profile';

/**
 * docs/PLATFORM-2.0.md §20 — an AI creative's representative works, avatar (0065) and cover (0071). Same storage
 * rules as a recipe's reference files (lib/recipes/assets.ts), because the same people upload them:
 *
 *   · 4 MB a file (under what a Vercel function accepts), twelve works and 40 MB a creative;
 *   · the type is the BYTES' type, never the client's header: JPEG/PNG/WebP, MP4/MOV;
 *   · images are decoded and re-encoded — orientation applied, every metadata byte (GPS included)
 *     dropped — so what is served is never what the camera wrote;
 *   · keys are `{userId}/wrk_<hex>.{ext}`, `{userId}/avatar_<hex>.jpg` and `{userId}/cover_<hex>.jpg`
 *     in the PRIVATE renders bucket. A key never leaves the server: pages address a work by its
 *     `wrk_` id and an avatar or cover by the creative's handle, and /creative-media (or the studio's
 *     /api/makers/media) serves them only while the profile is public.
 */

export const MAKER_WORKS_MAX = 12;
export const MAKER_WORKS_MAX_BYTES = 40 * 1024 * 1024;
export const WORK_TITLE_MAX = 80;
export const WORK_CAPTION_MAX = 280;
export const WORK_ID = /^wrk_[0-9a-f]{32}$/;
const IMAGE_MAX_SIDE = 2400;
const AVATAR_SIDE = 512;
/** The cover is stored 2:1 — the phone's banner whole; the desktop's 3:1 banner shows its middle band. */
export const COVER_WIDTH = 1800;
export const COVER_HEIGHT = 900;

export interface MakerWork {
  id: string;
  kind: 'image' | 'video';
  mime: MakerFileMime;
  width: number | null;
  height: number | null;
  title: string | null;
  caption: string | null;
  linkUrl: string | null;
  position: number;
}

export type WorkErrorCode = 'too_large' | 'bad_file' | 'limit_reached' | 'invalid' | 'not_found' | 'unavailable';
export class WorkError extends Error {
  constructor(readonly code: WorkErrorCode) { super(code); this.name = 'WorkError'; }
}

interface WorkRow { id: string; kind: 'image' | 'video'; mime: MakerFileMime; width: number | null; height: number | null; title: string | null; caption: string | null; link_url: string | null; position: number }
const COLUMNS = 'id,kind,mime,width,height,title,caption,link_url,position';
function toWork(row: WorkRow): MakerWork {
  return { id: row.id, kind: row.kind, mime: row.mime, width: row.width, height: row.height, title: row.title, caption: row.caption, linkUrl: row.link_url, position: row.position };
}

async function cleanWorkImage(bytes: Uint8Array): Promise<{ bytes: Uint8Array; mime: 'image/jpeg' | 'image/png'; width: number; height: number }> {
  const image = sharp(bytes, { limitInputPixels: 60_000_000, failOn: 'warning' });
  const meta = await image.metadata();
  if (!['png', 'jpeg', 'webp'].includes(meta.format ?? '') || (meta.pages ?? 1) > 1 || !meta.width || !meta.height) throw new WorkError('bad_file');
  const alpha = meta.format === 'png' && meta.hasAlpha === true;
  const resized = image.rotate().resize({ width: IMAGE_MAX_SIDE, height: IMAGE_MAX_SIDE, fit: 'inside', withoutEnlargement: true });
  const { data, info } = alpha ? await resized.png().toBuffer({ resolveWithObject: true }) : await resized.jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  if (data.byteLength > MAKER_FILE_MAX_BYTES) throw new WorkError('too_large');
  return { bytes: new Uint8Array(data), mime: alpha ? 'image/png' : 'image/jpeg', width: info.width, height: info.height };
}

async function ready(sql: SqlRunner): Promise<void> {
  if (!(await creativeProfilesReady(sql))) throw new WorkError('unavailable');
}

/** Optional text fields of a work; `false` when one is malformed. */
export function workMetaOf(input: { title?: unknown; caption?: unknown; link?: unknown }): { title: string | null; caption: string | null; linkUrl: string | null } | false {
  const title = lineOf(input.title, WORK_TITLE_MAX);
  const caption = typeof input.caption === 'string' && input.caption.trim() === '' ? null : typeof input.caption === 'string'
    ? ([...input.caption.trim()].length <= WORK_CAPTION_MAX && !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(input.caption.trim()) ? input.caption.trim().replace(/\r\n?/g, '\n') : false)
    : input.caption === undefined || input.caption === null ? null : false;
  const link = linkOf(input.link);
  if (title === false || caption === false || link === false) return false;
  return { title, caption, linkUrl: link?.url ?? null };
}

/** Stores one work for a creative the caller has already authorised. Identical bytes are the same work. */
export async function storeMakerWork(
  sql: SqlRunner, store: RenderStore,
  input: { userId: string; bytes: Uint8Array; title?: unknown; caption?: unknown; link?: unknown },
): Promise<{ work: MakerWork; unchanged: boolean }> {
  await ready(sql);
  const meta = workMetaOf(input);
  if (!meta) throw new WorkError('invalid');
  if (!input.bytes.byteLength || input.bytes.byteLength > MAKER_FILE_MAX_BYTES) throw new WorkError('too_large');
  const sniffed = sniffMakerFile(input.bytes);
  if (!sniffed) throw new WorkError('bad_file');
  const file = sniffed.startsWith('image/')
    ? await cleanWorkImage(input.bytes).catch((error: unknown) => { throw error instanceof WorkError ? error : new WorkError('bad_file'); })
    : { bytes: input.bytes, mime: sniffed, width: null, height: null };
  const kind = file.mime.startsWith('image/') ? 'image' : 'video';
  const sha = createHash('sha256').update(file.bytes).digest('hex');
  return sql.transaction(async (tx) => {
    await tx.query('select id from profiles where id=$1 for update', [input.userId]);
    const existing = await tx.query<WorkRow>(`select ${COLUMNS} from maker_works where user_id=$1 and sha256=$2`, [input.userId, sha]);
    if (existing.rows[0]) return { work: toWork(existing.rows[0]), unchanged: true };
    const totals = (await tx.query<{ n: number; total: string; next: number }>(
      'select count(*)::int n, coalesce(sum(bytes),0)::text total, coalesce(max(position)+1,0)::int next from maker_works where user_id=$1', [input.userId],
    )).rows[0]!;
    if (totals.n >= MAKER_WORKS_MAX || Number(totals.total) + file.bytes.byteLength > MAKER_WORKS_MAX_BYTES) throw new WorkError('limit_reached');
    const id = `wrk_${randomBytes(16).toString('hex')}`;
    const key = `${input.userId}/${id}.${extensionFor(file.mime)}`;
    await store.put(key, file.bytes, file.mime);
    const { rows } = await tx.query<WorkRow>(`insert into maker_works(id,user_id,position,kind,storage_key,mime,bytes,sha256,width,height,title,caption,link_url)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning ${COLUMNS}`,
    [id, input.userId, Math.min(totals.next, MAKER_WORKS_MAX - 1), kind, key, file.mime, file.bytes.byteLength, sha, file.width, file.height, meta.title, meta.caption, meta.linkUrl]);
    return { work: toWork(rows[0]!), unchanged: false };
  });
}

export async function listMakerWorks(sql: SqlRunner, userId: string): Promise<MakerWork[]> {
  if (!(await creativeProfilesReady(sql))) return [];
  const { rows } = await sql.query<WorkRow>(`select ${COLUMNS} from maker_works where user_id=$1 order by position, created_at`, [userId]);
  return rows.map(toWork);
}

/** A public creative's works, by handle — nothing for a private, revoked or unknown profile. */
export async function listPublicWorks(sql: SqlRunner, handle: string): Promise<MakerWork[]> {
  if (!(await creativeProfilesReady(sql))) return [];
  const { rows } = await sql.query<WorkRow>(`select ${COLUMNS.split(',').map((c) => `w.${c}`).join(',')} from maker_works w
    join platform_creators c on c.user_id=w.user_id where c.handle=$1 and c.active and c.public_profile order by w.position, w.created_at`, [handle]);
  return rows.map(toWork);
}

export async function updateMakerWork(sql: SqlRunner, userId: string, id: string, input: { title?: unknown; caption?: unknown; link?: unknown }): Promise<MakerWork> {
  await ready(sql);
  if (!WORK_ID.test(id)) throw new WorkError('not_found');
  const meta = workMetaOf(input);
  if (!meta) throw new WorkError('invalid');
  const { rows } = await sql.query<WorkRow>(`update maker_works set title=$3,caption=$4,link_url=$5 where id=$1 and user_id=$2 returning ${COLUMNS}`,
    [id, userId, meta.title, meta.caption, meta.linkUrl]);
  if (!rows[0]) throw new WorkError('not_found');
  return toWork(rows[0]);
}

export async function deleteMakerWork(sql: SqlRunner, store: RenderStore, userId: string, id: string): Promise<void> {
  await ready(sql);
  if (!WORK_ID.test(id)) throw new WorkError('not_found');
  const { rows } = await sql.query<{ storage_key: string }>('delete from maker_works where id=$1 and user_id=$2 returning storage_key', [id, userId]);
  if (!rows[0]) throw new WorkError('not_found');
  try { await store.delete?.(rows[0].storage_key); } catch { /* The row is gone; an orphaned private object is harmless. */ }
}

/** The creative's chosen order. Ids not theirs are refused; ids left out keep their place after the named ones. */
export async function reorderMakerWorks(sql: SqlRunner, userId: string, ids: readonly unknown[]): Promise<MakerWork[]> {
  await ready(sql);
  if (ids.length > MAKER_WORKS_MAX || !ids.every((id): id is string => typeof id === 'string' && WORK_ID.test(id)) || new Set(ids).size !== ids.length) throw new WorkError('invalid');
  return sql.transaction(async (tx) => {
    const own = (await tx.query<{ id: string }>('select id from maker_works where user_id=$1 order by position, created_at for update', [userId])).rows.map((row) => row.id);
    if (!ids.every((id) => own.includes(id as string))) throw new WorkError('not_found');
    const order = [...(ids as string[]), ...own.filter((id) => !ids.includes(id))];
    for (const [position, id] of order.entries()) await tx.query('update maker_works set position=$3 where id=$1 and user_id=$2', [id, userId, position]);
    const { rows } = await tx.query<WorkRow>(`select ${COLUMNS} from maker_works where user_id=$1 order by position, created_at`, [userId]);
    return rows.map(toWork);
  });
}

/** A square 512px JPEG avatar; replaces the previous one. Returns the new cache version. */
export async function storeMakerAvatar(sql: SqlRunner, store: RenderStore, userId: string, bytes: Uint8Array): Promise<string> {
  await ready(sql);
  if (!bytes.byteLength || bytes.byteLength > MAKER_FILE_MAX_BYTES) throw new WorkError('too_large');
  const sniffed = sniffMakerFile(bytes);
  if (!sniffed?.startsWith('image/')) throw new WorkError('bad_file');
  let out: Buffer;
  try {
    const image = sharp(bytes, { limitInputPixels: 60_000_000, failOn: 'warning' });
    const meta = await image.metadata();
    if (!['png', 'jpeg', 'webp'].includes(meta.format ?? '') || (meta.pages ?? 1) > 1) throw new Error('bad_file');
    out = await image.rotate().resize(AVATAR_SIDE, AVATAR_SIDE, { fit: 'cover', position: 'attention' }).flatten({ background: '#ffffff' }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  } catch { throw new WorkError('bad_file'); }
  const version = randomBytes(8).toString('hex');
  const key = `${userId}/avatar_${version}.jpg`;
  await store.put(key, new Uint8Array(out), 'image/jpeg');
  const { rows } = await sql.query<{ old: string | null }>(
    `update platform_creators c set avatar_key=$2, profile_updated_at=now() from (select avatar_key old from platform_creators where user_id=$1 and active for update) prev
      where c.user_id=$1 and c.active returning prev.old`, [userId, key]);
  if (!rows[0]) {
    try { await store.delete?.(key); } catch { /* never referenced */ }
    throw new WorkError('not_found');
  }
  if (rows[0].old) { try { await store.delete?.(rows[0].old); } catch { /* replaced; harmless */ } }
  return version;
}

/**
 * The profile banner (0071): any JPEG/PNG/WebP, cropped to 2:1 around what draws the eye, re-encoded
 * without metadata; replaces the previous one. Returns the new cache version.
 */
export async function storeMakerCover(sql: SqlRunner, store: RenderStore, userId: string, bytes: Uint8Array): Promise<string> {
  await ready(sql);
  if (!(await creativeCoverReady(sql))) throw new WorkError('unavailable');
  if (!bytes.byteLength || bytes.byteLength > MAKER_FILE_MAX_BYTES) throw new WorkError('too_large');
  const sniffed = sniffMakerFile(bytes);
  if (!sniffed?.startsWith('image/')) throw new WorkError('bad_file');
  let out: Buffer;
  try {
    const image = sharp(bytes, { limitInputPixels: 60_000_000, failOn: 'warning' });
    const meta = await image.metadata();
    if (!['png', 'jpeg', 'webp'].includes(meta.format ?? '') || (meta.pages ?? 1) > 1) throw new Error('bad_file');
    out = await image.rotate().resize(COVER_WIDTH, COVER_HEIGHT, { fit: 'cover', position: 'attention' }).flatten({ background: '#ffffff' }).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  } catch { throw new WorkError('bad_file'); }
  const version = randomBytes(8).toString('hex');
  const key = `${userId}/cover_${version}.jpg`;
  await store.put(key, new Uint8Array(out), 'image/jpeg');
  const { rows } = await sql.query<{ old: string | null }>(
    `update platform_creators c set cover_key=$2, profile_updated_at=now() from (select cover_key old from platform_creators where user_id=$1 and active for update) prev
      where c.user_id=$1 and c.active returning prev.old`, [userId, key]);
  if (!rows[0]) {
    try { await store.delete?.(key); } catch { /* never referenced */ }
    throw new WorkError('not_found');
  }
  if (rows[0].old) { try { await store.delete?.(rows[0].old); } catch { /* replaced; harmless */ } }
  return version;
}

export async function deleteMakerCover(sql: SqlRunner, store: RenderStore, userId: string): Promise<void> {
  await ready(sql);
  if (!(await creativeCoverReady(sql))) return;
  const { rows } = await sql.query<{ old: string | null }>(
    `update platform_creators c set cover_key=null from (select cover_key old from platform_creators where user_id=$1 and active for update) prev
      where c.user_id=$1 and c.active returning prev.old`, [userId]);
  if (rows[0]?.old) { try { await store.delete?.(rows[0].old); } catch { /* harmless */ } }
}

export async function deleteMakerAvatar(sql: SqlRunner, store: RenderStore, userId: string): Promise<void> {
  await ready(sql);
  const { rows } = await sql.query<{ old: string | null }>(
    `update platform_creators c set avatar_key=null from (select avatar_key old from platform_creators where user_id=$1 and active for update) prev
      where c.user_id=$1 and c.active returning prev.old`, [userId]);
  if (rows[0]?.old) { try { await store.delete?.(rows[0].old); } catch { /* harmless */ } }
}

export interface MakerMediaObject { key: string; mime: string; publicCache: boolean }

/**
 * Who may see a creative's avatar, cover or work: anyone while the profile is public (cacheable), and
 * the creative themself always (their studio preview). Everything else is not found.
 */
export async function makerMediaObject(sql: SqlRunner, viewerId: string | null, id: string): Promise<MakerMediaObject | null> {
  if (!(await creativeProfilesReady(sql))) return null;
  if (WORK_ID.test(id)) {
    const { rows } = await sql.query<{ user_id: string; storage_key: string; mime: string; visible: boolean }>(`select w.user_id,w.storage_key,w.mime,(c.active and c.public_profile and c.handle is not null) visible
      from maker_works w join platform_creators c on c.user_id=w.user_id where w.id=$1`, [id]);
    const row = rows[0];
    if (!row) return null;
    if (row.visible) return { key: row.storage_key, mime: row.mime, publicCache: true };
    return viewerId === row.user_id ? { key: row.storage_key, mime: row.mime, publicCache: false } : null;
  }
  const picture = /^(avatar|cover)-(?:(me)|([a-z0-9_]{3,20}))$/.exec(id);
  if (!picture) return null;
  // The cover (0071) is read through to_jsonb, so a database without the column has none.
  const column = picture[1] === 'cover' ? "to_jsonb(c.*)->>'cover_key'" : 'c.avatar_key';
  // The creative's own picture before they have a handle: never cached, never anyone else's.
  if (picture[2]) {
    if (!viewerId) return null;
    const { rows } = await sql.query<{ key: string | null }>(`select ${column} as key from platform_creators c where c.user_id=$1 and c.active`, [viewerId]);
    return rows[0]?.key ? { key: rows[0].key, mime: 'image/jpeg', publicCache: false } : null;
  }
  const { rows } = await sql.query<{ user_id: string; key: string | null; visible: boolean }>(
    `select c.user_id, ${column} as key, (c.active and c.public_profile) visible from platform_creators c where c.handle=$1`, [picture[3]]);
  const row = rows[0];
  if (!row?.key) return null;
  if (row.visible) return { key: row.key, mime: 'image/jpeg', publicCache: true };
  return viewerId === row.user_id ? { key: row.key, mime: 'image/jpeg', publicCache: false } : null;
}

