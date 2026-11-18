"use client";
/**
 * Whether a conversation is actually in front of the person (docs/BRAND-ROOMS-FEEDBACK.md §4). A brand
 * member's channel marks itself read only while it is (the brand's screens are always "in front", the
 * default). The team's side has no read mark at all (its waiting count clears on an answer or 확인함, §3);
 * the desk still says "not in front" while its conversation drawer is shut. Polling goes on either way, and
 * the desk hears about new lines (`onNewest`) so it can refresh its count.
 */
import { createContext } from "react";

export interface ChatPresence {
  /** The conversation is on screen (a hidden drawer is not). */
  visible: boolean;
  /** The newest line's time changed (a poll brought something, or a line was sent). */
  onNewest?: (newestAt: string | null) => void;
}

export const ChatPresenceContext = createContext<ChatPresence>({ visible: true });

/**
 * The read-mark rule: the end of the stream is in view inside its panel, the stream has loaded, the
 * conversation is on screen, and the browser tab is the one in front.
 */
export function readMarkAllowed(state: { seen: boolean; ready: boolean; visible: boolean; pageVisible: boolean }): boolean {
  return state.seen && state.ready && state.visible && state.pageVisible;
}

/** On the desk the conversation is on screen in list mode (a column), and in review mode only while its drawer is open. */
export function deskConversationVisible(review: boolean, drawerOpen: boolean): boolean {
  return !review || drawerOpen;
}
