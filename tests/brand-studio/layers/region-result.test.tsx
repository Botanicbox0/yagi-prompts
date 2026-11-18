import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RegionBox, StudioOutputView } from "@/lib/brand-studio/contracts";
import { regionEditModels } from "@/lib/brand-studio/models";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { studioLayersEn, studioLayersKo } from "@/messages/studio-layers";
import LayerEditor from "@/components/brand-studio/layers";
import { pictureBoxToWorld, resizeCanvas } from "@/components/brand-studio/layers/canvas";
import { fitView } from "@/components/brand-studio/layers/geometry";
import { commit, createHistory, preview, revert, settle, undo, type History } from "@/components/brand-studio/layers/history";
import {
  addLayer,
  brushTarget,
  createTextLayer,
  emptyDoc,
  findLayer,
  removeLayer,
  setBaseHidden,
  updateLayer,
  MAX_LAYERS,
  type LayerDoc,
  type LayerTool,
} from "@/components/brand-studio/layers/model";
import type { RegionEditPanelProps } from "@/components/brand-studio/layers/region-panel";
import { compareInterrupts } from "@/components/brand-studio/layers/stage";
import {
  BAR_ARM_MS,
  FIT_MARGIN,
  RESULT_BAR_BOX,
  RESULT_BAR_IDLE,
  RESULT_STRIP,
  barSurvives,
  createArmGuard,
  createBarControls,
  createHold,
  editsBlocked,
  guardStageEdit,
  focusAfterPatch,
  focusForRefine,
  isHoldKey,
  patchIsLatestStep,
  patchLanding,
  resultBarReducer,
  stageDocFor,
  trackRegionJob,
  undoPatch,
  withRegionPatch,
  type ResultBar,
  type ResultBarState,
} from "@/components/brand-studio/layers/region-result";
import { RegionResultBar } from "@/components/brand-studio/layers/region-result-bar";
import type { LayerEditorRegionSupport } from "@/components/brand-studio/seams";

const ko = getDictionary("ko").studioLayers;
const en = getDictionary("en").studioLayers;
const noop = () => {};
const BOX: RegionBox = { x: 0.2, y: 0.25, w: 0.35, h: 0.3 };

