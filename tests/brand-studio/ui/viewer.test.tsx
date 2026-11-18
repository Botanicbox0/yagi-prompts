import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Viewer, type RegionSupport, type ViewerActions, type ViewerItem, type ViewerProps } from "@/components/brand-studio/viewer";
import { AssetPanel, filterAssets } from "@/components/brand-studio/asset-panel";
import { parseTags } from "@/components/brand-studio/asset-editor";
import { cropStyle } from "@/components/brand-studio/gallery/region-form";
import { regionCredits } from "@/components/brand-studio/dock-model";
import { STUDIO_LIMITS } from "@/lib/brand-studio/contracts";
import { regionEditModels } from "@/lib/brand-studio/models";
import { trayItemFromAsset } from "@/components/brand-studio/refs";
import { fill } from "@/components/brand-studio/copy";
import { asset, copyFor, job, output } from "./fixtures";

/** docs/BRAND-STUDIO-V3.md §4 — the viewer's actions, partial edit v2 and the before/after slider. */
const noop = () => {};
const actions: ViewerActions = { regionEdit: async () => true, rerun: noop, toVideo: noop, reference: noop, save: noop, campaign: noop, finalize: noop, reuse: noop, remove: async () => true };
const withMore: ViewerActions = { ...actions, decorate: noop, review: noop };
const actionNames = (html: string) => [...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]);
const region: RegionSupport = {
  models: regionEditModels(),
  defaultModel: "nano-banana-pro",
  recent: [trayItemFromAsset(asset(7)), trayItemFromAsset(asset(8))],
  resolve: () => null,
  upload: async () => [],
};

function render(items: ViewerItem[], patch: Partial<ViewerProps> = {}, locale: "ko" | "en" = "ko") {
  return renderToStaticMarkup(
    <Viewer items={items} index={0} copy={copyFor(locale)} locale={locale} canCreate canGenerate busy={null} notice={null}
      parentOf={() => null} onIndex={noop} onClose={noop} actions={actions} {...patch} />,
  );
}

describe("viewer", () => {
  const picture = output(1);
  const imageJob = job(1, { outputs: [picture] });

  it("offers every action on a picture, in a labelled dialog with previous and next", () => {
    const copy = copyFor("ko");
    const html = render([{ type: "output", output: picture, job: imageJob }, { type: "output", output: output(2), job: imageJob }], { actions: withMore, region });
    expect(html).toMatch(/<dialog[^>]*aria-labelledby=/);
    expect(html).toContain(copy.viewer.label);
    expect(actionNames(html)).toEqual(["region", "rerun", "decorate", "to-video", "reference", "save", "review", "campaign", "download", "delete"]);
    // An image run's sentence can be read and copied in one press (2026-11-19); a video run's stays protected.
    expect(html).toContain("<p>Enhanced prompt 1</p>");
    expect(html).not.toContain("data-no-copy");
    expect(html).toContain("data-copy-sent");
    const clip = output(4, { kind: "video" });
    const video = render([{ type: "output", output: clip, job: job(4, { kind: "video", outputs: [clip] }) }]);
    expect(video).toContain('<p data-no-copy="">Enhanced prompt 4</p>');
    expect(video.match(/data-no-copy/g)).toHaveLength(1);
    // The handoff says where the result goes, in the rail's words.
    expect(html).toContain(`title="${copyFor("ko").viewer.campaignHint}"`);
    expect(html.match(/class="bs-btn bs-action" data-variant="soft"/g)).toHaveLength(8);
    expect(html).toContain(`aria-label="${copy.viewer.prev}" disabled=""`);
    expect(html).not.toContain(`aria-label="${copy.viewer.next}" disabled=""`);
    expect(html).toContain(copy.viewer.promptToggle);
    expect(html).toContain("Enhanced prompt 1");
    expect(html).toContain(copy.viewer.reuse);
  });

  it("finishes a draft at 1080p, shows a saved result as saved and says when the prompt was sent as written", () => {
    const copy = copyFor("en");
    const draft = output(3, { kind: "video", draft: true, savedAssetId: asset(1).id });
    const html = render([{ type: "output", output: draft, job: job(3, { kind: "video", finalPrompt: null, outputs: [draft] }) }], { actions: withMore, region }, "en");
    // Nothing of ours to protect when the request went as written.
    expect(html).not.toContain("data-no-copy");
    const names = actionNames(html);
    expect(names).toContain("finalize");
    expect(names).not.toContain("region");
    expect(names).not.toContain("decorate");
    expect(names).not.toContain("save");
    expect(html).toContain(copy.viewer.saved);
    expect(html).toContain(copy.viewer.notEnhanced);
  });

  it("opens a partial edit's result on a before/after slider that the keyboard can move", () => {
    const parent = output(9);
    const edited = output(4);
    const html = render([{ type: "output", output: edited, job: job(4, { kind: "region_edit", parentOutputId: parent.id, outputs: [edited] }) }], {
      parentOf: (id) => (id === parent.id ? parent : null),
    });
    expect(html).toContain("data-studio-compare");
    expect(html).toMatch(/<input[^>]*class="bs-compare-range" type="range" min="0" max="100"/);
    expect(html).toContain(`src="${parent.url}"`);
    expect(html).toContain(copyFor("ko").viewer.compareHint);
    expect(actionNames(html)).toContain("rerun");
    // An edit of a library picture compares against that picture.
    const fromAsset = render([{ type: "output", output: edited, job: job(4, { kind: "region_edit", parentAssetId: asset(3).id, outputs: [edited] }) }], {
      parentAssetOf: (id) => (id === asset(3).id ? asset(3) : null),
    });
    expect(fromAsset).toContain(`src="${asset(3).url}"`);
  });

  it("opens a set-up partial edit with the cut-out as 1, references from 2, the model and its credits", () => {
    const copy = copyFor("ko");
    const parent = output(9);
    const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
    const logo = { ...trayItemFromAsset(asset(5, { role: "logo" })), role: "logo" as const };
    const html = render([{ type: "output", output: parent, job: job(9, { outputs: [parent] }) }], {
      region,
      regionPreset: { key: `o:${parent.id}`, box, instruction: "이미지 1 로고를 라벨에", references: [logo] },
    });
    expect(html).toContain("data-studio-region-form");
    expect(html).toContain('data-box="0.1,0.2,0.3,0.4"');
    expect(html).toContain("data-studio-region-preview");
    expect(html).toContain(copy.region.preview);
    expect(html).toContain('data-region-ref="2"');
    expect(html).toMatch(/<option value="logo" selected="">/);
    // The server's "이미지 1" (the first reference) reads as "이미지 2" in the form.
    expect(html).toContain("이미지 2 로고를 라벨에");
    expect(html).toContain(fill(copy.credits.amount, { n: regionCredits("nano-banana-pro", 1) }));
    expect(html.match(/data-variant="solid"/g)).toHaveLength(1);
    expect(html).toContain("data-docked");
    expect(html).not.toMatch(/₩|\d\s*원/);
  });

  it("lets a viewer only look and download, and keeps generation closed while the limit is", () => {
    const item: ViewerItem = { type: "output", output: picture, job: imageJob };
    expect(actionNames(render([item], { canCreate: false, canGenerate: false, actions: withMore }))).toEqual(["download"]);
    expect(actionNames(render([item], { canGenerate: false, actions: withMore }))).toEqual(["decorate", "save", "review", "campaign", "download", "delete"]);
    expect(actionNames(render([{ type: "asset", asset: asset(1) }], { actions: withMore, region }))).toEqual(["region", "decorate", "to-video", "reference", "review", "campaign", "download"]);
  });
});

