/**
 * Editing studio v2, V1 — the organization's footage the editor can put in a film, and the `clip=` link
 * that opens the editor with one of them (docs/BRAND-EDITING-STUDIO-V2.md §6.1, §6.2, §11 V1).
 *
 * The clip addresses are exactly the ones the current editor stores (the same-origin stream route for
 * the picture, the public thumbnail for the poster), so a clip added in either editor is the same clip
 * in the other. Video only in V1: no stills, no audio files. Pure.
 */
import type { ComposeClip } from '@/lib/brand-studio/compose/timeline';
import type { StudioAssetView, StudioOutputView } from '@/lib/brand-studio/contracts';
import type { FrameSequence } from './frames';

export interface EditorSource {
  /** `a:<asset id>` or `o:<output id>`: the key the library and `clip=` links use. */
  key: string;
  kind: 'asset' | 'output';
  id: string;
  label: string;
  /** The same-origin stream route, as the current editor stores it. */
  srcUrl: string;
  thumbUrl: string | null;
  /** Length in tenths of a second, as the views give it. */
  seconds: number | null;
  /** Exact length in milliseconds, when the view has it. */
  durationMs: number | null;
  createdAt: string;
}

/** The address the current editor stores for a clip (`sameOriginComposeUrl` in its composer). */
export function composeStreamUrl(organizationId: string, source: 'asset' | 'output', id: string): string {
  const query = new URLSearchParams({ organizationId, source, id });
  return `/api/brand-studio/compose?${query.toString()}`;
}

/** Finished video-studio results and video assets, newest first. Everything else is left out. */
export function editorSources(
  organizationId: string,
  assets: readonly StudioAssetView[],
  outputs: ReadonlyArray<StudioOutputView & { label: string }>,
): EditorSource[] {
  const fromOutputs = outputs
    .filter((output) => output.kind === 'video')
    .map(
      (output): EditorSource => ({
        key: `o:${output.id}`,
        kind: 'output',
        id: output.id,
        label: output.label,
        srcUrl: composeStreamUrl(organizationId, 'output', output.id),
        thumbUrl: output.thumbUrl,
        seconds: output.seconds,
        durationMs: output.durationMs ?? null,
        createdAt: output.createdAt,
      }),
    );
  const fromAssets = assets
    .filter((asset) => asset.kind === 'video')
    .map(
      (asset): EditorSource => ({
        key: `a:${asset.id}`,
        kind: 'asset',
        id: asset.id,
        label: asset.name,
        srcUrl: composeStreamUrl(organizationId, 'asset', asset.id),
        thumbUrl: asset.thumbUrl,
        seconds: asset.seconds,
        durationMs: asset.durationMs ?? null,
        createdAt: asset.createdAt,
      }),
    );
  return [...fromOutputs, ...fromAssets].sort((a, b) => (a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1));
}

/** The footage's length in seconds: exact when known. */
export function sourceSeconds(source: Pick<EditorSource, 'seconds' | 'durationMs'>): number | null {
  if (typeof source.durationMs === 'number' && source.durationMs > 0) return source.durationMs / 1000;
  if (typeof source.seconds === 'number' && source.seconds > 0) return source.seconds;
  return null;
}

/**
 * The stored clip a new cut from the bin becomes: what the current editor's own "add" writes (whole
 * footage, length from the view, at least a second).
 */
export function storedClipForSource(source: EditorSource, id: string, measuredSeconds: number | null): ComposeClip {
  const durationSec = Math.max(1, source.seconds ?? measuredSeconds ?? 5);
  return {
    id,
    label: source.label,
    sourceKind: source.kind,
    ...(source.kind === 'asset' ? { assetId: source.id } : { outputId: source.id }),
    srcUrl: source.srcUrl,
    thumbUrl: source.thumbUrl,
    durationSec,
    trimStartSec: 0,
    trimEndSec: durationSec,
    volume: 1,
    muted: false,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `a:<uuid>` / `o:<uuid>` from a `clip=` value (already URL-decoded), else `null`. */
export function parseClipParam(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const match = /^([ao]):(.+)$/.exec(value.trim());
  if (!match || !UUID.test(match[2]!)) return null;
  return `${match[1]}:${match[2]!.toLowerCase()}`;
}

/**
 * The footage a `clip=` link asks for, when it is in the organization's list and is not already the
 * film's last cut (opening the same link twice adds it once). `null` means: do nothing, say nothing.
 */
export function deepLinkSource(sources: readonly EditorSource[], key: string | null, film: Pick<FrameSequence, 'clips'>): EditorSource | null {
  if (!key) return null;
  const source = sources.find((entry) => entry.key.toLowerCase() === key);
  if (!source) return null;
  const last = film.clips[film.clips.length - 1];
  return last && last.srcUrl === source.srcUrl ? null : source;
}
