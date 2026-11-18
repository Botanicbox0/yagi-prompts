import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import webPush from "web-push";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RoomNoticeSettings,
  detectPush,
  pushLineFor,
  pushSwitchLocked,
  saveEmailSwitch,
  toggleEmailSwitch,
  togglePushSwitch,
  type PushSwitchState,
} from "@/components/brand-rooms/chat/notice-settings";
import { roomNoticeSettingsPath, ROOM_NOTICE_SETTINGS_ID } from "@/lib/brand-rooms/notice-paths";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §10 — the "알림 설정" section of the messages inbox. This repo's tests run
 * without a DOM, so the section's markup is checked as the server renders it, and its behaviour through
 * the functions its handlers call: the switch moves at once and moves back when the save fails, a refused
 * browser permission leaves the push switch blocked, and the browser's own answers pick the line under it.
 * Every expected string is copied from §10.2/§10.3.
 */
const ORG = "a0000000-0000-4000-8000-00000000000a";
/** Made fresh each run, never a literal (a long base64url string reads as a leaked key to the secret scan). */
const KEY = webPush.generateVAPIDKeys().publicKey;
const ko = getDictionary("ko").roomsNotices.settings;
const en = getDictionary("en").roomsNotices.settings;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the section as the page renders it", () => {
  it("has the confirmed title, both switches with their labels and lines, and an empty status", () => {
    const html = renderToStaticMarkup(<RoomNoticeSettings organizationId={ORG} copy={ko} emailEnabled publicKey={KEY} />);
    expect(html).toContain(`id="${ROOM_NOTICE_SETTINGS_ID}"`);
    expect(html).toContain(">알림 설정</h2>");
    expect(html).toContain(">이메일 알림</label>");
    expect(html).toContain(">새 시안, 스토리보드, 메시지, 멘션 알림을 메일로 보내드려요.</p>");
    expect(html).toContain(">푸시 알림</label>");
    expect(html).toContain(">현재 사용 중인 브라우저에서 알림을 보내드려요.</p>");
    expect(html.match(/role="switch"/g)).toHaveLength(2);
    // The status line is there before anything happens, so a screen reader hears the result when it comes.
    expect(html).toMatch(/<p class="brc-notice-status" role="status" aria-live="polite"><\/p>/);
  });

  it("ties each switch to its label and line, and keeps it a button the keyboard reaches", () => {
    const html = renderToStaticMarkup(<RoomNoticeSettings organizationId={ORG} copy={en} emailEnabled={false} publicKey={KEY} />);
    const switches = [...html.matchAll(/<button([^>]*)>/g)].map((m) => m[1]!);
    expect(switches).toHaveLength(2);
    for (const attrs of switches) {
      expect(attrs).toContain('type="button"');
      expect(attrs).toContain('role="switch"');
      expect(attrs).not.toMatch(/\sdisabled(=|\s|$)/);
      const id = /id="([^"]+)"/.exec(attrs)![1]!;
      const label = /aria-labelledby="([^"]+)"/.exec(attrs)![1]!;
      const help = /aria-describedby="([^"]+)"/.exec(attrs)![1]!;
      expect(html).toContain(`<label id="${label}" for="${id}"`);
      expect(html).toContain(`<p id="${help}"`);
    }
    // Email reads the saved value; push waits for the browser's answer before it can move.
    expect(switches[0]).toContain('aria-checked="false"');
    expect(switches[1]).toContain('aria-checked="false"');
    expect(switches[1]).toContain('aria-disabled="true"');
    expect(switches[1]).toContain('aria-busy="true"');
    expect(html).toContain(">Notification settings</h2>");
    expect(html).toContain(">Email notifications</label>");
    expect(html).toContain(">Get emails for new drafts, storyboards, messages, and mentions.</p>");
    expect(html).toContain(">Push notifications</label>");
    expect(html).toContain(">Get notifications on your current browser.</p>");
  });

  it("shows the email switch on when the member has not switched mail off", () => {
    const html = renderToStaticMarkup(<RoomNoticeSettings organizationId={ORG} copy={ko} emailEnabled publicKey={null} />);
    expect(html).toMatch(/role="switch"[^>]*aria-checked="true"/);
    // No push keys on this deployment: no push switch at all.
    expect(html.match(/role="switch"/g)).toHaveLength(1);
    expect(html).not.toContain("푸시 알림");
  });

  it("leaves room at the end of the one-column list for the floating enquiry button, so no switch ends under it", () => {
    const css = readFileSync(join(process.cwd(), "components", "brand-rooms", "chat", "chat.css"), "utf8");
    const narrow = [...css.matchAll(/@media \(max-width: 899px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]!).join("\n");
    const pad = /\.brc-inbox-list \{\s*padding-bottom: calc\((\d+)px \+ env\(safe-area-inset-bottom, 0px\)\);/.exec(narrow);
    expect(pad).not.toBeNull();
    // The button is at most 48px tall and sits at most 24px above the list's end (browser check at 390×844:
    // list ends at 772, button 720–764). The clearance covers both, with room to spare.
    expect(Number(pad![1])).toBeGreaterThanOrEqual(48 + 24 + 8);
    // The button itself is not moved or restyled here (its only rule in this file hides it beside a conversation).
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(rules).not.toContain("bw-support-launch");
    expect([...rules.matchAll(/[^{}]*\[data-concierge-launcher\][^{}]*\{([^}]*)\}/g)].map((m) => m[1]!.trim())).toEqual(["display: none;"]);
  });

  it("links the page after unsubscribing to this section of the brand's inbox", () => {
    expect(roomNoticeSettingsPath(ORG.toUpperCase())).toBe(`/brand/rooms?organizationId=${ORG}#notice-settings`);
  });
});

