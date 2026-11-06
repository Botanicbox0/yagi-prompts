"use client";

import { useRef, useState } from "react";
import { isSandboxedClientOrganization } from "@/lib/brands/features";
import { BRAND_CORE_DELIVERABLE_TRACKS } from "@/lib/brands/production/reference-studio";
import { scopedHref } from "@/lib/brands/workspace/selection";

export interface B2BSoundMasterClip {
  id: string;
  badgeKo: string;
  badgeEn: string;
  titleKo: string;
  titleEn: string;
  videoUrl: string;
  posterUrl: string;
}

/**
 * 100% In-House YAGI Studio Virtual Model & Editorial 1080p Sound-On Masters (Zero Client Campaign Footage).
 */
export const B2B_SOUND_MASTER_CLIPS: readonly B2BSoundMasterClip[] = [
  {
    id: "house-runway",
    badgeKo: "런웨이 포맷",
    badgeEn: "Runway Format",
    titleKo: "인하우스 패션 런웨이",
    titleEn: "In-House Runway Master",
    videoUrl: "/reel/brands/house-runway-1080p.mp4",
    posterUrl: "/reel/brands/house-runway-1080p.jpg",
  },
  {
    id: "studio-editorial-blue",
    badgeKo: "룩북 포맷",
    badgeEn: "Lookbook Format",
    titleKo: "프렌치 블루 릴스",
    titleEn: "French Blue Reels",
    videoUrl: "/reel/brands/studio-editorial-blue-1080p.mp4",
    posterUrl: "/reel/brands/studio-editorial-blue-1080p.jpg",
  },
  {
    id: "house-french-blue-hero",
    badgeKo: "제품 히어로",
    badgeEn: "Product Hero",
    titleKo: "프렌치 블루 오브제",
    titleEn: "French Blue Object",
    videoUrl: "/reel/brands/house-french-blue-hero-1080p.mp4",
    posterUrl: "/reel/brands/house-french-blue-hero-1080p.jpg",
  },
  {
    id: "studio-rain-editorial",
    badgeKo: "브랜드 필름",
    badgeEn: "Brand Film",
    titleKo: "레인 에디토리얼",
    titleEn: "Rain Editorial",
    videoUrl: "/reel/brands/studio-rain-editorial-1080p.mp4",
    posterUrl: "/reel/brands/studio-rain-editorial-1080p.jpg",
  },
] as const;

