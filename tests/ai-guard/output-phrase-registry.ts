/**
 * Single explicit registry of EVERY exported output-phrase constant across every module that can
 * contribute to a model system instruction or to post-answer appended/rewritten lines.
 *
 * Collected explicitly by import + registry entries (no identifier-suffix regex) and never derived from
 * `*AllowPhrases`, `enhancerAllow`, `directorAllow`, or `directorAllowV2`.
 */
import * as compilerMod from '@/lib/brand-studio/director/compiler';
import * as rulesV2Mod from '@/lib/brand-studio/director/rules-v2';
import type { DirectorAudioMode, DirectorCompileInput } from '@/lib/brand-studio/director/types';
import * as enhancerMod from '@/lib/brand-studio/enhancer';
import * as linesMod from '@/lib/brand-studio/enhancer/lines';
import * as profilesMod from '@/lib/brand-studio/enhancer/profiles';
import * as coreMod from '@/lib/brand-studio/enhancer/profiles/core';
import * as gptImageMod from '@/lib/brand-studio/enhancer/profiles/gpt-image';
import * as metaMod from '@/lib/brand-studio/enhancer/profiles/meta';
import * as nanoBananaMod from '@/lib/brand-studio/enhancer/profiles/nano-banana';
import * as seedanceMod from '@/lib/brand-studio/enhancer/profiles/seedance';
import * as seedreamMod from '@/lib/brand-studio/enhancer/profiles/seedream';
import * as skinMod from '@/lib/brand-studio/enhancer/profiles/skin';
import * as tasksMod from '@/lib/brand-studio/enhancer/profiles/tasks';
import { bindReferences } from '@/lib/brand-studio/enhancer/references';
import * as schemaMod from '@/lib/brand-studio/enhancer/schema';
import type { EnhanceInput } from '@/lib/brand-studio/enhancer/types';

export type PhraseCategory = 'output_phrase' | 'short_excluded';

export interface RegistryPhraseEntry {
  readonly id: string;
  readonly moduleName: string;
  readonly exportName: string;
  readonly value: string;
  readonly category: PhraseCategory;
  /** True only for GPT Image 2.6 markup overlay mode (options.markup = true). */
  readonly markupOnly?: boolean;
  /** Non-null when this phrase can be emitted into post-answer output outside the raw system prompt. */
  readonly postAnswerSource?: string;
}

export const CONTRIBUTING_MODULES = [
  { name: 'profiles/core', mod: coreMod },
  { name: 'profiles/meta', mod: metaMod },
  { name: 'profiles/seedream', mod: seedreamMod },
  { name: 'profiles/nano-banana', mod: nanoBananaMod },
  { name: 'profiles/gpt-image', mod: gptImageMod },
  { name: 'profiles/seedance', mod: seedanceMod },
  { name: 'profiles/skin', mod: skinMod },
  { name: 'profiles/index', mod: profilesMod },
  { name: 'profiles/tasks', mod: tasksMod },
  { name: 'enhancer/lines', mod: linesMod },
  { name: 'enhancer/index', mod: enhancerMod },
  { name: 'enhancer/schema', mod: schemaMod },
  { name: 'director/compiler', mod: compilerMod },
  { name: 'director/rules-v2', mod: rulesV2Mod },
] as const;

/**
 * Every top-level `string` export in `CONTRIBUTING_MODULES` that is NOT an individual output phrase
 * (e.g., full template blocks or version strings). Any unregistered top-level `string` export fails tests.
 */
export const NON_PHRASE_STRING_EXPORTS: ReadonlySet<string> = new Set([
  'profiles/seedream:SEEDREAM_PROFILE',
  'profiles/nano-banana:NANO_BANANA_PROFILE',
  'profiles/gpt-image:GPT_IMAGE_PROFILE',
  'profiles/gpt-image:GPT_IMAGE_MARKUP_RULE',
  'profiles/seedance:SEEDANCE_PROFILE',
  'profiles/seedance:SEEDANCE_PROFILE_V2',
  'profiles/index:CORE_VERSION',
  'enhancer/index:CORE_VERSION',
]);

