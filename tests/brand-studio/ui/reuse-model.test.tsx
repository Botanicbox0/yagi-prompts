import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fill } from "@/components/brand-studio/copy";
import { dockCredits, dockEstimateKrw, initialDraft, regionCredits, regionInstructionForForm, withMedium } from "@/components/brand-studio/dock-model";
import { RegionEditPanel } from "@/components/brand-studio/layers/region-panel";
import { architectWasOn, planReuse, restoreTray, type ReuseLookup } from "@/components/brand-studio/reuse-model";
import type { LayerEditorRegionSupport } from "@/components/brand-studio/seams";
import { missingReferencesLine } from "@/components/brand-studio/use-dock";
import { Viewer, type ViewerActions } from "@/components/brand-studio/viewer";
import type { StudioAssetView, StudioJobView, StudioOutputView } from "@/lib/brand-studio/contracts";
import { creditsOf } from "@/lib/brand-studio/credits";
import { REGION_V2_MODEL, regionV2Models } from "@/lib/brand-studio/models";
import { imageRunKrw } from "@/lib/brand-studio/usage-rate";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { asset, copyFor, job, output } from "./fixtures";

/**
 * "이 설정 다시 쓰기" (2026-11-19): what each kind of run brings back, what is dropped, and that the
 * restored setting is quoted exactly like a fresh run with the same settings.
 */
const logo = asset(1, { role: "logo", name: "logo.png" });
const bottle = asset(2, { role: "product", name: "bottle.png" });
const knit = asset(3, { role: "style", name: "knit.png" });
const source = output(10, { width: 1200, height: 1600 });

function lookup(assets: StudioAssetView[], outputs: StudioOutputView[]): ReuseLookup {
  return { asset: (id) => assets.find((a) => a.id === id) ?? null, output: (id) => outputs.find((o) => o.id === id) ?? null };
}

const LONG = "A centered photograph of the bottle from Figure 2 with the bunny logo from Figure 1.";
const imageRun = (patch: Partial<StudioJobView> = {}) =>
  job(1, {
    kind: "image",
    model: "gpt-image-2.6-sunburst",
    prompt: "2번 이미지에서 인물 얼굴을 1번 이미지의 로고로 전부 변경",
    finalPrompt: LONG,
    reviewed: true,
    aspect: "3:2",
    resolution: "2K",
    quality: "high",
    expected: 3,
    references: [
      { assetId: logo.id, role: "logo", use: "토끼 모양만" },
      { assetId: bottle.id, role: "product" },
      { assetId: knit.id, role: "style", avoid: "배경" },
    ],
    ...patch,
  });

