"use client";

import { useRef, useState } from "react";
import { isSandboxedClientOrganization } from "@/lib/brands/features";
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
    badgeKo: "포맷 시딩 · 런웨이",
    badgeEn: "Format Seeding · Runway",
    titleKo: "인하우스 패션 런웨이 1080p",
    titleEn: "In-House Runway Master 1080p",
    videoUrl: "/reel/brands/house-runway-1080p.mp4",
    posterUrl: "/reel/brands/house-runway-1080p.jpg",
  },
  {
    id: "studio-editorial-blue",
    badgeKo: "포맷 시딩 · 룩북",
    badgeEn: "Format Seeding · Lookbook",
    titleKo: "프렌치 블루 릴스 1080p",
    titleEn: "French Blue Reels 1080p",
    videoUrl: "/reel/brands/studio-editorial-blue-1080p.mp4",
    posterUrl: "/reel/brands/studio-editorial-blue-1080p.jpg",
  },
  {
    id: "house-french-blue-hero",
    badgeKo: "스튜디오 · 히어로",
    badgeEn: "Studio · Hero",
    titleKo: "프렌치 블루 오브제 1080p",
    titleEn: "French Blue Hero 1080p",
    videoUrl: "/reel/brands/house-french-blue-hero-1080p.mp4",
    posterUrl: "/reel/brands/house-french-blue-hero-1080p.jpg",
  },
  {
    id: "studio-rain-editorial",
    badgeKo: "스튜디오 · 브랜드 필름",
    badgeEn: "Studio · Brand Film",
    titleKo: "레인 에디토리얼 1080p",
    titleEn: "Rain Editorial 1080p",
    videoUrl: "/reel/brands/studio-rain-editorial-1080p.mp4",
    posterUrl: "/reel/brands/studio-rain-editorial-1080p.jpg",
  },
] as const;

