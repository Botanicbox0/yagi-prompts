"use client";
/**
 * The canvas size chip in the editor's top bar and its small panel: ratio presets, width × height,
 * and the way back to the picture's own size. Non-modal: while it is open the stage shows the canvas
 * handles (stage.tsx); it closes with its chip or Escape.
 */
import { useId, useState, type KeyboardEvent } from "react";
import { AspectShape } from "../gallery/chip-select";
import { CANVAS_MAX, CANVAS_MIN, CANVAS_RATIOS, activeCanvasRatio, isCanvasResized, type CanvasRatio } from "./canvas";
import { fillStrips } from "./fill";
import type { LayerDoc } from "./model";
import { fill as fillText, type LayersCopy } from "./panels";

/**
 * "빈 곳 채우기" (fill.ts), passed only when the server capability is on, the member may generate and
 * the canvas is not blank. The button shows only while the empty area lies on one axis.
 */
export interface CanvasFillOffer {
  /** Credits of one partial edit with the editor's default model and quality; one per strip. */
  creditsPerStrip: number;
  locale: "ko" | "en";
  busy: boolean;
  /** The partial edit's error line. */
  error: string | null;
  onFill(): void;
}

export interface CanvasSizeControlProps {
  copy: LayersCopy;
  doc: LayerDoc;
  open: boolean;
  onOpenChange(open: boolean): void;
  onRatio(ratio: CanvasRatio): void;
  /** A typed size, applied centred. */
  onSize(size: { width: number; height: number }): void;
  onReset(): void;
  fill?: CanvasFillOffer | null;
}

type Side = "width" | "height";

export function CanvasSizeControl({ copy, doc, open, onOpenChange, onRatio, onSize, onReset, fill }: CanvasSizeControlProps) {
  const panelId = useId();
  // What is being typed; null shows the document's own value (so a handle drag updates the fields live).
  const [draft, setDraft] = useState<{ side: Side; text: string } | null>(null);
  const size = `${doc.width} × ${doc.height}`;
  const active = activeCanvasRatio(doc);
  const strips = fill && open ? fillStrips(doc).length : 0;

  const apply = (side: Side, text: string) => {
    setDraft(null);
    const value = Number(text);
    if (!text.trim() || !Number.isFinite(value)) return;
    onSize(side === "width" ? { width: value, height: doc.height } : { width: doc.width, height: value });
  };

  const field = (side: Side, label: string) => (
    <label className="bsl-canvas-field">
      <span className="bsl-label">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        className="bsl-input bsl-num"
        min={CANVAS_MIN}
        max={CANVAS_MAX}
        step={1}
        value={draft?.side === side ? draft.text : String(side === "width" ? doc.width : doc.height)}
        data-canvas-input={side}
        onChange={(event) => setDraft({ side, text: event.target.value })}
        onBlur={(event) => draft?.side === side && apply(side, event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          apply(side, event.currentTarget.value);
        }}
      />
    </label>
  );

  return (
    <div className="bsl-canvas" data-canvas-control>
      <button
        type="button"
        className="bsl-canvas-chip bsl-num"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`${copy.canvas.size} ${size}`}
        title={copy.canvas.size}
        data-canvas-chip
        onClick={() => onOpenChange(!open)}
      >
        {size}
      </button>
      {open && (
        <div id={panelId} className="bsl-canvas-panel" role="group" aria-label={copy.canvas.size} data-canvas-panel>
          <span className="bsl-label">{copy.canvas.ratio}</span>
          <div className="bsl-canvas-ratios" role="group" aria-label={copy.canvas.ratio}>
            {CANVAS_RATIOS.map((ratio) => (
              <button key={ratio} type="button" className="bsl-canvas-ratio" aria-pressed={active === ratio} data-ratio={ratio} onClick={() => onRatio(ratio)}>
                <AspectShape ratio={ratio} />
                <span className="bsl-num">{ratio}</span>
              </button>
            ))}
          </div>
          <div className="bsl-canvas-size">
            {field("width", copy.canvas.width)}
            <span className="bsl-canvas-times" aria-hidden="true">
              ×
            </span>
            {field("height", copy.canvas.height)}
          </div>
          {fill && strips > 0 && (
            <>
              <button
                type="button"
                className="bsl-btn bsl-num"
                data-variant="solid"
                data-size="sm"
                disabled={fill.busy}
                aria-busy={fill.busy}
                data-canvas-fill
                onClick={fill.onFill}
              >
                {fillText(copy.canvas.fillCta, {
                  label: copy.canvas.fill,
                  credits: (fill.creditsPerStrip * strips).toLocaleString(fill.locale === "ko" ? "ko-KR" : "en-US"),
                })}
              </button>
              {fill.error && (
                <p className="bsl-error" role="alert">
                  {fill.error}
                </p>
              )}
            </>
          )}
          {isCanvasResized(doc) && (
            <button type="button" className="bsl-btn" data-variant="soft" data-size="sm" data-canvas-reset onClick={onReset}>
              {copy.canvas.reset}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
