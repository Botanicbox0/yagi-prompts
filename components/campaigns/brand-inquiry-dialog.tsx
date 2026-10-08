'use client';

import { useEffect, useRef } from 'react';
import { BrandInquiryForm, type BrandFormLabels } from './brand-form';
import styles from './brand-inquiry-dialog.module.css';

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
    const open = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element)?.closest<HTMLAnchorElement>('a[data-inquiry-trigger], a[href$="#brands"]');
      if (!anchor || typeof dialog.showModal !== 'function') return;
      const destination = new URL(anchor.href);
      if (destination.origin !== window.location.origin || destination.pathname !== window.location.pathname) return;
      event.preventDefault();
      const params = destination.searchParams;
      window.dispatchEvent(new CustomEvent('twings:inquiry-type', { detail: params.get('type') ?? 'campaign' }));
      window.dispatchEvent(new CustomEvent('twings:use-case', { detail: params.get('useCase') ?? 'undecided' }));
      if (!dialog.open) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; dialog.showModal(); }
    };
    const restore = () => { document.body.style.overflow = previousOverflow; };
    document.addEventListener('click', open);
    dialog.addEventListener('close', restore);
    return () => { document.removeEventListener('click', open); dialog.removeEventListener('close', restore); if (dialog.open) { dialog.close(); restore(); } };
  }, []);
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
