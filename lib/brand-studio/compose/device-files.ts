/**
 * Files picked from the device in the editing studio (`/brand/studio/compose`, "+ 내 파일 올리기" and
 * "+ 내 음원 올리기"): which types it takes. The list is the library's (`STUDIO_UPLOAD_MIMES`), so a file the
 * editor takes is a file the library can upload; `label` is the name the hint and the "unsupported file" line
 * use (tests/brand-studio/compose/device-files.test.ts pins both lines to this list).
 *
 * Client-safe: constants and pure functions only.
 */
import type { StudioAssetKind } from '@/lib/brand-studio/contracts';

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
