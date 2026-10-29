import { BRAND_STUDIO_ACTION_PATH, STUDIO_REQUEST_HEADER } from '@/lib/admin/brand-host-studio';

/**
 * The browser side of a campaign cover on brand.twings.app (docs/BRAND-STAFF-ACCESS.md "운영자 캠페인 준비").
 *
 * An image can be 15 MiB, more than a serverless request body takes, so the bytes never pass through
 * the studio door: they go through the existing attachment path (`/api/brand-workspace`: reserve with
 * the declared type and size, the bytes straight to private storage or the local byte route, complete
 * where the server reads the real bytes). Only then does `brandWorkspace.cover` go through the door.
 * `send` is `fetch`, injectable for tests.
 */
// The server's own values (./schemas: BRAND_COVER_MIMES, BRAND_ATTACHMENT_LIMITS) restated, because that
// module needs Node and this one runs in the browser. tests/brands/studio-cover-client.test.ts pins them.
export const COVER_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];
export const COVER_MAX_BYTES = 15 * 1024 * 1024;

/** True when the picked file cannot become a cover; no file at all is fine (the image is optional). */
export function coverFileProblem(file: File | null): boolean {
  if (!file) return false;
  return !COVER_TYPES.includes(file.type) || file.size <= 0 || file.size > COVER_MAX_BYTES;
}

const WORKSPACE_API = '/api/brand-workspace';

async function workspace(send: typeof fetch, operation: string, input: Record<string, unknown>) {
  const response = await send(WORKSPACE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation, input }),
  });
  const result = await response.json().catch(() => null) as { ok?: boolean; id?: string; direct?: boolean; url?: string } | null;
  if (!response.ok || !result?.ok) throw new Error('upload');
  return result;
}

/** Reserve, send, complete. Resolves to the finished attachment's id; any failed step throws `upload`. */
export async function uploadStudioImage(projectId: string, file: File, send: typeof fetch = fetch): Promise<string> {
  if (coverFileProblem(file)) throw new Error('upload');
  // The service refuses path-like characters in a file name; keep the rest of the name.
  const name = file.name.replace(/[\\/<>:"|?*]/g, '_').slice(0, 160) || 'cover';
  const target = await workspace(send, 'attachment.reserve', {
    projectId, purpose: 'workspace', requestId: crypto.randomUUID(), name, mime: file.type, sizeBytes: file.size,
  });
  const id = String(target.id);
  const bytes = await send(target.direct && target.url ? target.url : `${WORKSPACE_API}/attachments/${id}`, {
    method: target.direct ? 'PUT' : 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!bytes.ok) throw new Error('upload');
  await workspace(send, 'attachment.complete', { id });
  return id;
}

export type StudioAnswer = { ok: true; to: string } | { ok: false; code: string };

/** One call to the studio door, as `ManagedForm` makes it. A bare 404 (lost session, refused) is `notFound`. */
export async function studioRequest(fields: Record<string, string>, send: typeof fetch = fetch): Promise<StudioAnswer> {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  const response = await send(BRAND_STUDIO_ACTION_PATH, {
    method: 'POST',
    headers: { Accept: 'application/json', [STUDIO_REQUEST_HEADER]: '1' },
    body,
  });
  const result = await response.json().catch(() => null) as { ok?: boolean; to?: string; code?: string } | null;
  if (result?.ok && typeof result.to === 'string') return { ok: true, to: result.to };
  return { ok: false, code: typeof result?.code === 'string' ? result.code : response.status === 404 ? 'notFound' : 'unknown' };
}
