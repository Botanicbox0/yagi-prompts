"use client";
/**
 * The stage: the base picture with its layers in DOM, scaled by the view, plus the selection frame,
 * marquee selection, non-destructive alpha-mask brush, handles and smart guides drawn in screen space.
 * Pointer work (move, resize, rotate, pan, marquee, brush, drop) happens here and goes back to the editor
 * as preview/settle calls on the history.
 */
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { RegionBox } from "@/lib/brand-studio/contracts";
import { REF_DRAG_TYPE, acceptsDrag, decodeRefDrag, type RefSource } from "../refs";
import { containsPoint as containsRegionPoint, drawBox, moveBox, resizeBox } from "../region-math";
import { drawableUrl } from "./browser";
import { CANVAS_HANDLES, baseRect, isCanvasResized, pictureBoxToWorld, resizeFromHandle, worldToPicture, type CanvasHandle } from "./canvas";
import { shapeGeometry } from "./export";
import {
  boundsOf,
  centerOf,
  handleAnchor,
  handleCursor,
  handlesFor,
  resizeLayerPatch,
  rotationFromPointer,
  snapMove,
  snapTargets,
  toScreen,
  toWorld,
  zoomAround,
  type Guides,
  type Handle,
  type Point,
  type SnapTargets,
  type View,
} from "./geometry";
import { paintMaskStrokeOnContext, worldPointToMask, type MaskBrushMode } from "./mask";
import {
  findLayer,
  fontChoice,
  topVisibleImageLayerId,
  updateLayer,
  type Frame,
  type ImageLayer,
  type Layer,
  type LayerDoc,
  type LayerTool,
  type ShapeLayer,
  type TextLayer,
} from "./model";
import type { LayersCopy } from "./panels";
import type { TextLayout } from "./text-layout";

type DragMode =
  | "move"
  | "resize"
  | "rotate"
  | "pan"
  | "locked"
  | "marqueeDraw"
  | "marqueeMove"
  | "marqueeResize"
  | "brush"
  | "canvas";

interface BrushSession {
  layerId: string;
  mode: MaskBrushMode;
  frame: Frame;
  maskCanvas: HTMLCanvasElement;
  maskCtx: CanvasRenderingContext2D;
  sourceImg: HTMLImageElement | null;
  lastMaskPt: Point;
  maskScale: number;
}

interface Drag {
  mode: DragMode;
  pointerId: number;
  start: LayerDoc;
  layer: Layer | null;
  frame: Frame | null;
  handle: Handle | null;
  canvasHandle: CanvasHandle | null;
  targets: SnapTargets | null;
  startClient: Point;
  startWorld: Point;
  startView: View;
  startRegionBox: RegionBox | null;
  moved: boolean;
}

export interface StageProps {
  copy: LayersCopy;
  doc: LayerDoc;
  baseUrl: string;
  frames: ReadonlyMap<string, Frame>;
  layouts: ReadonlyMap<string, TextLayout>;
  view: View;
  onView(update: (view: View) => View): void;
  tool?: LayerTool;
  brushSize?: number;
  brushHardness?: number;
  regionBox?: RegionBox | null;
  onRegionBox?(box: RegionBox | null): void;
  baseImgRef?: RefObject<HTMLImageElement | null>;
  selectedId: string | null;
  editingId: string | null;
  spaceDown: boolean;
  failed: ReadonlySet<string>;
  hintId: string;
  stageRef: RefObject<HTMLDivElement | null>;
  onSelect(id: string | null): void;
  onEditText(id: string | null): void;
  onPreview(doc: LayerDoc): void;
  onSettle(start: LayerDoc): void;
  /** Canvas-resize mode (the size panel is open): canvas handles instead of layer selection. */
  canvasMode?: boolean;
  /** Puts the document from before a drag back (Escape during a canvas drag). */
  onRevert?(start: LayerDoc): void;
  onTextInput(id: string, text: string): void;
  onImageError(url: string): void;
  onDropRef(ref: RefSource, at: Point): void;
  onDropFiles(files: File[], at: Point): void;
  onNotice(message: string): void;
}

