import { describe, expect, it } from "vitest";
import {
  BASE_OP_ID,
  baselineY,
  drawPlan,
  exportFileName,
  imageSources,
  planExport,
  renderPlan,
  shapeGeometry,
  type CanvasLike,
  type ExportPlan,
  type RenderDeps,
} from "@/components/brand-studio/layers/export";
import { addLayer, createImageLayer, createShapeLayer, createTextLayer, emptyDoc, updateLayer, type LayerDoc } from "@/components/brand-studio/layers/model";
import { graphemes } from "@/components/brand-studio/layers/text-layout";

const mono = () => (text: string) => graphemes(text).length * 10;
const base = { url: "/api/brand-studio/media/st/base.png", width: 1000, height: 800, name: "바탕 이미지" };

function sample(): LayerDoc {
  let doc = emptyDoc(1000, 800);
  doc = addLayer(doc, createImageLayer(doc, { url: "/api/brand-studio/media/st/logo.png", ref: null, name: "로고", natural: { width: 200, height: 100 }, id: "logo" }));
  doc = addLayer(doc, { ...createTextLayer(doc, { text: "aaaa bbbb cc", name: "제목", id: "title" }), x: 100, y: 50, w: 100, size: 20, lineHeight: 1.5, letterSpacing: 0.1, align: "left" });
  doc = addLayer(doc, createShapeLayer(doc, { shape: "rect", name: "판", id: "box" }));
  return doc;
}

type Call = [string, ...unknown[]];