describe("the push switch's line and lock", () => {
  it("says why it cannot move, in the confirmed words", () => {
    expect(pushLineFor(ko, "blocked")).toBe("브라우저 설정에서 알림을 허용해 주세요.");
    expect(pushLineFor(ko, "unsupported")).toBe("이 브라우저는 알림을 지원하지 않아요.");
    expect(pushLineFor(en, "blocked")).toBe("Please allow notifications in your browser settings.");
    expect(pushLineFor(en, "unsupported")).toBe("This browser does not support notifications.");
    for (const state of ["checking", "off", "on"] as const) expect(pushLineFor(ko, state)).toBe("현재 사용 중인 브라우저에서 알림을 보내드려요.");
  });

  it("locks while checking, in a browser that cannot push, and once permission was refused", () => {
    expect((["checking", "unsupported", "blocked", "off", "on"] as const).map(pushSwitchLocked)).toEqual([true, true, true, false, false]);
  });
});

describe("the email switch", () => {
  const moves = () => {
    const calls: Array<boolean | string> = [];
    return { calls, set: (v: boolean) => calls.push(v), report: (r: "saved" | "error") => calls.push(r) };
  };

  it("moves at once, then says saved", async () => {
    const m = moves();
    let seenWhileSaving: Array<boolean | string> = [];
    await toggleEmailSwitch(false, async () => void (seenWhileSaving = [...m.calls]), m);
    expect(seenWhileSaving).toEqual([false]);
    expect(m.calls).toEqual([false, "saved"]);
  });

  it("moves back and says it could not save when the save fails", async () => {
    const m = moves();
    await toggleEmailSwitch(true, async () => Promise.reject(new Error("offline")), m);
    expect(m.calls).toEqual([true, false, "error"]);
  });

  it("saves through the brand route, and treats anything but the same value back as a failure", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ ok: true, emailEnabled: false }), { status: 200 }));
    await saveEmailSwitch(ORG, false, fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("/api/brand-rooms/notice-prefs");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store" });
    expect(JSON.parse(String(init!.body))).toEqual({ organizationId: ORG, emailEnabled: false });
    const refused = async (status: number, body: unknown) =>
      saveEmailSwitch(ORG, false, (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch).then(
        () => "saved",
        () => "error",
      );
    expect(await refused(404, { ok: false, code: "rooms_closed" })).toBe("error");
    expect(await refused(500, { ok: false, code: "failed" })).toBe("error");
    expect(await refused(200, { ok: true, emailEnabled: true })).toBe("error");
    expect(await refused(200, "not the switch")).toBe("error");
  });
});

