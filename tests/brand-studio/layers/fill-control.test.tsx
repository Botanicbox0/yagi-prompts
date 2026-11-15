import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import LayerEditor from "@/components/brand-studio/layers";
import { canvasForRatio, resizeCanvas } from "@/components/brand-studio/layers/canvas";
import { CanvasSizeControl, type CanvasFillOffer } from "@/components/brand-studio/layers/canvas-control";
import { emptyDoc, type LayerDoc } from "@/components/brand-studio/layers/model";
import { regionEditModel, regionEditModels, regionCredits, initialDraft } from "@/components/brand-studio/dock-model";
import { fill as fillCopy } from "@/components/brand-studio/layers/panels";

const copy = getDictionary("ko").studioLayers;
const noop = () => {};

const offer = (over: Partial<CanvasFillOffer> = {}): CanvasFillOffer => ({ creditsPerStrip: 22, locale: "ko", busy: false, error: null, onFill: noop, ...over });

function control(doc: LayerDoc, fill: CanvasFillOffer | null) {
  return renderToStaticMarkup(
    <CanvasSizeControl copy={copy} doc={doc} open onOpenChange={noop} onRatio={noop} onSize={noop} onReset={noop} fill={fill} />,
  );
}

const oneSide = () => resizeCanvas(emptyDoc(1000, 800), { width: 1400, height: 800 }, { x: 0, y: 0.5 });
const twoSides = () => canvasForRatio(emptyDoc(1000, 800), "16:9");
const bothAxes = () => resizeCanvas(emptyDoc(1000, 800), { width: 1400, height: 1000 }, { x: 0.5, y: 0.5 });

describe("fill the empty area button", () => {
  it("is absent without the offer (capability off)", () => {
    expect(control(oneSide(), null)).not.toContain("data-canvas-fill");
  });

  it("is absent with margins on both axes, and with no margin at all", () => {
    expect(control(bothAxes(), offer())).not.toContain("data-canvas-fill");
    expect(control(emptyDoc(1000, 800), offer())).not.toContain("data-canvas-fill");
  });

  it("is there with the offer and one-axis margins, with the credits it will use", () => {
    const one = control(oneSide(), offer());
    expect(one).toContain("data-canvas-fill");
    expect(one).toContain(fillCopy(copy.canvas.fillCta, { label: copy.canvas.fill, credits: "22" }));
    // Two strips are two jobs.
    expect(control(twoSides(), offer())).toContain(fillCopy(copy.canvas.fillCta, { label: copy.canvas.fill, credits: "44" }));
  });

  it("shows busy and the partial-edit error line", () => {
    const html = control(oneSide(), offer({ busy: true, error: "보내지 못했어요." }));
    expect(html).toMatch(/data-canvas-fill[^>]*disabled|disabled[^>]*data-canvas-fill/);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('class="bsl-error"');
    expect(html).toContain("보내지 못했어요.");
  });
});

describe("layer editor fill offer", () => {
  const region = {
    sourceRef: { assetId: "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d" },
    previewUrl: "/api/brand-studio/media/st/a.png",
    models: regionEditModels(),
    defaultModel: regionEditModel(initialDraft("image")),
    defaultQuality: null,
    jobs: [],
    errorText: () => "",
    submit: async () => ({ ok: false as const, message: "" }),
    enhancePrompt: async () => ({ ok: false as const, message: "" }),
  };
  const props = {
    organizationId: "0b9f1c7e-1d2a-4c55-9a3e-7f1e2d3c4b5a",
    locale: "ko" as const,
    base: { ref: { assetId: "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d" }, url: "/api/brand-studio/media/st/a.png", width: 1200, height: 1500, name: null },
    assets: [],
    library: null,
    upload: async () => ({ ok: false as const, code: "failed" as const, message: "" }),
    onSaved: noop,
    onClose: noop,
    copy,
  };

  it("is absent by default, even with a resized canvas", () => {
    const html = renderToStaticMarkup(<LayerEditor {...props} region={region} initialCanvasOpen initialDoc={resizeCanvas(emptyDoc(1200, 1500), { width: 1600, height: 1500 }, { x: 0, y: 0.5 })} />);
    expect(html).toContain("data-canvas-panel");
    expect(html).not.toContain("data-canvas-fill");
  });

  it("is absent on a blank canvas and for a member who cannot generate", () => {
    const resized = resizeCanvas(emptyDoc(1200, 1500), { width: 1600, height: 1500 }, { x: 0, y: 0.5 });
    expect(renderToStaticMarkup(<LayerEditor {...props} region={region} fillEmpty blankCanvas initialCanvasOpen initialDoc={resized} />)).not.toContain("data-canvas-fill");
    expect(renderToStaticMarkup(<LayerEditor {...props} region={null} fillEmpty initialCanvasOpen initialDoc={resized} />)).not.toContain("data-canvas-fill");
  });

  it("is there with the capability on a one-axis canvas, priced from the partial-edit credits", () => {
    const resized = resizeCanvas(emptyDoc(1200, 1500), { width: 1600, height: 1500 }, { x: 0, y: 0.5 });
    const html = renderToStaticMarkup(<LayerEditor {...props} region={region} fillEmpty initialCanvasOpen initialDoc={resized} />);
    expect(html).toContain("data-canvas-fill");
    const credits = regionCredits(region.defaultModel, 0, region.defaultQuality).toLocaleString("ko-KR");
    expect(html).toContain(fillCopy(copy.canvas.fillCta, { label: copy.canvas.fill, credits }));
  });
});
