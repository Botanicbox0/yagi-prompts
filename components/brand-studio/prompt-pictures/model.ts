import type { StudioJobView } from "@/lib/brand-studio/contracts";

/** Matches server layout (`lib/brand-studio/prompt-shield/layout.ts`): 720 px wide (2x -> up to 360 CSS px), 24 lines max = 1,232 px tall. */
export const PROMPT_PAGE_RULE = {
  width: 720,
  padY: 40,
  lineHeight: 48,
  linesPerPage: 24,
  maxPages: 32,
} as const;

export function pageHeightForLines(lines: number): number {
  return PROMPT_PAGE_RULE.padY * 2 + Math.max(1, lines) * PROMPT_PAGE_RULE.lineHeight;
}

export const PROMPT_PICTURE_MAX_PAGES = PROMPT_PAGE_RULE.maxPages;
export const PROMPT_PICTURE_MAX_WIDTH = PROMPT_PAGE_RULE.width / 2;
export const PROMPT_PICTURE_FULL_HEIGHT = pageHeightForLines(PROMPT_PAGE_RULE.linesPerPage);
export const PROMPT_PICTURE_FULL_ASPECT = `${PROMPT_PAGE_RULE.width} / ${PROMPT_PICTURE_FULL_HEIGHT}`;
export const PROMPT_PICTURE_PLACEHOLDER_HEIGHT = 200;
export const PROMPT_PICTURE_COMPACT_PLACEHOLDER_HEIGHT = 136;

export type SentPromptMode =
  | { kind: "legacy" }
  | { kind: "not_designed" }
  | { kind: "pictures"; jobId: string; pages: number; version: string };

export type PromptPictureSource =
  | { kind: "run"; jobId: string; version: string; pages: number }
  | { kind: "design"; token: string; pages: number };

export type ShieldedDockDesign =
  | { kind: "token"; token: string; pages: number; typed: string; model: string }
  | { kind: "fromJob"; jobId: string; pages: number; version: string; typed: string; model: string };

export type ShieldedDropReason = "typed_changed" | "model_changed" | "kind_changed" | "undo" | "conflict";

export function clampPageCount(pages: number): number {
  if (!Number.isFinite(pages)) return 1;
  return Math.min(PROMPT_PICTURE_MAX_PAGES, Math.max(1, Math.trunc(pages)));
}

export function clampPage(page: number, total: number): number {
  const bound = clampPageCount(total);
  if (!Number.isFinite(page)) return 1;
  return Math.min(bound, Math.max(1, Math.trunc(page)));
}

export function stepPage(current: number, delta: -1 | 1, total: number): number {
  return clampPage(clampPage(current, total) + delta, total);
}

export function pagerState(page: number, total: number) {
  const bound = clampPageCount(total);
  const current = clampPage(page, bound);
  return {
    page: current,
    total: bound,
    showPager: bound > 1,
    canPrev: current > 1,
    canNext: current < bound,
    indicator: `${current} / ${bound}`,
  };
}

export function isKnownFullPage(page: number, total: number): boolean {
  const bound = clampPageCount(total);
  const current = clampPage(page, bound);
  return bound > 1 && current < bound;
}

/**
 * How the viewer shows a run's sent prompt:
 *  - `sent` key absent -> legacy text path (shield closed or non-video run)
 *  - `sent === null` -> not designed
 *  - `sent` object -> picture pages (`jobId:version:page`)
 */
export function sentPromptMode(job: Pick<StudioJobView, "id" | "sent">): SentPromptMode {
  if (!Object.hasOwn(job, "sent") || job.sent === undefined) return { kind: "legacy" };
  if (job.sent === null) return { kind: "not_designed" };
  return {
    kind: "pictures",
    jobId: job.id,
    pages: clampPageCount(job.sent.pages),
    version: job.sent.version,
  };
}

export function pictureScopeKey(source: PromptPictureSource): string {
  return source.kind === "run" ? `${source.jobId}:${source.version}` : `token:${source.token}`;
}

export function pictureCacheKey(source: PromptPictureSource, page: number): string {
  return `${pictureScopeKey(source)}:${clampPage(page, source.pages)}`;
}

export function shieldedDesignOf(enhanced: boolean | ShieldedDockDesign | null | undefined): ShieldedDockDesign | null {
  return typeof enhanced === "object" && enhanced !== null ? enhanced : null;
}

/**
 * Reads a shielded `prompt.enhance` answer (`{ ok: true, shielded: true, token, pages }`).
 * Returns null for failures, fallbacks, or legacy text answers.
 */
export function shieldedDesignFromEnhance(
  answer: unknown,
  ctx: { typed: string; model: string },
): ShieldedDockDesign | null {
  if (!answer || typeof answer !== "object") return null;
  const record = answer as Record<string, unknown>;
  if (record.ok !== true || record.shielded !== true) return null;
  if (record.source === "fallback") return null;
  if (typeof record.token !== "string" || !record.token) return null;
  if (typeof record.pages !== "number" || !Number.isFinite(record.pages) || record.pages < 1) return null;
  return {
    kind: "token",
    token: record.token,
    pages: clampPageCount(record.pages),
    typed: ctx.typed,
    model: ctx.model,
  };
}

/**
 * Restores a reviewed shielded video run as `{ fromJobId }` for reuse without leaking text.
 * Unreviewed video runs return null and fall back to typed words + Architect toggle on.
 */
export function shieldedDesignFromJob(
  job: Pick<StudioJobView, "id" | "kind" | "prompt" | "reviewed" | "sent">,
  model: string,
): ShieldedDockDesign | null {
  if (job.kind !== "video" || !job.reviewed) return null;
  if (!Object.hasOwn(job, "sent") || !job.sent || job.sent.shielded !== true) return null;
  return {
    kind: "fromJob",
    jobId: job.id,
    pages: clampPageCount(job.sent.pages),
    version: job.sent.version,
    typed: job.prompt,
    model,
  };
}

/**
 * Drops a shielded design when the typed text, selected model (normalized catalogue id), or run kind changes in the dock.
 * Only an edit to the typed text carries `typed_changed` so the dock decides whether `designedStale` applies.
 */
export function reconcileShieldedDesign(
  current: ShieldedDockDesign | null,
  next: { prompt: string; model: string; medium: string; remix: boolean },
): { design: ShieldedDockDesign | null; dropped: ShieldedDropReason | null } {
  if (!current) return { design: null, dropped: null };
  if (next.medium !== "video" || next.remix) return { design: null, dropped: "kind_changed" };
  if (next.model !== current.model) return { design: null, dropped: "model_changed" };
  if (next.prompt !== current.typed) return { design: null, dropped: "typed_changed" };
  return { design: current, dropped: null };
}
