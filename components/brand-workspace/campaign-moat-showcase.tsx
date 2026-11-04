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
  descKo: string;
  descEn: string;
  videoUrl: string;
  posterUrl: string;
  specLabel: string;
}

export const B2B_SOUND_MASTER_CLIPS: readonly B2BSoundMasterClip[] = [
  {
    id: "seeding-redcarpet-01",
    category: "seeding",
    badgeKo: "MASTER FORMAT · 기준 포맷",
    badgeEn: "MASTER FORMAT · Anchor Look",
    titleKo: "셀럽 레드카펫 파파라치 마스터 #01",
    titleEn: "Red-Carpet Paparazzi Master #01",
    descKo: "스웨이드 코르셋 드레스·실크 스카프 착장과 카메라 플래시·셔터 사운드(-14 LUFS)를 고정한 1080p 마스터 포맷입니다.",
    descEn: "1080p master format locking the suede corset dress, silk scarf, strobe lighting, and -14 LUFS shutter sound.",
    videoUrl: "/reel/brands/seeding-redcarpet-01-1080p.mp4",
    posterUrl: "/reel/brands/seeding-redcarpet-01-1080p.jpg",
    specLabel: "1080×1920 · 48kHz -14 LUFS · Clean Master",
  },
  {
    id: "seeding-redcarpet-02",
    category: "seeding",
    badgeKo: "CREATOR SEEDING #01 · 인물 확산",
    badgeEn: "CREATOR SEEDING #01 · Likeness Scale",
    titleKo: "동일 포맷 크리에이터 시딩 #02",
    titleEn: "Same-Format Creator Seeding #02",
    descKo: "마스터 포맷의 착장·조명·사운드 드롭(1.70s)은 100% 유지한 채 크리에이터 본인의 얼굴로 생성된 1080p 무로고 납품본입니다.",
    descEn: "100% identical dress, lighting, and 1.70s beat drop, scaled to a verified creator's own likeness in 1080p.",
    videoUrl: "/reel/brands/seeding-redcarpet-02-1080p.mp4",
    posterUrl: "/reel/brands/seeding-redcarpet-02-1080p.jpg",
    specLabel: "1080×1920 · 48kHz -14 LUFS · Clean Master",
  },
  {
    id: "seeding-redcarpet-03",
    category: "seeding",
    badgeKo: "CREATOR SEEDING #02 · 인물 확산",
    badgeEn: "CREATOR SEEDING #02 · Likeness Scale",
    titleKo: "동일 포맷 크리에이터 시딩 #03",
    titleEn: "Same-Format Creator Seeding #03",
    descKo: "수십 명의 인플루언서가 각자의 계정에 동시에 업로드해 릴스·틱톡 피드에서 브랜드 포맷 웨이브를 만듭니다.",
    descEn: "Simultaneous uploads across dozens of creator accounts trigger algorithmic feed dominance.",
    videoUrl: "/reel/brands/seeding-redcarpet-03-1080p.mp4",
    posterUrl: "/reel/brands/seeding-redcarpet-03-1080p.jpg",
    specLabel: "1080×1920 · 48kHz -14 LUFS · Clean Master",
  },
  {
    id: "seeding-redcarpet-04",
    category: "seeding",
    badgeKo: "CREATOR SEEDING #03 · 인물 확산",
    badgeEn: "CREATOR SEEDING #03 · Likeness Scale",
    titleKo: "동일 포맷 크리에이터 시딩 #04",
    titleEn: "Same-Format Creator Seeding #04",
    descKo: "워터마크 없는 1080p 클린 마스터와 마스터링된 오디오로 오가닉 게시 및 2차 파트너십 광고에 즉시 투입합니다.",
    descEn: "Logo-free 1080p master with broadcast-ready audio, ready for organic Reels and partnership ad boosting.",
    videoUrl: "/reel/brands/seeding-redcarpet-04-1080p.mp4",
    posterUrl: "/reel/brands/seeding-redcarpet-04-1080p.jpg",
    specLabel: "1080×1920 · 48kHz -14 LUFS · Clean Master",
  },
  {
    id: "studio-editorial-blue",
    category: "editorial",
    badgeKo: "STUDIO LOOKBOOK · 화보 필름",
    badgeEn: "STUDIO LOOKBOOK · Editorial Film",
    titleKo: "프렌치 블루 하이패션 룩북 마스터",
    titleEn: "French Blue High-Fashion Lookbook",
    descKo: "브랜드 키 컬러와 데님 디테일, 스튜디오 앰비언스 사운드를 결합한 1080p 셀프서비스 스튜디오 마스터입니다.",
    descEn: "1080p self-serve studio lookbook pairing brand key colors and denim embroidery with studio sound design.",
    videoUrl: "/reel/brands/studio-editorial-blue-1080p.mp4",
    posterUrl: "/reel/brands/studio-editorial-blue-1080p.jpg",
    specLabel: "1080×1920 · 48kHz -14 LUFS · Clean Master",
  },
  {
    id: "studio-rain-editorial",
    category: "editorial",
    badgeKo: "BRAND FILM · 무드 필름",
    badgeEn: "BRAND FILM · Mood Editorial",
    titleKo: "시네마틱 레인 & 플라워 에디토리얼",
    titleEn: "Cinematic Rain & Flower Editorial",
    descKo: "빗소리 폴리 사운드와 아날로그 필름 그레인, 클로즈업 컷 구성을 결합한 1080p 브랜드 무드 필름입니다.",
    descEn: "1080p brand mood film combining rain foley, analog film grain, and multi-cut editorial pacing.",
    videoUrl: "/reel/brands/studio-rain-editorial-1080p.mp4",
    posterUrl: "/reel/brands/studio-rain-editorial-1080p.jpg",
    specLabel: "1080×1920 · 48kHz -14 LUFS · Clean Master",
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
  const [filter, setFilter] = useState<"all" | "seeding" | "editorial">("all");
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  const visibleClips = B2B_SOUND_MASTER_CLIPS.filter((clip) => {
    if (!studioOpen && clip.category === "editorial") return false;
    if (filter === "all") return true;
    return clip.category === filter;
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
      badge: isKo ? "현재 탭 · CORE MOAT" : "CURRENT TAB · CORE MOAT",
      title: isKo ? "1. 위탁 캠페인 (Managed Campaigns)" : "1. Managed Campaigns",
      role: isKo ? "크리에이터·인플루언서 대거 시딩 & 바이럴 확산" : "Mass Creator & Influencer Seeding",
      desc: isKo
        ? "트렌드 포맷 1개를 설계한 뒤 검증된 인플루언서 다수가 본인 얼굴로 인스타그램 릴스·틱톡에 동시 업로드합니다. 후보 선발·조회수·저장수·2차 광고 권한을 한곳에서 관리합니다."
        : "Scale one master format across dozens of verified influencers publishing on their own Reels and TikTok channels, with live view/save tracking and ad rights.",
      active: true,
      shown: true,
    },
    {
      key: "studio",
      href: scopedHref("/brand/studio", choice),
      badge: isKo ? "SELF-SERVE · 직접 제작" : "SELF-SERVE · Direct Creation",
      title: isKo ? "2. 제작 스튜디오 (Self-Serve Studio)" : "2. Self-Serve Studio",
      role: isKo ? "패션·뷰티·F&B 화보·영상·사운드 즉시 제작" : "Fashion, Beauty & F&B Lookbooks & Films",
      desc: isKo
        ? "Pomelli 4-Shot 제품 화보(스튜디오·제형·착용·연출), 디자인 원칙 부착 선택기(Full/Custom/Free), 네모 박스 부분 수선, 클라이맥스 사운드를 직접 실행합니다."
        : "Create 4-shot product photoshoots, toggle design principle attachment (Full/Custom/Free), run micro-inpaint repairs, and master sound.",
      active: false,
      shown: studioOpen,
    },
    {
      key: "library",
      href: scopedHref("/brand/library", choice),
      badge: isKo ? "ARCHIVE & QC · 납품 보관함" : "ARCHIVE & QC · Master Vault",
      title: isKo ? "3. 콘텐츠 보관함 (Content Library)" : "3. Content Library",
      role: isKo ? "1080p 납품 마스터 아카이브 & 프레임 검수" : "1080p Delivered Masters & Frame QC",
      desc: isKo
        ? "캠페인 및 스튜디오에서 완성된 모든 1080p 영상·화보의 버전 이력을 모아보고, 타임코드별 수정 코멘트와 최종 승인을 관리합니다."
        : "Browse every delivered 1080p video and lookbook version, leave frame-accurate review notes, and approve final masters.",
      active: false,
      shown: true,
    },
    {
      key: "identity",
      href: scopedHref("/brand/identity", choice),
      badge: isKo ? "BRAND DNA · 브랜드 메모리" : "BRAND DNA · Brand Memory",
      title: isKo ? "4. 브랜드 (Brand DNA & Assets)" : "4. Brand DNA & Assets",
      role: isKo ? "무제한 에셋 인테이크 & 다중 미감(A/B/C) 설정" : "Unlimited Asset Intake & Multi-Aesthetic Lines",
      desc: isKo
        ? "웹사이트 URL 9단계 자동 추출, 핀터레스트 보드 스마트 샘플링, 공식 로고·제품 컷·컬러 팔레트·다중 미감 노선(Line A/B/C)을 등록합니다."
        : "Run 9-step website URL extraction, smart-sample Pinterest boards, and lock your logos, product cutouts, palettes, and A/B/C aesthetic lines.",
      active: false,
      shown: studioOpen,
    },
    {
      key: "governance",
      href: scopedHref("/brand/settings", choice),
      badge: isKo ? "GOVERNANCE · 설정 & 팀" : "GOVERNANCE · Settings & Team",
      title: isKo ? "5. 브랜드 설정 · 팀 (Settings & Team)" : "5. Brand Settings & Team",
      role: isKo ? "조직 프로필 · 도메인 · 멤버 권한 관리" : "Organization Profile & Role Permissions",
      desc: isKo
        ? "브랜드 기본 정보와 연락처를 관리하고, 마케터·PM·디렉터·외부 파트너사별 편집/열람 권한을 안전하게 분리합니다."
        : "Manage brand profile details and control owner, editor, and read-only viewer permissions across your marketing team.",
      active: false,
      shown: settingsOpen || membersOpen,
    },
  ].filter((t) => t.shown);

  return (
    <div style={{ display: "grid", gap: "24px", marginBottom: "28px" }}>
      {/* 1. Workspace Tab & Capability Orientation Map */}
      <section
        className="bw-panel"
        data-brand-tab-map
        style={{
          padding: "24px",
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
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: "12px",
            marginBottom: "16px",
          }}
        >
          <div>
            <p className="bw-kicker" style={{ color: "#3063A7", fontWeight: 700, marginBottom: "4px" }}>
              {isKo ? "WORKSPACE NAVIGATION GUIDE · 탭별 핵심 기능 안내" : "WORKSPACE NAVIGATION GUIDE · WHAT EACH TAB DOES"}
            </p>
            <h2 style={{ fontSize: "19px", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
              {isKo
                ? "목적에 맞는 탭을 선택해 크리에이터 대량 시딩 캠페인부터 자체 스튜디오 제작까지 바로 실행하세요"
                : "Choose the right workspace tab for mass creator seeding campaigns, direct studio production, or asset governance"}
            </h2>
          </div>
          <span
            style={{
              padding: "5px 12px",
              borderRadius: "999px",
              background: "#EEF4FB",
              color: "#3063A7",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            {isKo ? `활성 워크스페이스 탭 ${tabs.length}개` : `${tabs.length} Active Workspace Tabs`}
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "12px",
          }}
        >
          {tabs.map((tab) => (
            <a
              key={tab.key}
              href={tab.href}
              data-tab-guide-card={tab.key}
              style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: "10px",
                padding: "16px",
                borderRadius: "18px",
                background: tab.active ? "#F4F8FD" : "#F8F9FA",
                border: tab.active ? "1.5px solid #3875C5" : "1px solid rgba(0, 0, 0, 0.07)",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div style={{ display: "grid", gap: "6px" }}>
                <span
                  style={{
                    alignSelf: "flex-start",
                    padding: "3px 9px",
                    borderRadius: "999px",
                    background: tab.active ? "#3875C5" : "rgba(17, 17, 20, 0.07)",
                    color: tab.active ? "#FFFFFF" : "#3A3D45",
                    fontSize: "10px",
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                  }}
                >
                  {tab.badge}
                </span>
                <strong style={{ fontSize: "15px", fontWeight: 700, color: "#111114" }}>{tab.title}</strong>
                <span style={{ fontSize: "12px", fontWeight: 600, color: "#3063A7" }}>{tab.role}</span>
                <p style={{ fontSize: "12.5px", color: "#55555F", margin: 0, lineHeight: 1.5 }}>{tab.desc}</p>
              </div>
              <span style={{ fontSize: "12px", fontWeight: 700, color: tab.active ? "#3063A7" : "#111114" }}>
                {tab.active
                  ? isKo
                    ? "현재 보고 있는 화면 ●"
                    : "Viewing this tab ●"
                  : isKo
                    ? "이 탭으로 이동 →"
                    : "Open tab →"}
              </span>
            </a>
          ))}
        </div>
      </section>

      {/* 2. Mass Creator & Influencer Seeding Moat + 1080p Sound-On Master Showcase */}
      <section
        className="bw-panel"
        data-campaign-moat-showcase
        style={{
          padding: "28px",
          borderRadius: "24px",
          background: "#FFFFFF",
          border: "1.5px solid rgba(56, 117, 197, 0.28)",
          boxShadow: "var(--ys-card)",
          marginBottom: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "16px",
            marginBottom: "20px",
          }}
        >
          <div style={{ maxWidth: "760px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <span
                style={{
                  padding: "4px 10px",
                  borderRadius: "999px",
                  background: "#3875C5",
                  color: "#FFFFFF",
                  fontSize: "11px",
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                }}
              >
                {isKo ? "OUR CORE MOAT · 크리에이터 대량 확산 엔진" : "OUR CORE MOAT · MASS CREATOR SEEDING"}
              </span>
              <span
                style={{
                  padding: "4px 10px",
                  borderRadius: "999px",
                  background: "#F3F4F6",
                  color: "#111114",
                  fontSize: "11px",
                  fontWeight: 600,
                }}
              >
                1080p Full HD · 48kHz -14 LUFS Sound-On · Clean Master
              </span>
            </div>
            <h2 style={{ fontSize: "22px", fontWeight: 700, letterSpacing: "-0.03em", margin: "0 0 8px", color: "#111114" }}>
              {isKo
                ? "단 한 편의 1080p 사운드 마스터 포맷으로, 수십 명의 인플루언서 피드를 동시에 장악합니다"
                : "Scale one 1080p sound-on master format across dozens of verified influencer feeds simultaneously"}
            </h2>
            <p style={{ fontSize: "14px", color: "#55555F", margin: 0, lineHeight: 1.6 }}>
              {isKo
                ? "단발성 AI 이미지·영상 한두 개로는 알고리즘을 이길 수 없습니다. TWINGS 캠페인은 브랜드 착장·제품·조명·클라이맥스 사운드가 고정된 1080p 마스터 포맷을 설계한 뒤, 사전 검증된 크리에이터·인플루언서들이 본인 얼굴로 각자의 인스타그램 릴스·틱톡 계정에 동시 게시하여 폭발적인 파생 확산을 만듭니다."
                : "Single AI clips rarely move the algorithm. TWINGS locks your garment, product, lighting, and climax audio into a 1080p master format, then scales it across verified influencers publishing in their own likeness on Instagram Reels and TikTok."}
            </p>
          </div>

          {/* Approved Proof Metrics Box (AGENTS.md §5) */}
          <div
            data-moat-proof-metrics
            style={{
              padding: "16px 18px",
              borderRadius: "18px",
              background: "#111114",
              color: "#FFFFFF",
              minWidth: "280px",
              display: "grid",
              gap: "10px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#93C5FD", letterSpacing: "0.04em" }}>
                {isKo ? "실전 캠페인 검증 레퍼런스" : "VERIFIED CAMPAIGN TRACK RECORD"}
              </span>
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: "999px",
                  background: "rgba(255,255,255,0.12)",
                  fontSize: "11px",
                  fontWeight: 600,
                }}
              >
                {isKo ? "글로벌 AI 플랫폼" : "Global AI Platform"}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "10px" }}>
              <div>
                <strong style={{ fontSize: "18px", fontWeight: 700, display: "block", color: "#FFFFFF" }}>
                  {isKo ? "영상 9편" : "9 Films"}
                </strong>
                <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.72)" }}>
                  {isKo ? "포맷 시딩" : "Format Seed"}
                </span>
              </div>
              <div>
                <strong style={{ fontSize: "18px", fontWeight: 700, display: "block", color: "#93C5FD" }}>
                  {isKo ? "200만 뷰+" : "2M+ Views"}
                </strong>
                <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.72)" }}>
                  {isKo ? "오가닉 조회수" : "Organic Reach"}
                </span>
              </div>
              <div>
                <strong style={{ fontSize: "18px", fontWeight: 700, display: "block", color: "#FFFFFF" }}>
                  {isKo ? "300건+" : "300+ Posts"}
                </strong>
                <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.72)" }}>
                  {isKo ? "파생 오가닉 콘텐츠" : "Derivative UGC"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 4-Step Campaign Moat Pipeline */}
        <div
          data-moat-pipeline
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: "12px",
            marginBottom: "22px",
          }}
        >
          {[
            {
              step: "STEP 01 · FORMAT LOCK",
              title: isKo ? "1080p 사운드 마스터 포맷 설계" : "1080p Sound-On Master Format",
              body: isKo
                ? "브랜드 키 룩·제품·카메라 워크와 -14 LUFS 클라이맥스 사운드 드롭이 정밀하게 맞물린 기준 영상을 완성합니다."
                : "Lock the key look, product placement, camera choreography, and -14 LUFS audio drop into one anchor film.",
            },
            {
              step: "STEP 02 · MASS SEEDING",
              title: isKo ? "검증된 크리에이터·인플루언서 대거 참여" : "Mass Verified Creator Seeding",
              body: isKo
                ? "초상권·본인 동의가 완료된 크리에이터 수십 명이 각자의 얼굴로 동일 포맷의 주인공이 되어 동시에 영상을 확보합니다."
                : "Dozens of verified creators star in the exact same format using their consented likeness.",
            },
            {
              step: "STEP 03 · VIRAL WAVE",
              title: isKo ? "릴스·틱톡 본인 계정 동시 업로드" : "Simultaneous Reels & TikTok Wave",
              body: isKo
                ? "브랜드 계정 하나에 올리는 대신, 수십 명의 인플루언서 본계정에서 동시에 터지며 알고리즘 밈·트렌드로 확산됩니다."
                : "Published across dozens of creator channels at once to trigger algorithmic trend waves and organic remixes.",
            },
            {
              step: "STEP 04 · LIVE ROI & ADS",
              title: isKo ? "실시간 성과 집계 & 2차 광고 부스팅" : "Live ROI Tracking & Ad Boosting",
              body: isKo
                ? "게시물별 조회수·좋아요·저장수를 실시간 추적하고, 반응이 가장 높은 상위 영상을 2차 파트너십 광고로 즉시 전환합니다."
                : "Track live views, likes, and saves per post, then boost top-performing creator reels as partnership ads.",
            },
          ].map((item) => (
            <div
              key={item.step}
              data-moat-step={item.step}
              style={{
                padding: "14px 16px",
                borderRadius: "16px",
                background: "#F8F9FA",
                border: "1px solid rgba(0, 0, 0, 0.06)",
                display: "grid",
                gap: "6px",
              }}
            >
              <span style={{ fontSize: "10px", fontWeight: 700, color: "#3063A7", letterSpacing: "0.05em" }}>
                {item.step}
              </span>
              <strong style={{ fontSize: "14px", fontWeight: 700, color: "#111114" }}>{item.title}</strong>
              <p style={{ fontSize: "12.5px", color: "#55555F", margin: 0, lineHeight: 1.5 }}>{item.body}</p>
            </div>
          ))}
        </div>

        {/* Filter bar for 1080p Sound-On Master Reels */}
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
            <strong style={{ fontSize: "15px", fontWeight: 700, color: "#111114", display: "block" }}>
              {isKo
                ? "실제 납품 1080p 무로고 · 사운드 마스터 쇼케이스 (카드의 🔊 버튼으로 사운드를 켜보세요)"
                : "1080p Logo-Free Sound-On Master Showcase (Click 🔊 on any card to hear -14 LUFS audio)"}
            </strong>
            <span style={{ fontSize: "12px", color: "#55555F" }}>
              {isKo
                ? "동일한 레드카펫 착장·조명·셔터 사운드 포맷이 여러 크리에이터의 얼굴로 1080p 해상도에서 어떻게 일관되게 확산되는지 확인하세요."
                : "See how a single red-carpet format, wardrobe, lighting, and sound design scales cleanly across multiple creators in 1080p."}
            </span>
          </div>

          {studioOpen && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }} role="group" aria-label="Showcase filter">
              {[
                { id: "all" as const, ko: "전체 1080p 마스터 (6)", en: "All 1080p Masters (6)" },
                { id: "seeding" as const, ko: "인플루언서 시딩 포맷 확산 (4)", en: "Creator Seeding Scale (4)" },
                { id: "editorial" as const, ko: "B2B 스튜디오 화보·필름 (2)", en: "Studio Editorial Films (2)" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  data-showcase-filter={tab.id}
                  onClick={() => setFilter(tab.id)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "999px",
                    border: filter === tab.id ? "1.5px solid #3875C5" : "1px solid rgba(0,0,0,0.12)",
                    background: filter === tab.id ? "#EEF4FB" : "#FFFFFF",
                    color: filter === tab.id ? "#3063A7" : "#55555F",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {isKo ? tab.ko : tab.en}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 1080p Sound-On Video Wall */}
        <div
          data-b2b-sound-master-reel
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: "14px",
          }}
        >
          {visibleClips.map((clip) => {
            const soundOn = activeSoundId === clip.id;
            return (
              <article
                key={clip.id}
                data-b2b-master-card={clip.id}
                style={{
                  borderRadius: "18px",
                  overflow: "hidden",
                  background: "#111114",
                  color: "#FFFFFF",
                  border: soundOn ? "2px solid #3875C5" : "1px solid rgba(0, 0, 0, 0.12)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ position: "relative", aspectRatio: "9 / 16", background: "#0A0A0D", overflow: "hidden" }}>
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
                      padding: "4px 9px",
                      borderRadius: "999px",
                      background: "rgba(17, 17, 20, 0.76)",
                      backdropFilter: "blur(8px)",
                      color: "#FFFFFF",
                      fontSize: "10px",
                      fontWeight: 700,
                      letterSpacing: "0.03em",
                    }}
                  >
                    {isKo ? clip.badgeKo : clip.badgeEn}
                  </span>
                  <button
                    type="button"
                    data-reel-sound-toggle={clip.id}
                    aria-pressed={soundOn}
                    onClick={() => toggleSound(clip.id)}
                    style={{
                      position: "absolute",
                      bottom: "10px",
                      right: "10px",
                      padding: "6px 12px",
                      borderRadius: "999px",
                      border: "1px solid rgba(255,255,255,0.28)",
                      background: soundOn ? "#3875C5" : "rgba(17, 17, 20, 0.78)",
                      color: "#FFFFFF",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.28)",
                    }}
                  >
                    {soundOn
                      ? isKo
                        ? "🔊 사운드 재생 중 (-14 LUFS)"
                        : "🔊 Sound On (-14 LUFS)"
                      : isKo
                        ? "🔇 사운드 켜기"
                        : "🔇 Unmute Sound"}
                  </button>
                </div>

                <div style={{ padding: "12px 14px", display: "grid", gap: "4px", background: "#FFFFFF", color: "#111114" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
                    <strong style={{ fontSize: "13.5px", fontWeight: 700 }}>
                      {isKo ? clip.titleKo : clip.titleEn}
                    </strong>
                  </div>
                  <p style={{ fontSize: "12px", color: "#55555F", margin: 0, lineHeight: 1.45 }}>
                    {isKo ? clip.descKo : clip.descEn}
                  </p>
                  <span style={{ fontSize: "10.5px", fontWeight: 600, color: "#3063A7", marginTop: "2px" }}>
                    {clip.specLabel}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
