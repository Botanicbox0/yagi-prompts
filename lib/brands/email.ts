import type { BrandInquiry } from './repo';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import { BUSINESS } from '@/lib/legal/documents';
import { companyName } from '@/lib/notify/company-line';
import { sheet } from '@/lib/notify/sheet';

/**
 * The two messages an enquiry sends (2026-09-11): the studio's alert with everything the brand
 * typed, and the brand's receipt in their own language. On the shared sheet. No tracking.
 */

export interface EmailBody {
  subject: string;
  html: string;
  text: string;
}

type BrandCopy = ReturnType<typeof getDictionary>['campaigns']['brands'];

/**
 * Audit P2-17: the budget and format labels are the form's own dictionary entries, so the receipt
 * says exactly what the brand picked, in the words they picked it from.
 */
const BUDGET_KEY: Record<BrandInquiry['budgetBand'], keyof BrandCopy> = {
  under_3m: 'budgetUnder3m',
  '3m_10m': 'budget3mTo10m',
  '10m_30m': 'budget10mTo30m',
  over_30m: 'budgetOver30m',
  undecided: 'budgetUndecided',
};

function budgetLabel(copy: BrandCopy, band: BrandInquiry['budgetBand']): string {
  return copy[BUDGET_KEY[band]] as string;
}

function formatLabel(copy: BrandCopy, slug: string | null): string {
  if (slug === 'new') return copy.templateNew;
  if (slug === 'undecided' || slug === null) return copy.templateUndecided;
  return slug;
}

export function brandInquiryEmails(args: { inquiry: BrandInquiry; siteName: string; siteUrl: string; adminUrl: string }): { studio: EmailBody; brand: EmailBody } {
  const { inquiry, siteName } = args;
  const locale = inquiry.locale === 'ko' ? 'ko' : 'en';
  const copy = getDictionary(locale).campaigns.brands;
  // The studio reads Korean, whatever language the brand wrote in.
  const studioCopy = getDictionary('ko').campaigns.brands;
  const budget = budgetLabel(copy, inquiry.budgetBand);
  const format = formatLabel(copy, inquiry.templateSlug);

  const rows: Array<[string, string]> = [
    ['Company', inquiry.company],
    ['Contact', inquiry.contactName],
    ['Email', inquiry.email],
    ['Phone', inquiry.phone ?? '—'],
    ['Budget', budgetLabel(studioCopy, inquiry.budgetBand)],
    ['Format', formatLabel(studioCopy, inquiry.templateSlug)],
    ['Timing', inquiry.timing ?? '—'],
    ['Message', inquiry.message],
  ];
  const studioText = [`New brand enquiry — ${inquiry.company}`, '', ...rows.map(([k, v]) => `${k}: ${v}`), '', `Board: ${args.adminUrl}`].join('\n');
  const studio: EmailBody = {
    subject: `[${siteName}] 브랜드 의뢰 — ${inquiry.company} (${budgetLabel(studioCopy, inquiry.budgetBand)})`,
    html: sheet({
      title: `브랜드 의뢰 — ${inquiry.company}`,
      paragraphs: ['캠페인 페이지의 의뢰 폼으로 들어왔습니다. 담당자가 이메일로 회신해 주세요.'],
      rows,
      button: { label: '관리자 보드에서 열기', url: args.adminUrl },
      footer: `${siteName} · brand enquiry ${inquiry.id}`,
    }),
    text: studioText,
  };

  const r = copy.receipt;
  const received = interpolate(r.received, { name: inquiry.contactName, company: inquiry.company });
  const timing = inquiry.timing ?? r.timingNone;
  const brand: EmailBody = {
    subject: interpolate(r.subject, { site: siteName }),
    html: sheet({
      locale,
      title: r.title,
      paragraphs: [received, r.reply],
      rows: [
        [copy.fieldBudget, budget],
        [copy.fieldTemplate, format],
        [r.timing, timing],
      ],
      button: { label: r.cta, url: `${args.siteUrl}/${locale}/campaigns` },
      footer: `${siteName} · ${companyName(locale)} · ${r.footer}`,
    }),
    text: [received, r.reply, '', `${copy.fieldBudget}: ${budget}`, `${copy.fieldTemplate}: ${format}`, `${r.timing}: ${timing}`, '', BUSINESS.email].join('\n'),
  };

  return { studio, brand };
}
