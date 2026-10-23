import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { MakerSettings } from '@/lib/makers/profile';
import { MAKER_BIO_MAX } from '@/lib/makers/profile';
import { makerHref } from '@/lib/makers/links';
import { saveMakerProfileForm } from '@/app/(app)/creators/workspace/profile-actions';
import { BUTTON, FIELD, HINT, PANEL } from './styles';

/**
 * docs/PLATFORM-2.0.md §7.5 — the maker's public profile settings in the workspace. A server-rendered
 * form posting to a server action: no client island, works without JavaScript. `null` settings
 * means 0060 is not applied yet, and the panel says so instead of offering a form that cannot save.
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
  return (
    <section id="profile" data-maker-profile-settings className={`scroll-mt-24 ${PANEL}`}>
      <h2 className="text-xl font-semibold">{t.heading}</h2>
      <p className="text-sm leading-relaxed opacity-70">{t.lede}</p>
      {settings === null ? <p role="status" className="text-sm">{t.unavailable}</p> : <>
        {saved && <p role="status" className="rounded-xl border border-hairline p-3 text-sm">{t.saved}</p>}
        {message && <p role="alert" data-maker-profile-error={error} className="rounded-xl border border-accent p-3 text-sm">{message}</p>}
        <form action={saveMakerProfileForm} className="space-y-5">
          <label className="block text-sm font-medium">
            {t.handleLabel}
            <span className="mt-2 flex items-center gap-2">
              <span aria-hidden className="text-sm opacity-60">@</span>
              <input name="handle" defaultValue={settings.handle ?? ''} autoComplete="off" autoCapitalize="none" spellCheck={false} inputMode="text" maxLength={21} pattern="@?[A-Za-z0-9_]{3,20}" aria-describedby="maker-handle-hint" aria-invalid={error === 'invalid_handle' || error === 'handle_taken' || error === 'reserved_handle' || error === 'handle_required' ? true : undefined} className={`${FIELD} mt-0`} />
            </span>
            <span id="maker-handle-hint" className={HINT}>{t.handleHint}</span>
          </label>
          <label className="block text-sm font-medium">
            {t.bioLabel}
            <textarea name="bio" defaultValue={settings.bio ?? ''} rows={3} maxLength={MAKER_BIO_MAX} aria-describedby="maker-bio-hint" aria-invalid={error === 'invalid_bio' ? true : undefined} className={FIELD} />
            <span id="maker-bio-hint" className={HINT}>{t.bioHint}</span>
          </label>
          <label className="flex min-h-11 items-start gap-3 text-sm">
            <input type="checkbox" name="publicProfile" defaultChecked={settings.publicProfile} className="mt-0.5 size-5 shrink-0 accent-[var(--color-blue)]" />
            <span><span className="font-medium">{t.publicLabel}</span><span className={HINT}>{t.publicHint}</span></span>
          </label>
          <div className="flex flex-wrap items-center gap-4">
            <button type="submit" className={BUTTON}>{t.save}</button>
            {settings.publicProfile && settings.handle && <a href={makerHref(locale, settings.handle)} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">{t.view} ↗</a>}
          </div>
        </form>
      </>}
    </section>
  );
}
