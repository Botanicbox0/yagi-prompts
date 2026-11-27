"use client";
/**
 * Per-browser, per-mode "seen" store for the video studio's first-use mode explainer (VM-1).
 * Key: `twings_studio_video_mode_seen_v1`, value: compact JSON map of seen modes.
 * Every storage access is guarded by `try/catch`; corrupt or blocked storage behaves as unseen.
 */
import type { PendingVideoMode, VideoStudioMode } from "./video-modes-model";

export const VIDEO_MODE_SEEN_KEY = "twings_studio_video_mode_seen_v1";

export type SeenVideoModes = Partial<Record<PendingVideoMode, true>>;

function defaultStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readSeenVideoModes(storage: Storage | null = defaultStorage()): SeenVideoModes {
  if (!storage) return {};
  try {
    const raw = storage.getItem(VIDEO_MODE_SEEN_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const rec = parsed as Record<string, unknown>;
    const out: SeenVideoModes = {};
    if (rec.re_architect === true) out.re_architect = true;
    if (rec.motion_transfer === true) out.motion_transfer = true;
    return out;
  } catch {
    return {};
  }
}

/** `basic` never shows a first-use explainer (always treated as seen). */
export function isVideoModeSeen(mode: VideoStudioMode, storage: Storage | null = defaultStorage()): boolean {
  if (mode === "basic") return true;
  return readSeenVideoModes(storage)[mode] === true;
}

export function markVideoModeSeen(mode: PendingVideoMode, storage: Storage | null = defaultStorage()): SeenVideoModes {
  const next: SeenVideoModes = { ...readSeenVideoModes(storage), [mode]: true };
  if (storage) {
    try {
      storage.setItem(VIDEO_MODE_SEEN_KEY, JSON.stringify(next));
    } catch {
      // Blocked or quota-exceeded storage: memory-only fallback for this session.
    }
  }
  return next;
}
