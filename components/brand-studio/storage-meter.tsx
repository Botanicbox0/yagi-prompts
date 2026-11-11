import type { Dictionary } from '@/lib/i18n/dictionaries';
import { formatStorageBytes, type StudioStorageQuotaView } from '@/lib/brands/storage-quota-format';
import { fill } from './copy';
import s from './storage-meter.module.css';

export interface StorageMeterCardProps {
  storage: StudioStorageQuotaView;
  copy: Dictionary['studioLibrary']['storage'];
  locale: 'ko' | 'en';
  /** Optional link back to `/brand/library` when rendered on `/brand/settings`. */
  assetsHref?: string | null;
}

export function StorageMeterCard({ storage, copy, locale, assetsHref = null }: StorageMeterCardProps) {
  const used = formatStorageBytes(storage.usedBytes, locale);
  const quota = formatStorageBytes(storage.effectiveQuotaBytes, locale);
  const barWidth = `${Math.max(storage.usedBytes > 0 ? 2 : 0, Math.min(100, Math.round(storage.usageRatio * 100)))}%`;

  const statusNotice =
    storage.state === 'exceeded'
      ? fill(copy.exceededNotice, { used, quota, percent: storage.usagePercent })
      : storage.state === 'near_limit'
        ? fill(copy.nearLimitNotice, { used, quota, percent: storage.usagePercent })
        : null;

  return (
    <section
      className={s.card}
      data-brand-storage-meter
      data-storage-state={storage.state}
      data-storage-upload-blocked={storage.uploadBlocked ? 'true' : 'false'}
      aria-label={copy.title}
    >
      <div className={s.topRow}>
        <div className={s.titleGroup}>
          <h2 className={s.title}>{copy.title}</h2>
          {storage.state === 'near_limit' && (
            <span className={s.badge} data-storage-badge="near_limit">
              {copy.nearLimitBadge}
            </span>
          )}
          {storage.state === 'exceeded' && (
            <span className={`${s.badge} ${s.badgeExceeded}`} data-storage-badge="exceeded">
              {copy.exceededBadge}
            </span>
          )}
        </div>
        <span className={s.numbers} data-storage-numbers>
          {fill(copy.usedOf, { used, quota, percent: storage.usagePercent })}
        </span>
      </div>

      <div
        className={s.track}
        role="progressbar"
        aria-label={copy.title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, storage.usagePercent)}
      >
        <div className={s.fill} style={{ width: barWidth }} />
      </div>

      {statusNotice && (
        <div className={s.noticeRow} role={storage.state === 'exceeded' ? 'alert' : 'status'}>
          <p className={s.notice} data-storage-notice>
            {statusNotice}
          </p>
          {assetsHref && storage.state !== 'ok' && (
            <a href={assetsHref} className={s.actionLink} data-storage-manage-link>
              {copy.manageAssets}
            </a>
          )}
        </div>
      )}

      {storage.retentionDays !== null && (
        <p className={s.retention} data-storage-retention>
          {fill(copy.retentionNote, { days: storage.retentionDays })}
        </p>
      )}
    </section>
  );
}
