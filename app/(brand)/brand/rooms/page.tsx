import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { roomRouteContext } from "@/components/brand-rooms/route-context";
import { RoomInbox } from "@/components/brand-rooms/chat/inbox";
import { loadRoomSummary } from "@/lib/brand-rooms/messages";
import { GENERAL_CHANNEL } from "@/lib/brand-rooms/message-contracts";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getRequestLocale } from "@/lib/i18n/server";

/**
 * `/brand/rooms` — 메시지: every conversation this person has with the YAGI team (docs/BRAND-ROOMS.md §3,
 * §4). The route context is the whole gate (flag, sign-in, membership or invitation, the sandbox hardline
 * and the generation policy: the same 404 for all of them); the summary checks the seat again and keeps a
 * project guest to the projects they were invited to. `?channel=<projectId|general>` opens one.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return { title: getDictionary(locale === "en" ? "en" : "ko").roomsChat.inbox.title, robots: { index: false, follow: false } };
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

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
    />
  );
}
