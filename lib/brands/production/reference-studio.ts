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
      titleKo: "이미지 스튜디오 (1~4번 참고 이미지 생성 · 원하는 부위만 부분 수정)",
      titleEn: "Image Studio (1–4 Ref Composite & Micro-Region Edit)",
      badgeKo: "화보 생성 · 제품 교체 · 부분 수정",
      badgeEn: "Lookbook · Product Swap · Smart Mask Edit",
      summaryKo:
        "1~4번 역할별 참고 사진(인물·배경·포즈·색감)을 조합해 화보를 만들고, 어색한 부분만 드래그해 고치거나 브랜드 색감·질감을 항상 똑같이 고정합니다.",
      summaryEn:
        "Combine 1–4 role-locked references, run surgical micro-region Smart Mask edits, and pin brand color & texture references in one studio.",
      deliverablesKo: [
        "1~4번 참고 사진 조합 캠페인 화보 · 전신 룩북 (2K/4K)",
        "1번 배경·손 모양 유지 → 2번 우리 제품으로 교체한 상세페이지 컷",
        "원본은 그대로 두고 드래그한 부분만 고치는 정밀 부분 수정",
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
      titleKo: "영상 스튜디오 (첫 장면 고정 · 720p 확인 후 1080p 고화질 완성)",
      titleEn: "Video Studio (Start-Frame Lock · 720p Check -> 1080p Master)",
      badgeKo: "2단계 확인 · 1080p 브랜드 영상",
      badgeEn: "2-Stage Gate · 1080p Brand Film",
      summaryKo:
        "마음에 드는 화보 컷을 영상의 첫 장면으로 고정하고, 720p로 움직임과 표정을 먼저 확인한 뒤 통과한 영상만 1080p 고화질로 완성해 비용을 아낍니다.",
      summaryEn:
        "Lock your approved key visual as Frame 1, verify camera blocking in 720p first, and finish only approved takes into 1080p master films.",
      deliverablesKo: [
        "화보 첫 장면이 흔들리지 않는 9:16 릴스 · 16:9 가로형 브랜드 필름",
        "1단계(720p 움직임 먼저 확인) → 2단계(1080p 고화질·색보정 최종 완성)",
        "자연스러운 카메라 워킹과 음악 비트에 맞춘 컷 전환",
      ],
      deliverablesEn: [
        "Start-frame locked 9:16 Reels & 16:9 widescreen campaign films",
        "Stage 1 (720p motion check) -> Stage 2 (1080p optical & grain master)",
        "Camera blocking (dolly-in, pan, one-take) & beat-synced cut control",
      ],
      turnaroundKo: "720p 미리보기 약 60초 · 1080p 완성 약 90초",
      turnaroundEn: "~60s for 720p preview · ~90s for 1080p master",
      priceGuideKo: "720p 확인 1,800원 (145 cr) · 1080p 완성 5,500원 (440 cr)",
      priceGuideEn: "720p check ₩1,800 (145 cr) · 1080p master ₩5,500 (440 cr)",
      previewImage: "/reel/brands/house-french-blue-hero-1080p.jpg",
    },
    {
      id: "creator_format",
      orderNumber: "03",
      shortLabelKo: "크리에이터 캠페인 영상 (셀프 · 의뢰)",
      shortLabelEn: "Creator Campaign Video (Self · Commission)",
      titleKo: "크리에이터 캠페인용 영상 제작 (직접 만들기 · 전담팀 의뢰)",
      titleEn: "Creator Campaign Format Studio (Self-Build or Studio Commission)",
      badgeKo: "직접 제작 또는 3일 내 전담 완성",
      badgeEn: "Self-Serve Builder or D+3 Custom Commission",
      summaryKo:
        "크리에이터가 정면 셀카 1장만 넣으면 우리 브랜드 제품·의상·배경·색감이 그대로 입혀진 주인공 영상이 나오는 캠페인 전용 템플릿을 직접 만들거나 전담팀에 의뢰합니다.",
      summaryEn:
        "Build a reusable campaign video format where any creator drops 1 front selfie to star in your locked product, outfit, set, and color grade—or commission our directors.",
      deliverablesKo: [
        "직접 만들기: [크리에이터 얼굴 칸] + [우리 제품·배경·색감 고정] 템플릿 즉시 생성",
        "전담팀 의뢰: 제품 사진만 전달하면 3일(D+3) 안에 맞춤 캠페인 템플릿 제작·납품",
        "참여 크리에이터마다 셀카 1장으로 흔들림 없는 브랜드 퀄리티 영상 제작",
      ],
      deliverablesEn: [
        "Self-Builder: Lock [Creator Selfie Slot] + [Brand Product, Set & Color] in minutes",
        "Commissioned: Send product photos and receive a custom format within D+3 days",
        "Every creator generates consistent brand-grade videos from 1 front selfie",
      ],
      turnaroundKo: "직접 제작 즉시 · 전담팀 의뢰 D+3일 확정",
      turnaroundEn: "Instant (Self) · D+3 confirmed (Commissioned)",
      priceGuideKo: "직접 테스트 1,800원~ · 전담팀 맞춤 제작 의뢰 별도 견적",
      priceGuideEn: "Self format test from ₩1,800 · Custom format commission on brief",
      previewImage: "/reel/brands/slot-3-pose-lowangle-lookbook.jpg",
    },
    {
      id: "creator_distribution",
      orderNumber: "04",
      shortLabelKo: "크리에이터 캠페인 영상 + 유통",
      shortLabelEn: "Creator Campaign + Distribution",
      titleKo: "크리에이터 캠페인 영상 제작 + SNS 동시 게시 · 성과 리포트",
      titleEn: "Creator Campaign Format + Multi-Creator Seeding & ROI Distribution",
      badgeKo: "영상 제작 + 크리에이터 게시 + 광고 활용권",
      badgeEn: "Format + Creator Seeding + Ad Usage Rights",
      summaryKo:
        "캠페인 영상 제작에서 끝나지 않고, 팔로워 3,000명 이상 검증된 크리에이터 섭외·인스타 릴스/틱톡/쇼츠 동시 게시·실시간 조회수 리포트·2차 광고 활용권까지 한 번에 진행합니다.",
      summaryEn:
        "End-to-end execution from custom campaign format creation to 3,000+ follower creator matching, simultaneous seeding (IG Reels, TikTok, Shorts), live ROI reporting, and 2nd-use paid ad rights.",
      deliverablesKo: [
        "팔로워 3,000+ 카테고리 맞춤 크리에이터 10명 / 30명 / 50명+ 동시 게시 유통",
        "진행 일정: 의뢰 → D+3 템플릿 확정 → D+7 섭외 → D+14 동시 게시 → D+21 성과 리포트",
        "게시된 고화질 영상 원본 파일 다운로드 및 메타·틱톡 2차 광고 활용권 제공",
      ],
      deliverablesEn: [
        "Matched 3,000+ follower creators (10 / 30 / 50+ cohort seeding across IG, TikTok, Shorts)",
        "Timeline: Brief -> D+3 Format Lock -> D+7 Cohort Match -> D+14 Post -> D+21 ROI Report",
        "Clean 1080p master downloads + cleared 2nd-use paid ad rights (Meta / TikTok Spark Ads)",
      ],
      turnaroundKo: "D+3 템플릿 확정 · D+14 크리에이터 동시 게시 · D+21 리포트",
      turnaroundEn: "D+3 Format · D+14 Cohort Post · D+21 Final Report",
      priceGuideKo: "10인 초기 검증 · 30인 신제품 런칭 · 50인+ 대규모 확산 패키지",
      priceGuideEn: "10-Creator Seed · 30-Creator Growth · 50+ Mega Launch Packages",
      previewImage: "/reel/brands/studio-editorial-blue-1080p.jpg",
    },
    {
      id: "audio",
      orderNumber: "05",
      shortLabelKo: "오디오",
      shortLabelEn: "Audio",
      titleKo: "오디오 스튜디오 (브랜드 맞춤 배경음악 · 생생한 현장음 · 음량 자동 보정)",
      titleEn: "Audio Studio (Signature BGM · Foley Spatial Sound · -14 LUFS Master)",
      badgeKo: "배경음악 · 현장 효과음 · 상업용 음원",
      badgeEn: "BGM · Foley · -14 LUFS Commercial Master",
      summaryKo:
        "브랜드 분위기에 맞는 배경음악(BGM)부터 옷깃 스치는 소리·얼음 소리·발걸음 같은 현장 효과음, 목소리가 나올 때 배경음을 자연스럽게 줄여주는 기능까지 한 번에 완성합니다.",
      summaryEn:
        "Compose brand-tailored BGM, tactile Foley & room tone, automatic voiceover ducking (Act 1 -3 dB), and -14 LUFS / -1 dBTP commercial loudness mastering.",
      deliverablesKo: [
        "브랜드 카테고리별 맞춤 배경음악(BGM) & 화면 전환 타이밍 자동 맞춤",
        "생생한 현장 효과음(구두 발걸음·원단 스침·유리잔 얼음·카메라 셔터) + 무음악 현장음 버전",
        "내레이션 구간 배경음 자동 낮춤(-3dB) & 인스타·틱톡 표준 음량(-14 LUFS) 마감",
      ],
      deliverablesEn: [
        "Category-tailored signature BGM with frame-accurate beat-drop sync",
        "Tactile Foley stems (heels, silk rustle, glass clink, shutter) + No-BGM live ambient mix",
        "Automatic Act 1 -3 dB dialogue ducking & -14 LUFS / -1 dBTP broadcast master",
      ],
      turnaroundKo: "즉시 생성 및 영상 길이 자동 맞춤 (약 25초)",
      turnaroundEn: "Instant generation & frame-accurate sync (~25s)",
      priceGuideKo: "곡당 900원 (75 cr) · 상업 광고 음원 저작권 해결 포함",
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
      tierBadgeKo: "제품 로고 글자 보존 · 복잡한 지시문 · 부분 수정 1순위",
      tierBadgeEn: "Flagship · Complex Briefs & Exact Typography",
      promptFormulaBadgeKo: "얼굴·제품은 그대로 두고 배경·의상·조명만 깔끔하게 분리 연출",
      promptFormulaBadgeEn: "5-Tier Director Brief (Crop -> Ref Authority -> Pose/Garment -> Space -> #HEX Light)",
      shortTraitKo:
        "제품 라벨의 영문·한글 로고 철자를 뭉개짐 없이 가장 또렷하게 살리고, 복잡한 요청이나 어색한 부위 부분 수정에 가장 강한 모델입니다",
      shortTraitEn:
        "Flagship precision for complex multi-constraint briefs, exact package label typography, and surgical micro-region edits",
      strengthsKo: ["제품 로고·글자 선명 유지", "복잡한 요청 정확히 반영", "어색한 부위 정밀 수정"],
      strengthsEn: ["Exact Label Typography", "Complex Brief Fidelity", "Surgical Region Edit"],
      detailDescriptionKo:
        "여러 가지 조건이 섞인 까다로운 요청도 정확히 이해합니다. 예를 들어 '1번 사진에서는 얼굴만 가져오고 원래 배경과 소품은 완전히 지운 뒤, 2번 제품의 전면 로고 글자를 선명하게 살려 달라'는 식의 세밀한 연출에 가장 뛰어납니다.",
      detailDescriptionEn:
        "Parses 5-tier creative director briefs with strict reference authority isolation—locking facial identity or bottle geometry from Slot 1 while cleanly discarding unwanted source props and preserving crisp label lettering.",
      bestForDeliverablesKo: [
        "제품 앞면의 작은 로고 글자와 심볼 모양이 조금도 깨지면 안 되는 대표 상품컷",
        "1번 사진에서 인물 얼굴만 가져오고 의상·배경·조명은 완전히 새로 꾸미는 화보",
        "완성된 사진에서 손 모양·소품·로고 등 원하는 부위만 드래그해 자연스럽게 고칠 때",
      ],
      bestForDeliverablesEn: [
        "Hero key visuals where front package typography and brand marks must remain razor-sharp",
        "Editorial portraits isolating facial likeness from Slot 1 while building a brand-new set and outfit",
        "Targeted micro-region corrections on hands, held props, and engraved hardware",
      ],
      recommendedSlotFormulaKo:
        "1번(인물 또는 기본 배경) + 2번(우리 제품 정면 사진) + 3번(로고·소재 확대컷) + 4번(조명·색감 참고)",
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
      tierBadgeKo: "1~4번 참고 사진 동시 조합 · 4K 대표 화보 1순위",
      tierBadgeEn: "Master · 1–4 Slot Multi-Ref & 4K Lookbook",
      promptFormulaBadgeKo: "1번 인물 + 2번 배경 + 3번 포즈 + 4번 색감 동시 조합",
      promptFormulaBadgeEn: "ALL-CAPS Lock Blocks (IDENTITY LOCK · COMPOSITION LOCK · POSE LOCK · COLOR GRADE)",
      shortTraitKo:
        "1번 인물, 2번 배경 공간, 3번 포즈·구도, 4번 색감을 한 번에 자연스럽게 합쳐 최대 4K 고화질 캠페인 화보로 완성하는 대표 모델입니다",
      shortTraitEn:
        "Master of locking Slot 1 (Person) + Slot 2 (Space) + Slot 3 (Pose Vibe) + Slot 4 (Color Grade) into 2K/4K editorial frames",
      strengthsKo: ["1~4번 사진 동시 조합", "최대 4K 초고화질 화보", "조명·색감 자연스러운 흡수"],
      strengthsEn: ["4-Slot Simultaneous Lock", "Native 2K/4K Output", "Seamless Color Transfer"],
      detailDescriptionKo:
        "참고 사진 4장의 역할을 각각 정확히 나누어 반영합니다. 1번 사진의 얼굴, 2번 사진의 공간 분위기, 3번 사진의 카메라 각도와 포즈, 4번 사진의 색감을 어색한 합성 티 없이 한 장의 4K급 화보로 묶어 줍니다.",
      detailDescriptionEn:
        "Uses explicit IDENTITY LOCK, COMPOSITION LOCK, and COLOR GRADE compartments to fuse up to 4 references with zero composition drift and rich optical halation up to 4K.",
      bestForDeliverablesKo: [
        "1번 모델이 2번 장소에서 3번 포즈와 4번 색감으로 서 있는 메인 캠페인 화보",
        "화보를 먼저 만든 뒤 영상 스튜디오의 '첫 장면'으로 바로 이어서 쓸 고화질 원본",
        "고정해 둔 브랜드 색감과 필름 입자감을 시즌 화보 전체에 똑같이 입힐 때",
      ],
      bestForDeliverablesEn: [
        "Main campaign lookbooks combining Person (1) + Space (2) + Pose Vibe (3) + Color Grade (4)",
        "High-density 2K/4K keyframes ready to lock as Frame 1 in the Video Studio",
        "Season lookbooks enforcing pinned brand color temperature and 35mm grain",
      ],
      recommendedSlotFormulaKo:
        "1번(모델 얼굴) + 2번(배경 장소) + 3번(원하는 포즈·앵글) + 4번(원하는 색감·조명)",
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
      tierBadgeKo: "1번 장면 그대로 → 2번 우리 제품으로 교체 · 가성비 주력",
      tierBadgeEn: "Production Standard · 1->2 Product Swap",
      promptFormulaBadgeKo: "원본 조명·손 모양·그림자는 유지하고 제품만 감쪽같이 교체",
      promptFormulaBadgeEn: "High-Thinking Scene Lock + Target SKU 1:1 Swap Protocol",
      shortTraitKo:
        "1번 사진의 배경 조명, 손 모양, 바닥 그림자는 그대로 살려 두고, 안에 있는 제품만 2번 우리 제품으로 자연스럽게 바꿔 끼우는 실무 주력 모델입니다",
      shortTraitEn:
        "High-thinking production workhorse for keeping Image 1's lighting, hands, and shadows while swapping in your SKU from Image 2",
      strengthsKo: ["1→2번 제품 감쪽같은 교체", "손 모양·바닥 그림자 유지", "빠른 속도·합리적 비용"],
      strengthsEn: ["1->2 SKU Product Swap", "Hand & Contact Shadow Lock", "Fast Production ROI"],
      detailDescriptionKo:
        "1번 사진의 공간감과 테이블 반사광, 제품을 쥐고 있는 손가락 모양을 흐트러뜨리지 않고 그 자리에 2번 우리 브랜드 제품을 자연스럽게 앉혀 줍니다. 상세페이지용 제품 연출컷을 여러 장 만들 때 가장 효율적입니다.",
      detailDescriptionEn:
        "Leverages high-thinking spatial reasoning to preserve perspective, surface reflections, and finger occlusion in Image 1 while seamlessly swapping in your product from Image 2.",
      bestForDeliverablesKo: [
        "마음에 드는 1번 연출 사진 속 기존 화장품·음료·소품을 2번 우리 제품으로 바꿀 때",
        "모델 손에 들린 병·가방·패키지만 우리 브랜드 신제품으로 깔끔하게 교체할 때",
        "상세페이지에 쓸 여러 각도의 제품 연출 사진 5장 세트를 부담 없는 비용으로 만들 때",
      ],
      bestForDeliverablesEn: [
        "Replacing an existing bottle, jar, or object in Image 1 with your own product in Image 2",
        "Swapping held props (cosmetics, beverages, bags) in a model's hand without finger distortion",
        "Producing 5-cut e-commerce PDP product sets with consistent studio lighting",
      ],
      recommendedSlotFormulaKo:
        "1번(유지할 배경·손 구도) + 2번(교체할 우리 제품 정면) + 3번(제품 측면·질감) + 4번(색감 참고)",
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
      tierBadgeKo: "초고속 시안 확인 · 여러 구도 가볍게 테스트",
      tierBadgeEn: "Ultra-Fast Drafts · Angle & Mood Exploration",
      promptFormulaBadgeKo: "가장 저렴한 비용으로 10초 만에 5가지 구도·배경 시안 빠르게 비교",
      promptFormulaBadgeEn: "Lightweight Multi-Ref Fast Framing & Color Variation",
      shortTraitKo:
        "최종 고화질 화보를 뽑기 전에 여러 가지 카메라 각도, 배경 분위기, SNS 썸네일 구도를 가장 빠르고 저렴하게 테스트해 볼 때 좋습니다",
      shortTraitEn:
        "Fastest and most economical engine for exploring camera angles, moodboards, and 9:16 social thumbnail variations",
      strengthsKo: ["10초대 빠른 5컷 생성", "가장 부담 없는 비용", "여러 구도 한눈에 비교"],
      strengthsEn: ["Ultra-Fast 5-Cut Drafts", "Lowest Credit Cost", "Rapid Angle Exploration"],
      detailDescriptionKo:
        "1~4번 참고 사진의 전체적인 구도와 분위기만 빠르게 잡아 10초대에 5장 시안을 보여 줍니다. 본 작업(Nano Banana Pro나 GPT Image 2.6)에 들어가기 전에 어떤 구도와 배경이 가장 잘 어울리는지 먼저 골라낼 때 유용합니다.",
      detailDescriptionEn:
        "Generates 5-shot multi-reference concept sets in seconds at minimal credit cost—ideal for locking framing and lighting before final 2K/4K mastering in Nano Banana Pro or GPT Image 2.6.",
      bestForDeliverablesKo: [
        "본격적인 화보 제작 전에 10~20가지 배경·각도 조합을 빠르게 눈으로 비교해 볼 때",
        "인스타그램 릴스·틱톡·유튜브 쇼츠용 9:16 세로 표지 시안을 여러 장 뽑아볼 때",
        "캠페인 영상 제작 전에 전체적인 장면 흐름(스토리보드)을 가볍게 스케치할 때",
      ],
      bestForDeliverablesEn: [
        "Comparing 10–20 background and camera angle combinations during campaign pre-production",
        "Batch-creating 9:16 vertical cover thumbnails for Instagram Reels, TikTok, and Shorts",
        "Sketching storyboard frames for creator campaign formats before final lock",
      ],
      recommendedSlotFormulaKo:
        "1번(주제·인물) + 2번(배경 분위기) + 3번(구도 참고) + 4번(전체 색감)",
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
      tierBadgeKo: "실제 같은 피부결 · 전신 비율 · 의류 착장 1순위",
      tierBadgeEn: "Master · Real Matte Skin, 8-Head Lookbook & VTO",
      promptFormulaBadgeKo: "인위적인 AI 피부 광택 제거 · 실제 모공과 원단 결 · 의류 핏 고정",
      promptFormulaBadgeEn: "Authentic Matte Skin Pores · Zero Plastic Sheen · Exact Garment Fit Lock",
      shortTraitKo:
        "AI 특유의 번들거리는 인형 피부 느낌을 없애고 실제 사람 같은 보송한 피부결, 자연스러운 전신 비율, 옷 원래 핏을 그대로 살리는 패션·뷰티 특화 모델입니다",
      shortTraitEn:
        "Unmatched for authentic matte skin pores (zero plastic sheen), natural full-body lookbook proportions, and exact garment virtual try-on",
      strengthsKo: ["번들거림 없는 실제 피부결", "옷 기장·주름·봉제선 유지", "자연스러운 전신 모델 비율"],
      strengthsEn: ["Matte Real Skin Pores", "100% Garment Fit Lock", "Natural Full-Body Proportions"],
      detailDescriptionKo:
        "AI 사진에서 흔히 보이는 플라스틱처럼 매끈하고 번들거리는 피부 광택을 잡아서, 실제 카메라로 찍은 매거진 화보처럼 잔잔한 피부결과 원단 조직감을 살려 줍니다. 바닥에 놓고 찍은 옷 사진을 모델에게 자연스럽게 입히는 작업에도 가장 뛰어납니다.",
      detailDescriptionEn:
        "Eliminates synthetic waxy highlights to preserve natural skin micro-texture and strict garment construction (length, seams, print scale) for fashion lookbooks and beauty editorials.",
      bestForDeliverablesKo: [
        "바닥컷·옷걸이컷 의류(2번)의 기장과 핏을 변형 없이 모델(1번)에게 그대로 입히는 룩북",
        "인위적인 보정 느낌 없이 실제 피부 모공과 솜털 결이 살아 있어야 하는 뷰티·패션 화보",
        "한 명의 브랜드 모델로 정면·측면·후면 전신 컷을 흔들림 없는 비율로 연달아 찍을 때",
      ],
      bestForDeliverablesEn: [
        "Virtual Try-On (VTO) dressing Slot 1's model in Slot 2's flat-lay garment with zero seam or print drift",
        "Beauty & fashion editorials requiring real matte skin pores with zero synthetic waxy highlights",
        "Full-body front/side/back agency digitals and lookbooks with consistent model proportions",
      ],
      recommendedSlotFormulaKo:
        "1번(착장할 모델 사진) + 2번(입힐 의류·제품 정면) + 3번(원하는 착장 핏·포즈) + 4번(차분한 필름 색감)",
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
          tagKo: "1번 · 인물",
          tagEn: "Image 1 · Person",
          roleTitleKo: "모델 얼굴 · 헤어 · 피부",
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
          tagKo: "2번 · 배경",
          tagEn: "Image 2 · Background",
          roleTitleKo: "배경 공간 · 장소",
          roleTitleEn: "Space · Location / Set",
          lockRuleKo: "공간 구조·깊이감 반영",
          lockRuleEn: "Applies spatial depth & set",
          required: true,
          defaultThumb: defaultBgThumb,
          defaultAssetNameKo: "성수 콘크리트 & 채광 공간",
          defaultAssetNameEn: "Daylight Concrete Studio Set",
        },
        {
          slotNumber: 3,
          tagKo: "3번 · 포즈",
          tagEn: "Image 3 · Editorial Vibe",
          roleTitleKo: "포즈 · 카메라 각도",
          roleTitleEn: "Vibe · Pose / Camera Angle",
          lockRuleKo: "포즈·구도·사진 분위기",
          lockRuleEn: "Matches pose & lens framing",
          required: false,
          defaultThumb: defaultVibeThumb,
          defaultAssetNameKo: "3/4 에디토리얼 앵글 감도",
          defaultAssetNameEn: "3/4 Editorial Framing Ref",
        },
        {
          slotNumber: 4,
          tagKo: "4번 · 색감",
          tagEn: "Image 4 · Color Grade",
          roleTitleKo: "조명 · 필름 색감",
          roleTitleEn: "Color · Lighting & Moodprint",
          lockRuleKo: "색감·조명 분위기 맞춤",
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
      labelKo: "제품 교체 · 상세페이지 컷 (1번 장면 ↔ 2번 제품)",
      labelEn: "Product Swap & Packshot Reshoot (Image 1 ↔ Image 2)",
      summaryKo:
        "1번 사진의 구도·조명·손 모양은 그대로 두고, 안에 있는 제품만 2번 우리 제품으로 감쪽같이 교체합니다",
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
          tagKo: "1번 · 기본 장면",
          tagEn: "Image 1 · Base Scene",
          roleTitleKo: "배경 · 손 모양 · 구도",
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
          tagKo: "2번 · 우리 제품",
          tagEn: "Image 2 · Target Product",
          roleTitleKo: "교체할 우리 제품 정면",
          roleTitleEn: "Our Product · Front Master",
          lockRuleKo: "제품 모양·로고 글자 보존",
          lockRuleEn: "98% shape & label preservation",
          required: true,
          defaultThumb: defaultProductThumb,
          defaultAssetNameKo: "우리 브랜드 제품 정면 원판",
          defaultAssetNameEn: "Brand Product Front Master",
        },
        {
          slotNumber: 3,
          tagKo: "3번 · 디테일",
          tagEn: "Image 3 · Side / Detail",
          roleTitleKo: "제품 측면 · 소재 디테일",
          roleTitleEn: "Detail · Side / Texture / Logo",
          lockRuleKo: "측면 두께·표면 질감 보강",
          lockRuleEn: "Reinforces texture & side profile",
          required: false,
          defaultThumb: defaultDetailThumb,
          defaultAssetNameKo: "소재 · 라벨 클로즈업 보조컷",
          defaultAssetNameEn: "Material & Label Detail Ref",
        },
        {
          slotNumber: 4,
          tagKo: "4번 · 조명·색감",
          tagEn: "Image 4 · Light & Color",
          roleTitleKo: "원하는 조명 · 색감",
          roleTitleEn: "Tone · Specular & Color Ref",
          lockRuleKo: "표면 반사광·색감 맞춤",
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
      titleKo: "프렌치 코발트 화보 톤",
      titleEn: "French Cobalt Editorial Tone",
      ruleKo: "맑은 자연광 · 깊이 있는 네이비 그림자 · 자연스러운 피부톤 유지",
      ruleEn: "5400K cool daylight · deep navy shadows · balanced skin saturation",
      swatchHex: "#3875C5",
      thumb: "/reel/brands/slot-4-color-french-cobalt.jpg",
      promptTokenKo: "[고정 색감 레퍼런스: 5400K 프렌치 코발트 에디토리얼 색온도 및 섀도우 커브 유지]",
      promptTokenEn: "[Pinned Color Ref: 5400K French cobalt editorial color temperature and shadow curve]",
    },
    {
      id: "color_warm_film_2383",
      kind: "color",
      titleKo: "따뜻한 오후 햇살 필름 톤",
      titleEn: "Warm Daylight 2383 Film Grade",
      ruleKo: "따뜻한 자연 채광 · 부드러운 윤기 · 아날로그 필름 색감 유지",
      ruleEn: "4800K warm daylight · soft golden highlights · analog film roll-off",
      swatchHex: "#C89B6E",
      thumb: "/reel/campaigns/beauty-rose.jpg",
      promptTokenKo: "[고정 색감 레퍼런스: 4800K 웜 데이라이트 필름 2383 색감 및 소프트 하이라이트 유지]",
      promptTokenEn: "[Pinned Color Ref: 4800K warm daylight 2383 film grade and soft highlight roll-off]",
    },
    {
      id: "color_crisp_studio_neutral",
      kind: "color",
      titleKo: "깨끗한 화이트 스튜디오 톤",
      titleEn: "Crisp Neutral White Studio",
      ruleKo: "색 왜곡 없는 정밀 조명 · 제품 원래 색상 100% 그대로 유지",
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
      titleKo: "35mm 필름 입자 & 보송한 실제 피부결",
      titleEn: "35mm Fine Grain & Real Matte Skin",
      ruleKo: "번들거리는 AI 광택 제거 · 실제 피부 모공과 잔잔한 필름 입자 유지",
      ruleEn: "Eliminates AI plastic sheen · locks authentic pores & 35mm fine grain",
      swatchHex: "#475569",
      thumb: "/reel/brands/slot-1-subject-editorial.jpg",
      promptTokenKo: "[고정 질감 레퍼런스: 35mm 아날로그 파인 그레인 및 매트한 실사 피부 모공 질감 고정]",
      promptTokenEn: "[Pinned Texture Ref: 35mm analog fine grain and authentic matte skin pore texture]",
    },
    {
      id: "texture_macro_fabric_weave",
      kind: "texture",
      titleKo: "원단 직조 · 봉제선 · 금속 선명한 질감",
      titleEn: "Macro Fabric Weave & Brushed Metal",
      ruleKo: "울·데님 원단 결, 봉제 실땀, 금속 표면의 미세한 결까지 선명하게 유지",
      ruleEn: "Locks wool/denim weave, stitch thread detail, and brushed metal grain",
      swatchHex: "#334155",
      thumb: "/reel/brands/pin-texture-35mm-grain-weave.jpg",
      promptTokenKo: "[고정 질감 레퍼런스: 초근접 원단 직조 결·봉제 스티치·금속 표면 마이크로 질감 고정]",
      promptTokenEn: "[Pinned Texture Ref: hyper-sharp fabric weave, seam stitching, and surface micro-texture]",
    },
    {
      id: "texture_dewy_glass_smear",
      kind: "texture",
      titleKo: "투명 유리 · 물방울 · 수분 제형 질감",
      titleEn: "Glass Refraction & Dewy Serum Texture",
      ruleKo: "투명 용기 빛 굴절, 맺힌 물방울, 촉촉한 에센스 제형 질감 유지",
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
      labelKo: "제품 · 전면 라벨 부위",
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
      labelKo: "손 모양 · 소품 쥔 부위",
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
      labelKo: "얼굴 표정 · 시선 · 잔머리",
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
      labelKo: "옷깃 · 단추 · 소매 핏",
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
      nameKo: "GPT Image 2.6 · 부위 정밀 수정 & 로고/소품 교정",
      nameEn: "GPT Image 2.6 · Precision Region & Label Editor",
      badgeKo: "부분 수정 · 제품/로고 교정 1순위",
      badgeEn: "Best for Micro-Region Product & Label Edit",
      shortTraitKo:
        "드래그한 영역과 참고 사진을 함께 읽어서, 선택한 부위 안쪽만 깔끔하게 교체하거나 다듬습니다 (바깥 원본은 100% 그대로 유지)",
      shortTraitEn:
        "Reads the cropped selection patch + reference images and replaces only the masked region via a non-destructive Smart Layer Mask",
      howItWorksKo:
        "캔버스에서 네모 박스나 브러시로 표시한 부분만 골라 수정한 뒤 새 레이어로 얹어 줍니다. 선택한 영역 바깥의 원본 사진은 1픽셀도 바뀌지 않아 안심하고 부분 수정을 반복할 수 있습니다.",
      howItWorksEn:
        "Crops and pads only the selected bounds to the closest supported aspect ratio, runs multi-image region editing, and places the result as a masked layer so pixels outside the selection remain 100% untouched.",
      bestWhenKo: [
        "사진 전체는 마음에 드는데 제품 라벨 글자나 로고만 살짝 흐릿할 때",
        "모델 손에 들린 소품이나 손가락 모양만 어색해서 그 부위만 다시 고치고 싶을 때",
        "원하는 위치에 2번 참고 사진의 우리 제품(화장품·음료·가방·시계)을 자연스럽게 넣을 때",
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
      nameKo: "Nano Banana 2.1 · 경계선 티 안 나는 자연 합성",
      nameEn: "Nano Banana 2.1 · Seamless Edge & Lighting Blend",
      badgeKo: "표정·배경 소품 정리 추천",
      badgeEn: "Best for Zero-Seam Edge & Lighting Blend",
      shortTraitKo:
        "선택한 부위와 주변 원본 사이의 조명·그림자·피부 톤을 자동으로 맞춰서 수정한 티가 전혀 나지 않게 이어 줍니다",
      shortTraitEn:
        "Automatically matches surrounding lighting, shadows, and skin tone across selection edges with zero visible seams",
      howItWorksKo:
        "선택한 영역 주변의 빛 방향과 색온도를 함께 읽어서, 표정 수정·잔머리 정리·불필요한 배경 소품 지우기 등을 할 때 경계선 자국 없이 자연스럽게 마감합니다.",
      howItWorksEn:
        "Analyzes surrounding context and color temperature around the selection mask so expression tweaks, hairline cleanup, and object removal blend invisibly.",
      bestWhenKo: [
        "모델의 시선 방향이나 미소, 잔머리·헤어라인만 자연스럽게 다듬고 싶을 때",
        "배경에 걸린 불필요한 소품·전선·얼룩을 지우고 주변 배경으로 감쪽같이 메울 때",
        "제품 바닥면의 그림자나 반사광을 주변 조명에 맞게 자연스럽게 정리할 때",
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
      nameKo: "Nano Banana Pro · 4K 원단 질감 & 옷 핏 다듬기",
      nameEn: "Nano Banana Pro · 4K Texture & Garment Fit Reshape",
      badgeKo: "옷 주름 · 핏 · 4K 디테일 보정",
      badgeEn: "Best for Fabric Drape & 4K Detail",
      shortTraitKo:
        "선택한 의류·가방·제품 부위의 옷 주름과 실루엣을 정돈하고, 흐릿한 표면 질감을 4K급으로 선명하게 되살립니다",
      shortTraitEn:
        "Restores 2K/4K surface micro-textures and refines garment silhouette or drape within the selected region",
      howItWorksKo:
        "고정해 둔 질감 참고 사진(원단 직조·가죽 결·금속 질감)을 선택한 영역에 집중 반영해, 뭉개진 옷 주름이나 흐릿한 장식 디테일을 최대 4K 해상도로 또렷하게 복원합니다.",
      howItWorksEn:
        "Injects your pinned texture reference directly into the selected bounds to sharpen fabric folds, leather grain, or metallic edges up to 4K.",
      bestWhenKo: [
        "자켓 옷깃·소매 길이·바지 밑단 주름 등 옷 핏 일부만 깔끔하게 다듬을 때",
        "확대했을 때 흐릿해 보이는 원단 조직감이나 금속 장식을 선명하게 살릴 때",
        "화장품 제형이나 음료 얼음·물방울 부위의 선명도를 한 단계 높일 때",
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
      nameKo: "Seedream 5.0 Pro · 실제 피부결 & 필름 입자감 마감",
      nameEn: "Seedream 5.0 Pro · Real Matte Skin & 35mm Grain Finish",
      badgeKo: "인위적인 AI 광택 제거 · 최종 마감",
      badgeEn: "Removes AI Plastic Look · Final Finish",
      shortTraitKo:
        "부분 수정 후 생기기 쉬운 매끈한 AI 피부 광택을 없애고, 실제 카메라 필름 입자와 보송한 피부결로 전체 톤을 맞춥니다",
      shortTraitEn:
        "Eliminates synthetic AI smoothness by blending physical RGB/Mono film grain and matte skin pore micro-contrast",
      howItWorksKo:
        "수정한 부위와 원본 부위의 밝기와 필름 입자감을 하나로 맞춰 주어, 여러 번 부분 수정을 거쳐도 처음부터 실제 카메라로 한 번에 찍은 사진처럼 자연스럽게 어우러집니다.",
      howItWorksEn:
        "Blends brightness-compensated physical grain patches and skin pore micro-contrast so edited patches and original pixels share one cohesive camera sensor look.",
      bestWhenKo: [
        "부분 수정 후 고친 부위와 주변 원본의 입자감을 티 나지 않게 하나로 맞출 때",
        "인물 피부에서 번들거리는 AI 느낌을 빼고 잡지 화보 같은 실제 피부결을 만들 때",
        "완성된 화보 사진을 영상 스튜디오(첫 장면)로 넘기기 전에 필름 질감을 입힐 때",
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
      badgeKo: "직접 만들기 · 스튜디오에서 바로 생성",
      badgeEn: "Self-Serve Format Builder",
      titleKo: "캠페인 영상 템플릿 직접 만들기 (우리 제품·배경 고정 & 즉시 테스트)",
      titleEn: "Self-Serve Campaign Format Builder (Instant Lock & Test)",
      summaryKo:
        "스튜디오에서 만든 우리 브랜드 화보·제품·배경·색감을 움직이지 않게 잠그고, [크리에이터 정면 셀카 1장]만 바뀌는 캠페인 영상 템플릿을 바로 만듭니다.",
      summaryEn:
        "Lock your approved brand scene, product, outfit, and color grade as immutable slots while exposing a single [Creator Front Selfie] slot for instant campaign generation.",
      lockedElementsKo: [
        "우리 브랜드 제품 모양 · 옷 핏 · 로고 위치 100% 그대로 고정",
        "브랜드가 정한 배경 장소 · 카메라 움직임(720p/1080p) · 조명 색감 고정",
        "참여 크리에이터가 임의로 바꿀 수 없도록 브랜드 안전 기준 자동 적용",
      ],
      lockedElementsEn: [
        "100% lock on brand product geometry, outfit fit, and logo placement",
        "Immutable studio set, camera blocking (720p/1080p), and color grade",
        "Automatic brand safety guardrails across every creator render",
      ],
      creatorInputKo: "참여 크리에이터 준비물: 정면 셀카 1장 (본인 얼굴 사용 동의 + 자동 검수)",
      creatorInputEn: "Creator Input: 1 Front Selfie (consent + automated safety check)",
      turnaroundKo: "지금 바로 템플릿 생성 및 샘플 크리에이터 3인 미리보기 (약 60초)",
      turnaroundEn: "Build format & preview across 3 sample creators immediately (~60s)",
      ctaLabelKo: "캠페인 템플릿 직접 만들고 테스트하기",
      ctaLabelEn: "Build & Test Self-Serve Campaign Format",
    },
    {
      id: "studio_commission",
      badgeKo: "전담팀 의뢰 · 3일(D+3) 내 맞춤 완성",
      badgeEn: "Commission Custom Format to Studio",
      titleKo: "전담 디렉터에게 캠페인 템플릿 제작 의뢰 (D+3일 맞춤 납품)",
      titleEn: "Commissioned Studio Format Production (D+3 Custom Delivery)",
      summaryKo:
        "제품 실물 사진과 캠페인 목적(신제품 출시·뷰티 룩·시즌 행사)만 보내주시면, TWINGS 전담 감독이 3일(D+3) 안에 시선을 끄는 전용 캠페인 영상 템플릿을 만들어 드립니다.",
      summaryEn:
        "Send your product photos and campaign goal—our film directors design, test, and deliver a custom high-converting creator format within D+3 days.",
      lockedElementsKo: [
        "전담 감독이 설계한 12초 원테이크 및 음악 비트 맞춤 카메라 연출",
        "제품 제형·라벨 글자·옷 핏 디테일 98% 이상 보존 꼼꼼히 검수 완료",
        "납품 즉시 브랜드 전용 링크 발급 → 임직원·앰배서더·크리에이터 바로 사용",
      ],
      lockedElementsEn: [
        "Director-crafted 12s one-take or beat-synced camera choreography",
        "98%+ product texture, label, and garment detail QA before delivery",
        "Dedicated brand format link ready for ambassadors and creators",
      ],
      creatorInputKo: "브랜드 전달 사항: 제품 사진 2~4장 + 원하는 분위기 한 줄 설명",
      creatorInputEn: "Brand Handoff: 2–4 product photos + 1-line campaign mood brief",
      turnaroundKo: "의뢰 후 3일(D+3) 안에 전용 템플릿 확정 및 샘플 영상 3편 전달",
      turnaroundEn: "Custom format locked & 3 test videos delivered within D+3 days",
      ctaLabelKo: "3일 완성 전담 템플릿 제작 의뢰하기",
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
      badgeKo: "초기 반응 확인 · 10명",
      badgeEn: "10 Creators · Market Validation",
      titleKo: "크리에이터 10인 초기 확산 팩",
      titleEn: "10-Creator Seed Distribution Pack",
      creatorCountLabelKo: "팔로워 3,000+ 검증 크리에이터 10명 동시 게시",
      creatorCountLabelEn: "10 verified creators (3,000+ followers) simultaneous post",
      channelsKo: "인스타그램 릴스 · 틱톡 · 유튜브 쇼츠",
      channelsEn: "Instagram Reels · TikTok · YouTube Shorts",
      estimatedViewsKo: "예상 조회수 15만~40만 회+",
      estimatedViewsEn: "Est. 150K–400K+ organic views",
      includesKo: [
        "브랜드 전용 캠페인 영상 템플릿 1종 제작 포함",
        "카테고리(뷰티·패션·라이프) 맞춤 크리에이터 10명 섭외 및 1080p 영상 전달",
        "D+21일 조회수·도달·저장 성과 리포트 + 상위 3편 2차 광고 활용권 포함",
      ],
      includesEn: [
        "Includes 1 custom brand campaign video format",
        "10 category-matched creators recruited & 1080p masters delivered",
        "D+21 performance report + cleared 2nd-use ad rights for top 3 videos",
      ],
      timelineSummaryKo: "D+3 템플릿 확정 → D+7 10명 매칭 → D+14 동시 게시 → D+21 리포트",
      timelineSummaryEn: "D+3 Format -> D+7 10 Creators -> D+14 Live Post -> D+21 Report",
    },
    {
      id: "growth_30",
      badgeKo: "신제품 출시 표준 · 30명 (가장 많이 선택)",
      badgeEn: "30 Creators · Standard Launch (Most Popular)",
      titleKo: "크리에이터 30인 신제품 런칭 팩",
      titleEn: "30-Creator Growth Distribution Pack",
      creatorCountLabelKo: "팔로워 3,000+ 검증 크리에이터 30명 동시 게시",
      creatorCountLabelEn: "30 verified creators (3,000+ followers) multi-wave seeding",
      channelsKo: "인스타그램 릴스 · 틱톡 · 유튜브 쇼츠 동시 확산",
      channelsEn: "Simultaneous wave across IG Reels, TikTok & Shorts",
      estimatedViewsKo: "예상 조회수 50만~120만 회+",
      estimatedViewsEn: "Est. 500K–1.2M+ organic views",
      includesKo: [
        "브랜드 전용 캠페인 영상 템플릿 2종(도입부 2가지 비교) 제작 포함",
        "참여 크리에이터 30명 후보 명단 사전 공유 및 브랜드 원클릭 승인",
        "전 편 1080p 고화질 원본 파일 제공 + 상위 10편 메타·틱톡 2차 광고 활용권",
      ],
      includesEn: [
        "Includes 2 custom campaign video formats (A/B hook testing)",
        "Pre-launch creator shortlist sharing & 1-click brand approval",
        "All 30 clean 1080p masters + 2nd-use paid ad rights on top 10 assets",
      ],
      timelineSummaryKo: "D+3 템플릿 2종 확정 → D+7 30명 확정 → D+14 동시 게시 → D+21 성과 리포트",
      timelineSummaryEn: "D+3 2 Formats -> D+7 30 Creators -> D+14 Wave Post -> D+21 ROI Report",
    },
    {
      id: "mega_50_plus",
      badgeKo: "대규모 트렌드 확산 · 50명+",
      badgeEn: "50+ Creators · Category Takeover",
      titleKo: "크리에이터 50인+ 대규모 캠페인 & 자발적 참여 확산 팩",
      titleEn: "50+ Creator Mega Seeding & Organic Takeover",
      creatorCountLabelKo: "팔로워 3,000~10만+ 크리에이터 50명 이상 대규모 게시",
      creatorCountLabelEn: "50+ creators (3K to 100K+ followers) full-funnel wave",
      channelsKo: "릴스 · 틱톡 · 쇼츠 + 일반 유저 참여형 확산 연동",
      channelsEn: "IG Reels · TikTok · Shorts + Comment-to-DM Viral Loop",
      estimatedViewsKo: "예상 조회수 150만~300만 회+ 대규모 확산",
      estimatedViewsEn: "Est. 1.5M–3M+ full-funnel organic views",
      includesKo: [
        "브랜드 전용 캠페인 템플릿 3종 + 전담 사운드·색보정 마감 포함",
        "크리에이터 50명+ 동시 게시 + 일반 유저가 따라 찍는 챌린지 확산 설계",
        "전체 영상 무제한 2차 광고 활용권 및 주간 실시간 성과 리포트 제공",
      ],
      includesEn: [
        "3 custom formats + dedicated sound & color grading master",
        "50+ seeded creators + public organic challenge participation loop",
        "Full 2nd-use paid ad rights + weekly live dashboard reporting",
      ],
      timelineSummaryKo: "D+3 템플릿 확정 → D+7 50명+ 섭외 → D+14 대규모 게시 → D+21 종합 리포트",
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
    titleKo: "프렌치 런웨이 비트 & 카메라 셔터 현장음",
    titleEn: "French Runway House & Press Shutter Foley",
    bpmLabel: "122 BPM · 2.3초 화면 전환 맞춤",
    loudnessSpec: "-14.0 LUFS / -1.0 dBTP (인스타 릴스 · 틱톡 표준 음량)",
    duckingRuleKo: "첫 도입부와 목소리(내레이션) 구간에서 배경음악 자동 -3 dB 낮춤",
    duckingRuleEn: "Automatic Act 1 & voiceover -3 dB sidechain ducking",
    foleyLayersKo: [
      "대리석 바닥 위 또렷한 가죽 구두 발걸음 소리",
      "울 코트·실크 트렌치코트 옷깃이 스치는 자연스러운 원단 소리",
      "런웨이 현장 카메라 셔터 소리와 공간 울림",
    ],
    foleyLayersEn: [
      "Crisp leather heel taps on limestone runway",
      "Tactile wool coat & silk trench fabric rustle",
      "Press-line camera shutter clicks & gallery room tone",
    ],
    summaryKo:
      "2.3초 박자에 맞춰 모델 워킹 컷 전환이 경쾌하게 맞아떨어지는 세련된 런웨이 배경음악과 현장 효과음을 함께 입힙니다.",
    summaryEn:
      "Combines a 122 BPM French house groove (2.3s beat-drop lock) with tactile runway heel taps and fabric rustle.",
    creditsPerTrack: 75,
    priceKrwPerTrack: 900,
  },
  {
    id: "clinical_minimal_pulse",
    badgeKo: "뷰티 · 스킨케어 · 디바이스 추천",
    badgeEn: "Best for Beauty & Skincare Films",
    titleKo: "깨끗한 미니멀 배경음 & 수분 제형 ASMR 효과음",
    titleEn: "Clinical Minimal Pulse & Hydro Texture ASMR Foley",
    bpmLabel: "96 BPM · 차분한 리듬",
    loudnessSpec: "-14.0 LUFS / -1.0 dBTP (맑은 고음역 유지)",
    duckingRuleKo: "제품 설명 내레이션과 클로즈업 구간에서 배경음악 자동 -3 dB 낮춤",
    duckingRuleEn: "Automatic -3 dB ducking during INCI narration & macro shots",
    foleyLayersKo: [
      "스포이드 유리병 딸깍 소리와 세럼 물방울이 떨어지는 맑은 소리",
      "수분 크림·에센스를 피부에 부드럽게 펴 바르는 근접 ASMR 소리",
      "잡음 없이 깔끔하고 고요한 스튜디오 공간음",
    ],
    foleyLayersEn: [
      "Glass dropper click & close-mic serum droplet sound",
      "Hydrating cream & sheet mask tactile ASMR smear",
      "Pure studio air room tone with zero harsh sibilance",
    ],
    summaryKo:
      "클린 뷰티·스킨케어 브랜드의 신뢰감을 높여 주는 맑고 차분한 배경음악에 세럼 물방울·제형 ASMR 소리를 더합니다.",
    summaryEn:
      "Pairs crystalline minimal synth pulses with close-mic glass dropper and skincare texture ASMR Foley.",
    creditsPerTrack: 75,
    priceKrwPerTrack: 900,
  },
  {
    id: "warm_acoustic_lounge",
    badgeKo: "식음료 · 카페 · 라이프스타일 추천",
    badgeEn: "Best for F&B & Hospitality",
    titleKo: "따뜻한 라운지 배경음 & 얼음·커피 추출 현장음",
    titleEn: "Warm Analog Lounge & Ice / Espresso Foley",
    bpmLabel: "108 BPM · 따뜻한 아날로그 리듬",
    loudnessSpec: "-14.0 LUFS / -1.0 dBTP (포근한 음색 마감)",
    duckingRuleKo: "음료를 따르거나 얼음이 부딪히는 핵심 구간에서 배경음 -3 dB 자동 낮춤",
    duckingRuleEn: "Auto -3 dB BGM ducking during pour and ice-clink highlights",
    foleyLayersKo: [
      "유리잔 속 경쾌한 얼음 부딪힘과 청량한 탄산 기포 소리",
      "에스프레소 추출 소리와 도자기 컵을 테이블에 놓는 현장음",
      "여유로운 카페·라운지 공간의 따뜻한 공기감",
    ],
    foleyLayersEn: [
      "Crystal glass ice clink & fine carbonation fizz",
      "Espresso extraction & ceramic cup plating Foley",
      "Warm timber & concrete cafe ambient room tone",
    ],
    summaryKo:
      "식음료·호텔·라이프스타일 영상의 미각과 공간 분위기를 살려 주는 따뜻한 라운지 음악과 생생한 식음료 소리를 담았습니다.",
    summaryEn:
      "Blends warm tape-saturated lounge beats with crisp ice clinks, beverage pours, and inviting spatial ambiance.",
    creditsPerTrack: 75,
    priceKrwPerTrack: 900,
  },
  {
    id: "no_bgm_live_foley",
    badgeKo: "크리에이터 릴스 · 자연스러운 일상감 특화",
    badgeEn: "Best for Organic Creator Reels (No-BGM)",
    titleKo: "배경음악 없는 순수 현장 효과음 & 공간음",
    titleEn: "Pure On-Site Foley & Spatial Room Tone Master (No-BGM)",
    bpmLabel: "실제 현장 호흡 · 배경음악 없음",
    loudnessSpec: "-15.5 LUFS / -1.2 dBTP (자연스러운 현장 음량)",
    duckingRuleKo: "인물 목소리가 또렷하게 들리도록 주변 현장음 크기를 자동으로 조절",
    duckingRuleEn: "Balances ambient room tone around natural spoken dialogue",
    foleyLayersKo: [
      "인위적인 배경음악(BGM) 없이 실제 카메라 마이크로 녹음한 듯한 현장감",
      "인물 움직임에 딱 맞는 발걸음·옷자락·제품 만지는 소리 자동 맞춤",
      "인스타그램·틱톡 앱에서 유행하는 음원을 위에 바로 얹기 좋은 깔끔한 현장음",
    ],
    foleyLayersEn: [
      "100% No-BGM — authentic on-camera microphone spatial presence",
      "Frame-accurate footsteps, garment movement, and prop handling",
      "Clean ambient bed ready for native IG/TikTok trending audio overlays",
    ],
    summaryKo:
      "광고 느낌을 주는 배경음악을 빼고 실제 촬영 현장의 생생한 소리만 남겨서, 시청자가 끝까지 보게 만드는 자연스러운 릴스용 사운드입니다.",
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
    titleKo: "이미지 · 1~4번 참고 사진 화보",
    titleEn: "Image · Multi-Ref Lookbook",
    subtitleKo: "Nano Banana Pro / Seedream 5.0 Pro · 인물·배경·포즈·색감 조합 화보",
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
    titleKo: "이미지 · 제품만 우리 것으로 교체",
    titleEn: "Image · Product Swap & SKU",
    subtitleKo: "Nano Banana 2.1 / GPT Image 2.6 · 1번 배경 유지 → 2번 우리 제품 교체",
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
    titleKo: "이미지 · 원하는 부위만 부분 수정",
    titleEn: "Image · Micro-Region Edit",
    subtitleKo: "GPT Image 2.6 · 드래그한 영역(로고·손·표정)만 감쪽같이 수정",
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
    titleKo: "영상 · 1080p 브랜드 영상",
    titleEn: "Video · 1080p Brand Film",
    subtitleKo: "화보 첫 장면 고정 → 720p 움직임 확인 → 1080p 고화질 완성",
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
    subtitleKo: "셀카 1장으로 우리 제품 영상이 나오는 템플릿 직접 제작 또는 3일 완성 의뢰",
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
    subtitleKo: "영상 템플릿 제작 + 팔로워 3,000+ 크리에이터 10~50명+ 동시 게시 & 리포트",
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
    titleKo: "오디오 · 배경음악 & 현장 효과음",
    titleEn: "Audio · Signature BGM & Foley",
    subtitleKo: "브랜드 맞춤 배경음악 · 발걸음/원단/얼음 현장음 · 목소리 구간 자동 볼륨 조절",
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
