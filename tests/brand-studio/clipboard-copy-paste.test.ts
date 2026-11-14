import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import {
  clearStudioCopiedLayer,
  extractClipboardImages,
  getStudioCopiedLayer,
  isEditableTextTarget,
  setStudioCopiedLayer,
  studioDrawableImageUrl,
  type ClipboardDataLike,
} from "@/lib/brand-studio/clipboard-image";
import { planCropExport } from "@/components/brand-studio/layers/export";
import {
  addLayer,
  createImageLayer,
  createTextLayer,
  emptyDoc,
  pasteLayer,
  setBaseHidden,
  updateLayer,
  type Layer,
} from "@/components/brand-studio/layers/model";

describe("studio clipboard image copy & paste (Ctrl+C / Ctrl+V)", () => {
  beforeEach(() => {
    clearStudioCopiedLayer();
  });

  it("extracts screenshot / Copy-Image blobs from clipboardData.items and stamps unique filenames", () => {
    const rawPng1 = new File([new Uint8Array([137, 80, 78, 71, 1])], "image.png", { type: "image/png", lastModified: 100 });
    const rawPng2 = new File([new Uint8Array([137, 80, 78, 71, 2, 3])], "", { type: "image/png", lastModified: 101 });
    const textItem = {
      kind: "string",
      type: "text/plain",
      getAsFile: () => null,
    };
    const data: ClipboardDataLike = {
      items: [
        textItem,
        { kind: "file", type: "image/png", getAsFile: () => rawPng1 },
        { kind: "file", type: "image/png", getAsFile: () => rawPng2 },
      ],
      files: [],
    };

    const extracted = extractClipboardImages(data, 1700000000000);
    expect(extracted).toHaveLength(2);
    expect(extracted[0]!.name).toBe("clipboard-1700000000000-1.png");
    expect(extracted[1]!.name).toBe("clipboard-1700000000000-2.png");
    expect(extracted[0]!.type).toBe("image/png");
  });

  it("deduplicates when browsers populate both clipboardData.items and clipboardData.files and keeps named files", () => {
    const namedFile = new File([new Uint8Array([1, 2, 3, 4])], "packshot-hero.webp", {
      type: "image/webp",
      lastModified: 555,
    });
    const duplicateClone = new File([new Uint8Array([1, 2, 3, 4])], "packshot-hero.webp", {
      type: "image/webp",
      lastModified: 555,
    });
    const pdfFile = new File([new Uint8Array([9, 9])], "brief.pdf", { type: "application/pdf", lastModified: 555 });

    const data: ClipboardDataLike = {
      items: [
        { kind: "file", type: "image/webp", getAsFile: () => namedFile },
        { kind: "file", type: "application/pdf", getAsFile: () => pdfFile },
      ],
      files: [duplicateClone, pdfFile],
    };

    const extracted = extractClipboardImages(data, 1700000000999);
    expect(extracted).toHaveLength(1);
    expect(extracted[0]!.name).toBe("packshot-hero.webp");
    expect(extracted[0]!.type).toBe("image/webp");
  });

  it("isolates internal copied layers via deep clone and tracks written clipboard byteLength", () => {
    const doc = emptyDoc(1080, 1350);
    const layer = createTextLayer(doc, { text: "NEW COLLECTION", name: "헤드라인 1" });
    setStudioCopiedLayer(layer, 4096);

    // Mutating the original object must not mutate the stored clipboard entry.
    (layer as { text: string }).text = "MUTATED";

    const readBack = getStudioCopiedLayer<Layer>();
    expect(readBack).not.toBeNull();
    expect(readBack!.writtenByteLength).toBe(4096);
    expect(readBack!.layer.kind).toBe("text");
    if (readBack!.layer.kind === "text") {
      expect(readBack!.layer.text).toBe("NEW COLLECTION");
    }
  });

  it("pasteLayer nudges colliding layers, unlocks locked layers, and fits oversized cross-canvas layers", () => {
    let doc = emptyDoc(1000, 1000);
    const img = createImageLayer(doc, {
      url: "https://cdn.example.com/logo.png",
      ref: { assetId: "asset-1" },
      name: "로고 1",
      natural: { width: 400, height: 200 },
    });
    doc = addLayer(doc, img);
    doc = updateLayer(doc, img.id, { locked: true });

    const lockedSource = doc.layers[0]!;
    const firstPaste = pasteLayer(doc, lockedSource, { suffix: "사본" });
    expect(firstPaste.id).not.toBeNull();
    expect(firstPaste.id).not.toBe(lockedSource.id);
    expect(firstPaste.doc.layers).toHaveLength(2);
    const pasted = firstPaste.doc.layers[1]!;
    expect(pasted.locked).toBe(false);
    expect(pasted.x).toBeGreaterThan(lockedSource.x);
    expect(pasted.y).toBeGreaterThan(lockedSource.y);

    // Pasting an oversized layer onto a smaller canvas scales and centers cleanly.
    const smallCanvas = emptyDoc(300, 300);
    const hugeSource: Layer = {
      ...lockedSource,
      x: 1800,
      y: 1800,
      w: 1200,
      h: 600,
    };
    const fitted = pasteLayer(smallCanvas, hugeSource, { suffix: "사본" });
    const fittedLayer = fitted.doc.layers[0]!;
    expect(fittedLayer.w).toBeLessThanOrEqual(270);
    expect(fittedLayer.h).toBeLessThanOrEqual(270);
    expect(fittedLayer.x).toBeGreaterThanOrEqual(0);
    expect(fittedLayer.y).toBeGreaterThanOrEqual(0);
  });

  it("planCropExport shifts base and visible layers into marquee crop coordinates and honors baseHidden", () => {
    let doc = emptyDoc(1000, 800);
    const img = createImageLayer(doc, {
      url: "https://cdn.example.com/patch.png",
      ref: null,
      name: "패치 1",
      natural: { width: 200, height: 200 },
      at: { x: 500, y: 400 },
    });
    doc = addLayer(doc, img);

    const base = { url: "https://cdn.example.com/base.png", width: 1000, height: 800, name: "바탕 이미지" };
    const crop = planCropExport(doc, base, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, () => (t) => t.length * 10);

    expect(crop.box).toEqual({ x: 250, y: 200, w: 500, h: 400 });
    expect(crop.plan.width).toBe(500);
    expect(crop.plan.height).toBe(400);
    expect(crop.plan.ops).toHaveLength(2);
    expect(crop.plan.ops[0]!.frame.x).toBe(-250);
    expect(crop.plan.ops[0]!.frame.y).toBe(-200);
    expect(crop.plan.ops[1]!.frame.x).toBe(img.x - 250);
    expect(crop.plan.ops[1]!.frame.y).toBe(img.y - 200);

    const hiddenBaseCrop = planCropExport(setBaseHidden(doc, true), base, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, () => (t) => t.length * 10);
    expect(hiddenBaseCrop.plan.ops).toHaveLength(1);
    expect(hiddenBaseCrop.plan.ops[0]!.layerId).toBe(img.id);
  });

  it("keeps data/blob URLs untouched in studioDrawableImageUrl and detects editable targets safely", () => {
    expect(studioDrawableImageUrl("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(studioDrawableImageUrl("blob:https://twings.app/123")).toBe("blob:https://twings.app/123");
    expect(isEditableTextTarget(null)).toBe(false);
  });

  it("wires Ctrl+C / Ctrl+V clipboard image support across all 7 image & video studio surfaces", () => {
    const surfaces = [
      "components/brand-studio/layers/index.tsx",
      "components/brand-studio/layers/region-panel.tsx",
      "components/brand-studio/gallery/region-form.tsx",
      "components/brand-studio/viewer.tsx",
      "components/brand-studio/studio-app.tsx",
      "components/brand-studio/dock.tsx",
      "components/brand-studio/video/workspace.tsx",
    ];
    for (const rel of surfaces) {
      const src = readFileSync(path.resolve(process.cwd(), rel), "utf8");
      expect(src, `${rel} must import clipboard-image helpers`).toContain("@/lib/brand-studio/clipboard-image");
    }
  });
});
