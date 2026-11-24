/**
 * Files picked from the device in the editing studio (`/brand/studio/compose`, "+ 내 파일 올리기" and
 * "+ 내 음원 올리기").
 *
 * Which types it takes: the library's list (`STUDIO_UPLOAD_MIMES`), so a file the editor takes is a file the
 * library can upload; `label` is the name the hint and the "unsupported file" line use
 * (tests/brand-studio/compose/device-files.test.ts pins both lines to this list).
 *
 * What happens to it (A8): the file goes on the timeline at once from a `blob:` address (only this tab can
 * play it, and the save leaves it out), and is uploaded as an organization asset through the library's own
 * client (`createStudioApi().upload`: same type, size, storage and role checks, same answers). When the upload
 * lands, `adoptDeviceUpload` switches every cut, take, music, overlay and effect that plays that address to
 * the asset, keeping everything else, so from then on it is saved like any library cut. A refused or failed
 * upload leaves it as before: usable in this tab, gone after a reload, and the editor says so.
 *
 * Client-safe: no React, no server code.
 */
import type {
  StudioAssetKind,
  StudioAssetSaved,
  StudioAssetView,
  StudioErrorCode,
  StudioFailure,
} from '@/lib/brand-studio/contracts';
import type { UploadLimitReason } from '@/lib/brands/upload-limits-format';
import type { ComposeBgm, ComposeClip, ComposeOverlayClip, ComposeSfxClip, ComposerProject, TimelineClipTake } from './timeline';

export interface DeviceFileFormat {
  label: string;
  kind: StudioAssetKind;
  mime: string;
  /** Extensions without the dot, lower case; a file with no type is read by these. */
  exts: readonly string[];
}

export const DEVICE_FILE_FORMATS: readonly DeviceFileFormat[] = [
  { label: 'MP4', kind: 'video', mime: 'video/mp4', exts: ['mp4'] },
  { label: 'MOV', kind: 'video', mime: 'video/quicktime', exts: ['mov'] },
  { label: 'MP3', kind: 'audio', mime: 'audio/mpeg', exts: ['mp3'] },
  { label: 'WAV', kind: 'audio', mime: 'audio/wav', exts: ['wav'] },
  { label: 'JPG', kind: 'image', mime: 'image/jpeg', exts: ['jpg', 'jpeg'] },
  { label: 'PNG', kind: 'image', mime: 'image/png', exts: ['png'] },
  { label: 'WEBP', kind: 'image', mime: 'image/webp', exts: ['webp'] },
];

/** The file input's `accept`: every type, then every extension (optionally of one kind). */
export function deviceFileAccept(kind?: StudioAssetKind): string {
  const formats = kind ? DEVICE_FILE_FORMATS.filter((f) => f.kind === kind) : DEVICE_FILE_FORMATS;
  return [...formats.map((f) => f.mime), ...formats.flatMap((f) => f.exts.map((e) => `.${e}`))].join(',');
}

export const DEVICE_FILE_ACCEPT = deviceFileAccept();

/** What a picked file is: by its type, else by its extension; `null` when the editor does not take it. */
export function deviceFileKind(file: { type: string; name: string }): StudioAssetKind | null {
  const byType = DEVICE_FILE_FORMATS.find((f) => f.mime === file.type);
  if (byType) return byType.kind;
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  const byExt = ext ? DEVICE_FILE_FORMATS.find((f) => f.exts.includes(ext)) : undefined;
  return byExt?.kind ?? null;
}

/* ------------------------------------------------------------------ uploading a device file */

/** The address a library cut plays from (the editor's media browser, and the new editor's `composeStreamUrl`). */
export function composeSourceUrl(organizationId: string, source: 'asset' | 'output', id: string): string {
  const query = new URLSearchParams({ organizationId, source, id });
  return `/api/brand-studio/compose?${query.toString()}`;
}

/** What a cut playing a device file becomes once the file is an asset. */
export interface DeviceUploadAdoption {
  assetId: string;
  srcUrl: string;
  thumbUrl: string | null;
}

export type DeviceUploadResult =
  | { ok: true; asset: StudioAssetView; adoption: DeviceUploadAdoption }
  | { ok: false; code: StudioErrorCode; reason?: UploadLimitReason };

export interface DeviceFileLike extends Blob {
  name: string;
  type: string;
  size: number;
}

export interface MeasuredDeviceFile {
  width?: number;
  height?: number;
  seconds?: number;
}

/** The part of the library client (`createStudioApi`) a device upload uses. */
export interface DeviceUploadApi {
  upload(
    file: DeviceFileLike,
    options: { measure?: (file: Blob, kind: StudioAssetKind) => Promise<MeasuredDeviceFile> },
  ): Promise<StudioAssetSaved | StudioFailure>;
}

/**
 * Uploads one picked file as an organization asset through the library's client: it checks type and size
 * before sending anything, the server checks storage and role, and a refusal comes back with the same code
 * (and reason) the library shows a sentence for. `measured` is what the editor already read from the file.
 */
