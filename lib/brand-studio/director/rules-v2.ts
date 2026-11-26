/**
 * Brand-studio Seedance 2.5 video prompt rules v2 (`BRAND_SEEDANCE_RULES_V2=on`,
 * docs/SEEDANCE-BRIDGE-2026-11-26.md SB-2).
 *
 * Kept alongside v1 code paths so `BRAND_SEEDANCE_RULES_V2` unset/off stays byte-identical to `origin/main`.
 */
import { dictatedSpans } from '@/lib/ai-guard';
import { foldText, wordUnits } from '@/lib/ai-guard/text';
import { enhanceMeta } from '@/lib/brand-studio/enhancer/meta';
import {
  SEEDANCE_V2_EDITORIAL_MOTION_LIST,
  SEEDANCE_VIDEO_FILM_EXPOSURE_FORMULA,
  SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA,
  sleeveVolumeLine,
} from '@/lib/brand-studio/enhancer/profiles/seedance';
import { mentionsPerson } from '@/lib/brand-studio/enhancer/profiles/skin';
import type { Binding, BoundReference } from '@/lib/brand-studio/enhancer/references';
import type { EnhanceInput, EnhanceReference, EnhanceResult } from '@/lib/brand-studio/enhancer/types';
import { guessDirectorCameraGenre, type DirectorCameraGenre } from './genre';
import type {
  DirectorAudioMode,
  DirectorCompileInput,
  DirectorPlaybookRule,
  MediaAnalysisDigest,
  PromptIntentMode,
} from './types';

/** Official Seedance 2.5 prompt ceiling per clip (characters). */
export const SEEDANCE_25_PROMPT_CHARS = 15_000;

export const DIRECTOR_HEADER_V1 = { id: 'seedance-director', version: '2026-11-15.1' } as const;
export const DIRECTOR_HEADER_V2 = { id: 'seedance-director', version: '2026-11-27.1' } as const;

/** Returns the active director rule-set version (`2026-11-15.1` off, `2026-11-27.1` on). */
export function directorRulesVersion(env: Record<string, string | undefined> = process.env): string {
  return env.BRAND_SEEDANCE_RULES_V2 === 'on' ? DIRECTOR_HEADER_V2.version : DIRECTOR_HEADER_V1.version;
}

export {
  SEEDANCE_V2_EDITORIAL_MOTION_LIST as DIRECTOR_V2_EDITORIAL_MOTION_LIST,
  SEEDANCE_VIDEO_FILM_EXPOSURE_FORMULA,
  SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA,
  sleeveVolumeLine,
};

export const DIRECTOR_NO_BGM_CLAUSE =
  'diegetic Foley, room ambience and requested dialogue only — no background music, no score, no musical instruments';
export const DIRECTOR_NO_BGM_REBUILT_TAIL =
  'diegetic Foley, room ambience and requested dialogue only; no background music, no score, no musical instruments.';
export const DIRECTOR_EXPLICIT_MUSIC_AUDIO_LINE =
  'Audio: live diegetic room sound, Foley and the requested musical performance.';

export const DIRECTOR_V2_SAFE_MATTE_SKIN = 'natural unretouched matte-satin skin';
export const DIRECTOR_V2_PALETTE_ROLES_LIST = 'shadow floor, primary surfaces, key accent';
export const DIRECTOR_V2_LIGHTING_PRODUCT_PHRASE =
  'motivated light matching ambient shadow floor and color spill';
export const DIRECTOR_V2_DYNAMIC_CAMERA_LIST =
  'Steadicam tracking, crane sweep, 45°–180° orbital arc, FPV push-in';
export const DIRECTOR_V2_EXCLUSIONS_PHRASE = 'off-axis gaze and no on-screen text or watermarks';

const EXPLICIT_MUSIC_PERFORMANCE_RE =
  /\b(?:sing(?:s|ing)?|singer|vocal(?:s|ist)?|song|bgm|background\s+music|soundtrack|musical\s+score|live\s+band|concert|choir|rap(?:ping)?|guitar\s+solo|playing\s+(?:the\s+)?(?:piano|guitar|violin|drums|cello|saxophone)|music\s+video|dance\s+to\s+the\s+beat)\b|노래|보컬|가창|연주|배경\s*음악|뮤직\s*비디오|음악에\s*맞춰/i;

