"use client";

import { useEffect, useRef, useState } from "react";
import { fill as interpolate } from "@/components/brand-studio/copy";
import { formatCredits } from "@/lib/brand-studio/credits";
import type { VideoProjectStatus, VideoProjectSummary } from "@/lib/brand-studio/video-projects";
import type { StudioVideoCopy } from "@/messages/studio-video";
import type { SequenceRailHeight } from "./sequence-rail";
import w from "./video-workspace.module.css";

export interface VideoProjectBarProps {
  locale: "ko" | "en";
  canEdit: boolean;
  projectId: string | null;
  projectTitle: string;
  projectStatus: VideoProjectStatus;
  savingProject: boolean;
  projects: VideoProjectSummary[];
  clipCount: number;
  renderCredits: number;
  railHeight: SequenceRailHeight;
  solidMp4Cta: boolean;
  exportingNle: boolean;
  exportingMp4Ratio: number | null;
  canSendClipToOtherProject: boolean;
  copy: StudioVideoCopy["workspace"]["projects"];
  onSelectProject(projectId: string): void;
  onStartNewProject(): void;
  onRenameTitle(nextTitle: string): void;
  onToggleComplete(): void;
  onDeleteProject(): void;
  onSendClipToProject(targetProjectId: string): void;
  onSelectLayoutPreset(preset: "create" | "edit"): void;
  onShareReview(): void;
  onExportNle(): void;
  onExportMp4(): void;
}

