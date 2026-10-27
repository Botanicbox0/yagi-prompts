import type { Dictionary } from '@/messages/en';
import { interpolate } from '@/lib/i18n/format';
import type { SocialQueueItem } from '@/lib/influencers/admin';
import { OpForm, INPUT, BUTTON, BUTTON_PRIMARY } from '@/components/admin/chrome';

type Copy = Dictionary['social'];

/**
 * `/admin/community#social` — the "SNS 확인" queue (docs/PLATFORM-2.0.md §17.1). Screenshot, link,
 * what the member typed and what the local model read, side by side; the count field starts EMPTY
 * so the number that counts is always the one a person typed.
 */
export function SocialQueue({ copy, locale, queue, worker }: {
  copy: Copy;
  locale: string;
  queue: { waiting: SocialQueueItem[]; decided: SocialQueueItem[] } | null;
  worker: { modelId: string; lastSeenAt: string } | null;
}) {
  const a = copy.admin;
  const tag = locale === 'ko' ? 'ko-KR' : 'en-US';
  const when = (iso: string) => new Date(iso).toLocaleString(tag, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' });
  const n = (value: number | null) => (value === null ? a.none : value.toLocaleString(tag));
  const note = (raw: string | null) => {
    if (!raw) return null;
    if (raw === 'handle_match' || raw === 'handle_unread') return a.notes[raw];
    if (raw.startsWith('handle_mismatch:')) return interpolate(a.notes.handle_mismatch, { handle: raw.slice('handle_mismatch:'.length) });
    if (raw.startsWith('failed:')) return interpolate(a.notes.failed, { code: raw.slice('failed:'.length) });
    return raw;
  };
  const card = (item: SocialQueueItem, open: boolean) => (
    <article key={item.id} data-social-review={item.id} data-status={item.status} className="grid gap-4 rounded-xl border border-hairline p-4 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
      <div>
        {item.evidenceUrl ? (
          <a href={item.evidenceUrl} target="_blank" rel="noopener noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element -- admin-only private image route */}
            <img src={item.evidenceUrl} alt={`${a.evidence} · @${item.handle}`} loading="lazy" className="max-h-80 w-full rounded-lg border border-hairline object-contain" />
          </a>
        ) : <p className="text-sm opacity-60">{a.noEvidence}</p>}
      </div>
      <div className="min-w-0 space-y-3 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="break-all font-semibold">{copy.platforms[item.platform]} · <a href={item.profileUrl} target="_blank" rel="noopener noreferrer nofollow" className="underline">@{item.handle} ↗</a></h3>
          <span className="text-xs opacity-60">{item.recheck ? a.recheck : copy.state[item.status === 'submitted' ? 'checking' : item.status]} · {when(item.submittedAt)}</span>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="opacity-60">{a.claimed}</dt><dd>{n(item.claimedCount)}</dd>
          <dt className="opacity-60">{a.ai}</dt>
          <dd data-social-ai={item.aiState}>
            {item.aiState === 'done' && item.aiModel ? <>{n(item.aiCount)} · {interpolate(a.confidence, { value: (item.aiConfidence ?? 0).toFixed(2) })} · {item.aiModel}</> : item.aiState === 'failed' ? a.aiFailed : item.aiState === 'done' ? a.none : a.aiWaiting}
            {note(item.aiNote) ? <span className="block text-xs opacity-70">{note(item.aiNote)}</span> : null}
          </dd>
          {item.followerCount !== null && item.status !== 'submitted' ? <><dt className="opacity-60">{a.followerCount}</dt><dd>{n(item.followerCount)}</dd></> : null}
          {item.note ? <><dt className="opacity-60">{a.reason}</dt><dd className="whitespace-pre-wrap break-words">{item.note}</dd></> : null}
          <dt className="opacity-60">{a.account}</dt><dd className="break-all text-xs opacity-60">{item.userId}</dd>
        </dl>
        {open ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <OpForm op="social.verify" back="/admin/community#social" className="space-y-2 rounded-lg border border-hairline p-3">
              <input type="hidden" name="id" value={item.id} />
              <label className="block text-sm">{a.followerCount}
                <input name="followerCount" required inputMode="numeric" pattern="[0-9,\s]+" maxLength={14} autoComplete="off" className={`${INPUT} mt-1 min-h-10`} />
                <span className="mt-1 block text-xs opacity-60">{a.followerHint}</span>
              </label>
              <button className={`${BUTTON_PRIMARY} min-h-10`}>{a.verify}</button>
            </OpForm>
            <OpForm op="social.reject" back="/admin/community#social" className="space-y-2 rounded-lg border border-hairline p-3">
              <input type="hidden" name="id" value={item.id} />
              <label className="block text-sm">{a.reason}
                <textarea name="reason" required maxLength={500} rows={2} className={`${INPUT} mt-1`} />
              </label>
              <button className={`${BUTTON} min-h-10`}>{a.reject}</button>
            </OpForm>
          </div>
        ) : null}
      </div>
    </article>
  );
  return (
    <section id="social" data-social-queue className="scroll-mt-24 space-y-4">
      <h2 className="text-lg font-semibold">{a.title}</h2>
      <p className="text-sm opacity-65">{a.hint}</p>
      <p data-social-worker className="text-xs opacity-65">{worker ? interpolate(a.worker, { model: worker.modelId, when: when(worker.lastSeenAt) }) : a.workerNone}</p>
      {queue === null ? <p className="text-sm opacity-65">{a.unavailable}</p> : (
        <>
          {queue.waiting.length ? queue.waiting.map(item => card(item, true)) : <p className="text-sm opacity-65">{a.empty}</p>}
          {queue.decided.length ? (
            <details className="space-y-3 rounded-xl border border-hairline p-4">
              <summary className="cursor-pointer py-2 font-medium">{a.decided}</summary>
              <div className="mt-3 space-y-3">{queue.decided.map(item => card(item, false))}</div>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}
