import type { SqlRunner } from "@/lib/db/sql-runner";
import type { RenderStatus } from "@/lib/renders/repo";
import { tossKeyKind } from "@/lib/flags";

/**
 * The render board and the payment check (docs/ADMIN.md §7.1–7.2). READ-ONLY: every statement is a
 * select. Retrying a render or re-sending its email changes the render's life and can cross the
 * Toss refund of the same order, so neither exists here until the founder and the Director open
 * them (docs/ADMIN.md §8).
 *
 * What the board never reads: e-mail, photos, result and input storage keys, share tokens. A person
 * appears as the first eight characters of the account id.
 */

export const RENDER_STATUSES: readonly RenderStatus[] = ["failed", "held", "queued", "running", "succeeded"];
export const RENDER_MEDIA = ["video", "image"] as const;
export type RenderMediumFilter = (typeof RENDER_MEDIA)[number];
export const RENDER_PAGE_SIZE = 50;

/** Who the render was for, read from the table that holds its reason to exist. */
export type RenderKind = "payment" | "brand" | "campaign" | "reward" | "other";

/** Tables a render can belong to, newest feature last. Each is checked before it is joined. */
const KIND_TABLES: ReadonlyArray<{ kind: Exclude<RenderKind, "other">; table: string }> = [
  { kind: "payment", table: "billing_payments" },
  { kind: "brand", table: "brand_production_reservations" },
  { kind: "campaign", table: "campaign_render_jobs" },
  { kind: "reward", table: "platform_redemptions" },
];

export interface RenderBoardFilter {
  status: RenderStatus | null;
  medium: RenderMediumFilter | null;
  /** Template slug fragment, or the start of a render id. */
  query: string;
  page: number;
}

