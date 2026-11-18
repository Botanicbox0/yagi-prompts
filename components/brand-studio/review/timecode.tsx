/**
 * Words and timecodes on the review stage: `fill` for text templates, `fillNodes` when a slot holds an element,
 * and `Timecode`, which sets the frame number apart (`0:08` + a small `:00`) so it reads as seconds.
 */
import { Fragment, type ReactNode } from "react";
import { formatTimecode } from "@/lib/brand-studio/review-contracts";
import { frameTimecodeParts } from "@/lib/brand-studio/review-frames";

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

/** `fill` for a screen: the same template with elements (a `Timecode`) in its slots. */
export function fillNodes(template: string, values: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\w+\})/).map((part, i) => {
    const key = /^\{(\w+)\}$/.exec(part)?.[1];
    return <Fragment key={i}>{key && key in values ? values[key] : part}</Fragment>;
  });
}

/**
 * A timecode on screen. With a frame rate the frame number is set apart, smaller and quieter, so `0:08`
 * + `:00` reads as eight seconds and not eight minutes (docs/BRAND-ROOMS-FEEDBACK.md §11). Without one it
 * is the old tenths. `clockOnly`: the frame part left off (a length that ends on a whole second).
 */
export function Timecode({ ms, fps, clockOnly = false }: { ms: number | null | undefined; fps: number | null; clockOnly?: boolean }) {
  if (!fps) return <>{formatTimecode(ms)}</>;
  const { clock, frames } = frameTimecodeParts(ms, fps);
  return (
    <span className="bsv-tc" data-review-timecode="">
      {clock}
      {clockOnly ? null : <span className="bsv-tc-ff">{frames}</span>}
    </span>
  );
}

