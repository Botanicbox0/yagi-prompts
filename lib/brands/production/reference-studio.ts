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
      titleKo: "이미지 캔버스 (화보 생성 · 제품 교체 · 부분 수정)",
      titleEn: "Image Canvas (Lookbook · Product Swap · Region Edit)",
      badgeKo: "화보 · 제품 교체 · 부분 수정",
      badgeEn: "Lookbook · Swap · Edit",
      summaryKo:
        "제품·모델·색감 사진을 캔버스에 펼쳐놓고 화보 생성과 부분 수정을 진행합니다.",
      summaryEn:
        "Spread product, model, and color references on the canvas to generate stills and edit regions.",
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
      turnaroundKo: "즉시 생성 (15~35초)",
      turnaroundEn: "Instant (15–35s)",
      priceGuideKo: "5장 세트 400원~ (34 cr~)",
      priceGuideEn: "From ₩400 / 5 cuts",
      previewImage: "/reel/brands/slot-1-subject-editorial.jpg",
    },
    {
      id: "video",
      orderNumber: "02",
      shortLabelKo: "영상 · 업스케일",
      shortLabelEn: "Video & Upscale",
      titleKo: "영상 & 업스케일 스튜디오 (480p · 720p → 1080p/4K)",
      titleEn: "Video & Upscale Studio (480p · 720p -> 1080p/4K)",
      badgeKo: "480p · 720p · 1080p/4K 업스케일",
      badgeEn: "480p · 720p · 1080p/4K Upscale",
      summaryKo:
        "캔버스의 이미지를 시작 장면으로 연결해 영상을 만들고 1080p·4K로 업스케일합니다.",
      summaryEn:
        "Connect any canvas image as the start frame, generate video, and upscale to 1080p or 4K.",
      deliverablesKo: [
        "480p(드래프트 모드) · 720p(표준) · 1080p(본편) 3단계 해상도 직접 선택 생성",
        "전용 업스케일링 스튜디오: 720p 영상을 1080p(인스타 화질 저하 방지) 또는 4K로 업스케일",
        "인스타 릴스·Edits 업로드 시 피부가 뭉개지지 않는 미세 필름 입자·선명도 최적화",
      ],
      deliverablesEn: [
        "3-tier generation: 480p (Draft Mode), 720p (Standard), and 1080p (Native Master)",
        "Dedicated Upscaling Studio: 720p -> 1080p (Instagram De-AI Master) or 4K Ultra HD",
        "Instagram Reels/Edits optimization (ISO 3200 luma grain, CAS 0.25, SDR BT.709, CRF 13)",
      ],
      turnaroundKo: "약 35~90초",
      turnaroundEn: "~35–90s",
      priceGuideKo: "480p 800원~ · 720p 1,800원",
      priceGuideEn: "From ₩800 (480p) · ₩1,800 (720p)",
      previewImage: "/reel/brands/house-french-blue-hero-1080p.jpg",
    },
    {
      id: "creator_format",
      orderNumber: "03",
      shortLabelKo: "캠페인 영상 (셀프 · 의뢰)",
      shortLabelEn: "Campaign Video (Self · Custom)",
      titleKo: "크리에이터 캠페인용 영상 (직접 제작 · 전담팀 의뢰)",
      titleEn: "Creator Campaign Video Format (Self-Build or Commission)",
      badgeKo: "셀프 제작 · 3일 내 의뢰 완성",
      badgeEn: "Self-Build · D+3 Custom",
      summaryKo:
        "셀카 1장으로 우리 브랜드 제품·배경이 입혀진 영상이 나오는 포맷을 만들거나 의뢰합니다.",
      summaryEn:
        "Build or commission a campaign format where creators drop 1 selfie into your brand scene.",
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
      turnaroundKo: "즉시 제작 · 의뢰 시 D+3일",
      turnaroundEn: "Instant or D+3 Custom",
      priceGuideKo: "셀프 1,800원~ · 맞춤 의뢰 가능",
      priceGuideEn: "From ₩1,800 · Custom brief",
      previewImage: "/reel/brands/slot-3-pose-lowangle-lookbook.jpg",
    },
    {
      id: "creator_distribution",
      orderNumber: "04",
      shortLabelKo: "캠페인 영상 + 유통",
      shortLabelEn: "Campaign + Distribution",
      titleKo: "크리에이터 캠페인 영상 + SNS 게시 · 리포트",
      titleEn: "Creator Campaign + Seeding & ROI Report",
      badgeKo: "영상 + 크리에이터 게시 + 리포트",
      badgeEn: "Video + Creator Seeding + ROI",
      summaryKo:
        "3,000+ 팔로워 크리에이터 섭외부터 릴스·틱톡 동시 게시와 성과 리포트까지 진행합니다.",
      summaryEn:
        "Match 3,000+ follower creators for simultaneous IG/TikTok seeding and live ROI tracking.",
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
      turnaroundKo: "D+3 포맷 · D+14 게시 · D+21 리포트",
      turnaroundEn: "D+3 Format · D+14 Post · D+21 Report",
      priceGuideKo: "10인 · 30인 · 50인+ 패키지",
      priceGuideEn: "10 / 30 / 50+ Creator Cohorts",
      previewImage: "/reel/brands/studio-editorial-blue-1080p.jpg",
    },
    {
      id: "audio",
      orderNumber: "05",
      shortLabelKo: "오디오",
      shortLabelEn: "Audio",
      titleKo: "오디오 스튜디오 (배경음악 · 현장 효과음)",
      titleEn: "Audio Studio (BGM · Foley · Loudness Master)",
      badgeKo: "배경음악 · 현장음 · 상업 음원",
      badgeEn: "BGM · Foley · Commercial Master",
      summaryKo:
        "영상에 어울리는 배경음악(BGM)과 발걸음·얼음 소리 같은 현장 효과음을 입힙니다.",
      summaryEn:
        "Add brand-tailored BGM, tactile Foley sound effects, and -14 LUFS loudness mastering.",
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
      turnaroundKo: "즉시 생성 (약 25초)",
      turnaroundEn: "Instant (~25s)",
      priceGuideKo: "곡당 900원 (75 cr · 저작권 포함)",
      priceGuideEn: "₩900 / track (75 cr)",
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

/**
 * Founder-specified Seedance 2.5 Video Generation Tiers (`480p Draft Mode`, `720p`, `1080p`):
 * - `seedance_2_5_480p_draft`: `seedance-2.5` with `resolution: "480p"`, `draft: true`, `bitrate_mode: "high"`.
 *   Supports Sunra `draft_source_task_id` 1-click promotion to a 1080p final!
 * - `seedance_2_5_720p_standard`: `seedance-2.5` with `resolution: "720p"`, `draft: false`, `bitrate_mode: "high"`.
 *   Optimal base video to send into the dedicated Upscaling Studio (720p -> 1080p IG Optimized or 4K).
 * - `seedance_2_5_1080p_master`: `seedance-2.5` with `resolution: "1080p"`, `draft: false`, `bitrate_mode: "high"`.
 */
export type BrandSeedanceVideoTierId =
  | "seedance_2_5_480p_draft"
  | "seedance_2_5_720p_standard"
  | "seedance_2_5_1080p_master";

export interface BrandSeedanceVideoTierSpec {
  id: BrandSeedanceVideoTierId;
  modelId: "seedance-2.5";
  resolution: "480p" | "720p" | "1080p";
  draft: boolean;
  bitrateMode: "high";
  supportsDraftFinalizeTo1080p: boolean;
  recommendedUpscaleTarget: "1080p_ig_master" | "4k_ultra_master";
  nameKo: string;
  nameEn: string;
  badgeKo: string;
  badgeEn: string;
  summaryKo: string;
  summaryEn: string;
  bestWhenKo: string;
  bestWhenEn: string;
  turnaroundKo: string;
  turnaroundEn: string;
}

export const BRAND_SEEDANCE_VIDEO_TIERS: readonly BrandSeedanceVideoTierSpec[] = [
  {
    id: "seedance_2_5_480p_draft",
    modelId: "seedance-2.5",
    resolution: "480p",
    draft: true,
    bitrateMode: "high",
    supportsDraftFinalizeTo1080p: true,
    recommendedUpscaleTarget: "1080p_ig_master",
    nameKo: "Seedance 2.5 · 480p (Draft 모드)",
    nameEn: "Seedance 2.5 · 480p (Draft Mode)",
    badgeKo: "카메라 움직임 · 표정 4배 빠른 테스트",
    badgeEn: "4x Faster Motion & Acting Draft",
    summaryKo:
      "가장 저렴하고 빠르게 카메라 움직임, 모델 표정, 손동작을 먼저 확인하는 드래프트 모드입니다. 마음에 들면 똑같은 움직임 그대로 Sunra 1080p 본편으로 바로 승격할 수 있습니다.",
    summaryEn:
      "Fastest Draft preview (--resolution 480p --draft true --bitrate_mode high). Once approved, promote the exact same take to a 1080p final via Sunra draft_source_task_id.",
    bestWhenKo: "여러 가지 카메라 각도와 대사·표정 연기를 부담 없이 먼저 비교해 보고 싶을 때",
    bestWhenEn: "Testing multiple camera angles and micro-acting takes before committing to 1080p",
    turnaroundKo: "약 30~40초 생성 · 승인 시 1080p 즉시 승격",
    turnaroundEn: "~30–40s draft · 1-click 1080p finalize",
  },
  {
    id: "seedance_2_5_720p_standard",
    modelId: "seedance-2.5",
    resolution: "720p",
    draft: false,
    bitrateMode: "high",
    supportsDraftFinalizeTo1080p: false,
    recommendedUpscaleTarget: "1080p_ig_master",
    nameKo: "Seedance 2.5 · 720p (표준 · 업스케일 베이스)",
    nameEn: "Seedance 2.5 · 720p (Standard · Upscale Base)",
    badgeKo: "실무 최다 활용 · 720p 생성 후 1080p/4K 업스케일 추천",
    badgeEn: "Sweet Spot · Best Base for 1080p IG / 4K Upscaling",
    summaryKo:
      "속도와 화질의 균형이 가장 좋은 표준 모드입니다. 720p로 먼저 영상을 만든 뒤, 잘 나온 컷만 우측 '업스케일링 스튜디오'로 넘겨 인스타 최적화 1080p나 4K로 완성하는 방식이 가장 효율적입니다.",
    summaryEn:
      "Balanced 720p native generation (--resolution 720p --draft false --bitrate_mode high). Send winning 720p takes into the Upscaling Studio for 1080p IG optimization or 4K mastering.",
    bestWhenKo: "720p로 빠르게 결과를 확인하고, 선택된 베스트 컷만 인스타 1080p 마스터나 4K로 업스케일할 때",
    bestWhenEn: "Generating 720p takes and upscaling approved cuts to 1080p IG Master or 4K",
    turnaroundKo: "약 60초 생성 · 업스케일링 스튜디오 1클릭 연동",
    turnaroundEn: "~60s generation · 1-click handoff to Upscaling Studio",
  },
  {
    id: "seedance_2_5_1080p_master",
    modelId: "seedance-2.5",
    resolution: "1080p",
    draft: false,
    bitrateMode: "high",
    supportsDraftFinalizeTo1080p: false,
    recommendedUpscaleTarget: "4k_ultra_master",
    nameKo: "Seedance 2.5 · 1080p (네이티브 고화질 본편)",
    nameEn: "Seedance 2.5 · 1080p (Native Master)",
    badgeKo: "한 번에 1080p 본편 생성 · 인스타 최적화 후처리 연동",
    badgeEn: "Direct 1080p Native Render + IG Optimization",
    summaryKo:
      "처음부터 Seedance 2.5 최고 해상도인 1080p로 바로 생성합니다. 생성 직후 인스타 화질 저하 방지 필터(미세 필름 입자·선명도 보정)를 입히거나 4K로 한 단계 더 업스케일할 수 있습니다.",
    summaryEn:
      "Direct 1080p native generation (--resolution 1080p --draft false --bitrate_mode high), ready for Instagram De-AI mastering or 4K upscaling.",
    bestWhenKo: "이미 검증된 화보 첫 장면과 프롬프트로 지체 없이 1080p 납품용 본편을 바로 뽑을 때",
    bestWhenEn: "Direct 1080p production when Frame 1 and motion brief are already locked",
    turnaroundKo: "약 90초 생성 · 즉시 다운로드 및 인스타 최적화",
    turnaroundEn: "~90s generation · Instant download & IG master",
  },
];

/**
 * Dedicated Upscaling Studio Engines (`BRAND_UPSCALING_STUDIO_ENGINES`):
 * Answers: "어떤 upscaler를 줘야 하는가?" + "인스타 최적화 업스케일링 방식 우리가 쓰는 로직으로 1080p를 Sunra 업스케일러를 통해 만들 수 있게"
 */
export type BrandUpscalerEngineId =
  | "sunra_ig_1080p_upscaler"
  | "seedvr2_7b_optical_upscaler"
  | "sunra_cloud_4k_upscaler";

export type UpscaleTargetResolution = "1080p" | "2K" | "4K";

export interface BrandUpscalerEngineSpec {
  id: BrandUpscalerEngineId;
  nameKo: string;
  nameEn: string;
  providerBadgeKo: string;
  providerBadgeEn: string;
  supportedInputs: readonly ("480p" | "720p" | "1080p")[];
  supportedTargets: readonly UpscaleTargetResolution[];
  defaultTarget: UpscaleTargetResolution;
  includesIgDeAiLogic: boolean;
  shortTraitKo: string;
  shortTraitEn: string;
  whyThisUpscalerKo: string;
  whyThisUpscalerEn: string;
  strengthsKo: readonly [string, string, string];
  strengthsEn: readonly [string, string, string];
  creditsPer10s: number;
  priceKrwPer10s: number;
}

export const BRAND_UPSCALING_STUDIO_ENGINES: readonly BrandUpscalerEngineSpec[] = [
  {
    id: "sunra_ig_1080p_upscaler",
    nameKo: "Sunra 1080p 업스케일러 + 인스타 릴스·Edits 최적화",
    nameEn: "Sunra Cloud 1080p Upscaler + IG Reels De-AI Master",
    providerBadgeKo: "인스타 · 릴스 · 틱톡 업로드 1순위 (추천)",
    providerBadgeEn: "Best for Instagram Reels · Edits · TikTok (Recommended)",
    supportedInputs: ["480p", "720p", "1080p"],
    supportedTargets: ["1080p"],
    defaultTarget: "1080p",
    includesIgDeAiLogic: true,
    shortTraitKo:
      "Sunra 클라우드 업스케일러로 480p/720p 영상을 1080p로 올린 뒤, 인스타 업로드 시 피부와 배경이 플라스틱처럼 뭉개지지 않게 막아주는 인스타 전용 최적화 로직을 자동으로 입힙니다",
    shortTraitEn:
      "Upscales 480p/720p to 1080p via Sunra Cloud and applies our signature Instagram Reels anti-recompression & De-AI optical grain pipeline",
    whyThisUpscalerKo:
      "인스타그램·Edits 앱은 AI 특유의 매끈한 피부와 어두운 배경을 압축 과정에서 깍두기처럼 뭉개버립니다. Sunra 1080p 업스케일 위에 미세 필름 입자(ISO 3200 루미넌스 그레인), 속눈썹·원단 선명도 복원(CAS 0.25), OLED 블랙 보정, CRF 13 고화질 인코딩을 결합해 업로드 후에도 화질이 그대로 유지됩니다.",
    whyThisUpscalerEn:
      "Prevents Instagram's encoder from crushing smooth AI skin and dark shadows by combining Sunra 1080p cloud upscale with CAS 0.25 micro-contrast, ISO 3200 luminance-only grain, SDR BT.709 lock, and CRF 13 encoding.",
    strengthsKo: [
      "Sunra 클라우드 480p/720p → 1080p 고속 업스케일",
      "인스타·Edits 재압축 화질 저하 방지 (ISO 3200 필름 입자)",
      "릴스 인기 음원용 무음악(No-BGM) + 광고용(-14 LUFS) 동시 출력",
    ],
    strengthsEn: [
      "Sunra Cloud 480p/720p -> 1080p Fast Upscale",
      "IG Anti-Recompression (ISO 3200 Luma Grain + CAS 0.25)",
      "Dual Stems (No-BGM Reels + -14 LUFS Ad Master)",
    ],
    creditsPer10s: 120,
    priceKrwPer10s: 1500,
  },
  {
    id: "seedvr2_7b_optical_upscaler",
    nameKo: "SeedVR2 7B 광학 디테일 복원 업스케일러 (1080p · 4K)",
    nameEn: "SeedVR2 7B Diffusion Optical Upscaler (1080p · 4K)",
    providerBadgeKo: "인물 클로즈업 피부결 · 속눈썹 · 원단 직조 복원 1순위",
    providerBadgeEn: "Best for Close-Up Skin Pores, Eyelashes & Fabric Weave",
    supportedInputs: ["480p", "720p", "1080p"],
    supportedTargets: ["1080p", "4K"],
    defaultTarget: "1080p",
    includesIgDeAiLogic: true,
    shortTraitKo:
      "720p 원본에 없던 속눈썹 한 올, 눈동자 반사광, 울·실크 원단 직조 결을 새로 그려 넣으면서도 얼굴 피부가 우글거리지 않게 잡아주는 정밀 광학 복원 엔진입니다",
    shortTraitEn:
      "Reconstructs optical micro-texture (eyelashes, catchlights, fabric weave) via SeedVR2 7B FP16 with 3-frame Seamless Skin Anti-Boil masking up to 1080p or 4K",
    whyThisUpscalerKo:
      "일반 샤프닝 업스케일러(Topaz 등)는 외곽선만 인위적으로 날카롭게 만들어 테두리가 하얗게 뜨지만, SeedVR2 7B는 실제 카메라 렌즈로 찍은 것 같은 속눈썹·원단 결을 복원(+170% 선명도)하고 피부 우글거림 방지 마스크로 자연스러운 피부톤을 지킵니다.",
    whyThisUpscalerEn:
      "Outperforms traditional deblur filters (e.g. Topaz Proteus) by synthesizing true optical detail (+170% sharpness) while locking facial skin stability over a 3-frame window.",
    strengthsKo: [
      "속눈썹·눈동자·원단 결 +170% 광학 복원",
      "얼굴 피부 우글거림 원천 차단 마스킹 적용",
      "1080p 인스타 마스터 및 4K(8초 컷 자동 분할) 지원",
    ],
    strengthsEn: [
      "+170% Eyelash & Fabric Micro-Detail",
      "3-Frame Skin Anti-Boil Masking",
      "Supports 1080p IG Master & 4K (8s Cut Split)",
    ],
    creditsPer10s: 160,
    priceKrwPer10s: 2000,
  },
  {
    id: "sunra_cloud_4k_upscaler",
    nameKo: "Sunra 클라우드 2K · 4K 초고화질 업스케일러",
    nameEn: "Sunra Cloud 2K / 4K Ultra HD Upscaler",
    providerBadgeKo: "웹사이트 메인 배너 · 유튜브 4K · 오프라인 매장 화면용",
    providerBadgeEn: "Best for 4K Website Hero, YouTube 4K & Store Displays",
    supportedInputs: ["720p", "1080p"],
    supportedTargets: ["2K", "4K"],
    defaultTarget: "4K",
    includesIgDeAiLogic: false,
    shortTraitKo:
      "720p 또는 1080p로 완성된 영상을 브랜드 홈페이지 메인 배너, 유튜브 4K 캠페인 필름, 백화점·매장 대형 스크린용 2K/4K(2160p) 초고화질로 빠르게 업스케일합니다",
    shortTraitEn:
      "Cloud super-resolution upgrade from 720p/1080p to 2K (1440p) or 4K (2160p) with BT.709 color lock for large displays and web hero banners",
    whyThisUpscalerKo:
      "대형 모니터나 매장 스크린에서는 1080p 영상도 픽셀이 보일 수 있습니다. Sunra 클라우드 4K 업스케일러는 원본 색감(BT.709)과 프레임 흐름을 그대로 유지하면서 4K(3840×2160 / 2160×3840) 해상도로 깔끔하게 확장합니다. (단, 인스타그램 업로드용은 인스타 서버의 강제 축소 열화를 피하기 위해 1080p 인스타 최적화 모드를 권장합니다.)",
    whyThisUpscalerEn:
      "Delivers crisp 2K/4K masters on Sunra Cloud for widescreen web heroes and digital signage (while recommending 1080p SDR for Instagram uploads to avoid server downscale degradation).",
    strengthsKo: [
      "720p/1080p → 2K · 4K(2160p) 클라우드 업스케일",
      "브랜드 홈페이지 히어로 · 매장 대형 스크린 최적",
      "원본 색감(BT.709) 및 24fps 모션 프레임 유지",
    ],
    strengthsEn: [
      "720p/1080p -> 2K & 4K (2160p) Cloud Upgrade",
      "Ideal for Web Hero Banners & Retail Signage",
      "Strict BT.709 Color & 24fps Cadence Lock",
    ],
    creditsPer10s: 210,
    priceKrwPer10s: 2600,
  },
];

export type IgUpscaleLogicModuleId =
  | "cas_micro_edge"
  | "iso3200_luma_grain"
  | "skin_anti_boil_mask"
  | "oled_shadow_curve_sdr"
  | "cfr24_clean_metadata_zoom";

export interface IgUpscaleLogicModuleSpec {
  id: IgUpscaleLogicModuleId;
  titleKo: string;
  titleEn: string;
  detailKo: string;
  detailEn: string;
  technicalParam: string;
  defaultEnabled: boolean;
}

/**
 * Our 5 Core Instagram Optimization Upscaling Logic Modules (`tools/ig_reels_master.py` & `lib/brands/finish/upscale-master.ts`):
 */
export const IG_OPTIMIZED_UPSCALE_LOGIC_MODULES: readonly IgUpscaleLogicModuleSpec[] = [
  {
    id: "cas_micro_edge",
    titleKo: "속눈썹 · 원단 · 로고 미세 선명도 복원",
    titleEn: "Optical Micro-Contrast & Edge Restoration",
    detailKo: "단순 확대로 흐려진 눈동자 반사광, 속눈썹, 옷감 직조, 제품 로고 글자를 또렷하게 살립니다 (+170% 선명도 향상)",
    detailEn: "Restores eyelashes, catchlights, fabric weave, and product typography (+170% sharpness)",
    technicalParam: "scale=1080:1920:flags=lanczos,unsharp=3:3:0.55,cas=0.25",
    defaultEnabled: true,
  },
  {
    id: "iso3200_luma_grain",
    titleKo: "인스타 재압축 방지 미세 필름 입자 (ISO 3200)",
    titleEn: "ISO 3200 Luminance Sensor Grain (Anti-Compression)",
    detailKo: "색노이즈 없이 미세한 밝기 입자만 얹어 인스타그램 서버가 피부와 어두운 배경 화질을 깎지 못하게 보호합니다",
    detailEn: "Injects chroma-free luminance grain so Instagram's encoder allocates high bitrate to skin and shadows",
    technicalParam: "noise=c0s=3.4:c0f=t+u (chroma_noise=0)",
    defaultEnabled: true,
  },
  {
    id: "skin_anti_boil_mask",
    titleKo: "얼굴 피부 우글거림 방지 보호 마스크",
    titleEn: "3-Frame Seamless Skin Anti-Boil Masking",
    detailKo: "눈·아이라인·머리카락은 선명하게 올리고, 볼·이마 피부 영역은 3프레임 안정화로 인위적인 모공 들끓음을 막습니다",
    detailEn: "Sharpens eyes/hairline while stabilizing cheek/forehead skin over 3 frames to prevent pore boiling",
    technicalParam: "face_skin_mask=3f_temporal_stabilize + highlight_rolloff",
    defaultEnabled: true,
  },
  {
    id: "oled_shadow_curve_sdr",
    titleKo: "아이폰·갤럭시 OLED 진한 블랙 & SDR 색감 고정",
    titleEn: "OLED Shadow Anchor Curve & SDR BT.709 Lock",
    detailKo: "스마트폰 화면에서 검은 배경이 뿌옇게 뜨는 현상을 막고, 피부 하이라이트가 날아가지 않게 SDR 색감을 고정합니다",
    detailEn: "Anchors true OLED blacks and locks SDR BT.709 color so skin highlights never blow out in IG Edits",
    technicalParam: "curves=m='0.005/0.015 0.06/0.05 0.50/0.50 0.94/0.955 0.995/0.985',bt709",
    defaultEnabled: true,
  },
  {
    id: "cfr24_clean_metadata_zoom",
    titleKo: "24fps 고정 · CRF 13 고화질 · 클린 메타데이터 & 썸네일",
    titleEn: "24fps CFR · CRF 13 High@L4.1 · Clean Metadata & Cover",
    detailKo: "울렁이는 60fps 강제 보간 없이 자연스러운 24fps 시네마 모션을 유지하고, 불필요한 생성 메타데이터 제거 및 선명한 커버 사진을 함께 뽑아줍니다",
    detailEn: "Keeps native 24fps cinema cadence, encodes at H.264 CRF 13, strips metadata, and extracts a clean cover JPG",
    technicalParam: "libx264 -crf 13 -profile:v high -level 4.1 -r 24 -vsync cfr -map_metadata -1 (zoom=1.03)",
    defaultEnabled: true,
  },
];

export interface CompiledSunraVideoAndUpscalePlan {
  seedanceGeneration: {
    tierId: BrandSeedanceVideoTierId;
    sunraTool: "create_video";
    sunraArgs: {
      model: "seedance-2.5";
      resolution: "480p" | "720p" | "1080p";
      draft: boolean;
      duration: number;
      aspect_ratio: string;
      generate_audio: boolean;
      parameters: {
        bitrate_mode: "high";
      };
    };
  };
  upscaleStudio: {
    engineId: BrandUpscalerEngineId;
    sourceResolution: "480p" | "720p" | "1080p";
    targetResolution: UpscaleTargetResolution;
    sunraCloudStep: {
      mode: "seedance_draft_finalize_1080p" | "sunra_cloud_super_resolution" | "seedvr2_hybrid_diffusion";
      sunraModel: "seedance-2.5" | "pika-h3-flex" | "seedance-2.0";
      targetResolutionParam: "1080p" | "2k" | "4k";
    };
    igOptimizationActive: boolean;
    enabledLogicModules: readonly IgUpscaleLogicModuleId[];
    ffmpegFilterChain: string;
    igEditsExportRuleKo: string;
    igEditsExportRuleEn: string;
  };
}

/**
 * Compiles the end-to-end execution plan for Seedance 2.5 (480p Draft / 720p / 1080p)
 * and the attached Upscaling Studio (Sunra Cloud 1080p/4K + Instagram Reels De-AI Optimization).
 */
export function compileSunraVideoAndUpscalePlan(input: {
  seedanceTierId: BrandSeedanceVideoTierId;
  durationSec: number;
  aspectRatio: string;
  upscalerEngineId: BrandUpscalerEngineId;
  targetResolution?: UpscaleTargetResolution;
  enabledIgModules?: readonly IgUpscaleLogicModuleId[];
}): CompiledSunraVideoAndUpscalePlan {
  const tier =
    BRAND_SEEDANCE_VIDEO_TIERS.find((t) => t.id === input.seedanceTierId) ??
    BRAND_SEEDANCE_VIDEO_TIERS[1]!;
  const engine =
    BRAND_UPSCALING_STUDIO_ENGINES.find((e) => e.id === input.upscalerEngineId) ??
    BRAND_UPSCALING_STUDIO_ENGINES[0]!;
  const targetRes =
    input.targetResolution && engine.supportedTargets.includes(input.targetResolution)
      ? input.targetResolution
      : engine.defaultTarget;

  const activeModules =
    input.enabledIgModules ??
    IG_OPTIMIZED_UPSCALE_LOGIC_MODULES.filter((m) => m.defaultEnabled).map((m) => m.id);
  const modSet = new Set(activeModules);

  const filters: string[] = [];
  if (modSet.has("cfr24_clean_metadata_zoom")) {
    filters.push("crop=iw/1.03:ih/1.03");
  }
  filters.push(
    targetRes === "4K"
      ? "scale=2160:3840:flags=lanczos+accurate_rnd+full_chroma_int"
      : targetRes === "2K"
        ? "scale=1440:2560:flags=lanczos+accurate_rnd+full_chroma_int"
        : "scale=1080:1920:flags=lanczos+accurate_rnd+full_chroma_int",
  );
  if (modSet.has("cas_micro_edge")) {
    filters.push("unsharp=3:3:0.55:3:3:0.0", "cas=0.25");
  }
  if (modSet.has("oled_shadow_curve_sdr")) {
    filters.push("curves=m='0.005/0.015 0.06/0.05 0.50/0.50 0.94/0.955 0.995/0.985'");
  }
  if (modSet.has("iso3200_luma_grain")) {
    filters.push("noise=c0s=3.4:c0f=t+u");
  }
  filters.push("format=yuv420p");

  const cloudMode =
    tier.id === "seedance_2_5_480p_draft" && targetRes === "1080p"
      ? "seedance_draft_finalize_1080p"
      : engine.id === "seedvr2_7b_optical_upscaler"
        ? "seedvr2_hybrid_diffusion"
        : "sunra_cloud_super_resolution";

  return {
    seedanceGeneration: {
      tierId: tier.id,
      sunraTool: "create_video",
      sunraArgs: {
        model: "seedance-2.5",
        resolution: tier.resolution,
        draft: tier.draft,
        duration: input.durationSec,
        aspect_ratio: input.aspectRatio,
        generate_audio: true,
        parameters: {
          bitrate_mode: "high",
        },
      },
    },
    upscaleStudio: {
      engineId: engine.id,
      sourceResolution: tier.resolution,
      targetResolution: targetRes,
      sunraCloudStep: {
        mode: cloudMode,
        sunraModel:
          targetRes === "4K" || targetRes === "2K"
            ? "pika-h3-flex"
            : "seedance-2.5",
        targetResolutionParam:
          targetRes === "4K" ? "4k" : targetRes === "2K" ? "2k" : "1080p",
      },
      igOptimizationActive: engine.includesIgDeAiLogic && targetRes === "1080p",
      enabledLogicModules: activeModules,
      ffmpegFilterChain: filters.join(","),
      igEditsExportRuleKo:
        "인스타그램 · Edits 앱 내보내기 필수 설정: 해상도 HD(1080p) · 색상 SDR 유지(HDR 끄기) · 프레임 24fps 유지(60fps 끄기)",
      igEditsExportRuleEn:
        "Instagram / Edits Export Rule: Resolution HD (1080p) · Color SDR (Never HDR) · Frame Rate Native 24fps (Never 60fps)",
    },
  };
}

/**
 * Developer-IDE Inspired Collapsible Dual Split-Pane Architecture for Self-Studio:
 * - Left Pane: Image Studio (5 Image Models · 1-4 Reference Slots · Micro-Region Layer Edit)
 * - Right Pane: Video & Upscale Studio (Dotted Canvas · +References Bridge · Seedance 2.5 480p/720p/1080p · IG 1080p/4K Upscaling Studio · Floating Composer Dock)
 * - Either side can be collapsed at any time (`image_only` or `video_only`), or kept side-by-side (`dual_split`) so images generated on the left can be sent into the right video pane's `+ References` with 1 click.
 */
export type StudioSplitPaneMode = "dual_split" | "image_only" | "video_only";

export interface StudioSplitPaneModeSpec {
  id: StudioSplitPaneMode;
  iconGlyph: string;
  labelKo: string;
  labelEn: string;
  shortDescKo: string;
  shortDescEn: string;
  leftImageVisible: boolean;
  rightVideoVisible: boolean;
}

export const STUDIO_SPLIT_PANE_MODES: readonly StudioSplitPaneModeSpec[] = [
  {
    id: "dual_split",
    iconGlyph: "◫",
    labelKo: "듀얼 스플릿 (좌: 이미지 ↔ 우: 영상)",
    labelEn: "Dual Split (Left: Image ↔ Right: Video)",
    shortDescKo:
      "왼쪽에서 만든 화보·제품 컷을 클릭 한 번으로 오른쪽 Seedance 2.5 영상의 시작 프레임이나 +References에 바로 넣습니다",
    shortDescEn:
      "Send any image generated on the left directly into the right Seedance 2.5 video pane's First Frame or +References",
    leftImageVisible: true,
    rightVideoVisible: true,
  },
  {
    id: "image_only",
    iconGlyph: "◧",
    labelKo: "이미지 스튜디오만 펼치기 (우측 접기)",
    labelEn: "Image Studio Only (Fold Right)",
    shortDescKo:
      "우측 영상 탭을 접고 5종 이미지 모델·제품 교체·부분 수정 캔버스를 전체 화면으로 넓게 씁니다",
    shortDescEn:
      "Collapse the right video pane and focus 100% of the screen on image generation & micro-region editing",
    leftImageVisible: true,
    rightVideoVisible: false,
  },
  {
    id: "video_only",
    iconGlyph: "◨",
    labelKo: "영상 · 업스케일만 펼치기 (좌측 접기)",
    labelEn: "Video & Upscale Only (Fold Left)",
    shortDescKo:
      "좌측 이미지 탭을 접고 Seedance 2.5 영상 생성과 1080p(인스타 최적화)/4K 업스케일링 스튜디오에 집중합니다",
    shortDescEn:
      "Collapse the left image pane and focus 100% on Seedance 2.5 video & Instagram 1080p/4K upscaling",
    leftImageVisible: false,
    rightVideoVisible: true,
  },
];

export type VideoReferenceTargetSlot =
  | "first_frame"
  | "end_frame"
  | "character_ref"
  | "product_ref"
  | "color_mood_ref";

export interface VideoReferenceTargetSlotSpec {
  id: VideoReferenceTargetSlot;
  badgeKo: string;
  badgeEn: string;
  roleKo: string;
  roleEn: string;
  promptCitationKo: string;
  promptCitationEn: string;
}

export const VIDEO_REFERENCE_TARGET_SLOTS: readonly VideoReferenceTargetSlotSpec[] = [
  {
    id: "first_frame",
    badgeKo: "시작 프레임 (First Frame)",
    badgeEn: "First Frame",
    roleKo: "좌측 이미지를 영상의 0.0초 첫 장면으로 고정",
    roleEn: "Locks the left image as the 0.0s opening frame",
    promptCitationKo: "[시작 프레임: 좌측 이미지 컷 고정 — 카메라가 부드럽게 전진하며 자연스러운 인물·옷감 모션 시작]",
    promptCitationEn: "[First Frame locked from Left Image — smooth camera push-in with natural subject & fabric motion]",
  },
  {
    id: "character_ref",
    badgeKo: "+Ref 1 · 인물·착장 고정",
    badgeEn: "+Ref 1 · Subject & Outfit",
    roleKo: "좌측 이미지의 모델 얼굴·헤어·착장을 영상 내내 유지",
    roleEn: "Preserves model likeness, hair, and outfit across the clip",
    promptCitationKo: "[+References #1 인물·착장: 좌측 이미지의 모델 이목구비와 의류 핏 100% 유지]",
    promptCitationEn: "[+References #1 Subject: preserve 100% facial identity and outfit fit from left image]",
  },
  {
    id: "product_ref",
    badgeKo: "+Ref 2 · 제품·라벨 고정",
    badgeEn: "+Ref 2 · Product & Label",
    roleKo: "좌측 이미지의 제품 형태·로고 타이포그래피를 흔들림 없이 유지",
    roleEn: "Locks product geometry and label typography during motion",
    promptCitationKo: "[+References #2 제품: 좌측 이미지의 제품 용기 비율과 전면 라벨 글자 왜곡 없이 유지]",
    promptCitationEn: "[+References #2 Product: lock container geometry and label typography from left image]",
  },
  {
    id: "color_mood_ref",
    badgeKo: "+Ref 3 · 조명·색감 무드",
    badgeEn: "+Ref 3 · Lighting & Grade",
    roleKo: "좌측 이미지의 조명 온도와 필름 색감을 영상에 그대로 이식",
    roleEn: "Transfers lighting temperature and film grade to video",
    promptCitationKo: "[+References #3 색감·조명: 좌측 이미지의 하이라이트 윤기와 섀도우 색온도 그대로 유지]",
    promptCitationEn: "[+References #3 Color & Light: match specular highlights and shadow color temperature]",
  },
  {
    id: "end_frame",
    badgeKo: "끝 프레임 (End Frame)",
    badgeEn: "End Frame",
    roleKo: "영상 마지막 클로즈업·제품 착지 장면을 좌측 이미지로 고정",
    roleEn: "Locks the final landing frame of the video to the left image",
    promptCitationKo: "[끝 프레임: 좌측 이미지 구도로 정확히 안착하며 마무리]",
    promptCitationEn: "[End Frame: settle cleanly into the left image composition]",
  },
];

export interface BridgedVideoReferenceItem {
  slotId: VideoReferenceTargetSlot;
  imageSrc: string;
  imageLabelKo: string;
  imageLabelEn: string;
  sourceModelNameKo: string;
  sourceModelNameEn: string;
  citationKo: string;
  citationEn: string;
}

export function bridgeLeftImageToRightVideoReference(input: {
  currentRefs: readonly BridgedVideoReferenceItem[];
  slotId: VideoReferenceTargetSlot;
  imageSrc: string;
  imageLabelKo: string;
  imageLabelEn: string;
  sourceModelNameKo: string;
  sourceModelNameEn: string;
}): BridgedVideoReferenceItem[] {
  const spec =
    VIDEO_REFERENCE_TARGET_SLOTS.find((s) => s.id === input.slotId) ??
    VIDEO_REFERENCE_TARGET_SLOTS[0]!;
  const nextItem: BridgedVideoReferenceItem = {
    slotId: spec.id,
    imageSrc: input.imageSrc,
    imageLabelKo: input.imageLabelKo,
    imageLabelEn: input.imageLabelEn,
    sourceModelNameKo: input.sourceModelNameKo,
    sourceModelNameEn: input.sourceModelNameEn,
    citationKo: spec.promptCitationKo,
    citationEn: spec.promptCitationEn,
  };
  const filtered = input.currentRefs.filter((r) => r.slotId !== input.slotId);
  return [nextItem, ...filtered];
}

/**
 * Morphic Studio / Krea Canvas / Flora Style Multi-Asset Spatial Board Nodes.
 * Multiple assets (References, Generated Stills, Video Node, Upscale Node) are spread out
 * across the 2D dotted board so users can see, select, drag, and wire them at a glance.
 */
export type SpatialBoardNodeKind =
  | "reference_asset"
  | "generated_still"
  | "video_node"
  | "upscale_node";

export interface SpatialBoardAssetNode {
  id: string;
  kind: SpatialBoardNodeKind;
  badgeKo: string;
  badgeEn: string;
  titleKo: string;
  titleEn: string;
  metaKo: string;
  metaEn: string;
  thumbSrc: string;
  videoSrc?: string;
  aspectRatio: string;
  defaultSelected: boolean;
  connectedToIds: readonly string[];
}

export const DEFAULT_SPATIAL_BOARD_NODES: readonly SpatialBoardAssetNode[] = [
  {
    id: "node-ref-model",
    kind: "reference_asset",
    badgeKo: "참고 1 · 인물",
    badgeEn: "Ref 1 · Model",
    titleKo: "모델 얼굴 · 착장",
    titleEn: "Model & Outfit",
    metaKo: "클릭해 참조 켜기/끄기",
    metaEn: "Click to toggle ref",
    thumbSrc: "/reel/brands/slot-1-subject-editorial.jpg",
    aspectRatio: "4 / 5",
    defaultSelected: true,
    connectedToIds: ["node-still-01", "node-still-02"],
  },
  {
    id: "node-ref-product",
    kind: "reference_asset",
    badgeKo: "참고 2 · 제품",
    badgeEn: "Ref 2 · Product",
    titleKo: "우리 브랜드 제품 원본",
    titleEn: "Brand Product SKU",
    metaKo: "로고 · 형태 98% 유지",
    metaEn: "98% Label & Shape Lock",
    thumbSrc: "/reel/brands/slot-2-space-concrete-blue.jpg",
    aspectRatio: "4 / 5",
    defaultSelected: true,
    connectedToIds: ["node-still-01", "node-still-02"],
  },
  {
    id: "node-ref-color",
    kind: "reference_asset",
    badgeKo: "참고 3 · 색감·질감 핀",
    badgeEn: "Ref 3 · Style Pin",
    titleKo: "프렌치 코발트 & 필름",
    titleEn: "French Cobalt & Grain",
    metaKo: "고정 켜짐 (Pin ON)",
    metaEn: "Pinned Style ON",
    thumbSrc: "/reel/brands/slot-4-color-french-cobalt.jpg",
    aspectRatio: "1 / 1",
    defaultSelected: true,
    connectedToIds: ["node-still-01", "node-still-02", "node-video-seedance"],
  },
  {
    id: "node-still-01",
    kind: "generated_still",
    badgeKo: "생성 화보 A · 선택됨",
    badgeEn: "Generated Still A",
    titleKo: "정면 히어로 컷 (2K)",
    titleEn: "Front Hero Still (2K)",
    metaKo: "Nano Banana Pro · 4:5",
    metaEn: "Nano Banana Pro · 4:5",
    thumbSrc: "/reel/brands/slot-1-subject-editorial.jpg",
    aspectRatio: "4 / 5",
    defaultSelected: true,
    connectedToIds: ["node-video-seedance"],
  },
  {
    id: "node-still-02",
    kind: "generated_still",
    badgeKo: "생성 화보 B",
    badgeEn: "Generated Still B",
    titleKo: "측면 로우앵글 룩북 (2K)",
    titleEn: "Low-Angle Lookbook (2K)",
    metaKo: "GPT Image 2.6 · 4:5",
    metaEn: "GPT Image 2.6 · 4:5",
    thumbSrc: "/reel/brands/slot-3-pose-lowangle-lookbook.jpg",
    aspectRatio: "4 / 5",
    defaultSelected: false,
    connectedToIds: [],
  },
  {
    id: "node-video-seedance",
    kind: "video_node",
    badgeKo: "영상 노드 · Seedance 2.5",
    badgeEn: "Video · Seedance 2.5",
    titleKo: "화보 A → 720p 모션 영상",
    titleEn: "Still A -> 720p Motion",
    metaKo: "480p Draft · 720p · 1080p",
    metaEn: "480p Draft · 720p · 1080p",
    thumbSrc: "/reel/brands/house-french-blue-hero-1080p.jpg",
    videoSrc: "/reel/brands/house-french-blue-hero-1080p.mp4",
    aspectRatio: "9 / 16",
    defaultSelected: true,
    connectedToIds: ["node-upscale-ig"],
  },
  {
    id: "node-upscale-ig",
    kind: "upscale_node",
    badgeKo: "마감 노드 · 업스케일",
    badgeEn: "Finish · Upscale Studio",
    titleKo: "1080p 인스타 최적화 & 4K",
    titleEn: "1080p IG Master & 4K",
    metaKo: "Sunra 1080p + 화질 보호",
    metaEn: "Sunra 1080p + IG Guard",
    thumbSrc: "/reel/brands/studio-editorial-blue-1080p.jpg",
    videoSrc: "/reel/brands/studio-editorial-blue-1080p.mp4",
    aspectRatio: "9 / 16",
    defaultSelected: false,
    connectedToIds: [],
  },
];



