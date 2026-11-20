/**
 * Sending a sound to a timeline (docs/BRAND-SOUND-STUDIO.md §4.5, §7.3): music goes into the one
 * background-music slot (`ComposeBgm`), a sound effect onto the effects track (`sfxClips`, at most 24).
 * The slot is single, so a different track already there is replaced only when the request says so.
 *
 * Shared by the server operations on saved projects (lib/brand-studio/video-projects/service.ts) and by
 * the editing studio hand-off, which today keeps its one timeline in this browser (`composeStorageKey`).
 * Client-safe: no env, no db.
 */
import {
  MAX_COMPOSE_SFX,
  emptyComposerProject,
  normalizeSfxClip,
  parseStoredProject,
  serializeProjectForStorage,
  type ComposerProject,
} from '../compose/timeline';

export interface SoundSendTrack {
  assetId: string;
  /** What the timeline calls it: the row's shown name. */
  label: string;
  /** Measured length in seconds, or null when unknown. */
  seconds: number | null;
  /** Where the timeline plays it from. */
  srcUrl: string;
}

/** Background music starts quieter than the clips (the editing studio's own default when it picks audio). */
export const SENT_BGM_VOLUME = 0.4;
/** An effect whose length was never measured is placed as a short sting; the editor can stretch it. */
const SFX_FALLBACK_SECONDS = 2;
/** Music whose length was never measured: the editing studio's own fallback. */
const BGM_FALLBACK_SECONDS = 15;

export type BgmPlacement =
  | { status: 'placed'; timeline: ComposerProject; replaced: boolean }
  | { status: 'replace_needed'; currentLabel: string };

export function placeBgm(timeline: ComposerProject, track: SoundSendTrack, replace: boolean): BgmPlacement {
  const current = timeline.bgm;
  const different = Boolean(current) && current!.assetId !== track.assetId;
  if (different && !replace) return { status: 'replace_needed', currentLabel: current!.label };
  const seconds = track.seconds != null && Number.isFinite(track.seconds) && track.seconds > 0 ? track.seconds : BGM_FALLBACK_SECONDS;
  return {
    status: 'placed',
    replaced: different,
    timeline: {
      ...timeline,
      bgm: {
        label: track.label.trim().slice(0, 80) || 'BGM',
        sourceKind: 'asset',
        assetId: track.assetId,
        srcUrl: track.srcUrl,
        durationSec: Math.max(1, Math.round(seconds * 10) / 10),
        trimStartSec: 0,
        // Same track again: keep the volume someone already set.
        volume: current && current.assetId === track.assetId ? current.volume : SENT_BGM_VOLUME,
      },
    },
  };
}

export type SfxPlacement = { status: 'placed'; timeline: ComposerProject } | { status: 'full' };

export function placeSfx(timeline: ComposerProject, track: SoundSendTrack, id: string, startSec = 0): SfxPlacement {
  const existing = timeline.sfxClips ?? [];
  if (existing.length >= MAX_COMPOSE_SFX) return { status: 'full' };
  const seconds = track.seconds != null && Number.isFinite(track.seconds) && track.seconds > 0 ? track.seconds : SFX_FALLBACK_SECONDS;
  const clip = normalizeSfxClip({
    id,
    label: track.label,
    sourceKind: 'asset',
    assetId: track.assetId,
    srcUrl: track.srcUrl,
    startSec: Math.max(0, startSec),
    durationSec: seconds,
    volume: 1,
  });
  return { status: 'placed', timeline: { ...timeline, sfxClips: [...existing, clip] } };
}

export type ComposeHandoff =
  | { status: 'placed'; stored: string; replaced: boolean }
  | { status: 'replace_needed'; currentLabel: string };

/**
 * The editing studio's browser-kept timeline with this music in its slot: the value to write back under
 * `composeStorageKey(organizationId)` before opening the editing studio, which reads it on load.
 */
export function composeBgmHandoff(raw: string | null, track: SoundSendTrack, replace: boolean): ComposeHandoff {
  const timeline = parseStoredProject(raw) ?? emptyComposerProject('9:16');
  const placed = placeBgm(timeline, track, replace);
  if (placed.status !== 'placed') return placed;
  return { status: 'placed', stored: serializeProjectForStorage(placed.timeline), replaced: placed.replaced };
}

export type ComposeSfxHandoff = { status: 'placed'; stored: string } | { status: 'full' };

/** The editing studio's browser-kept timeline with this effect added at 0 s on its effects track. */
export function composeSfxHandoff(raw: string | null, track: SoundSendTrack, id: string): ComposeSfxHandoff {
  const timeline = parseStoredProject(raw) ?? emptyComposerProject('9:16');
  const placed = placeSfx(timeline, track, id, 0);
  if (placed.status !== 'placed') return placed;
  return { status: 'placed', stored: serializeProjectForStorage(placed.timeline) };
}
