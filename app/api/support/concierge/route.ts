import { NextRequest, NextResponse, after } from 'next/server';
import { getSessionUser } from '@/lib/supabase/auth-client';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { displayNameOf, loadCreatorProfile } from '@/lib/creators/profile';
import { runLiveTeamNoticeDeliveryPass, syncSlackSupportReplies } from '@/lib/brands/team-notice-outbox';
import { conciergeUserScopeKey } from '@/lib/support/concierge-scope';
import { resolveRequestUrl, resolveSurface, sameOriginMutation } from '@/lib/routing/surfaces';
import {
  loadConsumerSupportThread,
  recordConsumerEscalation,
  sendDirectConsumerEscalationFallback,
} from '@/lib/support/concierge-service';
import {
  answerPersonalConciergeQuery,
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

async function afterResponse(task: () => Promise<unknown>): Promise<void> {
  const run = async () => {
    try {
      await task();
    } catch {
      // best effort
    }
  };
  try {
    after(run);
  } catch {
    await run();
  }
}

async function resolveAuthenticatedMember(
  sql: Awaited<ReturnType<typeof getSqlRunner>>,
): Promise<{
  userId: string;
  displayName: string | null;
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

  if (sql) {
    try {
      const profile = await loadCreatorProfile(sql, userId);
      if (profile?.displayName) displayName = profile.displayName;
    } catch {
      // Keep session metadata if DB lookup is unavailable
    }
  }

  return { userId, displayName };
}

export async function GET(request: NextRequest) {
  if (resolveSurface(new URL(request.url), request.headers) !== 'consumer') {
    return json({ ok: false, code: 'not_found' }, 404);
  }
  const sql = await getSqlRunner().catch(() => null);
  const member = await resolveAuthenticatedMember(sql);
  if (!member) {
    return json({ ok: false, signedIn: false, code: 'sign_in_required' }, 401);
  }
  const locale: ConciergeLocale = request.nextUrl.searchParams.get('locale') === 'en' ? 'en' : 'ko';

  let snapshot: Awaited<ReturnType<typeof loadConsumerSupportThread>> = {
    hasEscalation: false,
    replies: [],
    thread: [],
    latestStaffReplyAt: null,
  };
  if (sql) {
    try {
      await syncSlackSupportReplies(sql, { userId: member.userId });
      snapshot = await loadConsumerSupportThread(sql, member.userId, locale);
    } catch {
      // Keep GET safe even if DB read fails momentarily
    }
  }

  return json({
    ok: true,
    signedIn: true,
    userKey: conciergeUserScopeKey(member.userId),
    displayName: member.displayName,
    replies: snapshot.replies,
    hasEscalation: snapshot.hasEscalation,
    thread: snapshot.thread,
    latestStaffReplyAt: snapshot.latestStaffReplyAt,
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
    const sql = await getSqlRunner().catch(() => null);
    const member = await resolveAuthenticatedMember(sql);
    if (!member) {
      return json({ ok: false, stored: false, code: 'sign_in_required' }, 401);
    }

    const message = typeof body.message === 'string' ? body.message.trim().slice(0, 2000) : '';
    if (!message) {
      return json({ ok: false, stored: false, code: 'empty_message' }, 400);
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

    const requestId = typeof body.requestId === 'string' ? body.requestId : undefined;

    if (!sql) {
      return json({ ok: false, stored: false, code: 'storage_unavailable' }, 503);
    }

    const stored = await recordConsumerEscalation(sql, {
      userId: member.userId,
      displayName: member.displayName,
      reason,
      message,
      pagePath,
      transcript,
      requestId,
    });

    if (!stored.ok) {
      const status =
        stored.code === 'rate_limited'
          ? 429
          : stored.code === 'sign_in_required'
            ? 401
            : 400;
      return json({ ok: false, stored: false, code: stored.code }, status);
    }

    if (!stored.available) {
      // Deploy-order safety before 0178: try safe production-gated direct send; never fake success if unsent.
      const fallback = await sendDirectConsumerEscalationFallback({
        userId: member.userId,
        displayName: member.displayName,
        message,
        pagePath,
      });
      if (!fallback.sent) {
        return json({ ok: false, stored: false, code: 'delivery_unavailable' }, 503);
      }
      return json({
        ok: true,
        stored: false,
        delivered: true,
        ...(fallback.duplicate ? { duplicate: true } : {}),
        userKey: conciergeUserScopeKey(member.userId),
        displayName: member.displayName,
      });
    }

    await afterResponse(() =>
      runLiveTeamNoticeDeliveryPass(sql, {
        deliveryId: stored.deliveryId ?? undefined,
        sourceKind: 'concierge_escalation',
        sourceId: stored.id,
      }),
    );

    return json({
      ok: true,
      stored: true,
      id: stored.id,
      deliveryStatus: 'pending',
      userKey: conciergeUserScopeKey(member.userId),
      displayName: member.displayName,
    });
  }

  return json({ ok: false, code: 'invalid_operation' }, 400);
}
