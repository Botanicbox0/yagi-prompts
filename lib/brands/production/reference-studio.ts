import type { BrandClientCategory } from "@/lib/brands/category-experience";

/**
 * Multi-Reference Slot Composer, 5 Core Deliverable Tracks & 5-Model Image Suite (`brand.twings.app/brand/studio`).
 *
 * Core Service Pillars (5 Core Deliverable Tracks):
 *   1. `image` — 이미지 (1~4번 멀티 레퍼런스 생성 + 극소 부위 정밀 수정 + 색감/질감 상시 고정)
 *   2. `video` — 영상 (화보 시작 프레임 고정 + 720p 동선 검수 → 1080p 사운드 마스터)
 *   3. `creator_format` — 크리에이터 캠페인용 영상 (셀프 포맷 빌더 / 스튜디오 전담 제작 의뢰)
 *   4. `creator_distribution` — 크리에이터 캠페인용 영상 + 유통까지 (포맷 제작 + 3,000+ 팔로워 크리에이터 다중 시딩 + IG/TikTok/Shorts 유통 + D+21 ROI 리포트 & 2차 광고 활용권)
 *   5. `audio` — 오디오 (시그니처 BGM + 현장 폴리/공간음 + Act 1 -3 dB 자동 더킹 + -14 LUFS 상업 마스터링)
 *
 * Image Model Lineup (5 Models):
 *   - `gpt_image_2_6` (`GPT Image 2.6`)
 *   - `nano_banana_pro` (`Nano Banana Pro`)
 *   - `nano_banana_2_1` (`Nano Banana 2.1`)
 *   - `nano_banana_2_0` (`Nano Banana 2.0`)
 *   - `seedream_5_0_pro` (`Seedream 5.0 Pro`)
 */

export type BrandCoreDeliverableTrackId =
  | "image"
  | "video"
  | "creator_format"
  | "creator_distribution"
  | "audio";

export interface BrandCoreDeliverableTrackSpec {
  id: BrandCoreDeliverableTrackId;
  orderNumber: string;
  shortLabelKo: string;
  shortLabelEn: string;
  titleKo: string;
  titleEn: string;
  badgeKo: string;
  badgeEn: string;
  summaryKo: string;
  summaryEn: string;
  deliverablesKo: readonly [string, string, string];
  deliverablesEn: readonly [string, string, string];
  turnaroundKo: string;
  turnaroundEn: string;
  priceGuideKo: string;
  priceGuideEn: string;
  previewImage: string;
}

export const BRAND_CORE_DELIVERABLE_TRACKS: readonly BrandCoreDeliverableTrackSpec[] =
  [
    {
      id: "image",
      orderNumber: "01",
      shortLabelKo: "이미지",
      shortLabelEn: "Image",
      titleKo: "이미지 스튜디오 (멀티 레퍼런스 생성 · 극소 부위 수정)",
      titleEn: "Image Studio (1–4 Ref Composite & Micro-Region Edit)",
      badgeKo: "화보 생성 · 제품 교체 · 부분 리터칭",
      badgeEn: "Lookbook · Product Swap · Smart Mask Edit",
      summaryKo:
        "1~4번 역할별 레퍼런스(인물·배경·감도·색감) 조합 생성과 캔버스 드래그 극소 부위 정밀 수정, 색감·질감 핀 고정을 한 화면에서 처리합니다.",
      summaryEn:
        "Combine 1–4 role-locked references, run surgical micro-region Smart Mask edits, and pin brand color & texture references in one studio.",
      deliverablesKo: [
        "1~4번 레퍼런스 조합 캠페인 화보 · 전신 룩북 (2K/4K)",
        "1번 장면 유지 → 2번 우리 제품 정밀 교체 이커머스 팩샷",
        "캔버스 드래그 영역만 고치는 스마트 레이어 마스크 부분 수정",
      ],
      deliverablesEn: [
        "1–4 slot multi-reference editorial lookbook & campaign stills (2K/4K)",
        "Slot 1 scene preservation -> Slot 2 exact SKU product swap packshots",
        "Non-destructive Smart Layer Mask micro-region retouching",
      ],
      turnaroundKo: "즉시 생성 (컷당 15~35초)",
      turnaroundEn: "Instant (15–35s per cut)",
      priceGuideKo: "5장 세트 400원~1,100원 (34~95 cr)",
      priceGuideEn: "₩400–₩1,100 per 5-cut set (34–95 cr)",
      previewImage: "/reel/brands/slot-1-subject-editorial.jpg",
    },
    {
      id: "video",
      orderNumber: "02",
      shortLabelKo: "영상",
      shortLabelEn: "Video",
      titleKo: "영상 스튜디오 (첫 프레임 고정 · 720p 검수 → 1080p 마스터)",
      titleEn: "Video Studio (Start-Frame Lock · 720p Check -> 1080p Master)",
      badgeKo: "2단계 검수 · 1080p 브랜드 필름",
      badgeEn: "2-Stage Gate · 1080p Brand Film",
      summaryKo:
        "이미지 스튜디오에서 확정한 화보를 시작 프레임으로 잠그고, 720p 프리뷰로 카메라 동선·표정을 먼저 검수한 뒤 통과한 컷만 1080p 마스터 영상으로 마감합니다.",
      summaryEn:
        "Lock your approved key visual as Frame 1, verify camera blocking in 720p first, and finish only approved takes into 1080p master films.",
      deliverablesKo: [
        "화보 시작 프레임 100% 고정 9:16 릴스 · 16:9 캠페인 필름",
        "Stage 1 (720p 동선·물리 검수) → Stage 2 (1080p 그레인·색보정 마감)",
        "카메라 무빙(돌리 인·패닝·원테이크) 및 컷 전환 타이밍 제어",
      ],
      deliverablesEn: [
        "Start-frame locked 9:16 Reels & 16:9 widescreen campaign films",
        "Stage 1 (720p motion check) -> Stage 2 (1080p optical & grain master)",
        "Camera blocking (dolly-in, pan, one-take) & beat-synced cut control",
      ],
      turnaroundKo: "720p 프리뷰 약 60초 · 1080p 마감 약 90초",
      turnaroundEn: "~60s for 720p preview · ~90s for 1080p master",
      priceGuideKo: "720p 검수 1,800원 (145 cr) · 1080p 마감 5,500원 (440 cr)",
      priceGuideEn: "720p check ₩1,800 (145 cr) · 1080p master ₩5,500 (440 cr)",
      previewImage: "/reel/brands/house-french-blue-hero-1080p.jpg",
    },
    {
      id: "creator_format",
      orderNumber: "03",
      shortLabelKo: "크리에이터 캠페인 영상 (셀프 · 의뢰)",
      shortLabelEn: "Creator Campaign Video (Self · Commission)",
      titleKo: "크리에이터 캠페인용 영상 제작 (셀프 포맷 빌더 · 스튜디오 의뢰)",
      titleEn: "Creator Campaign Format Studio (Self-Build or Studio Commission)",
      badgeKo: "셀프 제작 또는 D+3 전담 의뢰",
      badgeEn: "Self-Serve Builder or D+3 Custom Commission",
      summaryKo:
        "크리에이터가 정면 셀카 1장만 넣으면 우리 브랜드 제품·착장·배경·색감이 그대로 입혀진 주인공 영상이 나오는 캠페인 전용 포맷을 직접 만들거나 전담 디렉터에게 의뢰합니다.",
      summaryEn:
        "Build a reusable campaign video format where any creator drops 1 front selfie to star in your locked product, outfit, set, and color grade—or commission our directors.",
      deliverablesKo: [
        "셀프 빌더: [크리에이터 얼굴 슬롯] + [우리 제품·배경·색감 고정] 포맷 즉시 생성",
        "스튜디오 의뢰: 제품 사진만 전달하면 D+3일 내 맞춤 캠페인 포맷 설계·검수 납품",
        "크리에이터 1인당 셀카 1장으로 동일 브랜드 퀄리티 영상 무제한 파생",
      ],
      deliverablesEn: [
        "Self-Builder: Lock [Creator Selfie Slot] + [Brand Product, Set & Color] in minutes",
        "Commissioned: Send product photos and receive a custom format within D+3 days",
        "Every creator generates consistent brand-grade videos from 1 front selfie",
      ],
      turnaroundKo: "셀프 즉시 생성 · 스튜디오 의뢰 D+3 확정",
      turnaroundEn: "Instant (Self) · D+3 confirmed (Commissioned)",
      priceGuideKo: "셀프 포맷 테스트 1,800원~ · 전담 포맷 제작 의뢰 맞춤 견적",
      priceGuideEn: "Self format test from ₩1,800 · Custom format commission on brief",
      previewImage: "/reel/brands/slot-3-pose-lowangle-lookbook.jpg",
    },
    {
      id: "creator_distribution",
      orderNumber: "04",
      shortLabelKo: "크리에이터 캠페인 영상 + 유통",
      shortLabelEn: "Creator Campaign + Distribution",
      titleKo: "크리에이터 캠페인 영상 제작 + 다중 시딩 유통 · 성과 리포트",
      titleEn: "Creator Campaign Format + Multi-Creator Seeding & ROI Distribution",
      badgeKo: "영상 제작 + 크리에이터 시딩 + 2차 활용권",
      badgeEn: "Format + Creator Seeding + Ad Usage Rights",
      summaryKo:
        "캠페인 영상 포맷 제작에서 끝나지 않고, 팔로워 3,000+ 검증 크리에이터 모집·동시 게시(IG 릴스·틱톡·쇼츠)·실시간 조회수 리포트·2차 광고 활용권(Usage Rights)까지 원스톱으로 유통합니다.",
      summaryEn:
        "End-to-end execution from custom campaign format creation to 3,000+ follower creator matching, simultaneous seeding (IG Reels, TikTok, Shorts), live ROI reporting, and 2nd-use paid ad rights.",
      deliverablesKo: [
        "팔로워 3,000+ 카테고리 매칭 크리에이터 10명 / 30명 / 50명+ 동시 시딩 유통",
        "표준 타임라인: 의뢰 → D+3 포맷 확정 → D+7 모집 → D+14 동시 게시 → D+21 성과 리포트",
        "게시 완료 영상 원본 클린본 다운로드 및 메타/틱톡 2차 퍼포먼스 광고 활용권",
      ],
      deliverablesEn: [
        "Matched 3,000+ follower creators (10 / 30 / 50+ cohort seeding across IG, TikTok, Shorts)",
        "Timeline: Brief -> D+3 Format Lock -> D+7 Cohort Match -> D+14 Post -> D+21 ROI Report",
        "Clean 1080p master downloads + cleared 2nd-use paid ad rights (Meta / TikTok Spark Ads)",
      ],
      turnaroundKo: "D+3 포맷 확정 · D+14 크리에이터 일괄 게시 · D+21 리포트",
      turnaroundEn: "D+3 Format · D+14 Cohort Post · D+21 Final Report",
      priceGuideKo: "10인 시드 팩 · 30인 그로스 팩 · 50인+ 메가 런칭 패키지",
      priceGuideEn: "10-Creator Seed · 30-Creator Growth · 50+ Mega Launch Packages",
      previewImage: "/reel/brands/studio-editorial-blue-1080p.jpg",
    },
    {
      id: "audio",
      orderNumber: "05",
      shortLabelKo: "오디오",
      shortLabelEn: "Audio",
      titleKo: "오디오 스튜디오 (시그니처 BGM · 폴리 공간음 · 상업 마스터링)",
      titleEn: "Audio Studio (Signature BGM · Foley Spatial Sound · -14 LUFS Master)",
      badgeKo: "BGM · 폴리 · -14 LUFS 상업 음원",
      badgeEn: "BGM · Foley · -14 LUFS Commercial Master",
      summaryKo:
        "브랜드 무드에 맞춘 시그니처 BGM 생성부터 원단 스침·유리 결로·발걸음 등 리얼 폴리(Foley) 사운드, 대사 구간 자동 더킹(Act 1 -3 dB), -14 LUFS 상업 음원 마스터링까지 완성합니다.",
      summaryEn:
        "Compose brand-tailored BGM, tactile Foley & room tone, automatic voiceover ducking (Act 1 -3 dB), and -14 LUFS / -1 dBTP commercial loudness mastering.",
      deliverablesKo: [
        "브랜드 카테고리별 시그니처 BGM & 비트 드롭 싱크 오디오 트랙",
        "현장 폴리(Foley: 구두 발걸음·실크 스침·보틀 결로·셔터음) + 무BGM 현장음 전용 믹스",
        "나레이션/대사 구간 Act 1 -3 dB 자동 더킹 & -14 LUFS / -1 dBTP 라우드니스 마스터",
      ],
      deliverablesEn: [
        "Category-tailored signature BGM with frame-accurate beat-drop sync",
        "Tactile Foley stems (heels, silk rustle, glass clink, shutter) + No-BGM live ambient mix",
        "Automatic Act 1 -3 dB dialogue ducking & -14 LUFS / -1 dBTP broadcast master",
      ],
      turnaroundKo: "즉시 생성 및 영상 프레임 자동 싱크 (약 25초)",
      turnaroundEn: "Instant generation & frame-accurate sync (~25s)",
      priceGuideKo: "트랙당 900원 (75 cr) · 상업 광고 음원 라이선스 포함",
      priceGuideEn: "₩900 per track (75 cr) · Commercial ad sync license included",
      previewImage: "/reel/brands/slot-4-color-french-cobalt.jpg",
    },
  ];

