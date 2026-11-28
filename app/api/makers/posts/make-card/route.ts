import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { isSameOrigin } from '@/lib/billing/toss-runtime';
import { PROMPTS_TAG, revalidateMakerProfile } from '@/lib/cache';
import { readBoundedBody } from '@/lib/creator-subscriptions/http';
import { getSqlRunner } from '@/lib/db/connect';
import { creativeGate } from '@/lib/makers/access';
import { loadMakerSettings } from '@/lib/makers/profile';
import { makerBlogOpen } from '@/lib/posts/flag';
import { createUnlistedMakeCard } from '@/lib/posts/make-card';
import { PostError } from '@/lib/posts/repo';
import { loadPromptCardsBySlugs } from '@/lib/prompts/catalog';
import { selfPublishOpen } from '@/lib/recipes/self-publish';
import { getRenderStore } from '@/lib/renders/store';
import { getStorage } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });

const STATUS: Record<string, number> = {
  not_open: 404,
  sign_in_required: 401,
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  rights_required: 400,
  invalid_work: 400,
  test_required: 409,
  limit_reached: 429,
  unavailable: 503,
};

export async function POST(request: Request) {
  if (!makerBlogOpen() || !selfPublishOpen()) return json({ ok: false, code: 'not_open' }, 404);
  if (!isSameOrigin(request)) return json({ ok: false, code: 'forbidden' }, 403);

  const viewer = await getViewer();
  if (!viewer.userId) return json({ ok: false, code: 'sign_in_required' }, 401);

  const sql = await getSqlRunner();
  if (!sql) return json({ ok: false, code: 'unavailable' }, 503);

  const gate = await creativeGate(sql, viewer.userId);
  if (!gate.ok) return json({ ok: false, code: gate.code }, STATUS[gate.code] ?? 403);

  const bytes = await readBoundedBody(request, 64_000);
  if (!bytes) return json({ ok: false, code: 'too_large' }, 413);

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return json({ ok: false, code: 'invalid' }, 400);
  }

  try {
    const [store, storage] = await Promise.all([getRenderStore(), getStorage()]);
    const created = await createUnlistedMakeCard({ sql, store, storage }, gate.userId, body);
    const [cards, settings] = await Promise.all([
      loadPromptCardsBySlugs(sql, [created.slug]),
      loadMakerSettings(sql, gate.userId).catch(() => null),
    ]);
    revalidateTag(PROMPTS_TAG);
    if (settings?.handle) revalidateMakerProfile([settings.handle]);

    return json(
      {
        ok: true,
        slug: created.slug,
        title: cards[0]?.title ?? '',
        card: cards[0] ?? null,
      },
      201,
    );
  } catch (error) {
    if (error instanceof PostError) {
      const code = error.detail ?? error.code;
      return json({ ok: false, code }, STATUS[error.code] ?? 400);
    }
    return json({ ok: false, code: 'unavailable' }, 503);
  }
}
