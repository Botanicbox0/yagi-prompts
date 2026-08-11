/**
 * Public-bucket object → servable URL.
 *
 * Mirrors `defaultPublicUrl` in `lib/content/shape.ts`, but returns `null` when no Supabase
 * project is configured (PLAN §11 open item). `null` is the honest answer on a machine with only
 * the local fixture snapshot: the bytes exist under `.storage/`, but nothing serves them over
 * HTTP, so a card that pretended otherwise would render a broken image. Callers fall back to the
 * generated cover composition instead (see `components/landing/card-cover.tsx`).
 */

const PLACEHOLDER_HOST = 'YOUR-PROJECT';

export function isSupabaseConfigured(baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL): boolean {
  return Boolean(baseUrl && baseUrl.startsWith('http') && !baseUrl.includes(PLACEHOLDER_HOST));
}

export function publicContentUrl(
  key: string,
  baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
): string | null {
  if (!isSupabaseConfigured(baseUrl)) return null;
  return `${baseUrl!.replace(/\/$/, '')}/storage/v1/object/public/public-content/${key}`;
}
