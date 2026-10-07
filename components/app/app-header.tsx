import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { TwingsLogo } from '@/components/brand/twings-mark';
import { LocaleToggle } from '@/components/locale-toggle';

/**
 * The (app) group's header — the wordmark and the site's own links, the shape /account and
 * /library settled on in the 2026-09-03 UX pass, spelled once for the session-gated pages that
 * followed (the campaign apply page, "my campaigns").
 */
export function AppHeader({ locale, dict, rest }: { locale: Locale; dict: Dictionary; rest: string }) {
  const links = [
    { href: `/${locale}/video`, label: dict.audience.browse, active: rest.startsWith('/video') || rest.startsWith('/image') },
    { href: `/${locale}/campaigns`, label: dict.nav.campaigns, active: rest.startsWith('/campaigns') },
    { href: '/renders', label: dict.audience.myWork, active: rest.startsWith('/renders') },
    { href: '/account', label: dict.nav.account, active: rest.startsWith('/account') },
  ];
  return (
    <header className="border-b border-hairline">
      <div className="mx-auto flex max-w-shell items-center justify-between px-gutter py-5">
        <a href={`/${locale}`} className="flex items-center">
          <TwingsLogo size={18} />
        </a>
        <div className="flex items-center gap-6">
          <nav aria-label={dict.nav.primary} className="hidden items-center gap-6 md:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              aria-current={link.active ? 'page' : undefined}
              data-app-account={link.href === '/account' ? '' : undefined}
              className="inline-flex min-h-11 items-center text-sm aria-[current=page]:font-semibold"
            >
              {link.label}
            </a>
          ))}
          </nav>
          <LocaleToggle current={locale} rest={rest} prefixed={false} />
        </div>
      </div>
      <nav aria-label={dict.nav.primary} data-app-mobile-nav className="grid grid-cols-4 border-t border-hairline px-3 md:hidden">
        {links.map((link) => <a key={link.href} href={link.href} aria-current={link.active ? 'page' : undefined} data-app-account={link.href === '/account' ? '' : undefined} className="flex min-h-12 items-center justify-center px-1 text-center text-xs aria-[current=page]:border-b-2 aria-[current=page]:font-semibold">{link.label}</a>)}
      </nav>
    </header>
  );
}
