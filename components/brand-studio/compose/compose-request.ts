/**
 * The current editor's requests to `/api/brand-studio/compose` (operations in lib/brand-studio/compose/service.ts),
 * in one place. The current editor (video-composer.tsx) sends every operation through these two functions, and the
 * editing studio v2 sends its export record (`render.reserve`, components/brand-studio/editor-v2/export-record.ts)
 * through the same ones, so the two editors cannot drift apart.
 */

/** A request id the service accepts (`[A-Za-z0-9_-]{8,80}`); the prefix says what asked (`cmp` = an export). */
export function makeComposeRequestId(prefix = 'cmp'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

export async function postComposeOperation(operation: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch('/api/brand-studio/compose', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation, input }),
  });
  return (await res.json()) as Record<string, unknown>;
}
