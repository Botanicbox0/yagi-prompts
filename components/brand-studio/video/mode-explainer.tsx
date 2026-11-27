"use client";
/**
 * First-use visual explainer for Re-Architect and Motion Transfer (slice VM-1).
 * Studio-local component (self-contained; uses studio CSS tokens and allow-listed brand stills only).
 */
import { STUDIO_SHOT_LIMITS } from "@/lib/brand-studio/contracts";
import { DEFAULT_VIDEO_MODEL, STUDIO_MODELS, type StudioVideoModel } from "@/lib/brand-studio/models";
import type { StudioVideoModesCopy } from "@/messages/studio-video-modes";
import { fill } from "../copy";
import { formatVideoModeTipLines, type PendingVideoMode } from "./video-modes-model";
import s from "./mode-explainer.module.css";

const STILL_REF = "/reel/brands/city-fashion.jpg";
const STILL_ALT_A = "/reel/brands/tea-editorial.jpg";
const STILL_ALT_B = "/reel/brands/production-paris.jpg";
const DEFAULT_MODEL = STUDIO_MODELS.find((m) => m.id === DEFAULT_VIDEO_MODEL) as StudioVideoModel;

function ArrowGlyph() {
  return (
    <span className={s.arrow} aria-hidden="true">
      <svg viewBox="0 0 16 16">
        <path d="M3 8h10M9.5 4.5 13 8l-3.5 3.5" />
      </svg>
    </span>
  );
}

