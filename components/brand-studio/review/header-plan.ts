/**
 * Which of the stage head's actions shows where (docs/BRAND-ROOMS-FEEDBACK.md §11).
 *
 * One primary action per view, everything else quieter or inside the "⋯" menu:
 *   · the one filled button is 승인하기, for a brand member who may move the status while the draft can still
 *     be approved. Approved, a viewer, a guest: no filled button, and nothing is promoted in its place;
 *   · the YAGI team's pages show no filled button either: approving is the client's call, and the team's own
 *     main act is the reply (the composer's 보내기, the notes panel's primary);
 *   · other status moves and the download are outlined buttons; the link copy, the room's extra actions
 *     ("새 버전 올리기") and the side-by-side view are tools and sit in the menu;
 *   · on a narrow screen the outlined buttons fold into the menu too, so the row is primary + share + "⋯".
 */
import { nextStatuses, type ReviewStatus } from "@/lib/brand-studio/review-contracts";

export type HeaderKey = `status:${ReviewStatus}` | "download" | "copy-link" | "compare" | `extra:${string}`;

export interface HeaderPlan {
  primary: HeaderKey | null;
  secondary: HeaderKey[];
  menu: HeaderKey[];
}

export interface HeaderInput {
  status: ReviewStatus;
  /** May move the status (owners, editors, the team) and the page passed a way to. */
  canSetStatus: boolean;
  /** The YAGI team's own page. */
  team: boolean;
  hasLink: boolean;
  hasDownload: boolean;
  hasCompare: boolean;
  /** Keys of the page's own extra actions, menu-only. */
  extra?: readonly string[];
  narrow?: boolean;
}

export function planHeader(input: HeaderInput): HeaderPlan {
  const moves = input.canSetStatus ? nextStatuses(input.status) : [];
  const primary: HeaderKey | null = !input.team && moves.includes("approved") ? "status:approved" : null;
  const secondary: HeaderKey[] = moves.map((s) => `status:${s}` as HeaderKey).filter((key) => key !== primary);
  if (input.hasDownload) secondary.push("download");
  const menu: HeaderKey[] = [];
  if (input.hasLink) menu.push("copy-link");
  for (const key of input.extra ?? []) menu.push(`extra:${key}`);
  if (input.hasCompare) menu.push("compare");
  if (input.narrow) return { primary, secondary: [], menu: [...secondary, ...menu] };
  return { primary, secondary, menu };
}

/**
 * The notes panel's two icon buttons, with exactly what the row of pills used to hold and for the same
 * viewers: on the room stage once there is a note, "그림 표시만" and (with two or more authors) the author
 * select behind the filter button, and the three exports behind the export button.
 */
export function planNotesTools(input: { extended: boolean; hasNotes: boolean; authorCount: number }): {
  filter: Array<"drawing" | "author">;
  export: Array<"csv" | "markdown" | "markers">;
} {
  if (!input.extended || !input.hasNotes) return { filter: [], export: [] };
  return { filter: input.authorCount > 1 ? ["drawing", "author"] : ["drawing"], export: ["csv", "markdown", "markers"] };
}

/** The player's words the shortcuts list names its actions with (`studioReview.player`). */
export interface ShortcutWords {
  play: string;
  pause: string;
  back: string;
  forward: string;
  backSecond: string;
  forwardSecond: string;
  rangeStart: string;
  rangeEnd: string;
  loop: string;
  fullscreen: string;
  shortcuts: string;
}

/**
 * The "?" popover's rows (keys, separated by spaces · what they do), built from the controls' own words. It
 * replaces the sentence that used to sit under the timeline. Only the keys this stage answers are listed.
 */
export function reviewShortcuts(words: ShortcutWords, on: { isVideo: boolean; extended: boolean; canComment: boolean; fullscreen: boolean }): Array<[string, string]> {
  if (!on.isVideo) return [];
  const rows: Array<[string, string]> = [
    ["Space K", `${words.play} · ${words.pause}`],
    [on.extended ? "← → , ." : "← →", `${words.back} · ${words.forward}`],
    ["J", words.backSecond],
    ["L", words.forwardSecond],
  ];
  if (on.extended && on.canComment) rows.push(["I", words.rangeStart], ["O", words.rangeEnd]);
  if (on.extended) rows.push(["R", words.loop]);
  if (on.fullscreen) rows.push(["F", words.fullscreen]);
  rows.push(["?", words.shortcuts]);
  return rows;
}
