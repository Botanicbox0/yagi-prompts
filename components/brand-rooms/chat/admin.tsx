"use client";
/**
 * The team's side of a conversation (`/admin/brand-rooms/[organizationId]`): the same stream the brand
 * sees, read through the admin feed route and written through the registered `brand_rooms.*`
 * operations (docs/BRAND-ROOMS.md §9-2). The team replies, pins and takes lines down; it does not react,
 * edit or attach files from here (a deliverable or a storyboard is posted from its own team page).
 *
 * `AdminRoomThread` is the same compact column the brand gets beside a cut, for the team's storyboard and
 * deliverable pages (slices S and R).
 */
import "./chat.css";
import { useMemo, type ReactNode } from "react";
import { refKeyOf, type RoomRef } from "@/lib/brand-rooms/message-contracts";
import type { RoomsChatCopy } from "@/messages/rooms-chat";
import { ChannelView, RefThreadView } from "./channel-view";
import { adminTransport } from "./transport";

export function AdminRoomChannel({
  organizationId,
  channel,
  locale,
  copy,
  header,
  channelName,
}: {
  organizationId: string;
  channel: string;
  locale: "ko" | "en";
  copy: RoomsChatCopy;
  header?: ReactNode;
  channelName?: string;
}) {
  const transport = useMemo(() => adminTransport(organizationId), [organizationId]);
  return <ChannelView transport={transport} channel={channel} locale={locale} copy={copy} canTalk layout="fill" header={header} channelName={channelName} />;
}

export function AdminRoomThread({
  organizationId,
  projectId,
  roomRef,
  locale,
  copy,
  label,
}: {
  organizationId: string;
  projectId: string;
  roomRef: RoomRef;
  locale: "ko" | "en";
  copy: RoomsChatCopy;
  label: string;
}) {
  const transport = useMemo(() => adminTransport(organizationId), [organizationId]);
  return <RefThreadView transport={transport} projectId={projectId} refKey={refKeyOf(roomRef)} locale={locale} copy={copy} canTalk label={label} />;
}
