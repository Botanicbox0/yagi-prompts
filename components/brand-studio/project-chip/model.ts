/**
 * Pure helpers for the studio header project chip and picker (docs/BRAND-PROJECT-SPINE.md §4.5, slice 1b).
 * No React or DOM imports so every rule is unit-tested directly.
 */
import {
  BRAND_PROJECT_LIMITS,
  type StudioBrandProject,
  type StudioBrandProjectMoved,
  type StudioErrorCode,
  type StudioFailure,
} from "@/lib/brand-studio/contracts";
import { belongsToOpenProject, type OpenProject } from "@/lib/brand-studio/open-project";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { fill, type StudioLocale } from "../copy";

export type ProjectSpineCopy = Dictionary["projectSpine"];

/** 6 or more projects turns on the search field and the scrolling list (§4.2). */
export const PROJECT_SEARCH_THRESHOLD = 6;

/** Image cover uses `thumbUrl ?? url`; video cover uses its still `thumbUrl` only (never a `.mp4` in `<img>`). */
export function projectCoverThumb(project: Pick<StudioBrandProject, "cover">): string | null {
  if (!project.cover) return null;
  if (project.cover.kind === "image") return project.cover.thumbUrl ?? project.cover.url;
  return project.cover.thumbUrl ?? null;
}

/** Browser-side title filter (case-insensitive substring). */
export function filterProjects<T extends Pick<StudioBrandProject, "title">>(projects: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...projects];
  return projects.filter((p) => p.title.toLowerCase().includes(needle));
}

/**
 * Relative activity stamp ("2시간 전", "어제", "11월 21일" / "2 hours ago", "yesterday", "Nov 21").
 * Uses `Intl.RelativeTimeFormat` within 6 days and a short Seoul date beyond that.
 */
export function formatRelativeTime(iso: string, locale: StudioLocale, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = date.getTime() - now.getTime();
  const absSec = Math.abs(diffMs) / 1000;
  const tag = locale === "ko" ? "ko-KR" : "en-US";
  const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });

  if (absSec < 60) return rtf.format(0, "minute");
  if (absSec < 3600) return rtf.format(Math.round(diffMs / 60_000), "minute");
  if (absSec < 86_400) return rtf.format(Math.round(diffMs / 3_600_000), "hour");
  const days = Math.round(diffMs / 86_400_000);
  if (Math.abs(days) <= 6) return rtf.format(days, "day");
  return new Intl.DateTimeFormat(tag, { month: "short", day: "numeric", timeZone: "Asia/Seoul" }).format(date);
}

/** Second line of a project row: `pickerLast`, prefixed with `pickerTeamTag` for YAGI team projects. */
export function projectSecondLine(
  project: Pick<StudioBrandProject, "origin" | "lastActivityAt">,
  copy: Pick<ProjectSpineCopy, "pickerLast" | "pickerTeamTag">,
  locale: StudioLocale,
  now = new Date(),
): string {
  const when = formatRelativeTime(project.lastActivityAt, locale, now);
  const last = when ? fill(copy.pickerLast, { when }) : "";
  if (project.origin === "team") {
    return last ? `${copy.pickerTeamTag} · ${last}` : copy.pickerTeamTag;
  }
  return last;
}

/** `project.create` error message: `too_many_running` gets the dedicated daily-limit string, never the generic one. */
export function createProjectErrorLine(
  code: string | null | undefined,
  copy: Pick<ProjectSpineCopy, "createLimit" | "createFailed">,
): string {
  return code === "too_many_running" ? copy.createLimit : copy.createFailed;
}

/** Keyboard cursor movement across a list of `count` items (`ArrowDown`, `ArrowUp`, `Home`, `End`). */
export function nextListIndex(current: number, key: string, count: number): number {
  if (count <= 0) return -1;
  switch (key) {
    case "ArrowDown":
      return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp":
      return current <= 0 ? count - 1 : current - 1;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return current;
  }
}

export interface PickerKeyState {
  creating: boolean;
  activeIndex: number;
  entryCount: number;
  inSearchInput: boolean;
  searchHasText: boolean;
  visibleProjectCount: number;
  newRowIndex: number | null;
}

