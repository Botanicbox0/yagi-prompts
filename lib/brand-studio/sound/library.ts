/**
 * The sound studio's list (docs/BRAND-SOUND-STUDIO.md §7.3): the organization's audio, as rows the screen
 * draws. SS1 reads what already exists: audio the brand uploaded and audio the older editing/video studio
 * paths saved. Generated tracks with their own job rows arrive in SS2.
 *
 * Client-safe: no env, no db. The page reads the rows (already scoped to a seated organization) and hands
 * them here.
 */
import type { StudioAssetView, StudioJobView } from '../contracts';

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
  /** Library key (`a:<assetId>` or `o:<outputId>`), the same key likes and folders use. */
  key: string;
  /** An upload or a saved file; null for a made version not saved to the assets yet (it is saved on send). */
  assetId: string | null;
  /** A version made here (SS2 on): its result, its run, its letter (A, B…). */
  outputId?: string;
  jobId?: string;
  letter?: string;
  /** Stored waveform peaks, when a browser has saved them. */
  waveform?: number[] | null;
  /** The description it was made from (made versions only), for "설명 복사하기" and "비슷하게 만들기". */
  prompt?: string;
  vocal?: boolean;
  /** Made versions: the lyrics as the customer wrote them (none for an instrumental or a description request). */
  lyrics?: string | null;
  /** Made versions: "더 고르게 만들기" was on. */
  careful?: boolean;
  /** Made versions: what went to the engine when the Prompt Architect took part ("보낸 문장 보기"), else null. */
  sent?: string | null;
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
export function soundStreamUrl(organizationId: string, id: string, source: 'asset' | 'output' = 'asset'): string {
  const q = new URLSearchParams({ organizationId, source, id });
  return `/api/brand-studio/compose?${q.toString()}`;
}

/** `A`, `B`, … for the versions one request returned (§4.2). */
export function versionLetter(idx: number): string {
  return String.fromCharCode(65 + Math.max(0, Math.min(25, idx)));
}

/**
 * The versions made here, as rows (§4.2): every ready result of a finished music run, named "<title> · A".
 * A version already saved to the assets keeps its asset id, so sending it needs no second save.
 */
export function musicTracks(organizationId: string, jobs: readonly StudioJobView[], likedKeys: ReadonlySet<string> | readonly string[]): SoundTrackView[] {
  const liked = likedKeys instanceof Set ? likedKeys : new Set(likedKeys as readonly string[]);
  const rows: SoundTrackView[] = [];
  for (const job of jobs) {
    if (job.kind !== 'music' || job.status !== 'succeeded') continue;
    const title = job.music?.title ?? '';
    job.outputs.forEach((output, i) => {
      if (output.kind !== 'audio') return;
      const letter = versionLetter(i);
      const name = title ? `${title} · ${letter}` : letter;
      const key = `o:${output.id}`;
      rows.push({
        key,
        assetId: output.savedAssetId,
        outputId: output.id,
        jobId: job.id,
        letter,
        waveform: output.waveform ?? null,
        prompt: job.prompt,
        vocal: job.music?.vocal ?? false,
        lyrics: job.music?.lyrics ?? null,
        careful: job.music?.careful ?? false,
        sent: job.finalPrompt,
        tab: 'music',
        name,
        displayName: title ? name : null,
        seconds: output.seconds,
        streamUrl: soundStreamUrl(organizationId, output.id, 'output'),
        source: 'generation',
        liked: liked.has(key),
        createdAt: job.createdAt,
      });
    });
  }
  return rows;
}

/**
 * Rows for the list: made versions and the brand's audio files, newest first. A saved version appears once,
 * as the version (its asset is the same file).
 */
export function mergeTracks(made: readonly SoundTrackView[], files: readonly SoundTrackView[]): SoundTrackView[] {
  const savedAs = new Set(made.map((t) => t.assetId).filter((id): id is string => Boolean(id)));
  const order = (a: SoundTrackView, b: SoundTrackView) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : (a.letter ?? '').localeCompare(b.letter ?? '');
  return [...made, ...files.filter((t) => !t.assetId || !savedAs.has(t.assetId))].sort(order);
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
