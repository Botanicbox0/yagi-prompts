"use client";
/**
 * The studio's server conversation: first load, polling while jobs are open, and the operations the
 * screen runs. Components get answers already merged into the store; they never fetch on their own.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { FilmSheet, StudioJobCreate, StudioJobView, StudioState } from "@/lib/brand-studio/contracts";
import { createStudioApi, isFailure, measureInBrowser, type StudioApi, type StudioOps } from "./api";
import { newRequestId } from "./copy";
import { createPollLoop, type PollLoop } from "./poller";
import { STUDIO_JOB_SETTLED, STUDIO_JOB_STARTED, announce } from "./seams";
import { initialStore, isOpen, studioReducer } from "./store";

export type FilmState = { status: "loading" } | { status: "done"; sheet: FilmSheet | null };

export function useStudio({ organizationId, initialState, api: injected }: { organizationId: string; initialState?: StudioState | null; api?: StudioApi }) {
  const api = useMemo(() => injected ?? createStudioApi({ organizationId }), [injected, organizationId]);
  const [store, dispatch] = useReducer(studioReducer, initialState ?? null, initialStore);
  const preloaded = useRef(Boolean(initialState));

  const load = useCallback(async () => {
    dispatch({ type: "load" });
    let result = await api.loadState();
    // The first request after a quiet period can fail while the server wakes up (seen in production on
    // 2026-11-10: the first load failed, the next one answered in 0.2 s). One quiet second try before
    // showing an error.
    if (isFailure(result) && (result.code === "failed" || result.code === "provider_unavailable")) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      result = await api.loadState();
    }
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

  // A run this screen watched has settled: tell the workspace (its rail shows a toast elsewhere).
  const seen = useRef<Map<string, StudioJobView["status"]> | null>(null);
  useEffect(() => {
    if (!jobs) return;
    const before = seen.current;
    for (const event of settledJobs(before, jobs)) announce(STUDIO_JOB_SETTLED, event);
    seen.current = new Map(jobs.map((job) => [job.id, job.status]));
  }, [jobs]);

  // Another screen started a run (the reverse panel, a partial edit elsewhere): read the board again.
  useEffect(() => {
    const reload = () => void load();
    window.addEventListener(STUDIO_JOB_STARTED, reload);
    return () => window.removeEventListener(STUDIO_JOB_STARTED, reload);
  }, [load]);

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

  const refreshSilently = useCallback(() => {
    void api.loadState().then((fresh) => {
      if (!isFailure(fresh)) dispatch({ type: "loaded", state: fresh });
    });
  }, [api]);

  const deleteAsset = useCallback(
    async (assetId: string) => {
      const result = await api.call("asset.delete", { organizationId, assetId });
      if (!isFailure(result)) {
        dispatch({ type: "assetRemoved", id: assetId });
        refreshSilently();
      }
      return result;
    },
    [api, organizationId, refreshSilently],
  );

  const handoff = useCallback((input: StudioOps["handoff.campaign"][0]) => api.call("handoff.campaign", input), [api]);

  /** ✨ in the prompt bar: the sentence the enhancer would send, without starting anything. */
  const enhancePrompt = useCallback((input: StudioOps["prompt.enhance"][0]) => api.call("prompt.enhance", input), [api]);

  /** The viewer's "next version" form: which ways are open, what each uses and which fits the request. Spends nothing. */
  const planRevision = useCallback((input: StudioOps["revise.plan"][0]) => api.call("revise.plan", input), [api]);

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
      if (!isFailure(result)) {
        dispatch({ type: "outputRemoved", outputId });
        refreshSilently();
      }
      return result;
    },
    [api, organizationId, refreshSilently],
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
        if (!isFailure(result)) {
          dispatch({ type: "assetUpserted", asset: result.asset });
          refreshSilently();
        }
        return result;
      } finally {
        setUploads((current) => current.filter((u) => u.id !== id));
      }
    },
    [api, refreshSilently],
  );

  return { store, load, createJob, cancelJob, saveOutput, deleteOutput, updateAsset, deleteAsset, handoff, enhancePrompt, planRevision, films, analyzeFilm, uploads, upload };
}

/**
 * Runs that were open in the previous view of the board and are closed now. The first view settles
 * nothing (a run already finished before the screen opened was not watched).
 */
export function settledJobs(
  before: ReadonlyMap<string, StudioJobView["status"]> | null,
  jobs: readonly Pick<StudioJobView, "id" | "status" | "kind">[],
): Array<{ jobId: string; status: "succeeded" | "failed" | "canceled"; kind: string }> {
  if (!before) return [];
  const out: Array<{ jobId: string; status: "succeeded" | "failed" | "canceled"; kind: string }> = [];
  for (const job of jobs) {
    const was = before.get(job.id);
    if (was && isOpen({ status: was }) && !isOpen(job) && (job.status === "succeeded" || job.status === "failed" || job.status === "canceled"))
      out.push({ jobId: job.id, status: job.status, kind: job.kind });
  }
  return out;
}

export type StudioController = ReturnType<typeof useStudio>;