describe("partial edit quality", () => {
  it("offers a quality select only when the edit model has qualities, and prices it", () => {
    const parent = output(9);
    const preset = (model: string, quality?: string) => ({ key: `o:${parent.id}`, box: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 }, instruction: "x", model, quality });
    const items: ViewerItem[] = [{ type: "output", output: parent, job: job(9, { outputs: [parent] }) }];
    const nano = render(items, { region, regionPreset: preset("nano-banana-pro") });
    expect(nano).not.toContain('data-control="region-quality"');
    const gpt = render(items, { region, regionPreset: preset("gpt-image-2.6-sunburst", "high") });
    expect(gpt).toContain('data-control="region-quality"');
    expect(gpt).toMatch(/<option value="high" selected="">/);
    expect(gpt).toContain(fill(copyFor("ko").credits.amount, { n: regionCredits("gpt-image-2.6-sunburst", 0, "high") }));
    expect(regionCredits("gpt-image-2.6-sunburst", 0, "low")).toBeLessThan(regionCredits("gpt-image-2.6-sunburst", 0, "high"));
  });
});

describe("partial edit input preview", () => {
  it("cuts the box out of the picture with CSS at the box's own shape", () => {
    const style = cropStyle({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, { width: 1600, height: 1200 }, "https://m/p.png");
    expect(style).toMatchObject({ backgroundSize: "200.000% 400.000%", backgroundPosition: "50.000% 66.667%", aspectRatio: "800 / 300" });
    expect(style.backgroundImage).toBe('url("https://m/p.png")');
    expect(cropStyle({ x: 0, y: 0, w: 1, h: 1 }, { width: null, height: null }, "u").backgroundPosition).toBe("0.000% 0.000%");
  });
});

describe("asset library", () => {
  const library = [
    asset(1, { name: "Bottle front", role: "product", tags: ["spring"] }),
    asset(2, { name: "Logo mark", role: "logo" }),
    asset(3, { name: "Street walk", kind: "video", tags: ["봄", "reference"] }),
  ];

  it("searches names and tags and filters by role", () => {
    expect(filterAssets(library, "bottle", "all").map((a) => a.name)).toEqual(["Bottle front"]);
    expect(filterAssets(library, "봄", "all").map((a) => a.name)).toEqual(["Street walk"]);
    expect(filterAssets(library, "", "logo").map((a) => a.name)).toEqual(["Logo mark"]);
    expect(filterAssets(library, "spring", "logo")).toEqual([]);
  });

  it("states the upload limits, keeps video tiles still and names every tile", () => {
    const html = renderToStaticMarkup(
      <AssetPanel assets={library} copy={copyFor("ko")} canCreate attachOnPress open={false} notice={null} uploading={[]} searchId="assets-search"
        onClose={noop} onAttach={noop} onView={noop} onFiles={noop} onUpdate={async () => ({ ok: true, asset: library[0]! })} onDelete={async () => ({ ok: true })} />,
    );
    expect(html).toContain("JPG·PNG·WebP 15MB, MP4·MOV 50MB, MP3·WAV 15MB까지");
    expect(html).toMatch(/<video[^>]*muted=""[^>]*preload="metadata"/);
    expect(html).toContain(`aria-label="참조에 넣기: Bottle front"`);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('<label class="bs-sr" for="assets-search">');
  });

  it("cleans tags to the contract's limits", () => {
    expect(parseTags(" 봄, 신제품 ,, 봄 ")).toEqual(["봄", "신제품"]);
    expect(parseTags(Array.from({ length: 12 }, (_, i) => `t${i}`).join(","))).toHaveLength(STUDIO_LIMITS.tagsMax);
    expect(parseTags("x".repeat(40))[0]).toHaveLength(STUDIO_LIMITS.tagMax);
  });
});
