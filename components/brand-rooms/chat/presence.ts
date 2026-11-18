"use client";
/**
 * Whether a conversation is actually in front of the person (docs/BRAND-ROOMS-FEEDBACK.md §4). A channel
 * marks itself read only while it is: the brand's screens and the team's pages are always "in front" (the
 * default); the team's desk says "not in front" while its conversation drawer is shut, so the waiting count
 * keeps showing what waits until someone opens it. Polling goes on either way, and the desk hears about new
 * lines (`onNewest`) so it can refresh that count.
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
