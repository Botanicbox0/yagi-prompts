import { readFileSync } from "node:fs";
import path from "node:path";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { planRegionWindow } from "@/lib/brand-studio/region-edit/window";
import { planRegion } from "@/lib/brand-studio/region-edit/plan";
import { regionV2Models, REGION_V2_MODEL } from "@/lib/brand-studio/models";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { RegionEditPanel } from "@/components/brand-studio/layers/region-panel";
import { RegionForm } from "@/components/brand-studio/gallery/region-form";
import { regionInputFrame } from "@/components/brand-studio/region-math";
import type { RegionBox } from "@/lib/brand-studio/contracts";
import { copyFor } from "../ui/fixtures";

/**
 * Founder review 2026-11-25: the 부분 수정 preview squeezed a portrait selection into a landscape box, so it
 * was unclear what went in as image 1. The preview now shows exactly what is sent, at its true shape:
 * with the one region engine (v2) the window the server cuts around the selection (planRegionWindow), with
 * the selection outlined inside it; otherwise the box itself.
 */

/** The founder's case: a 251 x 340 selection on a full-body 3:4 picture (Seedream 2K, 1728 x 2304). */
const PICTURE_34 = { width: 1728, height: 2304 };
const FOUNDER_BOX: RegionBox = { x: 700 / 1728, y: 600 / 2304, w: 251 / 1728, h: 340 / 2304 };
/** The same selection on a 4:5 picture (not a shape the engine takes as it is). */
const PICTURE_45 = { width: 1600, height: 2000 };
const BOX_45: RegionBox = { x: 640 / 1600, y: 500 / 2000, w: 251 / 1600, h: 340 / 2000 };

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

describe("regionInputFrame (what goes in as image 1)", () => {
  for (const [name, picture, box] of [
    ["3:4", PICTURE_34, FOUNDER_BOX],
    ["4:5", PICTURE_45, BOX_45],
  ] as const) {
    it(`v2 on a ${name} picture: the frame is the server's window, its ratio the window's, the selection inside it`, () => {
      const plan = planRegionWindow(picture, box);
      const input = regionInputFrame(picture, box, true);
      expect(close(input.frame.x * picture.width, plan.roi.left)).toBe(true);
      expect(close(input.frame.y * picture.height, plan.roi.top)).toBe(true);
      expect(close(input.frame.w * picture.width, plan.roi.width)).toBe(true);
      expect(close(input.frame.h * picture.height, plan.roi.height)).toBe(true);
      expect(close(input.ratio, plan.roi.width / plan.roi.height)).toBe(true);
      const s = plan.select!;
      expect(input.selection).not.toBeNull();
      expect(close(input.selection!.x, (s.left - plan.roi.left) / plan.roi.width)).toBe(true);
      expect(close(input.selection!.y, (s.top - plan.roi.top) / plan.roi.height)).toBe(true);
      expect(close(input.selection!.w, s.width / plan.roi.width)).toBe(true);
      expect(close(input.selection!.h, s.height / plan.roi.height)).toBe(true);
      // A tall picture and a tall selection: a tall preview.
      expect(input.ratio).toBeLessThan(1);
    });
  }

  it("without the region engine (legacy) the frame is the box itself, at the box's pixel shape", () => {
    const input = regionInputFrame(PICTURE_34, FOUNDER_BOX, false);
    expect(input.frame).toEqual(FOUNDER_BOX);
    expect(input.selection).toBeNull();
    expect(close(input.ratio, 251 / 340, 0.01)).toBe(true);
    expect(input.ratio).toBeLessThan(1);
  });

  it("with no known size it falls back to the box", () => {
    const input = regionInputFrame({ width: null, height: null }, FOUNDER_BOX, true);
    expect(input.frame).toEqual(FOUNDER_BOX);
    expect(input.selection).toBeNull();
  });
});

describe("what the server sends as image 1 is never stretched (v2)", () => {
  for (const [name, picture, box] of [
    ["3:4", PICTURE_34, FOUNDER_BOX],
    ["4:5", PICTURE_45, BOX_45],
    ["2:3 at 3000 px", { width: 3000, height: 4500 }, { x: 0.4, y: 0.25, w: 0.145, h: 0.148 }],
  ] as const) {
    it(`${name}: the cut and the size it is sent at have the same shape (1 px rounding at most)`, () => {
      const plan = planRegionWindow(picture, box);
      const kx = plan.work.width / plan.roi.width;
      const ky = plan.work.height / plan.roi.height;
      // Same scale on both sides, up to rounding of one pixel on the short scaled side.
      expect(Math.abs(plan.work.height - Math.round(plan.roi.height * kx))).toBeLessThanOrEqual(1);
      expect(Math.abs(kx - ky)).toBeLessThan(1 / Math.min(plan.work.width, plan.work.height) + 1e-9);
    });
  }

  it("the founder's portrait selection on a 3:4 picture goes whole, 1:1, at 3:4", () => {
    const plan = planRegionWindow(PICTURE_34, FOUNDER_BOX);
    expect(plan.aspect).toBe("3:4");
    expect(plan.roi).toEqual({ left: 0, top: 0, width: 1728, height: 2304 });
    expect(plan.work).toEqual({ width: 1728, height: 2304 });
  });

  it("the legacy crop keeps its shape whenever an aspect holds the box (only its no-fit fallback stretches)", () => {
    const plan = planRegion(PICTURE_34, FOUNDER_BOX, ["1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2"]);
    const roiRatio = plan.roi.width / plan.roi.height;
    const workRatio = plan.work.width / plan.work.height;
    expect(Math.abs(Math.log(roiRatio / workRatio))).toBeLessThan(0.01);
  });
});

