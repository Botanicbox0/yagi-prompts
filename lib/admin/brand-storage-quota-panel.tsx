import { ManagedForm } from '@/components/brand-workspace/managed-form';
import type { BrandCopy } from '@/components/brand-workspace/action-form';
import type { SqlRunner } from '@/lib/db/sql-runner';
import {
  BYTES_PER_GB,
  formatStorageBytes,
  inspectProjectOnlyRetention,
  loadOrganizationStorageSummary,
  PROPOSED_PLAN_STORAGE_QUOTAS,
  type StorageQuotaTier,
} from '@/lib/brands/storage-quota';

/**
 * Admin organization page panel: per-organization storage quota override, category breakdown,
 * retention dry-run status, and 1-click reconciliation (docs/BRAND-STORAGE-QUOTAS-F.md).
 * Studio-internal console text only (never shown to a customer).
 */
const COPY = {
  ko: {
    title: '저장 공간 한도',
    hint: '배정 플랜 기본값을 따르며 조직별 GB·보관 일수를 덮어쓸 수 있습니다. 80% 이상은 안내만 띄우고, 100% 이상에서는 새 파일 업로드만 막습니다(열람·내려받기·삭제는 유지).',
    tiers: {
      b2b_39: 'Starter (기본 50 GB)',
      b2b_69: 'Growth (기본 200 GB)',
      b2b_99: 'Scale (기본 500 GB)',
      project_only: '프로젝트 전용 (기본 30 GB · 90일 보관)',
      unassigned: '플랜 미배정 (기본 10 GB)',
    } satisfies Record<StorageQuotaTier, string>,
    states: {
      ok: '정상',
      near_limit: '80% 이상 경고',
      exceeded: '100% 초과 (새 업로드 차단)',
    },
    overrideActive: (gb: string) => `조직별 덮어쓰기 적용 중 (${gb} GB)`,
    usingPlanDefault: '플랜 기본 한도 사용 중',
    breakdownLabel: '항목별 중복 제거 사용량',
    categories: {
      uploads: '스튜디오 업로드',
      saved: '저장된 생성물',
      unsaved: '미저장 생성 결과',
      deliveries: '야기 팀 시안·납품',
      storyboards: '스토리보드 컷',
      messages: '룸 대화 첨부',
      legacy: '캠페인·프로젝트 첨부',
    },
    retentionNone: '상시 보관 (구독 유지 기준)',
    retentionActive: (days: number, elapsed: number | null, expired: boolean) =>
      elapsed === null
        ? `납품 후 ${days}일 보관 정책 (완료된 납품 이력 없음)`
        : expired
          ? `납품 후 ${days}일 보관 정책 · 마지막 납품 후 ${elapsed}일 경과 (만료 점검 대상 · 자동 삭제 꺼짐)`
          : `납품 후 ${days}일 보관 정책 · 마지막 납품 후 ${elapsed}일 경과`,
    quotaGbLabel: '덮어쓸 저장 한도 (GB · 비우면 플랜 기본값)',
    retentionDaysLabel: '납품 후 보관 일수 (일 · 비우면 기본값)',
    noteLabel: '메모',
    save: '저장 한도 적용',
    reconcile: '실사용량 다시 계산',
    unavailable: '저장 한도 집계를 불러오지 못했습니다.',
  },
  en: {
    title: 'Storage quota',
    hint: 'Follows the assigned plan default unless overridden per organization. 80%+ shows a calm notice; 100%+ pauses new uploads only while keeping viewing, downloads, and deletes open.',
    tiers: {
      b2b_39: 'Starter (default 50 GB)',
      b2b_69: 'Growth (default 200 GB)',
      b2b_99: 'Scale (default 500 GB)',
      project_only: 'Project-only (default 30 GB · 90d retention)',
      unassigned: 'Unassigned (default 10 GB)',
    } satisfies Record<StorageQuotaTier, string>,
    states: {
      ok: 'Healthy',
      near_limit: '80%+ warning',
      exceeded: '100%+ (new uploads paused)',
    },
    overrideActive: (gb: string) => `Custom override active (${gb} GB)`,
    usingPlanDefault: 'Using plan default quota',
    breakdownLabel: 'Deduplicated usage by category',
    categories: {
      uploads: 'Studio uploads',
      saved: 'Saved generations',
      unsaved: 'Unsaved outputs',
      deliveries: 'Team deliveries',
      storyboards: 'Storyboard cuts',
      messages: 'Room attachments',
      legacy: 'Project attachments',
    },
    retentionNone: 'Continuous retention while subscribed',
    retentionActive: (days: number, elapsed: number | null, expired: boolean) =>
      elapsed === null
        ? `${days}-day post-delivery retention (no completed delivery yet)`
        : expired
          ? `${days}-day retention · ${elapsed}d since last delivery (review candidate · auto-delete off)`
          : `${days}-day retention · ${elapsed}d since last delivery`,
    quotaGbLabel: 'Override quota (GB · blank uses plan default)',
    retentionDaysLabel: 'Post-delivery retention (days · blank uses default)',
    noteLabel: 'Note',
    save: 'Save storage quota',
    reconcile: 'Reconcile usage now',
    unavailable: 'Storage quota summary is unavailable.',
  },
} as const;

