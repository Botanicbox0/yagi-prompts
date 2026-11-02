import { getDictionary } from '@/lib/i18n/dictionaries';
import { isLocale } from '@/lib/i18n/config';
import { TossReturn } from './return';
export const dynamic = 'force-dynamic';
export default async function ReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string }>;
}) {
  const { locale } = await searchParams;
  return (
    <main id="main" className="mx-auto min-h-screen max-w-2xl px-6 py-28">
      <TossReturn
        copy={getDictionary(isLocale(locale) ? locale : 'ko').billing.toss}
      />
    </main>
  );
}
