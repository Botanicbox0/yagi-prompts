"use client";
/**
 * `useStudioLibrary(organizationId)` (docs/BRAND-STUDIO-V3.md §4): the folders, likes and folder items the
 * library rail shows and the gallery writes to. Loads once, again when the window comes back into focus
 * (at most every 30 seconds, so a teammate's new folder shows up), and keeps every write optimistic.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { StudioLibrary } from "../seams";
import { createLibraryApi } from "./library-api";
import { createLibraryStore, libraryOf, type LibraryExtras } from "./library-store";

const REFRESH_MS = 30_000;

export function useStudioLibrary(organizationId: string): StudioLibrary & LibraryExtras {
  const store = useMemo(() => createLibraryStore(createLibraryApi({ organizationId })), [organizationId]);
  const snap = useSyncExternalStore(store.subscribe, store.get, store.get);
  useEffect(() => {
    let last = Date.now();
    void store.load();
    const refresh = () => {
      if (document.visibilityState === "hidden" || Date.now() - last < REFRESH_MS) return;
      last = Date.now();
      void store.load();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [store]);
  return useMemo(() => libraryOf(store, snap), [store, snap]);
}
