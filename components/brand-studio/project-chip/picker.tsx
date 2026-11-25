"use client";
/**
 * Floating project list inside the project chip popover (§4.2, docs §4.5).
 * Handles 0 projects (unfiled + new + guide), 1–5 projects (list + divider + unfiled + new), and 6+ projects
 * (search field + scrollable list). Viewers see no new-project row and get `viewerHint` in the footer.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { StudioBrandProject } from "@/lib/brand-studio/contracts";
import type { OpenProject } from "@/lib/brand-studio/open-project";
import type { StudioLocale } from "../copy";
import type { CreateBrandProjectResult } from "./context";
import {
  PROJECT_SEARCH_THRESHOLD,
  filterProjects,
  handlePickerKey,
  projectCoverThumb,
  projectSecondLine,
  type ProjectSpineCopy,
} from "./model";
import { NewProjectForm } from "./new-project-form";
import s from "./project-chip.module.css";

export interface ProjectPickerProps {
  id: string;
  projects: readonly StudioBrandProject[];
  open: OpenProject;
  canCreate: boolean;
  locale: StudioLocale;
  copy: ProjectSpineCopy;
  onSelect: (next: OpenProject) => void;
  onCreate: (title: string, requestId: string) => Promise<CreateBrandProjectResult>;
  onClose: () => void;
  /** Controlled create-form flag so the parent chip omits `aria-controls` while the form replaces the listbox. */
  creating?: boolean;
  onCreatingChange?: (next: boolean) => void;
  initialCreating?: boolean;
  initialSearch?: string;
  initialCreateError?: string | null;
  now?: Date;
}

type OptionEntry =
  | { kind: "project"; project: StudioBrandProject }
  | { kind: "unfiled" }
  | { kind: "new" };

function CheckIcon() {
  return (
    <svg className={`${s.icon} ${s.check}`} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.5 6.6 11.5 12.5 4.8" />
    </svg>
  );
}

