import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLATE,
  MAX_LAYERS,
  MIN_SIDE,
  SWATCHES,
  addLayer,
  canMove,
  createImageLayer,
  createShapeLayer,
  createTextLayer,
  duplicateLayer,
  emptyDoc,
  moveLayer,
  nearestWeight,
  nextName,
  normalizeAngle,
  removeLayer,
  updateLayer,
  withPlate,
  type LayerDoc,
} from "@/components/brand-studio/layers/model";

const doc0 = () => emptyDoc(1000, 800);

function three(): LayerDoc {
  let doc = doc0();
  doc = addLayer(doc, createShapeLayer(doc, { shape: "rect", name: "A", id: "a" }));
  doc = addLayer(doc, createShapeLayer(doc, { shape: "ellipse", name: "B", id: "b" }));
  doc = addLayer(doc, createTextLayer(doc, { text: "Hi", name: "C", id: "c" }));
  return doc;
}

describe("layer document", () => {
  it("creates layers centred on the picture, in base pixels", () => {
    const doc = doc0();
    const shape = createShapeLayer(doc, { shape: "rect", name: "R" });
    expect(shape.x + shape.w / 2).toBeCloseTo(500);
    expect(shape.y + shape.h / 2).toBeCloseTo(400);
    const text = createTextLayer(doc, { text: "Hello", name: "T", at: { x: 100, y: 100 } });
    expect(text.x + text.w / 2).toBeCloseTo(100);
    expect(text.font).toBe("pretendard");
    expect(text.color).toBe(SWATCHES.black);
  });

  it("places an image at its own ratio, never larger than the picture", () => {
    const doc = doc0();
    const logo = createImageLayer(doc, { url: "/api/brand-studio/media/st/x.png", ref: null, name: "logo", natural: { width: 400, height: 100 } });
    expect(logo.w / logo.h).toBeCloseTo(4);
    expect(logo.w).toBeLessThanOrEqual(doc.width * 0.9);
    const tiny = createImageLayer(doc, { url: "/x.png", ref: null, name: "t", natural: { width: 20, height: 10 } });
    expect(tiny.w).toBe(20);
    const unknown = createImageLayer(doc, { url: "/x.png", ref: null, name: "u", natural: null });
    expect(unknown.w).toBeCloseTo(unknown.h);
  });

  it("returns the same document for a patch that changes nothing", () => {
    const doc = three();
    expect(updateLayer(doc, "a", { x: doc.layers[0]!.x })).toBe(doc);
    expect(updateLayer(doc, "missing", { x: 5 })).toBe(doc);
    const moved = updateLayer(doc, "a", { x: 1 });
    expect(moved).not.toBe(doc);
    // Untouched layers are shared, so the history stays cheap.
    expect(moved.layers[1]).toBe(doc.layers[1]);
  });

  it("keeps values in range after an edit", () => {
    const doc = three();
    const next = updateLayer(doc, "a", { w: -10, opacity: 3, rotation: 270 });
    const a = next.layers[0]!;
    expect(a.w).toBe(MIN_SIDE);
    expect(a.opacity).toBe(1);
    expect(a.rotation).toBe(-90);
    const text = updateLayer(doc, "c", { font: "display", weight: 400 }).layers[2]!;
    expect(text.kind === "text" && text.weight).toBe(700);
  });

  it("normalises angles into (-180, 180]", () => {
    expect(normalizeAngle(180)).toBe(180);
    expect(normalizeAngle(-180)).toBe(180);
    expect(normalizeAngle(190)).toBe(-170);
    expect(normalizeAngle(-370)).toBe(-10);
    expect(normalizeAngle(-0)).toBe(0);
  });

  it("picks the nearest weight a font has", () => {
    expect(nearestWeight("pretendard", 640)).toBe(600);
    expect(nearestWeight("display", 300)).toBe(700);
    expect(nearestWeight("mono", 900)).toBe(400);
  });

  it("duplicates right above the original, offset and unlocked", () => {
    let doc = three();
    doc = updateLayer(doc, "a", { locked: true });
    const { doc: next, id } = duplicateLayer(doc, "a", { newId: "a2", suffix: "copy" });
    expect(id).toBe("a2");
    expect(next.layers.map((l) => l.id)).toEqual(["a", "a2", "b", "c"]);
    const copy = next.layers[1]!;
    expect(copy.name).toBe("A copy");
    expect(copy.locked).toBe(false);
    expect(copy.x).toBeGreaterThan(doc.layers[0]!.x);
  });

  it("moves a layer one step and refuses past the ends", () => {
    const doc = three();
    expect(moveLayer(doc, "a", 1).layers.map((l) => l.id)).toEqual(["b", "a", "c"]);
    expect(moveLayer(doc, "c", -1).layers.map((l) => l.id)).toEqual(["a", "c", "b"]);
    expect(moveLayer(doc, "c", 1)).toBe(doc);
    expect(moveLayer(doc, "a", -1)).toBe(doc);
    expect(canMove(doc, "a", -1)).toBe(false);
    expect(canMove(doc, "a", 1)).toBe(true);
  });

  it("removes a layer and ignores unknown ids", () => {
    const doc = three();
    expect(removeLayer(doc, "b").layers.map((l) => l.id)).toEqual(["a", "c"]);
    expect(removeLayer(doc, "zz")).toBe(doc);
  });

  it("stops adding at the layer limit", () => {
    let doc = doc0();
    for (let i = 0; i < MAX_LAYERS + 3; i++) doc = addLayer(doc, createShapeLayer(doc, { shape: "rect", name: `s${i}`, id: `s${i}` }));
    expect(doc.layers).toHaveLength(MAX_LAYERS);
  });

  it("names new layers with the next free number", () => {
    const doc = three();
    expect(nextName(doc, "A")).toBe("A 1");
    const named = addLayer(doc, createShapeLayer(doc, { shape: "rect", name: "Shape 1", id: "s1" }));
    expect(nextName(named, "Shape")).toBe("Shape 2");
  });

  it("turns the text background on and off without moving the words", () => {
    const doc = doc0();
    const text = createTextLayer(doc, { text: "Sale", name: "T" });
    const on = { ...text, ...withPlate(text, DEFAULT_PLATE) };
    const pad = DEFAULT_PLATE.padding * text.size;
    expect(on.x).toBeCloseTo(text.x - pad);
    expect(on.w).toBeCloseTo(text.w + pad * 2);
    const off = { ...on, ...withPlate(on as typeof text, null) };
    expect(off.x).toBeCloseTo(text.x);
    expect(off.w).toBeCloseTo(text.w);
    expect(off.plate).toBeNull();
  });
});
