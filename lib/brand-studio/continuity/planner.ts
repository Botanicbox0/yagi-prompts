/**
 * Server-side 2-way Next-Scene Continuity Planner (`+ 다음 씬 연장` for >30s workflows).
 *
 * - Path A (`studio_lineage`): Resolves originating job prompt/final_prompt, attached `@image` product/
 *   subject assets, and cached `FilmSheet` (`brand_studio_assets.film_sheets`) for zero-token context reuse.
 * - Path B (`external_keyframes`): Inspects client-sampled tail frames, selects the sharpest balanced tail
 *   frame, and directs seamless continuation geometry & lighting via `gemini-4-hydrogen` (`thinking: 'HIGH'`).
 */
import type { FilmSheet, StudioReference } from '@/lib/brand-studio/contracts';
import { callGeminiJson, inlinePart, studioGeminiConfig, type GeminiPart } from '@/lib/brand-studio/enhancer/gemini';
import { containsInternalTerm } from '@/lib/brand-studio/enhancer/schema';
import { filmSheetCacheKey } from '@/lib/brand-studio/film-sheet/lifecycle';
import { readyAsset } from '@/lib/brand-studio/repo';
import type { StudioDeps } from '@/lib/brand-studio/types';
import {
  type ContinuityPlan,
  type ContinuityPlanInput,
  type ContinuityReferenceItem,
} from './contracts';
import { pickBestContinuationFrameIndex } from './frame-picker';

const CONTINUITY_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    recommendedPrompt: {
      type: 'string',
      description: 'Actionable video scene prompt for the next cut maintaining continuous look, lighting, and subject.',
    },
    cameraTransition: {
      type: 'string',
      description: 'Short camera & blocking bridge from the end of the previous shot into this cut.',
    },
    continuityNotes: {
      type: 'string',
      description: 'One short customer-facing explanation in the requested locale.',
    },
  },
  required: ['recommendedPrompt', 'cameraTransition', 'continuityNotes'],
  additionalProperties: false,
} as const;

const INTERNAL_SCRUB_RE =
  /\b(?:gemini(?:-4-hydrogen)?|seedance|seedream|modelark|sunra|ffmpeg|laplacian|reinhard|supabase|slack|elevenlabs|yue2|seedvr2|morphic)\b|모픽/gi;

function scrubCustomerText(text: string): string {
  return text
    .replace(INTERNAL_SCRUB_RE, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

function decodeDataUrl(dataUrl: string): { mimeType: string; bytes: Uint8Array } | null {
  const m = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl.trim());
  if (!m) return null;
  try {
    const raw = Buffer.from(m[2]!, 'base64');
    if (raw.byteLength === 0) return null;
    const mime = m[1]!.toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1]!.toLowerCase();
    return { mimeType: mime, bytes: new Uint8Array(raw) };
  } catch {
    return null;
  }
}

function pickCachedFilmSheet(
  rawSheets: Record<string, FilmSheet> | null | undefined,
  locale: 'ko' | 'en',
): FilmSheet | null {
  if (!rawSheets || typeof rawSheets !== 'object') return null;
  const preferredKeys = [
    filmSheetCacheKey(locale, 'blueprint'),
    filmSheetCacheKey(locale, 'basic'),
    'blueprint:ko',
    'blueprint:en',
    'basic:ko',
    'basic:en',
    'ko',
    'en',
    ...Object.keys(rawSheets),
  ];
  for (const k of preferredKeys) {
    const candidate = rawSheets[k];
    if (candidate && Array.isArray(candidate.shots) && candidate.look) {
      return candidate;
    }
  }
  return null;
}

function summarizeFilmSheet(sheet: FilmSheet | null, locale: 'ko' | 'en'): string | null {
  if (!sheet) return null;
  const lastShot = sheet.shots[sheet.shots.length - 1];
  const parts: string[] = [];
  if (sheet.setting) parts.push(sheet.setting);
  if (sheet.look?.lighting || sheet.look?.palette) {
    parts.push([sheet.look.lighting, sheet.look.palette].filter(Boolean).join(', '));
  }
  if (lastShot) {
    parts.push(
      locale === 'ko'
        ? `마지막 컷: ${lastShot.framing} · ${lastShot.camera} · ${lastShot.action}`
        : `Last shot: ${lastShot.framing}, ${lastShot.camera}, ${lastShot.action}`,
    );
  }
  const joined = scrubCustomerText(parts.filter(Boolean).join(' / '));
  return joined ? joined.slice(0, 320) : null;
}

