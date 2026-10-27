import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { requireAdmin } from '@/lib/auth/viewer';
import { loadDeletionQueue } from '@/lib/account/deletion';
import { AdminShell, OutcomeBanner } from '@/components/admin/chrome';
import { AccountDeletionQueue } from '@/components/admin/account-deletion-queue';

/**
 * `/admin/account-deletions` — the in-app deletion requests (docs/APP-STORE-LAUNCH.md §3.2), worked
 * through docs/RUNBOOK-deletion.md. Before 0064 the queue says the table is missing instead of
 * failing the page.
 */
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;
const one = (params: SearchParams, key: string) => (typeof params[key] === 'string' ? (params[key] as string) : undefined);

export default async function AdminAccountDeletionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [locale, params, sql] = await Promise.all([getLocaleFromHeaders(), searchParams, getSqlRunner(), requireAdmin()]);
  const dict = getDictionary(locale);
  const copy = dict.accountDeletion.admin;
  const queue = sql === null ? null : await loadDeletionQueue(sql).catch(() => null);
  return (
    <AdminShell dict={dict.admin} locale={locale} active="accountDeletions">
      <div className="space-y-6">
        <h1 className="text-3xl font-semibold leading-tight">{copy.title}</h1>
        <p className="max-w-detail text-sm opacity-65">{copy.hint}</p>
        <OutcomeBanner dict={dict.admin} ok={one(params, 'ok')} err={one(params, 'err')} detail={one(params, 'detail')} />
        <AccountDeletionQueue copy={copy} locale={locale} queue={queue} now={new Date()} />
      </div>
    </AdminShell>
  );
}