export type StudioReferenceWorkflowId =
  | "lookbook_composite"
  | "product_swap";

export type StudioReferenceSlotNumber = 1 | 2 | 3 | 4;

export interface StudioReferenceSlotSpec {
  slotNumber: StudioReferenceSlotNumber;
  tagKo: string;
  tagEn: string;
  roleTitleKo: string;
  roleTitleEn: string;
  lockRuleKo: string;
  lockRuleEn: string;
  required: boolean;
  defaultThumb: string;
  defaultAssetNameKo: string;
  defaultAssetNameEn: string;
}

export interface StudioReferenceWorkflowPreset {
  id: StudioReferenceWorkflowId;
  labelKo: string;
  labelEn: string;
  summaryKo: string;
  summaryEn: string;
  formulaBadgeKo: string;
  formulaBadgeEn: string;
  defaultPromptKo: string;
  defaultPromptEn: string;
  quickRecipesKo: readonly [string, string, string];
  quickRecipesEn: readonly [string, string, string];
  slots: readonly [
    StudioReferenceSlotSpec,
    StudioReferenceSlotSpec,
    StudioReferenceSlotSpec,
    StudioReferenceSlotSpec,
  ];
}

/**
 * Founder-specified 5 Image Models for Brand Studio:
 *   1. `gpt_image_2_6` (`GPT Image 2.6`)
 *   2. `nano_banana_pro` (`Nano Banana Pro`)
 *   3. `nano_banana_2_1` (`Nano Banana 2.1`)
 *   4. `nano_banana_2_0` (`Nano Banana 2.0`)
 *   5. `seedream_5_0_pro` (`Seedream 5.0 Pro`)
 */
export type BrandStudioImageModelId =
  | "gpt_image_2_6"
  | "nano_banana_pro"
  | "nano_banana_2_1"
  | "nano_banana_2_0"
  | "seedream_5_0_pro";

export interface BrandStudioImageModelSpec {
  id: BrandStudioImageModelId;
  nameKo: string;
  nameEn: string;
  tierBadgeKo: string;
  tierBadgeEn: string;
  promptFormulaBadgeKo: string;
  promptFormulaBadgeEn: string;
  /** Short 1-line summary shown right inside the model selection card */
  shortTraitKo: string;
  shortTraitEn: string;
  /** Key strength tags shown as compact pills on the card */
  strengthsKo: readonly [string, string, string];
  strengthsEn: readonly [string, string, string];
  /** Detailed explanation of how the model behaves */
  detailDescriptionKo: string;
  detailDescriptionEn: string;
  /** Which deliverables / scenarios this model is best suited for */
  bestForDeliverablesKo: readonly [string, string, string];
  bestForDeliverablesEn: readonly [string, string, string];
  /** Recommended 1~4 reference slot combination for this model */
  recommendedSlotFormulaKo: string;
  recommendedSlotFormulaEn: string;
  /** Recommended workflow mode when this model is selected */
  preferredWorkflow: StudioReferenceWorkflowId;
  /** B2B credits for a 5-shot 2K set */
  creditsPer5Set: number;
  /** B2B card checkout KRW for a 5-shot 2K set */
  priceKrwPer5Set: number;
  /** B2B credits for 1 single 2K image */
  creditsPerSingle: number;
  supportedResolutions: readonly ("1K" | "2K" | "4K")[];
}

