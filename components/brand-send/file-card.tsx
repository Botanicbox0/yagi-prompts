'use client';

import type { SendFileCard } from '@/lib/brand-rooms/send-contracts';
import { fileCardInfo, type SendCopy } from './model';
import styles from './file-card.module.css';

export interface SendFileCardViewProps {
  file: SendFileCard;
  organizationId: string;
  copy: SendCopy;
}

function FileGlyph({ kind, available }: { kind: SendFileCard['kind']; available: boolean }) {
  if (!available) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.thumbIcon}>
        <path d="M5 5l14 14" />
        <rect x="4" y="6" width="16" height="12" rx="2" />
      </svg>
    );
  }
  if (kind === 'video') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.thumbIcon}>
        <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
        <path d="M10 9.5l5 2.5-5 2.5z" />
      </svg>
    );
  }
  if (kind === 'audio') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.thumbIcon}>
        <path d="M9 17.5V6.5l9-2v11" />
        <circle cx="6.5" cy="17.5" r="2.5" />
        <circle cx="15.5" cy="15.5" r="2.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.thumbIcon}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M5.5 16.5l4-4 3 3 2.5-2.5 3.5 3.5" />
    </svg>
  );
}

export function SendFileCardView({ file, organizationId, copy }: SendFileCardViewProps) {
  const info = fileCardInfo(file, organizationId, copy);

  return (
    <div
      className={styles.card}
      data-send-file-card={info.available ? 'available' : 'gone'}
      data-send-file-kind={file.kind ?? 'none'}
    >
      <div className={styles.thumb}>
        {info.available && info.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={info.thumbUrl}
            alt={info.title}
            width={132}
            height={99}
            loading="lazy"
            className={styles.thumbImg}
          />
        ) : (
          <FileGlyph kind={file.kind} available={info.available} />
        )}
      </div>

      <div className={styles.meta}>
        <span className={styles.title}>{info.title}</span>
        {info.subtitle ? <span className={styles.subtitle}>{info.subtitle}</span> : null}
      </div>

      {info.openHref ? (
        <div className={styles.actions}>
          <a href={info.openHref} className={styles.openLink} data-send-file-open>
            {copy.openFile}
          </a>
        </div>
      ) : null}
    </div>
  );
}
