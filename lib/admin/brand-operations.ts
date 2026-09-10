import type { z } from 'zod';
import { updateBrandInquiryStatus } from '@/lib/brands/repo';
import { InquiryStatusChange } from '@/lib/brands/schemas';
import { ADMIN_CAMPAIGNS_PATH } from '@/lib/campaigns/links';
import { fail, ok, type AdminOutcome } from './context';
import * as f from './form';
import type { AdminOperation, ParseResult } from './operations';

/**
 * Brand enquiries on the admin board (2026-09-11): one operation, the status. The studio replies by
 * email outside the product; here it only records that it did, and when the conversation ended.
 */
function parsed<T>(schema: z.ZodType<T>, value: unknown): ParseResult<T> {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  const detail = result.error.issues
    .slice(0, 4)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  return { ok: false, detail };
}

const status: AdminOperation<z.infer<typeof InquiryStatusChange>> = {
  parse: (form) => parsed(InquiryStatusChange, { id: f.str(form, 'id'), status: f.str(form, 'status') }),
  async run(ctx, input) {
    const moved = await updateBrandInquiryStatus(ctx.sql, input.id, input.status);
    if (!moved) return fail('notFound', 'the enquiry this form points at no longer exists');
    // No fragment on `to`: the dispatcher appends `?ok=` and a hash would swallow it.
    return ok('saved', { to: ADMIN_CAMPAIGNS_PATH });
  },
};

export const BRAND_OPERATIONS = {
  'brandInquiry.status': status,
} as const;

export type BrandOutcome = AdminOutcome;
