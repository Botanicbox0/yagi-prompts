/**
 * Which landed runs the video workspace puts into the sequence on its own (a clip, or a take stacked on the clip
 * that was selected when the run appeared). Adding a clip saves the film and, with no film yet, creates one, so
 * this decides whether the page writes a film the member never asked for.
 *
 * - Without the brand project spine (`startedHere` absent): main's rule, unchanged. The first list seeds what is
 *   known; any run id that appears in a later list counts as made in this session.
 * - With the spine (`startedHere` and `open` given): only a run this page started (its create answer, or the id
 *   the reverse panel announced) and only while it belongs to the open scope. A run that merely arrives in a list
 *   (the other scope after a chip switch, another member, another tab, a reload) is never added. A started run
 *   joins only the film it was started for (`film`); otherwise, or when it ends with nothing, it is dropped and
 *   stays on the wall, from where the member can add it by hand.
 */
import { STUDIO_JOB_OPEN_STATUSES, type StudioJobView, type StudioOutputView } from "@/lib/brand-studio/contracts";
import { belongsToOpenProject, type OpenProject } from "@/lib/brand-studio/open-project";

/**
 * The film on screen (spine only): its id (null: none yet), the workspace's film context (bumped when another
 * film is opened, a new one started, this one deleted, or the chip clears it), and whether a lazy create is on
 * its way (it answers in the same context).
 */
export interface SessionRunFilm {
  id: string | null;
  context: number;
  creating: boolean;
}

export interface SessionRunBook {
  /** Run ids seen so far; null until the first list (main's seed). */
  known: Set<string> | null;
  /** Session runs not added yet, with the clip selected when each appeared (null: append a new clip). */
  targets: Map<string, string | null>;
  /** Output ids already in the sequence or present in the first list. */
  ingested: Set<string>;
  /** Spine: started runs already given a target (so one that was listed before it was marked still counts once). */
  claimed: Set<string>;
  /** Spine: the film open (or being created) when each run was claimed. */
  claimedFilm: Map<string, { id: string | null; context: number }>;
}

export function createSessionRunBook(): SessionRunBook {
  return { known: null, targets: new Map(), ingested: new Set(), claimed: new Set(), claimedFilm: new Map() };
}

const OPEN_STATUSES: ReadonlySet<string> = new Set(STUDIO_JOB_OPEN_STATUSES);

/**
 * Spine: whether a landed run joins the film on screen now. Only the film that was open when the run was claimed,
 * or, claimed with no film yet, the film the create of that same context answered with. Anything else (the film
 * left the screen, the create failed or was not adopted) drops it for good: a landed run never makes a film.
 */
function landedRunVerdict(at: { id: string | null; context: number } | undefined, now: SessionRunFilm): "add" | "wait" | "drop" {
  if (!at || at.context !== now.context) return "drop";
  if (at.id !== null) return now.id === at.id ? "add" : "drop";
  if (now.id !== null) return "add";
  return now.creating ? "wait" : "drop";
}

export interface SessionRunAdd {
  jobId: string;
  output: StudioOutputView;
  label: string;
  stackIntoClipId: string | null;
}

type ListedRun = Pick<StudioJobView, "id" | "status" | "outputs" | "prompt" | "brandProjectId">;

/**
 * Reads the current list into `book` (mutated) and returns the outputs to add now, in list order. Call it with
 * every new list; the caller adds each with `addVideoOutputToSequence(output, label, { stackIntoClipId })`.
 */
export function collectSessionRunAdds(
  book: SessionRunBook,
  input: {
    jobs: readonly ListedRun[];
    selectedClipId: string | null;
    /** The label of a run without a prompt (the untitled film name). */
    untitled: string;
    /** Spine only: whether this page started the run (../started-runs.ts). */
    startedHere?: (jobId: string) => boolean;
    /** Spine only: the scope on screen. */
    open?: OpenProject;
    /** Spine only: the film on screen; with it, a landed run joins only the film it was started for. */
    film?: SessionRunFilm;
  },
): SessionRunAdd[] {
  const { jobs, selectedClipId, untitled, startedHere, open, film } = input;
  const drop = (jobId: string) => {
    book.targets.delete(jobId);
    book.claimedFilm.delete(jobId);
  };
  if (book.known === null) {
    book.known = new Set(jobs.map((j) => j.id));
    for (const j of jobs) for (const o of j.outputs) book.ingested.add(o.id);
    // Spine: a run this page started can already be in the first list it reads (never in main's).
    if (!startedHere) return [];
  }

  const adds: SessionRunAdd[] = [];
  for (const j of jobs) {
    if (startedHere) {
      book.known.add(j.id);
      if (!book.claimed.has(j.id) && startedHere(j.id)) {
        book.claimed.add(j.id);
        if (!book.targets.has(j.id)) book.targets.set(j.id, selectedClipId);
        if (film) book.claimedFilm.set(j.id, { id: film.id, context: film.context });
      }
      if (!book.targets.has(j.id)) continue;
      // Never into this scope's film from another scope (the run stays waiting for its own scope).
      if (open && !belongsToOpenProject(j.brandProjectId, open)) continue;
      if (!(j.status === "succeeded" && j.outputs.length > 0)) {
        // Ended with nothing to add (failed, stopped, refused, empty): nothing waits for it any more.
        if (!OPEN_STATUSES.has(j.status)) drop(j.id);
        continue;
      }
      if (film) {
        const verdict = landedRunVerdict(book.claimedFilm.get(j.id), film);
        if (verdict === "wait") continue;
        if (verdict === "drop") {
          drop(j.id);
          continue;
        }
      }
    } else if (!book.known.has(j.id)) {
      book.known.add(j.id);
      if (!book.targets.has(j.id)) book.targets.set(j.id, selectedClipId);
    }

    if (book.targets.has(j.id) && j.status === "succeeded" && j.outputs.length > 0) {
      const stackIntoClipId = book.targets.get(j.id) ?? null;
      for (const out of j.outputs) {
        if (out.kind === "video" && !book.ingested.has(out.id)) {
          book.ingested.add(out.id);
          adds.push({ jobId: j.id, output: out, label: j.prompt || untitled, stackIntoClipId });
        }
      }
      book.targets.delete(j.id);
      book.claimedFilm.delete(j.id);
    }
  }
  return adds;
}
