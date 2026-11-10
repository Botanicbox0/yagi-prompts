"use client";
/**
 * `/brand/rooms` — every conversation with the YAGI team in one place (docs/BRAND-ROOMS.md §3, §4).
 * Left: "일반 문의" and one channel per commissioned project, with unread counts and the last line.
 * Right: the chosen conversation, with a link to the project's room. On a phone the list comes first
 * and a chosen conversation takes the screen, with a way back.
 *
 * The list reads `/api/brand-rooms/summary` again every 20 s while the tab is on screen and whenever a
 * conversation announces a read or a send (ROOM_ACTIVITY).
 */
import "./chat.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { interpolate } from "@/lib/i18n/format";
import { GENERAL_CHANNEL } from "@/lib/brand-rooms/message-contracts";
import type { RoomsChatCopy } from "@/messages/rooms-chat";
import { ROOM_ACTIVITY, type RoomSummary } from "../seams";
import { ChannelView } from "./channel-view";
import { listStamp } from "./format";
import { brandTransport } from "./transport";

type Locale = "ko" | "en";
const SUMMARY_MS = 20_000;
const WIDE = "(min-width: 900px)";

const keyOf = (projectId: string | null) => (projectId ? projectId.toLowerCase() : GENERAL_CHANNEL);

/**
 * The inbox is as tall as the window below its own top, minus a bar fixed to the bottom of the screen
 * (the phone's tab bar), so the message box is always on screen. CSS keeps a fallback height.
 */
function useFitHeight() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fit = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      let bottom = 0;
      for (const node of Array.from(document.querySelectorAll<HTMLElement>("nav, [class*='tabs'], [role='tablist']"))) {
        if (node.contains(el) || el.contains(node)) continue;
        const style = getComputedStyle(node);
        if (style.position !== "fixed" || style.display === "none" || style.visibility === "hidden") continue;
        const rect = node.getBoundingClientRect();
        // Only a bar that spans the bottom edge of the screen counts.
        if (rect.bottom >= window.innerHeight - 1 && rect.width >= window.innerWidth * 0.9 && rect.height < window.innerHeight / 3) bottom = Math.max(bottom, rect.height);
      }
      const margin = window.innerWidth < 900 ? 8 : 16;
      el.style.setProperty("--brc-fit-h", `${Math.max(380, Math.floor(window.innerHeight - top - bottom - margin))}px`);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return ref;
}

