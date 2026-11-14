import {
  BANNED_AI_BUZZWORDS,
  BANNED_PINK_MAKEUP_TERMS,
  SKIN_MATTE_CONTRACT_A10
} from '@/lib/brands/briefs/compiler';
import {
  GEMINI_DIRECTOR_THINKING_LEVEL,
  PERSONAL_NO_BGM_AUDIO_CONTRACT_EN,
  enforcePersonalMorphicGuardrails,
  personalSceneBgmAudioContractEn
} from './morphic-production-playbook';
import {
  DEFAULT_EDITORIAL_TEMPLATE_BASELINE,
  DUAL_IDENTITY_CANDIDATE_ENGINES,
  GEMINI_DIRECTOR_DEFAULT_BASE_URL,
  GEMINI_DIRECTOR_DEFAULT_MODEL,
  TEMPLATE_BASELINE_PRESETS,
  rawIdentitySimilaritySchema,
  rawOpticalIdentityMasterSchema,
  rawPhotoInspectionSchema,
  rawStage1ChatSchema,
  rawStage2RewriteSchema,
  resolveTemplateBaseline,
  type ClientDirectorTurnResponse,
  type DirectorChatTurnInput,
  type DirectorChatTurnResult,
  type DirectorConfig,
  type DirectorEditIntent,
  type DirectorRewriteInput,
  type DirectorRewriteResult,
  type DirectorSummaryChip,
  type IdentitySimilarityVerdict,
  type IdentitySimilarityVerificationInput,
  type ModelSpecificImageEngine,
  type MultiPhotoIdentityInput,
  type OpaqueCompiledPrompt,
  type OpticalIdentityMasterPlan,
  type PersonalAudioMode,
  type PersonalBgmMood,
  type PersonalDirectorSpec,
  type PhotoInspectionInput,
  type PhotoInspectionVerdict,
  type PhotoIssueCode,
  type PhotoPrecheckInput,
  type PhotoPrecheckResult,
  type RecommendedPhotoCleanup,
  type TemplateBaselineSpec
} from './schema';

const SERVER_ONLY_PROMPT_VAULT = new WeakMap<OpaqueCompiledPrompt, string>();

export const REDACTED_PROMPT_SENTINEL = '[REDACTED_SERVER_ONLY_PROMPT]' as const;

export function sealServerOnlyPrompt(rawPrompt: string): OpaqueCompiledPrompt {
  const handle: OpaqueCompiledPrompt = Object.freeze({
    __brand: 'OpaqueCompiledPrompt' as const,
    toJSON() {
      return REDACTED_PROMPT_SENTINEL;
    },
    toString() {
      return REDACTED_PROMPT_SENTINEL;
    }
  });
  SERVER_ONLY_PROMPT_VAULT.set(handle, rawPrompt);
  return handle;
}

export function unwrapServerOnlyPrompt(handle: OpaqueCompiledPrompt): string {
  const value = SERVER_ONLY_PROMPT_VAULT.get(handle);
  if (!value) {
    throw new Error('Invalid or expired OpaqueCompiledPrompt handle');
  }
  return value;
}

export function directorConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): DirectorConfig | null {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = env.GEMINI_BASE_URL?.trim().replace(/\/+$/, '') || GEMINI_DIRECTOR_DEFAULT_BASE_URL;
  const override = env.GEMINI_DIRECTOR_MODEL?.trim();
  const model =
    override && /^[a-z0-9.-]{1,60}$/i.test(override) ? override : GEMINI_DIRECTOR_DEFAULT_MODEL;
  return { apiKey, baseUrl, model };
}

export function inspectPhotoPrecheck(input: PhotoPrecheckInput): PhotoPrecheckResult {
  const minEdge = Math.min(input.width, input.height);
  const needsUpscale = minEdge < 720;
  const needsRotationFix = input.exifOrientation !== undefined && input.exifOrientation !== 1;
  return {
    needsUpscale,
    needsRotationFix,
    recommendedLocalEngine: needsUpscale ? 'seedvr2-local' : null
  };
}

const PROMPT_INJECTION_REGEX =
  /(?:ignore\s+(?:all\s+)?(?:previous|above|prior)\s+instructions|system\s*prompt|base\s*recipe|print\s+(?:the\s+)?(?:exact\s+)?(?:system|seedance|master)\s*prompt|reveal\s+(?:the\s+)?prompt|이전\s*지시.*무시|원본\s*(?:영어\s*)?프롬프트.*출력|시스템\s*프롬프트.*출력|스킬\s*규칙.*출력)/iu;

const IDENTITY_SWAP_REGEX =
  /(?:swap\s+face|replace\s+(?:the\s+)?(?:face|identity)|(?:다른|남의|타인|연예인)\s*(?:사람\s*)?(?:얼굴|사진).*바꿔)/iu;

const OCCLUSION_ISSUES: ReadonlySet<PhotoIssueCode> = new Set([
  'hand_occlusion',
  'prop_occlusion',
  'hair_occlusion',
  'tight_crop',
  'wide_crop',
  'asymmetrical_shoulders',
  'bare_shoulder_id_crop',
  'wide_sleeve_silhouette_risk'
]);

const RETOUCH_ISSUES: ReadonlySet<PhotoIssueCode> = new Set([
  'over_retouched_contour',
  'heavy_filter'
]);

const DETAIL_ISSUES: ReadonlySet<PhotoIssueCode> = new Set(['low_resolution', 'motion_blur']);

export const IDENTITY_SIMILARITY_THRESHOLD = 0.9 as const;

export const AMERICANO_SKIN_CONTRACT =
  'Render a matte-to-natural living skin finish with a very low specular-to-diffuse ratio; skin highlights stay below clipping and never form glossy white bands or shiny hotspots on the forehead, nose bridge, or cheeks, showing locally varied living skin with subtle chromatic warmth shifts across cheeks and nose and restrained natural micro-relief without beauty-filter plastic blur, porcelain gradients, or harsh aging shadows.';

