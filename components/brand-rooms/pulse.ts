/**
 * The open screen's side of the room pulse (docs/BRAND-ROOMS-FEEDBACK.md §11, lib/brand-rooms/pulse.ts).
 *
 * Every 5 seconds while the tab is on screen, a short stamp per part; a part whose stamp moved is handed to
 * `onChange` and only that part is read again. After 10 minutes without a change the check slows to every
 * 15 seconds; any change, or coming back to the tab, makes it quick again. A hidden tab asks nothing and
 * asks at once when it is shown. A door that answers "not here" (401, 403, 404) stops the pulse for good on
 * this page; anything else (a slow answer, a 429, a network blip) waits for the next turn.
 *
 * The first answer is the baseline and changes nothing: the screen has just read its data.
 */
import { useEffect, useRef } from "react";

export const PULSE_FAST_MS = 5_000;
export const PULSE_SLOW_MS = 15_000;
export const PULSE_QUIET_AFTER_MS = 10 * 60_000;

export type PulseStamp = Record<string, string | null>;
export type PulseAnswer<S extends PulseStamp> = { ok: true; stamp: S } | { ok: false; stop: boolean };

export interface PulseOptions<S extends PulseStamp> {
  read(): Promise<PulseAnswer<S>>;
  onChange(changed: Array<keyof S & string>, stamp: S): void;
  /** The door said "not here": the pulse has stopped for good. */
  onStop?(): void;
  visible?: () => boolean;
  now?: () => number;
  fastMs?: number;
  slowMs?: number;
  quietAfterMs?: number;
}

const pageVisible = () => typeof document === "undefined" || document.visibilityState === "visible";

/** The parts whose stamp differs (a part missing on one side counts as changed). */
export function changedParts<S extends PulseStamp>(before: S, after: S): Array<keyof S & string> {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => (before[k] ?? null) !== (after[k] ?? null)) as Array<keyof S & string>;
}

/** The loop itself, apart from React so it can be driven with fake timers. Returns the stop function. */
export function startPulse<S extends PulseStamp>(options: PulseOptions<S>): () => void {
  const visible = options.visible ?? pageVisible;
  const now = options.now ?? (() => Date.now());
  const fast = options.fastMs ?? PULSE_FAST_MS;
  const slow = options.slowMs ?? PULSE_SLOW_MS;
  const quietAfter = options.quietAfterMs ?? PULSE_QUIET_AFTER_MS;
  let last: S | null = null;
  let lastChangeAt = now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let inflight = false;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const schedule = () => {
    clear();
    if (stopped || !visible()) return;
    timer = setTimeout(() => void tick(), now() - lastChangeAt >= quietAfter ? slow : fast);
  };
  const tick = async () => {
    timer = null;
    if (stopped || !visible()) return;
    if (inflight) return schedule();
    inflight = true;
    try {
      const answer = await options.read();
      if (stopped) return;
      if (!answer.ok) {
        if (answer.stop) {
          stopped = true;
          clear();
          options.onStop?.();
          return;
        }
      } else {
        if (last) {
          const changed = changedParts(last, answer.stamp);
          if (changed.length) {
            lastChangeAt = now();
            options.onChange(changed, answer.stamp);
          }
        }
        last = answer.stamp;
      }
    } catch {
      // A network blip: the next turn asks again.
    } finally {
      inflight = false;
    }
    schedule();
  };
  const onVisibility = () => {
    if (stopped) return;
    if (visible()) {
      // Back on the tab: ask at once, and quickly for a while.
      lastChangeAt = now();
      clear();
      void tick();
    } else {
      clear();
    }
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  void tick();
  return () => {
    stopped = true;
    clear();
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
  };
}

/**
 * `startPulse` for a component. `read` and the handlers are read fresh on every turn; a new `key` (another
 * room, another review) starts over with a new baseline. Null `key`: no pulse.
 */
export function usePulse<S extends PulseStamp>(
  key: string | null,
  read: () => Promise<PulseAnswer<S>>,
  onChange: (changed: Array<keyof S & string>, stamp: S) => void,
  onStop?: () => void,
): void {
  const latest = useRef({ read, onChange, onStop });
  useEffect(() => {
    latest.current = { read, onChange, onStop };
  }, [read, onChange, onStop]);
  useEffect(() => {
    if (!key) return;
    return startPulse<S>({
      read: () => latest.current.read(),
      onChange: (changed, stamp) => latest.current.onChange(changed, stamp),
      onStop: () => latest.current.onStop?.(),
    });
  }, [key]);
}

const STOP_STATUSES = new Set([401, 403, 404]);

/** A pulse door's answer as `PulseAnswer`. `init` for the share page's POST. */
export async function readPulse<S extends PulseStamp>(url: string, init?: RequestInit): Promise<PulseAnswer<S>> {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
  if (STOP_STATUSES.has(response.status)) return { ok: false, stop: true };
  if (!response.ok) return { ok: false, stop: false };
  const body = (await response.json().catch(() => null)) as { ok?: boolean; stamp?: S } | null;
  return body?.ok === true && body.stamp && typeof body.stamp === "object" ? { ok: true, stamp: body.stamp } : { ok: false, stop: false };
}

/** The brand member's door. */
export const roomPulseUrl = (organizationId: string, projectId: string) => `/api/brand-rooms/pulse?${new URLSearchParams({ organizationId, projectId })}`;

/** The team's door: one project's desk, or one review's stack. */
export const staffPulseUrl = (organizationId: string, scope: { projectId: string } | { reviewId: string }) =>
  `/admin/brand-rooms/${encodeURIComponent(organizationId)}/pulse?${new URLSearchParams("projectId" in scope ? { projectId: scope.projectId } : { review: scope.reviewId })}`;

/** The share page's door (a POST: the token travels in the body, never in an address). */
export const sharePulseInit = (token: string): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ op: "pulse", token }),
});