export function RoomInbox({
  organizationId,
  locale,
  copy,
  initial,
  selected: selectedFromUrl,
  canTalk,
}: {
  organizationId: string;
  locale: Locale;
  copy: RoomsChatCopy;
  initial: RoomSummary;
  selected: string | null;
  canTalk: boolean;
}) {
  const [summary, setSummary] = useState(initial);
  const [selected, setSelected] = useState<string | null>(selectedFromUrl);
  const transport = useMemo(() => brandTransport(organizationId), [organizationId]);
  const fitRef = useFitHeight();

  // On a wide screen an empty selection opens the first conversation; a phone keeps the list.
  useEffect(() => {
    if (selected || typeof window === "undefined" || !window.matchMedia(WIDE).matches) return;
    const first = summary.channels[0];
    if (first) setSelected(keyOf(first.projectId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/brand-rooms/summary?organizationId=${encodeURIComponent(organizationId)}`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      if (!response.ok) return;
      const body = (await response.json()) as RoomSummary | { ok: false };
      if (body.ok) setSummary(body);
    } catch {
      // The next tick tries again.
    }
  }, [organizationId]);

  useEffect(() => {
    let pending: number | undefined;
    const soon = () => {
      window.clearTimeout(pending);
      pending = window.setTimeout(() => void refresh(), 500);
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, SUMMARY_MS);
    window.addEventListener(ROOM_ACTIVITY, soon);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(pending);
      window.removeEventListener(ROOM_ACTIVITY, soon);
    };
  }, [refresh]);

  const hrefFor = (channel: string | null) => {
    const params = new URLSearchParams({ organizationId });
    if (channel) params.set("channel", channel);
    return `/brand/rooms?${params.toString()}`;
  };

  const choose = (channel: string | null) => {
    setSelected(channel);
    try {
      window.history.pushState(null, "", hrefFor(channel));
    } catch {
      // History blocked: the screen still switches.
    }
    if (channel) setSummary((s) => ({ ...s, channels: s.channels.map((c) => (keyOf(c.projectId) === channel ? { ...c, unread: 0 } : c)) }));
  };

  useEffect(() => {
    const back = () => setSelected(new URLSearchParams(window.location.search).get("channel"));
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);

  const current = summary.channels.find((c) => keyOf(c.projectId) === selected) ?? null;
  const title = selected === GENERAL_CHANNEL ? copy.inbox.general : (current?.title ?? null);
  const projectChannels = summary.channels.filter((c) => c.projectId);

  return (
    <div className="brc-inbox" ref={fitRef} data-view={selected ? "channel" : "list"} data-room-inbox>
      <nav className="brc-inbox-list" aria-label={copy.inbox.listLabel}>
        <header className="brc-inbox-head">
          <h1>{copy.inbox.title}</h1>
        </header>
        <ul>
          {summary.channels.map((c) => {
            const key = keyOf(c.projectId);
            const name = c.projectId ? c.title : copy.inbox.general;
            return (
              <li key={key}>
                <a
                  href={hrefFor(key)}
                  className="brc-inbox-item"
                  aria-current={selected === key ? "true" : undefined}
                  data-room-channel-link={key}
                  data-unread={c.unread > 0 ? "true" : undefined}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                    event.preventDefault();
                    choose(key);
                  }}
                >
                  <span className="brc-inbox-mark" aria-hidden="true">
                    {c.projectId ? (
                      <svg viewBox="0 0 20 20">
                        <rect x="3.5" y="4.5" width="13" height="11" rx="2.5" />
                        <path d="M3.5 8h13" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 20 20">
                        <path d="M4 5.5h12v7H9.5L6 15.5v-3H4z" />
                      </svg>
                    )}
                  </span>
                  <span className="brc-inbox-text">
                    <span className="brc-inbox-name">{name}</span>
                    <span className="brc-inbox-line">{c.lastLine ?? (c.projectId ? copy.inbox.noMessages : copy.inbox.generalHint)}</span>
                  </span>
                  <span className="brc-inbox-side">
                    {c.lastAt && <time dateTime={c.lastAt}>{listStamp(c.lastAt, locale, copy.channel)}</time>}
                    {c.unread > 0 && (
                      <span className="brc-badge" aria-label={interpolate(copy.inbox.unread, { count: c.unread })}>
                        {c.unread > 99 ? "99+" : c.unread}
                      </span>
                    )}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
        {projectChannels.length === 0 && <p className="brc-inbox-empty">{copy.inbox.empty}</p>}
      </nav>
      <div className="brc-inbox-pane">
        {selected ? (
          <ChannelView
            key={selected}
            transport={transport}
            channel={selected}
            locale={locale}
            copy={copy}
            canTalk={canTalk}
            layout="fill"
            channelName={title ?? undefined}
            header={
              <div className="brc-pane-head">
                <button type="button" className="brc-back" onClick={() => choose(null)}>
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M12 5l-5 5 5 5" />
                  </svg>
                  <span>{copy.inbox.back}</span>
                </button>
                <div className="brc-pane-title">
                  <h2>{title ?? ""}</h2>
                  <p>{selected === GENERAL_CHANNEL ? copy.channel.generalLede : copy.channel.projectLede}</p>
                </div>
                {selected !== GENERAL_CHANNEL && (
                  <a className="brc-btn" href={`/brand/rooms/${selected}?organizationId=${encodeURIComponent(organizationId)}`} data-room-open-link>
                    {copy.inbox.openRoom}
                  </a>
                )}
              </div>
            }
          />
        ) : (
          <p className="brc-state brc-pick">{copy.inbox.pick}</p>
        )}
      </div>
    </div>
  );
}
