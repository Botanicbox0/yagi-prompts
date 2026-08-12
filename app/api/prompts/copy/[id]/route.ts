import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { authorizePromptCopy } from '@/lib/prompts/access';
import { UPGRADE_PATH, signInHref } from '@/lib/billing/links';
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/config';
import { trackAsync } from '@/lib/events/server';

/**
 * `POST /api/prompts/copy/[id]` — PLAN §13.2/§13.3-5.
 *
 * This endpoint is what lets the gallery be **static**. A card cannot carry prompt text (it is
 * cached HTML shared by every tier), so "copy" has to be a request that arrives with the reader's
 * own session attached. One gate, one answer, every surface:
 *
 *   200  the text — a community prompt for anyone, a YAGI prompt for an entitled reader
 *   401  anonymous, and signing in is a step towards seeing it (Journey A); carries the sign-in URL
 *   403  signed in, not entitled; carries the upgrade URL and NOT one character of the prompt
 *   404  unknown id, or an item that is not published (pending / rejected / archived)
 *
 * POST rather than GET, for two independent reasons: it has a side effect (`copy_prompt`), and a
 * GET would be prefetchable, linkable and cacheable — three things a per-viewer answer must not be.
 * Every response is `private, no-store` + `noindex`, refusals included.
 */
export const dynamic = 'force-dynamic';

const HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: HEADERS });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  // The locale only decides which sign-in URL to hand back; it can never affect the gate.
  const raw = new URL(request.url).searchParams.get('locale');
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  const [sql, viewer] = await Promise.all([getSqlRunner(), getViewer()]);
  // No database ⇒ nothing is published ⇒ 404. Fail closed (the façades do the same).
  if (sql === null) return json({ error: 'not_found' }, 404);

  const decision = await authorizePromptCopy(sql, viewer, id);

  switch (decision.status) {
    case 'not_found':
      return json({ error: 'not_found' }, 404);
    case 'unauthorized':
      return json(
        { error: 'sign_in_required', signIn: signInHref(`/${locale}/prompts`, locale) },
        401,
      );
    case 'forbidden':
      return json({ error: 'pro_required', upgrade: `${UPGRADE_PATH}?locale=${locale}` }, 403);
    case 'ok': {
      // §13.2 — the conversion signal. Fire-and-forget: analytics may never sit on the critical
      // path of the thing it measures, and may never be able to fail it.
      trackAsync({
        type: 'copy_prompt',
        userId: viewer.userId,
        meta: { slug: decision.slug, surface: 'prompt', locale },
      });
      return json({ text: decision.text }, 200);
    }
  }
}
