import { describe, expect, it } from "vitest";
import {
  CANVAS_MAX,
  CANVAS_MIN,
  CANVAS_RATIOS,
  activeCanvasRatio,
  baseRect,
  canvasForRatio,
  emptyMargins,
  isCanvasResized,
  pictureBoxToWorld,
  resetCanvas,
  resizeCanvas,
  resizeFromHandle,
  worldToPicture,
} from "@/components/brand-studio/layers/canvas";
import { addLayer, createShapeLayer, emptyDoc, type LayerDoc } from "@/components/brand-studio/layers/model";

/** A 1000 × 800 picture with one 100 × 100 square at (200, 300). */
function sample(): LayerDoc {
  const doc = emptyDoc(1000, 800);
  return addLayer(doc, { ...createShapeLayer(doc, { shape: "rect", name: "판", id: "sq" }), x: 200, y: 300, w: 100, h: 100, rotation: 30 });
}

const layer = (doc: LayerDoc) => doc.layers[0]!;
/** Where the square sits relative to the picture: must never change when only the canvas changes. */
const relative = (doc: LayerDoc) => {
  const b = baseRect(doc);
  return { x: layer(doc).x - b.x, y: layer(doc).y - b.y };
};

describe("canvas basics", () => {
  it("lists the six presets and sane limits", () => {
    expect(CANVAS_RATIOS).toEqual(["1:1", "4:5", "3:4", "9:16", "16:9", "21:9"]);
    expect(CANVAS_MIN).toBe(64);
    expect(CANVAS_MAX).toBeGreaterThanOrEqual(4096);
  });

  it("treats a document without base as a picture covering the canvas", () => {
    const doc = sample();
    expect(baseRect(doc)).toEqual({ x: 0, y: 0, w: 1000, h: 800 });
    expect(isCanvasResized(doc)).toBe(false);
    expect(emptyMargins(doc)).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });
});

describe("resizeCanvas", () => {
  it("returns the same document when nothing changes", () => {
    const doc = sample();
    expect(resizeCanvas(doc, { width: 1000, height: 800 }, { x: 0.5, y: 0.5 })).toBe(doc);
  });

  it("keeps the left/top edge with anchor 0", () => {
    const next = resizeCanvas(sample(), { width: 1200, height: 1000 }, { x: 0, y: 0 });
    expect(next.width).toBe(1200);
    expect(next.height).toBe(1000);
    expect(baseRect(next)).toEqual({ x: 0, y: 0, w: 1000, h: 800 });
    expect(layer(next)).toMatchObject({ x: 200, y: 300, w: 100, h: 100, rotation: 30 });
    expect(emptyMargins(next)).toEqual({ left: 0, top: 0, right: 200, bottom: 200 });
  });

  it("keeps the right/bottom edge with anchor 1", () => {
    const next = resizeCanvas(sample(), { width: 1200, height: 1000 }, { x: 1, y: 1 });
    expect(baseRect(next)).toEqual({ x: 200, y: 200, w: 1000, h: 800 });
    expect(layer(next)).toMatchObject({ x: 400, y: 500 });
    expect(emptyMargins(next)).toEqual({ left: 200, top: 200, right: 0, bottom: 0 });
  });

  it("centres with anchor 0.5 and mixes anchors per axis", () => {
    const centred = resizeCanvas(sample(), { width: 1201, height: 1000 }, { x: 0.5, y: 0.5 });
    expect(baseRect(centred)).toEqual({ x: 101, y: 100, w: 1000, h: 800 });
    const mixed = resizeCanvas(sample(), { width: 1200, height: 1000 }, { x: 0, y: 1 });
    expect(baseRect(mixed)).toEqual({ x: 0, y: 200, w: 1000, h: 800 });
    expect(relative(mixed)).toEqual({ x: 200, y: 300 });
  });

  it("shrinks below the picture (the picture is cropped, not moved relative to layers)", () => {
    const next = resizeCanvas(sample(), { width: 600, height: 400 }, { x: 0.5, y: 0.5 });
    expect(baseRect(next)).toEqual({ x: -200, y: -200, w: 1000, h: 800 });
    expect(relative(next)).toEqual({ x: 200, y: 300 });
    expect(emptyMargins(next)).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });

  it("rounds and clamps sizes to the limits", () => {
    const tiny = resizeCanvas(sample(), { width: 3, height: 10.6 }, { x: 0, y: 0 });
    expect(tiny.width).toBe(CANVAS_MIN);
    expect(tiny.height).toBe(CANVAS_MIN);
    const huge = resizeCanvas(sample(), { width: 1e9, height: 900.4 }, { x: 0, y: 0 });
    expect(huge.width).toBe(CANVAS_MAX);
    expect(huge.height).toBe(900);
  });

  it("drops base again once the picture covers the canvas exactly", () => {
    const grown = resizeCanvas(sample(), { width: 1400, height: 900 }, { x: 0.5, y: 0.5 });
    expect(isCanvasResized(grown)).toBe(true);
    const back = resizeCanvas(grown, { width: 1000, height: 800 }, { x: 0.5, y: 0.5 });
    expect(back.base).toBeUndefined();
    expect("base" in back).toBe(false);
    expect(isCanvasResized(back)).toBe(false);
    expect(layer(back)).toMatchObject({ x: 200, y: 300 });
  });

  it("keeps baseHidden and layer order", () => {
    let doc: LayerDoc = { ...sample(), baseHidden: true };
    doc = addLayer(doc, { ...createShapeLayer(doc, { shape: "ellipse", name: "원", id: "el" }) });
    const next = resizeCanvas(doc, { width: 1200, height: 800 }, { x: 0, y: 0 });
    expect(next.baseHidden).toBe(true);
    expect(next.layers.map((l) => l.id)).toEqual(["sq", "el"]);
  });
});

