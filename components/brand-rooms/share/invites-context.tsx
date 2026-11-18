"use client";
/**
 * What the share dialog needs to invite people (docs/BRAND-ROOMS-FEEDBACK.md §12). The room page provides
 * it only while `BRAND_ROOM_INVITES` is on and the viewer is an owner or editor; without it every share
 * button keeps today's link-only dialog. Presentation only: the API authorizes on its own.
 */
import { createContext, useContext, type ReactNode } from "react";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export interface RoomShareInvites {
  organizationId: string;
  projectId: string;
  locale: "ko" | "en";
  copy: Dictionary["roomsShare"];
  /** The workspace's own role names (members page), for the members' rows. */
  roles: Dictionary["brandWorkspace"]["roles"];
}

const RoomShareInvitesContext = createContext<RoomShareInvites | null>(null);

export function RoomShareInvitesProvider({ value, children }: { value: RoomShareInvites | null; children: ReactNode }) {
  return <RoomShareInvitesContext.Provider value={value}>{children}</RoomShareInvitesContext.Provider>;
}

export function useRoomShareInvites(): RoomShareInvites | null {
  return useContext(RoomShareInvitesContext);
}
