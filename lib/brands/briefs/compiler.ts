import type { ConfirmedBrandIdentity } from '@/lib/brands/identity/schema';
import { hexToHsl } from './measurements';
import {
  shotHasPerson,
  type ShotCutKind,
  type ShotReference,
  type ShotSpec,
  type TimelineShot
} from './schema';

export const COMPILER_GRAMMAR_IDS = [
  'gpt-image-2.5',
  'nano-banana-pro',
  'seedream-5.5',
  'flux-kontext',
  'soul-2.0',
  'ideogram-recraft',
  'seedance-2.5'
] as const;
export type CompilerGrammarId = (typeof COMPILER_GRAMMAR_IDS)[number];

export const COMPILER_TARGET_IDS = [
  'gpt-image-2.5-flare',
  'gpt-image-2',
  'nano-banana-pro',
  'nano-banana-2.1',
  'seedream-5.5',
  'seedream-5.0-lite',
  'flux-3',
  'flux-kontext',
  'text2image_soul_v2',
  'soul_cinematic',
  'soul_location',
  'ideogram-4.5',
  'recraft-v4.1',
  'seedance-2.5',
  'seedance-2.0',
  'kling-omni'
] as const;
export type CompilerTargetId = (typeof COMPILER_TARGET_IDS)[number];

export type BriefRenderStage = 'draft' | 'approved' | 'final';

/**
 * a10 matte skin reflectance 3-sentence still-image contract (knowhow-corpus.md §2.2).
 * Automatically inserted into every still shot that features a person (`skin_contract: true`).
 * Kept byte-for-byte unchanged for still grammars; `serializeSeedance` uses `SKIN_VIDEO_CONTRACT_SEEDANCE`.
 */
export const SKIN_MATTE_CONTRACT_A10 =
  'Natural matte skin texture with visible pores and subtle micro-relief. ' +
  'Soft highlight roll-off across the cheekbones and bridge of the nose without specular plastic shine. ' +
  'True-to-life undertone with natural lip colour and zero beauty-filter smoothing.';

/**
 * Seedance 2.5 video skin and exposure contract (TWINGS-SOTA-BRIDGE.md §2-2, 2026-11-26).
 * Inserted once per compiled video prompt (never per shot) by `serializeSeedance` when `hasPerson && spec.skin_contract`.
 */
export const SKIN_VIDEO_CONTRACT_SEEDANCE =
  'looking like scanned, slightly underexposed 35mm film: soft contrast, cool lifted blacks (#14171C), fine organic grain, gentle halation on the brightest whites; one soft key light a stop under; skin stays natural and warm, unretouched matte-satin with visible micro-pores and fine stray flyaway hairs, never over-lit or glossy, with no blush';

/** a12 camera & lighting equipment brand names forbidden in prompts. */
export const BANNED_EQUIPMENT_BRANDS = [
  'canon',
  'nikon',
  'sony',
  'leica',
  'arri',
  'hasselblad',
  'profoto',
  'broncolor',
  'phase one',
  'fujifilm',
  'panasonic'
] as const;

/** photo-craft §2 AI buzzwords forbidden in prompts. */
export const BANNED_AI_BUZZWORDS = [
  'hyperrealistic',
  '8k',
  'octane',
  'cgi',
  'flawless',
  'porcelain',
  'pristine',
  'vibrant',
  'cinematic lighting',
  'unreal engine',
  'photorealistic masterpiece'
] as const;

/** IDENTITY §2 pink makeup / blush terms forbidden in prompts. */
export const BANNED_PINK_MAKEUP_TERMS = [
  'pink makeup',
  'heavy blush',
  'rosy cheeks',
  'glossy pink lips',
  'visible blush',
  'pink eyeshadow'
] as const;

export interface ShotRoutingDecision {
  cutKind: ShotCutKind;
  grammar: CompilerGrammarId;
  engineId: CompilerTargetId;
  fallbackEngineId: CompilerTargetId | null;
  defaultResolution: '480p' | '720p' | '1080p' | '2k' | '4k';
  rationale: string;
}

/**
 * Routing table (knowhow-corpus.md §2.1): maps each cut kind to the measured primary engine,
 * grammar, and fallback.
 */