export async function uploadDeviceFile(
  api: DeviceUploadApi,
  organizationId: string,
  file: DeviceFileLike,
  measured: MeasuredDeviceFile,
): Promise<DeviceUploadResult> {
  const saved = await api.upload(file, { measure: async () => measured });
  if (saved.ok !== true) return saved.reason ? { ok: false, code: saved.code, reason: saved.reason } : { ok: false, code: saved.code };
  const { asset } = saved;
  return {
    ok: true,
    asset,
    adoption: { assetId: asset.id, srcUrl: composeSourceUrl(organizationId, 'asset', asset.id), thumbUrl: asset.thumbUrl ?? null },
  };
}

/**
 * One upload per picked file, keyed by the file's tab address: asking again (a re-render, a split cut, undo)
 * returns the upload already running or done, never a second one.
 */
export function deviceUploadRuns(run: (file: DeviceFileLike, measured: MeasuredDeviceFile) => Promise<DeviceUploadResult>) {
  const runs = new Map<string, Promise<DeviceUploadResult>>();
  return {
    start(blobUrl: string, file: DeviceFileLike, measured: MeasuredDeviceFile): Promise<DeviceUploadResult> {
      let running = runs.get(blobUrl);
      if (!running) {
        running = run(file, measured);
        runs.set(blobUrl, running);
      }
      return running;
    },
  };
}

/**
 * A switched timeline is the same timeline: only where a file plays from changed. Each project an adoption makes
 * remembers the one it came from (followed to the first), so a screen that compares timelines by identity
 * ("말로 편집": a patch answer's base, its history marks) can ask `sameTimeline` instead and never notices
 * an upload landing.
 */
const adoptedFrom = new WeakMap<ComposerProject, ComposerProject>();

function originOf(project: ComposerProject): ComposerProject {
  return adoptedFrom.get(project) ?? project;
}

/** True for the same timeline, or one an upload switched in place (in either direction or both). */
export function sameTimeline(a: ComposerProject, b: ComposerProject): boolean {
  return a === b || originOf(a) === originOf(b);
}

function adoptedClip<T extends ComposeClip | TimelineClipTake>(item: T, a: DeviceUploadAdoption): T {
  const { outputId: _output, ...rest } = item;
  return { ...rest, sourceKind: 'asset', assetId: a.assetId, srcUrl: a.srcUrl, thumbUrl: item.thumbUrl ?? a.thumbUrl } as T;
}

function adoptList<T extends { srcUrl: string }>(list: readonly T[] | undefined, blobUrl: string, change: (item: T) => T): T[] | undefined {
  if (!list || !list.some((item) => item.srcUrl === blobUrl)) return undefined;
  return list.map((item) => (item.srcUrl === blobUrl ? change(item) : item));
}

/**
 * Every cut (and its takes), the music, overlays and sound effects that play `blobUrl` now play the uploaded
 * asset: same id, label, trim, place, sound, speed and everything else. The same project when nothing plays it.
 */
export function adoptDeviceUpload(project: ComposerProject, blobUrl: string, a: DeviceUploadAdoption): ComposerProject {
  let changed = false;
  const clips = project.clips.map((clip) => {
    const takes = adoptList(clip.takes, blobUrl, (take) => adoptedClip(take, a));
    if (clip.srcUrl !== blobUrl && !takes) return clip;
    changed = true;
    const base = clip.srcUrl === blobUrl ? adoptedClip(clip, a) : clip;
    return takes ? { ...base, takes } : base;
  });
  const bgm: ComposeBgm | null =
    project.bgm && project.bgm.srcUrl === blobUrl ? { ...project.bgm, sourceKind: 'asset', assetId: a.assetId, srcUrl: a.srcUrl } : project.bgm;
  const overlays = adoptList<ComposeOverlayClip>(project.overlays, blobUrl, (o) => {
    const { outputId: _output, ...rest } = o;
    return { ...rest, sourceKind: 'asset', assetId: a.assetId, srcUrl: a.srcUrl };
  });
  const sfxClips = adoptList<ComposeSfxClip>(project.sfxClips, blobUrl, (sfx) => ({ ...sfx, sourceKind: 'asset', assetId: a.assetId, srcUrl: a.srcUrl }));
  if (!changed && bgm === project.bgm && !overlays && !sfxClips) return project;
  const next: ComposerProject = {
    ...project,
    clips: changed ? clips : project.clips,
    bgm,
    ...(overlays ? { overlays } : {}),
    ...(sfxClips ? { sfxClips } : {}),
  };
  adoptedFrom.set(next, originOf(project));
  return next;
}

/** `adoptDeviceUpload` for every finished upload (a timeline committed from an older copy, e.g. a "말로 편집" draft). */
export function adoptDeviceUploads(project: ComposerProject, adoptions: ReadonlyMap<string, DeviceUploadAdoption>): ComposerProject {
  let next = project;
  for (const [blobUrl, a] of adoptions) next = adoptDeviceUpload(next, blobUrl, a);
  return next;
}
