/**
 * Per-model music Prompt Architect profiles for Sound Studio composer v2 (`lib/brand-studio/sound/architect.ts`).
 * Looked up by `MusicModelId` (`'suno-v6' | 'suno-v6-wild' | 'minimax-music-3'`).
 *
 * Note: the closed v1 path continues to read `SUNO_HEADER` (`suno@2026-11-21.2`) and `SUNO_PROFILE` from `../suno.ts`
 * directly so closed-organization jobs stay byte-identical.
 */
import type { MusicModelId } from '@/lib/brand-studio/sound/engine';
import type { ProfileHeader } from '../meta';
import {
  MINIMAX_MUSIC_3_HEADER,
  MINIMAX_MUSIC_3_PROFILE,
  MINIMAX_OPEN_WEIGHTS_TAGS,
} from './minimax-music-3';
import { SUNO_V6_HEADER, SUNO_V6_PROFILE } from './suno-v6';
import { SUNO_V6_WILD_HEADER, SUNO_V6_WILD_NOTE, SUNO_V6_WILD_PROFILE } from './suno-v6-wild';

export {
  MINIMAX_MUSIC_3_HEADER,
  MINIMAX_MUSIC_3_PROFILE,
  MINIMAX_OPEN_WEIGHTS_TAGS,
  SUNO_V6_HEADER,
  SUNO_V6_PROFILE,
  SUNO_V6_WILD_HEADER,
  SUNO_V6_WILD_NOTE,
  SUNO_V6_WILD_PROFILE,
};

export interface MusicProfile {
  id: MusicModelId;
  header: ProfileHeader;
  /** Recorded on v2 jobs as `work.enhancer.profileVersion` (`<id>@<version>`). */
  version: string;
  /** System instruction block sent to the text model. */
  system: string;
  limits: {
    styleMin: number;
    styleAimMax: number;
    styleHardMax: number;
    titleMax: number;
    lyricsMax: number;
  };
  /** Documented section tag allow-list when the engine specifies a fixed set (`minimax-music-3`). */
  allowedTags?: readonly string[];
  /** Informational model-behaviour note (not sent as a wording rule). */
  note?: string;
}

export const MUSIC_PROFILES: Readonly<Record<MusicModelId, MusicProfile>> = {
  'suno-v6': {
    id: 'suno-v6',
    header: SUNO_V6_HEADER,
    version: `${SUNO_V6_HEADER.id}@${SUNO_V6_HEADER.version}`,
    system: SUNO_V6_PROFILE,
    limits: {
      styleMin: 40,
      styleAimMax: 900,
      styleHardMax: 1000,
      titleMax: 40,
      lyricsMax: 5000,
    },
  },
  'suno-v6-wild': {
    id: 'suno-v6-wild',
    header: SUNO_V6_WILD_HEADER,
    version: `${SUNO_V6_WILD_HEADER.id}@${SUNO_V6_WILD_HEADER.version}`,
    system: SUNO_V6_WILD_PROFILE,
    limits: {
      styleMin: 40,
      styleAimMax: 900,
      styleHardMax: 1000,
      titleMax: 40,
      lyricsMax: 5000,
    },
    note: SUNO_V6_WILD_NOTE,
  },
  'minimax-music-3': {
    id: 'minimax-music-3',
    header: MINIMAX_MUSIC_3_HEADER,
    version: `${MINIMAX_MUSIC_3_HEADER.id}@${MINIMAX_MUSIC_3_HEADER.version}`,
    system: MINIMAX_MUSIC_3_PROFILE,
    limits: {
      styleMin: 200,
      styleAimMax: 1800,
      styleHardMax: 2000,
      titleMax: 40,
      lyricsMax: 3500,
    },
    allowedTags: MINIMAX_OPEN_WEIGHTS_TAGS,
  },
};

export function musicProfileForModel(modelId: MusicModelId): MusicProfile {
  const profile = MUSIC_PROFILES[modelId];
  if (!profile) throw new Error(`unknown music model profile: ${String(modelId)}`);
  return profile;
}