export const SHOT_ROUTING_TABLE: Record<ShotCutKind, ShotRoutingDecision> = {
  editorial_full_body: {
    cutKind: 'editorial_full_body',
    grammar: 'soul-2.0',
    engineId: 'text2image_soul_v2',
    fallbackEngineId: 'seedream-5.5',
    defaultResolution: '2k',
    rationale: 'Garment asymmetry and editorial atmosphere without reference copying'
  },
  reference_exact_product: {
    cutKind: 'reference_exact_product',
    grammar: 'seedream-5.5',
    engineId: 'seedream-5.5',
    fallbackEngineId: 'nano-banana-pro',
    defaultResolution: '2k',
    rationale: 'Thick glass, caustics, cap geometry, and reference frame fidelity (6/8 product benchmark)'
  },
  logo_mark_preserve: {
    cutKind: 'logo_mark_preserve',
    grammar: 'nano-banana-pro',
    engineId: 'nano-banana-pro',
    fallbackEngineId: 'nano-banana-2.1',
    defaultResolution: '2k',
    rationale: 'Exact mark/logo spelling and multi-reference combination (8/8 mark benchmark)'
  },
  person_portrait: {
    cutKind: 'person_portrait',
    grammar: 'nano-banana-pro',
    engineId: 'nano-banana-pro',
    fallbackEngineId: 'seedream-5.5',
    defaultResolution: '2k',
    rationale: '3/4 and profile facial geometry lock paired with a10 matte skin reflectance'
  },
  typography_layout: {
    cutKind: 'typography_layout',
    grammar: 'ideogram-recraft',
    engineId: 'ideogram-4.5',
    fallbackEngineId: 'recraft-v4.1',
    defaultResolution: '2k',
    rationale: 'Exact quoted typography, layout hierarchy, and brand hex lock'
  },
  seedance_start_frame: {
    cutKind: 'seedance_start_frame',
    grammar: 'soul-2.0',
    engineId: 'soul_cinematic',
    fallbackEngineId: 'nano-banana-pro',
    defaultResolution: '2k',
    rationale: 'Native optical halation and film grain tuned for Seedance 2.5 first frames'
  },
  short_film_clip: {
    cutKind: 'short_film_clip',
    grammar: 'seedance-2.5',
    engineId: 'seedance-2.5',
    fallbackEngineId: 'kling-omni',
    defaultResolution: '720p',
    rationale: 'Sub-second timeline cuts, @Image binding, and product shape preservation'
  },
  video_object_replace: {
    cutKind: 'video_object_replace',
    grammar: 'seedance-2.5',
    engineId: 'seedance-2.5',
    fallbackEngineId: 'kling-omni',
    defaultResolution: '720p',
    rationale: 'Motion-preserving video edit with product/wardrobe reference injection'
  }
};

export function grammarForTarget(target: CompilerTargetId): CompilerGrammarId {
  switch (target) {
    case 'gpt-image-2.5-flare':
    case 'gpt-image-2':
      return 'gpt-image-2.5';
    case 'nano-banana-pro':
    case 'nano-banana-2.1':
      return 'nano-banana-pro';
    case 'seedream-5.5':
    case 'seedream-5.0-lite':
      return 'seedream-5.5';
    case 'flux-3':
    case 'flux-kontext':
      return 'flux-kontext';
    case 'text2image_soul_v2':
    case 'soul_cinematic':
    case 'soul_location':
      return 'soul-2.0';
    case 'ideogram-4.5':
    case 'recraft-v4.1':
      return 'ideogram-recraft';
    case 'seedance-2.5':
    case 'seedance-2.0':
    case 'kling-omni':
      return 'seedance-2.5';
  }
}

export function routeShotEngine(
  spec: Pick<ShotSpec, 'cutKind' | 'deliverable' | 'engine'>,
  _identity?: ConfirmedBrandIdentity
): ShotRoutingDecision {
  const base = SHOT_ROUTING_TABLE[spec.cutKind];
  if (spec.engine?.id && (COMPILER_TARGET_IDS as readonly string[]).includes(spec.engine.id)) {
    const engineId = spec.engine.id as CompilerTargetId;
    return {
      ...base,
      engineId,
      grammar: grammarForTarget(engineId),
      defaultResolution: spec.engine.resolution === '1k' ? '2k' : spec.engine.resolution
    };
  }
  return base;
}

export type PromptLintRule =
  | 'equipment_brand'
  | 'ai_buzzword'
  | 'pink_makeup'
  | 'brand_forbidden_term'
  | 'unconsented_face_reference'
  | 'missing_reference_role'
  | 'nb_pro_mixed_references'
  | 'soul_reference_leak'
  | 'seedream_word_budget'
  | 'seedream_reference_limit'
  | 'palette_out_of_world'
  | 'timeline_gap_or_overlap'
  | 'subsecond_continuous_push_in';

export interface PromptLintIssue {
  rule: PromptLintRule;
  severity: 'error' | 'warn';
  text: string;
}

