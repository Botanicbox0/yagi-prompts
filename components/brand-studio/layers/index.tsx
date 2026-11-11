"use client";
/**
 * Unified "꾸미기 + 부분 수정" Layer Editor (`docs/BRAND-STUDIO-REGION-LAYERS.md` §1–§4, V3 §5):
 * - Full-screen zoomed/panned stage with `move`, `marquee` (RegionBox), `eraser` and `restore` brush tools
 * - Top Floating Contextual Island toolbar (smoothly expands Size `8..300px` & Hardness `0..100%`, default `30%`)
 * - Base visibility toggle (`baseHidden` -> checkerboard) + non-destructive alpha-mask layers (`maskDataUrl`)
 * - In-editor Oplux Region Edit panel + non-blocking job tracking that lands finished patches as new layers
 * - `mergeDown` ("아래로 합치기") and full-resolution PNG export.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { STUDIO_UPLOAD_MIMES, type RegionBox, type StudioAssetView } from "@/lib/brand-studio/contracts";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { useModal } from "../modal";
import { trayItemFromAsset, type RefSource, type TrayItem } from "../refs";
import { nudgeBox } from "../region-math";
import { libraryKey, type LayerEditorProps, type LibraryItemView } from "../seams";
import { browserRenderDeps, loadMaskAsDataUrl, measurerFor, naturalSize, waitForLayerFonts, warmFonts } from "./browser";
import { pushRecent } from "./colors";
import { EXPORT_STEPS, exportFileName, planExport, planMergeDown, renderPlan, type ExportStep, type RenderResult } from "./export";
import { ZOOM_STEP, fitView, nudgeDelta, zoomCentered, type Insets, type Point, type View } from "./geometry";
import { canRedo, canUndo, commit, createHistory, preview, redo, settle, undo, type History } from "./history";
import { LayerIcon, type LayerIconName } from "./icons";
import {
  BRUSH_HARDNESS_MAX,
  BRUSH_HARDNESS_MIN,
  BRUSH_SIZE_MAX,
  BRUSH_SIZE_MIN,
  DEFAULT_BRUSH_HARDNESS,
  DEFAULT_BRUSH_SIZE,
} from "./mask";
import {
  DEFAULT_PLATE,
  MAX_LAYERS,
  addLayer,
  canMergeDown,
  clamp,
  createImageLayer,
  createPatchLayer,
  createShapeLayer,
  createTextLayer,
  duplicateLayer,
  emptyDoc,
  findLayer,
  mergeLayerDown,
  moveLayer,
  newLayerId,
  nextName,
  removeLayer,
  setBaseHidden,
  topVisibleImageLayerId,
  updateLayer,
  withPlate,
  type Frame,
  type LayerDoc,
  type LayerPatch,
  type LayerTool,
  type TextLayer,
} from "./model";
import { AddPanel, IconButton, LayersPanel, PropsPanel, fill, type PickItem } from "./panels";
import { browserStorage, clearDraft, loadDraft, loadRecentColors, saveDraft, saveRecentColors } from "./persist";
import { RegionEditPanel } from "./region-panel";
import { Stage } from "./stage";
import { layoutText, type TextLayout } from "./text-layout";
import "./layers.css";

type Sheet = "add" | "region" | "layers" | "props";
const NOTICE_MS = 4600;
const ROLE_ORDER: Record<string, number> = { logo: 0, product: 1 };

const fromAsset = (asset: StudioAssetView): PickItem => ({
  key: `a:${asset.id}`,
  ref: { assetId: asset.id },
  url: asset.url,
  thumbUrl: asset.thumbUrl,
  name: asset.name,
  width: asset.width,
  height: asset.height,
  role: asset.role,
});

const fromLibrary = (item: LibraryItemView, fallback: string): PickItem => ({
  key: item.key,
  ref: item.ref,
  url: item.url,
  thumbUrl: item.thumbUrl,
  name: item.name ?? fallback,
  width: item.width,
  height: item.height,
});

function pickToTray(item: PickItem): TrayItem | null {
  if (!item.ref) return null;
  return {
    key: item.key,
    kind: "image",
    name: item.name,
    url: item.url,
    thumbUrl: item.thumbUrl,
    width: item.width,
    height: item.height,
    seconds: null,
    role: item.role ?? undefined,
    ...("assetId" in item.ref ? { assetId: item.ref.assetId } : { outputId: item.ref.outputId }),
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("read failed")));
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

/** A reopened draft points its pictures at the current asset addresses where it can. */
function refreshUrls(doc: LayerDoc, assets: readonly StudioAssetView[]): LayerDoc {
  let next = doc;
  for (const layer of doc.layers) {
    if (layer.kind !== "image" || !layer.src.ref || !("assetId" in layer.src.ref)) continue;
    const id = layer.src.ref.assetId;
    const asset = assets.find((a) => a.id === id);
    if (asset && asset.url !== layer.src.url) next = updateLayer(next, layer.id, { src: { ...layer.src, url: asset.url } });
  }
  return next;
}

interface TrackedRegionJob {
  jobId: string;
  autoFlatten: boolean;
  box: RegionBox;
}

