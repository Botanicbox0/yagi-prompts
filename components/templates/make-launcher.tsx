'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { interpolate } from '@/lib/i18n/format';
import { serverViewerAccess, subscribeViewerAccess, viewerAccessSnapshot, type ViewerAccess } from '@/lib/twings/viewer-access';

export interface MakeLauncherLabels {
  /** The signed-out reader's one line where a price used to be (founder 2026-10-29). */
  subscribeCta: string;
  /** `{n} credits` — what a signed-in reader spends. */
  credits: string;
  makeCta: string;
  makeCtaClosed: string;
}

const CTA = 'flex min-h-12 w-full items-center justify-center bg-accent px-5 font-label text-[0.85rem] tracking-[0.1em] text-white uppercase transition-opacity hover:opacity-85';

interface MakeLauncherProps { credits: number | null; signinHref: string; labels: MakeLauncherLabels; children?: ReactNode }

/**
 * The template page's make box (founder, 2026-10-29: "가격을 토큰 베이스로", the make panel as a
 * pop-up). No won, no dollar: a signed-out reader sees "Subscribe to make it here", one tap to the
 * free sign-up that comes back to the make sheet; a signed-in reader sees what the template costs in
 * credits and opens the sheet (`#make`, components/templates/make-sheet.tsx). The facts arrive from
 * the server as children. Who the reader is comes from the studio's own access call
 * (lib/twings/viewer-access.ts) — no second request.
 *
 * On a phone the same CTA stays at the thumb while the box is off screen: under 768px, clear of the
 * home indicator, and `data-hide-tabs` so the installed app's tabs step aside.
 */
export function MakeLauncher(props: MakeLauncherProps) {
  const access = useSyncExternalStore(subscribeViewerAccess, viewerAccessSnapshot, serverViewerAccess);
  return <MakeLauncherView {...props} access={access} />;
}

/** The launcher for a known (or not yet known: `null`) reader. */
export function MakeLauncherView({ credits, signinHref, labels, children, access }: MakeLauncherProps & { access: ViewerAccess | null }) {
  const boxRef = useRef<HTMLElement>(null);
  const [boxInView, setBoxInView] = useState(true);
  useEffect(() => {
    const target = boxRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setBoxInView(entry?.isIntersecting ?? false));
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  const signedIn = access?.signedIn === true;
  const cost = signedIn && credits !== null ? interpolate(labels.credits, { n: String(credits) }) : null;
  const cta = (where: 'launcher' | 'sticky') => signedIn
    ? <a href="#make" data-make-cta={where} className={CTA}>{access?.live ? labels.makeCta : labels.makeCtaClosed}</a>
    : <a href={signinHref} data-make-cta={where} data-make-subscribe className={CTA}>{labels.subscribeCta}</a>;

  return (
    <>
      <section ref={boxRef} data-template-make-launcher data-viewer={access === null ? 'unknown' : signedIn ? 'member' : 'visitor'} className="mt-6 rounded-2xl border border-hairline p-5 sm:p-6">
        {cost && <p data-template-credits className="font-display text-[2rem] leading-none font-black">{cost}</p>}
        <div className={cost ? 'mt-2.5' : ''}>{children}</div>
        <div className="mt-4">{cta('launcher')}</div>
      </section>
      <div
        data-make-sticky
        data-hide-tabs
        data-make-sticky-state={boxInView ? 'away' : 'shown'}
        aria-hidden={boxInView ? 'true' : undefined}
        inert={boxInView ? true : undefined}
        className={[
          'fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-surface/95 px-4 pt-3 pb-safe backdrop-blur md:hidden',
          'transition-transform duration-200 ease-out motion-reduce:transition-none',
          boxInView ? 'translate-y-full' : 'translate-y-0',
        ].join(' ')}
      >
        <div className="mx-auto flex max-w-xl items-center gap-4">
          {cost && <p data-make-sticky-credits className="shrink-0 font-display text-[1.2rem] leading-none font-black">{cost}</p>}
          <div className="flex-1">{cta('sticky')}</div>
        </div>
      </div>
    </>
  );
}
