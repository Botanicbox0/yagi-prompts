"use client";

import { useRef, useState } from "react";
import { scopedHref } from "@/lib/brands/workspace/selection";

export interface B2BSoundMasterClip {
  id: string;
  category: "seeding" | "editorial";
  badgeKo: string;
  badgeEn: string;
  titleKo: string;
  titleEn: string;
  videoUrl: string;
  posterUrl: string;
}

export const B2B_SOUND_MASTER_CLIPS: readonly B2BSoundMasterClip[] = [
  {
    id: "seeding-redcarpet-01",
    category: "seeding",
    badgeKo: "기준 포맷",
    badgeEn: "Master Format",
    titleKo: "레드카펫 마스터 #01",
    titleEn: "Red-Carpet Master #01",
    videoUrl: "/reel/brands/seeding-redcarpet-01-1080p.mp4",
    posterUrl: "/reel/brands/seeding-redcarpet-01-1080p.jpg",
  },
  {
    id: "seeding-redcarpet-02",
    category: "seeding",
    badgeKo: "인플루언서 A",
    badgeEn: "Creator A",
    titleKo: "동일 포맷 시딩 #02",
    titleEn: "Creator Seeding #02",
    videoUrl: "/reel/brands/seeding-redcarpet-02-1080p.mp4",
    posterUrl: "/reel/brands/seeding-redcarpet-02-1080p.jpg",
  },
  {
    id: "seeding-redcarpet-03",
    category: "seeding",
    badgeKo: "인플루언서 B",
    badgeEn: "Creator B",
    titleKo: "동일 포맷 시딩 #03",
    titleEn: "Creator Seeding #03",
    videoUrl: "/reel/brands/seeding-redcarpet-03-1080p.mp4",
    posterUrl: "/reel/brands/seeding-redcarpet-03-1080p.jpg",
  },
  {
    id: "seeding-redcarpet-04",
    category: "seeding",
    badgeKo: "인플루언서 C",
    badgeEn: "Creator C",
    titleKo: "동일 포맷 시딩 #04",
    titleEn: "Creator Seeding #04",
    videoUrl: "/reel/brands/seeding-redcarpet-04-1080p.mp4",
    posterUrl: "/reel/brands/seeding-redcarpet-04-1080p.jpg",
  },
  {
    id: "studio-editorial-blue",
    category: "editorial",
    badgeKo: "스튜디오 룩북",
    badgeEn: "Studio Lookbook",
    titleKo: "프렌치 블루 룩북",
    titleEn: "French Blue Lookbook",
    videoUrl: "/reel/brands/studio-editorial-blue-1080p.mp4",
    posterUrl: "/reel/brands/studio-editorial-blue-1080p.jpg",
  },
  {
    id: "studio-rain-editorial",
    category: "editorial",
    badgeKo: "브랜드 필름",
    badgeEn: "Brand Film",
    titleKo: "레인 에디토리얼 필름",
    titleEn: "Rain Editorial Film",
    videoUrl: "/reel/brands/studio-rain-editorial-1080p.mp4",
    posterUrl: "/reel/brands/studio-rain-editorial-1080p.jpg",
  },
] as const;

