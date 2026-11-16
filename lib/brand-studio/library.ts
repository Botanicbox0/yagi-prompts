/**
 * The studio library rail's server (docs/BRAND-STUDIO-V3.md §4): folders the organization shares, a
 * member's own likes, and the items both show.
 *
 * Gate order, same as the studio service (./service.ts): seat (membership) -> Morphic hardline + feature
 * policy -> role. The route checks the flag and sign-in first. Roles: any member, viewer included, may
 * like (a campaign-only guest may look but not like); folders need the role that may create in the studio.
 * Every asset or result is checked to be a live one of the same organization before it is liked or filed,
 * and items whose asset or result has gone are left out of every answer.
 */
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { lockOrganization, requireCreate, StudioDenied, studioSeat, type StudioSeat } from './access';
import type { StudioFailure } from './contracts';
import {
  FolderCreateSchema,
  FolderItemSchema,
  FolderRefSchema,
  FolderRenameSchema,
  isLibraryOperation,
  LIBRARY_LIMITS,
  LikeToggleSchema,
  type LibraryFolderDone,
  type LibraryFolderItems,
  type LibraryFolderWire,
  type LibraryItemWire,
  type LibraryLikeDone,
  type LibraryOperationResult,
  type LibraryRef,
  type LibraryRemoved,
  type LibrarySummary,
} from './library-contracts';
import type { StudioMediaStore } from './media-store';
import { failure, guarded } from './outcome';
import { assetView, outputView, readyAsset, readyOutput } from './repo';
import type { AssetRow, OutputRow } from './types';

