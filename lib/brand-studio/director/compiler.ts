/**
 * Intent-triaged `Video-Creator` Seedance 2.5 `PromptCompiler` (docs/STUDIO-PRO-SUITE-V4.md §1.3).
 *
 * 3-Mode Triage (`classifyPromptIntent`):
 *  - `'passthrough'`: User already wrote a structured multi-segment prompt (`Visual style:`, `Reference authority:`,
 *    explicit `0.0s–` / `0–3s` shot markers, or >= 260 chars of technical camera/lighting direction) ->
 *    preserves user's prompt intact while binding `@Image N` / model tokens cleanly if needed.
 *  - `'slot_fill'`: Medium-detail prompt missing explicit reference authority or boundary cuts ->
 *    enriches missing slots without altering user's core action/story.
 *  - `'expand'`: Short Korean/English brief -> expands into a full `Video-Creator` Seedance 2.5 specification.
 *
 * Embeds core `seedance-film-director` rules:
 *  - Omits redundant boilerplate headers (`Create a Seedance video`, aspect ratio, resolution, FPS).
 *  - Structure: `Reference authority:` -> `Visual style:` (`#Hex` palette roles, motivated light & shadow floor,
 *    lens/material texture) -> seconds-based timeline (`0.0s–Xs` with `hard cut`, `match cut`, `continuous` handoffs).
 *  - Self-contained visible action/camera/lighting prose for `blueprint` adaptations (never `"same as original video"`).
 *  - Anti-plastic skin (`natural skin texture faithful to @Image 1, zero plastic/waxy beauty-filter glare`; with no
 *    image attached no `@Image` token at all — bans
 *    `"glass-skin"` / `"dewy highlighter"` tokens that cause SeedVR2 boiling).
 *  - Anti-composite lighting (`match ambient shadow floor and color spill, never pasted-on or flat front-lit`).
 *  - Off-axis eyelines & angle alternation (`18° / 45° / 90° / OTS`).
 *  - Strict No-BGM Default when `audio === 'on' | 'sfx' | 'ambient' | 'native'` (`diegetic Foley, room ambience and
 *    requested dialogue only — no background music, no score, no musical instruments`) unless the user's prompt
 *    explicitly asks for singing/music performance.
 *  - Never blocks generation: any Gemini timeout/HTTP error deterministically falls back to `composeDirectorFallbackPrompt`.
 */
import { dictatedSpans, guardRequest, type GuardedRequest } from '@/lib/ai-guard';
import { foldText, wordUnits } from '@/lib/ai-guard/text';
import type { StudioAudioMode } from '@/lib/brand-studio/contracts';
import { composeFallbackPrompt, effectiveSeconds, enhancePrompt, filterSubsumedDictated } from '@/lib/brand-studio/enhancer';
import { blueprintShots, isBlueprint } from '@/lib/brand-studio/enhancer/blueprint';
import { callGeminiJson, inlinePart, studioGeminiConfig, type GeminiPart } from '@/lib/brand-studio/enhancer/gemini';
import { planShots } from '@/lib/brand-studio/enhancer/lines';
import { enhanceMeta } from '@/lib/brand-studio/enhancer/meta';
import { bindReferences, mapCustomerMentions, type Binding } from '@/lib/brand-studio/enhancer/references';
import {
  cleanNotes,
  containsInternalTerm,
  ENHANCER_RESPONSE_SCHEMA,
  EnhancerOutputSchema,
  NOTES_MAX,
  tidyPrompt,
} from '@/lib/brand-studio/enhancer/schema';
import type { EnhanceInput, EnhanceResult } from '@/lib/brand-studio/enhancer/types';
import { brandSeedanceRulesV2Open } from '@/lib/flags';
import { createMediaAnalyzer, DIRECTOR_THUMBS_MAX, resolveDirectorProvider } from './analyzer';
import { loadDirectorPlaybooks, playbookRuleLines } from './playbooks';
import {
  buildSeedanceDirectorSystemInstructionV2,
  composeDirectorFallbackPromptV2,
  DIRECTOR_EXPLICIT_MUSIC_AUDIO_LINE,
  DIRECTOR_NO_BGM_CLAUSE,
  DIRECTOR_NO_BGM_REBUILT_TAIL,
  directorAllowV2,
  hasPersonInDirectorScene,
  isGarmentReference,
  requestsExplicitMusicPerformance,
  scrubSeedanceAntiPatternsV2,
  SEEDANCE_25_PROMPT_CHARS,
} from './rules-v2';
import type {
  DirectorAudioMode,
  DirectorCompileDeps,
  DirectorCompileInput,
  DirectorCompileResult,
  DirectorPlaybookRule,
  MediaAnalysisDigest,
  PromptCompiler,
  PromptIntentMode,
} from './types';

export { requestsExplicitMusicPerformance };

const COMPILE_TIMEOUT_MS = 25_000;
const THUMB_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const DIRECTOR_NO_BGM_AUDIO_LINE = `Audio: ${DIRECTOR_NO_BGM_CLAUSE}.`;

export const DIRECTOR_SCRUB_SKIN_PHRASE = 'natural skin texture with zero plastic beauty-filter glare';
export const DIRECTOR_V1_REFERENCE_AUTHORITY_PHRASE =
  'locking identity, exact facial bone structure, wardrobe, and product geometry/labels';
export const DIRECTOR_V1_PALETTE_ROLES_LIST = 'shadow floor, primary surface/wardrobe, key/accent';
export const DIRECTOR_V1_VISUAL_STYLE_PHRASE =
  'motivated light source & grounded shadow floor, lens feel, and material texture';
export const DIRECTOR_V1_ANTI_COMPOSITE_LIGHTING_PHRASE =
  'match ambient shadow floor and color spill across subject and environment';
export const DIRECTOR_V1_SKIN_WITH_REF_PHRASE =
  'natural skin texture faithful to @Image 1, zero plastic/waxy beauty-filter glare';
