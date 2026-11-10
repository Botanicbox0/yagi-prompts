/**
 * "제작 의뢰" on the video screen (docs/BRAND-STUDIO-V3.md §6): the three commission tracks, each with
 * what the brand gives, what the studio makes and what comes back, linking into the existing request
 * wizard (`/brand/projects/new?track=…`). The tracks and their order come from
 * lib/brands/workspace/commission-tracks.ts, so a track hidden there (`template_build` for a brand whose
 * policy closes generation) is hidden here too. Server component.
 */
import { getAvailableCommissionTracks, type CommissionTrackId } from "@/lib/brands/workspace/commission-tracks";
import { scopedHref, type BrandWorkspaceChoice } from "@/lib/brands/workspace/selection";
import type { StudioVideoCopy } from "@/messages/studio-video";
import { StudioIcon } from "../icons";
import { VIDEO_REQUESTS_ANCHOR } from "./anchors";
import s from "./video.module.css";

export function requestHref(track: CommissionTrackId, choice: Pick<BrandWorkspaceChoice, "id">): string {
  return scopedHref(`/brand/projects/new?track=${track}`, choice);
}

export function VideoRequests({
  t,
  choice,
  locale,
  generativeClosed = false,
}: {
  t: StudioVideoCopy;
  choice: Pick<BrandWorkspaceChoice, "id">;
  locale: "ko" | "en";
  generativeClosed?: boolean;
}) {
  const q = t.requests;
  const tracks = getAvailableCommissionTracks({ generativeClosed, locale });
  return (
    <section id={VIDEO_REQUESTS_ANCHOR} className={s.requests} aria-labelledby={`${VIDEO_REQUESTS_ANCHOR}-title`} tabIndex={-1} data-studio-video-requests>
      <div className={s.requestsHead}>
        <h2 id={`${VIDEO_REQUESTS_ANCHOR}-title`}>{q.title}</h2>
        <p>{q.line}</p>
      </div>
      <ul className={s.requestGrid}>
        {tracks.map((track) => {
          const words = q.tracks[track.id];
          return (
            <li key={track.id}>
              <article className={s.request} data-studio-video-request={track.id}>
                <h3>{words.title}</h3>
                <p>{words.line}</p>
                <dl className={s.requestFacts}>
                  <div>
                    <dt>{q.gives}</dt>
                    <dd>{words.gives}</dd>
                  </div>
                  <div>
                    <dt>{q.makes}</dt>
                    <dd>{words.makes}</dd>
                  </div>
                  <div>
                    <dt>{q.returns}</dt>
                    <dd>{words.returns}</dd>
                  </div>
                </dl>
                <a className={`bs-btn ${s.requestAction}`} data-variant="soft" data-size="sm" href={requestHref(track.id, choice)} aria-label={`${q.open}: ${words.title}`}>
                  {q.open}
                  <StudioIcon name="arrow" />
                </a>
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