export const BRAND_STUDIO_IMAGE_MODELS: ReadonlyArray<BrandStudioImageModelSpec> =
  [
    {
      id: "gpt_image_2_6",
      nameKo: "GPT Image 2.6",
      nameEn: "GPT Image 2.6",
      tierBadgeKo: "복합 지시문 · 라벨 타이포 · 정밀 수정 플래그십",
      tierBadgeEn: "Flagship · Complex Briefs & Exact Typography",
      promptFormulaBadgeKo: "5단계 디렉터 브리프 (구도 → 레퍼런스 권한 → 착장/포즈 → 공간 → #HEX 조명)",
      promptFormulaBadgeEn: "5-Tier Director Brief (Crop -> Ref Authority -> Pose/Garment -> Space -> #HEX Light)",
      shortTraitKo:
        "까다로운 다중 조건 지시문 이행, 패키지·라벨 영문/한글 로고 철자 보존, 극소 부위 정밀 수정에 가장 강력한 플래그십 모델입니다",
      shortTraitEn:
        "Flagship precision for complex multi-constraint briefs, exact package label typography, and surgical micro-region edits",
      strengthsKo: ["라벨·로고 철자 무결성", "복합 디렉팅 100% 이행", "극소 부위 스마트 편집"],
      strengthsEn: ["Exact Label Typography", "Complex Brief Fidelity", "Surgical Region Edit"],
      detailDescriptionKo:
        "5단계 크리에이티브 디렉터 브리프 구조를 정밀하게 해석하여, 1번 레퍼런스에서는 얼굴만 가져오고 기존 배경·소품은 완전히 배제하는 등 까다로운 조건 분리와 제품 전면 로고·타이포그래피 보존을 동시에 달성합니다.",
      detailDescriptionEn:
        "Parses 5-tier creative director briefs with strict reference authority isolation—locking facial identity or bottle geometry from Slot 1 while cleanly discarding unwanted source props and preserving crisp label lettering.",
      bestForDeliverablesKo: [
        "제품 전면 라벨 글자와 심볼 로고가 1mm도 틀어지면 안 되는 메인 히어로 키비주얼",
        "1번 인물 얼굴만 유지하고 기존 의상·배경·소품은 완전히 새로 구성하는 하이엔드 화보",
        "캔버스 드래그 영역 안의 손 모양·소품·로고만 정밀 교정하는 부분 리터칭",
      ],
      bestForDeliverablesEn: [
        "Hero key visuals where front package typography and brand marks must remain razor-sharp",
        "Editorial portraits isolating facial likeness from Slot 1 while building a brand-new set and outfit",
        "Targeted micro-region corrections on hands, held props, and engraved hardware",
      ],
      recommendedSlotFormulaKo:
        "1번(인물 또는 베이스 단상) + 2번(우리 제품 정면 마스터) + 3번(라벨·소재 클로즈업) + 4번(#HEX 조명·색감)",
      recommendedSlotFormulaEn:
        "Slot 1 (Subject/Base) + Slot 2 (Product Master) + Slot 3 (Label Close-Up) + Slot 4 (#HEX Light Ref)",
      preferredWorkflow: "product_swap",
      creditsPer5Set: 95,
      priceKrwPer5Set: 1100,
      creditsPerSingle: 20,
      supportedResolutions: ["1K", "2K", "4K"],
    },
    {
      id: "nano_banana_pro",
      nameKo: "Nano Banana Pro",
      nameEn: "Nano Banana Pro",
      tierBadgeKo: "1~4번 멀티 레퍼런스 · 캠페인 화보 마스터",
      tierBadgeEn: "Master · 1–4 Slot Multi-Ref & 4K Lookbook",
      promptFormulaBadgeKo: "ALL-CAPS 섹션 잠금 (IDENTITY LOCK · COMPOSITION LOCK · POSE LOCK · COLOR GRADE)",
      promptFormulaBadgeEn: "ALL-CAPS Lock Blocks (IDENTITY LOCK · COMPOSITION LOCK · POSE LOCK · COLOR GRADE)",
      shortTraitKo:
        "1번 인물 + 2번 배경 + 3번 포즈 감도 + 4번 색감을 동시에 잠가 최대 4K 하이엔드 화보로 합성하는 멀티 레퍼런스 마스터입니다",
      shortTraitEn:
        "Master of locking Slot 1 (Person) + Slot 2 (Space) + Slot 3 (Pose Vibe) + Slot 4 (Color Grade) into 2K/4K editorial frames",
      strengthsKo: ["1~4번 슬롯 동시 잠금", "네이티브 2K·4K 화보", "조명·색온도 완벽 흡수"],
      strengthsEn: ["4-Slot Simultaneous Lock", "Native 2K/4K Output", "Seamless Color Transfer"],
      detailDescriptionKo:
        "IDENTITY LOCK·COMPOSITION LOCK·COLOR GRADE 블록 구조를 통해 1번 이미지의 이목구비, 2번 이미지의 건축 공간, 3번 이미지의 카메라 앵글, 4번 이미지의 프렌치 코발트/필름 톤을 구도 무너짐 없이 한 장의 4K급 화보로 결합합니다.",
      detailDescriptionEn:
        "Uses explicit IDENTITY LOCK, COMPOSITION LOCK, and COLOR GRADE compartments to fuse up to 4 references with zero composition drift and rich optical halation up to 4K.",
      bestForDeliverablesKo: [
        "1번 인물이 2번 배경에서 3번 이미지 감도와 4번 색감으로 서 있는 메인 캠페인 화보",
        "화보 확정 후 영상 스튜디오의 첫 프레임(Start Frame)으로 바로 넘길 고밀도 키프레임",
        "고정된 브랜드 색감 핀(Color Pin)과 질감 핀(Texture Pin)을 100% 반영한 시즌 룩북",
      ],
      bestForDeliverablesEn: [
        "Main campaign lookbooks combining Person (1) + Space (2) + Pose Vibe (3) + Color Grade (4)",
        "High-density 2K/4K keyframes ready to lock as Frame 1 in the Video Studio",
        "Season lookbooks enforcing pinned brand color temperature and 35mm grain",
      ],
      recommendedSlotFormulaKo:
        "1번(인물 마스터) + 2번(배경 공간) + 3번(포즈·사진 감도) + 4번(색감·조명 레퍼런스)",
      recommendedSlotFormulaEn:
        "Slot 1 (Model Identity) + Slot 2 (Space) + Slot 3 (Pose/Vibe) + Slot 4 (Color Grade Ref)",
      preferredWorkflow: "lookbook_composite",
      creditsPer5Set: 71,
      priceKrwPer5Set: 900,
      creditsPerSingle: 15,
      supportedResolutions: ["1K", "2K", "4K"],
    },
    {
      id: "nano_banana_2_1",
      nameKo: "Nano Banana 2.1",
      nameEn: "Nano Banana 2.1",
      tierBadgeKo: "1번 장면 → 2번 우리 제품 교체 · 프로덕션 표준",
      tierBadgeEn: "Production Standard · 1->2 Product Swap",
      promptFormulaBadgeKo: "고추론(High-Thinking) 장면 보존 + 타깃 제품 1:1 교체 프로토콜",
      promptFormulaBadgeEn: "High-Thinking Scene Lock + Target SKU 1:1 Swap Protocol",
      shortTraitKo:
        "1번 이미지의 조명·손 모양·접촉 그림자는 그대로 두고 제품만 2번 우리 제품으로 감쪽같이 교체하는 실무 표준 모델입니다",
      shortTraitEn:
        "High-thinking production workhorse for keeping Image 1's lighting, hands, and shadows while swapping in your SKU from Image 2",
      strengthsKo: ["1→2번 제품 정밀 교체", "손·접촉 그림자 보존", "높은 가성비·안정성"],
      strengthsEn: ["1->2 SKU Product Swap", "Hand & Contact Shadow Lock", "Fast Production ROI"],
      detailDescriptionKo:
        "고추론(Thinking High) 멀티모달 공간 인식을 바탕으로, 1번 베이스 장면의 원근감·테이블 반사광·모델 손가락 그립을 유지한 채 지정된 제품만 2번 레퍼런스 제품으로 위화감 없이 교체합니다.",
      detailDescriptionEn:
        "Leverages high-thinking spatial reasoning to preserve perspective, surface reflections, and finger occlusion in Image 1 while seamlessly swapping in your product from Image 2.",
      bestForDeliverablesKo: [
        "1번 이미지 속 기존 화장품·음료·오브제를 2번 이미지의 우리 제품으로 교체할 때",
        "모델 손에 들린 보틀·가방·패키지를 우리 브랜드 신제품으로 빠르게 바꿀 때",
        "상세페이지(PDP)용 다각도 제품 연출컷 5장 세트를 합리적인 비용으로 제작할 때",
      ],
      bestForDeliverablesEn: [
        "Replacing an existing bottle, jar, or object in Image 1 with your own product in Image 2",
        "Swapping held props (cosmetics, beverages, bags) in a model's hand without finger distortion",
        "Producing 5-cut e-commerce PDP product sets with consistent studio lighting",
      ],
      recommendedSlotFormulaKo:
        "1번(베이스 장면·손 구도) + 2번(교체할 우리 제품 정면) + 3번(제품 측면·질감) + 4번(색감 레퍼런스)",
      recommendedSlotFormulaEn:
        "Slot 1 (Base Scene/Hand) + Slot 2 (Target SKU Front) + Slot 3 (SKU Side Detail) + Slot 4 (Color Ref)",
      preferredWorkflow: "product_swap",
      creditsPer5Set: 48,
      priceKrwPer5Set: 600,
      creditsPerSingle: 10,
      supportedResolutions: ["1K", "2K", "4K"],
    },
    {
      id: "nano_banana_2_0",
      nameKo: "Nano Banana 2.0",
      nameEn: "Nano Banana 2.0",
      tierBadgeKo: "초고속 시안 탐색 · 구도/무드 스케치",
      tierBadgeEn: "Ultra-Fast Drafts · Angle & Mood Exploration",
      promptFormulaBadgeKo: "경량 멀티 레퍼런스 빠른 구도·비율·컬러 배리에이션",
      promptFormulaBadgeEn: "Lightweight Multi-Ref Fast Framing & Color Variation",
      shortTraitKo:
        "본 촬영 전 다양한 카메라 앵글·배경 무드·SNS 썸네일 구도를 가장 빠르고 경제적으로 대량 테스트할 때 적합합니다",
      shortTraitEn:
        "Fastest and most economical engine for exploring camera angles, moodboards, and 9:16 social thumbnail variations",
      strengthsKo: ["초고속 5컷 동시 시안", "최저 크레딧 비용", "다양한 앵글 빠른 비교"],
      strengthsEn: ["Ultra-Fast 5-Cut Drafts", "Lowest Credit Cost", "Rapid Angle Exploration"],
      detailDescriptionKo:
        "1~4번 레퍼런스의 핵심 구도와 색감 무드를 빠르게 결합해 10초대에 5장 시안 세트를 생성합니다. Nano Banana Pro나 GPT Image 2.6으로 최종 4K 마스터를 뽑기 전에 구도와 톤앤매너를 확정하는 용도로 이상적입니다.",
      detailDescriptionEn:
        "Generates 5-shot multi-reference concept sets in seconds at minimal credit cost—ideal for locking framing and lighting before final 2K/4K mastering in Nano Banana Pro or GPT Image 2.6.",
      bestForDeliverablesKo: [
        "캠페인 기획 단계에서 10~20가지 배경·앵글 조합을 빠르게 눈으로 비교할 때",
        "인스타그램 릴스·틱톡·쇼츠용 9:16 세로형 커버 썸네일 시안을 다량 제작할 때",
        "크리에이터 캠페인 포맷의 기본 무드보드와 스토리보드 프레임을 스케치할 때",
      ],
      bestForDeliverablesEn: [
        "Comparing 10–20 background and camera angle combinations during campaign pre-production",
        "Batch-creating 9:16 vertical cover thumbnails for Instagram Reels, TikTok, and Shorts",
        "Sketching storyboard frames for creator campaign formats before final lock",
      ],
      recommendedSlotFormulaKo:
        "1번(주제/인물) + 2번(배경 무드) + 3번(앵글 참고) + 4번(컬러 팔레트)",
      recommendedSlotFormulaEn:
        "Slot 1 (Subject) + Slot 2 (Mood Space) + Slot 3 (Angle Ref) + Slot 4 (Color Palette)",
      preferredWorkflow: "lookbook_composite",
      creditsPer5Set: 34,
      priceKrwPer5Set: 400,
      creditsPerSingle: 7,
      supportedResolutions: ["1K", "2K"],
    },
    {
      id: "seedream_5_0_pro",
      nameKo: "Seedream 5.0 Pro",
      nameEn: "Seedream 5.0 Pro",
      tierBadgeKo: "리얼 매트 피부결 · 전신 8등신 · 의류 착장 마스터",
      tierBadgeEn: "Master · Real Matte Skin, 8-Head Lookbook & VTO",
      promptFormulaBadgeKo: "AMERICANO 리빙 스킨 규약 (플라스틱 광택 차단 · 매트 모공 · 의류 원판 핏 고정)",
      promptFormulaBadgeEn: "AMERICANO Living Skin Contract (Zero Plastic Sheen · Matte Pores · Garment Fit Lock)",
      shortTraitKo:
        "인위적인 AI 플라스틱 윤기를 원천 차단한 매트 실사 피부결, 자연스러운 8등신 전신 비율, 의류 원판 핏 고정 착장에 독보적입니다",
      shortTraitEn:
        "Unmatched for authentic matte skin pores (zero plastic sheen), natural full-body lookbook proportions, and exact garment virtual try-on",
      strengthsKo: ["매트 실사 피부·모공 결", "의류 핏·기장·스티치 고정", "전신 8등신 모델 비율"],
      strengthsEn: ["Matte Real Skin Pores", "100% Garment Fit Lock", "Natural Full-Body Proportions"],
      detailDescriptionKo:
        "AMERICANO 리빙 스킨 규약(낮은 반사광 대비, 미세 피부 요철 보존, 뷰티 필터 광택 차단)과 의류 원판 불변 규칙(MODEL AND PHOTOGRAPH INVARIANTS)이 적용되어, 패션 룩북과 뷰티 클로즈업에서 실제 매거진 필름으로 촬영한 듯한 질감을 구현합니다.",
      detailDescriptionEn:
        "Applies the AMERICANO Living Skin Contract (low specular-to-diffuse ratio, authentic micro-relief, zero porcelain/plastic shader) and strict garment construction invariants for fashion lookbooks and beauty editorials.",
      bestForDeliverablesKo: [
        "바닥컷·행거컷 의류(2번)의 기장·봉제선·패턴을 왜곡 없이 모델(1번)에게 입히는 가상 착장(VTO)",
        "AI 특유의 매끈한 마네킹 피부 느낌 없이 실제 모공과 솜털이 살아있는 뷰티·패션 화보",
        "동일 전속 모델로 정면·측면·후면 전신 룩북을 흔들림 없는 비율로 연속 촬영할 때",
      ],
      bestForDeliverablesEn: [
        "Virtual Try-On (VTO) dressing Slot 1's model in Slot 2's flat-lay garment with zero seam or print drift",
        "Beauty & fashion editorials requiring real matte skin pores with zero synthetic waxy highlights",
        "Full-body front/side/back agency digitals and lookbooks with consistent model proportions",
      ],
      recommendedSlotFormulaKo:
        "1번(착장할 모델 마스터) + 2번(의류/제품 정면 원판) + 3번(착장 핏·후면 디테일) + 4번(매트 필름 색감)",
      recommendedSlotFormulaEn:
        "Slot 1 (Model Master) + Slot 2 (Garment/SKU Packshot) + Slot 3 (Worn Fit/Back Ref) + Slot 4 (Matte Film Grade)",
      preferredWorkflow: "lookbook_composite",
      creditsPer5Set: 65,
      priceKrwPer5Set: 800,
      creditsPerSingle: 13,
      supportedResolutions: ["1K", "2K"],
    },
  ];