/** What the library needs from the studio's dependencies (tests pass `studioDeps(sql)`). */
export interface LibraryDeps {
  sql: SqlRunner;
  media: StudioMediaStore;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

interface FolderRow {
  id: string;
  organization_id: string;
  name: string;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}

interface RefRow {
  asset_id: string | null;
  output_id: string | null;
}

/* ------------------------------------------------------------------ roles */

function requireLike(seat: StudioSeat): void {
  if (seat.role === 'guest') throw new StudioDenied('forbidden');
}

/* ------------------------------------------------------------------ views */

function itemFromAsset(row: AssetRow, media: StudioMediaStore): LibraryItemWire {
  const view = assetView(row, media);
  return {
    key: `a:${view.id}`,
    ref: { assetId: view.id },
    kind: view.kind,
    url: view.url,
    thumbUrl: view.thumbUrl,
    name: view.name,
    width: view.width,
    height: view.height,
    seconds: view.seconds,
    ...(view.pages ? { pages: view.pages } : {}),
    createdAt: view.createdAt,
  };
}

function itemFromOutput(row: OutputRow, media: StudioMediaStore): LibraryItemWire {
  const view = outputView(row, media);
  return {
    key: `o:${view.id}`,
    ref: { outputId: view.id },
    kind: view.kind,
    url: view.url,
    thumbUrl: view.thumbUrl,
    name: null,
    width: view.width,
    height: view.height,
    seconds: view.seconds,
    createdAt: view.createdAt,
  };
}

/** Views for `rows` in their order; anything deleted, unfinished or of another organization is left out. */
async function itemViews(sql: SqlRunner, organizationId: string, rows: readonly RefRow[], media: StudioMediaStore): Promise<LibraryItemWire[]> {
  const assetIds = [...new Set(rows.map((r) => r.asset_id).filter((id): id is string => Boolean(id)))];
  const outputIds = [...new Set(rows.map((r) => r.output_id).filter((id): id is string => Boolean(id)))];
  const assets = assetIds.length
    ? (
        await sql.query<AssetRow>(
          "select * from brand_studio_assets where organization_id = $1 and id = any($2::uuid[]) and status = 'ready' and deleted_at is null",
          [organizationId, assetIds],
        )
      ).rows
    : [];
  const outputs = outputIds.length
    ? (
        await sql.query<OutputRow>(
          `select * from brand_studio_outputs where organization_id = $1 and id = any($2::uuid[])
             and status = 'ready' and deleted_at is null and storage_key is not null`,
          [organizationId, outputIds],
        )
      ).rows
    : [];
  const assetById = new Map(assets.map((a) => [String(a.id), a]));
  const outputById = new Map(outputs.map((o) => [String(o.id), o]));
  const views: LibraryItemWire[] = [];
  for (const row of rows) {
    const asset = row.asset_id ? assetById.get(String(row.asset_id)) : undefined;
    const output = row.output_id ? outputById.get(String(row.output_id)) : undefined;
    if (asset) views.push(itemFromAsset(asset, media));
    else if (output) views.push(itemFromOutput(output, media));
  }
  return views;
}

/** The live-item join every folder count and cover reads. `$1` is the organization. */
const LIVE_ITEMS = `
  from brand_studio_folder_items i
  left join brand_studio_assets a
    on a.id = i.asset_id and a.organization_id = $1 and a.status = 'ready' and a.deleted_at is null
  left join brand_studio_outputs o
    on o.id = i.output_id and o.organization_id = $1 and o.status = 'ready' and o.deleted_at is null and o.storage_key is not null
  where i.organization_id = $1 and i.folder_id = any($2::uuid[]) and (a.id is not null or o.id is not null)`;
const COVER_KEY = `coalesce(a.thumb_key, case when a.kind = 'image' then a.storage_key end, o.thumb_key, case when o.kind = 'image' then o.storage_key end)`;

async function folderViews(sql: SqlRunner, organizationId: string, folders: readonly FolderRow[], media: StudioMediaStore): Promise<LibraryFolderWire[]> {
  if (folders.length === 0) return [];
  const ids = folders.map((f) => String(f.id));
  const counts = new Map(
    (await sql.query<{ folder_id: string; n: number }>(`select i.folder_id, count(*)::int as n ${LIVE_ITEMS} group by i.folder_id`, [organizationId, ids])).rows.map((r) => [
      String(r.folder_id),
      Number(r.n),
    ]),
  );
  const covers = new Map<string, string[]>();
  for (const row of (
    await sql.query<{ folder_id: string; cover: string }>(
      `select folder_id, cover from (
         select i.folder_id, ${COVER_KEY} as cover, row_number() over (partition by i.folder_id order by i.created_at desc, i.id) as rn
         ${LIVE_ITEMS} and ${COVER_KEY} is not null
       ) c where rn <= 4 order by folder_id, rn`,
      [organizationId, ids],
    )
  ).rows) {
    const list = covers.get(String(row.folder_id)) ?? [];
    list.push(media.url(String(row.cover)));
    covers.set(String(row.folder_id), list);
  }
  return folders.map((f) => ({
    id: String(f.id),
    name: String(f.name),
    count: counts.get(String(f.id)) ?? 0,
    covers: covers.get(String(f.id)) ?? [],
    updatedAt: iso(f.updated_at),
  }));
}

async function folderView(sql: SqlRunner, organizationId: string, folder: FolderRow, media: StudioMediaStore): Promise<LibraryFolderWire> {
  return (await folderViews(sql, organizationId, [folder], media))[0]!;
}

/* ------------------------------------------------------------------ reads */

async function liveFolder(sql: SqlRunner, organizationId: string, folderId: string, lock = false): Promise<FolderRow> {
  const row = (
    await sql.query<FolderRow>(
      `select * from brand_studio_folders where id = $1 and organization_id = $2 and deleted_at is null${lock ? ' for update' : ''}`,
      [folderId, organizationId],
    )
  ).rows[0];
  if (!row) throw new StudioDenied('not_found');
  return row;
}

/** A live, ready asset or result of this organization, as a library item. */
async function resolveRef(sql: SqlRunner, organizationId: string, ref: LibraryRef, media: StudioMediaStore): Promise<LibraryItemWire> {
  if ('assetId' in ref) {
    const asset = await readyAsset(sql, organizationId, ref.assetId);
    if (asset) return itemFromAsset(asset, media);
  } else {
    const output = await readyOutput(sql, organizationId, ref.outputId);
    if (output?.storage_key) return itemFromOutput(output, media);
  }
  throw new StudioDenied('reference_missing');
}

const refColumns = (ref: LibraryRef): [string | null, string | null] => ('assetId' in ref ? [ref.assetId, null] : [null, ref.outputId]);

/** `GET /api/brand-studio/library?organizationId=` — the folders (by name) and this member's likes (newest first). */
export async function loadLibrary(deps: LibraryDeps, viewer: Viewer, organizationId: string): Promise<LibrarySummary | StudioFailure> {
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await studioSeat(sql, viewer.userId, organizationId);
      const folders = (
        await sql.query<FolderRow>('select * from brand_studio_folders where organization_id = $1 and deleted_at is null order by lower(name), id', [organizationId])
      ).rows;
      const likes = (
        await sql.query<RefRow>(
          'select asset_id, output_id from brand_studio_likes where organization_id = $1 and user_id = $2 order by created_at desc, id limit $3',
          [organizationId, seat.userId, LIBRARY_LIMITS.likedShown],
        )
      ).rows;
      return {
        ok: true as const,
        folders: await folderViews(sql, organizationId, folders, deps.media),
        liked: await itemViews(sql, organizationId, likes, deps.media),
      };
    }),
  );
}

