import {
  BANNED_AI_BUZZWORDS,
  BANNED_PINK_MAKEUP_TERMS,
  SKIN_MATTE_CONTRACT_A10
} from '@/lib/brands/briefs/compiler';
import {
  GEMINI_DIRECTOR_DEFAULT_BASE_URL,
  GEMINI_DIRECTOR_DEFAULT_MODEL,
  rawPhotoInspectionSchema,
  rawStage1ChatSchema,
  rawStage2RewriteSchema,
  type ClientDirectorTurnResponse,
  type DirectorChatTurnInput,
  type DirectorChatTurnResult,
  type DirectorConfig,
  type DirectorRewriteInput,
  type DirectorRewriteResult,
  type OpaqueCompiledPrompt,
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
  'tight_crop'
]);

const DETAIL_ISSUES: ReadonlySet<PhotoIssueCode> = new Set(['low_resolution', 'motion_blur']);

export function routePhotoCleanup(
  issues: readonly PhotoIssueCode[],
  cleanupPromptEn: string | null
): RecommendedPhotoCleanup {
  if (issues.some((code) => OCCLUSION_ISSUES.has(code))) {
    return {
      mode: 'inpaint_occlusion',
      engine: 'nano-banana-2.1',
      fallbackEngine: 'seedream-5.0-pro',
      editPromptEn:
        cleanupPromptEn ??
        'Keep the person in Image 1 100% identical in facial identity, eyes, nose, lips, skin tone, and hairstyle. Remove only the occluding hand or handheld object near the face and restore a clean natural neckline and symmetrical shoulders.'
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
        responseMimeType: 'application/json'
      }
    })
  });

  if (!response.ok) {
    throw new Error(`gemini_director_http_${response.status}`);
  }
  const body = (await response.json()) as GeminiCandidateResponse;
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
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
        'Check for hand_occlusion, prop_occlusion (cups, bottles, phones, wings), hair_occlusion, tight_crop, low_resolution, or motion_blur.',
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
    }
  };
}

export type FlashTemplateDirector = ReturnType<typeof createFlashTemplateDirector>;
