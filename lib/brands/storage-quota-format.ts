/**
 * Client-safe constants, types, and formatters for per-organization storage quotas
 * (docs/BRAND-STORAGE-QUOTAS-F.md). Zero server/env/db imports so client components can import directly.
 */

export const BYTES_PER_KB = 1024;
export const BYTES_PER_MB = 1024 * 1024;
export const BYTES_PER_GB = 1024 * 1024 * 1024;

/** 80%: show a calm heads-up banner while keeping uploads and studio work open. */
export const STORAGE_WARN_RATIO = 0.8;
/** 100%: block new file uploads only; viewing, downloading, reviewing, and deleting stay open. */
export const STORAGE_BLOCK_RATIO = 1.0;

export const STORAGE_QUOTA_TIERS = ['b2b_39', 'b2b_69', 'b2b_99', 'project_only', 'unassigned'] as const;
export type StorageQuotaTier = (typeof STORAGE_QUOTA_TIERS)[number];

export type StorageQuotaState = 'ok' | 'near_limit' | 'exceeded';

/**
 * Proposed plan storage defaults (docs/BRAND-STORAGE-QUOTAS-F.md §3.2 — founder confirmation Q5 pending).
 * Monthly R2 cost is based on Cloudflare R2 Standard $0.015 / GB-month (~21 KRW / GB-month at 1,400 KRW/USD,
 * $0 egress) so 100% utilization stays <= 1.06% of monthly plan revenue.
 */
export const PROPOSED_PLAN_STORAGE_QUOTAS: Readonly<
  Record<
    StorageQuotaTier,
    {
      defaultQuotaBytes: number;
      defaultQuotaGb: number;
      defaultRetentionDays: number | null;
      estimatedFullR2MonthlyKrw: number;
    }
  >
> = {
  b2b_39: {
    defaultQuotaBytes: 50 * BYTES_PER_GB,
    defaultQuotaGb: 50,
    defaultRetentionDays: null,
    estimatedFullR2MonthlyKrw: 1_050,
  },
  b2b_69: {
    defaultQuotaBytes: 200 * BYTES_PER_GB,
    defaultQuotaGb: 200,
    defaultRetentionDays: null,
    estimatedFullR2MonthlyKrw: 4_200,
  },
  b2b_99: {
    defaultQuotaBytes: 500 * BYTES_PER_GB,
    defaultQuotaGb: 500,
    defaultRetentionDays: null,
    estimatedFullR2MonthlyKrw: 10_500,
  },
  project_only: {
    defaultQuotaBytes: 30 * BYTES_PER_GB,
    defaultQuotaGb: 30,
    defaultRetentionDays: 90,
    estimatedFullR2MonthlyKrw: 630,
  },
  unassigned: {
    defaultQuotaBytes: 10 * BYTES_PER_GB,
    defaultQuotaGb: 10,
    defaultRetentionDays: null,
    estimatedFullR2MonthlyKrw: 210,
  },
};

export interface StorageBreakdown {
  studioUploadsBytes: number;
  studioSavedBytes: number;
  studioUnsavedOutputsBytes: number;
  roomDeliveriesBytes: number;
  storyboardBytes: number;
  roomMessageAttachmentsBytes: number;
  projectAttachmentsBytes: number;
}

export const EMPTY_STORAGE_BREAKDOWN: Readonly<StorageBreakdown> = {
  studioUploadsBytes: 0,
  studioSavedBytes: 0,
  studioUnsavedOutputsBytes: 0,
  roomDeliveriesBytes: 0,
  storyboardBytes: 0,
  roomMessageAttachmentsBytes: 0,
  projectAttachmentsBytes: 0,
};

/** Customer-facing storage summary (no internal cloud/bucket names or cost figures). */
export interface StudioStorageQuotaView {
  usedBytes: number;
  effectiveQuotaBytes: number;
  /** 0..1+ ratio (`usedBytes / effectiveQuotaBytes`). */
  usageRatio: number;
  /** Whole-number percentage (`0..100+`). */
  usagePercent: number;
  state: StorageQuotaState;
  /** True when `state === 'exceeded'` (new uploads are refused; reads, downloads, decisions, and deletes remain open). */
  uploadBlocked: boolean;
  retentionDays: number | null;
}

export function storageQuotaStateOf(usedBytes: number, effectiveQuotaBytes: number): StorageQuotaState {
  const safeUsed = Math.max(0, usedBytes);
  if (effectiveQuotaBytes <= 0 || safeUsed >= effectiveQuotaBytes) return 'exceeded';
  if (safeUsed / effectiveQuotaBytes >= STORAGE_WARN_RATIO) return 'near_limit';
  return 'ok';
}

export function toStudioStorageQuotaView(input: {
  usedBytes: number;
  effectiveQuotaBytes: number;
  retentionDays: number | null;
}): StudioStorageQuotaView {
  const usedBytes = Math.max(0, Math.round(input.usedBytes));
  const effectiveQuotaBytes = Math.max(0, Math.round(input.effectiveQuotaBytes));
  const usageRatio = effectiveQuotaBytes > 0 ? usedBytes / effectiveQuotaBytes : usedBytes > 0 ? 1 : 1;
  const state = storageQuotaStateOf(usedBytes, effectiveQuotaBytes);
  const rawPercent = effectiveQuotaBytes > 0 ? Math.round((usedBytes / effectiveQuotaBytes) * 100) : 100;
  const usagePercent =
    state === 'exceeded' ? Math.max(100, rawPercent) : state === 'near_limit' ? Math.min(99, Math.max(80, rawPercent)) : Math.min(79, Math.max(0, rawPercent));
  return {
    usedBytes,
    effectiveQuotaBytes,
    usageRatio,
    usagePercent,
    state,
    uploadBlocked: state === 'exceeded',
    retentionDays: input.retentionDays,
  };
}

/** Human-readable byte formatter (`"18.2 MB"`, `"42.5 GB"`, `"50 GB"`). */
export function formatStorageBytes(bytes: number, locale: 'ko' | 'en' = 'ko'): string {
  const safe = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  const tag = locale === 'en' ? 'en-US' : 'ko-KR';
  if (safe < BYTES_PER_KB) return `${Math.round(safe)} B`;
  if (safe < BYTES_PER_MB) {
    return `${new Intl.NumberFormat(tag, { maximumFractionDigits: 0 }).format(safe / BYTES_PER_KB)} KB`;
  }
  if (safe < BYTES_PER_GB) {
    return `${new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }).format(safe / BYTES_PER_MB)} MB`;
  }
  return `${new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }).format(safe / BYTES_PER_GB)} GB`;
}
