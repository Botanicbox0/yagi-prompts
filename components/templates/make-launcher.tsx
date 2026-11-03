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

const CTA = 'audience-button w-full';

interface MakeLauncherProps {
  credits: number | null;
  /** The single-purchase price, shown to everyone until subscriptions open (the terms promise it here). */
  price?: { value: string; label: string } | null;
  signinHref: string;
  labels: MakeLauncherLabels;
  children?: ReactNode;
  /** Above the cost: on a story-first template, "my selfie → this scene" after the recipe. */
  lead?: ReactNode;
  /** The phone bar waits until the reader has scrolled past the box, not while it is still ahead. */
  stickyAfter?: boolean;
}

/**
 * The template page's make box. Until subscriptions open it shows the single-purchase price and a plain
 * make CTA, because the terms promise that price here and Toss review forbids credits on the web (§19.2).
 * After that (founder, 2026-10-29: "가격을 토큰 베이스로", the make panel as a
 * pop-up). No won, no dollar: a signed-out reader sees "Subscribe to make it here", one tap to the
 * free sign-up that comes back to the make sheet; a signed-in reader sees what the template costs in
 * credits and opens the sheet (`#make`, components/templates/make-sheet.tsx). The facts arrive from
 * the server as children. Who the reader is comes from the studio's own access call
 * (lib/twings/viewer-access.ts) — no second request.
 *
 * On a phone the same CTA stays at the thumb while the box is off screen: under 768px, clear of the
 * home indicator, and `data-hide-tabs` so the installed app's tabs step aside. With `stickyAfter`
 * (the box follows the recipe) it waits until the box has gone by: the recipe is read first.
 */
export function MakeLauncher(props: MakeLauncherProps) {
  const access = useSyncExternalStore(subscribeViewerAccess, viewerAccessSnapshot, serverViewerAccess);
  return <MakeLauncherView {...props} access={access} />;
}

/** The launcher for a known (or not yet known: `null`) reader. */
export function MakeLauncherView({ credits, price = null, signinHref, labels, children, lead, stickyAfter = false, access }: MakeLauncherProps & { access: ViewerAccess | null }) {
  const boxRef = useRef<HTMLElement>(null);
  const [box, setBox] = useState<'in' | 'ahead' | 'passed'>('in');
  useEffect(() => {
    const target = boxRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      setBox(entry.isIntersecting ? 'in' : entry.boundingClientRect.top < 0 ? 'passed' : 'ahead');
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  const boxInView = box === 'in' || (stickyAfter && box === 'ahead');

  const signedIn = access?.signedIn === true;
  const cost = !price && signedIn && credits !== null ? interpolate(labels.credits, { n: String(credits) }) : null;
  const cta = (where: 'launcher' | 'sticky') => signedIn
    ? <a href="#make" data-make-cta={where} className={CTA}>{access?.live ? labels.makeCta : labels.makeCtaClosed}</a>
    : <a href={signinHref} data-make-cta={where} data-make-subscribe className={CTA}>{labels.subscribeCta}</a>;

  return (
    <>
      <section ref={boxRef} data-template-make-launcher data-viewer={access === null ? 'unknown' : signedIn ? 'member' : 'visitor'} className="mt-6 rounded-[24px] border border-hairline bg-white p-5 shadow-[0_14px_34px_-24px_rgba(12,15,20,0.14)] sm:p-6">
        {lead && <div data-make-lead className="mb-5">{lead}</div>}
        {cost && <p data-template-credits className="font-display text-[2rem] leading-none font-black tabular-nums">{cost}</p>}
        {price && (
          <div className="flex flex-wrap items-center gap-2.5">
            <p data-template-price className="font-display text-[2rem] leading-none font-black tabular-nums">{price.value}</p>
            <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-black/75">{price.label}</span>
          </div>
        )}
        <div className={cost || price ? 'mt-2.5' : ''}>{children}</div>
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
          {cost && <p data-make-sticky-credits className="shrink-0 font-display text-[1.2rem] leading-none font-black tabular-nums">{cost}</p>}
          {price && <p data-make-sticky-price className="shrink-0 font-display text-[1.2rem] leading-none font-black tabular-nums">{price.value}</p>}
          <div className="flex-1">{cta('sticky')}</div>
        </div>
      </div>
    </>
  );
}
