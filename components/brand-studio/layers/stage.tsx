"use client";
/**
 * The stage: the base picture with its layers in DOM, scaled by the view, plus the selection frame,
 * handles and smart guides drawn in screen space on top. Pointer work (move, resize, rotate, pan,
 * drop) happens here and goes back to the editor as preview/settle calls on the history.
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
import { REF_DRAG_TYPE, acceptsDrag, decodeRefDrag, type RefSource } from "../refs";
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
import { findLayer, fontChoice, updateLayer, type Frame, type ImageLayer, type Layer, type LayerDoc, type ShapeLayer, type TextLayer } from "./model";
import type { LayersCopy } from "./panels";
import type { TextLayout } from "./text-layout";

type DragMode = "move" | "resize" | "rotate" | "pan" | "locked";

interface Drag {
  mode: DragMode;
  pointerId: number;
  start: LayerDoc;
  layer: Layer | null;
  frame: Frame | null;
  handle: Handle | null;
  targets: SnapTargets | null;
  startClient: Point;
  startWorld: Point;
  startView: View;
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
  onTextInput(id: string, text: string): void;
  onImageError(url: string): void;
  onDropRef(ref: RefSource, at: Point): void;
  onDropFiles(files: File[], at: Point): void;
  onNotice(message: string): void;
}

/** Screen pixels within which an edge or centre line catches. */
const SNAP_PX = 6;

export function Stage(props: StageProps) {
  const { copy, doc, frames, layouts, view, onView, selectedId, editingId, stageRef } = props;
  const dragRef = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState<DragMode | null>(null);
  const [guides, setGuides] = useState<Guides | null>(null);
  const [dropActive, setDropActive] = useState(false);

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

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target as HTMLElement;
    if (target.closest("textarea")) return;
    const world = toWorld(view, local(event.clientX, event.clientY));
    const base: Omit<Drag, "mode"> = {
      pointerId: event.pointerId,
      start: doc,
      layer: null,
      frame: null,
      handle: null,
      targets: null,
      startClient: { x: event.clientX, y: event.clientY },
      startWorld: world,
      startView: view,
      moved: false,
    };
    const handleEl = target.closest<HTMLElement>("[data-handle]");
    const layerEl = target.closest<HTMLElement>("[data-layer-id]");
    let drag: Drag | null = null;
    if (event.button === 1 || props.spaceDown) drag = { ...base, mode: "pan" };
    else if (handleEl && selectedId) {
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
          drag = { ...base, mode: "move", layer, frame, targets: snapTargets(doc, others) };
        }
      }
    } else {
      if (editingId) props.onEditText(null);
      props.onSelect(null);
      drag = { ...base, mode: "pan" };
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
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
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
    const layer = drag.layer;
    const frame = drag.frame;
    if (!layer || !frame) return;
    const world = toWorld(view, local(event.clientX, event.clientY));
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
    if (drag.moved && (drag.mode === "move" || drag.mode === "resize" || drag.mode === "rotate")) props.onSettle(drag.start);
  }

  function onDoubleClick(event: ReactMouseEvent<HTMLDivElement>) {
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

  return (
    <div
      ref={stageRef}
      className="bsl-stage"
      tabIndex={0}
      role="group"
      aria-label={copy.stage.label}
      aria-describedby={props.hintId}
      data-layers-stage
      data-panning={props.spaceDown || dragging === "pan" || undefined}
      data-dragging={dragging ?? undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onDoubleClick}
      onDragOver={onDragOver}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false);
      }}
      onDrop={onDrop}
    >
      <div
        className="bsl-world"
        style={{ width: doc.width, height: doc.height, transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`, ["--bsl-zoom" as string]: view.zoom } as CSSProperties}
      >
        <img className="bsl-base" src={props.baseUrl} alt="" draggable={false} />
        {doc.layers.map((layer) => {
          const frame = frames.get(layer.id) ?? layer;
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
              {layer.kind === "image" && <ImageNode layer={layer} failed={props.failed.has(layer.src.url)} missing={copy.stage.missing} onError={props.onImageError} />}
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

      {selected && selectedFrame && !selected.hidden && (
        <Selection layer={selected} frame={selectedFrame} view={view} editing={editing} dragging={dragging} />
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
        return <span key={hd} className="bsl-handle" data-handle={hd} data-edge={hd.length === 1 ? (hd === "n" || hd === "s" ? "h" : "v") : undefined} style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%`, cursor: handleCursor(hd, frame.rotation) }} />;
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

function ImageNode({ layer, failed, missing, onError }: { layer: ImageLayer; failed: boolean; missing: string; onError(url: string): void }) {
  if (failed)
    return (
      <div className="bsl-missing">
        <span>{missing}</span>
      </div>
    );
  return <img src={layer.src.url} alt="" draggable={false} onError={() => onError(layer.src.url)} />;
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
