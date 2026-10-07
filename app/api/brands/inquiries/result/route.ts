import { NextResponse } from 'next/server';
import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { brandEnquiryHref } from '@/lib/campaigns/links';
import { escapeHtml } from '@/lib/notify/templates';

/** A no-JavaScript receipt must be HTML in the response, not an effect on a static landing. */
export const dynamic = 'force-dynamic';
const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
type Outcome = 'sent' | 'invalid' | 'rate_limited' | 'unavailable';
const STATUS: Record<Outcome, number> = { sent: 200, invalid: 400, rate_limited: 429, unavailable: 503 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const locale = params.get('locale') === 'en' ? 'en' : 'ko';
  const dict = getDictionary(locale);
  const copy = dict.campaigns.brands;
  const requested = params.get('outcome');
  let outcome: Outcome = requested === 'sent' || requested === 'rate_limited' || requested === 'unavailable' ? requested : 'invalid';
  let id: string | null = null;
  let receipt = false;

  if (outcome === 'sent' && params.has('id')) {
    const candidate = params.get('id') ?? '';
    if (!UUID.test(candidate)) outcome = 'invalid';
    else {
      try {
        const sql = await getSqlRunner();
        // No contact details are even read by this public receipt route.
        const stored = sql ? (await sql.query<{ id: string; receipt_sent_at: string | Date | null }>(
          'select id, receipt_sent_at from brand_inquiries where id = $1::uuid', [candidate],
        )).rows[0] : null;
        if (!stored) outcome = 'unavailable';
        else { id = stored.id; receipt = stored.receipt_sent_at !== null; }
      } catch { outcome = 'unavailable'; }
    }
  }
  // The no-row honeypot response remains a generic success, as on the JSON endpoint.
  const title = outcome === 'sent' ? copy.successTitle : copy.formHeading;
  const body = outcome === 'sent' ? copy.successBody
    : outcome === 'invalid' ? copy.resultInvalid
      : outcome === 'rate_limited' ? copy.errRateLimited : copy.errUnavailable;
  const h = escapeHtml;
  const html = `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${h(title)} · ${h(dict.meta.siteName)}</title>
<style>body{margin:0;background:#fff;color:#171717;font-family:system-ui,sans-serif}main{max-width:40rem;margin:12vh auto;padding:2rem}p{line-height:1.7}h1{font-size:clamp(1.8rem,6vw,3rem);letter-spacing:-.04em}a{color:inherit;text-underline-offset:.25em}code{overflow-wrap:anywhere}footer{margin-top:2rem}</style></head>
<body><main data-brand-inquiry="${outcome}" role="${outcome === 'sent' ? 'status' : 'alert'}"><p>${h(dict.meta.siteName)}</p><h1>${h(title)}</h1><p>${h(body)}</p>
${receipt ? `<p data-brand-inquiry-receipt>${h(copy.successReceipt)}</p>` : ''}
${id ? `<p data-brand-inquiry-reference>${h(copy.referenceLabel)}: <code>${h(id)}</code></p>` : ''}
<footer><a href="${h(brandEnquiryHref(locale))}">${h(copy.resultBack)}</a></footer></main></body></html>`;
  return new NextResponse(html, { status: STATUS[outcome], headers: HEADERS });
}
