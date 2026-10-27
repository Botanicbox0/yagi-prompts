import type { Dictionary } from '@/messages/en';
import type { DeletionQueueItem } from '@/lib/account/deletion';
import { ADMIN_NAV_PATHS } from '@/lib/admin/workflow';
import { OpForm, INPUT, BUTTON, BUTTON_PRIMARY } from '@/components/admin/chrome';

type Copy = Dictionary['accountDeletion']['admin'];
const BACK = ADMIN_NAV_PATHS.accountDeletions;

/**
 * `/admin/account-deletions` — the deletion queue (docs/APP-STORE-LAUNCH.md §3.2). Open requests by
 * deadline, each with the address to confirm to, whether the account still exists and the three
 * marks. The work itself is docs/RUNBOOK-deletion.md; this page only records where it stands.
 */
export function AccountDeletionQueue({ copy, locale, queue, now }: {
  copy: Copy;
  locale: string;
  queue: { open: DeletionQueueItem[]; closed: DeletionQueueItem[] } | null;
  now: Date;
}) {
  const tag = locale === 'ko' ? 'ko-KR' : 'en-US';
  const when = (iso: string) => new Date(iso).toLocaleString(tag, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' });
  const card = (item: DeletionQueueItem, open: boolean) => {
    const overdue = open && new Date(item.dueAt).getTime() < now.getTime();
    return (
      <article key={item.id} data-deletion-review={item.id} data-status={item.status} data-overdue={overdue ? 'true' : undefined} className={`space-y-3 rounded-xl border p-4 text-sm ${overdue ? 'border-accent' : 'border-hairline'}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="break-all font-semibold">{item.email ?? copy.noEmail}</h3>
          <span className="text-xs opacity-70">
            {copy.statuses[item.status]}
            {overdue ? <strong className="text-accent"> · {copy.overdue}</strong> : null}
          </span>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="opacity-60">{copy.requestedAt}</dt><dd>{when(item.requestedAt)}</dd>
          <dt className="opacity-60">{copy.dueAt}</dt><dd>{when(item.dueAt)}</dd>
          <dt className="opacity-60">{copy.account}</dt>
          <dd className="break-all text-xs">{item.accountExists ? <span className="opacity-60">{item.userId}</span> : copy.accountGone}</dd>
          {item.note ? <><dt className="opacity-60">{copy.note}</dt><dd className="whitespace-pre-wrap break-words">{item.note}</dd></> : null}
        </dl>
        {item.staff ? <p role="note" data-deletion-staff className="text-accent">{copy.staff}</p> : null}
        {open ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {item.status === 'requested' ? (
              <OpForm op="account.deletion.start" back={BACK} className="space-y-2 rounded-lg border border-hairline p-3">
                <input type="hidden" name="id" value={item.id} />
                <label className="block text-sm">{copy.note}
                  <textarea name="note" maxLength={500} rows={2} className={`${INPUT} mt-1`} />
                </label>
                <button className={`${BUTTON_PRIMARY} min-h-10`}>{copy.start}</button>
              </OpForm>
            ) : null}
            <OpForm op="account.deletion.complete" back={BACK} className="space-y-2 rounded-lg border border-hairline p-3">
              <input type="hidden" name="id" value={item.id} />
              <p className="text-xs opacity-65">{copy.completeHint}</p>
              <button className={`${item.status === 'processing' ? BUTTON_PRIMARY : BUTTON} min-h-10`} disabled={item.accountExists}>{copy.complete}</button>
            </OpForm>
            <OpForm op="account.deletion.cancel" back={BACK} className="space-y-2 rounded-lg border border-hairline p-3">
              <input type="hidden" name="id" value={item.id} />
              <label className="block text-sm">{copy.cancelReason}
                <textarea name="note" required maxLength={500} rows={2} className={`${INPUT} mt-1`} />
              </label>
              <button className={`${BUTTON} min-h-10`}>{copy.cancel}</button>
            </OpForm>
          </div>
        ) : null}
      </article>
    );
  };
  return (
    <section id="deletions" data-account-deletion-queue className="scroll-mt-24 space-y-4">
      {queue === null ? <p role="status" className="text-sm opacity-65">{copy.unavailable}</p> : (
        <>
          {queue.open.length ? queue.open.map((item) => card(item, true)) : <p className="text-sm opacity-65">{copy.empty}</p>}
          {queue.closed.length ? (
            <details className="space-y-3 rounded-xl border border-hairline p-4">
              <summary className="cursor-pointer py-2 font-medium">{copy.closed}</summary>
              <div className="mt-3 space-y-3">{queue.closed.map((item) => card(item, false))}</div>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}
