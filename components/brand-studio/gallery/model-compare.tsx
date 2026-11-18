"use client";
/**
 * "모델 비교" in the viewer (2026-11-19): every result of one request on several models, next to each other on
 * the stage at the same height, each with its model and its credits under it. Two models given the same
 * request frame the picture differently (a face, a hand, the bottle land in different places), so they are
 * laid side by side and never cut at a line: the before/after slider stays for an edit of the SAME picture.
 *
 * A model whose run failed (or is still being made) keeps its place as a quiet tile with its name and the
 * one-line reason. A press on a picture leaves the comparison and opens that result. On a phone the row
 * is swiped: one picture per screen width (scroll-snap), the model name on each, and "1 / 3" for where you are.
 *
 * Pictures keep their own shape: each takes the width its own ratio gives at the shared height (the ratio
 * read from the file once it loads, the stored size until then), so nothing is cropped or stretched.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { StudioJobView, StudioOutputView } from "@/lib/brand-studio/contracts";
import { creditsOf } from "@/lib/brand-studio/credits";
import { studioModelOrLegacy } from "@/lib/brand-studio/models";
import { credits, errorLine, fill, type StudioCopy, type StudioLocale } from "../copy";

/** A sibling's result in the same place as `output` in its own run (its 2nd picture for this one's 2nd), else its first. */
export function siblingOutput(job: Pick<StudioJobView, "outputs">, output: Pick<StudioOutputView, "id"> | null, run: StudioJobView): StudioOutputView | null {
  const slot = output ? Math.max(0, job.outputs.findIndex((o) => o.id === output.id)) : 0;
  return run.outputs[Math.min(slot, run.outputs.length - 1)] ?? null;
}

/** What one result took, in credits: the run's amount over the results it covers (the wall's figure). */
export function resultCredits(run: Pick<StudioJobView, "estimateKrw" | "outputs" | "countedOutputs">): number {
  return run.estimateKrw > 0 && run.outputs.length > 0 ? Math.ceil(creditsOf(run.estimateKrw) / Math.max(1, run.countedOutputs ?? run.outputs.length)) : 0;
}

export interface CompareEntry {
  run: StudioJobView;
  /** The picture to show; null for a run that has none (failed, stopped, still being made). */
  output: StudioOutputView | null;
  label: string;
  /** What this picture took; null without a picture. */
  credits: number | null;
  /** Why there is no picture, in one line; null with one. */
  reason: string | null;
  /** The result the viewer opened. */
  current: boolean;
}

/**
 * The models of one request in pick order, each with the picture in the same place as the one opened.
 * A run that finished with nothing to show (every result deleted) is left out.
 */
export function compareEntries(job: StudioJobView, output: StudioOutputView | null, siblings: readonly StudioJobView[], copy: StudioCopy): CompareEntry[] {
  return siblings
    .filter((run) => !(run.status === "succeeded" && run.outputs.length === 0))
    .map((run) => {
      const current = run.id === job.id;
      const picture = current ? output : siblingOutput(job, output, run);
      const shown = picture && picture.kind === "image" ? picture : null;
      const reason = shown
        ? null
        : run.status === "failed"
          ? errorLine(copy, run.errorCode)
          : run.status === "canceled"
            ? copy.board.canceled
            : (copy.board.stage[run.status as keyof typeof copy.board.stage] ?? copy.board.stage.queued);
      return { run, output: shown, label: studioModelOrLegacy(run.model)?.label ?? run.model, credits: shown ? resultCredits(run) : null, reason, current };
    });
}

/** True when there is something to compare: at least two models with a picture. */
export function canCompareModels(entries: readonly CompareEntry[]): boolean {
  return entries.filter((entry) => entry.output).length >= 2;
}

/** The shape of a picture (width / height): its stored size, the run's ratio, or square. */
function storedRatio(entry: CompareEntry): number {
  const o = entry.output;
  if (o?.width && o.height) return o.width / o.height;
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(entry.run.aspect ?? "");
  return m && Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : 1;
}

export function ModelCompare({
  entries,
  copy,
  locale,
  onOpen,
}: {
  entries: readonly CompareEntry[];
  copy: StudioCopy;
  locale: StudioLocale;
  /** A press on a picture: leave the comparison and open that result. */
  onOpen(entry: CompareEntry): void;
}) {
  const v = copy.viewer;
  // The ratio each file really has, once it loads (a provider may return a slightly different shape).
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const ratios = entries.map((entry) => (entry.output && measured[entry.output.id]) || storedRatio(entry));
  const sum = ratios.reduce((a, b) => a + b, 0);
  const strip = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(() => Math.max(0, entries.findIndex((entry) => entry.current)));
  // On a phone the opened result is the one in view first.
  useEffect(() => {
    const el = strip.current;
    if (!el || el.scrollWidth <= el.clientWidth + 1) return;
    const start = Math.max(0, entries.findIndex((entry) => entry.current));
    el.scrollLeft = start * el.clientWidth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="bs-mcompare" data-studio-model-compare role="group" aria-label={v.compareModels} style={{ ["--sum" as string]: sum.toFixed(4), ["--n" as string]: entries.length } as CSSProperties}>
      <div
        ref={strip}
        className="bs-mcompare-row"
        onScroll={(event) => {
          const el = event.currentTarget;
          if (el.clientWidth > 0) setAt(Math.min(entries.length - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth))));
        }}
      >
        {entries.map((entry, i) => (
          <figure
            key={entry.run.id}
            className="bs-mcompare-item"
            data-compare-model={entry.run.model}
            data-current={entry.current ? "" : undefined}
            style={{ ["--r" as string]: ratios[i]!.toFixed(4) } as CSSProperties}
          >
            {entry.output ? (
              <button
                type="button"
                className="bs-mcompare-open"
                aria-label={fill(v.siblingShow, { model: entry.label })}
                aria-current={entry.current ? "true" : undefined}
                onClick={() => onOpen(entry)}
              >
                <img
                  src={entry.output.url}
                  alt=""
                  draggable={false}
                  onLoad={(event) => {
                    const img = event.currentTarget;
                    const id = entry.output!.id;
                    if (img.naturalWidth > 0 && img.naturalHeight > 0) setMeasured((m) => (m[id] ? m : { ...m, [id]: img.naturalWidth / img.naturalHeight }));
                  }}
                />
              </button>
            ) : (
              // Its name is the caption under it, like every other model's; the tile says why there is no picture.
              <div className="bs-mcompare-empty" data-state={entry.run.status === "failed" || entry.run.status === "canceled" ? "failed" : "open"}>
                <span className="bs-mcompare-empty-why">{entry.reason}</span>
              </div>
            )}
            <figcaption className="bs-mcompare-caption">
              <span className="bs-mcompare-name">{entry.label}</span>
              {entry.credits !== null && entry.credits > 0 && <span className="bs-mcompare-credits bs-num">{credits(copy.credits.amount, entry.credits, locale)}</span>}
            </figcaption>
          </figure>
        ))}
      </div>
      {entries.length > 1 && (
        <span className="bs-mcompare-at bs-num" aria-hidden="true" data-studio-compare-at>
          {at + 1} / {entries.length}
        </span>
      )}
    </div>
  );
}
