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
      <div className="bw-showcase-head">
        <div>
          <h2>
            {isKo
              ? "올인원 브랜드 미디어 스튜디오 · 화보 생성 · 부분 수정 · 1080p 영상"
              : "All-in-One Brand Media Studio · Image Generation · Micro-Editing · 1080p Film"}
          </h2>
          <p data-moat-pipeline>
            {isKo
              ? "1단계에서 우리 브랜드의 색감·질감을 먼저 고정한 뒤, 2단계에서 1~4번 참고 이미지 조합과 원하는 부위 부분 수정을 거치고, 3단계에서 1080p 영상과 크리에이터 캠페인으로 이어가세요."
              : "Lock Brand Identity & Pinned Color/Texture in Step 01, generate & micro-edit images in Step 02, and scale into 1080p sound masters & creator campaigns in Step 03."}
          </p>
        </div>

        <div className="bw-showcase-actions">
          <a
            href={scopedHref("/brand/identity", choice)}
            className="bw-button"
            data-home-onboarding-cta
            data-tab-guide-card="identity"
          >
            {isKo ? "1단계 · 브랜드 아이덴티티 등록" : "Step 01 · Brand Identity"}
          </a>
          <a
            href={scopedHref("/brand/studio", choice)}
            className="bw-button bw-primary"
            data-home-studio-cta
            data-tab-guide-card="studio"
          >
            {isKo ? "2~3단계 · 제작 스튜디오 열기" : "Open Self Studio"}
          </a>
        </div>
      </div>

      {/* Quick Capability Dock (Hatch / Krea style one-click tool pills) */}
      <div
        data-brand-quick-dock
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "8px",
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

      {/* 3-Step Studio Creation Workflow Launcher (Identity Lock -> Image Generation & Micro-Edit -> 1080p Master Video) */}
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
              {isKo ? "1단계 · 브랜드 & 색감·질감 고정" : "STEP 01 · Identity & Style Pin"}
            </span>
            <strong style={{ display: "block", fontSize: "14px", marginTop: "4px" }}>
              {isKo
                ? "우리 브랜드 핵심 기준 3가지 & 색감·질감 항상 똑같이 고정"
                : "Lock 3 Brand Rules & Pinned Color/Texture References"}
            </strong>
            <p className="bw-muted" style={{ fontSize: "12px", marginTop: "4px", lineHeight: 1.45 }}>
              {isKo
                ? "제품 모양·로고 글자·소재 기준과 우리 브랜드만의 색감·질감 참고 사진을 먼저 등록해 모든 작업에 일관되게 유지합니다."
                : "Pin your brand identity, color grade reference, and film texture reference across every studio run."}
            </p>
          </div>
          <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--ys-brand-text)" }}>
            {isKo ? "브랜드 아이덴티티 설정하기 →" : "Configure Brand Identity →"}
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
              {isKo ? "2단계 · 화보 생성 & 원하는 부위 부분 수정" : "STEP 02 · Image Gen & Micro-Edit"}
            </span>
            <strong style={{ display: "block", fontSize: "14px", marginTop: "4px" }}>
              {isKo
                ? "1~4번 참고 이미지 조합 생성 & 드래그한 부분만 정밀 수정"
                : "1–4 Multi-Ref Generation & Smart Mask Micro-Region Editing"}
            </strong>
            <p className="bw-muted" style={{ fontSize: "12px", marginTop: "4px", lineHeight: 1.45 }}>
              {isKo
                ? "1번 인물·2번 배경·3번 포즈·4번 색감을 합치거나, 원본은 그대로 둔 채 로고·손 모양·표정만 드래그해 자연스럽게 고칩니다."
                : "Combine 1–4 role-locked references or drag a selection marquee on the canvas to edit micro-regions via a Smart Layer Mask."}
            </p>
          </div>
          <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--ys-brand-text)" }}>
            {isKo ? "이미지 스튜디오 바로 열기 →" : "Open Image Studio →"}
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
              {isKo ? "3단계 · 1080p 영상 & 크리에이터 캠페인" : "STEP 03 · 1080p Video & Seeding"}
            </span>
            <strong style={{ display: "block", fontSize: "14px", marginTop: "4px" }}>
              {isKo
                ? "완성된 화보 사진을 첫 장면으로 1080p 사운드 영상 제작"
                : "Animate Approved Still into 1080p Sound Master Film"}
            </strong>
            <p className="bw-muted" style={{ fontSize: "12px", marginTop: "4px", lineHeight: 1.45 }}>
              {isKo
                ? "마음에 드는 화보를 첫 장면으로 고정해 720p로 움직임을 먼저 확인한 뒤 1080p 영상을 완성하거나, 크리에이터 캠페인으로 바로 연결합니다."
                : "Lock your approved still as the start frame, preview motion at 720p, and render the 1080p master film."}
            </p>
          </div>
          <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--ys-brand-text)" }}>
            {isKo ? "영상 스튜디오 바로 열기 →" : "Open Video Studio →"}
          </span>
        </a>
      </div>

      {/* 5 Core Deliverable Tracks Showcase (Image · Video · Creator Campaign Format [Self/Commission] · Creator Campaign + Distribution · Audio) */}
      <div
        data-brand-five-deliverables
        style={{
          marginTop: "14px",
          marginBottom: "14px",
          padding: "14px",
          borderRadius: "14px",
          background: "var(--ys-surface)",
          boxShadow: "var(--ys-ring)",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
          }}
        >
          <div>
            <strong style={{ fontSize: "13.5px", color: "var(--ys-ink)" }}>
              {isKo
                ? "우리 브랜드가 바로 만들고 유통할 수 있는 5대 핵심 결과물"
                : "5 Core Deliverables Ready for Instant Brand Production & Distribution"}
            </strong>
            <span
              className="bw-muted"
              style={{ marginLeft: "8px", fontSize: "12px" }}
            >
              {isKo
                ? "이미지 · 영상 · 크리에이터 캠페인 영상(셀프/의뢰) · 크리에이터 캠페인+유통 · 오디오"
                : "Image · Video · Creator Campaign Format (Self/Commission) · Campaign + Distribution · Audio"}
            </span>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(205px, 1fr))",
            gap: "10px",
          }}
        >
          {BRAND_CORE_DELIVERABLE_TRACKS.map((track) => {
            const targetHref =
              track.id === "creator_distribution"
                ? scopedHref("/brand/campaigns", choice)
                : scopedHref("/brand/studio", choice);
            return (
              <a
                key={track.id}
                href={targetHref}
                data-five-deliverable-card={track.id}
                style={{
                  textDecoration: "none",
                  color: "inherit",
                  padding: "10px 12px",
                  borderRadius: "12px",
                  background: "var(--ys-subtle-bg)",
                  border: "1px solid var(--ys-border)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "8px",
                  }}
                >
                  <strong style={{ fontSize: "13px", color: "var(--ys-ink)" }}>
                    {isKo ? track.shortLabelKo : track.shortLabelEn}
                  </strong>
                  <span
                    style={{
                      fontSize: "10.5px",
                      fontWeight: 700,
                      color: "var(--ys-brand-text)",
                    }}
                  >
                    {isKo ? track.badgeKo : track.badgeEn}
                  </span>
                </div>
                <p
                  className="bw-muted"
                  style={{
                    margin: 0,
                    fontSize: "11.5px",
                    lineHeight: 1.45,
                  }}
                >
                  {isKo ? track.summaryKo : track.summaryEn}
                </p>
                <div
                  style={{
                    marginTop: "auto",
                    paddingTop: "6px",
                    borderTop: "1px solid var(--ys-hairline)",
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "var(--ys-brand-text)",
                  }}
                >
                  {isKo ? track.priceGuideKo : track.priceGuideEn}
                </div>
              </a>
            );
          })}
        </div>
      </div>

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

      {/* Editorial Top-Rule 4-Track Bar (Matches .bw-studio-process grammar, zero nested boxes or emojis) */}
      {canRequest && (
        <div className="bw-showcase-tracks" data-commission-quick-launch>
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
    </section>
  );
}
