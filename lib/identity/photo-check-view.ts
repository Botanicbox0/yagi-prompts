/**
 * The advisory photo check's answer as the browser sees it (`POST /api/identity/selfie/{id}/check`).
 * Client-safe: no server imports. The server derives it in `lib/identity/photo-check.ts`; the words a
 * person reads come from `messages/*.ts` (`selfie.photoCheck`), never from the model.
 *
 * Advisory only (AGENTS.md §5): no state here ever disables saving, choosing or paying.
 */
export const PHOTO_CHECK_ISSUES = [
  'no_face', 'multiple_faces', 'not_real_person', 'face_covered', 'blurry',
  'side_angle', 'dark', 'backlit', 'small_face',
] as const;
export type PhotoCheckIssue = (typeof PHOTO_CHECK_ISSUES)[number];
export type PhotoCheckStatus = 'good' | 'check' | 'retake';
export interface PhotoCheck { status: PhotoCheckStatus; issues: PhotoCheckIssue[] }

/** How many issue lines a screen shows at most. */
export const PHOTO_CHECK_MAX_LINES = 3;

const statuses: readonly string[] = ['good', 'check', 'retake'];

/** A stored or received answer, re-checked; anything else is "no result". */
export function parsePhotoCheck(raw: unknown): PhotoCheck | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { status, issues } = raw as { status?: unknown; issues?: unknown };
  if (typeof status !== 'string' || !statuses.includes(status) || !Array.isArray(issues)) return null;
  if (!issues.every(issue => typeof issue === 'string' && (PHOTO_CHECK_ISSUES as readonly string[]).includes(issue))) return null;
  return { status: status as PhotoCheckStatus, issues: issues as PhotoCheckIssue[] };
}

// One request per photo per page session: the answer (or its absence) is remembered, never polled
// and never retried. `off` stops asking once the server says the check is not running at all.
const answers = new Map<string, Promise<PhotoCheck | null>>();
let off = false;

export function fetchPhotoCheck(selfieId: string): Promise<PhotoCheck | null> {
  if (off) return Promise.resolve(null);
  const known = answers.get(selfieId);
  if (known) return known;
  const pending = (async () => {
    try {
      const response = await fetch(`/api/identity/selfie/${encodeURIComponent(selfieId)}/check`, { method: 'POST', cache: 'no-store', credentials: 'same-origin' });
      const data = await response.json().catch(() => null) as { ok?: boolean; code?: string; check?: unknown } | null;
      if (data?.code === 'off') off = true;
      return response.ok && data?.ok === true ? parsePhotoCheck(data.check) : null;
    } catch { return null; }
  })();
  answers.set(selfieId, pending);
  return pending;
}
