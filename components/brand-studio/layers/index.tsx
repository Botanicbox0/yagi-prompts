"use client";
/**
 * "꾸미기" (docs/BRAND-STUDIO-V3.md §5): a full-screen layer editor over a finished picture. Logo,
 * headline, product cut, shapes; then one PNG at the picture's stored size, saved as a new asset.
 * DOM for editing, canvas for export, no new dependency. The document, geometry, history, text
 * layout, export and draft storage are pure modules next to this file; this component holds state
 * and wiring only. Loaded by the studio with next/dynamic (default export).
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { STUDIO_UPLOAD_MIMES, type StudioAssetView } from "@/lib/brand-studio/contracts";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { useModal } from "../modal";
import type { RefSource } from "../refs";
import { libraryKey, type LayerEditorProps, type LibraryItemView } from "../seams";
import { browserRenderDeps, measurerFor, naturalSize, waitForLayerFonts, warmFonts } from "./browser";
import { pushRecent } from "./colors";
import { EXPORT_STEPS, exportFileName, planExport, renderPlan, type ExportStep, type RenderResult } from "./export";
import { ZOOM_STEP, fitView, nudgeDelta, zoomCentered, type Insets, type Point, type View } from "./geometry";
import { canRedo, canUndo, commit, createHistory, preview, redo, settle, undo, type History } from "./history";
import { LayerIcon } from "./icons";
import {
  DEFAULT_PLATE,
  MAX_LAYERS,
  addLayer,
  createImageLayer,
  createShapeLayer,
  createTextLayer,
  duplicateLayer,
  emptyDoc,
  findLayer,
  moveLayer,
  newLayerId,
  nextName,
  removeLayer,
  updateLayer,
  withPlate,
  type Frame,
  type LayerDoc,
  type LayerPatch,
  type TextLayer,
} from "./model";
import { AddPanel, IconButton, LayersPanel, PropsPanel, fill, type PickItem } from "./panels";
import { browserStorage, clearDraft, loadDraft, loadRecentColors, saveDraft, saveRecentColors } from "./persist";
import { Stage } from "./stage";
import { layoutText, type TextLayout } from "./text-layout";
import "./layers.css";

type Sheet = "add" | "layers" | "props";
const NOTICE_MS = 4200;
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

export default function LayerEditor(props: LayerEditorProps & { copy: Dictionary["studioLayers"] }) {
  const { base, copy } = props;
  const baseKey = libraryKey(base.ref);
  const storage = useMemo(() => browserStorage(), []);
  const dialogRef = useModal();
  const stageRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLElement>(null);
  const rightRef = useRef<HTMLElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const hintId = useId();

  const [initial] = useState(() => {
    const restored = loadDraft(storage, { baseKey, width: base.width, height: base.height });
    return { doc: restored ? refreshUrls(restored, props.assets) : emptyDoc(base.width, base.height), restored: Boolean(restored?.layers.length) };
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

  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const [sheet, setSheet] = useState<Sheet | null>(null);

  const say = useCallback((message: string) => setNotice(message), []);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(t);
  }, [notice]);

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
    const bar = barRef.current?.getBoundingClientRect();
    const left = leftRef.current?.getBoundingClientRect();
    const right = rightRef.current?.getBoundingClientRect();
    return {
      top: top ? Math.max(0, top.bottom - stage.top) : 0,
      bottom: phone && bar ? Math.max(0, stage.bottom - bar.top) : 0,
      left: !phone && left ? Math.max(0, left.right - stage.left) : 0,
      right: !phone && right ? Math.max(0, stage.right - right.left) : 0,
    };
  }, []);

  const fit = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    const phone = window.matchMedia("(max-width: 720px)").matches;
    // Small pictures may be shown up to 200% so there is room to place things; export stays at the stored size.
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
  }, []);

  const stopEdit = useCallback(() => {
    const start = editStartRef.current;
    const id = editingId;
    editStartRef.current = null;
    setEditingId(null);
    if (!id) return;
    setHistory((h) => {
      const layer = findLayer(h.present, id);
      // An emptied text box goes away with the same undo step.
      const present = layer?.kind === "text" && !layer.text.trim() ? removeLayer(h.present, id) : h.present;
      const shown = preview(h, present);
      return start ? settle(shown, start) : shown;
    });
  }, [editingId]);

  // A text layer just added opens for typing once it exists in the rendered document.
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
    pendingEditRef.current = layer.id;
    setSheet(null);
  };

  const addShape = (shape: "rect" | "ellipse") => {
    if (atLimit()) return;
    const d = historyRef.current.present;
    const layer = createShapeLayer(d, { shape, name: nextName(d, shape === "rect" ? copy.names.rect : copy.names.ellipse) });
    edit((x) => addLayer(x, layer));
    setSelectedId(layer.id);
    setSheet(null);
  };

  const addImage = async (item: PickItem, at?: Point) => {
    if (atLimit()) return;
    const natural = item.width && item.height ? { width: item.width, height: item.height } : await naturalSize(item.url);
    const d = historyRef.current.present;
    const layer = createImageLayer(d, { url: item.url, ref: item.ref, name: item.name || nextName(d, copy.names.image), natural, ...(at ? { at } : {}) });
    edit((x) => addLayer(x, layer));
    setSelectedId(layer.id);
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
    if (!historyRef.current.present.layers.length) return;
    if (editingId) {
      editStartRef.current = null;
      setEditingId(null);
    }
    edit((d) => ({ ...d, layers: [] }));
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

  const dirty = () => JSON.stringify(historyRef.current.present.layers) !== JSON.stringify(savedRef.current.layers);
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
    if ((event.key === "Delete" || event.key === "Backspace") && selectedId) return act(() => remove(selectedId));
    const delta = nudgeDelta(event.key, event.shiftKey);
    if (delta && selectedId) return act(() => nudge(selectedId, delta));
    if (event.key === "Enter" && selected?.kind === "text" && target === stageRef.current) return act(() => startEdit(selected.id));
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
        // The browser closed it on its own (a repeated Esc): reopen and ask, unless we were closing.
        // A dialog that is open again by now was only closed by a remount (StrictMode runs effects twice).
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
            {copy.title}
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
          <button type="button" className="bsl-btn bsl-reset" data-variant="ghost" data-size="sm" onClick={reset} disabled={!doc.layers.length} data-action="reset">
            <LayerIcon name="reset" />
            <span>{copy.reset}</span>
          </button>
          <button type="button" className="bsl-btn" data-variant="solid" data-size="md" onClick={() => void save()} disabled={busy} aria-busy={busy} data-action="save">
            {copy.save}
          </button>
        </div>

        {(notice || exportError) && (
          <div className="bsl-toast-wrap">
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
          <section data-section="layers">
            <LayersPanel copy={copy} doc={doc} baseThumb={base.url} selectedId={selectedId} onSelect={setSelectedId} onPatch={(id, p) => patch(id, p)} />
          </section>
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
            />
          </section>
        </aside>

        <div className="bsl-bar" ref={barRef} role="toolbar" aria-label={copy.title}>
          {(["add", "layers", "props"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className="bsl-bar-btn"
              aria-pressed={sheet === value}
              disabled={value === "props" && !selected}
              onClick={() => setSheet((s) => (s === value ? null : value))}
            >
              <LayerIcon name={value === "add" ? "plus" : value === "layers" ? "layers" : "sliders"} />
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
