/**
 * "에셋에 저장" and "검수 · 공유" for an exported film, in one place. The current editor (video-composer.tsx) and the
 * editing studio v2's export sheet (components/brand-studio/editor-v2/export-keep.tsx) both save the exported file
 * through the library's own upload (`createStudioApi().upload`: the same type and size checks in the browser, and the
 * same storage, pre-approval and role checks on the server, as any upload) and open the same review share window, so
 * the two editors cannot drift apart. Moved from video-composer.tsx without changing what it does
 * (tests/brand-studio/compose/export-save-share.test.tsx pins the current editor's behaviour).
 */
import { isFailure, type StudioApi } from '@/components/brand-studio/api';
import { openShareReview } from '@/components/brand-studio/share-review-dialog';
import type { StudioAssetView, StudioErrorCode } from '@/lib/brand-studio/contracts';
import type { UploadLimitReason } from '@/lib/brands/upload-limits-format';
import type { StudioComposeCopy } from '@/messages/studio-compose';

/** A finished export, as either editor holds it. */
export interface ExportedFilm {
  blob: Blob;
  filename: string;
  width: number;
  height: number;
  durationSec: number;
}

export type ExportSaveResult =
  | { ok: true; asset: StudioAssetView }
  /** `code` is `null` when the upload threw instead of answering. */
  | { ok: false; code: StudioErrorCode | null; reason: UploadLimitReason | null };

/**
 * Uploads the exported file as one library asset, named by the export and measured by it (width, height and length
 * come from the export, not from reading the file again). One call is at most one asset; the callers keep the
 * "saved once" guard.
 */
export async function saveExportedFilm(api: Pick<StudioApi, 'upload'>, film: ExportedFilm): Promise<ExportSaveResult> {
  try {
    const file = Object.assign(film.blob, { name: film.filename });
    const res = await api.upload(file, {
      measure: async () => ({
        width: film.width,
        height: film.height,
        seconds: film.durationSec,
      }),
    });
    if (isFailure(res)) return { ok: false, code: res.code, reason: res.reason ?? null };
    return { ok: true, asset: res.asset };
  } catch {
    return { ok: false, code: null, reason: null };
  }
}

/** The current editor's line for a save that did not go through: storage full for the two limit codes, else failed. */
export function exportSaveFailureLine(status: Pick<StudioComposeCopy['status'], 'saveQuotaExceeded' | 'saveFailed'>, code: string | null): string {
  return code === 'asset_limit' || code === 'storage_quota_exceeded' ? status.saveQuotaExceeded : status.saveFailed;
}

export interface ExportReviewTarget {
  organizationId: string;
  assetId: string | null;
  outputId: string | null;
  title: string;
}

/**
 * Asks for the review share window for this piece (any mounted `ShareReviewDialog` host opens it; with neither an
 * asset nor a result nobody does) and returns the current editor's line for it.
 */
export function openExportReview(target: ExportReviewTarget, status: Pick<StudioComposeCopy['status'], 'reviewOpened' | 'reviewNeedsSave'>): string {
  openShareReview(target);
  return target.assetId || target.outputId ? status.reviewOpened : status.reviewNeedsSave;
}
