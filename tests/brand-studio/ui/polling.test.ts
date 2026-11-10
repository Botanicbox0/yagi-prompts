import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegionBoxSchema } from "@/lib/brand-studio/contracts";
import { POLL_IMAGE_MS, POLL_VIDEO_MS, createPollLoop, pollDelay } from "@/components/brand-studio/poller";
import { initialStore, studioReducer } from "@/components/brand-studio/store";
import { centeredBox, drawBox, moveBox, nudgeBox, resizeBox } from "@/components/brand-studio/region-math";
import { asset, job, output, studioState } from "./fixtures";

/** docs/BRAND-STUDIO-V2.md §7: 3 s for images, 8 s once a video is open, paused when hidden, stopped when done. */
describe("poll timing", () => {
  it("polls only while something is open, slower once a video is", () => {
    expect(pollDelay([])).toBeNull();
    expect(pollDelay([job(1, { status: "succeeded" }), job(2, { status: "failed" })])).toBeNull();
    expect(pollDelay([job(1, { status: "running" })])).toBe(POLL_IMAGE_MS);
    expect(pollDelay([job(1, { status: "queued" }), job(2, { kind: "video_remix", status: "held" })])).toBe(POLL_VIDEO_MS);
    expect(POLL_IMAGE_MS).toBe(3_000);
    expect(POLL_VIDEO_MS).toBe(8_000);
  });
});

describe("poll loop", () => {
  let hidden = false;
  const ticks: string[][] = [];
  const loop = () =>
    createPollLoop({
      tick: async (ids) => {
        ticks.push(ids);
      },
      hidden: () => hidden,
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    });
  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    ticks.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it("starts with an open job, asks only for open jobs and stops when none is left", async () => {
    const poll = loop();
    const open = job(1, { status: "running" });
    poll.update([open, job(2)]);
    expect(poll.scheduled).toBe(true);
    await vi.advanceTimersByTimeAsync(POLL_IMAGE_MS - 1);
    expect(ticks).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(ticks).toEqual([[open.id]]);
    expect(poll.scheduled).toBe(true);
    poll.update([{ ...open, status: "succeeded" }, job(2)]);
    expect(poll.scheduled).toBe(false);
    await vi.advanceTimersByTimeAsync(POLL_VIDEO_MS * 3);
    expect(ticks).toHaveLength(1);
  });

  it("slows down for video and pauses while the tab is hidden", async () => {
    const poll = loop();
    poll.update([job(1, { kind: "video", status: "running" })]);
    await vi.advanceTimersByTimeAsync(POLL_IMAGE_MS);
    expect(ticks).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(POLL_VIDEO_MS - POLL_IMAGE_MS);
    expect(ticks).toHaveLength(1);
    hidden = true;
    poll.visibility();
    expect(poll.scheduled).toBe(false);
    await vi.advanceTimersByTimeAsync(POLL_VIDEO_MS * 2);
    expect(ticks).toHaveLength(1);
    hidden = false;
    poll.visibility();
    await vi.advanceTimersByTimeAsync(POLL_VIDEO_MS);
    expect(ticks).toHaveLength(2);
    poll.stop();
    expect(poll.scheduled).toBe(false);
  });

  it("never runs two polls at once", async () => {
    let release: () => void = () => {};
    let running = 0, most = 0;
    const poll = createPollLoop({
      tick: () => new Promise<void>((resolve) => { running++; most = Math.max(most, running); release = () => { running--; resolve(); }; }),
      hidden: () => false,
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    });
    poll.update([job(1, { status: "running" })]);
    await vi.advanceTimersByTimeAsync(POLL_IMAGE_MS);
    poll.update([job(1, { status: "running" }), job(2, { status: "queued" })]);
    await vi.advanceTimersByTimeAsync(POLL_IMAGE_MS * 3);
    expect(most).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(POLL_IMAGE_MS);
    expect(most).toBe(1);
  });
});

describe("store", () => {
  it("merges polls by id, adds new runs first and marks saved results", () => {
    const first = job(1, { status: "running" });
    let store = initialStore(studioState({ jobs: [first], assets: [asset(1)] }));
    store = studioReducer(store, { type: "polled", poll: { ok: true, jobs: [{ ...first, status: "succeeded", outputs: [output(1)] }], allowance: studioState().allowance } });
    store = studioReducer(store, { type: "jobAdded", job: job(2, { createdAt: "2026-11-10T09:30:00Z" }) });
    store = studioReducer(store, { type: "outputSaved", outputId: output(1).id, assetId: asset(9).id });
    store = studioReducer(store, { type: "assetUpserted", asset: asset(9) });
    store = studioReducer(store, { type: "assetRemoved", id: asset(1).id });
    expect(store.phase).toBe("ready");
    expect(store.state!.jobs.map((j) => j.id)).toEqual([job(2).id, first.id]);
    expect(store.state!.jobs[1]!.outputs[0]!.savedAssetId).toBe(asset(9).id);
    expect(store.state!.assets.map((a) => a.id)).toEqual([asset(9).id]);
    expect(studioReducer(store, { type: "loadFailed", code: "forbidden" })).toEqual({ phase: "failed", code: "forbidden", state: null });
  });
});

describe("region box", () => {
  it("stays inside the picture, never below the contract's smallest side", () => {
    const boxes = [
      drawBox({ x: 0.9, y: 0.9 }, { x: 0.2, y: 0.4 }),
      drawBox({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }),
      drawBox({ x: -1, y: -1 }, { x: 3, y: 3 }),
      moveBox({ x: 0.7, y: 0.7, w: 0.3, h: 0.3 }, 0.5, 0.5),
      resizeBox({ x: 0.2, y: 0.2, w: 0.3, h: 0.3 }, "nw", { x: 0, y: 0 }),
      nudgeBox(centeredBox(), "ArrowRight", false)!,
      nudgeBox({ x: 0.98, y: 0.98, w: 0.02, h: 0.02 }, "ArrowLeft", true)!,
    ];
    for (const box of boxes) expect(RegionBoxSchema.safeParse(box).success, JSON.stringify(box)).toBe(true);
    expect(boxes[0]).toEqual({ x: 0.2, y: 0.4, w: 0.7, h: 0.5 });
    expect(boxes[3]).toEqual({ x: 0.7, y: 0.7, w: 0.3, h: 0.3 });
    expect(boxes[4]).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 });
    expect(nudgeBox(centeredBox(), "Enter", false)).toBeNull();
  });
});
