"use client";
/** Stub until slice B2 lands (docs/BRAND-STUDIO-V3.md §4): an empty library that refuses every write. */
import type { StudioLibrary } from "../seams";

const EMPTY: StudioLibrary = {
  ready: false,
  folders: [],
  liked: new Set<string>(),
  likedItems: [],
  folderItems: () => null,
  openFolder: () => {},
  toggleLike: async () => false,
  createFolder: async () => null,
  renameFolder: async () => false,
  deleteFolder: async () => false,
  addToFolder: async () => false,
  removeFromFolder: async () => false,
};

export function useStudioLibrary(_organizationId: string): StudioLibrary {
  return EMPTY;
}
