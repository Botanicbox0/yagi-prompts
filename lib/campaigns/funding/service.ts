import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Viewer } from "@/lib/auth/identity";
import type { SqlRunner } from "@/lib/db/sql-runner";
import {
  Denied,
  run,
  studio,
  seat,
  lockCase,
  event,
  clock,
  stamp,
  uuid,
  schemaReady,
  open,
  type FundingDeps,
  type Row,
} from "./core";
const Quote = z
  .object({
    campaignId: z.string().uuid(),
    requestId: z.string().uuid(),
    totalKrw: z.number().int().positive().max(2147483647),
    taxBasis: z.string().trim().min(1).max(1000),
    termsSummary: z.string().trim().min(1).max(4000),
    termsRef: z.string().trim().min(1).max(200),
    validUntil: z.string().datetime(),
  })
  .strict();
export async function issueFundingQuote(
  deps: { sql: SqlRunner; now?: Date },
  viewer: Viewer,
  input: unknown,
) {
  return run(deps.sql, viewer, Quote, input, async (sql, id, v) => {
    await studio(sql, id);
    if (new Date(v.validUntil) <= clock(deps)) throw new Denied("invalid");
    // Global campaign -> case lock order matches collaboration/production; never lock a project first.
    const campaign = (
      await sql.query("select id from campaigns where id=$1 for update", [
        v.campaignId,
      ])
    ).rows[0];
    if (!campaign) throw new Denied("not_found");
    const replay = (
      await sql.query(
        "select * from campaign_funding_quotes where created_by=$1 and request_id=$2",
        [id, v.requestId],
      )
    ).rows[0];
    let c = (
      await sql.query(
        "select * from campaign_funding_cases where campaign_id=$1 for update",
        [v.campaignId],
      )
    ).rows[0];
    const p = (
      await sql.query(
        `select p.id,p.organization_id from campaign_collaboration_links l join brand_projects p on p.id=l.project_id where l.campaign_id=$1 for share of p`,
        [v.campaignId],
      )
    ).rows[0];
    if (!p) throw new Denied("conflict");
    if (replay) {
      if (
        !c ||
        replay.case_id !== c.id ||
        Number(replay.total_krw) !== v.totalKrw ||
        replay.tax_basis !== v.taxBasis ||
        replay.terms_ref !== v.termsRef ||
        replay.terms_summary !== v.termsSummary ||
        stamp(replay.valid_until) !== new Date(v.validUntil).toISOString()
      )
        throw new Denied("conflict");
      return {
        id: String(replay.id),
        caseId: String(c.id),
        revision: Number(replay.revision),
      };
    }
    if (!c) {
      c = { id: randomUUID(), status: "quoted" };
      await sql.query(
        "insert into campaign_funding_cases(id,campaign_id,project_id,organization_id) values($1,$2,$3,$4)",
        [c.id, v.campaignId, p.id, p.organization_id],
      );
    }
    if (c.status !== "quoted") throw new Denied("conflict");
    const revision = Number(
      (
        await sql.query(
          "select coalesce(max(revision),0)+1 as n from campaign_funding_quotes where case_id=$1",
          [c.id],
        )
      ).rows[0]!.n,
    );
    await sql.query(
      "update campaign_funding_quotes set status='superseded' where case_id=$1 and status='proposed'",
      [c.id],
    );
    const quoteId = randomUUID();
    await sql.query(
      "insert into campaign_funding_quotes(id,case_id,revision,total_krw,tax_basis,terms_summary,terms_ref,valid_until,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        quoteId,
        c.id,
        revision,
        v.totalKrw,
        v.taxBasis,
        v.termsSummary,
        v.termsRef,
        v.validUntil,
        id,
        v.requestId,
      ],
    );
    await event(sql, c.id, quoteId, "quoted", id);
    return { id: quoteId, caseId: String(c.id), revision };
  });
}
const Accept = z
  .object({
    quoteId: z.string().uuid(),
    revision: z.number().int().positive(),
    consent: z.literal(true),
  })
  .strict();