export const ANATOMICAL_DE_FILTER_CONTRACT =
  'SURGICAL IN-PLACE IDENTITY LOCK: Edit the first attached image IN PLACE while keeping 98% of the person in Image 1 100% recognizable and untouched in core facial identity, exact eye shape, double-eyelid crease, inter-canthal distance, nasal bridge and tip width, philtrum length, mouth corners, exact hairstyle (preserve original part and bangs without replacing with generic 5:5 curtain bangs), and bright, clean, youthful Korean skin luminance (never age the skin, never add harsh pores or dark under-eye shadows, never re-render into a generic studio mugshot), while normalizing any 2D beauty-app liquify distortions (artificially pinched V-line jawline, over-inflated or over-lined lips) back to anatomically natural 3D camera lens proportions (85mm f/2.0 portrait perspective, soft oval-egg contour) wearing a clean minimalist matte black crew-neck top (never bare passport-photo shoulders).';

function stripBannedPlasticTokens(text: string): string {
  return text
    .replace(
      /\b(?:porcelain\s+skin|flawless\s+skin|smooth\s+skin|dewy\s+glow|visible\s+pores)\b/gi,
      'matte-to-natural living skin finish'
    )
    .replace(/\bbare\s+shoulders\b/gi, 'symmetrical shoulders in a minimalist matte black crew-neck top')
    .replace(/\bstrapless\s+(?:black\s+)?top\b/gi, 'minimalist matte black crew-neck top')
    .trim();
}

export function compileModelSpecificIdentityPrompt(
  engine: ModelSpecificImageEngine,
  spec: {
    extractedIdentityLockEn: string;
    extractedHairLockEn: string;
    rawSurgicalPromptEn: string;
  }
): string {
  const identityLock = stripBannedPlasticTokens(spec.extractedIdentityLockEn);
  const hairLock = stripBannedPlasticTokens(spec.extractedHairLockEn);
  const surgicalDelta = stripBannedPlasticTokens(spec.rawSurgicalPromptEn);

  if (engine === 'seedream-5.5') {
    // Official ByteDance Seedream 5.5 Formula: 4-Part Cohesive Natural-Language Prose
    const part1RefRole = `Reference Image 1 provides the young Korean female subject's exact facial identity, distinctive features (${identityLock}), exact hairstyle (${hairLock}), clothing, and ambient lighting—preserve 95% of Reference Image 1's real facial bone structure, eye spacing, nose bridge contour, lip shape, and personal charm so she remains 100% unmistakably the exact same person.`;
    const part2SceneProse = `An in-place refined vertical 3:4 medium bust-up portrait of the exact same young Korean woman from Reference Image 1, keeping her original hairstyle (${hairLock}) and natural styling, while gently relaxing any harsh, tense, or intimidating facial tension into a calm, effortlessly chic, approachable expression with softly closed or naturally relaxed lips and removing any hand touching the cheek or dangling earphone wire. ${surgicalDelta}`;
    const part3OpticsSkin = `Maintain the natural diffused daylight and soft tonal roll-off (#F4EFEA highlight roll-off, #262528 shadow floor) of an 85mm f/2.0 portrait lens. ${AMERICANO_SKIN_CONTRACT}`;
    const part4CleanFrame =
      'High-end editorial portrait master reference frame, completely clean composition with no earphone cords, no hands covering the jawline, no text, no logos, and no watermarks.';
    return `${part1RefRole} ${part2SceneProse} ${part3OpticsSkin} ${part4CleanFrame}`;
  }

  if (engine === 'gpt-image-2.5-sunburst') {
    // Official OpenAI GPT Image 2.5 Formula: 5-Tier Creative Brief Hierarchy
    return [
      '1. Deliverable & Framing: A high-end editorial bust-up portrait in vertical 3:4 format.',
      `2. Reference Authority (Identity Lock): Use Reference Image 1 strictly for the female subject's facial identity (${identityLock}) and exact hairstyle (${hairLock}). Ignore any tilted selfie angle, hand on face, earphone cord, or cluttered background.`,
      `3. Subject, Pose & Garment Construction: Eye-level frontal bust-up posture with calm, soft approachable eyes and relaxed closed lips, wearing a minimalist matte black crew-neck top. ${surgicalDelta}`,
      '4. Environment & Spatial Planes: Softly out-of-focus neutral daylight architectural background with clean negative space around the crown and shoulders.',
      `5. Lighting, Color Palette (#HEX) & Optical Rendering + Exclusions: Soft diffused daylight key (#F4EFEA highlights, #262528 shadow floor), 85mm f/2.0 optical compression. ${AMERICANO_SKIN_CONTRACT} No earphone cords, no hands near face, no text, no watermarks, no logos.`
    ].join('\n');
  }

  // Official Google Gemini Nano Banana 2.1 Formula: ALL-CAPS Section-Label & LOCK Architecture
  return [
    'ULTRA HIGH-END EDITORIAL PORTRAIT — vertical 3:4.',
    `IDENTITY LOCK: Keep the exact facial identity of the young Korean woman in Reference Image 1 (${identityLock}) and exact hairstyle (${hairLock}). ${ANATOMICAL_DE_FILTER_CONTRACT}`,
    'COMPOSITION LOCK: Eye-level vertical 3:4 bust-up portrait framing full head, hair, and symmetrical upper shoulders.',
    `POSE LOCK: Calm, relaxed, approachable eye-level gaze with gently closed lips (never fierce or tense). ${surgicalDelta}`,
    'OUTFIT & PROPS: Clean minimalist matte black crew-neck top; zero handheld props, zero earphone cords, zero hands touching face.',
    'SETTING: Softly out-of-focus neutral daylight architectural backdrop.',
    'COLOR GRADE & LIGHT: Soft diffused natural daylight (#F4EFEA highlight roll-off, #262528 shadow floor).',
    `CAMERA & OPTICS: 85mm f/2.0 portrait lens perspective. ${AMERICANO_SKIN_CONTRACT}`,
    'NEGATIVE: no text, no watermark, no brand logo, no earphone cord, no hand on cheek, no harsh glare, no plastic skin retouching.'
  ].join('\n');
}