export function CampaignMoatShowcase({
  locale,
  organizationId,
  studioOpen,
  canRequest = true,
  membersOpen = true,
  settingsOpen = true,
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

  const tabs = [
    {
      key: "campaigns",
      href: scopedHref("/brand", choice),
      label: isKo ? "위탁 캠페인 · 인플루언서 시딩" : "Managed Campaigns · Creator Seeding",
      active: true,
      shown: true,
    },
    {
      key: "studio",
      href: scopedHref("/brand/studio", choice),
      label: isKo ? "제작 스튜디오 · 화보·영상 제작" : "Self-Serve Studio · Direct Creation",
      active: false,
      shown: studioOpen,
    },
    {
      key: "identity",
      href: scopedHref("/brand/identity", choice),
      label: isKo ? "브랜드 · 로고·미감 등록" : "Brand · Logos & Aesthetics",
      active: false,
      shown: studioOpen,
    },
    {
      key: "library",
      href: scopedHref("/brand/library", choice),
      label: isKo ? "콘텐츠 보관함" : "Content Library",
      active: false,
      shown: true,
    },
    {
      key: "governance",
      href: scopedHref("/brand/settings", choice),
      label: isKo ? "설정 · 팀" : "Settings & Team",
      active: false,
      shown: settingsOpen || membersOpen,
    },
  ].filter((t) => t.shown);

  return (
    <div style={{ display: "grid", gap: "14px", marginBottom: "24px" }}>
      {/* 1. Calm 1-Line Quick Orientation Bar */}
      <nav
        aria-label={isKo ? "워크스페이스 빠른 이동" : "Workspace quick navigation"}
        data-brand-tab-map
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "8px",
        }}
      >
        {tabs.map((tab) => (
          <a
            key={tab.key}
            href={tab.href}
            data-tab-guide-card={tab.key}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "7px 14px",
              borderRadius: "999px",
              background: tab.active ? "#3875C5" : "#FFFFFF",
              color: tab.active ? "#FFFFFF" : "#41444D",
              border: tab.active ? "1px solid #3875C5" : "1px solid rgba(0, 0, 0, 0.09)",
              fontSize: "13px",
              fontWeight: tab.active ? 600 : 500,
              textDecoration: "none",
            }}
          >
            {tab.label}
          </a>
        ))}
      </nav>

      {/* 2. Quiet Media-First 1080p In-House Master Strip */}
      <section
        className="bw-panel"
        data-campaign-moat-showcase
        style={{
          padding: "20px",
          borderRadius: "24px",
          background: "#FFFFFF",
          border: "1px solid rgba(0, 0, 0, 0.08)",
          boxShadow: "var(--ys-card)",
          marginBottom: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            marginBottom: "14px",
          }}
        >
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: 600, letterSpacing: "-0.03em", margin: "0 0 4px", color: "#0E1013" }}>
              {isKo
                ? "1080p 사운드 마스터 포맷 설계부터 인플루언서 동시 시딩까지 한곳에서 진행합니다"
                : "Design 1080p sound-on master formats and scale creator seeding in one workspace"}
            </h2>
            <p
              data-moat-pipeline
              style={{
                margin: 0,
                fontSize: "13px",
                color: "#676B75",
              }}
            >
              {isKo
                ? "① 브랜드 로고·미감 등록 → ② 1080p 화보·영상 스튜디오 제작 → ③ 인플루언서 대거 시딩 & 성과 집계"
                : "① Register Brand DNA → ② Produce 1080p Studio Assets → ③ Creator Seeding & Live ROI"}
            </p>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            <a
              href={scopedHref("/brand/identity", choice)}
              data-home-onboarding-cta
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "8px 14px",
                borderRadius: "999px",
                background: "#F6F7F9",
                border: "1px solid rgba(0, 0, 0, 0.1)",
                color: "#0E1013",
                fontSize: "13px",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              {isKo ? "1단계: 브랜드 등록 →" : "Step 1: Brand Setup →"}
            </a>
            <a
              href={scopedHref("/brand/studio", choice)}
              data-home-studio-cta
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "8px 16px",
                borderRadius: "999px",
                background: "#3875C5",
                color: "#FFFFFF",
                fontSize: "13px",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              {isKo ? "2단계: 스튜디오 열기 →" : "Step 2: Open Studio →"}
            </a>
          </div>
        </div>

        {/* 4-Up 1080p In-House Video Strip */}
        <div
          data-b2b-sound-master-reel
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "12px",
          }}
        >
          {B2B_SOUND_MASTER_CLIPS.map((clip) => {
            const soundOn = activeSoundId === clip.id;
            return (
              <article
                key={clip.id}
                data-b2b-master-card={clip.id}
                style={{
                  position: "relative",
                  borderRadius: "18px",
                  overflow: "hidden",
                  aspectRatio: "9 / 16",
                  background: "#111114",
                  border: soundOn ? "2px solid #3875C5" : "1px solid rgba(0, 0, 0, 0.08)",
                }}
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
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
                <span
                  style={{
                    position: "absolute",
                    top: "10px",
                    left: "10px",
                    padding: "4px 10px",
                    borderRadius: "999px",
                    background: "rgba(17, 17, 20, 0.68)",
                    backdropFilter: "blur(8px)",
                    color: "#FFFFFF",
                    fontSize: "11px",
                    fontWeight: 600,
                  }}
                >
                  {isKo ? clip.badgeKo : clip.badgeEn}
                </span>
                <div
                  style={{
                    position: "absolute",
                    left: "10px",
                    right: "10px",
                    bottom: "10px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "6px",
                  }}
                >
                  <span
                    style={{
                      padding: "4px 9px",
                      borderRadius: "999px",
                      background: "rgba(17, 17, 20, 0.65)",
                      color: "#FFFFFF",
                      fontSize: "11px",
                      fontWeight: 600,
                    }}
                  >
                    {isKo ? clip.titleKo : clip.titleEn}
                  </span>
                  <button
                    type="button"
                    data-reel-sound-toggle={clip.id}
                    aria-pressed={soundOn}
                    onClick={() => toggleSound(clip.id)}
                    style={{
                      padding: "5px 10px",
                      borderRadius: "999px",
                      border: "1px solid rgba(255,255,255,0.28)",
                      background: soundOn ? "#3875C5" : "rgba(17, 17, 20, 0.76)",
                      color: "#FFFFFF",
                      fontSize: "11px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {soundOn ? (isKo ? "🔊 켜짐" : "🔊 On") : isKo ? "🔇 소리" : "🔇 Sound"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        {/* 3. 1 Self Studio + 3 Commission Tracks Quick Launch Strip (only for owners/editors who can request) */}
        {canRequest && (
        <div
          data-commission-quick-launch
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: "10px",
            marginTop: "14px",
            paddingTop: "14px",
            borderTop: "1px solid rgba(0, 0, 0, 0.06)",
          }}
        >
          <a
            href={scopedHref("/brand/studio", choice)}
            data-quick-track="self_studio"
            style={{
              display: "grid",
              gap: "3px",
              padding: "11px 14px",
              borderRadius: "14px",
              background: "#F6F7F9",
              border: "1px solid rgba(0, 0, 0, 0.08)",
              textDecoration: "none",
              color: "#0E1013",
            }}
          >
            <strong style={{ fontSize: "13px", fontWeight: 600 }}>
              {isKo ? "⚡ 셀프 스튜디오 (자체 생성)" : "⚡ Self Studio (Direct AI)"}
            </strong>
            <span style={{ fontSize: "12px", color: "#676B75" }}>
              {isKo ? "장착된 템플릿으로 화보·영상 직접 생성" : "Generate assets & videos directly"}
            </span>
          </a>

          <a
            href={`${scopedHref("/brand/projects/new", choice)}${choice ? "&" : "?"}track=template_build`}
            data-quick-track="template_build"
            style={{
              display: "grid",
              gap: "3px",
              padding: "11px 14px",
              borderRadius: "14px",
              background: "#F6F7F9",
              border: "1px solid rgba(0, 0, 0, 0.08)",
              textDecoration: "none",
              color: "#0E1013",
            }}
          >
            <strong style={{ fontSize: "13px", fontWeight: 600 }}>
              {isKo ? "① 전용 템플릿 생성만 의뢰" : "① Custom Template Build Only"}
            </strong>
            <span style={{ fontSize: "12px", color: "#676B75" }}>
              {isKo ? "YAGI 제작 → 시사 승인 후 스튜디오 장착" : "Review sample -> mounts to Self Studio"}
            </span>
          </a>

          <a
            href={`${scopedHref("/brand/projects/new", choice)}${choice ? "&" : "?"}track=creator_campaign`}
            data-quick-track="creator_campaign"
            style={{
              display: "grid",
              gap: "3px",
              padding: "11px 14px",
              borderRadius: "14px",
              background: "rgba(56, 117, 197, 0.08)",
              border: "1px solid rgba(56, 117, 197, 0.24)",
              textDecoration: "none",
              color: "#0E1013",
            }}
          >
            <strong style={{ fontSize: "13px", fontWeight: 600, color: "#3063A7" }}>
              {isKo ? "② 템플릿 + 인플루언서 발행 의뢰" : "② Template + Creator Seeding"}
            </strong>
            <span style={{ fontSize: "12px", color: "#676B75" }}>
              {isKo ? "포맷 설계 + 인플루언서 섭외·릴스 동시 게시" : "Format lock + creator wave & live ROI"}
            </span>
          </a>

          <a
            href={`${scopedHref("/brand/projects/new", choice)}${choice ? "&" : "?"}track=studio_film`}
            data-quick-track="studio_film"
            style={{
              display: "grid",
              gap: "3px",
              padding: "11px 14px",
              borderRadius: "14px",
              background: "#F6F7F9",
              border: "1px solid rgba(0, 0, 0, 0.08)",
              textDecoration: "none",
              color: "#0E1013",
            }}
          >
            <strong style={{ fontSize: "13px", fontWeight: 600 }}>
              {isKo ? "③ 마스터 영상 제작만 의뢰" : "③ Master Video Production Only"}
            </strong>
            <span style={{ fontSize: "12px", color: "#676B75" }}>
              {isKo ? "인플루언서 없이 1080p 완제품 필름 납품" : "1080p commercial film delivery only"}
            </span>
          </a>
        </div>
        )}
      </section>
    </div>
  );
}
