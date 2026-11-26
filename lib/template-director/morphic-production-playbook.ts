/**
 * Morphic & Video-Creator Production Playbook for TWINGS Personal Side (2026-11-05; SOTA bridge update 2026-11-26)
 *
 * Distilled from 33+ studio deliveries and revision loops under `D:\dev\Video-Creator`:
 * - Night Red Carpet Press Arrival (a delivery to eighteen creators — passthrough 3:4 distance framing,
 *   sleek low bun sync, and clean daily complexion rules)
 * - `2026-11-01-90s-interview-batch` (1994 Apgujeong Street Interview — understated lip-sync & daily makeup lock)
 * - `2026-10-29-fashion-runway-template` & `2026-11-01-twings-runway-remix` (Grounded on-set shadow integration,
 *   bare ear continuity, invisible-mannequin/neck-down outfit swap, strict No-BGM live runway Foley)
 * - `2026-11-05-twings-collagen-sheet` (CIELAB de-blush bare-skin preservation & close-mic ASMR skincare Foley)
 * - `2026-10-27-bridal-5shots-reverse` (Still vs. Seedance 2.5 video skin split: still-image local edits keep
 *   excluding pore emphasis, while Seedance 2.5 video uses the 1-stop underexposed 35mm formula with visible
 *   micro-pores and fine stray flyaway hairs to stop highlight clipping and temporal smoothing; 3:4 distance
 *   framing replaces close-up headshot crops and handles wide sleeve volume via one Reference-authority sentence)
 */

import type { PersonalAudioMode, PersonalBgmMood } from './schema';

export const GEMINI_DIRECTOR_THINKING_LEVEL = 'HIGH' as const;

export interface DirectorModelArchitectureDecision {
  personalModificationModel: 'gemini-4-hydrogen';
  personalThinkingLevel: 'HIGH';
  b2bBrandDirectorModel: 'argon';
  isFlashHighSufficientForPersonal: true;
  personalTemplateDirector: {
    model: 'gemini-4-hydrogen';
    thinkingLevel: 'HIGH';
  };
  b2bBrandDirector: {
    model: 'argon';
  };
  rationaleKo: readonly string[];
  rationaleEn: readonly string[];
}

/**
 * Architectural decision answering why `gemini-4-hydrogen` (`thinkingLevel: 'HIGH'`) is sufficient
 * and optimal for the TWINGS Personal Side, while `Argon` is reserved for B2B Brand Studio.
 */
export const DIRECTOR_MODEL_ARCHITECTURE_DECISION: DirectorModelArchitectureDecision = {
  personalModificationModel: 'gemini-4-hydrogen',
  personalThinkingLevel: 'HIGH',
  b2bBrandDirectorModel: 'argon',
  isFlashHighSufficientForPersonal: true,
  personalTemplateDirector: {
    model: 'gemini-4-hydrogen',
    thinkingLevel: 'HIGH'
  },
  b2bBrandDirector: {
    model: 'argon'
  },
  rationaleKo: [
    '개인 사이드 템플릿은 카메라 구도·컷 리듬·조명 설계가 이미 마스터 프롬프트에 고정되어 있어, 수정 단계에서는 슬롯별 의도 추출(의상·메이크업·헤어·소품·표정)과 사진 검수(가림·소매 부피·광각 왜곡·헤어 동기화)가 핵심입니다.',
    '실제 모픽(Morphic) 캠페인 18인 제작 파이프라인(optical_identity_engine.py)에 이어 Gemini 4 세대 고효율 모델인 gemini-4-hydrogen (HIGH thinking)으로 상향하여 다중 셀카 정면 앵커 선정, 3:4 크롭 좌표 계산, 헤어/의상 슬롯 동기화 정밀도를 높였습니다.',
    'gemini-4-hydrogen (HIGH)은 3.8 Flash 대비 더 빠른 응답 속도와 높은 멀티모달 추론 정확도로 개인 유저 체감 속도와 마진 구조를 동시에 지키며, 무거운 멀티턴 브랜드 디렉터 모델(Argon)은 B2B 브랜드 캠페인 설계에만 집중시키는 것이 가장 효율적입니다.'
  ],
  rationaleEn: [
    'Personal templates already lock camera choreography, cut timing, and lighting, so modification requires high-precision multimodal photo inspection and slot-level rewrite rather than open-ended campaign planning.',
    'Upgraded from the 18-creator Morphic production pipeline baseline to Gemini 4 high-efficiency gemini-4-hydrogen with HIGH thinking for sharper detection of 24mm barrel distortion, wide-sleeve silhouette bleed, and hairstyle continuity.',
    'gemini-4-hydrogen (HIGH) delivers faster latency and frontier-grade multimodal precision while protecting unit economics on personal renders, keeping Argon dedicated to B2B Brand Studio direction.'
  ]
} as const;

