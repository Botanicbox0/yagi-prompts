import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createRef } from "react";
import type { StudioAssetView, StudioOutputView } from "@/lib/brand-studio/contracts";
import { regionEditModels } from "@/lib/brand-studio/models";
import { getDictionary } from "@/lib/i18n/dictionaries";
import {
  BASE_OP_ID,
  drawPlan,
  imageSources,
  planExport,
  planMergeDown,
  type CanvasLike,
} from "@/components/brand-studio/layers/export";
import { commit, createHistory, redo, undo } from "@/components/brand-studio/layers/history";
import {
  DEFAULT_BRUSH_HARDNESS,
  brushAlphaAt,
  dabPoints,
  stampMaskBuffer,
  worldPointToMask,
} from "@/components/brand-studio/layers/mask";
import {
  addLayer,
  canMergeDown,
  createImageLayer,
  createPatchLayer,
  createTextLayer,
  emptyDoc,
  mergeLayerDown,
  setBaseHidden,
  topVisibleImageLayerId,
  updateLayer,
} from "@/components/brand-studio/layers/model";
import {
  draftKey,
  loadDraft,
  parseDraft,
  sanitizeLayer,
  saveDraft,
  serializeDraft,
  type StorageLike,
} from "@/components/brand-studio/layers/persist";
import { RegionEditPanel } from "@/components/brand-studio/layers/region-panel";
import { graphemes } from "@/components/brand-studio/layers/text-layout";
import { LibraryRail } from "@/components/brand-studio/rail";
import { RailMenu } from "@/components/brand-studio/rail/parts";
import type { LibraryItemView, StudioFolderView, StudioLibrary } from "@/components/brand-studio/seams";

const mono = () => (text: string) => graphemes(text).length * 10;
const BASE_KEY = "o:5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d";
const ORG = "000000a0-0000-4000-8000-0000000000a0";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe("base visibility, patch layers & mask persistence", () => {
  it("toggles baseHidden, finds the topmost visible image layer, and round-trips maskDataUrl + baseHidden", () => {
    let doc = emptyDoc(1000, 800);
    const bottom = createPatchLayer(doc, {
      id: "patch1",
      url: "/api/brand-studio/media/st/patch-1.png",
      ref: { outputId: uuid(11) },
      box: { x: 100, y: 120, w: 300, h: 240 },
      name: "부분 수정 1",
      maskDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
    });
    const topHidden = {
      ...createImageLayer(doc, {
        id: "patch2",
        url: "/api/brand-studio/media/st/patch-2.png",
        ref: null,
        name: "부분 수정 2",
        natural: { width: 200, height: 200 },
      }),
      hidden: true,
    };
    const topText = createTextLayer(doc, { id: "txt1", text: "라벨", name: "글자 1" });
    doc = addLayer(addLayer(addLayer(doc, bottom), topHidden), topText);
    doc = setBaseHidden(doc, true);

    expect(doc.baseHidden).toBe(true);
    expect(topVisibleImageLayerId(doc)).toBe("patch1");

    const storage = memoryStorage();
    expect(saveDraft(storage, BASE_KEY, doc)).toBe(true);
    expect(storage.map.has(draftKey(BASE_KEY))).toBe(true);

    const loaded = loadDraft(storage, { baseKey: BASE_KEY, width: 1000, height: 800 });
    expect(loaded).not.toBeNull();
    expect(loaded?.baseHidden).toBe(true);
    const loadedPatch = loaded?.layers.find((l) => l.id === "patch1");
    expect(loadedPatch?.kind).toBe("image");
    if (loadedPatch?.kind === "image") {
      expect(loadedPatch.maskDataUrl).toBe(bottom.maskDataUrl);
    }

    // Even an otherwise empty doc keeps its draft while baseHidden is true, and clears when restored.
    const baseOnlyHidden = setBaseHidden(emptyDoc(1000, 800), true);
    expect(saveDraft(storage, BASE_KEY, baseOnlyHidden)).toBe(true);
    expect(parseDraft(serializeDraft(baseOnlyHidden, BASE_KEY), { baseKey: BASE_KEY, width: 1000, height: 800 })?.baseHidden).toBe(true);

    // Inline data URLs remain rejected on `src.url` so full picture bytes never bloat localStorage.
    expect(sanitizeLayer({ id: "bad", kind: "image", src: { url: "data:image/png;base64,AAAA" } })).toBeNull();
  });
});

