/**
 * The sound studio's list (docs/BRAND-SOUND-STUDIO.md §7.3): the organization's audio, as rows the screen
 * draws. SS1 reads what already exists: audio the brand uploaded and audio the older editing/video studio
 * paths saved. Generated tracks with their own job rows arrive in SS2.
 *
 * Client-safe: no env, no db. The page reads the rows (already scoped to a seated organization) and hands
 * them here.
 */
import type { StudioAssetView } from '../contracts';

export const SOUND_TABS = ['music', 'sfx'] as const;
export type SoundTab = (typeof SOUND_TABS)[number];

export function soundTabParam(value: string | string[] | undefined | null): SoundTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'sfx' ? 'sfx' : 'music';
}

/**
 * Which tab an existing audio asset belongs to. Sound effects made by the older video-studio path are saved
 * as generated audio named "사운드 이펙트 (5s).mp3" (lib/brand-studio/music/sfx.ts) and have no other mark;
 * everything else (uploads, older music) is music. SS2 and SS5 record the kind on the job row instead.
 */
export function soundTabOf(asset: Pick<StudioAssetView, 'kind' | 'name' | 'source'>): SoundTab | null {
  if (asset.kind !== 'audio') return null;
  if (asset.source === 'generation' && /^\s*(사운드 이펙트|sound effect)/i.test(asset.name)) return 'sfx';
  return 'music';
}

/** Machine-made file names (camera rolls, generator ids, UUIDs, hashes) are never drawn (TASTE 15). */
const MACHINE_NAME = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  /^[0-9a-f]{16,}$/i,
  /^(img|dsc|vid|mov|rec|audio|voice|track|sound|untitled)[\s_-]?\d+/i,
  /^(hf|sunra|suno|eleven|mj|gen)_/i,
  /^\d[\d\s_.-]{5,}$/,
];

/**
 * The name a row shows: the file name without its extension, or null when it is machine-made or empty
 * (the screen then shows its own fallback, e.g. the date). Search still matches the stored name.
 */
export function trackDisplayName(name: string): string | null {
  const base = name.trim().replace(/\.(mp3|wav|m4a|aac|ogg|flac)$/i, '').trim();
  if (!base) return null;
  if (MACHINE_NAME.some((pattern) => pattern.test(base))) return null;
  return base.slice(0, 80);
}

export interface SoundTrackView {
  /** Library key (`a:<assetId>`), the same key likes and folders use. */
  key: string;
  assetId: string;
  tab: SoundTab;
  /** The stored name (searched), and what the row draws (null: the screen's fallback). */
  name: string;
  displayName: string | null;
  /** Seconds in tenths, or null when the length was never measured. */
  seconds: number | null;
  /** Same-origin stream (Range supported), so playing and drawing the waveform never needs storage CORS. */
  streamUrl: string;
  source: StudioAssetView['source'];
  liked: boolean;
  createdAt: string;
}

/** The compose gateway streams organization audio by id, after the same studio checks as every screen. */
export function soundStreamUrl(organizationId: string, assetId: string): string {
  const q = new URLSearchParams({ organizationId, source: 'asset', id: assetId });
  return `/api/brand-studio/compose?${q.toString()}`;
}

export function soundTracks(
  organizationId: string,
  assets: readonly StudioAssetView[],
  likedKeys: ReadonlySet<string> | readonly string[],
): SoundTrackView[] {
  const liked = likedKeys instanceof Set ? likedKeys : new Set(likedKeys as readonly string[]);
  const rows: SoundTrackView[] = [];
  for (const asset of assets) {
    const tab = soundTabOf(asset);
    if (!tab) continue;
    const key = `a:${asset.id}`;
    rows.push({
      key,
      assetId: asset.id,
      tab,
      name: asset.name,
      displayName: trackDisplayName(asset.name),
      seconds: asset.seconds,
      streamUrl: soundStreamUrl(organizationId, asset.id),
      source: asset.source,
      liked: liked.has(key),
      createdAt: asset.createdAt,
    });
  }
  // Newest first; the page reads assets newest first already, this keeps it true after an upload is prepended.
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export interface SoundListFilter {
  query?: string;
  likedOnly?: boolean;
}

/** Search matches the stored name and the shown one, ignoring case and spacing. */
export function filterTracks(tracks: readonly SoundTrackView[], tab: SoundTab, filter: SoundListFilter = {}): SoundTrackView[] {
  const needle = (filter.query ?? '').trim().toLowerCase().replace(/\s+/g, '');
  return tracks.filter((track) => {
    if (track.tab !== tab) return false;
    if (filter.likedOnly && !track.liked) return false;
    if (!needle) return true;
    const hay = `${track.name} ${track.displayName ?? ''}`.toLowerCase().replace(/\s+/g, '');
    return hay.includes(needle);
  });
}

/** `2:41`, `0:07`, `12:03`; `–:––` when unknown. */
export function formatTrackLength(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '–:––';
  const whole = Math.round(seconds);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