/**
 * Universal Personal Audio Principle (Founder Decision, 2026-11-05):
 * Personal users upload their videos to Instagram Reels / TikTok / YouTube Shorts and attach
 * trending music inside the social app. Baked-in background music clashes with user-selected tracks.
 * Therefore, TWINGS Personal Side strictly forbids BGM and generates ONLY natural on-site ambient sound & Foley/SFX.
 */
export const PERSONAL_NO_BGM_AUDIO_CONTRACT_EN =
  'Strict No-BGM Personal Audio Rule: Generate ONLY natural on-site ambient room/street tone and realistic physical Foley/SFX (footsteps, fabric movement, camera shutters, mist spray, object handling, and natural lip-sync speech when applicable). Strictly NO background music, NO musical score, NO BGM, NO beats, NO drums, NO synth pads, NO melody, and NO song.' as const;

export const PERSONAL_BGM_MOOD_PROMPTS: Record<PersonalBgmMood, string> = {
  cinematic: 'subtle lush cinematic atmospheric strings and warm analog pad score matched to the camera pacing',
  trendy_beat: 'crisp modern editorial bassline and minimalist rhythmic groove aligned softly with visual cuts',
  calm_mood: 'warm delicate ambient acoustic piano and airy textures breathing smoothly under room acoustics',
};

export function personalSceneBgmAudioContractEn(mood?: PersonalBgmMood | null): string {
  const moodDesc = PERSONAL_BGM_MOOD_PROMPTS[mood ?? 'cinematic'];
  return `Cohesive Scene BGM Audio Rule: Generate cohesive ${moodDesc} integrated naturally alongside crisp ambient Foley and clear spoken dialogue without overpowering voices, with clean studio mix continuity and zero harsh clipping.`;
}

export const PERSONAL_NO_BGM_AUDIO_NOTICE_KO =
  '인스타그램·틱톡 업로드 시 원하는 음악을 바로 입히실 수 있도록, 배경음악(BGM) 없이 현장 효과음과 자연스러운 사운드만 담아 제작됩니다.' as const;

export const PERSONAL_NO_BGM_AUDIO_NOTICE_EN =
  'Created with natural sound effects and ambient audio only (no background music), so you can easily add your own music on Instagram or TikTok.' as const;

export interface ApprovedVideoProductionLaw {
  id:
    | 'zero_distortion_passthrough_crop'
    | 'optical_50_85mm_distance'
    | 'distance_3x4_bustup_and_sleeve_authority'
    | 'neck_down_outfit_reference_crop'
    | 'americano_matte_satin_zero_mole_skin'
    | 'dynamic_hair_and_grounded_shadow_sync';
  titleKo: string;
  titleEn: string;
  /** Customer-friendly explanation (zero internal jargon) */
  customerTipKo: string;
  customerTipEn: string;
  /** Server-only production rule applied by the prompt compiler */
  compilerDirectiveEn: string;
}

/**
 * The 6 empirical laws distilled from approved Morphic campaign videos and creator revision rounds.
 */
