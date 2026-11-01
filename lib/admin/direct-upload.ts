/**
 * The browser half of the admin direct upload (components/admin/media-drop.tsx), kept free of Node
 * and React so it can be tested and shipped to the client as is.
 *
 * Audit 2026-09-25: a reported registration problem prompted an upload-path review. The reported
 * user's exact failure was not reproduced, but deterministic file refusals lost their reason: the
 * signing route answers `400 {error:'too_large'|'bad_type'}`, the client dropped that body and showed
 * "retry in a moment" for a refusal no retry can fix. These helpers carry the reason to the screen.
 */

export type UploadFailure = 'too_large' | 'bad_type' | 'session' | 'failed';

/** What the signing route's answer means for the person holding the file. */
export function directUploadFailure(status: number, body: unknown): UploadFailure {
  // The route answers every guard failure with a bare 404 (§3.7); from an admin page that only happens
  // when the session expired or the admin right is gone. A reload or a new sign-in is the fix.
  if (status === 401 || status === 403 || status === 404) return 'session';
  const code = body !== null && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
  return code === 'too_large' || code === 'bad_type' ? code : 'failed';
}

export interface UploadFailureLabels {
  uploadFailed: string;
  uploadTooLarge: string;
  uploadBadType: string;
  uploadSession: string;
}

export function uploadFailureText(reason: UploadFailure, labels: UploadFailureLabels): string {
  switch (reason) {
    case 'too_large':
      return labels.uploadTooLarge;
    case 'bad_type':
      return labels.uploadBadType;
    case 'session':
      return labels.uploadSession;
    default:
      return labels.uploadFailed;
  }
}

/**
 * Only types the server allowlist accepts (lib/prompts/media.ts). A browser that reports no type for a
 * file (some Windows setups do for .mov) would otherwise send `application/octet-stream` and be
 * refused as `bad_type` for a perfectly good clip. A type the browser DID report is only ever replaced by its canonical name.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
};

/**
 * Names browsers report for formats the allowlist already takes (staff report, 2026-11-01: audio
 * would not attach). Chrome on Windows calls an .m4a `audio/x-m4a`, and the type comes from the
 * machine's registry, so the same file can arrive under any of these.
 */
const AUDIO_MIME_ALIASES: Record<string, string> = {
  'audio/mp3': 'audio/mpeg',
  'audio/mpeg3': 'audio/mpeg',
  'audio/x-mp3': 'audio/mpeg',
  'audio/x-mpeg': 'audio/mpeg',
  'audio/x-mpeg-3': 'audio/mpeg',
  'audio/m4a': 'audio/mp4',
  'audio/x-m4a': 'audio/mp4',
  'audio/x-aac': 'audio/aac',
  'audio/vnd.dlna.adts': 'audio/aac',
  'audio/x-flac': 'audio/flac',
  'audio/wave': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',
};

export function canonicalMime(mime: string): string {
  const type = mime.split(';')[0]!.trim().toLowerCase();
  return AUDIO_MIME_ALIASES[type] ?? mime;
}

export function uploadMime(filename: string, browserType: string): string {
  if (browserType) return canonicalMime(browserType);
  const extension = /\.([A-Za-z0-9]{1,8})$/.exec(filename.trim())?.[1]?.toLowerCase();
  return (extension && MIME_BY_EXTENSION[extension]) || 'application/octet-stream';
}
