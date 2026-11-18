/**
 * Seams between the studio's slices (docs/BRAND-STUDIO-V3.md §8).
 *
 * Types and event names only. Each slice implements its side in its own files and imports the other
 * side through this file, so two people can build against each other without reading each other's code.
 * Change a shape here first and tell the other owner.
 */
import type {
  RegionBox,
  StudioAssetView,
  StudioErrorCode,
  StudioFailure,
  StudioJobView,
  StudioOutputView,
} from "@/lib/brand-studio/contracts";
import type { StudioImageModel } from "@/lib/brand-studio/models";
import type { RefSource, TrayItem } from "./refs";

/* ------------------------------------------------------------------ events */

/**
 * Fired on `window` right after any screen outside the board starts a job (the reverse panel, a region
 * edit sent from another surface). The board reloads. `detail: { jobId: string }`.
 */
export const STUDIO_JOB_STARTED = "twings:studio-job-started";

/**
 * Fired on `window` when a job the board is watching settles. The workspace rail shows a toast when the
 * person is on another screen. `detail: { jobId: string; status: "succeeded" | "failed" | "canceled"; kind: string }`.
 */
export const STUDIO_JOB_SETTLED = "twings:studio-job-settled";

/** Fired on `window` to open the reference-video (reverse) panel on the video screen. No detail. */
export const STUDIO_OPEN_REVERSE = "twings:studio-open-reverse";

export function announce(name: string, detail?: unknown): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(name, { detail }));
}

/* ----------------------------------------------------------------- library */

/** `"o:<outputId>"` or `"a:<assetId>"` — one key for anything that can be liked, filed or dragged. */
export type LibraryKey = string;
export const libraryKey = (ref: RefSource): LibraryKey => ("assetId" in ref ? `a:${ref.assetId}` : `o:${ref.outputId}`);

/** A result or an asset as the library rail shows it. */
export interface LibraryItemView {
  key: LibraryKey;
  ref: RefSource;
  kind: "image" | "video" | "audio";
  url: string;
  thumbUrl: string | null;
  name: string | null;
  width: number | null;
  height: number | null;
  seconds: number | null;
  createdAt: string;
}

/** A folder the whole organization shares. */
export interface StudioFolderView {
  id: string;
  name: string;
  count: number;
  /** Up to four thumbnails for the folder tile. */
  covers: string[];
  updatedAt: string;
}

/**
 * The library the rail shows and the gallery writes to (`rail/use-library.ts`, slice B2).
 * Every write is optimistic and resolves `false` when the server refused it (the hook rolls back).
 */
export interface StudioLibrary {
  /** False until the first load answered. */
  ready: boolean;
  folders: StudioFolderView[];
  /** Keys this member liked. */
  liked: ReadonlySet<LibraryKey>;
  /** Liked items, newest like first. */
  likedItems: LibraryItemView[];
  /** Items of a folder, or null until `openFolder` has loaded it. */
  folderItems(folderId: string): LibraryItemView[] | null;
  openFolder(folderId: string): void;
  toggleLike(ref: RefSource): Promise<boolean>;
  createFolder(name: string): Promise<StudioFolderView | null>;
  renameFolder(folderId: string, name: string): Promise<boolean>;
  deleteFolder(folderId: string): Promise<boolean>;
  addToFolder(folderId: string, ref: RefSource): Promise<boolean>;
  removeFromFolder(folderId: string, ref: RefSource): Promise<boolean>;
}

/** What `StudioApp` (B1) hands the rail (B2). The rail reads its own copy from `copy.library`. */
export interface LibraryRailProps {
  id: string;
  organizationId: string;
  locale: "ko" | "en";
  library: StudioLibrary;
  /** Uploaded and saved assets (the 업로드 tab). */
  assets: StudioAssetView[];
  /** Resolve a result by id, for likes and folder items the rail did not load itself. */
  outputOf(outputId: string): StudioOutputView | null;
  canCreate: boolean;
  /** True when pressing a thumbnail should attach it to the prompt bar (false: open it instead). */
  attachOnPress: boolean;
  /** Phones: the rail is a bottom sheet, opened by the screen. */
  open: boolean;
  notice: string | null;
  uploading: string[];
  searchId: string;
  onClose(): void;
  onAttach(ref: RefSource): void;
  onView(ref: RefSource): void;
  onFiles(files: File[]): void;
  onUpdate(assetId: string, patch: { name?: string; role?: StudioAssetView["role"]; tags?: string[] }): Promise<unknown>;
  onDelete(assetId: string): Promise<unknown>;
  onRegionEdit?(ref: RefSource): void;
  onDecorate?(ref: RefSource): void;
}

