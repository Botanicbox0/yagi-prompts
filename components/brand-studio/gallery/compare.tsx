"use client";
/**
 * Before / after for a partial edit (docs/BRAND-STUDIO-V3.md §4): the result with the picture it came
 * from laid over it, cut at a line the customer drags. The line is a real range input stretched over
 * the picture, so a drag, a press anywhere and the arrow keys all move it. Both pictures have the same
 * size (the edit is pasted back in place).
 */
import { useId, useState } from "react";

export function CompareSlider({
  before,
  after,
  width,
  height,
  labels,
  initial = 50,
}: {
  before: string;
  after: string;
  width: number | null;
  height: number | null;
  labels: { before: string; after: string; range: string; hint: string };
  initial?: number;
}) {
  const [at, setAt] = useState(initial);
  const id = useId();
  return (
    <div
      className="bs-compare"
      data-studio-compare
      style={{ ["--at" as string]: `${at}%`, ["--cr" as string]: width && height ? (width / height).toFixed(4) : undefined, aspectRatio: width && height ? `${width} / ${height}` : undefined }}
    >
      <img className="bs-compare-after" src={after} alt={labels.after} draggable={false} />
      <img className="bs-compare-before" src={before} alt={labels.before} draggable={false} />
      <span className="bs-compare-line" aria-hidden="true" />
      <span className="bs-compare-tag" data-side="before" aria-hidden="true">
        {labels.before}
      </span>
      <span className="bs-compare-tag" data-side="after" aria-hidden="true">
        {labels.after}
      </span>
      <label className="bs-sr" htmlFor={id}>
        {labels.range}
      </label>
      <input
        id={id}
        className="bs-compare-range"
        type="range"
        min={0}
        max={100}
        step={1}
        value={at}
        aria-valuetext={`${labels.before} ${at}%`}
        aria-describedby={`${id}-hint`}
        onChange={(event) => setAt(Number(event.target.value))}
      />
      <span id={`${id}-hint`} className="bs-sr">
        {labels.hint}
      </span>
    </div>
  );
}
