import { studioVideoEn, studioVideoKo } from "@/messages/studio-video";

/**
 * Unified 3-Track Commission Architecture + Frame.io V4 / Playbook.com Asset & Share Room Model.
 *
 * Aligns the B2B Brand Workspace around:
 * - Self Studio (`/brand/studio`): Brand directly generates assets/videos from mounted templates
 * - 3 Commissioned Tracks in `/brand/projects/new`:
 *   1. `template_build`: Commission YAGI to build a custom reusable template -> mounts into `/brand/studio`
 *   2. `creator_campaign`: Commission YAGI to build a template + recruit influencers & publish waves
 *   3. `studio_film`: Commission YAGI to produce a 1080p master video only (no influencer steps)
 *
 * Strictly enforces the Morphic Sandbox Hardline (`generativeClosed = true` hides `template_build`
 * and any self-serve studio references).
 */

export type CommissionTrackId = "creator_campaign" | "template_build" | "studio_film";

export type ShareLayoutMode = "grid" | "list" | "reel" | "player";

export type DeliverableApprovalStatus =
  | "awaiting_approval"
  | "needs_revision"
  | "ready_for_release";

export type ReleasePlatformId =
  | "instagram_reels"
  | "tiktok"
  | "youtube_shorts"
  | "owned_web"
  | "self_studio";

export type SmartCollectionId =
  | "all"
  | "source_assets"
  | "awaiting_approval"
  | "needs_revision"
  | "final_deliverables";

export interface CommissionTrackSpec {
  id: CommissionTrackId;
  stepBadge: string;
  title: string;
  subtitle: string;
  summary: string;
  productionMode: "creator" | "studio";
  requiresInfluencerSteps: boolean;
  defaultAspect: "9:16" | "16:9" | "4:5" | "1:1";
  includedStructure: readonly string[];
  workflowSteps: readonly string[];
  deliverableDestination: {
    badge: string;
    label: string;
    targetPath: "/brand/studio" | "/brand" | "/brand/library";
  };
}

export interface BrandWorkspaceTourStep {
  id: "intro" | "tracks" | "collections" | "player" | "share";
  stepNumber: number;
  totalSteps: number;
  type: "MODAL" | "POINT";
  anchor: "CENTER" | "TOP" | "BOTTOM" | "LEFT" | "RIGHT";
  targetSection: string;
  kicker: string;
  title: string;
  body: string;
  highlightPills: readonly string[];
}

export interface ShareLinkConfig {
  title: string;
  layout: ShareLayoutMode;
  access: "public" | "restricted";
  allowComments: boolean;
  allowApprovals: boolean;
  allowDownloads: boolean;
  passphraseEnabled: boolean;
  passphrase: string;
  expirationDays: 7 | 14 | 30 | null;
  watermark: boolean;
  recipientEmail: string;
}

export interface CollageFolderItem {
  id: string;
  title: string;
  kind: "video" | "image" | "audio" | "brief";
  meta: string;
  badge: string;
  previewTone: string;
  mediaUrl?: string;
}

export interface CollageFolderSummary {
  id: "brand_source" | "review_cuts" | "master_stems";
  title: string;
  subtitle: string;
  itemCount: number;
  updatedLabel: string;
  items: readonly CollageFolderItem[];
}

export const DEFAULT_SHARE_LINK_CONFIG: ShareLinkConfig = {
  title: "1080p Master Review Link",
  layout: "player",
  access: "public",
  allowComments: true,
  allowApprovals: true,
  allowDownloads: false,
  passphraseEnabled: false,
  passphrase: "",
  expirationDays: 14,
  watermark: false,
  recipientEmail: "",
};

/**
 * Returns the commission tracks available to the current organization.
 * When `generativeClosed` is true (e.g. Morphic sandbox), `template_build` (Self-Studio template commissioning)
 * is strictly excluded so self-serve AI capabilities are never exposed.
 *
 * Titles, one-liners and summaries are the wording of the video screen's "제작 의뢰" cards
 * (messages/studio-video.ts `requests.tracks`, docs/BRAND-STUDIO-V3.md §6), so the screen and this wizard
 * say the same thing. Counts, versions and resolutions below are unchanged from before.
 */