export async function acceptFundingQuote(
  deps: FundingDeps,
  viewer: Viewer,
  input: unknown,
) {
  if (!open(deps))
    return { ok: false as const, code: "payments_closed" as const };
  return run(deps.sql, viewer, Accept, input, async (sql, id, v) => {
    const found = (
      await sql.query(
        "select case_id from campaign_funding_quotes where id=$1",
        [v.quoteId],
      )
    ).rows[0];
    if (!found) throw new Denied("not_found");
    const c = await lockCase(sql, String(found.case_id));
    const q = (
      await sql.query("select * from campaign_funding_quotes where id=$1", [
        v.quoteId,
      ])
    ).rows[0]!;
    await seat(sql, id, String(c.project_id), true);
    if (
      q.status === "accepted" &&
      q.accepted_by === id &&
      Number(q.revision) === v.revision &&
      c.status === "accepted"
    )
      return { id: String(q.id) };
    if (
      c.status !== "quoted" ||
      q.status !== "proposed" ||
      Number(q.revision) !== v.revision ||
      new Date(stamp(q.valid_until)) <= clock(deps)
    )
      throw new Denied("conflict");
    await sql.query(
      "update campaign_funding_quotes set status='accepted',accepted_by=$2,accepted_at=$3 where id=$1 and status='proposed'",
      [q.id, id, clock(deps)],
    );
    await sql.query(
      "update campaign_funding_cases set status='accepted' where id=$1",
      [c.id],
    );
    await event(sql, c.id, q.id, "accepted", id);
    return { id: String(q.id) };
  });
}
function quoteDto(q: Row) {
  return {
    id: String(q.id),
    revision: Number(q.revision),
    totalKrw: Number(q.total_krw),
    taxBasis: String(q.tax_basis),
    termsSummary: String(q.terms_summary),
    termsRef: String(q.terms_ref),
    validUntil: stamp(q.valid_until),
    status: String(q.status),
  };
}
function paymentDto(p: Row) {
  return {
    id: String(p.id),
    quoteId: String(p.quote_id),
    status: String(p.status),
    environment: String(p.environment),
    amountKrw: Number(p.amount_krw),
    name: String(p.order_name),
    expiresAt: stamp(p.expires_at),
    approvedAt: p.approved_at ? stamp(p.approved_at) : null,
    refundedAt: p.refunded_at ? stamp(p.refunded_at) : null,
    refundInitiated: !!p.refund_started_at,
  };
}
async function casesDto(sql: SqlRunner, where: string, args: unknown[]) {
  const cases = (
    await sql.query(
      `select c.*,p.title as project_title,k.title as campaign_title from campaign_funding_cases c join brand_projects p on p.id=c.project_id join campaigns k on k.id=c.campaign_id where ${where} order by c.created_at desc`,
      args,
    )
  ).rows;
  const items = [];
  for (const c of cases) {
    const quotes = (
      await sql.query(
        "select * from campaign_funding_quotes where case_id=$1 order by revision desc",
        [c.id],
      )
    ).rows;
    const payments = (
      await sql.query(
        "select id,quote_id,status,environment,amount_krw,order_name,expires_at,approved_at,refunded_at,refund_started_at from campaign_funding_payments where case_id=$1 order by created_at desc",
        [c.id],
      )
    ).rows;
    items.push({
      id: String(c.id),
      campaignId: String(c.campaign_id),
      projectId: String(c.project_id),
      projectTitle: String(c.project_title),
      status: String(c.status),
      quote: quotes[0] ? quoteDto(quotes[0]) : null,
      quotes: quotes.map(quoteDto),
      payments: payments.map(paymentDto),
    });
  }
  return items;
}
export async function loadFundingProject(
  deps: { sql: SqlRunner },
  viewer: Viewer,
  projectId: string,
) {
  if (!uuid(viewer.userId) || !uuid(projectId)) return null;
  try {
    return await deps.sql.transaction(async (sql) => {
      const s = await seat(sql, viewer.userId!, projectId);
      if (!(await schemaReady(sql)))
        return {
          ready: false as const,
          canBuy: s.canBuy,
          canPropose: s.canPropose,
          items: [],
          campaigns: [],
          proposals: [],
        };
      return {
        ready: true as const,
        canBuy: s.canBuy,
        canPropose: s.canPropose,
        campaigns: (
          await sql.query<{ id: string; title: { en: string; ko: string } }>(
            "select k.id,k.title from campaigns k join campaign_collaboration_links l on l.campaign_id=k.id where l.project_id=$1 order by k.created_at desc",
            [projectId],
          )
        ).rows,
        proposals: await loadRewardProposals(sql, projectId),
        items: await casesDto(sql, "c.project_id=$1", [projectId]),
      };
    });
  } catch (e) {
    if (e instanceof Denied) return null;
    throw e;
  }
}
export async function loadFundingAdmin(sql: SqlRunner, viewer: Viewer) {
  if (!uuid(viewer.userId)) return null;
  try {
    return await sql.transaction(async (tx) => {
      await studio(tx, viewer.userId!);
      if (!(await schemaReady(tx)))
        return {
          ready: false as const,
          items: [],
          campaigns: [],
          proposals: [],
        };
      const campaigns = (
        await tx.query<{ id: string; project_id: string; title: unknown }>(
          "select k.id,l.project_id,k.title from campaigns k join campaign_collaboration_links l on l.campaign_id=k.id order by k.created_at desc",
        )
      ).rows;
      return {
        ready: true as const,
        items: await casesDto(tx, "true", []),
        campaigns,
        proposals: await loadRewardProposals(tx),
      };
    });
  } catch (e) {
    if (e instanceof Denied) return null;
    throw e;
  }
}
export async function loadFundingCheckout(
  sql: SqlRunner,
  viewer: Viewer,
  projectId: string,
  orderId: string,
) {
  const view = await loadFundingProject({ sql }, viewer, projectId);
  if (!view?.ready || !view.canBuy) return null;
  for (const item of view.items) {
    const order = item.payments.find((p) => p.id === orderId);
    if (order && item.quote?.id === order.quoteId)
      return { order, quote: item.quote, caseId: item.id };
  }
  return null;
}

