/**
 * Whether an organization already has a production contract (docs/BRAND-STUDIO-V3.md §6): only those see
 * the small "계약한 전용 템플릿" link to `/brand/studio?tab=formats`. One indexed existence check instead
 * of the formats tab's full workspace load (lib/brands/production/service.ts `loadProductionWorkspace`).
 * The caller has already passed `studioRouteContext`, so the organization is one the viewer may read.
 * A failure reads as "no contract": the link is a convenience and never blocks the page.
 */
import type { SqlRunner } from "@/lib/db/sql-runner";

export async function hasProductionContracts(sql: Pick<SqlRunner, "query">, organizationId: string): Promise<boolean> {
  try {
    const row = (await sql.query<{ one: number }>("select 1 as one from brand_production_contracts where organization_id = $1 limit 1", [organizationId])).rows[0];
    return Boolean(row);
  } catch {
    return false;
  }
}
