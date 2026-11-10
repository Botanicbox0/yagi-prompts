"use client";
/**
 * The studio's server conversation: first load, polling while jobs are open, and the operations the
 * screen runs. Components get answers already merged into the store; they never fetch on their own.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { FilmSheet, StudioJobCreate, StudioState } from "@/lib/brand-studio/contracts";
import { createStudioApi, isFailure, measureInBrowser, type StudioApi, type StudioOps } from "./api";
import { newRequestId } from "./copy";
import { createPollLoop, type PollLoop } from "./poller";
import { initialStore, studioReducer } from "./store";

export type FilmState = { status: "loading" } | { status: "done"; sheet: FilmSheet | null };

export function useStudio({ organizationId, initialState, api: injected }: { organizationId: string; initialState?: StudioState | null; api?: StudioApi }) {
  const api = useMemo(() => injected ?? createStudioApi({ organizationId }), [injected, organizationId]);
  const [store, dispatch] = useReducer(studioReducer, initialState ?? null, initialStore);
  const preloaded = useRef(Boolean(initialState));

  const load = useCallback(async () => {
    dispatch({ type: "load" });
    const result = await api.loadState();
    dispatch(isFailure(result) ? { type: "loadFailed", code: result.code } : { type: "loaded", state: result });
  }, [api]);

  useEffect(() => {
    if (preloaded.current) return;
    void load();
  }, [load]);

  // One poll loop per page: 3 s for images, 8 s once a video is open, paused while the tab is hidden.
  const loop = useRef<PollLoop | null>(null);
  useEffect(() => {
    const instance = createPollLoop({
      tick: async (jobIds) => {
        const result = await api.poll(jobIds);
        if (!isFailure(result)) dispatch({ type: "polled", poll: result });
      },
      hidden: () => document.visibilityState === "hidden",
      setTimer: (run, ms) => window.setTimeout(run, ms),
      clearTimer: (handle) => window.clearTimeout(handle as number),
    });
    loop.current = instance;
    const onVisibility = () => instance.visibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      instance.stop();
      document.removeEventListener("visibilitychange", onVisibility);
      loop.current = null;
    };
  }, [api]);
  const jobs = store.state?.jobs;
  useEffect(() => {
    if (jobs) loop.current?.update(jobs);
  }, [jobs]);

  const createJob = useCallback(
    async (input: StudioJobCreate) => {
      const result = await api.call("job.create", input);
      if (!isFailure(result)) dispatch({ type: "jobAdded", job: result.job });
      return result;
    },
    [api],
  );

  const saveOutput = useCallback(
    async (outputId: string) => {
      const result = await api.call("asset.from_output", { organizationId, outputId });
      if (!isFailure(result)) {
        dispatch({ type: "assetUpserted", asset: result.asset });
        dispatch({ type: "outputSaved", outputId, assetId: result.asset.id });
      }
      return result;
    },
    [api, organizationId],
  );

  const updateAsset = useCallback(
    async (input: Omit<StudioOps["asset.update"][0], "organizationId">) => {
      const result = await api.call("asset.update", { ...input, organizationId });
      if (!isFailure(result)) dispatch({ type: "assetUpserted", asset: result.asset });
      return result;
    },
    [api, organizationId],
  );

  const deleteAsset = useCallback(
    async (assetId: string) => {
      const result = await api.call("asset.delete", { organizationId, assetId });
      if (!isFailure(result)) dispatch({ type: "assetRemoved", id: assetId });
      return result;
    },
    [api, organizationId],
  );

  const handoff = useCallback((input: StudioOps["handoff.campaign"][0]) => api.call("handoff.campaign", input), [api]);

  /** Stops a run that has not reached the maker yet; either way the job is read again (status and usage). */
  const cancelJob = useCallback(
    async (jobId: string) => {
      const result = await api.call("job.cancel", { organizationId, jobId });
      const fresh = await api.poll([jobId]);
      if (!isFailure(fresh)) dispatch({ type: "polled", poll: fresh });
      return result;
    },
    [api, organizationId],
  );

  const deleteOutput = useCallback(
    async (outputId: string) => {
      const result = await api.call("output.delete", { organizationId, outputId });
      if (!isFailure(result)) dispatch({ type: "outputRemoved", outputId });
      return result;
    },
    [api, organizationId],
  );

  // A reference video is read once per asset; a failed reading is simply no reading.
  const [films, setFilms] = useState<Record<string, FilmState>>({});
  const asked = useRef(new Set<string>());
  const analyzeFilm = useCallback(
    (assetId: string) => {
      if (asked.current.has(assetId)) return;
      asked.current.add(assetId);
      setFilms((current) => ({ ...current, [assetId]: { status: "loading" } }));
      void api.call("film.analyze", { organizationId, assetId }).then((result) =>
        setFilms((current) => ({ ...current, [assetId]: { status: "done", sheet: isFailure(result) ? null : result.sheet } })),
      );
    },
    [api, organizationId],
  );

  const [uploads, setUploads] = useState<Array<{ id: string; name: string }>>([]);
  const upload = useCallback(
    async (file: File) => {
      const id = newRequestId();
      setUploads((current) => [...current, { id, name: file.name }]);
      try {
        const result = await api.upload(file, { requestId: id, measure: measureInBrowser });
        if (!isFailure(result)) dispatch({ type: "assetUpserted", asset: result.asset });
        return result;
      } finally {
        setUploads((current) => current.filter((u) => u.id !== id));
      }
    },
    [api],
  );

  return { store, load, createJob, cancelJob, saveOutput, deleteOutput, updateAsset, deleteAsset, handoff, films, analyzeFilm, uploads, upload };
}

export type StudioController = ReturnType<typeof useStudio>;
