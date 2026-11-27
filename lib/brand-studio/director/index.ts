/**
 * Silent Multimodal `Video-Creator` Director barrel (`lib/brand-studio/director`).
 */
export type {
  DirectorAudioMode,
  DirectorCompileDeps,
  DirectorCompileInput,
  DirectorCompileResult,
  DirectorPlaybookRule,
  DirectorProviderId,
  DirectorVideoInput,
  MediaAnalysisDigest,
  MediaAnalysisRefSummary,
  MediaAnalyzeDeps,
  MediaAnalyzeInput,
  MediaAnalyzer,
  PromptCompiler,
  PromptIntentMode,
} from './types';

export {
  ArgonMediaAnalyzerStub,
  createMediaAnalyzer,
  DIRECTOR_THUMBS_MAX,
  GeminiFlashMediaAnalyzer,
  MEDIA_ANALYSIS_RESPONSE_SCHEMA,
  resolveDirectorProvider,
} from './analyzer';

export { loadDirectorPlaybooks, playbookRuleLines } from './playbooks';

export {
  buildSeedanceDirectorSystemInstruction,
  classifyPromptIntent,
  compileDirectorPrompt,
  composeDirectorFallbackPrompt,
  DefaultPromptCompiler,
  DIRECTOR_NO_BGM_AUDIO_LINE,
  DIRECTOR_SCRUB_SKIN_PHRASE,
  DIRECTOR_V1_ANTI_COMPOSITE_LIGHTING_PHRASE,
  DIRECTOR_V1_PALETTE_ROLES_LIST,
  DIRECTOR_V1_REFERENCE_AUTHORITY_PHRASE,
  DIRECTOR_V1_SKIN_NO_GLARE_PHRASE,
  DIRECTOR_V1_SKIN_NO_REF_PHRASE,
  DIRECTOR_V1_SKIN_WITH_REF_PHRASE,
  DIRECTOR_V1_VISUAL_STYLE_PHRASE,
  directorAllow,
  directorV1OutputPhrases,
  enforceDirectorAudioPolicy,
  normalizeDirectorAudioMode,
  requestsExplicitMusicPerformance,
  scrubSeedanceAntiPatterns,
  stripRedundantVideoHeaders,
} from './compiler';

export {
  DYNAMIC_CAMERA_KEYWORDS_EN,
  DYNAMIC_CAMERA_KEYWORDS_KO,
  EDITORIAL_CAMERA_KEYWORDS_EN,
  EDITORIAL_CAMERA_KEYWORDS_KO,
  guessDirectorCameraGenre,
  type DirectorCameraGenre,
} from './genre';

export {
  buildSeedanceDirectorSystemInstructionV2,
  composeDirectorFallbackPromptV2,
  DIRECTOR_EXPLICIT_MUSIC_AUDIO_LINE,
  DIRECTOR_HEADER_V1,
  DIRECTOR_HEADER_V2,
  DIRECTOR_NO_BGM_CLAUSE,
  DIRECTOR_NO_BGM_REBUILT_TAIL,
  DIRECTOR_V2_DYNAMIC_CAMERA_LIST,
  DIRECTOR_V2_EDITORIAL_MOTION_LIST,
  DIRECTOR_V2_EXCLUSIONS_PHRASE,
  DIRECTOR_V2_GARMENT_AUTHORITY_PHRASE,
  DIRECTOR_V2_LIGHTING_PRODUCT_PHRASE,
  DIRECTOR_V2_PALETTE_ROLES_LIST,
  DIRECTOR_V2_PERSON_AUTHORITY_PHRASE,
  DIRECTOR_V2_SAFE_MATTE_SKIN,
  directorAllowV2,
  directorRulesVersion,
  directorV2OutputPhrases,
  hasPersonInDirectorScene,
  isGarmentReference,
  scrubSeedanceAntiPatternsV2,
  SEEDANCE_25_PROMPT_CHARS,
  SEEDANCE_VIDEO_FILM_EXPOSURE_FORMULA,
  SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA,
  sleeveVolumeLine,
} from './rules-v2';
