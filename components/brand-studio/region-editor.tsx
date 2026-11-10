/**
 * Draw, move and resize the partial-edit box over a picture with a mouse, a pen or a finger; the
 * keyboard path is "place a box" and then the arrow keys. The box is stored in fractions.
 */
import { useId, useRef, type PointerEvent, type ReactNode } from "react";
import type { RegionBox } from "@/lib/brand-studio/contracts";
import type { StudioCopy } from "./copy";
import { containsPoint, drawBox, moveBox, nudgeBox, pointIn, resizeBox, type Corner, type Point } from "./region-math";

type Drag = { mode: "draw"; start: Point } | { mode: "move"; start: Point; origin: RegionBox } | { mode: "resize"; corner: Corner; origin: RegionBox };

const CORNERS: readonly Corner[] = ["nw", "ne", "sw", "se"];

export function RegionEditor({ box, onChange, copy, children }: { box: RegionBox | null; onChange(box: RegionBox): void; copy: StudioCopy; children: ReactNode }) {
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const id = useId();
  const at = (event: PointerEvent) => pointIn(surface.current!.getBoundingClientRect(), event.clientX, event.clientY);

  function down(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const point = at(event);
    const corner = (event.target as HTMLElement).dataset?.corner as Corner | undefined;
    if (corner && box) drag.current = { mode: "resize", corner, origin: box };
    else if (box && containsPoint(box, point)) drag.current = { mode: "move", start: point, origin: box };
    else drag.current = { mode: "draw", start: point };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current) return;
    const point = at(event);
    if (current.mode === "draw") {
      if (Math.abs(point.x - current.start.x) < 0.01 && Math.abs(point.y - current.start.y) < 0.01) return;
      onChange(drawBox(current.start, point));
    } else if (current.mode === "move") onChange(moveBox(current.origin, point.x - current.start.x, point.y - current.start.y));
    else onChange(resizeBox(current.origin, current.corner, point));
  }
  function up(event: PointerEvent<HTMLDivElement>) {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <div
      ref={surface}
      className="bs-region"
      data-studio-region
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {children}
      {box && (
        <div
          className="bs-region-box"
          tabIndex={0}
          role="group"
          aria-label={copy.region.box}
          aria-describedby={`${id}-keys`}
          data-box={`${box.x},${box.y},${box.w},${box.h}`}
          style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
          onKeyDown={(event) => {
            const next = nudgeBox(box, event.key, event.shiftKey);
            if (!next) return;
            event.preventDefault();
            onChange(next);
          }}
        >
          {CORNERS.map((corner) => (
            <span key={corner} className="bs-region-handle" data-corner={corner} aria-hidden="true" />
          ))}
        </div>
      )}
      <span id={`${id}-keys`} className="bs-sr">
        {copy.region.keys}
      </span>
    </div>
  );
}