describe("resizeFromHandle", () => {
  const start = sample();
  const cases: Array<{ handle: Parameters<typeof resizeFromHandle>[1]; dx: number; dy: number; size: [number, number]; base: [number, number] }> = [
    { handle: "e", dx: 100, dy: 50, size: [1100, 800], base: [0, 0] },
    { handle: "s", dx: 50, dy: 100, size: [1000, 900], base: [0, 0] },
    { handle: "se", dx: 100, dy: 100, size: [1100, 900], base: [0, 0] },
    { handle: "w", dx: -100, dy: 50, size: [1100, 800], base: [100, 0] },
    { handle: "n", dx: 50, dy: -100, size: [1000, 900], base: [0, 100] },
    { handle: "nw", dx: -100, dy: -100, size: [1100, 900], base: [100, 100] },
    { handle: "ne", dx: 100, dy: -100, size: [1100, 900], base: [0, 100] },
    { handle: "sw", dx: -100, dy: 100, size: [1100, 900], base: [100, 0] },
  ];
  for (const c of cases) {
    it(`drags ${c.handle}`, () => {
      const next = resizeFromHandle(start, c.handle, c.dx, c.dy);
      expect([next.width, next.height]).toEqual(c.size);
      const b = baseRect(next);
      expect([b.x, b.y]).toEqual(c.base);
      expect(relative(next)).toEqual({ x: 200, y: 300 });
    });
  }

  it("moves only the dragged edges inward", () => {
    const next = resizeFromHandle(start, "w", 300, 0);
    expect(next.width).toBe(700);
    expect(baseRect(next).x).toBe(-300);
  });

  it("clamps without moving the opposite edge", () => {
    // West: the right edge (at 1000 in the start document's frame) must stay put.
    const west = resizeFromHandle(start, "w", 5000, 0);
    expect(west.width).toBe(CANVAS_MIN);
    expect(baseRect(west).x).toBe(CANVAS_MIN - 1000);
    expect(baseRect(west).x + 1000).toBe(west.width);
    const north = resizeFromHandle(start, "n", 0, 5000);
    expect(north.height).toBe(CANVAS_MIN);
    expect(baseRect(north).y + 800).toBe(north.height);
    // East: the left edge stays at 0.
    const east = resizeFromHandle(start, "e", -5000, 0);
    expect(east.width).toBe(CANVAS_MIN);
    expect(baseRect(east).x).toBe(0);
    const big = resizeFromHandle(start, "w", -1e7, 0);
    expect(big.width).toBe(CANVAS_MAX);
    expect(baseRect(big).x + 1000).toBe(CANVAS_MAX);
  });

  it("returns the same document for a zero drag", () => {
    expect(resizeFromHandle(start, "se", 0.2, -0.3)).toBe(start);
  });

  it("always works from the start document (no drift)", () => {
    const a = resizeFromHandle(start, "w", -100, 0);
    const b = resizeFromHandle(start, "w", -100, 0);
    expect(a).toEqual(b);
  });
});

