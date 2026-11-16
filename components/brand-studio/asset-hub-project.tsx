"use client";
/**
 * "프로젝트에 담기" on the assets page: choose the project a studio result belongs to, or none.
 * Membership is per run, so when the run (with its later versions, its 1080p finish and its partial edits)
 * holds more than one result, the sheet says how many move together before anything is sent.
 */
import { useId, useState } from "react";
import s from "./asset-hub.module.css";
import { useModal } from "./modal";
import { fill, type LibraryCopy } from "./rail/text";

export interface ProjectPickDialogProps {
  copy: LibraryCopy;
  projects: ReadonlyArray<{ id: string; title: string }>;
  /** Where the run is now; null for no project. */
  current: string | null;
  /** How many results on the page move with this run (itself included). */
  count: number;
  /** Resolves with a line to show when it did not work, or null when it did. */
  onPick(projectId: string | null): Promise<string | null>;
  onClose(): void;
}

export function ProjectPickDialog({ copy, projects, current, count, onPick, onClose }: ProjectPickDialogProps) {
  const p = copy.projects;
  const ref = useModal();
  const id = useId();
  const [choice, setChoice] = useState<string | null>(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <dialog
      ref={ref}
      className="bsr-dialog"
      aria-labelledby={`${id}-title`}
      data-asset-hub-project-picker
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form
        className="bsr-dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || choice === current) return;
          setBusy(true);
          setError(null);
          void onPick(choice).then((problem) => {
            setBusy(false);
            if (problem) setError(problem);
          });
        }}
      >
        <h2 id={`${id}-title`}>{p.pickTitle}</h2>
        {count > 1 && (
          <p className="bsr-muted" data-asset-hub-project-family={count}>
            {fill(p.familyNote, { n: count })}
          </p>
        )}
        <div className={s.pickList} role="radiogroup" aria-labelledby={`${id}-title`}>
          <label className={s.pickRow} data-asset-hub-project-choice="">
            <input type="radio" name={`${id}-project`} checked={choice === null} onChange={() => setChoice(null)} />
            <span>{p.none}</span>
          </label>
          {projects.map((project) => (
            <label key={project.id} className={s.pickRow} data-asset-hub-project-choice={project.id}>
              <input type="radio" name={`${id}-project`} checked={choice === project.id} onChange={() => setChoice(project.id)} />
              <span>{project.title}</span>
            </label>
          ))}
        </div>
        {projects.length === 0 && <p className="bsr-muted">{p.empty}</p>}
        {error && (
          <p className="bsr-alert" role="alert">
            {error}
          </p>
        )}
        <div className="bsr-row bsr-dialog-actions">
          <button type="button" className="bsr-btn" data-variant="ghost" onClick={onClose}>
            {copy.uploads.cancel}
          </button>
          <button type="submit" className="bsr-btn" data-variant="soft" data-tone="accent" disabled={busy || choice === current} data-asset-hub-project-save>
            {choice ? p.save : copy.uploads.save}
          </button>
        </div>
      </form>
    </dialog>
  );
}
