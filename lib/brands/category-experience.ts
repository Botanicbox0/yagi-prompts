import type { OnboardingCategory } from "@/lib/brands/identity/onboarding";
import type { OledCinemaLookId } from "@/lib/brands/production-pipeline/video-creator-techniques";
import type {
  DeliverableMedium as BrandMedium,
  ShotAspect as BrandAspect,
  ShotCutKind as BrandCutKind,
} from "@/lib/brands/briefs/schema";

export type BrandClientCategory = OnboardingCategory;

export interface CategorySceneOption {
  id: "product" | "texture" | "wearing" | "video";
  titleKo: string;
  titleEn: string;
  descKo: string;
  descEn: string;
  placeholderKo: string;
  placeholderEn: string;
  quickPromptsKo: readonly [string, string, string];
  quickPromptsEn: readonly [string, string, string];
  cutKind: BrandCutKind;
  medium: BrandMedium;
  defaultAspect: BrandAspect;
  focalMm: 35 | 50 | 85 | 100;
}

export interface CategoryCompilerGuardrails {
  defaultAspect: BrandAspect;
  defaultOledLookId: OledCinemaLookId;
  defaultLightColourK: number;
  scaleAndGeometryLockKo: string;
  scaleAndGeometryLockEn: string;
  skinAndMaterialLockKo: string;
  skinAndMaterialLockEn: string;
  negativeGuardrails: readonly string[];
  defaultProductChecklist: {
    geometry: string;
    label: string;
    material: string;
  };
}

export interface CategoryCampaignStarter {
  id: string;
  category: BrandClientCategory;
  badgeKo: string;
  badgeEn: string;
  titleKo: string;
  titleEn: string;
  objectiveKo: string;
  objectiveEn: string;
  deliverableSummaryKo: string;
  deliverableSummaryEn: string;
  recommendedTrack: "creator_campaign" | "template_build" | "studio_film";
}

export interface CategoryExperienceProfile {
  category: BrandClientCategory;
  labelKo: string;
  labelEn: string;
  rolePersonaKo: string;
  rolePersonaEn: string;
  headlineKo: string;
  headlineEn: string;
  scenes: readonly [
    CategorySceneOption,
    CategorySceneOption,
    CategorySceneOption,
    CategorySceneOption,
  ];
  compiler: CategoryCompilerGuardrails;
  campaignStarters: readonly CategoryCampaignStarter[];
}

export const BRAND_CLIENT_CATEGORIES: readonly BrandClientCategory[] = [
  "fashion_apparel",
  "beauty_skincare",
  "fnb_hospitality",
  "lifestyle_object",
  "tech_platform",
] as const;