export const MORPHIC_APPROVED_VIDEO_LAWS: readonly ApprovedVideoProductionLaw[] = [
  {
    id: 'zero_distortion_passthrough_crop',
    titleKo: 'AI 얼굴 재합성 없는 원본 사진 직결 원칙',
    titleEn: 'Zero-Distortion Original Photo Passthrough',
    customerTipKo:
      '가림이나 심한 보정이 없는 깨끗한 정면 사진은 AI로 얼굴을 다시 그리지 않고 원본 사진 그대로 사용하여 지인이 봐도 바로 알아보는 닮음새를 지킵니다.',
    customerTipEn:
      'Clean front photos are used directly without generative face re-synthesis so your real facial proportions stay 100% recognizable.',
    compilerDirectiveEn:
      'Preserve 100% of @Image 1 original facial bone structure, eye spacing, double-eyelid crease, nasal bridge/tip width, philtrum length, and mouth corners via passthrough optical crop without generative facial re-synthesis.'
  },
  {
    id: 'optical_50_85mm_distance',
    titleKo: '팔을 뻗거나 남이 찍어준 정면·반측면 거리감',
    titleEn: 'Natural Arm’s-Length or Portrait Distance',
    customerTipKo:
      '카메라를 얼굴에 너무 가까이 대고 찍은 초근접 셀카보다, 한 걸음 떨어져 찍거나 남이 찍어준 정면 상반신 사진에서 콧대와 얼굴형이 가장 예쁘게 나옵니다.',
    customerTipEn:
      'Photos taken at arm’s length or by someone else avoid close-up lens distortion and keep your nose and jawline natural in motion.',
    compilerDirectiveEn:
      'Avoid 24mm ultra-close wide-angle barrel distortion on facial features; render @Image 1 with natural 50-85mm portrait lens facial compression and balanced mid-face proportions.'
  },
  {
    id: 'distance_3x4_bustup_and_sleeve_authority',
    titleKo: '3:4 거리감 바스트업 & 넓은 소매·상의 부피 분리 원칙',
    titleEn: '3:4 Distance Bust-Up Framing & Sleeve Volume Separation',
    customerTipKo:
      '정수리 위 12~16% 여백과 좌우 여백, 목·쇄골·어깨·상반신이 함께 보이는 3:4 거리감 구도(머리 높이 32~42%)를 유지하고, 얼굴만 60~85% 채우는 과도한 클로즈업은 제한합니다. 셀카의 넓은 소매나 두꺼운 상의 부피는 크롭이 아닌 지시 문구로 분리합니다.',
    customerTipEn:
      'Keep a 3:4 distance bust-up framing (head height 32–42% of frame height, 12–16% headroom above the crown, side margins, neck, collarbone, shoulders, and upper body; close-up headshots filling 60–85% of the frame are banned). Wide sleeves or casual top volume are handled in prompt authority instead of cropping.',
    compilerDirectiveEn:
      'Keep @Image 1 in a 3:4 distance bust-up framing (head height 32–42% of frame height, 12–16% headroom above the crown, side margins, neck, collarbone, shoulders, and upper body in frame). Close-up headshot crops where the face fills 60–85% of the frame are banned because they make the head read too large. State once in Reference authority and Exclusions (never repeated per shot): ignore any wide casual top/sleeve volume from @Image 1; render a slender, graceful physique without cropping the upper body.'
  },
  {
    id: 'neck_down_outfit_reference_crop',
    titleKo: '의상 사진 속 모델 얼굴 섞임 0% 차단',
    titleEn: 'Zero Facial Bleed from Outfit Reference Photos',
    customerTipKo:
      '입고 싶은 옷 사진을 올리실 때 옷 모델의 턱이나 입술이 조금 나와 있어도, 의상 부분만 분리해 내 얼굴 인상에 전혀 섞이지 않게 보호합니다.',
    customerTipEn:
      'When you upload an outfit photo, we isolate only the neck-down garment so another model’s chin or lips never blend into your face.',
    compilerDirectiveEn:
      'Treat @Image 2 strictly as a neck-down garment and jewelry authority; completely ignore any visible chin, lips, neck, or skin tone at the top edge of @Image 2 so it has 0% influence on @Image 1 facial identity.'
  },
  {
    id: 'americano_matte_satin_zero_mole_skin',
    titleKo: '정지 이미지 무모공 · 영상 35mm 언더 노출 매트-새틴 피부결 분리 원칙',
    titleEn: 'Still vs. Video Skin & Underexposed 35mm Matte-Satin Rule',
    customerTipKo:
      '정지 이미지 부분 보정에서는 모공 강조를 피하고, 영상에서는 1스톱 언더 노출과 자연스러운 매트-새틴 피부결·미세 결·잔머리 표현으로 플래시 하이라이트 클리핑과 플라스틱 질감을 막습니다.',
    customerTipEn:
      'Still-image local edits keep excluding pore emphasis, while video uses slightly underexposed 35mm film contrast with matte-satin micro-texture and fine stray hairs so skin never clips or turns plastic.',
    compilerDirectiveEn:
      'Still-image local edits keep excluding pore emphasis to prevent static portrait aging. For Seedance 2.5 video, apply once in Visual style (never per shot) to stop highlight clipping and temporal smoothing: looking like scanned, slightly underexposed 35mm film: soft contrast, cool lifted blacks (#14171C), fine organic grain, gentle halation on the brightest whites; one soft key light a stop under; skin stays natural and warm, unretouched matte-satin with visible micro-pores and fine stray flyaway hairs, never over-lit or glossy, with no blush.'
  },
  {
    id: 'dynamic_hair_and_grounded_shadow_sync',
    titleKo: '내 헤어스타일 전 컷 유지 & 현장 조명 그림자 밀착',
    titleEn: 'Consistent Hairstyle Across Cuts & Natural Scene Lighting',
    customerTipKo:
      '로우번(묶은 머리), 단발, 시스루뱅 등 내 사진 속 머리 모양이 컷마다 바뀌지 않게 끝까지 유지하고, 공간의 조명과 그림자가 얼굴에 자연스럽게 어우러지게 합니다.',
    customerTipEn:
      'Locks your exact hairstyle (updo, bob, bangs, or long hair) across every cut and grounds facial lighting naturally in the scene.',
    compilerDirectiveEn:
      'Synchronize every timeline shot description to @Image 1 exact hairstyle (whether tied-back low bun, chin-length bob, wispy bangs, or long hair) and integrate directional venue lighting and shadow falloff on @Image 1 face so it never looks flat front-lit or pasted on.'
  }
] as const;