/** Re-exported string constants pointing to an already-registered canonical phrase constant. */
export const REEXPORT_PHRASE_ALIASES: Readonly<Record<string, string>> = {
  'director/rules-v2:DIRECTOR_V2_EDITORIAL_MOTION_LIST': 'seedance-v2-editorial-motion-list',
};

export const OUTPUT_PHRASE_REGISTRY: readonly RegistryPhraseEntry[] = [
  // profiles/seedream
  {
    id: 'seedream-use-case-list',
    moduleName: 'profiles/seedream',
    exportName: 'SEEDREAM_USE_CASE_LIST',
    value: seedreamMod.SEEDREAM_USE_CASE_LIST,
    category: 'output_phrase',
  },
  {
    id: 'seedream-integration-phrase',
    moduleName: 'profiles/seedream',
    exportName: 'SEEDREAM_INTEGRATION_PHRASE',
    value: seedreamMod.SEEDREAM_INTEGRATION_PHRASE,
    category: 'output_phrase',
  },
  {
    id: 'seedream-no-other-text-closer',
    moduleName: 'profiles/seedream',
    exportName: 'SEEDREAM_NO_OTHER_TEXT_CLOSER',
    value: seedreamMod.SEEDREAM_NO_OTHER_TEXT_CLOSER,
    category: 'short_excluded',
  },

  // profiles/nano-banana
  {
    id: 'nb-use-case-list',
    moduleName: 'profiles/nano-banana',
    exportName: 'NANO_BANANA_USE_CASE_LIST',
    value: nanoBananaMod.NANO_BANANA_USE_CASE_LIST,
    category: 'output_phrase',
  },
  {
    id: 'nb-keep-list-phrase',
    moduleName: 'profiles/nano-banana',
    exportName: 'NANO_BANANA_KEEP_LIST_PHRASE',
    value: nanoBananaMod.NANO_BANANA_KEEP_LIST_PHRASE,
    category: 'output_phrase',
  },
  {
    id: 'nb-logo-formula',
    moduleName: 'profiles/nano-banana',
    exportName: 'NANO_BANANA_LOGO_FORMULA',
    value: nanoBananaMod.NANO_BANANA_LOGO_FORMULA,
    category: 'output_phrase',
  },
  {
    id: 'nb-type-style-example',
    moduleName: 'profiles/nano-banana',
    exportName: 'NANO_BANANA_TYPE_STYLE_EXAMPLE',
    value: nanoBananaMod.NANO_BANANA_TYPE_STYLE_EXAMPLE,
    category: 'output_phrase',
  },
  {
    id: 'nb-no-lettering-closer',
    moduleName: 'profiles/nano-banana',
    exportName: 'NANO_BANANA_NO_LETTERING_CLOSER',
    value: nanoBananaMod.NANO_BANANA_NO_LETTERING_CLOSER,
    category: 'output_phrase',
  },

  // profiles/gpt-image
  {
    id: 'gpt-format-list',
    moduleName: 'profiles/gpt-image',
    exportName: 'GPT_IMAGE_FORMAT_LIST',
    value: gptImageMod.GPT_IMAGE_FORMAT_LIST,
    category: 'output_phrase',
  },
  {
    id: 'gpt-photo-phrase',
    moduleName: 'profiles/gpt-image',
    exportName: 'GPT_IMAGE_PHOTO_PHRASE',
    value: gptImageMod.GPT_IMAGE_PHOTO_PHRASE,
    category: 'short_excluded',
  },
  {
    id: 'gpt-framing-list',
    moduleName: 'profiles/gpt-image',
    exportName: 'GPT_IMAGE_FRAMING_LIST',
    value: gptImageMod.GPT_IMAGE_FRAMING_LIST,
    category: 'output_phrase',
  },
  {
    id: 'gpt-product-keep-formula',
    moduleName: 'profiles/gpt-image',
    exportName: 'GPT_IMAGE_PRODUCT_KEEP_FORMULA',
    value: gptImageMod.GPT_IMAGE_PRODUCT_KEEP_FORMULA,
    category: 'output_phrase',
  },
  {
    id: 'gpt-logo-formula',
    moduleName: 'profiles/gpt-image',
    exportName: 'GPT_IMAGE_LOGO_FORMULA',
    value: gptImageMod.GPT_IMAGE_LOGO_FORMULA,
    category: 'output_phrase',
  },
  {
    id: 'gpt-integration-phrase',
    moduleName: 'profiles/gpt-image',
    exportName: 'GPT_IMAGE_INTEGRATION_PHRASE',
    value: gptImageMod.GPT_IMAGE_INTEGRATION_PHRASE,
    category: 'output_phrase',
  },
  {
    id: 'gpt-markup-area-phrase',
    moduleName: 'profiles/gpt-image',
    exportName: 'GPT_IMAGE_MARKUP_AREA_PHRASE',
    value: gptImageMod.GPT_IMAGE_MARKUP_AREA_PHRASE,
    category: 'output_phrase',
    markupOnly: true,
  },
  {
    id: 'gpt-markup-closer',
    moduleName: 'profiles/gpt-image',
    exportName: 'GPT_IMAGE_MARKUP_CLOSER',
    value: gptImageMod.GPT_IMAGE_MARKUP_CLOSER,
    category: 'output_phrase',
    markupOnly: true,
  },

  // profiles/seedance
  {
    id: 'seedance-video-skin-exposure-formula',
    moduleName: 'profiles/seedance',
    exportName: 'SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA',
    value: seedanceMod.SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA,
    category: 'output_phrase',
  },
  {
    id: 'seedance-video-film-exposure-formula',
    moduleName: 'profiles/seedance',
    exportName: 'SEEDANCE_VIDEO_FILM_EXPOSURE_FORMULA',
    value: seedanceMod.SEEDANCE_VIDEO_FILM_EXPOSURE_FORMULA,
    category: 'output_phrase',
  },
  {
    id: 'seedance-palette-roles-list',
    moduleName: 'profiles/seedance',
    exportName: 'SEEDANCE_PALETTE_ROLES_LIST',
    value: seedanceMod.SEEDANCE_PALETTE_ROLES_LIST,
    category: 'output_phrase',
  },
  {
    id: 'seedance-v1-lighting-phrase',
    moduleName: 'profiles/seedance',
    exportName: 'SEEDANCE_V1_LIGHTING_PHRASE',
    value: seedanceMod.SEEDANCE_V1_LIGHTING_PHRASE,
    category: 'output_phrase',
  },
  {
    id: 'seedance-v1-camera-vocab-list',
    moduleName: 'profiles/seedance',
    exportName: 'SEEDANCE_V1_CAMERA_VOCAB_LIST',
    value: seedanceMod.SEEDANCE_V1_CAMERA_VOCAB_LIST,
    category: 'output_phrase',
  },
  {
    id: 'seedance-v1-skin-faithful-phrase',
    moduleName: 'profiles/seedance',
    exportName: 'SEEDANCE_V1_SKIN_FAITHFUL_PHRASE',
    value: seedanceMod.SEEDANCE_V1_SKIN_FAITHFUL_PHRASE,
    category: 'output_phrase',
  },
  {
    id: 'seedance-v1-skin-no-glare-phrase',
    moduleName: 'profiles/seedance',
    exportName: 'SEEDANCE_V1_SKIN_NO_GLARE_PHRASE',
    value: seedanceMod.SEEDANCE_V1_SKIN_NO_GLARE_PHRASE,
    category: 'output_phrase',
  },
  {
    id: 'seedance-v1-face-light-phrase',
    moduleName: 'profiles/seedance',
    exportName: 'SEEDANCE_V1_FACE_LIGHT_PHRASE',
    value: seedanceMod.SEEDANCE_V1_FACE_LIGHT_PHRASE,
    category: 'output_phrase',
  },
  {
    id: 'seedance-v2-lighting-phrase',
    moduleName: 'profiles/seedance',
    exportName: 'SEEDANCE_V2_LIGHTING_PHRASE',
    value: seedanceMod.SEEDANCE_V2_LIGHTING_PHRASE,
    category: 'output_phrase',
  },
  {
    id: 'seedance-v2-dynamic-camera-list',
    moduleName: 'profiles/seedance',
    exportName: 'SEEDANCE_V2_DYNAMIC_CAMERA_LIST',
    value: seedanceMod.SEEDANCE_V2_DYNAMIC_CAMERA_LIST,
    category: 'output_phrase',
  },
  {
    id: 'seedance-v2-editorial-motion-list',
    moduleName: 'profiles/seedance',
    exportName: 'SEEDANCE_V2_EDITORIAL_MOTION_LIST',
    value: seedanceMod.SEEDANCE_V2_EDITORIAL_MOTION_LIST,
    category: 'output_phrase',
  },
  {
    id: 'seedance-v2-exclusion-gaze-phrase',
    moduleName: 'profiles/seedance',
    exportName: 'SEEDANCE_V2_EXCLUSION_GAZE_PHRASE',
    value: seedanceMod.SEEDANCE_V2_EXCLUSION_GAZE_PHRASE,
    category: 'output_phrase',
  },

  // profiles/skin
  {
    id: 'skin-base-nb-phrase',
    moduleName: 'profiles/skin',
    exportName: 'SKIN_BASE_NANO_BANANA_PHRASE',
    value: skinMod.SKIN_BASE_NANO_BANANA_PHRASE,
    category: 'output_phrase',
  },
  {
    id: 'skin-base-default-phrase',
    moduleName: 'profiles/skin',
    exportName: 'SKIN_BASE_DEFAULT_PHRASE',
    value: skinMod.SKIN_BASE_DEFAULT_PHRASE,
    category: 'output_phrase',
  },
  {
    id: 'skin-realism-zones-phrase',
    moduleName: 'profiles/skin',
    exportName: 'SKIN_REALISM_ZONES_PHRASE',
    value: skinMod.SKIN_REALISM_ZONES_PHRASE,
    category: 'output_phrase',
  },
  {
    id: 'skin-realism-light-phrase',
    moduleName: 'profiles/skin',
    exportName: 'SKIN_REALISM_LIGHT_PHRASE',
    value: skinMod.SKIN_REALISM_LIGHT_PHRASE,
    category: 'output_phrase',
  },
  {
    id: 'skin-realism-perspective-phrase',
    moduleName: 'profiles/skin',
    exportName: 'SKIN_REALISM_PERSPECTIVE_PHRASE',
    value: skinMod.SKIN_REALISM_PERSPECTIVE_PHRASE,
    category: 'output_phrase',
  },
  {
    id: 'skin-realism-wide-texture-phrase',
    moduleName: 'profiles/skin',
    exportName: 'SKIN_REALISM_WIDE_TEXTURE_PHRASE',
    value: skinMod.SKIN_REALISM_WIDE_TEXTURE_PHRASE,
    category: 'output_phrase',
  },
  {
    id: 'skin-realism-seedream-example',
    moduleName: 'profiles/skin',
    exportName: 'SKIN_REALISM_SEEDREAM_EXAMPLE',
    value: skinMod.SKIN_REALISM_SEEDREAM_EXAMPLE,
    category: 'short_excluded',
  },
  {
    id: 'skin-realism-nb-photo-label',
    moduleName: 'profiles/skin',
    exportName: 'SKIN_REALISM_NB_PHOTO_LABEL',
    value: skinMod.SKIN_REALISM_NB_PHOTO_LABEL,
    category: 'short_excluded',
  },
  {
    id: 'skin-realism-gpt-photo-label',
    moduleName: 'profiles/skin',
    exportName: 'SKIN_REALISM_GPT_PHOTO_LABEL',
    value: skinMod.SKIN_REALISM_GPT_PHOTO_LABEL,
    category: 'short_excluded',
  },
  {
    id: 'skin-realism-gpt-closer',
    moduleName: 'profiles/skin',
    exportName: 'SKIN_REALISM_GPT_CLOSER',
    value: skinMod.SKIN_REALISM_GPT_CLOSER,
    category: 'output_phrase',
  },
  {
    id: 'skin-tone-depth-list',
    moduleName: 'profiles/skin',
    exportName: 'SKIN_TONE_DEPTH_LIST',
    value: skinMod.SKIN_TONE_DEPTH_LIST,
    category: 'output_phrase',
  },
  {
    id: 'skin-tone-undertone-list',
    moduleName: 'profiles/skin',
    exportName: 'SKIN_TONE_UNDERTONE_LIST',
    value: skinMod.SKIN_TONE_UNDERTONE_LIST,
    category: 'output_phrase',
  },
  {
    id: 'skin-restore-keep-phrase',
    moduleName: 'profiles/skin',
    exportName: 'SKIN_RESTORE_KEEP_PHRASE',
    value: skinMod.SKIN_RESTORE_KEEP_PHRASE,
    category: 'output_phrase',
  },
  {
    id: 'skin-restore-action-nb-phrase',
    moduleName: 'profiles/skin',
    exportName: 'SKIN_RESTORE_ACTION_NANO_BANANA_PHRASE',
    value: skinMod.SKIN_RESTORE_ACTION_NANO_BANANA_PHRASE,
    category: 'output_phrase',
  },
  {
    id: 'skin-restore-action-default-phrase',
    moduleName: 'profiles/skin',
    exportName: 'SKIN_RESTORE_ACTION_DEFAULT_PHRASE',
    value: skinMod.SKIN_RESTORE_ACTION_DEFAULT_PHRASE,
    category: 'output_phrase',
  },
  {
    id: 'skin-restore-zones-phrase',
    moduleName: 'profiles/skin',
    exportName: 'SKIN_RESTORE_ZONES_PHRASE',
    value: skinMod.SKIN_RESTORE_ZONES_PHRASE,
    category: 'output_phrase',
  },

  // profiles/index (region_edit)
  {
    id: 'region-logo-nb-formula',
    moduleName: 'profiles/index',
    exportName: 'REGION_EDIT_LOGO_NANO_BANANA_FORMULA',
    value: profilesMod.REGION_EDIT_LOGO_NANO_BANANA_FORMULA,
    category: 'output_phrase',
  },
  {
    id: 'region-logo-default-formula',
    moduleName: 'profiles/index',
    exportName: 'REGION_EDIT_LOGO_DEFAULT_FORMULA',
    value: profilesMod.REGION_EDIT_LOGO_DEFAULT_FORMULA,
    category: 'output_phrase',
  },
  {
    id: 'region-people-keep-phrase',
    moduleName: 'profiles/index',
    exportName: 'REGION_EDIT_PEOPLE_KEEP_PHRASE',
    value: profilesMod.REGION_EDIT_PEOPLE_KEEP_PHRASE,
    category: 'output_phrase',
  },
  {
    id: 'region-skin-phrase',
    moduleName: 'profiles/index',
    exportName: 'REGION_EDIT_SKIN_PHRASE',
    value: profilesMod.REGION_EDIT_SKIN_PHRASE,
    category: 'output_phrase',
  },

  // profiles/tasks (plus KEEP_PHRASES re-exported from enhancer/lines)
  {
    id: 'task-image-product-keep-formula',
    moduleName: 'profiles/tasks',
    exportName: 'IMAGE_TASK_PRODUCT_KEEP_FORMULA',
    value: tasksMod.IMAGE_TASK_PRODUCT_KEEP_FORMULA,
    category: 'output_phrase',
  },
  {
    id: 'task-image-logo-phrase',
    moduleName: 'profiles/tasks',
    exportName: 'IMAGE_TASK_LOGO_PHRASE',
    value: tasksMod.IMAGE_TASK_LOGO_PHRASE,
    category: 'output_phrase',
  },
  {
    id: 'task-image-integration-phrase',
    moduleName: 'profiles/tasks',
    exportName: 'IMAGE_TASK_INTEGRATION_PHRASE',
    value: tasksMod.IMAGE_TASK_INTEGRATION_PHRASE,
    category: 'output_phrase',
  },
  {
    id: 'task-region-wide-keep-tail',
    moduleName: 'profiles/tasks',
    exportName: 'REGION_TASK_WIDE_KEEP_TAIL',
    value: tasksMod.REGION_TASK_WIDE_KEEP_TAIL,
    category: 'output_phrase',
  },
  {
    id: 'task-region-crop-keep-tail',
    moduleName: 'profiles/tasks',
    exportName: 'REGION_TASK_CROP_KEEP_TAIL',
    value: tasksMod.REGION_TASK_CROP_KEEP_TAIL,
    category: 'output_phrase',
  },
  {
    id: 'task-revision-edit-keep-phrase',
    moduleName: 'profiles/tasks',
    exportName: 'REVISION_EDIT_KEEP_PHRASE',
    value: tasksMod.REVISION_EDIT_KEEP_PHRASE,
    category: 'output_phrase',
  },

  // enhancer/lines
  {
    id: 'lines-ambient-sound-open-phrase',
    moduleName: 'enhancer/lines',
    exportName: 'AMBIENT_SOUND_OPEN_PHRASE',
    value: linesMod.AMBIENT_SOUND_OPEN_PHRASE,
    category: 'output_phrase',
  },
  {
    id: 'lines-ambient-sound-close-phrase',
    moduleName: 'enhancer/lines',
    exportName: 'AMBIENT_SOUND_CLOSE_PHRASE',
    value: linesMod.AMBIENT_SOUND_CLOSE_PHRASE,
    category: 'output_phrase',
  },
  {
    id: 'lines-ambient-audio-line',
    moduleName: 'enhancer/lines',
    exportName: 'AMBIENT_AUDIO_LINE',
    value: linesMod.AMBIENT_AUDIO_LINE,
    category: 'output_phrase',
    postAnswerSource: 'schema.ts enforceAudio ambient',
  },
  {
    id: 'lines-native-audio-line',
    moduleName: 'enhancer/lines',
    exportName: 'NATIVE_AUDIO_LINE',
    value: linesMod.NATIVE_AUDIO_LINE,
    category: 'output_phrase',
    postAnswerSource: 'schema.ts enforceAudio native',
  },
  {
    id: 'lines-keep-camera',
    moduleName: 'enhancer/lines',
    exportName: 'KEEP_PHRASES.camera',
    value: linesMod.KEEP_PHRASES.camera,
    category: 'short_excluded',
  },
  {
    id: 'lines-keep-timing',
    moduleName: 'enhancer/lines',
    exportName: 'KEEP_PHRASES.timing',
    value: linesMod.KEEP_PHRASES.timing,
    category: 'short_excluded',
  },
  {
    id: 'lines-keep-composition',
    moduleName: 'enhancer/lines',
    exportName: 'KEEP_PHRASES.composition',
    value: linesMod.KEEP_PHRASES.composition,
    category: 'short_excluded',
  },
  {
    id: 'lines-keep-motion',
    moduleName: 'enhancer/lines',
    exportName: 'KEEP_PHRASES.motion',
    value: linesMod.KEEP_PHRASES.motion,
    category: 'short_excluded',
  },
  {
    id: 'lines-keep-look',
    moduleName: 'enhancer/lines',
    exportName: 'KEEP_PHRASES.look',
    value: linesMod.KEEP_PHRASES.look,
    category: 'output_phrase',
  },

  // director/compiler
  {
    id: 'director-no-bgm-audio-line',
    moduleName: 'director/compiler',
    exportName: 'DIRECTOR_NO_BGM_AUDIO_LINE',
    value: compilerMod.DIRECTOR_NO_BGM_AUDIO_LINE,
    category: 'output_phrase',
    postAnswerSource: 'compiler.ts enforceDirectorAudioPolicy default no-BGM',
  },
  {
    id: 'director-scrub-skin-phrase',
    moduleName: 'director/compiler',
    exportName: 'DIRECTOR_SCRUB_SKIN_PHRASE',
    value: compilerMod.DIRECTOR_SCRUB_SKIN_PHRASE,
    category: 'output_phrase',
    postAnswerSource: 'compiler.ts scrubSeedanceAntiPatterns v1',
  },
  {
    id: 'director-v1-palette-roles-list',
    moduleName: 'director/compiler',
    exportName: 'DIRECTOR_V1_PALETTE_ROLES_LIST',
    value: compilerMod.DIRECTOR_V1_PALETTE_ROLES_LIST,
    category: 'output_phrase',
  },
  {
    id: 'director-v1-anti-composite-lighting-phrase',
    moduleName: 'director/compiler',
    exportName: 'DIRECTOR_V1_ANTI_COMPOSITE_LIGHTING_PHRASE',
    value: compilerMod.DIRECTOR_V1_ANTI_COMPOSITE_LIGHTING_PHRASE,
    category: 'output_phrase',
  },
  {
    id: 'director-v1-skin-with-ref-phrase',
    moduleName: 'director/compiler',
    exportName: 'DIRECTOR_V1_SKIN_WITH_REF_PHRASE',
    value: compilerMod.DIRECTOR_V1_SKIN_WITH_REF_PHRASE,
    category: 'output_phrase',
  },
  {
    id: 'director-v1-skin-no-ref-phrase',
    moduleName: 'director/compiler',
    exportName: 'DIRECTOR_V1_SKIN_NO_REF_PHRASE',
    value: compilerMod.DIRECTOR_V1_SKIN_NO_REF_PHRASE,
    category: 'output_phrase',
  },
  {
    id: 'director-v1-skin-no-glare-phrase',
    moduleName: 'director/compiler',
    exportName: 'DIRECTOR_V1_SKIN_NO_GLARE_PHRASE',
    value: compilerMod.DIRECTOR_V1_SKIN_NO_GLARE_PHRASE,
    category: 'output_phrase',
  },

  // director/rules-v2
  {
    id: 'director-no-bgm-clause',
    moduleName: 'director/rules-v2',
    exportName: 'DIRECTOR_NO_BGM_CLAUSE',
    value: rulesV2Mod.DIRECTOR_NO_BGM_CLAUSE,
    category: 'output_phrase',
  },
  {
    id: 'director-no-bgm-rebuilt-tail',
    moduleName: 'director/rules-v2',
    exportName: 'DIRECTOR_NO_BGM_REBUILT_TAIL',
    value: rulesV2Mod.DIRECTOR_NO_BGM_REBUILT_TAIL,
    category: 'output_phrase',
    postAnswerSource: 'compiler.ts enforceDirectorAudioPolicy rebuilt no-BGM tail',
  },
  {
    id: 'director-explicit-music-audio-line',
    moduleName: 'director/rules-v2',
    exportName: 'DIRECTOR_EXPLICIT_MUSIC_AUDIO_LINE',
    value: rulesV2Mod.DIRECTOR_EXPLICIT_MUSIC_AUDIO_LINE,
    category: 'output_phrase',
    postAnswerSource: 'compiler.ts enforceDirectorAudioPolicy explicit music',
  },
  {
    id: 'director-v2-safe-matte-skin',
    moduleName: 'director/rules-v2',
    exportName: 'DIRECTOR_V2_SAFE_MATTE_SKIN',
    value: rulesV2Mod.DIRECTOR_V2_SAFE_MATTE_SKIN,
    category: 'output_phrase',
    postAnswerSource: 'rules-v2.ts scrubSeedanceAntiPatternsV2',
  },
  {
    id: 'director-v2-palette-roles-list',
    moduleName: 'director/rules-v2',
    exportName: 'DIRECTOR_V2_PALETTE_ROLES_LIST',
    value: rulesV2Mod.DIRECTOR_V2_PALETTE_ROLES_LIST,
    category: 'output_phrase',
  },
  {
    id: 'director-v2-lighting-product-phrase',
    moduleName: 'director/rules-v2',
    exportName: 'DIRECTOR_V2_LIGHTING_PRODUCT_PHRASE',
    value: rulesV2Mod.DIRECTOR_V2_LIGHTING_PRODUCT_PHRASE,
    category: 'output_phrase',
  },
  {
    id: 'director-v2-dynamic-camera-list',
    moduleName: 'director/rules-v2',
    exportName: 'DIRECTOR_V2_DYNAMIC_CAMERA_LIST',
    value: rulesV2Mod.DIRECTOR_V2_DYNAMIC_CAMERA_LIST,
    category: 'output_phrase',
  },
  {
    id: 'director-v2-exclusions-phrase',
    moduleName: 'director/rules-v2',
    exportName: 'DIRECTOR_V2_EXCLUSIONS_PHRASE',
    value: rulesV2Mod.DIRECTOR_V2_EXCLUSIONS_PHRASE,
    category: 'output_phrase',
  },
];