export interface BrandMemoryContext {
  bannedPhrases?: string[];
  approvedFrames?: string[];
  savedLooks?: string[];
}

export interface CompiledEngineParams {
  engineId: CompilerTargetId;
  grammar: CompilerGrammarId;
  stage: BriefRenderStage;
  aspect: ShotSpec['deliverable']['aspect'];
  resolution: '480p' | '720p' | '1080p' | '2k' | '4k';
  draft?: boolean;
  bitrateMode?: 'high';
  durationSeconds?: number;
  generateAudio?: boolean;
  thinkingLevel?: 'high';
  magicPrompt?: 'off';
  quality?: 'high' | '2k';
  variant?: 'sunburst' | 'flare';
}

export interface CompiledPromptResult {
  prompt: string;
  params: CompiledEngineParams;
  lint: PromptLintIssue[];
}

function activeReferences(spec: ShotSpec): ShotReference[] {
  return spec.references.filter((r) => r.role !== 'analysis-only');
}

function formatReferenceLine(ref: ShotReference, index: number, handlePrefix = 'Image'): string {
  const controls = ref.controls.length > 0 ? ref.controls.join(', ') : ref.role;
  const ignore = ref.ignore.length > 0 ? `; ignore ${ref.ignore.join(', ')}` : '';
  return `${handlePrefix} ${index + 1} (${ref.role}): lend ${controls}${ignore}.`;
}

function formatPoseSentence(spec: ShotSpec): string {
  if (!spec.subject) {
    if (spec.product) {
      return `Hero product ${spec.product.name} with ${spec.product.vessel_geometry}, ${spec.product.label_lock}, and ${spec.product.material_finish}.`;
    }
    return 'Architectural still-life composition with clean geometric balance.';
  }
  const { age_band, hair, pose } = spec.subject;
  return `Subject (${age_band}, ${hair} hair): torso angled ${pose.torso_deg} deg, head tilt ${pose.head_tilt}, gaze ${pose.gaze}, hands ${pose.hands}.`;
}

function formatWardrobeSentence(spec: ShotSpec): string {
  if (!spec.wardrobe) return '';
  return `Wardrobe (${spec.wardrobe.lock ? 'locked construction' : 'styled'}): ${spec.wardrobe.silhouette} in ${spec.wardrobe.fabric}, ${spec.wardrobe.construction}.`;
}

function formatLightAndOptics(spec: ShotSpec): string {
  const { light, camera, tone, palette } = spec;
  return (
    `Lighting: ${light.key.modifier} from ${light.key.side} at ${light.key.height} (${light.key.distance}), creating ${light.key.effect}; fill via ${light.fill} at ${light.colour_k}K. ` +
    `Tonal anchors (${tone.key_classification}): lifted black ${tone.lifted_black_hex}, shadow ${tone.shadow_hex}, midtone ${tone.mid_hex}, highlight ${tone.highlight_hex}, saturation ${tone.saturation_pct}%, shadow share ${tone.shadow_share_pct}%. ` +
    `Palette (${palette.world} world): ${palette.hex_values.join(', ')} (warm notes reserved for ${palette.warm_notes.join(', ')}). ` +
    `Optics: ${camera.focal_mm}mm lens at ${camera.distance_m}m, ${camera.aperture}, camera height ${camera.height}, tilt ${camera.tilt_deg} deg, subject width ${camera.subject_width_pct}% with ${camera.margin_pct}% frame margin, halation ${tone.halation}, fine film grain sigma ${tone.grain_sigma}.`
  );
}

function serializeGptImage(spec: ShotSpec, hasPerson: boolean): string {
  const refs = activeReferences(spec);
  const refLines =
    refs.length > 0
      ? refs.map((r, i) => formatReferenceLine(r, i, 'Image')).join(' ')
      : 'Standalone generation without external image references.';
  const wardrobe = formatWardrobeSentence(spec);
  const skin = hasPerson && spec.skin_contract ? ` ${SKIN_MATTE_CONTRACT_A10}` : '';
  const positiveExclusions = spec.exclusions.map((e) => `free of ${e}`).join(', ');
  return [
    `[1. MEDIUM & CROP] ${spec.deliverable.medium} (${spec.deliverable.aspect}) for ${spec.deliverable.use} — ${spec.brief}.`,
    `[2. REFERENCE AUTHORITY] ${refLines}`,
    `[3. POSE & WARDROBE] ${formatPoseSentence(spec)}${wardrobe ? ` ${wardrobe}` : ''}${skin}`,
    `[4. SPACE & LAYERS] Foreground: ${spec.space.foreground}. Midground: ${spec.space.midground}. Background: ${spec.space.background} on ${spec.space.surface}.`,
    `[5. LIGHT, PALETTE & OPTICS] ${formatLightAndOptics(spec)} Frame remains clean and ${positiveExclusions}.`
  ].join('\n\n');
}