/** `GET /api/brand-studio/library?organizationId=&folder=` — one folder's items, newest filed first. */
export async function loadFolderItems(deps: LibraryDeps, viewer: Viewer, organizationId: string, folderId: string): Promise<LibraryFolderItems | StudioFailure> {
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      await studioSeat(sql, viewer.userId, organizationId);
      if (!UUID.test(folderId)) throw new StudioDenied('not_found');
      const folder = await liveFolder(sql, organizationId, folderId);
      const rows = (
        await sql.query<RefRow>(
          'select asset_id, output_id from brand_studio_folder_items where folder_id = $1 and organization_id = $2 order by created_at desc, id limit $3',
          [folder.id, organizationId, LIBRARY_LIMITS.itemsPerFolder],
        )
      ).rows;
      return {
        ok: true as const,
        folder: await folderView(sql, organizationId, folder, deps.media),
        items: await itemViews(sql, organizationId, rows, deps.media),
      };
    }),
  );
}

/* ----------------------------------------------------------------- writes */

/** One `POST /api/brand-studio/library` operation. Unknown names are `invalid`. */
export async function runLibraryOperation(deps: LibraryDeps, viewer: Viewer, operation: unknown, input: unknown): Promise<LibraryOperationResult> {
  if (!isLibraryOperation(operation)) return failure('invalid');
  // The gate before any input detail is judged: a closed organization gets the same 404 whatever it sent.
  const organizationId = (input as { organizationId?: unknown } | null)?.organizationId;
  if (typeof organizationId !== 'string' || !UUID.test(organizationId)) return failure('invalid');
  const gate = await guarded(() => deps.sql.transaction((sql) => studioSeat(sql, viewer.userId, organizationId)));
  if ('ok' in gate) return gate;
  switch (operation) {
    case 'like.toggle':
      return toggleLike(deps, viewer, input);
    case 'folder.create':
      return createFolder(deps, viewer, input);
    case 'folder.rename':
      return renameFolder(deps, viewer, input);
    case 'folder.delete':
      return deleteFolder(deps, viewer, input);
    case 'folder.add':
      return addToFolder(deps, viewer, input);
    case 'folder.remove':
      return removeFromFolder(deps, viewer, input);
  }
}

async function toggleLike(deps: LibraryDeps, viewer: Viewer, raw: unknown): Promise<LibraryLikeDone | StudioFailure> {
  const parsed = LikeToggleSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const { organizationId, ref, liked } = parsed.data;
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await studioSeat(sql, viewer.userId, organizationId);
      requireLike(seat);
      const [assetId, outputId] = refColumns(ref);
      if (!liked) {
        await sql.query(
          `delete from brand_studio_likes where organization_id = $1 and user_id = $2
             and asset_id is not distinct from $3::uuid and output_id is not distinct from $4::uuid`,
          [organizationId, seat.userId, assetId, outputId],
        );
        return { ok: true as const, liked: false, item: null };
      }
      const item = await resolveRef(sql, organizationId, ref, deps.media);
      const exists = (
        await sql.query(
          `select 1 from brand_studio_likes where organization_id = $1 and user_id = $2
             and asset_id is not distinct from $3::uuid and output_id is not distinct from $4::uuid`,
          [organizationId, seat.userId, assetId, outputId],
        )
      ).rows[0];
      if (!exists) {
        await sql.query('insert into brand_studio_likes (organization_id, user_id, asset_id, output_id) values ($1, $2, $3, $4)', [
          organizationId,
          seat.userId,
          assetId,
          outputId,
        ]);
      }
      return { ok: true as const, liked: true, item };
    }),
  );
}

async function nameTaken(sql: SqlRunner, organizationId: string, name: string, except: string | null): Promise<boolean> {
  return Boolean(
    (
      await sql.query(
        `select 1 from brand_studio_folders where organization_id = $1 and deleted_at is null and lower(name) = lower($2)
           and id <> coalesce($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`,
        [organizationId, name, except],
      )
    ).rows[0],
  );
}

async function createFolder(deps: LibraryDeps, viewer: Viewer, raw: unknown): Promise<LibraryFolderDone | StudioFailure> {
  const parsed = FolderCreateSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const { organizationId, name } = parsed.data;
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await studioSeat(sql, viewer.userId, organizationId);
      requireCreate(seat);
      await lockOrganization(sql, organizationId);
      const live = Number(
        (await sql.query<{ n: number }>('select count(*)::int as n from brand_studio_folders where organization_id = $1 and deleted_at is null', [organizationId])).rows[0]?.n ?? 0,
      );
      if (live >= LIBRARY_LIMITS.foldersPerOrganization) throw new StudioDenied('asset_limit');
      if (await nameTaken(sql, organizationId, name, null)) throw new StudioDenied('conflict');
      const folder = (
        await sql.query<FolderRow>('insert into brand_studio_folders (organization_id, name, created_by) values ($1, $2, $3) returning *', [organizationId, name, seat.userId])
      ).rows[0]!;
      return { ok: true as const, folder: await folderView(sql, organizationId, folder, deps.media) };
    }),
  );
}

