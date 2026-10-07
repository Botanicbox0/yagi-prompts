import type { SqlRunner } from '@/lib/db/sql-runner';
import type { BudgetBand, InquiryStatus, InquiryType, InquiryUseCase } from './schemas';

/** One brand enquiry, as the studio reads it. */
export interface BrandInquiry {
  id: string;
  createdAt: string;
  locale: 'en' | 'ko';
  inquiryType: InquiryType;
  useCase: InquiryUseCase;
  company: string;
  contactName: string;
  email: string;
  phone: string | null;
  budgetBand: BudgetBand;
  templateSlug: string | null;
  timing: string | null;
  message: string;
  consentAt: string;
  userId: string | null;
  status: InquiryStatus;
  contactedAt: string | null;
  receiptSentAt: string | null;
}

interface RawRow {
  id: string;
  created_at: string | Date;
  locale: string;
  inquiry_type: InquiryType;
  use_case: InquiryUseCase;
  company: string;
  contact_name: string;
  email: string;
  phone: string | null;
  budget_band: string;
  template_slug: string | null;
  timing: string | null;
  message: string;
  consent_at: string | Date;
  user_id: string | null;
  status: string;
  contacted_at: string | Date | null;
  receipt_sent_at: string | Date | null;
}

const COLUMNS =
  'id, created_at, locale, inquiry_type, use_case, company, contact_name, email, phone, budget_band, template_slug, timing, message, consent_at, user_id, status, contacted_at, receipt_sent_at';

const iso = (value: string | Date | null): string | null => (value === null ? null : value instanceof Date ? value.toISOString() : String(value));

function toInquiry(row: RawRow): BrandInquiry {
  return {
    id: row.id,
    createdAt: iso(row.created_at) ?? '',
    locale: row.locale === 'en' ? 'en' : 'ko',
    inquiryType: row.inquiry_type,
    useCase: row.use_case,
    company: row.company,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    budgetBand: row.budget_band as BudgetBand,
    templateSlug: row.template_slug,
    timing: row.timing,
    message: row.message,
    consentAt: iso(row.consent_at) ?? '',
    userId: row.user_id,
    status: row.status as InquiryStatus,
    contactedAt: iso(row.contacted_at),
    receiptSentAt: iso(row.receipt_sent_at),
  };
}

export interface InsertBrandInquiryArgs {
  requestId?: string;
  locale: 'en' | 'ko';
  inquiryType?: InquiryType;
  useCase?: InquiryUseCase;
  company: string;
  contactName: string;
  email: string;
  phone: string | null;
  budgetBand: BudgetBand;
  templateSlug: string | null;
  timing: string | null;
  message: string;
  consentAt: Date;
  userId: string | null;
}

export async function insertBrandInquiry(sql: SqlRunner, args: InsertBrandInquiryArgs): Promise<{ inquiry: BrandInquiry; replayed: boolean }> {
  const { rows } = await sql.query<RawRow>(
    `with accepted as (
       insert into brand_inquiries
         (locale, company, contact_name, email, phone, budget_band, template_slug, timing, message, consent_at, user_id, inquiry_type, use_case, request_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11, $12, $13, $14::uuid)
       on conflict (request_id) do nothing
       returning ${COLUMNS}
     ), enqueued as (
       insert into brand_inquiry_deliveries (inquiry_id) select id from accepted returning inquiry_id
     )
     select accepted.* from accepted join enqueued on enqueued.inquiry_id = accepted.id`,
    [args.locale, args.company, args.contactName, args.email, args.phone, args.budgetBand, args.templateSlug, args.timing, args.message, args.consentAt.toISOString(), args.userId, args.inquiryType ?? 'campaign', args.useCase ?? 'undecided', args.requestId ?? null],
  );
  const row = rows[0];
  if (row) return { inquiry: toInquiry(row), replayed: false };
  // A fresh statement sees the winning transaction after a concurrent ON CONFLICT wait.
  // Putting this SELECT into the insert CTE would use its older snapshot and can miss that row.
  const existing = args.requestId ? await loadBrandInquiryByRequestId(sql, args.requestId) : null;
  if (!existing) throw new Error('brand_inquiries insert returned no row');
  return { inquiry: existing, replayed: true };
}

export async function loadBrandInquiryByRequestId(sql: SqlRunner, requestId: string): Promise<BrandInquiry | null> {
  const { rows } = await sql.query<RawRow>(`select ${COLUMNS} from brand_inquiries where request_id = $1::uuid`, [requestId]);
  return rows[0] ? toInquiry(rows[0]) : null;
}

export async function markBrandInquiryReceiptSent(sql: SqlRunner, inquiryId: string): Promise<void> {
  await sql.query('update brand_inquiries set receipt_sent_at = coalesce(receipt_sent_at, now()) where id = $1::uuid', [inquiryId]);
}

/** The daily cap reads this: how many enquiries this address sent since `since`. */
export async function countBrandInquiriesByEmailSince(sql: SqlRunner, email: string, since: Date): Promise<number> {
  const { rows } = await sql.query<{ n: number | string }>(
    'select count(*)::int as n from brand_inquiries where email = $1 and created_at >= $2::timestamptz',
    [email, since.toISOString()],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function listBrandInquiries(sql: SqlRunner, args: { statuses: readonly InquiryStatus[]; limit: number }): Promise<BrandInquiry[]> {
  if (args.statuses.length === 0) return [];
  const { rows } = await sql.query<RawRow>(
    `select ${COLUMNS} from brand_inquiries where status = any($1::text[]) order by created_at desc limit $2::int`,
    [args.statuses as string[], args.limit],
  );
  return rows.map(toInquiry);
}

export async function countBrandInquiries(sql: SqlRunner, status: InquiryStatus): Promise<number> {
  const { rows } = await sql.query<{ n: number | string }>('select count(*)::int as n from brand_inquiries where status = $1', [status]);
  return Number(rows[0]?.n ?? 0);
}

export async function loadBrandInquiry(sql: SqlRunner, id: string): Promise<BrandInquiry | null> {
  const { rows } = await sql.query<RawRow>(`select ${COLUMNS} from brand_inquiries where id = $1`, [id]);
  return rows[0] ? toInquiry(rows[0]) : null;
}

/** The studio's bookkeeping. `contacted_at` is stamped the first time an enquiry leaves `new`. */
export async function updateBrandInquiryStatus(sql: SqlRunner, id: string, status: InquiryStatus): Promise<boolean> {
  const { rows } = await sql.query<{ id: string }>(
    `update brand_inquiries
        set status = $2,
            contacted_at = case when $2 <> 'new' and contacted_at is null then now() else contacted_at end
      where id = $1
      returning id`,
    [id, status],
  );
  return rows.length > 0;
}
