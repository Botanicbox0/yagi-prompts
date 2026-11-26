"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchDesignPromptPicture,
  fetchRunPromptPicture,
  type PromptPictureResult,
} from "../api";
import { clampPage, clampPageCount, stepPage } from "./model";

export type PromptPictureLoader = (
  request:
    | { kind: "run"; organizationId: string; jobId: string; page: number }
    | { kind: "design"; organizationId: string; token: string; page: number },
  signal: AbortSignal,
) => Promise<PromptPictureResult>;

export type PromptPictureStatus = "idle" | "loading" | "ready" | "failed" | "busy";

export interface UsePromptPicturesInput {
  active: boolean;
  organizationId: string;
  kind: "run" | "design";
  jobId?: string;
  version?: string;
  token?: string;
  pages: number;
  fetchPicture?: PromptPictureLoader;
}

export interface UsePromptPicturesResult {
  page: number;
  total: number;
  status: PromptPictureStatus;
  url: string | null;
  goPrev(): void;
  goNext(): void;
  retry(): void;
}

interface ViewSnapshot {
  scopeKey: string;
  page: number;
  status: PromptPictureStatus;
  url: string | null;
}

/**
 * Loads shielded prompt pictures on demand, caches object URLs per `jobId:version:page` (or `token:page`),
 * deduplicates concurrent loads of the same page, and revokes every URL on scope change or unmount.
 */
export function usePromptPictures(input: UsePromptPicturesInput): UsePromptPicturesResult {
  const { active, organizationId, kind, jobId, version, token, pages, fetchPicture } = input;
  const total = clampPageCount(pages);
  const scopeKey = kind === "run" ? `${jobId ?? ""}:${version ?? ""}` : `token:${token ?? ""}`;

  const [nav, setNav] = useState<{ scopeKey: string; page: number }>({ scopeKey, page: 1 });
  const [retrySeq, setRetrySeq] = useState(0);
  const [view, setView] = useState<ViewSnapshot>({ scopeKey, page: 1, status: "idle", url: null });

  const currentPage = clampPage(nav.scopeKey === scopeKey ? nav.page : 1, total);

  const cacheRef = useRef<Map<string, string>>(new Map());
  const inFlightRef = useRef<Map<string, AbortController>>(new Map());
  const scopeRef = useRef(scopeKey);
  const pageRef = useRef(currentPage);
  pageRef.current = currentPage;
  const unmountedRef = useRef(false);
  const loaderRef = useRef(fetchPicture);
  loaderRef.current = fetchPicture;

  const abortAllInFlight = useCallback(() => {
    for (const controller of inFlightRef.current.values()) controller.abort();
    inFlightRef.current.clear();
  }, []);

  const clearCacheAndAbort = useCallback(() => {
    abortAllInFlight();
    for (const url of cacheRef.current.values()) URL.revokeObjectURL(url);
    cacheRef.current.clear();
  }, [abortAllInFlight]);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      clearCacheAndAbort();
    };
  }, [clearCacheAndAbort]);

  useEffect(() => {
    if (scopeRef.current === scopeKey) return;
    clearCacheAndAbort();
    scopeRef.current = scopeKey;
    setRetrySeq(0);
    setView({ scopeKey, page: 1, status: "idle", url: null });
  }, [scopeKey, clearCacheAndAbort]);

  useEffect(() => {
    if (!active || !organizationId) {
      abortAllInFlight();
      return;
    }
    if (kind === "run" && !jobId) return;
    if (kind === "design" && !token) return;
    if (scopeRef.current !== scopeKey) return;

    const cacheKey = `${scopeKey}:${currentPage}`;
    const cachedUrl = cacheRef.current.get(cacheKey);
    if (cachedUrl) {
      setView((prev) =>
        prev.scopeKey === scopeKey && prev.page === currentPage && prev.status === "ready" && prev.url === cachedUrl
          ? prev
          : { scopeKey, page: currentPage, status: "ready", url: cachedUrl },
      );
      return;
    }

    if (inFlightRef.current.has(cacheKey)) return;

    const controller = new AbortController();
    inFlightRef.current.set(cacheKey, controller);
    setView({ scopeKey, page: currentPage, status: "loading", url: null });

    const request =
      kind === "run"
        ? { kind: "run" as const, organizationId, jobId: jobId!, page: currentPage }
        : { kind: "design" as const, organizationId, token: token!, page: currentPage };

    const loadPromise = loaderRef.current
      ? loaderRef.current(request, controller.signal)
      : request.kind === "run"
        ? fetchRunPromptPicture({ organizationId, jobId: request.jobId, page: request.page }, { signal: controller.signal })
        : fetchDesignPromptPicture({ organizationId, token: request.token, page: request.page }, { signal: controller.signal });

    void loadPromise
      .catch(() => ({ ok: false as const, code: "failed" as const }))
      .then((result) => {
        if (inFlightRef.current.get(cacheKey) === controller) inFlightRef.current.delete(cacheKey);
        if (unmountedRef.current || controller.signal.aborted || scopeRef.current !== scopeKey) return;
        if (!result.ok) {
          if (pageRef.current === currentPage) {
            setView({
              scopeKey,
              page: currentPage,
              status: result.code === "too_many_running" ? "busy" : "failed",
              url: null,
            });
          }
          return;
        }
        const objectUrl = URL.createObjectURL(result.blob);
        const existing = cacheRef.current.get(cacheKey);
        if (existing) URL.revokeObjectURL(existing);
        cacheRef.current.set(cacheKey, objectUrl);
        if (pageRef.current === currentPage) {
          setView({ scopeKey, page: currentPage, status: "ready", url: objectUrl });
        }
      });
  }, [active, organizationId, scopeKey, kind, jobId, version, token, currentPage, retrySeq, abortAllInFlight]);

  const goPrev = useCallback(() => {
    setNav((prev) => {
      const base = prev.scopeKey === scopeKey ? prev.page : 1;
      return { scopeKey, page: stepPage(base, -1, total) };
    });
  }, [scopeKey, total]);

  const goNext = useCallback(() => {
    setNav((prev) => {
      const base = prev.scopeKey === scopeKey ? prev.page : 1;
      return { scopeKey, page: stepPage(base, 1, total) };
    });
  }, [scopeKey, total]);

  const retry = useCallback(() => {
    setRetrySeq((n) => n + 1);
  }, []);

  const settled = view.scopeKey === scopeKey && view.page === currentPage;
  const status: PromptPictureStatus = !active ? "idle" : settled ? (view.status === "idle" ? "loading" : view.status) : "loading";
  const url = active && settled && status === "ready" ? view.url : null;

  return { page: currentPage, total, status, url, goPrev, goNext, retry };
}
