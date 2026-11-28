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
import { deletionPassGate, runDeletionPass, type DeletionPassReport } from '@/lib/account/deletion';
import { liveDeletionDeps } from '@/lib/account/deletion-runtime';
import { sweepExpiredMakerWorkUploads } from '@/lib/makers/works';
import { getRenderStore } from '@/lib/renders/store';

/**
 * `GET|POST /api/renders/tick` — one pass of the render queue (docs/TEMPLATES-IA.md §8).
 *
 * Invoked by Vercel Cron (daily on the Hobby plan — `vercel.json`; per-minute once the project is
 * on Pro), by an operator with curl, and by nothing else that matters: the enqueue request, the
 * provider callback and the result page call the pass directly. When `CRON_SECRET` is set,
 * Vercel sends it as a bearer token and anything else is refused. When it is not set the tick is
 * open: the render, payment and exchange-rate steps are idempotent and a pass with nothing to do
 * changes nothing — but the account deletion pass is not harmless, and does not run without the
 * secret (`deletionPassGate`).
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
  // Abandoned presigned maker work uploads (`upl_*`, 0210): swept across all users independently of new presigns.
  let uploadSweep: { swept: number; pruned: number } | null = null;
  try { uploadSweep = await sweepExpiredMakerWorkUploads(sql, await getRenderStore()); }
  catch { console.warn('[maker-works] upload sweep failed'); }
  // Account deletion (docs/RUNBOOK-deletion.md): requests past their grace period, and cleanups left over.
  // After the render and payment passes on purpose, so an order they just settled no longer holds an account —
  // and not at all when that pass threw (a refund it owed may not have been sent) or when this tick is not
  // behind the cron secret. Counts only in the response and the log: no id, no address.
  let accountDeletion: DeletionPassReport | null = null;
  const deletionGate = deletionPassGate({ cronSecret: secret, renderPassOk: report !== null });
  if (deletionGate === 'run') {
    try { accountDeletion = await runDeletionPass(await liveDeletionDeps(sql)); }
    catch { console.warn('[account-deletion] pass failed'); }
  } else console.warn(`[account-deletion] ${JSON.stringify({ event: 'deletion_pass_skipped', reason: deletionGate })}`);
  const accountDeletionSkipped = deletionGate === 'run' ? null : deletionGate;
  if (accountDeletion && (accountDeletion.held > 0 || accountDeletion.failed > 0)) console.warn(`[account-deletion] ${JSON.stringify({ event: 'deletion_pass', ...accountDeletion })}`);
  if (report === null) return NextResponse.json({ ok: false, code: 'pass_failed', brandUsage, fxAlert, accountDeletion, accountDeletionSkipped }, { status: 503, headers: HEADERS });
  for (const line of report.errors) console.warn(`[renders] ${line}`);
  const { errors, ...counts } = report;
  // Presence only, never a value: which engines this deployment can actually reach.
  const config = { openai: openAiConfigFromEnv() !== null, ark: arkConfigFromEnv() !== null, arkAssets: arkAssetsConfigFromEnv() !== null };
  return NextResponse.json({ ok: true, summary: formatPassReport(report), report: counts, errorCount: errors.length, config, brandUsage, fxAlert, uploadSweep, accountDeletion, accountDeletionSkipped }, { headers: HEADERS });
}

export const GET = tick;
export const POST = tick;
