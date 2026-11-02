import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Viewer } from "@/lib/auth/identity";
import type { SqlRunner } from "@/lib/db/sql-runner";
import type { TossGateway } from "@/lib/billing/toss-gateway";
export type Row = Record<string, unknown>;
export type Failure =
  | "invalid"
  | "sign_in_required"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "unavailable"
  | "payments_closed"
  | "amount_mismatch"
  | "confirm_pending"
  | "payment_failed"
  | "payment_review"
  | "rate_limited";
export type Outcome<T extends object = Record<never, never>> =
  ({ ok: true } & T) | { ok: false; code: Failure };
export class Denied extends Error {
  constructor(readonly code: Failure) {
    super(code);
  }
}
export interface FundingDeps {
  sql: SqlRunner;
  gateway: TossGateway;
  enabled: boolean;
  policyReady: boolean;
  production: boolean;
  now?: Date;
}
export const clock = (d: { now?: Date }) => d.now ?? new Date();
export const stamp = (v: unknown) =>
  v instanceof Date ? v.toISOString() : String(v);
export const uuid = (v: unknown): v is string =>
  z.string().uuid().safeParse(v).success;
export const environmentMatches = (
  d: Pick<FundingDeps, "production" | "gateway">,
) => (d.production ? d.gateway.kind === "live" : d.gateway.kind !== "live");
export const open = (d: Omit<FundingDeps, "sql">) =>
  d.enabled &&
  d.policyReady &&
  (d.production ? d.gateway.kind === "live" : d.gateway.kind !== "live");
export async function schemaReady(sql: SqlRunner) {
  return (
    (
      await sql.query<{ ready: boolean }>(
        "select to_regclass('public.campaign_funding_payments') is not null as ready",
      )
    ).rows[0]?.ready === true
  );
}
export async function profile(sql: SqlRunner, id: string) {
  const p = (
    await sql.query("select id,is_admin from profiles where id=$1 for share", [
      id,
    ])
  ).rows[0];
  if (!p) throw new Denied("sign_in_required");
  return p;
}
export async function studio(sql: SqlRunner, id: string) {
  if ((await profile(sql, id)).is_admin !== true) throw new Denied("forbidden");
}
export async function seat(
  sql: SqlRunner,
  id: string,
  projectId: string,
  buy = false,
) {
  const p = (
    await sql.query("select * from brand_projects where id=$1 for share", [
      projectId,
    ])
  ).rows[0];
  if (!p || !p.client_visible) throw new Denied("not_found");
  const me = await profile(sql, id);
  const m = (
    await sql.query(
      "select role from brand_memberships where organization_id=$1 and user_id=$2 and status='active' for share",
      [p.organization_id, id],
    )
  ).rows[0];
  if (!m) throw new Denied("not_found");
  if (
    buy &&
    (m.role !== "owner" ||
      me.is_admin === true ||
      ["completed", "cancelled"].includes(String(p.status)))
  )
    throw new Denied("forbidden");
  return {
    project: p,
    canPropose:
      ["owner", "editor"].includes(String(m.role)) &&
      me.is_admin !== true &&
      !["completed", "cancelled"].includes(String(p.status)),
    canBuy:
      m.role === "owner" &&
      me.is_admin !== true &&
      !["completed", "cancelled"].includes(String(p.status)),
  };
}
export async function event(
  sql: SqlRunner,
  caseId: unknown,
  quoteId: unknown,
  kind: string,
  actorId: string | null,
  reason?: string,
) {
  await sql.query(
    "insert into campaign_funding_events(id,case_id,quote_id,kind,actor_id,reason) values($1,$2,$3,$4,$5,$6)",
    [randomUUID(), caseId, quoteId, kind, actorId, reason ?? null],
  );
}
export async function lockCase(sql: SqlRunner, id: string) {
  const c = (
    await sql.query(
      "select * from campaign_funding_cases where id=$1 for update",
      [id],
    )
  ).rows[0];
  if (!c) throw new Denied("not_found");
  return c;
}
export async function run<S extends z.ZodType, T extends object>(
  sql: SqlRunner,
  viewer: Viewer,
  schema: S,
  input: unknown,
  fn: (tx: SqlRunner, id: string, v: z.output<S>) => Promise<T>,
): Promise<Outcome<T>> {
  if (!uuid(viewer.userId)) return { ok: false, code: "sign_in_required" };
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, code: "invalid" };
  try {
    if (!(await schemaReady(sql))) return { ok: false, code: "unavailable" };
    return await sql.transaction(async (tx) => ({
      ok: true,
      ...(await fn(tx, viewer.userId!, p.data)),
    }));
  } catch (e) {
    if (e instanceof Denied) return { ok: false, code: e.code };
    if ((e as { code?: string }).code === "23505")
      return { ok: false, code: "conflict" };
    throw e;
  }
}
