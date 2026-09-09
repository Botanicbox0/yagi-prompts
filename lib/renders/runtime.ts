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
    notifier: getRenderNotifier(),
    siteUrl: origin,
    callbackUrl: `${origin}/api/renders/callback`,
    assets: liveAssetsClient(),
  };
}

export async function runLiveRenderPass(sql: SqlRunner, options: RenderPassOptions = {}): Promise<RenderPassReport> {
  const report = await runRenderPass(await livePassDeps(sql), options);
  // One line per pass in the deployment's logs — the only trace an `after()` run leaves.
  if (report.claimed + report.succeeded + report.failed + report.requeued + report.waiting + report.notified + report.notifyFailed > 0 || report.errors.length > 0) {
    console.log(`[renders] pass${options.jobId ? ` ${options.jobId}` : ''} — ${formatPassReport(report)}`);
    for (const line of report.errors) console.warn(`[renders] ${line}`);
  }
  return report;
}

export function formatPassReport(report: RenderPassReport): string {
  return (
    `notifier ${report.notifier} · recovered ${report.recovered.requeued}/${report.recovered.failed} · claimed ${report.claimed} · ` +
    `succeeded ${report.succeeded} · failed ${report.failed} · requeued ${report.requeued} · waiting ${report.waiting} · ` +
    `notified ${report.notified} · notify failed ${report.notifyFailed} · notify pending ${report.notifyPending}`
  );
}
