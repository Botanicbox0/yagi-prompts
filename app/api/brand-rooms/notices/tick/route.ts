import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSqlRunner } from '@/lib/db/connect';
import { roomNoticesOpen, runLiveRoomNoticePass } from '@/lib/brand-rooms/notices';
import { runLiveTeamNoticeDeliveryPass, syncSlackSupportReplies } from '@/lib/brands/team-notice-outbox';
import { purgeExpiredConsumerTranscripts } from '@/lib/support/concierge-service';

/**
 * `GET|POST /api/brand-rooms/notices/tick` — 10-minute cron pass (`vercel.json`) with isolated,
 * budget-bounded passes (F2):
 *   1. project room email/push notices (`runLiveRoomNoticePass`, when `BRAND_ROOM_NOTIFY=on` & `BRAND_ROOMS=on`)
 *   2. durable internal team Slack notices (`runLiveTeamNoticeDeliveryPass`, retries + backoff up to 8 attempts)
 *   3. Slack thread reply sync (`syncSlackSupportReplies`, bot transport only, 7-day round-robin + cursor)
 *   4. consumer privacy transcript purge (`purgeExpiredConsumerTranscripts`, 365-day retention)
 *
 * Each pass runs inside its own try/catch so a failure in one pass never blocks any other pass.
 * Stops claiming new work once the overall budget (`TICK_BUDGET_MS`, well under `maxDuration = 60`)
 * is reached. Counts and pass health only in JSON.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const TICK_BUDGET_MS = 45_000;
const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

async function tick(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ ok: false, code: 'unconfigured' }, { status: 503, headers: HEADERS });
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get('authorization') ?? '');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return NextResponse.json({ ok: false, code: 'unauthorized' }, { status: 401, headers: HEADERS });
  }
  const roomsEnabled = roomNoticesOpen();
  const sql = await getSqlRunner().catch(() => null);
  if (!sql) return NextResponse.json({ ok: false, code: 'unavailable' }, { status: 503, headers: HEADERS });

  const deadlineAtMs = Date.now() + TICK_BUDGET_MS;
  let passesAttempted = 0;
  let passesFailed = 0;

  // --- Pass 1 (isolated): Project room notices ---
  let roomPass: { enabled: boolean; ok: boolean; ran?: boolean; mails?: number; sent?: number; expired?: number } = {
    enabled: roomsEnabled,
    ok: true,
    ran: false,
  };
  let roomReport: Awaited<ReturnType<typeof runLiveRoomNoticePass>> | null = null;
  if (roomsEnabled) {
    passesAttempted += 1;
    try {
      roomReport = await runLiveRoomNoticePass(sql);
      roomPass = {
        enabled: true,
        ok: true,
        ran: roomReport.ran,
        mails: roomReport.mails,
        sent: roomReport.sent,
      };
    } catch (error) {
      passesFailed += 1;
      roomPass = { enabled: true, ok: false };
      console.warn(
        '[brand-rooms] room_notice_tick_failed',
        JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }),
      );
    }
  }

  // --- Pass 2 (isolated, budget-bounded): Durable team notice outbox ---
  let teamPass: {
    ok: boolean;
    claimed?: number;
    sent?: number;
    deferred?: number;
    failed?: number;
    recovered?: number;
    budgetExhausted?: boolean;
  } = { ok: true };
  let teamNotices: Awaited<ReturnType<typeof runLiveTeamNoticeDeliveryPass>> | null = null;
  if (Date.now() < deadlineAtMs) {
    passesAttempted += 1;
    try {
      teamNotices = await runLiveTeamNoticeDeliveryPass(sql, { limit: 20, deadlineAtMs });
      teamPass = {
        ok: true,
        claimed: teamNotices.claimed,
        sent: teamNotices.sent,
        deferred: teamNotices.deferred,
        failed: teamNotices.failed,
        recovered: teamNotices.recovered,
        ...(teamNotices.budgetExhausted ? { budgetExhausted: true } : {}),
      };
    } catch (error) {
      passesFailed += 1;
      teamPass = { ok: false };
      console.warn(
        '[support-slack] team_notice_tick_failed',
        JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }),
      );
    }
  }

  // --- Pass 3 (isolated, budget-bounded): Slack bot thread reply sync ---
  let replySyncPass: {
    ok: boolean;
    checked?: number;
    synced?: number;
    errors?: number;
    budgetExhausted?: boolean;
  } = { ok: true };
  let replySync: Awaited<ReturnType<typeof syncSlackSupportReplies>> | null = null;
  if (Date.now() < deadlineAtMs) {
    passesAttempted += 1;
    try {
      replySync = await syncSlackSupportReplies(sql, { force: true, limit: 20, deadlineAtMs });
      replySyncPass = {
        ok: true,
        checked: replySync.checked,
        synced: replySync.synced,
        errors: replySync.errors.length,
        ...(replySync.budgetExhausted ? { budgetExhausted: true } : {}),
      };
    } catch (error) {
      passesFailed += 1;
      replySyncPass = { ok: false };
      console.warn(
        '[support-slack] reply_sync_tick_failed',
        JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }),
      );
    }
  }

  // --- Pass 4 (isolated, budget-bounded): Consumer privacy transcript retention purge ---
  let retentionPass: { ok: boolean; purged: number; scrubbedNotices?: number } = { ok: true, purged: 0 };
  let scrubbedNotices = 0;
  if (Date.now() < deadlineAtMs) {
    passesAttempted += 1;
    try {
      const retention = await purgeExpiredConsumerTranscripts(sql, { limit: 100, deadlineAtMs });
      scrubbedNotices = retention.scrubbedNotices;
      retentionPass = {
        ok: true,
        purged: retention.purged,
        ...(retention.scrubbedNotices > 0 ? { scrubbedNotices: retention.scrubbedNotices } : {}),
      };
    } catch (error) {
      passesFailed += 1;
      retentionPass = { ok: false, purged: 0 };
      console.warn(
        '[support-concierge] retention_purge_failed',
        JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }),
      );
    }
  }

  // --- Pass 5 (reserved independent pass slot): Reservation expiry pass (future branch merge) ---

  if (passesAttempted > 0 && passesFailed === passesAttempted) {
    return NextResponse.json(
      {
        ok: false,
        code: 'pass_failed',
        passes: { rooms: roomPass, teamNotices: teamPass, replySync: replySyncPass, retention: retentionPass },
      },
      { status: 503, headers: HEADERS },
    );
  }

  if (!roomsEnabled && passesFailed === 0) {
    const didOtherWork =
      Boolean(
        teamNotices && (teamNotices.claimed > 0 || teamNotices.sent > 0 || teamNotices.recovered > 0),
      ) ||
      Boolean(replySync && replySync.synced > 0) ||
      retentionPass.purged > 0 ||
      scrubbedNotices > 0;
    if (!didOtherWork) {
      return NextResponse.json({ ok: true, ran: false }, { headers: HEADERS });
    }
  }

  return NextResponse.json(
    {
      ok: true,
      ...(roomReport ?? {}),
      passes: { rooms: roomPass, teamNotices: teamPass, replySync: replySyncPass, retention: retentionPass },
      teamNotices,
      replySync: replySync
        ? { checked: replySync.checked, synced: replySync.synced, errors: replySync.errors.length }
        : null,
      retention: retentionPass,
    },
    { headers: HEADERS },
  );
}

export const GET = tick;
export const POST = tick;
