import { describe, expect, it } from "vitest";
import { RegionBoxSchema, type RegionBox } from "@/lib/brand-studio/contracts";
import { baseRect, canvasForRatio, holdPictureView, resizeCanvas } from "@/components/brand-studio/layers/canvas";
import {
  FILL_OVERLAP_MIN,
  FILL_OVERLAP_SHARE,
  fillInstruction,
  fillSentOf,
  fillStrips,
  placeFillPatch,
  planFillSource,
} from "@/components/brand-studio/layers/fill";
import { emptyDoc, type LayerDoc } from "@/components/brand-studio/layers/model";

/** A 1000 × 800 picture. */
const picture = () => emptyDoc(1000, 800);
const wider = (anchorX: 0 | 0.5 | 1, width = 1400) => resizeCanvas(picture(), { width, height: 800 }, { x: anchorX, y: 0.5 });
const taller = (anchorY: 0 | 0.5 | 1, height = 1200) => resizeCanvas(picture(), { width: 1000, height }, { x: 0.5, y: anchorY });

const valid = (box: RegionBox) => expect(RegionBoxSchema.safeParse(box).success, JSON.stringify(box)).toBe(true);
/** The strip's box in canvas pixels. */
const px = (doc: LayerDoc, box: RegionBox) => ({ x: box.x * doc.width, y: box.y * doc.height, w: box.w * doc.width, h: box.h * doc.height });
const overlapFor = (margin: number) => Math.max(FILL_OVERLAP_MIN, Math.ceil(margin * FILL_OVERLAP_SHARE));
/** The widest feather the composite can use on a box (align.ts: up to 12 % of the short side). */
const widestFeather = (b: { w: number; h: number }) => Math.round(Math.min(b.w, b.h) * 0.12);

describe("fillStrips", () => {
  it("covers an empty right margin and reaches into the picture", () => {
    const doc = wider(0);
    const strips = fillStrips(doc);
    expect(strips).toHaveLength(1);
    const [strip] = strips;
    expect(strip!.side).toBe("right");
    valid(strip!.box);
    const b = px(doc, strip!.box);
    expect(b.x).toBeCloseTo(1000 - overlapFor(400), 6);
    expect(b.x + b.w).toBeCloseTo(1400, 6);
    expect(strip!.box).toMatchObject({ y: 0, h: 1 });
    const into = baseRect(doc).x + baseRect(doc).w - b.x;
    expect(into).toBeGreaterThanOrEqual(widestFeather(b));
  });

  it("covers an empty left margin", () => {
    const doc = wider(1);
    const [strip, more] = fillStrips(doc);
    expect(more).toBeUndefined();
    expect(strip!.side).toBe("left");
    valid(strip!.box);
    const b = px(doc, strip!.box);
    expect(b.x).toBe(0);
    expect(b.w).toBeCloseTo(400 + overlapFor(400), 6);
    expect(b.w - baseRect(doc).x).toBeGreaterThanOrEqual(widestFeather(b));
  });

  it("covers top and bottom", () => {
    expect(fillStrips(taller(1)).map((s) => s.side)).toEqual(["top"]);
    expect(fillStrips(taller(0)).map((s) => s.side)).toEqual(["bottom"]);
    const doc = taller(0.5);
    const strips = fillStrips(doc);
    expect(strips.map((s) => s.side)).toEqual(["top", "bottom"]);
    for (const s of strips) {
      valid(s.box);
      expect(s.box).toMatchObject({ x: 0, w: 1 });
    }
    const top = px(doc, strips[0]!.box);
    const bottom = px(doc, strips[1]!.box);
    expect(top.y).toBe(0);
    expect(top.h).toBeCloseTo(200 + overlapFor(200), 6);
    expect(bottom.y + bottom.h).toBeCloseTo(1200, 6);
    // Each reaches into the picture by more than the feather, and the two never cross.
    expect(top.h - 200).toBeGreaterThanOrEqual(widestFeather(top));
    expect(top.y + top.h).toBeLessThanOrEqual(bottom.y);
  });

  it("covers both opposite sides of a centred ratio preset", () => {
    const doc = canvasForRatio(picture(), "16:9");
    const strips = fillStrips(doc);
    expect(strips.map((s) => s.side)).toEqual(["left", "right"]);
    const b = baseRect(doc);
    for (const s of strips) valid(s.box);
    expect(px(doc, strips[0]!.box).w).toBeCloseTo(b.x + overlapFor(b.x), 6);
    expect(px(doc, strips[1]!.box).x).toBeCloseTo(b.x + b.w - overlapFor(doc.width - b.x - b.w), 6);
  });

  it("offers nothing with margins on both axes, or none at all", () => {
    expect(fillStrips(resizeCanvas(picture(), { width: 1400, height: 1000 }, { x: 0.5, y: 0.5 }))).toEqual([]);
    expect(fillStrips(resizeCanvas(picture(), { width: 1400, height: 1000 }, { x: 0, y: 0 }))).toEqual([]);
    expect(fillStrips(picture())).toEqual([]);
    // A canvas smaller than the picture leaves nothing empty.
    expect(fillStrips(resizeCanvas(picture(), { width: 600, height: 800 }, { x: 0.5, y: 0.5 }))).toEqual([]);
  });

  it("keeps a thin margin's box at least 2 % of the canvas", () => {
    const thin = resizeCanvas(picture(), { width: 1002, height: 800 }, { x: 0, y: 0.5 });
    const [strip] = fillStrips(thin);
    valid(strip!.box);
    expect(px(thin, strip!.box).w).toBeCloseTo(2 + FILL_OVERLAP_MIN, 6);
    const wide = resizeCanvas(emptyDoc(6000, 800), { width: 6004, height: 800 }, { x: 0, y: 0.5 });
    const [w] = fillStrips(wide);
    valid(w!.box);
    expect(w!.box.w).toBeGreaterThanOrEqual(0.02);
    expect(w!.box.x + w!.box.w).toBeLessThanOrEqual(1.0001);
  });

  it("keeps every box valid when the picture is narrow and the margins are wide", () => {
    for (const doc of [
      resizeCanvas(emptyDoc(64, 400), { width: 4000, height: 400 }, { x: 0.5, y: 0.5 }),
      resizeCanvas(emptyDoc(64, 400), { width: 4000, height: 400 }, { x: 0, y: 0.5 }),
      resizeCanvas(emptyDoc(400, 64), { width: 400, height: 12000 }, { x: 0.5, y: 1 }),
      resizeCanvas(emptyDoc(3000, 2000), { width: 3001, height: 2000 }, { x: 0.5, y: 0.5 }),
    ]) {
      const strips = fillStrips(doc);
      expect(strips.length).toBeGreaterThan(0);
      for (const s of strips) valid(s.box);
    }
  });
});