export function resolveCategoryReferenceWorkflows(
  category: BrandClientCategory,
): Record<StudioReferenceWorkflowId, StudioReferenceWorkflowPreset> {
  const isBeauty = category === "beauty_skincare";
  const isFnb = category === "fnb_hospitality";

  const defaultModelThumb = isBeauty
    ? "/reel/landing/v7/rx-beauty-orig.jpg"
    : "/reel/brands/slot-1-subject-editorial.jpg";
  const defaultBgThumb = isBeauty
    ? "/reel/landing/v7/rx-beauty-world.jpg"
    : isFnb
      ? "/reel/landing/v7/film-tea.jpg"
      : "/reel/brands/slot-2-space-concrete-blue.jpg";
  const defaultVibeThumb = isBeauty
    ? "/reel/landing/cut-cheek.webp"
    : "/reel/brands/slot-3-pose-lowangle-lookbook.jpg";
  const defaultColorThumb = isBeauty
    ? "/reel/campaigns/beauty-rose.jpg"
    : "/reel/brands/slot-4-color-french-cobalt.jpg";

  const defaultBaseSceneThumb = isBeauty
    ? "/reel/landing/cut-pump.webp"
    : isFnb
      ? "/reel/landing/v7/film-tea.jpg"
      : "/reel/studio/vto-set-front.webp";
  const defaultProductThumb = isBeauty
    ? "/reel/brands/swap-product-luxury-bottle.jpg"
    : isFnb
      ? "/reel/brands/tea-editorial.jpg"
      : "/reel/studio/vto-garment.webp";
  const defaultDetailThumb = isBeauty
    ? "/reel/landing/cut-hands.webp"
    : isFnb
      ? "/reel/landing/cut-scent.webp"
      : "/reel/brands/pin-texture-35mm-grain-weave.jpg";

  return {
    lookbook_composite: {
      id: "lookbook_composite",
      labelKo: "인물 · 배경 · 감도 · 색감 조합 (1~4번 레퍼런스)",
      labelEn: "Model · Background · Vibe · Color Mix (Slots 1–4)",
      summaryKo:
        "1번 인물 + 2번 배경 + 3번 이미지 감도(포즈·앵글) + 4번 색감을 역할별로 잠가 합성합니다",
      summaryEn:
        "Lock Slot 1 (Model), Slot 2 (Background), Slot 3 (Pose/Vibe), and Slot 4 (Color Grade) into one scene",
      formulaBadgeKo: "1번 인물 + 2번 배경 + 3번 감도 + 4번 색감",
      formulaBadgeEn: "1 Model + 2 Background + 3 Vibe + 4 Color",
      defaultPromptKo:
        "1번 이미지의 인물이 2번 이미지의 배경 공간에서, 3번 이미지의 구도·사진 감도로 자연스럽게 포즈를 취하고 4번 이미지의 조명과 색감을 적용해 줘.",
      defaultPromptEn:
        "Place the person from Image 1 inside the background of Image 2, matching the pose and editorial sensitivity of Image 3 and applying the lighting and color grade of Image 4.",
      quickRecipesKo: [
        "1번 이미지의 인물이 2번 이미지 배경에서, 3번 이미지의 이미지 감도로 서 있고 4번 이미지의 색감 적용해 줘",
        "1번 이미지 인물의 얼굴과 피부 톤은 그대로 고정하고, 2번 이미지 공간에서 3번 이미지의 로우앵글 구도로 촬영해 줘",
        "1번 이미지 인물에 3번 이미지의 착장 핏과 포즈를 입히고, 4번 이미지의 따뜻한 필름 색감으로 마감해 줘",
      ],
      quickRecipesEn: [
        "Place the person in Image 1 in the background of Image 2 with the editorial vibe of Image 3 and color tone of Image 4",
        "Lock the face and skin tone of Image 1, shooting in the space of Image 2 with the low-angle framing of Image 3",
        "Apply the outfit fit and pose of Image 3 to the person in Image 1, finished with the warm film grade of Image 4",
      ],
      slots: [
        {
          slotNumber: 1,
          tagKo: "1번 이미지 · 인물",
          tagEn: "Image 1 · Person",
          roleTitleKo: "인물 · 얼굴 / 헤어 / 피부",
          roleTitleEn: "Model · Face / Hair / Skin",
          lockRuleKo: "이목구비·피부톤·헤어 고정",
          lockRuleEn: "Locks facial identity & skin",
          required: true,
          defaultThumb: defaultModelThumb,
          defaultAssetNameKo: "브랜드 모델 정면 마스터",
          defaultAssetNameEn: "Brand Model Front Master",
        },
        {
          slotNumber: 2,
          tagKo: "2번 이미지 · 배경",
          tagEn: "Image 2 · Background",
          roleTitleKo: "배경 · 공간 / 장소",
          roleTitleEn: "Space · Location / Set",
          lockRuleKo: "공간 구조·원근감 반영",
          lockRuleEn: "Applies spatial depth & set",
          required: true,
          defaultThumb: defaultBgThumb,
          defaultAssetNameKo: "성수 콘크리트 & 채광 공간",
          defaultAssetNameEn: "Daylight Concrete Studio Set",
        },
        {
          slotNumber: 3,
          tagKo: "3번 이미지 · 이미지 감도",
          tagEn: "Image 3 · Editorial Vibe",
          roleTitleKo: "구도 · 포즈 / 사진 감도",
          roleTitleEn: "Vibe · Pose / Camera Angle",
          lockRuleKo: "프레이밍·포즈·렌즈 감도",
          lockRuleEn: "Matches pose & lens framing",
          required: false,
          defaultThumb: defaultVibeThumb,
          defaultAssetNameKo: "3/4 에디토리얼 앵글 감도",
          defaultAssetNameEn: "3/4 Editorial Framing Ref",
        },
        {
          slotNumber: 4,
          tagKo: "4번 이미지 · 색감",
          tagEn: "Image 4 · Color Grade",
          roleTitleKo: "색감 · 조명 / 필름 톤",
          roleTitleEn: "Color · Lighting & Moodprint",
          lockRuleKo: "색온도·대비·그레인 매칭",
          lockRuleEn: "Transfers color grade & light",
          required: false,
          defaultThumb: defaultColorThumb,
          defaultAssetNameKo: "프렌치 시네마 색감 무드",
          defaultAssetNameEn: "French Cinema Color Mood",
        },
      ],
    },
    product_swap: {
      id: "product_swap",
      labelKo: "제품 교체 · 팩샷 리슈팅 (1번 장면 ↔ 2번 제품)",
      labelEn: "Product Swap & Packshot Reshoot (Image 1 ↔ Image 2)",
      summaryKo:
        "1번 이미지의 구도·조명·손/배경은 유지하고, 제품만 2번 이미지의 우리 제품으로 정밀 교체합니다",
      summaryEn:
        "Keep the framing, lighting, and hands of Image 1 while swapping the product with your product in Image 2",
      formulaBadgeKo: "1번 기존 제품 → 2번 우리 제품으로 교체",
      formulaBadgeEn: "Swap Image 1 Product → Image 2 Product",
      defaultPromptKo:
        "1번 이미지의 배경·조명·구도는 그대로 유지하고, 1번 이미지 속 제품을 2번 이미지의 제품으로 정확히 변경해 줘. 3번 이미지의 디테일과 4번 이미지의 색감을 함께 반영해 줘.",
      defaultPromptEn:
        "Keep the background, lighting, and framing of Image 1 intact, and replace the product in Image 1 with the product from Image 2, preserving the detail of Image 3 and color tone of Image 4.",
      quickRecipesKo: [
        "1번 이미지 제품을 2번 이미지 제품으로 변경해 줘 (라벨 로고와 용기 비율 100% 유지)",
        "1번 이미지의 손 모양과 테이블 채광은 그대로 두고, 손에 들린 제품만 2번 이미지 제품으로 교체해 줘",
        "2번 이미지 제품 정면과 3번 이미지 측면 디테일을 결합해, 1번 이미지의 스튜디오 단상 위에 4번 색감으로 새로 촬영해 줘",
      ],
      quickRecipesEn: [
        "Replace the product in Image 1 with the product in Image 2 (keep 100% label typography and shape)",
        "Keep the hand pose and table daylight of Image 1, swapping only the held item with the product in Image 2",
        "Combine the front product in Image 2 and side detail in Image 3 onto the studio plinth of Image 1 with Image 4's color tone",
      ],
      slots: [
        {
          slotNumber: 1,
          tagKo: "1번 이미지 · 베이스 장면",
          tagEn: "Image 1 · Base Scene",
          roleTitleKo: "기존 장면 · 구도 / 손 / 배경",
          roleTitleEn: "Base Cut · Framing / Hand / Set",
          lockRuleKo: "구도·그림자·조명 위치 유지",
          lockRuleEn: "Keeps framing & shadow contact",
          required: true,
          defaultThumb: defaultBaseSceneThumb,
          defaultAssetNameKo: "베이스 스튜디오 구도 컷",
          defaultAssetNameEn: "Base Studio Framing Cut",
        },
        {
          slotNumber: 2,
          tagKo: "2번 이미지 · 교체할 제품",
          tagEn: "Image 2 · Target Product",
          roleTitleKo: "우리 제품 · 정면 마스터",
          roleTitleEn: "Our Product · Front Master",
          lockRuleKo: "제품 형태·로고·라벨 98% 보존",
          lockRuleEn: "98% shape & label preservation",
          required: true,
          defaultThumb: defaultProductThumb,
          defaultAssetNameKo: "우리 브랜드 제품 정면 원판",
          defaultAssetNameEn: "Brand Product Front Master",
        },
        {
          slotNumber: 3,
          tagKo: "3번 이미지 · 디테일 보조",
          tagEn: "Image 3 · Side / Detail",
          roleTitleKo: "측면 · 원단 / 제형 / 로고",
          roleTitleEn: "Detail · Side / Texture / Logo",
          lockRuleKo: "측면 두께·소재 질감 보강",
          lockRuleEn: "Reinforces texture & side profile",
          required: false,
          defaultThumb: defaultDetailThumb,
          defaultAssetNameKo: "소재 · 라벨 클로즈업 보조컷",
          defaultAssetNameEn: "Material & Label Detail Ref",
        },
        {
          slotNumber: 4,
          tagKo: "4번 이미지 · 색감·조명",
          tagEn: "Image 4 · Light & Color",
          roleTitleKo: "타깃 색감 · 하이라이트 무드",
          roleTitleEn: "Tone · Specular & Color Ref",
          lockRuleKo: "표면 반사광·색온도 매칭",
          lockRuleEn: "Matches specular & color tone",
          required: false,
          defaultThumb: defaultColorThumb,
          defaultAssetNameKo: "스튜디오 하이라이트 톤",
          defaultAssetNameEn: "Studio Specular Tone Ref",
        },
      ],
    },
  };
}

/**
 * Pinned Color Reference & Pinned Texture Reference Presets.
 * When pinned (locked), these references persist across all image generation,
 * product swaps, and micro-region edits so every cut keeps identical brand tone & surface grain.
 */
export interface PinnedStyleReferencePreset {
  id: string;
  kind: "color" | "texture";
  titleKo: string;
  titleEn: string;
  ruleKo: string;
  ruleEn: string;
  swatchHex: string;
  thumb: string;
  promptTokenKo: string;
  promptTokenEn: string;
}

export const PINNED_COLOR_REFERENCES: ReadonlyArray<PinnedStyleReferencePreset> =
  [
    {
      id: "color_editorial_cobalt",
      kind: "color",
      titleKo: "프렌치 코발트 에디토리얼 톤",
      titleEn: "French Cobalt Editorial Tone",
      ruleKo: "5400K 쿨 데이라이트 · 딥 네이비 섀도우 · 중채도 피부톤 고정",
      ruleEn: "5400K cool daylight · deep navy shadows · balanced skin saturation",
      swatchHex: "#3875C5",
      thumb: "/reel/brands/slot-4-color-french-cobalt.jpg",
      promptTokenKo: "[고정 색감 레퍼런스: 5400K 프렌치 코발트 에디토리얼 색온도 및 섀도우 커브 유지]",
      promptTokenEn: "[Pinned Color Ref: 5400K French cobalt editorial color temperature and shadow curve]",
    },
    {
      id: "color_warm_film_2383",
      kind: "color",
      titleKo: "웜 데이라이트 필름 2383 톤",
      titleEn: "Warm Daylight 2383 Film Grade",
      ruleKo: "4800K 자연 채광 · 소프트 골든 하이라이트 · 따뜻한 필름 계조 고정",
      ruleEn: "4800K warm daylight · soft golden highlights · analog film roll-off",
      swatchHex: "#C89B6E",
      thumb: "/reel/campaigns/beauty-rose.jpg",
      promptTokenKo: "[고정 색감 레퍼런스: 4800K 웜 데이라이트 필름 2383 색감 및 소프트 하이라이트 유지]",
      promptTokenEn: "[Pinned Color Ref: 4800K warm daylight 2383 film grade and soft highlight roll-off]",
    },
    {
      id: "color_crisp_studio_neutral",
      kind: "color",
      titleKo: "선명한 뉴트럴 화이트 스튜디오",
      titleEn: "Crisp Neutral White Studio",
      ruleKo: "5800K 정밀 색재현 · 왜곡 없는 제품 고유 컬러 100% 유지",
      ruleEn: "5800K true-to-life color accuracy · zero color cast on product",
      swatchHex: "#64748B",
      thumb: "/reel/studio/vto-set-front.webp",
      promptTokenKo: "[고정 색감 레퍼런스: 5800K 무왜곡 뉴트럴 스튜디오 화이트밸런스 및 제품 고유 색상 고정]",
      promptTokenEn: "[Pinned Color Ref: 5800K neutral studio white balance with true product color lock]",
    },
  ];

