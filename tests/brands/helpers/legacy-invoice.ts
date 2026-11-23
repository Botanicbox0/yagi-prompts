import { randomUUID } from 'node:crypto';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { BRAND_PLANS, type BrandPlanId } from '@/lib/brands/plans';

/**
 * B1c fix round: a calendar-month subscription draft written straight into the ledger, as the admin path wrote them
 * before B1c (no cycle, no epoch, full price, no discount, with its 'drafted' event). Engine tests use it for leftovers
 * that the admin path no longer creates for a plan organization (a month past the plan's end, or before its start).
 */
export async function insertLegacyDraft(
  sql: SqlRunner,
  input: { organizationId: string; period: string; planId: BrandPlanId; actorId: string },
): Promise<{ ok: true; invoice: { id: string } }> {
  const id = randomUUID();
  const list = BRAND_PLANS[input.planId].monthlyKrw;
  const vat = Math.floor(list / 10);
  await sql.query(
    `insert into brand_invoices (id, organization_id, period, plan_id, base_list_krw, list_krw, discount_percent, discount_krw,
        supply_krw, vat_krw, total_krw, status, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $5, 0, 0, $5, $6, $7, 'draft', $8, $8)`,
    [id, input.organizationId, input.period, input.planId, list, vat, list + vat, input.actorId],
  );
  await sql.query(
    `insert into brand_invoice_events (invoice_id, organization_id, action, from_status, to_status, snapshot, note, actor_id)
     values ($1, $2, 'drafted', null, 'draft', '{}'::jsonb, '', $3)`,
    [id, input.organizationId, input.actorId],
  );
  return { ok: true, invoice: { id } };
}
