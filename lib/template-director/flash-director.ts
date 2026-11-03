import {
  BANNED_AI_BUZZWORDS,
  BANNED_PINK_MAKEUP_TERMS,
  SKIN_MATTE_CONTRACT_A10
} from '@/lib/brands/briefs/compiler';
import {
  GEMINI_DIRECTOR_DEFAULT_BASE_URL,
  GEMINI_DIRECTOR_DEFAULT_MODEL,
  rawOpticalIdentityMasterSchema,
  rawPhotoInspectionSchema,
  rawStage1ChatSchema,
  rawStage2RewriteSchema,
  type ClientDirectorTurnResponse,
  type DirectorChatTurnInput,
  type DirectorChatTurnResult,
  type DirectorConfig,
  type DirectorRewriteInput,
  type DirectorRewriteResult,
  type MultiPhotoIdentityInput,
  type OpaqueCompiledPrompt,
  type OpticalIdentityMasterPlan,
  type PhotoInspectionInput,
  type PhotoInspectionVerdict,
  type PhotoIssueCode,
  type PhotoPrecheckInput,
  type PhotoPrecheckResult,
  type RecommendedPhotoCleanup
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
  'bare_shoulder_id_crop'
]);

const RETOUCH_ISSUES: ReadonlySet<PhotoIssueCode> = new Set([
  'over_retouched_contour',
  'heavy_filter'
]);

const DETAIL_ISSUES: ReadonlySet<PhotoIssueCode> = new Set(['low_resolution', 'motion_blur']);

export const ANATOMICAL_DE_FILTER_CONTRACT =
  'Keep the person in Image 1 100% recognizable in core facial identity, eye shape, nasal bridge, exact hairstyle (preserve original part and bangs without replacing with generic 5:5 curtain bangs), and natural charm, while normalizing 2D beauty-app liquify distortions (artificially pinched V-line jawline, over-inflated or over-lined lips, and plastic poreless skin blur) back to anatomically natural 3D camera lens proportions (85mm f/2.0 portrait perspective, soft oval-egg contour) wearing a clean minimalist matte black crew-neck top (never bare passport-photo shoulders) with natural matte skin micro-texture and visible pores.';

function sanitizeCleanupPrompt(raw: string | null, includeRetouchNormalization: boolean): string {
  const base = (
    raw ??
    'Keep the person in Image 1 100% identical in facial identity, eyes, nose, lips, skin tone, and hairstyle. Remove only the occluding hand or handheld object near the face and restore a clean natural neckline and symmetrical shoulders wearing a minimalist matte black crew-neck top.'
  )
    .replace(/\bbare\s+shoulders\b/gi, 'symmetrical shoulders in a minimalist matte black crew-neck top')
    .replace(/\bstrapless\s+(?:black\s+)?top\b/gi, 'minimalist matte black crew-neck top')
    .trim();

  if (includeRetouchNormalization && !base.includes('normalizing 2D beauty-app liquify distortions')) {
    return `${base} ${ANATOMICAL_DE_FILTER_CONTRACT}`;
  }
  return base;
}