export const PINNED_TEXTURE_REFERENCES: ReadonlyArray<PinnedStyleReferencePreset> =
  [
    {
      id: "texture_matte_skin_35mm",
      kind: "texture",
      titleKo: "35mm 파인 그레인 & 리얼 매트 피부결",
      titleEn: "35mm Fine Grain & Real Matte Skin",
      ruleKo: "AI 플라스틱 광택 제거 · 실제 피부 모공과 미세 아날로그 입자 고정",
      ruleEn: "Eliminates AI plastic sheen · locks authentic pores & 35mm fine grain",
      swatchHex: "#475569",
      thumb: "/reel/brands/slot-1-subject-editorial.jpg",
      promptTokenKo: "[고정 질감 레퍼런스: 35mm 아날로그 파인 그레인 및 매트한 실사 피부 모공 질감 고정]",
      promptTokenEn: "[Pinned Texture Ref: 35mm analog fine grain and authentic matte skin pore texture]",
    },
    {
      id: "texture_macro_fabric_weave",
      kind: "texture",
      titleKo: "원단 직조 · 스티치 · 메탈 마이크로 질감",
      titleEn: "Macro Fabric Weave & Brushed Metal",
      ruleKo: "울·데님 직조 결, 봉제 실땀, 브러시드 메탈 헤어라인 선명도 고정",
      ruleEn: "Locks wool/denim weave, stitch thread detail, and brushed metal grain",
      swatchHex: "#334155",
      thumb: "/reel/brands/pin-texture-35mm-grain-weave.jpg",
      promptTokenKo: "[고정 질감 레퍼런스: 초근접 원단 직조 결·봉제 스티치·금속 표면 마이크로 질감 고정]",
      promptTokenEn: "[Pinned Texture Ref: hyper-sharp fabric weave, seam stitching, and surface micro-texture]",
    },
    {
      id: "texture_dewy_glass_smear",
      kind: "texture",
      titleKo: "유리 굴절 · 결로 · 수분 제형 클린 질감",
      titleEn: "Glass Refraction & Dewy Serum Texture",
      ruleKo: "투명 용기 굴절, 미세 물방울 결로, 스킨케어 제형 스미어 질감 고정",
      ruleEn: "Locks glass bottle refraction, fine condensation droplets, and serum smear",
      swatchHex: "#0EA5E9",
      thumb: "/reel/brands/swap-product-luxury-bottle.jpg",
      promptTokenKo: "[고정 질감 레퍼런스: 투명 유리 굴절·미세 결로 물방울·수분 제형 하이라이트 질감 고정]",
      promptTokenEn: "[Pinned Texture Ref: crisp glass refraction, micro condensation droplets, and serum texture]",
    },
  ];

/**
 * Oplux (`oplux-plugin.ccx` + `app.oplux.ai`) & Morphic Canvas-inspired
 * Micro-Region Image Editing (극소 부위 정밀 수정) Architecture.
 */
export type StudioImageSubMode =
  | "multi_ref_generate"
  | "micro_region_edit"
  | "canvas_drag_ref";

export type StudioCanvasToolId =
  | "pointer"
  | "marquee_select"
  | "brush_mask"
  | "crop_ratio";

export type MicroEditQualityTier = "Low" | "Medium" | "High";
export type MicroEditResolutionTier = "1K" | "2K" | "4K";

export interface MicroRegionSelectionPreset {
  id: string;
  labelKo: string;
  labelEn: string;
  targetPartKo: string;
  targetPartEn: string;
  /** Normalized selection bounds (0..100%) on the studio canvas */
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  defaultEditPromptKo: string;
  defaultEditPromptEn: string;
}

export const MICRO_REGION_SELECTION_PRESETS: ReadonlyArray<MicroRegionSelectionPreset> =
  [
    {
      id: "region_product_label",
      labelKo: "제품 · 전면 라벨 극소 부위",
      labelEn: "Product & Front Label Micro-Region",
      targetPartKo: "제품 용기 · 로고 각인 · 전면 라벨 영역",
      targetPartEn: "Product container · logo engraving · front label",
      xPct: 30,
      yPct: 36,
      wPct: 40,
      hPct: 34,
      defaultEditPromptKo:
        "드래그한 선택 영역 안의 제품만 2번 레퍼런스 제품으로 교체하고, 전면 로고 철자와 표면 반사광을 선명하게 교정해 줘 (선택 영역 밖 배경·인물은 100% 원본 유지).",
      defaultEditPromptEn:
        "Replace only the product inside the selected region with Reference #2, keeping crisp front logo lettering and specular highlights (preserve 100% of pixels outside the selection).",
    },
    {
      id: "region_hand_grip",
      labelKo: "손 모양 · 소품 그립 극소 부위",
      labelEn: "Hand Grip & Held Prop Micro-Region",
      targetPartKo: "손가락 마디 · 그립 각도 · 접촉 그림자 영역",
      targetPartEn: "Finger joints · grip angle · contact shadow",
      xPct: 24,
      yPct: 48,
      wPct: 36,
      hPct: 28,
      defaultEditPromptKo:
        "선택한 손 부위가 제품을 자연스럽게 감싸 쥐도록 손가락 형태와 접촉 그림자만 정밀 교정해 줘 (의류 소매와 배경은 원본 그대로 보존).",
      defaultEditPromptEn:
        "Refine only the selected hand grip and contact shadow so the fingers hold the product naturally (keep sleeve and background untouched).",
    },
    {
      id: "region_face_expression",
      labelKo: "얼굴 표정 · 시선 · 잔머리 부위",
      labelEn: "Facial Expression · Gaze · Hairline",
      targetPartKo: "눈매 · 입꼬리 표정 · 헤어라인 · 피부결 영역",
      targetPartEn: "Eye gaze · subtle expression · hairline · skin pores",
      xPct: 32,
      yPct: 10,
      wPct: 36,
      hPct: 26,
      defaultEditPromptKo:
        "선택 영역 안의 인물 시선을 정면 카메라로 맞추고, 잔머리와 매트한 피부 모공 질감을 자연스럽게 다듬어 줘.",
      defaultEditPromptEn:
        "Adjust the gaze inside the selected region toward the camera and refine flyaway hair and natural matte skin pores.",
    },
    {
      id: "region_collar_stitch",
      labelKo: "옷깃 · 단추 · 소매 핏 극소 부위",
      labelEn: "Collar · Buttons · Sleeve Fit Region",
      targetPartKo: "라펠 대칭 · 단추 여밈 · 원단 주름 영역",
      targetPartEn: "Lapel symmetry · button closure · fabric fold",
      xPct: 26,
      yPct: 28,
      wPct: 48,
      hPct: 38,
      defaultEditPromptKo:
        "선택한 의류 부위의 옷깃 대칭과 봉제 스티치 선을 깔끔하게 정돈하고, 고정된 질감 레퍼런스의 원단 결을 적용해 줘.",
      defaultEditPromptEn:
        "Clean up the collar symmetry and stitch lines inside the selected garment region, applying the pinned fabric weave texture.",
    },
  ];

export type BrandStudioMicroEditModelId =
  | "precision_region_editor"
  | "seamless_edge_inpaint"
  | "texture_fit_reshape"
  | "film_grain_skin_enhancer";

export interface BrandStudioMicroEditModelSpec {
  id: BrandStudioMicroEditModelId;
  nameKo: string;
  nameEn: string;
  badgeKo: string;
  badgeEn: string;
  shortTraitKo: string;
  shortTraitEn: string;
  howItWorksKo: string;
  howItWorksEn: string;
  bestWhenKo: readonly [string, string, string];
  bestWhenEn: readonly [string, string, string];
  supportsQualityTier: boolean;
  supportedResolutions: readonly MicroEditResolutionTier[];
  smartMaskLock: boolean;
  creditsPerEdit: number;
  priceKrwPerEdit: number;
}

export const BRAND_STUDIO_MICRO_EDIT_MODELS: ReadonlyArray<BrandStudioMicroEditModelSpec> =
  [
    {
      id: "precision_region_editor",
      nameKo: "GPT Image 2.6 · 정밀 부위 리터칭 & 라벨/소품 교정",
      nameEn: "GPT Image 2.6 · Precision Region & Label Editor",
      badgeKo: "극소 부위 수정 · 제품/라벨 교정 1순위",
      badgeEn: "Best for Micro-Region Product & Label Edit",
      shortTraitKo:
        "드래그한 선택 영역(Input Preview)과 레퍼런스 사진을 함께 읽어, 선택 부위 내부만 스마트 레이어 마스크로 정밀 교체·수정합니다",
      shortTraitEn:
        "Reads the cropped selection patch + reference images and replaces only the masked region via a non-destructive Smart Layer Mask",
      howItWorksKo:
        "캔버스에서 사각형이나 브러시로 지정한 영역만 가장 가까운 표준 비율(1:1, 4:5, 3:4 등)로 자동 크롭·패딩해 수정한 뒤, 그레이스케일 레이어 마스크(Layer Mask)를 씌워 새 레이어로 얹습니다. 선택 영역 바깥의 원본 픽셀은 1픽셀도 변하지 않습니다.",
      howItWorksEn:
        "Crops and pads only the selected bounds to the closest supported aspect ratio, runs multi-image region editing, and places the result as a masked layer so pixels outside the selection remain 100% untouched.",
      bestWhenKo: [
        "화보 컷에서 다른 부분은 다 마음에 드는데 제품 라벨 글자나 로고만 살짝 깨졌을 때",
        "모델 손에 들린 소품이나 손가락 그립 모양만 어색해서 그 부위만 다시 고치고 싶을 때",
        "특정 영역에 2번 레퍼런스 제품(화장품·음료·가방·시계)을 정확히 합성해 넣을 때",
      ],
      bestWhenEn: [
        "When the whole shot is great except a slightly distorted logo or package label",
        "When only a model's hand grip or held prop needs targeted correction",
        "When inserting Reference #2 (bottle, bag, watch) into a specific selected area",
      ],
      supportsQualityTier: true,
      supportedResolutions: ["1K", "2K"],
      smartMaskLock: true,
      creditsPerEdit: 11,
      priceKrwPerEdit: 140,
    },
    {
      id: "seamless_edge_inpaint",
      nameKo: "Nano Banana 2.1 · 심리스 경계 블렌딩 에디터",
      nameEn: "Nano Banana 2.1 · Seamless Edge & Lighting Blend",
      badgeKo: "경계선 티 안 나는 자연 합성 추천",
      badgeEn: "Best for Zero-Seam Edge & Lighting Blend",
      shortTraitKo:
        "선택 영역과 주변 원본 픽셀 사이의 조명·그림자·피부 톤을 자동으로 맞춰 수정 자국이 전혀 남지 않게 블렌딩합니다",
      shortTraitEn:
        "Automatically matches surrounding lighting, shadows, and skin tone across selection edges with zero visible seams",
      howItWorksKo:
        "선택된 영역의 경계면(Edge) 주변 문맥과 색온도를 함께 분석하여, 표정 수정·헤어라인 정리·불필요한 배경 사물 제거·부분 조명 수정 시 경계선 이질감 없이 매끄럽게 이어 붙입니다.",
      howItWorksEn:
        "Analyzes surrounding context and color temperature around the selection mask so expression tweaks, hairline cleanup, and object removal blend invisibly.",
      bestWhenKo: [
        "모델의 시선 방향, 미소 등 표정 일부나 잔머리·헤어라인만 자연스럽게 고칠 때",
        "배경에 걸린 불필요한 소품·전선·그림자를 지우고 주변 공간 질감으로 메울 때",
        "제품 바닥면의 접촉 그림자(Contact Shadow)나 반사광을 주변 채광에 맞게 다듬을 때",
      ],
      bestWhenEn: [
        "Refining gaze direction, subtle facial expressions, or flyaway hairlines",
        "Removing unwanted background objects or wires and filling with matching set texture",
        "Polishing contact shadows and reflections beneath a product",
      ],
      supportsQualityTier: false,
      supportedResolutions: ["1K", "2K", "4K"],
      smartMaskLock: true,
      creditsPerEdit: 14,
      priceKrwPerEdit: 180,
    },
    {
      id: "texture_fit_reshape",
      nameKo: "Nano Banana Pro · 4K 질감 & 의류 핏 부분 리셰이핑",
      nameEn: "Nano Banana Pro · 4K Texture & Garment Fit Reshape",
      badgeKo: "원단 주름 · 핏 · 4K 디테일 보정",
      badgeEn: "Best for Fabric Drape & 4K Detail",
      shortTraitKo:
        "선택한 의류·가방·제품 부위의 실루엣 핏과 2K/4K 초고해상도 표면 질감을 복원하고 정돈합니다",
      shortTraitEn:
        "Restores 2K/4K surface micro-textures and refines garment silhouette or drape within the selected region",
      howItWorksKo:
        "고정해 둔 질감 참고 레퍼런스(원단 직조·가죽 결·금속 헤어라인)를 선택 영역에 집중 주입하여, 뭉개진 옷 주름이나 흐릿한 디테일을 최대 4K 해상도로 선명하게 되살립니다.",
      howItWorksEn:
        "Injects your pinned texture reference directly into the selected bounds to sharpen fabric folds, leather grain, or metallic edges up to 4K.",
      bestWhenKo: [
        "아우터 옷깃·소매 기장·바지 밑단 주름 등 의류 핏 일부만 깔끔하게 잡을 때",
        "확대했을 때 흐릿해 보이는 원단 직조 결이나 금속 버클 디테일을 4K급으로 살릴 때",
        "뷰티 제형 스미어나 식음료 얼음/결로 부위의 디테일 밀도를 높일 때",
      ],
      bestWhenEn: [
        "Tailoring jacket lapels, sleeve lengths, or trouser hems in a lookbook cut",
        "Restoring 4K fabric weave or metallic hardware sharpness on zoomed-in regions",
        "Boosting macro detail on cosmetic smears or beverage ice condensation",
      ],
      supportsQualityTier: false,
      supportedResolutions: ["2K", "4K"],
      smartMaskLock: true,
      creditsPerEdit: 16,
      priceKrwPerEdit: 200,
    },
    {
      id: "film_grain_skin_enhancer",
      nameKo: "Seedream 5.0 Pro · 리얼 매트 스킨 & 35mm 필름 마감",
      nameEn: "Seedream 5.0 Pro · Real Matte Skin & 35mm Grain Finish",
      badgeKo: "AI 플라스틱 느낌 제거 · 최종 마감",
      badgeEn: "Removes AI Plastic Look · Final Finish",
      shortTraitKo:
        "부분 수정 후 생기기 쉬운 매끈한 AI 피부 광택을 걷어내고, 실제 카메라 필름 입자와 모공 질감으로 톤을 통일합니다",
      shortTraitEn:
        "Eliminates synthetic AI smoothness by blending physical RGB/Mono film grain and matte skin pore micro-contrast",
      howItWorksKo:
        "영역별 밝기 보정(Brightness Correction)을 유지한 채 물리 노이즈 패치(RGB 컬러 그레인 또는 모노 그레인)와 피부결 인핸서를 레이어로 블렌딩해, 수정 부위와 원본 부위가 실제 스튜디오 카메라로 한 번에 찍은 것처럼 일체화됩니다.",
      howItWorksEn:
        "Blends brightness-compensated physical grain patches and skin pore micro-contrast so edited patches and original pixels share one cohesive camera sensor look.",
      bestWhenKo: [
        "극소 부위 수정 후 수정된 부위와 주변 영역의 입자감(Grain)을 완벽히 하나로 맞출 때",
        "인물 피부에서 인위적인 AI 윤기를 빼고 매거진 화보 같은 매트 피부결을 만들 때",
        "최종 화보 컷을 영상 제작(첫 프레임)으로 넘기기 전에 필름 룩 마감을 입힐 때",
      ],
      bestWhenEn: [
        "Unifying sensor grain between an edited micro-region and the rest of the frame",
        "Removing synthetic sheen from model skin for an authentic magazine finish",
        "Applying final film texture before sending the cut to Video Studio as Frame 1",
      ],
      supportsQualityTier: false,
      supportedResolutions: ["2K", "4K"],
      smartMaskLock: true,
      creditsPerEdit: 8,
      priceKrwPerEdit: 100,
    },
  ];