/** Screen pixels within which an edge or centre line catches. */
const SNAP_PX = 6;
const MARQUEE_HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function resizeRegionHandle(box: RegionBox, handle: Handle, to: Point): RegionBox {
  if (handle === "nw" || handle === "ne" || handle === "sw" || handle === "se") {
    return resizeBox(box, handle, to);
  }
  if (handle === "n") return drawBox({ x: box.x, y: box.y + box.h }, { x: box.x + box.w, y: to.y });
  if (handle === "s") return drawBox({ x: box.x, y: box.y }, { x: box.x + box.w, y: to.y });
  if (handle === "w") return drawBox({ x: box.x + box.w, y: box.y }, { x: to.x, y: box.y + box.h });
  return drawBox({ x: box.x, y: box.y }, { x: to.x, y: box.y + box.h });
}

export function Stage(props: StageProps) {
  const {
    copy,
    doc,
    frames,
    layouts,
    view,
    onView,
    tool = "move",
    brushSize = 48,
    brushHardness = 30,
    regionBox = null,
    selectedId,
    editingId,
    stageRef,
  } = props;
  const dragRef = useRef<Drag | null>(null);
  const brushSessionRef = useRef<BrushSession | null>(null);
  const liveBrushCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [dragging, setDragging] = useState<DragMode | null>(null);
  const [brushingLayerId, setBrushingLayerId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [guides, setGuides] = useState<Guides | null>(null);
  const [dropActive, setDropActive] = useState(false);

  // Preload existing layer masks so the first brush stroke has a decoded image immediately.
  useEffect(() => {
    if (typeof Image === "undefined") return;
    const cache = maskCacheRef.current;
    for (const layer of doc.layers) {
      if (layer.kind !== "image" || !layer.maskDataUrl || cache.has(layer.maskDataUrl)) continue;
      const im = new Image();
      const src = drawableUrl(layer.maskDataUrl);
      im.decoding = "async";
      im.src = src;
      cache.set(layer.maskDataUrl, im);
    }
  }, [doc.layers]);

  // Wheel: Ctrl/⌘ (and trackpad pinch) zooms around the pointer, plain wheel pans. Needs a non-passive listener.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest?.("textarea")) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const unit = event.deltaMode === 1 ? 16 : 1;
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY * unit * 0.0025);
        onView((v) => zoomAround(v, anchor, v.zoom * factor));
      } else {
        const dx = (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * unit;
        const dy = (event.shiftKey && !event.deltaX ? 0 : event.deltaY) * unit;
        onView((v) => ({ ...v, panX: v.panX - dx, panY: v.panY - dy }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [stageRef, onView]);

  const local = (clientX: number, clientY: number): Point => {
    const rect = stageRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  // A RegionBox is fractions of the base PICTURE, wherever it sits on the canvas.
  const toNorm = (world: Point): Point => worldToPicture(doc, world);

  // Escape during a canvas drag puts the canvas and the view back, before the editor sees the key.
  const { onRevert } = props;
  useEffect(() => {
    if (dragging !== "canvas") return;
    const onKey = (event: KeyboardEvent) => {
      const drag = dragRef.current;
      if (event.key !== "Escape" || drag?.mode !== "canvas") return;
      event.preventDefault();
      event.stopPropagation();
      dragRef.current = null;
      setDragging(null);
      try {
        stageRef.current?.releasePointerCapture(drag.pointerId);
      } catch {
        /* already released */
      }
      onRevert?.(drag.start);
      onView(() => drag.startView);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dragging, onRevert, onView, stageRef]);

  const renderLiveBrushPreview = (session: BrushSession) => {
    const canvas = liveBrushCanvasRef.current;
    if (!canvas) return;
    const mw = session.maskCanvas.width;
    const mh = session.maskCanvas.height;
    if (canvas.width !== mw) canvas.width = mw;
    if (canvas.height !== mh) canvas.height = mh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, mw, mh);
    if (session.sourceImg && session.sourceImg.complete && session.sourceImg.naturalWidth > 0) {
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(session.sourceImg, 0, 0, mw, mh);
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(session.maskCanvas, 0, 0, mw, mh);
      ctx.globalCompositeOperation = "source-over";
    }
  };

  // Paint initial preview frame as soon as the live `<canvas>` mounts for `brushingLayerId`.
  useEffect(() => {
    if (brushingLayerId && brushSessionRef.current?.layerId === brushingLayerId) {
      renderLiveBrushPreview(brushSessionRef.current);
    }
  }, [brushingLayerId]);

  function startBrushSession(layer: ImageLayer, frame: Frame, world: Point, mode: MaskBrushMode): boolean {
    if (typeof document === "undefined") return false;
    const domImg = stageRef.current?.querySelector<HTMLImageElement>(`[data-layer-id="${layer.id}"] img`) ?? null;
    const cachedMask = layer.maskDataUrl ? maskCacheRef.current.get(layer.maskDataUrl) ?? null : null;
    const baseW = cachedMask?.naturalWidth || domImg?.naturalWidth || Math.round(frame.w) || 256;
    const baseH = cachedMask?.naturalHeight || domImg?.naturalHeight || Math.round(frame.h) || 256;
    const scaleDown = Math.min(1, 2048 / Math.max(1, baseW, baseH));
    const mw = Math.max(8, Math.round(baseW * scaleDown));
    const mh = Math.max(8, Math.round(baseH * scaleDown));

    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = mw;
    maskCanvas.height = mh;
    const maskCtx = maskCanvas.getContext("2d");
    if (!maskCtx) return false;

    if (layer.maskDataUrl && cachedMask && cachedMask.complete && cachedMask.naturalWidth > 0) {
      maskCtx.drawImage(cachedMask, 0, 0, mw, mh);
    } else {
      maskCtx.fillStyle = "#ffffff";
      maskCtx.fillRect(0, 0, mw, mh);
    }

    const mapped = worldPointToMask(world, frame, { width: mw, height: mh });
    const radius = Math.max(1, (brushSize / 2) * mapped.scale);
    paintMaskStrokeOnContext(maskCtx, {
      from: { x: mapped.x, y: mapped.y },
      to: { x: mapped.x, y: mapped.y },
      radius,
      hardness: brushHardness,
      mode,
    });

    const session: BrushSession = {
      layerId: layer.id,
      mode,
      frame,
      maskCanvas,
      maskCtx,
      sourceImg: domImg,
      lastMaskPt: { x: mapped.x, y: mapped.y },
      maskScale: mapped.scale,
    };
    brushSessionRef.current = session;
    setBrushingLayerId(layer.id);
    return true;
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target as HTMLElement;
    if (target.closest("textarea")) return;
    const loc = local(event.clientX, event.clientY);
    setCursor(loc);
    const world = toWorld(view, loc);
    const base: Omit<Drag, "mode"> = {
      pointerId: event.pointerId,
      start: doc,
      layer: null,
      frame: null,
      handle: null,
      canvasHandle: null,
      targets: null,
      startClient: { x: event.clientX, y: event.clientY },
      startWorld: world,
      startView: view,
      startRegionBox: regionBox,
      moved: false,
    };

    let drag: Drag | null = null;
    if (event.button === 1 || props.spaceDown) {
      drag = { ...base, mode: "pan" };
    } else if (props.canvasMode) {
      if (editingId) props.onEditText(null);
      const canvasHandle = target.closest<HTMLElement>("[data-canvas-handle]")?.dataset.canvasHandle as CanvasHandle | undefined;
      drag = canvasHandle ? { ...base, mode: "canvas", canvasHandle } : { ...base, mode: "pan" };
    } else if (tool === "marquee" && props.onRegionBox) {
      if (editingId) props.onEditText(null);
      const marqueeHandleEl = target.closest<HTMLElement>("[data-marquee-handle]");
      const norm = toNorm(world);
      if (marqueeHandleEl && regionBox) {
        drag = {
          ...base,
          mode: "marqueeResize",
          handle: marqueeHandleEl.dataset.marqueeHandle as Handle,
        };
      } else if (regionBox && (target.closest("[data-marquee-box]") || containsRegionPoint(regionBox, norm))) {
        drag = { ...base, mode: "marqueeMove" };
      } else {
        drag = { ...base, mode: "marqueeDraw" };
      }
    } else if (tool === "eraser" || tool === "restore") {
      if (editingId) props.onEditText(null);
      let candidate = findLayer(doc, selectedId);
      if (!candidate || candidate.kind !== "image" || candidate.hidden) {
        const fallbackId = topVisibleImageLayerId(doc);
        candidate = fallbackId ? findLayer(doc, fallbackId) : null;
        if (candidate) props.onSelect(candidate.id);
      }
      if (!candidate || candidate.kind !== "image" || candidate.hidden) {
        props.onNotice(copy.stage.needImageLayer);
        return;
      }
      if (candidate.locked) {
        props.onNotice(copy.stage.locked);
        return;
      }
      const frame = frames.get(candidate.id) ?? candidate;
      const mode: MaskBrushMode = tool === "eraser" ? "erase" : "restore";
      if (!startBrushSession(candidate, frame, world, mode)) return;
      drag = { ...base, mode: "brush", layer: candidate, frame, moved: true };
    } else {
      const handleEl = target.closest<HTMLElement>("[data-handle]");
      const layerEl = target.closest<HTMLElement>("[data-layer-id]");
      if (handleEl && selectedId) {
        const layer = findLayer(doc, selectedId);
        const frame = frames.get(selectedId);
        if (layer && frame && !layer.locked) {
          const handle = handleEl.dataset.handle as Handle | "rotate";
          drag = handle === "rotate" ? { ...base, mode: "rotate", layer, frame } : { ...base, mode: "resize", layer, frame, handle };
        }
      } else if (layerEl?.dataset.layerId) {
        const id = layerEl.dataset.layerId;
        if (editingId && editingId !== id) props.onEditText(null);
        props.onSelect(id);
        const layer = findLayer(doc, id);
        const frame = frames.get(id);
        if (layer && frame && editingId !== id) {
          if (layer.locked) drag = { ...base, mode: "locked", layer };
          else {
            const others = doc.layers.filter((l) => l.id !== id && !l.hidden).map((l) => boundsOf(frames.get(l.id) ?? l));
            // The picture's edges catch too once it no longer fills the canvas.
            const edges = isCanvasResized(doc) ? [...others, baseRect(doc)] : others;
            drag = { ...base, mode: "move", layer, frame, targets: snapTargets(doc, edges) };
          }
        }
      } else {
        if (editingId) props.onEditText(null);
        props.onSelect(null);
        drag = { ...base, mode: "pan" };
      }
    }

    if (!drag) return;
    event.preventDefault();
    stageRef.current?.focus({ preventScroll: true });
    try {
      stageRef.current?.setPointerCapture(event.pointerId);
    } catch {
      /* capture is a convenience */
    }
    dragRef.current = drag;
    setDragging(drag.mode);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const loc = local(event.clientX, event.clientY);
    if (tool === "eraser" || tool === "restore") setCursor(loc);
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;

    if (drag.mode === "brush") {
      const session = brushSessionRef.current;
      if (!session) return;
      const world = toWorld(view, loc);
      const mapped = worldPointToMask(world, session.frame, {
        width: session.maskCanvas.width,
        height: session.maskCanvas.height,
      });
      const radius = Math.max(1, (brushSize / 2) * session.maskScale);
      paintMaskStrokeOnContext(session.maskCtx, {
        from: session.lastMaskPt,
        to: { x: mapped.x, y: mapped.y },
        radius,
        hardness: brushHardness,
        mode: session.mode,
      });
      session.lastMaskPt = { x: mapped.x, y: mapped.y };
      renderLiveBrushPreview(session);
      return;
    }

    if (!drag.moved && Math.hypot(event.clientX - drag.startClient.x, event.clientY - drag.startClient.y) < 3) return;
    const first = !drag.moved;
    drag.moved = true;
    if (drag.mode === "pan") {
      const dx = event.clientX - drag.startClient.x;
      const dy = event.clientY - drag.startClient.y;
      onView(() => ({ ...drag.startView, panX: drag.startView.panX + dx, panY: drag.startView.panY + dy }));
      return;
    }
    if (drag.mode === "locked") {
      if (first) props.onNotice(copy.stage.locked);
      return;
    }
    if (drag.mode === "canvas" && drag.canvasHandle) {
      const z = drag.startView.zoom;
      const next = resizeFromHandle(drag.start, drag.canvasHandle, (event.clientX - drag.startClient.x) / z, (event.clientY - drag.startClient.y) / z);
      // West and north handles shift the content in document space; move the view back so the picture stays put.
      const from = baseRect(drag.start);
      const to = baseRect(next);
      onView(() => ({ ...drag.startView, panX: drag.startView.panX - (to.x - from.x) * z, panY: drag.startView.panY - (to.y - from.y) * z }));
      props.onPreview(next);
      return;
    }
    const world = toWorld(view, loc);
    if (drag.mode === "marqueeDraw" && props.onRegionBox) {
      props.onRegionBox(drawBox(toNorm(drag.startWorld), toNorm(world)));
      return;
    }
    if (drag.mode === "marqueeMove" && props.onRegionBox && drag.startRegionBox) {
      const picture = baseRect(doc);
      const dx = picture.w > 0 ? (world.x - drag.startWorld.x) / picture.w : 0;
      const dy = picture.h > 0 ? (world.y - drag.startWorld.y) / picture.h : 0;
      props.onRegionBox(moveBox(drag.startRegionBox, dx, dy));
      return;
    }
    if (drag.mode === "marqueeResize" && props.onRegionBox && drag.startRegionBox && drag.handle) {
      props.onRegionBox(resizeRegionHandle(drag.startRegionBox, drag.handle, toNorm(world)));
      return;
    }

    const layer = drag.layer;
    const frame = drag.frame;
    if (!layer || !frame) return;
    if (drag.mode === "move") {
      let dx = world.x - drag.startWorld.x;
      let dy = world.y - drag.startWorld.y;
      let lines: Guides | null = null;
      if (!event.altKey && drag.targets) {
        const snap = snapMove(boundsOf({ ...frame, x: frame.x + dx, y: frame.y + dy }), drag.targets, SNAP_PX / view.zoom);
        dx += snap.dx;
        dy += snap.dy;
        lines = snap.guides.x.length || snap.guides.y.length ? snap.guides : null;
      }
      setGuides(lines);
      props.onPreview(updateLayer(drag.start, layer.id, { x: layer.x + dx, y: layer.y + dy }));
    } else if (drag.mode === "rotate") {
      props.onPreview(updateLayer(drag.start, layer.id, { rotation: rotationFromPointer(centerOf(frame), world, event.shiftKey) }));
    } else if (drag.mode === "resize" && drag.handle) {
      props.onPreview(updateLayer(drag.start, layer.id, resizeLayerPatch(layer, frame, drag.handle, world, event.shiftKey)));
    }
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    setDragging(null);
    setGuides(null);
    try {
      stageRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
    if (drag.mode === "brush") {
      const session = brushSessionRef.current;
      brushSessionRef.current = null;
      setBrushingLayerId(null);
      if (session && drag.layer?.kind === "image") {
        try {
          const dataUrl = session.maskCanvas.toDataURL("image/png");
          if (typeof Image !== "undefined") {
            const im = new Image();
            im.src = dataUrl;
            maskCacheRef.current.set(dataUrl, im);
          }
          props.onPreview(updateLayer(drag.start, drag.layer.id, { maskDataUrl: dataUrl }));
          props.onSettle(drag.start);
        } catch {
          /* ignore encode error */
        }
      }
      return;
    }
    if (drag.mode === "marqueeDraw" && !drag.moved && props.onRegionBox && drag.startRegionBox) {
      props.onRegionBox(null);
      return;
    }
    if (drag.moved && (drag.mode === "move" || drag.mode === "resize" || drag.mode === "rotate" || drag.mode === "canvas")) props.onSettle(drag.start);
  }

  function onDoubleClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (tool !== "move") return;
    const id = (event.target as HTMLElement).closest<HTMLElement>("[data-layer-id]")?.dataset.layerId;
    const layer = id ? findLayer(doc, id) : null;
    if (layer?.kind === "text" && !layer.locked) props.onEditText(layer.id);
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (!acceptsDrag(event.dataTransfer?.types)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!dropActive) setDropActive(true);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    if (!acceptsDrag(event.dataTransfer?.types)) return;
    event.preventDefault();
    setDropActive(false);
    const at = toWorld(view, local(event.clientX, event.clientY));
    const ref = decodeRefDrag(event.dataTransfer.getData(REF_DRAG_TYPE));
    if (ref) return props.onDropRef(ref, at);
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length) props.onDropFiles(files, at);
  }

  const selected = findLayer(doc, selectedId);
  const selectedFrame = selected ? frames.get(selected.id) : undefined;
  const editing = Boolean(editingId && editingId === selectedId);
  const canvasMode = Boolean(props.canvasMode);
  const picture = baseRect(doc);
  const showBrushCursor = !canvasMode && (tool === "eraser" || tool === "restore") && !props.spaceDown && dragging !== "pan" && cursor !== null;

  return (
    <div
      ref={stageRef}
      className="bsl-stage"
      tabIndex={0}
      role="group"
      aria-label={copy.stage.label}
      aria-describedby={props.hintId}
      data-layers-stage
      data-tool={tool}
      data-canvas={canvasMode || undefined}
      data-panning={props.spaceDown || dragging === "pan" || undefined}
      data-dragging={dragging ?? undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => setCursor(null)}
      onDoubleClick={onDoubleClick}
      onDragOver={onDragOver}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false);
      }}
      onDrop={onDrop}
    >
      <div
        className="bsl-world"
        data-base-hidden={doc.baseHidden || undefined}
        style={{
          width: doc.width,
          height: doc.height,
          transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
          ["--bsl-zoom" as string]: view.zoom,
        } as CSSProperties}
      >
        <div className="bsl-base-clip">
          <img
            ref={props.baseImgRef}
            className="bsl-base"
            src={drawableUrl(props.baseUrl)}
            alt=""
            draggable={false}
            style={{ left: picture.x, top: picture.y, width: picture.w, height: picture.h, display: doc.baseHidden ? "none" : undefined }}
          />
        </div>
        {doc.layers.map((layer) => {
          const frame = frames.get(layer.id) ?? layer;
          const activeBrush = brushingLayerId === layer.id;
          return (
            <div
              key={layer.id}
              className="bsl-layer"
              data-layer-id={layer.id}
              data-kind={layer.kind}
              data-selected={layer.id === selectedId || undefined}
              data-locked={layer.locked || undefined}
              aria-hidden="true"
              style={{
                left: frame.x,
                top: frame.y,
                width: frame.w,
                height: frame.h,
                transform: frame.rotation ? `rotate(${frame.rotation}deg)` : undefined,
                opacity: layer.opacity,
                display: layer.hidden ? "none" : undefined,
              }}
            >
              {layer.kind === "image" && (
                <ImageNode
                  layer={layer}
                  activeBrush={activeBrush}
                  liveCanvasRef={activeBrush ? liveBrushCanvasRef : undefined}
                  failed={props.failed.has(layer.src.url)}
                  missing={copy.stage.missing}
                  onError={props.onImageError}
                />
              )}
              {layer.kind === "shape" && <ShapeNode layer={layer} w={frame.w} h={frame.h} />}
              {layer.kind === "text" && (
                <TextNode
                  layer={layer}
                  layout={layouts.get(layer.id)}
                  editing={editingId === layer.id}
                  placeholder={copy.stage.textPlaceholder}
                  label={copy.props.content}
                  onInput={(text) => props.onTextInput(layer.id, text)}
                  onDone={() => props.onEditText(null)}
                />
              )}
            </div>
          );
        })}
      </div>

      {guides && (
        <svg className="bsl-guides" aria-hidden="true">
          {guides.x.map((x) => {
            const sx = view.panX + x * view.zoom;
            return <line key={`x${x}`} x1={sx} x2={sx} y1={view.panY} y2={view.panY + doc.height * view.zoom} />;
          })}
          {guides.y.map((y) => {
            const sy = view.panY + y * view.zoom;
            return <line key={`y${y}`} y1={sy} y2={sy} x1={view.panX} x2={view.panX + doc.width * view.zoom} />;
          })}
        </svg>
      )}

      {!canvasMode && tool === "move" && selected && selectedFrame && !selected.hidden && (
        <Selection layer={selected} frame={selectedFrame} view={view} editing={editing} dragging={dragging} />
      )}

      {regionBox && (
        <MarqueeSelection
          box={regionBox}
          doc={doc}
          view={view}
          interactive={tool === "marquee"}
        />
      )}

      {canvasMode && (
        <div
          className="bsl-canvas-frame"
          aria-hidden="true"
          data-canvas-frame
          style={{ left: view.panX, top: view.panY, width: doc.width * view.zoom, height: doc.height * view.zoom }}
        >
          {CANVAS_HANDLES.map((hd) => {
            const at = handleAnchor(hd);
            return (
              <span
                key={hd}
                className="bsl-handle"
                data-canvas-handle={hd}
                data-edge={hd.length === 1 ? (hd === "n" || hd === "s" ? "h" : "v") : undefined}
                style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%`, cursor: handleCursor(hd, 0) }}
              />
            );
          })}
          {dragging === "canvas" && <span className="bsl-size-tag bsl-num">{`${doc.width} × ${doc.height}`}</span>}
        </div>
      )}

      {showBrushCursor && cursor && (
        <span
          className="bsl-brush-cursor"
          data-mode={tool}
          aria-hidden="true"
          style={{
            left: cursor.x,
            top: cursor.y,
            width: Math.max(4, brushSize * view.zoom),
            height: Math.max(4, brushSize * view.zoom),
          }}
        />
      )}

      {dropActive && (
        <div className="bsl-drop" aria-hidden="true">
          <span>{copy.stage.drop}</span>
        </div>
      )}
    </div>
  );
}

function Selection({ layer, frame, view, editing, dragging }: { layer: Layer; frame: Frame; view: View; editing: boolean; dragging: DragMode | null }) {
  const c = toScreen(view, centerOf(frame));
  const w = frame.w * view.zoom;
  const h = frame.h * view.zoom;
  const small = Math.min(w, h) < 36;
  const handles = layer.locked || editing ? [] : handlesFor(layer.kind).filter((hd) => !small || hd.length === 2);
  return (
    <div
      className="bsl-selection"
      data-locked={layer.locked || undefined}
      aria-hidden="true"
      style={{ left: c.x - w / 2, top: c.y - h / 2, width: w, height: h, transform: frame.rotation ? `rotate(${frame.rotation}deg)` : undefined }}
    >
      {handles.map((hd) => {
        const at = handleAnchor(hd);
        return (
          <span
            key={hd}
            className="bsl-handle"
            data-handle={hd}
            data-edge={hd.length === 1 ? (hd === "n" || hd === "s" ? "h" : "v") : undefined}
            style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%`, cursor: handleCursor(hd, frame.rotation) }}
          />
        );
      })}
      {!layer.locked && !editing && (
        <span className="bsl-rotate" data-handle="rotate">
          <span />
        </span>
      )}
      {(dragging === "resize" || dragging === "rotate") && (
        <span className="bsl-size-tag bsl-num" style={{ transform: frame.rotation ? `rotate(${-frame.rotation}deg)` : undefined }}>
          {dragging === "rotate" ? `${Math.round(frame.rotation)}°` : `${Math.round(frame.w)} × ${Math.round(frame.h)}`}
        </span>
      )}
    </div>
  );
}

