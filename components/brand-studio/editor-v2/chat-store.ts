'use client';

/**
 * Browser thread store for Editing Studio v2 right-side chat (slice E-C).
 *
 * Scoped by `${organizationId}:${userId}:${filmId}` so two members sharing a browser never see each
 * other's threads. Stores only text/metadata (never file bytes, blob/signed URLs, document snapshots,
 * or in-memory history marks). Every browser storage call lives inside `try { ... } catch` so blocked
 * or full storage degrades silently to in-memory state.
 */
export const EDITOR_CHAT_STORAGE_PREFIX = 'twings_editor_chat_v1';
export const EDITOR_CHAT_STORE_VERSION = 1;
export const EDITOR_CHAT_MAX_ENTRIES = 60;
export const EDITOR_CHAT_MAX_BYTES = 65_536;
export const EDITOR_CHAT_MAX_DRAFT_CHARS = 500;
export const EDITOR_CHAT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const SAMPLE_CHAT_FILM_ID = 'sample';
export const DEFAULT_REAL_CHAT_FILM_ID = 'own';

export interface EditorChatScope {
  organizationId: string;
  userId: string;
  filmId: string;
}

/**
 * Resolves a stable per-film id for the browser thread key:
 * - real mode: explicit filmId (server film / project id) or the real film's stable storage id;
 * - sample mode: constant `'sample'`.
 */
export function resolveChatFilmId(input: {
  isReal: boolean;
  filmId?: string | null;
  projectId?: string | null;
}): string {
  if (!input.isReal) return SAMPLE_CHAT_FILM_ID;
  const explicit = input.filmId?.trim();
  if (explicit) return explicit;
  const project = input.projectId?.trim();
  if (project) return project;
  return DEFAULT_REAL_CHAT_FILM_ID;
}

export interface StoredChatChipSummary {
  kind: 'cut' | 'playhead';
  label: string;
}

export type StoredChatEntry =
  | { id: string; kind: 'user'; text: string; chips?: StoredChatChipSummary[] }
  | { id: string; kind: 'applied'; lines: string[]; undone: boolean }
  | { id: string; kind: 'proposal'; lines: string[]; status: 'open' | 'applied' | 'dismissed' | 'stale' }
  | {
      id: string;
      kind: 'ask';
      about: string;
      message: string;
      choices: Array<{ value: string; label: string }>;
      status: 'open' | 'answered' | 'closed';
      picked?: string;
    }
  | { id: string; kind: 'note'; text: string; showExamples?: boolean };

export interface StoredEditorChat {
  v: 1;
  updatedAt: number;
  entries: StoredChatEntry[];
  draft?: string;
}

export interface LoadedEditorChat {
  entries: StoredChatEntry[];
  draft: string;
}

export function editorChatStorageKey(scope: EditorChatScope): string {
  const filmId = scope.filmId.trim() || DEFAULT_REAL_CHAT_FILM_ID;
  return `${EDITOR_CHAT_STORAGE_PREFIX}:${scope.organizationId}:${scope.userId}:${filmId}`;
}

function utf8Bytes(text: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  return text.length * 3;
}

function sanitizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) out.push(item.slice(0, 300));
  }
  return out.slice(0, 24);
}

function sanitizeChips(raw: unknown): StoredChatChipSummary[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: StoredChatChipSummary[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const kind = rec.kind === 'cut' || rec.kind === 'playhead' ? rec.kind : null;
    const label = typeof rec.label === 'string' ? rec.label.trim().slice(0, 80) : '';
    if (kind && label) out.push({ kind, label });
  }
  return out.length > 0 ? out.slice(0, 24) : undefined;
}

/** Strips any in-memory fields (such as `historyMark`, `run`, `baseSequence`) before storage or after load. */
export function sanitizeChatEntry(raw: unknown, downgradeOpen: boolean): StoredChatEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const id = typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim().slice(0, 80) : null;
  if (!id) return null;

  switch (rec.kind) {
    case 'user': {
      const text = typeof rec.text === 'string' ? rec.text.slice(0, EDITOR_CHAT_MAX_DRAFT_CHARS) : '';
      if (!text.trim()) return null;
      const chips = sanitizeChips(rec.chips);
      return chips ? { id, kind: 'user', text, chips } : { id, kind: 'user', text };
    }
    case 'applied': {
      const lines = sanitizeStringArray(rec.lines);
      if (lines.length === 0) return null;
      return { id, kind: 'applied', lines, undone: rec.undone === true };
    }
    case 'proposal': {
      const lines = sanitizeStringArray(rec.lines);
      const rawStatus = rec.status;
      if (rawStatus !== 'open' && rawStatus !== 'applied' && rawStatus !== 'dismissed' && rawStatus !== 'stale') {
        return null;
      }
      const status = downgradeOpen && rawStatus === 'open' ? 'dismissed' : rawStatus;
      return { id, kind: 'proposal', lines, status };
    }
    case 'ask': {
      const about = typeof rec.about === 'string' ? rec.about.slice(0, 80) : '';
      const message = typeof rec.message === 'string' ? rec.message.slice(0, 300) : '';
      if (!about || !message) return null;
      const rawChoices = Array.isArray(rec.choices) ? rec.choices : [];
      const choices: Array<{ value: string; label: string }> = [];
      for (const c of rawChoices) {
        if (!c || typeof c !== 'object') continue;
        const cr = c as Record<string, unknown>;
        if (typeof cr.value === 'string' && typeof cr.label === 'string' && cr.value && cr.label) {
          choices.push({ value: cr.value.slice(0, 80), label: cr.label.slice(0, 120) });
        }
      }
      const rawStatus = rec.status;
      if (rawStatus !== 'open' && rawStatus !== 'answered' && rawStatus !== 'closed') return null;
      const status = downgradeOpen && rawStatus === 'open' ? 'closed' : rawStatus;
      const picked = typeof rec.picked === 'string' && rec.picked ? rec.picked.slice(0, 80) : undefined;
      return picked ? { id, kind: 'ask', about, message, choices, status, picked } : { id, kind: 'ask', about, message, choices, status };
    }
    case 'note': {
      const text = typeof rec.text === 'string' ? rec.text.trim().slice(0, 400) : '';
      if (!text) return null;
      return rec.showExamples === true ? { id, kind: 'note', text, showExamples: true } : { id, kind: 'note', text };
    }
    default:
      return null;
  }
}

