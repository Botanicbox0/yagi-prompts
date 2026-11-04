import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/supabase/auth-client';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { displayNameOf, loadCreatorProfile } from '@/lib/creators/profile';
import { resolveRequestUrl, resolveSurface, sameOriginMutation } from '@/lib/routing/surfaces';
import {
  answerPersonalConciergeQuery,
  fetchSlackPersonalConciergeReplies,
  notifySlackPersonalConcierge,
  personalSlackHandle,
  type ConciergeLocale,
  type ConciergeTranscriptTurn,
  type EscalationReason,
} from '@/lib/support/personal-concierge';

export const dynamic = 'force-dynamic';

const HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  Vary: 'Cookie',
};

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: HEADERS });
}

async function resolveAuthenticatedMember(): Promise<{
  userId: string;
  displayName: string | null;
  email: string | null;
} | null> {
  const user = await getSessionUser();
  let devId: string | null = null;
  if (!user && process.env.NODE_ENV === 'development') {
    try {
      devId = (await getViewer()).userId;
    } catch {
      // Ignore unavailable local profile
    }
  }
  const userId = user?.id ?? devId;
  if (!userId) return null;

  let displayName =
    displayNameOf(user?.user_metadata?.full_name) ??
    displayNameOf(user?.user_metadata?.name) ??
    null;
  let email = typeof user?.email === 'string' ? user.email : null;

  try {
    const sql = await getSqlRunner();
    if (sql) {
      const profile = await loadCreatorProfile(sql, userId);
      if (profile?.displayName) displayName = profile.displayName;
      if (!email) {
        const row = (
          await sql.query<{ email?: string }>('select email from profiles where id=$1', [userId])
        ).rows[0];
        if (row?.email) email = String(row.email);
      }
    }
  } catch {
    // Keep session metadata if DB lookup is unavailable
  }

  return { userId, displayName, email };
}

export async function GET(request: NextRequest) {
  if (resolveSurface(new URL(request.url), request.headers) !== 'consumer') {
    return json({ ok: false, code: 'not_found' }, 404);
  }
  const member = await resolveAuthenticatedMember();
  if (!member) {
    return json({ ok: false, signedIn: false, code: 'sign_in_required' }, 401);
  }

  const replies = await fetchSlackPersonalConciergeReplies({
    userId: member.userId,
    displayName: member.displayName,
    email: member.email,
  });

  return json({
    ok: true,
    signedIn: true,
    displayName: member.displayName,
    handle: personalSlackHandle(member.displayName, member.email, member.userId),
    replies,
  });
}

export async function POST(request: NextRequest) {
  const requestUrl = new URL(request.url);
  if (resolveSurface(requestUrl, request.headers) !== 'consumer') {
    return json({ ok: false, code: 'not_found' }, 404);
  }
  const origin = resolveRequestUrl(requestUrl, request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers)) {
    return json({ ok: false, code: 'forbidden' }, 403);
  }

  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 32768) {
      return json({ ok: false, code: 'payload_too_large' }, 413);
    }
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return json({ ok: false, code: 'invalid_json' }, 400);
  }

  const operation = typeof body.operation === 'string' ? body.operation : 'ask';
  const locale: ConciergeLocale = body.locale === 'en' ? 'en' : 'ko';

  if (operation === 'ask') {
    const query = typeof body.query === 'string' ? body.query.slice(0, 1000) : '';
    const result = answerPersonalConciergeQuery({ query, locale });
    return json({ ok: true, result });
  }

  if (operation === 'escalate') {
    // Human escalation strictly requires login
    const member = await resolveAuthenticatedMember();
    if (!member) {
      return json({ ok: false, code: 'sign_in_required' }, 401);
    }

    const message = typeof body.message === 'string' ? body.message.trim().slice(0, 2000) : '';
    if (!message) {
      return json({ ok: false, code: 'empty_message' }, 400);
    }

    const rawReason = body.reason;
    const reason: EscalationReason =
      rawReason === 'user_requested_human' ||
      rawReason === 'account_or_billing_check' ||
      rawReason === 'ai_unanswered'
        ? rawReason
        : 'user_requested_human';

    const pagePath =
      typeof body.pagePath === 'string' && body.pagePath.startsWith('/')
        ? body.pagePath.slice(0, 200)
        : undefined;

    const rawTranscript = Array.isArray(body.transcript) ? body.transcript : [];
    const transcript: ConciergeTranscriptTurn[] = rawTranscript
      .slice(-6)
      .filter(
        (item): item is { role: 'user' | 'ai' | 'human_agent'; text: string } =>
          Boolean(
            item &&
              typeof item === 'object' &&
              (('role' in item && item.role === 'user') ||
                ('role' in item && item.role === 'ai') ||
                ('role' in item && item.role === 'human_agent')) &&
              'text' in item &&
              typeof item.text === 'string',
          ),
      )
      .map((item) => ({
        role: item.role,
        text: item.text.slice(0, 400),
      }));

    const slackOutcome = await notifySlackPersonalConcierge({
      userId: member.userId,
      displayName: member.displayName,
      email: member.email,
      reason,
      message,
      pagePath,
      transcript,
    });

    return json({
      ok: true,
      slackSent: slackOutcome.sent,
      handle: personalSlackHandle(member.displayName, member.email, member.userId),
      displayName: member.displayName,
    });
  }

  return json({ ok: false, code: 'invalid_operation' }, 400);
}
