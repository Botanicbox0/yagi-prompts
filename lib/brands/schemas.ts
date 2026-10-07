import { z } from 'zod';

/**
 * Brand enquiries (founder, 2026-09-11) — the form on the campaigns page, validated once, here.
 *
 * A brand tells the studio who they are, roughly what they can spend, which format they have in
 * mind and when. Nothing about the form is a contract; it is the start of a conversation, so the
 * schema is deliberately loose about the optional parts and strict only where a wrong value would
 * waste a reply (the address) or hide spam (the honeypot).
 */

export const BUDGET_BANDS = ['under_3m', '3m_10m', '10m_30m', 'over_30m', 'undecided'] as const;
export type BudgetBand = (typeof BUDGET_BANDS)[number];

export const INQUIRY_STATUSES = ['new', 'contacted', 'closed'] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export const INQUIRY_TYPES = ['campaign', 'production', 'filter', 'undecided'] as const;
export type InquiryType = (typeof INQUIRY_TYPES)[number];
export const INQUIRY_USE_CASES = ['launch', 'beauty_fashion', 'app_platform', 'local', 'seasonal', 'undecided'] as const;
export type InquiryUseCase = (typeof INQUIRY_USE_CASES)[number];

/** Per address, per rolling day — enough for a typo and a retry, not enough for a script. */
export const BRAND_INQUIRIES_PER_DAY = 3;

const optionalLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null));

export const BrandInquiryInput = z.object({
  requestId: z.uuid().optional(),
  inquiryType: z.enum(INQUIRY_TYPES).default('campaign'),
  useCase: z.enum(INQUIRY_USE_CASES).default('undecided'),
  company: z.string().trim().min(1).max(120),
  contactName: z.string().trim().min(1).max(80),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.email()),
  phone: optionalLine(40),
  budgetBand: z.enum(BUDGET_BANDS),
  templateSlug: optionalLine(120),
  timing: optionalLine(120),
  message: z.string().trim().min(10).max(4000),
  consent: z.literal(true),
  locale: z.enum(['en', 'ko']).default('ko'),
  /** Honeypot: a real person never sees this field, so a value means a script filled the form. */
  website: z.string().max(200).optional(),
});

export type BrandInquiryInput = z.infer<typeof BrandInquiryInput>;

export const InquiryStatusChange = z.object({
  id: z.uuid(),
  status: z.enum(INQUIRY_STATUSES),
});