export interface EquivalenceConfig {
  readonly id: string;
  readonly site: 'enhancer' | 'director';
  readonly env: Record<string, string | undefined>;
  readonly input: EnhanceInput | DirectorCompileInput;
}

export function normalizePhraseWs(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function containsNormalizedPhrase(haystack: string, needle: string): boolean {
  return normalizePhraseWs(haystack).includes(normalizePhraseWs(needle));
}

/**
 * Independent post-answer line enumeration matching schema.ts / enforceAudio / enforceDirectorAudioPolicy /
 * scrubSeedanceAntiPatterns[V2]. Never calls `*AllowPhrases`, `enhancerAllow`, or `directorAllow*`.
 */
export function postAnswerAppendedLinesForConfig(cfg: EquivalenceConfig): string[] {
  const out: string[] = [];
  if (cfg.site === 'enhancer') {
    const inp = cfg.input as EnhanceInput;
    if (inp.kind === 'region_edit') {
      out.push('Do not move or resize anything else.');
    }
    if (inp.profile === 'seedance' && inp.video) {
      if (inp.video.audio === 'ambient') out.push(linesMod.AMBIENT_AUDIO_LINE);
      else if (inp.video.audio === 'native') out.push(linesMod.NATIVE_AUDIO_LINE);
      if (inp.kind === 'video_remix' && inp.video.method === 'edit') {
        const ref = bindReferences(inp).bound.find((b) => b.ref.kind === 'video')?.token ?? '@Video1';
        out.push(`Everything else in ${ref} stays as it is.`);
      }
    }
    return out;
  }

  const dirInp = cfg.input as DirectorCompileInput;
  const rulesV2 = cfg.env.BRAND_SEEDANCE_RULES_V2 === 'on';
  out.push(rulesV2 ? rulesV2Mod.DIRECTOR_V2_SAFE_MATTE_SKIN : compilerMod.DIRECTOR_SCRUB_SKIN_PHRASE);
  const audioMode: DirectorAudioMode = dirInp.video?.audio ?? 'on';
  if (audioMode !== 'off' && audioMode !== 'silent') {
    const userText = `${dirInp.prompt}\n${dirInp.video?.change ?? ''}`;
    const explicitMusic =
      audioMode !== 'sfx' && audioMode !== 'ambient' && compilerMod.requestsExplicitMusicPerformance(userText);
    if (explicitMusic) {
      out.push(rulesV2Mod.DIRECTOR_EXPLICIT_MUSIC_AUDIO_LINE);
    } else {
      out.push(compilerMod.DIRECTOR_NO_BGM_AUDIO_LINE, rulesV2Mod.DIRECTOR_NO_BGM_REBUILT_TAIL);
    }
  }
  return out;
}
