/**
 * The result board (docs/BRAND-STUDIO-V2.md §5.2): one group per run, newest first. A run that is
 * still open reserves each result's place at its final ratio, so nothing jumps when it lands.
 */
import type { StudioJobView, StudioOutputView } from "@/lib/brand-studio/contracts";
import { studioModel, type StudioMedium } from "@/lib/brand-studio/models";
import { errorLine, fill, formatKrw, type StudioCopy, type StudioLocale } from "./copy";
import { startRefDrag } from "./refs";
import { isOpen } from "./store";

export function ratioOf(aspect: string | null | undefined): string | null {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect ?? "");
  return match ? `${match[1]} / ${match[2]}` : null;
}

/** The place a pending result takes: the run's ratio, else its source picture's, else a square. */
export function slotRatio(job: Pick<StudioJobView, "aspect">, parent: Pick<StudioOutputView, "width" | "height"> | null): string {
  return ratioOf(job.aspect) ?? (parent?.width && parent.height ? `${parent.width} / ${parent.height}` : "1 / 1");
}

export function outputRatio(output: StudioOutputView, job: StudioJobView, parent: StudioOutputView | null): string {
  return output.width && output.height ? `${output.width} / ${output.height}` : slotRatio(job, parent);
}

export const EXAMPLES: ReadonlyArray<{ key: "one" | "two" | "three"; medium: StudioMedium }> = [
  { key: "one", medium: "image" },
  { key: "two", medium: "image" },
  { key: "three", medium: "video" },
];

/** A run can be stopped only before anything reached the maker (the server says so when it has). */
export const canCancel = (job: Pick<StudioJobView, "status">) => job.status === "held" || job.status === "queued";

export interface BoardProps {
  jobs: readonly StudioJobView[];
  copy: StudioCopy;
  locale: StudioLocale;
  canCreate: boolean;
  /** Owner or editor: may stop their team's waiting runs. */
  canStop?: boolean;
  /** The run whose cancel is on its way. */
  stopping?: string | null;
  /** A line under a run (why it could not be stopped). */
  notes?: Readonly<Record<string, string>>;
  parentOf(outputId: string | null): StudioOutputView | null;
  onOpen(outputId: string): void;
  onRetry(job: StudioJobView): void;
  onCancel?(job: StudioJobView): void;
  onExample(text: string, medium: StudioMedium): void;
}

export function Board({ jobs: all, copy, locale, canCreate, canStop = false, stopping = null, notes = {}, parentOf, onOpen, onRetry, onCancel, onExample }: BoardProps) {
  const c = copy.board;
  // A finished run whose results were all deleted leaves nothing to show.
  const jobs = all.filter((job) => !(job.status === "succeeded" && job.outputs.length === 0));
  if (!jobs.length)
    return (
      <section className="bs-board" data-studio-board data-state="empty" aria-label={c.label}>
        <div className="bs-empty">
          <h2>{c.emptyTitle}</h2>
          {canCreate ? (
            <>
              <p>{c.emptyBody}</p>
              <ul className="bs-examples" data-studio-examples>
                {EXAMPLES.map(({ key, medium }) => (
                  <li key={key}>
                    <button type="button" className="bs-example" onClick={() => onExample(c.examples[key], medium)}>
                      {c.examples[key]}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>{c.emptyReadOnly}</p>
          )}
        </div>
      </section>
    );
  let n = 0;
  return (
    <section className="bs-board" data-studio-board aria-label={c.label}>
      {jobs.map((job) => {
        const parent = parentOf(job.parentOutputId);
        const open = isOpen(job);
        const pending = open ? Math.max(0, job.expected - job.outputs.length) : 0;
        const model = studioModel(job.model);
        return (
          <article key={job.id} className="bs-job" data-job-status={job.status} data-job-kind={job.kind} data-studio-job={job.id}>
            <header className="bs-job-head">
              <div className="bs-job-text">
                <p className="bs-job-prompt">{job.prompt || c.noPrompt}</p>
                <p className="bs-job-meta">
                  {model && <span>{model.label}</span>}
                  {job.kind === "region_edit" && <span>{c.editBadge}</span>}
                  {job.kind === "video_final" && <span>{c.finalBadge}</span>}
                  {job.estimateKrw > 0 && <span className="bs-num">{fill(c.usage, { amount: formatKrw(job.estimateKrw, locale) })}</span>}
                </p>
              </div>
              {canStop && onCancel && canCancel(job) && (
                <button
                  type="button"
                  className="bs-btn"
                  data-variant="ghost"
                  data-size="sm"
                  data-studio-cancel
                  aria-label={c.cancelLabel}
                  disabled={stopping === job.id}
                  aria-busy={stopping === job.id}
                  onClick={() => onCancel(job)}
                >
                  {c.cancel}
                </button>
              )}
            </header>
            {notes[job.id] && (
              <p className="bs-job-note" role="status" data-studio-job-note>
                {notes[job.id]}
              </p>
            )}
            {job.status === "failed" && (
              <div className="bs-job-note" data-state="failed">
                <p>{errorLine(copy, job.errorCode)}</p>
                {canCreate && (
                  <button type="button" className="bs-btn" data-variant="soft" data-size="sm" onClick={() => onRetry(job)}>
                    {c.retry}
                  </button>
                )}
              </div>
            )}
            {job.status === "canceled" && <p className="bs-job-note">{c.canceled}</p>}
            {(job.outputs.length > 0 || pending > 0) && (
              <div className="bs-results">
                {job.outputs.map((output) => {
                  const label = fill(c.open, { n: ++n });
                  return (
                    <button
                      key={output.id}
                      type="button"
                      className="bs-tile"
                      data-kind={output.kind}
                      data-state="ready"
                      style={{ aspectRatio: outputRatio(output, job, parent) }}
                      draggable={canCreate}
                      onDragStart={(event) => startRefDrag(event, { outputId: output.id })}
                      onClick={() => onOpen(output.id)}
                      aria-label={label}
                    >
                      {output.kind === "video" ? (
                        <video src={`${output.url}#t=0.1`} poster={output.thumbUrl ?? undefined} muted playsInline preload="metadata" tabIndex={-1} />
                      ) : (
                        <img src={output.thumbUrl ?? output.url} alt="" loading="lazy" draggable={false} />
                      )}
                      {output.draft && <span className="bs-badge">{c.draftBadge}</span>}
                    </button>
                  );
                })}
                {Array.from({ length: pending }, (_, i) => (
                  <div
                    key={`pending-${i}`}
                    className="bs-tile"
                    data-state="pending"
                    style={{ aspectRatio: slotRatio(job, parent) }}
                    role="img"
                    aria-label={fill(c.pending, { n: job.outputs.length + i + 1 })}
                  >
                    <span className="bs-stage">{c.stage[job.status as keyof typeof c.stage] ?? c.stage.queued}</span>
                  </div>
                ))}
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
