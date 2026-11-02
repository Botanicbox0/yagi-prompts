import 'server-only';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { siteUrl } from '@/lib/seo/site-url';
import { liveAssetsClient } from '@/lib/identity/runtime';
import { getRenderNotifier } from './notify';
import { runRenderPass, type RenderPassDeps, type RenderPassOptions, type RenderPassReport } from './service';
import { getRenderStore } from './store';

/**
 * The pass, wired to the live environment — the one place the route handlers assemble it, so the
 * request that enqueues, the tick, the provider callback and the result page all run the same
 * thing with the same dependencies.
 */
export async function livePassDeps(sql: SqlRunner): Promise<RenderPassDeps> {
  const origin = siteUrl();
  return {
    sql,
    store: await getRenderStore(),
    notifier: getRenderNotifier(sql),
    siteUrl: origin,
    callbackUrl: `${origin}/api/renders/callback`,
    assets: liveAssetsClient(),
  };
}

export async function runLiveRenderPass(sql: SqlRunner, options: RenderPassOptions = {}): Promise<RenderPassReport> {
  const report = await runRenderPass(await livePassDeps(sql), options);
  const { payments } = report;
  if (report.yielded > 0) await continueInNewInvocation();
  // One line per pass in the deployment's logs — the only trace an `after()` run leaves.
  if (report.claimed + report.succeeded + report.failed + report.requeued + report.yielded + report.waiting + report.notified + report.notifyFailed > 0 || payments.confirmed + payments.refunded + payments.failed + payments.manual > 0 || report.errors.length > 0) {
    console.log(`[renders] pass${options.jobId ? ` ${options.jobId}` : ''} — ${formatPassReport(report)}`);
    for (const line of report.errors) console.warn(`[renders] ${line}`);
  }
  return report;
}

/**
 * A set that stopped between steps continues in a fresh function, whether or not anyone has the page
 * open. Only the start is awaited; if this call is lost, the owner's page or the cron claims the job.
 */
async function continueInNewInvocation(): Promise<void> {
  const secret = process.env.CRON_SECRET?.trim();
  try {
    await fetch(`${siteUrl()}/api/renders/tick`, { method: 'POST', headers: secret ? { authorization: `Bearer ${secret}` } : {}, signal: AbortSignal.timeout(10_000) });
  } catch { /* the timeout is the normal end of this call: the tick outlives it */ }
}

export function formatPassReport(report: RenderPassReport): string {
  return (
    `notifier ${report.notifier} · recovered ${report.recovered.requeued}/${report.recovered.failed} · claimed ${report.claimed} · ` +
    `succeeded ${report.succeeded} · failed ${report.failed} · requeued ${report.requeued} · yielded ${report.yielded} · waiting ${report.waiting} · ` +
    `notified ${report.notified} · notify failed ${report.notifyFailed} · notify pending ${report.notifyPending} · ` +
    `payments confirmed ${report.payments.confirmed} · refunded ${report.payments.refunded} · failed ${report.payments.failed} · manual ${report.payments.manual}`
  );
}
