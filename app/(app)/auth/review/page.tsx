import type { Metadata } from 'next';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getRequestLocale } from '@/lib/i18n/server';
import { isLocale } from '@/lib/i18n/config';
import { TwingsMark } from '@/components/brand/twings-mark';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function ReviewLogin({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const locale = isLocale(params.locale) ? params.locale : await getRequestLocale();
  const dict = getDictionary(locale); const copy = dict.auth.review;
  return <main data-review-login className="mx-auto flex min-h-svh max-w-[24rem] flex-col justify-center px-6 py-16">
    <a href={`/${locale}`} aria-label={dict.meta.siteName}><TwingsMark className="h-8" /></a>
    <h1 className="mt-10 text-2xl font-bold">{copy.title}</h1>
    <p className="mt-3 text-sm leading-relaxed opacity-70">{copy.description}</p>
    {params.error && <p role="alert" className="mt-6 text-sm">{copy.invalid}</p>}
    <form method="post" action="/auth/review/login" className="mt-8 flex flex-col gap-5">
      <input type="hidden" name="locale" value={locale} />
      <label className="flex flex-col gap-2 text-sm">{copy.email}<input name="email" type="email" autoComplete="username" maxLength={120} required className="rounded border px-3 py-3" /></label>
      <label className="flex flex-col gap-2 text-sm">{copy.password}<input name="password" type="password" autoComplete="current-password" maxLength={256} required className="rounded border px-3 py-3" /></label>
      <button type="submit" className="rounded-full bg-black px-6 py-3 text-white">{copy.submit}</button>
    </form>
    <a href={`/auth/choose?locale=${locale}`} className="mt-6 text-sm underline">{copy.customerLogin}</a>
  </main>;
}
