import { after, NextResponse } from 'next/server';
import { portraitDeps } from '@/lib/identity/portrait-runtime';
import { runPortraitPass } from '@/lib/identity/portrait-service';
import { arkAssetsConfigFromEnv } from '@/lib/ark/assets';
import { arkConfigFromEnv } from '@/lib/ark/client';
import { getSqlRunner } from '@/lib/db/connect';
import { openAiConfigFromEnv } from '@/lib/images/openai';
import { formatPassReport, runLiveRenderPass } from '@/lib/renders/runtime';

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

  const report = await runLiveRenderPass(sql, { limit: 5 });
  after(async()=>{try{const portraits=await portraitDeps();if(portraits)await runPortraitPass(portraits);}catch{/* Durable portrait queue is resumed by its owner or a later tick. */}});
  for (const line of report.errors) console.warn(`[renders] ${line}`);
  const { errors, ...counts } = report;
  // Presence only, never a value: which engines this deployment can actually reach.
  const config = { openai: openAiConfigFromEnv() !== null, ark: arkConfigFromEnv() !== null, arkAssets: arkAssetsConfigFromEnv() !== null };
  return NextResponse.json({ ok: true, summary: formatPassReport(report), report: counts, errorCount: errors.length, config }, { headers: HEADERS });
}

export const GET = tick;
export const POST = tick;
