'use client';

import { useId, useRef } from 'react';
import type { SendCopy } from './model';
import styles from './invite-row.module.css';

export interface SendInviteRowProps {
  mode: 'invitable' | 'not_allowed' | 'self' | 'rate_limited';
  email: string;
  optionId?: string;
  selected?: boolean;
  copy: Pick<
    SendCopy,
    'inviteHeading' | 'inviteDesc' | 'inviteAction' | 'inviteNotAllowed' | 'inviteSelf' | 'sendRate'
  >;
  onHover?: () => void;
  onPick?: (email: string) => void;
}

export function SendInviteRow({
  mode,
  email,
  optionId,
  selected = false,
  copy,
  onHover,
  onPick,
}: SendInviteRowProps) {
  const headingId = useId();
  const pickedOnDownRef = useRef(false);

  if (mode === 'not_allowed') {
    return (
      <div className={styles.notice} role="status" data-send-invite-not-allowed>
        {copy.inviteNotAllowed}
      </div>
    );
  }
  if (mode === 'self') {
    return (
      <div className={styles.notice} role="status" data-send-invite-self>
        {copy.inviteSelf}
      </div>
    );
  }
  if (mode === 'rate_limited') {
    return (
      <div className={styles.notice} role="status" data-send-invite-rate>
        {copy.sendRate}
      </div>
    );
  }

  const resetPointerPick = () => {
    pickedOnDownRef.current = false;
  };

  return (
    <div data-send-invite-group role="group" aria-labelledby={headingId}>
      <div id={headingId} className={styles.heading}>
        {copy.inviteHeading}
      </div>
      <div
        id={optionId}
        role="option"
        aria-selected={selected}
        className={styles.row}
        data-send-invite-option="true"
        onMouseEnter={onHover}
        onMouseDown={(event) => {
          if (typeof event.button === 'number' && event.button !== 0) return;
          event.preventDefault();
          pickedOnDownRef.current = true;
          onPick?.(email);
        }}
        onPointerUp={resetPointerPick}
        onPointerLeave={resetPointerPick}
        onPointerCancel={resetPointerPick}
        onClick={() => {
          if (pickedOnDownRef.current) {
            pickedOnDownRef.current = false;
            return;
          }
          onPick?.(email);
        }}
      >
        <span className={styles.icon} aria-hidden="true">
          <svg viewBox="0 0 16 16" className={styles.iconSvg}>
            <path d="M8 3.5v9M3.5 8h9" />
          </svg>
        </span>
        <div className={styles.copy}>
          <strong className={styles.address}>{email}</strong>
          <span className={styles.desc}>{copy.inviteDesc}</span>
        </div>
        <span className={styles.actionBtn} data-send-invite-action>
          {copy.inviteAction}
        </span>
      </div>
    </div>
  );
}
