import type { BrandInquiry } from './repo';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import { BUSINESS } from '@/lib/legal/documents';
import { companyName } from '@/lib/notify/company-line';

/**
 * The two messages an enquiry sends (2026-09-11): the studio's alert with everything the brand
 * typed, and the brand's receipt in their own language. Same sheet as the render mail
 * (lib/renders/email.ts): white card on light grey, one black button, grey meta. No tracking.
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

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sheet(args: { title: string; paragraphs: string[]; rows?: Array<[string, string]>; button?: { label: string; url: string } | null; footer: string }): string {
  const rows = (args.rows ?? [])
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#71717a;font-size:13px;vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:6px 0;font-size:14px;color:#18181b;white-space:pre-wrap">${escapeHtml(v)}</td></tr>`,
    )
    .join('');
  const button = args.button
    ? `<p style="margin:28px 0 0"><a href="${escapeHtml(args.button.url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;border-radius:999px;padding:12px 22px;font-size:14px;font-weight:600">${escapeHtml(args.button.label)}</a></p>`
    : '';
  return [
    '<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,\'Pretendard\',sans-serif;color:#18181b">',
    '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:36px 32px">',
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${escapeHtml(args.title)}</h1>`,
    ...args.paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6">${escapeHtml(p)}</p>`),
    rows ? `<table style="border-collapse:collapse;margin-top:16px">${rows}</table>` : '',
    button,
    `<p style="margin:32px 0 0;font-size:12px;color:#a1a1aa;line-height:1.5">${escapeHtml(args.footer)}</p>`,
    '</div></body></html>',
  ].join('');
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