export type PickerKeyAction =
  | { type: "none" }
  | { type: "exit_create"; focusIndex: number | null }
  | { type: "close_picker" }
  | { type: "move"; nextIndex: number }
  | { type: "activate"; index: number };

/**
 * Pure keyboard state machine for `ProjectPicker` (F4 & F6):
 * - Escape from anywhere in the create form exits back to the list and focuses the new-project row.
 * - Escape in the list closes the popover and returns focus to the chip.
 * - Enter in the search field is ignored when the search text matches zero projects (never selects 미분류).
 */
export function handlePickerKey(state: PickerKeyState, key: string): PickerKeyAction {
  if (key === "Escape") {
    return state.creating
      ? { type: "exit_create", focusIndex: state.newRowIndex }
      : { type: "close_picker" };
  }
  if (state.creating) return { type: "none" };

  if (key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") {
    if ((key === "Home" || key === "End") && state.inSearchInput) return { type: "none" };
    const nextIndex = nextListIndex(state.activeIndex, key, state.entryCount);
    return nextIndex >= 0 ? { type: "move", nextIndex } : { type: "none" };
  }

  if (key === "Enter" && state.inSearchInput) {
    if (state.searchHasText && state.visibleProjectCount === 0) return { type: "none" };
    if (state.activeIndex >= 0 && state.activeIndex < state.entryCount) {
      return { type: "activate", index: state.activeIndex };
    }
  }

  return { type: "none" };
}

export type BrandProjectCreateAnswer =
  | { ok: true; project: StudioBrandProject }
  | { ok: false; code: StudioErrorCode };

export type BrandProjectCreateOutcome =
  | { ok: true; project: StudioBrandProject }
  | { ok: false; ignored: true }
  | { ok: false; error: string };

/**
 * Plain async controller for the inline new-project create flow (F8.6):
 * - Allocates one `requestId` per opened form session; ignores concurrent double-submits and reuses the
 *   same `requestId` on retries after failure.
 * - Maps `too_many_running` -> `copy.createLimit`, any other failure -> `copy.createFailed`.
 * - On success, puts the created project first in `projects`, opens it, and clears `requestId`.
 */
export function createBrandProjectController(opts: {
  initialProjects: readonly StudioBrandProject[];
  initialOpen?: OpenProject;
  copy: Pick<ProjectSpineCopy, "createLimit" | "createFailed">;
  create: (input: { title: string; requestId: string }) => Promise<BrandProjectCreateAnswer>;
  makeRequestId?: () => string;
}) {
  const makeId = opts.makeRequestId ?? (() => crypto.randomUUID());
  let projects: StudioBrandProject[] = [...opts.initialProjects];
  let open: OpenProject = opts.initialOpen ?? { kind: "unfiled" };
  let requestId: string | null = null;
  let submitting = false;

  return {
    getState: () => ({ projects, open, submitting, requestId }),
    resetForm: () => {
      requestId = null;
    },
    submit: async (rawTitle: string): Promise<BrandProjectCreateOutcome> => {
      const title = rawTitle.trim();
      if (!title || submitting) return { ok: false, ignored: true };
      if (!requestId) requestId = makeId();
      submitting = true;
      try {
        const answer = await opts.create({ title, requestId });
        if (!answer.ok) {
          return { ok: false, error: createProjectErrorLine(answer.code, opts.copy) };
        }
        projects = [answer.project, ...projects.filter((p) => p.id !== answer.project.id)];
        open = { kind: "project", id: answer.project.id };
        requestId = null;
        return { ok: true, project: answer.project };
      } finally {
        submitting = false;
      }
    },
  };
}

/** Deduplicate job ids in order and cap at `BRAND_PROJECT_LIMITS.moveMax` (200, §4.6). */
export function collectMoveJobIds(
  jobIds: readonly string[],
  limit = BRAND_PROJECT_LIMITS.moveMax,
): { jobIds: string[]; totalUnique: number; overLimit: boolean } {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of jobIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return {
    jobIds: unique.slice(0, limit),
    totalUnique: unique.length,
    overLimit: unique.length > limit,
  };
}