const RewardProposal = z
  .object({
    campaignId: z.string().uuid(),
    projectId: z.string().uuid(),
    requestId: z.string().uuid(),
    amountKrw: z.number().int().positive().max(2147483647),
    conditions: z.string().trim().min(1).max(4000),
  })
  .strict();
/** A request to the studio, never a payout configuration or a binding participant offer. */
export async function proposeCampaignReward(
  deps: { sql: SqlRunner },
  viewer: Viewer,
  input: unknown,
) {
  return run(deps.sql, viewer, RewardProposal, input, async (sql, id, v) => {
    // Lock-free authorization first; then campaign -> project locks and current-seat recheck.
    const authorized =
      (
        await sql.query(
          `select 1 from brand_projects p join brand_memberships m on m.organization_id=p.organization_id join profiles u on u.id=m.user_id join campaign_collaboration_links l on l.project_id=p.id where p.id=$1 and m.user_id=$2 and l.campaign_id=$3 and m.status='active' and m.role in ('owner','editor') and u.is_admin=false and p.client_visible and p.status not in ('completed','cancelled')`,
          [v.projectId, id, v.campaignId],
        )
      ).rows.length > 0;
    if (!authorized) throw new Denied("not_found");
    const campaign = (
      await sql.query("select id from campaigns where id=$1 for update", [
        v.campaignId,
      ])
    ).rows[0];
    if (!campaign) throw new Denied("not_found");
    const s = await seat(sql, id, v.projectId);
    if (!s.canPropose) throw new Denied("forbidden");
    if (
      !(
        await sql.query(
          "select 1 from campaign_collaboration_links where campaign_id=$1 and project_id=$2",
          [v.campaignId, v.projectId],
        )
      ).rows.length
    )
      throw new Denied("not_found");
    const replay = (
      await sql.query(
        "select * from campaign_funding_reward_proposals where created_by=$1 and request_id=$2",
        [id, v.requestId],
      )
    ).rows[0];
    if (replay) {
      if (
        replay.campaign_id !== v.campaignId ||
        replay.project_id !== v.projectId ||
        Number(replay.amount_krw) !== v.amountKrw ||
        replay.conditions !== v.conditions
      )
        throw new Denied("conflict");
      return { id: String(replay.id) };
    }
    const proposalId = randomUUID();
    await sql.query(
      "insert into campaign_funding_reward_proposals(id,campaign_id,project_id,organization_id,amount_krw,conditions,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        proposalId,
        v.campaignId,
        v.projectId,
        s.project.organization_id,
        v.amountKrw,
        v.conditions,
        id,
        v.requestId,
      ],
    );
    return { id: proposalId };
  });
}
const RewardReview = z
  .object({
    proposalId: z.string().uuid(),
    state: z.enum(["reviewed", "declined"]),
    note: z.string().trim().min(1).max(1000),
  })
  .strict();
