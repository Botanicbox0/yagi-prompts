"use client";

import { clipPlayDuration, type ComposeClip } from "@/lib/brand-studio/compose/timeline";
import type { StudioVideoCopy } from "@/messages/studio-video";
import w from "./video-workspace.module.css";

export interface FloatingClipBarProps {
  clip: ComposeClip;
  clipIndex: number;
  canEdit: boolean;
  detectingCuts?: boolean;
  extendingScene?: boolean;
  copy: StudioVideoCopy["workspace"]["floatingBar"];
  onTrim(): void;
  onDetectCuts(): void;
  onColorGrade(): void;
  onAttachAsReference(): void;
  onExtendScene?: () => void;
  /** Absent while music generation is closed (`BRAND_STUDIO_MUSIC_GENERATION`): the button is not shown. */
  onGenerateMusic?: () => void;
  onUpscale(): void;
  onDelete(): void;
}

export function FloatingClipBar({
  clip,
  clipIndex,
  canEdit,
  detectingCuts = false,
  extendingScene = false,
  copy,
  onTrim,
  onDetectCuts,
  onColorGrade,
  onAttachAsReference,
  onExtendScene,
  onGenerateMusic,
  onUpscale,
  onDelete,
}: FloatingClipBarProps) {
  const playSec = clipPlayDuration(clip);
  const takeCount = clip.takes?.length ?? 1;
  const activeTake = (clip.activeTakeIndex ?? 0) + 1;

  return (
    <div
      className={w.floatingBar}
      role="toolbar"
      aria-label={copy.label}
      data-sequence-floating-bar
      data-selected-clip-id={clip.id}
    >
      <span className={w.floatingClipMeta}>
        <span className={w.floatingClipIndex}>#{clipIndex + 1}</span>
        <span className={w.floatingClipName} title={clip.label}>
          {clip.label}
        </span>
        <span className={w.floatingClipDuration}>{playSec}s</span>
        {takeCount > 1 && (
          <span className={w.floatingTakeTag}>
            {activeTake}/{takeCount}
          </span>
        )}
      </span>

      <div className={w.floatingActions}>
        <button
          type="button"
          className={w.floatingBtn}
          disabled={!canEdit}
          onClick={onTrim}
          data-floating-action="trim"
        >
          {copy.trim}
        </button>
        <button
          type="button"
          className={w.floatingBtn}
          disabled={!canEdit || detectingCuts}
          onClick={onDetectCuts}
          data-floating-action="detect-cuts"
        >
          {detectingCuts ? copy.detectingCuts : copy.detectCuts}
        </button>
        <button
          type="button"
          className={w.floatingBtn}
          disabled={!canEdit}
          onClick={onColorGrade}
          data-floating-action="color-grade"
        >
          {copy.colorGrade}
        </button>
        <button
          type="button"
          className={w.floatingBtn}
          disabled={!canEdit}
          onClick={onAttachAsReference}
          data-floating-action="attach-ref"
        >
          {copy.attachRef}
        </button>
        {onExtendScene && (
          <button
            type="button"
            className={w.floatingBtn}
            disabled={!canEdit || extendingScene}
            onClick={onExtendScene}
            data-floating-action="extend-scene"
          >
            {extendingScene ? copy.extendingScene : copy.extendScene}
          </button>
        )}
        {onGenerateMusic && (
          <button
            type="button"
            className={w.floatingBtn}
            disabled={!canEdit}
            onClick={onGenerateMusic}
            data-floating-action="generate-music"
          >
            {copy.generateMusic}
          </button>
        )}
        <button
          type="button"
          className={w.floatingBtn}
          disabled={!canEdit}
          onClick={onUpscale}
          data-floating-action="upscale"
        >
          {copy.upscale}
        </button>
        <button
          type="button"
          className={w.floatingDeleteBtn}
          disabled={!canEdit}
          onClick={onDelete}
          data-floating-action="delete"
        >
          {copy.deleteClip}
        </button>
      </div>
    </div>
  );
}