function serializeNanoBanana(spec: ShotSpec, hasPerson: boolean): string {
  const refs = activeReferences(spec);
  const idRef = refs.find((r) => r.role === 'identity');
  const prodRefs = refs.filter((r) => r.role !== 'identity');
  const identityBlock = idRef
    ? `Preserve the exact facial geometry, bone structure, eye spacing, and natural skin tone of Image 1 (${idRef.asset_id}).${spec.skin_contract ? ` ${SKIN_MATTE_CONTRACT_A10}` : ''}`
    : hasPerson
      ? `Fictional editorial cast member.${spec.skin_contract ? ` ${SKIN_MATTE_CONTRACT_A10}` : ''}`
      : 'Faceless product/scene composition — no person in frame.';
  const compLock = `Framing at ${spec.camera.focal_mm}mm, distance ${spec.camera.distance_m}m, subject width ${spec.camera.subject_width_pct}%, minimum ${spec.camera.margin_pct}% clean margin.`;
  const poseLock = formatPoseSentence(spec);
  const outfitProps = [
    formatWardrobeSentence(spec),
    spec.product
      ? `Product lock: ${spec.product.name} (${spec.product.vessel_geometry}; ${spec.product.label_lock}; ${spec.product.material_finish}).`
      : '',
    prodRefs.map((r, i) => formatReferenceLine(r, idRef ? i + 1 : i, 'Image')).join(' ')
  ]
    .filter(Boolean)
    .join(' ');

  return [
    `IDENTITY LOCK: ${identityBlock}`,
    `COMPOSITION LOCK: ${compLock}`,
    `POSE LOCK: ${poseLock}`,
    `OUTFIT & PROPS: ${outfitProps || 'Clean minimal styling without extra props.'}`,
    `SETTING: Foreground ${spec.space.foreground}; midground ${spec.space.midground}; background ${spec.space.background} (${spec.space.surface}).`,
    `COLOR GRADE & LIGHT: ${spec.light.key.modifier} ${spec.light.key.side} (${spec.light.key.height}), ${spec.light.fill}, ${spec.light.colour_k}K. Tonal hex anchors ${spec.tone.lifted_black_hex} / ${spec.tone.shadow_hex} / ${spec.tone.mid_hex} / ${spec.tone.highlight_hex}. Palette ${spec.palette.hex_values.join(', ')}.`,
    `CAMERA & OPTICS: ${spec.camera.focal_mm}mm, ${spec.camera.aperture}, DOF ratio ${spec.camera.dof_ratio}, halation ${spec.tone.halation}, grain sigma ${spec.tone.grain_sigma}.`,
    `NEGATIVE: ${spec.exclusions.join(', ')}.`
  ].join('\n');
}

function serializeSeedream(spec: ShotSpec, hasPerson: boolean): string {
  const refs = activeReferences(spec);
  const p1 =
    refs.length > 0
      ? `Reference preservation rules: ${refs.map((r, i) => formatReferenceLine(r, i, 'Image')).join(' ')}`
      : `Editorial brief: ${spec.brief}. Preserve exact geometric proportions across the frame.`;
  const p2 = [
    formatPoseSentence(spec),
    formatWardrobeSentence(spec),
    `Environment: ${spec.space.foreground} leading to ${spec.space.midground} against ${spec.space.background} (${spec.space.surface}).`,
    hasPerson && spec.skin_contract ? SKIN_MATTE_CONTRACT_A10 : ''
  ]
    .filter(Boolean)
    .join(' ');
  const p3 = formatLightAndOptics(spec);
  const p4 = `Deliverable: ${spec.deliverable.medium} for ${spec.deliverable.use}, clean uncropped frame free of ${spec.exclusions.join(', ')}.`;
  return [p1, p2, p3, p4].join('\n\n');
}

