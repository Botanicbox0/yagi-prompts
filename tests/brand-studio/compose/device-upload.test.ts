/**
 * A8: "+ 내 파일 올리기" / "+ 내 음원 올리기" in the old editing studio (/brand/studio/compose) put a device file
 * on the timeline as a `blob:` address that the save drops, so the cut was gone after a reload and nothing
 * said so. Now the file is uploaded as an organization asset through the library's own client path
 * (`createStudioApi().upload`: reserve -> PUT/POST -> complete, same type, size, storage and role checks), and
 * when it lands every cut (and the music) that plays it switches to the asset in place: same id, trim,
 * position, sound, speed. From then on it is saved like any library cut. A refused or failed upload leaves the
 * cut in this tab only, as before, and the editor says so.
 */
import { describe, expect, it, vi } from 'vitest';
import { createStudioApi } from '@/components/brand-studio/api';
import { studioUploadErrorLine, type StudioCopy } from '@/components/brand-studio/copy';
import { commitHistory, initHistory, mapHistory, redoHistory, undoHistory } from '@/components/brand-studio/compose/history';
import { STUDIO_LIMITS, type StudioAssetView } from '@/lib/brand-studio/contracts';
import {
  adoptDeviceUpload,
  adoptDeviceUploads,
  composeSourceUrl,
  deviceUploadRuns,
  uploadDeviceFile,
  type DeviceUploadAdoption,
} from '@/lib/brand-studio/compose/device-files';
import {
  appendClip,
  applyTimelinePatches,
  emptyComposerProject,
  parseStoredProject,
  serializeProjectForStorage,
  type ComposerProject,
} from '@/lib/brand-studio/compose/timeline';
import { fromStored } from '@/lib/brand-studio/editor-v2/stored';
import { composeStreamUrl } from '@/lib/brand-studio/editor-v2/sources';
import { getDictionary } from '@/lib/i18n/dictionaries';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const ASSET = '40000000-0000-4000-8000-000000000001';
const LIBRARY_ASSET = '40000000-0000-4000-8000-000000000002';
const BLOB = 'blob:http://localhost:3634/7c1d0e2a-0000-4000-8000-000000000001';
const MUSIC_BLOB = 'blob:http://localhost:3634/7c1d0e2a-0000-4000-8000-000000000002';

function assetView(id: string, kind: StudioAssetView['kind'] = 'video'): StudioAssetView {
  return {
    id,
    kind,
    role: null,
    name: kind === 'audio' ? 'theme.mp3' : 'my clip.mp4',
    tags: [],
    url: `/media/${id}`,
    thumbUrl: null,
    width: kind === 'video' ? 1080 : null,
    height: kind === 'video' ? 1920 : null,
    seconds: kind === 'image' ? null : 8,
    source: 'upload',
    createdAt: '2026-11-24T00:00:00.000Z',
  };
}

