/**
 * The editing studio's own device-file logic (A8 + review 1, 2, 4, 5), driven without a browser:
 * `startDeviceUploads` is what the composer calls after a pick, with its state setters as hooks.
 * - images are never uploaded (they are never cuts here), and of several sounds only the one that becomes the
 *   music goes up;
 * - a video longer than the library takes is not uploaded and says why;
 * - each upload goes uploading -> adopted (state cleared) or -> tab-only with the line for its reason, and an
 *   upload that merely did not go through gets one sentence that is true for any upload and never says reload.
 */
import { describe, expect, it, vi } from 'vitest';
import { studioUploadErrorLine } from '@/components/brand-studio/copy';
import {
  planDeviceUploads,
  startDeviceUploads,
  type ComposeUploadCopy,
  type DevicePick,
  type DeviceUploadContext,
} from '@/components/brand-studio/compose/device-uploads';
import { STUDIO_ERROR_CODES, STUDIO_LIMITS, type StudioAssetView, type StudioErrorCode } from '@/lib/brand-studio/contracts';
import { composeSourceUrl, type DeviceUploadResult } from '@/lib/brand-studio/compose/device-files';
import { getDictionary } from '@/lib/i18n/dictionaries';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const ASSET = '40000000-0000-4000-8000-000000000001';
const ko = getDictionary('ko');
const uploadCopy: ComposeUploadCopy = {
  uploading: ko.brandStudio.assets.uploading,
  errors: ko.brandStudio.errors,
  unapprovedUpload: ko.brandStudio.unapprovedUpload,
  uploadFailed: ko.brandStudio.uploadFailed,
};
const tooLongTemplate = ko.studioCompose.status.deviceTooLong;

function pick(n: number, kind: DevicePick['kind'], seconds?: number): DevicePick {
  const ext = kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : 'png';
  const type = kind === 'video' ? 'video/mp4' : kind === 'audio' ? 'audio/mpeg' : 'image/png';
  const file = new File([new Uint8Array(8)], `file ${n}.${ext}`, { type });
  return { blobUrl: `blob:http://localhost/${n}`, file, kind, measured: seconds === undefined ? {} : { seconds } };
}

const asset = (id = ASSET): StudioAssetView => ({
  id, kind: 'video', role: null, name: 'x', tags: [], url: `/m/${id}`, thumbUrl: null, width: null, height: null, seconds: 5, source: 'upload', createdAt: '2026-11-24T00:00:00.000Z',
});
const ok = (): DeviceUploadResult => ({ ok: true, asset: asset(), adoption: { assetId: ASSET, srcUrl: composeSourceUrl(ORG, 'asset', ASSET), thumbUrl: null } });

function context(result: (blobUrl: string) => DeviceUploadResult, extra: Partial<DeviceUploadContext> = {}) {
  const states: Array<[string, string | null]> = [];
  const said: string[] = [];
  const adopted: string[] = [];
  const start = vi.fn(async (blobUrl: string) => result(blobUrl));
  const ctx: DeviceUploadContext = {
    start,
    canCreate: true,
    uploadCopy,
    tooLongTemplate,
    setState: (blobUrl, state) => states.push([blobUrl, state]),
    adopted: (blobUrl) => adopted.push(blobUrl),
    say: (line) => said.push(line),
    ...extra,
  };
  return { ctx, start, states, said, adopted };
}

