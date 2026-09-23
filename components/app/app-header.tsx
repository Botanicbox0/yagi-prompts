import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { TwingsLogo } from '@/components/brand/twings-mark';
import { LocaleToggle } from '@/components/locale-toggle';
import { siteLinks } from '@/components/marketing/chrome';

/**
 * The (app) group's header — the wordmark and the site's own links, the shape /account and
 * /library settled on in the 2026-09-03 UX pass, spelled once for the session-gated pages that
 * followed (the campaign apply page, "my campaigns").
 */
export function AppHeader({ locale, dict, rest }: { locale: Locale; dict: Dictionary; rest: string }) {
  return (
    <header className="border-b border-hairline">
      <div className="mx-auto flex max-w-shell items-center justify-between px-gutter py-5">
        <a href={`/${locale}`} className="flex items-center">
          <TwingsLogo size={18} />
        </a>
        <div className="flex items-center gap-6">
          {siteLinks(locale, dict).map((link, index) => (
            <a
              key={link.href}
              href={link.href}
              className={[index === 0 ? '' : 'hidden sm:inline', 'font-label text-eyebrow uppercase'].join(' ')}
            >
              {link.label}
            </a>
          ))}
          {/* Audit P2-9: session-gated pages link the account (내 작품, deletion) directly. */}
          <a href="/account" data-app-account className="font-label text-eyebrow uppercase">
            {dict.nav.account}
          </a>
          <LocaleToggle current={locale} rest={rest} prefixed={false} />
        </div>
      </div>
    </header>
  );
}
