import { describe, expect, it } from "vitest";
import { planHeader, planNotesTools, reviewShortcuts } from "@/components/brand-studio/review/header-plan";
import { REVIEW_STATUSES } from "@/lib/brand-studio/review-contracts";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §11 — one primary action per view. 승인하기 is the only filled button, for a
 * brand member who may still approve; nothing is promoted in its place. The menus hold what the old rows held.
 */
const base = { hasLink: true, hasDownload: false, hasCompare: false, team: false };

describe("the stage head", () => {
  it("has at most one filled primary for every role and state", () => {
    for (const status of REVIEW_STATUSES) {
      for (const canSetStatus of [true, false]) {
        for (const team of [true, false]) {
          for (const narrow of [true, false]) {
            const plan = planHeader({ ...base, status, canSetStatus, team, narrow, hasDownload: status === "approved" });
            const primaries = [plan.primary].filter(Boolean);
            expect(primaries.length).toBeLessThanOrEqual(1);
            if (plan.primary) expect(plan.primary).toBe("status:approved");
          }
        }
      }
    }
  });

  it("gives an owner or editor 승인하기 as the primary and 수정 요청 outlined, the link copy and new version in the menu", () => {
    const plan = planHeader({ ...base, status: "open", canSetStatus: true, hasCompare: true, extra: ["new-version"] });
    expect(plan).toEqual({ primary: "status:approved", secondary: ["status:changes_requested"], menu: ["copy-link", "extra:new-version", "compare"] });
  });

  it("promotes nothing once approved, for a viewer, a guest, or the team", () => {
    expect(planHeader({ ...base, status: "approved", canSetStatus: true, hasDownload: true })).toEqual({ primary: null, secondary: ["status:open", "download"], menu: ["copy-link"] });
    expect(planHeader({ ...base, status: "open", canSetStatus: false })).toEqual({ primary: null, secondary: [], menu: ["copy-link"] });
    expect(planHeader({ ...base, hasLink: false, status: "open", canSetStatus: false, hasDownload: true })).toEqual({ primary: null, secondary: ["download"], menu: [] });
    expect(planHeader({ ...base, status: "changes_requested", canSetStatus: true, team: true })).toEqual({ primary: null, secondary: ["status:approved", "status:open"], menu: ["copy-link"] });
  });

  it("folds the outlined actions into the menu on a phone", () => {
    expect(planHeader({ ...base, status: "open", canSetStatus: true, narrow: true, extra: ["new-version"] })).toEqual({
      primary: "status:approved",
      secondary: [],
      menu: ["status:changes_requested", "copy-link", "extra:new-version"],
    });
  });
});

describe("the notes panel's two buttons", () => {
  it("hold exactly what the row of pills held, for the same viewers", () => {
    expect(planNotesTools({ extended: true, hasNotes: true, authorCount: 3 })).toEqual({ filter: ["drawing", "author"], export: ["csv", "markdown", "markers"] });
    expect(planNotesTools({ extended: true, hasNotes: true, authorCount: 1 })).toEqual({ filter: ["drawing"], export: ["csv", "markdown", "markers"] });
    expect(planNotesTools({ extended: true, hasNotes: false, authorCount: 0 })).toEqual({ filter: [], export: [] });
    expect(planNotesTools({ extended: false, hasNotes: true, authorCount: 3 })).toEqual({ filter: [], export: [] });
  });
});

describe("the shortcuts list", () => {
  it.each(["ko", "en"] as const)("names every key with the controls' own words (%s)", (locale) => {
    const words = getDictionary(locale).studioReview.player;
    const rows = reviewShortcuts(words, { isVideo: true, extended: true, canComment: true, fullscreen: true });
    expect(rows.map(([k]) => k)).toEqual(["Space K", "← → , .", "J", "L", "I", "O", "R", "F", "?"]);
    expect(rows.find(([k]) => k === "R")?.[1]).toBe(words.loop);
    expect(rows.find(([k]) => k === "F")?.[1]).toBe(words.fullscreen);
    expect(rows[0]![1]).toBe(`${words.play} · ${words.pause}`);
    // A viewer who cannot write gets no I/O; the studio's v3 stage no , . or R; a still none at all.
    expect(reviewShortcuts(words, { isVideo: true, extended: true, canComment: false, fullscreen: false }).map(([k]) => k)).toEqual(["Space K", "← → , .", "J", "L", "R", "?"]);
    expect(reviewShortcuts(words, { isVideo: true, extended: false, canComment: true, fullscreen: false }).map(([k]) => k)).toEqual(["Space K", "← →", "J", "L", "?"]);
    expect(reviewShortcuts(words, { isVideo: false, extended: true, canComment: true, fullscreen: true })).toEqual([]);
  });
});
