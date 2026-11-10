import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Viewer, type ViewerActions, type ViewerItem, type ViewerProps } from "@/components/brand-studio/viewer";
import { AssetPanel, filterAssets } from "@/components/brand-studio/asset-panel";
import { parseTags } from "@/components/brand-studio/asset-editor";
import { STUDIO_LIMITS } from "@/lib/brand-studio/contracts";
import { asset, copyFor, job, output } from "./fixtures";

/** docs/BRAND-STUDIO-V2.md §5.2 — the viewer's actions and the asset library. */
const noop = () => {};
const actions: ViewerActions = { regionEdit: async () => true, rerun: noop, toVideo: noop, reference: noop, save: noop, campaign: noop, finalize: noop, reuse: noop };
const actionNames = (html: string) => [...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]);

function render(items: ViewerItem[], patch: Partial<ViewerProps> = {}, locale: "ko" | "en" = "ko") {
  return renderToStaticMarkup(
    <Viewer items={items} index={0} copy={copyFor(locale)} canCreate canGenerate busy={null} notice={null}
      parentOf={() => null} onIndex={noop} onClose={noop} actions={actions} {...patch} />,
  );
}

describe("viewer", () => {
  const picture = output(1);
  const imageJob = job(1, { outputs: [picture] });

  it("offers every action on a picture, in a labelled dialog with previous and next", () => {
    const copy = copyFor("ko");
    const html = render([{ type: "output", output: picture, job: imageJob }, { type: "output", output: output(2), job: imageJob }]);
    expect(html).toMatch(/<dialog[^>]*aria-labelledby=/);
    expect(html).toContain(copy.viewer.label);
    expect(actionNames(html)).toEqual(["region", "rerun", "to-video", "reference", "save", "campaign", "download"]);
    expect(html).toContain(`aria-label="${copy.viewer.prev}" disabled=""`);
    expect(html).not.toContain(`aria-label="${copy.viewer.next}" disabled=""`);
    expect(html).toContain(copy.viewer.promptToggle);
    expect(html).toContain("Enhanced prompt 1");
    expect(html).toContain(copy.viewer.reuse);
  });

  it("finishes a draft at 1080p, shows a saved result as saved and says when the prompt was sent as written", () => {
    const copy = copyFor("en");
    const draft = output(3, { kind: "video", draft: true, savedAssetId: asset(1).id });
    const html = render([{ type: "output", output: draft, job: job(3, { kind: "video", finalPrompt: null, outputs: [draft] }) }], {}, "en");
    const names = actionNames(html);
    expect(names).toContain("finalize");
    expect(names).not.toContain("region");
    expect(names).not.toContain("save");
    expect(html).toContain(copy.viewer.saved);
    expect(html).toContain(copy.viewer.notEnhanced);
  });

  it("compares a partial edit with the picture it came from", () => {
    const parent = output(9);
    const edited = output(4);
    const html = render([{ type: "output", output: edited, job: job(4, { kind: "region_edit", parentOutputId: parent.id, outputs: [edited] }) }], { parentOf: (id) => (id === parent.id ? parent : null) });
    expect(html).toContain("data-studio-compare");
    expect(html).toContain(copyFor("ko").viewer.before);
    expect(actionNames(html)).not.toContain("rerun");
  });

  it("lets a viewer only look and download, and keeps generation closed while the limit is", () => {
    const item: ViewerItem = { type: "output", output: picture, job: imageJob };
    expect(actionNames(render([item], { canCreate: false, canGenerate: false }))).toEqual(["download"]);
    expect(actionNames(render([item], { canGenerate: false }))).toEqual(["save", "campaign", "download"]);
    expect(actionNames(render([{ type: "asset", asset: asset(1) }]))).toEqual(["region", "to-video", "reference", "campaign", "download"]);
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
    const copy = copyFor("ko");
    const html = renderToStaticMarkup(
      <AssetPanel assets={library} copy={copy} canCreate attachOnPress open={false} notice={null} uploading={[]} searchId="assets-search"
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
