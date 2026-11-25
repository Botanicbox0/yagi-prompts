/**
 * The runs this page started: the answers of its own `job.create` / `job.create_group` calls and the ids a panel
 * on this page announces with `STUDIO_JOB_STARTED` (the reverse panel calls the server itself). A run that only
 * shows up in a list read later (another scope, another member, another tab, a reload) is not one of them.
 *
 * Plain bookkeeping, no requests: `useStudio` keeps one per page and the video workspace asks it before it puts a
 * landed run into the sequence (./video/session-runs.ts).
 */
export interface StartedRuns {
  /** Mark runs a create call of this page answered with. */
  markJobs(jobs: readonly { id: string }[]): void;
  /** Mark the run a `STUDIO_JOB_STARTED` event names (`detail.jobId`); anything else is ignored. */
  markAnnounced(detail: unknown): void;
  /** Whether this page started the run. Stable function, safe to pass around. */
  has(jobId: string): boolean;
}

export function createStartedRuns(): StartedRuns {
  const ids = new Set<string>();
  return {
    markJobs(jobs) {
      for (const job of jobs) if (typeof job.id === "string" && job.id) ids.add(job.id);
    },
    markAnnounced(detail) {
      const jobId = detail && typeof detail === "object" ? (detail as { jobId?: unknown }).jobId : undefined;
      if (typeof jobId === "string" && jobId) ids.add(jobId);
    },
    has: (jobId) => ids.has(jobId),
  };
}
