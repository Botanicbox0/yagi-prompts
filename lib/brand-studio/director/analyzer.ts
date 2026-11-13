/**
 * Multimodal input analyzer for the Silent `Video-Creator` Director (docs/STUDIO-PRO-SUITE-V4.md §1.3).
 *
 * Inspects up to 9 attached `@imageN` thumbnails plus the cached `@video1` `FilmSheet` (`shots`, `look`,
 * `audio`, `seconds`). Supports `gemini-4-hydrogen` (default, mapping legacy `gemini-3.8-flash`) and
 * `argon` (`BRAND_STUDIO_DIRECTOR_PROVIDER`), gracefully falling back to `gemini-4-hydrogen` when
 * the Argon endpoint is not configured yet.
 */
import { z } from 'zod';
import { callGeminiJson, inlinePart, studioGeminiConfig, type GeminiPart } from '@/lib/brand-studio/enhancer/gemini';
import { containsInternalTerm } from '@/lib/brand-studio/enhancer/schema';
import type {
  DirectorProviderId,
  MediaAnalysisDigest,
  MediaAnalysisRefSummary,
  MediaAnalyzeDeps,
  MediaAnalyzeInput,
  MediaAnalyzer,
} from './types';

export const DIRECTOR_THUMBS_MAX = 9;

const THUMB_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ANALYZE_TIMEOUT_MS = 18_000;
const HEX_RE = /^#[0-9a-f]{6}$/i;

const RawAnalysisSchema = z.object({
  paletteHex: z.array(z.string()).catch([]),
  lightingNotes: z.string().catch(''),
  textureNotes: z.string().catch(''),
  subjectNotes: z.string().catch(''),
  referenceNotes: z
    .array(
      z.object({
        token: z.string().catch(''),
        visualNotes: z.string().catch(''),
      }),
    )
    .catch([]),
});

export const MEDIA_ANALYSIS_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    paletteHex: {
      type: 'array',
      items: { type: 'string' },
      description: '3 to 4 dominant hex colors (#RRGGBB) from the attached images and scene.',
    },
    lightingNotes: {
      type: 'string',
      description: 'Motivated key light direction, softness, ambient shadow floor, and color spill.',
    },
    textureNotes: {
      type: 'string',
      description: 'Natural skin, fabric, prop, and lens texture without plastic beauty-filter glare.',
    },
    subjectNotes: {
      type: 'string',
      description: 'Key subjects, wardrobe, and product geometry observed in the references.',
    },
    referenceNotes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          token: { type: 'string' },
          visualNotes: { type: 'string' },
        },
        required: ['token', 'visualNotes'],
      },
    },
  },
  required: ['paletteHex', 'lightingNotes', 'textureNotes', 'subjectNotes', 'referenceNotes'],
} as const;

export function resolveDirectorProvider(env: Record<string, string | undefined>): DirectorProviderId {
  const requested = env.BRAND_STUDIO_DIRECTOR_PROVIDER?.trim().toLowerCase();
  if (requested === 'argon') return 'argon';
  // Map legacy 'gemini-3.8-flash' and default/empty values onto Gemini 4 Hydrogen.
  return 'gemini-4-hydrogen';
}

function defaultHexPalette(paletteHint?: string): string[] {
  const extracted = (paletteHint ?? '').match(/#[0-9a-f]{6}\b/gi) ?? [];
  if (extracted.length >= 3) return extracted.slice(0, 4).map((h) => h.toUpperCase());
  return ['#1B1F24', '#D8CFC2', '#6B7280'];
}

function buildReferenceStubs(input: MediaAnalyzeInput): MediaAnalysisRefSummary[] {
  const ordinals: Record<'image' | 'video' | 'audio', number> = { image: 0, video: 0, audio: 0 };
  return input.references.map((ref) => {
    ordinals[ref.kind] += 1;
    const ord = ordinals[ref.kind];
    const word = ref.kind === 'image' ? 'Image' : ref.kind === 'video' ? 'Video' : 'Audio';
    const token = `@${word} ${ord}`;
    const base = [
      ref.role ? `role: ${ref.role}` : '',
      ref.use?.trim() ? `use: ${ref.use.trim()}` : '',
      ref.avoid?.trim() ? `avoid: ${ref.avoid.trim()}` : '',
    ]
      .filter(Boolean)
      .join('; ');
    return {
      index: ref.index,
      token,
      kind: ref.kind,
      role: ref.role ?? null,
      visualNotes: base || `${ref.kind} reference ${ord}`,
    };
  });
}

function deterministicDigest(
  provider: DirectorProviderId,
  input: MediaAnalyzeInput,
  fallbackUsed: boolean,
): MediaAnalysisDigest {
  const sheet = input.sheet ?? null;
  const references = buildReferenceStubs(input);
  return {
    provider,
    fallbackUsed,
    paletteHex: defaultHexPalette(sheet?.look.palette),
    lightingNotes:
      sheet?.look.lighting?.trim() ||
      'motivated directional daylight with grounded ambient shadow floor and natural color spill',
    textureNotes:
      sheet?.look.texture?.trim() ||
      'fine natural filmic grain, authentic material surface and natural skin texture without waxy glare',
    subjectNotes:
      sheet?.subjects?.map((s) => `${s.count}× ${s.what}`).join('; ') ||
      references.map((r) => `${r.token}: ${r.visualNotes}`).join('; '),
    references,
    filmSummary: sheet
      ? {
          seconds: sheet.seconds,
          shotCount: sheet.shots.length,
          look: sheet.look,
          audio: sheet.audio,
        }
      : null,
  };
}

function safeClean(text: string, fallback: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed || containsInternalTerm(trimmed)) return fallback;
  return trimmed.slice(0, 280);
}