describe("non-destructive brush mask & undo/redo history", () => {
  it("stamps soft feathered erase dabs at default 30% hardness, restores alpha, and undoes/redoes mask strokes", () => {
    expect(brushAlphaAt(0, 20, DEFAULT_BRUSH_HARDNESS)).toBeCloseTo(1, 5);
    const midAlpha = brushAlphaAt(12, 20, DEFAULT_BRUSH_HARDNESS);
    expect(midAlpha).toBeGreaterThan(0.15);
    expect(midAlpha).toBeLessThan(0.95);
    expect(brushAlphaAt(21, 20, DEFAULT_BRUSH_HARDNESS)).toBe(0);

    const mask = new Uint8ClampedArray(40 * 40).fill(255);

    stampMaskBuffer(mask, 40, 40, {
      from: { x: 20, y: 20 },
      to: { x: 20, y: 20 },
      radius: 10,
      hardness: DEFAULT_BRUSH_HARDNESS,
      mode: "erase",
    });

    const centerIdx = 20 * 40 + 20;
    const midIdx = 20 * 40 + 26;
    const outsideIdx = 2 * 40 + 2;
    expect(mask[centerIdx]).toBe(0);
    expect(mask[midIdx]).toBeGreaterThan(0);
    expect(mask[midIdx]).toBeLessThan(255);
    expect(mask[outsideIdx]).toBe(255);

    // Restore brush recovers erased opacity smoothly.
    stampMaskBuffer(mask, 40, 40, {
      from: { x: 20, y: 20 },
      to: { x: 20, y: 20 },
      radius: 10,
      hardness: 100,
      mode: "restore",
    });
    expect(mask[centerIdx]).toBe(255);

    // Continuous strokes interpolate evenly spaced dabs and map world points into rotated layer space.
    expect(dabPoints({ x: 0, y: 0 }, { x: 30, y: 0 }, 10).length).toBeGreaterThanOrEqual(8);
    const mapped = worldPointToMask(
      { x: 250, y: 200 },
      { x: 150, y: 100, w: 200, h: 200, rotation: 90 },
      { width: 100, height: 100 },
    );
    expect(mapped.x).toBeCloseTo(50, 4);
    expect(mapped.y).toBeCloseTo(50, 4);

    // Undo / Redo restores exact maskDataUrl snapshots per stroke.
    let doc = emptyDoc(800, 800);
    doc = addLayer(
      doc,
      createPatchLayer(doc, {
        id: "p1",
        url: "/api/brand-studio/media/st/p1.png",
        box: { x: 50, y: 50, w: 200, h: 200 },
        name: "부분 수정 1",
        maskDataUrl: "data:image/png;base64,MASK_INITIAL",
      }),
    );
    let h = createHistory(doc);
    h = commit(h, updateLayer(h.present, "p1", { maskDataUrl: "data:image/png;base64,MASK_STROKE_1" }));
    h = commit(h, updateLayer(h.present, "p1", { maskDataUrl: "data:image/png;base64,MASK_STROKE_2" }));

    expect(h.present.layers[0]?.kind === "image" && h.present.layers[0].maskDataUrl).toBe("data:image/png;base64,MASK_STROKE_2");
    h = undo(h);
    expect(h.present.layers[0]?.kind === "image" && h.present.layers[0].maskDataUrl).toBe("data:image/png;base64,MASK_STROKE_1");
    h = undo(h);
    expect(h.present.layers[0]?.kind === "image" && h.present.layers[0].maskDataUrl).toBe("data:image/png;base64,MASK_INITIAL");
    h = redo(h);
    expect(h.present.layers[0]?.kind === "image" && h.present.layers[0].maskDataUrl).toBe("data:image/png;base64,MASK_STROKE_1");
  });
});