/* ------------------------------------------------------------------ layers */

export interface LayerEditorInitialPatch {
  id?: string;
  url: string;
  maskUrl: string | null;
  /** Pixel coordinates on `base` (`0..base.width`, `0..base.height`). */
  box: { x: number; y: number; w: number; h: number };
  name?: string;
  ref?: RefSource | null;
}

export interface LayerEditorRegionPreset {
  box: RegionBox | null;
  instruction: string;
  serverNumbered?: boolean;
  model?: string;
  quality?: string | null;
  references?: TrayItem[];
  /** The rewrite switch as the edit was sent ("같은 영역 다시 수정하기"); on when absent. */
  enhance?: boolean;
  /** One line the editor shows when it opens (the original is gone, a reference is missing). */
  notice?: string | null;
}

export interface LayerEditorRegionSupport {
  sourceRef: RefSource;
  previewUrl: string;
  models: readonly StudioImageModel[];
  defaultModel: string;
  defaultQuality?: string | null;
  /** Region edit v2: every partial edit runs on `defaultModel`; no model or quality is offered or kept. */
  fixedModel?: boolean;
  /** Live jobs from `StudioApp` so settled `region_edit` runs arrive as layers without blocking. */
  jobs: readonly StudioJobView[];
  errorText(code: StudioErrorCode | null): string;
  submit(request: {
    source: RefSource;
    box: RegionBox;
    instruction: string;
    model: string;
    quality: string;
    references: TrayItem[];
    enhance: boolean;
    /** The sent picture's size when it is not `base` ("빈 곳 채우기" sends the whole canvas). */
    sourceSize?: { width: number; height: number };
    /** `fill`: a strip of "빈 곳 채우기" (internal; no tile on the wall, never listed). */
    purpose?: "fill";
  }): Promise<{ ok: true; job: StudioJobView } | { ok: false; message: string }>;
  enhancePrompt(request: {
    source: RefSource;
    box: RegionBox;
    instruction: string;
    model: string;
    quality: string;
    references: TrayItem[];
  }): Promise<{ ok: true; finalPrompt: string } | { ok: false; message: string }>;
}

/** What `StudioApp` (B1) hands the layer editor (E). The editor reads its own copy from `copy.layers`. */
export interface LayerEditorProps {
  organizationId: string;
  locale: "ko" | "en";
  /** The picture being decorated, at its stored size. */
  base: { ref: RefSource; url: string; width: number; height: number; name: string | null };
  /** Images the person can drop in as layers (uploads and saved results). */
  assets: StudioAssetView[];
  library: StudioLibrary | null;
  initialTool?: "move" | "marquee";
  initialPatch?: LayerEditorInitialPatch | null;
  initialRegionPreset?: LayerEditorRegionPreset | null;
  region?: LayerEditorRegionSupport | null;
  /** The base is a generated white picture ("새로 꾸미기"): its size is the canvas, so no canvas resizing. */
  blankCanvas?: boolean;
  /** The server allows "빈 곳 채우기" (`StudioState.canFillEmpty`, flag `BRAND_STUDIO_OUTPAINT`). Off when absent. */
  fillEmpty?: boolean;
  /**
   * "빈 곳 채우기": the picture just uploaded for it (`assetId`), then the runs started on it (`jobIds`,
   * possibly none). The screen hides that picture and deletes it once all those runs have settled.
   */
  onFillSource?(assetId: string, jobIds?: readonly string[]): void;
  /** Stores the exported PNG as a new asset. */
  upload(file: File): Promise<{ ok: true; asset: StudioAssetView } | StudioFailure>;
  onSaved(asset: StudioAssetView): void;
  onClose(): void;
}

/* ------------------------------------------------------------------ review */

/** `review/send.ts` (slice D) exports `sendToReview(input)`; the gallery's more-menu (B1) calls it. */
export interface SendToReviewInput {
  organizationId: string;
  ref: RefSource;
  title: string;
}
export type SendToReviewResult = { ok: true; href: string } | StudioFailure;
