import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STUDIO_UPLOAD_MIMES } from '@/lib/brand-studio/contracts';
import {
  DEVICE_FILE_ACCEPT,
  DEVICE_FILE_FORMATS,
  deviceFileAccept,
  deviceFileKind,
} from '@/lib/brand-studio/compose/device-files';
import { studioComposeEn, studioComposeKo } from '@/messages/studio-compose';

/**
 * "+ 내 파일 올리기" in the old editing studio (/brand/studio/compose): the types it takes, the hint under the
 * button and the "unsupported file" line must name the same formats (A9: WEBP was taken but never named).
 */
describe('editing studio — device file formats', () => {
  const labels = DEVICE_FILE_FORMATS.map((f) => f.label);

  it('takes exactly the types the library uploads', () => {
    const ours = [...new Set(DEVICE_FILE_FORMATS.map((f) => f.mime))].sort();
    const library = Object.values(STUDIO_UPLOAD_MIMES).flat().sort();
    expect(ours).toEqual(library);
    for (const format of DEVICE_FILE_FORMATS) {
      expect((STUDIO_UPLOAD_MIMES[format.kind] as readonly string[]).includes(format.mime)).toBe(true);
    }
  });

  it('the picker accepts every format by type and by extension, and nothing else', () => {
    const accepted = DEVICE_FILE_ACCEPT.split(',');
    const expected = [
      ...DEVICE_FILE_FORMATS.map((f) => f.mime),
      ...DEVICE_FILE_FORMATS.flatMap((f) => f.exts.map((e) => `.${e}`)),
    ];
    expect(new Set(accepted)).toEqual(new Set(expected));
    expect(accepted).toHaveLength(new Set(accepted).size);
    // The screen still offers what it offered before (same order, now from one list).
    expect(DEVICE_FILE_ACCEPT).toBe(
      'video/mp4,video/quicktime,audio/mpeg,audio/wav,image/jpeg,image/png,image/webp,.mp4,.mov,.mp3,.wav,.jpg,.jpeg,.png,.webp',
    );
    expect(deviceFileAccept('audio')).toBe('audio/mpeg,audio/wav,.mp3,.wav');
  });

  it('the hint and the unsupported-file line name every format, in both languages', () => {
    for (const copy of [studioComposeKo, studioComposeEn]) {
      for (const line of [copy.sources.uploadHint, copy.status.unsupportedFile]) {
        for (const label of labels) expect(line).toContain(label);
        const named = line.match(/\b[A-Z][A-Z0-9]{2,3}\b/g) ?? [];
        expect([...new Set(named)].sort()).toEqual([...labels].sort());
      }
    }
  });

  it('the composer reads the formats from this list (no second copy of the accept string)', () => {
    const src = readFileSync(resolve(process.cwd(), 'components/brand-studio/compose/video-composer.tsx'), 'utf8');
    const inputOf = (marker: string) => {
      const at = src.indexOf(marker);
      expect(at).toBeGreaterThan(0);
      return src.slice(src.lastIndexOf('<input', at), at);
    };
    expect(inputOf('data-compose-local-input')).toContain('accept={DEVICE_FILE_ACCEPT}');
    expect(inputOf('data-compose-audio-upload-input')).toContain("accept={deviceFileAccept('audio')}");
  });

  it('reads the kind by type, else by extension (as before)', () => {
    expect(deviceFileKind({ type: 'video/mp4', name: 'a.bin' })).toBe('video');
    expect(deviceFileKind({ type: '', name: 'clip.MOV' })).toBe('video');
    expect(deviceFileKind({ type: 'audio/wav', name: 'x' })).toBe('audio');
    expect(deviceFileKind({ type: '', name: 'song.mp3' })).toBe('audio');
    expect(deviceFileKind({ type: 'image/webp', name: 'x' })).toBe('image');
    expect(deviceFileKind({ type: '', name: 'photo.JPEG' })).toBe('image');
    expect(deviceFileKind({ type: 'video/webm', name: 'clip.webm' })).toBeNull();
    expect(deviceFileKind({ type: 'text/plain', name: 'notes.txt' })).toBeNull();
  });
});
