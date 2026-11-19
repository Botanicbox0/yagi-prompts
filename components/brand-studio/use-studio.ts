"use client";
/**
 * The studio's server conversation: first load, polling while jobs are open, and the operations the
 * screen runs. Components get answers already merged into the store; they never fetch on their own.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { z } from "zod";
import type { FilmSheet, ReviseMarkReadSchema, StudioAssetView, StudioFailure, StudioJobCreate, StudioJobGroupCreate, StudioJobView, StudioProjectRef, StudioReviseMarkRead, StudioState } from "@/lib/brand-studio/contracts";
import { createStudioApi, isFailure, measureInBrowser, type ApiResult, type StudioApi, type StudioOps } from "./api";
import { newRequestId } from "./copy";
import { createPollLoop, type PollLoop } from "./poller";
import { STUDIO_JOB_SETTLED, STUDIO_JOB_STARTED, announce } from "./seams";
import { initialStore, isOpen, studioReducer } from "./store";

export type FilmState = { status: "loading" } | { status: "done"; sheet: FilmSheet | null };

/**
 * The `job.create` input as it is sent. With no project chosen (or projects closed, which the caller turns
 * into null) it is the very object it always was. A new version and a 1080p finish name no project either:
 * the server gives them the project of the run they come from.
 */
export function jobInputForProject(input: StudioJobCreate, projectId: string | null): StudioJobCreate {
  const fresh = input.kind === "image" || input.kind === "video" || input.kind === "video_remix" || input.kind === "region_edit";
  return projectId && fresh ? { ...input, projectId } : input;
}

export function useStudio({
  organizationId,
  initialState,
  api: injected,
  projectId = null,
}: {
  organizationId: string;
  initialState?: StudioState | null;
  api?: StudioApi;
  /** The project new runs go into. Sent only while the server says projects are open (`state.projects`). */
  projectId?: string | null;
}) {
  const api = useMemo(() => injected ?? createStudioApi({ organizationId }), [injected, organizationId]);
  const [store, dispatch] = useReducer(studioReducer, initialState ?? null, initialStore);
  const projectsOpen = Boolean(store.state?.projects);
  const intoProject = useRef<string | null>(null);
  intoProject.current = projectsOpen ? projectId : null;
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
      const result = await api.call("job.create", jobInputForProject(input, intoProject.current));
      if (!isFailure(result)) dispatch({ type: "jobAdded", job: result.job });
      return result;
    },
    [api],
  );

  /** One request on several image models: every run lands on the wall at once, or none does. */
  const createGroup = useCallback(
    async (input: StudioJobGroupCreate) => {
      const target = intoProject.current;
      const result = await api.call("job.create_group", target ? { ...input, projectId: target } : input);
      if (!isFailure(result)) for (const job of result.jobs) dispatch({ type: "jobAdded", job });
      return result;
    },
    [api],
  );

  /** Put a run (and everything made from it) in a project, or take it out with `null`. */
  const assignProject = useCallback(
    async (jobId: string, target: string | null) => {
      const result = await api.call("job.assign_project", { organizationId, jobId, projectId: target });
      if (!isFailure(result)) dispatch({ type: "jobsProject", jobIds: result.jobIds, projectId: result.projectId });
      return result;
    },
    [api, organizationId],
  );

  /** A new project with nothing in it yet (the video studio's own endpoint and row). */
  const createProject = useCallback(
    async (title: string): Promise<StudioProjectRef | StudioFailure> => {
      try {
        const res = await fetch("/api/brand-studio/video-projects", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ op: "create", organizationId, requestId: newRequestId(), title }),
        });
        const body = (await res.json().catch(() => null)) as { ok?: boolean; code?: StudioFailure["code"]; project?: { id: string; title: string } } | null;
        if (!res.ok || !body?.ok || !body.project) return { ok: false, code: body?.code ?? "failed" };
        const project = { id: body.project.id, title: body.project.title };
        dispatch({ type: "projectAdded", project });
        return project;
      } catch {
        return { ok: false, code: "failed" };
      }
    },
    [organizationId],
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
  const talkRevision = useCallback((input: StudioOps["revise.talk"][0]) => api.call("revise.talk", input), [api]);

  /** A spot marked on a clip: what it is on (a short label for the chip, a description for the request). Spends nothing. */
  const readMark = useCallback(
    (input: z.input<typeof ReviseMarkReadSchema>): Promise<ApiResult<StudioReviseMarkRead>> => api.call("revise.mark", input),
    [api],
  );

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

  /** Takes a run that ended with no result off the wall (the server keeps the row). */
  const deleteJob = useCallback(
    async (jobId: string) => {
      const result = await api.call("job.delete", { organizationId, jobId });
      if (!isFailure(result)) dispatch({ type: "jobRemoved", jobId });
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

  // Uploads whose role the server is recognising (`roleCheck`): the library is read again a few times until
  // each has its answer (`roleSource`), at most ROLE_READ_DELAYS_MS.length times.
  const [awaitingRoles, setAwaitingRoles] = useState<{ ids: string[]; reads: number }>({ ids: [], reads: 0 });
  const assets = store.state?.assets;
  useEffect(() => {
    if (!awaitingRoles.ids.length) return;
    const still = stillAwaitingRole(awaitingRoles.ids, assets ?? []);
    if (still.length !== awaitingRoles.ids.length) return setAwaitingRoles((current) => ({ ...current, ids: still }));
    const delay = ROLE_READ_DELAYS_MS[awaitingRoles.reads];
    if (delay === undefined) return setAwaitingRoles({ ids: [], reads: 0 });
    const timer = window.setTimeout(() => {
      refreshSilently();
      setAwaitingRoles((current) => ({ ...current, reads: current.reads + 1 }));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [awaitingRoles, assets, refreshSilently]);

  const [uploads, setUploads] = useState<Array<{ id: string; name: string }>>([]);
  const upload = useCallback(
    /** `transient`: a source made for one run and deleted afterwards ("빈 곳 채우기"); its role is not read. */
    async (file: File, options: { transient?: boolean } = {}) => {
      const id = newRequestId();
      setUploads((current) => [...current, { id, name: file.name }]);
      try {
        const result = await api.upload(file, { requestId: id, measure: measureInBrowser, ...(options.transient ? { transient: true } : {}) });
        if (!isFailure(result)) {
          dispatch({ type: "assetUpserted", asset: result.asset });
          refreshSilently();
          const assetId = result.asset.id;
          if (result.roleCheck) setAwaitingRoles((current) => ({ ids: [...new Set([...current.ids, assetId])], reads: 0 }));
        }
        return result;
      } finally {
        setUploads((current) => current.filter((u) => u.id !== id));
      }
    },
    [api, refreshSilently],
  );

  return { store, load, createJob, createGroup, assignProject, createProject, cancelJob, saveOutput, deleteOutput, deleteJob, updateAsset, deleteAsset, handoff, enhancePrompt, planRevision, talkRevision, readMark, films, analyzeFilm, uploads, upload };
}

/**
 * When the library is read again after an upload whose role is being recognised: about 4, 8, 14 and 24 s
 * after it (one reading takes about 4 s and gives up at 15 s).
 */
export const ROLE_READ_DELAYS_MS: readonly number[] = [4000, 4000, 6000, 10_000];

/** The uploads still waiting for their role: in the library and with no answer yet. */
export function stillAwaitingRole(ids: readonly string[], assets: readonly Pick<StudioAssetView, "id" | "roleSource">[]): string[] {
  return ids.filter((id) => {
    const asset = assets.find((a) => a.id === id);
    return Boolean(asset && !asset.roleSource);
  });
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