export function getAvailableCommissionTracks(options?: {
  generativeClosed?: boolean;
  locale?: string;
}): CommissionTrackSpec[] {
  const isEn = options?.locale === "en";
  const generativeClosed = Boolean(options?.generativeClosed);
  const words = (isEn ? studioVideoEn : studioVideoKo).requests.tracks;

  const creatorCampaign: CommissionTrackSpec = {
    id: "creator_campaign",
    stepBadge: isEn ? "Creator campaign" : "크리에이터 캠페인",
    title: words.creator_campaign.title,
    subtitle: words.creator_campaign.line,
    summary: words.creator_campaign.summary,
    productionMode: "creator",
    requiresInfluencerSteps: true,
    defaultAspect: "9:16",
    includedStructure: isEn
      ? ["5-step campaign brief", "Creator shortlist and approvals", "3 asset and cut folders"]
      : ["5단계 캠페인 조건", "크리에이터 후보 비교와 확정", "시사·납품 폴더 3개"],
    workflowSteps: isEn
      ? ["1. Format and brief", "2. Creator shortlist", "3. Master cut review", "4. Posts and live report"]
      : ["1. 포맷과 조건 확정", "2. 크리에이터 후보 확정", "3. 마스터 컷 검수", "4. 릴스·틱톡 게시와 실시간 리포트"],
    deliverableDestination: {
      badge: isEn ? "Creator posts and report" : "크리에이터 게시와 성과 리포트",
      label: isEn
        ? "Creators post on their own Reels and TikTok accounts; views and saves come back to the campaign page"
        : "크리에이터가 각자 릴스·틱톡 계정에 올리고, 조회수와 저장 수는 캠페인 화면에 모여요",
      targetPath: "/brand",
    },
  };

  const templateBuild: CommissionTrackSpec = {
    id: "template_build",
    stepBadge: isEn ? "Scale production" : "스케일 제작",
    title: words.template_build.title,
    subtitle: words.template_build.line,
    summary: words.template_build.summary,
    productionMode: "studio",
    requiresInfluencerSteps: false,
    defaultAspect: "9:16",
    includedStructure: isEn
      ? ["1-page brief", "Sample cut review", "Arrives in your studio once approved"]
      : ["1페이지 의뢰서", "샘플 컷 시사", "승인하면 스튜디오에 들어가요"],
    workflowSteps: isEn
      ? ["1. Send the product and mood", "2. We design the master format", "3. Sample cut review", "4. Your template in the studio"]
      : ["1. 제품과 분위기 보내기", "2. 마스터 포맷 설계", "3. 샘플 영상 타임코드 검수", "4. 스튜디오 전용 템플릿으로 받기"],
    deliverableDestination: {
      badge: isEn ? "Your template in the studio" : "스튜디오 전용 템플릿",
      label: isEn
        ? "Once approved, the master format arrives in your studio as your own template, ready to vary"
        : "승인하면 마스터 포맷이 스튜디오에 전용 템플릿으로 들어와, 그다음부터 직접 바꿔 만들 수 있어요",
      targetPath: "/brand/studio",
    },
  };

  const studioFilm: CommissionTrackSpec = {
    id: "studio_film",
    stepBadge: isEn ? "Single video" : "단일 영상",
    title: words.studio_film.title,
    subtitle: words.studio_film.line,
    summary: words.studio_film.summary,
    productionMode: "studio",
    requiresInfluencerSteps: false,
    defaultAspect: "16:9",
    includedStructure: isEn
      ? ["1-page production brief", "v1 → v2 version review", "1080p master and share link"]
      : ["1페이지 영상 브리프", "v1 → v2 버전 비교 시사", "1080p 마스터 납품과 공유 링크"],
    workflowSteps: isEn
      ? ["1. 1-page film brief", "2. First cut (v1)", "3. Timecode and on-screen notes (v2)", "4. 1080p master download"]
      : ["1. 1페이지 영상 기획과 에셋 전달", "2. 1차 편집본(v1) 시사", "3. 타임코드·화면 위치 의견 반영(v2)", "4. 1080p 최종 마스터 승인과 다운로드"],
    deliverableDestination: {
      badge: isEn ? "1080p master delivery" : "1080p 마스터 납품",
      label: isEn
        ? "Approved 1080p clean MP4 + stems archive directly in your Content Library"
        : "승인된 1080p 무로고 클린 MP4와 사운드 마스터가 [콘텐츠 보관함]에 영구 아카이빙",
      targetPath: "/brand/library",
    },
  };

  if (generativeClosed) {
    return [creatorCampaign, studioFilm];
  }
  return [creatorCampaign, templateBuild, studioFilm];
}

/**
 * Frame.io 2026 Walnut-style Interactive Guided Tour steps.
 * Explains each capability clearly with a modal welcome + anchored point callouts.
 */