describe("canvasForRatio", () => {
  it("adds height for a taller preset, picture centred", () => {
    const next = canvasForRatio(sample(), "4:5");
    expect([next.width, next.height]).toEqual([1000, 1250]);
    expect(baseRect(next)).toEqual({ x: 0, y: 225, w: 1000, h: 800 });
    expect(relative(next)).toEqual({ x: 200, y: 300 });
    expect(activeCanvasRatio(next)).toBe("4:5");
  });

  it("adds width for a wider preset", () => {
    const next = canvasForRatio(sample(), "16:9");
    expect([next.width, next.height]).toEqual([1422, 800]);
    expect(baseRect(next)).toEqual({ x: 211, y: 0, w: 1000, h: 800 });
    expect(activeCanvasRatio(next)).toBe("16:9");
    const wide = canvasForRatio(sample(), "21:9");
    expect([wide.width, wide.height]).toEqual([1867, 800]);
    expect(activeCanvasRatio(wide)).toBe("21:9");
  });

  it("is idempotent and computed from the picture, not the current canvas", () => {
    const once = canvasForRatio(sample(), "9:16");
    expect(canvasForRatio(once, "9:16")).toBe(once);
    const fromOther = canvasForRatio(canvasForRatio(sample(), "21:9"), "9:16");
    expect([fromOther.width, fromOther.height]).toEqual([once.width, once.height]);
    expect(baseRect(fromOther)).toEqual(baseRect(once));
    expect(relative(fromOther)).toEqual({ x: 200, y: 300 });
  });

  it("never crops the picture", () => {
    for (const ratio of CANVAS_RATIOS) {
      const next = canvasForRatio(sample(), ratio);
      const b = baseRect(next);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(next.width);
      expect(b.y + b.h).toBeLessThanOrEqual(next.height);
      expect(activeCanvasRatio(next)).toBe(ratio);
    }
  });

  it("drops base when the picture already has that ratio", () => {
    const square = emptyDoc(900, 900);
    expect(canvasForRatio(square, "1:1")).toBe(square);
    const resized = resizeCanvas(square, { width: 1200, height: 900 }, { x: 0.5, y: 0.5 });
    const back = canvasForRatio(resized, "1:1");
    expect(back.base).toBeUndefined();
    expect([back.width, back.height]).toEqual([900, 900]);
  });
});

describe("resetCanvas", () => {
  it("goes back to the picture's size with layers moving with it", () => {
    const grown = resizeFromHandle(sample(), "nw", -150, -70);
    const reset = resetCanvas(grown);
    expect([reset.width, reset.height]).toEqual([1000, 800]);
    expect(reset.base).toBeUndefined();
    expect(layer(reset)).toMatchObject({ x: 200, y: 300 });
  });

  it("returns the same document when the canvas was not resized", () => {
    const doc = sample();
    expect(resetCanvas(doc)).toBe(doc);
  });
});

describe("activeCanvasRatio", () => {
  it("matches presets within a pixel and is null otherwise", () => {
    expect(activeCanvasRatio(emptyDoc(1080, 1350))).toBe("4:5");
    expect(activeCanvasRatio(emptyDoc(1080, 1351))).toBe("4:5");
    expect(activeCanvasRatio(emptyDoc(1920, 1080))).toBe("16:9");
    expect(activeCanvasRatio(emptyDoc(1000, 1000))).toBe("1:1");
    expect(activeCanvasRatio(emptyDoc(1000, 800))).toBeNull();
  });
});

describe("emptyMargins", () => {
  it("reports uncovered canvas on each side, zero where the picture passes the edge", () => {
    const doc: LayerDoc = { ...emptyDoc(1000, 1000), base: { x: -50, y: 100, w: 800, h: 1000 } };
    expect(emptyMargins(doc)).toEqual({ left: 0, top: 100, right: 250, bottom: 0 });
  });
});

describe("picture fractions on a resized canvas", () => {
  const doc: LayerDoc = { ...emptyDoc(1200, 1000), base: { x: 100, y: 200, w: 1000, h: 800 } };

  it("maps world points to picture fractions, clamped to the picture", () => {
    expect(worldToPicture(doc, { x: 600, y: 600 })).toEqual({ x: 0.5, y: 0.5 });
    expect(worldToPicture(doc, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(worldToPicture(doc, { x: 5000, y: 5000 })).toEqual({ x: 1, y: 1 });
  });

  it("maps a picture-fraction box to world pixels", () => {
    expect(pictureBoxToWorld(doc, { x: 0.1, y: 0.25, w: 0.5, h: 0.5 })).toEqual({ x: 200, y: 400, w: 500, h: 400 });
  });

  it("is the old canvas-fraction math on an unresized canvas", () => {
    const plain = emptyDoc(1000, 800);
    expect(worldToPicture(plain, { x: 250, y: 200 })).toEqual({ x: 0.25, y: 0.25 });
    expect(pictureBoxToWorld(plain, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 })).toEqual({ x: 250, y: 200, w: 500, h: 400 });
  });
});
