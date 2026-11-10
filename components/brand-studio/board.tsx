/**
 * What the gallery wall (./gallery/wall.tsx) knows about runs, kept apart from its markup: which runs a
 * screen lists, the shape a result or a pending place takes, and when a run may still be stopped.
 * (Until v3 this file was the board itself; the wall replaced its layout, docs/BRAND-STUDIO-V3.md §4.)
 */
import type { StudioJobKind, StudioJobView, StudioOutputView } from "@/lib/brand-studio/contracts";
import type { StudioMedium } from "@/lib/brand-studio/models";

export function ratioOf(aspect: string | null | undefined): string | null {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect ?? "");
  return match ? `${match[1]} / ${match[2]}` : null;
}

/** "3 / 4" -> 0.75; anything unreadable is a square. */
export function ratioNumber(ratio: string): number {
  const match = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/.exec(ratio);
  const value = match ? Number(match[1]) / Number(match[2]) : 1;
  return Number.isFinite(value) && value > 0 ? Math.min(4, Math.max(0.25, value)) : 1;
}

/** The place a pending result takes: the run's ratio, else its source picture's, else a square. */
export function slotRatio(job: Pick<StudioJobView, "aspect">, parent: Pick<StudioOutputView, "width" | "height"> | null): string {
  return ratioOf(job.aspect) ?? (parent?.width && parent.height ? `${parent.width} / ${parent.height}` : "1 / 1");
}

export function outputRatio(output: StudioOutputView, job: StudioJobView, parent: Pick<StudioOutputView, "width" | "height"> | null): string {
  return output.width && output.height ? `${output.width} / ${output.height}` : slotRatio(job, parent);
}

/** Example sentences for an empty screen, per medium. */
export const EXAMPLES: Readonly<Record<StudioMedium, ReadonlyArray<"one" | "two" | "three">>> = {
  image: ["one", "two"],
  video: ["three"],
};

/** A run can be stopped only before anything reached the maker (the server says so when it has). */
export const canCancel = (job: Pick<StudioJobView, "status">) => job.status === "held" || job.status === "queued";

const KINDS: Readonly<Record<StudioMedium, ReadonlySet<StudioJobKind>>> = {
  image: new Set(["image", "region_edit"]),
  video: new Set(["video", "video_remix", "video_final"]),
};

/** The medium a run belongs to. */
export function jobMedium(job: Pick<StudioJobView, "kind">): StudioMedium {
  return KINDS.image.has(job.kind) ? "image" : "video";
}

/** The runs a screen lists: the image screen only pictures and partial edits, the video screen only video. */
export function jobsFor<T extends Pick<StudioJobView, "kind">>(jobs: readonly T[], mode: StudioMedium): T[] {
  return jobs.filter((job) => KINDS[mode].has(job.kind));
}