export function CampaignMoatShowcase({
  locale,
  organizationId,
  studioOpen,
  membersOpen = true,
  settingsOpen = true,
}: {
  locale: "ko" | "en";
  organizationId?: string | null;
  studioOpen: boolean;
  membersOpen?: boolean;
  settingsOpen?: boolean;
}) {
  const isKo = locale === "ko";
  const choice = organizationId ? { id: organizationId } : null;
  const [activeSoundId, setActiveSoundId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"seeding" | "all">("seeding");
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  const visibleClips = B2B_SOUND_MASTER_CLIPS.filter((clip) => {
    if (!studioOpen && clip.category === "editorial") return false;
    if (filter === "seeding") return clip.category === "seeding";
    return true;
  });

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
      label: isKo ? "위탁 캠페인 · 인플루언서 확산" : "Managed Campaigns · Creator Seeding",
      active: true,
      shown: true,
    },
    {
      key: "studio",
      href: scopedHref("/brand/studio", choice),
      label: isKo ? "제작 스튜디오 · 화보·영상 직접 제작" : "Self-Serve Studio · Direct Creation",
      active: false,
      shown: studioOpen,
    },
    {
      key: "library",
      href: scopedHref("/brand/library", choice),
      label: isKo ? "콘텐츠 보관함 · 납품 검수" : "Content Library · Master QC",
      active: false,
      shown: true,
    },
    {
      key: "identity",
      href: scopedHref("/brand/identity", choice),
      label: isKo ? "브랜드 · 로고·제품·미감 등록" : "Brand · Logos & Aesthetics",
      active: false,
      shown: studioOpen,
    },
    {
      key: "governance",
      href: scopedHref("/brand/settings", choice),
      label: isKo ? "설정 · 팀 권한" : "Settings & Team",
      active: false,
      shown: settingsOpen || membersOpen,
    },
  ].filter((t) => t.shown);

  return (
    <div style={{ display: "grid", gap: "16px", marginBottom: "24px" }}>
      {/* 1. Compact Top Pill Bar (One-line orientation, zero text wall) */}
      <nav
        aria-label={isKo ? "워크스페이스 주요 기능" : "Workspace capabilities"}
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
              gap: "6px",
              padding: "8px 14px",
              borderRadius: "999px",
              background: tab.active ? "#3875C5" : "#FFFFFF",
              color: tab.active ? "#FFFFFF" : "#41444D",
              border: tab.active ? "1px solid #3875C5" : "1px solid rgba(0, 0, 0, 0.1)",
              fontSize: "13px",
              fontWeight: tab.active ? 600 : 500,
              textDecoration: "none",
            }}
          >
            {tab.label}
          </a>
        ))}
      </nav>

      {/* 2. Media-First Moat Showcase (1080p Sound-On Videos as the Hero) */}
      <section
        className="bw-panel"
        data-campaign-moat-showcase
        style={{
          padding: "22px",
          borderRadius: "24px",
          background: "#FFFFFF",
          border: "1px solid rgba(0, 0, 0, 0.08)",
          boxShadow: "var(--ys-card)",
          marginBottom: 0,
        }}
      >
        {/* Header Row: 1-Line Headline + Compact Proof Pills */}
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
            <h2 style={{ fontSize: "19px", fontWeight: 600, letterSpacing: "-0.03em", margin: "0 0 4px", color: "#0E1013" }}>
              {isKo
                ? "마스터 포맷 1편을 수십 명의 인플루언서 얼굴로 복제해 릴스·틱톡을 동시에 덮습니다"
                : "Scale one 1080p master format across dozens of influencer faces on Reels & TikTok"}
            </h2>
            <div
              data-moat-pipeline
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "6px",
                fontSize: "12.5px",
                color: "#676B75",
              }}
            >
              <span>{isKo ? "① 1080p 포맷·사운드 고정" : "① Lock 1080p Format"}</span>
              <span>→</span>
              <span>{isKo ? "② 인플루언서 본인 얼굴 시딩" : "② Creator Likeness Seeding"}</span>
              <span>→</span>
              <span>{isKo ? "③ 본계정 동시 업로드" : "③ Simultaneous Reels Wave"}</span>
              <span>→</span>
              <span>{isKo ? "④ 조회수 집계·2차 광고" : "④ Live ROI & Ad Boost"}</span>
            </div>
          </div>

          <div
            data-moat-proof-metrics
            style={{
              display: "inline-flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "6px",
              padding: "6px 12px",
              borderRadius: "999px",
              background: "#F6F7F9",
              border: "1px solid rgba(0, 0, 0, 0.07)",
              fontSize: "12px",
              fontWeight: 600,
              color: "#0E1013",
            }}
          >
            <span style={{ color: "#3063A7" }}>{isKo ? "글로벌 AI 플랫폼" : "Global AI Platform"}</span>
            <span>·</span>
            <span>{isKo ? "영상 9편" : "9 Films"}</span>
            <span>·</span>
            <span style={{ color: "#3063A7" }}>{isKo ? "200만 뷰+" : "2M+ Views"}</span>
            <span>·</span>
            <span>{isKo ? "300건+ 파생" : "300+ UGC"}</span>
          </div>
        </div>

        {/* 1080p Sound-On Video Strip (Pure Visuals, No Paragraph Clutter) */}
        <div
          data-b2b-sound-master-reel
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(185px, 1fr))",
            gap: "12px",
          }}
        >
          {visibleClips.map((clip) => {
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

        {/* Bottom Action Bar: 2 Clear Next Steps */}
        {studioOpen && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "10px",
              marginTop: "14px",
              paddingTop: "14px",
              borderTop: "1px solid rgba(0, 0, 0, 0.06)",
            }}
          >
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
                {isKo ? "1단계: 우리 브랜드 로고·미감 등록하기 →" : "Step 1: Register Brand DNA & Assets →"}
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
                {isKo ? "2단계: 제작 스튜디오에서 화보·영상 만들기 →" : "Step 2: Create in Self-Serve Studio →"}
              </a>
            </div>

            <button
              type="button"
              data-showcase-filter={filter === "all" ? "seeding" : "all"}
              onClick={() => setFilter(filter === "all" ? "seeding" : "all")}
              style={{
                padding: "6px 12px",
                borderRadius: "999px",
                border: "1px solid rgba(0,0,0,0.1)",
                background: "#FFFFFF",
                color: "#676B75",
                fontSize: "12px",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {filter === "all"
                ? isKo
                  ? "인플루언서 시딩 4편만 보기"
                  : "Show 4 Seeding Reels"
                : isKo
                  ? "+ 스튜디오 룩북 2편 함께 보기"
                  : "+ Show 2 Studio Lookbooks"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
