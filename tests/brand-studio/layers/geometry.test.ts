import { describe, expect, it } from "vitest";
import {
  boundsOf,
  centerOf,
  containsPoint,
  cornersOf,
  fitView,
  handleCursor,
  hitTest,
  nudgeDelta,
  resizeFrame,
  resizeLayerPatch,
  rotatePoint,
  rotationFromPointer,
  snapMove,
  snapTargets,
  toScreen,
  toWorld,
  zoomAround,
  ZOOM_MAX,
  ZOOM_MIN,
} from "@/components/brand-studio/layers/geometry";
import { createImageLayer, createShapeLayer, createTextLayer, emptyDoc, type Frame } from "@/components/brand-studio/layers/model";

const frame = (x: number, y: number, w: number, h: number, rotation = 0): Frame => ({ x, y, w, h, rotation });

describe("rotated boxes", () => {
  it("rotates a point clockwise around a centre (screen y points down)", () => {
    const p = rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 90);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(10);
  });

  it("measures the bounds of a turned box", () => {
    const b = boundsOf(frame(0, 0, 100, 20, 90));
    expect(b.w).toBeCloseTo(20);
    expect(b.h).toBeCloseTo(100);
    expect(centerOf(b).x).toBeCloseTo(50);
    expect(centerOf(b).y).toBeCloseTo(10);
  });

  it("hit-tests in the box's own frame", () => {
    const f = frame(0, 0, 100, 20, 90);
    expect(containsPoint(f, { x: 50, y: 50 })).toBe(true);
    expect(containsPoint(f, { x: 90, y: 10 })).toBe(false);
  });

  it("finds the topmost visible layer under the pointer", () => {
    const frames = [
      { ...frame(0, 0, 100, 100), id: "bottom", hidden: false },
      { ...frame(50, 50, 100, 100), id: "top", hidden: false },
      { ...frame(0, 0, 200, 200), id: "hidden", hidden: true },
    ];
    expect(hitTest(frames, { x: 60, y: 60 })?.id).toBe("top");
    expect(hitTest(frames, { x: 10, y: 10 })?.id).toBe("bottom");
    expect(hitTest(frames, { x: 190, y: 190 })).toBeNull();
  });
});

describe("resizing from a handle", () => {
  it("pins the opposite corner", () => {
    const f = frame(10, 10, 100, 50);
    expect(resizeFrame(f, "se", { x: 210, y: 110 }, { keepRatio: false })).toEqual(frame(10, 10, 200, 100));
    const nw = resizeFrame(f, "nw", { x: 0, y: 0 }, { keepRatio: false });
    expect(nw.x + nw.w).toBeCloseTo(110);
    expect(nw.y + nw.h).toBeCloseTo(60);
  });

  it("keeps the ratio on corners, following the larger pull", () => {
    const r = resizeFrame(frame(0, 0, 100, 50), "se", { x: 300, y: 60 }, { keepRatio: true });
    expect(r.w).toBeCloseTo(300);
    expect(r.h).toBeCloseTo(150);
  });

  it("grows an edge with ratio kept around the centre line", () => {
    const r = resizeFrame(frame(0, 0, 100, 50), "e", { x: 200, y: 25 }, { keepRatio: true });
    expect(r.w).toBeCloseTo(200);
    expect(r.h).toBeCloseTo(100);
    expect(r.y + r.h / 2).toBeCloseTo(25);
    expect(r.x).toBeCloseTo(0);
  });

  it("keeps the pinned corner in place on a rotated box", () => {
    const f = frame(100, 100, 200, 100, 30);
    const pinned = cornersOf(f)[0]!; // nw stays when dragging se
    const r = resizeFrame(f, "se", { x: 500, y: 400 }, { keepRatio: false });
    const after = cornersOf(r)[0]!;
    expect(after.x).toBeCloseTo(pinned.x);
    expect(after.y).toBeCloseTo(pinned.y);
    expect(r.rotation).toBe(30);
  });

  it("never goes below the minimum side, even past the anchor", () => {
    const r = resizeFrame(frame(0, 0, 100, 100), "se", { x: -50, y: -50 }, { keepRatio: false, min: 4 });
    expect(r.w).toBe(4);
    expect(r.h).toBe(4);
    expect(r.x).toBe(0);
  });

  it("applies each layer kind's rule", () => {
    const doc = emptyDoc(1000, 1000);
    const image = { ...createImageLayer(doc, { url: "/a.png", ref: null, name: "i", natural: { width: 200, height: 100 } }), x: 0, y: 0, w: 200, h: 100 };
    const keep = resizeLayerPatch(image, frame(0, 0, 200, 100), "se", { x: 400, y: 120 }, false);
    expect((keep.w ?? 0) / (keep.h ?? 1)).toBeCloseTo(2);
    const free = resizeLayerPatch(image, frame(0, 0, 200, 100), "se", { x: 400, y: 120 }, true);
    expect(free).toMatchObject({ w: 400, h: 120 });

    const shape = { ...createShapeLayer(doc, { shape: "rect", name: "s" }), x: 0, y: 0, w: 200, h: 100 };
    expect(resizeLayerPatch(shape, frame(0, 0, 200, 100), "se", { x: 400, y: 120 }, false)).toMatchObject({ w: 400, h: 120 });
    const square = resizeLayerPatch(shape, frame(0, 0, 200, 100), "se", { x: 400, y: 120 }, true);
    expect((square.w ?? 0) / (square.h ?? 1)).toBeCloseTo(2);

    const text = { ...createTextLayer(doc, { text: "Hi", name: "t" }), x: 0, y: 0, w: 200, size: 40 };
    const corner = resizeLayerPatch(text, frame(0, 0, 200, 48), "se", { x: 400, y: 96 }, false);
    expect(corner).toMatchObject({ w: 400, size: 80 });
    const side = resizeLayerPatch(text, frame(0, 0, 200, 48), "e", { x: 300, y: 20 }, false);
    expect(side).toEqual({ x: 0, y: 0, w: 300 });
  });

  it("turns the resize cursor with the box", () => {
    expect(handleCursor("e", 0)).toBe("ew-resize");
    expect(handleCursor("e", 90)).toBe("ns-resize");
    expect(handleCursor("ne", 45)).toBe("ew-resize");
    expect(handleCursor("n", -45)).toBe("nwse-resize");
  });
});