describe("the preview markup", () => {
  const layersCopy = getDictionary("ko").studioLayers;
  const panel = (fixedModel: boolean) =>
    renderToStaticMarkup(
      <RegionEditPanel
        copy={layersCopy}
        locale="ko"
        baseSize={PICTURE_45}
        baseImgRef={createRef()}
        region={{
          sourceRef: { outputId: "30000000-0000-4000-8000-0000000000a1" },
          previewUrl: "/p.png",
          models: regionV2Models(),
          defaultModel: REGION_V2_MODEL,
          defaultQuality: null,
          ...(fixedModel ? { fixedModel: true } : {}),
          jobs: [],
          errorText: () => "",
          submit: async () => ({ ok: false, message: "" }),
          enhancePrompt: async () => ({ ok: true, finalPrompt: "" }),
        }}
        box={BOX_45}
        quickItems={[]}
        uploading={false}
        onBox={() => {}}
        resolveRef={() => null}
        onUploadRefs={async () => []}
        onSubmitted={() => {}}
      />,
    );

  it("v2: the crop has the window's shape and the selection is outlined inside it", () => {
    const plan = planRegionWindow(PICTURE_45, BOX_45);
    const html = panel(true);
    expect(html).toContain(`aspect-ratio:${plan.roi.width} / ${plan.roi.height}`);
    expect(html).toContain("data-layers-region-select");
    const s = plan.select!;
    const pct = (v: number) => `${((v) * 100).toFixed(3)}%`;
    expect(html).toContain(`left:${pct((s.left - plan.roi.left) / plan.roi.width)}`);
    expect(html).toContain(`height:${pct(s.height / plan.roi.height)}`);
  });

  it("legacy: the crop is the box, with no outline", () => {
    const html = panel(false);
    expect(html).toContain(`aspect-ratio:251 / 340`);
    expect(html).not.toContain("data-layers-region-select");
  });

  it("the older viewer form shows the window too when the region engine is fixed", () => {
    const copy = copyFor("ko");
    const plan = planRegionWindow(PICTURE_45, BOX_45);
    const html = renderToStaticMarkup(
      <RegionForm
        picture={{ url: "/p.png", ...PICTURE_45 }}
        box={BOX_45}
        wide
        copy={copy}
        locale="ko"
        models={regionV2Models()}
        model={REGION_V2_MODEL}
        quality=""
        references={[]}
        recent={[]}
        instruction=""
        note={null}
        credits={0}
        uploading={false}
        onBox={() => {}}
        onModel={() => {}}
        onQuality={() => {}}
        onReferences={() => {}}
        resolve={() => null}
        onFiles={() => {}}
        onInstruction={() => {}}
        onCancel={() => {}}
        onSend={() => {}}
      />,
    );
    expect(html).toContain(`aspect-ratio:${plan.roi.width} / ${plan.roi.height}`);
    expect(html).toContain("data-studio-region-select");
  });
});

describe("the preview is letterboxed, never stretched (CSS)", () => {
  const rule = (css: string, selector: string) => {
    const at = css.indexOf(`${selector} {`);
    expect(at).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf("}", at));
  };
  it("layer editor: the crop's width follows its own ratio inside a fixed-height stage, with no max-height squeeze", () => {
    const css = readFileSync(path.join(process.cwd(), "components/brand-studio/layers/layers.css"), "utf8");
    const crop = rule(css, ".bsl-region-crop");
    expect(crop).not.toMatch(/max-height/);
    expect(crop).toMatch(/width:\s*min\(100%,\s*calc\(var\(--bsl-region-h\)\s*\*\s*var\(--crop-r/);
    expect(rule(css, ".bsl-region-stage")).toMatch(/height:\s*var\(--bsl-region-h\)/);
  });
  it("the selection outline is drawn inside its box, so it never spills past the preview at the frame edge", () => {
    const layers = readFileSync(path.join(process.cwd(), "components/brand-studio/layers/layers.css"), "utf8");
    const viewer = readFileSync(path.join(process.cwd(), "app/(brand)/studio-v2.css"), "utf8");
    for (const shadow of [/box-shadow:([^;]+);/.exec(rule(layers, ".bsl-region-select"))?.[1], /box-shadow:([^;]+);/.exec(rule(viewer, ".bs-region-select"))?.[1]]) {
      expect(shadow).toBeTruthy();
      for (const part of shadow!.split(/,(?![^(]*\))/)) expect(part.trim()).toMatch(/^inset\b/);
    }
  });
  it("viewer form: the crop keeps the ratio-derived width and sets no max-height", () => {
    const css = readFileSync(path.join(process.cwd(), "app/(brand)/studio-v2.css"), "utf8");
    const crop = rule(css, ".bs-region-crop");
    expect(crop).not.toMatch(/max-height/);
    expect(crop).toMatch(/--crop-r/);
  });
});