const SUPPORTED_EDIT_RATIOS: ReadonlyArray<{ label: string; value: number }> = [
  { label: "1:1", value: 1 },
  { label: "16:9", value: 16 / 9 },
  { label: "9:16", value: 9 / 16 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:4", value: 3 / 4 },
  { label: "5:4", value: 5 / 4 },
  { label: "4:5", value: 0.8 },
];

/**
 * Mirrors `findClosestAspectRatio` from `oplux-plugin.ccx`:
 * Given a selection width & height, returns the closest supported aspect ratio label
 * so the cropped patch can be padded cleanly without geometric distortion.
 */
export function findClosestSupportedAspectRatio(
  width: number,
  height: number,
): string {
  if (height <= 0 || width <= 0) return "1:1";
  const ratio = width / height;
  let best = SUPPORTED_EDIT_RATIOS[0]!;
  let minDiff = Infinity;
  for (const candidate of SUPPORTED_EDIT_RATIOS) {
    const diff = Math.abs(ratio - candidate.value);
    if (diff < minDiff) {
      minDiff = diff;
      best = candidate;
    }
  }
  return best.label;
}

/**
 * Track 3 (`creator_format`) & Track 4 (`creator_distribution`) Presets:
 * - Self-Serve Format Builder vs Studio Commissioned Format
 * - End-to-End Creator Seeding Distribution Cohorts (10 / 30 / 50+ Creators)
 */
export type CreatorCampaignFormatModeId = "self_build" | "studio_commission";

export interface CreatorCampaignFormatModeSpec {
  id: CreatorCampaignFormatModeId;
  badgeKo: string;
  badgeEn: string;
  titleKo: string;
  titleEn: string;
  summaryKo: string;
  summaryEn: string;
  lockedElementsKo: readonly [string, string, string];
  lockedElementsEn: readonly [string, string, string];
  creatorInputKo: string;
  creatorInputEn: string;
  turnaroundKo: string;
  turnaroundEn: string;
  ctaLabelKo: string;
  ctaLabelEn: string;
}

export const BRAND_CREATOR_FORMAT_MODES: readonly CreatorCampaignFormatModeSpec[] =
  [
    {
      id: "self_build",
      badgeKo: "MODE A · 셀프 스튜디오에서 직접 포맷 빌드",
      badgeEn: "MODE A · Self-Serve Format Builder",
      titleKo: "셀프 캠페인 포맷 빌더 (브랜드가 직접 슬롯 잠금 & 즉시 테스트)",
      titleEn: "Self-Serve Campaign Format Builder (Instant Lock & Test)",
      summaryKo:
        "스튜디오에서 확정한 우리 브랜드 화보·제품·배경·색감을 고정 슬롯으로 잠그고, [크리에이터 정면 셀카 1장]만 바뀌는 캠페인 영상 포맷을 즉시 생성합니다.",
      summaryEn:
        "Lock your approved brand scene, product, outfit, and color grade as immutable slots while exposing a single [Creator Front Selfie] slot for instant campaign generation.",
      lockedElementsKo: [
        "우리 브랜드 제품 패키지 · 착장 핏 · 로고 위치 100% 고정",
        "브랜드 지정 배경 공간 · 카메라 동선(720p/1080p) · 조명 색온도 고정",
        "참여 크리에이터가 바꿀 수 없는 브랜드 세이프티 가드레일 자동 적용",
      ],
      lockedElementsEn: [
        "100% lock on brand product geometry, outfit fit, and logo placement",
        "Immutable studio set, camera blocking (720p/1080p), and color grade",
        "Automatic brand safety guardrails across every creator render",
      ],
      creatorInputKo: "참여 크리에이터 입력: 정면 셀카 1장 (본인 얼굴 사용 동의 + 자동 검수)",
      creatorInputEn: "Creator Input: 1 Front Selfie (consent + automated safety check)",
      turnaroundKo: "지금 바로 포맷 생성 및 샘플 크리에이터 3인 프리뷰 확인 (약 60초)",
      turnaroundEn: "Build format & preview across 3 sample creators immediately (~60s)",
      ctaLabelKo: "셀프 캠페인 포맷 즉시 생성 및 테스트",
      ctaLabelEn: "Build & Test Self-Serve Campaign Format",
    },
    {
      id: "studio_commission",
      badgeKo: "MODE B · 전담 디렉터에게 맞춤 포맷 제작 의뢰",
      badgeEn: "MODE B · Commission Custom Format to Studio",
      titleKo: "스튜디오 전담 캠페인 포맷 제작 의뢰 (D+3 맞춤 포맷 설계·납품)",
      titleEn: "Commissioned Studio Format Production (D+3 Custom Delivery)",
      summaryKo:
        "제품 실물 사진과 캠페인 목적(신제품 론칭·뷰티 룩·시즌 프로모션)만 전달하면, TWINGS 전담 필름 디렉터가 D+3일 내에 바이럴 훅이 검증된 전용 캠페인 포맷을 제작해 납품합니다.",
      summaryEn:
        "Send your product photos and campaign goal—our film directors design, test, and deliver a custom high-converting creator format within D+3 days.",
      lockedElementsKo: [
        "전담 디렉터의 맞춤형 12초 원테이크/비트싱크 카메라 연출 설계",
        "제품 제형·라벨·착장 디테일 98%+ 보존 정밀 검수 완료",
        "납품 후 브랜드 전용 링크 발급 → 내부 임직원·앰배서더·크리에이터 즉시 사용",
      ],
      lockedElementsEn: [
        "Director-crafted 12s one-take or beat-synced camera choreography",
        "98%+ product texture, label, and garment detail QA before delivery",
        "Dedicated brand format link ready for ambassadors and creators",
      ],
      creatorInputKo: "브랜드 전달 사항: 제품 원판 사진 2~4장 + 원하는 캠페인 무드 1줄",
      creatorInputEn: "Brand Handoff: 2–4 product photos + 1-line campaign mood brief",
      turnaroundKo: "의뢰 접수 후 D+3일 내 전용 포맷 확정 및 테스트 영상 3편 납품",
      turnaroundEn: "Custom format locked & 3 test videos delivered within D+3 days",
      ctaLabelKo: "D+3 전담 캠페인 포맷 제작 의뢰하기",
      ctaLabelEn: "Commission D+3 Custom Campaign Format",
    },
  ];

export type CreatorDistributionTierId = "seed_10" | "growth_30" | "mega_50_plus";

export interface CreatorDistributionTierSpec {
  id: CreatorDistributionTierId;
  badgeKo: string;
  badgeEn: string;
  titleKo: string;
  titleEn: string;
  creatorCountLabelKo: string;
  creatorCountLabelEn: string;
  channelsKo: string;
  channelsEn: string;
  estimatedViewsKo: string;
  estimatedViewsEn: string;
  includesKo: readonly [string, string, string];
  includesEn: readonly [string, string, string];
  timelineSummaryKo: string;
  timelineSummaryEn: string;
}

export const BRAND_CREATOR_DISTRIBUTION_TIERS: readonly CreatorDistributionTierSpec[] =
  [
    {
      id: "seed_10",
      badgeKo: "SEED COHORT · 초기 반응 검증",
      badgeEn: "SEED COHORT · Market Validation",
      titleKo: "10인 크리에이터 시드 유통 팩",
      titleEn: "10-Creator Seed Distribution Pack",
      creatorCountLabelKo: "팔로워 3,000+ 검증 크리에이터 10명 동시 게시",
      creatorCountLabelEn: "10 verified creators (3,000+ followers) simultaneous post",
      channelsKo: "Instagram Reels · TikTok · YouTube Shorts",
      channelsEn: "Instagram Reels · TikTok · YouTube Shorts",
      estimatedViewsKo: "예상 오가닉 조회수 15만~40만 뷰+",
      estimatedViewsEn: "Est. 150K–400K+ organic views",
      includesKo: [
        "브랜드 전용 캠페인 영상 포맷 1종 제작 포함",
        "카테고리(뷰티·패션·라이프) 맞춤 크리에이터 10인 섭외 및 1080p 영상 납품",
        "D+21 조회수·도달·저장 성과 리포트 + 상위 3편 2차 광고 활용권(Usage Rights)",
      ],
      includesEn: [
        "Includes 1 custom brand campaign video format",
        "10 category-matched creators recruited & 1080p masters delivered",
        "D+21 performance report + cleared 2nd-use ad rights for top 3 videos",
      ],
      timelineSummaryKo: "D+3 포맷 확정 → D+7 10인 매칭 → D+14 일괄 게시 → D+21 리포트",
      timelineSummaryEn: "D+3 Format -> D+7 10 Creators -> D+14 Live Post -> D+21 Report",
    },
    {
      id: "growth_30",
      badgeKo: "GROWTH COHORT · 신제품 론칭 표준 (가장 많이 선택)",
      badgeEn: "GROWTH COHORT · Standard Product Launch (Most Popular)",
      titleKo: "30인 크리에이터 그로스 유통 팩",
      titleEn: "30-Creator Growth Distribution Pack",
      creatorCountLabelKo: "팔로워 3,000+ 검증 크리에이터 30명 멀티 시딩",
      creatorCountLabelEn: "30 verified creators (3,000+ followers) multi-wave seeding",
      channelsKo: "Instagram Reels · TikTok · YouTube Shorts 동시 확산",
      channelsEn: "Simultaneous wave across IG Reels, TikTok & Shorts",
      estimatedViewsKo: "예상 오가닉 조회수 50만~120만 뷰+",
      estimatedViewsEn: "Est. 500K–1.2M+ organic views",
      includesKo: [
        "브랜드 전용 캠페인 영상 포맷 2종(A/B 훅 비교) 제작 포함",
        "크리에이터 30인 후보 리스트 사전 공유 및 브랜드 원클릭 승인",
        "전 편 1080p 클린 마스터 제공 + 상위 10편 메타/틱톡 2차 퍼포먼스 광고 활용권",
      ],
      includesEn: [
        "Includes 2 custom campaign video formats (A/B hook testing)",
        "Pre-launch creator shortlist sharing & 1-click brand approval",
        "All 30 clean 1080p masters + 2nd-use paid ad rights on top 10 assets",
      ],
      timelineSummaryKo: "D+3 포맷 2종 확정 → D+7 30인 확정 → D+14 동시 게시 → D+21 ROI 리포트",
      timelineSummaryEn: "D+3 2 Formats -> D+7 30 Creators -> D+14 Wave Post -> D+21 ROI Report",
    },
    {
      id: "mega_50_plus",
      badgeKo: "MEGA CAMPAIGN · 카테고리 장악 & 파생 확산",
      badgeEn: "MEGA CAMPAIGN · Category Takeover",
      titleKo: "50인+ 메가 캠페인 & 오가닉 파생 유통 팩",
      titleEn: "50+ Creator Mega Seeding & Organic Takeover",
      creatorCountLabelKo: "팔로워 3,000~10만+ 크리에이터 50명 이상 대규모 시딩",
      creatorCountLabelEn: "50+ creators (3K to 100K+ followers) full-funnel wave",
      channelsKo: "IG Reels · TikTok · Shorts + 댓글 자동 DM 레시피 연동",
      channelsEn: "IG Reels · TikTok · Shorts + Comment-to-DM Viral Loop",
      estimatedViewsKo: "실적 기준: 200만 뷰+ · 파생 오가닉 콘텐츠 300건+ 달성 구조",
      estimatedViewsEn: "Proven track record: 2M+ views & 300+ derivative organic posts",
      includesKo: [
        "브랜드 전용 멀티 포맷 3종 + 전담 사운드/컬러 그레이딩 마스터링",
        "50인+ 시딩 유통 + 일반 유저 참여형 오가닉 챌린지 확산 구조 설계",
        "전체 산출물 무제한 2차 광고 활용권 및 주간 실시간 대시보드 리포트",
      ],
      includesEn: [
        "3 custom formats + dedicated sound & color grading master",
        "50+ seeded creators + public organic challenge participation loop",
        "Full 2nd-use paid ad rights + weekly live dashboard reporting",
      ],
      timelineSummaryKo: "D+3 포맷 확정 → D+7 50인+ 섭외 → D+14 메가 시딩 → D+21 종합 리포트",
      timelineSummaryEn: "D+3 Formats -> D+7 50+ Cohort -> D+14 Mega Wave -> D+21 Full Report",
    },
  ];

/**
 * Track 5 (`audio`) Audio Studio Presets:
 * - Signature BGM + Tactile Foley + Act 1 -3 dB Voiceover Ducking + -14 LUFS / -1 dBTP Mastering
 */
export type BrandAudioPresetId =
  | "runway_french_house"
  | "clinical_minimal_pulse"
  | "warm_acoustic_lounge"
  | "no_bgm_live_foley";

export interface BrandAudioPresetSpec {
  id: BrandAudioPresetId;
  badgeKo: string;
  badgeEn: string;
  titleKo: string;
  titleEn: string;
  bpmLabel: string;
  loudnessSpec: string;
  duckingRuleKo: string;
  duckingRuleEn: string;
  foleyLayersKo: readonly [string, string, string];
  foleyLayersEn: readonly [string, string, string];
  summaryKo: string;
  summaryEn: string;
  creditsPerTrack: number;
  priceKrwPerTrack: number;
}

export const BRAND_AUDIO_STUDIO_PRESETS: readonly BrandAudioPresetSpec[] = [
  {
    id: "runway_french_house",
    badgeKo: "패션 · 룩북 · 런웨이 1순위",
    badgeEn: "Best for Fashion & Lookbook Reels",
    titleKo: "프렌치 런웨이 하우스 & 카메라 셔터 폴리",
    titleEn: "French Runway House & Press Shutter Foley",
    bpmLabel: "122 BPM · Beat-Drop Sync @ 2.3s",
    loudnessSpec: "-14.0 LUFS / -1.0 dBTP (IG Reels · TikTok 표준)",
    duckingRuleKo: "Act 1 도입부 및 브랜드 보이스오버 구간 자동 -3 dB 더킹",
    duckingRuleEn: "Automatic Act 1 & voiceover -3 dB sidechain ducking",
    foleyLayersKo: [
      "대리석 위 가죽 구두 힐 탭(Heel Tap) 현장음",
      "울 코트·실크 트렌치 원단 스침(Fabric Rustle) 마이크로 폴리",
      "프레스 라인 플래시 카메라 셔터 & 공간 잔향(Room Tone)",
    ],
    foleyLayersEn: [
      "Crisp leather heel taps on limestone runway",
      "Tactile wool coat & silk trench fabric rustle",
      "Press-line camera shutter clicks & gallery room tone",
    ],
    summaryKo:
      "2.3초 비트 드롭에 맞춰 워킹 컷 전환이 딱 떨어지는 프렌치 일렉트로닉 BGM과 런웨이 현장 폴리 사운드를 결합합니다.",
    summaryEn:
      "Combines a 122 BPM French house groove (2.3s beat-drop lock) with tactile runway heel taps and fabric rustle.",
    creditsPerTrack: 75,
    priceKrwPerTrack: 900,
  },
  {
    id: "clinical_minimal_pulse",
    badgeKo: "뷰티 · 스킨케어 · 디바이스 추천",
    badgeEn: "Best for Beauty & Skincare Films",
    titleKo: "클리니컬 미니멀 앰비언트 & 수분 제형 ASMR 폴리",
    titleEn: "Clinical Minimal Pulse & Hydro Texture ASMR Foley",
    bpmLabel: "96 BPM · Soft Sub-Pulse",
    loudnessSpec: "-14.0 LUFS / -1.0 dBTP (클린 고역 보존)",
    duckingRuleKo: "성분 내레이션 및 제품 클로즈업 구간 자동 -3 dB 더킹",
    duckingRuleEn: "Automatic -3 dB ducking during INCI narration & macro shots",
    foleyLayersKo: [
      "스포이드 유리 보틀 클릭 & 세럼 물방울 드롭(Drop) 클로즈업 사운드",
      "수분 크림·콜라겐 시트 밀착 스미어(Smear) 마이크로 ASMR",
      "깨끗한 스튜디오 에어 룸톤(Clean Air Room Tone)",
    ],
    foleyLayersEn: [
      "Glass dropper click & close-mic serum droplet sound",
      "Hydrating cream & sheet mask tactile ASMR smear",
      "Pure studio air room tone with zero harsh sibilance",
    ],
    summaryKo:
      "피부 과학·클린 뷰티 브랜드의 신뢰감을 높이는 투명한 미니멀 신스 펄스와 초근접 제형 ASMR 폴리를 마스터링합니다.",
    summaryEn:
      "Pairs crystalline minimal synth pulses with close-mic glass dropper and skincare texture ASMR Foley.",
    creditsPerTrack: 75,
    priceKrwPerTrack: 900,
  },
  {
    id: "warm_acoustic_lounge",
    badgeKo: "F&B · 라이프스타일 · 공간 추천",
    badgeEn: "Best for F&B & Hospitality",
    titleKo: "웜 아날로그 라운지 & 에스프레소/아이스 폴리",
    titleEn: "Warm Analog Lounge & Ice / Espresso Foley",
    bpmLabel: "108 BPM · Warm Tape Groove",
    loudnessSpec: "-14.0 LUFS / -1.0 dBTP (아날로그 테이프 세츄레이션)",
    duckingRuleKo: "잔 따르는 소리·얼음 부딪힘 하이라이트 구간 BGM -3 dB 자동 더킹",
    duckingRuleEn: "Auto -3 dB BGM ducking during pour and ice-clink highlights",
    foleyLayersKo: [
      "크리스탈 잔 속 얼음 부딪힘(Ice Clink) & 탄산 기포 사운드",
      "에스프레소 추출 및 세라믹 컵 플레이팅 현장 폴리",
      "성수·한남 라운지 특유의 따뜻한 우드 공간 잔향",
    ],
    foleyLayersEn: [
      "Crystal glass ice clink & fine carbonation fizz",
      "Espresso extraction & ceramic cup plating Foley",
      "Warm timber & concrete cafe ambient room tone",
    ],
    summaryKo:
      "식음료·호텔·라이프스타일 영상의 미각과 공간감을 깨우는 아날로그 라운지 비트와 생생한 식음 폴리를 조화시킵니다.",
    summaryEn:
      "Blends warm tape-saturated lounge beats with crisp ice clinks, beverage pours, and inviting spatial ambiance.",
    creditsPerTrack: 75,
    priceKrwPerTrack: 900,
  },
  {
    id: "no_bgm_live_foley",
    badgeKo: "크리에이터 릴스 · 오가닉 바이럴 특화",
    badgeEn: "Best for Organic Creator Reels (No-BGM)",
    titleKo: "무BGM 순수 현장 폴리 & 공간음 마스터 (No-BGM Live Ambience)",
    titleEn: "Pure On-Site Foley & Spatial Room Tone Master (No-BGM)",
    bpmLabel: "Natural Live Sync · Zero Artificial BGM",
    loudnessSpec: "-15.5 LUFS / -1.2 dBTP (다이내믹 레인지 보존)",
    duckingRuleKo: "인물 대사·인터뷰 음성이 또렷이 들리도록 주변 공간음 밸런스 자동 조절",
    duckingRuleEn: "Balances ambient room tone around natural spoken dialogue",
    foleyLayersKo: [
      "배경 음악(BGM) 100% 배제 — 실제 카메라 마이크가 수음한 듯한 현장 공기감",
      "인물 동선에 정확히 맞물리는 발걸음·옷자락·소품 접촉음 동기화",
      "인스타그램·틱톡 인앱 트렌드 음원을 위에 얹기 가장 좋은 클린 현장음 트랙",
    ],
    foleyLayersEn: [
      "100% No-BGM — authentic on-camera microphone spatial presence",
      "Frame-accurate footsteps, garment movement, and prop handling",
      "Clean ambient bed ready for native IG/TikTok trending audio overlays",
    ],
    summaryKo:
      "광고 티가 나는 인위적 BGM을 빼고 실제 현장에서 찍은 듯한 생생한 공간음과 폴리만 남겨 오가닉 릴스 체류 시간을 극대화합니다.",
    summaryEn:
      "Strips away artificial background music and masters pure on-set Foley and room tone for maximum organic Reel retention.",
    creditsPerTrack: 60,
    priceKrwPerTrack: 700,
  },
];

export type FirstCreationGoalId =
  | "fashion_lookbook"
  | "product_ecommerce"
  | "micro_retouch_edit"
  | "video_storyboard_motion"
  | "creator_campaign_format"
  | "creator_seeding_distribution"
  | "brand_signature_audio";

export interface FirstCreationGoalCard {
  id: FirstCreationGoalId;
  titleKo: string;
  titleEn: string;
  subtitleKo: string;
  subtitleEn: string;
  targetTrack: BrandCoreDeliverableTrackId;
  targetMedium: "image" | "video";
  targetSubMode: StudioImageSubMode;
  targetWorkflowMode: StudioReferenceWorkflowId;
  targetImageModelId: BrandStudioImageModelId;
  targetAspect: "1:1" | "4:5" | "3:4" | "16:9" | "9:16";
}

/**
 * Onboarding "What are you here to make first?" goal cards covering all 5 Core Deliverables.
 * Selecting a goal automatically configures the studio's track, sub-mode, reference workflow, model, and aspect ratio.
 */
export const FIRST_CREATION_GOALS: readonly FirstCreationGoalCard[] = [
  {
    id: "fashion_lookbook",
    titleKo: "이미지 · 멀티 레퍼런스 화보",
    titleEn: "Image · Multi-Ref Lookbook",
    subtitleKo: "Nano Banana Pro / Seedream 5.0 Pro · 1~4번 레퍼런스 조합 화보",
    subtitleEn: "Nano Banana Pro / Seedream 5.0 Pro · 4-slot lookbook composite",
    targetTrack: "image",
    targetMedium: "image",
    targetSubMode: "multi_ref_generate",
    targetWorkflowMode: "lookbook_composite",
    targetImageModelId: "nano_banana_pro",
    targetAspect: "4:5",
  },
  {
    id: "product_ecommerce",
    titleKo: "이미지 · 제품 교체 & 이커머스",
    titleEn: "Image · Product Swap & SKU",
    subtitleKo: "Nano Banana 2.1 / GPT Image 2.6 · 1번 장면 → 2번 우리 제품 교체",
    subtitleEn: "Nano Banana 2.1 / GPT Image 2.6 · Swap scene product with your SKU",
    targetTrack: "image",
    targetMedium: "image",
    targetSubMode: "multi_ref_generate",
    targetWorkflowMode: "product_swap",
    targetImageModelId: "nano_banana_2_1",
    targetAspect: "1:1",
  },
  {
    id: "micro_retouch_edit",
    titleKo: "이미지 · 극소 부위 정밀 수정",
    titleEn: "Image · Micro-Region Edit",
    subtitleKo: "GPT Image 2.6 · 캔버스 드래그 영역만 스마트 마스크로 부분 교정",
    subtitleEn: "GPT Image 2.6 · Drag selection box to edit only that region",
    targetTrack: "image",
    targetMedium: "image",
    targetSubMode: "micro_region_edit",
    targetWorkflowMode: "lookbook_composite",
    targetImageModelId: "gpt_image_2_6",
    targetAspect: "4:5",
  },
  {
    id: "video_storyboard_motion",
    titleKo: "영상 · 1080p 브랜드 필름",
    titleEn: "Video · 1080p Brand Film",
    subtitleKo: "화보 첫 프레임 고정 → 720p 동선 검수 → 1080p 마스터 영상",
    subtitleEn: "Start-frame lock -> 720p motion check -> 1080p master film",
    targetTrack: "video",
    targetMedium: "video",
    targetSubMode: "multi_ref_generate",
    targetWorkflowMode: "lookbook_composite",
    targetImageModelId: "nano_banana_pro",
    targetAspect: "9:16",
  },
  {
    id: "creator_campaign_format",
    titleKo: "크리에이터 캠페인 영상 (셀프 · 의뢰)",
    titleEn: "Creator Campaign Format (Self · Commission)",
    subtitleKo: "셀카 1장으로 우리 제품 영상이 나오는 포맷 셀프 빌드 또는 D+3 의뢰",
    subtitleEn: "Self-build or commission a 1-selfie creator campaign video format",
    targetTrack: "creator_format",
    targetMedium: "video",
    targetSubMode: "multi_ref_generate",
    targetWorkflowMode: "lookbook_composite",
    targetImageModelId: "seedream_5_0_pro",
    targetAspect: "9:16",
  },
  {
    id: "creator_seeding_distribution",
    titleKo: "크리에이터 캠페인 영상 + 유통까지",
    titleEn: "Creator Campaign + Seeding Distribution",
    subtitleKo: "포맷 제작 + 팔로워 3,000+ 크리에이터 10~50인+ 동시 시딩 & ROI 리포트",
    subtitleEn: "Format + 10–50+ verified creators seeding across IG/TikTok/Shorts",
    targetTrack: "creator_distribution",
    targetMedium: "video",
    targetSubMode: "multi_ref_generate",
    targetWorkflowMode: "lookbook_composite",
    targetImageModelId: "seedream_5_0_pro",
    targetAspect: "9:16",
  },
  {
    id: "brand_signature_audio",
    titleKo: "오디오 · 시그니처 BGM & 폴리",
    titleEn: "Audio · Signature BGM & Foley",
    subtitleKo: "브랜드 전용 BGM · 현장 폴리 공간음 · Act 1 -3 dB 더킹 · -14 LUFS 마스터",
    subtitleEn: "Custom BGM, tactile Foley, Act 1 -3 dB ducking & -14 LUFS master",
    targetTrack: "audio",
    targetMedium: "video",
    targetSubMode: "multi_ref_generate",
    targetWorkflowMode: "lookbook_composite",
    targetImageModelId: "nano_banana_2_0",
    targetAspect: "9:16",
  },
];

export interface ExtractedBrandKit {
  domain: string;
  monogram: string;
  colors: ReadonlyArray<{ hex: string; labelKo: string; labelEn: string }>;
  displayFont: string;
  bodyFont: string;
  pairingSummaryKo: string;
  pairingSummaryEn: string;
  rulesKo: [string, string, string];
  rulesEn: [string, string, string];
  recommendedPinnedColorId: string;
  recommendedPinnedTextureId: string;
}

/**
 * Mirrors the "Building your brand kit (Logo · Colors · Type)" auto-extractor modal:
 * Given a brand website domain or handle, synthesizes a structured Brand Kit (Logo monogram,
 * 5-color palette, Display/Body typography specimen, and 3 core brand identity rules).
 */
export function extractBrandKitFromDomain(
  rawInput: string,
  category: BrandClientCategory,
): ExtractedBrandKit {
  const cleaned = rawInput
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0] || "twings.app";
  const baseName = (cleaned.split(".")[0] || "BRAND").toUpperCase();
  const monogram = baseName.slice(0, 2);

  if (category === "beauty_skincare") {
    return {
      domain: cleaned,
      monogram,
      colors: [
        { hex: "#F7F4EF", labelKo: "보타니컬 아이보리", labelEn: "Botanical Ivory" },
        { hex: "#DCE7F3", labelKo: "세럼 하이드로 블루", labelEn: "Hydro Blue" },
        { hex: "#2A5C9A", labelKo: "클리니컬 코발트", labelEn: "Clinical Cobalt" },
        { hex: "#C8B6A6", labelKo: "누드 베이지", labelEn: "Nude Beige" },
        { hex: "#141619", labelKo: "딥 잉크", labelEn: "Deep Ink" },
      ],
      displayFont: "Editorial Serif",
      bodyFont: "Pretendard Variable",
      pairingSummaryKo: "클리니컬 세리프 헤드라인 + 고밀도 산세리프 성분 표기",
      pairingSummaryEn: "Clinical Serif Display + Clean Sans-Serif INCI Body",
      rulesKo: [
        `${baseName} 보틀 숄더 곡률과 스포이드·펌프 비율 1:1 고정`,
        `전면 ${baseName} 로고 타이포그래피 철자 및 용량 표기 왜곡 금지`,
        "투명 유리의 자연 굴절광과 수분감 있는 세미매트 피부결 유지",
      ],
      rulesEn: [
        `Lock ${baseName} bottle shoulder curvature and dropper proportions 1:1`,
        `Preserve ${baseName} front label typography and volume markings`,
        "Maintain clean glass refraction and hydrated semi-matte skin texture",
      ],
      recommendedPinnedColorId: "color_crisp_studio_neutral",
      recommendedPinnedTextureId: "texture_dewy_glass_smear",
    };
  }

  if (category === "fnb_hospitality") {
    return {
      domain: cleaned,
      monogram,
      colors: [
        { hex: "#F4EFE6", labelKo: "웜 오트밀", labelEn: "Warm Oatmeal" },
        { hex: "#D9A464", labelKo: "로스티드 앰버", labelEn: "Roasted Amber" },
        { hex: "#2B5B9E", labelKo: "시그니처 블루", labelEn: "Signature Blue" },
        { hex: "#4A3525", labelKo: "에스프레소 브라운", labelEn: "Espresso Brown" },
        { hex: "#181512", labelKo: "차콜 로스트", labelEn: "Charcoal Roast" },
      ],
      displayFont: "Grotesk Display",
      bodyFont: "Pretendard Variable",
      pairingSummaryKo: "볼드 패키지 그로테스크 + 메뉴 에디토리얼 본문",
      pairingSummaryEn: "Bold Packaging Grotesk + Warm Editorial Menu Body",
      rulesKo: [
        `${baseName} 캔·보틀·컵 슬리브 원통 곡률 및 리드 형태 고정`,
        `곡면 라벨 위 ${baseName} 로고와 플레이버 텍스트 선명도 유지`,
        "차가운 표면의 자연 결로 물방울과 신선한 원재료 텍스처 보존",
      ],
      rulesEn: [
        `Lock ${baseName} can/bottle cylinder curvature and lid geometry`,
        `Keep curved ${baseName} label typography sharp without warping`,
        "Preserve natural cold condensation droplets and fresh ingredient texture",
      ],
      recommendedPinnedColorId: "color_warm_film_2383",
      recommendedPinnedTextureId: "texture_dewy_glass_smear",
    };
  }

  return {
    domain: cleaned,
    monogram,
    colors: [
      { hex: "#1E4E8C", labelKo: "프렌치 코발트", labelEn: "French Cobalt" },
      { hex: "#DCE7F7", labelKo: "아이스 스카이", labelEn: "Ice Sky" },
      { hex: "#F5F4F0", labelKo: "알라바스터 화이트", labelEn: "Alabaster White" },
      { hex: "#8C96A6", labelKo: "콘크리트 그레이", labelEn: "Concrete Slate" },
      { hex: "#0F1115", labelKo: "오닉스 블랙", labelEn: "Onyx Ink" },
    ],
    displayFont: "Editorial Display",
    bodyFont: "Pretendard Variable",
    pairingSummaryKo: "모던 에디토리얼 디스플레이 + Pretendard 정밀 캡션",
    pairingSummaryEn: "Modern Editorial Display + Pretendard Precision Caption",
    rulesKo: [
      `${baseName} 시그니처 아우터·오브제 실루엣 및 테일러드 어깨선 고정`,
      `직조 라벨·금속 각인 위 ${baseName} 철자 100% 무결성 유지`,
      "35mm 아날로그 필름 그레인과 매트한 실제 피부·원단 직조 결 보존",
    ],
    rulesEn: [
      `Lock ${baseName} signature silhouette and tailored shoulder line`,
      `Preserve 100% spelling integrity on ${baseName} woven labels and hardware`,
      "Maintain 35mm analog film grain and matte skin/fabric micro-texture",
    ],
    recommendedPinnedColorId: "color_editorial_cobalt",
    recommendedPinnedTextureId: "texture_matte_skin_35mm",
  };
}