describe("merge down & masked export compositing", () => {
  const base = { url: "/api/brand-studio/media/st/base.png", width: 1000, height: 800, name: "바탕 이미지" };

  it("merges an upper layer into the layer below, or flattens the bottom layer onto Base", () => {
    let doc = emptyDoc(1000, 800);
    const l1 = createPatchLayer(doc, {
      id: "l1",
      url: "/api/brand-studio/media/st/l1.png",
      box: { x: 100, y: 100, w: 200, h: 200 },
      name: "부분 수정 1",
    });
    const l2 = createPatchLayer(doc, {
      id: "l2",
      url: "/api/brand-studio/media/st/l2.png",
      box: { x: 220, y: 150, w: 180, h: 220 },
      name: "부분 수정 2",
    });
    doc = addLayer(addLayer(doc, l1), l2);

    expect(canMergeDown(doc, "l2")).toBe(true);
    expect(canMergeDown(doc, "l1")).toBe(true);
    expect(canMergeDown(updateLayer(doc, "l2", { locked: true }), "l2")).toBe(false);

    // Merging l2 into l1 plans a tight union bounding box [100..400, 100..370].
    const pairPlan = planMergeDown(doc, "l2", base, mono);
    expect(pairPlan).not.toBeNull();
    expect(pairPlan!.box).toEqual({ x: 100, y: 100, w: 300, h: 270 });
    expect(pairPlan!.plan.ops.map((o) => o.layerId)).toEqual(["l1", "l2"]);

    const afterPair = mergeLayerDown(doc, "l2", {
      url: "/api/brand-studio/media/st/merged-pair.png",
      box: pairPlan!.box,
      name: "합친 레이어 1",
      newId: "m1",
    });
    expect(afterPair.id).toBe("m1");
    expect(afterPair.doc.layers.map((l) => l.id)).toEqual(["m1"]);

    // Merging the bottom layer (index 0) bakes onto Base over the clipped layer bounds.
    const basePlan = planMergeDown(afterPair.doc, "m1", base, mono);
    expect(basePlan).not.toBeNull();
    expect(basePlan!.box).toEqual({ x: 100, y: 100, w: 300, h: 270 });
    expect(basePlan!.plan.ops.map((o) => o.layerId)).toEqual([BASE_OP_ID, "m1"]);
  });

  it("always exports Base even when baseHidden is true, and composites maskUrl via destination-in", () => {
    let doc = setBaseHidden(emptyDoc(1000, 800), true);
    doc = addLayer(
      doc,
      createPatchLayer(doc, {
        id: "masked",
        url: "/api/brand-studio/media/st/patch.png",
        box: { x: 100, y: 150, w: 300, h: 200 },
        name: "부분 수정 1",
        maskDataUrl: "data:image/png;base64,MASK_A",
      }),
    );

    const plan = planExport(doc, base, mono);
    expect(plan.ops.map((o) => o.layerId)).toEqual([BASE_OP_ID, "masked"]);
    const sources = imageSources(plan);
    expect(sources.has(base.url)).toBe(true);
    expect(sources.has("/api/brand-studio/media/st/patch.png")).toBe(true);
    expect(sources.has("data:image/png;base64,MASK_A")).toBe(true);

    const mainCalls: Array<[string, ...unknown[]]> = [];
    const offscreenOps: string[] = [];
    const makeCtx = (log: Array<[string, ...unknown[]]>, isOffscreen = false) => {
      let composite = "source-over";
      const ctx: Record<string, unknown> = {
        globalAlpha: 1,
        get globalCompositeOperation() {
          return composite;
        },
        set globalCompositeOperation(val: string) {
          composite = val;
          if (isOffscreen) offscreenOps.push(`comp:${val}`);
        },
        save: () => log.push(["save"]),
        restore: () => log.push(["restore"]),
        translate: (...a: unknown[]) => log.push(["translate", ...a]),
        rotate: (...a: unknown[]) => log.push(["rotate", ...a]),
        drawImage: (...a: unknown[]) => {
          log.push(["drawImage", ...a]);
          if (isOffscreen) offscreenOps.push("draw");
        },
      };
      return ctx as unknown as CanvasRenderingContext2D;
    };

    const offCanvas: CanvasLike = {
      getContext: () => makeCtx([], true),
      toBlob: (cb) => cb(new Blob([new Uint8Array(8)], { type: "image/png" })),
    };

    drawPlan(
      makeCtx(mainCalls),
      plan,
      new Map<string, CanvasImageSource>([
        [base.url, { tag: "base" } as unknown as CanvasImageSource],
        ["/api/brand-studio/media/st/patch.png", { tag: "patch" } as unknown as CanvasImageSource],
        ["data:image/png;base64,MASK_A", { tag: "mask" } as unknown as CanvasImageSource],
      ]),
      () => "'Pretendard Variable', sans-serif",
      () => offCanvas,
    );

    expect(offscreenOps).toEqual(["comp:source-over", "draw", "comp:destination-in", "draw", "comp:source-over"]);
    expect(mainCalls.filter((c) => c[0] === "drawImage")).toHaveLength(2);
  });
});