/**
 * Multimodal analyzer backed by `gemini-4-hydrogen` (`studioGeminiConfig`).
 * Inspects up to 9 attached `@imageN` thumbnails + cached `@video1` `FilmSheet`.
 */
export class GeminiFlashMediaAnalyzer implements MediaAnalyzer {
  readonly provider: DirectorProviderId = 'gemini-4-hydrogen';

  async analyze(input: MediaAnalyzeInput, deps: MediaAnalyzeDeps): Promise<MediaAnalysisDigest> {
    const base = deterministicDigest(this.provider, input, true);
    const config = studioGeminiConfig(deps.env);
    if (!config) {
      try {
        deps.onFallback?.('analyzer_no_key');
      } catch {
        // ignore logger errors
      }
      return base;
    }

    const parts: GeminiPart[] = [];
    let imageThumbCount = 0;
    let imageOrd = 0;
    for (const ref of input.references) {
      if (ref.kind !== 'image') continue;
      imageOrd += 1;
      if (imageThumbCount >= DIRECTOR_THUMBS_MAX) continue;
      if (!ref.thumb || !THUMB_MIMES.has(ref.thumb.mime) || ref.thumb.bytes.byteLength === 0) continue;
      const token = `@Image ${imageOrd}`;
      parts.push({
        text: `Attached ${token} ("${ref.label}"${ref.role ? `, role: ${ref.role}` : ''}):`,
      });
      parts.push(inlinePart(ref.thumb.bytes, ref.thumb.mime));
      imageThumbCount += 1;
    }

    if (imageThumbCount === 0) {
      return { ...base, fallbackUsed: false };
    }

    const contextPayload = {
      prompt: input.prompt.trim().slice(0, 800),
      references: base.references.map((r) => ({ token: r.token, kind: r.kind, role: r.role, notes: r.visualNotes })),
      film: input.sheet
        ? {
            seconds: input.sheet.seconds,
            look: input.sheet.look,
            audio: input.sheet.audio,
            shots: input.sheet.shots.slice(0, 20),
          }
        : null,
    };

    try {
      const raw = await callGeminiJson(config, deps.fetch, {
        system: `You are a cinematographer inspecting up to ${DIRECTOR_THUMBS_MAX} reference images and an optional reference video shot-sheet for a film director.
Extract concrete visual evidence in English:
- paletteHex: 3 to 4 exact #RRGGBB hex codes representing the shadow floor, primary surface/wardrobe, and key/accent tones.
- lightingNotes: motivated light source direction, shadow floor depth, and ambient color spill (no studio gear brand names).
- textureNotes: natural skin, fabric, prop, and lens texture (never use plastic or beauty-filter words).
- subjectNotes: concise physical description of people, wardrobe, and product geometry/labels.
- referenceNotes: one entry per @Image token describing what is visible in that image.
Return JSON only.`,
        parts: [{ text: JSON.stringify(contextPayload) }, ...parts],
        schema: MEDIA_ANALYSIS_RESPONSE_SCHEMA,
        thinking: 'LOW',
        timeoutMs: ANALYZE_TIMEOUT_MS,
      });

      const parsed = RawAnalysisSchema.safeParse(raw);
      if (!parsed.success) {
        deps.onFallback?.('analyzer_bad_shape');
        return base;
      }

      const hexes = parsed.data.paletteHex
        .map((h) => h.trim().toUpperCase())
        .filter((h) => HEX_RE.test(h))
        .slice(0, 4);

      const noteByToken = new Map<string, string>();
      for (const item of parsed.data.referenceNotes) {
        const key = item.token.replace(/\s+/g, '').toLowerCase();
        if (key && item.visualNotes.trim()) {
          noteByToken.set(key, item.visualNotes.trim());
        }
      }

      const enrichedRefs = base.references.map((r) => {
        const key = (r.token ?? '').replace(/\s+/g, '').toLowerCase();
        const modelNote = key ? noteByToken.get(key) : undefined;
        return modelNote && !containsInternalTerm(modelNote)
          ? { ...r, visualNotes: modelNote.slice(0, 220) }
          : r;
      });

      return {
        provider: this.provider,
        fallbackUsed: false,
        paletteHex: hexes.length >= 2 ? hexes : base.paletteHex,
        lightingNotes: safeClean(parsed.data.lightingNotes, base.lightingNotes),
        textureNotes: safeClean(parsed.data.textureNotes, base.textureNotes),
        subjectNotes: safeClean(parsed.data.subjectNotes, base.subjectNotes),
        references: enrichedRefs,
        filmSummary: base.filmSummary,
      };
    } catch (error) {
      try {
        const reason = error instanceof Error ? error.message : 'analyzer_failed';
        deps.onFallback?.(reason);
      } catch {
        // ignore logger errors
      }
      return base;
    }
  }
}