function sanitizeCleanupPrompt(raw: string | null, includeRetouchNormalization: boolean): string {
  const base = (
    raw ??
    'Keep the person in Image 1 100% identical in facial identity, eyes, nose, lips, skin tone, and hairstyle. Remove only the occluding hand or handheld object near the face and restore a clean natural neckline and symmetrical shoulders wearing a minimalist matte black crew-neck top.'
  )
    .replace(/\bbare\s+shoulders\b/gi, 'symmetrical shoulders in a minimalist matte black crew-neck top')
    .replace(/\bstrapless\s+(?:black\s+)?top\b/gi, 'minimalist matte black crew-neck top')
    .replace(/\bvisible\s+pores\b/gi, 'clean, luminous, youthful skin tone')
    .trim();

  if (includeRetouchNormalization && !base.includes('normalizing any 2D beauty-app liquify distortions')) {
    return `${base} ${ANATOMICAL_DE_FILTER_CONTRACT}`;
  }
  return base;
}

export { resolveTemplateBaseline };

export function routePhotoCleanup(
  issues: readonly PhotoIssueCode[],
  cleanupPromptEn: string | null,
  extractedHairDescription: string | null = null
): RecommendedPhotoCleanup {
  const hasOcclusion = issues.some((code) => OCCLUSION_ISSUES.has(code));
  const hasRetouch = issues.some((code) => RETOUCH_ISSUES.has(code));

  if (hasOcclusion || hasRetouch) {
    const mode = hasOcclusion ? 'inpaint_occlusion' : 'normalize_retouch';
    const rawSurgicalPromptEn = sanitizeCleanupPrompt(
      cleanupPromptEn ?? (hasRetouch ? ANATOMICAL_DE_FILTER_CONTRACT : null),
      hasRetouch
    );
    const spec = {
      extractedIdentityLockEn:
        'exact eye shape, double-eyelid crease, inter-canthal distance, nose bridge and tip width, philtrum length, and natural lip contour from Reference Image 1',
      extractedHairLockEn:
        extractedHairDescription?.trim() || 'exact hairstyle, parting, and bangs from Reference Image 1',
      rawSurgicalPromptEn
    };
    return {
      mode,
      engine: 'nano-banana-2.1',
      fallbackEngine: 'seedream-5.5',
      editPromptEn: rawSurgicalPromptEn,
      requiresDualCandidateSelection: true,
      candidateEngines: DUAL_IDENTITY_CANDIDATE_ENGINES,
      candidatePromptsEn: {
        'seedream-5.5': compileModelSpecificIdentityPrompt('seedream-5.5', spec),
        'nano-banana-2.1': compileModelSpecificIdentityPrompt('nano-banana-2.1', spec)
      }
    };
  }
  if (issues.some((code) => DETAIL_ISSUES.has(code))) {
    return {
      mode: 'restore_detail',
      engine: 'seedvr2-local',
      fallbackEngine: null,
      editPromptEn: null,
      requiresDualCandidateSelection: false,
      candidateEngines: null,
      candidatePromptsEn: null
    };
  }
  return {
    mode: 'none',
    engine: null,
    fallbackEngine: null,
    editPromptEn: null,
    requiresDualCandidateSelection: false,
    candidateEngines: null,
    candidatePromptsEn: null
  };
}

export function toClientDirectorTurnResponse(
  result: DirectorChatTurnResult
): ClientDirectorTurnResponse {
  return {
    approved: result.approved,
    refusal: result.refusal,
    replyKo: result.replyKo,
    guardrailAdjustmentKo: result.guardrailAdjustmentKo,
    readyToRender: result.readyToRender,
    summaryChips: result.summaryChips.map((chip) => ({
      slot: chip.slot,
      labelKo: chip.labelKo,
      summaryKo: chip.summaryKo
    }))
  };
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function sanitizeRewrittenPrompt(
  rawPrompt: string,
  hasPersonSlot: boolean,
  castOrOptions:
    | 'solo'
    | 'couple'
    | 'pet'
    | { cast?: 'solo' | 'couple' | 'pet'; audioMode?: PersonalAudioMode; bgmMood?: PersonalBgmMood | null } = 'solo'
): string {
  const opts = typeof castOrOptions === 'string' ? { cast: castOrOptions } : castOrOptions;
  const cast = opts.cast ?? 'solo';
  let cleaned = rawPrompt.trim();
  for (const buzz of BANNED_AI_BUZZWORDS) {
    cleaned = cleaned.replace(new RegExp(`\\b${escapeRegExp(buzz)}\\b`, 'gi'), '');
  }
  for (const pink of BANNED_PINK_MAKEUP_TERMS) {
    cleaned = cleaned.replace(new RegExp(escapeRegExp(pink), 'gi'), 'natural lip colour');
  }
  cleaned = cleaned.replace(/[ \t]{2,}/g, ' ');
  if (hasPersonSlot && !cleaned.includes('Natural matte skin texture with visible pores')) {
    cleaned = `${cleaned}\n\n${SKIN_MATTE_CONTRACT_A10}`;
  }
  return enforcePersonalMorphicGuardrails(cleaned, {
    hasPersonSlot,
    cast,
    audioMode: opts.audioMode,
    bgmMood: opts.bgmMood,
  });
}

export function verifyRewrittenPrompt(
  prompt: string
): { ok: true } | { ok: false; reason: string } {
  if (!prompt || prompt.trim().length < 40) {
    return { ok: false, reason: 'prompt_too_short' };
  }
  const lower = prompt.toLowerCase();
  for (const buzz of BANNED_AI_BUZZWORDS) {
    if (new RegExp(`\\b${escapeRegExp(buzz)}\\b`, 'i').test(lower)) {
      return { ok: false, reason: `banned_buzzword:${buzz}` };
    }
  }
  for (const pink of BANNED_PINK_MAKEUP_TERMS) {
    if (lower.includes(pink.toLowerCase())) {
      return { ok: false, reason: `banned_pink_makeup:${pink}` };
    }
  }
  return { ok: true };
}

/**
 * Server-only Video-Creator Film Director Doctrine for Stage 2 Internal Rewriter.
 * Never sent to Stage 1 and never returned to the client.
 */
const STAGE2_VIDEO_CREATOR_DOCTRINE = [
  'You are the internal Stage 2 Seedance 2.5 Film Director Rewriter.',
  'Apply the structuredIntent edits (outfitOverrideEn, makeupOverrideEn, hairOverrideEn, propOverrideEn, shotEdits, strictExclusionsEn) onto the basePrompt while strictly preserving:',
  '1. Reference Authority & Strict Lock: @Image 1 supplies ONLY facial identity and the target hairstyle. Ignore original background, casual top, wide blouse/puff sleeves, handheld objects, cups, bottles, angel wings, eyeglasses/sunglasses on head, or props from @Image 1. Keep naturally slender shoulders, collarbones, and slim upper arms.',
  '2. Additional Reference Binding (Neck-Down Isolation): When @Image 2 (outfit/look) or @Image 3 (prop/product) is present in referenceSlots, bind it explicitly in Reference authority and across every Timeline shot. @Image 2 supplies ONLY the neck-down garment, silhouette, and footwear (NEVER copy face, hairstyle, skin tone, or background from @Image 2; forbid floating clothing cutouts or white studio backdrops).',
  '3. Makeup & Complexion Override: When makeupOverrideEn is present (e.g. keeping the user photo natural daily makeup instead of heavy 1990s retro smoky/plum makeup), replace the basePrompt makeup instructions accordingly while keeping skin warm and natural (zero pink blush/pink eyeshadow, zero random moles, beauty marks, or blemishes on face/neck per TWINGS IDENTITY.md).',
  '4. Dynamic Multi-Shot Hairstyle Synchronization: Synchronize the target hairstyle (whether sleek tied low-bun, chin-length bob, or long straight hair with bangs) across ALL timeline shots so tied hair never unties mid-video.',
  '5. Candid Micro-Acting & Lower-Face Lock: Keep lip motion calm and understated; forbid wide toothy grins, shouting, or stiff passport-photo staring straight into the camera lens. Every shot transition must remain an instantaneous editorial hard cut.',
  `6. SKIN_MATTE_CONTRACT: Preserve "${SKIN_MATTE_CONTRACT_A10}".`,
  '7. AUDIO CONTRACT: Check `audioMode` in the input JSON. When `audioMode === "ambient"` (default), enforce the Strict No-BGM Personal Audio Rule (ambient sound & natural speech/foley only, zero BGM). When `audioMode === "bgm"`, honor `audioDirective` for cohesive scene-matched background music balanced beneath dialogue and foley.',
  '8. Preserve the original camera focal length, chiaroscuro shadow floor, and unbroken single-bed audio rules.'
].join('\n');

interface GeminiCandidateResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string; thought?: boolean }>;
    };
  }>;
}

