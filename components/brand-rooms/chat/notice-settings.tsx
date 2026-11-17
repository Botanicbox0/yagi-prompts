"use client";
/**
 * "알림 설정" at the bottom of the messages inbox (docs/BRAND-ROOMS-FEEDBACK.md §2.2, §10): two switches.
 *
 *   이메일 알림  this brand's project room mail for the signed-in member (`brand_room_notice_prefs`, through
 *               `/api/brand-rooms/notice-prefs`). The page reads the current value on the server.
 *   푸시 알림    this browser (a push subscription is per browser and origin), through the shared browser
 *               flow (components/notify/push-client.ts) and `/api/brand-rooms/notice-push`. Hidden when
 *               the deployment has no VAPID key.
 *
 * Each switch moves at once and moves back if the save fails. Rendered only while room notices are on
 * (the page decides; with `BRAND_ROOM_NOTIFY` off none of this, copy included, reaches the browser).
 * Every word is the founder's (messages/rooms-notices.ts `settings`).
 */
import { useEffect, useId, useRef, useState } from "react";
import { browserDisplayEnv, isStandaloneDisplay } from "@/components/pwa/display-mode";
import { isIosDevice } from "@/components/pwa/platform";
import { currentPushSubscription, pushAvailability, pushSupported, savePush, subscribePush, unsubscribePush } from "@/components/notify/push-client";
import { ROOM_NOTICE_SETTINGS_ID } from "@/lib/brand-rooms/notice-paths";
import type { RoomNoticeSettingsCopy } from "@/messages/rooms-notices";

/** What the page hands the inbox for this section (plain data; the inbox renders the section itself). */
export interface RoomNoticeSettingsData {
  copy: RoomNoticeSettingsCopy;
  emailEnabled: boolean;
  /** The VAPID public key, or null when push is not configured on this deployment (no push switch). */
  publicKey: string | null;
}

/** `checking` until the browser has been asked what it can do; `blocked` is a permission the person denied. */
export type PushSwitchState = "checking" | "unsupported" | "blocked" | "off" | "on";

const SAVED_MS = 3_000;

/** What the push switch starts from in this browser, before any press. */
export async function detectPush(publicKey: string): Promise<{ state: PushSwitchState; subscription: PushSubscription | null }> {
  const availability = pushAvailability({
    publicKey,
    supported: pushSupported(),
    ios: isIosDevice({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints }),
    standalone: isStandaloneDisplay(browserDisplayEnv()),
    permission: "Notification" in window ? Notification.permission : null,
  });
  // The brand host is not an installable app: an iPhone tab cannot get push here at all.
  if (availability === "install" || availability === "unsupported" || availability === "unconfigured") return { state: "unsupported", subscription: null };
  if (availability === "denied") return { state: "blocked", subscription: null };
  const subscription = await currentPushSubscription(publicKey);
  return { state: subscription ? "on" : "off", subscription };
}

/** The line under the push switch: why it cannot move, or what it does. */
export function pushLineFor(copy: RoomNoticeSettingsCopy, state: PushSwitchState): string {
  return state === "blocked" ? copy.blocked : state === "unsupported" ? copy.unsupported : copy.pushHelp;
}

/** The push switch cannot move until the browser has answered, nor in a browser that will not push here. */
export const pushSwitchLocked = (state: PushSwitchState): boolean => state === "checking" || state === "unsupported" || state === "blocked";

export interface SwitchMoves<T> {
  set: (value: T) => void;
  report: (result: "saved" | "error") => void;
}

/** The email switch's save (`/api/brand-rooms/notice-prefs`). Throws unless the server kept exactly this value. */
export async function saveEmailSwitch(organizationId: string, emailEnabled: boolean, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher("/api/brand-rooms/notice-prefs", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ organizationId, emailEnabled }),
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as { ok?: boolean; emailEnabled?: boolean } | null;
  if (!response.ok || body?.ok !== true || body.emailEnabled !== emailEnabled) throw new Error("refused");
}

/** Email: the switch moves at once, then the save; it moves back when the save fails. */
export async function toggleEmailSwitch(next: boolean, save: (next: boolean) => Promise<void>, moves: SwitchMoves<boolean>): Promise<void> {
  moves.set(next);
  try {
    await save(next);
    moves.report("saved");
  } catch {
    moves.set(!next);
    moves.report("error");
  }
}

/**
 * Push: the same, with the browser's answer in between. A refused permission leaves the switch blocked
 * (its line says where to allow it), a dismissed prompt leaves it off, a failure moves it back.
 * `subscribe` must ask for permission before its first await (Safari grants it only inside the press).
 */
export async function togglePushSwitch(
  from: "on" | "off",
  ops: { subscribe: () => Promise<"on" | "denied" | "off">; unsubscribe: () => Promise<void> },
  moves: SwitchMoves<PushSwitchState>,
): Promise<void> {
  const turningOn = from === "off";
  moves.set(turningOn ? "on" : "off");
  try {
    if (!turningOn) {
      await ops.unsubscribe();
      moves.report("saved");
      return;
    }
    const result = await ops.subscribe();
    if (result === "denied") moves.set("blocked");
    else if (result === "off") moves.set("off");
    else moves.report("saved");
  } catch {
    moves.set(from);
    moves.report("error");
  }
}

