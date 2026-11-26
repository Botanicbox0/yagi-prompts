"use client";
import type { StudioCopy } from "../copy";
import type { ShieldedDockDesign } from "./model";
import { PromptPictureView } from "./prompt-picture-view";
import s from "./prompt-pictures.module.css";
import type { PromptPictureLoader } from "./use-prompt-pictures";

export interface DockPromptPicturesProps {
  organizationId: string;
  design: ShieldedDockDesign;
  copy: StudioCopy;
  fetchPicture?: PromptPictureLoader;
}

/**
 * Compact designed-prompt picture panel in the dock after "지금 설계하기" or reuse of a reviewed
 * video run. Keeps the typed prompt untouched in the textarea above.
 */
export function DockPromptPictures({ organizationId, design, copy, fetchPicture }: DockPromptPicturesProps) {
  return (
    <div
      className={s.dockPanel}
      data-studio-designed-panel=""
      data-designed-source={design.kind}
    >
      <p className={s.dockHint} data-studio-designed-hint="">
        {copy.dock.designedHint}
      </p>
      <PromptPictureView
        active
        compact
        organizationId={organizationId}
        kind={design.kind === "token" ? "design" : "run"}
        token={design.kind === "token" ? design.token : undefined}
        jobId={design.kind === "fromJob" ? design.jobId : undefined}
        version={design.kind === "fromJob" ? design.version : undefined}
        pages={design.pages}
        copy={copy}
        fetchPicture={fetchPicture}
      />
    </div>
  );
}
