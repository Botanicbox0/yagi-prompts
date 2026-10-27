import { getSqlRunner } from "@/lib/db/connect";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/format";
import {
  loadAllCampaigns,
  loadCampaignCounts,
  loadPayoutQueue,
} from "@/lib/campaigns/repo";
import {
  ADMIN_CAMPAIGNS_PATH,
  ADMIN_INQUIRIES_PATH,
} from "@/lib/campaigns/links";
import { loadAllPrompts } from "@/lib/prompts/repo";
import { summarizeRenderJobs } from "@/lib/renders/repo";
import { countBrandInquiries } from "@/lib/brands/repo";
import { countRenderFeedback } from "@/lib/renders/feedback";
import { AdminShell, BUTTON, BUTTON_PRIMARY } from "@/components/admin/chrome";
import { ADMIN_PROMPTS_PATH, ADMIN_PROMPT_NEW_PATH } from "@/lib/prompts/links";
import { requireAdmin } from "@/lib/auth/viewer";
import { loadStudioInbox } from "@/lib/brands/workspace/inbox";
import { adminNextActions, campaignWorkCounts } from "@/lib/admin/workflow";
import { loadRiskQueueSummary } from "@/lib/campaigns/risk/admin";
import { countSocialQueue } from "@/lib/influencers/admin";
import { countManualTossPayments } from "@/lib/billing/toss-service";
import { platformReady } from "@/lib/creator-platform/service";
import { creatorApplicationCount } from "@/lib/creator-platform/onboarding";
import { countDeletionQueue } from "@/lib/account/deletion";

/**
 * `/admin` — the dashboard (founder, 2026-09-11). The old front door was the playbook list, a
 * screen from a product TWINGS no longer is; it lives at /admin/playbooks now.
 *
 * Four panels, one question each: is anything waiting on the campaigns board, on the template
 * queue, in the render pipeline, in the brand inbox. Every number is a link to the list it counts.
 */
export const dynamic = "force-dynamic";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function Stat({
  href,
  label,
  count,
  hot,
}: {
  href: string | null;
  label: string;
  count: number;
  hot?: boolean;
}) {
  const text = interpolate(label, { count: count.toLocaleString() });
  const className = [
    "font-mono text-code",
    hot && count > 0 ? "text-accent" : "opacity-80",
  ].join(" ");
  return (
    <li data-admin-stat={count}>
      {href ? (
        <a
          href={href}
          className={`${className} underline-offset-4 hover:underline`}
        >
          {text}
        </a>
      ) : (
        <span className={className}>{text}</span>
      )}
    </li>
  );
}

function Card({
  title,
  href,
  children,
}: {
  title: string;
  href: string | null;
  children: React.ReactNode;
}) {
  return (
    <section data-admin-card className="border border-hairline">
      <header className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <h2 className="font-label text-eyebrow uppercase">{title}</h2>
        {href && (
          <a
            href={href}
            aria-label={title}
            className="text-accent font-label text-[0.62rem] tracking-[0.1em] uppercase"
          >
            →
          </a>
        )}
      </header>
      <ul className="flex flex-col gap-2 p-4">{children}</ul>
    </section>
  );
}

