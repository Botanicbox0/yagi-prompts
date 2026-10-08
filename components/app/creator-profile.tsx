import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/i18n/config';
import { campaignsHref } from '@/lib/campaigns/links';
import { DISPLAY_NAME_MAX, socialLinkHref, type CreatorProfile } from '@/lib/creators/profile';
import { saveCreatorProfile } from '@/app/(app)/account/actions';

export function CreatorProfileCard({ profile, email, dict, locale, feedback }: {
  profile: CreatorProfile | null; email: string | null; dict: Dictionary; locale: Locale; feedback: unknown;
}) {
  const t = dict.creatorProfile;
  const name = profile?.displayName ?? t.fallbackName;
  const snsHref = socialLinkHref(profile?.snsUrl ?? null);
  return <section data-creator-profile className="mt-8 max-w-detail rounded-3xl border border-hairline bg-white p-6 sm:p-8">
    <div className="flex min-w-0 items-center gap-4">
      <span aria-hidden="true" className="flex size-14 shrink-0 items-center justify-center rounded-full bg-accent text-xl font-semibold text-white">{Array.from(name)[0]?.toUpperCase()}</span>
      <div className="min-w-0"><p data-profile-name className="break-words text-xl font-semibold">{name}</p><p className="mt-1 flex items-center gap-1.5 text-xs text-accent"><span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />{t.signedIn}</p></div>
    </div>
    <form action={saveCreatorProfile} className="mt-7 border-t border-hairline pt-6">
      <label htmlFor="creator-display-name" className="block text-sm font-medium">{t.nameLabel}</label>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        <input id="creator-display-name" name="displayName" autoComplete="nickname" required maxLength={DISPLAY_NAME_MAX} defaultValue={profile?.displayName ?? ''} className="min-h-12 min-w-0 flex-1 rounded-xl border border-hairline bg-white px-4 outline-none focus:border-accent" />
        <button type="submit" className="min-h-12 shrink-0 rounded-full bg-black px-6 text-sm font-medium text-white">{t.saveName}</button>
      </div>
      {feedback === 'saved' && <p role="status" className="mt-3 text-sm text-accent">{t.saved}</p>}
      {feedback === 'err' && <p role="alert" className="mt-3 text-sm text-accent">{t.error}</p>}
    </form>
    <div className="mt-6 border-t border-hairline pt-6"><h2 className="text-sm font-medium">{t.emailLabel}</h2><p className="mt-2 break-all text-sm">{email}</p><p className="mt-2 text-sm opacity-60">{t.emailHint}</p></div>
    <div data-creator-sns className="mt-6 border-t border-hairline pt-6">
      <h2 className="text-sm font-medium">{t.snsTitle}</h2>
      {snsHref ? <><a href={snsHref} target="_blank" rel="noopener noreferrer" className="mt-2 block break-all text-sm text-accent underline underline-offset-4">{snsHref} ↗</a><p className="mt-2 text-sm opacity-60">{t.snsHint}</p></> : <p data-profile-no-sns className="mt-2 text-sm leading-relaxed opacity-60">{t.snsEmpty}</p>}
      <a href={campaignsHref(locale)} className="mt-4 inline-flex min-h-10 items-center text-sm font-medium underline underline-offset-4">{t.campaignCta} ↗</a>
    </div>
  </section>;
}