export function parseStoredEditorChat(
  raw: unknown,
  now = Date.now(),
): { ok: true; data: LoadedEditorChat } | { ok: false; reason: 'invalid' | 'expired' } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'invalid' };
  const record = raw as Record<string, unknown>;
  if (record.v !== EDITOR_CHAT_STORE_VERSION) return { ok: false, reason: 'invalid' };
  if (typeof record.updatedAt !== 'number' || !Number.isFinite(record.updatedAt)) return { ok: false, reason: 'invalid' };
  if (now - record.updatedAt > EDITOR_CHAT_TTL_MS) return { ok: false, reason: 'expired' };
  if (!Array.isArray(record.entries)) return { ok: false, reason: 'invalid' };

  const entries: StoredChatEntry[] = [];
  for (const item of record.entries) {
    const clean = sanitizeChatEntry(item, true);
    if (clean) entries.push(clean);
  }
  const trimmedEntries = entries.slice(-EDITOR_CHAT_MAX_ENTRIES);
  const draft = typeof record.draft === 'string' ? record.draft.slice(0, EDITOR_CHAT_MAX_DRAFT_CHARS) : '';
  return { ok: true, data: { entries: trimmedEntries, draft } };
}

export function serializeEditorChat(
  entries: readonly unknown[],
  draft: string,
  now = Date.now(),
): string | null {
  const cleanEntries: StoredChatEntry[] = [];
  for (const item of entries) {
    const clean = sanitizeChatEntry(item, false);
    if (clean) cleanEntries.push(clean);
  }
  const kept = cleanEntries.slice(-EDITOR_CHAT_MAX_ENTRIES);
  let cleanDraft = draft.slice(0, EDITOR_CHAT_MAX_DRAFT_CHARS);
  if (kept.length === 0 && !cleanDraft) return null;

  const build = (list: StoredChatEntry[], text: string): string => {
    const payload: StoredEditorChat = text
      ? { v: EDITOR_CHAT_STORE_VERSION, updatedAt: now, entries: list, draft: text }
      : { v: EDITOR_CHAT_STORE_VERSION, updatedAt: now, entries: list };
    return JSON.stringify(payload);
  };

  let serialized = build(kept, cleanDraft);
  while (utf8Bytes(serialized) > EDITOR_CHAT_MAX_BYTES && kept.length > 0) {
    kept.shift();
    serialized = build(kept, cleanDraft);
  }
  while (utf8Bytes(serialized) > EDITOR_CHAT_MAX_BYTES && cleanDraft.length > 0) {
    cleanDraft = cleanDraft.slice(0, Math.floor(cleanDraft.length / 2));
    serialized = build(kept, cleanDraft);
  }
  if (kept.length === 0 && !cleanDraft) return null;
  return serialized;
}

export function loadEditorChat(scope: EditorChatScope, now = Date.now()): LoadedEditorChat {
  const key = editorChatStorageKey(scope);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { entries: [], draft: '' };
    const parsed = parseStoredEditorChat(JSON.parse(raw), now);
    if (!parsed.ok) {
      window.localStorage.removeItem(key);
      return { entries: [], draft: '' };
    }
    return parsed.data;
  } catch {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Blocked storage: stay in memory.
    }
    return { entries: [], draft: '' };
  }
}

export function saveEditorChat(scope: EditorChatScope, state: { entries: readonly unknown[]; draft: string }, now = Date.now()): void {
  const key = editorChatStorageKey(scope);
  const serialized = serializeEditorChat(state.entries, state.draft, now);
  try {
    if (serialized === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, serialized);
    }
  } catch {
    // Full or blocked storage: keep thread in memory for this visit.
  }
}

export function clearEditorChat(scope: EditorChatScope): void {
  const key = editorChatStorageKey(scope);
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Blocked storage: nothing to clear.
  }
}
