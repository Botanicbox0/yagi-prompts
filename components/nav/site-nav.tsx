'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TwingsLogo } from '@/components/brand/twings-mark';
import { TextSwap } from '@/components/ui/text-swap';
import { useScroll } from '@/components/motion/scroll-provider';
import { type SectionTheme } from '@/lib/motion/geometry';
import type { Audience } from '@/lib/navigation/audience';

/**
 * The fixed 64px audience navigation stays white so both public experiences have one stable door.
 *   · It NEVER reads the session. A marketing nav that awaited `getUser()` would drag `/[locale]`
 *     and `/[locale]/pricing` out of static rendering and break the §3.1 cache contract, so
 *     "Sign in" is an unconditional link. Authed chrome lives in the (app) group.
 *   · Below 1024 the links collapse into an accessible overlay menu.
 */

export interface NavLabels {
  brand: string;
  signIn: string;
  menu: string;
  close: string;
  primary: string;
  skipToContent: string;
}

export interface NavLink {
  href: string;
  label: string;
}

export function SiteNav({
  locale,
  labels,
  links,
  signInNext,
  localeToggle,
  audience = 'creator', modes = [], audienceLabel, signInHref: explicitSignInHref, primary,
}: {
  locale: string;
  labels: NavLabels;
  /**
   * §13.2 — the nav's contents are decided by the SERVER (`components/marketing/chrome.tsx`), which
   * is where `PLAYBOOKS_IN_NAV` lives. Passing the resolved list keeps this client component free
   * of product policy and keeps the flag a one-line change in one file.
   */
  links: NavLink[];
  /** Where a sign-in returns to. `/prompts` is the v1.5 home; `/library` was the v1 one. */
  signInNext: string;
  localeToggle: ReactNode;
  initialTheme?: SectionTheme;
  audience?: Audience;
  modes?: Array<{ id: Audience; href: string; label: string }>;
  audienceLabel?: string;
  signInHref?: string;
  primary?: NavLink;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const { lenis } = useScroll();

  // --- hairline appears once the page has moved (§4) -----------------------
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // --- overlay menu: lock the scroller, close on Escape --------------------
  useEffect(() => {
    if (!open) return;
    lenis?.stop();
    document.documentElement.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key === 'Tab') {
        const controls = overlayRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
        if (!controls?.length) return;
        const first = controls[0]; const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.documentElement.style.overflow = '';
      lenis?.start();
      menuButtonRef.current?.focus();
    };
  }, [open, lenis]);

  // A resize past the overlay breakpoint must not leave a stuck, invisible dialog.
  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      if (window.innerWidth >= 1024) setOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  const signInHref = explicitSignInHref ?? `/auth/signin?next=${encodeURIComponent(signInNext)}&locale=${locale}`;
  const modeLinks = (
    <div aria-label={audienceLabel} data-audience-switch className="flex shrink-0 items-center gap-0.5 rounded-full border border-hairline p-0.5 text-[0.6875rem] font-medium sm:text-xs">
      {modes.map(mode => <a key={mode.id} href={mode.href} aria-current={mode.id === audience ? 'page' : undefined} data-audience={mode.id} className={`inline-flex min-h-10 items-center justify-center rounded-full px-2.5 transition-colors sm:px-3 ${mode.id === audience ? 'bg-black text-white' : 'hover:bg-black/5'}`}>{mode.label}</a>)}
    </div>
  );

  return (
    <>
      <a
        href="#main"
        className="text-accent sr-only bg-white px-4 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60]"
      >
        {labels.skipToContent}
      </a>

      <header
        data-theme="light"
        data-audience-nav={audience}
        className={[
          'fixed inset-x-0 top-0 z-50 h-16 text-on-surface',
          // A stable white bar gains a separator after the page moves.
          scrolled
            ? 'border-b border-hairline bg-surface'
            : 'border-b border-transparent bg-surface',
        ].join(' ')}
      >
        <nav
          aria-label={labels.primary}
          className="mx-auto flex h-full max-w-shell items-center justify-between px-gutter"
        >
          {/* No aria-label: the wordmark's own `aria-label` IS the accessible name (2026-08-16 —
              the mark became the logotype, so the text beside it would have been the same word
              twice). */}
          <div className="flex min-w-0 items-center gap-2 min-[360px]:gap-3 sm:gap-5">
            <a href={audience === 'brand' ? `/${locale}/brands` : `/${locale}`} className="flex shrink-0 items-center" title={labels.brand}>
              <TwingsLogo size={16} className="[&_[data-twings-mark]]:hidden min-[360px]:[&_[data-twings-mark]]:inline-block" />
            </a>
            {modeLinks}
          </div>

          <div className="hidden items-center gap-5 lg:flex">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-xs font-medium"
              >
                <TextSwap>{link.label}</TextSwap>
              </a>
            ))}
            {localeToggle}
            <a
              href={signInHref}
              className="inline-flex min-h-10 items-center rounded-full border border-current px-4 py-2 text-xs font-medium"
            >
              <TextSwap>{labels.signIn}</TextSwap>
            </a>
            {audience === 'brand' && primary && <a href={primary.href} className="inline-flex min-h-10 items-center rounded-full bg-black px-4 py-2 text-xs font-medium text-white">{primary.label} ↗</a>}
          </div>

          <button
            type="button"
            ref={menuButtonRef}
            onClick={() => setOpen(true)}
            aria-expanded={open}
            aria-controls="nav-overlay"
            className="ml-2 min-h-11 min-w-11 shrink-0 text-xs font-medium lg:hidden"
          >
            <TextSwap>{labels.menu}</TextSwap>
          </button>
        </nav>
      </header>

      {open && (
        <div
          id="nav-overlay"
          ref={overlayRef}
          role="dialog"
          aria-modal="true"
          aria-label={labels.primary}
          data-theme="light"
          className="fixed inset-0 z-[55] flex flex-col overflow-y-auto bg-surface text-on-surface lg:hidden"
        >
          <div className="flex h-16 items-center justify-between px-gutter">
            <span className="font-display text-[1.05rem] leading-none font-black uppercase">
              {labels.brand}
            </span>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={() => setOpen(false)}
              className="font-label text-eyebrow uppercase"
            >
              <TextSwap>{labels.close}</TextSwap>
            </button>
          </div>

          <div className="flex flex-1 flex-col justify-between px-gutter pt-10 pb-12">
            <div className="mb-8 self-start" onClick={() => setOpen(false)}>{modeLinks}</div>
            <ul className="flex flex-col gap-6">
              {links.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className="text-[clamp(1.7rem,7vw,3rem)] leading-tight font-semibold tracking-tight"
                  >
                    <TextSwap>{link.label}</TextSwap>
                  </a>
                </li>
              ))}
              <li>
                <a
                  href={signInHref}
                  onClick={() => setOpen(false)}
                  className="inline-block pt-5 text-lg font-medium underline underline-offset-4"
                >
                  <TextSwap>{labels.signIn}</TextSwap>
                </a>
              </li>
              {audience === 'brand' && primary && <li><a onClick={() => setOpen(false)} href={primary.href} className="inline-flex min-h-12 items-center rounded-full bg-black px-6 text-sm font-medium text-white">{primary.label} ↗</a></li>}
            </ul>
            <div className="pt-10">{localeToggle}</div>
          </div>
        </div>
      )}
    </>
  );
}