function serializeFluxKontext(spec: ShotSpec, hasPerson: boolean): string {
  const refs = activeReferences(spec);
  const lead =
    refs.length > 0
      ? hasPerson
        ? 'Maintain the exact facial identity and bone structure of Image 1 while placing the subject into the directed studio environment.'
        : 'Maintain the exact product silhouette, vessel proportions, and label typography of Image 1 while rendering the surrounding studio environment.'
      : `Camera-first ${spec.camera.focal_mm}mm ${spec. camera.aperture} editorial photograph at ${spec.camera.distance_m}m distance.`;
  const skin = hasPerson && spec.skin_contract ? ` ${SKIN_MATTE_CONTRACT_A10}` : '';
  return [
    `1. CAMERA & OPTICS: ${lead} ${spec.camera.focal_mm}mm focal length, ${spec.camera.aperture}, ${spec.camera.height} camera height, ${spec.camera.margin_pct}% clean margin.`,
    `2. SUBJECT & MATERIAL: ${formatPoseSentence(spec)} ${formatWardrobeSentence(spec)}${skin}`,
    `3. SPACE: ${spec.space.foreground}, ${spec.space.midground}, ${spec.space.background} on ${spec.space.surface}.`,
    `4. LIGHT: ${spec.light.key.modifier} from ${spec.light.key.side} (${spec.light.key.height}), ${spec.light.fill}, ${spec.light.colour_k}K.`,
    `5. COLOUR WORLD: Tonal anchors ${spec.tone.lifted_black_hex}, ${spec.tone.shadow_hex}, ${spec.tone.mid_hex}, ${spec.tone.highlight_hex} within palette ${spec.palette.hex_values.join(', ')}, clean bare frame with natural optical grain sigma ${spec.tone.grain_sigma}.`
  ].join('\n');
}

function serializeSoul(spec: ShotSpec, hasPerson: boolean): string {
  const skin = hasPerson && spec.skin_contract ? ` ${SKIN_MATTE_CONTRACT_A10}` : '';
  return [
    `Editorial direction: ${spec.brief}.`,
    `Subject & garment architecture: ${formatPoseSentence(spec)} ${formatWardrobeSentence(spec)}${skin}`,
    `Atmosphere & colour world (${spec.palette.world}): palette ${spec.palette.hex_values.join(', ')} with lifted black ${spec.tone.lifted_black_hex}, midtone ${spec.tone.mid_hex}, highlight ${spec.tone.highlight_hex}.`,
    `Light & optical finish: ${spec.light.key.modifier} from ${spec.light.key.side} at ${spec.light.colour_k}K, ${spec.camera.focal_mm}mm lens (${spec.camera.aperture}), native optical halation ${spec.tone.halation} and organic film grain sigma ${spec.tone.grain_sigma}.`
  ].join('\n\n');
}

function serializeIdeogramRecraft(spec: ShotSpec): string {
  const headline = spec.product?.label_lock ?? spec.brief;
  return [
    `1. SUMMARY: ${spec.deliverable.medium} for ${spec.deliverable.use} — ${spec.brief}.`,
    `2. STYLE & HEX PALETTE: Strict brand palette ${spec.palette.hex_values.join(', ')} with tonal anchors ${spec.tone.lifted_black_hex} and ${spec.tone.highlight_hex}, clean architectural grid.`,
    `3. COMPOSITION & EXACT TEXT: Center-weighted layout on ${spec.space.surface} (${spec.space.background}) with exact quoted typography "${headline}" and ${spec.camera.margin_pct}% clear margin.`
  ].join('\n');
}

