"use client";
/**
 * "캠페인으로 이어지는 길" (docs/BRAND-STUDIO-V3.md §6): five steps from a finished video to a campaign
 * on twings.app, ending in the existing "캠페인으로 보내기" (`handoff.campaign` with `asFormat`). The
 * action picks one of the brand's videos (loaded only when pressed) and opens the same dialog the
 * result viewer uses, with "use it as the format" on by default for a video.
 */
import { useId, useMemo, useState } from "react";
import type { StudioOutputView, StudioState } from "@/lib/brand-studio/contracts";
import type { StudioVideoCopy } from "@/messages/studio-video";
import { createStudioApi, isFailure, type StudioApi } from "../api";
import { errorLine, type StudioCopy } from "../copy";
import { HandoffDialog, handoffInput } from "../handoff-dialog";
import { useModal } from "../modal";
import { StudioIcon } from "../icons";
import s from "./video.module.css";

export interface CampaignPathProps {
  organizationId: string;
  copy: StudioCopy;
  video: StudioVideoCopy;
  locale: "ko" | "en";
  /** Owners and editors; viewers and the TWINGS team see the steps without the action. */
  canSend: boolean;
  api?: StudioApi;
}

/** Video results newest first, finished ones before drafts. */
export function sendableVideos(state: Pick<StudioState, "jobs">): StudioOutputView[] {
  const all = state.jobs.flatMap((job) => (job.status === "succeeded" ? job.outputs.filter((o) => o.kind === "video") : []));
  return all.sort((a, b) => Number(a.draft) - Number(b.draft) || b.createdAt.localeCompare(a.createdAt));
}

export function CampaignPath({ organizationId, copy, video: t, locale, canSend, api: injected }: CampaignPathProps) {
  const api = useMemo(() => injected ?? createStudioApi({ organizationId }), [injected, organizationId]);
  const p = t.path;
  const id = useId();
  const [picking, setPicking] = useState(false);
  const [state, setState] = useState<StudioState | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [target, setTarget] = useState<StudioOutputView | null>(null);

  async function begin() {
    setFailed(null);
    setPicking(true);
    const result = await api.loadState();
    if (isFailure(result)) return setFailed(errorLine(copy, result.code));
    setState(result);
  }

  return (
    <section className={s.band} aria-labelledby={`${id}-title`} data-studio-video-path>
      <div className={s.bandHead}>
        <div>
          <h2 id={`${id}-title`}>{p.title}</h2>
          <p>{p.line}</p>
        </div>
        {canSend && (
          <button type="button" className="bs-btn" data-variant="soft" data-size="md" onClick={() => void begin()} data-studio-video-path-send>
            <StudioIcon name="send" />
            {p.action}
          </button>
        )}
      </div>
      <ol className={s.steps}>
        {p.steps.map((step, i) => (
          <li key={step.title} className={s.step} data-studio-video-path-step={i + 1}>
            <span className={s.stepNo} aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className={s.stepTitle}>{step.title}</span>
            <span className={s.stepLine}>{step.line}</span>
          </li>
        ))}
      </ol>
      {picking && !target && (
        <VideoPick
          t={t}
          locale={locale}
          state={state}
          failed={failed}
          onPick={(output) => setTarget(output)}
          onClose={() => {
            setPicking(false);
            setState(null);
          }}
        />
      )}
      {target && state && (
        <HandoffDialog
          campaigns={state.campaigns}
          copy={copy}
          kind="video"
          onSend={(choice, requestId, asFormat) =>
            api.call("handoff.campaign", handoffInput({ outputId: target.id }, choice, { organizationId, requestId }, asFormat))
          }
          onDone={(href) => window.location.assign(href)}
          onClose={() => {
            setTarget(null);
            setPicking(false);
          }}
        />
      )}
    </section>
  );
}

function VideoPick({
  t,
  locale,
  state,
  failed,
  onPick,
  onClose,
}: {
  t: StudioVideoCopy;
  locale: "ko" | "en";
  state: StudioState | null;
  failed: string | null;
  onPick(output: StudioOutputView): void;
  onClose(): void;
}) {
  const ref = useModal();
  const id = useId();
  const p = t.path;
  const videos = state ? sendableVideos(state) : [];
  const when = new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" });
  return (
    <dialog
      ref={ref}
      className={`bs-dialog ${s.pickDialog}`}
      aria-labelledby={`${id}-title`}
      data-studio-video-path-pick
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="bs-dialog-body">
        <h2 id={`${id}-title`}>{p.pickTitle}</h2>
        {failed ? (
          <p role="alert">{failed}</p>
        ) : !state ? (
          <p role="status">{p.pickLoading}</p>
        ) : videos.length === 0 ? (
          <p>{p.pickEmpty}</p>
        ) : (
          <ul className={s.pickList}>
            {videos.map((output) => (
              <li key={output.id}>
                <button
                  type="button"
                  className={s.pickTile}
                  aria-label={[output.draft ? p.draft : "", when.format(new Date(output.createdAt))].filter(Boolean).join(" · ")}
                  onClick={() => onPick(output)}
                  data-studio-video-path-output={output.id}
                >
                  {output.thumbUrl ? <img src={output.thumbUrl} alt="" loading="lazy" /> : <video src={`${output.url}#t=0.1`} muted playsInline preload="metadata" aria-hidden="true" />}
                  {output.draft && (
                    <span className={s.tileBadge} aria-hidden="true">
                      {p.draft}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="bs-row bs-dialog-actions">
          <span className="bs-spacer" />
          <button type="button" className="bs-btn" data-variant="ghost" data-size="md" onClick={onClose}>
            {p.close}
          </button>
        </div>
      </div>
    </dialog>
  );
}