const PROFILES: Record<BrandClientCategory, CategoryExperienceProfile> = {
  fashion_apparel: {
    category: "fashion_apparel",
    labelKo: "패션 · 어패럴",
    labelEn: "Fashion & Apparel",
    rolePersonaKo: "패션 MD · 아트 디렉터 맞춤",
    rolePersonaEn: "For Fashion Directors & MDs",
    headlineKo: "룩북 핏·원단 디테일·런웨이 숏폼까지 컬렉션 톤으로 제작합니다",
    headlineEn: "Create lookbook fits, fabric macros, and runway short-form in your collection tone",
    scenes: [
      {
        id: "product",
        titleKo: "행거 · 정물 단독 컷",
        titleEn: "Garment Packshot",
        descKo: "아우터·상의·가방의 정면 실루엣과 핏",
        descEn: "Clean front silhouette, drape, and hardware",
        placeholderKo:
          "예: 차분한 콘크리트 호리존 위에서 시그니처 테크니컬 재킷의 비대칭 지퍼와 매트 나일론 핏이 잘 보이게",
        placeholderEn:
          "e.g. Signature technical jacket on a calm concrete horizon showing asymmetric zipper and matte nylon drape",
        quickPromptsKo: [
          "콘크리트 스튜디오 자연광 아래 시그니처 재킷 정면 실루엣",
          "아이보리 호리존 위 가죽 백과 메탈 버클 정물 컷",
          "프렌치 블루 배경 앞 코트와 테일러드 팬츠 레이어드 정물",
        ],
        quickPromptsEn: [
          "Signature jacket front silhouette in concrete studio daylight",
          "Leather bag and metal buckle still-life on ivory horizon",
          "Layered coat and tailored trousers against French-blue backdrop",
        ],
        cutKind: "reference_exact_product",
        medium: "product still",
        defaultAspect: "4:5",
        focalMm: 85,
      },
      {
        id: "texture",
        titleKo: "원단 · 봉제 디테일",
        titleEn: "Fabric & Stitch Macro",
        descKo: "직조 결, 지퍼, 단추, 직조 라벨 클로즈업",
        descEn: "Close-up of weave texture, zipper teeth, and woven label",
        placeholderKo:
          "예: 아우터 칼라 봉제선과 무광 스냅 버튼, 나일론 원단 결이 선명하게 보이는 클로즈업",
        placeholderEn:
          "e.g. Macro close-up of collar stitching, matte snap button, and crisp nylon weave",
        quickPromptsKo: [
          "무광 나일론 원단 결과 방수 지퍼 라인 초근접 클로즈업",
          "울 코트 헤링본 직조감과 소매 커프스 버튼 디테일",
          "내부 직조 케어라벨과 정교한 심실링 마감 클로즈업",
        ],
        quickPromptsEn: [
          "Macro close-up of matte nylon weave and waterproof zipper line",
          "Wool coat herringbone weave and sleeve cuff button detail",
          "Interior woven label and precision seam-sealing close-up",
        ],
        cutKind: "logo_mark_preserve",
        medium: "product still",
        defaultAspect: "1:1",
        focalMm: 100,
      },
      {
        id: "wearing",
        titleKo: "착용 · 핏 룩북",
        titleEn: "Lookbook Fit & Editorial",
        descKo: "모델 착장 실루엣과 자연스러운 피부 톤 화보",
        descEn: "Model wearing the garment with natural warm skin tone",
        placeholderKo:
          "예: 오후 채광이 들어오는 성수동 콘크리트 공간에서 아우터를 걸친 모델의 3/4 워킹 룩북",
        placeholderEn:
          "e.g. 3/4 walking lookbook of a model wearing the jacket in sunlit concrete space",
        quickPromptsKo: [
          "성수 콘크리트 자연광 아래 아우터를 입은 모델의 3/4 룩북 컷",
          "프렌치 블루 세트 앞에서 테일러드 코트 핏을 보여주는 전신 화보",
          "계단 위에서 자연스럽게 시선을 돌린 로우앵글 스트리트 룩북",
        ],
        quickPromptsEn: [
          "3/4 lookbook cut of model in jacket under concrete daylight",
          "Full-body editorial showing tailored coat drape on French-blue set",
          "Low-angle street lookbook on steps with natural off-camera gaze",
        ],
        cutKind: "editorial_full_body",
        medium: "editorial still",
        defaultAspect: "4:5",
        focalMm: 50,
      },
      {
        id: "video",
        titleKo: "런웨이 · 무빙 숏폼",
        titleEn: "Runway & Lookbook Film",
        descKo: "옷깃의 흔들림과 카메라 호흡이 살아있는 15초 영상",
        descEn: "15s short film capturing fabric motion and camera cadence",
        placeholderKo:
          "예: 모델이 걸어 나올 때 코트 밑단이 흔들리고, 소매 디테일로 빠르게 교차 편집되는 15초 릴스",
        placeholderEn:
          "e.g. 15s Reels where coat hem moves in motion, intercut with sleeve and collar details",
        quickPromptsKo: [
          "이미 걸어 나오는 동작으로 시작해 아우터 핏과 원단 디테일을 교차하는 15초 런웨이",
          "도심 오후 자연광 속 코트 자락의 움직임을 따라가는 9:16 룩북 필름",
          "정면 워킹에서 시작해 측면 실루엣과 지퍼 클로즈업으로 이어지는 15초 숏폼",
        ],
        quickPromptsEn: [
          "Begin already in motion: 15s runway intercutting jacket fit and fabric macro",
          "9:16 lookbook film tracking coat movement in afternoon city light",
          "15s short-form from walking entry to profile silhouette and zipper close-up",
        ],
        cutKind: "short_film_clip",
        medium: "short film",
        defaultAspect: "9:16",
        focalMm: 50,
      },
    ],
    compiler: {
      defaultAspect: "4:5",
      defaultOledLookId: "oled-editorial-punch",
      defaultLightColourK: 5400,
      scaleAndGeometryLockKo:
        "의상 비대칭 지퍼·봉제선·라벨 비례 1:1 고정 및 전신 발끝 접지·상반신 35~55% 구도 유지",
      scaleAndGeometryLockEn:
        "Lock garment asymmetric zipper, seam lines & label 1:1; enforce grounded footwear and 35–55% bust-up framing",
      skinAndMaterialLockKo:
        "원단 매트/직조 질감 보존 및 핑크 블러셔 없는 자연스러운 웜 피부 톤(15°–40°) 유지",
      skinAndMaterialLockEn:
        "Preserve matte/woven fabric texture and natural warm skin tone (15°–40°) with no visible pink blush",
      negativeGuardrails: [
        "warped garment logo",
        "melted zipper teeth",
        "floating feet",
        "pink blush makeup",
        "plastic beauty filter skin",
      ],
      defaultProductChecklist: {
        geometry: "비대칭 지퍼 라인, 칼라 구조, 어깨 재단선과 밑단 실루엣 비례 100% 보존",
        label: "전면·내부 워드마크 철자 및 로고 직선 비례 1:1 고정",
        material: "매트 나일론·울 직조 결 및 무광 금속 스냅 질감 유지 (플라스틱 광택 금지)",
      },
    },
    campaignStarters: [
      {
        id: "fashion-lookbook-seeding",
        category: "fashion_apparel",
        badgeKo: "패션 · 시즌 룩북 시딩",
        badgeEn: "Fashion · Lookbook Seeding",
        titleKo: "시즌 시그니처 아우터 릴스 동시 시딩 캠페인",
        titleEn: "Signature Outerwear Reels Seeding Campaign",
        objectiveKo:
          "런웨이·스트리트 무드 마스터 포맷 1편을 설계한 뒤, 패션 크리에이터들이 각자의 얼굴로 인스타그램 릴스·틱톡에 동시 업로드해 시즌 주력 아우터 핏을 확산합니다.",
        objectiveEn:
          "Lock one runway/street master format and scale simultaneous creator Reels/TikTok uploads showcasing the hero outerwear fit.",
        deliverableSummaryKo: "9:16 릴스 마스터 + 4:5 룩북 스틸",
        deliverableSummaryEn: "9:16 Reels Master + 4:5 Lookbook Stills",
        recommendedTrack: "creator_campaign",
      },
    ],
  },
  beauty_skincare: {
    category: "beauty_skincare",
    labelKo: "뷰티 · 스킨케어",
    labelEn: "Beauty & Skincare",
    rolePersonaKo: "뷰티 BM · 브랜드 마케터 맞춤",
    rolePersonaEn: "For Beauty BMs & Brand Marketers",
    headlineKo: "손안에 들어오는 실제 용기 비율과 투명한 제형, 맑은 피부 톤으로 제작합니다",
    headlineEn: "True hand-held bottle scale, translucent formulation texture, and natural skin glow",
    scenes: [
      {
        id: "product",
        titleKo: "보틀 · 용기 단독 컷",
        titleEn: "Bottle & Packaging Hero",
        descKo: "실제 손안 크기 비율과 유리 굴절·라벨을 지킨 정물",
        descEn: "True hand-held bottle scale with crisp glass refraction & label",
        placeholderKo:
          "예: 수분감 있는 라임스톤 단상 위 50ml 세럼 보틀, 실제 손안에 들어오는 크기로 전면 라벨이 선명하게",
        placeholderEn:
          "e.g. 50ml serum bottle on limestone plinth at true hand-held scale with crisp front serif label",
        quickPromptsKo: [
          "라임스톤 석재 위 50ml 세럼 보틀과 투명한 아침 자연광 그림자",
          "프렌치 블루 새틴 위 향수 보틀, 은색 캡과 분사 펌프까지 선명한 정물",
          "맑은 수면 파동 위 스킨케어 용기 정면 클린 팩샷",
        ],
        quickPromptsEn: [
          "50ml serum bottle on limestone plinth with crisp morning daylight shadow",
          "Perfume bottle on French-blue satin showing silver cap and atomizer pump",
          "Clean front skincare bottle packshot over gentle water ripples",
        ],
        cutKind: "reference_exact_product",
        medium: "product still",
        defaultAspect: "4:5",
        focalMm: 85,
      },
      {
        id: "texture",
        titleKo: "제형 · 수분 텍스처",
        titleEn: "Formulation & Droplet Macro",
        descKo: "세럼 물방울, 크림 스미어, 스포이드 끝 초근접 컷",
        descEn: "Macro shot of serum droplet, cream smear, and glass dropper tip",
        placeholderKo:
          "예: 유리 스포이드 끝에서 맑은 세럼 한 방울이 맺히는 순간, 기포와 수분 광채 초근접 클로즈업",
        placeholderEn:
          "e.g. Macro close-up of a clear serum droplet forming at the glass pipette tip with micro-bubbles",
        quickPromptsKo: [
          "유리 스포이드 끝에서 투명한 에센스 한 방울이 떨어지기 직전의 초근접 컷",
          "차가운 석재 위 부드럽게 펴 발린 크림 제형과 촉촉한 윤기 클로즈업",
          "보틀 유리 표면의 미세한 물방울과 빛 굴절 디테일",
        ],
        quickPromptsEn: [
          "Extreme macro of a translucent essence droplet at the glass dropper tip",
          "Cream formulation smear on cool stone showing hydrated specular sheen",
          "Micro water droplets and light refraction on frosted glass bottle",
        ],
        cutKind: "logo_mark_preserve",
        medium: "product still",
        defaultAspect: "1:1",
        focalMm: 100,
      },
      {
        id: "wearing",
        titleKo: "피부 도포 · 사용 컷",
        titleEn: "Skin Application & Glow",
        descKo: "보정 필터 없이 맑고 건강한 피부 결이 살아있는 화보",
        descEn: "Natural pore texture and warm skin glow without plastic filters",
        placeholderKo:
          "예: 아침 창가 자연광 아래 손안에 들어오는 세럼 보틀을 뺨 가까이 든 모델의 맑은 피부 클로즈업",
        placeholderEn:
          "e.g. Sunlit close-up of model holding the hand-sized serum bottle near her cheek with natural skin texture",
        quickPromptsKo: [
          "창가 자연광 아래 실제 피부 결과 맑은 수분 윤광이 돋보이는 인물·보틀 투샷",
          "과한 핑크 색조 없이 본연의 입술 톤과 깨끗한 결을 살린 뷰티 에디토리얼",
          "손끝에 제형을 덜어 볼에 닿는 순간을 담은 85mm 뷰티 클로즈업",
        ],
        quickPromptsEn: [
          "Window-lit two-shot of natural skin texture and true-scale bottle",
          "Beauty editorial with natural muted lip tone and zero pink blush",
          "85mm close-up of fingertip applying serum to sunlit cheekbone",
        ],
        cutKind: "person_portrait",
        medium: "editorial still",
        defaultAspect: "4:5",
        focalMm: 85,
      },
      {
        id: "video",
        titleKo: "글로우 · 제형 숏폼",
        titleEn: "Beauty Glow & Texture Film",
        descKo: "얼굴·보틀·제형 인서트가 리듬감 있게 교차하는 15초 영상",
        descEn: "15s beauty film intercutting face glow, true-scale bottle, and texture",
        placeholderKo:
          "예: 맑은 피부 클로즈업에서 시작해 스포이드 물방울과 보틀 정면 컷이 빠르게 교차하는 15초 뷰티 필름",
        placeholderEn:
          "e.g. 15s beauty film intercutting luminous skin close-up, dropper droplet, and centered bottle hero",
        quickPromptsKo: [
          "자연광 피부 클로즈업 → 스포이드 제형 낙하 → 보틀 정면 안착으로 이어지는 15초 필름",
          "수면 위 보틀 리빌과 모델의 은은한 시선 처리가 교차하는 9:16 뷰티 릴스",
          "손안 크기 향수 분사 순간과 보틀 라벨 클로즈업을 잇는 15초 감각 쇼츠",
        ],
        quickPromptsEn: [
          "15s film: sunlit skin close-up -> pipette droplet -> bottle hero lockup",
          "9:16 beauty Reels intercutting water-ripple bottle reveal and calm gaze",
          "15s sensory spot linking true-scale perfume mist and crisp label macro",
        ],
        cutKind: "short_film_clip",
        medium: "short film",
        defaultAspect: "9:16",
        focalMm: 85,
      },
    ],
    compiler: {
      defaultAspect: "4:5",
      defaultOledLookId: "dreamcore-pastel-bloom",
      defaultLightColourK: 5500,
      scaleAndGeometryLockKo:
        "용기 실제 손안 크기(Hand-held scale) 고정 · 캡·분사 펌프·스포이드 부품 누락 금지 · 전면 세리프 라벨 1:1 고정",
      scaleAndGeometryLockEn:
        "Lock true hand-held bottle scale; preserve cap, atomizer pump & dropper parts; lock front serif label 1:1",
      skinAndMaterialLockKo:
        "분홍 블러셔·인위적 뷰티 필터 금지(no visible blush) · 실제 모공과 따뜻한 피부 톤(15°–40°) 및 유리 굴절률 보존",
      skinAndMaterialLockEn:
        "No visible pink blush or plastic skin filter; preserve real pore micro-texture, warm skin (15°–40°), and glass refraction",
      negativeGuardrails: [
        "oversized giant perfume bottle",
        "missing atomizer pump",
        "pink blush on cheeks",
        "plastic airbrushed skin",
        "warped bottle label typography",
      ],
      defaultProductChecklist: {
        geometry: "원통·하트 등 보틀 고유 비율, 실제 손안 크기, 캡과 내부 분사 펌프·스포이드 구조 100% 유지",
        label: "보틀 전면 세리프·워드마크 자간 및 중앙 정렬 1:1 고정",
        material: "프로스티드·투명 유리 굴절률과 액체 투명도, 실제 피부 모공 질감 보존",
      },
    },
    campaignStarters: [
      {
        id: "beauty-serum-seeding",
        category: "beauty_skincare",
        badgeKo: "뷰티 · 신제품 릴스 시딩",
        badgeEn: "Beauty · New Launch Seeding",
        titleKo: "신제품 세럼·향수 제형 & 글로우 릴스 확산 캠페인",
        titleEn: "New Serum & Fragrance Glow Reels Seeding Campaign",
        objectiveKo:
          "보틀 비율과 제형 질감이 고정된 1080p 뷰티 포맷을 설계하고, 뷰티 크리에이터들이 본인 얼굴로 릴스·틱톡에 동시 업로드해 초기 바이럴과 저장수를 확보합니다.",
        objectiveEn:
          "Design a bottle-locked 1080p beauty format and scale creator Reels/TikTok seeding to drive saves and launch reach.",
        deliverableSummaryKo: "9:16 글로우 릴스 + 1:1 제형 상세컷",
        deliverableSummaryEn: "9:16 Glow Reels + 1:1 Texture Macros",
        recommendedTrack: "creator_campaign",
      },
    ],
  },
  fnb_hospitality: {
    category: "fnb_hospitality",
    labelKo: "F&B · 다이닝",
    labelEn: "F&B & Hospitality",
    rolePersonaKo: "F&B 브랜드 PM · 마케터 맞춤",
    rolePersonaEn: "For F&B Brand PMs & Marketers",
    headlineKo: "패키지 로고 곡률부터 신선한 결로·푸어링 숏폼까지 식음료 감도로 제작합니다",
    headlineEn: "Curved package logo lock, fresh condensation macros, and pouring short-form",
    scenes: [
      {
        id: "product",
        titleKo: "메뉴 · 패키지 단독 컷",
        titleEn: "Menu & Package Hero",
        descKo: "보틀·캔·컵 슬리브 곡면 로고와 패키지가 선명한 정물",
        descEn: "Bottle, can, or cup-sleeve hero with curved label precision",
        placeholderKo:
          "예: 따뜻한 오크우드 카운터 위 시그니처 콜드브루 보틀과 세라믹 잔, 라벨 로고가 왜곡 없이 선명하게",
        placeholderEn:
          "e.g. Signature cold-brew bottle and ceramic cup on warm oak counter with undistorted curved label",
        quickPromptsKo: [
          "오크우드 바 카운터 위 시그니처 콜드브루 보틀과 오후 창문 채광",
          "정갈한 리넨 테이블 위 디저트 패키지 박스와 엠보싱 로고 정물",
          "스테인리스 에스프레소 바 위 시그니처 캔 음료 라인업 팩샷",
        ],
        quickPromptsEn: [
          "Signature cold-brew bottle on oak bar counter in afternoon window light",
          "Dessert package box with embossed logo on clean linen table",
          "Signature canned beverage lineup on brushed steel espresso bar",
        ],
        cutKind: "reference_exact_product",
        medium: "product still",
        defaultAspect: "4:5",
        focalMm: 85,
      },
      {
        id: "texture",
        titleKo: "결로 · 시즐 디테일",
        titleEn: "Condensation & Sizzle Macro",
        descKo: "얼음 잔 물방울, 크레마, 원재료의 신선한 질감 클로즈업",
        descEn: "Ice condensation droplets, espresso crema, and fresh ingredient macro",
        placeholderKo:
          "예: 차가운 유리잔 표면에 맺힌 자연스러운 결로 물방울과 진한 에스프레소 크레마 층 초근접 컷",
        placeholderEn:
          "e.g. Macro close-up of natural condensation droplets on chilled glass and rich espresso crema layer",
        quickPromptsKo: [
          "얼음이 담긴 유리잔 표면의 자연스러운 결로 물방울과 햇빛 반사 클로즈업",
          "갓 추출된 에스프레소가 우유 위로 퍼지는 마블링 초근접 디테일",
          "신선한 시트러스 과육과 탄산 기포가 올라오는 순간 매크로 컷",
        ],
        quickPromptsEn: [
          "Macro of natural condensation droplets on iced glass catching sunlight",
          "Freshly pulled espresso marbling into milk in extreme close-up",
          "Fresh citrus pulp and rising sparkling bubbles macro detail",
        ],
        cutKind: "logo_mark_preserve",
        medium: "product still",
        defaultAspect: "1:1",
        focalMm: 100,
      },
      {
        id: "wearing",
        titleKo: "테이블 · 다이닝 무드",
        titleEn: "Table & Dining Scene",
        descKo: "공간 채광과 함께 메뉴를 즐기는 자연스러운 라이프스타일 컷",
        descEn: "Natural sunlit table and hospitality scene",
        placeholderKo:
          "예: 성수 로스터리 창가 자리에서 시그니처 라떼 잔을 든 손과 따뜻한 오후 공간 분위기",
        placeholderEn:
          "e.g. Hand holding signature latte cup by a sunlit roastery window with warm afternoon ambiance",
        quickPromptsKo: [
          "오후 햇살이 깊게 들어오는 우드 테이블 위 브런치 플레이트와 커피 페어링",
          "시그니처 보틀을 한 손에 든 자연스러운 테이크아웃 라이프스타일 컷",
          "저녁 무드 조명 아래 와인 글라스와 세라믹 식기가 어우러진 다이닝 테이블",
        ],
        quickPromptsEn: [
          "Sunlit wood table with brunch plate and signature coffee pairing",
          "Natural takeaway lifestyle cut holding the signature bottle",
          "Evening dining table with glassware and ceramic plating",
        ],
        cutKind: "editorial_full_body",
        medium: "editorial still",
        defaultAspect: "4:5",
        focalMm: 50,
      },
      {
        id: "video",
        titleKo: "푸어링 · 시즐 숏폼",
        titleEn: "Pouring & Sizzle Short-Form",
        descKo: "음료 푸어링과 얼음·패키지 클로즈업이 이어지는 15초 영상",
        descEn: "15s sensory video of pouring action, ice clink, and package reveal",
        placeholderKo:
          "예: 얼음 잔 위로 콜드브루가 시원하게 따라지고, 보틀 전면 로고로 포커스되는 15초 릴스",
        placeholderEn:
          "e.g. 15s Reels of cold brew pouring over ice cubes, settling onto the front bottle logo",
        quickPromptsKo: [
          "얼음 잔 위로 시그니처 음료가 부어지는 순간부터 보틀 정면 컷까지 이어지는 15초 필름",
          "크레마가 올라오는 모닝 에스프레소 추출과 패키지 클로즈업 9:16 릴스",
          "탄산 기포와 결로 물방울 클로즈업으로 시작해 테이블 전체 무드로 열리는 숏폼",
        ],
        quickPromptsEn: [
          "15s film from signature drink pouring over ice to front bottle lockup",
          "9:16 Reels of morning espresso extraction crema and package close-up",
          "Short-form opening on sparkling condensation macro and pulling back to table mood",
        ],
        cutKind: "short_film_clip",
        medium: "short film",
        defaultAspect: "9:16",
        focalMm: 85,
      },
    ],
    compiler: {
      defaultAspect: "4:5",
      defaultOledLookId: "kodak-2383-campaign",
      defaultLightColourK: 4800,
      scaleAndGeometryLockKo:
        "원통형 보틀·컵 슬리브 곡면 로고 비율 1:1 고정 및 식기·패키지 기하 왜곡 방지",
      scaleAndGeometryLockEn:
        "Lock cylindrical bottle & cup-sleeve curved logo 1:1; prevent tableware and package distortion",
      skinAndMaterialLockKo:
        "자연스러운 결로 물방울·세라믹 유약 질감 보존 및 인위적인 합성 연기·과포화 색감 차단",
      skinAndMaterialLockEn:
        "Preserve natural condensation droplets and ceramic glaze; block artificial CGI smoke and oversaturated food hues",
      negativeGuardrails: [
        "fake CGI smoke",
        "oversaturated neon food color",
        "warped cup sleeve logo",
        "melted ice geometry",
      ],
      defaultProductChecklist: {
        geometry: "원통형 보틀·컵 슬리브 곡률과 세라믹 잔·패키지 박스 비례 보존",
        label: "패키지 전면 및 슬리브 엠보싱 워드마크·크레스트 1:1 고정",
        material: "자연광 결로 물방울, 액체 투명도, 우드·세라믹 실제 표면 질감 유지",
      },
    },
    campaignStarters: [
      {
        id: "fnb-menu-viral",
        category: "fnb_hospitality",
        badgeKo: "F&B · 신메뉴·매장 바이럴",
        badgeEn: "F&B · Menu & Store Viral",
        titleKo: "시즌 시그니처 메뉴 & 패키지 릴스 바이럴 캠페인",
        titleEn: "Seasonal Signature Menu & Package Reels Campaign",
        objectiveKo:
          "푸어링·시즐 사운드가 살아있는 1080p 마스터 포맷을 제작하고, 라이프스타일·미식 크리에이터 피드에 동시 확산해 매장 방문과 저장수를 높입니다.",
        objectiveEn:
          "Create a 1080p pouring/sizzle sound-on format and scale creator seeding to drive store visits and saves.",
        deliverableSummaryKo: "9:16 시즐 릴스 + 4:5 메뉴 화보",
        deliverableSummaryEn: "9:16 Sizzle Reels + 4:5 Menu Stills",
        recommendedTrack: "creator_campaign",
      },
    ],
  },
  lifestyle_object: {
    category: "lifestyle_object",
    labelKo: "라이프스타일 · 오브제",
    labelEn: "Lifestyle & Object",
    rolePersonaKo: "리빙 · 오브제 디렉터 맞춤",
    rolePersonaEn: "For Living & Object Directors",
    headlineKo: "제품의 조형 비례와 소재 마감, 공간 배치 무드를 정교하게 담아냅니다",
    headlineEn: "Precision industrial geometry, material finishes, and architectural space styling",
    scenes: [
      {
        id: "product",
        titleKo: "오브제 단독 컷",
        titleEn: "Object Studio Packshot",
        descKo: "제품의 직선·곡선 비례가 왜곡 없이 드러나는 정물",
        descEn: "Distortion-free studio packshot of object geometry",
        placeholderKo:
          "예: 정갈한 화이트 호리존 위 오브제 정면 실루엣과 은은한 측면 확산광 그림자",
        placeholderEn:
          "e.g. Clean front silhouette of the object on a white horizon with soft diffused side shadow",
        quickPromptsKo: [
          "화이트 호리존 위 오브제 정면 비례와 부드러운 바닥 그림자",
          "쿨 스틸 단상 위 제품 측면 실루엣과 림 하이라이트",
          "프렌치 블루 배경 앞 시그니처 오브제 클린 스튜디오 컷",
        ],
        quickPromptsEn: [
          "Object front proportion on white horizon with soft floor shadow",
          "Product profile silhouette on cool steel plinth with rim highlight",
          "Signature object clean studio cut in front of French-blue backdrop",
        ],
        cutKind: "reference_exact_product",
        medium: "product still",
        defaultAspect: "4:5",
        focalMm: 85,
      },
      {
        id: "texture",
        titleKo: "소재 · 마감 디테일",
        titleEn: "Material & Finish Macro",
        descKo: "브러시드 메탈, 세라믹, 패브릭, 각인 로고 클로즈업",
        descEn: "Brushed metal, ceramic glaze, fabric weave, and engraved logo macro",
        placeholderKo:
          "예: 브러시드 알루미늄 표면 헤어라인 질감과 음각 로고 각인이 선명한 초근접 컷",
        placeholderEn:
          "e.g. Macro close-up of brushed aluminum hairline finish and engraved wordmark",
        quickPromptsKo: [
          "브러시드 메탈 헤어라인 마감과 음각 로고 각인 초근접 클로즈업",
          "매트 세라믹 표면 질감과 모서리 곡률 하이라이트 디테일",
          "패브릭 위빙 질감과 금속 다이얼 노브 조립부 매크로 컷",
        ],
        quickPromptsEn: [
          "Brushed metal hairline finish and engraved logo macro",
          "Matte ceramic surface texture and edge curvature highlight",
          "Fabric weave and metal dial knob assembly close-up",
        ],
        cutKind: "logo_mark_preserve",
        medium: "product still",
        defaultAspect: "1:1",
        focalMm: 100,
      },
      {
        id: "wearing",
        titleKo: "공간 배치 · 사용 컷",
        titleEn: "Spatial & In-Use Scene",
        descKo: "채광 좋은 인테리어 공간 속에서 자연스럽게 쓰이는 장면",
        descEn: "Object placed naturally in sunlit architectural interior",
        placeholderKo:
          "예: 오전 자연광이 들어오는 미니멀 거실 선반 위에 놓인 오브제와 주변 여백",
        placeholderEn:
          "e.g. Object placed on a minimalist living room shelf in morning daylight with generous negative space",
        quickPromptsKo: [
          "오전 창문광이 들어오는 모듈러 선반 위 오브제 공간 연출 컷",
          "데스크 위에서 손끝으로 오브제 스위치를 조작하는 자연스러운 사용 장면",
          "차분한 석재와 우드가 어우러진 라운지 테이블 위 제품 배치 화보",
        ],
        quickPromptsEn: [
          "Object styled on modular shelf in morning window light",
          "Natural hand interaction operating the object switch on a desk",
          "Product placed on a stone and wood lounge table",
        ],
        cutKind: "editorial_full_body",
        medium: "editorial still",
        defaultAspect: "4:5",
        focalMm: 50,
      },
      {
        id: "video",
        titleKo: "라이프스타일 숏폼",
        titleEn: "Object & Space Short-Form",
        descKo: "빛의 이동과 제품 디테일이 차분하게 이어지는 15초 필름",
        descEn: "15s architectural film tracking light movement and object detail",
        placeholderKo:
          "예: 공간 전체 샷에서 시작해 오브제 표면의 빛 반사와 작동 순간으로 이어지는 15초 필름",
        placeholderEn:
          "e.g. 15s film moving from sunlit room wide shot to surface specular roll-off and tactile interaction",
        quickPromptsKo: [
          "창가 채광이 오브제 표면을 따라 흐르고 손끝 조작으로 이어지는 15초 필름",
          "미니멀 공간 와이드 컷과 메탈 각인 클로즈업을 교차하는 9:16 릴스",
          "오브제 360도 실루엣과 질감 사운드가 맞물리는 15초 제품 쇼츠",
        ],
        quickPromptsEn: [
          "15s film of window light sweeping across object surface into tactile interaction",
          "9:16 Reels intercutting minimalist room wide shot and metal engraving macro",
          "15s product short pairing silhouette rotation with tactile foley",
        ],
        cutKind: "short_film_clip",
        medium: "short film",
        defaultAspect: "9:16",
        focalMm: 50,
      },
    ],
    compiler: {
      defaultAspect: "4:5",
      defaultOledLookId: "reference-match",
      defaultLightColourK: 5400,
      scaleAndGeometryLockKo:
        "산업 디자인 직선·곡률 비례 및 각인 로고 위치 1:1 고정 · 광각 왜곡 금지",
      scaleAndGeometryLockEn:
        "Lock industrial straight/curved proportions and engraved logo 1:1; prevent wide-angle distortion",
      skinAndMaterialLockKo:
        "메탈·세라믹·유리 고유 반사율 보존 및 공간 수직·수평 건축 라인 정렬",
      skinAndMaterialLockEn:
        "Preserve metal, ceramic & glass specular roll-off and architectural vertical/horizontal alignment",
      negativeGuardrails: [
        "bent straight edges",
        "warped industrial dial",
        "gibberish engraved text",
        "cluttered background props",
      ],
      defaultProductChecklist: {
        geometry: "제품 외곽 직선·모서리 곡률·조작부 버튼 비례 100% 유지",
        label: "전면·상단 음각/인쇄 로고 철자 및 위치 1:1 고정",
        material: "브러시드 메탈·세라믹·아노다이징 알루미늄 실제 반사 질감 보존",
      },
    },
    campaignStarters: [
      {
        id: "lifestyle-object-launch",
        category: "lifestyle_object",
        badgeKo: "라이프스타일 · 오브제 런칭",
        badgeEn: "Lifestyle · Object Launch",
        titleKo: "시그니처 오브제 공간 스타일링 & 릴스 캠페인",
        titleEn: "Signature Object Spatial Styling & Reels Campaign",
        objectiveKo:
          "오브제 조형미와 공간 채광이 돋보이는 1080p 마스터 필름과 화보를 제작하고, 인테리어·라이프스타일 크리에이터 채널에 확산합니다.",
        objectiveEn:
          "Produce 1080p spatial master films and scale across interior and lifestyle creators.",
        deliverableSummaryKo: "9:16 공간 릴스 + 4:5 오브제 화보",
        deliverableSummaryEn: "9:16 Spatial Reels + 4:5 Object Stills",
        recommendedTrack: "studio_film",
      },
    ],
  },
  tech_platform: {
    category: "tech_platform",
    labelKo: "테크 · 디지털 서비스",
    labelEn: "Tech & Digital Service",
    rolePersonaKo: "프로덕트 마케터 · PM 맞춤",
    rolePersonaEn: "For Product Marketers & PMs",
    headlineKo: "서비스 사용 순간과 디바이스 화면, 런칭 캠페인 영상을 또렷하게 제작합니다",
    headlineEn: "Crisp device frames, real-world usage scenes, and product launch films",
    scenes: [
      {
        id: "product",
        titleKo: "디바이스 · 화면 단독 컷",
        titleEn: "Device & Screen Hero",
        descKo: "데스크·스튜디오 위 디바이스와 선명한 화면 구도",
        descEn: "Clean device hardware and screen composition",
        placeholderKo:
          "예: 정갈한 화이트 데스크 위 스마트폰·노트북 화면이 왜곡 없이 또렷하게 보이는 정면 컷",
        placeholderEn:
          "e.g. Smartphone and laptop on a clean white desk with undistorted screen geometry",
        quickPromptsKo: [
          "프렌치 블루 톤 데스크 위 디바이스 정면 실루엣과 정갈한 여백",
          "미니멀 스튜디오 단상 위 하드웨어 측면 림라이트 정물 컷",
          "자연광 창가 데스크 위 태블릿·스마트폰 멀티 디바이스 구도",
        ],
        quickPromptsEn: [
          "Device front silhouette on French-blue toned desk with clean negative space",
          "Hardware profile with subtle rim light on minimalist studio plinth",
          "Multi-device tablet and phone layout on sunlit window desk",
        ],
        cutKind: "reference_exact_product",
        medium: "product still",
        defaultAspect: "4:5",
        focalMm: 85,
      },
      {
        id: "texture",
        titleKo: "인터랙션 · 손끝 디테일",
        titleEn: "Interaction & Tactile Macro",
        descKo: "화면을 터치하거나 디바이스를 조작하는 클로즈업",
        descEn: "Close-up of finger touch interaction and hardware finish",
        placeholderKo:
          "예: 한 손으로 스마트폰을 쥐고 화면을 부드럽게 스와이프하는 순간 클로즈업",
        placeholderEn:
          "e.g. Close-up of holding the smartphone in one hand and swiping smoothly",
        quickPromptsKo: [
          "자연광 아래 스마트폰 화면을 한 손으로 터치하는 손끝 클로즈업",
          "디바이스 메탈 베젤 모서리와 글래스 표면 반사광 매크로 컷",
          "키보드 타이핑과 트랙패드 제스처가 어우러진 워크스페이스 디테일",
        ],
        quickPromptsEn: [
          "Sunlit close-up of thumb touching smartphone screen",
          "Macro of device metal bezel edge and glass specular reflection",
          "Workspace detail of keyboard typing and trackpad gesture",
        ],
        cutKind: "logo_mark_preserve",
        medium: "product still",
        defaultAspect: "1:1",
        focalMm: 85,
      },
      {
        id: "wearing",
        titleKo: "일상 사용 · 인물 컷",
        titleEn: "Real-Life Usage Scene",
        descKo: "일상 공간에서 서비스를 자연스럽게 쓰는 인물 화보",
        descEn: "Authentic human moment using the service in daily life",
        placeholderKo:
          "예: 채광 좋은 카페 창가에서 스마트폰으로 서비스를 확인하며 미소 짓는 자연스러운 인물 컷",
        placeholderEn:
          "e.g. Natural portrait by a sunlit cafe window checking the app on a smartphone",
        quickPromptsKo: [
          "오전 채광이 들어오는 라운지에서 스마트폰으로 서비스를 쓰는 인물 화보",
          "도심 산책 중 이어폰을 끼고 화면을 확인하는 생동감 있는 라이프스타일 컷",
          "크리에이티브 스튜디오 데스크에서 팀원이 화면을 함께 보는 장면",
        ],
        quickPromptsEn: [
          "Portrait using the mobile service in a sunlit morning lounge",
          "Lively city walk checking the screen with earbuds",
          "Creative studio desk moment reviewing the screen together",
        ],
        cutKind: "editorial_full_body",
        medium: "editorial still",
        defaultAspect: "4:5",
        focalMm: 50,
      },
      {
        id: "video",
        titleKo: "서비스 런칭 숏폼",
        titleEn: "Product Launch Short-Form",
        descKo: "사용자 표정과 화면 인터랙션이 빠르게 연결되는 15초 영상",
        descEn: "15s launch video linking user reaction and crisp device interaction",
        placeholderKo:
          "예: 스마트폰을 켜는 손끝 클로즈업에서 시작해 사용자의 밝은 표정과 일상 공간으로 이어지는 15초 런칭 영상",
        placeholderEn:
          "e.g. 15s launch video from thumb tap close-up to user reaction and sunlit space",
        quickPromptsKo: [
          "화면 탭 클로즈업 → 인물의 직관적인 반응 → 일상 공간 와이드로 이어지는 15초 런칭 필름",
          "빠른 리듬의 3연속 사용 장면 교차 편집으로 핵심 효용을 보여주는 9:16 릴스",
          "데스크 셋업에서 시작해 모바일 사용 경험으로 자연스럽게 전환되는 15초 숏폼",
        ],
        quickPromptsEn: [
          "15s launch film: screen tap macro -> authentic user reaction -> sunlit room wide",
          "9:16 Reels intercutting 3 rapid real-world usage moments",
          "15s short-form transitioning from desk setup to mobile experience",
        ],
        cutKind: "short_film_clip",
        medium: "short film",
        defaultAspect: "9:16",
        focalMm: 50,
      },
    ],
    compiler: {
      defaultAspect: "4:5",
      defaultOledLookId: "oled-editorial-punch",
      defaultLightColourK: 5500,
      scaleAndGeometryLockKo:
        "디바이스 베젤·화면 직사각형 비례 고정 · 깨진 가상 UI 텍스트 생성 금지 · 로고 1:1 고정",
      scaleAndGeometryLockEn:
        "Lock device bezel & screen aspect ratio; forbid gibberish UI text; lock brand mark 1:1",
      skinAndMaterialLockKo:
        "글래스·알루미늄 하드웨어 질감 및 인물의 자연스러운 피부 톤(15°–40°) 유지",
      skinAndMaterialLockEn:
        "Preserve glass/aluminum hardware finish and natural human skin tone (15°–40°)",
      negativeGuardrails: [
        "gibberish screen text",
        "bent phone screen",
        "extra fingers on device",
        "neon cyberpunk clutter",
      ],
      defaultProductChecklist: {
        geometry: "디바이스 외곽 베젤 두께, 카메라 모듈 위치, 화면 직각 비례 유지",
        label: "브랜드 심볼 및 앱 아이콘·워드마크 비례 1:1 고정",
        material: "강화유리 반사광과 매트 알루미늄 바디, 자연스러운 손 피부 질감 보존",
      },
    },
    campaignStarters: [
      {
        id: "tech-creator-seeding",
        category: "tech_platform",
        badgeKo: "테크 · 앱·서비스 대량 시딩",
        badgeEn: "Tech · App & Platform Seeding",
        titleKo: "신규 기능 런칭 크리에이터 릴스·틱톡 확산 캠페인",
        titleEn: "Feature Launch Creator Reels & TikTok Seeding Campaign",
        objectiveKo:
          "핵심 사용 경험이 한눈에 보이는 1080p 포맷을 설계하고, 크리에이터들이 각자의 계정에서 동시에 게시해 오가닉 조회수와 유입을 폭발적으로 늘립니다.",
        objectiveEn:
          "Lock a high-converting 1080p usage format and scale simultaneous creator posts to drive organic reach and sign-ups.",
        deliverableSummaryKo: "9:16 사용 인증 릴스 + 16:9 런칭 필름",
        deliverableSummaryEn: "9:16 Usage Reels + 16:9 Launch Film",
        recommendedTrack: "creator_campaign",
      },
    ],
  },
};