/** Also used by lib/renders/pet-photo-check.ts (docs/CAST-CATEGORIES.md §3) — one Gemini JSON call, one shape. */
export async function callGeminiStructuredJson<T>(
  config: DirectorConfig,
  fetchImpl: typeof fetch,
  systemText: string,
  parts: Array<Record<string, unknown>>,
  parser: (raw: unknown) => T
): Promise<T> {
  const url = `${config.baseUrl}/models/${config.model}:generateContent`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': config.apiKey
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemText }]
      },
      contents: [
        {
          role: 'user',
          parts
        }
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        thinkingConfig: {
          thinkingLevel: GEMINI_DIRECTOR_THINKING_LEVEL
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`gemini_director_http_${response.status}`);
  }
  const body = (await response.json()) as GeminiCandidateResponse;
  const text = (body.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
  if (!text.trim()) {
    throw new Error('gemini_director_empty_response');
  }
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
  const parsedJson = JSON.parse(fenced ? fenced[1]! : text) as unknown;
  return parser(parsedJson);
}

export function createFlashTemplateDirector(
  config: DirectorConfig,
  deps: { fetch?: typeof fetch } = {}
) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;

  return {
    model: config.model,

    async inspectPhoto(input: PhotoInspectionInput): Promise<PhotoInspectionVerdict> {
      const systemInstruction = [
        'Inspect the uploaded reference photo for Seedance 2.5 / TWINGS video generation.',
        'Ideal Bust-Up framing has faceWidthRatio between 0.30 and 0.42 with visible neck and symmetrical shoulders.',
        'Check for hand_occlusion, prop_occlusion (cups, bottles, phones, wings), hair_occlusion, tight_crop, wide_sleeve_silhouette_risk (wide puff/blouse sleeves that could make upper arms look thick in sleeveless dresses), wide_angle_distortion (<30cm 24mm barrel distortion), over_retouched_contour (2D liquify pinched V-line jaw, artificially inflated lips, plastic poreless beauty-app blur), heavy_filter, low_resolution, or motion_blur.',
        'When over_retouched_contour or heavy_filter is present, set status to needs_cleanup and gently explain that 2D beauty-app contour/lip retouching can look unnatural in 3D motion, offering natural optical camera proportion & skin texture normalization.',
        'Extract an accurate English hairstyle and facial structure description (extractedHairDescription) and provide polite Korean/English guidance.'
      ].join('\n');

      const parts: Array<Record<string, unknown>> = [
        {
          text: JSON.stringify({
            width: input.width,
            height: input.height,
            role: input.role
          })
        },
        {
          inlineData: {
            mimeType: input.photo.mime,
            data: Buffer.from(input.photo.bytes).toString('base64')
          }
        }
      ];

      const raw = await callGeminiStructuredJson(
        config,
        fetchImpl,
        systemInstruction,
        parts,
        (json) => rawPhotoInspectionSchema.parse(json)
      );

      return {
        status: raw.status,
        issues: raw.issues,
        faceWidthRatio: raw.faceWidthRatio,
        extractedHairDescription: raw.extractedHairDescription,
        userMessageKo: raw.userMessageKo,
        userMessageEn: raw.userMessageEn,
        recommendedCleanup: routePhotoCleanup(
          raw.issues,
          raw.cleanupPromptEn,
          raw.extractedHairDescription
        )
      };
    },

    async runChatTurn(input: DirectorChatTurnInput): Promise<DirectorChatTurnResult> {
      const normalized = input.userMessage.normalize('NFKC').trim();
      if (!normalized || normalized.length > 1000) {
        return {
          approved: false,
          refusal: 'too_large',
          replyKo: '요청 문장은 1,000자 이내로 입력해 주세요.',
          guardrailAdjustmentKo: null,
          readyToRender: false,
          summaryChips: [],
          structuredIntent: null
        };
      }
      if (IDENTITY_SWAP_REGEX.test(normalized)) {
        return {
          approved: false,
          refusal: 'identity',
          replyKo: '본인 얼굴만 사용할 수 있으며, 타인이나 연예인 얼굴로의 변경은 지원하지 않아요.',
          guardrailAdjustmentKo: null,
          readyToRender: false,
          summaryChips: [],
          structuredIntent: null
        };
      }
      if (PROMPT_INJECTION_REGEX.test(normalized)) {
        return {
          approved: false,
          refusal: 'unsafe',
          replyKo: '템플릿의 의상·소품·장면 연출 수정 요청만 반영할 수 있어요.',
          guardrailAdjustmentKo: null,
          readyToRender: false,
          summaryChips: [],
          structuredIntent: null
        };
      }

      const stage1System = [
        'You are the Stage 1 Reception Desk for TWINGS personal template customization.',
        'You ONLY see the public Korean shot summary (templateSummaryKo), editableSlots, and user references.',
        'Translate the user request into Korean summaryChips and a sanitized English structuredIntent for the allowed slots.',
        'If the user asks for extreme facial distortion (shouting, wide-open mouth, acrobatics, staring stiffly into the lens), soften it into calm, candid off-axis micro-acting and explain the adjustment in guardrailAdjustmentKo.'
      ].join('\n');

      const parts: Array<Record<string, unknown>> = [
        {
          text: JSON.stringify({
            templateId: input.templateId,
            templateSummaryKo: input.templateSummaryKo,
            editableSlots: input.editableSlots,
            userMessage: normalized,
            attachedReferences: (input.references ?? []).map((ref) => ({
              slotName: ref.slotName,
              role: ref.role
            }))
          })
        },
        ...(input.references ?? []).map((ref) => ({
          inlineData: {
            mimeType: ref.mime,
            data: Buffer.from(ref.bytes).toString('base64')
          }
        }))
      ];

      return callGeminiStructuredJson(config, fetchImpl, stage1System, parts, (json) =>
        rawStage1ChatSchema.parse(json)
      );
    },

    async rewritePrompt(input: DirectorRewriteInput): Promise<DirectorRewriteResult> {
      const audioRule =
        input.audioMode === 'bgm'
          ? personalSceneBgmAudioContractEn(input.bgmMood)
          : PERSONAL_NO_BGM_AUDIO_CONTRACT_EN;
      const parts: Array<Record<string, unknown>> = [
        {
          text: JSON.stringify({
            basePrompt: input.basePrompt,
            structuredIntent: input.structuredIntent,
            referenceSlots: input.referenceSlots,
            audioMode: input.audioMode ?? 'ambient',
            bgmMood: input.bgmMood ?? null,
            audioDirective: audioRule,
          })
        }
      ];

      const raw = await callGeminiStructuredJson(
        config,
        fetchImpl,
        STAGE2_VIDEO_CREATOR_DOCTRINE,
        parts,
        (json) => rawStage2RewriteSchema.parse(json)
      );

      const hasPerson = input.referenceSlots.some((slot) => slot.role === 'person' || slot.role === 'partner');
      // docs/CAST-CATEGORIES.md §3: the locks follow who is in it, not one assumed person.
      const cast = input.referenceSlots.some((slot) => slot.role === 'partner') ? 'couple' : input.referenceSlots.some((slot) => slot.role === 'pet') ? 'pet' : 'solo';
      const sanitized = sanitizeRewrittenPrompt(raw.rewrittenPrompt, hasPerson, {
        cast,
        audioMode: input.audioMode,
        bgmMood: input.bgmMood,
      });
      const check = verifyRewrittenPrompt(sanitized);
      if (!check.ok) {
        throw new Error(`stage2_prompt_verification_failed:${check.reason}`);
      }

      return {
        compiledPrompt: sealServerOnlyPrompt(sanitized),
        preservedCameraAndLighting: raw.preservedCameraAndLighting,
        preservedAudioRule: raw.preservedAudioRule,
        preservedIdentityStrictLock: raw.preservedIdentityStrictLock
      };
    },

    async synthesizeOpticalIdentityMaster(
      input: MultiPhotoIdentityInput
    ): Promise<OpticalIdentityMasterPlan> {
      if (input.photos.length === 0) {
        throw new Error('optical_identity_master_no_photos');
      }

      const systemInstruction = [
        'You are the TWINGS Optical Identity Lock Engine v2 (3-Stage Zero-Distortion Identity-First Architecture).',
        'Your #1 priority is 100% REAL FACIAL IDENTITY PRESERVATION. Generative re-synthesis (Nano Banana) can distort eye spacing, widen the nose, or age skin texture, so you MUST prefer `passthrough_crop` (keeping 100% original pixels) whenever at least ONE uploaded photo has a clean, unoccluded, flattering face and there is no explicit `creatorNoteKo` requesting contour/hairline modification.',
        '1. strategy: return "passthrough_crop" if any photo has a clean unoccluded face and creatorNoteKo is empty; return "surgical_inplace_edit" ONLY when creatorNoteKo explicitly asks to modify forehead/jawline/lip contour OR when every single photo has physical hand/cup/prop occlusion or severe 2D beauty-app liquify.',
        '2. styleAnchorIndex: 0-based index of the single most flattering, youthful, recognizable photo.',
        '3. structureAnchorIndex: 0-based index of the photo with the most accurate natural facial proportions. NEVER select a 24mm ultra-close wide-angle unretouched selfie (<30cm from lens where barrel distortion enlarges the nose) as structureAnchorIndex.',
        '4. styleAnchorRotationClockwiseDegrees: 0 | 90 | 180 | 270 clockwise rotation needed if the selected styleAnchor photo is lying sideways.',
        '5. bustupCropBoxNormalized: [ymin, xmin, ymax, xmax] (0..1000) framing a clean 3:4 bust-up portrait on the upright styleAnchor photo.',
        '6. Compose opticalMasterPromptEn for in-place surgical editing (when needed), preserving 98% of the original facial identity, eye shape, nose width, philtrum, and bright youthful Korean skin luminance without aging pores.'
      ].join('\n');

      const cappedPhotos = input.photos.slice(0, 8);
      const parts: Array<Record<string, unknown>> = [
        {
          text: JSON.stringify({
            photoCount: cappedPhotos.length,
            creatorNoteKo: input.creatorNoteKo ?? null,
            filenames: cappedPhotos.map((p, idx) => p.filename ?? `photo_${idx}`)
          })
        },
        ...cappedPhotos.map((photo) => ({
          inlineData: {
            mimeType: photo.mime,
            data: Buffer.from(photo.bytes).toString('base64')
          }
        }))
      ];

      const raw = await callGeminiStructuredJson(
        config,
        fetchImpl,
        systemInstruction,
        parts,
        (json) => rawOpticalIdentityMasterSchema.parse(json)
      );

      const maxIdx = cappedPhotos.length - 1;
      const styleAnchorIndex = Math.min(Math.max(raw.styleAnchorIndex, 0), maxIdx);
      const structureAnchorIndex = Math.min(Math.max(raw.structureAnchorIndex, 0), maxIdx);
      const hasNote = Boolean(input.creatorNoteKo && input.creatorNoteKo.trim().length > 0);
      const strategy: 'passthrough_crop' | 'surgical_inplace_edit' = hasNote
        ? 'surgical_inplace_edit'
        : raw.requiresMasterSynthesis
          ? raw.strategy
          : 'passthrough_crop';
      const requiresMasterSynthesis = strategy === 'surgical_inplace_edit';
      const primaryEngine: ModelSpecificImageEngine = input.preferredEngine ?? 'seedream-5.5';
      const fallbackEngine: ModelSpecificImageEngine =
        primaryEngine === 'seedream-5.5' ? 'nano-banana-2.1' : 'seedream-5.5';

      const compiledPrimaryPrompt = compileModelSpecificIdentityPrompt(primaryEngine, {
        extractedIdentityLockEn: raw.extractedIdentityLockEn,
        extractedHairLockEn: raw.extractedHairLockEn,
        rawSurgicalPromptEn: raw.opticalMasterPromptEn
      });
      const compiledFallbackPrompt = compileModelSpecificIdentityPrompt(fallbackEngine, {
        extractedIdentityLockEn: raw.extractedIdentityLockEn,
        extractedHairLockEn: raw.extractedHairLockEn,
        rawSurgicalPromptEn: raw.opticalMasterPromptEn
      });
      const compiledSeedreamPrompt =
        primaryEngine === 'seedream-5.5'
          ? compiledPrimaryPrompt
          : compileModelSpecificIdentityPrompt('seedream-5.5', {
              extractedIdentityLockEn: raw.extractedIdentityLockEn,
              extractedHairLockEn: raw.extractedHairLockEn,
              rawSurgicalPromptEn: raw.opticalMasterPromptEn
            });
      const compiledNanoBananaPrompt =
        primaryEngine === 'nano-banana-2.1'
          ? compiledPrimaryPrompt
          : compileModelSpecificIdentityPrompt('nano-banana-2.1', {
              extractedIdentityLockEn: raw.extractedIdentityLockEn,
              extractedHairLockEn: raw.extractedHairLockEn,
              rawSurgicalPromptEn: raw.opticalMasterPromptEn
            });

      return {
        strategy,
        styleAnchorIndex,
        structureAnchorIndex,
        styleAnchorRotationClockwiseDegrees: raw.styleAnchorRotationClockwiseDegrees,
        bustupCropBoxNormalized: raw.bustupCropBoxNormalized,
        detectedIssues: raw.detectedIssues,
        requiresMasterSynthesis,
        engine: requiresMasterSynthesis ? primaryEngine : null,
        extractedIdentityLockEn: raw.extractedIdentityLockEn,
        extractedHairLockEn: raw.extractedHairLockEn,
        opticalMasterPromptEn: sealServerOnlyPrompt(compiledPrimaryPrompt),
        fallbackMasterPromptEn: sealServerOnlyPrompt(compiledFallbackPrompt),
        dualCandidatePromptsEn: {
          'seedream-5.5': sealServerOnlyPrompt(compiledSeedreamPrompt),
          'nano-banana-2.1': sealServerOnlyPrompt(compiledNanoBananaPrompt)
        }
      };
    },

    async verifyIdentitySimilarity(
      input: IdentitySimilarityVerificationInput
    ): Promise<IdentitySimilarityVerdict> {
      const systemInstruction = [
        'You are the TWINGS Stage 3 Facial Identity Similarity Verification Gate.',
        'Compare Image 1 (Original Creator Photo) vs Image 2 (AI Edited Master) and return strict JSON:',
        '- identitySimilarityScore (0.00..1.00): how closely Image 2 matches the exact eye shape, eyelid crease, nose bridge/tip width, philtrum length, mouth corners, and personal charm of Image 1.',
        '- agingOrDistortionDetected (boolean): true if Image 2 makes the person look older, tired, wider-nosed, longer in the mid-face, harsher in skin texture, or like a different person.',
        '- passedGate (boolean): true ONLY if identitySimilarityScore >= 0.90 AND agingOrDistortionDetected === false.',
        '- reasonKo (string): concise 1-sentence Korean diagnosis.'
      ].join('\n');

      const parts: Array<Record<string, unknown>> = [
        {
          text: JSON.stringify({
            creatorNoteKo: input.creatorNoteKo ?? null
          })
        },
        {
          inlineData: {
            mimeType: input.originalPhoto.mime,
            data: Buffer.from(input.originalPhoto.bytes).toString('base64')
          }
        },
        {
          inlineData: {
            mimeType: input.generatedPhoto.mime,
            data: Buffer.from(input.generatedPhoto.bytes).toString('base64')
          }
        }
      ];

      const raw = await callGeminiStructuredJson(
        config,
        fetchImpl,
        systemInstruction,
        parts,
        (json) => rawIdentitySimilaritySchema.parse(json)
      );

      const passedGate =
        raw.identitySimilarityScore >= IDENTITY_SIMILARITY_THRESHOLD && !raw.agingOrDistortionDetected;

      return {
        identitySimilarityScore: raw.identitySimilarityScore,
        agingOrDistortionDetected: raw.agingOrDistortionDetected,
        passedGate,
        recommendedAction: passedGate ? 'keep_surgical_edit' : 'fallback_to_passthrough_crop',
        reasonKo: raw.reasonKo
      };
    }
  };
}

