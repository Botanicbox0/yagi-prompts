"use client";
/**
 * The bar under the picture after a partial edit lands (region-result.ts): the line, then
 * 원본 비교 (press and hold), 되돌리기 and 경계 다듬기. Workspace tokens only; the check is the one accent.
 * For BAR_ARM_MS after it appears (or shows again) the buttons ignore activation, without looking disabled.
 */
import { useEffect, useRef } from "react";
import { LayerIcon } from "./icons";
import type { LayersCopy } from "./panels";
import { createBarControls, isHoldKey, type BarControls } from "./region-result";

export interface RegionResultBarProps {
  copy: LayersCopy;
  comparing: boolean;
  /** Changes when the bar becomes visible again (a phone sheet closing over it): the quiet time restarts. */
  visibleKey?: string;
  onCompare(held: boolean): void;
  onUndo(): void;
  onRefine(): void;
}

export function RegionResultBar({ copy, comparing, visibleKey = "", onCompare, onUndo, onRefine }: RegionResultBarProps) {
  const r = copy.region;
  const handlersRef = useRef({ onCompare, onUndo, onRefine });
  handlersRef.current = { onCompare, onUndo, onRefine };
  const controlsRef = useRef<BarControls | null>(null);
  controlsRef.current ??= createBarControls({
    onCompare: (held) => handlersRef.current.onCompare(held),
    onUndo: () => handlersRef.current.onUndo(),
    onRefine: () => handlersRef.current.onRefine(),
  });
  const controls = controlsRef.current;
  // Restart the quiet time in the same render the bar shows again, so no tap slips in before an effect.
  const armedForRef = useRef(visibleKey);
  if (armedForRef.current !== visibleKey) {
    armedForRef.current = visibleKey;
    controls.arm();
  }

  // A hold never outlives the bar, its hiding, or the window's focus.
  useEffect(() => {
    const release = () => controls.releaseCompare();
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("blur", release);
      release();
    };
  }, [controls, visibleKey]);

  return (
    <div className="bsl-result" data-layers-result>
      <p className="bsl-result-line" role="status">
        <LayerIcon name="check" />
        <span>{r.applied}</span>
      </p>
      <div className="bsl-result-actions">
        <button
          type="button"
          className="bsl-btn bsl-result-btn"
          data-variant="soft"
          aria-pressed={comparing}
          title={r.compareHint}
          data-result-action="compare"
          onPointerDown={(event) => {
            if (event.button === 0) controls.pressCompare();
          }}
          onPointerUp={() => controls.releaseCompare()}
          onPointerLeave={() => controls.releaseCompare()}
          onPointerCancel={() => controls.releaseCompare()}
          onKeyDown={(event) => {
            if (!isHoldKey(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            controls.pressCompare();
          }}
          onKeyUp={(event) => {
            if (!isHoldKey(event.key)) return;
            event.preventDefault();
            controls.releaseCompare();
          }}
          onBlur={() => controls.releaseCompare()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <LayerIcon name="eye" />
          <span>{r.compare}</span>
        </button>
        <button type="button" className="bsl-btn bsl-result-btn" data-variant="ghost" data-result-action="undo" onClick={() => controls.undo()}>
          <LayerIcon name="undo" />
          <span>{r.undo}</span>
        </button>
        <button type="button" className="bsl-btn bsl-result-btn" data-variant="ghost" data-result-action="refine" onClick={() => controls.refine()}>
          <LayerIcon name="eraser" />
          <span>{r.refine}</span>
        </button>
      </div>
    </div>
  );
}
