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

  return (
    <section
      className="bw-showcase-panel"
      data-campaign-moat-showcase
      data-brand-tab-map
      aria-label={isKo ? "스튜디오 레퍼런스 및 제작 방식" : "Studio reference and production modes"}
    >
      {/* 2D INFINITE NODE CANVAS & 5-DELIVERABLE PIPELINE LAUNCHPAD STAGE ON /brand HOME */}
      <a
        href={scopedHref("/brand/studio", choice)}
        data-home-studio-cta
        data-tab-guide-card="studio"
        style={{
          display: "block",
          textDecoration: "none",
          color: "#F3F4F6",
          position: "relative",
          height: "440px",
          borderRadius: "16px",
          backgroundColor: "#0B0C0E",
          backgroundImage:
            "radial-gradient(rgba(255, 255, 255, 0.16) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          overflow: "hidden",
          marginBottom: "16px",
          boxShadow: "0 18px 44px rgba(0, 0, 0, 0.28)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "14px",
            left: "16px",
            right: "16px",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
            zIndex: 5,
          }}
        >
          <span
            data-moat-pipeline
            style={{
              fontSize: "12px",
              color: "#93C5FD",
              fontWeight: 700,
            }}
          >
            {isKo
              ? "2D 무한 노드 캔버스 · 좌/우 분할 워크벤치 · 5대 제작/유통 스튜디오"
              : "2D Infinite Node Canvas · Dual Split Workbench · 5 Deliverable Studios"}
          </span>

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "4px",
              borderRadius: "999px",
              background: "#18191D",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            <span
              style={{
                padding: "4px 12px",
                borderRadius: "999px",
                background: "#3875C5",
                color: "#FFFFFF",
                fontSize: "11.5px",
                fontWeight: 700,
              }}
            >
              {isKo ? "00 · 2D 무한 캔버스" : "00 · 2D Canvas"}
            </span>
            <span
              style={{
                padding: "4px 12px",
                color: "rgba(255, 255, 255, 0.72)",
                fontSize: "11.5px",
                fontWeight: 600,
              }}
            >
              {isKo ? "좌·우 분할 (이미지↔영상)" : "Dual Split"}
            </span>
            <span
              style={{
                padding: "4px 12px",
                color: "rgba(255, 255, 255, 0.72)",
                fontSize: "11.5px",
                fontWeight: 600,
              }}
            >
              {isKo ? "1080p 인스타 업스케일" : "1080p IG Upscale"}
            </span>
          </div>

          <span
            style={{
              padding: "6px 14px",
              borderRadius: "999px",
              background: "#3875C5",
              color: "#FFFFFF",
              fontSize: "12px",
              fontWeight: 700,
            }}
          >
            {isKo ? "제작 스튜디오 열기 →" : "Open Production Studio →"}
          </span>
        </div>

        {/* SVG Bezier Pipeline Wires Connecting the 3 Production Nodes */}
        <svg
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            zIndex: 2,
          }}
        >
          <path
            d="M 204 162 C 254 162, 260 162, 304 162"
            fill="none"
            stroke="#3875C5"
            strokeWidth="2.2"
          />
          <path
            d="M 468 162 C 516 162, 524 162, 568 162"
            fill="none"
            stroke="#3875C5"
            strokeWidth="2.2"
          />
          <circle cx="204" cy="162" r="4" fill="#3875C5" />
          <circle cx="304" cy="162" r="4" fill="#93C5FD" />
          <circle cx="468" cy="162" r="4" fill="#3875C5" />
          <circle cx="568" cy="162" r="4" fill="#93C5FD" />
        </svg>

        {/* Production Node Cards inside Blue Selection Bounding Box (#1D7DFA) on Dotted Plane */}
        <div
          style={{
            position: "absolute",
            left: "44px",
            top: "64px",
            width: "736px",
            height: "204px",
            border: "2px solid #1D7DFA",
            borderRadius: "14px",
            zIndex: 3,
          }}
        >
          {/* Node 1: @Image 1 + @Image 2 Reference */}
          <div
            style={{
              position: "absolute",
              left: "12px",
              top: "12px",
              width: "148px",
              height: "178px",
              borderRadius: "10px",
              overflow: "hidden",
              background: "#14161B",
              border: "1px solid rgba(255,255,255,0.14)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ padding: "4px 7px", fontSize: "9.5px", fontWeight: 700, color: "#93C5FD", background: "#101217" }}>
              {isKo ? "@Image 1·2 인물·제품 고정" : "@Image 1·2 Ref Lock"}
            </div>
            <img
              src="/reel/brands/slot-1-subject-editorial.jpg"
              alt=""
              style={{ width: "100%", flex: 1, minHeight: 0, objectFit: "cover" }}
            />
            <div style={{ padding: "4px 7px", fontSize: "9.5px", color: "rgba(255,255,255,0.75)", background: "#101217" }}>
              {isKo ? "로고·실루엣 무변형 락" : "Silhouette & Logo Lock"}
            </div>
          </div>

          {/* Node 2: Generated 2K Lookbook Still */}
          <div
            style={{
              position: "absolute",
              left: "260px",
              top: "12px",
              width: "164px",
              height: "178px",
              borderRadius: "10px",
              overflow: "hidden",
              background: "#14161B",
              border: "1px solid rgba(56,117,197,0.65)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ padding: "4px 7px", fontSize: "9.5px", fontWeight: 700, color: "#93C5FD", background: "#101217" }}>
              {isKo ? "Nano Banana Pro · 2K 화보" : "Nano Banana Pro · 2K"}
            </div>
            <img
              src="/reel/brands/studio-editorial-blue-1080p.jpg"
              alt=""
              style={{ width: "100%", flex: 1, minHeight: 0, objectFit: "cover" }}
            />
            <div style={{ padding: "4px 7px", fontSize: "9.5px", color: "rgba(255,255,255,0.8)", background: "#101217" }}>
              {isKo ? "→ 우측 영상 시작 프레임" : "→ Bridge to Video"}
            </div>
          </div>

          {/* Node 3: Seedance 2.5 720p -> 1080p IG Master */}
          <div
            style={{
              position: "absolute",
              left: "524px",
              top: "12px",
              width: "198px",
              height: "178px",
              borderRadius: "10px",
              overflow: "hidden",
              background: "#14161B",
              border: "1px solid rgba(56,117,197,0.65)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ padding: "4px 7px", fontSize: "9.5px", fontWeight: 700, color: "#93C5FD", background: "#101217" }}>
              {isKo ? "Seedance 2.5 · 1080p 인스타 마스터" : "Seedance 2.5 · 1080p IG"}
            </div>
            <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
              <img
                src="/reel/brands/house-runway-1080p.jpg"
                alt=""
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  transform: "translate(-50%, -50%)",
                  width: "30px",
                  height: "30px",
                  borderRadius: "999px",
                  background: "rgba(0, 0, 0, 0.52)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="#FFFFFF">
                  <polygon points="7 4 20 12 7 20 7 4" />
                </svg>
              </span>
            </div>
            <div style={{ padding: "4px 7px", fontSize: "9.5px", color: "rgba(255,255,255,0.8)", background: "#101217" }}>
              {isKo ? "Sunra 1080p 화질 방어 · -14 LUFS" : "Sunra 1080p IG · -14 LUFS"}
            </div>
          </div>
        </div>

        {/* Bottom Floating Dock Preview inside Canvas Hero (Founder-Tone Korean UX) */}
        <div
          style={{
            position: "absolute",
            bottom: "14px",
            left: "50%",
            transform: "translateX(-50%)",
            width: "min(680px, calc(100% - 32px))",
            display: "grid",
            gap: "6px",
            zIndex: 4,
          }}
        >
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {(isKo
              ? [
                  "01 · 5대 모델 화보 생성",
                  "02 · Seedance 2.5 모션 확장",
                  "720p→1080p 인스타 업스케일",
                  "03 · 크리에이터 캠페인 포맷(셀프·의뢰)",
                  "04 · 10·30·50인 유통 패키지",
                  "05 · BGM·폴리 오디오(-14 LUFS)",
                ]
              : [
                  "01 · 5-Model Image Studio",
                  "02 · Seedance 2.5 Video",
                  "1080p IG Upscale Studio",
                  "03 · Creator Campaign Format",
                  "04 · 10/30/50+ Seeding",
                  "05 · BGM & Foley Audio",
                ]
            ).map((pill) => (
              <span
                key={pill}
                style={{
                  padding: "5px 11px",
                  borderRadius: "999px",
                  background: "#18191D",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  color: "#F3F4F6",
                  fontSize: "11px",
                  fontWeight: 600,
                }}
              >
                {pill}
              </span>
            ))}
          </div>
          <div
            style={{
              padding: "12px 16px",
              borderRadius: "16px",
              background: "#18191D",
              border: "1px solid rgba(56, 117, 197, 0.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "14px",
              color: "rgba(255, 255, 255, 0.88)",
              fontSize: "13px",
              fontWeight: 600,
            }}
          >
            <span style={{ position: "relative", width: "44px", height: "34px", display: "inline-block", flexShrink: 0 }}>
              <img
                src="/reel/brands/slot-1-subject-editorial.jpg"
                alt=""
                style={{
                  position: "absolute",
                  left: 0,
                  top: "2px",
                  width: "30px",
                  height: "30px",
                  borderRadius: "6px",
                  objectFit: "cover",
                  border: "1.5px solid #FFFFFF",
                  transform: "rotate(-8deg)",
                }}
              />
              <img
                src="/reel/brands/house-runway-1080p.jpg"
                alt=""
                style={{
                  position: "absolute",
                  left: "10px",
                  top: 0,
                  width: "30px",
                  height: "30px",
                  borderRadius: "6px",
                  objectFit: "cover",
                  border: "1.5px solid #FFFFFF",
                  transform: "rotate(7deg)",
                }}
              />
            </span>
            <span>
              {isKo ? (
                <>
                  캔버스 노드를 드래그해 묶은 뒤 <strong style={{ color: "#93C5FD" }}>Enter</strong>를 누르면 화보 → Seedance 2.5 영상 → 1080p 인스타 업스케일·캠페인으로 즉시 연결됩니다
                </>
              ) : (
                <>
                  Drag-select canvas nodes and press <strong style={{ color: "#93C5FD" }}>Enter</strong> to bridge Stills → Seedance 2.5 Video → 1080p IG Master
                </>
              )}
            </span>
          </div>
        </div>
      </a>

      {/* 4-Up Portrait (4:5) Passepartout Video Gallery — Zero cropped heads, zero chip clutter over footage */}
      <div className="bw-showcase-reel" data-b2b-sound-master-reel>
        {B2B_SOUND_MASTER_CLIPS.map((clip) => {
          const soundOn = activeSoundId === clip.id;
          return (
            <figure
              key={clip.id}
              className="bw-showcase-card"
              data-b2b-master-card={clip.id}
              data-sound-active={soundOn ? "true" : undefined}
            >
              <div className="bw-showcase-media">
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
                        ? "소리 켜기"
                        : "Sound"}
                  </span>
                </button>
              </div>
              <figcaption className="bw-showcase-caption">
                <strong>{isKo ? clip.titleKo : clip.titleEn}</strong>
                <span>{isKo ? clip.badgeKo : clip.badgeEn} · 1080p</span>
              </figcaption>
            </figure>
          );
        })}
      </div>

      {/* 5 Visual Action Cards (Image · Video & Upscale · Creator Campaign Video · Campaign + Distribution · Audio) — Direct Deep-Link Launchpad */}
      <div
        data-brand-five-deliverables
        style={{
          marginTop: "14px",
          marginBottom: "14px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(195px, 1fr))",
          gap: "10px",
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
                padding: "10px",
                borderRadius: "14px",
                background: "var(--ys-surface)",
                border: "1px solid var(--ys-border)",
                boxShadow: "var(--ys-shadow-1)",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div
                style={{
                  width: "100%",
                  aspectRatio: "16 / 10",
                  borderRadius: "9px",
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
                    left: "8px",
                    top: "8px",
                    padding: "2px 8px",
                    borderRadius: "999px",
                    background: "rgba(15, 17, 21, 0.82)",
                    color: "#FFFFFF",
                    fontSize: "11px",
                    fontWeight: 700,
                  }}
                >
                  {isKo ? track.shortLabelKo : track.shortLabelEn}
                </span>
              </div>

              <div style={{ display: "grid", gap: "3px" }}>
                <strong style={{ fontSize: "13px", color: "var(--ys-ink)" }}>
                  {isKo ? track.badgeKo : track.badgeEn}
                </strong>
                <p
                  className="bw-muted"
                  style={{
                    margin: 0,
                    fontSize: "11.5px",
                    lineHeight: 1.4,
                  }}
                >
                  {isKo ? track.summaryKo : track.summaryEn}
                </p>
              </div>

              <div
                style={{
                  marginTop: "auto",
                  paddingTop: "6px",
                  borderTop: "1px solid var(--ys-hairline)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "var(--ys-brand-text)",
                }}
              >
                <span>{isKo ? track.priceGuideKo : track.priceGuideEn}</span>
                <span>{isKo ? "스튜디오 열기 →" : "Open Studio →"}</span>
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
