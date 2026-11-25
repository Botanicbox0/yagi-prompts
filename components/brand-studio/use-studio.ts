"use client";
/**
 * The studio's server conversation: first load, polling while jobs are open, and the operations the
 * screen runs. Components get answers already merged into the store; they never fetch on their own.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { z } from "zod";
import type { BrandProjectFilingInput, FilmSheet, ReviseMarkReadSchema, StudioAssetView, StudioErrorCode, StudioFailure, StudioJobCreate, StudioJobGroupCreate, StudioJobView, StudioProjectRef, StudioReviseMarkRead, StudioState } from "@/lib/brand-studio/contracts";
import { belongsToOpenProject, brandProjectIdOf, queryParamOfOpenProject, type OpenProject } from "@/lib/brand-studio/open-project";
import { createStudioApi, isFailure, measureInBrowser, type ApiResult, type StudioApi, type StudioOps } from "./api";
import { newRequestId } from "./copy";
import type { RefSource } from "./refs";
import { createPollLoop, type PollLoop } from "./poller";
import { handleNotFoundForOpenProject } from "./project-chip/model";
import { STUDIO_JOB_SETTLED, STUDIO_JOB_STARTED, announce } from "./seams";
import { createStartedRuns } from "./started-runs";
import { initialStore, isOpen, studioReducer, type StudioAction, type StudioStore } from "./store";

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

/**
 * Brand project spine filing on `job.create` (§2, §4.3): attaches `brandProjectId` only when a project is open
 * and the run is fresh; omits the key completely for 미분류 (`null`) or child runs (`video_final`, `video_revise`).
 */
export function jobInputForBrandProject(
  input: StudioJobCreate,
  brandProjectId: string | null,
): StudioJobCreate & BrandProjectFilingInput {
  const fresh = input.kind === "image" || input.kind === "video" || input.kind === "video_remix" || input.kind === "region_edit";
  return brandProjectId && fresh ? { ...input, brandProjectId } : input;
}

/** Brand project spine filing on `job.create_group` (§2, §4.3): attaches `brandProjectId` only when a project is open. */
export function groupInputForBrandProject(
  input: StudioJobGroupCreate,
  brandProjectId: string | null,
): StudioJobGroupCreate & BrandProjectFilingInput {
  return brandProjectId ? { ...input, brandProjectId } : input;
}

/**
 * Filter incoming jobs to the current open scope while the brand project spine is active (F2).
 * Without the spine (`open` null/undefined), returns `jobs` untouched.
 */
export function filterJobsForScope(
  jobs: readonly StudioJobView[],
  open: OpenProject | null | undefined,
): StudioJobView[] {
  if (!open) return jobs as StudioJobView[];
  return jobs.filter((job) => belongsToOpenProject(job.brandProjectId, open));
}

/**
 * Pure reducer wrapper for F2: while `open` is active, drops late `polled` or `jobAdded` runs that belong to
 * another scope so a switch never leaks the previous project's runs onto the new project's wall.
 */
export function applyScopedStudioAction(
  store: StudioStore,
  action: StudioAction,
  open: OpenProject | null | undefined,
): StudioStore {
  if (!open) return studioReducer(store, action);
  if (action.type === "jobAdded") {
    return belongsToOpenProject(action.job.brandProjectId, open) ? studioReducer(store, action) : store;
  }
  if (action.type === "polled") {
    const filtered = filterJobsForScope(action.poll.jobs, open);
    return studioReducer(store, { type: "polled", poll: { ...action.poll, jobs: filtered } });
  }
  return studioReducer(store, action);
}

export type StudioLoadPlan =
  | { load: false }
  | { load: true; options: { brandProject: string } | undefined };

/** Pure request plan for `useStudio`: skips initial load when preloaded for the same scope, otherwise loads once. */
export function planStudioLoad(input: {
  scopeParam: string | undefined;
  preloaded: { done: boolean; scope: string | undefined };
}): StudioLoadPlan {
  if (input.preloaded.done && input.preloaded.scope === input.scopeParam) {
    return { load: false };
  }
  return {
    load: true,
    options: input.scopeParam ? { brandProject: input.scopeParam } : undefined,
  };
}

/** Stale-load guard: only the latest load sequence may commit its result. */
export function isCurrentLoadSeq(latestSeq: number, requestSeq: number): boolean {
  return latestSeq === requestSeq;
}

export type ScopedLoadFailureDecision =
  | { action: "fallback_unfiled" }
  | { action: "dispatch_failed"; code: StudioErrorCode };

/**
 * F7: when a scoped project state load answers `not_found` (project closed elsewhere while the page was open),
 * fall back to 미분류 with the gone notice and reload unfiled.
 */
