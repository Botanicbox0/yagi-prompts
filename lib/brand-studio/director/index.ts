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
  DIRECTOR_HEADER_V1,
  DIRECTOR_HEADER_V2,
  directorAllowV2,
  directorRulesVersion,
  hasPersonInDirectorScene,
  isGarmentReference,
  scrubSeedanceAntiPatternsV2,
  SEEDANCE_25_PROMPT_CHARS,
  SEEDANCE_VIDEO_FILM_EXPOSURE_FORMULA,
  SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA,
  sleeveVolumeLine,
} from './rules-v2';
