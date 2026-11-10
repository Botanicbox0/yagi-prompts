"use client";
/**
 * Slice M's public pieces (docs/BRAND-ROOMS.md §4). Other slices mount them through the props in
 * ../seams.ts and must not depend on anything else in this folder.
 *
 *   RoomChannel  one conversation (a project's channel or the organization's general channel)
 *   RoomThread   the lines about one thing (a storyboard cut, a deliverable): the comment column of a cut
 */
import "./chat.css";
import { useMemo } from "react";
import { channelKeyOf, refKeyOf } from "@/lib/brand-rooms/message-contracts";
import type { RoomChannelProps, RoomThreadProps } from "../seams";
import { ChannelView, RefThreadView } from "./channel-view";
import { brandTransport } from "./transport";

export function RoomChannel({ organizationId, projectId, locale, copy, canTalk, layout }: RoomChannelProps) {
  const transport = useMemo(() => brandTransport(organizationId), [organizationId]);
  return <ChannelView transport={transport} channel={channelKeyOf(projectId)} locale={locale} copy={copy} canTalk={canTalk} layout={layout} />;
}

export function RoomThread({ organizationId, projectId, roomRef, locale, copy, canTalk, label }: RoomThreadProps) {
  const transport = useMemo(() => brandTransport(organizationId), [organizationId]);
  return <RefThreadView transport={transport} projectId={projectId} refKey={refKeyOf(roomRef)} locale={locale} copy={copy} canTalk={canTalk} label={label} />;
}
