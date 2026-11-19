/**
 * The revise conversation kept in this browser, one per output (docs/BRAND-STUDIO-VIDEO-REMIX.md §3.5). It is a
 * per-viewer convenience: every read and write is wrapped, and with storage blocked or full the conversation
 * simply lives as long as the panel does. Only plain data is kept (texts, the sheet, attached items' ids and
 * addresses, mark positions); no credentials.
 */
import type { TalkSaved, TalkStore } from "./revise-talk-flow";

const PREFIX = "twings.revise-talk.v1";
/** Conversations older than this are dropped when read. */
const KEEP_MS = 14 * 24 * 60 * 60 * 1000;

export const talkStoreKey = (organizationId: string, outputId: string) => `${PREFIX}:${organizationId}:${outputId}`;

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function browserTalkStore(organizationId: string, outputId: string, now: () => number = () => Date.now()): TalkStore {
  const key = talkStoreKey(organizationId, outputId);
  return {
    load() {
      try {
        const raw = storage()?.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { at?: number; saved?: TalkSaved };
        if (!parsed?.saved || typeof parsed.at !== "number" || now() - parsed.at > KEEP_MS) {
          storage()?.removeItem(key);
          return null;
        }
        const s = parsed.saved;
        if (!Array.isArray(s.thread) || !s.sheet || !Array.isArray(s.sheet.change)) return null;
        return s;
      } catch {
        return null;
      }
    },
    save(saved) {
      try {
        storage()?.setItem(key, JSON.stringify({ at: now(), saved }));
      } catch {
        // Full or blocked: the conversation stays on screen only.
      }
    },
    clear() {
      try {
        storage()?.removeItem(key);
      } catch {
        // Nothing to clear.
      }
    },
  };
}

/**
 * Which of these results have a conversation kept in this browser that has not become a version yet (the
 * version row marks them with a quiet dot). Making the version clears it, so a kept thread means unfinished.
 */
export function savedTalkOutputs(organizationId: string, outputIds: readonly string[], now: () => number = () => Date.now()): Set<string> {
  const out = new Set<string>();
  for (const outputId of outputIds) {
    const saved = browserTalkStore(organizationId, outputId, now).load();
    if (saved && saved.thread.some((item) => item.from === "customer")) out.add(outputId);
  }
  return out;
}

/** A store that keeps nothing (tests, and the screen when no output is open). */
export const memoryTalkStore = (): TalkStore & { value: TalkSaved | null } => {
  const store = {
    value: null as TalkSaved | null,
    load: () => store.value,
    save: (saved: TalkSaved) => {
      store.value = JSON.parse(JSON.stringify(saved)) as TalkSaved;
    },
    clear: () => {
      store.value = null;
    },
  };
  return store;
};
