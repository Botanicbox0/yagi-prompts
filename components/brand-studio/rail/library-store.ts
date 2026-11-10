/**
 * The library's state outside React (docs/BRAND-STUDIO-V3.md §4): one snapshot, optimistic writes that
 * roll back when the server refuses them. `use-library.ts` subscribes React to it; tests drive it with a
 * fake client. Every write resolves `false` (or `null`) on refusal and leaves the code in `lastError`.
 */
import type { StudioErrorCode } from "@/lib/brand-studio/contracts";
import { LIBRARY_LIMITS, type LibraryFolderWire, type LibraryItemWire } from "@/lib/brand-studio/library-contracts";
import type { RefSource } from "../refs";
import { libraryKey, type LibraryItemView, type LibraryKey, type StudioFolderView, type StudioLibrary } from "../seams";
import { libraryFailed, type LibraryApi } from "./library-api";

// The wire shapes are the seam shapes: a change on either side breaks here at compile time.
const _items: (wire: LibraryItemWire) => LibraryItemView = (wire) => wire;
const _folders: (wire: LibraryFolderWire) => StudioFolderView = (wire) => wire;
void _items;
void _folders;

export interface LibrarySnapshot {
  ready: boolean;
  /** The first load failed (the rail offers a retry). */
  error: boolean;
  /** Why the last write was refused; cleared by the next write. */
  lastError: StudioErrorCode | null;
  folders: StudioFolderView[];
  likedKeys: ReadonlySet<LibraryKey>;
  likedItems: LibraryItemView[];
  items: Readonly<Record<string, LibraryItemView[]>>;
}

/** What the hook adds to the seam: load errors and a retry. */
export interface LibraryExtras {
  error: boolean;
  lastError: StudioErrorCode | null;
  reload(): void;
}

export const TEMP_FOLDER = "tmp-";
export const isTempFolder = (id: string) => id.startsWith(TEMP_FOLDER);

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
export const sortFolders = (folders: readonly StudioFolderView[]) => [...folders].sort((a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id));

/** The same tidy-up the server applies (lib/brand-studio/library-contracts.ts `FolderNameSchema`). */
export function cleanFolderName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim();
  return name && name.length <= LIBRARY_LIMITS.folderNameMax ? name : null;
}

const EMPTY: LibrarySnapshot = { ready: false, error: false, lastError: null, folders: [], likedKeys: new Set(), likedItems: [], items: {} };

