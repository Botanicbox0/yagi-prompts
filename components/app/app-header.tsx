import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { TwingsWordmark } from '@/components/brand/twings-wordmark';
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
        <a href={`/${locale}`} className="flex items-center gap-2.5">
          <TwingsWordmark className="h-[18px] w-auto" />
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
          <LocaleToggle current={locale} rest={rest} prefixed={false} />
        </div>
      </div>
    </header>
  );
}