describe("이 설정 다시 쓰기 on a generated image", () => {
  const all = lookup([logo, bottle, knit], [source]);
  const ctx = { current: initialDraft("image"), lookup: all, outputName: "결과" };

  it("brings back the typed words (not the written sentence), the Architect switch, model, ratio, resolution, quality and count", () => {
    const plan = planReuse(imageRun(), ctx);
    expect(plan.to).toBe("dock");
    if (plan.to !== "dock") return;
    expect(plan.draft).toMatchObject({
      medium: "image",
      model: "gpt-image-2.6-sunburst",
      prompt: "2번 이미지에서 인물 얼굴을 1번 이미지의 로고로 전부 변경",
      enhance: true,
      aspect: "3:2",
      resolution: "2K",
      quality: "high",
      count: 3,
    });
    expect(plan.draft.prompt).not.toContain("Figure");
    expect(plan.reviewed).toBeNull();
    expect(plan.missing).toEqual([]);
  });

  it("brings every reference back in the same order with the same role and notes", () => {
    const plan = planReuse(imageRun(), ctx);
    if (plan.to !== "dock") throw new Error("dock expected");
    expect(plan.tray.map((t) => t.key)).toEqual([`a:${logo.id}`, `a:${bottle.id}`, `a:${knit.id}`]);
    expect(plan.tray.map((t) => t.role)).toEqual(["logo", "product", "style"]);
    expect(plan.tray[0]).toMatchObject({ use: "토끼 모양만" });
    expect(plan.tray[2]).toMatchObject({ avoid: "배경" });
    // Reordered references come back reordered.
    const swapped = planReuse(imageRun({ references: [{ assetId: knit.id }, { assetId: logo.id }] }), ctx);
    if (swapped.to !== "dock") throw new Error("dock expected");
    expect(swapped.tray.map((t) => t.key)).toEqual([`a:${knit.id}`, `a:${logo.id}`]);
  });

  it("keeps the Architect switch off for a run sent as written, on for one rewritten on send", () => {
    const off = planReuse(imageRun({ finalPrompt: null, reviewed: false }), ctx);
    const auto = planReuse(imageRun({ finalPrompt: "rewritten on send", reviewed: false }), ctx);
    expect(off.to === "dock" && off.draft.enhance).toBe(false);
    expect(auto.to === "dock" && auto.draft.enhance).toBe(true);
    expect(auto.to === "dock" && auto.draft.prompt).toBe("2번 이미지에서 인물 얼굴을 1번 이미지의 로고로 전부 변경");
    expect(architectWasOn({ finalPrompt: null })).toBe(false);
  });

  it("quotes the restored bar exactly like a fresh run with the same settings", () => {
    const run = imageRun();
    const plan = planReuse(run, ctx);
    if (plan.to !== "dock") throw new Error("dock expected");
    const fresh = imageRunKrw({ model: run.model, resolution: run.resolution!, references: run.references.length, count: run.expected, quality: run.quality ?? null, aspect: run.aspect! });
    expect(dockEstimateKrw(plan.draft, plan.tray)).toBe(fresh);
    expect(dockCredits(plan.draft, plan.tray)).toBe(creditsOf(fresh));
  });

  it("restores the rest when a reference is gone and names the missing one", () => {
    const plan = planReuse(imageRun(), { ...ctx, lookup: lookup([logo, knit], [source]) });
    if (plan.to !== "dock") throw new Error("dock expected");
    expect(plan.tray.map((t) => t.key)).toEqual([`a:${logo.id}`, `a:${knit.id}`]);
    expect(plan.missing).toEqual([{ kind: "image", number: 2 }]);
    expect(plan.draft).toMatchObject({ model: "gpt-image-2.6-sunburst", count: 3, quality: "high" });
    const ko = copyFor("ko");
    expect(missingReferencesLine(plan.missing, ko)).toBe(fill(ko.viewer.reuseMissing, { label: "이미지 2" }));
    expect(missingReferencesLine([{ kind: "image", number: 1 }, { kind: "image", number: 3 }], copyFor("en"))).toBe("Not found: Image 1, Image 3. Add it again if needed.");
    expect(missingReferencesLine([], ko)).toBeNull();
    // The quote follows what came back (two references now).
    expect(dockEstimateKrw(plan.draft, plan.tray)).toBe(imageRunKrw({ model: "gpt-image-2.6-sunburst", resolution: "2K", references: 2, count: 3, quality: "high", aspect: "3:2" }));
  });

  it("restoreTray numbers a missing reference by tray position when the kind is not known", () => {
    const { items, missing } = restoreTray([{ assetId: logo.id }, { outputId: output(99).id }], lookup([logo], []), "결과");
    expect(items).toHaveLength(1);
    expect(missing).toEqual([{ kind: "any", number: 2 }]);
  });
});

