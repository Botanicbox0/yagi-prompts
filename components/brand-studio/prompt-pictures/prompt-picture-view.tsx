"use client";
import { useState, type ReactNode, type SyntheticEvent } from "react";
import { fill, type StudioCopy } from "../copy";
import { StudioIcon } from "../icons";
import {
  PROMPT_PICTURE_COMPACT_PLACEHOLDER_HEIGHT,
  PROMPT_PICTURE_FULL_ASPECT,
  PROMPT_PICTURE_PLACEHOLDER_HEIGHT,
  isKnownFullPage,
  pagerState,
} from "./model";
import s from "./prompt-pictures.module.css";
import { usePromptPictures, type PromptPictureLoader, type PromptPictureStatus } from "./use-prompt-pictures";

const blockCopyAction = (event: SyntheticEvent) => {
  event.preventDefault();
};

export interface PromptPictureFrameProps {
  page: number;
  total: number;
  status: PromptPictureStatus;
  url: string | null;
  copy: StudioCopy;
  compact?: boolean;
  onPrev?(): void;
  onNext?(): void;
  onRetry?(): void;
}

/**
 * Framed picture viewer for shielded video prompts: copy/drag/context-menu guards, quiet loading
 * placeholder, error/retry or 429 busy states, and optional single-page prev/next pager.
 */
export function PromptPictureFrame({
  page,
  total,
  status,
  url,
  copy,
  compact = false,
  onPrev,
  onNext,
  onRetry,
}: PromptPictureFrameProps) {
  const v = copy.viewer;
  const pager = pagerState(page, total);
  const fullRatio = !compact && isKnownFullPage(pager.page, pager.total);
  const placeholderStyle = fullRatio
    ? { aspectRatio: PROMPT_PICTURE_FULL_ASPECT }
    : { height: compact ? PROMPT_PICTURE_COMPACT_PLACEHOLDER_HEIGHT : PROMPT_PICTURE_PLACEHOLDER_HEIGHT };

  return (
    <div
      className={s.root}
      data-no-copy=""
      data-prompt-picture=""
      onCopy={blockCopyAction}
      onCut={blockCopyAction}
      onDragStart={blockCopyAction}
      onContextMenu={blockCopyAction}
    >
      <div className={compact ? `${s.frame} ${s.frameCompact}` : s.frame} data-prompt-picture-frame="">
        {status === "ready" && url ? (
          <img
            className={s.image}
            src={url}
            alt={fill(v.pictureAlt, { page: pager.page, total: pager.total })}
            draggable={false}
            data-prompt-picture-img=""
          />
        ) : status === "busy" ? (
          <div className={s.state} role="status" data-prompt-picture-busy="">
            <p className={s.stateText}>{v.pictureBusy}</p>
          </div>
        ) : status === "failed" ? (
          <div className={s.state} role="status" data-prompt-picture-failed="">
            <p className={s.stateText}>{v.pictureFailed}</p>
            <button
              type="button"
              className="bs-btn"
              data-variant="soft"
              data-size="sm"
              data-prompt-picture-retry=""
              onClick={onRetry}
            >
              {v.pictureRetry}
            </button>
          </div>
        ) : (
          <div
            className={s.placeholder}
            aria-busy="true"
            data-prompt-picture-loading=""
            style={placeholderStyle}
          />
        )}
      </div>
      {pager.showPager && (
        <div className={s.pager} data-prompt-picture-pager="">
          <button
            type="button"
            className="bs-btn bs-icon-btn"
            data-variant="ghost"
            data-size="sm"
            aria-label={v.pagerPrev}
            disabled={!pager.canPrev}
            data-prompt-picture-prev=""
            onClick={onPrev}
          >
            <StudioIcon name="prev" />
          </button>
          <span className={s.pagerCount} data-prompt-picture-page="">
            {pager.indicator}
          </span>
          <button
            type="button"
            className="bs-btn bs-icon-btn"
            data-variant="ghost"
            data-size="sm"
            aria-label={v.pagerNext}
            disabled={!pager.canNext}
            data-prompt-picture-next=""
            onClick={onNext}
          >
            <StudioIcon name="next" />
          </button>
        </div>
      )}
    </div>
  );
}

export interface PromptPictureViewProps {
  active: boolean;
  organizationId: string;
  kind: "run" | "design";
  jobId?: string;
  version?: string;
  token?: string;
  pages: number;
  copy: StudioCopy;
  compact?: boolean;
  fetchPicture?: PromptPictureLoader;
}

export function PromptPictureView({
  active,
  organizationId,
  kind,
  jobId,
  version,
  token,
  pages,
  copy,
  compact = false,
  fetchPicture,
}: PromptPictureViewProps) {
  const state = usePromptPictures({
    active,
    organizationId,
    kind,
    jobId,
    version,
    token,
    pages,
    fetchPicture,
  });

  return (
    <PromptPictureFrame
      page={state.page}
      total={state.total}
      status={state.status}
      url={state.url}
      copy={copy}
      compact={compact}
      onPrev={state.goPrev}
      onNext={state.goNext}
      onRetry={state.retry}
    />
  );
}

export interface PromptDetailsProps {
  children(open: boolean): ReactNode;
}

/**
 * Holds the open state for `<details className="bs-prompt-details">` so Viewer keeps its exact
 * pre-existing hook count while loading sent prompt pictures only when expanded.
 */
export function PromptDetails({ children }: PromptDetailsProps) {
  const [open, setOpen] = useState(false);

  return (
    <details
      className="bs-prompt-details"
      data-studio-prompt-details
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      {children(open)}
    </details>
  );
}