export default function LayerEditor(props: LayerEditorProps & { copy: Dictionary["studioLayers"] }) {
  const { base, copy } = props;
  const baseKey = libraryKey(base.ref);
  const storage = useMemo(() => browserStorage(), []);
  const dialogRef = useModal();
  const stageRef = useRef<HTMLDivElement>(null);
  const baseImgRef = useRef<HTMLImageElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const islandRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLElement>(null);
  const rightRef = useRef<HTMLElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const hintId = useId();

  const [initial] = useState(() => {
    const restored = loadDraft(storage, { baseKey, width: base.width, height: base.height });
    let doc = restored ? refreshUrls(restored, props.assets) : emptyDoc(base.width, base.height);
    let initialSelected: string | null = null;
    if (props.initialPatch) {
      const existing = doc.layers.find(
        (l) => (props.initialPatch?.id && l.id === props.initialPatch.id) || (l.kind === "image" && l.src.url === props.initialPatch?.url),
      );
      if (existing) {
        initialSelected = existing.id;
      } else {
        const patchLayer = createPatchLayer(doc, {
          id: props.initialPatch.id,
          url: props.initialPatch.url,
          ref: props.initialPatch.ref ?? null,
          box: props.initialPatch.box,
          name: props.initialPatch.name ?? nextName(doc, copy.names.regionPatch),
          maskDataUrl: props.initialPatch.maskUrl,
        });
        doc = addLayer(doc, patchLayer);
        initialSelected = patchLayer.id;
      }
    }
    return { doc, restored: Boolean(restored?.layers.length), initialSelected };
  });

  const [history, setHistory] = useState<History<LayerDoc>>(() => createHistory(initial.doc));
  const doc = history.present;
  const historyRef = useRef(history);
  historyRef.current = history;
  const savedRef = useRef<LayerDoc>(initial.doc);
  const discardedRef = useRef(false);
  const closingRef = useRef(false);
  const escapeAtRef = useRef(0);
  const editStartRef = useRef<LayerDoc | null>(null);
  const pendingEditRef = useRef<string | null>(null);
  const autoFitRef = useRef(true);
  const handledJobsRef = useRef<Set<string>>(new Set());

  const [tool, setToolState] = useState<LayerTool>(props.initialTool ?? "move");
  const [brushSize, setBrushSize] = useState<number>(DEFAULT_BRUSH_SIZE);
  const [brushHardness, setBrushHardness] = useState<number>(DEFAULT_BRUSH_HARDNESS);
  const [regionBox, setRegionBox] = useState<RegionBox | null>(props.initialRegionPreset?.box ?? null);
  const [autoFlatten, setAutoFlatten] = useState<boolean>(false);
  const [pendingRegionJobs, setPendingRegionJobs] = useState<TrackedRegionJob[]>([]);

  const [selectedId, setSelectedId] = useState<string | null>(initial.initialSelected);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [view, setView] = useState<View>({ zoom: 0.2, panX: 0, panY: 0 });
  const [spaceDown, setSpaceDown] = useState(false);
  const [fontsVersion, setFontsVersion] = useState(0);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [recent, setRecent] = useState<string[]>(() => loadRecentColors(storage));
  const [notice, setNotice] = useState<string | null>(initial.restored ? copy.restored : null);
  const [live, setLive] = useState("");
  const [uploading, setUploading] = useState<string[]>([]);
  const [step, setStep] = useState<ExportStep | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(props.initialTool === "marquee" && props.region ? "region" : null);

  const say = useCallback((message: string) => setNotice(message), []);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(t);
  }, [notice]);

  // Convert server mask URL on `initialPatch` into an inline PNG Data URL so brush strokes never taint.
  useEffect(() => {
    const patchInfo = props.initialPatch;
    if (!patchInfo?.maskUrl || patchInfo.maskUrl.startsWith("data:image/")) return;
    const targetId = initial.initialSelected;
    if (!targetId) return;
    let alive = true;
    void loadMaskAsDataUrl(patchInfo.maskUrl).then((dataUrl) => {
      if (!alive || !dataUrl || !dataUrl.startsWith("data:image/")) return;
      setHistory((h) => {
        const nextPresent = updateLayer(h.present, targetId, { maskDataUrl: dataUrl });
        return { ...h, present: nextPresent };
      });
    });
    return () => {
      alive = false;
    };
  }, [props.initialPatch, initial.initialSelected]);

  /* ------------------------------------------------------------ fonts and layout */

  useEffect(() => {
    warmFonts();
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (!fonts) return;
    const bump = () => setFontsVersion((v) => v + 1);
    fonts.addEventListener?.("loadingdone", bump);
    void fonts.ready.then(bump);
    return () => fonts.removeEventListener?.("loadingdone", bump);
  }, []);

  // Text layouts cached per layer object (edits replace only the layers they touch); fonts loading resets it.
  const layoutCache = useRef<{ version: number; map: WeakMap<TextLayer, TextLayout> }>({ version: -1, map: new WeakMap() });
  const layouts = useMemo(() => {
    if (layoutCache.current.version !== fontsVersion) layoutCache.current = { version: fontsVersion, map: new WeakMap() };
    const cache = layoutCache.current.map;
    const map = new Map<string, TextLayout>();
    for (const layer of doc.layers) {
      if (layer.kind !== "text") continue;
      let layout = cache.get(layer);
      if (!layout) {
        layout = layoutText(layer, measurerFor(layer));
        cache.set(layer, layout);
      }
      map.set(layer.id, layout);
    }
    return map;
  }, [doc.layers, fontsVersion]);
  const frames = useMemo(() => {
    const map = new Map<string, Frame>();
    for (const l of doc.layers) map.set(l.id, { x: l.x, y: l.y, w: l.w, h: l.kind === "text" ? (layouts.get(l.id)?.height ?? l.h) : l.h, rotation: l.rotation });
    return map;
  }, [doc.layers, layouts]);

  const selected = findLayer(doc, selectedId);
  useEffect(() => {
    if (selectedId && !findLayer(doc, selectedId)) setSelectedId(null);
  }, [doc, selectedId]);
  useEffect(() => {
    const layer = findLayer(historyRef.current.present, selectedId);
    setLive(layer ? fill(copy.stage.selected, { name: layer.name }) : "");
  }, [selectedId, copy.stage.selected]);

  /* --------------------------------------------------------------------- view */

  const insets = useCallback((): Insets => {
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage) return { top: 0, right: 0, bottom: 0, left: 0 };
    const phone = window.matchMedia("(max-width: 720px)").matches;
    const top = topRef.current?.getBoundingClientRect();
    const island = islandRef.current?.getBoundingClientRect();
    const bar = barRef.current?.getBoundingClientRect();
    const left = leftRef.current?.getBoundingClientRect();
    const right = rightRef.current?.getBoundingClientRect();
    const topBottom = Math.max(top ? top.bottom - stage.top : 0, island ? island.bottom - stage.top : 0);
    return {
      top: Math.max(0, topBottom),
      bottom: phone && bar ? Math.max(0, stage.bottom - bar.top) : 0,
      left: !phone && left ? Math.max(0, left.right - stage.left) : 0,
      right: !phone && right ? Math.max(0, stage.right - right.left) : 0,
    };
  }, []);

  const fit = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    const phone = window.matchMedia("(max-width: 720px)").matches;
    setView(fitView({ width: el.clientWidth, height: el.clientHeight }, { width: base.width, height: base.height }, insets(), phone ? 12 : 28, 2));
  }, [base.width, base.height, insets]);

  useEffect(() => {
    fit();
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => autoFitRef.current && fit());
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit]);

  const onView = useCallback((update: (v: View) => View) => {
    autoFitRef.current = false;
    setView(update);
  }, []);
  const stageSize = () => ({ width: stageRef.current?.clientWidth ?? 0, height: stageRef.current?.clientHeight ?? 0 });
  const zoomBy = (factor: number) => onView((v) => zoomCentered(v, stageSize(), v.zoom * factor));
  const zoomActual = () => onView((v) => zoomCentered(v, stageSize(), 1));
  const zoomFit = () => {
    autoFitRef.current = true;
    fit();
  };

  /* ------------------------------------------------------------------ history */

  const edit = useCallback((fn: (d: LayerDoc) => LayerDoc, key?: string) => setHistory((h) => commit(h, fn(h.present), key ? { key } : {})), []);
  const patch = useCallback((id: string, p: LayerPatch, key?: string) => edit((d) => updateLayer(d, id, p), key), [edit]);

  const startEdit = useCallback((id: string) => {
    const layer = findLayer(historyRef.current.present, id);
    if (!layer || layer.kind !== "text" || layer.locked) return;
    editStartRef.current = historyRef.current.present;
    setSelectedId(id);
    setEditingId(id);
    setToolState("move");
  }, []);

  const stopEdit = useCallback(() => {
    const start = editStartRef.current;
    const id = editingId;
    editStartRef.current = null;
    setEditingId(null);
    if (!id) return;
    setHistory((h) => {
      const layer = findLayer(h.present, id);
      const present = layer?.kind === "text" && !layer.text.trim() ? removeLayer(h.present, id) : h.present;
      const shown = preview(h, present);
      return start ? settle(shown, start) : shown;
    });
  }, [editingId]);

  const selectTool = useCallback(
    (nextTool: LayerTool) => {
      if (editingId && nextTool !== "move") stopEdit();
      setToolState(nextTool);
      if (nextTool === "eraser" || nextTool === "restore") {
        const cur = findLayer(historyRef.current.present, selectedId);
        if (!cur || cur.kind !== "image" || cur.hidden) {
          const topId = topVisibleImageLayerId(historyRef.current.present);
          if (topId) setSelectedId(topId);
        }
      }
    },
    [editingId, selectedId, stopEdit],
  );

  const toggleBase = useCallback(() => {
    const curDoc = historyRef.current.present;
    const nextHidden = !curDoc.baseHidden;
    edit((d) => setBaseHidden(d, nextHidden));
    if (nextHidden && !selectedId) {
      const topId = topVisibleImageLayerId(curDoc);
      if (topId) setSelectedId(topId);
    }
  }, [edit, selectedId]);

  useEffect(() => {
    const id = pendingEditRef.current;
    if (id && findLayer(doc, id)) {
      pendingEditRef.current = null;
      startEdit(id);
    }
  }, [doc, startEdit]);

  const doUndo = () => {
    if (editingId) stopEdit();
    setHistory(undo);
  };
  const doRedo = () => {
    if (editingId) stopEdit();
    setHistory(redo);
  };

  /* --------------------------------------------------- non-blocking region jobs */

  useEffect(() => {
    if (!pendingRegionJobs.length || !props.region) return;
    const liveJobs = props.region.jobs;
    const settledEntries = pendingRegionJobs.filter((entry) => {
      const hit = liveJobs.find((j) => j.id === entry.jobId);
      return hit && (hit.status === "succeeded" || hit.status === "failed" || hit.status === "canceled");
    });
    if (!settledEntries.length) return;

    const settledIds = new Set(settledEntries.map((e) => e.jobId));
    setPendingRegionJobs((cur) => cur.filter((e) => !settledIds.has(e.jobId)));

    for (const entry of settledEntries) {
      if (handledJobsRef.current.has(entry.jobId)) continue;
      handledJobsRef.current.add(entry.jobId);
      const job = liveJobs.find((j) => j.id === entry.jobId);
      if (!job) continue;

      if (job.status === "failed") {
        setExportError(null);
        say(props.region.errorText(job.errorCode) || copy.region.failedToast);
        continue;
      }
      if (job.status !== "succeeded") continue;

      const output = job.outputs.find((o) => o.kind === "image");
      if (entry.autoFlatten || !output) {
        say(copy.region.autoFlattenedDone);
        continue;
      }

      void (async () => {
        const rp = output.regionPatch;
        const maskDataUrl = rp?.maskUrl ? await loadMaskAsDataUrl(rp.maskUrl) : null;
        const normBox = rp ? { x: rp.x, y: rp.y, w: rp.w, h: rp.h } : entry.box;
        const pxBox = {
          x: normBox.x * base.width,
          y: normBox.y * base.height,
          w: normBox.w * base.width,
          h: normBox.h * base.height,
        };
        const patchUrl = rp?.url ?? output.url;
        const newId = newLayerId();
        edit((d) => {
          if (d.layers.length >= MAX_LAYERS) return d;
          const layer = createPatchLayer(d, {
            id: newId,
            url: patchUrl,
            ref: { outputId: output.id },
            box: pxBox,
            name: nextName(d, copy.names.regionPatch),
            maskDataUrl,
          });
          return addLayer(d, layer);
        });
        setSelectedId(newId);
        setRegionBox(null);
        setToolState("eraser");
        say(copy.region.patchArrived);
      })();
    }
  }, [pendingRegionJobs, props.region, base.width, base.height, copy.names.regionPatch, copy.region, edit, say]);

  /* ------------------------------------------------------------------- adding */

  const atLimit = () => {
    if (historyRef.current.present.layers.length < MAX_LAYERS) return false;
    say(fill(copy.stage.tooMany, { n: MAX_LAYERS }));
    return true;
  };

  const addText = () => {
    if (atLimit()) return;
    const d = historyRef.current.present;
    const layer = createTextLayer(d, { text: copy.names.defaultText, name: nextName(d, copy.names.text) });
    edit((x) => addLayer(x, layer));
    setSelectedId(layer.id);
    setToolState("move");
    pendingEditRef.current = layer.id;
    setSheet(null);
  };

  const addShape = (shape: "rect" | "ellipse") => {
    if (atLimit()) return;
    const d = historyRef.current.present;
    const layer = createShapeLayer(d, { shape, name: nextName(d, shape === "rect" ? copy.names.rect : copy.names.ellipse) });
    edit((x) => addLayer(x, layer));
    setSelectedId(layer.id);
    setToolState("move");
    setSheet(null);
  };

  const addImage = async (item: PickItem, at?: Point) => {
    if (atLimit()) return;
    const natural = item.width && item.height ? { width: item.width, height: item.height } : await naturalSize(item.url);
    const d = historyRef.current.present;
    const layer = createImageLayer(d, { url: item.url, ref: item.ref, name: item.name || nextName(d, copy.names.image), natural, ...(at ? { at } : {}) });
    edit((x) => addLayer(x, layer));
    setSelectedId(layer.id);
    setToolState("move");
    setSheet(null);
  };

  const assetItems = useMemo(
    () =>
      props.assets
        .filter((a) => a.kind === "image")
        .sort((a, b) => (ROLE_ORDER[a.role ?? ""] ?? 2) - (ROLE_ORDER[b.role ?? ""] ?? 2) || b.createdAt.localeCompare(a.createdAt))
        .map(fromAsset),
    [props.assets],
  );
  const likedItems = useMemo(
    () => (props.library?.likedItems ?? []).filter((i) => i.kind === "image").map((i) => fromLibrary(i, copy.names.image)),
    [props.library?.likedItems, copy.names.image],
  );
  const folderItems = (folderId: string) => props.library?.folderItems(folderId)?.filter((i) => i.kind === "image").map((i) => fromLibrary(i, copy.names.image)) ?? null;

  const quickTrayItems = useMemo(() => {
    const out: TrayItem[] = [];
    const seen = new Set<string>([baseKey]);
    for (const item of [...assetItems, ...likedItems]) {
      if (seen.has(item.key)) continue;
      const tray = pickToTray(item);
      if (tray) {
        seen.add(item.key);
        out.push(tray);
      }
    }
    return out;
  }, [assetItems, likedItems, baseKey]);

  const resolveRef = (ref: RefSource): PickItem | null => {
    const key = libraryKey(ref);
    const pools: PickItem[][] = [assetItems, likedItems, ...(props.library?.folders ?? []).map((f) => folderItems(f.id) ?? [])];
    for (const pool of pools) {
      const hit = pool.find((i) => i.key === key);
      if (hit) return hit;
    }
    if (key === baseKey) return { key, ref, url: base.url, thumbUrl: null, name: base.name ?? copy.names.image, width: base.width, height: base.height };
    return null;
  };

  const uploadFiles = async (files: File[], at?: Point) => {
    for (const file of files) {
      if (!(STUDIO_UPLOAD_MIMES.image as readonly string[]).includes(file.type)) {
        say(copy.stage.notImage);
        continue;
      }
      setUploading((u) => [...u, file.name]);
      try {
        const result = await props.upload(file);
        if (result.ok) await addImage(fromAsset(result.asset), at);
        else say(fill(copy.stage.uploadFailed, { name: file.name }));
      } catch {
        say(fill(copy.stage.uploadFailed, { name: file.name }));
      } finally {
        setUploading((u) => {
          const i = u.indexOf(file.name);
          return i < 0 ? u : [...u.slice(0, i), ...u.slice(i + 1)];
        });
      }
    }
  };

  const uploadRegionRefFiles = async (files: File[]): Promise<TrayItem[]> => {
    const added: TrayItem[] = [];
    for (const file of files) {
      if (!(STUDIO_UPLOAD_MIMES.image as readonly string[]).includes(file.type)) {
        say(copy.stage.notImage);
        continue;
      }
      setUploading((u) => [...u, file.name]);
      try {
        const result = await props.upload(file);
        if (result.ok) added.push(trayItemFromAsset(result.asset));
        else say(fill(copy.stage.uploadFailed, { name: file.name }));
      } catch {
        say(fill(copy.stage.uploadFailed, { name: file.name }));
      } finally {
        setUploading((u) => {
          const i = u.indexOf(file.name);
          return i < 0 ? u : [...u.slice(0, i), ...u.slice(i + 1)];
        });
      }
    }
    return added;
  };

  /* -------------------------------------------------------------- layer edits */

  const duplicate = (id: string) => {
    if (atLimit()) return;
    const newId = newLayerId();
    edit((d) => duplicateLayer(d, id, { newId, suffix: copy.names.copySuffix }).doc);
    setSelectedId(newId);
  };
  const remove = (id: string) => {
    if (findLayer(historyRef.current.present, id)?.locked) return say(copy.stage.locked);
    if (editingId === id) {
      editStartRef.current = null;
      setEditingId(null);
    }
    edit((d) => removeLayer(d, id));
    setSelectedId(null);
  };
  const reorder = (id: string, stepBy: 1 | -1) => edit((d) => moveLayer(d, id, stepBy));
  const mergeDown = async (id: string) => {
    const current = historyRef.current.present;
    if (!canMergeDown(current, id)) return;
    if (editingId) stopEdit();
    try {
      const textLayers = current.layers.filter((l): l is TextLayer => l.kind === "text" && !l.hidden);
      if (textLayers.length) await waitForLayerFonts(textLayers);
      const planned = planMergeDown(current, id, { url: base.url, width: base.width, height: base.height, name: copy.names.base }, measurerFor);
      if (!planned) return say(copy.layers.mergeFailed);
      const rendered = await renderPlan(planned.plan, browserRenderDeps(() => {}));
      if (!rendered.ok) return say(copy.layers.mergeFailed);
      const dataUrl = await blobToDataUrl(rendered.blob);
      const newId = newLayerId();
      edit((d) => mergeLayerDown(d, id, { url: dataUrl, box: planned.box, name: nextName(d, copy.names.merged), newId }).doc);
      setSelectedId(newId);
      say(copy.layers.mergedDone);
    } catch {
      say(copy.layers.mergeFailed);
    }
  };
  const nudge = (id: string, delta: Point) =>
    edit((d) => {
      const layer = findLayer(d, id);
      return layer && !layer.locked ? updateLayer(d, id, { x: layer.x + delta.x, y: layer.y + delta.y }) : d;
    }, `${id}:nudge`);
  const togglePlate = (layer: TextLayer) =>
    edit((d) => {
      const current = findLayer(d, layer.id);
      return current?.kind === "text" ? updateLayer(d, layer.id, withPlate(current, current.plate ? null : DEFAULT_PLATE)) : d;
    });
  const restoreRatio = async (id: string) => {
    const layer = findLayer(historyRef.current.present, id);
    if (layer?.kind !== "image") return;
    const natural = await naturalSize(layer.src.url);
    if (!natural) return;
    edit((d) => {
      const l = findLayer(d, id);
      if (!l) return d;
      const h = (l.w * natural.height) / natural.width;
      return updateLayer(d, id, { h, y: l.y + (l.h - h) / 2 });
    });
  };
  const colorUsed = (color: string) =>
    setRecent((r) => {
      const next = pushRecent(r, color);
      saveRecentColors(storage, next);
      return next;
    });
  const reset = () => {
    if (!historyRef.current.present.layers.length && !historyRef.current.present.baseHidden) return;
    if (editingId) {
      editStartRef.current = null;
      setEditingId(null);
    }
    edit((d) => ({ v: d.v, width: d.width, height: d.height, layers: [] }));
    setSelectedId(null);
    say(copy.resetDone);
  };

  /* -------------------------------------------------------------------- draft */

  useEffect(() => {
    if (discardedRef.current) return;
    const t = window.setTimeout(() => saveDraft(storage, baseKey, doc), 400);
    return () => window.clearTimeout(t);
  }, [doc, storage, baseKey]);
  useEffect(
    () => () => {
      if (!discardedRef.current) saveDraft(storage, baseKey, historyRef.current.present);
    },
    [storage, baseKey],
  );

  /* -------------------------------------------------------------------- close */

  const dirty = () =>
    JSON.stringify(historyRef.current.present.layers) !== JSON.stringify(savedRef.current.layers) ||
    Boolean(historyRef.current.present.baseHidden) !== Boolean(savedRef.current.baseHidden);

  const finishClose = (mode: "keep" | "discard") => {
    if (mode === "discard") {
      discardedRef.current = true;
      clearDraft(storage, baseKey);
    } else saveDraft(storage, baseKey, historyRef.current.present);
    closingRef.current = true;
    props.onClose();
  };
  const requestClose = () => {
    if (step) return;
    if (dirty()) setConfirming(true);
    else finishClose("keep");
  };
  useEffect(() => {
    if (confirming) keepRef.current?.focus();
  }, [confirming]);

  const handleEscape = () => {
    if (confirming) return setConfirming(false);
    if (step) return;
    if (editingId) return stopEdit();
    if (sheet) return setSheet(null);
    if (regionBox) return setRegionBox(null);
    if (selectedId) return setSelectedId(null);
    requestClose();
  };

  /* ------------------------------------------------------------------- export */

  const failure = (result: Exclude<RenderResult, { ok: true }>): string => {
    if (result.reason === "image") return fill(copy.export.failImage, { names: result.names.map((n) => `‘${n}’`).join(", ") });
    if (result.reason === "blocked") return copy.export.failBlocked;
    if (result.reason === "too-big") return copy.export.failTooBig;
    return copy.export.failCanvas;
  };

  const save = async () => {
    if (step) return;
    if (editingId) stopEdit();
    setExportError(null);
    setStep("fonts");
    const current = historyRef.current.present;
    try {
      await waitForLayerFonts(current.layers.filter((l): l is TextLayer => l.kind === "text" && !l.hidden));
      const plan = planExport(current, { url: base.url, width: base.width, height: base.height, name: copy.names.base }, measurerFor);
      const result = await renderPlan(plan, browserRenderDeps((s) => setStep(s)));
      if (!result.ok) {
        setExportError(failure(result));
        setStep(null);
        return;
      }
      setStep("saving");
      const file = new File([result.blob], exportFileName(base.name ?? copy.export.fallbackName, copy.export.fileSuffix, result.mime), { type: result.mime });
      const uploaded = await props.upload(file);
      if (!uploaded.ok) {
        setExportError(copy.export.failUpload);
        setStep(null);
        return;
      }
      savedRef.current = current;
      saveDraft(storage, baseKey, current);
      closingRef.current = true;
      props.onSaved(uploaded.asset);
      props.onClose();
    } catch {
      setExportError(copy.export.failUpload);
      setStep(null);
    }
  };

  /* ----------------------------------------------------------------- keyboard */

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      escapeAtRef.current = performance.now();
      handleEscape();
      return;
    }
    if (confirming || step) return;
    const target = event.target as HTMLElement;
    const typing = Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (typing) {
      if (mod && key === "enter" && editingId) {
        event.preventDefault();
        stopEdit();
      }
      return;
    }
    const act = (fn: () => void) => {
      event.preventDefault();
      fn();
    };
    if (mod && key === "z") return act(event.shiftKey ? doRedo : doUndo);
    if (mod && key === "y") return act(doRedo);
    if (mod && key === "d") return act(() => selectedId && duplicate(selectedId));
    if (mod && (key === "=" || key === "+")) return act(() => zoomBy(ZOOM_STEP));
    if (mod && key === "-") return act(() => zoomBy(1 / ZOOM_STEP));
    if (mod && key === "0") return act(zoomFit);
    if (mod && key === "1") return act(zoomActual);
    if (mod && key === "]") return act(() => selectedId && reorder(selectedId, 1));
    if (mod && key === "[") return act(() => selectedId && reorder(selectedId, -1));
    if (mod) return;

    if (key === "v") return act(() => selectTool("move"));
    if (key === "m" && props.region) return act(() => selectTool("marquee"));
    if (key === "e") return act(() => selectTool("eraser"));
    if (key === "b" || key === "r") return act(() => selectTool("restore"));
    if ((tool === "eraser" || tool === "restore") && event.key === "[") {
      return act(() => setBrushSize((s) => clamp(s - 8, BRUSH_SIZE_MIN, BRUSH_SIZE_MAX)));
    }
    if ((tool === "eraser" || tool === "restore") && event.key === "]") {
      return act(() => setBrushSize((s) => clamp(s + 8, BRUSH_SIZE_MIN, BRUSH_SIZE_MAX)));
    }

    if (tool === "marquee" && regionBox) {
      const nextBox = nudgeBox(regionBox, event.key, event.shiftKey);
      if (nextBox) return act(() => setRegionBox(nextBox));
    }

    if ((event.key === "Delete" || event.key === "Backspace") && selectedId && tool === "move") return act(() => remove(selectedId));
    const delta = nudgeDelta(event.key, event.shiftKey);
    if (delta && selectedId && tool === "move") return act(() => nudge(selectedId, delta));
    if (event.key === "Enter" && selected?.kind === "text" && target === stageRef.current && tool === "move") return act(() => startEdit(selected.id));
    if (event.key === " " && (target === stageRef.current || target === dialogRef.current)) return act(() => setSpaceDown(true));
  };

  useEffect(() => {
    const up = () => setSpaceDown(false);
    window.addEventListener("blur", up);
    return () => window.removeEventListener("blur", up);
  }, []);

  /* ------------------------------------------------------------------- render */

  const busy = Boolean(step);
  const stepIndex = step ? EXPORT_STEPS.indexOf(step) + 1 : 0;
  const zoomPercent = `${Math.round(view.zoom * 100)}%`;
  const frameHeight = selected ? (frames.get(selected.id)?.h ?? selected.h) : 0;
  const showRegionSection = Boolean(props.region && (tool === "marquee" || regionBox !== null));
  const brushActive = tool === "eraser" || tool === "restore";

  const toolButtons: Array<{ id: LayerTool; icon: LayerIconName; label: string; show: boolean }> = [
    { id: "move", icon: "move", label: copy.tools.move, show: true },
    { id: "marquee", icon: "marquee", label: copy.tools.marquee, show: Boolean(props.region) },
    { id: "eraser", icon: "eraser", label: copy.tools.eraser, show: true },
    { id: "restore", icon: "restore", label: copy.tools.restore, show: true },
  ];

  const barSheets: Sheet[] = props.region ? ["add", "region", "layers", "props"] : ["add", "layers", "props"];

  return (
    <dialog
      ref={dialogRef}
      className="bsl-dialog"
      aria-labelledby={titleId}
      data-layer-editor
      onKeyDown={onKeyDown}
      onKeyUp={(event) => event.key === " " && setSpaceDown(false)}
      onCancel={(event) => {
        event.preventDefault();
        if (performance.now() - escapeAtRef.current < 250) return;
        handleEscape();
      }}
      onClose={() => {
        const dialog = dialogRef.current;
        if (closingRef.current || !dialog?.isConnected || dialog.open) return;
        try {
          dialog.showModal();
        } catch {
          return;
        }
        requestClose();
      }}
    >
      <div className="bsl-root" data-sheet={sheet ?? undefined} inert={confirming || busy}>
        <Stage
          copy={copy}
          doc={doc}
          baseUrl={base.url}
          frames={frames}
          layouts={layouts}
          view={view}
          onView={onView}
          tool={tool}
          brushSize={brushSize}
          brushHardness={brushHardness}
          regionBox={regionBox}
          onRegionBox={setRegionBox}
          baseImgRef={baseImgRef}
          selectedId={selectedId}
          editingId={editingId}
          spaceDown={spaceDown}
          failed={failed}
          hintId={hintId}
          stageRef={stageRef}
          onSelect={setSelectedId}
          onEditText={(id) => (id ? startEdit(id) : stopEdit())}
          onPreview={(next) => setHistory((h) => preview(h, next))}
          onSettle={(start) => setHistory((h) => settle(h, start))}
          onTextInput={(id, text) => setHistory((h) => preview(h, updateLayer(h.present, id, { text })))}
          onImageError={(url) => setFailed((f) => (f.has(url) ? f : new Set([...f, url])))}
          onDropRef={(ref, at) => {
            const item = resolveRef(ref);
            if (item) void addImage(item, at);
            else say(copy.stage.notImage);
          }}
          onDropFiles={(files, at) => void uploadFiles(files, at)}
          onNotice={say}
        />
        <p id={hintId} className="bsl-sr">
          {copy.stage.hint}
        </p>

        <div className="bsl-top" ref={topRef}>
          <IconButton icon="close" label={copy.close} onClick={requestClose} data="close" />
          <h2 id={titleId} className="bsl-title">
            {tool === "marquee" ? copy.regionModeTitle : copy.title}
            {base.name && <span className="bsl-title-name">{base.name}</span>}
          </h2>
          <span className="bsl-spacer" />
          <div className="bsl-cluster" role="group" aria-label={`${copy.undo} · ${copy.redo}`}>
            <IconButton icon="undo" label={copy.undo} disabled={!canUndo(history)} onClick={doUndo} data="undo" />
            <IconButton icon="redo" label={copy.redo} disabled={!canRedo(history)} onClick={doRedo} data="redo" />
          </div>
          <div className="bsl-cluster bsl-zoom" role="group" aria-label={fill(copy.zoomLevel, { percent: zoomPercent })}>
            <IconButton icon="minus" label={copy.zoomOut} onClick={() => zoomBy(1 / ZOOM_STEP)} data="zoom-out" />
            <button type="button" className="bsl-zoom-value bsl-num" onClick={zoomActual} title={copy.zoomActual} aria-label={`${copy.zoomActual} · ${zoomPercent}`}>
              {zoomPercent}
            </button>
            <IconButton icon="plus" label={copy.zoomIn} onClick={() => zoomBy(ZOOM_STEP)} data="zoom-in" />
            <IconButton icon="fit" label={copy.zoomFit} onClick={zoomFit} data="zoom-fit" />
          </div>
          <button
            type="button"
            className="bsl-btn bsl-reset"
            data-variant="ghost"
            data-size="sm"
            onClick={reset}
            disabled={!doc.layers.length && !doc.baseHidden}
            data-action="reset"
          >
            <LayerIcon name="reset" />
            <span>{copy.reset}</span>
          </button>
          <button type="button" className="bsl-btn" data-variant="solid" data-size="md" onClick={() => void save()} disabled={busy} aria-busy={busy} data-action="save">
            {copy.save}
          </button>
        </div>

        <div
          ref={islandRef}
          className="bsl-island"
          role="toolbar"
          aria-label={copy.tools.label}
          data-layers-island
          data-expanded={brushActive || undefined}
        >
          <div className="bsl-island-tools">
            {toolButtons
              .filter((t) => t.show)
              .map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="bsl-tool-btn"
                  aria-pressed={tool === t.id}
                  title={t.label}
                  data-tool-btn={t.id}
                  onClick={() => selectTool(t.id)}
                >
                  <LayerIcon name={t.icon} />
                  <span>{t.label}</span>
                </button>
              ))}
          </div>
          <div className="bsl-island-brush" aria-hidden={!brushActive}>
            <label className="bsl-brush-slider">
              <span className="bsl-label">{copy.tools.brushSize}</span>
              <input
                type="range"
                className="bsl-range"
                min={BRUSH_SIZE_MIN}
                max={BRUSH_SIZE_MAX}
                value={brushSize}
                tabIndex={brushActive ? 0 : -1}
                aria-label={copy.tools.brushSize}
                onChange={(event) => setBrushSize(clamp(Number(event.target.value), BRUSH_SIZE_MIN, BRUSH_SIZE_MAX))}
              />
              <span className="bsl-brush-val bsl-num">{`${brushSize}px`}</span>
            </label>
            <label className="bsl-brush-slider">
              <span className="bsl-label">{copy.tools.brushHardness}</span>
              <input
                type="range"
                className="bsl-range"
                min={BRUSH_HARDNESS_MIN}
                max={BRUSH_HARDNESS_MAX}
                value={brushHardness}
                tabIndex={brushActive ? 0 : -1}
                aria-label={copy.tools.brushHardness}
                onChange={(event) => setBrushHardness(clamp(Number(event.target.value), BRUSH_HARDNESS_MIN, BRUSH_HARDNESS_MAX))}
              />
              <span className="bsl-brush-val bsl-num">{`${brushHardness}%`}</span>
            </label>
          </div>
        </div>

        {(notice || exportError) && (
          <div className="bsl-toast-wrap" data-brush-open={brushActive || undefined}>
            {exportError ? (
              <p className="bsl-toast" data-tone="error" role="alert" data-layers-error>
                {exportError}
              </p>
            ) : (
              <p className="bsl-toast" role="status">
                {notice}
              </p>
            )}
          </div>
        )}

        <aside className="bsl-panel bsl-left" ref={leftRef} data-panel="add" aria-label={copy.add.title}>
          <SheetHead copy={copy} onClose={() => setSheet(null)} />
          <AddPanel
            copy={copy}
            assets={assetItems}
            library={props.library}
            likedItems={likedItems}
            folderItems={folderItems}
            uploading={uploading}
            onAddText={addText}
            onAddShape={addShape}
            onPick={(item) => void addImage(item)}
            onFiles={(files) => void uploadFiles(files)}
          />
        </aside>

        <aside className="bsl-panel bsl-right" ref={rightRef} data-panel="right" aria-label={`${copy.layers.title} · ${copy.props.title}`}>
          <SheetHead copy={copy} onClose={() => setSheet(null)} />
          {props.region && showRegionSection && (
            <section data-section="region">
              <RegionEditPanel
                copy={copy}
                locale={props.locale}
                baseSize={{ width: base.width, height: base.height }}
                baseImgRef={baseImgRef}
                region={props.region}
                box={regionBox}
                preset={props.initialRegionPreset}
                autoFlatten={autoFlatten}
                quickItems={quickTrayItems}
                uploading={uploading.length > 0}
                onBox={setRegionBox}
                onAutoFlatten={setAutoFlatten}
                resolveRef={(ref) => {
                  const hit = resolveRef(ref);
                  return hit ? pickToTray(hit) : null;
                }}
                onUploadRefs={uploadRegionRefFiles}
                onSubmitted={(jobId, meta) => {
                  setPendingRegionJobs((cur) => [...cur, { jobId, autoFlatten: meta.autoFlatten, box: meta.box }]);
                  setSheet(null);
                }}
              />
            </section>
          )}
          <section data-section="layers">
            <LayersPanel
              copy={copy}
              doc={doc}
              baseThumb={base.url}
              selectedId={selectedId}
              runningCount={pendingRegionJobs.length}
              onSelect={setSelectedId}
              onPatch={(id, p) => patch(id, p)}
              onToggleBase={toggleBase}
            />
          </section>
          {(!showRegionSection || selected !== null) && (
            <section data-section="props">
              <PropsPanel
                copy={copy}
                doc={doc}
                layer={selected}
                frameHeight={frameHeight}
                recent={recent}
                onPatch={patch}
                onColorUsed={colorUsed}
                onEditText={startEdit}
                onTogglePlate={togglePlate}
                onRestoreRatio={(id) => void restoreRatio(id)}
                onDuplicate={duplicate}
                onDelete={remove}
                onMove={reorder}
                onMergeDown={(id) => void mergeDown(id)}
              />
            </section>
          )}
        </aside>

        <div className="bsl-bar" ref={barRef} role="toolbar" aria-label={copy.title}>
          {barSheets.map((value) => (
            <button
              key={value}
              type="button"
              className="bsl-bar-btn"
              aria-pressed={sheet === value}
              disabled={value === "props" && !selected}
              onClick={() => {
                if (value === "region" && tool !== "marquee") selectTool("marquee");
                setSheet((s) => (s === value ? null : value));
              }}
            >
              <LayerIcon name={value === "add" ? "plus" : value === "region" ? "marquee" : value === "layers" ? "layers" : "sliders"} />
              <span>{copy.sheet[value]}</span>
            </button>
          ))}
          <button type="button" className="bsl-bar-btn" onClick={zoomFit}>
            <LayerIcon name="fit" />
            <span className="bsl-num">{zoomPercent}</span>
          </button>
        </div>

        <p className="bsl-sr" aria-live="polite">
          {live}
        </p>
      </div>

      {busy && step && (
        <div className="bsl-progress" role="status" aria-live="polite" data-layers-progress>
          <p className="bsl-progress-title">{copy.export.working}</p>
          <p className="bsl-progress-step">{copy.export[step]}</p>
          <div className="bsl-progress-track" aria-hidden="true">
            <span style={{ width: `${(stepIndex / EXPORT_STEPS.length) * 100}%` }} />
          </div>
          <p className="bsl-muted bsl-num">{fill(copy.export.progress, { step: stepIndex, total: EXPORT_STEPS.length })}</p>
        </div>
      )}

      {confirming && (
        <div className="bsl-confirm-scrim">
          <div className="bsl-confirm" role="alertdialog" aria-modal="true" aria-labelledby={`${titleId}-confirm`} aria-describedby={`${titleId}-confirm-body`} data-layers-confirm>
            <h3 id={`${titleId}-confirm`}>{copy.confirm.title}</h3>
            <p id={`${titleId}-confirm-body`}>{copy.confirm.body}</p>
            <div className="bsl-confirm-actions">
              <button ref={keepRef} type="button" className="bsl-btn" data-variant="solid" data-size="md" onClick={() => setConfirming(false)}>
                {copy.confirm.keep}
              </button>
              <button type="button" className="bsl-btn" data-variant="soft" data-size="md" onClick={() => finishClose("keep")}>
                {copy.confirm.close}
              </button>
              <button type="button" className="bsl-btn" data-variant="ghost" data-size="md" data-tone="danger" onClick={() => finishClose("discard")}>
                {copy.confirm.discard}
              </button>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}

function SheetHead({ copy, onClose }: { copy: Dictionary["studioLayers"]; onClose(): void }) {
  return (
    <div className="bsl-sheet-head">
      <span className="bsl-grabber" aria-hidden="true" />
      <IconButton icon="close" label={copy.sheet.close} onClick={onClose} quiet />
    </div>
  );
}
