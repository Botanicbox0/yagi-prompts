import { after, NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getMailer } from '@/lib/notify/service';
import { siteUrl } from '@/lib/seo/site-url';
import { BRANDS_ANCHOR, campaignsHref } from '@/lib/campaigns/links';
import { notifyBrandStudio, sendBrandInquiryReceipt, submitBrandInquiry } from '@/lib/brands/service';

/**
 * `POST /api/brands/inquiries` — the brand form on the campaigns page (components/campaigns/brand-form.tsx).
 *
 * Two shapes of the same request:
 *   · JSON from the hydrated form → a small JSON answer, and the island swaps itself for the receipt;
 *   · a plain form post (the submit landed before hydration, or JavaScript is off) → a 303 back to
 *     the campaigns page with `?inquiry=…#brands`, which the island reads on mount. Either way the
 *     page stays static, and no field ever travels in a GET.
 *
 * The row is written inside the request, then the brand's receipt is sent and its outcome is part
 * of the answer (`receipt`), so the success panel only claims a confirmation mail that went out
 * (audit Q7). The studio's alert goes out in `after()`. A slow or absent mail provider can never
 * fail an enquiry that has already been recorded.
 */
export const dynamic = 'force-dynamic';

const HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

type Outcome = 'sent' | 'invalid' | 'rate_limited' | 'unavailable';
const STATUS: Record<Outcome, number> = { sent: 201, invalid: 400, rate_limited: 429, unavailable: 503 };

function isLocale(value: unknown): value is 'en' | 'ko' {
  return value === 'en' || value === 'ko';
}

/** Read whichever body the browser sent. A form post's checkbox arrives as "on"; the schema wants `true`. */
async function readBody(request: Request): Promise<{ body: unknown; form: boolean }> {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/json')) return { body: await request.json(), form: false };
  const data = await request.formData();
  const body: Record<string, unknown> = {};
  for (const [key, value] of data.entries()) if (typeof value === 'string') body[key] = value;
  body.consent = data.get('consent') === 'on' || data.get('consent') === 'true';
  return { body, form: true };
}

function answer(args: { form: boolean; locale: 'en' | 'ko'; outcome: Outcome; field?: string; origin: string; receipt?: boolean }): NextResponse {
  if (!args.form) {
    const payload = args.outcome === 'sent' ? { ok: true, receipt: args.receipt === true } : { ok: false, code: args.outcome, ...(args.field ? { field: args.field } : {}) };
    return NextResponse.json(payload, { status: STATUS[args.outcome], headers: HEADERS });
  }
  const target = new URL(campaignsHref(args.locale), args.origin);
  target.searchParams.set('inquiry', args.outcome);
  if (args.field) target.searchParams.set('field', args.field);
  if (args.outcome === 'sent' && args.receipt === true) target.searchParams.set('receipt', '1');
  target.hash = BRANDS_ANCHOR;
  return new NextResponse(null, { status: 303, headers: { ...HEADERS, Location: target.toString() } });
}

export async function POST(request: Request): Promise<NextResponse> {
  const origin = new URL(request.url).origin;
  let body: unknown;
  let form = false;
  try {
    ({ body, form } = await readBody(request));
  } catch {
    return answer({ form: false, locale: 'ko', outcome: 'invalid', origin });
  }
  const locale = isLocale((body as { locale?: unknown } | null)?.locale) ? (body as { locale: 'en' | 'ko' }).locale : 'ko';

  const sql = await getSqlRunner();
  if (sql === null) return answer({ form, locale, outcome: 'unavailable', origin });

  // Signed-in brands leave a trail to their account; nobody has to be signed in to ask.
  const viewer = await getViewer().catch(() => null);
  const result = await submitBrandInquiry({ sql }, body, viewer?.userId ?? null);
  if (!result.ok) return answer({ form, locale, outcome: result.code, ...(result.field ? { field: result.field } : {}), origin });

  const inquiry = result.inquiry;
  let receipt = false;
  if (inquiry !== null) {
    const deps = { mailer: getMailer(), siteUrl: siteUrl(), siteName: getDictionary(inquiry.locale).meta.siteName };
    // Audit Q7: the brand's receipt goes out inside the request so the answer can say whether it
    // did. The row is already stored; a failed or absent mailer only drops the receipt sentence.
    receipt = await sendBrandInquiryReceipt(deps, inquiry).catch((error: unknown) => {
      console.error(`[brands] receipt for inquiry ${inquiry.id} failed`, error);
      return false;
    });
    after(async () => {
      try {
        const studio = await notifyBrandStudio(deps, inquiry);
        console.info(`[brands] inquiry ${inquiry.id} mail studio=${studio?.ok ?? 'skipped'} brand=${receipt}`);
      } catch (error) {
        console.error(`[brands] mail after inquiry ${inquiry.id} failed`, error);
      }
    });
  }
  return answer({ form, locale, outcome: 'sent', origin, receipt });
}
