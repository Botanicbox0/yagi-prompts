"use client";
import { useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/messages/en";

type T = Dictionary["brandWorkspace"]["productionStudio"]["onboarding"];
type Media = { src: string; poster: string; width: number; height: number };

/**
 * Example media supplied by TWINGS for this explanation (docs/reviews/STUDIO-ONBOARDING-20260924.md).
 * The two videos share a format but not their shots or length (about 30 s and 24 s), so they are
 * never played in sync or presented as frame-for-frame copies.
 */
export const STUDIO_DEMO = {
  format: { src: "/reel/studio-demo/designed-format.mp4", poster: "/reel/studio-demo/designed-format.jpg", width: 1280, height: 720 },
  variant: { src: "/reel/studio-demo/different-person.mp4", poster: "/reel/studio-demo/different-person.jpg", width: 1280, height: 720 },
  selfie: { src: "/reel/studio-demo/reference-selfie.jpeg", width: 1206, height: 2075 },
} as const;

/**
 * Idle: the poster image under a real play button. The `<video>` is mounted but hidden and has no
 * `src`, so no MP4 is requested and Chrome draws no loading spinner over a video that has not loaded.
 * On click or keyboard activation the handler sets `src` and calls `play()` in the same user gesture
 * (Safari requires that). Native controls take over from then on. No autoplay attribute, never muted by us.
 */
function DemoVideo({ media, name, t, onPlay }: { media: Media; name: string; t: T; onPlay: (v: HTMLVideoElement) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"idle" | "active" | "error">("idle");
  const moveFocus = useRef(false);
  useEffect(() => {
    // The play button disappears; keep keyboard focus on the video's own controls.
    if (state === "active" && moveFocus.current) { moveFocus.current = false; ref.current?.focus(); }
  }, [state]);

  function start() {
    const v = ref.current;
    if (!v) return;
    if (!v.getAttribute("src")) v.src = media.src;
    else if (state === "error") v.load();
    moveFocus.current = true;
    setState("active");
    // A blocked autoplay policy is not a failure: the native play control is there to press.
    v.play()?.catch((e: unknown) => { if ((e as { name?: string })?.name !== "NotAllowedError" && (e as { name?: string })?.name !== "AbortError") setState("error"); });
  }

  return (
    <div className="bw-studio-demo-player" data-state={state}>
      <video
        ref={ref}
        poster={media.poster}
        width={media.width}
        height={media.height}
        controls
        playsInline
        preload="none"
        aria-label={name}
        hidden={state !== "active"}
        onPlay={(e) => onPlay(e.currentTarget)}
        onError={() => setState("error")}
      >
        {t.videoFallback}
      </video>
      {state !== "active" && (
        <button type="button" className="bw-studio-play" onClick={start} aria-label={(state === "error" ? t.retryVideo : t.playVideo).replace("{name}", name)}>
          <img src={media.poster} width={media.width} height={media.height} alt="" loading="lazy" decoding="async" />
          <span className="bw-studio-play-badge" aria-hidden="true">
            {state === "error" ? t.retry : <><svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" /></svg>{t.play}</>}
          </span>
        </button>
      )}
      {state === "error" && <p role="alert" className="bw-error bw-studio-play-error">{t.videoError}</p>}
    </div>
  );
}

/** Starting one example pauses the other so two soundtracks never overlap. */
export function StudioShowcase({ t }: { t: T }) {
  const root = useRef<HTMLDivElement>(null);
  function onlyThis(current: HTMLVideoElement) {
    root.current?.querySelectorAll("video").forEach((v) => { if (v !== current && !v.paused) v.pause(); });
  }
  return (
    <section className="bw-studio-showcase" aria-labelledby="studio-showcase-title" data-studio-showcase>
      <div className="bw-studio-showcase-intro">
        <h2 id="studio-showcase-title">{t.showcaseTitle}</h2>
        <p>{t.showcaseBody}</p>
      </div>
      <div className="bw-studio-demo" ref={root}>
        <figure className="bw-studio-demo-video" data-studio-demo="format">
          <DemoVideo media={STUDIO_DEMO.format} name={t.formatVideo} t={t} onPlay={onlyThis} />
          <figcaption><strong>{t.formatLabel}</strong><span>{t.formatCaption}</span></figcaption>
        </figure>
        <span className="bw-studio-demo-op" aria-hidden="true">+</span>
        <figure className="bw-studio-demo-selfie" data-studio-demo="selfie">
          <img src={STUDIO_DEMO.selfie.src} width={STUDIO_DEMO.selfie.width} height={STUDIO_DEMO.selfie.height} alt={t.selfieAlt} loading="lazy" decoding="async" />
          <figcaption><strong>{t.selfieLabel}</strong><span>{t.selfieCaption}</span></figcaption>
        </figure>
        <span className="bw-studio-demo-op" aria-hidden="true">=</span>
        <figure className="bw-studio-demo-video" data-studio-demo="variant">
          <DemoVideo media={STUDIO_DEMO.variant} name={t.variantVideo} t={t} onPlay={onlyThis} />
          <figcaption><strong>{t.variantLabel}</strong><span>{t.variantCaption}</span></figcaption>
        </figure>
      </div>
      <p className="bw-muted bw-studio-showcase-note">{t.showcaseNote}</p>
    </section>
  );
}
