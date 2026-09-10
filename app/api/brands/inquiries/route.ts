import { after, NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getMailer } from '@/lib/notify/service';
import { siteUrl } from '@/lib/seo/site-url';
import { BRANDS_ANCHOR, campaignsHref } from '@/lib/campaigns/links';
import { notifyBrandInquiry, submitBrandInquiry } from '@/lib/brands/service';

/**
 * `POST /api/brands/inquiries` — the brand form on the campaigns page (components/campaigns/brand-form.tsx).
 *
 * Two shapes of the same request:
 *   · JSON from the hydrated form → a small JSON answer, and the island swaps itself for the receipt;
 *   · a plain form post (the submit landed before hydration, or JavaScript is off) → a 303 back to
 *     the campaigns page with `?inquiry=…#brands`, which the island reads on mount. Either way the
 *     page stays static, and no field ever travels in a GET.
 *
 * The row is written inside the request; the two mails (the studio's alert, the brand's receipt)
 * go out in `after()`, so a slow or absent mail provider can neither delay nor fail an enquiry
 * that has already been recorded.
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

function answer(args: { form: boolean; locale: 'en' | 'ko'; outcome: Outcome; field?: string; origin: string }): NextResponse {
  if (!args.form) {
    const payload = args.outcome === 'sent' ? { ok: true } : { ok: false, code: args.outcome, ...(args.field ? { field: args.field } : {}) };
    return NextResponse.json(payload, { status: STATUS[args.outcome], headers: HEADERS });
  }
  const target = new URL(campaignsHref(args.locale), args.origin);
  target.searchParams.set('inquiry', args.outcome);
  if (args.field) target.searchParams.set('field', args.field);
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
  if (inquiry !== null) {
    after(async () => {
      try {
        const outcome = await notifyBrandInquiry(
          { mailer: getMailer(), siteUrl: siteUrl(), siteName: getDictionary(inquiry.locale).meta.siteName },
          inquiry,
        );
        console.info(`[brands] inquiry ${inquiry.id} mail studio=${outcome.studio?.ok ?? 'skipped'} brand=${outcome.brand?.ok ?? 'skipped'}`);
      } catch (error) {
        console.error(`[brands] mail after inquiry ${inquiry.id} failed`, error);
      }
    });
  }
  return answer({ form, locale, outcome: 'sent', origin });
}
