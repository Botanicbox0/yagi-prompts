"use client";
/**
 * Native modal dialog to move one run (with its family) or a multi-select batch into a brand project or 미분류 (§4.6, H3).
 * Uses `<dialog className="bs-dialog">` opened via `useModal` (`showModal()`), native radio inputs for arrow-key
 * navigation, and the studio's existing dialog backdrop/styles (no glass, no new colour variables).
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { StudioBrandProject } from "@/lib/brand-studio/contracts";
import { brandProjectIdOf, type OpenProject } from "@/lib/brand-studio/open-project";
import type { StudioLocale } from "../copy";
import { useBackdropClose, useModal } from "../modal";
import {
  createMoveToProjectController,
  moveFamilyLine,
  projectSecondLine,
  type MoveApiFn,
  type ProjectSpineCopy,
} from "./model";

export interface MoveToProjectDialogProps {
  projects: readonly StudioBrandProject[];
  currentScope: OpenProject;
  jobIds: readonly string[];
  locale: StudioLocale;
  copy: ProjectSpineCopy;
  onMove: MoveApiFn;
  onMoved: (result: { projectId: string | null; toast: string; removedJobIds: string[] }) => void;
  onClose: () => void;
  /** Optional element getter to return focus to when opened from a transient menu item (H3). */
  returnFocus?: () => HTMLElement | null | undefined;
  /** Initial family count for deterministic SSR tests (optional). */
  initialFamilyCount?: number | null;
  /** Initial error line for deterministic SSR tests (optional). */
  initialError?: string | null;
  now?: Date;
}

const UNFILED_VALUE = "__unfiled__";

export function MoveToProjectDialog({
  projects,
  currentScope,
  jobIds,
  locale,
  copy,
  onMove,
  onMoved,
  onClose,
  returnFocus,
  initialFamilyCount = null,
  initialError = null,
  now,
}: MoveToProjectDialogProps) {
  const id = useId();
  const currentId = brandProjectIdOf(currentScope);
  const [targetId, setTargetId] = useState<string | null>(currentId);
  const [familyCount, setFamilyCount] = useState<number | null>(initialFamilyCount);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  submittingRef.current = submitting;
  const [error, setError] = useState<string | null>(initialError);

  const dialogRef = useModal({ returnFocus });
  const backdrop = useBackdropClose(() => {
    if (!submittingRef.current) onClose();
  });

  const controller = useMemo(
    () =>
      createMoveToProjectController({
        jobIds,
        projects,
        openScope: currentScope,
        copy,
        move: onMove,
      }),
    [copy, currentScope, jobIds, onMove, projects],
  );

  // Ask the server how many runs (including family) will move with `preview: true`.
  useEffect(() => {
    let alive = true;
    void controller.preview(targetId).then((res) => {
      if (!alive || "stale" in res) return;
      setFamilyCount(res.familyCount);
    });
    return () => {
      alive = false;
    };
  }, [controller, targetId]);

  const familyLine = moveFamilyLine(familyCount, copy, new Set(jobIds).size);
  const unchanged =
    (targetId === null && currentId === null) ||
    (targetId !== null && currentId !== null && targetId.toLowerCase() === currentId.toLowerCase());

  const handleSubmit = async () => {
    if (submitting || unchanged) return;
    setSubmitting(true);
    setError(null);
    const outcome = await controller.submit(targetId);
    setSubmitting(false);
    if (outcome.ok) {
      onMoved({
        projectId: outcome.projectId,
        toast: outcome.toast,
        removedJobIds: outcome.removedJobIds,
      });
      onClose();
      return;
    }
    if (!("ignored" in outcome)) {
      setError(outcome.error);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="bs-dialog"
      aria-labelledby={`${id}-title`}
      data-project-move-dialog=""
      onCancel={(event) => {
        event.preventDefault();
        if (!submittingRef.current) onClose();
      }}
      {...backdrop}
    >
      <form
        className="bs-dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <h2 id={`${id}-title`}>{copy.move}</h2>

        <fieldset className="bs-choices" disabled={submitting}>
          <legend className="bs-sr">{copy.move}</legend>
          {projects.map((project) => {
            const isTarget = targetId !== null && targetId.toLowerCase() === project.id.toLowerCase();
            const isCurrent = currentId !== null && currentId.toLowerCase() === project.id.toLowerCase();
            const second = projectSecondLine(project, copy, locale, now);
            return (
              <label
                key={project.id}
                className="bs-choice"
                data-project-move-option={project.id}
                data-current={isCurrent ? "true" : undefined}
              >
                <input
                  type="radio"
                  name={`${id}-target`}
                  value={project.id}
                  checked={isTarget}
                  onChange={() => {
                    setTargetId(project.id);
                    if (error) setError(null);
                  }}
                />
                <span>
                  {project.title}
                  {second ? ` · ${second}` : ""}
                </span>
                {isCurrent && <span className="bs-sr">{copy.selectedMark}</span>}
              </label>
            );
          })}

          <label
            className="bs-choice"
            data-project-move-option="unfiled"
            data-current={currentId === null ? "true" : undefined}
          >
            <input
              type="radio"
              name={`${id}-target`}
              value={UNFILED_VALUE}
              checked={targetId === null}
              onChange={() => {
                setTargetId(null);
                if (error) setError(null);
              }}
            />
            <span>{copy.unfiled}</span>
            {currentId === null && <span className="bs-sr">{copy.selectedMark}</span>}
          </label>
        </fieldset>

        {familyLine && (
          <p className="bs-note bs-num" data-project-move-family="">
            {familyLine}
          </p>
        )}

        {error && (
          <p className="bs-dock-message" role="alert" data-project-move-error="">
            {error}
          </p>
        )}

        <div className="bs-row bs-dialog-actions">
          <span className="bs-spacer" />
          <button type="button" className="bs-btn" data-variant="ghost" data-size="md" disabled={submitting} onClick={onClose}>
            {copy.cancel}
          </button>
          <button
            type="submit"
            className="bs-btn"
            data-variant="solid"
            data-size="md"
            data-project-move-submit=""
            disabled={submitting || unchanged}
          >
            {copy.moveSubmit}
          </button>
        </div>
      </form>
    </dialog>
  );
}