export function routePhotoCleanup(
  issues: readonly PhotoIssueCode[],
  cleanupPromptEn: string | null
): RecommendedPhotoCleanup {
  const hasOcclusion = issues.some((code) => OCCLUSION_ISSUES.has(code));
  const hasRetouch = issues.some((code) => RETOUCH_ISSUES.has(code));

  if (hasOcclusion) {
    return {
      mode: 'inpaint_occlusion',
      engine: 'nano-banana-2.1',
      fallbackEngine: 'seedream-5.0-pro',
      editPromptEn: sanitizeCleanupPrompt(cleanupPromptEn, hasRetouch)
    };
  }
  if (hasRetouch) {
    return {
      mode: 'normalize_retouch',
      engine: 'nano-banana-2.1',
      fallbackEngine: 'seedream-5.0-pro',
      editPromptEn: sanitizeCleanupPrompt(cleanupPromptEn ?? ANATOMICAL_DE_FILTER_CONTRACT, true)
    };
  }
  if (issues.some((code) => DETAIL_ISSUES.has(code))) {
    return {
      mode: 'restore_detail',
      engine: 'seedvr2-local',
      fallbackEngine: null,
      editPromptEn: null
    };
  }
  return {
    mode: 'none',
    engine: null,
    fallbackEngine: null,
    editPromptEn: null
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

export function sanitizeRewrittenPrompt(rawPrompt: string, hasPersonSlot: boolean): string {
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
  return cleaned;
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
  'Apply the structuredIntent edits onto the basePrompt while strictly preserving:',
  '1. Reference Authority & Strict Lock: @Image 1 supplies ONLY facial identity and the target hairstyle. Ignore original background, casual top, handheld objects, cups, bottles, angel wings, or props from @Image 1.',
  '2. Additional Reference Binding: When @Image 2 (outfit/look) or @Image 3 (prop/product) is present in referenceSlots, bind it explicitly in Reference authority and across every Timeline shot, forbidding floating clothing cutouts or white studio backdrops.',
  '3. Candid Micro-Acting & Lower-Face Lock: Keep lip motion calm and understated; forbid wide toothy grins, shouting, or stiff passport-photo staring straight into the camera lens. Every shot transition must remain an instantaneous editorial hard cut.',
  `4. SKIN_MATTE_CONTRACT: Preserve "${SKIN_MATTE_CONTRACT_A10}".`,
  '5. Preserve the original camera focal length, chiaroscuro shadow floor, and unbroken single-bed audio rules.'
].join('\n');

interface GeminiCandidateResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

async function callGeminiStructuredJson<T>(
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
          thinkingLevel: 'LOW'
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`gemini_director_http_${response.status}`);
  }
  const body = (await response.json()) as GeminiCandidateResponse;
  const partsList = body.candidates?.[0]?.content?.parts ?? [];
  const text = partsList[partsList.length - 1]?.text;
  if (!text) {
    throw new Error('gemini_director_empty_response');
  }
  const parsedJson = JSON.parse(text) as unknown;
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
        'Check for hand_occlusion, prop_occlusion (cups, bottles, phones, wings), hair_occlusion, tight_crop, over_retouched_contour (2D liquify pinched V-line jaw, artificially inflated lips, plastic poreless beauty-app blur), heavy_filter, low_resolution, or motion_blur.',
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
        recommendedCleanup: routePhotoCleanup(raw.issues, raw.cleanupPromptEn)
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
      const parts: Array<Record<string, unknown>> = [
        {
          text: JSON.stringify({
            basePrompt: input.basePrompt,
            structuredIntent: input.structuredIntent,
            referenceSlots: input.referenceSlots
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

      const hasPerson = input.referenceSlots.some((slot) => slot.role === 'person');
      const sanitized = sanitizeRewrittenPrompt(raw.rewrittenPrompt, hasPerson);
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
        'You are the TWINGS Optical Identity Lock Engine (Backend Pre-Render Stage 0).',
        'Analyze 1 to 8 uploaded photos of the same creator/user and select two anchors:',
        '1. styleAnchorIndex: 0-based index of the photo showing the creator’s most flattering everyday hairstyle, bangs/parting, and natural facial vibe.',
        '2. structureAnchorIndex: 0-based index of the photo showing the clearest frontal facial bone symmetry, eye shape, and nasal bridge.',
        '3. Detect any 2D beauty-app liquify distortions (over_retouched_contour, heavy_filter), prop/hand occlusions, or bare-shoulder ID crops.',
        '4. Compose opticalMasterPromptEn to synthesize a single 85mm f/2.0 optical portrait lens master reference combining the exact facial identity of structureAnchorIndex with the hairstyle/vibe of styleAnchorIndex, normalizing any 2D V-chin liquify into a soft oval-egg contour, wearing a minimalist matte black crew-neck top (never bare shoulders) with natural matte skin micro-texture.'
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
      const sanitizedMasterPrompt = sanitizeCleanupPrompt(raw.opticalMasterPromptEn, true);

      return {
        styleAnchorIndex,
        structureAnchorIndex,
        detectedIssues: raw.detectedIssues,
        requiresMasterSynthesis: raw.requiresMasterSynthesis,
        engine: 'nano-banana-2.1',
        extractedIdentityLockEn: raw.extractedIdentityLockEn,
        extractedHairLockEn: raw.extractedHairLockEn,
        opticalMasterPromptEn: sealServerOnlyPrompt(sanitizedMasterPrompt)
      };
    }
  };
}

export type FlashTemplateDirector = ReturnType<typeof createFlashTemplateDirector>;