function buildFallbackPlan(args: {
  input: ContinuityPlanInput;
  path: 'studio_lineage' | 'external_keyframes';
  priorPrompt: string | null;
  filmSheetSummary: string | null;
  referenceRefs: ContinuityReferenceItem[];
  selectedFrameIndex: number;
  selectedFrameTimestampSec: number | null;
  selectedFrameDataUrl: string | null;
}): ContinuityPlan {
  const {
    input,
    path,
    priorPrompt,
    filmSheetSummary,
    referenceRefs,
    selectedFrameIndex,
    selectedFrameTimestampSec,
    selectedFrameDataUrl,
  } = args;
  const isKo = input.locale === 'ko';
  const imageCount = referenceRefs.filter((r) => r.mediaKind === 'image').length;
  const leadRefToken =
    imageCount > 0 ? (isKo ? '@이미지 1' : '@Image1') : '';
  const over30sSequence = input.sequenceDurationSec + input.targetNextSeconds >= 30;
  const direction = input.userDirection?.trim();

  const cameraTransition = isKo
    ? '직전 컷의 마지막 시선·카메라 속도를 유지한 채 부드럽게 전진 트래킹으로 이어집니다.'
    : 'Carry forward the exact closing framing, lighting direction, and smooth forward camera motion.';

  let recommendedPrompt: string;
  if (path === 'studio_lineage') {
    const contextHint = scrubCustomerText(filmSheetSummary || priorPrompt || input.clipLabel || '');
    if (isKo) {
      recommendedPrompt = [
        leadRefToken ? `${leadRefToken}의 제품 디테일과 질감을 유지한 채` : '직전 장면의 조명과 색감을 그대로 이어받아',
        contextHint ? `(${contextHint.slice(0, 140)}) 흐름에서 이어지는 다음 ${input.targetNextSeconds}초 컷,` : `자연스럽게 이어지는 다음 ${input.targetNextSeconds}초 컷,`,
        direction || '피사체의 핵심 실루엣을 또렷하게 드러내며 천천히 돌리 인하는 안정적인 시네마틱 샷',
      ]
        .filter(Boolean)
        .join(' ');
    } else {
      recommendedPrompt = [
        leadRefToken ? `Continuing seamlessly with ${leadRefToken}, preserving consistent product texture and lighting,` : 'Continuing seamlessly with matched lighting and palette,',
        contextHint ? `advancing from ${contextHint.slice(0, 140)},` : '',
        direction || `a continuous ${input.targetNextSeconds}s follow-up cut with a slow, steady camera push-in`,
      ]
        .filter(Boolean)
        .join(' ');
    }
  } else {
    const tsLabel = selectedFrameTimestampSec !== null ? `${selectedFrameTimestampSec.toFixed(1)}s` : '';
    if (isKo) {
      recommendedPrompt = [
        tsLabel ? `이전 클립(${tsLabel} 프레임)의 구도와 광량에서 자연스럽게 연결되는 다음 ${input.targetNextSeconds}초 장면,` : `이전 클립의 마지막 구도와 광량에서 이어지는 다음 ${input.targetNextSeconds}초 장면,`,
        direction || '동일한 색온도와 피사체 거리를 유지하며 부드럽게 앵글을 이동해 다음 행동을 완성하는 샷',
      ].join(' ');
    } else {
      recommendedPrompt = [
        tsLabel ? `Direct visual continuation from the ${tsLabel} closing frame for ${input.targetNextSeconds}s,` : `Direct visual continuation for ${input.targetNextSeconds}s,`,
        direction || 'preserving color temperature and subject framing while transitioning smoothly into the next beat.',
      ].join(' ');
    }
  }

  const continuityNotes = isKo
    ? path === 'studio_lineage'
      ? `기존 장면 설계와 참조 에셋${imageCount > 0 ? ` ${imageCount}건` : ''}을 연결해 톤 일관성을 유지해요.`
      : `클립 후반에서 가장 선명하고 노출이 안정된 프레임${selectedFrameTimestampSec !== null ? ` (${selectedFrameTimestampSec.toFixed(1)}초)` : ''}을 시작 기준점으로 잡았어요.`
    : path === 'studio_lineage'
      ? `Linked prior scene direction and ${imageCount > 0 ? `${imageCount} studio reference(s)` : 'saved shot notes'} for visual consistency.`
      : `Selected the sharpest balanced closing frame${selectedFrameTimestampSec !== null ? ` (${selectedFrameTimestampSec.toFixed(1)}s)` : ''} to anchor the next cut.`;

  return {
    path,
    recommendedPrompt: scrubCustomerText(recommendedPrompt),
    cameraTransition: scrubCustomerText(cameraTransition),
    continuityNotes: scrubCustomerText(continuityNotes),
    selectedFrameIndex,
    selectedFrameTimestampSec,
    selectedFrameDataUrl,
    referenceRefs,
    filmSheetSummary,
    over30sSequence,
    creditsUsed: 0,
  };
}