export function getBrandWorkspaceTourSteps(options?: {
  generativeClosed?: boolean;
  locale?: string;
}): BrandWorkspaceTourStep[] {
  const isEn = options?.locale === "en";
  const generativeClosed = Boolean(options?.generativeClosed);
  const totalSteps = 5;

  return [
    {
      id: "intro",
      stepNumber: 1,
      totalSteps,
      type: "MODAL",
      anchor: "CENTER",
      targetSection: "tour-intro",
      kicker: isEn ? "INTERACTIVE WORKSPACE TOUR · 1 MIN" : "워크스페이스 인터랙티브 투어 · 1분 가이드",
      title: isEn
        ? "One Room for Asset Intake, Frame-Accurate Review & Custom Share Links"
        : "에셋 전달부터 프레임 단위 시사, 커스텀 공유 링크까지 한 화면에서",
      body: isEn
        ? "Explore how your brand exchanges source files with YAGI, reviews 1080p cuts with spatial pins, tracks approval states, and shares custom review links with stakeholders."
        : "복잡한 이메일·메신저 파일 주고받기 없이, 브랜드 에셋 폴더 정리부터 프레임 단위 타임코드·화면 핀 피드백, 임원진 맞춤 공유 링크 설정까지 핵심 기능을 5단계로 안내합니다.",
      highlightPills: isEn
        ? ["Collage Asset Folders", "Frame & Spatial Pin QA", "Custom Share Builder"]
        : ["비주얼 콜라주 에셋 폴더", "프레임 · 화면 좌표 핀 시사", "레이아웃 · 보안 공유 빌더"],
    },
    {
      id: "tracks",
      stepNumber: 2,
      totalSteps,
      type: "POINT",
      anchor: "BOTTOM",
      targetSection: "tour-tracks",
      kicker: isEn ? "Step 2 · Ways to ask our team" : "2단계 · 저희 팀에 맡기는 방법",
      title: isEn
        ? generativeClosed
          ? "Two ways to work with our team"
          : "Make it yourself, or ask our team in three ways"
        : generativeClosed
          ? "저희 팀에 맡기는 두 가지 방법"
          : "직접 만들거나, 저희 팀에 세 가지로 맡겨요",
      body: isEn
        ? generativeClosed
          ? "A creator campaign or a single brand film. Each one opens its own room for assets and review."
          : "Make it yourself in the studio, or ask our team for a creator campaign, scale production from one master format, or a single brand film. Each one opens this review room."
        : generativeClosed
          ? "크리에이터 캠페인 제작과 단일 브랜드 필름 중 목적에 맞는 쪽을 고르면, 필요한 입력만 받고 바로 시작해요."
          : "스튜디오에서 직접 만들 수도 있고, 크리에이터 캠페인 제작, 마스터 포맷 하나로 여러 편을 만드는 스케일 제작, 단일 브랜드 필름을 저희 팀에 맡길 수도 있어요. 셋 다 이 시사 룸으로 이어져요.",
      highlightPills: generativeClosed
        ? isEn
          ? ["Creator campaign", "Single video: a brand film"]
          : ["크리에이터 캠페인 제작", "단일 영상: 브랜드 필름"]
        : isEn
          ? ["Creator campaign", "Scale production", "Single video: a brand film"]
          : ["크리에이터 캠페인 제작", "스케일 제작", "단일 영상: 브랜드 필름"],
    },
    {
      id: "collections",
      stepNumber: 3,
      totalSteps,
      type: "POINT",
      anchor: "TOP",
      targetSection: "tour-collections",
      kicker: isEn ? "STEP 3 · COLLAGE ASSET FOLDERS & STATUS" : "STEP 3 · 비주얼 콜라주 폴더 & 승인 상태 메타데이터",
      title: isEn
        ? "Visual Collage Folders & Instant Approval Status Pills"
        : "제품·로고 원본부터 v1→v2 시사 컷까지 한눈에 보이는 콜라주 폴더",
      body: isEn
        ? "Source files, work-in-progress cuts, and approved 1080p masters are organized into 3 visual collage folders. Filter deliverables by status (Awaiting Approval, Needs Revision, Ready for Release) with one click."
        : "브랜드가 올린 제품·로고 원본 폴더, YAGI가 업로드한 버전별 시사 컷 폴더, 최종 납품 마스터 폴더가 3분할 썸네일 콜라주로 자동 정리됩니다. 각 영상 카드 아래에서 [검수 대기 / 수정 요청 / 최종 승인] 상태와 배포 매체를 즉시 확인·전환할 수 있습니다.",
      highlightPills: isEn
        ? ["Awaiting Approval", "Needs Revision", "Ready for Release"]
        : ["검수 대기", "수정 요청", "최종 승인 (납품 완료)"],
    },
    {
      id: "player",
      stepNumber: 4,
      totalSteps,
      type: "POINT",
      anchor: "RIGHT",
      targetSection: "tour-player",
      kicker: isEn ? "STEP 4 · FRAME-ACCURATE & SPATIAL PIN REVIEW" : "STEP 4 · 프레임 단위 타임코드 & 화면 위치 핀 피드백",
      title: isEn
        ? "Click Directly on the Video Frame to Drop a Timecode & Spatial Pin"
        : "영상 화면 위 원하는 곳을 클릭해 정확한 시간(00:02.12)과 위치 핀을 남기세요",
      body: isEn
        ? "Enable Pin on Frame, click any spot on the video (e.g. logo kerning or lighting highlight), and leave a note. Clicking a comment chip jumps the player to that exact frame and highlights the pin."
        : "『몇 초쯤 로고 조금 키워주세요』처럼 모호하게 설명할 필요가 없습니다. [화면 위치 핀 찍기]를 켜고 영상 위 원하는 지점을 클릭하면 타임코드(예: 00:02.12)와 화면 좌표(x, y)가 동시에 기록되며, 코멘트 클릭 시 해당 프레임으로 즉시 이동합니다.",
      highlightPills: isEn
        ? ["Spatial Frame Pin (x, y)", "Frame Step (±1f)", "v1 ↔ v2 Version Stack"]
        : ["화면 좌표 핀(x, y)", "1프레임 정밀 이동(±1f)", "v1 ↔ v2 버전 즉시 비교"],
    },
    {
      id: "share",
      stepNumber: 5,
      totalSteps,
      type: "POINT",
      anchor: "LEFT",
      targetSection: "tour-share",
      kicker: isEn ? "STEP 5 · CUSTOM SHARE LINK BUILDER" : "STEP 5 · 맞춤형 공유 링크 빌더 (레이아웃 · 보안 설정)",
      title: isEn
        ? "Customize Presentation Layout (Grid · Reel · Player) & Security Controls"
        : "공유 대상에 맞춰 레이아웃(Grid · Reel · Player)과 다운로드·비밀번호 권한을 제어하세요",
      body: isEn
        ? "Open the Share Builder to switch how external reviewers see your assets (Grid, List, Reel, or Cinema Player) and toggle comments, one-click approvals, MP4 downloads, passphrase lock, expiration date, and watermark."
        : "외부 임원진이나 파트너사에게 시사 링크를 보낼 때 단순 URL 복사를 넘어, 보여줄 화면 레이아웃(Grid / List / Reel / Player)을 고르고 코멘트 허용·원본 다운로드 허용·비밀번호 잠금·만료일·시사용 워터마크를 세밀하게 설정해 공유할 수 있습니다.",
      highlightPills: isEn
        ? ["Grid · Reel · Player", "Passphrase & Expiry", "Preview Watermark"]
        : ["Grid · Reel · Player 뷰", "비밀번호 · 만료일 잠금", "시사용 워터마크 토글"],
    },
  ];
}

