/**
 * What the studio's one `/api/renders/access` call learned about this reader — signed in, and
 * whether making is open to them — shared with the template page's make launcher, which sits
 * outside the studio (the studio lives in the make sheet). Same plain store as
 * `lib/twings/viewer-selfie.ts`: the static page has no provider above both islands. `null` until
 * the call answers.
 */

export interface ViewerAccess {
  signedIn: boolean;
  /** This reader can make the template now (the studio's `live`). */
  live: boolean;
}

type Listener = () => void;

let current: ViewerAccess | null = null;
const listeners = new Set<Listener>();

export function publishViewerAccess(next: ViewerAccess): void {
  if (current?.signedIn === next.signedIn && current.live === next.live) return;
  current = next;
  for (const listener of listeners) listener();
}

export function subscribeViewerAccess(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function viewerAccessSnapshot(): ViewerAccess | null {
  return current;
}

/** The server render: nothing is known about the reader. */
export function serverViewerAccess(): ViewerAccess | null {
  return null;
}
