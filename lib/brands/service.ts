import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Mailer, SendOutcome } from '@/lib/notify/mailer';
import { BUSINESS } from '@/lib/legal/documents';
import { brandInquiryEmails } from './email';
import { countBrandInquiriesByEmailSince, insertBrandInquiry, type BrandInquiry } from './repo';
import { BRAND_INQUIRIES_PER_DAY, BrandInquiryInput } from './schemas';

/**
 * Brand enquiries — the service (founder, 2026-09-11). Two functions, on purpose:
 *
 *   · `submitBrandInquiry` validates and STORES. It is the request's whole job; it must finish
 *     inside the request and it must never depend on a mail provider being up.
 *   · `notifyBrandInquiry` sends the two mails afterwards (`after()` in the route). A mail that
 *     fails leaves the row in place; the studio board still shows the enquiry.
 *
 * Spam: a honeypot field is accepted and dropped without a word, and one address gets three
 * enquiries per rolling day. Neither is a CAPTCHA, which would cost more real brands than bots.
 */

export type SubmitBrandInquiryResult =
  | { ok: true; inquiry: BrandInquiry | null }
  | { ok: false; code: 'invalid' | 'rate_limited'; field?: string };

const DAY_MS = 24 * 60 * 60 * 1000;

export async function submitBrandInquiry(
  deps: { sql: SqlRunner; now?: Date },
  raw: unknown,
  userId: string | null,
): Promise<SubmitBrandInquiryResult> {
  const parsed = BrandInquiryInput.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = first && first.path.length > 0 ? String(first.path[0]) : undefined;
    return field ? { ok: false, code: 'invalid', field } : { ok: false, code: 'invalid' };
  }
  const input = parsed.data;
  // A filled honeypot is a script. Say yes, store nothing, send nothing.
  if (input.website && input.website.length > 0) return { ok: true, inquiry: null };

  const now = deps.now ?? new Date();
  const recent = await countBrandInquiriesByEmailSince(deps.sql, input.email, new Date(now.getTime() - DAY_MS));
  if (recent >= BRAND_INQUIRIES_PER_DAY) return { ok: false, code: 'rate_limited' };

  const inquiry = await insertBrandInquiry(deps.sql, {
    locale: input.locale,
    company: input.company,
    contactName: input.contactName,
    email: input.email,
    phone: input.phone,
    budgetBand: input.budgetBand,
    templateSlug: input.templateSlug,
    timing: input.timing,
    message: input.message,
    consentAt: now,
    userId,
  });
  return { ok: true, inquiry };
}

export interface NotifyBrandInquiryDeps {
  mailer: Mailer | null;
  siteUrl: string;
  siteName: string;
  /** Where the studio's alert goes. Defaults to the business address in lib/legal/documents. */
  studioEmail?: string;
}

export interface NotifyBrandInquiryResult {
  studio: SendOutcome | null;
  brand: SendOutcome | null;
}

export async function notifyBrandInquiry(deps: NotifyBrandInquiryDeps, inquiry: BrandInquiry): Promise<NotifyBrandInquiryResult> {
  if (deps.mailer === null) return { studio: null, brand: null };
  const origin = deps.siteUrl.replace(/\/+$/, '');
  const emails = brandInquiryEmails({ inquiry, siteName: deps.siteName, siteUrl: origin, adminUrl: `${origin}/admin/inquiries` });
  const studioEmail = deps.studioEmail ?? BUSINESS.email;

  const studio = await deps.mailer
    .send({
      to: studioEmail,
      subject: emails.studio.subject,
      html: emails.studio.html,
      text: emails.studio.text,
      idempotencyKey: `brand-inquiry:${inquiry.id}:studio`,
      unsubscribeUrl: `${origin}/admin/campaigns`,
    })
    .catch((error: unknown): SendOutcome => ({ ok: false, retryable: false, error: error instanceof Error ? error.message : String(error) }));

  const brand = await deps.mailer
    .send({
      to: inquiry.email,
      subject: emails.brand.subject,
      html: emails.brand.html,
      text: emails.brand.text,
      idempotencyKey: `brand-inquiry:${inquiry.id}:brand`,
      unsubscribeUrl: `${origin}/${inquiry.locale}/campaigns`,
    })
    .catch((error: unknown): SendOutcome => ({ ok: false, retryable: false, error: error instanceof Error ? error.message : String(error) }));

  return { studio, brand };
}
