/**
 * Editing studio v2 — the record an export leaves (docs/BRAND-EDITING-STUDIO.md §8-3: export is free and
 * still recorded). The same request the current editor makes when its export starts
 * (components/brand-studio/compose/video-composer.tsx, `handleExport`), through the same helper: the compose
 * route's `render.reserve`, which writes one 0-credit `brand_studio_jobs` row (`video_final` / `compose-1080p`,
 * `params.source = 'compose'`). The admin organization page, the organization list's last activity and the
 * per-member runs read that row. The service checks the person may create (owner or editor, not a guest).
 *
 * Asked once per export that really makes pictures (export-job.ts: at its first progress report of the picture
 * phase, after the export's own checks before the first frame), only for the organization's own film; an export
 * refused before its first frame leaves none. Unlike the current editor, the export never waits for it: a record that is refused, fails or hangs changes nothing about
 * the file. The request id starts with `ed2_` (the current editor's export ids start with `cmp_`), so the row
 * says which editor made the file without anything new on the server.
 */
import { makeComposeRequestId, postComposeOperation } from '@/components/brand-studio/compose/compose-request';

export const EXPORT_RECORD_PREFIX = 'ed2';

/** The current editor's input for `render.reserve`: the organization, a new request id, the film's length, and optional open project. */
export function exportRecordInput(
  organizationId: string,
  frames: number,
  fps: number,
  brandProjectId?: string | null,
): { organizationId: string; requestId: string; durationSec: number; brandProjectId?: string } {
  return {
    organizationId,
    requestId: makeComposeRequestId(EXPORT_RECORD_PREFIX),
    durationSec: Math.max(0.3, fps > 0 ? frames / fps : 0),
    ...(brandProjectId ? { brandProjectId } : {}),
  };
}

/** Asks for the record and returns at once. Whatever the answer, the export goes on. */
export function recordExport(organizationId: string, frames: number, fps: number, brandProjectId?: string | null): void {
  postComposeOperation('render.reserve', exportRecordInput(organizationId, frames, fps, brandProjectId))
    .then((answer) => {
      if (answer?.ok !== true) console.warn('[editor export] not recorded', answer?.code ?? answer);
    })
    .catch((error: unknown) => {
      console.warn('[editor export] not recorded', error instanceof Error ? error.message : String(error));
    });
}