export function CampaignMoatShowcase({
  locale,
  organizationId,
  studioOpen,
  canRequest = true,
  membersOpen = false,
}: {
  locale: "ko" | "en";
  organizationId?: string | null;
  studioOpen: boolean;
  canRequest?: boolean;
  membersOpen?: boolean;
  settingsOpen?: boolean;
}) {
  const isKo = locale === "ko";
  const choice = organizationId ? { id: organizationId } : null;
  const [activeSoundId, setActiveSoundId] = useState<string | null>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  // Hardline: Sandboxed clients (e.g. Morphic) or studio-closed organizations NEVER see the B2B showcase or self-serve studio entry points.
  if (!studioOpen || isSandboxedClientOrganization({ id: organizationId })) {
    return null;
  }

  function toggleSound(clipId: string) {
    const nextId = activeSoundId === clipId ? null : clipId;
    setActiveSoundId(nextId);
    for (const [id, el] of Object.entries(videoRefs.current)) {
      if (!el) continue;
      if (id === nextId) {
        el.muted = false;
        el.currentTime = 0;
        void el.play().catch(() => {});
      } else {
        el.muted = true;
      }
    }
  }

  const studioHref = scopedHref("/brand/studio", choice);
  const studioSep = studioHref.includes("?") ? "&" : "?";

  return (
    <section
      className="bw-showcase-panel"
      data-campaign-moat-showcase
      data-brand-tab-map
      aria-label={isKo ? "스튜디오 레퍼런스 및 제작 방식" : "Studio reference and production modes"}
      style={{
        padding: "20px 22px",
        gap: "16px",
        borderRadius: "16px",
        background: "#FFFFFF",
        border: "1px solid #E4E6EC",
        boxShadow: "0 4px 20px rgba(15, 23, 42, 0.03)",
        marginBottom: "16px",
      }}
    >
      {/* 1. MAGNIFIC + PLAYBOOK OPEN WHITE LAUNCHPAD STAGE (100% Zoom Spatial Breathing Room) */}
      <div
        style={{
          borderRadius: "14px",
          backgroundColor: "#FFFFFF",
          backgroundImage:
            "radial-gradient(rgba(15, 23, 42, 0.055) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          border: "1px solid #E4E6EC",
          padding: "22px 20px 18px",
          display: "grid",
          gap: "16px",
        }}
      >
        {/* Top Utility & Status Row (Playbook / Magnific Header Strip) */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
          }}
        >
          <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span
              data-moat-pipeline
              style={{
                padding: "3px 9px",
                borderRadius: "999px",
                background: "rgba(56, 117, 197, 0.09)",
                color: "#3063A7",
                fontSize: "10.5px",
                fontWeight: 700,
                letterSpacing: "0.01em",
              }}
            >
              {isKo
                ? "WHITE DUAL CANVAS · 올인원 브랜드 미디어 스튜디오"
                : "WHITE DUAL CANVAS · All-in-One Brand Media Studio"}
            </span>
            <span style={{ fontSize: "11.5px", color: "#6B6F7B" }}>
              {isKo
                ? "좌측 이미지 캔버스 ⇄ 우측 영상 캔버스 1클릭 브릿지 · 1080p 인스타 무열화 마스터"
                : "Left Image Canvas ⇄ Right Video Canvas 1-Click Bridge · 1080p IG De-AI Master"}
            </span>
          </div>

          <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
            {membersOpen && (
              <a
                href={`${scopedHref("/brand/members", choice)}#invite-composer`}
                data-home-invite-cta
                style={{
                  height: "28px",
                  padding: "0 10px",
                  borderRadius: "999px",
                  border: "1px solid #E4E6EC",
                  background: "#FFFFFF",
                  color: "#111114",
                  fontSize: "11.5px",
                  fontWeight: 600,
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                }}
              >
                <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M10 4v12M4 10h12" />
                </svg>
                <span>{isKo ? "팀원 초대 (Invite)" : "Invite Team"}</span>
              </a>
            )}
            <a
              href={scopedHref("/brand/identity", choice)}
              data-home-onboarding-cta
              data-tab-guide-card="identity"
              style={{
                height: "28px",
                padding: "0 10px",
                borderRadius: "999px",
                border: "1px solid #E4E6EC",
                background: "#F8F9FB",
                color: "#383B44",
                fontSize: "11.5px",
                fontWeight: 600,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              {isKo ? "브랜드 킷 고정" : "Brand Kit"}
            </a>
            <a
              href={studioHref}
              data-home-studio-cta
              data-tab-guide-card="studio"
              style={{
                height: "28px",
                padding: "0 12px",
                borderRadius: "999px",
                background: "#111114",
                color: "#FFFFFF",
                fontSize: "11.5px",
                fontWeight: 650,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
              }}
            >
              <span>+ {isKo ? "새 스튜디오 작업" : "New Studio Space"}</span>
            </a>
          </div>
        </div>

        {/* Centered Greeting + Search/Command Bar + 7 Compact Icon Tiles (Magnific Proportions) */}
        <div
          style={{
            display: "grid",
            justifyItems: "center",
            textAlign: "center",
            gap: "12px",
            padding: "6px 0 4px",
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: "18px",
              fontWeight: 650,
              letterSpacing: "-0.025em",
              color: "#0E1013",
            }}
          >
            {isKo
              ? "무엇을 만들까요? 화이트 듀얼 캔버스에서 바로 시작하세요"
              : "Start creating on your White Dual Canvas"}
          </h2>

          {/* Centered Command / Quick-Jump Bar */}
          <a
            href={studioHref}
            style={{
              width: "min(560px, 100%)",
              height: "36px",
              padding: "0 12px",
              borderRadius: "999px",
              background: "#F6F7F9",
              border: "1px solid #E4E6EC",
              color: "#6B6F7B",
              fontSize: "12px",
              textDecoration: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
              boxShadow: "inset 0 1px 2px rgba(15, 23, 42, 0.03)",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" />
                <line x1="20" y1="20" x2="16.5" y2="16.5" />
              </svg>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {isKo
                  ? "화보 생성, Seedance 2.5 모션, 1080p 인스타 마스터링 또는 워크플로 바로 이동..."
                  : "Ask Studio or jump to Dual Canvas, 5 Image Models, Seedance 2.5, 1080p IG..."}
              </span>
            </span>
            <span
              style={{
                padding: "2px 7px",
                borderRadius: "6px",
                background: "#FFFFFF",
                border: "1px solid #E4E6EC",
                color: "#383B44",
                fontSize: "10px",
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              Studio →
            </span>
          </a>

          {/* Magnific-Style Compact 42x42 Icon Tile Dock */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "center",
              gap: "16px",
              paddingTop: "4px",
            }}
          >
            {(
              [
                {
                  id: "dual",
                  href: studioHref,
                  labelKo: "듀얼 캔버스",
                  labelEn: "Dual Canvas",
                  tint: "rgba(56, 117, 197, 0.1)",
                  color: "#3063A7",
                  svg: (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <rect x="3" y="4" width="8" height="16" rx="2" />
                      <rect x="13" y="4" width="8" height="16" rx="2" />
                    </svg>
                  ),
                },
                {
                  id: "image",
                  href: `${studioHref}${studioSep}track=image`,
                  labelKo: "이미지 5모델",
                  labelEn: "Image",
                  tint: "rgba(37, 99, 235, 0.09)",
                  color: "#1D4ED8",
                  svg: (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <rect x="3" y="3" width="18" height="18" rx="3" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="M21 15l-5-5L5 21" />
                    </svg>
                  ),
                },
                {
                  id: "video",
                  href: `${studioHref}${studioSep}track=video`,
                  labelKo: "Seedance 영상",
                  labelEn: "Video",
                  tint: "rgba(16, 185, 129, 0.1)",
                  color: "#047857",
                  svg: (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <rect x="2" y="5" width="14" height="14" rx="2" />
                      <path d="M16 10l6-3v10l-6-3z" />
                    </svg>
                  ),
                },
                {
                  id: "upscale",
                  href: `${studioHref}${studioSep}track=video`,
                  labelKo: "1080p 마스터",
                  labelEn: "1080p IG",
                  tint: "rgba(124, 58, 237, 0.09)",
                  color: "#6D28D9",
                  svg: (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                    </svg>
                  ),
                },
                {
                  id: "format",
                  href: `${studioHref}${studioSep}track=creator_format`,
                  labelKo: "캠페인 포맷",
                  labelEn: "Formats",
                  tint: "rgba(234, 88, 12, 0.09)",
                  color: "#C2410C",
                  svg: (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <rect x="6" y="3" width="12" height="18" rx="2" />
                      <line x1="10" y1="17" x2="14" y2="17" />
                    </svg>
                  ),
                },
                {
                  id: "seeding",
                  href: `${studioHref}${studioSep}track=creator_distribution`,
                  labelKo: "시딩 패키지",
                  labelEn: "Seeding",
                  tint: "rgba(14, 165, 233, 0.1)",
                  color: "#0369A1",
                  svg: (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <circle cx="9" cy="7" r="3" />
                      <path d="M3 19v-1a6 6 0 0 1 12 0v1" />
                      <circle cx="17" cy="9" r="2.5" />
                      <path d="M15 19v-1a4.5 4.5 0 0 1 6 0v1" />
                    </svg>
                  ),
                },
                {
                  id: "audio",
                  href: `${studioHref}${studioSep}track=audio`,
                  labelKo: "오디오 · BGM",
                  labelEn: "Audio",
                  tint: "rgba(15, 23, 42, 0.06)",
                  color: "#111114",
                  svg: (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M11 5L6 9H2v6h4l5 4V5z" />
                      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                    </svg>
                  ),
                },
              ] as const
            ).map((tile) => (
              <a
                key={tile.id}
                href={tile.href}
                style={{
                  textDecoration: "none",
                  color: "#111114",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "5px",
                  minWidth: "62px",
                }}
              >
                <span
                  style={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "11px",
                    background: tile.tint,
                    color: tile.color,
                    border: "1px solid rgba(15, 23, 42, 0.07)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {tile.svg}
                </span>
                <span style={{ fontSize: "11px", fontWeight: 600, color: "#383B44" }}>
                  {isKo ? tile.labelKo : tile.labelEn}
                </span>
              </a>
            ))}
          </div>
        </div>

        {/* Magnific / Playbook Bottom 2-Column Split: [Left: Quick Workflow Shortcuts] + [Right: Create a Space / Dual White Canvas Preview] */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(220px, 0.85fr) minmax(0, 1.45fr)",
            gap: "12px",
            alignItems: "stretch",
          }}
        >
          {/* Left Card: Quick Projects & Brand Setup */}
          <div
            style={{
              padding: "12px 14px",
              borderRadius: "12px",
              background: "#F8F9FB",
              border: "1px solid #E4E6EC",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              gap: "8px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <strong style={{ fontSize: "12px", color: "#111114" }}>
                {isKo ? "빠른 워크플로 시작" : "Quick Workflows"}
              </strong>
              <span style={{ fontSize: "10.5px", color: "#6B6F7B" }}>3 Steps</span>
            </div>
            <div style={{ display: "grid", gap: "5px" }}>
              <a
                href={scopedHref("/brand/identity", choice)}
                style={{
                  padding: "6px 9px",
                  borderRadius: "8px",
                  background: "#FFFFFF",
                  border: "1px solid #E4E6EC",
                  color: "#111114",
                  fontSize: "11.5px",
                  fontWeight: 600,
                  textDecoration: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span>{isKo ? "1. 브랜드 킷 · 색감 고정" : "1. Brand Kit Lock"}</span>
                <span style={{ fontSize: "10.5px", color: "#3063A7" }}>Setup →</span>
              </a>
              <a
                href={studioHref}
                style={{
                  padding: "6px 9px",
                  borderRadius: "8px",
                  background: "#FFFFFF",
                  border: "1px solid #E4E6EC",
                  color: "#111114",
                  fontSize: "11.5px",
                  fontWeight: 600,
                  textDecoration: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span>{isKo ? "2. 화이트 듀얼 캔버스 (이미지⇄영상)" : "2. White Dual Canvas"}</span>
                <span style={{ fontSize: "10.5px", color: "#3063A7" }}>Open →</span>
              </a>
              <a
                href={scopedHref("/brand/library", choice)}
                style={{
                  padding: "6px 9px",
                  borderRadius: "8px",
                  background: "#FFFFFF",
                  border: "1px solid #E4E6EC",
                  color: "#111114",
                  fontSize: "11.5px",
                  fontWeight: 600,
                  textDecoration: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span>{isKo ? "3. 1080p 마스터 · 보관함" : "3. 1080p Library"}</span>
                <span style={{ fontSize: "10.5px", color: "#6B6F7B" }}>Vault →</span>
              </a>
            </div>
          </div>

          {/* Right Card: Create a Space (Magnific-style White Infinite Canvas Card) */}
          <a
            href={studioHref}
            style={{
              padding: "14px 16px",
              borderRadius: "12px",
              background: "#F8F9FB",
              border: "1px solid #E4E6EC",
              textDecoration: "none",
              color: "#111114",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
            }}
          >
            <div style={{ display: "grid", gap: "4px", maxWidth: "360px" }}>
              <span
                style={{
                  fontSize: "10.5px",
                  fontWeight: 700,
                  color: "#3063A7",
                }}
              >
                {isKo ? "VIDEO-CREATOR DUAL STAGE" : "VIDEO-CREATOR DUAL STAGE"}
              </span>
              <strong style={{ fontSize: "13.5px", color: "#111114" }}>
                {isKo
                  ? "상단 디렉팅 바 + 하단 좌(이미지) ⇄ 우(영상) 화이트 캔버스"
                  : "Top Directing Bar + Left Image ⇄ Right Video White Canvas"}
              </strong>
              <span style={{ fontSize: "11.5px", color: "#6B6F7B", lineHeight: 1.4 }}>
                {isKo
                  ? "좌측에서 생성한 화보를 클릭 한 번에 우측 Seedance 2.5 시작 프레임과 1080p 인스타 마스터로 연결합니다."
                  : "Bridge generated lookbook cuts from the left image canvas directly to Seedance 2.5 and 1080p IG mastering on the right."}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <img
                  src="/reel/brands/slot-1-subject-editorial.jpg"
                  alt=""
                  style={{
                    width: "44px",
                    height: "54px",
                    borderRadius: "7px",
                    objectFit: "cover",
                    border: "1px solid #E4E6EC",
                  }}
                />
                <span style={{ fontSize: "12px", color: "#3063A7", fontWeight: 700 }}>→</span>
                <img
                  src="/reel/brands/house-runway-1080p.jpg"
                  alt=""
                  style={{
                    width: "54px",
                    height: "54px",
                    borderRadius: "7px",
                    objectFit: "cover",
                    border: "1.5px solid #3875C5",
                  }}
                />
              </div>
              <span
                style={{
                  padding: "6px 12px",
                  borderRadius: "999px",
                  background: "#3875C5",
                  color: "#FFFFFF",
                  fontSize: "11.5px",
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                }}
              >
                {isKo ? "캔버스 열기 +" : "Open Canvas +"}
              </span>
            </div>
          </a>
        </div>
      </div>

      {/* 2. PLAYBOOK-STYLE COMPACT HORIZONTAL MEDIA PRODUCTION PIPELINE & 1080P MASTERS */}
      <div style={{ display: "grid", gap: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
          <strong style={{ fontSize: "12.5px", color: "#111114" }}>
            {isKo ? "하우스 1080p 사운드 마스터 레퍼런스 (Playbook 보드 뷰)" : "In-House 1080p Sound Masters"}
          </strong>
          <span style={{ fontSize: "11px", color: "#6B6F7B" }}>
            {isKo ? "16:10 컴팩트 프리뷰 · 사운드 켜기 지원" : "Compact Board Preview · Sound On"}
          </span>
        </div>

        <div
          className="bw-showcase-reel"
          data-b2b-sound-master-reel
          style={{ gap: "10px" }}
        >
          {B2B_SOUND_MASTER_CLIPS.map((clip) => {
            const soundOn = activeSoundId === clip.id;
            return (
              <figure
                key={clip.id}
                className="bw-showcase-card"
                data-b2b-master-card={clip.id}
                data-sound-active={soundOn ? "true" : undefined}
                style={{ padding: "5px 5px 8px", gap: "6px" }}
              >
                <div
                  className="bw-showcase-media"
                  style={{ aspectRatio: "16 / 10", maxHeight: "148px" }}
                >
                  <video
                    ref={(el) => {
                      videoRefs.current[clip.id] = el;
                    }}
                    src={clip.videoUrl}
                    poster={clip.posterUrl}
                    muted={!soundOn}
                    autoPlay
                    loop
                    playsInline
                    preload="metadata"
                  />
                  <button
                    type="button"
                    className="bw-showcase-sound"
                    data-reel-sound-toggle={clip.id}
                    aria-pressed={soundOn}
                    onClick={() => toggleSound(clip.id)}
                    style={{ minHeight: "26px", padding: "3px 8px", fontSize: "10.5px" }}
                  >
                    {soundOn ? (
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M11 5L6 9H2v6h4l5 4V5z" />
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M11 5L6 9H2v6h4l5 4V5z" />
                        <line x1="23" y1="9" x2="17" y2="15" />
                        <line x1="17" y1="9" x2="23" y2="15" />
                      </svg>
                    )}
                    <span>
                      {soundOn
                        ? isKo
                          ? "소리 켜짐"
                          : "Sound On"
                        : isKo
                          ? "소리"
                          : "Sound"}
                    </span>
                  </button>
                </div>
                <figcaption className="bw-showcase-caption">
                  <strong style={{ fontSize: "11.5px" }}>{isKo ? clip.titleKo : clip.titleEn}</strong>
                  <span style={{ fontSize: "10px" }}>{isKo ? clip.badgeKo : clip.badgeEn} · 1080p</span>
                </figcaption>
              </figure>
            );
          })}
        </div>
      </div>

      {/* 3. COMPACT 5-DELIVERABLE TRACK CARDS (Playbook Mini-Board Strip) */}
      <div
        data-brand-five-deliverables
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))",
          gap: "8px",
        }}
      >
        {BRAND_CORE_DELIVERABLE_TRACKS.map((track) => {
          const studioBaseHref = scopedHref("/brand/studio", choice);
          const sep = studioBaseHref.includes("?") ? "&" : "?";
          const targetHref = `${studioBaseHref}${sep}track=${track.id}`;
          return (
            <a
              key={track.id}
              href={targetHref}
              data-five-deliverable-card={track.id}
              data-deliverable-card-studio-link={track.id}
              style={{
                textDecoration: "none",
                color: "inherit",
                padding: "8px 10px",
                borderRadius: "11px",
                background: "#F8F9FB",
                border: "1px solid #E4E6EC",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: "76px",
                  borderRadius: "7px",
                  overflow: "hidden",
                  background: "#111317",
                  position: "relative",
                }}
              >
                <img
                  src={track.previewImage}
                  alt={isKo ? track.shortLabelKo : track.shortLabelEn}
                  loading="lazy"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    objectPosition: "50% 22%",
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                    left: "6px",
                    top: "6px",
                    padding: "2px 6px",
                    borderRadius: "999px",
                    background: "rgba(15, 17, 21, 0.82)",
                    color: "#FFFFFF",
                    fontSize: "10px",
                    fontWeight: 700,
                  }}
                >
                  {isKo ? track.shortLabelKo : track.shortLabelEn}
                </span>
              </div>

              <div style={{ display: "grid", gap: "2px" }}>
                <strong style={{ fontSize: "12px", color: "var(--ys-ink)" }}>
                  {isKo ? track.badgeKo : track.badgeEn}
                </strong>
                <p
                  className="bw-muted"
                  style={{
                    margin: 0,
                    fontSize: "10.5px",
                    lineHeight: 1.35,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {isKo ? track.summaryKo : track.summaryEn}
                </p>
              </div>

              <div
                style={{
                  marginTop: "auto",
                  paddingTop: "4px",
                  borderTop: "1px solid var(--ys-hairline)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: "10.5px",
                  fontWeight: 700,
                  color: "var(--ys-brand-text)",
                }}
              >
                <span>{isKo ? track.priceGuideKo : track.priceGuideEn}</span>
                <span>→</span>
              </div>
            </a>
          );
        })}
      </div>

      {/* Collapsible Step-by-Step Guide & Quick Links (Keeps main screen 100% visual & uncluttered) */}
      <details style={{ marginTop: "8px" }}>
        <summary
          style={{
            cursor: "pointer",
            fontSize: "12px",
            fontWeight: 600,
            color: "var(--ys-ink-secondary)",
            padding: "6px 2px",
          }}
        >
          {isKo
            ? "1~3단계 작업 순서 및 전담팀 제작 의뢰 바로가기 펼치기"
            : "Show 3-Step Guide & Commission Shortcuts"}
        </summary>

        <div className="bw-showcase-actions" style={{ marginTop: "8px", marginBottom: "8px" }}>
          <a
            href={scopedHref("/brand/identity", choice)}
            className="bw-button"
            data-home-onboarding-cta
            data-tab-guide-card="identity"
          >
            {isKo ? "브랜드 킷 설정" : "Brand Kit"}
          </a>
        </div>

        <div
          data-brand-quick-dock
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "8px",
            marginTop: "10px",
            marginBottom: "12px",
          }}
        >
          {(
            [
              {
                id: "brand_kit",
                href: scopedHref("/brand/identity", choice),
                labelKo: "홈페이지 주소로 로고·컬러·서체 자동 불러오기",
                labelEn: "Brand Kit · Auto-Extract Logo, Colors & Type",
              },
              {
                id: "style_pin",
                href: scopedHref("/brand/studio", choice),
                labelKo: "브랜드 색감·질감 항상 똑같이 고정",
                labelEn: "Style Pin · Lock Color & Texture Reference",
              },
              {
                id: "image_gen",
                href: scopedHref("/brand/studio", choice),
                labelKo: "1~4번 참고 사진으로 화보·상품컷 생성",
                labelEn: "Image · 1–4 Multi-Reference Generation",
              },
              {
                id: "micro_edit",
                href: scopedHref("/brand/studio", choice),
                labelKo: "원하는 부위만 드래그해서 감쪽같이 수정",
                labelEn: "Edit · Smart Mask Micro-Region Editing",
              },
              {
                id: "video_master",
                href: scopedHref("/brand/studio", choice),
                labelKo: "1080p 고화질 사운드 영상 제작",
                labelEn: "Video · 1080p Sound Master Film",
              },
              {
                id: "assets",
                href: scopedHref("/brand/library", choice),
                labelKo: "제작한 콘텐츠 보관함",
                labelEn: "Assets · Content Library",
              },
            ] as const
          ).map((item) => (
            <a
              key={item.id}
              href={item.href}
              className="bw-quick-chip"
              data-quick-dock-item={item.id}
              style={{ textDecoration: "none" }}
            >
              {isKo ? item.labelKo : item.labelEn}
            </a>
          ))}
        </div>

        <div className="bw-launcher-grid" data-brand-studio-launcher>
          <a
            href={scopedHref("/brand/identity", choice)}
            className="bw-launcher-card"
            data-studio-launcher-step="identity"
          >
            <div>
              <span
                className="bw-chip"
                style={{
                  background: "var(--ys-brand-tint)",
                  color: "var(--ys-brand-text)",
                  fontWeight: 700,
                  marginBottom: "6px",
                }}
              >
                {isKo ? "1단계 · 브랜드 킷 고정" : "STEP 01 · Brand Kit"}
              </span>
              <strong style={{ display: "block", fontSize: "13.5px", marginTop: "4px" }}>
                {isKo ? "로고 · 색감 · 질감 기준 등록" : "Lock Brand Color & Texture"}
              </strong>
            </div>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--ys-brand-text)" }}>
              {isKo ? "설정하기 →" : "Configure →"}
            </span>
          </a>

          <a
            href={scopedHref("/brand/studio", choice)}
            className="bw-launcher-card"
            data-studio-launcher-step="image"
          >
            <div>
              <span
                className="bw-chip"
                style={{
                  background: "var(--ys-brand-tint)",
                  color: "var(--ys-brand-text)",
                  fontWeight: 700,
                  marginBottom: "6px",
                }}
              >
                {isKo ? "2단계 · 캔버스 화보 & 수정" : "STEP 02 · Image Canvas"}
              </span>
              <strong style={{ display: "block", fontSize: "13.5px", marginTop: "4px" }}>
                {isKo ? "에셋을 펼쳐놓고 화보 생성 · 부분 수정" : "Spread Assets & Edit Regions"}
              </strong>
            </div>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--ys-brand-text)" }}>
              {isKo ? "캔버스 열기 →" : "Open Canvas →"}
            </span>
          </a>

          <a
            href={scopedHref("/brand/studio", choice)}
            className="bw-launcher-card"
            data-studio-launcher-step="video"
          >
            <div>
              <span
                className="bw-chip"
                style={{
                  background: "var(--ys-brand-tint)",
                  color: "var(--ys-brand-text)",
                  fontWeight: 700,
                  marginBottom: "6px",
                }}
              >
                {isKo ? "3단계 · 영상 & 업스케일" : "STEP 03 · Video & Upscale"}
              </span>
              <strong style={{ display: "block", fontSize: "13.5px", marginTop: "4px" }}>
                {isKo ? "화보를 연결해 720p · 1080p 영상 완성" : "Connect Still to 1080p Video"}
              </strong>
            </div>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--ys-brand-text)" }}>
              {isKo ? "영상 만들기 →" : "Create Video →"}
            </span>
          </a>
        </div>

        {canRequest && (
          <div className="bw-showcase-tracks" data-commission-quick-launch style={{ marginTop: "12px" }}>
            <a
              href={scopedHref("/brand/studio", choice)}
              className="bw-showcase-track"
              data-quick-track="self_studio"
            >
              <span className="bw-showcase-track-num" aria-hidden="true">01</span>
              <strong>{isKo ? "셀프 스튜디오" : "Self Studio"}</strong>
              <span>
                {isKo
                  ? "장착된 템플릿으로 화보·영상을 직접 생성합니다"
                  : "Generate brand stills and videos directly"}
              </span>
            </a>

            <a
              href={`${scopedHref("/brand/projects/new", choice)}${choice ? "&" : "?"}track=template_build`}
              className="bw-showcase-track"
              data-quick-track="template_build"
            >
              <span className="bw-showcase-track-num" aria-hidden="true">02</span>
              <strong>
                {isKo ? "전용 템플릿 제작 의뢰" : "Custom Template Build"}
              </strong>
              <span>
                {isKo
                  ? "시사 승인 후 셀프 스튜디오에 즉시 장착됩니다"
                  : "Review sample cut and mount to Self Studio"}
              </span>
            </a>

            <a
              href={`${scopedHref("/brand/projects/new", choice)}${choice ? "&" : "?"}track=creator_campaign`}
              className="bw-showcase-track"
              data-quick-track="creator_campaign"
            >
              <span className="bw-showcase-track-num" aria-hidden="true">03</span>
              <strong>
                {isKo ? "인플루언서 시딩 캠페인" : "Creator Seeding Campaign"}
              </strong>
              <span>
                {isKo
                  ? "포맷 설계부터 크리에이터 섭외·동시 게시까지 진행합니다"
                  : "Format design, creator casting, and live ROI"}
              </span>
            </a>

            <a
              href={`${scopedHref("/brand/projects/new", choice)}${choice ? "&" : "?"}track=studio_film`}
              className="bw-showcase-track"
              data-quick-track="studio_film"
            >
              <span className="bw-showcase-track-num" aria-hidden="true">04</span>
              <strong>
                {isKo ? "마스터 영상 제작 의뢰" : "Master Film Production"}
              </strong>
              <span>
                {isKo
                  ? "인플루언서 없이 1080p 완제품 필름을 납품합니다"
                  : "1080p commercial film delivery without seeding"}
              </span>
            </a>
          </div>
        )}
      </details>
    </section>
  );
}
