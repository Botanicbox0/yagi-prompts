import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { MakerSettings } from '@/lib/makers/profile';
import { MAKER_BIO_MAX } from '@/lib/makers/profile';
import { CITY_MAX, COUNTRY_CODES, DISPLAY_NAME_MAX, EMAIL_MAX, HEADLINE_MAX, MAKER_LINKS_MAX, countryName } from '@/lib/makers/fields';
import { makerHref, makerShortPath } from '@/lib/makers/links';
import { saveMakerProfileForm } from '@/app/(app)/creators/workspace/profile-actions';
import { AvatarUpload } from './creative-studio';
import { BUTTON, FIELD, HINT, PANEL } from './styles';

/**
 * docs/PLATFORM-2.0.md §7.5·§20 — the creative's public profile settings in the studio. A
 * server-rendered form posting to a server action: works without JavaScript (the avatar alone is an
 * island, since a file needs one). `null` settings means 0060 is not applied yet, and the panel says
 * so; `extended: false` means 0065 is not, and the panel offers only handle, bio and the opt-in.
 */
export function MakerProfilePanel({
  settings,
  dict,
  locale,
  saved,
  error,
}: {
  settings: MakerSettings | null;
  dict: Dictionary;
  locale: Locale;
  saved: boolean;
  /** A result code from the redirect; only known codes are rendered. */
  error: string | null;
}) {
  const t = dict.creatorProgram.profile;
  const message = error && Object.hasOwn(t.errors, error) ? t.errors[error as keyof typeof t.errors] : null;
  const invalid = (...codes: string[]) => (error && codes.includes(error) ? true : undefined);
  const countries = COUNTRY_CODES.map((code) => ({ code, name: countryName(code, locale) })).sort((a, b) => a.name.localeCompare(b.name, locale));
  const label = 'block text-sm font-medium';
  return (
    <section id="profile" data-maker-profile-settings className={`scroll-mt-24 ${PANEL}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t.heading}</h2>
          <p className="mt-1 text-sm leading-relaxed opacity-70">{t.lede}</p>
        </div>
        {settings?.publicProfile && settings.handle && (
          <a href={makerHref(locale, settings.handle)} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">{t.view} ↗</a>
        )}
      </div>
      {settings === null ? <p role="status" className="text-sm">{t.unavailable}</p> : <>
        {saved && <p role="status" className="rounded-xl border border-hairline p-3 text-sm">{t.saved}</p>}
        {message && <p role="alert" data-maker-profile-error={error} className="rounded-xl border border-accent p-3 text-sm">{message}</p>}

        {settings.extended && (
          <AvatarUpload
            handle={settings.handle}
            version={settings.avatarVersion}
            name={settings.displayName}
            copy={{ label: t.avatarLabel, hint: t.avatarHint, upload: t.avatarUpload, remove: t.avatarRemove, errors: dict.creatorProgram.works.errors }}
          />
        )}

        <form action={saveMakerProfileForm} className="space-y-6">
          {settings.extended && (
            <fieldset className="space-y-5">
              <legend className="text-xs font-medium tracking-wide uppercase opacity-60">{t.basicsHeading}</legend>
              <label className={label}>
                {t.displayNameLabel}
                <input name="displayName" defaultValue={settings.displayName ?? ''} maxLength={DISPLAY_NAME_MAX} autoComplete="nickname" aria-invalid={invalid('invalid_name')} aria-describedby="maker-name-hint" className={FIELD} />
                <span id="maker-name-hint" className={HINT}>{t.displayNameHint}</span>
              </label>
              <label className={label}>
                {t.headlineLabel}
                <input name="headline" defaultValue={settings.headline ?? ''} maxLength={HEADLINE_MAX} aria-invalid={invalid('invalid_headline')} aria-describedby="maker-headline-hint" className={FIELD} />
                <span id="maker-headline-hint" className={HINT}>{t.headlineHint}</span>
              </label>
            </fieldset>
          )}

          <label className={label}>
            {t.handleLabel}
            <span className="mt-2 flex items-center gap-2">
              <span aria-hidden className="text-sm opacity-60">@</span>
              <input name="handle" defaultValue={settings.handle ?? ''} autoComplete="off" autoCapitalize="none" spellCheck={false} inputMode="text" maxLength={21} pattern="@?[A-Za-z0-9_]{3,20}" aria-describedby="maker-handle-hint" aria-invalid={invalid('invalid_handle', 'handle_taken', 'reserved_handle', 'handle_required')} className={`${FIELD} mt-0`} />
            </span>
            <span id="maker-handle-hint" className={HINT}>{t.handleHint}</span>
          </label>
          <label className={label}>
            {t.bioLabel}
            <textarea name="bio" defaultValue={settings.bio ?? ''} rows={3} maxLength={MAKER_BIO_MAX} aria-describedby="maker-bio-hint" aria-invalid={invalid('invalid_bio')} className={FIELD} />
            <span id="maker-bio-hint" className={HINT}>{t.bioHint}</span>
          </label>

          {settings.extended && <>
            <div className="grid gap-5 sm:grid-cols-2">
              <label className={label}>
                {t.countryLabel}
                <select name="country" defaultValue={settings.country ?? ''} aria-invalid={invalid('invalid_country')} className={FIELD}>
                  <option value="">{t.countryNone}</option>
                  {countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
                </select>
              </label>
              <label className={label}>
                {t.cityLabel}
                <input name="city" defaultValue={settings.city ?? ''} maxLength={CITY_MAX} autoComplete="address-level2" aria-invalid={invalid('invalid_city')} className={FIELD} />
                <span className={HINT}>{t.cityHint}</span>
              </label>
            </div>
            <label className={label}>
              {t.toolsLabel}
              <input name="tools" defaultValue={settings.tools.join(', ')} aria-invalid={invalid('invalid_tools')} aria-describedby="maker-tools-hint" className={FIELD} />
              <span id="maker-tools-hint" className={HINT}>{t.toolsHint}</span>
            </label>

            <fieldset className="space-y-3">
              <legend className="text-xs font-medium tracking-wide uppercase opacity-60">{t.contactHeading}</legend>
              <p className="text-sm font-medium">{t.linksLabel}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {Array.from({ length: MAKER_LINKS_MAX }, (_, i) => (
                  <input key={i} name={`link${i}`} type="text" inputMode="url" defaultValue={settings.links[i]?.url ?? ''} placeholder={i === 0 ? 'instagram.com/…' : i === 1 ? 'tiktok.com/@…' : 'https://'} autoComplete="url" aria-label={`${t.linksLabel} ${i + 1}`} aria-invalid={invalid('invalid_links')} className={`${FIELD} mt-0`} />
                ))}
              </div>
              <span className={HINT}>{t.linksHint}</span>
              <label className={`${label} pt-2`}>
                {t.emailLabel}
                <input name="publicEmail" type="email" defaultValue={settings.publicEmail ?? ''} maxLength={EMAIL_MAX} autoComplete="email" aria-invalid={invalid('invalid_email')} aria-describedby="maker-email-hint" className={FIELD} />
                <span id="maker-email-hint" className={HINT}>{t.emailHint}</span>
              </label>
            </fieldset>

            <label className="flex min-h-11 items-start gap-3 text-sm">
              <input type="checkbox" name="openToBrands" defaultChecked={settings.openToBrands} className="mt-0.5 size-5 shrink-0 accent-[var(--color-blue)]" />
              <span><span className="font-medium">{t.openToBrandsLabel}</span><span className={HINT}>{t.openToBrandsHint}</span></span>
            </label>
          </>}

          <label className="flex min-h-11 items-start gap-3 rounded-xl bg-on-surface/5 p-4 text-sm">
            <input type="checkbox" name="publicProfile" defaultChecked={settings.publicProfile} className="mt-0.5 size-5 shrink-0 accent-[var(--color-blue)]" />
            <span><span className="font-medium">{t.publicLabel}</span><span className={HINT}>{t.publicHint}</span></span>
          </label>
          <div className="flex flex-wrap items-center gap-4">
            <button type="submit" className={BUTTON}>{t.save}</button>
            {settings.publicProfile && settings.handle && (
              <span className="text-xs opacity-70">{t.shortLink}: <span className="font-mono">twings.app{makerShortPath(settings.handle)}</span></span>
            )}
          </div>
        </form>
      </>}
    </section>
  );
}
