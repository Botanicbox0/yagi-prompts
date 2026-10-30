import type { SqlRunner } from "@/lib/db/sql-runner";
import { countManualTossPayments } from "@/lib/billing/toss-service";
import { summarizeRenderJobs, type NotifyStatus, type RenderProvider, type RenderStatus } from "@/lib/renders/repo";

export const NON_RETRYABLE_RENDER_ERRORS = new Set([
  "face_check_refused",
  "safety_refused",
  "content_policy_violation",
  "moderation_blocked",
  "liveness_required",
]);

export function canRetryRenderJob(job: {
  status: string;
  errorCode: string | null;
  inputKey: string | null;
}): boolean {
  if (job.status !== "failed") return false;
  if (!job.inputKey) return false;
  if (job.errorCode && NON_RETRYABLE_RENDER_ERRORS.has(job.errorCode)) {
    return false;
  }
  return true;
}

export function maskEmailForAdmin(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at <= 0) return "***";
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  return `${local.slice(0, 1)}***@${domain}`;
}

export interface AdminRenderBoardJob {
  id: string;
  userId: string;
  userEmailMasked: string | null;
  templateId: string;
  templateSlug: string;
  medium: string;
  engine: string;
  aspect: string;
  resolution: string | null;
  status: RenderStatus;
  provider: RenderProvider | null;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  costUsd: number | null;
  notifyStatus: NotifyStatus;
  notifyAttempts: number;
  inputKey: string | null;
  paymentOrderId: string | null;
  paymentStatus: string | null;
  paymentFailureCode: string | null;
  amountKrw: number | null;
  feedbackStatus: string | null;
  createdAt: string;
  finishedAt: string | null;
  retryable: boolean;
}

export interface AdminManualPaymentRow {
  id: string;
  userId: string | null;
  userEmailMasked: string | null;
  templateSlug: string;
  orderName: string;
  amountKrw: number;
  status: string;
  failureCode: string | null;
  renderId: string | null;
  createdAt: string;
  needsManualAction: boolean;
}

export interface AdminRenderBoardView {
  summary: {
    recent: number;
    failed: number;
    held: number;
    running: number;
    costUsd7d: number;
    paymentsManual: number;
  };
  jobs: AdminRenderBoardJob[];
  payments: AdminManualPaymentRow[];
}

function iso(v: unknown): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