export function inferBrandCategoryFromName(name?: string | null): BrandClientCategory {
  const normalized = (name ?? "").trim().toLowerCase();
  if (!normalized) return "fashion_apparel";
  if (
    /beauty|aura|serum|skin|cosmetic|glow|뷰티|코스메틱|세럼|스킨/.test(
      normalized
    )
  ) {
    return "beauty_skincare";
  }
  if (
    /roast|coffee|cafe|matcha|food|dining|kitchen|bakery|tea|brew|다이닝|로스터|카페|커피|베이커리|식품/.test(
      normalized
    )
  ) {
    return "fnb_hospitality";
  }
  if (
    /living|object|home|furniture|ceramic|chair|lamp|fragrance|perfume|maison|kaiper|리빙|오브제|가구|홈|향수/.test(
      normalized
    )
  ) {
    return "lifestyle_object";
  }
  if (
    /tech|ai|app|cloud|labs|digital|software|platform|saas|테크|플랫폼|앱/.test(
      normalized
    )
  ) {
    return "tech_platform";
  }
  return "fashion_apparel";
}

export function inferBrandCategoryFromWorkspace(input: {
  category?: BrandClientCategory | string | null;
  organizationName?: string | null;
  checklist?: readonly string[] | null;
  memoryPayloads?: ReadonlyArray<Record<string, unknown>> | null;
}): BrandClientCategory {
  if (
    input.category &&
    (BRAND_CLIENT_CATEGORIES as readonly string[]).includes(input.category)
  ) {
    return input.category as BrandClientCategory;
  }
  if (input.memoryPayloads) {
    for (const payload of input.memoryPayloads) {
      const memCat =
        typeof payload?.category === "string" ? payload.category : null;
      if (
        memCat &&
        (BRAND_CLIENT_CATEGORIES as readonly string[]).includes(memCat)
      ) {
        return memCat as BrandClientCategory;
      }
    }
  }
  if (input.checklist && input.checklist.length > 0) {
    const joined = input.checklist.join(" ").toLowerCase();
    if (
      /세럼|스포이드|프로스티드|유리 굴절|수분|코스메틱|앰플|크림|serum|dropper|frosted|cosmetic|skincare/.test(
        joined
      )
    ) {
      return "beauty_skincare";
    }
    if (
      /콜드브루|슬리브|결로|식재료|로스터|다이닝|유약|커피|라떼|coldbrew|roast|condensation|ceramic|dining/.test(
        joined
      )
    ) {
      return "fnb_hospitality";
    }
    if (
      /디바이스|베젤|강화유리|알루미늄 바디|앱 아이콘|화면 직각|device|bezel|screen|saas/.test(
        joined
      )
    ) {
      return "tech_platform";
    }
    if (
      /오브제|가구|도자기|조명 기구|디퓨저|향수|furniture|ceramic|fragrance|object/.test(
        joined
      )
    ) {
      return "lifestyle_object";
    }
    if (
      /지퍼|재킷|팬츠|나일론|원단|스냅 버튼|직조 라벨|칼라 구조|jacket|zipper|nylon|garment|cargo/.test(
        joined
      )
    ) {
      return "fashion_apparel";
    }
  }
  return inferBrandCategoryFromName(input.organizationName);
}

export function resolveCategoryExperienceProfile(
  categoryOrInput?:
    | BrandClientCategory
    | string
    | null
    | {
        category?: BrandClientCategory | string | null;
        organizationName?: string | null;
        checklist?: readonly string[] | null;
        memoryPayloads?: ReadonlyArray<Record<string, unknown>> | null;
      },
  fallbackOrgName?: string | null
): CategoryExperienceProfile {
  if (typeof categoryOrInput === "object" && categoryOrInput !== null) {
    return PROFILES[inferBrandCategoryFromWorkspace(categoryOrInput)];
  }
  if (
    categoryOrInput &&
    (BRAND_CLIENT_CATEGORIES as readonly string[]).includes(categoryOrInput)
  ) {
    return PROFILES[categoryOrInput as BrandClientCategory];
  }
  return PROFILES[inferBrandCategoryFromName(fallbackOrgName)];
}

export function listCategoryExperienceProfiles(): readonly CategoryExperienceProfile[] {
  return BRAND_CLIENT_CATEGORIES.map((c) => PROFILES[c]);
}