async function renameFolder(deps: LibraryDeps, viewer: Viewer, raw: unknown): Promise<LibraryFolderDone | StudioFailure> {
  const parsed = FolderRenameSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const { organizationId, folderId, name } = parsed.data;
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      requireCreate(await studioSeat(sql, viewer.userId, organizationId));
      let folder = await liveFolder(sql, organizationId, folderId, true);
      if (folder.name !== name) {
        if (await nameTaken(sql, organizationId, name, folder.id)) throw new StudioDenied('conflict');
        folder = (await sql.query<FolderRow>('update brand_studio_folders set name = $2, updated_at = now() where id = $1 returning *', [folder.id, name])).rows[0]!;
      }
      return { ok: true as const, folder: await folderView(sql, organizationId, folder, deps.media) };
    }),
  );
}

async function deleteFolder(deps: LibraryDeps, viewer: Viewer, raw: unknown): Promise<LibraryRemoved | StudioFailure> {
  const parsed = FolderRefSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const { organizationId, folderId } = parsed.data;
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      requireCreate(await studioSeat(sql, viewer.userId, organizationId));
      // A repeated delete is done, not an error; a folder of another organization is not found.
      const row = (await sql.query<{ id: string }>('select id from brand_studio_folders where id = $1 and organization_id = $2', [folderId, organizationId])).rows[0];
      if (!row) throw new StudioDenied('not_found');
      await sql.query('update brand_studio_folders set deleted_at = now(), updated_at = now() where id = $1 and deleted_at is null', [folderId]);
      return { ok: true as const };
    }),
  );
}

async function addToFolder(deps: LibraryDeps, viewer: Viewer, raw: unknown): Promise<LibraryFolderDone | StudioFailure> {
  const parsed = FolderItemSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const { organizationId, folderId, ref } = parsed.data;
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await studioSeat(sql, viewer.userId, organizationId);
      requireCreate(seat);
      let folder = await liveFolder(sql, organizationId, folderId, true);
      const item = await resolveRef(sql, organizationId, ref, deps.media);
      const [assetId, outputId] = refColumns(ref);
      const filed = (
        await sql.query(
          `select 1 from brand_studio_folder_items where folder_id = $1
             and asset_id is not distinct from $2::uuid and output_id is not distinct from $3::uuid`,
          [folder.id, assetId, outputId],
        )
      ).rows[0];
      if (!filed) {
        const held = Number(
          (await sql.query<{ n: number }>('select count(*)::int as n from brand_studio_folder_items where folder_id = $1', [folder.id])).rows[0]?.n ?? 0,
        );
        if (held >= LIBRARY_LIMITS.itemsPerFolder) throw new StudioDenied('asset_limit');
        await sql.query(
          'insert into brand_studio_folder_items (folder_id, organization_id, asset_id, output_id, added_by) values ($1, $2, $3, $4, $5)',
          [folder.id, organizationId, assetId, outputId, seat.userId],
        );
        folder = (await sql.query<FolderRow>('update brand_studio_folders set updated_at = now() where id = $1 returning *', [folder.id])).rows[0]!;
      }
      return { ok: true as const, folder: await folderView(sql, organizationId, folder, deps.media), item };
    }),
  );
}

async function removeFromFolder(deps: LibraryDeps, viewer: Viewer, raw: unknown): Promise<LibraryFolderDone | StudioFailure> {
  const parsed = FolderItemSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const { organizationId, folderId, ref } = parsed.data;
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      requireCreate(await studioSeat(sql, viewer.userId, organizationId));
      let folder = await liveFolder(sql, organizationId, folderId, true);
      const [assetId, outputId] = refColumns(ref);
      const removed = (
        await sql.query(
          `delete from brand_studio_folder_items where folder_id = $1
             and asset_id is not distinct from $2::uuid and output_id is not distinct from $3::uuid returning id`,
          [folder.id, assetId, outputId],
        )
      ).rows.length;
      if (removed) folder = (await sql.query<FolderRow>('update brand_studio_folders set updated_at = now() where id = $1 returning *', [folder.id])).rows[0]!;
      return { ok: true as const, folder: await folderView(sql, organizationId, folder, deps.media) };
    }),
  );
}