describe("a finished fill lands where it belongs", () => {
  it("stays put relative to the picture after the canvas changed again", () => {
    const doc = wider(0); // picture at x 0, empty on the right
    const sent = fillSentOf(doc);
    const [strip] = fillStrips(doc);
    const atSend = placeFillPatch(doc, sent, strip!.box);
    expect(atSend.x).toBeCloseTo(1000 - overlapFor(400), 6);
    expect(atSend).toMatchObject({ y: 0, h: 800 });

    // While waiting the customer adds 300 px on the left and 100 on top: the picture moves to (300, 100).
    const later = resizeCanvas(resizeCanvas(doc, { width: 1700, height: 800 }, { x: 1, y: 0 }), { width: 1700, height: 900 }, { x: 0, y: 1 });
    expect(baseRect(later)).toMatchObject({ x: 300, y: 100 });
    const placed = placeFillPatch(later, sent, strip!.box);
    expect(placed.x).toBeCloseTo(atSend.x + 300, 6);
    expect(placed.y).toBeCloseTo(100, 6);
    expect(placed.w).toBeCloseTo(atSend.w, 6);
    expect(placed.h).toBeCloseTo(800, 6);
  });
});

describe("the picture that is sent", () => {
  it("draws the picture at its place and stretches its nearest edge over each empty margin", () => {
    const doc = canvasForRatio(picture(), "16:9"); // 1422 × 800, picture at x 211
    const plan = planFillSource(doc, { width: 2000, height: 1600 }); // stored at half its natural size
    expect(plan).toMatchObject({ width: 1422, height: 800 });
    expect(plan.ops).toEqual([
      { sx: 0, sy: 0, sw: 2000, sh: 1600, dx: 211, dy: 0, dw: 1000, dh: 800 },
      { sx: 0, sy: 0, sw: 1, sh: 1600, dx: 0, dy: 0, dw: 211, dh: 800 },
      { sx: 1999, sy: 0, sw: 1, sh: 1600, dx: 1211, dy: 0, dw: 211, dh: 800 },
    ]);
  });

  it("stretches the top and bottom rows for a taller canvas", () => {
    const doc = taller(0.5); // picture at y 200
    expect(planFillSource(doc, { width: 1000, height: 800 }).ops).toEqual([
      { sx: 0, sy: 0, sw: 1000, sh: 800, dx: 0, dy: 200, dw: 1000, dh: 800 },
      { sx: 0, sy: 0, sw: 1000, sh: 1, dx: 0, dy: 0, dw: 1000, dh: 200 },
      { sx: 0, sy: 799, sw: 1000, sh: 1, dx: 0, dy: 1000, dw: 1000, dh: 200 },
    ]);
  });

  it("has a fixed English instruction per side, never customer text", () => {
    expect(fillInstruction("left")).toContain("LEFT edge");
    expect(fillInstruction("bottom")).toContain("BOTTOM edge");
    expect(fillInstruction("right")).toMatch(/Add no new objects, people or text\./);
  });
});

describe("undo and redo keep the picture where it is on screen", () => {
  it("moves the pan by the opposite of the picture's move, times the zoom", () => {
    const before = picture();
    const after = canvasForRatio(before, "16:9"); // picture moves to x 211
    const view = { zoom: 0.5, panX: 100, panY: 50 };
    expect(holdPictureView(view, before, after)).toEqual({ zoom: 0.5, panX: 100 - 211 * 0.5, panY: 50 });
    expect(holdPictureView(holdPictureView(view, before, after), after, before)).toEqual(view);
    // Nothing moved: the same view object.
    expect(holdPictureView(view, before, { ...before, layers: [] })).toBe(view);
  });
});