function UnfiledIcon() {
  return (
    <svg className={s.icon} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" strokeDasharray="2 2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className={s.icon} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

function NeutralFolderIcon() {
  return (
    <svg className={s.icon} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 4.5h4l1.3 1.5h5.7v6.5h-11z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className={s.icon} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2 13 13" />
    </svg>
  );
}

export function ProjectPicker({
  id,
  projects,
  open,
  canCreate,
  locale,
  copy,
  onSelect,
  onCreate,
  onClose,
  creating: controlledCreating,
  onCreatingChange,
  initialCreating = false,
  initialSearch = "",
  initialCreateError = null,
  now,
}: ProjectPickerProps) {
  const [localCreating, setLocalCreating] = useState(initialCreating);
  const creating = controlledCreating ?? localCreating;
  const setCreating = (next: boolean) => {
    setLocalCreating(next);
    onCreatingChange?.(next);
  };
  const [search, setSearch] = useState(initialSearch);
  const hasSearch = projects.length >= PROJECT_SEARCH_THRESHOLD;
  const visibleProjects = hasSearch ? filterProjects(projects, search) : [...projects];

  const entries: OptionEntry[] = [
    ...visibleProjects.map((project): OptionEntry => ({ kind: "project", project })),
    { kind: "unfiled" },
    ...(canCreate ? [{ kind: "new" as const }] : []),
  ];

  const unfiledIdx = visibleProjects.length;
  const newIdx = unfiledIdx + 1;
  const newRowIndex = canCreate ? newIdx : null;

  const selectedIndex = entries.findIndex((entry) =>
    entry.kind === "project"
      ? open.kind === "project" && entry.project.id.toLowerCase() === open.id.toLowerCase()
      : entry.kind === "unfiled"
        ? open.kind === "unfiled"
        : false,
  );
  const [activeIndex, setActiveIndex] = useState(selectedIndex >= 0 ? selectedIndex : 0);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pendingFocusIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (creating) return;
    if (pendingFocusIndexRef.current !== null) {
      const idx = pendingFocusIndexRef.current;
      pendingFocusIndexRef.current = null;
      setActiveIndex(idx);
      rowRefs.current[idx]?.focus();
      return;
    }
    if (hasSearch) {
      searchRef.current?.focus();
    } else {
      const target = rowRefs.current[selectedIndex >= 0 ? selectedIndex : 0];
      target?.focus();
    }
  }, [creating, hasSearch, selectedIndex]);

  useEffect(() => {
    setActiveIndex((cur) => (cur >= entries.length ? Math.max(0, entries.length - 1) : cur));
  }, [entries.length]);

  const exitCreateForm = (focusIndex: number | null) => {
    pendingFocusIndexRef.current = focusIndex;
    setCreating(false);
  };

  const activate = (entry: OptionEntry) => {
    if (entry.kind === "project") {
      onSelect({ kind: "project", id: entry.project.id });
      onClose();
    } else if (entry.kind === "unfiled") {
      onSelect({ kind: "unfiled" });
      onClose();
    } else {
      setCreating(true);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const action = handlePickerKey(
      {
        creating,
        activeIndex,
        entryCount: entries.length,
        inSearchInput: typeof document !== "undefined" && document.activeElement === searchRef.current,
        searchHasText: search.trim().length > 0,
        visibleProjectCount: visibleProjects.length,
        newRowIndex,
      },
      event.key,
    );
    switch (action.type) {
      case "exit_create":
        event.preventDefault();
        event.stopPropagation();
        exitCreateForm(action.focusIndex);
        return;
      case "close_picker":
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      case "move":
        event.preventDefault();
        setActiveIndex(action.nextIndex);
        rowRefs.current[action.nextIndex]?.focus();
        return;
      case "activate": {
        event.preventDefault();
        const target = entries[action.index];
        if (target) activate(target);
        return;
      }
      case "none":
        return;
    }
  };

  const renderProjectRow = (project: StudioBrandProject, idx: number) => {
    const thumb = projectCoverThumb(project);
    const isSelected = open.kind === "project" && open.id.toLowerCase() === project.id.toLowerCase();
    const second = projectSecondLine(project, copy, locale, now);
    return (
      <button
        key={project.id}
        ref={(el) => {
          rowRefs.current[idx] = el;
        }}
        type="button"
        role="option"
        tabIndex={activeIndex === idx ? 0 : -1}
        aria-selected={isSelected}
        data-project-row={project.id}
        data-highlighted={activeIndex === idx ? "true" : undefined}
        className={s.row}
        onMouseEnter={() => setActiveIndex(idx)}
        onClick={() => activate({ kind: "project", project })}
      >
        {thumb ? (
          <img className={s.rowThumb} src={thumb} alt="" />
        ) : (
          <span className={s.rowTile} aria-hidden="true">
            <NeutralFolderIcon />
          </span>
        )}
        <span className={s.rowText}>
          <strong className={s.rowTitle}>{project.title}</strong>
          {second && <small className={s.meta}>{second}</small>}
        </span>
        {isSelected && (
          <>
            <CheckIcon />
            <span className={s.sr}>{copy.selectedMark}</span>
          </>
        )}
      </button>
    );
  };

  const isUnfiledSelected = open.kind === "unfiled";

  return (
    <div className={s.popover} data-project-picker="" onKeyDown={handleKeyDown}>
      <div className={s.label}>{copy.saveTo}</div>
      {creating ? (
        <NewProjectForm
          copy={copy}
          onCreate={onCreate}
          onCreated={onClose}
          onCancel={() => exitCreateForm(newRowIndex)}
          initialError={initialCreateError}
        />
      ) : (
        <>
          {hasSearch && (
            <div className={s.searchWrap}>
              <SearchIcon />
              <input
                ref={searchRef}
                type="search"
                className={s.searchInput}
                placeholder={copy.pickerSearch}
                aria-label={copy.pickerSearch}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setActiveIndex(0);
                }}
              />
            </div>
          )}
          <div id={id} role="listbox" aria-label={copy.saveTo} className={s.list}>
            {projects.length > 0 && (
              <>
                {hasSearch ? (
                  <div className={s.scrollArea} data-project-scroll="true">
                    {visibleProjects.length > 0 ? (
                      visibleProjects.map((project, idx) => renderProjectRow(project, idx))
                    ) : (
                      <p className={s.noMatch}>{copy.pickerNoMatch}</p>
                    )}
                  </div>
                ) : (
                  visibleProjects.map((project, idx) => renderProjectRow(project, idx))
                )}
                <div className={s.divider} role="separator" />
              </>
            )}

            <button
              ref={(el) => {
                rowRefs.current[unfiledIdx] = el;
              }}
              type="button"
              role="option"
              tabIndex={activeIndex === unfiledIdx ? 0 : -1}
              aria-selected={isUnfiledSelected}
              data-project-row="unfiled"
              data-highlighted={activeIndex === unfiledIdx ? "true" : undefined}
              className={s.row}
              onMouseEnter={() => setActiveIndex(unfiledIdx)}
              onClick={() => activate({ kind: "unfiled" })}
            >
              <span className={s.rowDash} aria-hidden="true">
                <UnfiledIcon />
              </span>
              <span className={s.rowText}>
                <strong className={s.rowTitle}>{copy.unfiled}</strong>
                <small className={s.meta}>{copy.pickerUnfiledDesc}</small>
              </span>
              {isUnfiledSelected && (
                <>
                  <CheckIcon />
                  <span className={s.sr}>{copy.selectedMark}</span>
                </>
              )}
            </button>

            {canCreate && (
              <button
                ref={(el) => {
                  rowRefs.current[newIdx] = el;
                }}
                type="button"
                role="option"
                tabIndex={activeIndex === newIdx ? 0 : -1}
                aria-selected="false"
                data-project-new=""
                data-highlighted={activeIndex === newIdx ? "true" : undefined}
                className={s.row}
                onMouseEnter={() => setActiveIndex(newIdx)}
                onClick={() => activate({ kind: "new" })}
              >
                <span className={s.rowDash} aria-hidden="true">
                  <PlusIcon />
                </span>
                <span className={s.rowText}>
                  <strong className={s.rowTitle}>{copy.newProject}</strong>
                  <small className={s.meta}>{copy.newProjectDesc}</small>
                </span>
              </button>
            )}
          </div>

          {projects.length === 0 && canCreate && <p className={s.guide}>{copy.pickerEmpty}</p>}
          <p className={s.footer}>{canCreate ? copy.pickerFooter : copy.viewerHint}</p>
        </>
      )}
    </div>
  );
}