describe("the push switch", () => {
  const moves = () => {
    const calls: Array<PushSwitchState | string> = [];
    return { calls, set: (v: PushSwitchState) => calls.push(v), report: (r: "saved" | "error") => calls.push(r) };
  };
  const ops = (subscribe: () => Promise<"on" | "denied" | "off">, unsubscribe: () => Promise<void> = async () => undefined) => ({ subscribe, unsubscribe });

  it("turns on at once, asks the browser, then says saved", async () => {
    const m = moves();
    let seen: Array<PushSwitchState | string> = [];
    await togglePushSwitch("off", ops(async () => ((seen = [...m.calls]), "on")), m);
    expect(seen).toEqual(["on"]);
    expect(m.calls).toEqual(["on", "saved"]);
  });

  it("is blocked, not failed, when the person refuses the permission; back off when they dismiss it", async () => {
    const denied = moves();
    await togglePushSwitch("off", ops(async () => "denied"), denied);
    expect(denied.calls).toEqual(["on", "blocked"]);
    const dismissed = moves();
    await togglePushSwitch("off", ops(async () => "off"), dismissed);
    expect(dismissed.calls).toEqual(["on", "off"]);
  });

  it("moves back and says it could not save when subscribing or unsubscribing fails", async () => {
    const on = moves();
    await togglePushSwitch("off", ops(async () => Promise.reject(new Error("refused: 503"))), on);
    expect(on.calls).toEqual(["on", "off", "error"]);
    const off = moves();
    await togglePushSwitch("on", ops(async () => "on", async () => Promise.reject(new Error("offline"))), off);
    expect(off.calls).toEqual(["off", "on", "error"]);
  });

  it("turns off at once, then says saved", async () => {
    const m = moves();
    const unsubscribe = vi.fn(async () => undefined);
    await togglePushSwitch("on", ops(async () => "on", unsubscribe), m);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(m.calls).toEqual(["off", "saved"]);
  });
});

describe("what this browser can do (detectPush)", () => {
  function browser(options: { permission?: NotificationPermission; push?: boolean; ua?: string; subscription?: { key: Uint8Array } | null }) {
    const permission = options.permission ?? "default";
    const registration = {
      pushManager: { getSubscription: async () => (options.subscription ? { options: { applicationServerKey: options.subscription.key.buffer } } : null) },
    };
    const navigator = {
      userAgent: options.ua ?? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130",
      platform: "Win32",
      maxTouchPoints: 0,
      ...(options.push === false ? {} : { serviceWorker: { getRegistration: async () => registration } }),
    };
    const Notification = { permission };
    const window = { navigator, Notification, matchMedia: () => ({ matches: false }), localStorage: { getItem: () => null }, ...(options.push === false ? {} : { PushManager: function PushManager() {} }) };
    vi.stubGlobal("navigator", navigator);
    vi.stubGlobal("window", window);
    vi.stubGlobal("Notification", Notification);
  }
  const keyBytes = (base64url: string) => Uint8Array.from(Buffer.from(base64url, "base64url"));

  it("is blocked when the person denied notifications for this site", async () => {
    browser({ permission: "denied" });
    expect((await detectPush(KEY)).state).toBe("blocked");
  });

  it("is unsupported without push in the browser, and in an iPhone tab (the brand host cannot be installed)", async () => {
    browser({ push: false });
    expect((await detectPush(KEY)).state).toBe("unsupported");
    browser({ ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1" });
    expect((await detectPush(KEY)).state).toBe("unsupported");
  });

  it("is on only with a granted permission and a subscription made with this key", async () => {
    browser({ permission: "granted", subscription: { key: keyBytes(KEY) } });
    expect((await detectPush(KEY)).state).toBe("on");
    browser({ permission: "granted", subscription: { key: new Uint8Array([4, 1, 2, 3]) } });
    expect((await detectPush(KEY)).state).toBe("off");
    browser({ permission: "default", subscription: { key: keyBytes(KEY) } });
    expect((await detectPush(KEY)).state).toBe("off");
  });
});