export function createLibraryStore(api: LibraryApi) {
  let state: LibrarySnapshot = EMPTY;
  const listeners = new Set<() => void>();
  /** The newest like write per key: an older answer neither applies nor rolls back. */
  const likeTurn = new Map<LibraryKey, number>();
  let turn = 0;
  let tempCount = 0;

  function set(patch: Partial<LibrarySnapshot> | ((s: LibrarySnapshot) => Partial<LibrarySnapshot>)) {
    state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
    for (const listener of listeners) listener();
  }
  const refuse = (code: StudioErrorCode) => set({ lastError: code });
  const replaceFolder = (folder: StudioFolderView, previousId = folder.id) =>
    set((s) => ({ folders: sortFolders([...s.folders.filter((f) => f.id !== previousId && f.id !== folder.id), folder]) }));
  const patchFolder = (id: string, fn: (f: StudioFolderView) => StudioFolderView) =>
    set((s) => ({ folders: s.folders.map((f) => (f.id === id ? fn(f) : f)) }));
  const withItems = (id: string, fn: (items: LibraryItemView[]) => LibraryItemView[]) =>
    set((s) => (s.items[id] ? { items: { ...s.items, [id]: fn(s.items[id]!) } } : {}));

  async function load(): Promise<void> {
    const result = await api.summary();
    if (libraryFailed(result)) return set((s) => ({ error: !s.ready }));
    set({
      ready: true,
      error: false,
      folders: sortFolders(result.folders),
      likedItems: result.liked,
      likedKeys: new Set(result.liked.map((item) => item.key)),
    });
  }

  async function openFolder(folderId: string): Promise<void> {
    if (isTempFolder(folderId)) return;
    const result = await api.folder(folderId);
    if (libraryFailed(result)) {
      // Someone else deleted it: it leaves the list, and the rail goes back to all folders.
      if (result.code === "not_found") set((s) => ({ folders: s.folders.filter((f) => f.id !== folderId) }));
      return;
    }
    set((s) => ({ items: { ...s.items, [folderId]: result.items } }));
    replaceFolder(result.folder);
  }

  async function toggleLike(ref: RefSource): Promise<boolean> {
    const key = libraryKey(ref);
    const wasLiked = state.likedKeys.has(key);
    const at = state.likedItems.findIndex((item) => item.key === key);
    const removed = at >= 0 ? state.likedItems[at]! : null;
    const mine = ++turn;
    likeTurn.set(key, mine);
    set((s) => {
      const keys = new Set(s.likedKeys);
      if (wasLiked) keys.delete(key);
      else keys.add(key);
      return { lastError: null, likedKeys: keys, likedItems: wasLiked ? s.likedItems.filter((item) => item.key !== key) : s.likedItems };
    });
    const result = await api.call("like.toggle", { ref, liked: !wasLiked });
    const latest = likeTurn.get(key) === mine;
    if (libraryFailed(result)) {
      if (latest) {
        set((s) => {
          const keys = new Set(s.likedKeys);
          if (wasLiked) keys.add(key);
          else keys.delete(key);
          const items = s.likedItems.filter((item) => item.key !== key);
          if (wasLiked && removed) items.splice(Math.min(at, items.length), 0, removed);
          return { likedKeys: keys, likedItems: items, lastError: result.code };
        });
      }
      return false;
    }
    if (latest && result.liked && result.item) {
      const item = result.item;
      set((s) => ({ likedItems: [item, ...s.likedItems.filter((i) => i.key !== key)] }));
    }
    return true;
  }

  async function createFolder(raw: string): Promise<StudioFolderView | null> {
    const name = cleanFolderName(raw);
    if (!name) {
      refuse("invalid");
      return null;
    }
    const temp: StudioFolderView = { id: `${TEMP_FOLDER}${++tempCount}`, name, count: 0, covers: [], updatedAt: new Date().toISOString() };
    set((s) => ({ lastError: null, folders: sortFolders([...s.folders, temp]) }));
    const result = await api.call("folder.create", { name });
    if (libraryFailed(result)) {
      set((s) => ({ folders: s.folders.filter((f) => f.id !== temp.id), lastError: result.code }));
      return null;
    }
    replaceFolder(result.folder, temp.id);
    return result.folder;
  }

  async function renameFolder(folderId: string, raw: string): Promise<boolean> {
    const name = cleanFolderName(raw);
    const before = state.folders.find((f) => f.id === folderId);
    if (!name || !before || isTempFolder(folderId)) {
      refuse(name ? "not_found" : "invalid");
      return false;
    }
    set({ lastError: null });
    replaceFolder({ ...before, name });
    const result = await api.call("folder.rename", { folderId, name });
    if (libraryFailed(result)) {
      set((s) => ({
        folders: sortFolders(s.folders.map((f) => (f.id === folderId && f.name === name ? { ...f, name: before.name } : f))),
        lastError: result.code,
      }));
      return false;
    }
    replaceFolder(result.folder);
    return true;
  }

  async function deleteFolder(folderId: string): Promise<boolean> {
    const before = state.folders.find((f) => f.id === folderId);
    if (!before || isTempFolder(folderId)) return false;
    const items = state.items[folderId];
    set((s) => {
      const { [folderId]: _gone, ...rest } = s.items;
      return { lastError: null, folders: s.folders.filter((f) => f.id !== folderId), items: rest };
    });
    const result = await api.call("folder.delete", { folderId });
    if (libraryFailed(result)) {
      set((s) => ({ folders: sortFolders([...s.folders, before]), items: items ? { ...s.items, [folderId]: items } : s.items, lastError: result.code }));
      return false;
    }
    return true;
  }

  async function addToFolder(folderId: string, ref: RefSource): Promise<boolean> {
    if (isTempFolder(folderId) || !state.folders.some((f) => f.id === folderId)) {
      refuse("not_found");
      return false;
    }
    const key = libraryKey(ref);
    const bumped = !state.items[folderId]?.some((item) => item.key === key);
    set({ lastError: null });
    if (bumped) patchFolder(folderId, (f) => ({ ...f, count: f.count + 1 }));
    const result = await api.call("folder.add", { folderId, ref });
    if (libraryFailed(result)) {
      if (bumped) patchFolder(folderId, (f) => ({ ...f, count: Math.max(0, f.count - 1) }));
      set({ lastError: result.code });
      return false;
    }
    replaceFolder(result.folder);
    const item = result.item;
    if (item) withItems(folderId, (items) => [item, ...items.filter((i) => i.key !== item.key)]);
    return true;
  }

  async function removeFromFolder(folderId: string, ref: RefSource): Promise<boolean> {
    if (isTempFolder(folderId) || !state.folders.some((f) => f.id === folderId)) return false;
    const key = libraryKey(ref);
    const list = state.items[folderId];
    const at = list ? list.findIndex((item) => item.key === key) : -1;
    const removed = at >= 0 ? list![at]! : null;
    const lowered = !list || removed !== null;
    set({ lastError: null });
    if (lowered) patchFolder(folderId, (f) => ({ ...f, count: Math.max(0, f.count - 1) }));
    if (removed) withItems(folderId, (items) => items.filter((i) => i.key !== key));
    const result = await api.call("folder.remove", { folderId, ref });
    if (libraryFailed(result)) {
      if (lowered) patchFolder(folderId, (f) => ({ ...f, count: f.count + 1 }));
      if (removed) withItems(folderId, (items) => (items.some((i) => i.key === key) ? items : [...items.slice(0, at), removed, ...items.slice(at)]));
      set({ lastError: result.code });
      return false;
    }
    replaceFolder(result.folder);
    return true;
  }

  // Fire-and-forget versions with a stable identity (an effect may depend on them).
  const openFolderNow = (folderId: string): void => void openFolder(folderId);
  const reloadNow = (): void => void load();

  return {
    get: (): LibrarySnapshot => state,
    openFolderNow,
    reloadNow,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load,
    openFolder,
    toggleLike,
    createFolder,
    renameFolder,
    deleteFolder,
    addToFolder,
    removeFromFolder,
  };
}

export type LibraryStore = ReturnType<typeof createLibraryStore>;

/** The seam object (plus the rail's extras) for one snapshot. */
export function libraryOf(store: LibraryStore, snap: LibrarySnapshot): StudioLibrary & LibraryExtras {
  return {
    ready: snap.ready,
    error: snap.error,
    // Read live: a caller checks it right after awaiting a write, before React has re-rendered.
    get lastError() {
      return store.get().lastError;
    },
    folders: snap.folders,
    liked: snap.likedKeys,
    likedItems: snap.likedItems,
    folderItems: (folderId) => snap.items[folderId] ?? null,
    openFolder: store.openFolderNow,
    toggleLike: store.toggleLike,
    createFolder: store.createFolder,
    renameFolder: store.renameFolder,
    deleteFolder: store.deleteFolder,
    addToFolder: store.addToFolder,
    removeFromFolder: store.removeFromFolder,
    reload: store.reloadNow,
  };
}

/** True for the hook's own library (the seam type does not carry the extras). */
export function hasExtras(library: StudioLibrary): library is StudioLibrary & LibraryExtras {
  return typeof (library as Partial<LibraryExtras>).reload === "function";
}