export interface ModificationExecutionPattern {
  id:
    | 'outfit_swap_with_photo'
    | 'silhouette_slim_arm_lock'
    | 'makeup_daily_clean_deblush'
    | 'hair_updo_or_bangs_lock'
    | 'expression_calm_lower_face';
  labelKo: string;
  labelEn: string;
  userSymptomKo: string;
  userSymptomEn: string;
  howWeSolveKo: string;
  howWeSolveEn: string;
  sampleRequestKo: string;
  sampleRequestEn: string;
  compilerRuleEn: string;
}

/**
 * Concrete modification execution patterns learned from real creator revision requests.
 */
export const MORPHIC_MODIFICATION_PLAYBOOK: readonly ModificationExecutionPattern[] = [
  {
    id: 'outfit_swap_with_photo',
    labelKo: '원하는 의상 사진 그대로 갈아입히기',
    labelEn: 'Swap to My Uploaded Outfit Photo',
    userSymptomKo: '기본 템플릿 의상이나 목 스카프 대신 내가 원하는 드레스·자켓을 입고 싶을 때',
    userSymptomEn: 'When you want to wear your own dress or jacket instead of the default template outfit',
    howWeSolveKo:
      '올리신 의상 사진에서 옷 실루엣과 소재만 추출해 전 컷에 입히고, 기본 의상·목 스카프는 완전히 제거합니다.',
    howWeSolveEn:
      'Extracts only the neck-down garment silhouette and fabric from your outfit photo and replaces the default wardrobe across every cut.',
    sampleRequestKo:
      '기본 의상과 목 스카프는 빼고, 첨부한 블랙 드레스 사진 디자인 그대로 전 컷 동일하게 입혀주세요.',
    sampleRequestEn:
      'Remove the default outfit and neck scarf, and dress me in the exact black dress from my attached outfit photo across every shot.',
    compilerRuleEn:
      'Replace all default garment tokens in every shot with @Image 2 neck-down wardrobe; add all replaced default garments and neck scarves to [Exclusions].'
  },
  {
    id: 'silhouette_slim_arm_lock',
    labelKo: '팔뚝·어깨 라인 슬림하고 자연스럽게 고정',
    labelEn: 'Keep Arms & Shoulders Slender',
    userSymptomKo: '셀카에 찍힌 넓은 블라우스 소매나 외투 때문에 민소매·드레스 컷에서 팔이 두꺼워 보일 때',
    userSymptomEn: 'When wide sleeves in your selfie make your arms look thick in sleeveless or dress shots',
    howWeSolveKo:
      '얼굴만 60~85% 채우는 크롭 대신 정수리 위 12~16% 여백과 목·쇄골·어깨·상반신이 보이는 3:4 거리감 구도(머리 높이 32~42%)를 유지하고, 상의 소매 부피 차단은 레퍼런스 권한과 제외 규칙에 한 번만 선언해 슬림한 실루엣을 유지합니다.',
    howWeSolveEn:
      'Preserves 3:4 distance framing (head height 32–42% of frame height, 12–16% headroom, neck, collarbone, shoulders, and upper body; 60–85% headshot crops banned) and strips wide sleeve volume once in Reference authority and Exclusions rather than cropping.',
    sampleRequestKo:
      '내 사진 속 넓은 소매 옷 부피는 무시하고, 어깨선과 팔 라인이 슬림한 비율로 나오게 해주세요.',
    sampleRequestEn:
      'Ignore the wide sleeve volume from my selfie and keep my shoulders, collarbones, and arms slender and graceful.',
    compilerRuleEn:
      'Keep @Image 1 in a 3:4 distance bust-up framing (head height 32–42% of frame height, 12–16% headroom above the crown, side margins, neck, collarbone, shoulders, and upper body in frame; close-up headshot crops filling 60–85% of the frame are banned). Declare once in Reference authority and Exclusions (never repeated per shot): ignore any wide casual top/sleeve volume from @Image 1, and maintain a slender, graceful physique with slim toned arms and delicate collarbones.'
  },
  {
    id: 'makeup_daily_clean_deblush',
    labelKo: '진한 화장·핑크기 빼고 내 평소 데일리 메이크업 유지',
    labelEn: 'Keep My Clean Daily Makeup & Complexion',
    userSymptomKo: '템플릿의 스모키 화장이나 강한 볼터치·점 표현 때문에 내 원래 순한 인상과 달라 보일 때',
    userSymptomEn: 'When heavy template makeup, blush, or spots make you look different from your usual self',
    howWeSolveKo:
      '인위적인 핑크 블러셔·진한 아이섀도우·불필요한 얼굴 점을 모두 차단하고, 내 사진 속 맑고 깨끗한 피부톤과 데일리 메이크업을 유지합니다.',
    howWeSolveEn:
      'Removes heavy smoky makeup, pink blush, and unintended moles while keeping your clean daily makeup and bright skin tone.',
    sampleRequestKo:
      '진한 눈화장이나 볼터치 없이 내 사진 속 깔끔한 데일리 메이크업과 잡티·점 없는 맑은 피부결로 유지해 주세요.',
    sampleRequestEn:
      'Keep my clean daily makeup and blemish-free matte-satin skin from my photo without heavy eye makeup, pink blush, or moles.',
    compilerRuleEn:
      'Override template heavy makeup with @Image 1 clean daily eye/brow styling, blemish-free matte-satin fair complexion (zero freckles, zero unintended moles, zero pink blush), and natural muted lip tone.'
  },
  {
    id: 'hair_updo_or_bangs_lock',
    labelKo: '묶은 머리(로우번)·단발·앞머리 전 컷 유지 + 장식 제거',
    labelEn: 'Lock Updo, Bob, or Bangs Across All Cuts',
    userSymptomKo: '묶은 머리나 단발인데 컷이 바뀌면서 갑자기 긴 생머리로 풀리거나 귀걸이·안경이 생길 때',
    userSymptomEn: 'When tied-back hair or a short bob turns into long hair mid-video or unwanted eyewear appears',
    howWeSolveKo:
      '첫 컷부터 마지막 컷까지 내 사진의 실제 머리 스타일(로우번, 단발, 앞머리 유무)로 모든 장면을 통일하고 불필요한 안경·귀장식을 제거합니다.',
    howWeSolveEn:
      'Synchronizes every shot to your exact hairstyle (low bun, bob, or bangs) and strips unwanted glasses or ear cuffs.',
    sampleRequestKo:
      '내 사진 속 깔끔하게 묶은 머리(또는 단발·앞머리) 스타일이 중간에 풀리지 않게 끝까지 유지하고 귀걸이·안경은 빼주세요.',
    sampleRequestEn:
      'Keep my exact tied-back hair (or bob/bangs) consistent from start to finish and remove any glasses or ear ornaments.',
    compilerRuleEn:
      'Synchronize every shot in Timeline to @Image 1 exact hairstyle (do not default to long loose hair when @Image 1 has a low bun or short bob) and strip all eyeglasses, crown sunglasses, and ear cuffs.'
  },
  {
    id: 'expression_calm_lower_face',
    labelKo: '센 인상 완화 · 차분한 입 모양과 자연스러운 반미소',
    labelEn: 'Soft Half-Smile & Calm Lower-Face Motion',
    userSymptomKo: '입을 너무 크게 벌리거나 표정이 과해져서 하관과 턱선이 어색해 보일 때',
    userSymptomEn: 'When wide mouth movements or fierce expressions distort your lower face and jawline',
    howWeSolveKo:
      '입을 크게 벌리거나 정면을 노려보지 않고, 시선을 자연스럽게 스치며 부드러운 반미소를 짓도록 해 하관 닮음새를 지킵니다.',
    howWeSolveEn:
      'Keeps lip movements small and understated with a soft off-axis half-smile to protect lower-face likeness.',
    sampleRequestKo:
      '입을 크게 벌리지 않고 차분하게 미소 짓는 자연스러운 표정으로 내 원래 하관과 턱선을 지켜주세요.',
    sampleRequestEn:
      'Keep mouth movements small and calm with a gentle half-smile so my lower face and jawline stay natural.',
    compilerRuleEn:
      'Enforce calm, understated lower-face micro-acting with softly closed lips or a subtle half-smile; forbid wide toothy grins, wide-open mouth movements, or stiff passport-photo staring.'
  }
] as const;

