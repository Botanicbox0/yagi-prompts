'use client';

import { useEffect, useId, useRef, type KeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { CampaignOpsCopy } from '@/messages/campaign-ops';
import { ProcessStage } from '../process-stage';
import type { ProcessStep } from '../process-stage/model';
import s from './campaign-ops.module.css';

export interface HowDialogProps {
  open: boolean;
  title: string;
  closeLabel: string;
  exampleCaption: string;
  steps: readonly ProcessStep[];
  pic: CampaignOpsCopy['pic'];
  returnFocusTo: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

function isTopMostModal(dialog: HTMLDivElement | null): boolean {
  if (!dialog || typeof document === 'undefined') return false;
  if (document.querySelector('dialog[open]')) return false;
  const modals = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')];
  return modals.length === 0 || modals[modals.length - 1] === dialog;
}

function focusNoScroll(el: HTMLElement | null) {
  if (!el) return;
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
}

export function HowDialog({
  open,
  title,
  closeLabel,
  exampleCaption,
  steps,
  pic,
  returnFocusTo,
  onClose,
}: HowDialogProps) {
  const titleId = useId();
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      focusNoScroll(closeButtonRef.current);
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      focusNoScroll(returnFocusTo.current);
    }
  }, [open, returnFocusTo]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;

    const inertRecords: Array<{ el: Element; hadInert: boolean }> = [];
    for (const child of Array.from(document.body.children)) {
      if (child.nodeType !== 1 || typeof child.setAttribute !== 'function') continue;
      if (child === backdropRef.current || child.contains(backdropRef.current)) continue;
      if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE') continue;
      inertRecords.push({ el: child, hadInert: child.hasAttribute('inert') });
      child.setAttribute('inert', '');
    }

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (!isTopMostModal(dialogRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      for (const { el, hadInert } of inertRecords) {
        if (!hadInert) el.removeAttribute('inert');
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = [
      ...dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      focusNoScroll(last);
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      focusNoScroll(first);
    }
  };

  const content = (
    <div
      ref={backdropRef}
      className={s.dialogBackdrop}
      data-how-dialog-backdrop=""
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-how-dialog=""
        onClick={(event) => event.stopPropagation()}
        onKeyDown={trapFocus}
      >
        <div className={s.dialogHead}>
          <h2 id={titleId} className={s.dialogTitle}>
            {title}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            className={s.dialogClose}
            aria-label={closeLabel}
            onClick={onClose}
            data-how-dialog-close=""
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5.5 5.5 14.5 14.5M14.5 5.5 5.5 14.5" />
            </svg>
          </button>
        </div>

        <ProcessStage
          steps={steps}
          ariaLabel={title}
          exampleCaption={exampleCaption}
          pic={pic}
          variant="dialog"
        />
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}
