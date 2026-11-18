import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { roomRouteContext, type RoomRouteContext } from "@/components/brand-rooms/route-context";
import { RoomInbox } from "@/components/brand-rooms/chat/inbox";
import type { RoomNoticeSettingsData } from "@/components/brand-rooms/chat/notice-settings";
import { loadRoomSummary } from "@/lib/brand-rooms/messages";
import { GENERAL_CHANNEL } from "@/lib/brand-rooms/message-contracts";
import { loadRoomNoticePrefs } from "@/lib/brand-rooms/notice-prefs";
import { brandRoomNotifyOpen } from "@/lib/flags";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getRequestLocale } from "@/lib/i18n/server";
import { pushPublicKey } from "@/lib/notify/push";

/**
 * `/brand/rooms` — 메시지: every conversation this person has with the YAGI team (docs/BRAND-ROOMS.md §3,
 * §4). The route context is the whole gate (flag, sign-in, membership or invitation, the sandbox hardline
 * and the generation policy: the same 404 for all of them); the summary checks the seat again and keeps a
 * project guest to the projects they were invited to. `?channel=<projectId|general>` opens one.
 *
 * With room notices on (`BRAND_ROOM_NOTIFY`, docs/BRAND-ROOMS-FEEDBACK.md §10) the list ends with the
 * notice settings; off, nothing of them is rendered or sent to the browser.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return { title: getDictionary(locale === "en" ? "en" : "ko").roomsChat.inbox.title, robots: { index: false, follow: false } };
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * What the settings section starts from, or null: notices off, or the switch cannot be read (no table yet,
 * no seat). Plain data; the inbox renders the section in its own list (see `RoomInbox` `settings`).
 */
async function noticeSettings(ctx: RoomRouteContext): Promise<RoomNoticeSettingsData | null> {
  if (!brandRoomNotifyOpen()) return null;
  try {
    const prefs = await loadRoomNoticePrefs(ctx.deps.sql, ctx.viewer, ctx.choice.id);
    if (!prefs.ok) return null;
    return { copy: ctx.dict.roomsNotices.settings, emailEnabled: prefs.emailEnabled, publicKey: pushPublicKey() };
  } catch (error) {
    console.warn("[brand-rooms] room_notice_settings_failed", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 200) : "unknown" }));
    return null;
  }
}

export default async function RoomsInboxPage({ searchParams }: { searchParams: Promise<{ organizationId?: string | string[]; channel?: string | string[] }> }) {
  const params = await searchParams;
  const ctx = await roomRouteContext(params.organizationId);
  const summary = await loadRoomSummary({ sql: ctx.deps.sql }, ctx.viewer, ctx.choice.id);
  if (!summary.ok) notFound();
  const asked = first(params.channel)?.trim().toLowerCase() ?? null;
  const open = new Set(summary.channels.map((c) => (c.projectId ? c.projectId.toLowerCase() : GENERAL_CHANNEL)));
  return (
    <RoomInbox
      organizationId={ctx.choice.id}
      locale={ctx.locale}
      copy={ctx.dict.roomsChat}
      initial={summary}
      selected={asked && open.has(asked) ? asked : null}
      canTalk
      settings={await noticeSettings(ctx)}
    />
  );
}
