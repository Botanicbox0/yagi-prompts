"use client";
/**
 * Deliverable-centric `파일` tab of a project room (`docs/BRAND-PROJECTS-E.md` §1-2):
 * groups every project deliverable into 4 smart categories (`기획서` · `스토리보드` · `시안` · `최종본`)
 * with an `전체` overview so clients find briefs, storyboards, drafts with frame-pinned notes, and
 * approved finals in one place.
 */
import { useState } from "react";
import { StoryboardTab } from "@/components/brand-rooms/storyboard";
import { ProjectReviewTab } from "@/components/brand-rooms/review";
import { IntakeBriefSummary } from "@/components/brand-workspace/intake-brief-summary";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { RoomBriefFile, RoomProject } from "@/lib/brand-rooms/overview";
import type { RoomLocale } from "../seams";

export type RoomFilesCategory = "all" | "brief" | "storyboard" | "drafts" | "finals";

const CATEGORIES: readonly RoomFilesCategory[] = ["all", "brief", "storyboard", "drafts", "finals"];

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export interface ProjectFilesTabProps {
  organizationId: string;
  project: RoomProject;
  briefFiles: RoomBriefFile[];
  locale: RoomLocale;
  filesCopy: Dictionary["roomsShell"]["files"];
  intakeCopy: Dictionary["intakeBrief"];
  storyboardCopy: Dictionary["roomsStoryboard"];
  reviewCopy: Dictionary["roomsReview"];
  studioReviewCopy: Dictionary["studioReview"];
  chatCopy: Dictionary["roomsChat"];
  canEdit: boolean;
  canTalk: boolean;
  initialCategory?: RoomFilesCategory;
  initialStoryboard?: { boardId?: string; frameId?: string };
  initialReview?: { reviewId?: string; atMs?: number; commentId?: string };
}

export function ProjectFilesTab({
  organizationId,
  project,
  briefFiles,
  locale,
  filesCopy,
  intakeCopy,
  storyboardCopy,
  reviewCopy,
  studioReviewCopy,
  chatCopy,
  canEdit,
  canTalk,
  initialCategory = "all",
  initialStoryboard,
  initialReview,
}: ProjectFilesTabProps) {
  const [category, setCategory] = useState<RoomFilesCategory>(initialCategory);
  const showBrief = category === "all" || category === "brief";
  const showStoryboard = category === "all" || category === "storyboard";
  const showDrafts = category === "all" || category === "drafts";
  const showFinals = category === "finals";

  return (
    <div className="brr-files" data-room-files data-room-files-category={category}>
      <nav
        className="brr-files-filter"
        aria-label={filesCopy.filterLabel}
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          marginBottom: 20,
          padding: 4,
          borderRadius: 999,
          background: "var(--ys-raised, rgba(15, 23, 42, 0.04))",
          width: "fit-content",
        }}
      >
        {CATEGORIES.map((cat) => {
          const active = category === cat;
          return (
            <button
              key={cat}
              type="button"
              data-room-files-pill={cat}
              aria-pressed={active}
              onClick={() => setCategory(cat)}
              style={{
                border: 0,
                borderRadius: 999,
                padding: "7px 14px",
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                cursor: "pointer",
                background: active ? "var(--ys-active-bg, #ededed)" : "transparent",
                color: active ? "var(--ys-active-fg, #09090b)" : "var(--ys-ink-secondary)",
                boxShadow: active ? "0 1px 2px rgba(15, 23, 42, 0.08)" : "none",
              }}
            >
              {filesCopy.categories[cat]}
            </button>
          );
        })}
      </nav>

      {showBrief ? (
        <section className="brr-card" data-room-files-brief style={{ marginBottom: 20, padding: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px" }}>{filesCopy.briefHeading}</h2>
          {project.intakeBrief ? (
            <IntakeBriefSummary brief={project.intakeBrief} copy={intakeCopy} />
          ) : project.objective ? (
            <p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap", color: "var(--ys-ink, #111827)" }}>
              {project.objective}
            </p>
          ) : null}

          <div style={{ marginTop: 14 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--ys-muted, #4B5563)", margin: "0 0 8px" }}>{filesCopy.briefAttachments}</h3>
            {briefFiles.length > 0 ? (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
                {briefFiles.map((file) => (
                  <li key={file.id}>
                    <a
                      href={`/api/brand-workspace/attachments/${encodeURIComponent(file.id)}`}
                      data-room-brief-file={file.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "10px 14px",
                        borderRadius: 10,
                        border: "1px solid var(--ys-line, rgba(15, 23, 42, 0.08))",
                        textDecoration: "none",
                        color: "var(--ys-ink, #111827)",
                        fontSize: 14,
                      }}
                    >
                      <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
                      <span style={{ fontSize: 12, color: "var(--ys-muted, #6B7280)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                        {formatSize(file.sizeBytes)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="brr-empty" style={{ margin: 0 }}>
                {filesCopy.briefEmpty}
              </p>
            )}
          </div>
        </section>
      ) : null}

      {showStoryboard ? (
        <section data-room-files-storyboard style={{ marginBottom: 20 }}>
          <StoryboardTab
            organizationId={organizationId}
            projectId={project.id}
            locale={locale}
            copy={storyboardCopy}
            chatCopy={chatCopy}
            shareCopy={reviewCopy}
            canEdit={canEdit}
            canTalk={canTalk}
            initial={initialStoryboard}
          />
        </section>
      ) : null}

      {showDrafts ? (
        <section data-room-files-drafts>
          <ProjectReviewTab
            key="drafts"
            organizationId={organizationId}
            projectId={project.id}
            locale={locale}
            copy={reviewCopy}
            reviewCopy={studioReviewCopy}
            chatCopy={chatCopy}
            canEdit={canEdit}
            canTalk={canTalk}
            initial={initialReview}
          />
        </section>
      ) : null}

      {showFinals ? (
        <section data-room-files-finals>
          <ProjectReviewTab
            key="finals"
            organizationId={organizationId}
            projectId={project.id}
            locale={locale}
            copy={reviewCopy}
            reviewCopy={studioReviewCopy}
            chatCopy={chatCopy}
            canEdit={canEdit}
            canTalk={canTalk}
            filterStatus="approved"
            finalsEmptyText={filesCopy.finalsEmpty}
          />
        </section>
      ) : null}
    </div>
  );
}