function MarqueeSelection({
  box,
  doc,
  view,
  interactive,
}: {
  box: RegionBox;
  doc: LayerDoc;
  view: View;
  interactive: boolean;
}) {
  const world = pictureBoxToWorld(doc, box);
  const left = view.panX + world.x * view.zoom;
  const top = view.panY + world.y * view.zoom;
  const width = world.w * view.zoom;
  const height = world.h * view.zoom;
  const pxW = Math.max(1, Math.round(world.w));
  const pxH = Math.max(1, Math.round(world.h));
  const small = Math.min(width, height) < 36;
  const handles = interactive ? MARQUEE_HANDLES.filter((hd) => !small || hd.length === 2) : [];

  return (
    <div
      className="bsl-marquee"
      data-marquee-box
      data-interactive={interactive || undefined}
      data-box={`${box.x},${box.y},${box.w},${box.h}`}
      aria-hidden="true"
      style={{ left, top, width, height }}
    >
      <span className="bsl-marquee-badge bsl-num">1</span>
      {handles.map((hd) => {
        const at = handleAnchor(hd);
        return (
          <span
            key={hd}
            className="bsl-handle"
            data-marquee-handle={hd}
            data-edge={hd.length === 1 ? (hd === "n" || hd === "s" ? "h" : "v") : undefined}
            style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%`, cursor: handleCursor(hd, 0) }}
          />
        );
      })}
      <span className="bsl-size-tag bsl-num">{`${pxW} × ${pxH}`}</span>
    </div>
  );
}

function ImageNode({
  layer,
  activeBrush,
  liveCanvasRef,
  failed,
  missing,
  onError,
}: {
  layer: ImageLayer;
  activeBrush: boolean;
  liveCanvasRef?: RefObject<HTMLCanvasElement | null>;
  failed: boolean;
  missing: string;
  onError(url: string): void;
}) {
  if (failed)
    return (
      <div className="bsl-missing">
        <span>{missing}</span>
      </div>
    );
  const maskUrl = layer.maskDataUrl ? drawableUrl(layer.maskDataUrl).replace(/"/g, "%22") : null;
  const maskStyle: CSSProperties | undefined =
    !activeBrush && maskUrl
      ? {
          WebkitMaskImage: `url("${maskUrl}")`,
          maskImage: `url("${maskUrl}")`,
          WebkitMaskSize: "100% 100%",
          maskSize: "100% 100%",
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
        }
      : activeBrush
        ? { opacity: 0 }
        : undefined;
  return (
    <>
      <img src={drawableUrl(layer.src.url)} alt="" draggable={false} style={maskStyle} onError={() => onError(layer.src.url)} />
      {activeBrush && <canvas ref={liveCanvasRef} className="bsl-brush-canvas" />}
    </>
  );
}

function ShapeNode({ layer, w, h }: { layer: ShapeLayer; w: number; h: number }) {
  const g = shapeGeometry(layer, w, h);
  const paint = { fill: layer.fill ?? "none", stroke: layer.stroke && g.strokeWidth > 0 ? layer.stroke : "none", strokeWidth: g.strokeWidth };
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${Math.max(w, 0.01)} ${Math.max(h, 0.01)}`} preserveAspectRatio="none">
      {g.kind === "ellipse" ? (
        <ellipse cx={g.x + g.w / 2} cy={g.y + g.h / 2} rx={g.w / 2} ry={g.h / 2} {...paint} />
      ) : (
        <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={g.radius} ry={g.radius} {...paint} />
      )}
    </svg>
  );
}

function TextNode({
  layer,
  layout,
  editing,
  placeholder,
  label,
  onInput,
  onDone,
}: {
  layer: TextLayer;
  layout: TextLayout | undefined;
  editing: boolean;
  placeholder: string;
  label: string;
  onInput(text: string): void;
  onDone(): void;
}) {
  if (!layout) return null;
  const lh = layout.lineHeightPx;
  const font: CSSProperties = {
    fontFamily: fontChoice(layer.font).stack,
    fontWeight: layer.weight,
    fontSize: layer.size,
    letterSpacing: `${layer.letterSpacing * layer.size}px`,
    color: layer.color,
  };
  return (
    <div className="bsl-text" style={font}>
      {layer.plate && <div className="bsl-plate" style={{ background: layer.plate.color, borderRadius: layer.plate.radius * layer.size }} />}
      {editing ? (
        <textarea
          className="bsl-text-input"
          value={layer.text}
          placeholder={placeholder}
          aria-label={label}
          autoFocus
          spellCheck={false}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => onInput(event.target.value)}
          onBlur={onDone}
          style={{
            left: layout.pad,
            top: layout.pad,
            width: layout.contentWidth,
            height: Math.max(lh, layout.height - layout.pad * 2),
            lineHeight: `${lh}px`,
            textAlign: layer.align,
          }}
        />
      ) : (
        layout.lines.map((line, i) => (
          <span key={i} className="bsl-line" style={{ left: layout.pad + line.x, top: layout.pad + i * lh, height: lh, lineHeight: `${lh}px` }}>
            {line.text}
          </span>
        ))
      )}
    </div>
  );
}