function formatTimelineAudio(shot: TimelineShot): string {
  if (!shot.audio) return '';
  const parts: string[] = [];
  if (shot.audio.music) parts.push(`(${shot.audio.music})`);
  if (shot.audio.sfx) parts.push(`<${shot.audio.sfx}>`);
  if (shot.audio.dialogue) {
    const d = shot.audio.dialogue;
    parts.push(`${d.speaker} (${d.language}, ${d.tone}): {${d.line}}`);
  }
  if (shot.audio.on_screen_text) parts.push(`【${shot.audio.on_screen_text}】`);
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

function serializeSeedance(
  spec: ShotSpec,
  target: CompilerTargetId,
  hasPerson: boolean
): string {
  const isKling = target === 'kling-omni';
  const refs = activeReferences(spec);
  // Canonical Seedance 2.5 reference modes (TWINGS-SOTA-BRIDGE.md §2-2):
  // - Mode A (default): one 3:4 distance face master (`@Image 1`, head height 32–42%, 12–16% headroom),
  //   wardrobe described in text; wide casual top/sleeve volume handled via Reference authority, not cropping.
  // - Mode B: `@Image 1` face master + `@Image 2` separate faceless clothing / ghost-mannequin image.
  // - Mode C (conditional only): 3-panel turnaround sheet strictly for multi-angle narrative or virtual
  //   characters — never the default.
  const refBindings = refs
    .map((r, i) => {
      const token = isKling ? `<<<image_${i + 1}>>>` : `@Image ${i + 1}`;
      const controls = r.controls.length > 0 ? r.controls.join(', ') : r.role;
      return `${token} anchors ${r.role} (${controls})`;
    })
    .join('; ');

  const duration = spec.duration_s ?? 5;
  const timeline: TimelineShot[] =
    spec.timeline && spec.timeline.length > 0
      ? spec.timeline
      : [
          {
            shot: 1,
            start: 0,
            end: duration,
            edit: 'continuous',
            focal_mm: spec.camera.focal_mm,
            camera: `steady ${spec.camera.height} tracking at ${spec.camera.distance_m}m`,
            action: spec.brief
          }
        ];

  const wantsNoBgm = timeline.some((s) => s.audio?.no_bgm);
  const noBgmGuard =
    'No score, no background music, no song, no melody, no rhythmic beat — clean diegetic room tone and foley only.';

  const visualStyle =
    `Visual style: ${spec.deliverable.medium} in the ${spec.palette.world} colour world (${spec.palette.hex_values.join(', ')}), ` +
    `${spec.light.key.modifier} from ${spec.light.key.side} at ${spec.light.colour_k}K with ${spec.light.fill}, ` +
    `tonal floor ${spec.tone.lifted_black_hex} to highlight ${spec.tone.highlight_hex}, ` +
    `${spec.camera.focal_mm}mm optics (${spec.camera.aperture}), halation ${spec.tone.halation}, grain sigma ${spec.tone.grain_sigma}.`;

  const productLock = spec.product
    ? `Product geometry lock: ${spec.product.name} keeps exact ${spec.product.vessel_geometry}, ${spec.product.label_lock}, and ${spec.product.material_finish} without morphing.`
    : '';
  const skinLock = hasPerson && spec.skin_contract ? SKIN_VIDEO_CONTRACT_SEEDANCE : '';

  const shotLines = timeline.map((s) => {
    const startStr = s.start.toFixed(1);
    const endStr = s.end.toFixed(1);
    return `[Shot ${s.shot} — ${startStr}–${endStr}s] (${s.edit}) ${s.focal_mm}mm, ${s.camera}. ${s.action}${formatTimelineAudio(s)}`;
  });

  const antiComposite =
    'Anti-Composite & Anti-AI Symmetry: single unified physical space, natural micro-asymmetry, zero split-screen or collage seams.';
  const excludeBlock = `[Exclude: ${spec.exclusions.join(', ')}, subtitles, logo overlay, slideshow, crossfade]`;

  return [
    wantsNoBgm ? noBgmGuard : '',
    'Begin already in motion.',
    visualStyle,
    refBindings ? `Reference binding: ${refBindings}.` : '',
    productLock,
    skinLock,
    ...shotLines,
    antiComposite,
    excludeBlock,
    wantsNoBgm ? noBgmGuard : ''
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Lints a `ShotSpec` and compiled prompt against TWINGS hardlines, brand identity rules,
 * reference role separation, palette world bounds, and Seedance timeline invariants.
 */
export function lintCompiledPrompt(
  spec: ShotSpec,
  prompt: string,
  identity: ConfirmedBrandIdentity,
  target: CompilerTargetId,
  memory?: BrandMemoryContext
): PromptLintIssue[] {
  const issues: PromptLintIssue[] = [];
  const lowerPrompt = prompt.toLowerCase();
  const lowerBrief = spec.brief.toLowerCase();

  // 1. (removed 2026-11-20) GPT Image is no longer refused for a shot with a person: the founder allowed people on
  // GPT Image on 2026-11-19 (the old knowhow-corpus §2.1 ban was about GPT Image 2.0 for fashion lookbooks), and
  // the studio's Prompt Architect already allows it (lib/brand-studio/enhancer/profiles/gpt-image.ts). A person
  // shot on GPT Image still gets the a10 skin contract (serializeGptImage).

  // 2. a12 equipment brand names
  for (const brand of BANNED_EQUIPMENT_BRANDS) {
    const re = new RegExp(`\\b${brand.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (re.test(spec.brief) || re.test(prompt)) {
      issues.push({
        rule: 'equipment_brand',
        severity: 'error',
        text: `Forbidden camera/lighting equipment brand "${brand}" detected (a12).`
      });
    }
  }

  // 3. photo-craft §2 AI buzzwords (check brief and non-exclusion body)
  const promptWithoutNegative = prompt
    .replace(/NEGATIVE:.*$/im, '')
    .replace(/\[Exclude:.*?\]/gi, '')
    .replace(/free of .*$/im, '');
  for (const buzz of BANNED_AI_BUZZWORDS) {
    if (lowerBrief.includes(buzz) || promptWithoutNegative.toLowerCase().includes(buzz)) {
      issues.push({
        rule: 'ai_buzzword',
        severity: 'error',
        text: `Banned AI buzzword "${buzz}" detected (photo-craft §2).`
      });
    }
  }

  // 4. IDENTITY §2 pink makeup terms
  for (const term of BANNED_PINK_MAKEUP_TERMS) {
    if (lowerBrief.includes(term) || promptWithoutNegative.toLowerCase().includes(term)) {
      issues.push({
        rule: 'pink_makeup',
        severity: 'error',
        text: `Forbidden pink makeup / blush term "${term}" detected (IDENTITY §2).`
      });
    }
  }

  // 5. Brand forbidden terms, voice forbidden words, competitor exclusions, and memory banned phrases
  const brandBanned = [
    ...identity.rules.forbiddenTerms,
    ...identity.voice.forbiddenWords,
    ...identity.rules.competitorExclusions,
    ...(memory?.bannedPhrases ?? [])
  ];
  for (const phrase of brandBanned) {
    const clean = phrase.trim().toLowerCase();
    if (!clean) continue;
    if (lowerBrief.includes(clean) || promptWithoutNegative.toLowerCase().includes(clean)) {
      issues.push({
        rule: 'brand_forbidden_term',
        severity: 'error',
        text: `Brand forbidden term "${phrase}" detected in brief or prompt.`
      });
    }
  }

  // 6. Consented faces rule (i5 / BrandRulesSchema.consentedFacesOnly)
  if (identity.rules.consentedFacesOnly) {
    for (const ref of spec.references) {
      if (ref.role === 'identity' && ref.consented !== true) {
        issues.push({
          rule: 'unconsented_face_reference',
          severity: 'error',
          text: `Identity reference "${ref.asset_id}" is missing explicit face consent (consented: true).`
        });
      }
    }
  }

  // 7. Reference role & controls/ignore completeness (a8)
  const refs = activeReferences(spec);
  for (const ref of refs) {
    if (ref.controls.length === 0 || ref.ignore.length === 0) {
      issues.push({
        rule: 'missing_reference_role',
        severity: 'error',
        text: `Reference "${ref.asset_id}" (${ref.role}) must declare both controls[] and ignore[] lists.`
      });
    }
  }

  // 8. Nano Banana Pro trap: mixing an identity reference with a scene reference collapses facial geometry (§2.2)
  if (target === 'nano-banana-pro' || target === 'nano-banana-2.1') {
    const hasId = refs.some((r) => r.role === 'identity');
    const hasScene = refs.some((r) => r.role === 'scene');
    if (hasId && hasScene) {
      issues.push({
        rule: 'nb_pro_mixed_references',
        severity: 'error',
        text: 'Nano Banana must not combine an identity reference with a scene photo reference (causes face blending and scene collapse).'
      });
    }
  }

  // 9. Soul 2.0 reference leak trap (§2.2)
  if ((target === 'text2image_soul_v2' || target === 'soul_location') && refs.length > 0) {
    issues.push({
      rule: 'soul_reference_leak',
      severity: 'error',
      text: `${target} must not receive image references (causes direct composition copying; use text + #HEX only).`
    });
  }

  // 10. Seedream word & reference budget (§2.2: <= 600 words, <= 10 references)
  if (target === 'seedream-5.5' || target === 'seedream-5.0-lite') {
    const words = prompt.trim().split(/\s+/).length;
    if (words > 600) {
      issues.push({
        rule: 'seedream_word_budget',
        severity: 'warn',
        text: `Seedream prompt has ${words} words (recommended <= 600 words).`
      });
    }
    if (refs.length > 10) {
      issues.push({
        rule: 'seedream_reference_limit',
        severity: 'error',
        text: `Seedream accepts at most 10 references (got ${refs.length}).`
      });
    }
  }

  // 11. Brand palette hue-band check when `identity.rules.paletteOnly` is true
  if (identity.rules.paletteOnly) {
    const [lo, hi] = identity.world.ownedHue;
    for (const hex of spec.palette.hex_values) {
      const { h, s } = hexToHsl(hex);
      if (s > 0.14 && (h < lo || h > hi)) {
        issues.push({
          rule: 'palette_out_of_world',
          severity: 'error',
          text: `Palette swatch ${hex} (hue ${Math.round(h)} deg) falls outside brand owned hue band [${lo}, ${hi}].`
        });
      }
    }
  }

  // 12. Seedance timeline continuity & sub-second continuous push-in trap (§2.3)
  if (spec.timeline && spec.timeline.length > 0) {
    let cursor = 0;
    for (const cut of spec.timeline) {
      if (Math.abs(cut.start - cursor) > 0.001) {
        issues.push({
          rule: 'timeline_gap_or_overlap',
          severity: 'error',
          text: `Timeline Shot ${cut.shot} starts at ${cut.start}s, expected ${cursor}s (zero gaps/overlaps allowed).`
        });
      }
      if (cut.end <= cut.start) {
        issues.push({
          rule: 'timeline_gap_or_overlap',
          severity: 'error',
          text: `Timeline Shot ${cut.shot} end (${cut.end}s) must be greater than start (${cut.start}s).`
        });
      }
      const dur = cut.end - cut.start;
      if (
        dur < 1.0 &&
        cut.edit === 'continuous' &&
        /push-in|push in/i.test(cut.camera)
      ) {
        issues.push({
          rule: 'subsecond_continuous_push_in',
          severity: 'error',
          text: `Timeline Shot ${cut.shot} (${dur.toFixed(2)}s) uses continuous push-in on a sub-second cut (stretches to 3-4s; use hard cut).`
        });
      }
      cursor = cut.end;
    }
    if (spec.duration_s !== undefined && Math.abs(cursor - spec.duration_s) > 0.001) {
      issues.push({
        rule: 'timeline_gap_or_overlap',
        severity: 'error',
        text: `Timeline total (${cursor}s) does not equal duration_s (${spec.duration_s}s).`
      });
    }
  }

  return issues;
}

export interface CompilePromptOptions {
  target?: CompilerTargetId;
  stage?: BriefRenderStage;
  finalResolution?: '720p' | '1080p' | '2k' | '4k';
}

/**
 * Compiles a `ShotSpec` + `ConfirmedBrandIdentity` + optional `BrandMemoryContext` into a model-specific
 * prompt, CLI/API parameters, and lint report (knowhow-corpus.md §2.2–2.4).
 */
export function compilePrompt(
  spec: ShotSpec,
  identity: ConfirmedBrandIdentity,
  memory?: BrandMemoryContext,
  options: CompilePromptOptions = {}
): CompiledPromptResult {
  const stage: BriefRenderStage = options.stage ?? 'draft';
  const routed = routeShotEngine(spec, identity);
  const target: CompilerTargetId = options.target ?? routed.engineId;
  const grammar = grammarForTarget(target);
  const hasPerson = shotHasPerson(spec);

  let prompt: string;
  switch (grammar) {
    case 'gpt-image-2.5':
      prompt = serializeGptImage(spec, hasPerson);
      break;
    case 'nano-banana-pro':
      prompt = serializeNanoBanana(spec, hasPerson);
      break;
    case 'seedream-5.5':
      prompt = serializeSeedream(spec, hasPerson);
      break;
    case 'flux-kontext':
      prompt = serializeFluxKontext(spec, hasPerson);
      break;
    case 'soul-2.0':
      prompt = serializeSoul(spec, hasPerson);
      break;
    case 'ideogram-recraft':
      prompt = serializeIdeogramRecraft(spec);
      break;
    case 'seedance-2.5':
      prompt = serializeSeedance(spec, target, hasPerson);
      break;
  }

  const isVideo = grammar === 'seedance-2.5';
  const resolution: CompiledEngineParams['resolution'] = isVideo
    ? stage === 'draft'
      ? '480p'
      : options.finalResolution === '1080p'
        ? '1080p'
        : '720p'
    : options.finalResolution === '4k' && target === 'nano-banana-pro'
      ? '4k'
      : '2k';

  const params: CompiledEngineParams = {
    engineId: target,
    grammar,
    stage,
    aspect: spec.deliverable.aspect,
    resolution,
    ...(isVideo
      ? {
          draft: stage === 'draft',
          bitrateMode: 'high' as const,
          durationSeconds: spec.duration_s ?? 5,
          generateAudio: !(spec.timeline?.some((s) => s.audio?.no_bgm) ?? false)
        }
      : {}),
    ...(target === 'nano-banana-2.1' ? { thinkingLevel: 'high' as const } : {}),
    ...(target === 'ideogram-4.5' ? { magicPrompt: 'off' as const, quality: 'high' as const } : {}),
    ...(target === 'gpt-image-2.5-flare' || target === 'gpt-image-2'
      ? { variant: 'sunburst' as const, quality: 'high' as const }
      : {}),
    ...(grammar === 'soul-2.0' ? { quality: '2k' as const } : {})
  };

  const lint = lintCompiledPrompt(spec, prompt, identity, target, memory);
  return { prompt, params, lint };
}
