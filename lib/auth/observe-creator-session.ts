import { isTemplateLook, type TemplateLook } from '@/lib/template-look/look';

export type CreatorSession =
  | { signedIn: false }
  /** `look` (docs/PERSONAL-STUDIO.md §3.4.10) is present only when the endpoint sent it: the switch on and 0190 applied. */
  | { signedIn: true; displayName: string | null; look?: TemplateLook | null };
export const ANONYMOUS_SESSION: CreatorSession = { signedIn: false };

/** A narrow display projection, never usable as authorization for a private page or mutation. */
export function parseCreatorSession(value: unknown): CreatorSession {
  if (!value || typeof value !== 'object' || !('signedIn' in value) || value.signedIn !== true) return ANONYMOUS_SESSION;
  const name = 'displayName' in value && typeof value.displayName === 'string' ? value.displayName.trim() : '';
  const displayName = name && name.length <= 80 && !/[\u0000-\u001f\u007f]/.test(name) ? name : null;
  if (!('look' in value)) return { signedIn: true, displayName };
  // A closed vocabulary: anything but the two styles reads as "not chosen".
  return { signedIn: true, displayName, look: isTemplateLook(value.look) ? value.look : null };
}

interface SessionEnvironment {
  window: EventTarget;
  document: EventTarget & { visibilityState: string };
  fetch: (signal: AbortSignal) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
  now: () => number;
}

/** Refresh on return to the site, with no polling or auth SDK bundled into public pages. */
export function observeCreatorSession(env: SessionEnvironment, changed: (session: CreatorSession) => void): () => void {
  let disposed = false;
  let generation = 0;
  let lastWake = -Infinity;
  let controller: AbortController | null = null;
  const refresh = () => {
    if (disposed) return;
    const now = env.now();
    if (now - lastWake < 1_000) return; // focus + visibilitychange fire together.
    lastWake = now;
    const request = ++generation;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    const timeout = setTimeout(() => controller?.signal === signal && controller.abort(), 8_000);
    void env.fetch(signal).then(async response => {
      const session = response.ok ? parseCreatorSession(await response.json()) : ANONYMOUS_SESSION;
      if (!disposed && request === generation && !signal.aborted) changed(session);
    }).catch(() => {
      if (!disposed && request === generation) changed(ANONYMOUS_SESSION);
    }).finally(() => clearTimeout(timeout));
  };
  const onVisible = () => { if (env.document.visibilityState === 'visible') refresh(); };
  const onPageShow = (event: Event) => { if ('persisted' in event && event.persisted) { lastWake = -Infinity; refresh(); } };
  env.window.addEventListener('focus', refresh);
  env.window.addEventListener('pageshow', onPageShow);
  env.document.addEventListener('visibilitychange', onVisible);
  refresh();
  return () => {
    disposed = true; generation++; controller?.abort();
    env.window.removeEventListener('focus', refresh);
    env.window.removeEventListener('pageshow', onPageShow);
    env.document.removeEventListener('visibilitychange', onVisible);
  };
}
