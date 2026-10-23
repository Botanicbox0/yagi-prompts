'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { chooseProviderHref } from '@/lib/auth/providers';
import { useCreatorSession } from '@/components/nav/creator-account';
import { useStandaloneDisplay } from '@/components/pwa/display-mode';

/**
 * The installed app's bottom tabs — docs/PLATFORM-2.0.md §5.2 (2026-10-22).
 *
 * Standalone only. The 2026-10-07 decision — no bottom-fixed UI in the mobile browser, so nothing
 * covers the pay and make buttons — stands for the browser: on the server and in a browser tab this
 * renders nothing, and app/globals.css hides `[data-bottom-tabs]` outside standalone as well.
 *
 * Hiding them on a page: put `data-hide-tabs` on any element. The simplest place is the page's own
 * bottom-fixed bar (the template make screen's CTA), so the tabs step aside exactly while that bar
 * is on screen; `<body data-hide-tabs>` works the same way. See docs/qa/app-shell/README.md.
 */

type Labels = Dictionary['appShell']['tabs'];

export type BottomTabId = 'formats' | 'renders' | 'photo' | 'account';

export interface BottomTabItem {
  id: BottomTabId;
  href: string;
  label: string;
  current: boolean;
}

/** "내 사진" lives on /account until the selfie library gives it a page of its own (§4). */
export const PHOTO_HREF = '/account';
const ACCOUNT_HREF = '/account';
const RENDERS_HREF = '/renders';

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

export function bottomTabItems({
  locale,
  pathname,
  signedIn,
  labels,
  photoHref = PHOTO_HREF,
}: {
  locale: Locale;
  pathname: string | null;
  signedIn: boolean;
  labels: Labels;
  photoHref?: string;
}): BottomTabItem[] {
  const path = pathname ?? '';
  const items: BottomTabItem[] = [
    { id: 'formats', href: `/${locale}/video`, label: labels.formats, current: /^\/(?:en|ko)\/(?:video|image|t)(?:\/|$)/.test(path) },
    // Signed out, "my work" is the sign-in door that comes back to it.
    { id: 'renders', href: signedIn ? RENDERS_HREF : chooseProviderHref(RENDERS_HREF, locale), label: labels.renders, current: under(path, RENDERS_HREF) },
    { id: 'photo', href: photoHref, label: labels.photo, current: photoHref !== ACCOUNT_HREF && under(path, photoHref) },
    { id: 'account', href: ACCOUNT_HREF, label: labels.account, current: under(path, ACCOUNT_HREF) },
  ];
  // Two tabs to one place are one tab: while the photo page is /account, "내 사진" folds into "계정".
  return photoHref === ACCOUNT_HREF ? items.filter((item) => item.id !== 'photo') : items;
}

function TabIcon({ id }: { id: BottomTabId }) {
  const common = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  switch (id) {
    case 'formats':
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="14" rx="3" />
          <path d="M10.25 9.5v5l4.25-2.5z" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'renders':
      return (
        <svg {...common}>
          <rect x="7" y="3.5" width="13.5" height="13.5" rx="2.5" />
          <path d="M3.5 7.5v10a3 3 0 0 0 3 3h10" />
        </svg>
      );
    case 'photo':
      return (
        <svg {...common}>
          <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
          <circle cx="12" cy="10.5" r="2.75" />
          <path d="M7.75 17c.9-1.9 2.4-2.9 4.25-2.9s3.35 1 4.25 2.9" />
        </svg>
      );
    case 'account':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="10" r="3" />
          <path d="M6.9 17.6c1.2-1.9 3-2.9 5.1-2.9s3.9 1 5.1 2.9" />
        </svg>
      );
  }
}

/**
 * The bar itself — the site's own tokens (white surface, hairline, ink; the current tab in the
 * accent blue), 56px rows, the current tab named for assistive tech. The bar always sits on white,
 * so the blue is `text-blue` (#0000EE) — app/globals.css keeps `text-accent` for section-inverting
 * chrome, and a plain class takes no `aria-*` variant in Tailwind v4. The focus ring is the site's
 * own, drawn inside the tab so the screen edge never clips it.
 */
export function BottomTabsBar({ items, label }: { items: BottomTabItem[]; label: string }) {
  return (
    <nav data-bottom-tabs aria-label={label} className="fixed inset-x-0 bottom-0 z-50 border-t border-hairline bg-surface text-on-surface">
      <ul className="mx-auto grid max-w-md" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={item.href}
              data-tab={item.id}
              aria-current={item.current ? 'page' : undefined}
              className="flex min-h-14 flex-col items-center justify-center gap-1 px-1 text-[0.6875rem] leading-none font-medium text-on-surface aria-[current=page]:font-semibold aria-[current=page]:text-blue focus-visible:outline-offset-[-3px]"
            >
              <TabIcon id={item.id} />
              <span>{item.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Watches for a page's `data-hide-tabs`, only while the tabs could show at all. */
function usePageHidesTabs(active: boolean): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!active) return;
    const read = () => setHidden(document.querySelector('[data-hide-tabs]') !== null);
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-hide-tabs'] });
    return () => observer.disconnect();
  }, [active]);
  return hidden;
}

export function BottomTabs({ locale, labels }: { locale: Locale; labels: Labels }) {
  const standalone = useStandaloneDisplay();
  const pathname = usePathname();
  const session = useCreatorSession(standalone === true);
  const hidden = usePageHidesTabs(standalone === true);
  const visible = standalone === true && !hidden;

  // `html[data-app-tabs]` reserves the bar's height at the bottom of the page (app/globals.css).
  useEffect(() => {
    document.documentElement.toggleAttribute('data-app-tabs', visible);
    return () => document.documentElement.removeAttribute('data-app-tabs');
  }, [visible]);

  if (!visible) return null;
  return <BottomTabsBar items={bottomTabItems({ locale, pathname, signedIn: session.signedIn, labels })} label={labels.nav} />;
}