/**
 * docs/PERSONAL-STUDIO.md §3.4.9 — the canonical wording for a buyer who keeps their own hair or makeup on a template
 * that styles it (`own` in the spec). The server writes it; nothing the customer sent becomes prompt text. Taken from
 * `hair_updo_or_bangs_lock` and `makeup_daily_clean_deblush` above, cut to the part itself: no eyewear stripping, no
 * assumed skin tone, and no blush or pink term (doctrine item 3 names none, not even negated). `{subject}` is "the
 * person" or "each person"; `{photo}` is "@Image 1" (video), "the reference photo" (image steps, whose prompt
 * `lib/renders/prompt.ts` speaks without handles) or "their own photo" (two people).
 */
export const OWN_STYLE_RULE_EN = {
  hair: "{subject}'s own hairstyle exactly as in {photo} (length, parting, bangs, colour, tied or loose) in every shot, never the template's hairstyle; do not default to long loose hair when {photo} shows a low bun or short bob",
  makeup: "{subject}'s own clean daily makeup as in {photo} (eye and brow styling, natural muted lip tone) in every shot, never the template's makeup",
} as const;

/**
 * Deterministic post-processor that guarantees every rewritten or compiled personal video prompt
 * enforces the Morphic production guardrails + Universal Personal No-BGM Audio Rule.
 */
