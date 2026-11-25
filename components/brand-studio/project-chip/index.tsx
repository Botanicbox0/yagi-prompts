"use client";
/**
 * The studio header project chip and gone-project notice (docs/BRAND-PROJECT-SPINE.md §4.2, slice 1b).
 * One component mounted beside the studio title in all four studios (image, video, sound, editing).
 */
import { useCallback, useEffect, useId, useRef, useState, type FocusEvent } from "react";
import { fill } from "../copy";
import { ProjectSpineProvider, useProjectSpine, type CreateBrandProjectResult, type ProjectSpineContextValue, type ProjectSpineProviderProps } from "./context";
import {
  PROJECT_SEARCH_THRESHOLD,
  collectMoveJobIds,
  createBrandProjectController,
  createMoveToProjectController,
  createProjectErrorLine,
  filterProjects,
  formatRelativeTime,
  handleNotFoundForOpenProject,
  handlePickerKey,
  moveDoneToast,
  moveFamilyLine,
  movedJobsLeavingScope,
  nextListIndex,
  projectCoverThumb,
  projectSecondLine,
  removeProjectFromList,
  type MoveApiFn,
  type MoveSubmitOutcome,
  type ProjectSpineCopy,
} from "./model";
import { MoveToProjectDialog, type MoveToProjectDialogProps } from "./move-dialog";
import { ProjectPicker } from "./picker";
import s from "./project-chip.module.css";

export {
  MoveToProjectDialog,
  PROJECT_SEARCH_THRESHOLD,
  ProjectSpineProvider,
  collectMoveJobIds,
  createBrandProjectController,
  createMoveToProjectController,
  createProjectErrorLine,
  filterProjects,
  formatRelativeTime,
  handleNotFoundForOpenProject,
  handlePickerKey,
  moveDoneToast,
  moveFamilyLine,
  movedJobsLeavingScope,
  nextListIndex,
  projectCoverThumb,
  projectSecondLine,
  removeProjectFromList,
  useProjectSpine,
  s as projectChipStyles,
  type CreateBrandProjectResult,
  type MoveApiFn,
  type MoveSubmitOutcome,
  type MoveToProjectDialogProps,
  type ProjectSpineContextValue,
  type ProjectSpineCopy,
  type ProjectSpineProviderProps,
};

export interface ProjectChipProps {
  /** Test-only initial open state (for SSR markup assertions). */
  initialOpen?: boolean;
  /** Test-only initial create-form state. */
  initialCreating?: boolean;
  /** Test-only initial search string. */
  initialSearch?: string;
  /** Test-only initial create-form error. */
  initialCreateError?: string | null;
  /** Optional clock override for deterministic relative-time rendering in tests. */
  now?: Date;
}

export function ProjectChip({
  initialOpen = false,
  initialCreating = false,
  initialSearch = "",
  initialCreateError = null,
  now,
}: ProjectChipProps) {
  const ctx = useProjectSpine();
  const [menuOpen, setMenuOpen] = useState(initialOpen);
  const [creating, setCreating] = useState(initialCreating);
  const wrapRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setCreating(false);
  }, []);

  const closeAndFocusChip = useCallback(() => {
    closeMenu();
    chipRef.current?.focus();
  }, [closeMenu]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && wrapRef.current?.contains(target)) return;
      closeMenu();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [closeMenu, menuOpen]);

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!menuOpen) return;
    const next = event.relatedTarget as Node | null;
    if (next && !event.currentTarget.contains(next)) {
      closeMenu();
    }
  };

  if (!ctx) return null;

  const { projects, open, canCreate, locale, copy, select, createProject } = ctx;
  const activeProject =
    open.kind === "project" ? projects.find((p) => p.id.toLowerCase() === open.id.toLowerCase()) ?? null : null;
  const label = activeProject ? activeProject.title : copy.unfiled;
  const thumb = activeProject ? projectCoverThumb(activeProject) : null;
  const openMarker = activeProject ? activeProject.id : "unfiled";

  return (
    <div ref={wrapRef} className={s.wrap} onBlur={handleBlur}>
      <button
        ref={chipRef}
        type="button"
        className={s.chip}
        data-project-chip=""
        data-project-open={openMarker}
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        aria-controls={menuOpen && !creating ? listId : undefined}
        aria-label={fill(copy.chipAria, { name: label })}
        onClick={() => {
          if (menuOpen) closeMenu();
          else setMenuOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !menuOpen) {
            event.preventDefault();
            setMenuOpen(true);
          } else if (event.key === "Escape" && menuOpen) {
            event.preventDefault();
            closeAndFocusChip();
          }
        }}
      >
        {thumb ? (
          <img className={s.chipThumb} src={thumb} alt="" />
        ) : (
          <span className={s.chipTile} aria-hidden="true">
            <svg className={s.icon} viewBox="0 0 16 16" width="13" height="13">
              {activeProject ? (
                <path d="M2.5 4.5h4l1.3 1.5h5.7v6.5h-11z" />
              ) : (
                <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" strokeDasharray="2 2" />
              )}
            </svg>
          </span>
        )}
        <span className={s.chipLabel}>{label}</span>
        <svg className={s.chevron} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 10l5 5 5-5" />
        </svg>
      </button>

      {menuOpen && (
        <ProjectPicker
          id={listId}
          projects={projects}
          open={open}
          canCreate={canCreate}
          locale={locale}
          copy={copy}
          onSelect={(next) => select(next)}
          onCreate={createProject}
          onClose={closeAndFocusChip}
          creating={creating}
          onCreatingChange={setCreating}
          initialCreating={initialCreating}
          initialSearch={initialSearch}
          initialCreateError={initialCreateError}
          now={now}
        />
      )}
    </div>
  );
}

/** Quiet dismissible line under the studio header when the remembered or addressed project is no longer available. */
export function ProjectGoneNotice() {
  const ctx = useProjectSpine();
  if (!ctx || ctx.notice !== "gone") return null;
  return (
    <div className={s.goneNotice} role="status" data-project-gone-notice="">
      <p>{ctx.copy.goneNotice}</p>
      <button type="button" className={s.dismissBtn} onClick={ctx.dismissNotice}>
        {ctx.copy.dismissNotice}
      </button>
    </div>
  );
}