export async function reviewCampaignReward(
  deps: { sql: SqlRunner },
  viewer: Viewer,
  input: unknown,
) {
  return run(deps.sql, viewer, RewardReview, input, async (sql, id, v) => {
    await studio(sql, id);
    const row = (
      await sql.query(
        "update campaign_funding_reward_proposals set state=$2,review_note=$3,reviewed_by=$4,reviewed_at=now() where id=$1 and state='proposed' returning id",
        [v.proposalId, v.state, v.note, id],
      )
    ).rows[0];
    if (!row) throw new Denied("conflict");
    return { id: String(row.id) };
  });
}
async function loadRewardProposals(sql: SqlRunner, projectId?: string) {
  return (
    await sql.query<{
      id: string;
      campaign_id: string;
      project_id: string;
      amount_krw: number;
      conditions: string;
      state: "proposed" | "reviewed" | "declined";
      review_note: string | null;
      created_at: Date;
    }>(
      `select id,campaign_id,project_id,amount_krw,conditions,state,review_note,created_at from campaign_funding_reward_proposals ${projectId ? "where project_id=$1" : ""} order by created_at desc`,
      projectId ? [projectId] : [],
    )
  ).rows;
}

const VoidQuote = z
  .object({
    caseId: z.string().uuid(),
    reason: z.string().trim().min(1).max(1000),
    confirmed: z.literal(true),
  })
  .strict();
/** Preserve the accepted quote and its actor/time. Only proven-unpaid expired cases may be re-quoted. */
export async function voidExpiredFundingQuote(
  deps: { sql: SqlRunner; now?: Date },
  viewer: Viewer,
  input: unknown,
) {
  return run(deps.sql, viewer, VoidQuote, input, async (sql, id, v) => {
    await studio(sql, id);
    const c = await lockCase(sql, v.caseId);
    if (c.status !== "accepted") throw new Denied("conflict");
    const q = (
      await sql.query(
        "select * from campaign_funding_quotes where case_id=$1 and status='accepted'",
        [c.id],
      )
    ).rows[0];
    if (!q || new Date(stamp(q.valid_until)) > clock(deps))
      throw new Denied("conflict");
    await sql.query(
      "update campaign_funding_payments set status='expired',updated_at=$2 where case_id=$1 and status='pending' and payment_key is null and expires_at<=$2",
      [c.id, clock(deps)],
    );
    if (
      (
        await sql.query(
          "select 1 from campaign_funding_payments where case_id=$1 and status not in ('failed','expired')",
          [c.id],
        )
      ).rows.length
    )
      throw new Denied("conflict");
    await sql.query(
      "update campaign_funding_quotes set status='voided' where id=$1",
      [q.id],
    );
    await sql.query(
      "update campaign_funding_cases set status='quoted' where id=$1",
      [c.id],
    );
    await event(sql, c.id, q.id, "expired_quote_voided", id, v.reason);
    return { id: String(c.id) };
  });
}
