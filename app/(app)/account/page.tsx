import { getViewer } from '@/lib/auth/viewer';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { LocaleToggle } from '@/components/locale-toggle';

/**
 * Account — M0 skeleton. Stripe portal link lands in M3; notification toggles in M5 and NOT
 * before (§3.5: zero notification UI before M5).
 */
export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const locale = await getLocaleFromHeaders();
  const dict = getDictionary(locale);

  let tier = 'anon';
  let email: string | null = null;
  try {
    const viewer = await getViewer();
    tier = viewer.tier;
    email = viewer.email;
  } catch {
    // Placeholder env (no Supabase project yet, PLAN §11) — render the shell, not a 500.
  }

  return (
    <main className="min-h-screen bg-white px-gutter py-24 text-black">
      <div className="mb-10 flex items-center justify-between">
        <p className="font-label text-eyebrow uppercase text-blue">{dict.nav.account}</p>
        <LocaleToggle current={locale} rest="/account" prefixed={false} />
      </div>
      <h1 className="font-display text-title uppercase">{dict.nav.account}</h1>
      <dl className="mt-8 text-body">
        <dt className="font-label text-eyebrow uppercase opacity-60">{dict.auth.signedInAs}</dt>
        <dd>{email ?? '—'}</dd>
        <dt className="mt-4 font-label text-eyebrow uppercase opacity-60">plan</dt>
        <dd>{tier}</dd>
      </dl>
    </main>
  );
}
