/**
 * What the editing studio does with the files one pick added from the device (A8): which go up as organization
 * assets, and what the screen shows for each. React-free; the composer calls `startDeviceUploads` after the new
 * cuts are on the timeline and passes its state setters as the hooks (tests drive it the same way).
 *
 * - Images never go up: here they are only references in this tab, never cuts (the image role check and the
 *   storage they would take are not asked for).
 * - Of several sounds in one pick only the last goes up: it is the one that becomes the music.
 * - A video longer than the library takes (`STUDIO_LIMITS.mediaSecondsMax`, the same constant the upload's
 *   completion checks) is not sent; it stays in this tab with a line saying why.
 * - Every upload shows "uploading", then either disappears into the asset (`adopted`) or stays in this tab
 *   (`tab_only`) with the library's sentence for the reason (`studioUploadErrorLine`).
 */
import { fill, studioUploadErrorLine, type StudioCopy } from '@/components/brand-studio/copy';
import { STUDIO_LIMITS, type StudioAssetKind, type StudioAssetView } from '@/lib/brand-studio/contracts';
import type {
  DeviceFileLike,
  DeviceUploadAdoption,
  DeviceUploadResult,
  MeasuredDeviceFile,
} from '@/lib/brand-studio/compose/device-files';

/**
 * The library's upload wording, as the library shows it: the word on a file on its way up
 * (`brandStudio.assets.uploading`), the sentence for each refusal (`brandStudio.errors`,
 * `brandStudio.unapprovedUpload`) and for an upload that did not go through (`brandStudio.uploadFailed`).
 */
export interface ComposeUploadCopy extends Pick<StudioCopy, 'errors' | 'unapprovedUpload' | 'uploadFailed'> {
  uploading: string;
}

/** A device file's upload, by its tab address: on its way up, or not uploaded (it stays in this tab). */
export type DeviceFileState = 'uploading' | 'tab_only';

/** One file a pick added, in pick order. */
export interface DevicePick {
  blobUrl: string;
  file: DeviceFileLike;
  kind: StudioAssetKind;
  measured: MeasuredDeviceFile;
}

/** Which of one pick's files go up, and which videos are too long to. */
export function planDeviceUploads(picks: readonly DevicePick[]): { upload: DevicePick[]; tooLong: DevicePick[] } {
  const lastSound = [...picks].reverse().find((p) => p.kind === 'audio');
  const upload: DevicePick[] = [];
  const tooLong: DevicePick[] = [];
  for (const pick of picks) {
    if (pick.kind === 'image') continue;
    if (pick.kind === 'audio' && pick !== lastSound) continue;
    const seconds = pick.measured.seconds;
    if (pick.kind === 'video' && typeof seconds === 'number' && seconds > STUDIO_LIMITS.mediaSecondsMax) tooLong.push(pick);
    else upload.push(pick);
  }
  return { upload, tooLong };
}

export interface DeviceUploadContext {
  /** Starts (or returns the already running) upload of one file: `deviceUploadRuns().start`. */
  start(blobUrl: string, file: DeviceFileLike, measured: MeasuredDeviceFile): Promise<DeviceUploadResult>;
  canCreate: boolean;
  /** Without it the uploads still run and the cut still says it stays here; no reason line is shown. */
  uploadCopy?: ComposeUploadCopy;
  /** The line for a video over the library's length; `{minutes}` is filled in. */
  tooLongTemplate: string;
  setState(blobUrl: string, state: DeviceFileState | null): void;
  adopted(blobUrl: string, asset: StudioAssetView, adoption: DeviceUploadAdoption): void;
  say(line: string): void;
}

/** Runs one pick's uploads; resolves when every one of them has settled. */
export function startDeviceUploads(picks: readonly DevicePick[], ctx: DeviceUploadContext): Promise<void> {
  const { upload, tooLong } = planDeviceUploads(picks);
  for (const pick of tooLong) {
    ctx.setState(pick.blobUrl, 'tab_only');
    ctx.say(fill(ctx.tooLongTemplate, { minutes: STUDIO_LIMITS.mediaSecondsMax / 60 }));
  }
  const stays = (blobUrl: string, result: Extract<DeviceUploadResult, { ok: false }>) => {
    ctx.setState(blobUrl, 'tab_only');
    if (ctx.uploadCopy) ctx.say(studioUploadErrorLine(ctx.uploadCopy, result.code, result.reason));
  };
  const settled = upload.map((pick) => {
    // Someone who cannot create would be refused by the server: the library's answer, without a request.
    if (!ctx.canCreate) return Promise.resolve(stays(pick.blobUrl, { ok: false, code: 'forbidden' }));
    ctx.setState(pick.blobUrl, 'uploading');
    return ctx.start(pick.blobUrl, pick.file, pick.measured).then((result) => {
      if (result.ok) {
        ctx.adopted(pick.blobUrl, result.asset, result.adoption);
        ctx.setState(pick.blobUrl, null);
        return;
      }
      stays(pick.blobUrl, result);
    });
  });
  return Promise.all(settled).then(() => undefined);
}