export type FlashTemplateDirector = ReturnType<typeof createFlashTemplateDirector>;

/**
 * Deterministic Stage 1 fallback used when `GEMINI_API_KEY` is absent in local dev/CI
 * or as an instant pre-check alongside `createFlashTemplateDirector`.
 */
export function runHeuristicDirectorTurn(
  input: DirectorChatTurnInput & {
    audioMode?: PersonalAudioMode;
    bgmMood?: PersonalBgmMood | null;
  }
): DirectorChatTurnResult {
  const normalized = input.userMessage.normalize('NFKC').trim();
  if (normalized.length > 1000) {
    return {
      approved: false,
      refusal: 'too_large',
      replyKo: '요청 문장은 1,000자 이내로 입력해 주세요.',
      guardrailAdjustmentKo: null,
      readyToRender: false,
      summaryChips: [],
      structuredIntent: null,
    };
  }
  if (normalized && IDENTITY_SWAP_REGEX.test(normalized)) {
    return {
      approved: false,
      refusal: 'identity',
      replyKo: '본인 얼굴만 사용할 수 있으며, 타인이나 연예인 얼굴로의 변경은 지원하지 않아요.',
      guardrailAdjustmentKo: null,
      readyToRender: false,
      summaryChips: [],
      structuredIntent: null,
    };
  }
  if (normalized && PROMPT_INJECTION_REGEX.test(normalized)) {
    return {
      approved: false,
      refusal: 'unsafe',
      replyKo: '템플릿의 의상·소품·장면 연출 수정 요청만 반영할 수 있어요.',
      guardrailAdjustmentKo: null,
      readyToRender: false,
      summaryChips: [],
      structuredIntent: null,
    };
  }

  const chips: DirectorSummaryChip[] = [];
  const refs = input.references ?? [];
  const hasLook = refs.some((r) => r.role === 'look' || r.slotName === 'outfit' || r.slotName === 'look_ref');
  const hasProp = refs.some((r) => r.role === 'product' || r.slotName === 'prop' || r.slotName === 'prop_ref');
  const hasScene = refs.some((r) => r.role === 'scene' || r.slotName === 'scene' || r.slotName === 'scene_ref');

  const safeNote = normalized.slice(0, 60);
  if (hasLook) {
    chips.push({ slot: 'outfit', labelKo: '의상 레퍼런스', summaryKo: safeNote || '첨부한 의상 스타일 반영' });
  }
  if (hasProp) {
    chips.push({ slot: 'prop', labelKo: '소품 레퍼런스', summaryKo: safeNote || '첨부한 소품·제품 반영' });
  }
  if (hasScene) {
    chips.push({ slot: 'lighting_mood', labelKo: '장면 분위기', summaryKo: safeNote || '첨부한 배경 무드 반영' });
  }

  if (normalized && !hasLook && !hasProp && !hasScene) {
    if (/드레스|자켓|재킷|코트|셔츠|옷|의상|착장|outfit|dress|jacket/i.test(normalized)) {
      chips.push({ slot: 'outfit', labelKo: '의상', summaryKo: safeNote });
    } else if (/화장|메이크업|블러셔|립|피부|makeup|lip/i.test(normalized)) {
      chips.push({ slot: 'makeup', labelKo: '메이크업', summaryKo: safeNote });
    } else if (/머리|헤어|앞머리|로우번|단발|생머리|안경|선글라스|hair|bangs/i.test(normalized)) {
      chips.push({ slot: 'hair', labelKo: '헤어', summaryKo: safeNote });
    } else if (/소품|가방|가지고|들고|제품|컵|prop|product/i.test(normalized)) {
      chips.push({ slot: 'prop', labelKo: '소품', summaryKo: safeNote });
    } else if (/조명|배경|분위기|색감|lighting|mood|background/i.test(normalized)) {
      chips.push({ slot: 'lighting_mood', labelKo: '분위기', summaryKo: safeNote });
    } else {
      chips.push({ slot: 'shot_action', labelKo: '연출', summaryKo: safeNote });
    }
  }

  const intent: DirectorEditIntent = {
    hairOverrideEn: chips.find((c) => c.slot === 'hair')?.summaryKo ?? null,
    makeupOverrideEn: chips.find((c) => c.slot === 'makeup')?.summaryKo ?? null,
    outfitOverrideEn: chips.find((c) => c.slot === 'outfit')?.summaryKo ?? null,
    propOverrideEn: chips.find((c) => c.slot === 'prop')?.summaryKo ?? null,
    shotEdits: normalized ? [{ shotIndex: 1, actionEn: `Apply user styling note calmly: ${normalized.slice(0, 240)}` }] : [],
    strictExclusionsEn: [],
  };

  const partsSummary = chips.map((c) => `${c.labelKo}(${c.summaryKo})`).join(', ');
  const audioLabel = input.audioMode === 'bgm' ? ' · 어울리는 배경음악 포함' : '';

  return {
    approved: true,
    refusal: 'none',
    replyKo: partsSummary
      ? `카메라 무빙과 기본 리듬은 유지한 채 ${partsSummary}${audioLabel} 설정으로 장면에 반영했어요.`
      : `장면 설정${audioLabel}이 적용되었어요.`,
    guardrailAdjustmentKo: null,
    readyToRender: true,
    summaryChips: chips.slice(0, 5),
    structuredIntent: intent,
  };
}