/** Deduplicate mixed runs, library assets, and films against the combined `BRAND_PROJECT_LIMITS.moveMax` (200) limit. */
export function collectMoveTargets(
  targets: {
    jobIds?: readonly string[];
    assetIds?: readonly string[];
    filmIds?: readonly string[];
  },
  limit = BRAND_PROJECT_LIMITS.moveMax,
): { jobIds: string[]; assetIds: string[]; filmIds: string[]; totalUnique: number; overLimit: boolean } {
  const dedup = (ids: readonly string[] = []) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of ids) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  };
  const jobIds = dedup(targets.jobIds);
  const assetIds = dedup(targets.assetIds);
  const filmIds = dedup(targets.filmIds);
  const totalUnique = jobIds.length + assetIds.length + filmIds.length;
  return {
    jobIds: jobIds.slice(0, limit),
    assetIds: assetIds.slice(0, Math.max(0, limit - jobIds.length)),
    filmIds: filmIds.slice(0, Math.max(0, limit - jobIds.length - assetIds.length)),
    totalUnique,
    overLimit: totalUnique > limit,
  };
}

/**
 * Family-size line of MoveToProjectDialog (§4.6): shown only when MORE runs will move than were chosen (results
 * made together and their versions come along). Moving exactly what was chosen needs no line.
 */
export function moveFamilyLine(
  familyCount: number | null | undefined,
  copy: Pick<ProjectSpineCopy, "moveFamily">,
  chosenCount = 1,
): string | null {
  if (!familyCount || familyCount <= Math.max(1, chosenCount)) return null;
  return fill(copy.moveFamily, { n: familyCount });
}

/** Toast message after a successful `project.move` (§4.6). */
export function moveDoneToast(
  projectId: string | null,
  projects: readonly Pick<StudioBrandProject, "id" | "title">[],
  copy: Pick<ProjectSpineCopy, "moveDone" | "moveDoneUnfiled">,
): string {
  if (!projectId) return copy.moveDoneUnfiled;
  const hit = projects.find((p) => p.id.toLowerCase() === projectId.toLowerCase());
  return fill(copy.moveDone, { name: hit?.title ?? "" });
}

export type MoveDialogScope = OpenProject | { kind: "brand_materials" } | { kind: "unknown" };

/** Which moved runs leave the currently displayed wall (all moved ids when destination != open scope). */
export function movedJobsLeavingScope(
  movedJobIds: readonly string[],
  targetProjectId: string | null,
  openScope: MoveDialogScope,
): string[] {
  if (openScope.kind === "brand_materials" || openScope.kind === "unknown") {
    return targetProjectId === null ? [] : [...movedJobIds];
  }
  return belongsToOpenProject(targetProjectId, openScope) ? [] : [...movedJobIds];
}

/**
 * Stable content key for memoising `createMoveToProjectController` (Fix 3-1):
 * keyed on the scope key and id sequences so wrapper arrays/objects with equal contents
 * never rebuild the controller or re-fire `preview: true` on parent re-renders.
 */
export function moveControllerContentKey(input: {
  jobIds: readonly string[];
  assetIds?: readonly string[];
  filmIds?: readonly string[];
  openScope: MoveDialogScope;
}): string {
  const scopeKey =
    input.openScope.kind === "project"
      ? `project:${input.openScope.id.toLowerCase()}`
      : input.openScope.kind;
  return `${scopeKey}|${input.jobIds.join(",")}|${(input.assetIds ?? []).join(",")}|${(input.filmIds ?? []).join(",")}`;
}

export type MoveApiFn = (input: {
  projectId: string | null;
  jobIds?: string[];
  assetIds?: string[];
  filmIds?: string[];
  preview?: boolean;
}) => Promise<StudioBrandProjectMoved | StudioFailure>;

export type MoveSubmitOutcome =
  | { ok: true; projectId: string | null; toast: string; removedJobIds: string[] }
  | { ok: false; ignored: true }
  | { ok: false; error: string };

/**
 * Plain async controller for MoveToProjectDialog (§4.6 & slice 2b §5.5):
 * - Sequence-guards `preview: true` calls so late responses from an earlier target never overwrite the count.
 * - Guards against double-submit and computes the toast + wall removals from the returned moved family.
 */
