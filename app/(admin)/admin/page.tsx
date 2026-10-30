import { getSqlRunner } from "@/lib/db/connect";
import type { SqlRunner } from "@/lib/db/sql-runner";
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
import {
  AdminBadge,
  AdminFold,
  AdminShell,
  BUTTON,
  BUTTON_PRIMARY,
} from "@/components/admin/chrome";
import { ADMIN_PROMPTS_PATH, ADMIN_PROMPT_NEW_PATH } from "@/lib/prompts/links";
import { requireAdmin, type Viewer } from "@/lib/auth/viewer";
import { loadStudioInbox } from "@/lib/brands/workspace/inbox";
import {
  adminNextActions,
  campaignWorkCounts,
  type AdminTaskKey,
} from "@/lib/admin/workflow";
import { loadRiskQueueSummary } from "@/lib/campaigns/risk/admin";
import { countSocialQueue } from "@/lib/influencers/admin";
import { countManualTossPayments } from "@/lib/billing/toss-service";
import { platformReady } from "@/lib/creator-platform/service";
import { creatorApplicationCount } from "@/lib/creator-platform/onboarding";
import { loadFundingAdmin } from "@/lib/campaigns/funding/service";
import { loadStudioUsageQueue } from "@/lib/brands/usage/service";

/**
 * `/admin` — the dashboard (founder, 2026-09-11). The old front door was the playbook list, a
 * screen from a product TWINGS no longer is; it lives at /admin/playbooks now.
 *
 * Priority queue at the top ordered by severity (critical -> high -> normal) and wait time,
 * followed by the four operational overview panels.
 */