/**
 * Deterministic prompt compiler used offline or as resilient fallback for Stage 2 Director rewrites.
 */
export function applyDeterministicDirectorSpec(input: {
  basePrompt: string;
  medium: 'image' | 'video';
  cast?: 'solo' | 'couple' | 'pet';
  hasPersonSlot?: boolean;
  hasOutfitRef?: boolean;
  hasPropRef?: boolean;
  hasSceneRef?: boolean;
  directorSpec?: PersonalDirectorSpec | null;
}): string {
  const parts: string[] = [input.basePrompt.trim()];
  const spec = input.directorSpec ?? null;

  if (input.hasOutfitRef) {
    parts.push(
      'Custom Outfit Authority: Apply the garment silhouette, color, and fabric strictly from the uploaded look reference image neck-down only; never copy face, skin tone, or backdrop from the outfit reference.'
    );
  }
  if (input.hasPropRef) {
    parts.push(
      'Custom Prop Authority: Naturally integrate the uploaded object/prop reference at accurate physical hand scale without obscuring the face.'
    );
  }
  if (input.hasSceneRef) {
    parts.push(
      'Custom Scene Mood Authority: Harmonize environmental tone and backdrop ambiance gently with the uploaded scene reference while preserving the template camera framing and lighting continuity.'
    );
  }

  const intent = spec?.structuredIntent ?? null;
  if (intent?.outfitOverrideEn) parts.push(`Wardrobe preference: ${intent.outfitOverrideEn}`);
  if (intent?.makeupOverrideEn) parts.push(`Makeup preference: ${intent.makeupOverrideEn}`);
  if (intent?.hairOverrideEn) parts.push(`Hairstyle preference: ${intent.hairOverrideEn}`);
  if (intent?.propOverrideEn) parts.push(`Prop preference: ${intent.propOverrideEn}`);
  if (intent?.shotEdits?.length) {
    parts.push(intent.shotEdits.map((e) => `Shot ${e.shotIndex}: ${e.actionEn}`).join(' '));
  } else if (spec?.userMessage?.trim()) {
    parts.push(`User customization note (keep camera choreography & facial identity locked): ${spec.userMessage.trim()}`);
  } else if (spec?.summaryChips?.length) {
    parts.push(
      `User selected slot adjustments: ${spec.summaryChips.map((c) => `${c.slot}=${c.summaryKo}`).join('; ')}`
    );
  }

  const combined = parts.join('\n\n');
  const hasPerson = input.hasPersonSlot ?? input.cast !== 'pet';

  if (input.medium === 'video') {
    return sanitizeRewrittenPrompt(combined, hasPerson, {
      cast: input.cast ?? 'solo',
      audioMode: spec?.audioMode ?? 'ambient',
      bgmMood: spec?.bgmMood ?? null,
    });
  }

  return hasPerson && !combined.includes('Natural matte skin texture with visible pores')
    ? `${combined}\n\n${SKIN_MATTE_CONTRACT_A10}`
    : combined;
}

