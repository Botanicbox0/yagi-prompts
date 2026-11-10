/**
 * Polling for open jobs (docs/BRAND-STUDIO-V2.md §7): every 3 s while only images are open, every 8 s
 * once a video is open, paused while the tab is hidden, stopped when nothing is open. Each poll also
 * moves the server's open jobs one step forward, so it must not run twice at once.
 *
 * Timers and visibility are injected so the loop is tested without a browser.
 */
import type { StudioJobKind, StudioJobView } from "@/lib/brand-studio/contracts";
import { isOpen } from "./store";

export const POLL_IMAGE_MS = 3_000;
export const POLL_VIDEO_MS = 8_000;
const VIDEO_KINDS: ReadonlySet<StudioJobKind> = new Set(["video", "video_remix", "video_final"]);

export function openJobIds(jobs: readonly StudioJobView[]): string[] {
  return jobs.filter(isOpen).map((job) => job.id);
}

/** Milliseconds until the next poll, or null when no job is open. */
export function pollDelay(jobs: readonly Pick<StudioJobView, "kind" | "status">[]): number | null {
  const open = jobs.filter(isOpen);
  if (!open.length) return null;
  return open.some((job) => VIDEO_KINDS.has(job.kind)) ? POLL_VIDEO_MS : POLL_IMAGE_MS;
}

export interface PollDeps {
  tick(jobIds: string[]): Promise<void>;
  hidden(): boolean;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface PollLoop {
  /** The latest jobs; starts, re-times or stops the loop. */
  update(jobs: readonly StudioJobView[]): void;
  /** Call on `visibilitychange`. */
  visibility(): void;
  stop(): void;
  readonly scheduled: boolean;
}

export function createPollLoop(deps: PollDeps): PollLoop {
  let jobs: readonly StudioJobView[] = [];
  let timer: unknown = null;
  let timerDelay: number | null = null;
  let inFlight = false;
  let stopped = false;

  const clear = () => {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
    timerDelay = null;
  };
  const schedule = () => {
    const delay = pollDelay(jobs);
    if (stopped || inFlight || delay === null || deps.hidden()) return clear();
    if (timer !== null && timerDelay === delay) return;
    clear();
    timerDelay = delay;
    timer = deps.setTimer(fire, delay);
  };
  async function fire() {
    timer = null;
    timerDelay = null;
    const ids = openJobIds(jobs);
    if (stopped || !ids.length || deps.hidden()) return;
    inFlight = true;
    try {
      await deps.tick(ids);
    } catch {
      // A failed poll waits for the next turn; the board keeps what it has.
    } finally {
      inFlight = false;
      schedule();
    }
  }

  return {
    update(next) {
      jobs = next;
      schedule();
    },
    visibility: schedule,
    stop() {
      stopped = true;
      clear();
    },
    get scheduled() {
      return timer !== null;
    },
  };
}