function recorder(opts: { letterSpacing?: boolean } = {}) {
  const calls: Call[] = [];
  const ctx: Record<string, unknown> = { globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "start", textBaseline: "alphabetic" };
  if (opts.letterSpacing !== false) ctx.letterSpacing = "0px";
  for (const name of ["save", "restore", "translate", "rotate", "drawImage", "beginPath", "moveTo", "arcTo", "closePath", "rect", "ellipse", "fill", "stroke"]) {
    ctx[name] = (...args: unknown[]) => calls.push([name, ...args]);
  }
  ctx.fillText = (...args: unknown[]) => calls.push(["fillText", ...args, ctx.letterSpacing ?? null, ctx.font]);
  ctx.measureText = (text: string) => ({ width: graphemes(text).length * 10, fontBoundingBoxAscent: 16, fontBoundingBoxDescent: 4 });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

function fakeCanvas(results: Array<{ type: string; size: number } | null | Error>): CanvasLike & { requested: string[] } {
  const { ctx } = recorder();
  const requested: string[] = [];
  let i = 0;
  return {
    requested,
    getContext: () => ctx,
    toBlob(callback, type) {
      requested.push(type ?? "");
      const next = results[i++] ?? null;
      if (next instanceof Error) throw next;
      callback(next ? new Blob([new Uint8Array(next.size)], { type: next.type }) : null);
    },
  };
}

const deps = (over: Partial<RenderDeps> = {}): RenderDeps => ({
  loadImage: async () => ({}) as CanvasImageSource,
  family: () => "'Pretendard Variable', sans-serif",
  createCanvas: () => fakeCanvas([{ type: "image/png", size: 100 }]),
  ...over,
});

describe("export plan", () => {
  it("draws the base first, then visible layers bottom to top", () => {
    let doc = sample();
    doc = updateLayer(doc, "box", { hidden: true });
    const plan = planExport(doc, base, mono);
    expect(plan.width).toBe(1000);
    expect(plan.ops.map((o) => o.layerId)).toEqual([BASE_OP_ID, "logo", "title"]);
    expect(plan.ops[0]).toMatchObject({ kind: "image", url: base.url, frame: { x: 0, y: 0, w: 1000, h: 800 } });
  });

  it("skips fully transparent layers", () => {
    const plan = planExport(updateLayer(sample(), "logo", { opacity: 0 }), base, mono);
    expect(plan.ops.some((o) => o.layerId === "logo")).toBe(false);
  });

  it("lays out text exactly as the stage does and sizes the box from the lines", () => {
    const plan = planExport(sample(), base, mono);
    const text = plan.ops.find((o) => o.kind === "text");
    if (text?.kind !== "text") throw new Error("no text op");
    // 2 px spacing per character: "aaaa bbbb" is 108 px, wider than 100; "bbbb cc" is 84 px.
    expect(text.layout.lines.map((l) => l.text)).toEqual(["aaaa", "bbbb cc"]);
    expect(text.frame.h).toBe(60);
    expect(text.spacingPx).toBe(2);
  });

  it("lists every picture once with the layers that use it", () => {
    let doc = sample();
    doc = addLayer(doc, createImageLayer(doc, { url: "/api/brand-studio/media/st/logo.png", ref: null, name: "로고 2", natural: null, id: "logo2" }));
    const sources = imageSources(planExport(doc, base, mono));
    expect(sources.get("/api/brand-studio/media/st/logo.png")).toEqual(["로고", "로고 2"]);
    expect(sources.get(base.url)).toEqual(["바탕 이미지"]);
  });
});

describe("shared geometry", () => {
  it("keeps a stroke inside the box and shrinks the corner radius with it", () => {
    expect(shapeGeometry({ shape: "rect", stroke: "#000000", strokeWidth: 10, radius: 20 }, 100, 50)).toEqual({ kind: "rect", x: 5, y: 5, w: 90, h: 40, radius: 15, strokeWidth: 10 });
    expect(shapeGeometry({ shape: "rect", stroke: null, strokeWidth: 10, radius: 200 }, 100, 50)).toMatchObject({ x: 0, w: 100, radius: 25, strokeWidth: 0 });
  });

  it("puts the baseline where CSS puts it inside a line box", () => {
    const layout = { lines: [], lineHeightPx: 30, pad: 10, contentWidth: 100, height: 50 };
    // half-leading (30 - 20) / 2 = 5, then the ascent.
    expect(baselineY(layout, 0, 16, 4)).toBe(10 + 5 + 16);
    expect(baselineY(layout, 2, 16, 4)).toBe(10 + 60 + 5 + 16);
  });
});

describe("drawing", () => {
  it("draws images at their frame and text line by line with spacing", () => {
    const { ctx, calls } = recorder();
    const plan = planExport(sample(), base, mono);
    const images = new Map<string, CanvasImageSource>([
      [base.url, { id: "base" } as unknown as CanvasImageSource],
      ["/api/brand-studio/media/st/logo.png", { id: "logo" } as unknown as CanvasImageSource],
    ]);
    drawPlan(ctx, plan, images, () => "'Pretendard Variable', sans-serif");
    const draws = calls.filter((c) => c[0] === "drawImage");
    expect(draws[0]).toEqual(["drawImage", { id: "base" }, 0, 0, 1000, 800]);
    const texts = calls.filter((c) => c[0] === "fillText");
    expect(texts.map((c) => c[1])).toEqual(["aaaa", "bbbb cc"]);
    // line 2 baseline: 30 * 1 + (30 - 20) / 2 + 16
    expect(texts[1]![3]).toBe(30 + 5 + 16);
    expect(texts[0]![4]).toBe("2px");
    expect(texts[0]![5]).toBe("700 20px 'Pretendard Variable', sans-serif");
    // Each op is wrapped in save/restore so opacity and rotation never leak.
    expect(calls.filter((c) => c[0] === "save")).toHaveLength(plan.ops.length);
    expect(calls.filter((c) => c[0] === "restore")).toHaveLength(plan.ops.length);
  });

  it("rotates around the layer's centre", () => {
    const { ctx, calls } = recorder();
    const doc = updateLayer(sample(), "box", { rotation: 90 });
    drawPlan(ctx, planExport(doc, base, mono), new Map(), () => "x");
    expect(calls.some((c) => c[0] === "rotate" && Math.abs((c[1] as number) - Math.PI / 2) < 1e-9)).toBe(true);
  });

  it("places characters one by one where the engine has no letter spacing", () => {
    const { ctx, calls } = recorder({ letterSpacing: false });
    drawPlan(ctx, planExport(sample(), base, mono), new Map(), () => "x");
    const first = calls.filter((c) => c[0] === "fillText").slice(0, 4);
    expect(first.map((c) => [c[1], c[2]])).toEqual([
      ["a", 0],
      ["a", 12],
      ["a", 24],
      ["a", 36],
    ]);
  });
});

describe("rendering", () => {
  const plan = (): ExportPlan => planExport(sample(), base, mono);

  it("encodes PNG and reports each step", async () => {
    const steps: string[] = [];
    const result = await renderPlan(plan(), deps({ onStep: (s) => steps.push(s) }));
    expect(result.ok && result.mime).toBe("image/png");
    expect(steps).toEqual(["fonts", "images", "drawing", "saving"]);
  });

  it("names the layers whose picture failed and makes no file", async () => {
    const result = await renderPlan(
      plan(),
      deps({ loadImage: async (url) => (url.includes("logo") ? Promise.reject(new Error("404")) : ({} as CanvasImageSource)) }),
    );
    expect(result).toEqual({ ok: false, reason: "image", names: ["로고"] });
  });

  it("falls back to WebP, then JPEG, when the PNG is over the limit", async () => {
    const canvas = fakeCanvas([
      { type: "image/png", size: 2000 },
      { type: "image/png", size: 1500 }, // an engine that answers a WebP request with PNG
      { type: "image/jpeg", size: 800 },
    ]);
    const result = await renderPlan(plan(), deps({ createCanvas: () => canvas }), 1000);
    expect(canvas.requested).toEqual(["image/png", "image/webp", "image/jpeg"]);
    expect(result.ok && result.mime).toBe("image/jpeg");
  });

  it("says when nothing fits under the limit", async () => {
    const canvas = fakeCanvas([
      { type: "image/png", size: 2000 },
      { type: "image/webp", size: 1500 },
      { type: "image/jpeg", size: 1200 },
    ]);
    expect(await renderPlan(plan(), deps({ createCanvas: () => canvas }), 1000)).toEqual({ ok: false, reason: "too-big" });
  });

  it("reports a tainted canvas and a missing canvas plainly", async () => {
    const blocked = Object.assign(new Error("tainted"), { name: "SecurityError" });
    expect(await renderPlan(plan(), deps({ createCanvas: () => fakeCanvas([blocked]) }))).toEqual({ ok: false, reason: "blocked" });
    expect(await renderPlan(plan(), deps({ createCanvas: () => null }))).toEqual({ ok: false, reason: "canvas" });
    expect(await renderPlan(plan(), deps({ createCanvas: () => fakeCanvas([null]) }))).toEqual({ ok: false, reason: "canvas" });
  });
});

describe("file name", () => {
  it("is the picture's name plus the suffix, without its extension or unsafe characters", () => {
    expect(exportFileName("봄 캠페인.png", "꾸미기")).toBe("봄 캠페인-꾸미기.png");
    expect(exportFileName("a/b:c*?.jpg", "꾸미기", "image/jpeg")).toBe("a-b-c-꾸미기.jpg");
    expect(exportFileName(null, "design")).toBe("twings-design.png");
    expect(exportFileName("   ", "design", "image/webp")).toBe("twings-design.webp");
    expect(exportFileName("x".repeat(200), "design").length).toBeLessThanOrEqual(60 + "-design.png".length);
  });
});
