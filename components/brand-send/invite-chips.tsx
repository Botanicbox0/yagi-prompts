'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SendInviteChip } from '@/lib/brand-rooms/send-contracts';
import { INVITE_COPIED_FEEDBACK_MS, buildInviteLinkUrl, inviteChipDisplayList } from './invite-model';
import type { SendCopy } from './model';
import styles from './invite-chips.module.css';

export interface SendInviteChipsProps {
  invites?: readonly SendInviteChip[];
  copy: Pick<
    SendCopy,
    'chipPending' | 'chipExpired' | 'chipAccepted' | 'chipCount' | 'inviteLinkCopy' | 'inviteLinkCopied'
  >;
  tokensByEmail?: Readonly<Record<string, string>>;
  compact?: boolean;
}

export function SendInviteChips({
  invites,
  copy,
  tokensByEmail,
  compact = false,
}: SendInviteChipsProps) {
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const copyableEmails = useMemo(() => {
    const set = new Set<string>();
    if (tokensByEmail) {
      for (const [email, token] of Object.entries(tokensByEmail)) {
        if (token) set.add(email.toLowerCase());
      }
    }
    return set;
  }, [tokensByEmail]);

  const items = useMemo(
    () => inviteChipDisplayList(invites, copy, copyableEmails),
    [copy, copyableEmails, invites],
  );

  const handleCopy = useCallback(
    async (email: string) => {
      const lower = email.toLowerCase();
      const token = tokensByEmail?.[lower];
      if (!token) return;
      const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
      const url = buildInviteLinkUrl(origin, token);
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
          if (!mountedRef.current) return;
          setCopiedEmail(lower);
          if (timerRef.current !== null) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            if (mountedRef.current) setCopiedEmail(null);
          }, INVITE_COPIED_FEEDBACK_MS);
        }
      } catch {
        // Clipboard permission denied: leave state unchanged without throwing.
      }
    },
    [tokensByEmail],
  );

  if (items.length === 0) return null;

  return (
    <div className={styles.list} data-compact={compact ? 'true' : undefined} data-send-invite-chips>
      {items.map((item) => {
        if (item.kind === 'count') {
          return (
            <span key={item.key} className={styles.chip} data-send-invite-count={item.count}>
              <span>{item.label}</span>
            </span>
          );
        }
        const lower = item.email.toLowerCase();
        const isCopied = copiedEmail === lower;
        return (
          <span key={item.key} className={styles.chip} data-send-invite-chip={lower} data-state={item.state}>
            <span className={styles.email}>{item.email}</span>
            <span className={styles.sep} aria-hidden="true">
              ·
            </span>
            <span className={styles.state}>{item.stateLabel}</span>
            {item.hasCopyLink ? (
              <button
                type="button"
                className={styles.copyBtn}
                data-send-invite-copy={lower}
                onClick={() => void handleCopy(item.email)}
              >
                {isCopied ? copy.inviteLinkCopied : copy.inviteLinkCopy}
              </button>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