export function enforcePersonalMorphicGuardrails(
  rawPrompt: string,
  options: {
    hasPersonSlot: boolean;
    /** docs/CAST-CATEGORIES.md §3 — who the template features; absent = `solo`, the original locks. */
    cast?: 'solo' | 'couple' | 'pet';
    hasOutfitSlot?: boolean;
    hasLookReferenceSlot?: boolean;
    hasSlenderArmLock?: boolean;
    preserveExistingLipSyncAudio?: boolean;
    audioMode?: PersonalAudioMode;
    bgmMood?: PersonalBgmMood | null;
    /**
     * docs/PERSONAL-STUDIO.md §3.3 — the template locks its sound: its own audio wording stays exactly as written
     * (no phrase replacement) and no personal audio contract is appended.
     */
    lockTemplateAudio?: boolean;
  }
): string {
  let out = rawPrompt.trim();

  // 1. Strip any accidental "porcelain skin" or "visible pores" tokens that cause plastic glare or aging/mole artifacts, and strip BGM phrases unless bgm mode is active
  out = out
    .replace(/\bfair\s+porcelain\s+skin\b/gi, 'clean matte-satin fair complexion')
    .replace(/\bporcelain\s+skin\b/gi, 'matte-satin living skin finish')
    .replace(/\bdewy\s+glass[- ]skin\b/gi, 'clean natural skin finish');

  if (options.lockTemplateAudio) {
    // The template's sound is locked: its audio wording is left as written.
  } else if (options.audioMode === 'bgm') {
    out = out
      .replace(/Strict\s+No-BGM(?:\s+Personal)?\s+Audio\s+Rule:[^\n]*/gi, '')
      .replace(/,?\s*no background music\b/gi, '')
      .replace(/\bwith natural ambient on-site audio only\b/gi, 'with natural ambient audio and balanced musical underscore');
  } else {
    out = out
      .replace(/\bwith\s+background\s+music(?:\s+and\s+upbeat\s+soundtrack)?\b/gi, 'with natural ambient on-site audio only')
      .replace(/\bupbeat\s+soundtrack\b/gi, 'natural ambient sound');
  }

  // 2. When an outfit slot (@Image 2 / look_ref) is present, ensure neck-down isolation is explicitly stated
  if (
    (options.hasOutfitSlot || options.hasLookReferenceSlot) &&
    !out.toLowerCase().includes('neck-down') &&
    !out.toLowerCase().includes('ignore @image 2')
  ) {
    out = `${out}\n\nNECK-DOWN GARMENT LOCK: Use the outfit reference strictly for neck-down garment silhouette, fabric, and color; ignore any chin, lips, or face at the top edge of the outfit photo.`;
  }

  // 2b. docs/CAST-CATEGORIES.md §3 — the solo locks speak of one person in @Image 1. A couple keeps two
  // people distinct; a pet keeps the animal exactly as photographed and is never given a human body lock.
  if (options.cast === 'couple' && !out.toLowerCase().includes('two-person lock')) {
    out = `${out}\n\nTWO-PERSON LOCK: Exactly two people. Keep each person's identity, face and hairstyle exactly as in their own photo, keep them visibly two distinct people, and never blend their features.`;
  }
  if (options.cast === 'pet' && !out.toLowerCase().includes('pet lock')) {
    out = `${out}\n\nPET LOCK: Keep the pet's species, breed, coat colour, markings and proportions exactly as in its photo; no extra animals.`;
  }

  // 3. When slender arm lock is active, preserve legacy slender-arm lock output unchanged in SB-1 (unused on live paths)
  if (options.hasSlenderArmLock && options.cast !== 'pet' && !out.toLowerCase().includes('slender silhouette lock')) {
    out = `${out}\n\nSLENDER SILHOUETTE LOCK: Ignore any wide blouse or puff sleeves from @Image 1 and maintain naturally slender shoulders, collarbones, and slim toned arms (no random moles or blemishes on face or neck).`;
  }

  // 4. Enforce Personal Audio Rule unless the template uses immutable master lip-sync audio (@audio1)
  const hasImmutableAudioRef = /@audio\s*1/i.test(out);
  if (!options.lockTemplateAudio && !options.preserveExistingLipSyncAudio && !hasImmutableAudioRef) {
    if (options.audioMode === 'bgm') {
      if (!out.toLowerCase().includes('cohesive scene bgm audio rule')) {
        out = `${out}\n\n${personalSceneBgmAudioContractEn(options.bgmMood)}`;
      }
    } else if (
      !out.toLowerCase().includes('no background music') &&
      !out.toLowerCase().includes('no-bgm')
    ) {
      out = `${out}\n\n${PERSONAL_NO_BGM_AUDIO_CONTRACT_EN}`;
    }
  }

  return out;
}
