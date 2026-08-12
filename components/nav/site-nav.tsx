'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GoatMark } from './goat-mark';
import { TextSwap } from '@/components/ui/text-swap';
import { useScroll } from '@/components/motion/scroll-provider';
import { useSectionThemeAt } from '@/components/motion/use-section-theme';
import { BREAKPOINTS, NAV_HEIGHT, type SectionTheme } from '@/lib/motion/geometry';

/**
 * PLAN §4 — the fixed 64px bar.
 *
 *   · Theme is SECTION-STATE-DRIVEN: an IntersectionObserver shrinks its root to a 1px probe line
 *     at the bar's midpoint and flips `data-theme` to whichever section crosses it. No
 *     `mix-blend-mode` anywhere (R2 dropped it).
 *   · It NEVER reads the session. A marketing nav that awaited `getUser()` would drag `/[locale]`
 *     and `/[locale]/pricing` out of static rendering and break the §3.1 cache contract, so
 *     "Sign in" is an unconditional link. Authed chrome lives in the (app) group.
 *   · Every label is a text-swap (§5.3-3).
 *   · Below 768 the links collapse into an overlay menu (§4).
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
  initialTheme = 'light',
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
}) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { lenis } = useScroll();

  // §4 — the bar takes the theme of whichever section crosses its midpoint.
  const theme = useSectionThemeAt(NAV_HEIGHT / 2, initialTheme);

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
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.documentElement.style.overflow = '';
      lenis?.start();
    };
  }, [open, lenis]);

  // A resize past the overlay breakpoint must not leave a stuck, invisible dialog.
  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      if (window.innerWidth >= BREAKPOINTS.navOverlay) setOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  const signInHref = `/auth/signin?next=${encodeURIComponent(signInNext)}&locale=${locale}`;

  return (
    <>
      <a
        href="#main"
        className="text-accent sr-only bg-white px-4 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60]"
      >
        {labels.skipToContent}
      </a>

      <header
        data-theme={theme}
        className={[
          'fixed inset-x-0 top-0 z-50 h-16 text-on-surface',
          // Transparent over the first screen so the hero reads full-bleed; opaque the moment the
          // page moves, because display type set at 180px scrolls straight through a see-through
          // bar and takes the wordmark with it. §4's "solid hairline underline on scroll" is the
          // same idea one step further.
          scrolled
            ? 'border-b border-hairline bg-surface'
            : 'border-b border-transparent bg-transparent',
        ].join(' ')}
      >
        <nav
          aria-label={labels.primary}
          className="mx-auto flex h-full max-w-shell items-center justify-between px-gutter"
        >
          {/* No aria-label: the visible "PLAYBOOK" wordmark IS the accessible name. An
              aria-label of "Home" would override it and mismatch the visible text (axe
              `label-content-name-mismatch`), which breaks voice control. */}
          <a href={`/${locale}`} className="flex items-center gap-2.5">
            <GoatMark className="h-6 w-6" />
            <span className="font-display text-[1.05rem] leading-none font-black tracking-[0.02em] uppercase">
              <TextSwap>{labels.brand}</TextSwap>
            </span>
          </a>

          <div className="hidden items-center gap-8 md:flex">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="font-label text-eyebrow uppercase"
              >
                <TextSwap>{link.label}</TextSwap>
              </a>
            ))}
            {localeToggle}
            <a
              href={signInHref}
              className="border border-current px-4 py-2 font-label text-eyebrow uppercase"
            >
              <TextSwap>{labels.signIn}</TextSwap>
            </a>
          </div>

          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-expanded={open}
            aria-controls="nav-overlay"
            className="font-label text-eyebrow uppercase md:hidden"
          >
            <TextSwap>{labels.menu}</TextSwap>
          </button>
        </nav>
      </header>

      {open && (
        <div
          id="nav-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={labels.primary}
          data-theme="dark"
          className="fixed inset-0 z-[55] flex flex-col bg-surface text-on-surface md:hidden"
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
            <ul className="flex flex-col gap-6">
              {links.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="font-display text-[clamp(2.5rem,12vw,4rem)] leading-[0.95] font-black uppercase"
                  >
                    <TextSwap>{link.label}</TextSwap>
                  </a>
                </li>
              ))}
              <li>
                <a
                  href={signInHref}
                  className="text-accent font-display text-[clamp(2.5rem,12vw,4rem)] leading-[0.95] font-black uppercase"
                >
                  <TextSwap>{labels.signIn}</TextSwap>
                </a>
              </li>
            </ul>
            <div className="pt-10">{localeToggle}</div>
          </div>
        </div>
      )}
    </>
  );
}
