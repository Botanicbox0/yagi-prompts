/**
 * Pure presentation, paging, deduplication, and request-guard helpers for the R-B archive view
 * (`/brand/library?view=archive`). Zero React or DOM imports.
 */
import type {
  StudioBrandProjectArchive,
  StudioBrandProjectArchiveCard,
  StudioBrandProjectCardCover,
} from "@/lib/brand-studio/contracts";
import { scopedHref } from "@/lib/brands/workspace/selection";
import { studioProjectHref } from "@/components/brand-workspace/home/project-cards/model";
import type { StudioLocale } from "../copy";
import { formatRelativeTime } from "../project-chip/model";

export type ArchiveLoadPhase = "idle" | "loading" | "loading_more" | "ready" | "failed";
export type ArchiveFailedKind = "first" | "more" | null;

export interface ArchiveState {
  phase: ArchiveLoadPhase;
  projects: StudioBrandProjectArchiveCard[];
  next: string | null;
  total: number;
  errorCode: string | null;
  failedKind: ArchiveFailedKind;
}

export type ArchiveAction =
  | { type: "start_first" }
  | { type: "start_more" }
  | { type: "loaded"; mode: "replace" | "append"; page: StudioBrandProjectArchive }
  | { type: "failed"; kind: "first" | "more"; code?: string };

const EMPTY_ARCHIVE_STATE: ArchiveState = {
  phase: "loading",
  projects: [],
  next: null,
  total: 0,
  errorCode: null,
  failedKind: null,
};

function dedupeArchiveRows(
  existing: readonly StudioBrandProjectArchiveCard[],
  incoming: readonly StudioBrandProjectArchiveCard[],
): StudioBrandProjectArchiveCard[] {
  const seen = new Set<string>();
  const out: StudioBrandProjectArchiveCard[] = [];
  for (const row of existing) {
    const key = row.project.id.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(row);
    }
  }
  for (const row of incoming) {
    const key = row.project.id.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

/**
 * Merges a fetched `project.archive` page into `ArchiveState`.
 * On `append`, rows are deduplicated by `project.id` (case-insensitive) keeping the first occurrence because
 * `project.move` out between pages can drop a page-1 project's activity behind the keyset cursor (R-B contract §2.2).
 */
export function mergeArchivePage(
  state: ArchiveState,
  mode: "replace" | "append",
  page: StudioBrandProjectArchive,
): ArchiveState {
  const projects =
    mode === "append"
      ? dedupeArchiveRows(state.projects, page.projects)
      : dedupeArchiveRows([], page.projects);
  return {
    phase: "ready",
    projects,
    next: page.next,
    total: page.total,
    errorCode: null,
    failedKind: null,
  };
}

/** Initial state for `ArchiveView`; optionally seeded synchronously for deterministic SSR tests. */
export function initialArchiveState(seed?: StudioBrandProjectArchive | null): ArchiveState {
  return seed ? mergeArchivePage(EMPTY_ARCHIVE_STATE, "replace", seed) : EMPTY_ARCHIVE_STATE;
}

/** Pure transition reducer for paged `project.archive` loads and searches. */
export function archiveReducer(state: ArchiveState, action: ArchiveAction): ArchiveState {
  switch (action.type) {
    case "start_first":
      return { ...EMPTY_ARCHIVE_STATE };
    case "start_more":
      return state.next !== null
        ? { ...state, phase: "loading_more", errorCode: null, failedKind: null }
        : state;
    case "loaded":
      return mergeArchivePage(state, action.mode, action.page);
    case "failed":
      if (action.kind === "first") {
        return {
          phase: "failed",
          projects: [],
          next: null,
          total: 0,
          errorCode: action.code ?? "failed",
          failedKind: "first",
        };
      }
      return {
        ...state,
        phase: "failed",
        errorCode: action.code ?? "failed",
        failedKind: "more",
      };
  }
}

export interface ArchiveFirstLoadCursor {
  organizationId: string;
  query: string;
  refreshNonce: number;
}

/**
 * Returns `true` only on mount (`prev === null`) or when `organizationId`, committed `query`, or `refreshNonce`
 * changes — preventing redundant requests across equal-props re-renders.
 */
export function shouldReadArchiveFirstPage(
  prev: ArchiveFirstLoadCursor | null,
  next: ArchiveFirstLoadCursor,
): boolean {
  return (
    prev === null ||
    prev.organizationId !== next.organizationId ||
    prev.query !== next.query ||
    prev.refreshNonce !== next.refreshNonce
  );
}

/** Whether an archive row represents a finished project (`selectable === false` or non-open status). */
export function isFinishedArchiveRow(
  row: Pick<StudioBrandProjectArchiveCard, "status" | "selectable">,
): boolean {
  return row.selectable === false || row.status !== "open";
}

/** Whether the row should show the `archiveOpenStudio` action (only selectable projects when studio is open AND member can create). */
export function archiveRowCanOpenStudio(
  row: Pick<StudioBrandProjectArchiveCard, "status" | "selectable">,
  canOpenStudio: boolean,
  canCreate: boolean,
): boolean {
  return canOpenStudio && canCreate && !isFinishedArchiveRow(row);
}

/** Link opening an archive row's files inside `/brand/library` (without `view`). */
export function archiveRowFilesHref(organizationId: string, projectId: string): string {
  const base = scopedHref("/brand/library", organizationId ? { id: organizationId } : null);
  return `${base}${base.includes("?") ? "&" : "?"}project=${encodeURIComponent(projectId)}`;
}

/** Link opening a selectable archive row in the studio (`/brand/studio`), reusing `studioProjectHref`. */
export function archiveRowStudioHref(organizationId: string, projectId: string): string {
  return organizationId
    ? studioProjectHref(organizationId, projectId)
    : `/brand/studio?project=${encodeURIComponent(projectId)}`;
}

export type ArchiveRowCoverThumb =
  | { kind: "image"; src: string }
  | { kind: "video"; url: string }
  | null;

/** Selects the lead cover thumbnail for one archive row (never puts a `.mp4` inside `<img>`). */
export function archiveRowCover(covers: readonly StudioBrandProjectCardCover[]): ArchiveRowCoverThumb {
  const first = covers[0];
  if (!first) return null;
  if (first.kind === "image") return { kind: "image", src: first.thumbUrl ?? first.url };
  if (first.thumbUrl) return { kind: "image", src: first.thumbUrl };
  if (first.url) return { kind: "video", url: first.url };
  return null;
}

const SEOUL_YEAR = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric" });

/**
 * Formats an archive row's activity date in Asia/Seoul:
 * matches existing relative/month-day formatting (`formatRelativeTime`) for dates in the current Seoul year,
 * and includes the Seoul year for earlier years.
 */
export function formatArchiveActivityDate(iso: string, locale: StudioLocale, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (SEOUL_YEAR.format(date) === SEOUL_YEAR.format(now)) {
    return formatRelativeTime(iso, locale, now);
  }
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

/** Parses `?view=archive` on `/brand/library` (absent or anything else -> `null`). */
export function parseLibraryView(raw: string | string[] | undefined): "archive" | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim() === "archive" ? "archive" : null;
}

/** Decides what main body `ArchiveView` renders given current state and active search query. */
export function archiveBodyKind(
  state: Pick<ArchiveState, "phase" | "projects">,
  committedQuery: string,
): "loading_initial" | "failed_initial" | "empty_search" | "empty_none" | "rows" {
  if (state.projects.length > 0) return "rows";
  if (state.phase === "loading") return "loading_initial";
  if (state.phase === "failed") return "failed_initial";
  return committedQuery.trim().length > 0 ? "empty_search" : "empty_none";
}