/** True only when the user's own prompt explicitly asks for singing, musical instruments, or music/BGM. */
export function requestsExplicitMusicPerformance(prompt: string): boolean {
  const strippedNegations = prompt.replace(
    /\b(?:no|without|zero|never)\s+(?:background\s+)?(?:music|bgm|score|singing|instruments?)\b/gi,
    ' ',
  );
  return EXPLICIT_MUSIC_PERFORMANCE_RE.test(strippedNegations);
}

const NO_PERSON_RE =
  /(?:사람|인물|모델|사람은|인물은)\s*(?:없이|없는|없음|없게|빼고|제외)|\bno\s+(?:people|person|humans?|models?)\b|\bwithout\s+(?:people|a\s+person|anyone|humans?|models?)\b|\bproduct\s+only\b/i;

const GARMENT_REF_RE =
  /의상|옷|코트|재킷|자켓|드레스|원피스|셔츠|블라우스|스웨터|니트|상의|하의|팬츠|바지|스커트|치마|수트|정장|착장|\b(?:garment|wardrobe|outfit|clothing|apparel|dress|coat|jacket|blazer|shirt|blouse|sweater|knit|top|skirt|trousers|pants|suit|ghost[- ]?mannequin)\b/i;

export function isGarmentReference(ref: Pick<EnhanceReference, 'role' | 'use' | 'label'>): boolean {
  if (ref.role === 'person' || ref.role === 'logo' || ref.role === 'style' || ref.role === 'place') return false;
  return GARMENT_REF_RE.test([ref.use ?? '', ref.label ?? ''].join(' '));
}

export function hasPersonInDirectorScene(
  input: Pick<DirectorCompileInput, 'prompt' | 'references' | 'video'>,
  analysis?: MediaAnalysisDigest | null,
): boolean {
  if (input.references.some((r) => r.kind === 'image' && r.role === 'person')) {
    return true;
  }
  const userWords = [input.prompt, input.video?.change ?? '', ...input.references.map((r) => r.use ?? '')].join('\n');
  if (NO_PERSON_RE.test(userWords)) {
    return false;
  }
  if (mentionsPerson(userWords)) {
    return true;
  }
  const sheetText = [
    ...(input.video?.sheet?.subjects?.map((s) => s.what) ?? []),
    ...(input.video?.sheet?.shots?.map((s) => s.action) ?? []),
  ].join('\n');
  if (sheetText && mentionsPerson(sheetText)) {
    return true;
  }
  if (analysis?.subjectNotes && mentionsPerson(analysis.subjectNotes)) {
    return true;
  }
  return false;
}

const GLOSSY_TERM =
  '(?:poreless\\s+porcelain(?:\\s+glass[- ]skin)?|porcelain(?:\\s+skin)?|glass[- ]skin|dewy(?:\\s+(?:highlighter(?:\\s+glow)?|glow|skin))?|flawless(?:\\s+skin)?|poreless(?:\\s+skin)?|silky[- ]smooth\\s+poreless\\s+skin|plastic\\s+beauty[- ]filter(?:\\s+glare)?|beauty[- ]diffused\\s+xenon\\s+flash)';

const NEGATED_GLOSSY_RE = new RegExp(
  `\\b(?:no|without|never|avoid|zero|free\\s+of)\\s+(?:artificial\\s+|excessive\\s+|heavy\\s+)?${GLOSSY_TERM}\\b`,
  'gi',
);
const BARE_GLOSSY_RE = new RegExp(`\\b${GLOSSY_TERM}\\b`, 'gi');

const BANNED_SAME_AS_ORIGINAL_RE =
  /\b(?:same\s+as\s+(?:the\s+)?original\s+video|keep\s+(?:the\s+)?original\s+(?:video|camera\s+as\s+is)|identical\s+to\s+(?:the\s+)?source\s+video)\b/gi;

const SAFE_MATTE_SKIN = DIRECTOR_V2_SAFE_MATTE_SKIN;