export async function loadAdminRenderBoard(
  sql: SqlRunner,
  filters: { status?: string; tab?: string; userId?: string } = {},
  now: Date = new Date(),
): Promise<AdminRenderBoardView> {
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [baseSummary, paymentsManual, costRes] = await Promise.all([
    summarizeRenderJobs(sql, since7d),
    countManualTossPayments(sql).catch(() => 0),
    sql
      .query<{ cost: number | string | null }>(
        `select coalesce(sum(cost_usd), 0)::numeric as cost from render_jobs where created_at >= $1::timestamptz`,
        [since7d.toISOString()],
      )
      .catch(() => ({ rows: [{ cost: 0 }] })),
  ]);

  const costUsd7d = Number(costRes.rows[0]?.cost ?? 0) || 0;

  const where: string[] = [];
  const params: unknown[] = [];
  if (
    filters.status &&
    ["failed", "running", "queued", "held", "succeeded"].includes(filters.status)
  ) {
    if (filters.status === "running") {
      where.push(`j.status in ('queued', 'running')`);
    } else {
      params.push(filters.status);
      where.push(`j.status = $${params.length}`);
    }
  }
  if (filters.userId && /^[0-9a-f-]{36}$/i.test(filters.userId)) {
    params.push(filters.userId);
    where.push(`j.user_id = $${params.length}`);
  }
  const whereClause = where.length > 0 ? `where ${where.join(" and ")}` : "";

  const jobsRes = await sql.query<{
    id: string;
    user_id: string;
    email: string | null;
    template_id: string;
    template_slug: string;
    medium: string;
    engine: string;
    aspect: string;
    resolution: string | null;
    status: RenderStatus;
    provider: RenderProvider | null;
    attempts: number;
    error_code: string | null;
    error_message: string | null;
    cost_usd: number | string | null;
    notify_status: NotifyStatus;
    notify_attempts: number;
    input_key: string | null;
    payment_order_id: string | null;
    payment_status: string | null;
    payment_failure_code: string | null;
    amount_krw: number | null;
    feedback_status: string | null;
    created_at: Date | string;
    finished_at: Date | string | null;
  }>(
    `select
       j.id, j.user_id, u.email, j.template_id, j.template_slug, j.medium, j.engine, j.aspect, j.resolution,
       j.status, j.provider, j.attempts, j.error_code, j.error_message, j.cost_usd,
       j.notify_status, j.notify_attempts, j.input_key,
       bp.id as payment_order_id, bp.status as payment_status, bp.failure_code as payment_failure_code, bp.amount_krw,
       rf.status as feedback_status,
       j.created_at, j.finished_at
     from render_jobs j
     left join profiles u on u.id = j.user_id
     left join lateral (
       select id, status, failure_code, amount_krw
         from billing_payments
        where render_id = j.id
        order by created_at desc
        limit 1
     ) bp on true
     left join lateral (
       select status
         from render_feedback
        where render_id = j.id
        order by created_at desc
        limit 1
     ) rf on true
     ${whereClause}
     order by
       case when j.status = 'failed' then 0 when j.status = 'held' then 1 when j.status in ('running','queued') then 2 else 3 end,
       j.created_at desc
     limit 80`,
    params,
  );

  const jobs: AdminRenderBoardJob[] = jobsRes.rows.map((r) => {
    const cost =
      r.cost_usd === null
        ? null
        : typeof r.cost_usd === "number"
          ? r.cost_usd
          : Number.parseFloat(String(r.cost_usd));
    const retryable = canRetryRenderJob({
      status: r.status,
      errorCode: r.error_code,
      inputKey: r.input_key,
    });
    return {
      id: r.id,
      userId: r.user_id,
      userEmailMasked: maskEmailForAdmin(r.email),
      templateId: r.template_id,
      templateSlug: r.template_slug,
      medium: r.medium,
      engine: r.engine,
      aspect: r.aspect,
      resolution: r.resolution,
      status: r.status,
      provider: r.provider,
      attempts: Number(r.attempts ?? 0),
      errorCode: r.error_code,
      errorMessage: r.error_message,
      costUsd: Number.isFinite(cost) ? cost : null,
      notifyStatus: r.notify_status,
      notifyAttempts: Number(r.notify_attempts ?? 0),
      inputKey: r.input_key,
      paymentOrderId: r.payment_order_id,
      paymentStatus: r.payment_status,
      paymentFailureCode: r.payment_failure_code,
      amountKrw: r.amount_krw === null ? null : Number(r.amount_krw),
      feedbackStatus: r.feedback_status,
      createdAt: iso(r.created_at) ?? "",
      finishedAt: iso(r.finished_at),
      retryable,
    };
  });

  const paymentsRes = await sql
    .query<{
      id: string;
      user_id: string | null;
      email: string | null;
      template_slug: string;
      order_name: string;
      amount_krw: number;
      status: string;
      failure_code: string | null;
      render_id: string | null;
      created_at: Date | string;
    }>(
      `select
         p.id, p.user_id, u.email, p.template_slug, p.order_name, p.amount_krw,
         p.status, p.failure_code, p.render_id, p.created_at
       from billing_payments p
       left join profiles u on u.id = p.user_id
       where p.payment_type = 'NORMAL'
       order by
         case when (p.status = 'refund_pending' and p.failure_code in ('refund_manual', 'partial_balance'))
                or (p.status = 'paid' and p.failure_code = 'fulfil_manual')
              then 0 else 1 end,
         p.created_at desc
       limit 50`,
    )
    .catch(() => ({ rows: [] }));

  const payments: AdminManualPaymentRow[] = paymentsRes.rows.map((p) => {
    const needsManualAction =
      (p.status === "refund_pending" &&
        (p.failure_code === "refund_manual" ||
          p.failure_code === "partial_balance")) ||
      (p.status === "paid" && p.failure_code === "fulfil_manual");
    return {
      id: p.id,
      userId: p.user_id,
      userEmailMasked: maskEmailForAdmin(p.email),
      templateSlug: p.template_slug,
      orderName: p.order_name,
      amountKrw: Number(p.amount_krw ?? 0),
      status: p.status,
      failureCode: p.failure_code,
      renderId: p.render_id,
      createdAt: iso(p.created_at) ?? "",
      needsManualAction,
    };
  });

  return {
    summary: {
      ...baseSummary,
      costUsd7d,
      paymentsManual,
    },
    jobs,
    payments,
  };
}

export interface AdminUserRow {
  id: string;
  emailMasked: string | null;
  displayName: string | null;
  locale: string;
  isAdmin: boolean;
  isMaker: boolean;
  makerHandle: string | null;
  isInfluencer: boolean;
  maxFollowers: number | null;
  socialSummary: string | null;
  brandCount: number;
  selfieCount: number;
  ordersCount: number;
  rendersCount: number;
  applicationsCount: number;
  createdAt: string;
}

export interface AdminUserView {
  counts: {
    all: number;
    admins: number;
    makers: number;
    influencers: number;
    brands: number;
  };
  users: AdminUserRow[];
}