export function createMoveToProjectController(opts: {
  jobIds: readonly string[];
  assetIds?: readonly string[];
  filmIds?: readonly string[];
  projects: readonly Pick<StudioBrandProject, "id" | "title">[];
  openScope: MoveDialogScope;
  copy: Pick<ProjectSpineCopy, "moveDone" | "moveDoneUnfiled" | "moveFailed">;
  move: MoveApiFn;
}) {
  const collected = collectMoveTargets({
    jobIds: opts.jobIds,
    assetIds: opts.assetIds,
    filmIds: opts.filmIds,
  });
  const payloadIds = () => ({
    ...(collected.jobIds.length > 0 ? { jobIds: collected.jobIds } : {}),
    ...(collected.assetIds.length > 0 ? { assetIds: collected.assetIds } : {}),
    ...(collected.filmIds.length > 0 ? { filmIds: collected.filmIds } : {}),
  });
  let previewSeq = 0;
  let familyCount: number | null = null;
  let submitting = false;

  return {
    getState: () => ({ jobIds: collected.jobIds, familyCount, submitting, overLimit: collected.overLimit }),
    preview: async (targetProjectId: string | null): Promise<{ familyCount: number | null } | { stale: true }> => {
      const seq = ++previewSeq;
      if (collected.totalUnique === 0 || collected.overLimit) {
        familyCount = 0;
        return { familyCount: 0 };
      }
      const answer = await opts.move({ projectId: targetProjectId, ...payloadIds(), preview: true });
      if (seq !== previewSeq) return { stale: true };
      familyCount = answer.ok ? answer.jobIds.length : null;
      return { familyCount };
    },
    submit: async (targetProjectId: string | null): Promise<MoveSubmitOutcome> => {
      if (
        submitting ||
        collected.totalUnique === 0 ||
        collected.overLimit ||
        (opts.openScope.kind === "brand_materials" && targetProjectId === null)
      ) {
        return { ok: false, ignored: true };
      }
      submitting = true;
      try {
        const answer = await opts.move({ projectId: targetProjectId, ...payloadIds() });
        if (!answer.ok) return { ok: false, error: opts.copy.moveFailed };
        return {
          ok: true,
          projectId: answer.projectId,
          toast: moveDoneToast(answer.projectId, opts.projects, opts.copy),
          removedJobIds: movedJobsLeavingScope(answer.jobIds, answer.projectId, opts.openScope),
        };
      } finally {
        submitting = false;
      }
    },
  };
}

/** H5: Removes a project that was closed elsewhere from the picker list (case-insensitive id match). */
export function removeProjectFromList<T extends Pick<StudioBrandProject, "id">>(
  projects: readonly T[],
  goneId: string | null | undefined,
): T[] {
  if (!goneId) return [...projects];
  const needle = goneId.toLowerCase();
  return projects.filter((item) => item.id.toLowerCase() !== needle);
}

/**
 * H5: When a making request (`job.create`, `job.create_group`, upload, film create, music) answers `not_found`
 * while a brand project is open, ask `project.list` once. If the open project is no longer listed, it was closed
 * elsewhere: call `onProjectGone(openProjectId)` (switches to 미분류, removes it from the list, shows goneNotice)
 * and return `true` so the caller keeps the draft and suppresses the generic error.
 */
export async function handleNotFoundForOpenProject(input: {
  code: string | null | undefined;
  openProjectId: string | null | undefined;
  listProjects: () => Promise<{ ok: true; projects: readonly Pick<StudioBrandProject, "id">[] } | { ok: false }>;
  onProjectGone: (goneProjectId: string) => void;
}): Promise<boolean> {
  if (input.code !== "not_found" || !input.openProjectId) return false;
  const listed = await input.listProjects().catch(() => ({ ok: false as const }));
  if (!listed.ok) return false;
  const stillThere = listed.projects.some(
    (project) => project.id.toLowerCase() === input.openProjectId!.toLowerCase(),
  );
  if (stillThere) return false;
  input.onProjectGone(input.openProjectId);
  return true;
}