export async function BrandStorageQuotaPanel({
  sql,
  organizationId,
  b,
  locale,
}: {
  sql: SqlRunner;
  organizationId: string;
  b: BrandCopy;
  locale: string;
}) {
  const loc = locale === 'en' ? 'en' : 'ko';
  const c = COPY[loc];
  let summary: Awaited<ReturnType<typeof loadOrganizationStorageSummary>> | null = null;
  let retention: Awaited<ReturnType<typeof inspectProjectOnlyRetention>> | null = null;
  try {
    [summary, retention] = await Promise.all([
      loadOrganizationStorageSummary(sql, organizationId),
      inspectProjectOnlyRetention(sql, organizationId),
    ]);
  } catch {
    summary = null;
    retention = null;
  }

  const overrideGbDefault =
    summary?.overrideQuotaBytes == null ? '' : String(Math.round((summary.overrideQuotaBytes / BYTES_PER_GB) * 100) / 100);

  return (
    <section
      id="brand-storage-quota"
      className="bw-panel"
      data-brand-storage-quota={summary ? summary.state : 'unavailable'}
    >
      <h2>{c.title}</h2>
      <p className="bw-muted">{c.hint}</p>
      {!summary ? (
        <p>{c.unavailable}</p>
      ) : (
        <>
          <p data-brand-storage-quota-summary>
            <strong>
              {formatStorageBytes(summary.usedBytes, loc)} / {formatStorageBytes(summary.effectiveQuotaBytes, loc)} ({summary.usagePercent}%)
            </strong>
            {' · '}
            <span>{c.states[summary.state]}</span>
            {' · '}
            <span>{c.tiers[summary.tier]}</span>
          </p>
          <p className="bw-muted" style={{ marginTop: 4 }}>
            {summary.overrideQuotaBytes !== null
              ? c.overrideActive(overrideGbDefault)
              : `${c.usingPlanDefault} (${PROPOSED_PLAN_STORAGE_QUOTAS[summary.tier].defaultQuotaGb} GB)`}
            {' · '}
            {retention && retention.retentionDays !== null
              ? c.retentionActive(retention.retentionDays, retention.daysSinceLastDelivery, retention.expired)
              : c.retentionNone}
          </p>
          <details className="bw-details" style={{ marginBottom: 12 }}>
            <summary>{c.breakdownLabel}</summary>
            <ul className="bw-list" style={{ marginTop: 8 }}>
              <li className="bw-row">
                <span>{c.categories.uploads}</span>
                <strong>{formatStorageBytes(summary.breakdown.studioUploadsBytes, loc)}</strong>
              </li>
              <li className="bw-row">
                <span>{c.categories.saved}</span>
                <strong>{formatStorageBytes(summary.breakdown.studioSavedBytes, loc)}</strong>
              </li>
              <li className="bw-row">
                <span>{c.categories.unsaved}</span>
                <strong>{formatStorageBytes(summary.breakdown.studioUnsavedOutputsBytes, loc)}</strong>
              </li>
              <li className="bw-row">
                <span>{c.categories.deliveries}</span>
                <strong>{formatStorageBytes(summary.breakdown.roomDeliveriesBytes, loc)}</strong>
              </li>
              <li className="bw-row">
                <span>{c.categories.storyboards}</span>
                <strong>{formatStorageBytes(summary.breakdown.storyboardBytes, loc)}</strong>
              </li>
              <li className="bw-row">
                <span>{c.categories.messages}</span>
                <strong>{formatStorageBytes(summary.breakdown.roomMessageAttachmentsBytes, loc)}</strong>
              </li>
              <li className="bw-row">
                <span>{c.categories.legacy}</span>
                <strong>{formatStorageBytes(summary.breakdown.projectAttachmentsBytes, loc)}</strong>
              </li>
            </ul>
          </details>
          <ManagedForm op="brandEngine.storageQuota" b={b} submit={c.save}>
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="expectedRevision" value={summary.revision} />
            <label>
              {c.quotaGbLabel}
              <input name="quotaGb" type="number" min={0} max={100000} step="0.1" defaultValue={overrideGbDefault} />
            </label>
            <label>
              {c.retentionDaysLabel}
              <input name="retentionDays" type="number" min={1} max={3650} step={1} defaultValue={summary.overrideRetentionDays ?? ''} />
            </label>
            <label>
              {c.noteLabel}
              <input name="note" defaultValue={summary.note} maxLength={500} />
            </label>
          </ManagedForm>
          <div style={{ marginTop: 10 }}>
            <ManagedForm op="brandEngine.storageReconcile" b={b} submit={c.reconcile}>
              <input type="hidden" name="organizationId" value={organizationId} />
            </ManagedForm>
          </div>
        </>
      )}
    </section>
  );
}
