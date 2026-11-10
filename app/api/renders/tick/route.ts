import { NextResponse } from 'next/server';
import { arkAssetsConfigFromEnv } from '@/lib/ark/assets';
import { arkConfigFromEnv } from '@/lib/ark/client';
import { getSqlRunner } from '@/lib/db/connect';
import { openAiConfigFromEnv } from '@/lib/images/openai';
import { formatPassReport, runLiveRenderPass } from '@/lib/renders/runtime';
import type { RenderPassReport } from '@/lib/renders/service';
import { getTossGateway } from '@/lib/billing/toss-gateway';
import { reconcileBrandUsagePayments } from '@/lib/brands/usage/payment';
import { runLiveFxThresholdAlertCheck, type FxThresholdAlertPassReport } from '@/lib/twings/fx-rate-alert';

/**
 * `GET|POST /api/renders/tick` — one pass of the render queue (docs/TEMPLATES-IA.md §8).
 *
 * Invoked by Vercel Cron (daily on the Hobby plan — `vercel.json`; per-minute once the project is
 * on Pro), by an operator with curl, and by nothing else that matters: the enqueue request, the
 * provider callback and the result page call the pass directly. When `CRON_SECRET` is set,
 * Vercel sends it as a bearer token and anything else is refused; when it is not set, the tick
 * is open but harmless — every step is idempotent and a pass with nothing to do changes nothing.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

async function tick(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const auth = request.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, code: 'unauthorized' }, { status: 401, headers: HEADERS });
    }
  }
  const sql = await getSqlRunner();
  if (sql === null) return NextResponse.json({ ok: false, code: 'unavailable' }, { status: 503, headers: HEADERS });

  // A failed pass must not take the secondary-usage recovery down with it (docs/PLATFORM-2.0.md §2.2-3).
  let report: RenderPassReport | null = null;
  try { report = await runLiveRenderPass(sql, { limit: 5 }); }
  catch (error) { console.error(`[renders] ${JSON.stringify({ event: 'render_pass_failed', code: error instanceof Error ? error.name : 'unknown' })}`); }
  // Secondary-usage payments (docs/SECONDARY-USAGE.md): durable recovery of lost confirmations, unfinished
  // activation and admin-requested refunds, with no page load. Independent of any render or public flag.
  let brandUsage: { checked: number } | null = null;
  try { const gateway = getTossGateway(); if (gateway) brandUsage = await reconcileBrandUsagePayments({ sql, gateway }); }
  catch { console.warn('[brand-usage] reconcile pass failed'); }
  // Daily USD/KRW > 1,400원 threshold guard: sends 1 email/day to founder if exchange rate crosses 1,400 KRW.
  let fxAlert: FxThresholdAlertPassReport | null = null;
  try { fxAlert = await runLiveFxThresholdAlertCheck(); }
  catch { console.warn('[fx-alert] USD/KRW threshold check failed'); }
  if (report === null) return NextResponse.json({ ok: false, code: 'pass_failed', brandUsage, fxAlert }, { status: 503, headers: HEADERS });
  for (const line of report.errors) console.warn(`[renders] ${line}`);
  const { errors, ...counts } = report;
  // Presence only, never a value: which engines this deployment can actually reach.
  const config = { openai: openAiConfigFromEnv() !== null, ark: arkConfigFromEnv() !== null, arkAssets: arkAssetsConfigFromEnv() !== null };
  return NextResponse.json({ ok: true, summary: formatPassReport(report), report: counts, errorCount: errors.length, config, brandUsage, fxAlert }, { headers: HEADERS });
}

export const GET = tick;
export const POST = tick;