describe("같은 영역 다시 수정하기 on an edited image", () => {
  const edit = (patch: Partial<StudioJobView> = {}) =>
    job(2, {
      kind: "region_edit",
      model: REGION_V2_MODEL,
      prompt: "선택한 부분의 마크를 이미지 1의 토끼 로고로 바꿔 주세요",
      finalPrompt: "In Figure 1, change only the boxed part",
      parentOutputId: source.id,
      box: { x: 0.36, y: 0.42, w: 0.28, h: 0.2 },
      references: [{ assetId: logo.id, role: "logo" }],
      outputs: [output(11)],
      ...patch,
    });
  const result = output(11);
  const ctx = { current: initialDraft("image"), lookup: lookup([logo, bottle], [source, result]), outputName: "결과", from: result };

  it("opens the partial-edit tool on the original with the same box, words, references and switch", () => {
    const plan = planReuse(edit(), ctx);
    expect(plan.to).toBe("region");
    if (plan.to !== "region") return;
    expect(plan.source).toEqual({ outputId: source.id });
    expect(plan.onResult).toBe(false);
    expect(plan.open).toEqual({ list: "outputs", key: `o:${source.id}` });
    expect(plan.preset).toMatchObject({
      box: { x: 0.36, y: 0.42, w: 0.28, h: 0.2 },
      instruction: "선택한 부분의 마크를 이미지 1의 토끼 로고로 바꿔 주세요",
      serverNumbered: true,
      enhance: true,
      model: REGION_V2_MODEL,
    });
    expect(plan.preset.references?.map((r) => [r.key, r.role])).toEqual([[`a:${logo.id}`, "logo"]]);
    // Never the generation bar.
    expect(plan).not.toHaveProperty("draft");
  });

  it("opens a library picture's edit on that picture", () => {
    const plan = planReuse(edit({ parentOutputId: null, parentAssetId: bottle.id }), ctx);
    expect(plan.to === "region" && plan.source).toEqual({ assetId: bottle.id });
    expect(plan.to === "region" && plan.open).toEqual({ list: "assets", key: `a:${bottle.id}` });
  });

  it("falls back to the result itself when the original is gone, with the words and the area", () => {
    const plan = planReuse(edit(), { ...ctx, lookup: lookup([logo], [result]) });
    if (plan.to !== "region") throw new Error("region expected");
    expect(plan.onResult).toBe(true);
    expect(plan.source).toEqual({ outputId: result.id });
    expect(plan.preset.instruction).toBe("선택한 부분의 마크를 이미지 1의 토끼 로고로 바꿔 주세요");
    expect(plan.preset.box).toEqual({ x: 0.36, y: 0.42, w: 0.28, h: 0.2 });
    // Without a result to fall back to there is nothing to open.
    expect(planReuse(edit({ outputs: [] }), { ...ctx, lookup: lookup([], []), from: null }).to).toBe("none");
  });

  it("keeps the switch off for an edit sent as written (its words are the form's numbering)", () => {
    const plan = planReuse(edit({ finalPrompt: null, prompt: "이미지 1의 마크를 이미지 2 로고로" }), ctx);
    if (plan.to !== "region") throw new Error("region expected");
    expect(plan.preset).toMatchObject({ serverNumbered: false, enhance: false, instruction: "이미지 1의 마크를 이미지 2 로고로" });
  });

  it("reports a missing reference and quotes the form like a fresh edit with the same references", () => {
    const plan = planReuse(edit({ references: [{ assetId: logo.id }, { assetId: knit.id }] }), ctx);
    if (plan.to !== "region") throw new Error("region expected");
    expect(plan.missing).toEqual([{ kind: "image", number: 2 }]);
    const restored = plan.preset.references ?? [];
    expect(regionCredits(plan.preset.model!, restored.length, plan.preset.quality, true)).toBe(regionCredits(REGION_V2_MODEL, 1, null, true));
  });

  it("the partial-edit panel opens prefilled: form-numbered words, the references, the switch", () => {
    const plan = planReuse(edit({ references: [{ assetId: logo.id, role: "logo" }] }), ctx);
    if (plan.to !== "region") throw new Error("region expected");
    const layersCopy = getDictionary("ko").studioLayers;
    const support = {
      sourceRef: plan.source,
      previewUrl: source.url,
      models: regionV2Models(),
      defaultModel: REGION_V2_MODEL,
      defaultQuality: null,
      fixedModel: true,
      jobs: [],
      errorText: () => "오류",
      submit: async () => ({ ok: false, message: "noop" }),
      enhancePrompt: async () => ({ ok: true, finalPrompt: "x" }),
    } as unknown as LayerEditorRegionSupport;
    const render = (preset: typeof plan.preset) =>
      renderToStaticMarkup(
        <RegionEditPanel copy={layersCopy} locale="ko" baseSize={{ width: 1200, height: 1600 }} baseImgRef={createRef()} region={support}
          box={preset.box} preset={preset} quickItems={[]} uploading={false} onBox={() => {}}
          resolveRef={() => null} onUploadRefs={async () => []} onSubmitted={() => {}} />,
      );
    const html = render(plan.preset);
    // The server numbered the logo "이미지 1"; the form shows it as 2 again (the cut-out is 1).
    expect(html).toContain(regionInstructionForForm(plan.preset.instruction, "ko"));
    expect(html).toContain("이미지 2");
    expect(html).toContain(logo.thumbUrl!);
    expect(html).toMatch(/<input type="checkbox" checked=""/);
    const off = render({ ...plan.preset, enhance: false, serverNumbered: false });
    expect(off).not.toMatch(/<input type="checkbox" checked=""/);
  });

  it("the viewer's own form (no layer editor) opens on the original with the same words", () => {
    const plan = planReuse(edit(), ctx);
    if (plan.to !== "region") throw new Error("region expected");
    const copy = copyFor("ko");
    const noop = () => {};
    const actions: ViewerActions = { regionEdit: async () => true, rerun: noop, toVideo: noop, reference: noop, save: noop, campaign: noop, finalize: noop, reuse: noop, remove: async () => true };
    const html = renderToStaticMarkup(
      <Viewer items={[{ type: "output", output: source, job: job(9, { outputs: [source] }) }]} index={0} copy={copy} locale="ko" canCreate canGenerate busy={null} notice={null}
        parentOf={() => null} onIndex={noop} onClose={noop} actions={actions}
        region={{ models: regionV2Models(), defaultModel: REGION_V2_MODEL, defaultQuality: null, fixedModel: true, recent: [], resolve: () => null, upload: async () => [] }}
        regionPreset={{ key: plan.open.key, box: plan.preset.box, instruction: plan.preset.instruction, references: plan.preset.references }} />,
    );
    expect(html).toContain("data-studio-region-form");
    expect(html).toContain(regionInstructionForForm(plan.preset.instruction, "ko"));
    expect(html).toContain(logo.thumbUrl!);
  });
});

describe("video runs and blueprints keep their own way back", () => {
  const ctx = { current: initialDraft("video"), lookup: lookup([], []), outputName: "결과" };
  it("a reviewed video run comes back with the sentence that was read (as before)", () => {
    const run = job(5, { kind: "video", model: "seedance-2.5", prompt: "병이 천천히 돈다", finalPrompt: "The bottle turns slowly", reviewed: true, aspect: "9:16", resolution: "720p", seconds: 5, audio: "native" });
    const plan = planReuse(run, ctx);
    if (plan.to !== "dock") throw new Error("dock expected");
    expect(plan.draft.prompt).toBe("The bottle turns slowly");
    expect(plan.reviewed).toEqual({ original: "병이 천천히 돈다", improved: "The bottle turns slowly" });
    expect(plan.draft.medium).toBe("video");
  });
  it("a blueprint goes to the reverse panel", () => {
    expect(planReuse(job(6, { kind: "video_remix", method: "blueprint" }), { ...ctx, current: withMedium(initialDraft(), "video") })).toEqual({ to: "reverse", jobId: job(6).id });
  });
});