export function decideScopedLoadFailure(input: {
  spineOpen: OpenProject | null | undefined;
  code: StudioErrorCode;
}): ScopedLoadFailureDecision {
  if (input.spineOpen?.kind === "project" && input.code === "not_found") {
    return { action: "fallback_unfiled" };
  }
  return { action: "dispatch_failed", code: input.code };
}

export function useStudio({
  organizationId,
  initialState,
  api: injected,
  projectId = null,
  spineOpen,
  onProjectGone,
}: {
  organizationId: string;
  initialState?: StudioState | null;
  api?: StudioApi;
  /** The project new runs go into. Sent only while the server says projects are open (`state.projects`). */
  projectId?: string | null;
  /** Brand project spine scope (present only while the spine prop exists). */
  spineOpen?: OpenProject | null;
  /** Called when a scoped load or making request discovers the open project was closed elsewhere (F7, H5). */
  onProjectGone?: (goneId?: string) => void;
}) {
  const api = useMemo(() => injected ?? createStudioApi({ organizationId }), [injected, organizationId]);
  const spineActive = spineOpen !== undefined && spineOpen !== null;
  const scopeParam = spineActive ? queryParamOfOpenProject(spineOpen) : undefined;
  const openScopeRef = useRef<OpenProject | null>(spineActive ? spineOpen : null);
  openScopeRef.current = spineActive ? spineOpen : null;
  // H4: Run the tested `applyScopedStudioAction` directly inside `useReducer` (zero duplicate dispatch logic).
  const [store, dispatch] = useReducer(
    (state: StudioStore, action: StudioAction) => applyScopedStudioAction(state, action, openScopeRef.current),
    initialState ?? null,
    initialStore,
  );
  const projectsOpen = !spineActive && Boolean(store.state?.projects);
  const intoProject = useRef<string | null>(null);
  intoProject.current = projectsOpen ? projectId : null;
  const intoBrandProject = useRef<string | null>(null);
  intoBrandProject.current = spineActive ? brandProjectIdOf(spineOpen) : null;
  const onProjectGoneRef = useRef(onProjectGone);
  onProjectGoneRef.current = onProjectGone;
  const preloadedScope = useRef<{ done: boolean; scope: string | undefined }>({
    done: Boolean(initialState),
    scope: scopeParam,
  });
  const loadSeqRef = useRef(0);
  // The runs this page started (./started-runs.ts): bookkeeping only, it sends nothing.
  const [started] = useState(createStartedRuns);
  const wasStartedHere = started.has;

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    dispatch({ type: "load" });
    const loadOpts = scopeParam ? { brandProject: scopeParam } : undefined;
    let result = await api.loadState(loadOpts);
    // The first request after a quiet period can fail while the server wakes up (seen in production on
    // 2026-11-10: the first load failed, the next one answered in 0.2 s). One quiet second try before
    // showing an error.
    if (isFailure(result) && (result.code === "failed" || result.code === "provider_unavailable")) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (!isCurrentLoadSeq(loadSeqRef.current, seq)) return;
      result = await api.loadState(loadOpts);
    }
    if (!isCurrentLoadSeq(loadSeqRef.current, seq)) return;
    if (isFailure(result)) {
      const decision = decideScopedLoadFailure({ spineOpen: openScopeRef.current, code: result.code });
      if (decision.action === "fallback_unfiled" && onProjectGoneRef.current) {
        onProjectGoneRef.current(openScopeRef.current?.kind === "project" ? openScopeRef.current.id : undefined);
        return;
      }
      dispatch({ type: "loadFailed", code: result.code });
      return;
    }
    dispatch({ type: "loaded", state: result });
  }, [api, scopeParam]);

  useEffect(() => {
    const plan = planStudioLoad({ scopeParam, preloaded: preloadedScope.current });
    if (!plan.load) return;
    preloadedScope.current = { done: false, scope: scopeParam };
    void load();
  }, [load, scopeParam]);

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
    const reload = (event: Event) => {
      started.markAnnounced((event as CustomEvent).detail);
      void load();
    };
    window.addEventListener(STUDIO_JOB_STARTED, reload);
    return () => window.removeEventListener(STUDIO_JOB_STARTED, reload);
  }, [load, started]);

  const createJob = useCallback(
    async (input: StudioJobCreate) => {
      const openProjectId = spineActive ? intoBrandProject.current : null;
      const body = spineActive
        ? jobInputForBrandProject(input, openProjectId)
        : jobInputForProject(input, intoProject.current);
      const result = await api.call("job.create", body);
      if (!isFailure(result)) {
        started.markJobs([result.job]);
        dispatch({ type: "jobAdded", job: result.job });
        return result;
      }
      if (
        openProjectId &&
        onProjectGoneRef.current &&
        (await handleNotFoundForOpenProject({
          code: result.code,
          openProjectId,
          listProjects: () => api.listBrandProjects(),
          onProjectGone: (goneId) => onProjectGoneRef.current?.(goneId),
        }))
      ) {
        return { ...result, projectGone: true as const };
      }
      return result;
    },
    [api, spineActive, started],
  );

  /** One request on several image models: every run lands on the wall at once, or none does. */
  const createGroup = useCallback(
    async (input: StudioJobGroupCreate) => {
      const openProjectId = spineActive ? intoBrandProject.current : null;
      const body = spineActive
        ? groupInputForBrandProject(input, openProjectId)
        : intoProject.current
          ? { ...input, projectId: intoProject.current }
          : input;
      const result = await api.call("job.create_group", body);
      if (!isFailure(result)) {
        started.markJobs(result.jobs);
        for (const job of result.jobs) dispatch({ type: "jobAdded", job });
        return result;
      }
      if (
        openProjectId &&
        onProjectGoneRef.current &&
        (await handleNotFoundForOpenProject({
          code: result.code,
          openProjectId,
          listProjects: () => api.listBrandProjects(),
          onProjectGone: (goneId) => onProjectGoneRef.current?.(goneId),
        }))
      ) {
        return { ...result, projectGone: true as const };
      }
      return result;
    },
    [api, spineActive, started],
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
    const seq = loadSeqRef.current;
    const loadOpts = scopeParam ? { brandProject: scopeParam } : undefined;
    void api.loadState(loadOpts).then((fresh) => {
      if (loadSeqRef.current === seq && !isFailure(fresh)) dispatch({ type: "loaded", state: fresh });
    });
  }, [api, scopeParam]);

  /**
   * Who to tell when this member deletes an asset or a result and the server said yes: the prompt bar drops
   * it (use-dock.ts). Only these explicit deletes count; a reload that no longer lists something never does.
   */
  const deletedListeners = useRef(new Set<(source: RefSource) => void>());
  const onSourceDeleted = useCallback((listener: (source: RefSource) => void) => {
    deletedListeners.current.add(listener);
    return () => {
      deletedListeners.current.delete(listener);
    };
  }, []);
  const notifyDeleted = useCallback((source: RefSource) => {
    for (const listener of deletedListeners.current) listener(source);
  }, []);

  const deleteAsset = useCallback(
    async (assetId: string) => {
      const result = await api.call("asset.delete", { organizationId, assetId });
      if (!isFailure(result)) {
        dispatch({ type: "assetRemoved", id: assetId });
        notifyDeleted({ assetId });
        refreshSilently();
      }
      return result;
    },
    [api, organizationId, refreshSilently, notifyDeleted],
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
        notifyDeleted({ outputId });
        refreshSilently();
      }
      return result;
    },
    [api, organizationId, refreshSilently, notifyDeleted],
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

  /** Remove runs that moved out of the open brand project scope from the wall (§4.6). */
  const removeJobs = useCallback((jobIds: readonly string[]) => {
    for (const jobId of jobIds) dispatch({ type: "jobRemoved", jobId });
  }, []);

  /** Brand project spine `project.move` call (preview or commit, §4.6). */
  const moveToBrandProject = useCallback(
    (input: Parameters<StudioApi["moveToBrandProject"]>[0]) => api.moveToBrandProject(input),
    [api],
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
        const brandProjectId = spineActive ? intoBrandProject.current : null;
        const result = await api.upload(file, {
          requestId: id,
          measure: measureInBrowser,
          ...(options.transient ? { transient: true } : {}),
          ...(brandProjectId ? { brandProjectId } : {}),
        });
        if (!isFailure(result)) {
          dispatch({ type: "assetUpserted", asset: result.asset });
          refreshSilently();
          const assetId = result.asset.id;
          if (result.roleCheck) setAwaitingRoles((current) => ({ ids: [...new Set([...current.ids, assetId])], reads: 0 }));
          return result;
        }
        if (
          brandProjectId &&
          onProjectGoneRef.current &&
          (await handleNotFoundForOpenProject({
            code: result.code,
            openProjectId: brandProjectId,
            listProjects: () => api.listBrandProjects(),
            onProjectGone: (goneId) => onProjectGoneRef.current?.(goneId),
          }))
        ) {
          return { ...result, projectGone: true as const };
        }
        return result;
      } finally {
        setUploads((current) => current.filter((u) => u.id !== id));
      }
    },
    [api, refreshSilently, spineActive],
  );

  return { store, load, wasStartedHere, createJob, createGroup, assignProject, createProject, cancelJob, saveOutput, deleteOutput, deleteJob, removeJobs, moveToBrandProject, updateAsset, deleteAsset, onSourceDeleted, handoff, enhancePrompt, planRevision, talkRevision, readMark, films, analyzeFilm, uploads, upload };
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
