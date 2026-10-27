import type { SqlRunner } from '@/lib/db/sql-runner';
import { listJobOutputs } from '@/lib/recipes/repo';
import { renderMediaHref } from './share';
import { extensionFor } from './store';

/**
 * A set render's pictures (a recipe carousel: `render_job_outputs`, position 0 = the job's own result)
 * as the result page, the share page and the email link them — in order, through the render gateway,
 * behind the same two doors as the result (the owner's session or the 3-day token). A render with one
 * result has no frames: every one-result surface stays exactly as it was.
 */

export interface RenderFrame {
  /** 1-based, the order the set was made in. */
  frame: number;
  view: string;
  download: string;
  filename: string;
}

/** The name a saved picture gets: the template, the render, and the frame number for a set. */
export function renderFilename(job: { id: string; templateSlug: string }, mime: string, frame: number | null = null): string {
  return `twings-${job.templateSlug}-${job.id.slice(0, 8)}${frame === null ? '' : `-${frame}`}.${extensionFor(mime)}`;
}

/** Only a finished image render with two or more pictures is a set. */
export async function loadRenderFrames(
  sql: SqlRunner,
  job: { id: string; templateSlug: string; status: string; resultMime: string | null },
  share?: string,
): Promise<RenderFrame[]> {
  if (job.status !== 'succeeded' || !job.resultMime?.startsWith('image/')) return [];
  const outputs = await listJobOutputs(sql, job.id);
  if (outputs.length < 2) return [];
  return outputs.map((output) => {
    const frame = output.position + 1;
    return {
      frame,
      view: renderMediaHref(job.id, { share, frame }),
      download: renderMediaHref(job.id, { share, frame, download: true }),
      filename: renderFilename(job, output.mime, frame),
    };
  });
}
