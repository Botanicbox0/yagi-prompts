import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { formatPayoutsCsv, loadAdminPayouts, payoutFilter } from "@/lib/admin/payouts";

/**
 * `GET /admin/payouts/csv` — downloads the monthly AI creative settlement CSV (UTF-8 BOM) for
 * 세무법인 이움 (docs/ADMIN.md §7.4 & §10-3). Guarded by `requireAdmin()`; answers 404 when not admin.
 */
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin();
  } catch {
    return new NextResponse(null, { status: 404, headers: NO_STORE });
  }

  const sql = await getSqlRunner();
  if (sql === null) {
    return new NextResponse(null, { status: 503, headers: NO_STORE });
  }

  const url = new URL(request.url);
  const filter = payoutFilter({
    month: url.searchParams.get("month") ?? undefined,
    taxType: url.searchParams.get("taxType") ?? undefined,
  });

  const report = await loadAdminPayouts(sql, filter);
  const csv = formatPayoutsCsv(report.rows);
  const suffix = filter.month || "all";
  const filename = `twings-payouts-${suffix}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