function Sprockets() {
  return (
    <span className={s.sprockets} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

function FigureOutline({ shift = 0 }: { shift?: number }) {
  return (
    <svg
      viewBox="0 0 40 50"
      className={s.figureSvg}
      aria-hidden="true"
      style={shift ? { transform: `translateX(${shift}px)` } : undefined}
    >
      <circle cx="20" cy="11" r="4.5" />
      <path d="M12 24c2.5-3.5 5.5-5 8-5s5.5 1.5 8 5" />
      <path d="M20 19v13M20 32l-6 12M20 32l6 12" />
      <path d="M7 39c6-5 20-5 26 0" strokeDasharray="3 3" />
    </svg>
  );
}

function DrawnGlyph({ kind }: { kind: "product" | "cast" | "place" }) {
  if (kind === "product") {
    return (
      <svg viewBox="0 0 28 28" className={s.drawnIcon} aria-hidden="true">
        <rect x="10" y="4" width="8" height="3.5" rx="1" />
        <path d="M9 10.5c0-1.5 1-2.5 2.5-2.5h5c1.5 0 2.5 1 2.5 2.5V22a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2V10.5z" />
        <path d="M11.5 15h5" />
      </svg>
    );
  }
  if (kind === "cast") {
    return (
      <svg viewBox="0 0 28 28" className={s.drawnIcon} aria-hidden="true">
        <circle cx="14" cy="9.5" r="4" />
        <path d="M6.5 23c.8-4.2 3.8-6.5 7.5-6.5s6.7 2.3 7.5 6.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 28 28" className={s.drawnIcon} aria-hidden="true">
      <path d="M4.5 22.5h19" />
      <path d="M7.5 22.5v-9.5a6.5 6.5 0 0 1 13 0v9.5" />
      <circle cx="14" cy="11.5" r="2" />
    </svg>
  );
}

function ReArchitectPicture({ copy }: { copy: StudioVideoModesCopy["explainer"]["reArchitect"] }) {
  // Before strip: three distinct allowed stills. After strip (Round 3 item 2): three drawn tiles in accent tone (no photos).
  const refFrames = [STILL_REF, STILL_ALT_A, STILL_ALT_B] as const;
  const drawnTiles: ReadonlyArray<{ id: "1" | "2" | "3"; kind: "product" | "cast" | "place"; label: string }> = [
    { id: "1", kind: "product", label: copy.mine1 },
    { id: "2", kind: "cast", label: copy.mine2 },
    { id: "3", kind: "place", label: copy.mine3 },
  ];
  return (
    <div className={s.steps} data-video-mode-picture="re_architect">
      <div className={s.stepCard}>
        <div className={s.filmStrip} aria-hidden="true" data-rearchitect-strip="before">
          <Sprockets />
          <div className={s.frames}>
            {refFrames.map((src, i) => (
              <span key={i} className={s.frame}>
                <img src={src} alt="" loading="lazy" decoding="async" />
              </span>
            ))}
          </div>
          <Sprockets />
        </div>
        <p className={s.stepLabel}>{copy.step1}</p>
      </div>
      <ArrowGlyph />
      <div className={s.stepCard}>
        <div className={s.shotTable} aria-hidden="true">
          <div className={s.shotRow}>
            <span className={s.shotMeta}>{copy.shot1}</span>
            <span className={`${s.shotBar} ${s.shotBarAccent}`} />
          </div>
          <div className={s.shotRow}>
            <span className={s.shotMeta}>{copy.shot2}</span>
            <span className={`${s.shotBar} ${s.shotBarMid}`} />
          </div>
          <div className={s.shotRow}>
            <span className={s.shotMeta}>{copy.shot3}</span>
            <span className={`${s.shotBar} ${s.shotBarWide}`} />
          </div>
        </div>
        <p className={s.stepLabel}>{copy.step2}</p>
      </div>
      <ArrowGlyph />
      <div className={s.stepCard}>
        <div className={s.filmStrip} aria-hidden="true" data-rearchitect-strip="after">
          <Sprockets />
          <div className={s.frames}>
            {drawnTiles.map((tile) => (
              <span key={tile.id} className={`${s.frame} ${s.drawnTile}`} data-rearchitect-drawn-tile={tile.id}>
                <DrawnGlyph kind={tile.kind} />
                <span className={s.drawnLabel}>{tile.label}</span>
              </span>
            ))}
          </div>
          <Sprockets />
        </div>
        <p className={s.stepLabel}>{copy.step3}</p>
      </div>
    </div>
  );
}

function MotionTransferPicture({ copy }: { copy: StudioVideoModesCopy["explainer"]["motionTransfer"] }) {
  // Round 3 item 2: before = one still x3 with moving outline; after = a clearly different allowed still x3 with the SAME outlines.
  return (
    <div className={s.steps} data-video-mode-picture="motion_transfer">
      <div className={s.stepCard}>
        <div className={s.filmStrip} aria-hidden="true" data-motion-strip="before">
          <Sprockets />
          <div className={s.frames}>
            {[-2, 0, 2].map((shift, i) => (
              <span key={i} className={s.frame}>
                <img src={STILL_REF} alt="" loading="lazy" decoding="async" />
                <span className={s.motionOverlay}>
                  <FigureOutline shift={shift} />
                </span>
              </span>
            ))}
          </div>
          <Sprockets />
        </div>
        <p className={s.stepLabel}>{copy.step1}</p>
      </div>
      <ArrowGlyph />
      <div className={s.stepCard}>
        <div className={s.carryStage} aria-hidden="true">
          <div className={s.carryMotion}>
            <FigureOutline />
            <span className={s.carryTag}>{copy.motionTag}</span>
          </div>
          <div className={`${s.carryTile} ${s.motionSubject}`}>
            <img src={STILL_ALT_A} alt="" loading="lazy" decoding="async" />
          </div>
        </div>
        <p className={s.stepLabel}>{copy.step2}</p>
      </div>
      <ArrowGlyph />
      <div className={s.stepCard}>
        <div className={s.filmStrip} aria-hidden="true" data-motion-strip="after">
          <Sprockets />
          <div className={s.frames}>
            {[-2, 0, 2].map((shift, i) => (
              <span key={i} className={`${s.frame} ${s.motionSubject}`}>
                <img src={STILL_ALT_A} alt="" loading="lazy" decoding="async" />
                <span className={s.motionOverlay}>
                  <FigureOutline shift={shift} />
                </span>
              </span>
            ))}
          </div>
          <Sprockets />
        </div>
        <p className={s.stepLabel}>{copy.step3}</p>
      </div>
    </div>
  );
}

export interface VideoModeExplainerProps {
  mode: PendingVideoMode;
  copy: StudioVideoModesCopy;
  model?: Pick<StudioVideoModel, "maxReferenceImages" | "minSeconds" | "maxSeconds" | "referenceVideoSeconds">;
  shotLimits?: { secondsMax: number };
  maxClips?: number;
  /** Keep hidden before client hydration to avoid SSR/CSR flash. */
  hidden?: boolean;
  onDismiss(): void;
}

export function VideoModeExplainer({
  mode,
  copy,
  model = DEFAULT_MODEL,
  shotLimits = STUDIO_SHOT_LIMITS,
  maxClips,
  hidden = false,
  onDismiss,
}: VideoModeExplainerProps) {
  const modeName = mode === "re_architect" ? copy.modes.reArchitect : copy.modes.motionTransfer;
  const oneLiner = mode === "re_architect" ? copy.oneLiners.reArchitect : copy.oneLiners.motionTransfer;
  const lines = formatVideoModeTipLines({
    mode,
    model,
    shotLimits,
    maxClips,
    copy: copy.tip,
  });

  return (
    <section
      className={s.root}
      aria-label={fill(copy.explainer.label, { mode: modeName })}
      data-video-mode-explainer={mode}
      hidden={hidden}
    >
      <div className={s.head}>
        <div className={s.titleGroup}>
          <h3 className={s.title}>{modeName}</h3>
          <p className={s.oneLiner}>{oneLiner}</p>
        </div>
        <button
          type="button"
          className="bs-btn"
          data-variant="soft"
          data-size="sm"
          onClick={onDismiss}
          data-video-mode-explainer-dismiss
        >
          {copy.status.gotIt}
        </button>
      </div>

      {mode === "re_architect" ? (
        <ReArchitectPicture copy={copy.explainer.reArchitect} />
      ) : (
        <MotionTransferPicture copy={copy.explainer.motionTransfer} />
      )}

      <ul className={s.lines}>
        <li>
          <span className={s.lineLabel}>{copy.tip.giveLabel}</span>
          <span className={s.lineText}>{lines.give}</span>
        </li>
        <li>
          <span className={s.lineLabel}>{copy.tip.keepLabel}</span>
          <span className={s.lineText}>{lines.keep}</span>
        </li>
        <li>
          <span className={s.lineLabel}>{copy.tip.getLabel}</span>
          <span className={s.lineText}>{lines.get}</span>
        </li>
      </ul>

      {mode === "motion_transfer" && (
        <ul className={s.honestNotes} data-video-mode-honest-notes>
          <li>{copy.tip.motionHonestNotes.faceColor}</li>
          <li>{copy.tip.motionHonestNotes.extraCredits}</li>
        </ul>
      )}
    </section>
  );
}