export const DIRECTOR_V1_SKIN_NO_REF_PHRASE = 'natural skin texture when people appear';
export const DIRECTOR_V1_SKIN_NO_GLARE_PHRASE = 'zero plastic/waxy beauty-filter glare';

const DIRECTOR_MODEL_NOTES = {
  ko: '참조 이미지와 컷 구성을 바탕으로 카메라·조명·사운드 연출을 정교하게 다듬었어요.',
  en: 'Refined camera staging, lighting, cut handoffs, and diegetic sound around your references.',
} as const;

const DIRECTOR_PASSTHROUGH_NOTES = {
  ko: '작성하신 상세 연출문을 그대로 유지하고 참조 표기만 정확히 연결했어요.',
  en: 'Kept your detailed direction intact and bound your attached reference tokens.',
} as const;

const DIRECTOR_FALLBACK_NOTES = {
  ko: '요청하신 장면에 참조 기준, 조명·질감, 컷 전환과 현장음 규칙을 안전하게 적용했어요.',
  en: 'Applied reference authority, natural lighting and skin rules, cut handoffs, and diegetic sound.',
} as const;

const STRUCTURED_HEADER_RE = /(?:^|\n)\s*(?:\*\*)?(?:visual\s+style|reference\s+authority)(?:\*\*)?\s*:/i;
const SHOT_TIMELINE_MARKER_RE =
  /(?:^|\n)\s*(?:\[[^\]]*\]\s*)?\d{1,3}(?:\.\d+)?\s*s?\s*[–—-]\s*\d{1,3}(?:\.\d+)?\s*s\b/im;
const TECHNICAL_DIRECTION_RE =
  /\b(?:camera|lens|focal|\d{2,3}\s*mm|lighting|key\s+light|rim\s+light|fill\s+light|shadow\s+floor|color\s+spill|palette|close-up|medium\s+shot|wide\s+shot|push\s+in|pull\s+back|dolly|orbit|pan|tilt|handheld|locked[- ]off|hard\s+cut|match\s+cut|continuous|ots|over[- ]the[- ]shoulder|eyeline|diegetic|foley|ambience)\b|#[0-9a-f]{6}\b|카메라|조명|클로즈업|미디엄\s*샷|와이드\s*샷|핸드헬드|달리|트래킹|패닝|틸트|하드\s*컷|매치\s*컷|시선|역광|측광/i;

const BANNED_PLASTIC_SKIN_RE =
  /\b(?:poreless\s+porcelain(?:\s+glass[- ]skin)?|glass[- ]skin|dewy\s+highlighter(?:\s+glow)?|silky[- ]smooth\s+poreless\s+skin|plastic\s+beauty[- ]filter|beauty[- ]diffused\s+xenon\s+flash)\b/gi;

const BANNED_SAME_AS_ORIGINAL_RE =
  /\b(?:same\s+as\s+(?:the\s+)?original\s+video|keep\s+(?:the\s+)?original\s+(?:video|camera\s+as\s+is)|identical\s+to\s+(?:the\s+)?source\s+video)\b/gi;

const REDUNDANT_HEADER_LINE_RE =
  /^\s*(?:create\s+a\s+seedance(?:\s+\d+(?:\.\d+)?)?\s+video[^.\n]*\.?|(?:aspect\s+ratio|resolution|frame\s*rate|fps|duration)\s*:\s*[^\n]+)\s*$/gim;

/**
 * Classifies customer prompt detail into one of 3 compilation modes:
 *  - `'passthrough'`: Structured multi-segment prompt (`Visual style:`, `Reference authority:`, explicit
 *    `0.0s–` / `0–3s` shot markers, or `>= 260` chars with technical camera/lighting direction).
 *  - `'slot_fill'`: Medium-detail prompt missing explicit reference authority or boundary cuts.
 *  - `'expand'`: Short Korean/English brief expanded into a full `Video-Creator` Seedance 2.5 specification.
 */
export function classifyPromptIntent(
  prompt: string,
  hasVideo = false,
  refCount = 0,
): PromptIntentMode {
  const trimmed = prompt.trim();
  if (!trimmed) return 'expand';

  if (STRUCTURED_HEADER_RE.test(trimmed) || SHOT_TIMELINE_MARKER_RE.test(trimmed)) {
    return 'passthrough';
  }
  if (trimmed.length >= 260 && TECHNICAL_DIRECTION_RE.test(trimmed)) {
    return 'passthrough';
  }

  const lineCount = trimmed.split(/\n+/).filter((l) => l.trim().length > 0).length;
  const sentenceCount = trimmed.split(/[.!?。]+/).filter((s) => s.trim().length > 0).length;
  const hasTechnicalCue = TECHNICAL_DIRECTION_RE.test(trimmed);

  if (
    trimmed.length >= 85 ||
    (trimmed.length >= 45 && (hasTechnicalCue || lineCount >= 2 || sentenceCount >= 2)) ||
    (trimmed.length >= 55 && (hasVideo || refCount > 0))
  ) {
    return 'slot_fill';
  }

  return 'expand';
}

export function normalizeDirectorAudioMode(mode: DirectorAudioMode | undefined): StudioAudioMode {
  switch (mode) {
    case 'off':
    case 'silent':
      return 'silent';
    case 'sfx':
    case 'ambient':
      return 'ambient';
    case 'on':
    case 'native':
    default:
      return 'native';
  }
}

function toEnhanceInput(
  input: DirectorCompileInput,
  extraRules: readonly string[],
): EnhanceInput {
  const existingRules = input.brand?.rules ?? [];
  const mergedRules = [...existingRules, ...extraRules].slice(0, 18);
  const brand =
    input.brand || mergedRules.length > 0
      ? {
          ...(input.brand ?? {}),
          rules: mergedRules,
        }
      : null;
  return {
    ...input,
    brand,
    video: input.video
      ? {
          ...input.video,
          audio: normalizeDirectorAudioMode(input.video.audio),
        }
      : null,
  };
}