export async function planSceneContinuation(
  deps: StudioDeps,
  input: ContinuityPlanInput,
  options?: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch },
): Promise<ContinuityPlan> {
  const env: Record<string, string | undefined> = options?.env ?? process.env;
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;

  let jobRow: {
    id: string;
    prompt: string;
    final_prompt: string | null;
    refs: StudioReference[] | null;
  } | null = null;
  let assetRow: {
    id: string;
    name: string;
    kind: 'image' | 'video' | 'audio';
    source: string;
    source_output_id: string | null;
    film_sheets: Record<string, FilmSheet> | null;
  } | null = null;
  let resolvedOutputId = input.outputId ?? null;
  let resolvedSavedAssetId: string | null = input.assetId ?? null;

  if (resolvedOutputId) {
    const out = (
      await deps.sql.query<{
        id: string;
        job_id: string;
        saved_asset_id: string | null;
      }>(
        `select id, job_id, saved_asset_id
           from brand_studio_outputs
          where organization_id = $1 and id = $2 and deleted_at is null
          limit 1`,
        [input.organizationId, resolvedOutputId],
      )
    ).rows[0];

    if (out) {
      if (!resolvedSavedAssetId && out.saved_asset_id) {
        resolvedSavedAssetId = out.saved_asset_id;
      }
      jobRow =
        (
          await deps.sql.query<{
            id: string;
            prompt: string;
            final_prompt: string | null;
            refs: StudioReference[] | null;
          }>(
            `select id, prompt, final_prompt, refs
               from brand_studio_jobs
              where organization_id = $1 and id = $2
              limit 1`,
            [input.organizationId, out.job_id],
          )
        ).rows[0] ?? null;
    }
  }

  if (resolvedSavedAssetId) {
    assetRow =
      (
        await deps.sql.query<{
          id: string;
          name: string;
          kind: 'image' | 'video' | 'audio';
          source: string;
          source_output_id: string | null;
          film_sheets: Record<string, FilmSheet> | null;
        }>(
          `select id, name, kind, source, source_output_id, film_sheets
             from brand_studio_assets
            where organization_id = $1 and id = $2 and deleted_at is null
            limit 1`,
          [input.organizationId, resolvedSavedAssetId],
        )
      ).rows[0] ?? null;

    if (!jobRow && assetRow?.source_output_id) {
      resolvedOutputId = assetRow.source_output_id;
      const srcOut = (
        await deps.sql.query<{ job_id: string }>(
          `select job_id from brand_studio_outputs
            where organization_id = $1 and id = $2 and deleted_at is null
            limit 1`,
          [input.organizationId, assetRow.source_output_id],
        )
      ).rows[0];
      if (srcOut) {
        jobRow =
          (
            await deps.sql.query<{
              id: string;
              prompt: string;
              final_prompt: string | null;
              refs: StudioReference[] | null;
            }>(
              `select id, prompt, final_prompt, refs
                 from brand_studio_jobs
                where organization_id = $1 and id = $2
                limit 1`,
              [input.organizationId, srcOut.job_id],
            )
          ).rows[0] ?? null;
      }
    }
  }

  const cachedSheet = pickCachedFilmSheet(assetRow?.film_sheets, input.locale);
  const filmSheetSummary = summarizeFilmSheet(cachedSheet, input.locale);
  const path: 'studio_lineage' | 'external_keyframes' =
    jobRow !== null || cachedSheet !== null ? 'studio_lineage' : 'external_keyframes';

  const referenceRefs: ContinuityReferenceItem[] = [];
  const seenIds = new Set<string>();

  if (jobRow && Array.isArray(jobRow.refs)) {
    for (const ref of jobRow.refs) {
      if (!ref?.assetId || seenIds.has(ref.assetId)) continue;
      const refAsset = await readyAsset(deps.sql, input.organizationId, ref.assetId);
      if (!refAsset || refAsset.kind !== 'image') continue;
      seenIds.add(refAsset.id);
      const role: ContinuityReferenceItem['role'] =
        ref.frame === 'start'
          ? 'start_frame'
          : ref.role === 'person'
            ? 'subject'
            : ref.role === 'style'
              ? 'style'
              : 'product';
      referenceRefs.push({
        kind: 'asset',
        id: refAsset.id,
        mediaKind: 'image',
        name: refAsset.name,
        role,
      });
    }
  }

  if (referenceRefs.length === 0) {
    if (resolvedOutputId) {
      referenceRefs.push({
        kind: 'output',
        id: resolvedOutputId,
        mediaKind: 'video',
        name: input.clipLabel || 'Previous shot',
        role: 'style',
      });
    } else if (assetRow) {
      referenceRefs.push({
        kind: 'asset',
        id: assetRow.id,
        mediaKind: assetRow.kind === 'image' ? 'image' : 'video',
        name: assetRow.name,
        role: 'style',
      });
    }
  }

  const candidates = input.keyframes ?? [];
  const selectedFrameIndex = pickBestContinuationFrameIndex(candidates);
  const chosenFrame = candidates[selectedFrameIndex] ?? null;
  const selectedFrameTimestampSec = chosenFrame ? chosenFrame.timestampSec : null;
  const selectedFrameDataUrl = chosenFrame?.dataUrl ?? null;

  const fallback = buildFallbackPlan({
    input,
    path,
    priorPrompt: jobRow?.final_prompt ?? jobRow?.prompt ?? null,
    filmSheetSummary,
    referenceRefs,
    selectedFrameIndex,
    selectedFrameTimestampSec,
    selectedFrameDataUrl,
  });

  const geminiCfg = studioGeminiConfig(env);
  if (!geminiCfg || env.BRAND_STUDIO_PROVIDER === 'fake') {
    return fallback;
  }

  try {
    const contextLines: string[] = [
      `Continuity path: ${path}`,
      `Requested locale: ${input.locale}`,
      `Current sequence total: ${input.sequenceDurationSec}s; target next cut: ${input.targetNextSeconds}s`,
      `Over 30s multi-scene workflow: ${fallback.over30sSequence ? 'yes' : 'no'}`,
    ];
    if (input.clipLabel) contextLines.push(`Clip label: ${input.clipLabel}`);
    if (jobRow) {
      contextLines.push(`Prior shot prompt: ${jobRow.final_prompt || jobRow.prompt}`);
    }
    if (filmSheetSummary) {
      contextLines.push(`Cached shot sheet summary: ${filmSheetSummary}`);
    }
    const imageRefs = referenceRefs.filter((r) => r.mediaKind === 'image');
    if (imageRefs.length > 0) {
      contextLines.push(
        `Preserve attached studio image references using tokens (${imageRefs
          .map((r, i) => `${input.locale === 'ko' ? `@이미지 ${i + 1}` : `@Image${i + 1}`}=${r.name}`)
          .join(', ')}).`,
      );
    }
    if (chosenFrame) {
      contextLines.push(
        `Anchor tail frame index=${selectedFrameIndex} at ${chosenFrame.timestampSec}s (sharpness=${chosenFrame.sharpness}, exposure=${chosenFrame.exposure}, motionDelta=${chosenFrame.motionDelta}).`,
      );
    }
    if (input.userDirection?.trim()) {
      contextLines.push(`User next-scene direction: ${input.userDirection.trim()}`);
    }

    const parts: GeminiPart[] = [{ text: contextLines.join('\n') }];
    for (const frame of candidates.slice(0, 4)) {
      if (!frame.dataUrl) continue;
      const decoded = decodeDataUrl(frame.dataUrl);
      if (decoded) {
        parts.push(inlinePart(decoded.bytes, decoded.mimeType));
      }
    }

    const system = [
      'You are an editorial commercial film continuity director.',
      'Design a seamless next-scene video generation prompt that matches lighting, color palette, lens language, and subject details from the previous cut.',
      'Never mention model names, engine names, APIs, or internal pipelines.',
      input.locale === 'ko'
        ? 'Write continuityNotes and cameraTransition in natural, concise Korean.'
        : 'Write continuityNotes and cameraTransition in concise English.',
    ].join(' ');

    const raw = (await callGeminiJson(geminiCfg, fetchImpl, {
      system,
      parts,
      schema: CONTINUITY_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      thinking: 'HIGH',
      timeoutMs: 18_000,
    })) as {
      recommendedPrompt?: unknown;
      cameraTransition?: unknown;
      continuityNotes?: unknown;
    };

    const rec = typeof raw.recommendedPrompt === 'string' ? scrubCustomerText(raw.recommendedPrompt) : '';
    const cam = typeof raw.cameraTransition === 'string' ? scrubCustomerText(raw.cameraTransition) : '';
    const note = typeof raw.continuityNotes === 'string' ? scrubCustomerText(raw.continuityNotes) : '';
    const exempt = `${input.userDirection ?? ''} ${input.clipLabel}`;

    if (
      rec.length < 12 ||
      containsInternalTerm(rec, exempt) ||
      containsInternalTerm(cam, exempt) ||
      containsInternalTerm(note, exempt)
    ) {
      return fallback;
    }

    return {
      ...fallback,
      recommendedPrompt: rec,
      cameraTransition: cam || fallback.cameraTransition,
      continuityNotes: note || fallback.continuityNotes,
    };
  } catch {
    return fallback;
  }
}
