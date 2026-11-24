import { isTemplateLook, readLookCookie, type TemplateLook } from './look';
import type { ViewerLook } from '@/lib/prompts/facets';

/**
 * docs/PERSONAL-STUDIO.md §3.4.10 — what this browser knows about the viewer's template style, shared by every island
 * on the page (the list filter, the style island, the home curation, the question, the make card's line) WITHOUT a
 * request of its own:
 *
 *   · the `tw_look` cookie, read synchronously on the first client read (the static HTML cannot carry it);
 *   · the header's own session answer (`GET /api/account/session`, components/nav/creator-account.tsx), which says
 *     whether anyone is signed in and, with the switch on, their stored choice. Signed out → nothing is hidden, whatever
 *     the cookie says; signed in → the stored choice wins over the cookie (the endpoint also rewrites the cookie).
 *
 * A tiny external store (useSyncExternalStore): the server snapshot is "nothing known", so the static markup is the
 * same for everyone and nothing is hidden before the client has read the cookie.
 */

export type LookSession =
  | { status: 'unknown' }
  | { status: 'anonymous' }
  /** `look` undefined: the server did not say (the switch off, or 0190 not applied) — the feature stays unset. */
  | { status: 'member'; look: TemplateLook | null | undefined };

export interface LookState {
  /** The choice the cookie carries; null with none (and always null on the server). */
  cookie: TemplateLook | null;
  session: LookSession;
  /** The page where "다른 스타일도 보기" was pressed: that page view shows every card. */
  showAllPath: string | null;
  /** The after-signup sheet is deciding whether to ask (or is asking): the standalone question waits. */
  firstRunPending: boolean;
}

const INITIAL: LookState = Object.freeze({ cookie: null, session: { status: 'unknown' } as LookSession, showAllPath: null, firstRunPending: false });

let state: LookState = INITIAL;
let cookieRead = false;
const listeners = new Set<() => void>();

function emit(next: LookState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

function readDocumentCookie(): TemplateLook | null {
  try {
    return typeof document === 'undefined' ? null : readLookCookie(document.cookie);
  } catch {
    return null;
  }
}

export function subscribeLook(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The client snapshot: the first read takes the cookie, synchronously. */
export function lookSnapshot(): LookState {
  if (!cookieRead && typeof document !== 'undefined') {
    cookieRead = true;
    const cookie = readDocumentCookie();
    if (cookie !== state.cookie) state = { ...state, cookie };
  }
  return state;
}

/** The server (and hydration) snapshot: nothing known, nothing hidden. */
export function serverLookSnapshot(): LookState {
  return INITIAL;
}

/** The choice that decides what is hidden; null shows everything. */
export function effectiveLook(current: LookState): TemplateLook | null {
  if (current.session.status === 'anonymous') return null;
  if (current.session.status === 'member' && current.session.look !== undefined) return current.session.look;
  return current.cookie;
}

export function viewerLookOf(current: LookState, pathname: string): ViewerLook {
  return { look: effectiveLook(current), showAll: current.showAllPath !== null && current.showAllPath === pathname };
}

/** The header's session answer, handed over by `useCreatorSession` (no second request). */
export function publishLookSession(session: { signedIn: boolean; look?: unknown }): void {
  const next: LookSession = !session.signedIn
    ? { status: 'anonymous' }
    : { status: 'member', look: 'look' in session ? (isTemplateLook(session.look) ? session.look : session.look === null ? null : undefined) : undefined };
  const current = lookSnapshot();
  if (JSON.stringify(current.session) === JSON.stringify(next)) return;
  emit({ ...current, session: next, ...(next.status === 'anonymous' ? { cookie: null } : {}) });
}

/** After the route stored (or cleared) the choice: it also set (or deleted) the cookie, so both move together. */
export function recordChosenLook(look: TemplateLook | null): void {
  const current = lookSnapshot();
  emit({ ...current, cookie: look, session: { status: 'member', look }, showAllPath: null });
}

export function revealAllLooks(pathname: string): void {
  emit({ ...lookSnapshot(), showAllPath: pathname });
}

export function setFirstRunPending(pending: boolean): void {
  const current = lookSnapshot();
  if (current.firstRunPending !== pending) emit({ ...current, firstRunPending: pending });
}

/** Test seam: back to the first-load state (and the cookie unread). */
export function resetLookStore(): void {
  state = INITIAL;
  cookieRead = false;
  listeners.clear();
}

// --- the question's once-a-day snooze (per browser; a convenience, never state the server needs) -------------------

export const LOOK_SNOOZE_KEY = 'tw_look_snooze';
export const LOOK_SNOOZE_MS = 24 * 60 * 60 * 1000;

type SnoozeStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): SnoozeStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function lookQuestionSnoozed(now: number = Date.now(), storage: SnoozeStorage | null = defaultStorage()): boolean {
  try {
    const raw = storage?.getItem(LOOK_SNOOZE_KEY);
    if (!raw) return false;
    const at = Number(raw);
    return Number.isFinite(at) && now - at >= 0 && now - at < LOOK_SNOOZE_MS;
  } catch {
    return false;
  }
}

export function snoozeLookQuestion(now: number = Date.now(), storage: SnoozeStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(LOOK_SNOOZE_KEY, String(now));
  } catch {
    /* private mode or blocked storage: it may ask again on the next visit, which is allowed */
  }
}

/** Ask only a signed-in person whose choice is known to be unset, when nothing else is asking, at most once a day. */
export function shouldAskLook(current: LookState, snoozed: boolean): boolean {
  return current.session.status === 'member' && current.session.look === null && !current.firstRunPending && !snoozed;
}