describe('which device files go up', () => {
  it('images never; of several sounds only the last (the music); a video over the library length stays here', () => {
    const max = STUDIO_LIMITS.mediaSecondsMax;
    const picks = [pick(1, 'image'), pick(2, 'video', 12), pick(3, 'audio', 30), pick(4, 'audio', 40), pick(5, 'video', max + 1), pick(6, 'video', max)];
    const plan = planDeviceUploads(picks);
    expect(plan.upload.map((p) => p.blobUrl)).toEqual(['blob:http://localhost/2', 'blob:http://localhost/4', 'blob:http://localhost/6']);
    expect(plan.tooLong.map((p) => p.blobUrl)).toEqual(['blob:http://localhost/5']);
    // A long sound is not refused for its length (the library does not record it), and an unknown length goes up.
    expect(planDeviceUploads([pick(7, 'audio', max * 3)]).upload).toHaveLength(1);
    expect(planDeviceUploads([pick(8, 'video')]).upload).toHaveLength(1);
  });

  it('a pick runs the uploads, sets each state, and adopts the finished ones', async () => {
    const { ctx, start, states, said, adopted } = context(() => ok());
    const max = STUDIO_LIMITS.mediaSecondsMax;
    await startDeviceUploads([pick(1, 'image'), pick(2, 'video', 12), pick(3, 'audio'), pick(4, 'audio'), pick(5, 'video', max + 30)], ctx);
    expect(start.mock.calls.map((c) => c[0])).toEqual(['blob:http://localhost/2', 'blob:http://localhost/4']);
    expect(adopted).toEqual(['blob:http://localhost/2', 'blob:http://localhost/4']);
    expect(states).toEqual([
      ['blob:http://localhost/5', 'tab_only'],
      ['blob:http://localhost/2', 'uploading'],
      ['blob:http://localhost/4', 'uploading'],
      ['blob:http://localhost/2', null],
      ['blob:http://localhost/4', null],
    ]);
    // The too-long video says the real reason, with the library's length.
    expect(said).toEqual([tooLongTemplate.replace('{minutes}', String(max / 60))]);
    expect(said[0]).toContain(String(max / 60));
    // The image and the first sound get no state at all: as before this branch.
    expect(states.some(([b]) => b.endsWith('/1') || b.endsWith('/3'))).toBe(false);
  });

  it('a refusal leaves the file in this tab with the line for its reason', async () => {
    const cases: Array<[StudioErrorCode, string | undefined, string]> = [
      ['file_too_large', undefined, ko.brandStudio.errors.file_too_large],
      ['unsupported_file', undefined, ko.brandStudio.errors.unsupported_file],
      ['storage_quota_exceeded', undefined, ko.brandStudio.errors.storage_quota_exceeded],
      ['storage_quota_exceeded', 'unapproved_quota', ko.brandStudio.unapprovedUpload.quotaExceeded],
      ['asset_limit', undefined, ko.brandStudio.errors.asset_limit],
      ['forbidden', undefined, ko.brandStudio.errors.forbidden],
      ['sign_in_required', undefined, ko.brandStudio.errors.sign_in_required],
      ['failed', undefined, ko.brandStudio.uploadFailed],
      ['invalid', undefined, ko.brandStudio.uploadFailed],
      ['conflict', undefined, ko.brandStudio.uploadFailed],
      ['too_many_running', undefined, ko.brandStudio.uploadFailed],
      ['not_found', undefined, ko.brandStudio.uploadFailed],
    ];
    for (const [code, reason, line] of cases) {
      const { ctx, states, said, adopted } = context(() => ({ ok: false, code, ...(reason ? { reason: reason as 'unapproved_quota' } : {}) }));
      await startDeviceUploads([pick(9, 'video', 5)], ctx);
      expect(states, code).toEqual([['blob:http://localhost/9', 'uploading'], ['blob:http://localhost/9', 'tab_only']]);
      expect(said, code).toEqual([line]);
      expect(adopted).toEqual([]);
    }
  });

  it('someone who cannot create gets the library’s no-permission line without a request', async () => {
    const { ctx, start, states, said } = context(() => ok(), { canCreate: false });
    await startDeviceUploads([pick(1, 'video', 5), pick(2, 'image')], ctx);
    expect(start).not.toHaveBeenCalled();
    expect(states).toEqual([['blob:http://localhost/1', 'tab_only']]);
    expect(said).toEqual([ko.brandStudio.errors.forbidden]);
  });
});

describe('the upload failure sentence', () => {
  it('is one line, true for any upload, that never asks for a reload; the true reason lines stay', () => {
    for (const locale of ['ko', 'en'] as const) {
      const copy = getDictionary(locale).brandStudio;
      const line = copy.uploadFailed;
      expect(line).not.toBe(copy.errors.failed);
      for (const code of ['failed', 'invalid', 'conflict', 'too_many_running', 'not_found', 'made_up', null, undefined]) {
        expect(studioUploadErrorLine(copy, code)).toBe(line);
      }
      for (const code of ['file_too_large', 'unsupported_file', 'storage_quota_exceeded', 'asset_limit', 'forbidden', 'sign_in_required', 'feature_unavailable', 'studio_closed'] as const) {
        expect(studioUploadErrorLine(copy, code)).toBe(copy.errors[code]);
      }
      expect(line).not.toMatch(/새로고침|새로 고침|reload|refresh/i);
      expect(line).not.toMatch(/이미지|생성|image|generat/i);
    }
    // Every code the client can return is answered by one of the two kinds of line.
    for (const code of STUDIO_ERROR_CODES) expect(typeof studioUploadErrorLine(ko.brandStudio, code)).toBe('string');
  });
});