function isExemptMatch(match: string, exempt: string): boolean {
  if (!exempt) return false;
  return new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(exempt);
}

/**
 * Strips redundant headers, `"same as original video"` shortcuts, and all banned glossy-skin buzzwords
 * (`porcelain`, `glass-skin`, `dewy`, `flawless`, `poreless`, etc.) while keeping the canonical
 * `SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA` and `SEEDANCE_VIDEO_FILM_EXPOSURE_FORMULA` intact.
 */
export function scrubSeedanceAntiPatternsV2(
  text: string,
  exempt = '',
  stripHeaders: (value: string) => string = defaultStripHeaders,
): string {
  let out = stripHeaders(text);
  out = out.replace(NEGATED_GLOSSY_RE, (match) =>
    isExemptMatch(match, exempt) ? match : SAFE_MATTE_SKIN,
  );
  out = out.replace(BARE_GLOSSY_RE, (match) =>
    isExemptMatch(match, exempt) ? match : SAFE_MATTE_SKIN,
  );
  out = out.replace(
    new RegExp(`${SAFE_MATTE_SKIN}(?:\\s*(?:,|and|or)\\s*${SAFE_MATTE_SKIN})+`, 'gi'),
    SAFE_MATTE_SKIN,
  );
  out = out.replace(BANNED_SAME_AS_ORIGINAL_RE, (match) =>
    isExemptMatch(match, exempt) ? match : 'steady motivated camera continuation',
  );
  return out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

const REDUNDANT_HEADER_LINE_RE =
  /^\s*(?:create\s+a\s+seedance(?:\s+\d+(?:\.\d+)?)?\s+video[^.\n]*\.?|(?:aspect\s+ratio|resolution|frame\s*rate|fps|duration)\s*:\s*[^\n]+)\s*$/gim;

function defaultStripHeaders(text: string): string {
  return text
    .replace(REDUNDANT_HEADER_LINE_RE, '')
    .replace(/^\s*create\s+a\s+seedance(?:\s+\d+(?:\.\d+)?)?\s+video\s*[:,-]?\s*/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildSeedanceDirectorSystemInstructionV2(options: {
  intent: Exclude<PromptIntentMode, 'passthrough'>;
  seconds: number;
  blueprint: boolean;
  audioMode: DirectorAudioMode;
  explicitMusic: boolean;
  hasImageRefs: boolean;
  hasVideoRef: boolean;
  hasPerson?: boolean;
  personTokens?: readonly string[];
  hasSeparateGarmentRef?: boolean;
}): string {
  const hasPerson = options.hasPerson ?? true;
  const personTokens = options.personTokens ?? [];

  const modeGuidance =
    options.intent === 'slot_fill'
      ? 'Mode: SLOT-FILL. Keep the user story beats, subjects, and dialogue while filling missing Reference authority, Visual style (#Hex palette, exposure, and lighting), genre-appropriate camera work, cut handoffs, and the Audio line.'
      : 'Mode: EXPAND. Expand the brief into a complete Seedance 2.5 sequence grounded in physical staging, motivated lighting, and cut rhythm.';

  const audioInstruction =
    options.audioMode === 'off' || options.audioMode === 'silent'
      ? 'Audio rule: silent run. Write NO "Audio:" line and do not describe sound.'
      : options.explicitMusic
        ? 'Audio rule: write ONE "Audio:" line with room ambience, Foley, and the explicitly requested musical/vocal performance.'
        : `Audio rule (Strict No-BGM Default): write ONE "Audio:" line specifying ${DIRECTOR_NO_BGM_CLAUSE} (music is layered cleanly in Sequence Rail post-production).`;

  const blueprintRule = options.blueprint
    ? 'Blueprint adaptation rule: the reference video is NOT sent to the generator. Write 100% self-contained visible action, camera travel/pan-tilt/zoom, subject counts, and lighting prose. Never write "same as original video" or a video token.'
    : options.hasVideoRef
      ? 'Reference video rule: bind @Video 1 / @Video1 for preserved motion/timing, and state every visible replacement clearly.'
      : 'Reference binding rule: bind only attached @Image N / @Audio N tokens; invent no unattached tokens.';

  let referenceAuthorityRule: string;
  if (!options.hasImageRefs) {
    referenceAuthorityRule =
      '   - "Reference authority:" only when a video/audio token is attached (no image references are attached here, so write zero image tokens). Describe wardrobe and subjects in text.';
  } else {
    const sleeveDirective =
      personTokens.length > 0
        ? `For ${personTokens.join(', ')}, state face and hair authority only (never body proportions, background, lighting, or casual clothing), and include once: "${personTokens.map(sleeveVolumeLine).join('; ')}".`
        : `When an attached image shows a person, state face and hair authority only (never body proportions, background, lighting, or casual clothing), and include once: "${sleeveVolumeLine('<person @Image token>')}".`;
    const wardrobeClause = options.hasSeparateGarmentRef
      ? 'A person reference supplies face and hair; the separate clothing reference supplies wardrobe only (exact silhouette, tailoring, fabric, and colour; never face or skin).'
      : "A person reference supplies face and hair; wardrobe comes from the brief's words unless a separate clothing reference is bound (in which case the separate clothing reference supplies wardrobe only).";
    referenceAuthorityRule = `   - "Reference authority:" ${wardrobeClause} ${sleeveDirective} Keep product/logo/style/place tokens concise by role.`;
  }

  const visualStyleRule = hasPerson
    ? `   - "Visual style:" write ONE block for the whole prompt (never repeat inside shots) with concrete #Hex palette roles (${DIRECTOR_V2_PALETTE_ROLES_LIST}), ${DIRECTOR_V2_LIGHTING_PRODUCT_PHRASE} (never pasted-on or flat front-lit), and include once verbatim: "${SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA}". Keep over-smooth or beauty-filter buzzwords out of every block, including exclusions.`
    : `   - "Visual style:" write ONE block for the whole prompt (never repeat inside shots) with concrete #Hex palette roles (${DIRECTOR_V2_PALETTE_ROLES_LIST}), ${DIRECTOR_V2_LIGHTING_PRODUCT_PHRASE}, and include once verbatim: "${SEEDANCE_VIDEO_FILM_EXPOSURE_FORMULA}". Because no person is in the scene, omit skin texture clauses.`;

  return `You are a veteran Film Director writing a production-ready Seedance 2.5 video prompt in English (ceiling ${SEEDANCE_25_PROMPT_CHARS} characters).
${modeGuidance}

Mandatory Seedance 2.5 Grammar & Quality Rules:
1. OMIT all redundant headers: never write "Create a Seedance video", aspect ratio (9:16, 16:9), resolution (480p, 1080p, 4K), FPS, or model names.
2. Exact block order separated by line breaks:
${referenceAuthorityRule}
   - Anti-boilerplate discipline: state reference authority, physique proportions, off-axis eyeline preference, and exclusions ONCE outside the timeline. Never repeat body-proportion text, negative defence clauses, or eyeline boilerplate inside individual shot lines — keep each shot line strictly to framing, action, camera movement, and cut handoff.
   - Camera by genre (no global camera lock): infer the genre from the brief:
     * Action, music video, fantasy, chase, or kinetic narrative -> moving camera (${DIRECTOR_V2_DYNAMIC_CAMERA_LIST}) written with start, path, and end.
     * Fashion editorial, lookbook, beauty, or calm portrait -> cut rhythm and micro-movement inside held poses (${SEEDANCE_V2_EDITORIAL_MOTION_LIST}), alternating camera angles (18° / 45° / 90° / OTS), avoiding forced pantomime.
   - Seconds-based timeline from 0.0s to ${options.seconds.toFixed(1)}s ("0.0s–Xs: …") with contiguous ranges and an explicit handoff at the end of every non-final shot ("hard cut", "match cut on …", or "continuous").
${visualStyleRule}
   - Optional single "Exclusions:" line (once, never per shot) for ${DIRECTOR_V2_EXCLUSIONS_PHRASE}.
   - ${audioInstruction}
3. ${blueprintRule}
4. Spoken dialogue only when the user's brief provides words; keep spoken lines verbatim in quotes. Never expose internal tool, provider, or infrastructure names.
Return JSON matching { "prompt": string, "notes": string } where "notes" is one concise sentence in the user's language.`;
}

function spacedToken(token: string | null): string | null {
  if (!token) return null;
  return token.replace(
    /^@(Image|Video|Audio)(\d+)$/i,
    (_m, kind: string, n: string) => `@${kind[0]!.toUpperCase()}${kind.slice(1).toLowerCase()} ${n}`,
  );
}

function referenceClauseV2(b: BoundReference, token: string): string {
  if (b.ref.frame === 'start') {
    return `${token} is the opening frame: start directly from it`;
  }
  if (b.ref.frame === 'end') {
    return `${token} is the closing frame: end cleanly on it`;
  }
  if (b.ref.role === 'person') {
    return `${token} supplies only the person's face and hair (not background, lighting, or casual clothing); ${sleeveVolumeLine(token)}`;
  }
  if (isGarmentReference(b.ref)) {
    return `${token} supplies wardrobe only (exact silhouette, tailoring, fabric, and colour; never face or skin)`;
  }
  switch (b.ref.role) {
    case 'product':
      return `${token} supplies only the product (exact shape, label geometry, proportions, and surface colours)`;
    case 'logo':
      return `${token} supplies only the exact logo mark (no redrawing or mirroring)`;
    case 'style':
      return `${token} supplies only lighting palette and surface atmosphere (not subjects or layout)`;
    case 'place':
      return `${token} supplies only the architectural setting`;
    default:
      return `${token} supplies only its named visual subject`;
  }
}

export interface FallbackV2Context {
  enhanceInput: EnhanceInput;
  binding: Binding;
  blueprint: boolean;
  seconds: number;
  rawRequest: string;
  rawChange: string;
  userText: string;
  playbookLines: readonly string[];
  planned: ReadonlyArray<{
    start: number;
    end: number;
    framing: string;
    camera: string;
    action: string;
    transition?: string;
  }>;
  analysis?: MediaAnalysisDigest | null;
  enforceAudio: (prompt: string, audioMode: DirectorAudioMode | undefined, userPrompt: string) => string;
  audioMode: DirectorAudioMode;
  locale: 'ko' | 'en';
  notes: string;
  env?: Record<string, string | undefined>;
}

const ANGLE_CYCLE_V2 = [
  '18° off-axis medium close-up',
  '45° three-quarter medium shot',
  'OTS (over-the-shoulder) insert',
  '90° side-profile tracking shot',
] as const;

const DYNAMIC_PLANNED_CAMERAS = [
  'low-angle Steadicam tracking forward into the frame',
  '45°–90° orbital arc sweeping around the subject',
  'crane rise into a kinetic FPV push-in',
] as const;

function buildShotLinesV2(
  ctx: FallbackV2Context,
  genre: DirectorCameraGenre,
  hasPerson: boolean,
  coreAction: string,
): string[] {
  const shotLines: string[] = [];
  if (ctx.planned.length > 0) {
    ctx.planned.forEach((shot, idx) => {
      const isLast = idx === ctx.planned.length - 1;
      const angle = ANGLE_CYCLE_V2[idx % ANGLE_CYCLE_V2.length];
      let camera = shot.camera || (genre === 'dynamic' ? DYNAMIC_PLANNED_CAMERAS[idx % DYNAMIC_PLANNED_CAMERAS.length]! : 'steady motivated push-in');
      if (genre === 'dynamic' && /locked[- ]?off/i.test(camera)) {
        camera = DYNAMIC_PLANNED_CAMERAS[idx % DYNAMIC_PLANNED_CAMERAS.length]!;
      }
      const actionText = scrubSeedanceAntiPatternsV2(
        `${shot.framing || angle}, ${shot.action || coreAction}; camera: ${camera}`,
        ctx.userText,
      ).replace(/\.+$/, '');
      const rawTransition = typeof shot.transition === 'string' ? shot.transition : '';
      const handoff = isLast
        ? genre === 'dynamic'
          ? 'Carrying forward momentum through the final frame.'
          : 'Settling on the final resting frame.'
        : /continuous|no cut/i.test(rawTransition)
          ? 'Continuous handoff into the next shot.'
          : /match/i.test(rawTransition)
            ? 'Match cut on motion vector.'
            : 'Hard cut.';
      shotLines.push(`${shot.start.toFixed(1)}s–${shot.end.toFixed(1)}s: ${angle} (${actionText}). ${handoff}`);
    });
    return shotLines;
  }

  const seconds = ctx.seconds;
  if (seconds > 5) {
    const mid = Math.round(seconds * 0.45 * 10) / 10;
    const secondSplit = Math.round(seconds * 0.78 * 10) / 10;
    if (genre === 'dynamic') {
      shotLines.push(
        `0.0s–${mid.toFixed(1)}s: 18° low-angle Steadicam tracking from behind into a medium wide — ${coreAction}; camera accelerates smoothly along the subject path. Hard cut.`,
      );
      shotLines.push(
        `${mid.toFixed(1)}s–${secondSplit.toFixed(1)}s: 45° to 90° orbital arc sweeping smoothly around the subject — kinetic motion continues with spatial parallax and grounded weight. Match cut on motion.`,
      );
      shotLines.push(
        `${secondSplit.toFixed(1)}s–${seconds.toFixed(1)}s: crane rise into an FPV push-in — action reaches peak payoff and carries momentum cleanly into the final frame.`,
      );
    } else if (hasPerson) {
      shotLines.push(
        `0.0s–${mid.toFixed(1)}s: 18° off-axis medium shot — ${coreAction}; held pose carried by a small weight shift and calm breath as camera eases gently forward. Hard cut.`,
      );
      shotLines.push(
        `${mid.toFixed(1)}s–${secondSplit.toFixed(1)}s: 45° three-quarter medium close-up — slow head turn and subtle breath inside a held pose with natural fabric settle; gentle handheld settle. Hard cut.`,
      );
      shotLines.push(
        `${secondSplit.toFixed(1)}s–${seconds.toFixed(1)}s: OTS / 90° profile close framing — held pose with a fine hair strand moving in soft air, settling cleanly on the final frame.`,
      );
    } else {
      shotLines.push(
        `0.0s–${mid.toFixed(1)}s: 18° table-level medium shot — ${coreAction}; slow dolly glide from left edge toward center axis. Hard cut.`,
      );
      shotLines.push(
        `${mid.toFixed(1)}s–${secondSplit.toFixed(1)}s: 45° three-quarter close-up — crisp material highlights and shadow falloff across surfaces; smooth slow push-in toward the label. Hard cut.`,
      );
      shotLines.push(
        `${secondSplit.toFixed(1)}s–${seconds.toFixed(1)}s: 90° side-profile macro detail — light settles cleanly across the silhouette on the final frame.`,
      );
    }
    return shotLines;
  }

  if (genre === 'dynamic') {
    shotLines.push(
      `0.0s–${seconds.toFixed(1)}s: 18° low-angle Steadicam tracking sweeping into a 45° orbital arc push-in — ${coreAction}; continuous moving camera with clear start, path, and end.`,
    );
  } else if (hasPerson) {
    shotLines.push(
      `0.0s–${seconds.toFixed(1)}s: 18° to 45° off-axis medium shot — ${coreAction}; held pose carried by a small weight shift, slow head turn, breath, and a hair strand moving while camera eases gently in.`,
    );
  } else {
    shotLines.push(
      `0.0s–${seconds.toFixed(1)}s: 18° to 45° off-axis product framing — ${coreAction}; smooth slow push-in settling across the surface on the final frame.`,
    );
  }
  return shotLines;
}

export function composeDirectorFallbackPromptV2(ctx: FallbackV2Context): EnhanceResult {
  const { enhanceInput, binding, blueprint, analysis } = ctx;
  const hasPerson = hasPersonInDirectorScene(
    { prompt: enhanceInput.prompt, references: enhanceInput.references, video: enhanceInput.video },
    analysis,
  );
  const genreText = [enhanceInput.prompt, enhanceInput.video?.change ?? '', enhanceInput.video?.sheet?.summary ?? ''].join('\n');
  const genre = guessDirectorCameraGenre(genreText);

  const hexes =
    analysis?.paletteHex && analysis.paletteHex.length >= 2
      ? analysis.paletteHex
      : (enhanceInput.brand?.palette ?? []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).length >= 2
        ? (enhanceInput.brand?.palette ?? []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 4)
        : ['#14171C', '#D8CFC2', '#3875C5'];

  const shadowHex = hexes[0] ?? '#14171C';
  const surfaceHex = hexes[1] ?? '#D8CFC2';
  const accentHex = hexes[2] ?? '#3875C5';

  const imageBindings = binding.bound.filter((b) => b.token && b.ref.kind === 'image');
  const videoToken = !blueprint
    ? spacedToken(binding.bound.find((b) => b.token && b.ref.kind === 'video')?.token ?? null)
    : null;

  const headerLines: string[] = [];
  if (imageBindings.length > 0 || videoToken) {
    const parts: string[] = [];
    if (videoToken) {
      parts.push(`follow ${videoToken} for camera pacing and motion rhythm`);
    }
    for (const b of imageBindings) {
      parts.push(referenceClauseV2(b, spacedToken(b.token)!));
    }
    headerLines.push(`Reference authority: ${parts.join('; ')}.`);
  } else if (binding.seedanceMode === 'frames') {
    headerLines.push(
      'Reference authority: start directly from the supplied opening frame, preserving its exact subject proportions and lighting.',
    );
  }

  const lightingDesc =
    analysis?.lightingNotes ||
    enhanceInput.video?.sheet?.look.lighting ||
    'motivated directional key light';
  const textureDesc =
    analysis?.textureNotes ||
    enhanceInput.video?.sheet?.look.texture ||
    'organic lens roll-off and authentic material micro-texture';
  const formula = hasPerson ? SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA : SEEDANCE_VIDEO_FILM_EXPOSURE_FORMULA;

  headerLines.push(
    `Visual style: palette anchored by ${shadowHex} shadow floor, ${surfaceHex} primary surfaces, and ${accentHex} key accents; ${lightingDesc}, match ambient shadow floor and color spill, never pasted-on or flat front-lit; ${textureDesc}; ${formula}.`,
  );

  if (ctx.playbookLines.length > 0) {
    headerLines.push(`Brand direction: ${scrubSeedanceAntiPatternsV2(ctx.playbookLines[0]!, ctx.userText)}`);
  }

  const exclusionsLine = hasPerson
    ? 'Exclusions: natural off-axis eyeline across cuts without staring dead-center into the lens; no on-screen text, subtitles, or watermarks.'
    : 'Exclusions: no on-screen text, subtitles, or watermarks.';

  const fullCoreAction = scrubSeedanceAntiPatternsV2(
    [ctx.rawChange ? `Adaptation: ${ctx.rawChange}` : '', ctx.rawRequest].filter(Boolean).join('. ') ||
      'The subject moves naturally through the space in continuous physical motion',
    ctx.userText,
  ).replace(/\.+$/, '');

  const assemble = (action: string) => {
    const shots = buildShotLinesV2(ctx, genre, hasPerson, action);
    return ctx.enforceAudio([...headerLines, ...shots, exclusionsLine].join('\n'), ctx.audioMode, ctx.userText);
  };

  let joined = assemble(fullCoreAction);
  if (joined.length > SEEDANCE_25_PROMPT_CHARS) {
    const excess = joined.length - SEEDANCE_25_PROMPT_CHARS + 32;
    const maxActionLen = Math.max(80, fullCoreAction.length - excess);
    const trimmed = fullCoreAction.slice(0, maxActionLen).trimEnd().replace(/[,;:\s]+$/, '');
    joined = assemble(trimmed);
    if (joined.length > SEEDANCE_25_PROMPT_CHARS) {
      joined = assemble(trimmed.slice(0, Math.max(40, maxActionLen - (joined.length - SEEDANCE_25_PROMPT_CHARS + 8))).trimEnd());
    }
  }

  return {
    prompt: joined,
    notes: ctx.notes,
    source: 'fallback',
    meta: enhanceMeta(enhanceInput, 'fallback', { env: ctx.env }),
  };
}

/** Output phrases the v2 director rules tell the model to write into the prompt (scoped to scene/audio state). */
export function directorV2OutputPhrases(options: {
  hasPerson: boolean;
  personTokens: readonly string[];
  hasImageRefs?: boolean;
  audioMode: DirectorAudioMode;
  explicitMusic: boolean;
  noBgmLine: string;
}): string[] {
  const sleevePhrases =
    options.personTokens.length > 0
      ? options.personTokens.map(sleeveVolumeLine)
      : options.hasImageRefs
        ? [sleeveVolumeLine('<person @Image token>')]
        : [];
  const out: string[] = [
    DIRECTOR_V2_SAFE_MATTE_SKIN,
    options.hasPerson ? SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA : SEEDANCE_VIDEO_FILM_EXPOSURE_FORMULA,
    `${DIRECTOR_V2_PALETTE_ROLES_LIST}, ${DIRECTOR_V2_LIGHTING_PRODUCT_PHRASE}`,
    DIRECTOR_V2_DYNAMIC_CAMERA_LIST,
    SEEDANCE_V2_EDITORIAL_MOTION_LIST,
    ...sleevePhrases,
  ];
  if (options.audioMode !== 'off' && options.audioMode !== 'silent') {
    if (options.explicitMusic) {
      out.push(`${DIRECTOR_V2_EXCLUSIONS_PHRASE}\n${DIRECTOR_EXPLICIT_MUSIC_AUDIO_LINE}`);
    } else {
      out.push(
        `${DIRECTOR_V2_EXCLUSIONS_PHRASE}\n${options.noBgmLine}`,
        DIRECTOR_NO_BGM_CLAUSE,
        DIRECTOR_NO_BGM_REBUILT_TAIL,
      );
    }
  } else {
    out.push(DIRECTOR_V2_EXCLUSIONS_PHRASE);
  }
  return out;
}

/**
 * Per-call allow-list for `brand-studio.director` when `BRAND_SEEDANCE_RULES_V2=on`:
 * permits the scoped audio policy lines, the v2 scrub replacement, the canonical v2 skin/film formula
 * and output phrases relevant to the scene, the bound person sleeve-volume line(s), `dictatedSpans(system)`, and
 * this input's v2 deterministic fallback.
 */
export function directorAllowV2(
  input: DirectorCompileInput,
  binding: Binding,
  system: string,
  analysis: MediaAnalysisDigest | null,
  playbooks: readonly DirectorPlaybookRule[],
  composeFallback: (input: DirectorCompileInput, opts: { analysis?: MediaAnalysisDigest | null; playbooks?: readonly DirectorPlaybookRule[]; env?: Record<string, string | undefined> }) => EnhanceResult,
  noBgmLine: string,
  env: Record<string, string | undefined>,
): string[] {
  let fallbackText = '';
  try {
    fallbackText = composeFallback(input, { analysis, playbooks, env }).prompt;
  } catch {
    fallbackText = '';
  }

  const hasPerson = hasPersonInDirectorScene(input, analysis);
  const hasImageRefs = binding.bound.some((b) => b.token && b.ref.kind === 'image');
  const personTokens = binding.bound
    .filter((b) => b.token && b.ref.kind === 'image' && b.ref.role === 'person')
    .map((b) => spacedToken(b.token)!);
  const audioMode: DirectorAudioMode = input.video?.audio ?? 'on';
  const userText = `${input.prompt}\n${input.video?.change ?? ''}`;
  const explicitMusic =
    audioMode !== 'sfx' && audioMode !== 'ambient' && requestsExplicitMusicPerformance(userText);

  return [
    ...new Set(
      [
        ...directorV2OutputPhrases({ hasPerson, personTokens, hasImageRefs, audioMode, explicitMusic, noBgmLine }),
        ...dictatedSpans(system),
        fallbackText,
      ].filter((s) => s.length > 0 && wordUnits(foldText(s)).length >= 4),
    ),
  ];
}
