/**
 * Client-safe upload limit constants & helpers (no server/env/db imports).
 *
 * Pre-approval limits are defined as named constants so the founder may adjust them at any time
 * without a DB migration. Existing format attachment limits remain in `lib/brands/workspace/schemas.ts`.
 */

/**
 * Organizations created BEFORE this cutoff (KST launch gate) are never subject to the pre-approval
 * upload gate — only brand-new workspaces created at or after this timestamp are evaluated.
 */
export const UPLOAD_GATE_APPLIES_FROM = '2026-11-24T00:00:00+09:00';

/** Pre-approval workspace total upload cap (bytes). Founder may adjust this constant. */
export const UNAPPROVED_UPLOAD_QUOTA_BYTES = 500 * 1024 * 1024;
/** Pre-approval workspace maximum uploaded file count. Founder may adjust this constant. */
export const UNAPPROVED_UPLOAD_MAX_FILES = 50;

/** Client-safe mirror of `BRAND_ATTACHMENT_LIMITS` (tested equal in `upload-error-numbers.test.ts`; server schemas remain source of truth). */
export const BRAND_ATTACHMENT_DISPLAY_LIMITS = {
  'image/jpeg': 15 * 1024 * 1024,
  'image/png': 15 * 1024 * 1024,
  'image/webp': 15 * 1024 * 1024,
  'video/mp4': 50_000_000,
  'video/webm': 50_000_000,
  'application/pdf': 20 * 1024 * 1024,
} as const;

export type UploadLimitReason = 'unapproved_quota' | 'unapproved_file_limit';

export function isUnapprovedUploadReason(value: unknown): value is UploadLimitReason {
  return value === 'unapproved_quota' || value === 'unapproved_file_limit';
}

/**
 * Formats an existing byte cap as an exact whole-number megabyte figure without changing constants
 * (`15 * 1024 * 1024` -> 15, `15_000_000` -> 15, `500 * 1024 * 1024` -> 500).
 */
export function formatLimitMb(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  if (bytes % (1024 * 1024) === 0) return bytes / (1024 * 1024);
  if (bytes % 1_000_000 === 0) return bytes / 1_000_000;
  return Math.max(1, Math.round(bytes / (1024 * 1024)));
}