/** Formats Seedance reference token with space (`@Image 1`) for `Video-Creator` house readability while staying provider-compatible. */
function spacedSeedanceToken(token: string | null): string | null {
  if (!token) return null;
  return token.replace(/^@(Image|Video|Audio)(\d+)$/i, (_m, kind: string, n: string) => `@${kind[0]!.toUpperCase()}${kind.slice(1).toLowerCase()} ${n}`);
}

/** `@Image1` -> `@Image 1` everywhere in a prompt (the spelling this director sends to Seedance). */
function spaceSeedanceTokens(text: string): string {
  return text.replace(/@(Image|Video|Audio)(\d+)\b/g, '@$1 $2');
}

/** `@Image 1` -> `@Image1`: the spelling the enhancer binds and checks references with. */
function unspaceSeedanceTokens(text: string): string {
  return text.replace(/@(Image|Video|Audio) (\d+)\b/g, '@$1$2');
}

/**
 * A new version of a generated clip (lib/brand-studio/revision) is not directed from scratch: the
 * prompt writer that knows how the clip was made (`revision.madeWith`, the earlier requests, the marks)
 * writes it, in the enhancer (enhancer/profiles/tasks.ts `revisionTask`). The earlier prompt usually
 * came from this director, so its tokens are handed over in the enhancer's spelling.
 */
const revisionUserText = (input: { prompt: string; video?: { change?: string } | null; revision?: EnhanceInput['revision'] }): string =>
  [input.prompt, input.revision?.clarified?.answer ?? '', input.video?.change ?? '', input.revision?.madeWith ?? '', ...(input.revision?.history ?? [])].join('\n');

function revisionEnhanceInput(enhanceInput: EnhanceInput): EnhanceInput {
  const revision = enhanceInput.revision!;
  // This director makes clips without background music unless a musical performance was asked for
  // (`enforceDirectorAudioPolicy`). The enhancer's `native` sound line would add "music that fits the
  // mood" and contradict the earlier prompt, so a revision is written with the no-music sound line.
  const noMusic = enhanceInput.video?.audio === 'native' && !requestsExplicitMusicPerformance(revisionUserText(enhanceInput));
  return {
    ...enhanceInput,
    video: enhanceInput.video ? { ...enhanceInput.video, audio: noMusic ? 'ambient' : enhanceInput.video.audio } : enhanceInput.video,
    revision: { ...revision, madeWith: unspaceSeedanceTokens(revision.madeWith), history: revision.history.map(unspaceSeedanceTokens) },
  };
}

