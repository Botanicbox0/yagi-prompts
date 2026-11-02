/**
 * The signed-in reader's saved selfie, shared between the studio (which already asks
 * `/api/renders/access` once per page) and the template page's "my selfie → these results" strip,
 * so the strip can show the reader's own face without a second request.
 *
 * A plain module-level store: the static template page has no provider above both islands, and
 * the photo never leaves the reader's browser (the URL is the owner-only gateway link).
 */

type Listener = () => void;

let current: string | null = null;
const listeners = new Set<Listener>();

export function publishViewerSelfie(url: string | null): void {
  if (current === url) return;
  current = url;
  for (const listener of listeners) listener();
}

export function subscribeViewerSelfie(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function viewerSelfieSnapshot(): string | null {
  return current;
}
