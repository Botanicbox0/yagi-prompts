import { getSqlRunner } from "@/lib/db/connect";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/format";
import { requireAdmin } from "@/lib/auth/viewer";
import { AdminShell } from "@/components/admin/chrome";
import { AdminPageHeader, QueueCard } from "@/components/admin/patterns";
import { ADMIN_PROMPTS_PATH, ADMIN_PROMPT_NEW_PATH } from "@/lib/prompts/links";
import {
  ADMIN_QUEUE_GROUPS,
  adminNextActions,
  adminQueueStates,
} from "@/lib/admin/queues";
import { loadAdminQueues } from "@/lib/admin/queue-load";

/**
 * `/admin` — the queue (docs/ADMIN.md §2.2). One question: who is waiting on the studio, most urgent
 * first. "Handle now" lists the queues with work in them; "Every queue" shows all of them by who is
 * waiting, with "not counted" instead of a zero when a source could not be read. Every number is a
 * link to the list it counts, and nothing here approves or pays.
 *
 * It replaced a dashboard that showed the same counts twice and sent the render-failure and
 * payment numbers to the feedback inbox (audit 2026-11-03 §0).
 */
export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  const [locale, sql, viewer] = await Promise.all([
    getLocaleFromHeaders(),
    getSqlRunner(),
    requireAdmin(),
  ]);
  const dict = getDictionary(locale);
  const a = dict.admin;
  const w = dict.adminWorkflow;
  const c = dict.adminConsole;

  const loaded = sql === null ? null : await loadAdminQueues(sql, viewer, new Date());
  const counts = loaded?.counts ?? {};
  const next = adminNextActions(counts);
  const states = adminQueueStates(counts);
  const waiting = next.reduce((sum, queue) => sum + queue.count, 0);
  const risk = loaded?.risk ?? null;
  const waitingText = interpolate(c.home.waiting, { count: waiting.toLocaleString(locale) });

  const riskNotes =
    risk === null
      ? []
      : !risk.ready
        ? [w.riskUnavailable]
        : [
            ...(!risk.enabled ? [w.riskDisabled] : []),
            ...(risk.enabled && risk.workerUnavailable ? [w.riskWorker] : []),
            ...(risk.dead > 0 ? [interpolate(w.riskDead, { count: risk.dead.toLocaleString(locale) })] : []),
          ];

  return (
    <AdminShell dict={a} locale={locale} active="home">
      <AdminPageHeader
        title={c.home.title}
        {...(sql !== null && waiting > 0
          ? { count: waiting.toLocaleString(locale), countLabel: waitingText }
          : {})}
        lede={c.home.lede}
        actions={
          // Discoverability (2026-09-25): registering a template is the most common admin task, so
          // it stays one press away from the first screen.
          <div data-admin-template-actions className="admin-action-row">
            <a href={ADMIN_PROMPT_NEW_PATH} data-admin-new-template className="admin-btn admin-btn-primary">
              + {a.promptsNew}
            </a>
            <a href={ADMIN_PROMPTS_PATH} className="admin-btn">
              {a.dashTemplateManage}
            </a>
            <a href="/admin/campaigns/new" className="admin-btn">
              + {a.newCampaign}
            </a>
          </div>
        }
      />

      <section
        className="admin-quick-search"
        data-admin-quick-search
        aria-label={c.home.quickSearchHeading}
      >
        <form method="get" action="/admin/renders" role="search">
          <input
            type="search"
            name="q"
            placeholder={c.home.quickSearchRenders}
            aria-label={c.home.quickSearchRenders}
          />
          <button type="submit" className="admin-btn">
            {c.nav.renders}
          </button>
        </form>
        <form method="get" action="/admin/users" role="search">
          <input
            type="search"
            name="q"
            placeholder={c.home.quickSearchUsers}
            aria-label={c.home.quickSearchUsers}
          />
          <button type="submit" className="admin-btn">
            {c.nav.users}
          </button>
        </form>
        <form method="get" action={ADMIN_PROMPTS_PATH} role="search">
          <input
            type="search"
            name="q"
            placeholder={c.home.quickSearchPrompts}
            aria-label={c.home.quickSearchPrompts}
          />
          <button type="submit" className="admin-btn">
            {c.nav.prompts}
          </button>
        </form>
        <form method="get" action="/admin/inquiries" role="search">
          <input
            type="search"
            name="q"
            placeholder={c.home.quickSearchInquiries}
            aria-label={c.home.quickSearchInquiries}
          />
          <button type="submit" className="admin-btn">
            {c.nav.inquiries}
          </button>
        </form>
      </section>

      <section className="admin-section" data-admin-next-actions aria-labelledby="admin-next-heading">
        <h2 id="admin-next-heading">{c.home.nextHeading}</h2>
        {sql === null ? (
          <p role="status" className="admin-notice">
            {w.unavailable}
          </p>
        ) : next.length === 0 ? (
          <p className="admin-empty">{c.home.empty}</p>
        ) : (
          <ol className="admin-next-list">
            {next.map((queue, index) => (
              <li key={queue.key} data-admin-task={queue.key}>
                <span className="admin-next-count" aria-hidden="true">
                  {queue.count.toLocaleString(locale)}
                </span>
                <div className="admin-next-text">
                  <h3>{w.tasks[queue.key].title}</h3>
                  <p>
                    {w.tasks[queue.key].hint}{" "}
                    <span className="admin-visually-hidden">
                      {interpolate(c.home.waiting, { count: queue.count.toLocaleString(locale) })}
                    </span>
                  </p>
                </div>
                <a
                  href={queue.href}
                  className={index === 0 ? "admin-btn admin-btn-primary" : "admin-btn"}
                >
                  {w.tasks[queue.key].action}
                </a>
              </li>
            ))}
          </ol>
        )}
      </section>

      {sql !== null && (
        <section className="admin-section" data-admin-queue-board aria-labelledby="admin-board-heading">
          <h2 id="admin-board-heading">{c.home.boardHeading}</h2>
          <div className="admin-board-grid">
            {ADMIN_QUEUE_GROUPS.map((group) => (
              <QueueCard
                key={group}
                title={c.queueGroups[group]}
                locale={locale}
                labels={{ clear: c.home.clear, unknown: c.home.unknown, unknownHint: c.home.unknownHint }}
                rows={states
                  .filter((state) => state.group === group)
                  .map((state) => ({
                    key: state.key,
                    label: c.queues[state.key],
                    href: state.href,
                    count: state.count,
                  }))}
              />
            ))}
          </div>
        </section>
      )}

      {riskNotes.length > 0 && (
        <section className="admin-section" data-admin-risk-status aria-labelledby="admin-system-heading">
          <h2 id="admin-system-heading">{c.home.systemHeading}</h2>
          <ul className="admin-system-list">
            {riskNotes.map((note) => (
              <li key={note}>
                <a href="/admin/risk">{note}</a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="admin-help">
        <summary>{w.startHeading}</summary>
        <p className="admin-help-lede">{w.startHint}</p>
        <ol>
          {(
            [
              ["brand", "/admin/brand-workspace"],
              ["campaign", "/admin/campaigns/new"],
              ["participants", "/admin/campaigns"],
            ] as const
          ).map(([key, href]) => (
            <li key={key}>
              <div>
                <h3>{w.start[key].title}</h3>
                <p>{w.start[key].hint}</p>
              </div>
              <a href={href} className="admin-btn">
                {w.start[key].action}
              </a>
            </li>
          ))}
        </ol>
      </details>
    </AdminShell>
  );
}