/**
 * A switch the keyboard reaches even when it cannot move (`aria-disabled`, not `disabled`), so the line
 * that says why (blocked, unsupported) is still read with it. Space and Enter are the button's own.
 */
function Switch({
  id,
  labelledBy,
  checked,
  disabled,
  busy,
  describedBy,
  onToggle,
}: {
  id: string;
  labelledBy: string;
  checked: boolean;
  disabled: boolean;
  busy: boolean;
  describedBy: string;
  onToggle: () => void;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      className="brc-switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-busy={busy || undefined}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled && !busy) onToggle();
      }}
    >
      <span className="brc-switch-track" aria-hidden="true" />
    </button>
  );
}

export function RoomNoticeSettings({
  organizationId,
  copy,
  emailEnabled,
  publicKey,
}: {
  organizationId: string;
  copy: RoomNoticeSettingsCopy;
  emailEnabled: boolean;
  /** The VAPID public key, or null when push is not configured on this deployment (no push switch). */
  publicKey: string | null;
}) {
  const ids = useId();
  const [email, setEmail] = useState(emailEnabled);
  const [emailBusy, setEmailBusy] = useState(false);
  const [push, setPush] = useState<PushSwitchState>("checking");
  const [pushBusy, setPushBusy] = useState(false);
  const [status, setStatus] = useState<"saved" | "error" | null>(null);
  const savedTimer = useRef<number | undefined>(undefined);
  const sectionRef = useRef<HTMLElement>(null);
  const pushEndpoint = `/api/brand-rooms/notice-push?${new URLSearchParams({ organizationId }).toString()}`;

  const report = (result: "saved" | "error") => {
    window.clearTimeout(savedTimer.current);
    setStatus(result);
    if (result === "saved") savedTimer.current = window.setTimeout(() => setStatus(null), SAVED_MS);
  };
  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  // The page after unsubscribing links here (`#notice-settings`): bring the section into view.
  useEffect(() => {
    if (window.location.hash === `#${ROOM_NOTICE_SETTINGS_ID}`) sectionRef.current?.scrollIntoView({ block: "nearest" });
  }, []);

  useEffect(() => {
    if (publicKey === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const found = await detectPush(publicKey);
        if (cancelled) return;
        setPush(found.state);
        // Keep the server's record of this browser in step with whoever is signed in now.
        if (found.subscription) void savePush(pushEndpoint, "POST", found.subscription.toJSON()).catch(() => undefined);
      } catch {
        if (!cancelled) setPush("off");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicKey, pushEndpoint]);

  const toggleEmail = async () => {
    if (emailBusy) return;
    setEmailBusy(true);
    setStatus(null);
    await toggleEmailSwitch(!email, (next) => saveEmailSwitch(organizationId, next), { set: setEmail, report });
    setEmailBusy(false);
  };

  const togglePush = async () => {
    if (publicKey === null || pushBusy || (push !== "on" && push !== "off")) return;
    setPushBusy(true);
    setStatus(null);
    // Synchronous up to the permission prompt inside `subscribePush`: Safari grants it only to the press.
    await togglePushSwitch(push, { subscribe: () => subscribePush(publicKey, pushEndpoint), unsubscribe: () => unsubscribePush(pushEndpoint) }, { set: setPush, report });
    setPushBusy(false);
  };

  return (
    <section
      ref={sectionRef}
      id={ROOM_NOTICE_SETTINGS_ID}
      className="brc-notice-settings"
      aria-labelledby={`${ids}-title`}
      data-room-notice-settings
    >
      <h2 id={`${ids}-title`} className="brc-notice-title">
        {copy.title}
      </h2>
      <div className="brc-notice-row" data-notice-switch="email">
        <div className="brc-notice-text">
          <label id={`${ids}-email-label`} htmlFor={`${ids}-email`} className="brc-notice-label">
            {copy.email}
          </label>
          <p id={`${ids}-email-help`} className="brc-notice-help">
            {copy.emailHelp}
          </p>
        </div>
        <Switch
          id={`${ids}-email`}
          labelledBy={`${ids}-email-label`}
          checked={email}
          disabled={false}
          busy={emailBusy}
          describedBy={`${ids}-email-help`}
          onToggle={() => void toggleEmail()}
        />
      </div>
      {publicKey !== null && (
        <div className="brc-notice-row" data-notice-switch="push" data-push-state={push}>
          <div className="brc-notice-text">
            <label id={`${ids}-push-label`} htmlFor={`${ids}-push`} className="brc-notice-label">
              {copy.push}
            </label>
            <p id={`${ids}-push-help`} className="brc-notice-help" data-tone={push === "blocked" || push === "unsupported" ? "note" : undefined}>
              {pushLineFor(copy, push)}
            </p>
          </div>
          <Switch
            id={`${ids}-push`}
            labelledBy={`${ids}-push-label`}
            checked={push === "on"}
            disabled={pushSwitchLocked(push)}
            busy={pushBusy || push === "checking"}
            describedBy={`${ids}-push-help`}
            onToggle={() => void togglePush()}
          />
        </div>
      )}
      <p className="brc-notice-status" role="status" aria-live="polite" data-tone={status ?? undefined}>
        {status === "saved" ? copy.saved : status === "error" ? copy.error : ""}
      </p>
    </section>
  );
}