/** One statement about sound is enough: a separate `Audio:` line after the text already said it is dropped. */
function dropRepeatedAudioLine(text: string): string {
  const kept: string[] = [];
  let stated = false;
  for (const line of text.split('\n')) {
    if (stated && /^[ \t]*(?:audio|sound)\s*:/i.test(line)) continue;
    if (/\b(?:audio|sound)\s*:/i.test(line)) stated = true;
    kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** What this director adds to a revision prompt: its token spelling and the audio policy. Nothing is re-directed. */
function finishRevisionPrompt(result: EnhanceResult, input: DirectorCompileInput): EnhanceResult {
  const spaced = dropRepeatedAudioLine(spaceSeedanceTokens(stripRedundantVideoHeaders(result.prompt)));
  // The revision writer already states the sound for the clip's audio mode. The audio policy is applied
  // only where it still has something to do (a silent clip, or a prompt that does not rule music out):
  // run over a line that already says "no music" it would only mangle that line.
  const audio = input.video?.audio ?? 'on';
  const silent = audio === 'off' || audio === 'silent';
  const rulesMusicOut = /\bno\s+(?:background\s+)?music\b/i.test(spaced);
  return { ...result, prompt: silent || !rulesMusicOut ? enforceDirectorAudioPolicy(spaced, audio, revisionUserText(input)) : spaced };
}

export function stripRedundantVideoHeaders(text: string): string {
  return text
    .replace(REDUNDANT_HEADER_LINE_RE, '')
    .replace(/^\s*create\s+a\s+seedance(?:\s+\d+(?:\.\d+)?)?\s+video\s*[:,-]?\s*/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function scrubSeedanceAntiPatterns(text: string, exempt = ''): string {
  let out = stripRedundantVideoHeaders(text);
  out = out.replace(BANNED_PLASTIC_SKIN_RE, (match) =>
    new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(exempt)
      ? match
      : DIRECTOR_SCRUB_SKIN_PHRASE,
  );
  out = out.replace(BANNED_SAME_AS_ORIGINAL_RE, (match) =>
    new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(exempt)
      ? match
      : 'steady motivated camera continuation',
  );
  return out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export function enforceDirectorAudioPolicy(
  prompt: string,
  audioMode: DirectorAudioMode | undefined,
  userPrompt: string,
): string {
  const audioLineRe = /^[ \t]*(?:\*\*)?(?:audio|sound)(?:\*\*)?\s*:.*$/gim;
  if (audioMode === 'off' || audioMode === 'silent') {
    return prompt.replace(audioLineRe, '').replace(/\n{3,}/g, '\n\n').trim();
  }

  const explicitMusic =
    audioMode !== 'sfx' && audioMode !== 'ambient' && requestsExplicitMusicPerformance(userPrompt);
  if (explicitMusic) {
    return audioLineRe.test(prompt)
      ? prompt
      : `${prompt.trim()}\n${DIRECTOR_EXPLICIT_MUSIC_AUDIO_LINE}`;
  }

  // Strict No-BGM Default for `on`, `sfx`, `ambient`, and `native` unless singing/music was explicitly requested.
  const existingLines = prompt.match(audioLineRe);
  if (!existingLines || existingLines.length === 0) {
    return `${prompt.trim()}\n${DIRECTOR_NO_BGM_AUDIO_LINE}`;
  }

  const first = existingLines[0]!;
  const body = first
    .replace(/^[ \t]*(?:\*\*)?(?:audio|sound)(?:\*\*)?\s*:\s*/i, '')
    .replace(
      /\b(?:with\s+)?(?:quiet\s+|soft\s+|gentle\s+|upbeat\s+|cinematic\s+)?(?:background\s+)?(?:music|score|soundtrack|bgm|melody|beat)[^.;]*[.;]?/gi,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.]+$/, '');

  const rebuilt = body
    ? /no\s+background\s+music/i.test(body)
      ? `Audio: ${body}.`
      : `Audio: ${body} — ${DIRECTOR_NO_BGM_REBUILT_TAIL}`
    : DIRECTOR_NO_BGM_AUDIO_LINE;

  return prompt.replace(first, rebuilt);
}

/**
 * Core `Video-Creator` (`seedance-film-director`) system specification for Seedance 2.5 compilation.
 */
export function buildSeedanceDirectorSystemInstruction(options: {
  intent: Exclude<PromptIntentMode, 'passthrough'>;
  seconds: number;
  blueprint: boolean;
  audioMode: DirectorAudioMode;
  explicitMusic: boolean;
  hasImageRefs: boolean;
  hasVideoRef: boolean;
  rulesV2?: boolean;
  hasPerson?: boolean;
  personTokens?: readonly string[];
  hasSeparateGarmentRef?: boolean;
}): string {
  if (options.rulesV2) {
    return buildSeedanceDirectorSystemInstructionV2(options);
  }
  const modeGuidance =
    options.intent === 'slot_fill'
      ? `Mode: SLOT-FILL. Preserve the user's exact story beats, subject actions, and spoken lines while filling missing Reference authority, Visual style (#Hex palette + lighting + skin/material texture), off-axis shot angles, explicit cut handoffs, and the Audio line.`
      : `Mode: EXPAND. Expand the user's brief into a complete, film-directed Seedance 2.5 sequence grounded in physical staging, motivated lighting, and cut rhythm.`;

  const audioInstruction =
    options.audioMode === 'off' || options.audioMode === 'silent'
      ? 'Audio rule: silent run. Write NO "Audio:" line and do not describe sound.'
      : options.explicitMusic
        ? 'Audio rule: write ONE "Audio:" line with room ambience, Foley, and the explicitly requested musical/vocal performance.'
        : `Audio rule (Strict No-BGM Default): write ONE "Audio:" line specifying ${DIRECTOR_NO_BGM_CLAUSE} (music is layered cleanly in Sequence Rail post-production).`;

  const blueprintRule = options.blueprint
    ? 'Blueprint adaptation rule: the reference video is NOT sent to the generator. Write 100% self-contained visible action, camera travel/pan-tilt/zoom, subject counts, and lighting prose. NEVER write "same as original video", "@Video1", or "keep original camera".'
    : options.hasVideoRef
      ? 'Reference video rule: bind @Video 1 / @Video1 for preserved motion/timing, and state every visible replacement clearly without vague "same as original video" shortcuts.'
      : 'Reference rule: bind only the attached @Image N / @Audio N tokens; invent no unattached tokens.';

  return `You are a veteran Film Director writing a production-ready Seedance 2.5 video prompt in English.
${modeGuidance}

Mandatory Seedance 2.5 Grammar & Quality Rules:
1. OMIT all redundant boilerplate headers: never write "Create a Seedance video", aspect ratio (9:16, 16:9), resolution (480p, 1080p, 4K), FPS, or model names.
2. Exact block order separated by line breaks:
   - "Reference authority:" (when references are attached) ${DIRECTOR_V1_REFERENCE_AUTHORITY_PHRASE} to ${options.hasImageRefs ? '@Image 1 (and any additional @Image N tokens)' : 'the attached references only'}.
   - "Visual style:" concrete #Hex color palette roles (${DIRECTOR_V1_PALETTE_ROLES_LIST}), ${DIRECTOR_V1_VISUAL_STYLE_PHRASE}.
   - Anti-composite lighting: ${DIRECTOR_V1_ANTI_COMPOSITE_LIGHTING_PHRASE} — never pasted-on or flat front-lit.
   - Anti-plastic skin: enforce ${options.hasImageRefs ? DIRECTOR_V1_SKIN_WITH_REF_PHRASE : `${DIRECTOR_V1_SKIN_NO_REF_PHRASE} (no image is attached: write no @Image token), ${DIRECTOR_V1_SKIN_NO_GLARE_PHRASE}`}. NEVER write "glass-skin", "poreless porcelain", or "dewy highlighter" (causes upscaler boiling).
   - Seconds-based timeline from 0.0s to ${options.seconds.toFixed(1)}s ("0.0s–Xs: …") with contiguous ranges, off-axis eyelines & camera angle alternation across cuts (18° / 45° / 90° / OTS — never repetitive flat passport front-stares), concrete camera start-to-end movement, and an explicit cut handoff at the end of every shot except the final shot ("hard cut", "match cut on …", or "continuous").
   - ${audioInstruction}
3. ${blueprintRule}
4. Spoken dialogue only when the user's brief provides words; keep spoken lines verbatim in quotes. Never expose internal tool, provider, or infrastructure names.
Return JSON matching { "prompt": string, "notes": string } where "notes" is one concise sentence in the user's language.`;
}

/** `@Image 1` / `@video2` tokens in `text`, as `image1` / `video2`. */
function referenceTokens(text: string): Set<string> {
  return new Set([...text.matchAll(/@(image|video)\s?(\d{1,2})\b/gi)].map((m) => `${m[1]!.toLowerCase()}${m[2]}`));
}

/** True when `written` names an `@Image N` / `@Video N` the customer's own words do not. */
function inventsReferenceToken(written: string, userText: string): boolean {
  const own = referenceTokens(userText);
  return [...referenceTokens(written)].some((token) => !own.has(token));
}

function buildPassthroughPrompt(input: DirectorCompileInput, binding: Binding): string {
  const rawCombined = [input.prompt.trim(), input.video?.change?.trim() ?? ''].filter(Boolean).join('\n');
  let boundText = mapCustomerMentions(rawCombined, binding.bound);
  boundText = boundText.replace(/@(image|video|audio)\s*(\d{1,2})\b/gi, (_m, w: string, n: string) => {
    return `@${w[0]!.toUpperCase()}${w.slice(1).toLowerCase()} ${n}`;
  });
  boundText = stripRedundantVideoHeaders(boundText);

  // Ensure attached image/video tokens that were not explicitly named in text still retain authority binding if needed.
  const attachedTokens = binding.bound
    .filter((b) => b.token && !(isBlueprint(toEnhanceInput(input, [])) && b.ref.kind === 'video'))
    .map((b) => spacedSeedanceToken(b.token)!)
    .filter(Boolean);

  if (
    input.profile === 'seedance' &&
    attachedTokens.length > 0 &&
    !/reference\s+authority\s*:/i.test(boundText) &&
    !attachedTokens.some((tok) => new RegExp(tok.replace(' ', '\\s?'), 'i').test(boundText))
  ) {
    boundText = `Reference authority: lock subject, product geometry, and surface fidelity to ${attachedTokens.join(', ')}.\n${boundText}`;
  }

  return boundText;
}

const ANGLE_CYCLE = [
  '18° off-axis medium close-up',
  '45° three-quarter medium shot',
  'OTS (over-the-shoulder) insert',
  '90° side-profile tracking shot',
] as const;

/**
 * Deterministic `Video-Creator` Seedance 2.5 fallback composer: never throws, never calls the network,
 * and embeds Reference authority, `#Hex` Visual style, anti-plastic skin, anti-composite lighting,
 * `18° / 45° / 90° / OTS` angle alternation, explicit `hard cut` / `match cut` / `continuous` handoffs,
 * and Strict No-BGM Default.
 */
export function composeDirectorFallbackPrompt(
  input: DirectorCompileInput,
  options: {
    analysis?: MediaAnalysisDigest | null;
    playbooks?: readonly DirectorPlaybookRule[];
    env?: Record<string, string | undefined>;
  } = {},
): EnhanceResult {
  const playbookLines = playbookRuleLines(options.playbooks ?? []);
  const enhanceInput = toEnhanceInput(input, playbookLines);
  const rulesV2 = brandSeedanceRulesV2Open(options.env);

  if (enhanceInput.profile !== 'seedance') {
    return composeFallbackPrompt(enhanceInput);
  }

  // A new version of a clip keeps the prompt it was made from: the enhancer's revision fallback, not a new direction.
  if (enhanceInput.revision) {
    const revised = finishRevisionPrompt(composeFallbackPrompt(revisionEnhanceInput(enhanceInput), { env: options.env }), input);
    return rulesV2 ? { ...revised, meta: enhanceMeta(enhanceInput, 'fallback', { env: options.env }) } : revised;
  }

  const binding = bindReferences(enhanceInput);
  const blueprint = isBlueprint(enhanceInput);
  const seconds = effectiveSeconds(enhanceInput.kind, enhanceInput.video) ?? 6;
  const rawRequest = mapCustomerMentions(enhanceInput.prompt.trim(), binding.bound);
  const rawChange = mapCustomerMentions(enhanceInput.video?.change?.trim() ?? '', binding.bound);
  const userText = `${enhanceInput.prompt}\n${enhanceInput.video?.change ?? ''}`;

  if (rulesV2) {
    const plannedV2 = blueprint
      ? blueprintShots(seconds, enhanceInput.video)
      : enhanceInput.kind === 'video_remix'
        ? planShots(seconds, enhanceInput.video)
        : [];
    return composeDirectorFallbackPromptV2({
      enhanceInput,
      binding,
      blueprint,
      seconds,
      rawRequest,
      rawChange,
      userText,
      playbookLines,
      planned: plannedV2,
      analysis: options.analysis,
      enforceAudio: enforceDirectorAudioPolicy,
      audioMode: input.video?.audio ?? 'on',
      locale: input.locale,
      notes: DIRECTOR_FALLBACK_NOTES[input.locale],
      env: options.env,
    });
  }

  const hexes =
    options.analysis?.paletteHex && options.analysis.paletteHex.length >= 2
      ? options.analysis.paletteHex
      : (enhanceInput.brand?.palette ?? []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).length >= 2
        ? (enhanceInput.brand?.palette ?? []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 4)
        : ['#1B1F24', '#D8CFC2', '#3875C5'];

  const shadowHex = hexes[0] ?? '#1B1F24';
  const surfaceHex = hexes[1] ?? '#D8CFC2';
  const accentHex = hexes[2] ?? '#3875C5';

  const imageTokens = binding.bound
    .filter((b) => b.token && b.ref.kind === 'image')
    .map((b) => spacedSeedanceToken(b.token)!);
  const videoToken = !blueprint
    ? spacedSeedanceToken(binding.bound.find((b) => b.token && b.ref.kind === 'video')?.token ?? null)
    : null;

  const lines: string[] = [];

  if (imageTokens.length > 0 || videoToken) {
    const parts: string[] = [];
    if (videoToken) {
      parts.push(`follow ${videoToken} for camera pacing and motion rhythm`);
    }
    if (imageTokens.length > 0) {
      parts.push(
        `lock identity, exact proportions, label geometry and surface details to ${imageTokens.join(', ')}; maintain natural skin texture faithful to ${imageTokens[0]}, zero plastic/waxy beauty-filter glare`,
      );
    }
    lines.push(`Reference authority: ${parts.join('; ')}.`);
  } else if (binding.seedanceMode === 'frames') {
    lines.push('Reference authority: start directly from the supplied opening frame, preserving its exact subject proportions and lighting.');
  }

  const lightingDesc =
    options.analysis?.lightingNotes ||
    enhanceInput.video?.sheet?.look.lighting ||
    'motivated directional key light';
  const textureDesc =
    options.analysis?.textureNotes ||
    enhanceInput.video?.sheet?.look.texture ||
    'organic lens roll-off and authentic material micro-texture';

  const skinClause =
    imageTokens.length > 0
      ? `Natural skin texture faithful to ${imageTokens[0]}, zero plastic/waxy beauty-filter glare.`
      : // No image attached: name no reference (a bare `@Image 1` is refused by the bar and sent to the provider).
        'Natural skin texture when people appear, zero plastic/waxy beauty-filter glare.';

  lines.push(
    `Visual style: palette anchored by ${shadowHex} shadow floor, ${surfaceHex} primary surfaces, and ${accentHex} key accents; ${lightingDesc}, match ambient shadow floor and color spill, never pasted-on or flat front-lit; ${textureDesc}. ${skinClause}`,
  );

  if (playbookLines.length > 0) {
    lines.push(`Brand direction: ${playbookLines[0]}`);
  }

  const coreAction = scrubSeedanceAntiPatterns(
    [rawChange ? `Adaptation: ${rawChange}` : '', rawRequest].filter(Boolean).join('. ') ||
      'The subject moves naturally through the space in continuous physical motion',
    userText,
  ).replace(/\.+$/, '');

  const planned = blueprint
    ? blueprintShots(seconds, enhanceInput.video)
    : enhanceInput.kind === 'video_remix'
      ? planShots(seconds, enhanceInput.video)
      : [];

  if (planned.length > 0) {
    planned.forEach((shot, idx) => {
      const isLast = idx === planned.length - 1;
      const angle = ANGLE_CYCLE[idx % ANGLE_CYCLE.length];
      const actionText = scrubSeedanceAntiPatterns(
        `${shot.framing || angle}, ${shot.action || coreAction}; camera: ${shot.camera || 'steady motivated push-in'}`,
        userText,
      ).replace(/\.+$/, '');
      const rawTransition = 'transition' in shot && typeof shot.transition === 'string' ? shot.transition : '';
      const handoff = isLast
        ? 'Settling on the final resting frame.'
        : /continuous|no cut/i.test(rawTransition)
          ? 'Continuous handoff into the next shot.'
          : /match/i.test(rawTransition)
            ? 'Match cut on motion vector.'
            : 'Hard cut.';
      lines.push(`${shot.start.toFixed(1)}s–${shot.end.toFixed(1)}s: ${angle} (${actionText}) with off-axis eyeline. ${handoff}`);
    });
  } else if (seconds > 5) {
    const mid = Math.round(seconds * 0.45 * 10) / 10;
    const secondSplit = Math.round(seconds * 0.78 * 10) / 10;
    lines.push(
      `0.0s–${mid.toFixed(1)}s: 18° off-axis medium shot with natural off-axis eyeline — ${coreAction}; camera glides in with gentle parallax. Hard cut.`,
    );
    lines.push(
      `${mid.toFixed(1)}s–${secondSplit.toFixed(1)}s: 45° three-quarter close-up — physical interaction continues with grounded weight and natural material response; subtle handheld tracking. Match cut on motion.`,
    );
    lines.push(
      `${secondSplit.toFixed(1)}s–${seconds.toFixed(1)}s: OTS / 90° profile payoff — action completes cleanly and settles into a composed final frame; slow locked-off hold.`,
    );
  } else {
    lines.push(
      `0.0s–${seconds.toFixed(1)}s: 18° to 45° off-axis medium shot with natural off-axis eyeline — ${coreAction}; smooth camera push-in settling cleanly on the final frame.`,
    );
  }

  const audioMode = input.video?.audio ?? 'on';
  const joined = enforceDirectorAudioPolicy(lines.join('\n'), audioMode, userText);

  return {
    prompt: joined,
    notes: DIRECTOR_FALLBACK_NOTES[input.locale],
    source: 'fallback',
  };
}

/** The customer's label in a picture caption goes through `guard.data` (unchanged with the guard off). */
function directorThumbParts(binding: Binding, guard: GuardedRequest): GeminiPart[] {
  const parts: GeminiPart[] = [];
  let count = 0;
  for (const b of binding.bound) {
    if (count >= DIRECTOR_THUMBS_MAX) break;
    const thumb = b.ref.thumb;
    if (!thumb || b.ref.kind !== 'image' || !THUMB_MIMES.has(thumb.mime) || thumb.bytes.byteLength === 0) continue;
    const label = spacedSeedanceToken(b.token) ?? b.name;
    parts.push({
      text: `Attached ${label} ("${guard.data('label', b.ref.label)}"${b.ref.role ? `, ${b.ref.role}` : ''}):`,
    });
    parts.push(inlinePart(thumb.bytes, thumb.mime));
    count += 1;
  }
  return parts;
}

/** Output phrases the v1 director rules tell the model to write into the prompt (scoped to ref/audio state). */
export function directorV1OutputPhrases(options: {
  hasImageRefs: boolean;
  audioMode: DirectorAudioMode;
  explicitMusic: boolean;
}): string[] {
  const out: string[] = [
    DIRECTOR_SCRUB_SKIN_PHRASE,
    DIRECTOR_V1_REFERENCE_AUTHORITY_PHRASE,
    `(${DIRECTOR_V1_PALETTE_ROLES_LIST}), ${DIRECTOR_V1_VISUAL_STYLE_PHRASE}`,
    DIRECTOR_V1_ANTI_COMPOSITE_LIGHTING_PHRASE,
    ...(options.hasImageRefs
      ? [DIRECTOR_V1_SKIN_WITH_REF_PHRASE]
      : [DIRECTOR_V1_SKIN_NO_REF_PHRASE, DIRECTOR_V1_SKIN_NO_GLARE_PHRASE]),
  ];
  if (options.audioMode !== 'off' && options.audioMode !== 'silent') {
    if (options.explicitMusic) {
      out.push(DIRECTOR_EXPLICIT_MUSIC_AUDIO_LINE);
    } else {
      out.push(DIRECTOR_NO_BGM_AUDIO_LINE, DIRECTOR_NO_BGM_CLAUSE, DIRECTOR_NO_BGM_REBUILT_TAIL);
    }
  }
  return out;
}

/**
 * Our fixed lines that are meant to appear in a directed prompt (the prompt guard's allow-list for this
 * director): the audio lines `enforceDirectorAudioPolicy` writes, the skin phrase the scrub writes, every
 * phrase the rules tell the model to write, and this input's deterministic fallback, which the customer
 * reads whenever the director fails anyway.
 */
export function directorAllow(
  input: DirectorCompileInput,
  system: string,
  analysis: MediaAnalysisDigest | null = null,
  playbooks: readonly DirectorPlaybookRule[] = [],
  env: Record<string, string | undefined> = process.env,
): string[] {
  let fallbackText = '';
  try {
    fallbackText = composeDirectorFallbackPrompt(input, { analysis, playbooks, env }).prompt;
  } catch {
    fallbackText = '';
  }
  const playbookLines = playbookRuleLines(playbooks);
  const binding = bindReferences(toEnhanceInput(input, playbookLines));
  const hasImageRefs = binding.bound.some((b) => b.token && b.ref.kind === 'image');
  const audioMode: DirectorAudioMode = input.video?.audio ?? 'on';
  const userText = `${input.prompt}\n${input.video?.change ?? ''}`;
  const explicitMusic =
    audioMode !== 'sfx' && audioMode !== 'ambient' && requestsExplicitMusicPerformance(userText);

  const explicit = directorV1OutputPhrases({ hasImageRefs, audioMode, explicitMusic });
  const dictated = filterSubsumedDictated(explicit, dictatedSpans(system), system);
  return [
    ...new Set(
      [
        ...explicit,
        ...dictated,
        fallbackText,
      ].filter((s) => s.length > 0 && wordUnits(foldText(s)).length >= 4),
    ),
  ];
}

export class DefaultPromptCompiler implements PromptCompiler {
  classifyIntent(prompt: string, hasVideo = false, refCount = 0): PromptIntentMode {
    return classifyPromptIntent(prompt, hasVideo, refCount);
  }

  async compile(input: DirectorCompileInput, deps: DirectorCompileDeps): Promise<DirectorCompileResult> {
    const provider = resolveDirectorProvider(deps.env);
    const hasVideo = Boolean(input.video?.sheet || input.references.some((r) => r.kind === 'video'));
    const intent = this.classifyIntent(input.prompt, hasVideo, input.references.length);
    const playbooks = await loadDirectorPlaybooks(deps.sql, deps.organizationId);
    const playbookLines = playbookRuleLines(playbooks);
    const enhanceInput = toEnhanceInput(input, playbookLines);
    const binding = bindReferences(enhanceInput);
    const rulesV2 = brandSeedanceRulesV2Open(deps.env);

    // 0. A new version of a generated clip: written from the clip's own history, never re-directed
    //    (a request such as "make the bottle green" is not a scene to direct). See `revisionEnhanceInput`.
    if (enhanceInput.revision && enhanceInput.profile === 'seedance') {
      const revised = await enhancePrompt(revisionEnhanceInput(enhanceInput), deps);
      return {
        ...finishRevisionPrompt(revised, input),
        intent: 'slot_fill',
        provider,
        analysis: null,
        playbooksApplied: playbooks.length,
      };
    }

    // 1. Passthrough mode: preserve structured user prompt intact, binding @Image N tokens cleanly.
    if (intent === 'passthrough') {
      const passthroughPrompt = buildPassthroughPrompt(input, binding);
      return {
        prompt: passthroughPrompt,
        notes: DIRECTOR_PASSTHROUGH_NOTES[input.locale],
        source: 'fallback',
        intent: 'passthrough',
        provider,
        analysis: null,
        playbooksApplied: playbooks.length,
      };
    }

    // 2. Non-Seedance (still image / region edit) delegates to the model-profiled enhancer with playbooks & 9-thumb support.
    if (enhanceInput.profile !== 'seedance') {
      const imageResult = await enhancePrompt(enhanceInput, deps);
      return {
        ...imageResult,
        intent,
        provider,
        analysis: null,
        playbooksApplied: playbooks.length,
      };
    }

    // 3. Seedance 2.5 Multimodal Video-Creator Director (`slot_fill` | `expand`).
    const analyzer = deps.analyzer ?? createMediaAnalyzer(deps.env);
    const shouldAnalyze =
      Boolean(input.video?.sheet) ||
      input.references.some((r) => r.kind === 'image' && Boolean(r.thumb));
    const analysis = shouldAnalyze
      ? await analyzer.analyze(
          {
            locale: input.locale,
            prompt: input.prompt,
            references: input.references,
            sheet: input.video?.sheet ?? null,
          },
          { fetch: deps.fetch, env: deps.env, onFallback: deps.onFallback },
        )
      : null;

    const fallback = (reason: string): DirectorCompileResult => {
      try {
        deps.onFallback?.(reason);
      } catch {
        // ignore logger errors
      }
      const fb = composeDirectorFallbackPrompt(input, { analysis, playbooks, env: deps.env });
      return {
        ...fb,
        ...(rulesV2
          ? {
              meta: {
                ...(fb.meta ?? enhanceMeta(enhanceInput, 'fallback', { env: deps.env })),
                fallbackReason: reason,
              },
            }
          : {}),
        intent,
        provider,
        analysis,
        playbooksApplied: playbooks.length,
      };
    };

    const config = studioGeminiConfig(deps.env);
    if (!config) return fallback('no_key');

    const blueprint = isBlueprint(enhanceInput);
    if (!input.prompt.trim() && !input.video?.change?.trim() && !blueprint) {
      return fallback('empty_prompt');
    }

    const seconds = effectiveSeconds(enhanceInput.kind, enhanceInput.video) ?? 6;
    const audioMode: DirectorAudioMode = input.video?.audio ?? 'on';
    const userText = `${input.prompt}\n${input.video?.change ?? ''}`;
    const explicitMusic =
      audioMode !== 'sfx' && audioMode !== 'ambient' && requestsExplicitMusicPerformance(userText);

    const personTokens = rulesV2
      ? binding.bound
          .filter((b) => b.token && b.ref.kind === 'image' && b.ref.role === 'person')
          .map((b) => spacedSeedanceToken(b.token)!)
      : [];
    const system = buildSeedanceDirectorSystemInstruction({
      intent,
      seconds,
      blueprint,
      audioMode,
      explicitMusic,
      hasImageRefs: binding.bound.some((b) => b.token && b.ref.kind === 'image'),
      hasVideoRef: !blueprint && binding.bound.some((b) => b.token && b.ref.kind === 'video'),
      ...(rulesV2
        ? {
            rulesV2: true,
            hasPerson: hasPersonInDirectorScene(input, analysis),
            personTokens,
            hasSeparateGarmentRef: binding.bound.some((b) => b.token && b.ref.kind === 'image' && isGarmentReference(b.ref)),
          }
        : {}),
    });

    const plannedShots = blueprint
      ? blueprintShots(seconds, enhanceInput.video)
      : enhanceInput.kind === 'video_remix'
        ? planShots(seconds, enhanceInput.video)
        : [];

    const userPayload = {
      intent,
      request: mapCustomerMentions(input.prompt.trim(), binding.bound),
      change: input.video?.change?.trim() ? mapCustomerMentions(input.video.change.trim(), binding.bound) : null,
      customerLanguage: input.locale,
      seconds,
      audioMode,
      references: binding.bound
        .filter((b) => b.token || binding.seedanceMode === 'frames')
        .map((b) => ({
          token: spacedSeedanceToken(b.token),
          role: b.ref.role ?? null,
          label: b.ref.label,
          take: b.ref.use?.trim() || null,
          avoid: b.ref.avoid?.trim() || null,
          frame: b.ref.frame ?? null,
        })),
      mediaDigest: analysis
        ? {
            paletteHex: analysis.paletteHex,
            lightingNotes: analysis.lightingNotes,
            textureNotes: analysis.textureNotes,
            subjectNotes: analysis.subjectNotes,
            filmSummary: analysis.filmSummary,
          }
        : null,
      shots: plannedShots.length > 0 ? plannedShots : null,
      brand: enhanceInput.brand ?? null,
      playbooks: playbookLines,
    };

    // The prompt guard (lib/ai-guard, docs/PROMPT-GUARD.md): canary + one shared rule on the system part,
    // the customer's material in named data blocks. With PROMPT_GUARD=off the request is byte for byte as before.
    const guard = guardRequest({ site: 'brand-studio.director', env: deps.env, internal: system });

    try {
      const raw = await callGeminiJson(config, deps.fetch, {
        system: guard.system,
        parts: guard.parts([{ text: guard.json('request', userPayload) }, ...directorThumbParts(binding, guard)]),
        schema: ENHANCER_RESPONSE_SCHEMA,
        thinking: 'LOW',
        timeoutMs: COMPILE_TIMEOUT_MS,
      });

      const parsed = EnhancerOutputSchema.safeParse(raw);
      if (!parsed.success) return fallback('bad_shape');

      let cleaned = tidyPrompt(parsed.data.prompt, userText);
      cleaned = rulesV2
        ? scrubSeedanceAntiPatternsV2(cleaned, userText, stripRedundantVideoHeaders)
        : scrubSeedanceAntiPatterns(cleaned, userText);
      if (cleaned.length < 20) return fallback('too_short');
      if (rulesV2 && cleaned.length > SEEDANCE_25_PROMPT_CHARS) return fallback('too_long');
      if (containsInternalTerm(cleaned, userText)) return fallback('internal_term');

      cleaned = enforceDirectorAudioPolicy(cleaned, audioMode, userText);
      if (rulesV2 && cleaned.length > SEEDANCE_25_PROMPT_CHARS) return fallback('too_long');

      // A run with no image or video reference at all (start/end frames are image references, so they are
      // untouched): a token the model invented is refused by the bar and sent to the provider as is.
      if (!input.references.some((r) => r.kind === 'image' || r.kind === 'video') && inventsReferenceToken(cleaned, userText)) {
        return fallback('unbound_token');
      }

      const notes = cleanNotes(parsed.data.notes, input.locale, DIRECTOR_MODEL_NOTES[input.locale]);
      // The outgoing check, on exactly what would be shown, stored and sent. A refused prompt answers this
      // director's own fallback (as any failed check above); a refused note answers the default note.
      const verdict = guard.check(
        { prompt: cleaned, notes },
        {
          // The customer's own words: request, change, reference notes, brand notes and playbooks.
          exempt: [
            userText,
            ...input.references.map((r) => `${r.label}\n${r.use ?? ''}\n${r.avoid ?? ''}`),
            enhanceInput.brand?.name ?? '',
            enhanceInput.brand?.tone ?? '',
            ...(enhanceInput.brand?.rules ?? []),
          ],
          allow: rulesV2
            ? directorAllowV2(
                input,
                binding,
                guard.system,
                analysis,
                playbooks,
                composeDirectorFallbackPrompt,
                DIRECTOR_NO_BGM_AUDIO_LINE,
                deps.env,
              )
            : directorAllow(input, guard.system, analysis, playbooks, deps.env),
          shapes: { prompt: { noMarkup: true }, notes: { maxChars: NOTES_MAX, oneSentence: true } },
        },
      );
      if (verdict.blocked.includes('prompt')) return fallback(`prompt_guard_${verdict.reason}`);

      return {
        prompt: cleaned,
        notes: verdict.blocked.includes('notes') ? DIRECTOR_MODEL_NOTES[input.locale] : notes,
        source: 'model',
        ...(rulesV2 ? { meta: enhanceMeta(enhanceInput, 'model', { llmModel: config.model, env: deps.env }) } : {}),
        intent,
        provider,
        analysis,
        playbooksApplied: playbooks.length,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'request_failed';
      return fallback(/^gemini_[a-z0-9_]+$/.test(reason) ? reason : 'request_failed');
    }
  }
}

export async function compileDirectorPrompt(
  input: DirectorCompileInput,
  deps: DirectorCompileDeps,
): Promise<DirectorCompileResult> {
  const compiler = new DefaultPromptCompiler();
  return compiler.compile(input, deps);
}