export interface RenderBoardRow {
  id: string;
  userId: string;
  templateId: string;
  templateSlug: string;
  templateTitle: string | null;
  templateTitleKo: string | null;
  medium: string;
  engine: string;
  aspect: string;
  resolution: string | null;
  status: RenderStatus;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  costUsd: number | null;
  notifyStatus: string;
  paymentStatus: string | null;
  paymentFailure: string | null;
  feedbackStatus: string | null;
  kind: RenderKind;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RenderBoardSummary {
  recent: number;
  failed: number;
  costUsd: number;
  held: number;
  queued: number;
  running: number;
}

export interface RenderBoard {
  rows: RenderBoardRow[];
  /** Rows matching the filter, across every page. */
  total: number;
  /** Every render by status, for the filter pills. */
  byStatus: Record<RenderStatus, number>;
  summary: RenderBoardSummary;
}

export type PaymentEnvironment = "live" | "test" | "fake";
export type PaymentEnvironmentBucket = "live" | "test";

export interface RenderPayment {
  id: string;
  environment: PaymentEnvironment;
  status: string;
  failureCode: string | null;
  amountKrw: number;
  approvedAt: string | null;
  refundedAt: string | null;
  refundAttempts: number | null;
  fulfilAttempts: number | null;
}

export interface RenderDetail extends RenderBoardRow {
  provider: string | null;
  providerTaskId: string | null;
  costSource: string | null;
  resultBytes: number | null;
  notifyChannel: string;
  notifyAttempts: number;
  notifiedAt: string | null;
  claimedAt: string | null;
  finishingAt: string | null;
  updatedAt: string;
  payment: RenderPayment | null;
  feedbackReason: string | null;
  feedbackAt: string | null;
}

export interface ManualPayment {
  id: string;
  userId: string | null;
  environment: PaymentEnvironment;
  orderName: string;
  templateSlug: string | null;
  amountKrw: number;
  status: string;
  failureCode: "refund_manual" | "partial_balance" | "fulfil_manual";
  refundAttempts: number | null;
  fulfilAttempts: number | null;
  renderId: string | null;
  renderStatus: string | null;
  createdAt: string;
  approvedAt: string | null;
  updatedAt: string;
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

async function presentTables(sql: SqlRunner, names: readonly string[]): Promise<Set<string>> {
  const { rows } = await sql.query<{ name: string }>(
    "select name from unnest($1::text[]) as name where to_regclass('public.' || name) is not null",
    [names],
  );
  return new Set(rows.map((row) => row.name));
}

/** `case … end` naming the table a render belongs to, built from the tables that exist. */
async function kindExpression(sql: SqlRunner): Promise<string> {
  const present = await presentTables(sql, KIND_TABLES.map((entry) => entry.table));
  const arms = KIND_TABLES.filter((entry) => present.has(entry.table)).map(
    (entry) => `when exists (select 1 from ${entry.table} k where k.render_id = j.id) then '${entry.kind}'`,
  );
  return arms.length === 0 ? "'other'" : `case ${arms.join(" ")} else 'other' end`;
}

const ROW_COLUMNS = `
  j.id, j.user_id, j.template_id, j.template_slug, j.medium, j.engine, j.aspect, j.resolution, j.status,
  j.attempts, j.error_code, j.error_message, j.cost_usd, j.notify_status, j.created_at, j.started_at,
  j.finished_at, pi.title as template_title, pi.title_ko as template_title_ko,
  p.status as payment_status, p.failure_code as payment_failure, fb.status as feedback_status`;

const ROW_JOINS = `
  from render_jobs j
  left join prompt_items pi on pi.id = j.template_id
  left join billing_payments p on p.render_id = j.id
  left join render_feedback fb on fb.render_id = j.id`;

type RawRow = Record<string, unknown>;

function toRow(raw: RawRow): RenderBoardRow {
  return {
    id: String(raw.id),
    userId: String(raw.user_id),
    templateId: String(raw.template_id),
    templateSlug: String(raw.template_slug),
    templateTitle: (raw.template_title as string | null) ?? null,
    templateTitleKo: (raw.template_title_ko as string | null) ?? null,
    medium: String(raw.medium),
    engine: String(raw.engine),
    aspect: String(raw.aspect),
    resolution: (raw.resolution as string | null) ?? null,
    status: raw.status as RenderStatus,
    attempts: Number(raw.attempts ?? 0),
    errorCode: (raw.error_code as string | null) ?? null,
    errorMessage: (raw.error_message as string | null) ?? null,
    costUsd: num(raw.cost_usd),
    notifyStatus: String(raw.notify_status),
    paymentStatus: (raw.payment_status as string | null) ?? null,
    paymentFailure: (raw.payment_failure as string | null) ?? null,
    feedbackStatus: (raw.feedback_status as string | null) ?? null,
    kind: (raw.kind as RenderKind | null) ?? "other",
    createdAt: iso(raw.created_at) ?? "",
    startedAt: iso(raw.started_at),
    finishedAt: iso(raw.finished_at),
  };
}

/** The list filter: status, medium, and a slug fragment or the start of an id. */
function where(filter: RenderBoardFilter): { clause: string; params: unknown[] } {
  const params: unknown[] = [];
  const parts: string[] = [];
  if (filter.status) {
    params.push(filter.status);
    parts.push(`j.status = $${params.length}`);
  }
  if (filter.medium) {
    params.push(filter.medium);
    parts.push(`j.medium = $${params.length}`);
  }
  const query = filter.query.trim().toLowerCase();
  if (query !== "") {
    params.push(`%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    params.push(`${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    parts.push(`(lower(j.template_slug) like $${params.length - 1} or j.id::text like $${params.length})`);
  }
  return { clause: parts.length ? `where ${parts.join(" and ")}` : "", params };
}

export async function loadRenderBoard(sql: SqlRunner, filter: RenderBoardFilter, now: Date = new Date()): Promise<RenderBoard> {
  const kind = await kindExpression(sql);
  const { clause, params } = where(filter);
  const page = Math.max(1, Math.floor(filter.page));
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [list, total, statuses, summary] = await Promise.all([
    sql.query<RawRow>(
      `select ${ROW_COLUMNS}, ${kind} as kind ${ROW_JOINS} ${clause}
        order by j.created_at desc, j.id desc
        limit $${params.length + 1}::int offset $${params.length + 2}::int`,
      [...params, RENDER_PAGE_SIZE, (page - 1) * RENDER_PAGE_SIZE],
    ),
    sql.query<{ n: number | string }>(`select count(*)::int as n from render_jobs j ${clause}`, params),
    sql.query<{ status: RenderStatus; n: number | string }>(
      "select status, count(*)::int as n from render_jobs group by status",
    ),
    sql.query<Record<string, number | string | null>>(
      `select
         count(*) filter (where created_at >= $1::timestamptz)::int as recent,
         count(*) filter (where status = 'failed' and created_at >= $1::timestamptz)::int as failed,
         coalesce(sum(cost_usd) filter (where created_at >= $1::timestamptz), 0)::float8 as cost,
         count(*) filter (where status = 'held')::int as held,
         count(*) filter (where status = 'queued')::int as queued,
         count(*) filter (where status = 'running')::int as running
       from render_jobs`,
      [weekAgo],
    ),
  ]);

  const byStatus = Object.fromEntries(RENDER_STATUSES.map((status) => [status, 0])) as Record<RenderStatus, number>;
  for (const row of statuses.rows) byStatus[row.status] = Number(row.n);
  const s = summary.rows[0] ?? {};
  return {
    rows: list.rows.map(toRow),
    total: Number(total.rows[0]?.n ?? 0),
    byStatus,
    summary: {
      recent: Number(s.recent ?? 0),
      failed: Number(s.failed ?? 0),
      costUsd: num(s.cost) ?? 0,
      held: Number(s.held ?? 0),
      queued: Number(s.queued ?? 0),
      running: Number(s.running ?? 0),
    },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadRenderDetail(sql: SqlRunner, id: string): Promise<RenderDetail | null> {
  if (!UUID.test(id)) return null;
  const kind = await kindExpression(sql);
  // Columns added after 0017 are read through `to_jsonb`, so an older schema reads them as absent.
  const { rows } = await sql.query<RawRow>(
    `select ${ROW_COLUMNS}, ${kind} as kind,
            j.provider, j.provider_task_id, j.result_bytes, j.notify_channel, j.notify_attempts, j.notified_at,
            j.claimed_at, j.updated_at,
            to_jsonb(j) ->> 'finishing_at' as finishing_at,
            to_jsonb(j) ->> 'cost_source' as cost_source,
            p.id as payment_id, p.environment as payment_environment, p.amount_krw as payment_amount, p.approved_at as payment_approved_at,
            p.refunded_at as payment_refunded_at,
            to_jsonb(p) ->> 'refund_attempts' as payment_refund_attempts,
            to_jsonb(p) ->> 'fulfil_attempts' as payment_fulfil_attempts,
            fb.reason as feedback_reason, fb.created_at as feedback_at
       ${ROW_JOINS}
      where j.id = $1`,
    [id],
  );
  const raw = rows[0];
  if (!raw) return null;
  return {
    ...toRow(raw),
    provider: (raw.provider as string | null) ?? null,
    providerTaskId: (raw.provider_task_id as string | null) ?? null,
    costSource: (raw.cost_source as string | null) ?? null,
    resultBytes: num(raw.result_bytes),
    notifyChannel: String(raw.notify_channel ?? ""),
    notifyAttempts: Number(raw.notify_attempts ?? 0),
    notifiedAt: iso(raw.notified_at),
    claimedAt: iso(raw.claimed_at),
    finishingAt: iso(raw.finishing_at),
    updatedAt: iso(raw.updated_at) ?? "",
    payment:
      raw.payment_id === null || raw.payment_id === undefined
        ? null
        : {
            id: String(raw.payment_id),
            environment: (raw.payment_environment as PaymentEnvironment | null) ?? "test",
            status: String(raw.payment_status),
            failureCode: (raw.payment_failure as string | null) ?? null,
            amountKrw: Number(raw.payment_amount ?? 0),
            approvedAt: iso(raw.payment_approved_at),
            refundedAt: iso(raw.payment_refunded_at),
            refundAttempts: num(raw.payment_refund_attempts),
            fulfilAttempts: num(raw.payment_fulfil_attempts),
          },
    feedbackReason: (raw.feedback_reason as string | null) ?? null,
    feedbackAt: iso(raw.feedback_at),
  };
}

/** Failed renders created in the last seven days — the home queue's second line. */
export async function countRecentRenderFailures(sql: SqlRunner, now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { rows } = await sql.query<{ n: number | string }>(
    "select count(*)::int as n from render_jobs where status = 'failed' and created_at >= $1::timestamptz",
    [since],
  );
  return Number(rows[0]?.n ?? 0);
}

const MANUAL_PAYMENT_WHERE = `p.payment_type = 'NORMAL' and (
  (p.status = 'refund_pending' and p.failure_code in ('refund_manual', 'partial_balance')) or
  (p.status = 'paid' and p.failure_code = 'fulfil_manual'))`;

/**
 * Which environment the deployment belongs to (`live` vs `test` — where `test` groups test keys and
 * local fake orders together). Reads the active Toss widget keys first, falling back to `VERCEL_ENV`.
 */
export function defaultPaymentEnvironment(
  env: Record<string, string | undefined> = process.env,
): PaymentEnvironmentBucket {
  const keys = tossKeyKind(env);
  if (keys === "live") return "live";
  if (keys === "test") return "test";
  return env.VERCEL_ENV === "production" ? "live" : "test";
}

export function paymentChecksFilter(
  params: Record<string, string | string[] | undefined>,
  env: Record<string, string | undefined> = process.env,
): { environment: PaymentEnvironmentBucket; defaultEnvironment: PaymentEnvironmentBucket } {
  const defaultEnvironment = defaultPaymentEnvironment(env);
  const raw = params.env;
  const value = typeof raw === "string" ? raw : undefined;
  return {
    environment: value === "live" || value === "test" ? value : defaultEnvironment,
    defaultEnvironment,
  };
}

function environmentSqlFilter(bucket?: PaymentEnvironmentBucket): string {
  if (bucket === "live") return "and p.environment = 'live'";
  if (bucket === "test") return "and p.environment in ('test', 'fake')";
  return "";
}

export async function countManualPayments(
  sql: SqlRunner,
  environment: PaymentEnvironmentBucket = defaultPaymentEnvironment(),
): Promise<number> {
  const { rows } = await sql.query<{ n: number | string }>(
    `select count(*)::int as n from billing_payments p
      where ${MANUAL_PAYMENT_WHERE} ${environmentSqlFilter(environment)}`,
  );
  return Number(rows[0]?.n ?? 0);
}

export async function countManualPaymentsByEnvironment(
  sql: SqlRunner,
): Promise<Record<PaymentEnvironmentBucket, number>> {
  const { rows } = await sql.query<{ live: number | string; test: number | string }>(
    `select
       count(*) filter (where p.environment = 'live')::int as live,
       count(*) filter (where p.environment in ('test', 'fake'))::int as test
      from billing_payments p
     where ${MANUAL_PAYMENT_WHERE}`,
  );
  return {
    live: Number(rows[0]?.live ?? 0),
    test: Number(rows[0]?.test ?? 0),
  };
}

/**
 * Toss single payments an operator holds now (docs/PLATFORM-2.0.md §2.2-4): a refund or a fulfilment
 * that stopped retrying after its cap, or a partial-cancel balance. Scoped to an environment bucket
 * when supplied so live and test/fake rows stay separated.
 */
export async function loadManualPayments(
  sql: SqlRunner,
  environment?: PaymentEnvironmentBucket,
): Promise<ManualPayment[]> {
  const { rows } = await sql.query<RawRow>(
    `select p.id, p.user_id, p.environment, p.order_name, p.template_slug, p.amount_krw, p.status, p.failure_code,
            to_jsonb(p) ->> 'refund_attempts' as refund_attempts,
            to_jsonb(p) ->> 'fulfil_attempts' as fulfil_attempts,
            p.render_id, j.status as render_status, p.created_at, p.approved_at, p.updated_at
       from billing_payments p
       left join render_jobs j on j.id = p.render_id
      where ${MANUAL_PAYMENT_WHERE} ${environmentSqlFilter(environment)}
      order by p.updated_at asc, p.id asc
      limit 200`,
  );
  return rows.map((raw) => ({
    id: String(raw.id),
    userId: (raw.user_id as string | null) ?? null,
    environment: (raw.environment as PaymentEnvironment | null) ?? "test",
    orderName: String(raw.order_name),
    templateSlug: (raw.template_slug as string | null) ?? null,
    amountKrw: Number(raw.amount_krw ?? 0),
    status: String(raw.status),
    failureCode: raw.failure_code as ManualPayment["failureCode"],
    refundAttempts: num(raw.refund_attempts),
    fulfilAttempts: num(raw.fulfil_attempts),
    renderId: (raw.render_id as string | null) ?? null,
    renderStatus: (raw.render_status as string | null) ?? null,
    createdAt: iso(raw.created_at) ?? "",
    approvedAt: iso(raw.approved_at),
    updatedAt: iso(raw.updated_at) ?? "",
  }));
}

/** The board's address for a filter; changing anything but the page goes back to page one. */
export function renderBoardHref(filter: RenderBoardFilter, change: Partial<RenderBoardFilter> = {}): string {
  const next = { ...filter, page: 1, ...change };
  const search = new URLSearchParams();
  if (next.status) search.set("status", next.status);
  if (next.medium) search.set("medium", next.medium);
  if (next.query.trim()) search.set("q", next.query.trim());
  if (next.page > 1) search.set("page", String(next.page));
  const query = search.toString();
  return query ? `/admin/renders?${query}` : "/admin/renders";
}

/** Status pill tone (docs/ADMIN.md §3): failed in ink, held aside, moving outlined, done quiet. */
export function renderTone(status: RenderStatus): "fail" | "hold" | "progress" | "done" {
  if (status === "failed") return "fail";
  if (status === "held") return "hold";
  if (status === "succeeded") return "done";
  return "progress";
}

const MANUAL = new Set(["refund_manual", "partial_balance", "fulfil_manual"]);

/**
 * Error codes that must never be retried automatically or by an operator (docs/ADMIN.md §8 & §10-4,
 * AGENTS.md §4: face check, liveness, moderation, and safety rejections are final).
 */
export const NON_RETRYABLE_RENDER_ERRORS = new Set([
  "face_check_failed",
  "face_rejected",
  "liveness_required",
  "moderation_blocked",
  "safety_rejected",
  "policy_violation",
  "content_policy_violation",
  "provider_moderation",
]);

/**
 * Whether an operator may re-queue a failed render (docs/ADMIN.md §8, founder decision 2026-11-04):
 * - Only `failed` renders with transient provider errors (`provider_timeout`, `engine_error`, `stalled`, 5xx, etc.).
 * - Never face/liveness/moderation rejections.
 * - If a payment is linked, its status must be `paid` (never `refund_pending` or `refunded`).
 */
export function canRetryRender(input: {
  status: RenderStatus;
  errorCode: string | null;
  paymentStatus: string | null;
}): boolean {
  if (input.status !== "failed") return false;
  if (input.errorCode && NON_RETRYABLE_RENDER_ERRORS.has(input.errorCode.trim().toLowerCase())) {
    return false;
  }
  if (input.paymentStatus !== null && input.paymentStatus !== "paid") {
    return false;
  }
  return true;
}

/** Whether an operator may re-send the completion notice for a finished render. */
export function canResendRenderNotice(input: { status: RenderStatus }): boolean {
  return input.status === "succeeded";
}

/** A payment an operator must handle reads as "to do"; settled ones are quiet. */
export function paymentTone(status: string, failureCode: string | null): "action" | "fail" | "progress" | "done" {
  if (failureCode !== null && MANUAL.has(failureCode)) return "action";
  if (status === "failed") return "fail";
  if (status === "paid" || status === "refunded") return "done";
  return "progress";
}

/** Parse the board's query string, refusing anything that is not a known value. */
export function renderBoardFilter(params: Record<string, string | string[] | undefined>): RenderBoardFilter {
  const one = (key: string) => {
    const value = params[key];
    return typeof value === "string" ? value : undefined;
  };
  const status = one("status");
  const medium = one("medium");
  const page = Number.parseInt(one("page") ?? "1", 10);
  return {
    status: status && (RENDER_STATUSES as readonly string[]).includes(status) ? (status as RenderStatus) : null,
    medium: medium && (RENDER_MEDIA as readonly string[]).includes(medium) ? (medium as RenderMediumFilter) : null,
    query: (one("q") ?? "").slice(0, 80),
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1,
  };
}
