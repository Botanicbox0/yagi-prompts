import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { regionCredits, regionEditInput, regionProblem } from "@/components/brand-studio/dock-model";
import { fill } from "@/components/brand-studio/copy";
import { RegionEditPanel } from "@/components/brand-studio/layers/region-panel";
import type { LayerEditorRegionSupport } from "@/components/brand-studio/seams";
import { trayItemFromAsset } from "@/components/brand-studio/refs";
import { Viewer, type RegionSupport, type ViewerActions, type ViewerProps } from "@/components/brand-studio/viewer";
import { REGION_V2_MODEL, regionEditModels, regionV2Models } from "@/lib/brand-studio/models";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { asset, copyFor, job, output } from "./fixtures";

/**
 * Region edit v2 (`StudioState.regionV2`): we pick the engine, the customer is not given a picker.
 * No model or quality select anywhere a part of a picture is edited; the credits are the one engine's.
 */
const noop = () => {};
const actions: ViewerActions = { regionEdit: async () => true, rerun: noop, toVideo: noop, reference: noop, save: noop, campaign: noop, finalize: noop, reuse: noop, remove: async () => true };
const fixed: RegionSupport = {
  models: regionV2Models(),
  defaultModel: REGION_V2_MODEL,
  defaultQuality: null,
  fixedModel: true,
  recent: [trayItemFromAsset(asset(7))],
  resolve: () => null,
  upload: async () => [],
};
const choice: RegionSupport = { ...fixed, models: regionEditModels(), defaultModel: "nano-banana-pro", fixedModel: undefined };

function viewer(region: RegionSupport, preset: Partial<NonNullable<ViewerProps["regionPreset"]>> = {}, locale: "ko" | "en" = "ko") {
  const parent = output(9);
  return renderToStaticMarkup(
    <Viewer items={[{ type: "output", output: parent, job: job(9, { outputs: [parent] }) }]} index={0} copy={copyFor(locale)} locale={locale} canCreate canGenerate busy={null} notice={null}
      parentOf={() => null} onIndex={noop} onClose={noop} actions={actions} region={region}
      regionPreset={{ key: `o:${parent.id}`, box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, instruction: "로고를 지워줘", ...preset }} />,
  );
}

function panel(region: Partial<LayerEditorRegionSupport>, preset?: { model?: string; quality?: string | null }) {
  const layersCopy = getDictionary("ko").studioLayers;
  const base: LayerEditorRegionSupport = {
    sourceRef: { assetId: asset(1).id },
    previewUrl: asset(1).url,
    models: regionEditModels(),
    defaultModel: "nano-banana-pro",
    defaultQuality: null,
    jobs: [],
    errorText: () => "오류",
    submit: async () => ({ ok: false, message: "noop" }),
    enhancePrompt: async () => ({ ok: true, finalPrompt: "x" }),
    ...region,
  } as LayerEditorRegionSupport;
  return {
    copy: layersCopy,
    html: renderToStaticMarkup(
      <RegionEditPanel copy={layersCopy} locale="ko" baseSize={{ width: 1200, height: 1500 }} baseImgRef={createRef()} region={base}
        box={{ x: 0.2, y: 0.25, w: 0.35, h: 0.3 }} quickItems={[]} uploading={false} onBox={noop}
        resolveRef={() => null} onUploadRefs={async () => []} onSubmitted={noop}
        {...(preset ? { preset: { box: null, instruction: "", ...preset } } : {})} />,
    ),
  };
}

describe("region edit v2 forms", () => {
  it("the viewer's partial-edit form shows no model or quality select and the one engine's credits", () => {
    for (const locale of ["ko", "en"] as const) {
      const html = viewer(fixed, {}, locale);
      expect(html).toContain("data-studio-region-form");
      expect(html).not.toContain('data-control="region-model"');
      expect(html).not.toContain('data-control="region-quality"');
      expect(html).toContain(fill(copyFor(locale).credits.amount, { n: regionCredits(REGION_V2_MODEL, 0, null, true) }));
    }
    // Flag off: the choice is still there.
    expect(viewer(choice)).toContain('data-control="region-model"');
  });

  it("a rerun of an edit made on another model shows the one engine's credits", () => {
    const html = viewer(fixed, { model: "gpt-image-2.6-sunburst", quality: "high" });
    expect(html).not.toContain('data-control="region-quality"');
    expect(html).toContain(fill(copyFor("ko").credits.amount, { n: regionCredits(REGION_V2_MODEL, 0, null, true) }));
  });

  it("the layer editor's partial-edit panel shows no model or quality select", () => {
    const on = panel({ models: regionV2Models(), defaultModel: REGION_V2_MODEL, fixedModel: true }, { model: "nano-banana-pro" });
    expect(on.html).toContain("data-layers-region");
    expect(on.html).not.toContain(on.copy.region.modelLabel);
    expect(on.html).not.toContain("<select");
    const off = panel({});
    expect(off.html).toContain(off.copy.region.modelLabel);
    expect(off.html).toContain("<select");
  });

  it("the panel says the picture around the selection goes as image 1, and keeps the crop sentence with the flag off", () => {
    const on = panel({ models: regionV2Models(), defaultModel: REGION_V2_MODEL, fixedModel: true });
    expect(on.html).toContain(on.copy.region.inputPreviewCaptionWide);
    expect(on.html).not.toContain(on.copy.region.inputPreviewCaption);
    const off = panel({});
    expect(off.html).toContain(off.copy.region.inputPreviewCaption);
    expect(off.html).not.toContain(off.copy.region.inputPreviewCaptionWide);
  });

  it("builds the request for the one engine and checks its limits", () => {
    const body = regionEditInput({
      ids: { organizationId: "org", requestId: "r" },
      source: { assetId: "a" },
      box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      instruction: "별로 바꿔줘",
      draft: { medium: "image", model: "gpt-image-2.6-sunburst", enhance: true },
      model: "gpt-image-2.6-sunburst",
      quality: "high",
      v2: true,
    });
    expect(body).toMatchObject({ kind: "region_edit", model: REGION_V2_MODEL });
    expect(body).not.toHaveProperty("quality");
    // Seedream takes 10 pictures: the cut-out and nine references.
    const nine = Array.from({ length: 9 }, () => ({ kind: "image" as const }));
    expect(regionProblem({ box: { x: 0, y: 0, w: 1, h: 1 }, instruction: "x", model: "nano-banana-pro", references: nine, v2: true })).toBeNull();
    expect(regionProblem({ box: { x: 0, y: 0, w: 1, h: 1 }, instruction: "x", model: "nano-banana-pro", references: [...nine, { kind: "image" }], v2: true })).toMatchObject({ kind: "too_many_images", max: 9 });
  });
});
