import { NextResponse } from 'next/server';
import { getSqlRunner } from '@/lib/db/connect';
import { runLiveRenderPass } from '@/lib/renders/runtime';

/**
 * `POST /api/renders/callback` — ModelArk's task-completion webhook (`callback_url` on the task).
 *
 * The body is never trusted for anything but the hint that something finished: the pass re-reads
 * every waiting task from the provider itself, authenticated, and only a task the provider says
 * succeeded is copied and marked. A forged call therefore costs one poll and changes nothing. The
 * answer is 200 whatever happened, so the provider does not retry a callback we cannot use.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

function taskIdOf(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  const direct = record.id ?? record.task_id;
  if (typeof direct === 'string') return direct;
  const nested = record.data;
  if (nested && typeof nested === 'object') {
    const id = (nested as Record<string, unknown>).id;
    if (typeof id === 'string') return id;
  }
  return null;
}

export async function POST(request: Request): Promise<NextResponse> {
  let taskId: string | null = null;
  try {
    taskId = taskIdOf(await request.json());
  } catch {
    // An unreadable body is still a hint that something may have finished.
  }
  const sql = await getSqlRunner();
  if (sql !== null) {
    try {
      const report = await runLiveRenderPass(sql, { limit: 0 });
      for (const line of report.errors) console.warn(`[renders] ${line}`);
    } catch (error) {
      console.error('[renders] callback pass failed', error);
    }
  }
  return NextResponse.json({ ok: true, task: taskId }, { headers: HEADERS });
}