describe("LibraryRail & Oplux RegionEditPanel entry points", () => {
  const imageAsset: StudioAssetView = {
    id: uuid(1),
    kind: "image",
    role: "product",
    name: "Perfume Bottle",
    tags: [],
    url: "https://media.example/st/a-1.png",
    thumbUrl: null,
    width: 1000,
    height: 1200,
    seconds: null,
    source: "upload",
    createdAt: "2026-11-11T00:00:00Z",
  };
  const videoAsset: StudioAssetView = {
    ...imageAsset,
    id: uuid(2),
    kind: "video",
    name: "Clip.mp4",
    seconds: 5,
  };
  const likedImage: LibraryItemView = {
    key: `o:${uuid(3)}`,
    ref: { outputId: uuid(3) },
    kind: "image",
    url: "https://media.example/st/o-3.png",
    thumbUrl: null,
    name: "Hero Shot",
    width: 1024,
    height: 1024,
    seconds: null,
    createdAt: "2026-11-11T00:00:00Z",
  };
  const folder: StudioFolderView = {
    id: uuid(501),
    name: "캠페인 컷",
    count: 1,
    covers: [likedImage.url],
    updatedAt: "2026-11-11T00:00:00Z",
  };
  const stubLibrary = (): StudioLibrary => ({
    ready: true,
    folders: [folder],
    liked: new Set([likedImage.key]),
    likedItems: [likedImage],
    folderItems: () => [likedImage],
    openFolder: () => {},
    toggleLike: async () => true,
    createFolder: async () => null,
    renameFolder: async () => true,
    deleteFolder: async () => true,
    addToFolder: async () => true,
    removeFromFolder: async () => true,
  });

  it("exposes 부분 수정 and 꾸미기 on image items in Uploads and Liked tabs with zero solid buttons", () => {
    const libCopy = getDictionary("ko").studioLibrary;
    const uploadsHtml = renderToStaticMarkup(
      <LibraryRail
        id="rail-u"
        organizationId={ORG}
        locale="ko"
        library={stubLibrary()}
        assets={[imageAsset, videoAsset]}
        outputOf={(): StudioOutputView | null => null}
        canCreate
        attachOnPress
        open={false}
        notice={null}
        uploading={[]}
        searchId="s-u"
        onClose={() => {}}
        onAttach={() => {}}
        onView={() => {}}
        onFiles={() => {}}
        onUpdate={async () => ({ ok: true })}
        onDelete={async () => ({ ok: true })}
        onRegionEdit={() => {}}
        onDecorate={() => {}}
        copy={libCopy}
      />,
    );
    expect(uploadsHtml).toContain('aria-haspopup="menu"');
    expect(uploadsHtml).not.toContain('data-variant="solid"');

    const likedHtml = renderToStaticMarkup(
      <LibraryRail
        id="rail-l"
        organizationId={ORG}
        locale="ko"
        initialTab="liked"
        library={stubLibrary()}
        assets={[imageAsset]}
        outputOf={(): StudioOutputView | null => null}
        canCreate
        attachOnPress
        open={false}
        notice={null}
        uploading={[]}
        searchId="s-l"
        onClose={() => {}}
        onAttach={() => {}}
        onView={() => {}}
        onFiles={() => {}}
        onUpdate={async () => ({ ok: true })}
        onDelete={async () => ({ ok: true })}
        onRegionEdit={() => {}}
        onDecorate={() => {}}
        copy={libCopy}
      />,
    );
    expect(likedHtml).toContain(`data-library-item="${likedImage.key}"`);
    expect(likedHtml).toContain('aria-haspopup="menu"');
    expect(likedHtml).not.toContain('data-variant="solid"');

    // RailMenu trigger stays compact before opening.
    const menuTrigger = renderToStaticMarkup(
      <RailMenu
        open={false}
        label="더보기"
        items={[
          { key: "region", label: libCopy.item.regionEdit, run() {} },
          { key: "decorate", label: libCopy.item.decorate, run() {} },
        ]}
        onToggle={() => {}}
      />,
    );
    expect(menuTrigger).toContain('aria-haspopup="menu"');
  });

  it("renders Oplux RegionEditPanel with preview 1, 5-task Prompt Assistant, ! info toggles, auto-flatten, and credit-only single solid CTA", () => {
    const layersCopy = getDictionary("ko").studioLayers;
    const html = renderToStaticMarkup(
      <RegionEditPanel
        copy={layersCopy}
        locale="ko"
        baseSize={{ width: 1200, height: 1500 }}
        baseImgRef={createRef()}
        region={{
          sourceRef: { assetId: imageAsset.id },
          previewUrl: imageAsset.url,
          models: regionEditModels(),
          defaultModel: "nano-banana-pro",
          defaultQuality: null,
          jobs: [],
          errorText: () => "오류",
          submit: async () => ({ ok: false, message: "noop" }),
          enhancePrompt: async () => ({ ok: true, finalPrompt: "enhanced" }),
        }}
        box={{ x: 0.2, y: 0.25, w: 0.35, h: 0.3 }}
        autoFlatten={false}
        quickItems={[]}
        uploading={false}
        onBox={() => {}}
        onAutoFlatten={() => {}}
        resolveRef={() => null}
        onUploadRefs={async () => []}
        onSubmitted={() => {}}
      />,
    );

    expect(html).toContain("data-layers-region");
    expect(html).toContain("data-layers-region-preview");
    expect(html).toContain(">1<");
    expect(html).toContain("data-layers-assistant");
    for (const task of ["remove_mark", "place_mark", "swap_person", "enhance_detail", "custom"]) {
      expect(html).toContain(`data-task="${task}"`);
    }
    expect(html).toContain(layersCopy.region.autoFlatten);
    expect(html.match(/data-variant="solid"/g)).toHaveLength(1);
    expect(html).toContain("크레딧");
    expect(html).not.toMatch(/₩|KRW|\d\s*원/i);
  });
});
