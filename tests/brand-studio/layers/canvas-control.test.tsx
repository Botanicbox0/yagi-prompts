import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import LayerEditor from "@/components/brand-studio/layers";
import { CANVAS_RATIOS, canvasForRatio, resizeCanvas } from "@/components/brand-studio/layers/canvas";
import { CanvasSizeControl } from "@/components/brand-studio/layers/canvas-control";
import { emptyDoc } from "@/components/brand-studio/layers/model";

const copy = getDictionary("ko").studioLayers;
const noop = () => {};

function control(doc = emptyDoc(1080, 1350), open = false) {
  return renderToStaticMarkup(
    <CanvasSizeControl copy={copy} doc={doc} open={open} onOpenChange={noop} onRatio={noop} onSize={noop} onReset={noop} />,
  );
}

describe("canvas size control", () => {
  it("shows the canvas size on a closed chip", () => {
    const html = control();
    expect(html).toContain("data-canvas-chip");
    expect(html).toContain("1080 × 1350");
    expect(html).toContain(`aria-label="${copy.canvas.size} 1080 × 1350"`);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("data-canvas-panel");
  });

  it("opens with six presets, two size fields and the matching preset pressed", () => {
    const html = control(emptyDoc(1080, 1350), true);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("data-canvas-panel");
    for (const ratio of CANVAS_RATIOS) expect(html).toContain(`data-ratio="${ratio}"`);
    expect(html.match(/data-ratio="/g)).toHaveLength(6);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*data-ratio="4:5"|data-ratio="4:5"[^>]*aria-pressed="true"/);
    expect(html).toContain('data-canvas-input="width"');
    expect(html).toContain('data-canvas-input="height"');
    expect(html).toContain(copy.canvas.width);
    expect(html).toContain(copy.canvas.height);
    expect(html).toContain(copy.canvas.ratio);
    // Not resized: no way back needed.
    expect(html).not.toContain("data-canvas-reset");
  });

  it("offers the way back only while the canvas is resized", () => {
    const resized = canvasForRatio(emptyDoc(1000, 800), "16:9");
    const html = control(resized, true);
    expect(html).toContain("data-canvas-reset");
    expect(html).toContain(copy.canvas.reset);
    expect(html).toContain("1422 × 800");
    const free = control(resizeCanvas(emptyDoc(1000, 800), { width: 1111, height: 800 }, { x: 0, y: 0 }), true);
    expect(free).not.toContain('aria-pressed="true"');
  });
});

describe("layer editor size chip", () => {
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

  it("is in the top bar of a picture", () => {
    const html = renderToStaticMarkup(<LayerEditor {...props} />);
    expect(html).toContain("data-canvas-chip");
    expect(html).toContain("1200 × 1500");
  });

  it("opens (test-only initial prop) with the panel and eight canvas handles", () => {
    const html = renderToStaticMarkup(<LayerEditor {...props} initialCanvasOpen />);
    expect(html).toContain("data-canvas-panel");
    expect(html.match(/data-canvas-handle="/g)).toHaveLength(8);
  });

  it("shows no canvas handles while the panel is closed", () => {
    expect(renderToStaticMarkup(<LayerEditor {...props} />)).not.toContain("data-canvas-handle");
  });

  it("is not offered on a blank canvas", () => {
    const html = renderToStaticMarkup(<LayerEditor {...props} blankCanvas initialCanvasOpen />);
    expect(html).not.toContain("data-canvas-chip");
    expect(html).not.toContain("data-canvas-handle");
  });
});