export function VideoProjectBar({
  locale,
  canEdit,
  projectId,
  projectTitle,
  projectStatus,
  savingProject,
  projects,
  clipCount,
  renderCredits,
  railHeight,
  solidMp4Cta,
  exportingNle,
  exportingMp4Ratio,
  canSendClipToOtherProject,
  copy,
  onSelectProject,
  onStartNewProject,
  onRenameTitle,
  onToggleComplete,
  onDeleteProject,
  onSendClipToProject,
  onSelectLayoutPreset,
  onShareReview,
  onExportNle,
  onExportMp4,
}: VideoProjectBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [sendMenuOpen, setSendMenuOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(projectTitle);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraftTitle(projectTitle);
  }, [projectTitle]);

  useEffect(() => {
    if (!menuOpen && !sendMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
        setSendMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [menuOpen, sendMenuOpen]);

  const commitTitle = () => {
    setEditingTitle(false);
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== projectTitle) {
      onRenameTitle(trimmed);
    } else {
      setDraftTitle(projectTitle);
    }
  };

  const otherActiveProjects = projects.filter((p) => p.id !== projectId && p.status === "active");
  const isEditPreset = railHeight === "full";

  return (
    <div ref={wrapRef} className={w.projectBar} data-video-project-bar>
      <div className={w.projectBarStart}>
        <div className={w.projectDropdownAnchor}>
          <button
            type="button"
            className={w.projectDropdownBtn}
            aria-expanded={menuOpen}
            onClick={() => {
              setMenuOpen((prev) => !prev);
              setSendMenuOpen(false);
            }}
            data-video-project-switcher
          >
            <span>{copy.myProjects}</span>
            <span className={w.projectCountChip}>{projects.length}</span>
          </button>

          {menuOpen && (
            <div className={w.projectMenu} role="menu" data-video-project-menu>
              <div className={w.projectMenuHead}>
                <span>{copy.myProjects}</span>
                {canEdit && (
                  <button
                    type="button"
                    className={w.projectNewBtn}
                    onClick={() => {
                      setMenuOpen(false);
                      onStartNewProject();
                    }}
                    data-video-project-new
                  >
                    {copy.newProject}
                  </button>
                )}
              </div>

              {projects.length === 0 ? (
                <p className={w.projectEmptyNote}>{copy.emptyList}</p>
              ) : (
                <ul className={w.projectList}>
                  {projects.map((p) => {
                    const active = p.id === projectId;
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          className={w.projectItemBtn}
                          data-active={active ? "" : undefined}
                          onClick={() => {
                            setMenuOpen(false);
                            onSelectProject(p.id);
                          }}
                          data-video-project-option={p.id}
                        >
                          <span className={w.projectItemTitle}>{p.title}</span>
                          <span className={w.projectItemMeta}>
                            {p.status === "completed" ? `${copy.completedBadge} · ` : ""}
                            {interpolate(copy.meta, { clips: p.clipCount, seconds: p.durationSec })}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {canEdit && projectId && (
                <div className={w.projectMenuFoot}>
                  <button
                    type="button"
                    className={w.projectFootBtn}
                    onClick={() => {
                      setMenuOpen(false);
                      onDeleteProject();
                    }}
                    data-video-project-delete
                  >
                    {copy.deleteProject}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {editingTitle && canEdit ? (
          <input
            type="text"
            className={w.projectTitleInput}
            aria-label={copy.renameLabel}
            placeholder={copy.renamePlaceholder}
            value={draftTitle}
            maxLength={120}
            autoFocus
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitTitle();
              } else if (e.key === "Escape") {
                setDraftTitle(projectTitle);
                setEditingTitle(false);
              }
            }}
            data-video-project-title-input
          />
        ) : (
          <button
            type="button"
            className={w.projectTitleBtn}
            disabled={!canEdit}
            onClick={() => canEdit && setEditingTitle(true)}
            title={copy.renameLabel}
            data-video-project-title
          >
            {projectTitle || copy.untitled}
          </button>
        )}

        {projectId && (
          <span className={w.projectSaveState} data-video-project-save-state>
            {projectStatus === "completed"
              ? copy.completedBadge
              : savingProject
                ? copy.savingBadge
                : copy.savedBadge}
          </span>
        )}

        {canEdit && projectId && (
          <button
            type="button"
            className={w.projectStatusBtn}
            onClick={onToggleComplete}
            data-video-project-complete
          >
            {projectStatus === "completed" ? copy.reopenProject : copy.completeProject}
          </button>
        )}

        {canEdit && canSendClipToOtherProject && otherActiveProjects.length > 0 && (
          <div className={w.projectDropdownAnchor}>
            <button
              type="button"
              className={w.projectStatusBtn}
              aria-expanded={sendMenuOpen}
              onClick={() => {
                setSendMenuOpen((prev) => !prev);
                setMenuOpen(false);
              }}
              data-video-send-to-project
            >
              {copy.sendToProject}
            </button>
            {sendMenuOpen && (
              <div className={w.projectMenu} role="menu" data-video-send-menu>
                <div className={w.projectMenuHead}>
                  <span>{copy.sendToProjectPick}</span>
                </div>
                <ul className={w.projectList}>
                  {otherActiveProjects.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className={w.projectItemBtn}
                        onClick={() => {
                          setSendMenuOpen(false);
                          onSendClipToProject(p.id);
                        }}
                        data-video-send-target={p.id}
                      >
                        <span className={w.projectItemTitle}>{p.title}</span>
                        <span className={w.projectItemMeta}>
                          {interpolate(copy.meta, { clips: p.clipCount, seconds: p.durationSec })}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div
        className={w.layoutPresetGroup}
        role="group"
        aria-label={copy.presetsLabel}
        data-video-layout-preset
      >
        <button
          type="button"
          className={w.layoutPresetBtn}
          aria-pressed={!isEditPreset}
          onClick={() => onSelectLayoutPreset("create")}
          data-layout-preset="create"
        >
          {copy.presetCreate}
        </button>
        <button
          type="button"
          className={w.layoutPresetBtn}
          aria-pressed={isEditPreset}
          onClick={() => onSelectLayoutPreset("edit")}
          data-layout-preset="edit"
        >
          {copy.presetEdit}
        </button>
      </div>

      <div className={w.projectBarEnd}>
        <button
          type="button"
          className={w.barActionBtn}
          onClick={onShareReview}
          data-video-share-review
        >
          {copy.shareReview}
        </button>
        <button
          type="button"
          className={w.barActionBtn}
          disabled={clipCount === 0 || exportingNle}
          onClick={onExportNle}
          data-video-export-nle
        >
          {exportingNle ? copy.exportingNle : copy.exportNle}
        </button>
        <button
          type="button"
          className={solidMp4Cta ? w.barPrimaryCta : w.barDarkBtn}
          data-variant={solidMp4Cta ? "solid" : undefined}
          disabled={!canEdit || clipCount === 0 || exportingMp4Ratio !== null}
          onClick={onExportMp4}
          data-video-export-mp4
        >
          {exportingMp4Ratio !== null
            ? interpolate(copy.exportingMp4, { percent: Math.round(exportingMp4Ratio * 100) })
            : clipCount > 0
              ? interpolate(copy.exportMp4WithCredits, { credits: formatCredits(renderCredits, locale) })
              : copy.exportMp4}
        </button>
      </div>
    </div>
  );
}
