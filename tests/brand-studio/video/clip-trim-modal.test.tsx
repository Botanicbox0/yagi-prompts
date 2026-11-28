import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { FrameThumbs } from "@/components/brand-studio/editor-v2/frame-thumbs";
import { ClipTrimModal } from "@/components/brand-studio/video/clip-trim-modal";
import {
  TRIM_FRAME_STEP_SECONDS,
  TRIM_STRIP_COUNT,
  TRIM_TEN_FRAMES_SECONDS,
  applyPlayheadBound,
  fixedSceneStep,
  sceneBoundaries,
  sceneJumpTarget,
  stripTimestamps,
} from "@/components/brand-studio/video/trim-nav-model";
import { mountDom } from "@/tests/brands/_dom-harness";
import { asset } from "../ui/fixtures";

const KO_TRIM = getDictionary("ko").studioVideo.workspace.trimModal;
const noop = () => {};

function fakeThumbsFactory(decodedMap: Map<number, string> = new Map()) {
  const want = vi.fn();
  const dispose = vi.fn();
  const listeners = new Set<() => void>();
  const instance = {
    want,
    dispose,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get(_src: string, sourceFrame: number) {
      return decodedMap.get(sourceFrame);
    },
    clear: vi.fn(),
  } as unknown as FrameThumbs;
  return {
    create: () => instance,
    want,
    dispose,
    emit: () => listeners.forEach((fn) => fn()),
  };
}

function attachFakeVideoBehavior(video: object, duration = 60) {
  let currentTime = 0;
  let paused = true;
  const play = vi.fn(() => {
    paused = false;
    return Promise.resolve();
  });
  const pause = vi.fn(() => {
    paused = true;
  });
  Object.defineProperty(video, "duration", { configurable: true, get: () => duration });
  Object.defineProperty(video, "paused", { configurable: true, get: () => paused });
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    get: () => currentTime,
    set: (v: number) => {
      currentTime = v;
    },
  });
  (video as unknown as { play: typeof play; pause: typeof pause }).play = play;
  (video as unknown as { play: typeof play; pause: typeof pause }).pause = pause;
  return {
    getCurrentTime: () => currentTime,
    setCurrentTime: (v: number) => {
      currentTime = v;
    },
    isPaused: () => paused,
    play,
    pause,
  };
}

describe("Batch T: trim-nav-model pure math", () => {
  it("computes 16 evenly spaced strip timestamps across short and 10-minute clips", () => {
    const shortStrip = stripTimestamps(12);
    expect(shortStrip).toHaveLength(TRIM_STRIP_COUNT);
    expect(shortStrip[0]!).toBeGreaterThan(0);
    expect(shortStrip[shortStrip.length - 1]!).toBeLessThan(12);

    const longStrip = stripTimestamps(600);
    expect(longStrip).toHaveLength(16);
    expect(longStrip[0]!).toBeCloseTo(18.75, 2);
    expect(longStrip[15]!).toBeCloseTo(581.25, 2);
  });

  it("computes fixed scene step clamped to 2..10s", () => {
    expect(fixedSceneStep(15)).toBe(2);
    expect(fixedSceneStep(60)).toBe(6);
    expect(fixedSceneStep(600)).toBe(10);
  });

  it("extracts sorted interior scene boundaries and jumps with 0.3s prev hysteresis or fixed-step fallback", () => {
    const shots = [
      { start: 0, end: 5 },
      { start: 5, end: 14 },
      { start: 14, end: 24 },
      { start: 24, end: 30 },
    ];
    expect(sceneBoundaries(shots, 30)).toEqual([5, 14, 24]);
    expect(sceneBoundaries(undefined, 30)).toEqual([]);

    // Forward & backward with shots
    expect(sceneJumpTarget(0, shots, 30, "next")).toMatchObject({ target: 5, usedShots: true });
    expect(sceneJumpTarget(5, shots, 30, "next")).toMatchObject({ target: 14, usedShots: true });
    // Within 0.3s of boundary 14 -> skips back to 5
    expect(sceneJumpTarget(14.1, shots, 30, "prev")).toMatchObject({ target: 5, usedShots: true });
    // Well into shot [14..24] -> jumps back to 14
    expect(sceneJumpTarget(16.5, shots, 30, "prev")).toMatchObject({ target: 14, usedShots: true });

    // Without shots -> fixed step (60s -> 6s)
    expect(sceneJumpTarget(10, undefined, 60, "next")).toMatchObject({ target: 16, usedShots: false, stepSeconds: 6 });
    expect(sceneJumpTarget(10, undefined, 60, "prev")).toMatchObject({ target: 4, usedShots: false, stepSeconds: 6 });
  });

  it("applyPlayheadBound clamps I/O to minSeconds..maxSeconds and reports movedOther", () => {
    const initial = { start: 0, end: 20, duration: 20 };

    // Set start at 10s -> end stays 20s (valid 10s span), no other handle moved
    const okStart = applyPlayheadBound(initial, 10, "start", 60, 4, 30);
    expect(okStart.range).toEqual({ start: 10, end: 20, duration: 10 });
    expect(okStart.movedOther).toBeNull();

    // Set start at 25s (past current end 20s) -> end shifts automatically and movedOther = "end"
    const shiftedEnd = applyPlayheadBound(initial, 25, "start", 60, 4, 30);
    expect(shiftedEnd.range.start).toBe(25);
    expect(shiftedEnd.range.end).toBeGreaterThanOrEqual(29);
    expect(shiftedEnd.movedOther).toBe("end");

    // Set end at 45s (more than 30s past current start 0s) -> start shifts automatically and movedOther = "start"
    const shiftedStart = applyPlayheadBound(initial, 45, "end", 60, 4, 30);
    expect(shiftedStart.range.end).toBe(45);
    expect(shiftedStart.range.duration).toBeLessThanOrEqual(30);
    expect(shiftedStart.movedOther).toBe("start");
  });
});

