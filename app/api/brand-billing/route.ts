import type { NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { studioEnv } from '@/lib/brand-studio/env';
import { loadCustomerBrandBilling } from '@/lib/brands/billing';
import { billingJson, billingStatus } from '@/lib/brands/billing/http';
import { loadCustomerExtraGrants } from '@/lib/brands/billing-page-data';
import { getSqlRunner } from '@/lib/db/connect';

/**
 * `GET /api/brand-billing?organizationId=…`
 * Read-only customer billing overview for an organization owner/admin:
 * plan, monthly allowance (source, base, extra, resets on), active discount, non-draft invoices,
 * and billing profile. Sandboxed organizations and non-members get 404; non-owner/admin members get 403.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer.userId) return billingJson({ ok: false, code: 'sign_in_required' }, 401);
  const sql = await getSqlRunner().catch(() => null);
  if (!sql) return billingJson({ ok: false, code: 'unavailable' }, 503);
  try {
    const organizationId = request.nextUrl.searchParams.get('organizationId') ?? '';
    const result = await loadCustomerBrandBilling({ sql, env: studioEnv() }, viewer, organizationId);
    if (!result.ok) {
      return billingJson({ ok: false, code: result.code }, billingStatus(result.code));
    }
    const extraGrants = await loadCustomerExtraGrants(sql, result.billing.organizationId);
    return billingJson({ ok: true, ...result.billing, extraGrants }, 200);
  } catch (error) {
    console.warn(
      '[brand-billing] overview_failed',
      JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }),
    );
    return billingJson({ ok: false, code: 'unavailable' }, 503);
  }
}
