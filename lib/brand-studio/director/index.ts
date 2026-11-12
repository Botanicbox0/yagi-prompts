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
