/**
 * Enhancer shapes (docs/BRAND-STUDIO-V2.md §12). `index.ts` re-exports them; they live here so the
 * profile, fallback and validation modules can share them without importing the entry point.
 */
import type {
  FilmSheet,
  StudioAssetRole,
  StudioAudioMode,
  StudioKeepKey,
  StudioRemixMethod,
} from '@/lib/brand-studio/contracts';
import type { StudioPromptProfile } from '@/lib/brand-studio/models';
import type { SqlRunner } from '@/lib/db/sql-runner';

export type EnhanceKind = 'image' | 'region_edit' | 'video' | 'video_remix';

export interface EnhanceReference {
  /**
   * 1-based place of the reference in the run's tray order (the request's `references` array).
   * Per-kind numbers ("이미지 2", "@Image2") are derived from this order, so passing the per-kind
   * chip number instead also works as long as it rises with tray order.
   */
  index: number;
  kind: 'image' | 'video' | 'audio';
  /** The chip text the customer sees ("이미지 1"). Context for the model, never sent to the generator. */
  label: string;
  role?: StudioAssetRole;
  /** What to take from it, in the customer's words. */
  use?: string;
  /** What not to take from it, in the customer's words. */
  avoid?: string;
  /** Video only: the picture opens (`start`) or closes (`end`) the shot. */
  frame?: 'start' | 'end';
  /** A still of it, at most 768 px on the long side (the caller resizes). Images only are sent. */
  thumb?: { bytes: Uint8Array; mime: string };
}

export interface EnhanceVideo {
  /** Output length; null when it follows the reference video. */
  seconds: number | null;
  aspect: string;
  audio: StudioAudioMode;
  method?: StudioRemixMethod;
  keep?: StudioKeepKey[];
  change?: string;
  sheet?: FilmSheet | null;
}

export interface EnhanceInput {
  kind: EnhanceKind;
  profile: StudioPromptProfile;
  locale: 'ko' | 'en';
  prompt: string;
  references: EnhanceReference[];
  brand?: { name?: string; tone?: string; palette?: string[]; rules?: string[] } | null;
  /** Region edit only: the enlarged cropped region sent as image 1 / Figure 1 so Gemini sees the cut-out. */
  editCropThumb?: { bytes: Uint8Array; mime: string } | null;
  video?: EnhanceVideo | null;
}

export interface EnhanceResult {
  prompt: string;
  /** One short sentence in the customer's language on what was strengthened. */
  notes: string;
  source: 'model' | 'fallback';
}

export interface EnhanceDeps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  /** Optional DB runner + org ID so published `brand_studio_playbooks` (`inject_director = true`) feed the Director. */
  sql?: SqlRunner;
  organizationId?: string;
  /**
   * Optional (addition to the §12 signature): called with a short reason code when the fallback is
   * used ("no_key", "gemini_http_429", "lost_references" …). For server logs only; never shown.
   */
  onFallback?: (reason: string) => void;
}