export const dynamic = "force-dynamic";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function queryScalarCount(
  sql: SqlRunner,
  queryText: string,
): Promise<number> {
  try {
    const res = await sql.query<{ count: number }>(queryText);
    return Number(res.rows[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

async function queryOldestAt(
  sql: SqlRunner,
  queryText: string,
): Promise<string | null> {
  try {
    const res = await sql.query<{ oldest: string | Date | null }>(queryText);
    const val = res.rows[0]?.oldest;
    if (!val) return null;
    return val instanceof Date ? val.toISOString() : String(val);
  } catch {
    return null;
  }
}

async function loadExtraQueueMetrics(sql: SqlRunner, viewer: Viewer) {
  const [
    subscriptionReviews,
    formatsSubmitted,
    contestEntries,
    fundingView,
    usageRows,
    oldestPaymentsManual,
    oldestRendersFailed,
    oldestPosts,
    oldestApplicants,
    oldestInquiries,
    oldestFeedback,
    oldestTemplates,
  ] = await Promise.all([
    queryScalarCount(
      sql,
      `select count(*)::int as count from creator_subscription_periods where status = 'failed' and failure_code in ('charge_exhausted_review', 'provider_review_required')`,
    ),
    platformReady(sql)
      .then((ready) =>
        ready
          ? queryScalarCount(
              sql,
              `select count(*)::int as count from platform_formats where status = 'submitted'`,
            )
          : 0,
      )
      .catch(() => 0),
    queryScalarCount(
      sql,
      `select count(*)::int as count from contest_entries where status = 'submitted'`,
    ),
    loadFundingAdmin(sql, viewer).catch(() => null),
    loadStudioUsageQueue({ sql }, viewer).catch(() => null),
    queryOldestAt(
      sql,
      `select min(created_at) as oldest from billing_payments where refund_status = 'manual' or (status = 'paid' and render_id is null and refund_status = 'none' and render_recovery_attempts >= 5)`,
    ),
    queryOldestAt(
      sql,
      `select min(created_at) as oldest from render_jobs where status = 'failed' or (status = 'succeeded' and output_held = true)`,
    ),
    queryOldestAt(
      sql,
      `select min(posted_at) as oldest from campaign_applications where status = 'posted'`,
    ),
    queryOldestAt(
      sql,
      `select min(created_at) as oldest from campaign_applications where status = 'applied'`,
    ),
    queryOldestAt(
      sql,
      `select min(created_at) as oldest from brand_inquiries where status = 'new'`,
    ),
    queryOldestAt(
      sql,
      `select min(created_at) as oldest from render_feedback where status = 'new'`,
    ),
    queryOldestAt(
      sql,
      `select min(created_at) as oldest from prompt_items where status = 'pending'`,
    ),
  ]);

  const funding =
    fundingView && fundingView.ready
      ? fundingView.proposals.filter((p) => p.state === "proposed").length +
        fundingView.items
          .flatMap((i) => i.payments)
          .filter((p) => p.status === "review").length
      : 0;
  const brandUsage = (usageRows ?? []).filter((r) =>
    ["requested", "quoted", "paid", "consent_pending"].includes(r.status),
  ).length;

  const oldestAt: Partial<Record<AdminTaskKey, string | null>> = {
    paymentsManual: oldestPaymentsManual,
    rendersFailed: oldestRendersFailed,
    posts: oldestPosts,
    applicants: oldestApplicants,
    inquiries: oldestInquiries,
    feedback: oldestFeedback,
    templates: oldestTemplates,
  };

  return {
    subscriptionReviews,
    formatsSubmitted,
    contestEntries,
    funding,
    brandUsage,
    oldestAt,
  };
}

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
    "font-mono text-code tabular-nums",
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
    extra,
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
          {
            subscriptionReviews: 0,
            formatsSubmitted: 0,
            contestEntries: 0,
            funding: 0,
            brandUsage: 0,
            oldestAt: {},
          },
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
          loadExtraQueueMetrics(sql, viewer),
        ]);
  const counts =
    sql === null
      ? new Map()
      : await loadCampaignCounts(
          sql,
          campaigns.map((row) => row.id),
        );
  const { applicants, posts } = campaignWorkCounts(counts.values());
  const firstPostCampaignId =
    campaigns.find((row) => (counts.get(row.id)?.posted ?? 0) > 0)?.id ?? null;
  const firstApplicantCampaignId =
    campaigns.find((row) => (counts.get(row.id)?.applied ?? 0) > 0)?.id ?? null;
  const recruiting = campaigns.filter(
    (row) => row.status === "recruiting",
  ).length;
  const payouts = payoutQueue.length;
  const pending = prompts.filter((row) => row.status === "pending").length;
  const published = prompts.filter((row) => row.status === "published").length;
  const waiting = inbox?.length ?? 0;
  const riskCount =
    (risk?.ready ? risk.open + risk.dead : 0) +
    (risk?.enabled && risk?.workerUnavailable ? 1 : 0);
  const tasks = adminNextActions(
    {
      paymentsManual,
      rendersFailed: renders.failed + renders.held,
      posts,
      applicants,
      payouts,
      studio: waiting,
      inquiries,
      feedback,
      templates: pending,
      risk: riskCount,
      subscriptionReviews: extra.subscriptionReviews,
      funding: extra.funding,
      brandUsage: extra.brandUsage,
      creatorApplications,
      formatsSubmitted: extra.formatsSubmitted,
      socialAccounts,
      contestEntries: extra.contestEntries,
    },
    {
      now,
      locale,
      firstPostCampaignId,
      firstApplicantCampaignId,
      oldestAt: {
        ...extra.oldestAt,
        studio: inbox?.[0]?.lastMessageAt ?? null,
      },
    },
  );

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
              <li
                key={task.key}
                data-admin-task={task.key}
                data-admin-task-severity={task.severity}
              >
                <div>
                  <h3 className="flex flex-wrap items-center gap-2">
                    <AdminBadge
                      tone={
                        task.severity === "critical"
                          ? "danger"
                          : task.severity === "high"
                            ? "accent"
                            : "neutral"
                      }
                    >
                      {w.severity[task.severity]}
                    </AdminBadge>
                    <span>{w.tasks[task.key].title}</span>
                    <span className="admin-task-count">
                      {interpolate(w.queueCount, {
                        count: task.count.toLocaleString(locale),
                      })}
                    </span>
                    {task.waitLabel && (
                      <AdminBadge tone="warning">{task.waitLabel}</AdminBadge>
                    )}
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
          <h2 className="mt-8 text-lg font-semibold">{w.overview}</h2>
          <div
            data-admin-dashboard
            className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <Card title={a.dashCampaigns} href={ADMIN_CAMPAIGNS_PATH}>
              <Stat
                href={`${ADMIN_CAMPAIGNS_PATH}#status-recruiting`}
                label={a.dashRecruiting}
                count={recruiting}
              />
              <Stat
                href={
                  firstApplicantCampaignId
                    ? `${ADMIN_CAMPAIGNS_PATH}/${firstApplicantCampaignId}#applications`
                    : ADMIN_CAMPAIGNS_PATH
                }
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
            <Card
              title={a.dashRenders}
              href="/admin/renders"
            >
              <Stat
                href="/admin/renders"
                label={a.dashRendersWeek}
                count={renders.recent}
              />
              <Stat
                href="/admin/renders?status=failed"
                label={a.dashRendersFailed}
                count={renders.failed}
                hot
              />
              <Stat
                href="/admin/renders?status=held"
                label={a.dashRendersHeld}
                count={renders.held}
              />
              <Stat
                href="/admin/renders?tab=payments"
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

      <AdminFold id="getting-started" summary={w.startHeading}>
        <section
          className="admin-getting-started mt-0 border-0 p-0"
          aria-label={w.startHeading}
        >
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
      </AdminFold>
    </AdminShell>
  );
}