function output(over: Partial<StudioOutputView> = {}): StudioOutputView {
  return {
    id: "out-1",
    jobId: "job-1",
    kind: "image",
    url: "/api/brand-studio/media/st/full.png",
    thumbUrl: null,
    width: 1200,
    height: 1500,
    seconds: null,
    draft: false,
    savedAssetId: null,
    regionPatch: { url: "/api/brand-studio/media/st/patch.png", maskUrl: "/api/brand-studio/media/st/mask.png", x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    sourceRef: { assetId: "a-1" },
    createdAt: "2026-11-18T00:00:00.000Z",
    ...over,
  };
}

/** The editor's landing: one `edit` of the document, then focus from `focusAfterPatch`. */
function land(h: History<LayerDoc>, id = "patch-1", out = output()): History<LayerDoc> {
  const landing = patchLanding(trackRegionJob(out.jobId, { box: BOX }), out);
  return commit(h, withRegionPatch(h.present, landing, { id, name: "부분 수정 1", maskDataUrl: "data:image/png;base64,AAAA" }), { now: 1 });
}

function bar(over: Partial<ResultBar> = {}): ResultBar {
  return { layerId: "patch-1", jobId: "job-1", tool: "marquee", comparing: false, ...over };
}

describe("partial edit wording", () => {
  it("drops the flatten choice and its two notices in both languages", () => {
    for (const dict of [studioLayersEn, studioLayersKo]) {
      const region = dict.region as Record<string, unknown>;
      expect(region.autoFlatten).toBeUndefined();
      expect(region.patchArrived).toBeUndefined();
      expect(region.autoFlattenedDone).toBeUndefined();
    }
  });

  it("uses the confirmed lines", () => {
    expect(ko.region).toMatchObject({
      applied: "수정 사항이 적용되었습니다",
      compare: "원본 비교",
      compareHint: "누르고 있으면 수정 전 모습이 보여요",
      undo: "되돌리기",
      refine: "경계 다듬기",
      refineHint: "경계를 문지르면 원본 이미지가 나타나요",
      appliedToast: "수정 결과가 갤러리에 저장되었습니다",
    });
    expect(en.region).toMatchObject({
      applied: "Changes applied",
      compare: "Compare",
      compareHint: "Hold to see the original",
      undo: "Undo",
      refine: "Refine edges",
      refineHint: "Rub the edges to reveal the original image",
      appliedToast: "Your edit is saved to the gallery",
    });
  });

  it("leaves no flatten code in the studio components", () => {
    const root = join(process.cwd(), "components", "brand-studio");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) files.push(path);
      }
    };
    walk(root);
    const hits = files.filter((f) => /autoFlatten|patchArrived|autoFlattenedDone/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});

describe("sending a partial edit", () => {
  it("records only the job and its box", () => {
    expect(trackRegionJob("job-9", { box: BOX })).toEqual({ jobId: "job-9", box: BOX });
    expectTypeOf<Parameters<RegionEditPanelProps["onSubmitted"]>[1]>().toEqualTypeOf<{ box: RegionBox }>();
    expectTypeOf<RegionEditPanelProps>().not.toHaveProperty("autoFlatten");
    expectTypeOf<RegionEditPanelProps>().not.toHaveProperty("onAutoFlatten");
  });

  it("shows no flatten checkbox in the editor's region panel and no result bar before a result", () => {
    const region = {
      sourceRef: { assetId: "a-1" },
      previewUrl: "/api/brand-studio/media/st/a.png",
      models: regionEditModels(),
      defaultModel: "nano-banana-pro",
      defaultQuality: null,
      jobs: [],
      errorText: () => "오류",
      submit: async () => ({ ok: false as const, message: "noop" }),
      enhancePrompt: async () => ({ ok: true as const, finalPrompt: "x" }),
    } as unknown as LayerEditorRegionSupport;
    const html = renderToStaticMarkup(
      <LayerEditor
        organizationId="0b9f1c7e-1d2a-4c55-9a3e-7f1e2d3c4b5a"
        locale="ko"
        base={{ ref: { assetId: "a-1" }, url: "/api/brand-studio/media/st/a.png", width: 1200, height: 1500, name: null }}
        assets={[]}
        library={null}
        upload={async () => ({ ok: false as const, code: "failed" as const, message: "" })}
        onSaved={noop}
        onClose={noop}
        copy={ko}
        region={region}
        initialTool="marquee"
        initialRegionPreset={{ box: BOX, instruction: "" }}
      />,
    );
    expect(html).toContain("data-layers-region");
    expect(html).not.toContain("자동으로 바로 합치기");
    expect(html.match(/type="checkbox"/g)).toHaveLength(1);
    expect(html).not.toContain("data-layers-result");
  });
});

describe("a finished partial edit lands as a patch layer", () => {
  it("adds one layer as one undo step, where the picture sits", () => {
    const doc = resizeCanvas(emptyDoc(1200, 1500), { width: 1600, height: 1500 }, { x: 1, y: 0.5 });
    const h = land(createHistory(doc));
    expect(h.past).toHaveLength(1);
    expect(h.present.layers).toHaveLength(1);
    const layer = findLayer(h.present, "patch-1");
    expect(layer?.kind).toBe("image");
    if (layer?.kind !== "image") return;
    expect(layer.src).toEqual({ ref: { outputId: "out-1" }, url: "/api/brand-studio/media/st/patch.png" });
    expect(layer.maskDataUrl).toBe("data:image/png;base64,AAAA");
    const at = pictureBoxToWorld(doc, { x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
    expect({ x: layer.x, y: layer.y, w: layer.w, h: layer.h }).toEqual({ x: Math.round(at.x), y: Math.round(at.y), w: Math.round(at.w), h: Math.round(at.h) });
    expect(undo(h).present).toBe(doc);
  });

  it("falls back to the whole result over the sent box when no patch was stored", () => {
    const landing = patchLanding(trackRegionJob("job-1", { box: BOX }), output({ regionPatch: null }));
    expect(landing).toEqual({ url: "/api/brand-studio/media/st/full.png", maskUrl: null, outputId: "out-1", box: BOX });
  });

  it("adds nothing when the layer limit is reached", () => {
    let doc = emptyDoc(1200, 1500);
    for (let i = 0; i < MAX_LAYERS; i += 1) doc = addLayer(doc, createTextLayer(doc, { text: `t${i}`, name: `t${i}` }));
    const landing = patchLanding(trackRegionJob("job-1", { box: BOX }), output());
    expect(withRegionPatch(doc, landing, { id: "p", name: "p", maskDataUrl: null })).toBe(doc);
  });

  it("selects the patch, clears the box and keeps the tool", () => {
    for (const tool of ["move", "marquee", "eraser", "restore"] as LayerTool[]) {
      expect(focusAfterPatch({ tool, selectedId: "other", regionBox: BOX }, "patch-1")).toEqual({ tool, selectedId: "patch-1", regionBox: null });
    }
  });
});

describe("result bar", () => {
  const applied = (state: ResultBarState, layerId: string, seq: number, tool: LayerTool = "marquee") =>
    resultBarReducer(state, { type: "applied", layerId, jobId: `job-${layerId}`, seq, tool });

  it("belongs to the newest result, also when an older one lands late", () => {
    let s = applied(RESULT_BAR_IDLE, "a", 1);
    expect(s.bar?.layerId).toBe("a");
    s = applied(s, "c", 3);
    s = applied(s, "b", 2);
    expect(s.bar?.layerId).toBe("c");
    s = resultBarReducer(s, { type: "dismiss" });
    expect(s.bar).toBeNull();
    expect(applied(s, "b", 2).bar).toBeNull();
    expect(applied(s, "d", 4).bar?.layerId).toBe("d");
  });

  it("goes when the patch is gone, another tool or layer is picked, or a new box is drawn", () => {
    const h = land(createHistory(emptyDoc(1200, 1500)));
    const doc = h.present;
    const b = bar();
    const now = { doc, tool: "marquee" as LayerTool, selectedId: "patch-1" as string | null, regionBox: null as RegionBox | null };
    expect(barSurvives(b, now)).toBe(true);
    expect(barSurvives(b, { ...now, selectedId: null })).toBe(true);
    expect(barSurvives(b, { ...now, doc: undo(h).present })).toBe(false);
    expect(barSurvives(b, { ...now, tool: "move" })).toBe(false);
    expect(barSurvives(b, { ...now, selectedId: "other" })).toBe(false);
    expect(barSurvives(b, { ...now, regionBox: BOX })).toBe(false);
  });

  it("holds the original on the stage only while compare is pressed", () => {
    const h = land(createHistory(setBaseHidden(emptyDoc(1200, 1500), true)));
    const doc = h.present;
    let s = applied(RESULT_BAR_IDLE, "patch-1", 1);
    expect(stageDocFor(doc, s.bar)).toBe(doc);

    s = resultBarReducer(s, { type: "compare", on: true });
    const shown = stageDocFor(doc, s.bar);
    expect(findLayer(shown, "patch-1")?.hidden).toBe(true);
    expect(shown.baseHidden).toBeFalsy();
    // The document the editor keeps (history, draft) is untouched.
    expect(findLayer(doc, "patch-1")?.hidden).toBe(false);
    expect(doc.baseHidden).toBe(true);
    expect(h.past).toHaveLength(1);

    s = resultBarReducer(s, { type: "compare", on: false });
    expect(stageDocFor(doc, s.bar)).toBe(doc);
    // Dismissing mid-press also ends it.
    s = resultBarReducer(resultBarReducer(s, { type: "compare", on: true }), { type: "dismiss" });
    expect(stageDocFor(doc, s.bar)).toBe(doc);
  });

  it("press and hold changes once each way and can always be released", () => {
    const onChange = vi.fn();
    const hold = createHold(onChange);
    hold.release();
    expect(onChange).not.toHaveBeenCalled();
    hold.press();
    hold.press();
    expect(hold.held).toBe(true);
    hold.release();
    hold.release();
    expect(onChange.mock.calls).toEqual([[true], [false]]);
    expect(isHoldKey(" ")).toBe(true);
    expect(isHoldKey("Enter")).toBe(true);
    expect(isHoldKey("Escape")).toBe(false);
  });

  it("undo takes the patch's own step when it is the latest", () => {
    const base = createHistory(emptyDoc(1200, 1500));
    const h = land(base);
    expect(patchIsLatestStep(h, "patch-1")).toBe(true);
    const after = undoPatch(h, "patch-1");
    expect(after).toEqual(undo(h));
    expect(after.present).toBe(base.present);
    expect(after.future).toHaveLength(1);
  });

  it("undo after later edits takes the patch out as one new step and keeps the rest", () => {
    const h0 = land(createHistory(emptyDoc(1200, 1500)));
    const text = createTextLayer(h0.present, { text: "later", name: "later" });
    const h1 = commit(h0, addLayer(h0.present, text), { now: 2 });
    const h2 = commit(h1, updateLayer(h1.present, "patch-1", { x: 40 }), { now: 3 });
    expect(patchIsLatestStep(h2, "patch-1")).toBe(false);
    const after = undoPatch(h2, "patch-1");
    expect(after.past).toHaveLength(h2.past.length + 1);
    expect(findLayer(after.present, "patch-1")).toBeNull();
    expect(findLayer(after.present, text.id)).not.toBeNull();
    // And the editor's own undo brings the patch back.
    expect(findLayer(undo(after).present, "patch-1")).not.toBeNull();
    // A patch already gone changes nothing.
    expect(undoPatch(after, "patch-1")).toBe(after);
  });

  it("refine selects the patch and switches to the eraser, and the bar stays with it", () => {
    const h = land(createHistory(emptyDoc(1200, 1500)));
    const next = focusForRefine({ tool: "marquee", selectedId: null, regionBox: null }, "patch-1");
    expect(next).toEqual({ tool: "eraser", selectedId: "patch-1", regionBox: null });
    let s = applied(RESULT_BAR_IDLE, "patch-1", 1, "marquee");
    s = resultBarReducer(resultBarReducer(s, { type: "compare", on: true }), { type: "refine" });
    expect(s.bar).toMatchObject({ tool: "eraser", comparing: false });
    expect(barSurvives(s.bar!, { doc: h.present, ...next })).toBe(true);
    // Picking the move tool afterwards dismisses it.
    expect(barSurvives(s.bar!, { doc: h.present, ...next, tool: "move" })).toBe(false);
  });

  it("renders the line as a status and three plain buttons (no filled or red button)", () => {
    const html = renderToStaticMarkup(<RegionResultBar copy={ko} comparing={false} onCompare={noop} onUndo={noop} onRefine={noop} />);
    expect(html).toContain("data-layers-result");
    expect(html).toMatch(/<p class="bsl-result-line" role="status">.*수정 사항이 적용되었습니다/);
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html).toContain(`title="${ko.region.compareHint}"`);
    expect(html).toContain('data-result-action="compare"');
    expect(html).toContain('aria-pressed="false"');
    for (const label of [ko.region.compare, ko.region.undo, ko.region.refine]) expect(html).toContain(label);
    expect(html).not.toContain('data-variant="solid"');
    expect(html).not.toContain('data-tone="danger"');

    const pressed = renderToStaticMarkup(<RegionResultBar copy={en} comparing onCompare={noop} onUndo={noop} onRefine={noop} />);
    expect(pressed).toContain('aria-pressed="true"');
    for (const label of ["Changes applied", "Compare", "Undo", "Refine edges"]) expect(pressed).toContain(label);
  });
});

describe("compare is display-only", () => {
  const MASK = "data:image/png;base64,BBBB";
  const reduce = (actions: Parameters<typeof resultBarReducer>[1][]) => actions.reduce(resultBarReducer, RESULT_BAR_IDLE);
  const twoPatches = () => land(land(createHistory(emptyDoc(1200, 1500)), "patch-1"), "patch-2", output({ id: "out-2", jobId: "job-2" }));

  /** An eraser stroke the way the stage makes one: target and start from the document it is given. */
  function stroke(h: History<LayerDoc>, input: LayerDoc, selectedId: string, blocked: boolean): History<LayerDoc> {
    const target = brushTarget(input, selectedId);
    if (!target) return h;
    const start = input;
    const shown = guardStageEdit(h, preview(h, updateLayer(start, target.id, { maskDataUrl: MASK })), blocked);
    return guardStageEdit(shown, settle(shown, start), blocked);
  }

  it("two patches: after 경계 다듬기 on patch 2, holding compare and rubbing changes nothing", () => {
    const h = twoPatches();
    const s = reduce([
      { type: "applied", layerId: "patch-2", jobId: "job-2", seq: 2, tool: "marquee" },
      { type: "refine" },
      { type: "compare", on: true },
    ]);
    const focus = focusForRefine({ tool: "marquee", selectedId: null, regionBox: null }, "patch-2");
    expect(editsBlocked(s.bar)).toBe(true);

    // The compare copy hides patch 2, so input read from it would aim at patch 1: input never reads it.
    const display = stageDocFor(h.present, s.bar);
    expect(brushTarget(display, "patch-2")?.id).toBe("patch-1");
    expect(brushTarget(h.present, "patch-2")?.id).toBe("patch-2");

    // Even if a stroke reached the history, it is kept out; the bar and the selection stay.
    const after = stroke(h, h.present, "patch-2", editsBlocked(s.bar));
    expect(after).toBe(h);
    expect(findLayer(after.present, "patch-1")?.hidden).toBe(false);
    expect(findLayer(after.present, "patch-2")?.hidden).toBe(false);
    expect(barSurvives(s.bar!, { doc: after.present, ...focus })).toBe(true);

    // What used to happen: a stroke started from the compare copy committed patch 2 hidden.
    const leaked = stroke(createHistory(h.present), display, "patch-2", false);
    expect(findLayer(leaked.present, "patch-2")?.hidden).toBe(true);
  });

  it("released, the same stroke erases patch 2 as one step and hides nothing", () => {
    const h = twoPatches();
    const s = reduce([
      { type: "applied", layerId: "patch-2", jobId: "job-2", seq: 2, tool: "marquee" },
      { type: "refine" },
      { type: "compare", on: true },
      { type: "compare", on: false },
    ]);
    expect(editsBlocked(s.bar)).toBe(false);
    const after = stroke(h, h.present, "patch-2", editsBlocked(s.bar));
    expect(after.past).toHaveLength(h.past.length + 1);
    const p2 = findLayer(after.present, "patch-2");
    expect(p2?.kind === "image" && p2.maskDataUrl).toBe(MASK);
    expect(p2?.hidden).toBe(false);
    expect(findLayer(after.present, "patch-1")?.hidden).toBe(false);
  });

  it("one patch: a stroke while comparing is dropped and the patch stays visible", () => {
    const h = land(createHistory(emptyDoc(1200, 1500)));
    const s = reduce([
      { type: "applied", layerId: "patch-1", jobId: "job-1", seq: 1, tool: "eraser" },
      { type: "compare", on: true },
    ]);
    const after = stroke(h, h.present, "patch-1", editsBlocked(s.bar));
    expect(after).toBe(h);
    expect(findLayer(after.present, "patch-1")?.hidden).toBe(false);
    expect(stageDocFor(after.present, s.bar)).not.toBe(after.present);
  });

  it("any other edit while comparing leaves the history alone", () => {
    const h = twoPatches();
    const s = reduce([{ type: "applied", layerId: "patch-2", jobId: "job-2", seq: 2, tool: "move" }, { type: "compare", on: true }]);
    const blocked = editsBlocked(s.bar);
    const edits: Array<(x: History<LayerDoc>) => History<LayerDoc>> = [
      (x) => commit(x, removeLayer(x.present, "patch-2")),
      (x) => commit(x, updateLayer(x.present, "patch-2", { hidden: true })),
      (x) => commit(x, updateLayer(x.present, "patch-1", { x: 99 })),
      (x) => preview(x, updateLayer(x.present, "patch-2", { rotation: 30 })),
      (x) => undo(x),
    ];
    for (const edit of edits) expect(guardStageEdit(h, edit(h), blocked)).toBe(h);
    // Released or dismissed, nothing is blocked any more.
    expect(editsBlocked(resultBarReducer(s, { type: "compare", on: false }).bar)).toBe(false);
    expect(editsBlocked(resultBarReducer(s, { type: "dismiss" }).bar)).toBe(false);
    expect(editsBlocked(null)).toBe(false);
  });

  it("a second pointer: canvas input after compare is ignored, a drag under way when compare starts is not kept", () => {
    const h = twoPatches();
    // Finger 1 holds compare, finger 2 rubs the canvas: the lock is for the whole editor, not one pointer.
    const s = reduce([{ type: "applied", layerId: "patch-2", jobId: "job-2", seq: 2, tool: "eraser" }, { type: "compare", on: true }]);
    expect(stroke(h, h.present, "patch-2", editsBlocked(s.bar))).toBe(h);

    // Finger 2 was already moving patch 2 (previews only) when finger 1 pressed compare: back to the start.
    const start = h.present;
    const moving = preview(h, updateLayer(start, "patch-2", { x: 400 }));
    expect(compareInterrupts("move")).toBe("revert");
    const reverted = revert(moving, start);
    expect(reverted.present).toBe(start);
    expect(reverted.past).toEqual(h.past);
    for (const mode of ["resize", "rotate", "canvas"] as const) expect(compareInterrupts(mode)).toBe("revert");
    // A brush stroke under way never previewed anything: it is dropped. Pan and box drags just stop.
    expect(compareInterrupts("brush")).toBe("drop");
    for (const mode of ["pan", "locked", "marqueeDraw", "marqueeMove", "marqueeResize"] as const) expect(compareInterrupts(mode)).toBe("stop");
  });
});

describe("the bar keeps the picture clear", () => {
  // Top: the measured bottom of the tool island; sides: the measured panel edges (1440 wide).
  const desktop = (width: number, height: number) => ({ top: 126, left: 304, right: 348, bottom: RESULT_STRIP, width, height });

  it("reserves its strip in the fit on larger screens", () => {
    for (const [width, height] of [
      [1440, 900],
      [1920, 1080],
    ] as const) {
      const s = desktop(width, height);
      const barTop = height - RESULT_BAR_BOX.bottom - RESULT_BAR_BOX.height;
      for (const canvas of [
        { width: 1200, height: 1500 },
        { width: 1080, height: 1920 },
        { width: 1280, height: 960 },
      ]) {
        const v = fitView({ width, height }, canvas, s, FIT_MARGIN.wide, 2);
        const pictureBottom = v.panY + canvas.height * v.zoom;
        expect(pictureBottom, `${width}x${height} ${canvas.width}x${canvas.height}`).toBeLessThanOrEqual(barTop - 8 + 0.5);
      }
    }
  });
});

describe("the bar ignores taps right after it appears", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("guards for BAR_ARM_MS and restarts when armed again", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T09:00:00.000Z"));
    const guard = createArmGuard();
    expect(guard.ready()).toBe(false);
    vi.advanceTimersByTime(BAR_ARM_MS - 1);
    expect(guard.ready()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(guard.ready()).toBe(true);
    guard.arm();
    expect(guard.ready()).toBe(false);
    vi.advanceTimersByTime(BAR_ARM_MS);
    expect(guard.ready()).toBe(true);
  });

  it("undo, refine and compare do nothing in the first 500 ms, pointer and keyboard alike", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T09:00:00.000Z"));
    const onCompare = vi.fn();
    const onUndo = vi.fn();
    const onRefine = vi.fn();
    const controls = createBarControls({ onCompare, onUndo, onRefine });

    // A second tap where the sheet's send button was (a click, or Enter/Space on a focused button).
    controls.undo();
    controls.refine();
    controls.pressCompare();
    controls.releaseCompare();
    vi.advanceTimersByTime(499);
    controls.undo();
    expect(onUndo).not.toHaveBeenCalled();
    expect(onRefine).not.toHaveBeenCalled();
    expect(onCompare).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    controls.undo();
    controls.refine();
    controls.pressCompare();
    controls.releaseCompare();
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRefine).toHaveBeenCalledTimes(1);
    expect(onCompare.mock.calls).toEqual([[true], [false]]);

    // Shown again after a phone sheet closes: quiet again.
    controls.arm();
    controls.undo();
    expect(onUndo).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    controls.undo();
    expect(onUndo).toHaveBeenCalledTimes(2);
  });

  it("does not draw its buttons disabled while quiet", () => {
    const html = renderToStaticMarkup(<RegionResultBar copy={ko} comparing={false} onCompare={noop} onUndo={noop} onRefine={noop} />);
    expect(html).not.toMatch(/disabled|aria-disabled/);
  });
});
