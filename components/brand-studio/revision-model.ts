/**
 * Versions of one generated clip (docs/BRAND-STUDIO-V6-PLAN.md §4), as pure data for the wall and the
 * viewer. A clip is a chain v1, v2, v3 … of runs that share `revision.rootJobId` (v1 is the root run and
 * carries no `revision`). A 1080p final belongs to the version of the draft it finishes. Images never take
 * part: every function here leaves image and partial-edit runs exactly as they came in.
 */
import type { ReviseMark, StudioJobCreate, StudioJobView, StudioOutputView, StudioReference } from "@/lib/brand-studio/contracts";
import { isOpen } from "./store";

const CLIP_KINDS: ReadonlySet<StudioJobView["kind"]> = new Set(["video", "video_remix", "video_final"]);

/** Where one run sits: the chain it belongs to and its version number in it. */
interface Place {
  root: string;
  version: number;
}

/** Root and version of every clip run in `jobs` (images are absent from the map). */
function places(jobs: readonly StudioJobView[]): Map<string, Place> {
  const byOutput = new Map<string, StudioJobView>();
  for (const job of jobs) for (const output of job.outputs) byOutput.set(output.id, job);
  const own = (job: StudioJobView): Place => ({ root: job.revision?.rootJobId ?? job.id, version: job.revision?.version ?? 1 });
  const map = new Map<string, Place>();
  for (const job of jobs) {
    if (!CLIP_KINDS.has(job.kind)) continue;
    if (job.kind === "video_final") {
      // A final takes the place of the draft it finishes; one whose draft is gone stands alone.
      const draft = job.parentOutputId ? byOutput.get(job.parentOutputId) : undefined;
      map.set(job.id, draft && draft.kind !== "video_final" && CLIP_KINDS.has(draft.kind) ? own(draft) : own(job));
    } else map.set(job.id, own(job));
  }
  return map;
}

/** A run counts as the clip's current version while it is being made or has a result to show. */
const alive = (job: StudioJobView) => isOpen(job) || (job.status === "succeeded" && job.outputs.length > 0);

/** Chains by root id; each chain's versions in order, every version with all of its runs (draft and finals). */
export function revisionChains(jobs: readonly StudioJobView[]): Map<string, Array<{ version: number; jobs: StudioJobView[] }>> {
  const at = places(jobs);
  const chains = new Map<string, Map<number, StudioJobView[]>>();
  for (const job of jobs) {
    const place = at.get(job.id);
    if (!place) continue;
    const chain = chains.get(place.root) ?? new Map<number, StudioJobView[]>();
    chains.set(place.root, chain);
    chain.set(place.version, [...(chain.get(place.version) ?? []), job]);
  }
  const out = new Map<string, Array<{ version: number; jobs: StudioJobView[] }>>();
  for (const [root, chain] of chains)
    out.set(
      root,
      [...chain.entries()].sort((a, b) => a[0] - b[0]).map(([version, list]) => ({ version, jobs: list })),
    );
  return out;
}

export interface ChainVersion {
  version: number;
  /** The run that owns `output` (a final when the 1080p result represents the version), else the version's own run. */
  job: StudioJobView;
  /** The result that represents this version; null while it is being made. */
  output: StudioOutputView | null;
  /** What was asked for this version (null for v1). */
  request: string | null;
  /** The spots that request pointed at (its circled digits), in order; empty when none. */
  marks: ReviseMark[];
  /** The question asked about that request and the customer's answer; null when none was asked. */
  clarified: { question: string; answer: string } | null;
  state: "ready" | "making";
}

