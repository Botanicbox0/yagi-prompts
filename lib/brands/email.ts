import type { BrandInquiry } from './repo';

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

const BUDGET_LABEL: Record<BrandInquiry['budgetBand'], { ko: string; en: string }> = {
  under_3m: { ko: '300만원 미만', en: 'Under KRW 3M' },
  '3m_10m': { ko: '300만원 ~ 1,000만원', en: 'KRW 3M to 10M' },
  '10m_30m': { ko: '1,000만원 ~ 3,000만원', en: 'KRW 10M to 30M' },
  over_30m: { ko: '3,000만원 이상', en: 'Over KRW 30M' },
  undecided: { ko: '미정', en: 'Not decided' },
};

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
  const ko = inquiry.locale === 'ko';
  const budget = BUDGET_LABEL[inquiry.budgetBand][ko ? 'ko' : 'en'];
  const format = inquiry.templateSlug === 'new' ? (ko ? '브랜드 전용 장면 제작' : 'A brand-only scene') : inquiry.templateSlug === 'undecided' || inquiry.templateSlug === null ? (ko ? '상담 후 결정' : 'Decide after a call') : inquiry.templateSlug;

  const rows: Array<[string, string]> = [
    ['Company', inquiry.company],
    ['Contact', inquiry.contactName],
    ['Email', inquiry.email],
    ['Phone', inquiry.phone ?? '—'],
    ['Budget', BUDGET_LABEL[inquiry.budgetBand].ko],
    ['Format', format],
    ['Timing', inquiry.timing ?? '—'],
    ['Message', inquiry.message],
  ];
  const studioText = [`New brand enquiry — ${inquiry.company}`, '', ...rows.map(([k, v]) => `${k}: ${v}`), '', `Board: ${args.adminUrl}`].join('\n');
  const studio: EmailBody = {
    subject: `[${siteName}] 브랜드 의뢰 — ${inquiry.company} (${budget})`,
    html: sheet({
      title: `브랜드 의뢰 — ${inquiry.company}`,
      paragraphs: ['캠페인 페이지의 의뢰 폼으로 들어왔습니다. 1영업일 안에 회신하기로 약속한 건입니다.'],
      rows,
      button: { label: '관리자 보드에서 열기', url: args.adminUrl },
      footer: `${siteName} · brand enquiry ${inquiry.id}`,
    }),
    text: studioText,
  };

  const brand: EmailBody = ko
    ? {
        subject: `${siteName} — 캠페인 의뢰를 받았습니다`,
        html: sheet({
          title: '의뢰를 받았습니다.',
          paragraphs: [
            `${inquiry.contactName}님, ${inquiry.company}의 캠페인 의뢰가 접수됐습니다.`,
            '담당자가 1영업일 안에 이 주소로 회신합니다. 급한 건은 hello@yagiworkshop.xyz로 바로 보내 주세요.',
          ],
          rows: [
            ['예산대', budget],
            ['희망 포맷', format],
            ['희망 시기', inquiry.timing ?? '미정'],
          ],
          button: { label: '캠페인 페이지 보기', url: `${args.siteUrl}/ko/campaigns` },
          footer: `${siteName} · 야기워크숍 주식회사 · 이 메일은 의뢰 접수 확인용으로 한 번만 발송됩니다.`,
        }),
        text: [`${inquiry.contactName}님, ${inquiry.company}의 캠페인 의뢰가 접수됐습니다.`, '담당자가 1영업일 안에 이 주소로 회신합니다.', '', `예산대: ${budget}`, `희망 포맷: ${format}`, `희망 시기: ${inquiry.timing ?? '미정'}`, '', 'hello@yagiworkshop.xyz'].join('\n'),
      }
    : {
        subject: `${siteName} — we received your campaign enquiry`,
        html: sheet({
          title: 'Enquiry received.',
          paragraphs: [
            `${inquiry.contactName}, the campaign enquiry for ${inquiry.company} is in.`,
            'Someone from the studio replies to this address within one business day. If it is urgent, write to hello@yagiworkshop.xyz.',
          ],
          rows: [
            ['Budget', budget],
            ['Format', format],
            ['Timing', inquiry.timing ?? 'Not decided'],
          ],
          button: { label: 'See the campaigns page', url: `${args.siteUrl}/en/campaigns` },
          footer: `${siteName} · YAGI WORKSHOP Inc. · Sent once, to confirm this enquiry.`,
        }),
        text: [`${inquiry.contactName}, the campaign enquiry for ${inquiry.company} is in.`, 'Someone from the studio replies within one business day.', '', `Budget: ${budget}`, `Format: ${format}`, `Timing: ${inquiry.timing ?? 'Not decided'}`, '', 'hello@yagiworkshop.xyz'].join('\n'),
      };

  return { studio, brand };
}
