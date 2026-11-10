/**
 * Morphic & Video-Creator Production Playbook for TWINGS Personal Side (2026-11-05)
 *
 * Distilled from 33+ real creator deliveries and revision loops under `D:\dev\Video-Creator`:
 * - `2026-11-03-brandazine-01a195e5` (Night Red Carpet Press Arrival — 18 creators, including
 *   `@love__coc0` 윤슬지 v3 black dress + passthrough crop, `@minach0ii` 최미나 head/neck crop for
 *   slender arm silhouette, `@princess__ej` 정은지 v3 mole removal + sleek low bun sync)
 * - `2026-11-01-90s-interview-batch` (1994 Apgujeong Street Interview — understated lip-sync & daily makeup lock)
 * - `2026-10-29-fashion-runway-template` & `2026-11-01-twings-runway-remix` (Grounded on-set shadow integration,
 *   bare ear continuity, invisible-mannequin/neck-down outfit swap, strict No-BGM live runway Foley)
 * - `2026-11-05-twings-collagen-sheet` (CIELAB de-blush bare-skin preservation & close-mic ASMR skincare Foley)
 * - `2026-10-27-bridal-5shots-reverse` (Americano Living Skin Contract — low specular-to-diffuse ratio,
 *   banning "porcelain skin" plastic hotspots)
 */

export const GEMINI_DIRECTOR_THINKING_LEVEL = 'HIGH' as const;

export interface DirectorModelArchitectureDecision {
  personalModificationModel: 'gemini-3.8-flash';
  personalThinkingLevel: 'HIGH';
  b2bBrandDirectorModel: 'argon';
  isFlashHighSufficientForPersonal: true;
  personalTemplateDirector: {
    model: 'gemini-3.8-flash';
    thinkingLevel: 'HIGH';
  };
  b2bBrandDirector: {
    model: 'argon';
  };
  rationaleKo: readonly string[];
  rationaleEn: readonly string[];
}

/**
 * Architectural decision answering why `gemini-3.8-flash` (`thinkingLevel: 'HIGH'`) is sufficient
 * and optimal for the TWINGS Personal Side, while `Argon` is reserved for B2B Brand Studio.
 */
