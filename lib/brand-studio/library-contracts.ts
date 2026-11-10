/**
 * Brand studio library wire contract (docs/BRAND-STUDIO-V3.md §4, the 보관함 레일).
 *
 * Folders the organization shares, likes that belong to one member, and the items both show. The route
 * (`app/api/brand-studio/library`) parses every request with these schemas and the rail's client
 * (`components/brand-studio/rail`) imports the same file. The view shapes match `LibraryItemView` and
 * `StudioFolderView` in `components/brand-studio/seams.ts`; the client checks that at compile time.
 *
 * Client-safe: zod and types only (no env, no db).
 */
import { z } from 'zod';
import type { StudioFailure } from './contracts';

export const LIBRARY_LIMITS = {
  foldersPerOrganization: 100,
  itemsPerFolder: 500,
  folderNameMax: 60,
  /** Liked items the rail lists (newest like first). */
  likedShown: 300,
} as const;

export const LIBRARY_OPERATIONS = ['like.toggle', 'folder.create', 'folder.rename', 'folder.delete', 'folder.add', 'folder.remove'] as const;
export type LibraryOperation = (typeof LIBRARY_OPERATIONS)[number];

const Id = z.uuid();

/** Exactly one of a library asset or an earlier result. */
export const LibraryRefSchema = z.union([z.object({ assetId: Id }).strict(), z.object({ outputId: Id }).strict()]);
export type LibraryRef = z.infer<typeof LibraryRefSchema>;

/** Trimmed, 1..60 characters, no line breaks. */
export const FolderNameSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1).max(LIBRARY_LIMITS.folderNameMax));

/** Sets the like to `liked` (idempotent, so a double press or a retry cannot flip it twice). */
export const LikeToggleSchema = z.object({ organizationId: Id, ref: LibraryRefSchema, liked: z.boolean() }).strict();
export const FolderCreateSchema = z.object({ organizationId: Id, name: FolderNameSchema }).strict();
export const FolderRenameSchema = z.object({ organizationId: Id, folderId: Id, name: FolderNameSchema }).strict();
export const FolderRefSchema = z.object({ organizationId: Id, folderId: Id }).strict();
export const FolderItemSchema = z.object({ organizationId: Id, folderId: Id, ref: LibraryRefSchema }).strict();

/* ------------------------------------------------------------ responses */

export interface LibraryItemWire {
  /** `"o:<outputId>"` or `"a:<assetId>"`. */
  key: string;
  ref: LibraryRef;
  kind: 'image' | 'video' | 'audio';
  url: string;
  thumbUrl: string | null;
  name: string | null;
  width: number | null;
  height: number | null;
  seconds: number | null;
  createdAt: string;
}

export interface LibraryFolderWire {
  id: string;
  name: string;
  /** Live items only (a deleted asset or result is not counted). */
  count: number;
  /** Up to four stills, newest filed first. */
  covers: string[];
  updatedAt: string;
}

/** `GET ?organizationId=` */
export interface LibrarySummary {
  ok: true;
  folders: LibraryFolderWire[];
  liked: LibraryItemWire[];
}

/** `GET ?organizationId=&folder=` */
export interface LibraryFolderItems {
  ok: true;
  folder: LibraryFolderWire;
  items: LibraryItemWire[];
}

export interface LibraryLikeDone {
  ok: true;
  liked: boolean;
  /** The liked thing, so the 좋아요 tab can show it without another read. Null after an un-like. */
  item: LibraryItemWire | null;
}

export interface LibraryFolderDone {
  ok: true;
  folder: LibraryFolderWire;
  /** The filed thing (`folder.add`). */
  item?: LibraryItemWire;
}

export type LibraryRemoved = { ok: true };

export interface LibraryOps {
  'like.toggle': [z.input<typeof LikeToggleSchema>, LibraryLikeDone];
  'folder.create': [z.input<typeof FolderCreateSchema>, LibraryFolderDone];
  'folder.rename': [z.input<typeof FolderRenameSchema>, LibraryFolderDone];
  'folder.delete': [z.input<typeof FolderRefSchema>, LibraryRemoved];
  'folder.add': [z.input<typeof FolderItemSchema>, LibraryFolderDone];
  'folder.remove': [z.input<typeof FolderItemSchema>, LibraryFolderDone];
}

export type LibraryOperationResult = StudioFailure | LibraryLikeDone | LibraryFolderDone | LibraryRemoved;

export function isLibraryOperation(value: unknown): value is LibraryOperation {
  return typeof value === 'string' && (LIBRARY_OPERATIONS as readonly string[]).includes(value);
}

export const libraryRefKey = (ref: LibraryRef): string => ('assetId' in ref ? `a:${ref.assetId}` : `o:${ref.outputId}`);