/**
 * Builds the 3 Playbook/Frame.io V4 Collage Folders for a project room.
 */
export function buildCollageFolders(options: {
  projectId: string;
  locale?: string;
  contents: readonly {
    id: string;
    title: string;
    version: number;
    decision: string;
    mediaUrl: string;
  }[];
}): CollageFolderSummary[] {
  const isEn = options.locale === "en";
  const defaultCutItems: CollageFolderItem[] = [
    {
      id: "cut-v2",
      title: "MASTER_CUT_9x16_v2.mp4",
      kind: "video",
      meta: "00:15 · 1080p",
      badge: "v2",
      previewTone: "linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)",
      mediaUrl: "/reel/brands/house-runway-1080p.mp4",
    },
    {
      id: "cut-v1",
      title: "FIRST_CUT_9x16_v1.mp4",
      kind: "video",
      meta: "00:15 · 1080p",
      badge: "v1",
      previewTone: "linear-gradient(135deg, #1e293b 0%, #334155 100%)",
      mediaUrl: "/reel/brands/studio-editorial-blue-1080p.mp4",
    },
    {
      id: "cut-feed",
      title: "FEED_CUT_4x5_v2.mp4",
      kind: "video",
      meta: "00:15 · 4:5",
      badge: "4:5",
      previewTone: "linear-gradient(135deg, #172554 0%, #3875c5 100%)",
      mediaUrl: "/reel/brands/house-french-blue-hero-1080p.mp4",
    },
  ];
  const mappedCuts: CollageFolderItem[] = options.contents.slice(0, 3).map((c) => ({
    id: c.id,
    title: `${c.title} (v${c.version})`,
    kind: "video" as const,
    meta: "1080p · 24fps",
    badge: `v${c.version}`,
    previewTone: "linear-gradient(135deg, #172554 0%, #1e3a8a 100%)",
    mediaUrl: c.mediaUrl,
  }));
  const cutItems: CollageFolderItem[] = [
    ...mappedCuts,
    ...defaultCutItems.slice(mappedCuts.length),
  ].slice(0, 3);

  return [
    {
      id: "brand_source",
      title: isEn ? "Brand Source Assets" : "브랜드 전달 원본 에셋",
      subtitle: isEn ? "Product packshots · Vector logo · Reference mood" : "제품 누끼 · 로고 원본 · 레퍼런스 보드",
      itemCount: 6,
      updatedLabel: isEn ? "Synced with Intake" : "에셋 인테이크 연동됨",
      items: [
        {
          id: "src-product",
          title: isEn ? "Product_Hero_Packshot.png" : "제품_전면_고해상도_원본.png",
          kind: "image",
          meta: "4096×4096 · PNG",
          badge: "PACKSHOT",
          previewTone: "linear-gradient(135deg, #1e3a8a 0%, #3063a7 100%)",
        },
        {
          id: "src-logo",
          title: isEn ? "Brand_Wordmark_Lockup.svg" : "브랜드_공식_로고_원본.svg",
          kind: "image",
          meta: "Vector · SVG",
          badge: "LOGO",
          previewTone: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        },
        {
          id: "src-mood",
          title: isEn ? "Campaign_Key_Look_Ref.pdf" : "캠페인_키룩_무드보드.pdf",
          kind: "brief",
          meta: "12 Pages · PDF",
          badge: "MOOD",
          previewTone: "linear-gradient(135deg, #1e293b 0%, #334155 100%)",
        },
      ],
    },
    {
      id: "review_cuts",
      title: isEn ? "Review Cuts & Version Stack" : "시사 영상 · 버전 스택 (v1 → v2)",
      subtitle: isEn ? "Frame-accurate timecode & spatial pin review" : "타임코드 · 화면 위치 핀 피드백 대상 컷",
      itemCount: Math.max(options.contents.length, 3),
      updatedLabel: isEn ? "v2 Latest Cut" : "최신 v2 업로드됨",
      items: cutItems,
    },
    {
      id: "master_stems",
      title: isEn ? "1080p Masters & Audio Stems" : "최종 납품 마스터 · 사운드 스템",
      subtitle: isEn ? "Clean 1080p MP4 · -14 LUFS sound master · Captions" : "무로고 클린 1080p MP4 · -14 LUFS 음원",
      itemCount: 4,
      updatedLabel: isEn ? "Ready on Approval" : "최종 승인 시 즉시 잠금 해제",
      items: [
        {
          id: "stem-master",
          title: isEn ? "FINAL_CLEAN_1080P_9x16.mp4" : "최종_무로고_클린마스터_9x16.mp4",
          kind: "video",
          meta: "1080×1920 · H.264",
          badge: "MASTER",
          previewTone: "linear-gradient(135deg, #064e3b 0%, #047857 100%)",
        },
        {
          id: "stem-audio",
          title: isEn ? "SOUND_MASTER_48KHZ_14LUFS.wav" : "사운드_마스터_48kHz_14LUFS.wav",
          kind: "audio",
          meta: "48kHz 24-bit · WAV",
          badge: "-14 LUFS",
          previewTone: "linear-gradient(135deg, #1e1b4b 0%, #3730a3 100%)",
        },
        {
          id: "stem-clean",
          title: isEn ? "TEXTLESS_CLEAN_PLATE.mp4" : "자막제거_클린본_2차광고용.mp4",
          kind: "video",
          meta: "1080×1920 · Clean",
          badge: "CLEAN",
          previewTone: "linear-gradient(135deg, #0f172a 0%, #334155 100%)",
        },
      ],
    },
  ];
}

/**
 * Generates a deterministic, clean share URL reflecting the chosen Frame.io V4 Share Builder config.
 */
export function buildSharePreviewUrl(
  projectId: string,
  versionNumber: number,
  config: Pick<ShareLinkConfig, "layout" | "access" | "expirationDays" | "watermark">
): string {
  const slug = (projectId || "brand-cut").slice(0, 12);
  const params = new URLSearchParams();
  params.set("v", String(versionNumber));
  params.set("view", config.layout);
  if (config.access === "restricted") params.set("access", "restricted");
  if (config.expirationDays) params.set("exp", `${config.expirationDays}d`);
  if (config.watermark) params.set("wm", "1");
  return `https://brand.twings.app/s/${slug}?${params.toString()}`;
}