describe("rotation", () => {
  it("points the top handle at the pointer", () => {
    const c = { x: 0, y: 0 };
    expect(rotationFromPointer(c, { x: 0, y: -10 }, false)).toBe(0);
    expect(rotationFromPointer(c, { x: 10, y: 0 }, false)).toBe(90);
    expect(rotationFromPointer(c, { x: 0, y: 10 }, false)).toBe(180);
    expect(rotationFromPointer(c, { x: -10, y: 0 }, false)).toBe(-90);
  });

  it("snaps to 15° steps with Shift", () => {
    const c = { x: 0, y: 0 };
    const p = rotatePoint({ x: 0, y: -10 }, c, 22);
    expect(rotationFromPointer(c, p, false)).toBeCloseTo(22);
    expect(rotationFromPointer(c, p, true)).toBe(15);
    expect(rotationFromPointer(c, rotatePoint({ x: 0, y: -10 }, c, 23), true)).toBe(30);
  });
});

describe("smart guides", () => {
  const canvas = { width: 1000, height: 800 };

  it("snaps a box's centre to the picture's centre lines", () => {
    const targets = snapTargets(canvas, []);
    const s = snapMove({ x: 447, y: 352, w: 100, h: 100 }, targets, 6);
    expect(s.dx).toBe(3);
    expect(s.dy).toBe(-2);
    expect(s.guides.x).toEqual([500]);
    expect(s.guides.y).toEqual([400]);
  });

  it("snaps edges to the picture's edges and to other layers", () => {
    const targets = snapTargets(canvas, [{ x: 600, y: 100, w: 200, h: 50 }]);
    const s = snapMove({ x: 4, y: 153, w: 100, h: 100 }, targets, 6);
    expect(s.dx).toBe(-4); // left edge to the picture's edge
    expect(s.dy).toBe(-3); // top edge to the other layer's bottom (150)
    expect(s.guides.y).toContain(150);
  });

  it("leaves the box alone outside the threshold", () => {
    const s = snapMove({ x: 120, y: 120, w: 50, h: 50 }, snapTargets(canvas, []), 6);
    expect(s).toEqual({ dx: 0, dy: 0, guides: { x: [], y: [] } });
  });
});

describe("view", () => {
  it("fits the picture into the free area, centred, never above 100%", () => {
    const v = fitView({ width: 1400, height: 900 }, { width: 2000, height: 1000 }, { top: 80, right: 320, bottom: 0, left: 280 }, 20);
    const free = 1400 - 600 - 40;
    expect(v.zoom).toBeCloseTo(free / 2000);
    expect(v.panX + (2000 * v.zoom) / 2).toBeCloseTo(280 + 20 + free / 2);
    expect(fitView({ width: 2000, height: 2000 }, { width: 100, height: 100 }, { top: 0, right: 0, bottom: 0, left: 0 }).zoom).toBe(1);
  });

  it("zooms around the anchor without moving the point under it", () => {
    const v = { zoom: 0.5, panX: 100, panY: 50 };
    const anchor = { x: 400, y: 300 };
    const before = toWorld(v, anchor);
    const next = zoomAround(v, anchor, 2);
    const after = toScreen(next, before);
    expect(after.x).toBeCloseTo(anchor.x);
    expect(after.y).toBeCloseTo(anchor.y);
    expect(zoomAround(v, anchor, 1000).zoom).toBe(ZOOM_MAX);
    expect(zoomAround(v, anchor, 0).zoom).toBe(ZOOM_MIN);
  });

  it("nudges 1 px, 10 px with Shift", () => {
    expect(nudgeDelta("ArrowLeft", false)).toEqual({ x: -1, y: 0 });
    expect(nudgeDelta("ArrowDown", true)).toEqual({ x: 0, y: 10 });
    expect(nudgeDelta("a", false)).toBeNull();
  });
});
