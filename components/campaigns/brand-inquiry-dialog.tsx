'use client';

import { useEffect, useRef } from 'react';
import { BrandInquiryForm, type BrandFormLabels } from './brand-form';
import styles from './brand-inquiry-dialog.module.css';
import { inquiryDestination, inquirySelections } from '@/lib/campaigns/inquiry-navigation';

/** All enquiry links keep their native anchor fallback. Only this small island owns the modal. */
export function BrandInquiryDialog({ endpoint, locale, labels, privacy, title, body, close }: {
  endpoint: string; locale: 'ko' | 'en'; labels: BrandFormLabels;
  privacy: { href: string; label: string }; title: string; body: string; close: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    let previousOverflow = '';
    let opener: HTMLElement | null = null;
    let fromLocation = false;
    let locked = false;
    const show = (destination: URL, trigger: HTMLElement | null, incoming: boolean) => {
      if (typeof dialog.showModal !== 'function') return;
      const values = inquirySelections(destination, Object.keys(labels.inquiryTypeOptions), Object.keys(labels.useCaseOptions));
      window.dispatchEvent(new CustomEvent('twings:inquiry-type', { detail: values.type }));
      window.dispatchEvent(new CustomEvent('twings:use-case', { detail: values.useCase }));
      if (dialog.open) return;
      opener = trigger;
      fromLocation = incoming;
      if (!locked) {
        previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        locked = true;
      }
      dialog.showModal();
    };
    const open = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest<HTMLAnchorElement>('a[data-inquiry-trigger], a[href$="#brands"]');
      if (!anchor || typeof dialog.showModal !== 'function') return;
      const destination = inquiryDestination(anchor.href, window.location.href);
      if (!destination) return;
      event.preventDefault();
      show(destination, anchor, false);
    };
    const restore = () => {
      // A queued close event must not undo a dialog reopened before that event is delivered.
      if (dialog.open) return;
      if (locked) { document.body.style.overflow = previousOverflow; locked = false; }
      if (fromLocation && window.location.hash === '#brands') {
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
      }
      fromLocation = false;
      if (opener?.isConnected) opener.focus();
      opener = null;
    };
    const followLocation = () => {
      const destination = inquiryDestination(window.location.href, window.location.href);
      if (destination) show(destination, null, true);
      else if (fromLocation && dialog.open) dialog.close();
    };
    document.addEventListener('click', open);
    dialog.addEventListener('close', restore);
    window.addEventListener('hashchange', followLocation);
    window.addEventListener('popstate', followLocation);
    followLocation();
    return () => {
      document.removeEventListener('click', open);
      dialog.removeEventListener('close', restore);
      window.removeEventListener('hashchange', followLocation);
      window.removeEventListener('popstate', followLocation);
      if (dialog.open) dialog.close();
      if (locked) document.body.style.overflow = previousOverflow;
    };
  }, [labels.inquiryTypeOptions, labels.useCaseOptions]);
  return <>
    <noscript><style>{`.${styles.dialog}:not([open]){display:block;position:static;max-height:none;width:100%;margin:0}.${styles.close}{display:none}`}</style></noscript>
    <dialog ref={dialogRef} data-brand-inquiry-dialog data-lenis-prevent aria-labelledby="inquiry-dialog-title" aria-describedby="inquiry-dialog-body" className={styles.dialog} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
    }}>
      <button type="button" className={styles.close} aria-label={close} onClick={() => dialogRef.current?.close()}><span aria-hidden="true">×</span></button>
      <h2 id="inquiry-dialog-title" className={styles.title}>{title}</h2>
      <p id="inquiry-dialog-body" className={styles.body}>{body}</p>
      <BrandInquiryForm compact endpoint={endpoint} locale={locale} labels={labels} privacy={privacy} templates={[]} />
    </dialog>
  </>;
}
