/**
 * Turn-offs on the desk's 공유 링크 tab, told to the "link made" box beside them (docs/BRAND-ROOMS-FEEDBACK.md
 * §4): once any link is turned off, the box stops offering the address it was showing, so it can never hand
 * out a link that no longer opens. One page, one listener list; no React, so it is tested on its own.
 */
const REVOKED = "revoked";
const bus: EventTarget | null = typeof EventTarget === "undefined" ? null : new EventTarget();

export function announceShareRevoked(shareId: string): void {
  bus?.dispatchEvent(new CustomEvent<string>(REVOKED, { detail: shareId }));
}

/** Calls `listener` with the turned-off link's id; returns the way to stop listening. */
export function onShareRevoked(listener: (shareId: string) => void): () => void {
  const handler = (event: Event) => listener(String((event as CustomEvent<string>).detail));
  bus?.addEventListener(REVOKED, handler);
  return () => bus?.removeEventListener(REVOKED, handler);
}