export default async function AdminHomePage() {
  const [locale, sql, viewer] = await Promise.all([
    getLocaleFromHeaders(),
    getSqlRunner(),
    requireAdmin(),
  ]);
  const dict = getDictionary(locale);
  const a = dict.admin;
  const now = new Date();

  const w = dict.adminWorkflow;
  const [
    campaigns,
    payoutQueue,
    prompts,
    renders,
    inquiries,
    feedback,
    inbox,
    risk,
    paymentsManual,
    creatorApplications,
    socialAccounts,
    accountDeletions,
  ] =
    sql === null
      ? ([
          [],
          [],
          [],
          { recent: 0, failed: 0, held: 0, running: 0 },
          0,
          0,
          [],
          null,
          0,
          0,
          0,
          0,
        ] as const)
      : await Promise.all([
          loadAllCampaigns(sql),
          loadPayoutQueue(sql, now),
          loadAllPrompts(sql),
          summarizeRenderJobs(sql, new Date(now.getTime() - WEEK_MS)),
          countBrandInquiries(sql, "new"),
          countRenderFeedback(sql, "new"),
          loadStudioInbox({ sql }, viewer),
          loadRiskQueueSummary(sql, viewer, now),
          // docs/PLATFORM-2.0.md §2.2-4: refunds and renders automation handed to an operator.
          countManualTossPayments(sql),
          // 0 when 0046/0051 are absent; the queue then stays out of the list instead of failing the page.
          platformReady(sql)
            .then((ready) => (ready ? creatorApplicationCount(sql) : 0))
            .catch(() => 0),
          // docs/PLATFORM-2.0.md §17.1 — 0 before 0057; the SNS queue line then stays out.
          countSocialQueue(sql).catch(() => 0),
          // docs/APP-STORE-LAUNCH.md §3.2 — 0 before 0064; the deletion line then stays out.
          countDeletionQueue(sql).catch(() => 0),
        ]);
  const counts =
    sql === null
      ? new Map()
      : await loadCampaignCounts(
          sql,
          campaigns.map((row) => row.id),
        );
  const { applicants, posts } = campaignWorkCounts(counts.values());
  const recruiting = campaigns.filter(
    (row) => row.status === "recruiting",
  ).length;
  const payouts = payoutQueue.length;
  const pending = prompts.filter((row) => row.status === "pending").length;
  const published = prompts.filter((row) => row.status === "published").length;
  const waiting = inbox?.length ?? 0;
  const tasks = adminNextActions({
    posts,
    applicants,
    payouts,
    studio: waiting,
    inquiries,
    feedback,
    templates: pending,
    risk: risk?.ready ? risk.open : 0,
    creatorApplications,
    socialAccounts,
    accountDeletions,
  });

  return (
    <AdminShell dict={a} locale={locale} active="home">
      <h1 className="text-3xl font-semibold leading-tight">{a.dashHeading}</h1>
      <p className="mt-3 max-w-detail text-body opacity-60">{a.dashLede}</p>

      <section
        data-admin-next-actions
        className="admin-next-actions"
        aria-labelledby="admin-next-heading"
      >
        <h2 id="admin-next-heading">{w.nextHeading}</h2>
        <p className="admin-section-hint">{w.nextHint}</p>
        {sql === null ? (
          <p role="status" className="admin-empty-state">
            {w.unavailable}
          </p>
        ) : tasks.length === 0 ? (
          <p className="admin-empty-state">{w.empty}</p>
        ) : (
          <ul className="admin-task-list">
            {tasks.map((task, index) => (
              <li key={task.key} data-admin-task={task.key}>
                <div>
                  <h3>
                    {w.tasks[task.key].title}{" "}
                    <span className="admin-task-count">
                      {interpolate(w.queueCount, {
                        count: task.count.toLocaleString(locale),
                      })}
                    </span>
                  </h3>
                  <p>{w.tasks[task.key].hint}</p>
                </div>
                <a
                  href={task.href}
                  className={index === 0 ? BUTTON_PRIMARY : BUTTON}
                >
                  {w.tasks[task.key].action}
                </a>
              </li>
            ))}
          </ul>
        )}
        {risk && (
          <div className="admin-section-hint" data-admin-risk-status>
            {!risk.ready ? (
              <p>
                <a href="/admin/risk" className="underline">
                  {w.riskUnavailable}
                </a>
              </p>
            ) : (
              <>
                {!risk.enabled && (
                  <p>
                    <a href="/admin/risk" className="underline">
                      {w.riskDisabled}
                    </a>
                  </p>
                )}
                {risk.enabled && risk.workerUnavailable && (
                  <p>
                    <a href="/admin/risk" className="underline">
                      {w.riskWorker}
                    </a>
                  </p>
                )}
                {risk.dead > 0 && (
                  <p>
                    <a href="/admin/risk" className="underline">
                      {interpolate(w.riskDead, {
                        count: risk.dead.toLocaleString(locale),
                      })}
                    </a>
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </section>

      <section
        className="admin-getting-started"
        aria-labelledby="admin-start-heading"
      >
        <h2 id="admin-start-heading">{w.startHeading}</h2>
        <p className="admin-section-hint">{w.startHint}</p>
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
              <a href={href} className={BUTTON}>
                {w.start[key].action}
              </a>
            </li>
          ))}
        </ol>
      </section>

      {/* Discoverability (2026-09-25): registering a template was only reachable through the small
          arrow on the templates card. It is the most common admin task, so it gets its own row. */}
      <div
        data-admin-template-actions
        className="mt-6 flex flex-wrap items-center gap-3 border border-hairline px-4 py-3"
      >
        <p className="min-w-48 flex-1 font-mono text-[0.75rem] opacity-70">
          {a.dashTemplateAction}
        </p>
        <a
          href={ADMIN_PROMPT_NEW_PATH}
          data-admin-new-template
          className={BUTTON_PRIMARY}
        >
          + {a.promptsNew}
        </a>
        <a href={ADMIN_PROMPTS_PATH} className={BUTTON}>
          {a.dashTemplateManage}
        </a>
      </div>

      {sql !== null && (
        <>
          <h2 className="mt-10 text-lg font-semibold">{w.overview}</h2>
          <div
            data-admin-dashboard
            className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <Card title={a.dashCampaigns} href={ADMIN_CAMPAIGNS_PATH}>
              <Stat
                href={`${ADMIN_CAMPAIGNS_PATH}#status-recruiting`}
                label={a.dashRecruiting}
                count={recruiting}
              />
              <Stat
                href={ADMIN_CAMPAIGNS_PATH}
                label={a.dashApplicants}
                count={applicants}
                hot
              />
              <Stat
                href={
                  payouts > 0
                    ? `${ADMIN_CAMPAIGNS_PATH}#payout-queue`
                    : ADMIN_CAMPAIGNS_PATH
                }
                label={a.dashPayouts}
                count={payouts}
                hot
              />
            </Card>
            <Card title={a.dashTemplates} href="/admin/prompts">
              <Stat
                href="/admin/prompts?tab=pending"
                label={a.dashPending}
                count={pending}
                hot
              />
              <Stat
                href="/admin/prompts?tab=published"
                label={a.dashPublished}
                count={published}
              />
            </Card>
            <Card title={a.dashRenders} href={`${ADMIN_INQUIRIES_PATH}?kind=feedback`}>
              <Stat
                href={`${ADMIN_INQUIRIES_PATH}?kind=feedback`}
                label={a.dashRendersWeek}
                count={renders.recent}
              />
              <Stat
                href={`${ADMIN_INQUIRIES_PATH}?kind=feedback&status=new`}
                label={a.dashRendersFailed}
                count={renders.failed}
                hot
              />
              <Stat
                href="/admin/community#claims"
                label={a.dashRendersHeld}
                count={renders.held}
              />
              <Stat
                href={`${ADMIN_INQUIRIES_PATH}?kind=feedback&status=new`}
                label={a.dashPaymentsManual}
                count={paymentsManual}
                hot
              />
              <Stat
                href={`${ADMIN_INQUIRIES_PATH}?kind=feedback&status=new`}
                label={a.dashFeedbackNew}
                count={feedback}
                hot
              />
            </Card>
            <Card title={a.dashInquiries} href={ADMIN_INQUIRIES_PATH}>
              <Stat
                href={`${ADMIN_INQUIRIES_PATH}?kind=brand&status=new`}
                label={a.dashInquiriesNew}
                count={inquiries}
                hot
              />
              <Stat
                href="/admin/brand-workspace#studio-inbox"
                label={a.dashInbox}
                count={waiting}
                hot
              />
            </Card>
          </div>
        </>
      )}
    </AdminShell>
  );
}
