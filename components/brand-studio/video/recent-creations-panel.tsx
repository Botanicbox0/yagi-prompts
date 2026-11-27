"use client";

import { useMemo, useState } from "react";
import type { StudioJobView, StudioOutputView } from "@/lib/brand-studio/contracts";
import type { StudioVideoCopy } from "@/messages/studio-video";
import { startRefDrag } from "../refs";
import w from "./video-workspace.module.css";

export interface RecentCreationsPanelProps {
  allJobs: StudioJobView[];
  canEdit: boolean;
  copy: StudioVideoCopy["workspace"]["drawer"];
  /** Video studio modes (VM-1): makes recent cards draggable onto the dock via `startRefDrag`. */
  draggableRefs?: boolean;
  onAttachOutput(output: StudioOutputView, label: string): void;
  onAddVideoToSequence(output: StudioOutputView, label: string): void;
}

export function RecentCreationsPanel({
  allJobs,
  canEdit,
  copy,
  draggableRefs = false,
  onAttachOutput,
  onAddVideoToSequence,
}: RecentCreationsPanelProps) {
  const [filter, setFilter] = useState<"all" | "image" | "video">("all");
  const [collapsed, setCollapsed] = useState(false);

  const items = useMemo(() => {
    const out: Array<{ output: StudioOutputView; label: string }> = [];
    for (const job of allJobs) {
      for (const output of job.outputs) {
        if (filter !== "all" && output.kind !== filter) continue;
        const label = job.prompt?.trim().slice(0, 48) || output.id.slice(0, 8);
        out.push({ output, label });
        if (out.length >= 24) break;
      }
      if (out.length >= 24) break;
    }
    return out;
  }, [allJobs, filter]);

  return (
    <section
      className={w.recentDrawerPanel}
      aria-label={copy.recentHeading}
      data-video-recent-drawer
      data-collapsed={collapsed ? "" : undefined}
    >
      <div className={w.recentDrawerHead}>
        <span className={w.recentDrawerTitle}>{copy.recentHeading}</span>
        <div className={w.recentFilterRow} role="group" aria-label={copy.recentHeading}>
          {(["all", "image", "video"] as const).map((key) => (
            <button
              key={key}
              type="button"
              className={w.recentFilterPill}
              aria-pressed={filter === key}
              onClick={() => {
                setFilter(key);
                setCollapsed(false);
              }}
              data-recent-filter={key}
            >
              {key === "all" ? copy.filterAll : key === "image" ? copy.filterImages : copy.filterVideos}
            </button>
          ))}
          <button
            type="button"
            className={w.recentCollapseBtn}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((prev) => !prev)}
            title={collapsed ? copy.toggleOpen : copy.toggleClose}
            data-recent-collapse
          >
            {collapsed ? "+" : "−"}
          </button>
        </div>
      </div>

      {!collapsed &&
        (items.length === 0 ? (
          <p className={w.recentEmpty}>{copy.emptyRecent}</p>
        ) : (
          <div className={w.recentGrid} data-recent-creations-grid>
            {items.map(({ output, label }) => (
              <div
                key={output.id}
                className={w.recentCard}
                data-recent-output={output.id}
                {...(draggableRefs && canEdit
                  ? {
                      draggable: true,
                      onDragStart: (event) => startRefDrag(event, { outputId: output.id }),
                    }
                  : {})}
              >
                <div className={w.recentThumb}>
                  {output.thumbUrl ? (
                    <img src={output.thumbUrl} alt={label} loading="lazy" />
                  ) : output.kind === "image" ? (
                    <img src={output.url} alt={label} loading="lazy" />
                  ) : (
                    <video src={output.url} muted playsInline preload="metadata" />
                  )}
                  {output.kind === "video" && output.seconds ? (
                    <span className={w.recentSecondsBadge}>{output.seconds}s</span>
                  ) : null}
                </div>
                <div className={w.recentCardActions}>
                  <button
                    type="button"
                    className={w.recentMiniBtn}
                    disabled={!canEdit}
                    onClick={() => onAttachOutput(output, label)}
                    data-recent-attach={output.id}
                  >
                    {copy.attachBtn}
                  </button>
                  {output.kind === "video" && (
                    <button
                      type="button"
                      className={w.recentMiniBtn}
                      disabled={!canEdit}
                      onClick={() => onAddVideoToSequence(output, label)}
                      data-recent-add-sequence={output.id}
                    >
                      {copy.sequenceBtn}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
    </section>
  );
}
