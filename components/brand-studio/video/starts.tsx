"use client";
/**
 * The three ways to start on the video screen (docs/BRAND-STUDIO-V3.md §6): write it (focus the prompt
 * bar), start from a reference video (open the reverse drawer), or ask the team (jump to the request
 * section). Plain buttons and one in-page link; nothing here talks to the server.
 */
import type { StudioVideoCopy } from "@/messages/studio-video";
import { StudioIcon, type StudioIconName } from "../icons";
import { STUDIO_OPEN_REVERSE, announce } from "../seams";
import { VIDEO_REQUESTS_ANCHOR } from "./anchors";
import s from "./video.module.css";

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Puts the caret in the prompt bar; without one (read-only, allowance closed) it brings the gallery into view. */
export function focusPromptBar(): void {
  const field = document.querySelector<HTMLTextAreaElement>("[data-studio-dock] textarea");
  const behavior: ScrollBehavior = reducedMotion() ? "auto" : "smooth";
  if (field) {
    field.scrollIntoView({ block: "center", behavior });
    field.focus({ preventScroll: true });
    return;
  }
  document.querySelector("[data-studio-video-gallery]")?.scrollIntoView({ block: "start", behavior });
}

export function VideoStarts({ t, requests }: { t: StudioVideoCopy; requests: boolean }) {
  const cards: Array<{ key: string; icon: StudioIconName; title: string; line: string; run?: () => void; href?: string }> = [
    { key: "prompt", icon: "sparkles", ...t.starts.prompt, run: focusPromptBar },
    { key: "reverse", icon: "video", ...t.starts.reverse, run: () => announce(STUDIO_OPEN_REVERSE) },
    ...(requests ? [{ key: "request", icon: "send" as const, ...t.starts.request, href: `#${VIDEO_REQUESTS_ANCHOR}` }] : []),
  ];
  return (
    <nav aria-label={t.starts.label} data-studio-video-starts>
      <ul className={s.starts}>
        {cards.map((card) => {
          const body = (
            <>
              <span className={s.startIcon} aria-hidden="true">
                <StudioIcon name={card.icon} />
              </span>
              <span className={s.startTitle}>{card.title}</span>
              <span className={s.startLine}>{card.line}</span>
            </>
          );
          return (
            <li key={card.key}>
              {card.href ? (
                <a className={s.start} href={card.href} data-studio-video-start={card.key}>
                  {body}
                </a>
              ) : (
                <button type="button" className={s.start} onClick={card.run} data-studio-video-start={card.key}>
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