/**
 * Argon multimodal analyzer stub (`BRAND_STUDIO_DIRECTOR_PROVIDER=argon`).
 * When `ARGON_DIRECTOR_URL` / `BRAND_STUDIO_ARGON_ENDPOINT` is not configured yet (or errors),
 * gracefully falls back to `GeminiFlashMediaAnalyzer` without blocking generation.
 */
export class ArgonMediaAnalyzerStub implements MediaAnalyzer {
  readonly provider: DirectorProviderId = 'argon';
  private readonly fallbackAnalyzer: GeminiFlashMediaAnalyzer;

  constructor(fallbackAnalyzer = new GeminiFlashMediaAnalyzer()) {
    this.fallbackAnalyzer = fallbackAnalyzer;
  }

  async analyze(input: MediaAnalyzeInput, deps: MediaAnalyzeDeps): Promise<MediaAnalysisDigest> {
    const endpoint = deps.env.ARGON_DIRECTOR_URL?.trim() || deps.env.BRAND_STUDIO_ARGON_ENDPOINT?.trim();
    if (!endpoint) {
      try {
        deps.onFallback?.('argon_unconfigured');
      } catch {
        // ignore logger errors
      }
      return this.fallbackAnalyzer.analyze(input, deps);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ANALYZE_TIMEOUT_MS);
    try {
      const response = await deps.fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(deps.env.ARGON_API_KEY?.trim() ? { authorization: `Bearer ${deps.env.ARGON_API_KEY.trim()}` } : {}),
        },
        body: JSON.stringify({
          locale: input.locale,
          prompt: input.prompt.trim().slice(0, 800),
          referenceCount: input.references.length,
          film: input.sheet ?? null,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`argon_http_${response.status}`);
      const raw = await response.json();
      const parsed = RawAnalysisSchema.safeParse(raw);
      if (!parsed.success) throw new Error('argon_bad_shape');
      const base = deterministicDigest(this.provider, input, false);
      const hexes = parsed.data.paletteHex
        .map((h) => h.trim().toUpperCase())
        .filter((h) => HEX_RE.test(h))
        .slice(0, 4);
      return {
        ...base,
        provider: this.provider,
        fallbackUsed: false,
        paletteHex: hexes.length >= 2 ? hexes : base.paletteHex,
        lightingNotes: safeClean(parsed.data.lightingNotes, base.lightingNotes),
        textureNotes: safeClean(parsed.data.textureNotes, base.textureNotes),
        subjectNotes: safeClean(parsed.data.subjectNotes, base.subjectNotes),
      };
    } catch {
      try {
        deps.onFallback?.('argon_fallback_to_gemini');
      } catch {
        // ignore logger errors
      }
      return this.fallbackAnalyzer.analyze(input, deps);
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createMediaAnalyzer(env: Record<string, string | undefined>): MediaAnalyzer {
  return resolveDirectorProvider(env) === 'argon'
    ? new ArgonMediaAnalyzerStub()
    : new GeminiFlashMediaAnalyzer();
}
