import { describe, expect, it } from "vitest";
import { COALESCE_MS, HISTORY_CAP, canRedo, canUndo, commit, createHistory, preview, redo, revert, settle, undo } from "@/components/brand-studio/layers/history";

describe("history", () => {
  it("undoes and redoes whole steps", () => {
    let h = createHistory("a");
    h = commit(h, "b", { now: 1 });
    h = commit(h, "c", { now: 2 });
    expect(canUndo(h)).toBe(true);
    h = undo(h);
    expect(h.present).toBe("b");
    h = undo(h);
    expect(h.present).toBe("a");
    expect(canUndo(h)).toBe(false);
    expect(undo(h)).toBe(h);
    h = redo(h);
    expect(h.present).toBe("b");
    expect(canRedo(h)).toBe(true);
  });

  it("drops the redo branch after a new step", () => {
    let h = commit(commit(createHistory(1), 2, { now: 1 }), 3, { now: 2 });
    h = undo(h);
    h = commit(h, 4, { now: 3 });
    expect(h.future).toEqual([]);
    expect(redo(h)).toBe(h);
  });

  it("ignores a commit that changes nothing", () => {
    const h = createHistory({ n: 1 });
    expect(commit(h, h.present)).toBe(h);
  });

  it("keeps at most the cap", () => {
    let h = createHistory(0);
    for (let i = 1; i <= HISTORY_CAP + 20; i++) h = commit(h, i, { now: i * 10_000 });
    expect(h.past).toHaveLength(HISTORY_CAP);
    expect(h.past[0]).toBe(20);
  });

  it("folds quick edits with the same key into one step", () => {
    let h = createHistory("");
    h = commit(h, "#1", { key: "color", now: 1000 });
    h = commit(h, "#12", { key: "color", now: 1200 });
    h = commit(h, "#123", { key: "color", now: 1400 });
    expect(h.past).toEqual([""]);
    h = commit(h, "#1234", { key: "color", now: 1400 + COALESCE_MS + 1 });
    expect(h.past).toEqual(["", "#123"]);
    h = commit(h, "x", { key: "other", now: 1400 + COALESCE_MS + 2 });
    expect(h.past).toHaveLength(3);
    // Undo always breaks the chain.
    h = commit(undo(h), "y", { key: "other", now: 1400 + COALESCE_MS + 3 });
    expect(h.past).toEqual(["", "#123", "#1234"]);
  });

  it("makes a drag one step: previews in between, settle at the end", () => {
    let h = commit(createHistory("start"), "before-drag", { now: 1 });
    const start = h.present;
    h = preview(h, "drag-1");
    h = preview(h, "drag-2");
    expect(h.past).toEqual(["start"]);
    h = settle(h, start, { now: 2 });
    expect(h.present).toBe("drag-2");
    expect(h.past).toEqual(["start", "before-drag"]);
    expect(undo(h).present).toBe("before-drag");
  });

  it("settles nothing when the drag did not change the document", () => {
    const h = createHistory("same");
    expect(settle(h, h.present)).toBe(h);
    expect(revert(preview(h, "moved"), "same").present).toBe("same");
  });
});