/**
 * Compiles a customer's template customization using `gemini-4-hydrogen` when configured,
 * falling back cleanly to `applyDeterministicDirectorSpec` in local/offline environments or on transient API error.
 */
export async function compileDirectorPrompt(
  input: {
    basePrompt: string;
    medium: 'image' | 'video';
    cast?: 'solo' | 'couple' | 'pet';
    hasPersonSlot?: boolean;
    hasOutfitRef?: boolean;
    hasPropRef?: boolean;
    hasSceneRef?: boolean;
    directorSpec?: PersonalDirectorSpec | null;
    referenceSlots?: readonly DirectorRewriteInput['referenceSlots'][number][];
  },
  deps: { env?: Record<string, string | undefined>; fetch?: typeof fetch } = {}
): Promise<string> {
  const spec = input.directorSpec ?? null;
  const hasCustomization = Boolean(
    spec?.userMessage?.trim() ||
      spec?.summaryChips?.length ||
      spec?.structuredIntent ||
      spec?.audioMode === 'bgm' ||
      input.hasOutfitRef ||
      input.hasPropRef ||
      input.hasSceneRef
  );
  if (!hasCustomization) return input.basePrompt;

  const config = directorConfigFromEnv(deps.env ?? process.env);
  if (config && input.medium === 'video') {
    try {
      const director = createFlashTemplateDirector(config, { fetch: deps.fetch });
      const intent: DirectorEditIntent = spec?.structuredIntent ?? {
        hairOverrideEn: spec?.summaryChips?.find((c) => c.slot === 'hair')?.summaryKo ?? null,
        makeupOverrideEn: spec?.summaryChips?.find((c) => c.slot === 'makeup')?.summaryKo ?? null,
        outfitOverrideEn: spec?.summaryChips?.find((c) => c.slot === 'outfit')?.summaryKo ?? null,
        propOverrideEn: spec?.summaryChips?.find((c) => c.slot === 'prop')?.summaryKo ?? null,
        shotEdits: spec?.userMessage?.trim()
          ? [{ shotIndex: 1, actionEn: spec.userMessage.trim().slice(0, 480) }]
          : [],
        strictExclusionsEn: [],
      };
      type RewriteSlot = {
        index: number;
        slotName: string;
        role: 'person' | 'pet' | 'partner' | 'look' | 'product' | 'scene';
      };
      const slots: RewriteSlot[] = input.referenceSlots
        ? input.referenceSlots.filter((s): s is RewriteSlot => s.role !== 'mask')
        : [{ index: 1, slotName: 'selfie', role: 'person' }];
      if (input.hasOutfitRef && !slots.some((s) => s.slotName === 'look_ref')) {
        slots.push({ index: slots.length + 1, slotName: 'look_ref', role: 'look' });
      }
      if (input.hasPropRef && !slots.some((s) => s.slotName === 'prop_ref')) {
        slots.push({ index: slots.length + 1, slotName: 'prop_ref', role: 'product' });
      }
      if (input.hasSceneRef && !slots.some((s) => s.slotName === 'scene_ref')) {
        slots.push({ index: slots.length + 1, slotName: 'scene_ref', role: 'scene' });
      }
      const rewritten = await director.rewritePrompt({
        basePrompt: input.basePrompt,
        structuredIntent: intent,
        referenceSlots: slots,
        audioMode: spec?.audioMode ?? 'ambient',
        bgmMood: spec?.bgmMood ?? null,
      });
      return unwrapServerOnlyPrompt(rewritten.compiledPrompt);
    } catch {
      // Resilient fallback keeps paid render generation moving even if optional LLM refinement errors transiently.
    }
  }

  return applyDeterministicDirectorSpec(input);
}