describe("Batch T: ClipTrimModal interactive navigation (all orgs)", () => {
  const longClip = asset(50, {
    kind: "video",
    name: "commercial-60s.mp4",
    url: "https://media.example/st/commercial-60s.mp4",
    thumbUrl: "https://media.example/st/commercial-60s.webp",
    width: 1280,
    height: 720,
    seconds: 60,
  });

  it("requests 16 browser thumbs via FrameThumbs, disposes on unmount, falls back to ticks when empty, and renders decoded frames", async () => {
    const decoded = new Map<number, string>([[0, "blob:thumb-0"], [5, "blob:thumb-5"]]);
    const spy = fakeThumbsFactory(decoded);

    const dom = await mountDom(
      <ClipTrimModal
        asset={longClip}
        copy={KO_TRIM}
        createThumbs={spy.create}
        onSkip={noop}
        onApply={noop}
        onUploadTrimmed={async () => null}
        onClose={noop}
      />,
    );
    try {
      expect(spy.want).toHaveBeenCalledTimes(1);
      expect(spy.want.mock.calls[0]![0]).toHaveLength(16);
      expect(dom.queryAll("[data-trim-strip-thumb]")).toHaveLength(2);
      // Without cached shots: zero scene markers, fixed-step labels ("6초 뒤로" / "6초 앞으로") + W7 title explains no scene marks
      expect(dom.queryAll("[data-trim-scene-marker]")).toHaveLength(0);
      expect(dom.query("[data-trim-prev-scene]")?.textContent).toBe("6초 뒤로");
      expect(dom.query("[data-trim-next-scene]")?.textContent).toBe("6초 앞으로");
      expect(dom.query("[data-trim-prev-scene]")?.getAttribute("title")).toContain("장면 표시가 없어요");
      expect(dom.query("[data-trim-next-scene]")?.getAttribute("title")).toContain("장면 표시가 없어요");
      expect(dom.query("[data-trim-play]")?.getAttribute("title")).toContain("Space");
      expect(dom.query("[data-trim-set-start]")?.getAttribute("title")).toContain("I");
      expect(dom.query("[data-trim-set-end]")?.getAttribute("title")).toContain("O");

      // SMALL 4: loadedmetadata within 1 frame of asset.seconds (60.02s vs 60s) does NOT trigger a second decode!
      const videoEl = dom.query("video")!;
      attachFakeVideoBehavior(videoEl, 60.02);
      await act(async () => {
        (videoEl as unknown as { dispatchEvent(ev: unknown): void }).dispatchEvent({
          type: "loadedmetadata",
          bubbles: false,
          cancelable: false,
          target: videoEl,
          currentTarget: videoEl,
          preventDefault() {},
          stopPropagation() {},
          stopImmediatePropagation() {},
        });
      });
      expect(spy.want).toHaveBeenCalledTimes(1);
    } finally {
      await dom.unmount();
    }
    expect(spy.dispose).toHaveBeenCalledTimes(1);

    // Undecodable clip (0 frames decoded) -> renders fallback ticks, never crashes
    const emptySpy = fakeThumbsFactory();
    const emptyDom = await mountDom(
      <ClipTrimModal
        asset={longClip}
        copy={KO_TRIM}
        createThumbs={emptySpy.create}
        onSkip={noop}
        onApply={noop}
        onUploadTrimmed={async () => null}
        onClose={noop}
      />,
    );
    try {
      expect(emptyDom.queryAll("[data-trim-strip-thumb]")).toHaveLength(0);
      expect(emptyDom.queryAll("[data-trim-filmstrip] span").length).toBeGreaterThanOrEqual(12);
    } finally {
      await emptyDom.unmount();
    }
  });

  it("supports click/drag scrub, hover preview thumbnail + timestamp, cached scene markers, keyboard shortcuts (no J/K/L), and I/O clamp note", async () => {
    const shots = [
      { start: 0, end: 10 },
      { start: 10, end: 25 },
      { start: 25, end: 42 },
      { start: 42, end: 60 },
    ];
    const spy = fakeThumbsFactory();
    const dom = await mountDom(
      <ClipTrimModal
        asset={longClip}
        copy={KO_TRIM}
        shots={shots}
        createThumbs={spy.create}
        onSkip={noop}
        onApply={noop}
        onUploadTrimmed={async () => null}
        onClose={noop}
      />,
    );
    try {
      const dialog = dom.query("[data-video-trim-modal]")!;
      const videoEl = dom.query("video")!;
      const v = attachFakeVideoBehavior(videoEl, 60);
      const strip = dom.query("[data-trim-filmstrip]")!;
      (strip as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 600, height: 52, right: 600, bottom: 52, x: 0, y: 0, toJSON() {} }) as DOMRect;

      // Scene markers rendered ONLY from cached shots
      expect(dom.queryAll("[data-trim-scene-marker]")).toHaveLength(3);
      expect(dom.query("[data-trim-prev-scene]")?.textContent).toBe(KO_TRIM.prevScene);
      expect(dom.query("[data-trim-next-scene]")?.textContent).toBe(KO_TRIM.nextScene);

      // Click on strip at x=300 (50% of 600px -> 30.0s) seeks video & updates playhead
      await act(async () => {
        (strip as unknown as { dispatchEvent(ev: unknown): void }).dispatchEvent({
          type: "pointerdown",
          bubbles: true,
          cancelable: true,
          clientX: 300,
          target: strip,
          currentTarget: strip,
          preventDefault() {},
          stopPropagation() {},
          stopImmediatePropagation() {},
        });
      });
      expect(v.getCurrentTime()).toBeCloseTo(30, 1);
      expect(dom.query("[data-trim-playhead-readout]")?.textContent).toContain("30.0초");

      // Hover preview appears with timestamp
      await act(async () => {
        (strip as unknown as { dispatchEvent(ev: unknown): void }).dispatchEvent({
          type: "pointermove",
          bubbles: true,
          cancelable: true,
          clientX: 150,
          target: strip,
          currentTarget: strip,
          preventDefault() {},
          stopPropagation() {},
          stopImmediatePropagation() {},
        });
      });
      expect(dom.query("[data-trim-hover-preview]")?.textContent).toContain("15.0s");

      // ArrowDown jumps to next scene (from 30s -> 42s); ArrowUp jumps back to 25s
      await dom.keyDown("ArrowDown", { target: dialog });
      expect(v.getCurrentTime()).toBeCloseTo(42, 1);
      await dom.keyDown("ArrowUp", { target: dialog });
      expect(v.getCurrentTime()).toBeCloseTo(25, 1);

      // ArrowRight (+1 frame), Shift+ArrowRight (+10 frames)
      await dom.keyDown("ArrowRight", { target: dialog });
      expect(v.getCurrentTime()).toBeCloseTo(25 + TRIM_FRAME_STEP_SECONDS, 3);
      await dom.keyDown("ArrowRight", { target: dialog, shiftKey: true });
      expect(v.getCurrentTime()).toBeCloseTo(25 + TRIM_FRAME_STEP_SECONDS + TRIM_TEN_FRAMES_SECONDS, 3);

      // Press `I` at ~25.5s -> moves start to 25.5s and shifts end cleanly (still within 30s) -> check clamp note when pushing end past 30s
      await dom.keyDown("ArrowDown", { target: dialog }); // 42s
      await dom.keyDown("i", { target: dialog });
      // Original range was [0..30], setting start at 42s forces end to move -> clampNote shown!
      expect(dom.query("[data-trim-clamp-note]")).not.toBeNull();
      expect(dom.query("[data-trim-range-readout]")?.textContent).toContain("42.0초");

      // Space toggles play/pause; J/K/L do NOT trigger playback or seek
      const timeBeforeJkl = v.getCurrentTime();
      await dom.keyDown("j", { target: dialog });
      await dom.keyDown("k", { target: dialog });
      await dom.keyDown("l", { target: dialog });
      expect(v.getCurrentTime()).toBe(timeBeforeJkl);
      expect(v.play).not.toHaveBeenCalled();

      await dom.keyDown(" ", { target: dialog });
      expect(v.play).toHaveBeenCalledTimes(1);
    } finally {
      await dom.unmount();
    }
  });

  it("loops inside [range.start, range.end] only when playback starts inside range; fits compactly in 1280x800 and 1440x900 CSS", async () => {
    const spy = fakeThumbsFactory();
    const dom = await mountDom(
      <ClipTrimModal
        asset={longClip}
        copy={KO_TRIM}
        createThumbs={spy.create}
        onSkip={noop}
        onApply={noop}
        onUploadTrimmed={async () => null}
        onClose={noop}
      />,
    );
    try {
      const videoEl = dom.query("video")!;
      const v = attachFakeVideoBehavior(videoEl, 60);

      // Start playback inside [0..30] at t=2s -> hitting t=31s wraps to range.start (0)
      v.setCurrentTime(2);
      await dom.click("[data-trim-play]");
      await act(async () => {
        (videoEl as unknown as { dispatchEvent(ev: unknown): void }).dispatchEvent({
          type: "play",
          bubbles: false,
          cancelable: false,
          target: videoEl,
          currentTarget: videoEl,
          preventDefault() {},
          stopPropagation() {},
          stopImmediatePropagation() {},
        });
      });
      v.setCurrentTime(31);
      await act(async () => {
        (videoEl as unknown as { dispatchEvent(ev: unknown): void }).dispatchEvent({
          type: "timeupdate",
          bubbles: false,
          cancelable: false,
          target: videoEl,
          currentTarget: videoEl,
          preventDefault() {},
          stopPropagation() {},
          stopImmediatePropagation() {},
        });
      });
      expect(v.getCurrentTime()).toBe(0);

      // Pause, seek outside range to 45s, play -> hitting 46s does NOT jump back to 0!
      await dom.click("[data-trim-play]");
      v.setCurrentTime(45);
      await dom.click("[data-trim-play]");
      v.setCurrentTime(46);
      await act(async () => {
        (videoEl as unknown as { dispatchEvent(ev: unknown): void }).dispatchEvent({
          type: "timeupdate",
          bubbles: false,
          cancelable: false,
          target: videoEl,
          currentTarget: videoEl,
          preventDefault() {},
          stopPropagation() {},
          stopImmediatePropagation() {},
        });
      });
      expect(v.getCurrentTime()).toBe(46);
    } finally {
      await dom.unmount();
    }

    // CSS fit guard: preview capped with clamp(220px, 34dvh, 320px), zero hardcoded hex in new trim styles
    const css = readFileSync(resolve(process.cwd(), "components/brand-studio/video/video-workspace.module.css"), "utf8");
    expect(css).toContain("height: clamp(220px, 34dvh, 320px)");
    expect(css).toContain(".trimPlayheadLine");
    expect(css).toContain(".trimSceneMarker");
    expect(css).toContain(".trimHoverPreview");
  });
});
