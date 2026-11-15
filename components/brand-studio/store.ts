/**
 * The studio screen's copy of server state, as a pure reducer. The server owns every value here; the
 * reducer only merges answers (state load, polls, single-operation answers) so the board never
 * flickers back to an older view. Nothing is kept in localStorage.
 */
import {
  STUDIO_JOB_OPEN_STATUSES,
  type StudioAssetView,
  type StudioErrorCode,
  type StudioJobView,
  type StudioJobsPoll,
  type StudioOutputView,
  type StudioState,
} from "@/lib/brand-studio/contracts";

export type StudioStore =
  | { phase: "loading"; state: StudioState | null }
  | { phase: "failed"; code: StudioErrorCode; state: null }
  | { phase: "ready"; state: StudioState };

export type StudioAction =
  | { type: "load" }
  | { type: "loaded"; state: StudioState }
  | { type: "loadFailed"; code: StudioErrorCode }
  | { type: "polled"; poll: StudioJobsPoll }
  | { type: "jobAdded"; job: StudioJobView }
  | { type: "assetUpserted"; asset: StudioAssetView }
  | { type: "assetRemoved"; id: string }
  | { type: "outputSaved"; outputId: string; assetId: string }
  | { type: "outputRemoved"; outputId: string }
  | { type: "jobRemoved"; jobId: string };

export function initialStore(state?: StudioState | null): StudioStore {
  return state ? { phase: "ready", state } : { phase: "loading", state: null };
}

function withState(store: StudioStore, change: (state: StudioState) => StudioState): StudioStore {
  return store.phase === "ready" ? { phase: "ready", state: change(store.state) } : store;
}

/** Newer answers replace jobs by id; jobs the answer does not mention stay where they are. */
export function mergeJobs(current: readonly StudioJobView[], incoming: readonly StudioJobView[]): StudioJobView[] {
  const byId = new Map(incoming.map((job) => [job.id, job]));
  const merged = current.map((job) => byId.get(job.id) ?? job);
  const known = new Set(current.map((job) => job.id));
  const fresh = incoming.filter((job) => !known.has(job.id));
  return [...fresh, ...merged].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export function studioReducer(store: StudioStore, action: StudioAction): StudioStore {
  switch (action.type) {
    case "load":
      return { phase: "loading", state: store.state };
    case "loaded":
      return { phase: "ready", state: action.state };
    case "loadFailed":
      return { phase: "failed", code: action.code, state: null };
    case "polled":
      return withState(store, (s) => ({ ...s, allowance: action.poll.allowance, jobs: mergeJobs(s.jobs, action.poll.jobs) }));
    case "jobAdded":
      return withState(store, (s) => ({ ...s, jobs: mergeJobs(s.jobs, [action.job]) }));
    case "assetUpserted":
      return withState(store, (s) => ({
        ...s,
        assets: s.assets.some((a) => a.id === action.asset.id)
          ? s.assets.map((a) => (a.id === action.asset.id ? action.asset : a))
          : [action.asset, ...s.assets],
      }));
    case "assetRemoved":
      return withState(store, (s) => ({ ...s, assets: s.assets.filter((a) => a.id !== action.id) }));
    case "outputSaved":
      return withState(store, (s) => ({
        ...s,
        jobs: s.jobs.map((job) =>
          job.outputs.some((o) => o.id === action.outputId)
            ? { ...job, outputs: job.outputs.map((o) => (o.id === action.outputId ? { ...o, savedAssetId: action.assetId } : o)) }
            : job,
        ),
      }));
    case "jobRemoved":
      return withState(store, (s) => ({ ...s, jobs: s.jobs.filter((job) => job.id !== action.jobId) }));
    case "outputRemoved":
      return withState(store, (s) => ({
        ...s,
        jobs: s.jobs.map((job) =>
          job.outputs.some((o) => o.id === action.outputId) ? { ...job, outputs: job.outputs.filter((o) => o.id !== action.outputId) } : job,
        ),
      }));
  }
}

export function isOpen(job: Pick<StudioJobView, "status">): boolean {
  return STUDIO_JOB_OPEN_STATUSES.includes(job.status);
}

/** Every result on the board in board order (newest job first), with its job. */
export function boardOutputs(jobs: readonly StudioJobView[]): Array<{ output: StudioOutputView; job: StudioJobView }> {
  return jobs.flatMap((job) => job.outputs.map((output) => ({ output, job })));
}

export function findOutput(jobs: readonly StudioJobView[], outputId: string | null | undefined): StudioOutputView | null {
  if (!outputId) return null;
  for (const job of jobs) for (const output of job.outputs) if (output.id === outputId) return output;
  return null;
}

/* ------------------------------------------------- "빈 곳 채우기" (internal runs) */

/**
 * The runs a screen lists or takes results from: never the internal strips of "빈 곳 채우기" (`purpose:
 * 'fill'`). The layer editor's `region.jobs` keeps the full list so its strips still arrive as layers.
 */
export function listedJobs<T extends Pick<StudioJobView, "purpose">>(jobs: readonly T[]): T[] {
  // The same array when there is nothing to leave out (memoised lists keep their identity).
  return jobs.some((job) => job.purpose === "fill") ? jobs.filter((job) => job.purpose !== "fill") : (jobs as T[]);
}

/**
 * Pictures uploaded for "빈 곳 채우기" whose runs have all settled (succeeded, failed or stopped), so the
 * picture can be deleted: no run reads it any more. `tracked` maps each picture to the runs started on it;
 * a run not seen in `jobs` yet counts as open.
 */
export function fillSourcesToDelete(tracked: ReadonlyMap<string, readonly string[]>, jobs: readonly Pick<StudioJobView, "id" | "status">[]): string[] {
  const open = new Set<string>(STUDIO_JOB_OPEN_STATUSES);
  const out: string[] = [];
  for (const [assetId, jobIds] of tracked) {
    const settled = jobIds.every((id) => {
      const hit = jobs.find((j) => j.id === id);
      return Boolean(hit) && !open.has(hit!.status);
    });
    if (settled) out.push(assetId);
  }
  return out;
}