export async function loadAdminUserView(
  sql: SqlRunner,
  filters: { q?: string; role?: string } = {},
): Promise<AdminUserView> {
  const baseRes = await sql.query<{
    id: string;
    email: string;
    display_name: string | null;
    locale: string;
    is_admin: boolean | null;
    orders_count: number;
    renders_count: number;
    applications_count: number;
    created_at: Date | string;
  }>(
    `select
       p.id, p.email, p.display_name, p.locale, p.is_admin,
       (select count(*)::int from billing_payments b where b.user_id = p.id and b.status = 'paid') as orders_count,
       (select count(*)::int from render_jobs r where r.user_id = p.id) as renders_count,
       (select count(*)::int from campaign_applications ca where ca.creator_id = p.id) as applications_count,
       p.created_at
     from profiles p
     order by p.is_admin desc nulls last, p.created_at desc
     limit 200`,
  );

  // Optional enrichments from newer migrations (0050 identity_selfies, 0051/0060 platform_creators, 0057 social_accounts, 0023 brand_memberships)
  const [selfieRows, makerRows, socialRows, brandRows] = await Promise.all([
    sql
      .query<{ user_id: string; n: number }>(
        `select user_id, count(*)::int as n from identity_selfies where deleted_at is null group by user_id`,
      )
      .then((r) => r.rows)
      .catch(() => [] as Array<{ user_id: string; n: number }>),
    sql
      .query<{ user_id: string; active: boolean; handle: string | null }>(
        `select user_id, active, handle from platform_creators where active = true`,
      )
      .then((r) => r.rows)
      .catch(() =>
        sql
          .query<{ user_id: string; active: boolean }>(
            `select user_id, active from platform_creators where active = true`,
          )
          .then((r) =>
            r.rows.map((row) => ({ ...row, handle: null as string | null })),
          )
          .catch(() => [] as Array<{ user_id: string; active: boolean; handle: string | null }>),
      ),
    sql
      .query<{
        user_id: string;
        platform: string;
        handle: string;
        follower_count: number | null;
        status: string;
      }>(
        `select user_id, platform, handle, follower_count, status from social_accounts`,
      )
      .then((r) => r.rows)
      .catch(
        () =>
          [] as Array<{
            user_id: string;
            platform: string;
            handle: string;
            follower_count: number | null;
            status: string;
          }>,
      ),
    sql
      .query<{ user_id: string; n: number }>(
        `select user_id, count(*)::int as n from brand_memberships group by user_id`,
      )
      .then((r) => r.rows)
      .catch(() => [] as Array<{ user_id: string; n: number }>),
  ]);

  const selfieByUser = new Map(selfieRows.map((r) => [r.user_id, Number(r.n)]));
  const makerByUser = new Map(makerRows.map((r) => [r.user_id, r.handle ?? null]));
  const brandByUser = new Map(brandRows.map((r) => [r.user_id, Number(r.n)]));
  const socialByUser = new Map<
    string,
    Array<{
      platform: string;
      handle: string;
      followerCount: number | null;
      status: string;
    }>
  >();
  for (const s of socialRows) {
    const list = socialByUser.get(s.user_id) ?? [];
    list.push({
      platform: s.platform,
      handle: s.handle,
      followerCount: s.follower_count === null ? null : Number(s.follower_count),
      status: s.status,
    });
    socialByUser.set(s.user_id, list);
  }

  const allUsers: AdminUserRow[] = baseRes.rows.map((u) => {
    const socials = socialByUser.get(u.id) ?? [];
    const verifiedFollowers = socials
      .filter((s) => s.status === "verified" && typeof s.followerCount === "number")
      .map((s) => s.followerCount as number);
    const maxFollowers =
      verifiedFollowers.length > 0 ? Math.max(...verifiedFollowers) : null;
    const isInfluencer = maxFollowers !== null && maxFollowers >= 3000;
    const socialSummary =
      socials.length > 0
        ? socials
            .map(
              (s) =>
                `${s.platform}:@${s.handle}${s.followerCount !== null ? ` (${s.followerCount.toLocaleString()})` : ""} [${s.status}]`,
            )
            .join(", ")
        : null;
    return {
      id: u.id,
      emailMasked: maskEmailForAdmin(u.email),
      displayName: u.display_name,
      locale: u.locale,
      isAdmin: u.is_admin === true,
      isMaker: makerByUser.has(u.id),
      makerHandle: makerByUser.get(u.id) ?? null,
      isInfluencer,
      maxFollowers,
      socialSummary,
      brandCount: brandByUser.get(u.id) ?? 0,
      selfieCount: selfieByUser.get(u.id) ?? 0,
      ordersCount: Number(u.orders_count ?? 0),
      rendersCount: Number(u.renders_count ?? 0),
      applicationsCount: Number(u.applications_count ?? 0),
      createdAt: iso(u.created_at) ?? "",
    };
  });

  const counts = {
    all: allUsers.length,
    admins: allUsers.filter((u) => u.isAdmin).length,
    makers: allUsers.filter((u) => u.isMaker).length,
    influencers: allUsers.filter((u) => u.isInfluencer).length,
    brands: allUsers.filter((u) => u.brandCount > 0).length,
  };

  const q = filters.q?.trim().toLowerCase() ?? "";
  const filtered = allUsers.filter((u) => {
    if (filters.role === "admin" && !u.isAdmin) return false;
    if (filters.role === "maker" && !u.isMaker) return false;
    if (filters.role === "influencer" && !u.isInfluencer) return false;
    if (filters.role === "brand" && u.brandCount === 0) return false;
    if (q) {
      const hay = [
        u.id,
        u.displayName ?? "",
        u.emailMasked ?? "",
        u.makerHandle ?? "",
        u.socialSummary ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return {
    counts,
    users: filtered,
  };
}
