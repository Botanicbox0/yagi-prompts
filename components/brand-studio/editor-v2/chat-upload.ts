'use client';

/**
 * Editing studio v2 — chat attachment upload helper (slice E-C, Batch 3).
 *
 * Reuses the studio's existing library upload client (`createStudioApi.upload` — `asset.reserve` →
 * direct PUT or studio asset endpoint → `asset.complete`, with optional `brandProjectId`
 * filing) and the library's own upload refusal sentences (`studioUploadErrorLine`).
 * Registered in `NETWORK_FILES` in `tests/brand-studio/editor-v2/flag-gate.test.ts` (1-client cap).
 */
import { createStudioApi, isFailure, uploadKind, uploadProblem, type MeasuredMedia, type UploadFile } from '@/components/brand-studio/api';
import { fill, studioUploadErrorLine, type StudioCopy } from '@/components/brand-studio/copy';
import {
  STUDIO_LIMITS,
  STUDIO_UPLOAD_MIMES,
  type StudioAssetKind,
  type StudioAssetView,
  type StudioErrorCode,
} from '@/lib/brand-studio/contracts';
import type { UploadLimitReason } from '@/lib/brands/upload-limits-format';
import type { StudioEditorChatCopy } from '@/messages/studio-editor-chat';

export const CHAT_UPLOAD_ACCEPT = Object.values(STUDIO_UPLOAD_MIMES).flat().join(',');

export type ChatUploadErrorCopy = Pick<StudioCopy, 'errors' | 'unapprovedUpload' | 'uploadFailed'>;

export interface ChatUploadClient {
  upload: ReturnType<typeof createStudioApi>['upload'];
}

export type ChatPrecheckFailure = { ok: false; code: 'unsupported_file' | 'file_too_large' | 'too_long' };

export type ChatUploadResult =
  | { ok: true; asset: StudioAssetView; kind: StudioAssetKind }
  | { ok: false; code: StudioErrorCode | 'too_long'; reason?: UploadLimitReason; precheck?: boolean };

/** Best-effort browser media duration/dimensions reader (degrades to `{}` in headless/DOM tests). */
export async function measureChatUploadFile(file: Blob, kind: StudioAssetKind): Promise<MeasuredMedia> {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return {};
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    if (kind === 'image') {
      return await new Promise<MeasuredMedia>((resolve) => {
        const img = new Image();
        const done = (value: MeasuredMedia) => {
          img.onload = null;
          img.onerror = null;
          resolve(value);
        };
        img.onload = () => done({ width: img.naturalWidth || undefined, height: img.naturalHeight || undefined });
        img.onerror = () => done({});
        img.src = objectUrl;
      });
    }
    return await new Promise<MeasuredMedia>((resolve) => {
      const el = document.createElement(kind === 'video' ? 'video' : 'audio');
      el.preload = 'metadata';
      const done = (value: MeasuredMedia) => {
        el.onloadedmetadata = null;
        el.onerror = null;
        resolve(value);
      };
      el.onloadedmetadata = () => {
        const seconds = Number.isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration * 10) / 10 : undefined;
        if (kind === 'video') {
          const v = el as HTMLVideoElement;
          done({ width: v.videoWidth || undefined, height: v.videoHeight || undefined, seconds });
        } else {
          done({ seconds });
        }
      };
      el.onerror = () => done({});
      el.src = objectUrl;
    });
  } catch {
    return {};
  } finally {
    try {
      URL.revokeObjectURL?.(objectUrl);
    } catch {
      // ignore revoke errors in synthetic DOMs
    }
  }
}

/** Validates kind & size before any upload starts. */
export function precheckChatUploadFile(file: UploadFile): { ok: true; kind: StudioAssetKind } | ChatPrecheckFailure {
  const problem = uploadProblem(file);
  const kind = uploadKind(file.type);
  if (problem || !kind) {
    return { ok: false, code: problem === 'file_too_large' ? 'file_too_large' : 'unsupported_file' };
  }
  return { ok: true, kind };
}

/**
 * Uploads a dropped or picked file through the studio library (`asset.reserve` → PUT/POST → `asset.complete`),
 * enforcing kind, size, and `STUDIO_LIMITS.mediaSecondsMax` (600 s) limits.
 */
export async function uploadChatAttachmentFile(params: {
  organizationId: string;
  file: UploadFile & Blob;
  brandProjectId?: string | null;
  client?: ChatUploadClient;
  measure?: (file: Blob, kind: StudioAssetKind) => Promise<MeasuredMedia>;
}): Promise<ChatUploadResult> {
  const check = precheckChatUploadFile(params.file);
  if (!check.ok) return { ...check, precheck: true };

  const measureFn = params.measure ?? measureChatUploadFile;
  const measured = await measureFn(params.file, check.kind).catch((): MeasuredMedia => ({}));
  if (
    (check.kind === 'video' || check.kind === 'audio') &&
    measured.seconds !== undefined &&
    measured.seconds > STUDIO_LIMITS.mediaSecondsMax
  ) {
    return { ok: false, code: 'too_long', precheck: true };
  }

  const uploader = params.client ?? createStudioApi({ organizationId: params.organizationId });
  const saved = await uploader.upload(params.file, {
    ...(params.brandProjectId ? { brandProjectId: params.brandProjectId } : {}),
    measure: async () => measured,
  });
  if (isFailure(saved)) {
    return { ok: false, code: saved.code, ...(saved.reason ? { reason: saved.reason } : {}) };
  }
  return { ok: true, asset: saved.asset, kind: check.kind };
}

/** Formats an upload refusal/failure using the studio library's own `studioUploadErrorLine`. */
export function formatChatUploadFailure(
  uploadCopy: ChatUploadErrorCopy | null | undefined,
  chatCopy: StudioEditorChatCopy,
  failure: { code: StudioErrorCode | 'too_long'; reason?: UploadLimitReason },
  maxMediaSeconds: number = STUDIO_LIMITS.mediaSecondsMax,
): string {
  if (failure.code === 'too_long') return fill(chatCopy.attachTooLong, { minutes: Math.round(maxMediaSeconds / 60) });
  if (uploadCopy) return studioUploadErrorLine(uploadCopy, failure.code, failure.reason);
  return chatCopy.noteUnavailable;
}
