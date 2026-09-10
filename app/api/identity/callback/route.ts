import { after, NextResponse } from 'next/server';
import { getSqlRunner } from '@/lib/db/connect';
import { liveIdentityDeps } from '@/lib/identity/runtime';
import { completeIdentityVerification } from '@/lib/identity/service';
import { runLiveRenderPass } from '@/lib/renders/runtime';
import { releaseHeldRendersFor } from '@/lib/renders/service';

/**
 * `/api/identity/callback` — where BytePlus's liveness page sends the person when they are done
 * (docs/TEMPLATES-IA.md §8.2). The query carries `bytedToken` and `resultCode`; nothing in it is
 * trusted beyond the token, which we exchange with the bank for the group id ourselves. The
 * answer is always a redirect to the verify page, which reads the row and says what happened.
 */
export const dynamic = 'force-dynamic';

const HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

async function handle(params: URLSearchParams): Promise<NextResponse> {
  const sql = await getSqlRunner();
  const outcome = sql === null ? { status: 'unknown' as const, userId: null, nextPath: null } : await completeIdentityVerification(liveIdentityDeps(sql), params);

  if (outcome.status === 'active' && sql !== null && outcome.userId !== null) {
    // Verified: every render this person left waiting behind the check starts now, and the person
    // lands straight where they were going (their job's page, or the template) — no detour.
    const released = await releaseHeldRendersFor(sql, outcome.userId);
    if (released.length > 0) {
      after(async () => {
        try {
          await runLiveRenderPass(sql, { limit: released.length });
        } catch (error) {
          console.error('[identity] pass after release failed', error);
        }
      });
    }
    if (outcome.nextPath) return new NextResponse(null, { status: 303, headers: { ...HEADERS, Location: outcome.nextPath } });
  }

  const target = new URL('/identity/verify', 'http://placeholder');
  target.searchParams.set('result', outcome.status);
  if (outcome.nextPath) target.searchParams.set('next', outcome.nextPath);
  return new NextResponse(null, { status: 303, headers: { ...HEADERS, Location: `${target.pathname}${target.search}` } });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(new URL(request.url).searchParams);
}

/** Some H5 flows post the result instead; the same fields, read from the form. */
export async function POST(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  try {
    const form = await request.formData();
    for (const [key, value] of form.entries()) if (typeof value === 'string' && !params.has(key)) params.set(key, value);
  } catch {
    // No form body — the query alone decides.
  }
  return handle(params);
}