/** The versions of the clip `job` belongs to, ready or being made, for the viewer's strip. Failed ones are left out. */
export function chainOf(jobs: readonly StudioJobView[], job: StudioJobView): ChainVersion[] {
  const place = places(jobs).get(job.id);
  if (!place) return [];
  const chain = revisionChains(jobs).get(place.root) ?? [];
  const list: ChainVersion[] = [];
  for (const { version, jobs: runs } of chain) {
    const main = runs.find((run) => run.kind !== "video_final") ?? null;
    const final = runs.find((run) => run.kind === "video_final" && run.status === "succeeded" && run.outputs.length > 0) ?? null;
    const request = main?.revision ? main.prompt : null;
    const marks = (main?.revision && main.revision.marks) || [];
    const clarified = main?.revision?.clarified ?? null;
    const shared = { version, request, marks, clarified };
    if (final) list.push({ ...shared, job: final, output: final.outputs[0]!, state: "ready" });
    else if (main && main.status === "succeeded" && main.outputs.length > 0) list.push({ ...shared, job: main, output: main.outputs[0]!, state: "ready" });
    else if (main && isOpen(main)) list.push({ ...shared, job: main, output: null, state: "making" });
  }
  return list;
}

/**
 * What the wall shows: per chain, the newest version still being made or ready (all of its runs), and any
 * failed or stopped versions newer than it so they can be tried again or removed. Older versions are hidden;
 * the viewer's strip reaches them. `keepJobId` keeps that run's version too (the viewer keeps the one it is
 * showing while a newer version comes in). Chains of one version and images come back as they were, and the
 * order is the order given.
 */
export function collapseRevisions(jobs: readonly StudioJobView[], keepJobId?: string | null): StudioJobView[] {
  const at = places(jobs);
  const heads = new Map<string, number>();
  const sizes = new Map<string, Set<number>>();
  for (const job of jobs) {
    const place = at.get(job.id);
    if (!place) continue;
    const seen = sizes.get(place.root) ?? new Set<number>();
    seen.add(place.version);
    sizes.set(place.root, seen);
    if (alive(job)) heads.set(place.root, Math.max(heads.get(place.root) ?? 0, place.version));
  }
  const keep = keepJobId ? at.get(keepJobId) : undefined;
  return jobs.filter((job) => {
    const place = at.get(job.id);
    if (!place || (sizes.get(place.root)?.size ?? 0) < 2) return true;
    if (keep && keep.root === place.root && keep.version === place.version) return true;
    return place.version >= (heads.get(place.root) ?? 0);
  });
}

/** The version `job` is in its clip (1 for a clip of one version), or null for an image run. */
export function versionOf(jobs: readonly StudioJobView[], job: StudioJobView): number | null {
  return places(jobs).get(job.id)?.version ?? null;
}

/** Version number of each clip run whose clip has more than one version (for the `v3` badge). */
export function revisionBadges(jobs: readonly StudioJobView[]): Map<string, number> {
  const at = places(jobs);
  const sizes = new Map<string, Set<number>>();
  for (const place of at.values()) sizes.set(place.root, (sizes.get(place.root) ?? new Set<number>()).add(place.version));
  const badges = new Map<string, number>();
  for (const [jobId, place] of at) if ((sizes.get(place.root)?.size ?? 0) > 1) badges.set(jobId, place.version);
  return badges;
}

/** The version number to show on `job`'s tile, or null when its clip has a single version. */
export function versionBadge(jobs: readonly StudioJobView[], job: StudioJobView): number | null {
  return revisionBadges(jobs).get(job.id) ?? null;
}

/**
 * "다시" on a failed version: the same request again from the same base, with the pictures that were added
 * for it (the trailing `revision.added` references). Null when the run is not a version or its base is gone.
 */
export function reviseRerunInput(job: StudioJobView, ids: { organizationId: string; requestId: string }): StudioJobCreate | null {
  const revision = job.revision;
  if (!revision?.baseOutputId || !job.prompt.trim()) return null;
  const added = revision.added > 0 ? job.references.slice(-revision.added) : [];
  const references: StudioReference[] = added.map(({ frame: _frame, ...ref }) => ref);
  return {
    kind: "video_revise",
    organizationId: ids.organizationId,
    requestId: ids.requestId,
    outputId: revision.baseOutputId,
    mode: revision.mode,
    prompt: job.prompt,
    references,
    marks: revision.marks ?? [],
    // The videos read for that request are read again (they were never among the references).
    materials: (revision.materials ?? []).map((m) => ({ ...m })),
    // What the customer said they meant goes again too: the same request means the same thing.
    ...(revision.clarified ? { clarified: { question: revision.clarified.question, answer: revision.clarified.answer } } : {}),
  };
}