export const DIRECTOR_MODEL_ARCHITECTURE_DECISION: DirectorModelArchitectureDecision = {
  personalModificationModel: 'gemini-3.8-flash',
  personalThinkingLevel: 'HIGH',
  b2bBrandDirectorModel: 'argon',
  isFlashHighSufficientForPersonal: true,
  personalTemplateDirector: {
    model: 'gemini-3.8-flash',
    thinkingLevel: 'HIGH'
  },
  b2bBrandDirector: {
    model: 'argon'
  },
  rationaleKo: [
    '개인 사이드 템플릿은 카메라 구도·컷 리듬·조명 설계가 이미 마스터 프롬프트에 고정되어 있어, 수정 단계에서는 슬롯별 의도 추출(의상·메이크업·헤어·소품·표정)과 사진 검수(가림·소매 부피·광각 왜곡·헤어 동기화)가 핵심입니다.',
    '실제 모픽(Morphic) 캠페인 18인 제작 파이프라인(optical_identity_engine.py)에서도 gemini-3.8-flash (HIGH thinking)가 다중 셀카 중 최적의 정면 앵커 선정, 3:4 크롭 좌표 계산, 헤어/의상 슬롯 동기화를 완벽히 수행했습니다.',
    'gemini-3.8-flash (HIGH)는 멀티모달 이미지 검수와 컷별 프롬프트 치환을 1.5~2.5초 내에 처리하여 개인 유저 체감 속도와 6% 마진 구조를 동시에 지키며, 무거운 멀티턴 브랜드 디렉터 모델(Argon)은 B2B 브랜드 캠페인 설계에만 집중시키는 것이 가장 효율적입니다.'
  ],
  rationaleEn: [
    'Personal templates already lock camera choreography, cut timing, and lighting, so modification requires high-precision multimodal photo inspection and slot-level rewrite rather than open-ended campaign planning.',
    'Proven in the 18-creator Morphic production pipeline (optical_identity_engine.py), gemini-3.8-flash with HIGH thinking accurately detects 24mm barrel distortion, wide-sleeve silhouette bleed, and hairstyle continuity.',
    'gemini-3.8-flash (HIGH) delivers ~2s latency and protects unit economics on personal renders, while Argon remains dedicated to B2B Brand Studio direction.'
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

export const PERSONAL_NO_BGM_AUDIO_NOTICE_KO =
  '인스타그램·틱톡 업로드 시 원하는 음악을 바로 입히실 수 있도록, 배경음악(BGM) 없이 현장 효과음과 자연스러운 사운드만 담아 제작됩니다.' as const;

export const PERSONAL_NO_BGM_AUDIO_NOTICE_EN =
  'Created with natural sound effects and ambient audio only (no background music), so you can easily add your own music on Instagram or TikTok.' as const;

export interface ApprovedVideoProductionLaw {
  id:
    | 'zero_distortion_passthrough_crop'
    | 'optical_50_85mm_distance'
    | 'headneck_crop_against_wide_sleeves'
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
    id: 'headneck_crop_against_wide_sleeves',
    titleKo: '넓은 소매·두꺼운 외투 사진의 팔뚝 부피 번짐 차단',
    titleEn: 'Slim Arm & Shoulder Protection Against Bulky Selfie Clothes',
    customerTipKo:
      '올리신 셀카에서 퍼프 소매나 품이 넓은 옷을 입고 있어도 영상에서 팔이나 어깨가 두꺼워 보이지 않도록 얼굴·목선만 깔끔하게 분리해 슬림한 실루엣으로 연출합니다.',
    customerTipEn:
      'Even if your photo has puffy sleeves or bulky outerwear, we isolate your face and neck so your arms and shoulders look slender in the video.',
    compilerDirectiveEn:
      'Strictly ignore any wide blouse sleeves, puffy shoulders, or bulky outerwear from @Image 1 (tight head-and-neck identity extraction); render @Image 1 with an overall petite, slender, graceful physique, slim toned arms, and delicate collarbones.'
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
    titleKo: '번들거림·원치 않는 점 없는 맑은 매트 새틴 피부결',
    titleEn: 'Clean Matte-Satin Skin Without Plastic Glare or Random Moles',
    customerTipKo:
      '플래시 조명 아래에서도 이마나 코끝이 플라스틱처럼 번들거리거나 원래 없던 점·잡티가 생기지 않도록 깨끗하고 보송한 피부결로 표현합니다.',
    customerTipEn:
      'Keeps skin clean and matte-satin under bright lights without plastic forehead glare or unintended moles and blemishes.',
    compilerDirectiveEn:
      'Render a clean, youthful matte-satin fair complexion faithful to @Image 1 with a very low specular-to-diffuse ratio (zero freckles, zero unintended moles or dark cheek spots, zero glossy white forehead bands, and zero aging pore exaggeration).'
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
    labelKo: '팔뚝·어깨 라인 슬림하고 여리여리하게 고정',
    labelEn: 'Keep Arms & Shoulders Slender',
    userSymptomKo: '셀카에 찍힌 넓은 블라우스 소매나 외투 때문에 민소매·드레스 컷에서 팔이 두꺼워 보일 때',
    userSymptomEn: 'When wide sleeves in your selfie make your arms look thick in sleeveless or dress shots',
    howWeSolveKo:
      '셀카 속 소매 부피가 영상 체형에 영향을 주지 않도록 얼굴·목만 분리하고 슬림한 여배우 체형 비율로 고정합니다.',
    howWeSolveEn:
      'Strips wide sleeve volume from your selfie and locks a slender, graceful shoulder and arm silhouette.',
    sampleRequestKo:
      '내 사진 속 넓은 소매 옷 부피는 무시하고, 어깨선과 팔 라인이 슬림하고 여리여리한 비율로 나오게 해주세요.',
    sampleRequestEn:
      'Ignore the wide sleeve volume from my selfie and keep my shoulders, collarbones, and arms slender and graceful.',
    compilerRuleEn:
      'Apply tight head-and-neck crop authority on @Image 1; strip original wide sleeves/blouse volume and enforce an overall petite, slender, graceful actress physique with slim toned arms and delicate collarbones.'
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
 * Deterministic post-processor that guarantees every rewritten or compiled personal video prompt
 * enforces the Morphic production guardrails + Universal Personal No-BGM Audio Rule.
 */
export function enforcePersonalMorphicGuardrails(
  rawPrompt: string,
  options: {
    hasPersonSlot: boolean;
    hasOutfitSlot?: boolean;
    hasLookReferenceSlot?: boolean;
    hasSlenderArmLock?: boolean;
    preserveExistingLipSyncAudio?: boolean;
  }
): string {
  let out = rawPrompt.trim();

  // 1. Strip any accidental "porcelain skin" or "visible pores" tokens that cause plastic glare or aging/mole artifacts, and strip BGM phrases
  out = out
    .replace(/\bfair\s+porcelain\s+skin\b/gi, 'clean matte-satin fair complexion')
    .replace(/\bporcelain\s+skin\b/gi, 'matte-satin living skin finish')
    .replace(/\bdewy\s+glass[- ]skin\b/gi, 'clean natural skin finish')
    .replace(/\bwith\s+background\s+music(?:\s+and\s+upbeat\s+soundtrack)?\b/gi, 'with natural ambient on-site audio only')
    .replace(/\bupbeat\s+soundtrack\b/gi, 'natural ambient sound');

  // 2. When an outfit slot (@Image 2 / look_ref) is present, ensure neck-down isolation is explicitly stated
  if (
    (options.hasOutfitSlot || options.hasLookReferenceSlot) &&
    !out.toLowerCase().includes('neck-down') &&
    !out.toLowerCase().includes('ignore @image 2')
  ) {
    out = `${out}\n\nNECK-DOWN GARMENT LOCK: Use the outfit reference strictly for neck-down garment silhouette, fabric, and color; ignore any chin, lips, or face at the top edge of the outfit photo.`;
  }

  // 3. When slender arm lock is active, enforce tight head-and-neck sleeve isolation
  if (options.hasSlenderArmLock && !out.toLowerCase().includes('slender silhouette lock')) {
    out = `${out}\n\nSLENDER SILHOUETTE LOCK: Ignore any wide blouse or puff sleeves from @Image 1 and maintain naturally slender shoulders, collarbones, and slim toned arms (no random moles or blemishes on face or neck).`;
  }

  // 4. Enforce Universal Personal No-BGM Audio Rule unless the template uses immutable master lip-sync audio (@audio1)
  const hasImmutableAudioRef = /@audio\s*1/i.test(out);
  if (
    !options.preserveExistingLipSyncAudio &&
    !hasImmutableAudioRef &&
    !out.toLowerCase().includes('no background music') &&
    !out.toLowerCase().includes('no-bgm')
  ) {
    out = `${out}\n\n${PERSONAL_NO_BGM_AUDIO_CONTRACT_EN}`;
  }

  return out;
}