/** A file of `size` bytes. Real bytes when a type is missing or an alias (the upload makes a copy under the right type). */
function file(name: string, type: string, size: number): File {
  const canonical = ['video/mp4', 'video/quicktime', 'audio/mpeg', 'audio/wav', 'image/jpeg', 'image/png', 'image/webp'].includes(type);
  if (!canonical) return new File([new Uint8Array(size)], name, { type });
  const f = new File([new Uint8Array(4)], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

/** A fake server for the library's upload path; records every request. */
function fakeServer(options: { reserve?: Record<string, unknown>; put?: number; throwOn?: 'reserve' | 'put'; kind?: StudioAssetView['kind'] } = {}) {
  const calls: Array<{ url: string; method: string; operation?: string; input?: Record<string, unknown> }> = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    let operation: string | undefined;
    let body: Record<string, unknown> | undefined;
    if (typeof init?.body === 'string') {
      const parsed = JSON.parse(init.body) as { operation: string; input: Record<string, unknown> };
      operation = parsed.operation;
      body = parsed.input;
    }
    calls.push({ url, method, ...(operation ? { operation, input: body } : {}) });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    if (operation === 'asset.reserve') {
      if (options.throwOn === 'reserve') throw new TypeError('Failed to fetch');
      return json(options.reserve ?? { ok: true, id: ASSET, direct: false }, options.reserve?.ok === false ? 400 : 200);
    }
    if (operation === 'asset.complete') return json({ ok: true, asset: assetView(ASSET, options.kind) });
    if (url.startsWith(`/api/brand-studio/assets/${ASSET}`)) {
      if (options.throwOn === 'put') throw new TypeError('Failed to fetch');
      return new Response(null, { status: options.put ?? 200 });
    }
    return json({ ok: false, code: 'not_found' }, 404);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const measured = { seconds: 8, width: 1080, height: 1920 };

/** A film with a device cut (split in two and trimmed), a library cut, and device music. */
function filmWithDeviceFile(): ComposerProject {
  let p = emptyComposerProject('9:16');
  p = appendClip(p, {
    id: 'dev',
    label: 'my clip',
    sourceKind: 'local',
    srcUrl: BLOB,
    thumbUrl: null,
    durationSec: 8,
    trimStartSec: 0,
    trimEndSec: 8,
    volume: 1,
    muted: false,
  });
  p = appendClip(p, {
    id: 'lib',
    label: 'library clip',
    sourceKind: 'asset',
    assetId: LIBRARY_ASSET,
    srcUrl: composeSourceUrl(ORG, 'asset', LIBRARY_ASSET),
    thumbUrl: '/thumb.jpg',
    durationSec: 5,
    trimStartSec: 0,
    trimEndSec: 5,
    volume: 1,
    muted: false,
  });
  p = applyTimelinePatches(p, [
    { op: 'split_clip_at', clipIndex: 0, atMediaSec: 3 },
    { op: 'trim_clip', clipIndex: 1, trimEndSec: 7 },
    { op: 'set_clip_audio', clipIndex: 0, volume: 0.4, muted: true },
    { op: 'set_clip_speed', clipIndex: 1, playbackRate: 2 },
    { op: 'move_clip', fromIndex: 2, toIndex: 0 },
  ]).project;
  return {
    ...p,
    bgm: { label: 'theme', sourceKind: 'local', srcUrl: MUSIC_BLOB, durationSec: 30, trimStartSec: 2, volume: 0.4 },
  };
}

const adoption: DeviceUploadAdoption = { assetId: ASSET, srcUrl: composeSourceUrl(ORG, 'asset', ASSET), thumbUrl: null };

describe('device files go up through the library path', () => {
  it('reserve -> bytes -> complete, with the browser measurement; the cut then plays from the library address', async () => {
    const server = fakeServer();
    const api = createStudioApi({ organizationId: ORG, fetch: server.fetch });
    const result = await uploadDeviceFile(api, ORG, file('my clip.mp4', 'video/mp4', 9_000_000), measured);
    expect(server.calls.map((c) => c.operation ?? `${c.method} ${c.url.split('?')[0]}`)).toEqual([
      'asset.reserve',
      `POST /api/brand-studio/assets/${ASSET}`,
      'asset.complete',
    ]);
    expect(server.calls[0]!.input).toMatchObject({ organizationId: ORG, name: 'my clip.mp4', mime: 'video/mp4', sizeBytes: 9_000_000 });
    expect(server.calls[2]!.input).toMatchObject({ organizationId: ORG, assetId: ASSET, seconds: 8, width: 1080, height: 1920 });
    expect(result).toEqual({ ok: true, asset: assetView(ASSET), adoption });
    // The same stream address the new editor and the media browser use for a library asset.
    expect(adoption.srcUrl).toBe(composeStreamUrl(ORG, 'asset', ASSET));
  });

  it('the limits are the library’s: nothing is sent for a file the library would refuse', async () => {
    // [name, reported type, size, refusal or the type the upload is sent under]
    const cases: Array<[string, string, number, { code: string } | { mime: string }]> = [
      ['big.mp4', 'video/mp4', STUDIO_LIMITS.videoBytesMax + 1, { code: 'file_too_large' }],
      ['ok.mp4', 'video/mp4', STUDIO_LIMITS.videoBytesMax, { mime: 'video/mp4' }],
      ['big.wav', 'audio/wav', STUDIO_LIMITS.audioBytesMax + 1, { code: 'file_too_large' }],
      ['ok.mp3', 'audio/mpeg', STUDIO_LIMITS.audioBytesMax, { mime: 'audio/mpeg' }],
      ['big.webp', 'image/webp', STUDIO_LIMITS.imageBytesMax + 1, { code: 'file_too_large' }],
      ['clip.webm', 'video/webm', 1000, { code: 'unsupported_file' }],
      // Review 4: a file the editor takes by its extension goes up under that extension's own type (the
      // server reads the bytes and keeps what they are), so the hint and the upload agree.
      ['no-type.mov', '', 1000, { mime: 'video/quicktime' }],
      ['x-wav.wav', 'audio/x-wav', 1000, { mime: 'audio/wav' }],
      ['octet.mp4', 'application/octet-stream', 1000, { mime: 'video/mp4' }],
      ['jpg-alias.jpg', 'image/jpg', 1000, { mime: 'image/jpeg' }],
      ['big-no-type.mov', '', STUDIO_LIMITS.videoBytesMax + 1, { code: 'file_too_large' }],
      ['notes.txt', '', 1000, { code: 'unsupported_file' }],
    ];
    for (const [name, type, size, want] of cases) {
      const server = fakeServer();
      const api = createStudioApi({ organizationId: ORG, fetch: server.fetch });
      const result = await uploadDeviceFile(api, ORG, file(name, type, size), {});
      if ('code' in want) {
        expect(result, name).toEqual({ ok: false, code: want.code });
        expect(server.calls, name).toHaveLength(0);
      } else {
        expect(result.ok, name).toBe(true);
        expect(server.calls[0]!.operation, name).toBe('asset.reserve');
        expect(server.calls[0]!.input, name).toMatchObject({ mime: want.mime, name, sizeBytes: size });
        const put = server.calls[1]!;
        expect(put.url, name).toContain(`/api/brand-studio/assets/${ASSET}`);
      }
    }
  });

  it('a refusal or a dropped connection comes back with the library’s reason and message', async () => {
    const copy = getDictionary('ko').brandStudio as StudioCopy;
    const full = fakeServer({ reserve: { ok: false, code: 'storage_quota_exceeded', reason: 'unapproved_quota' } });
    const refused = await uploadDeviceFile(createStudioApi({ organizationId: ORG, fetch: full.fetch }), ORG, file('a.mp4', 'video/mp4', 1000), {});
    expect(refused).toEqual({ ok: false, code: 'storage_quota_exceeded', reason: 'unapproved_quota' });
    expect(full.calls.map((c) => c.operation)).toEqual(['asset.reserve']);
    expect(studioUploadErrorLine(copy, 'storage_quota_exceeded', 'unapproved_quota')).toBe(copy.unapprovedUpload.quotaExceeded);

    const offline = fakeServer({ throwOn: 'put' });
    const dropped = await uploadDeviceFile(createStudioApi({ organizationId: ORG, fetch: offline.fetch }), ORG, file('a.mp4', 'video/mp4', 1000), {});
    expect(dropped).toEqual({ ok: false, code: 'failed' });
    expect(offline.calls.some((c) => c.operation === 'asset.complete')).toBe(false);
  });

  it('one upload per picked file: asking again for the same file starts nothing new', async () => {
    const run = vi.fn(async () => ({ ok: true as const, asset: assetView(ASSET), adoption }));
    const runs = deviceUploadRuns(run);
    const f = file('my clip.mp4', 'video/mp4', 1000);
    const first = runs.start(BLOB, f, measured);
    const again = runs.start(BLOB, f, measured);
    expect(again).toBe(first);
    await first;
    expect(runs.start(BLOB, f, measured)).toBe(first);
    expect(run).toHaveBeenCalledTimes(1);
    void runs.start(MUSIC_BLOB, file('theme.mp3', 'audio/mpeg', 1000), {});
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('a finished upload switches the cut in place', () => {
  it('every cut that plays the file becomes the asset, with the same id, trim, place, sound and speed', () => {
    const before = filmWithDeviceFile();
    const after = adoptDeviceUpload(before, BLOB, adoption);
    expect(after.clips.map((c) => c.id)).toEqual(before.clips.map((c) => c.id));
    after.clips.forEach((clip, i) => {
      const was = before.clips[i]!;
      if (was.srcUrl !== BLOB) {
        expect(clip).toBe(was); // the library cut is untouched
        return;
      }
      expect(clip).toEqual({ ...was, sourceKind: 'asset', assetId: ASSET, srcUrl: adoption.srcUrl, thumbUrl: null });
    });
    expect(after.clips.filter((c) => c.assetId === ASSET)).toHaveLength(2);
    // The music was another file: not touched by this upload.
    expect(after.bgm).toBe(before.bgm);
    // Nothing plays the file: the same film, not a copy.
    expect(adoptDeviceUpload(after, BLOB, adoption)).toBe(after);
  });

  it('survives save and load; before the upload lands the save leaves the cut out, as it always did', () => {
    const before = filmWithDeviceFile();
    const savedEarly = parseStoredProject(serializeProjectForStorage(before))!;
    expect(savedEarly.clips.map((c) => c.id)).toEqual(['lib']);
    expect(savedEarly.bgm).toBeNull();

    const musicAdoption: DeviceUploadAdoption = { assetId: LIBRARY_ASSET, srcUrl: composeSourceUrl(ORG, 'asset', LIBRARY_ASSET), thumbUrl: null };
    const adopted = adoptDeviceUploads(before, new Map([[BLOB, adoption], [MUSIC_BLOB, musicAdoption]]));
    const text = serializeProjectForStorage(adopted);
    expect(text).not.toContain('blob:');
    expect(text).not.toContain('"local"');
    const loaded = parseStoredProject(text)!;
    expect(loaded.clips.map((c) => c.id)).toEqual(adopted.clips.map((c) => c.id));
    loaded.clips.forEach((clip, i) => {
      const was = adopted.clips[i]!;
      expect([clip.trimStartSec, clip.trimEndSec, clip.volume, clip.muted, clip.playbackRate]).toEqual([
        was.trimStartSec,
        was.trimEndSec,
        was.volume,
        was.muted,
        was.playbackRate,
      ]);
      expect(clip.srcUrl).toBe(was.srcUrl);
    });
    expect(loaded.bgm).toEqual({ label: 'theme', sourceKind: 'asset', assetId: LIBRARY_ASSET, srcUrl: musicAdoption.srcUrl, durationSec: 30, trimStartSec: 2, volume: 0.4 });
  });

  it('the new editor reads a switched cut exactly like a library cut', () => {
    const adopted = adoptDeviceUpload(filmWithDeviceFile(), BLOB, adoption);
    const stored = parseStoredProject(serializeProjectForStorage(adopted))!;
    const switched = stored.clips.find((c) => c.assetId === ASSET)!;
    const library = stored.clips.find((c) => c.id === 'lib')!;
    const pick = (c: typeof switched) => ({ sourceKind: c.sourceKind, hasAsset: typeof c.assetId === 'string', outputId: c.outputId, url: new URL(c.srcUrl, 'https://x.invalid').pathname });
    expect(pick(switched)).toEqual(pick(library));
    const film = fromStored(stored);
    expect(film.sequence.clips.map((c) => c.id)).toEqual(stored.clips.map((c) => c.id));
    expect(film.sequence.clips.find((c) => c.id === switched.id)!.srcUrl).toBe(adoption.srcUrl);
  });

  it('undo and redo never bring the device address back once the file is up', () => {
    const start = filmWithDeviceFile();
    let history = initHistory(start);
    history = commitHistory(history, applyTimelinePatches(start, [{ op: 'remove_clip', clipIndex: 2 }]).project);
    const switched = mapHistory(history, (p) => adoptDeviceUpload(p, BLOB, adoption));
    expect(switched.present.clips.some((c) => c.srcUrl === BLOB)).toBe(false);
    const undone = undoHistory(switched);
    expect(undone.present.clips.some((c) => c.srcUrl === BLOB)).toBe(false);
    expect(undone.present.clips.filter((c) => c.assetId === ASSET)).toHaveLength(2);
    // No step is added: one undo still goes back exactly one edit.
    expect(switched.past).toHaveLength(history.past.length);
    expect(undoHistory(undone)).toBe(undone);
    // Redo returns the edit, switched too.
    const redone = redoHistory(undone);
    expect(redone.present).toBe(switched.present);
    expect(redone.present.clips.some((c) => c.srcUrl === BLOB)).toBe(false);
    expect(redone.present.clips.filter((c) => c.assetId === ASSET)).toHaveLength(1);
    expect(redoHistory(redone)).toBe(redone);
    // The file lands while the edit waits on the redo stack: redo brings it back switched as well.
    const undoneFirst = undoHistory(history);
    expect(undoneFirst.future).toHaveLength(1);
    const landed = mapHistory(undoneFirst, (p) => adoptDeviceUpload(p, BLOB, adoption));
    const redoneAfter = redoHistory(landed);
    expect(redoneAfter.present.clips.some((c) => c.srcUrl === BLOB)).toBe(false);
    expect(redoneAfter.present.clips.map((c) => c.id)).toEqual(history.present.clips.map((c) => c.id));
    // Nothing to switch: the same history.
    expect(mapHistory(switched, (p) => adoptDeviceUpload(p, BLOB, adoption))).toBe(switched);
  });
});
