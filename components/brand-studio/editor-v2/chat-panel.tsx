'use client';

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import type { MeasuredMedia } from '@/components/brand-studio/api';
import { fill } from '@/components/brand-studio/copy';
import { REF_DRAG_TYPE, acceptsDrag, decodeRefDrag, type RefSource } from '@/components/brand-studio/refs';
import { MAX_COMPOSE_CLIPS } from '@/lib/brand-studio/compose/timeline';
import type { StudioAssetKind, StudioAssetView } from '@/lib/brand-studio/contracts';
import type { AskAbout, AskChoice } from '@/lib/brand-studio/edit-assist/plan';
import { applyResolvedStepsToSequence, applyRulePatchesToSequence, type AssistInheritPair } from '@/lib/brand-studio/editor-v2/assist-apply';
import {
  diffFrameSequences,
  formatAskChoices,
  formatAskQuestion,
  formatFrameLength,
  mapFailureNoteText,
} from '@/lib/brand-studio/editor-v2/assist-diff';
import {
  ASSIST_CUT_MAX_SEC,
  buildAssistPlanInput,
  buildPlannerProject,
  validateSequenceForAssist,
} from '@/lib/brand-studio/editor-v2/assist-project';
import { formatTimecode, type FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import { editorSources, sourceSeconds, type EditorSource } from '@/lib/brand-studio/editor-v2/sources';
import type { StudioEditorCopy } from '@/messages/studio-editor';
import type { StudioEditorChatCopy } from '@/messages/studio-editor-chat';
import { requestAssistPlan, ASSIST_CLIENT_TIMEOUT_MS, type AssistClientResponse } from './assist-client';
import {
  CHAT_UPLOAD_ACCEPT,
  formatChatUploadFailure,
  precheckChatUploadFile,
  uploadChatAttachmentFile,
  type ChatUploadClient,
  type ChatUploadErrorCopy,
} from './chat-upload';
import {
  EDITOR_CHAT_MAX_CHARS,
  PLAYHEAD_CHIP_KEY,
  buildChatRecentTurns,
  buildSelectionChips,
  canUndoChatEntry,
  chatContextFromChips,
  chipSummaries,
  evaluateBatch1Utterance,
  focusEntryIdOf,
  hasOpenProposal,
  hydrateStoredEntries,
  markAppliedEntryUndone,
  startChatExchange,
  syncEntriesWithSequence,
  visibleSelectionChips,
  type ChatContextPayload,
  type ChatEntry,
  type ChatExampleChip,
  type SelectionChip,
} from './chat-model';
import { clearEditorChat, loadEditorChat, saveEditorChat, type EditorChatScope } from './chat-store';
import { EditorIcon } from './icons';
import type { AssistDock } from './layout-model';
import type { FilmStatus } from './use-editor';
import styles from './editor-v2.module.css';

const useIsoLayoutEffect = typeof document !== 'undefined' ? useLayoutEffect : useEffect;
const SCROLL_PIN_THRESHOLD_PX = 24;
/** Minimum interval between playhead chip text updates during active playback (≤ 4/s, W4). */
export const PLAYHEAD_PLAYBACK_THROTTLE_MS = 250;

export interface PlayheadBus {
  /** Exact current playhead frame (used when submitting a message). */
  get: () => number;
  /** Throttled display frame subscribed by the playhead chip leaf (≤ 4/s while playing, exact when paused). */
  getDisplay: () => number;
  set: (frame: number, playing?: boolean, nowMs?: number) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createPlayheadBus(initial = 0, minNotifyMs = PLAYHEAD_PLAYBACK_THROTTLE_MS): PlayheadBus {
  let exact = initial;
  let displayed = initial;
  let lastNotifyAt = -Infinity;
  const listeners = new Set<() => void>();
  const notify = (now: number) => {
    lastNotifyAt = now;
    for (const listener of listeners) listener();
  };
  return {
    get: () => exact,
    getDisplay: () => displayed,
    set: (frame: number, playing = false, nowMs?: number) => {
      exact = frame;
      if (displayed === frame) return;
      const now = nowMs ?? (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
      if (!playing) {
        displayed = frame;
        notify(now);
        return;
      }
      if (now - lastNotifyAt >= minNotifyMs) {
        displayed = frame;
        notify(now);
      }
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type ChatInsertSourceFn = (
  source: EditorSource,
  options?: { at?: 'end' | 'playhead'; playhead?: number },
) => Promise<{ ok: true; index: number; frames: number; fps: number; label: string } | { ok: false; reason: 'blocked' | 'limit' }>;

export const MAX_CONCURRENT_CHAT_UPLOADS = 4;

function attachmentFileKey(file: File): string {
  const modified = typeof file.lastModified === 'number' && Number.isFinite(file.lastModified) ? file.lastModified : 0;
  return `${file.name}\0${file.size}\0${modified}`;
}

export interface ChatAttachmentChip {
  id: string;
  name: string;
  kind: StudioAssetKind;
  seconds: number | null;
  status: 'waiting' | 'uploading' | 'ready' | 'failed';
  fileKey?: string;
  source?: EditorSource;
  assetId?: string;
  outputId?: string;
  file?: File;
  error?: string;
}

export interface EditorChatSessionInput {
  scope: EditorChatScope | null;
  /** True while the film id for the storage key is not yet known (W4: draw nothing in the thread area). */
  scopePending?: boolean;
  /** True when `BRAND_STUDIO_EDIT_ASSIST` is on; false falls back to the local sample parser (kill switch). */
  assistEnabled: boolean;
  locale: 'ko' | 'en';
  sequence: FrameSequence;
  selection: readonly string[];
  canUndo: boolean;
  readOnly: boolean;
  status: FilmStatus;
  copy: StudioEditorCopy;
  chatCopy: StudioEditorChatCopy | null;
  playheadBus: PlayheadBus;
  edit: (mutate: (current: FrameSequence) => FrameSequence, inherit?: ReadonlyArray<readonly [string, string]>) => void;
  undo: () => void;
  brandProjectId?: string | null;
  sources?: readonly EditorSource[];
  onAssetSaved?: (asset: StudioAssetView) => void;
  onInsertSource?: ChatInsertSourceFn;
  uploadCopy?: ChatUploadErrorCopy | null;
  uploadClient?: ChatUploadClient;
  uploadMeasure?: (file: Blob, kind: StudioAssetKind) => Promise<MeasuredMedia>;
}

export interface EditorChatSession {
  entries: ChatEntry[];
  draft: string;
  setDraft: (value: string) => void;
  /** True once the current `scope` has been hydrated before paint (W4). */
  threadReady: boolean;
  /** Non-playhead cut chips currently visible, plus a flag for whether the playhead fallback chip is visible. */
  cutChips: Extract<SelectionChip, { kind: 'cut' }>[];
  showPlayheadChip: boolean;
  /** In-memory attachment chips (never persisted in `chat-store.ts`, never sent to the planner). */
  attachments: ChatAttachmentChip[];
  attachNotice: string | null;
  insertingAttachmentId: string | null;
  attachFiles: (files: readonly File[]) => void;
  attachDraggedSource: (ref: RefSource) => boolean;
  retryAttachment: (chipId: string) => void;
  removeAttachment: (chipId: string) => void;
  insertAttachment: (chipId: string, at: 'end' | 'playhead') => void;
  getContextPayload: () => ChatContextPayload;
  dismissChip: (key: string) => void;
  submit: (overrideText?: string) => void;
  answerAsk: (entryId: string, choiceIndex: number) => void;
  applyProposal: (entryId: string) => void;
  dismissProposal: (entryId: string) => void;
  undoEntry: (entryId: string) => void;
  clearThread: () => void;
  focusEntryId: string | null;
  openProposal: boolean;
  /** Open proposal's preview sequence while `baseSequence === current.sequence`, or `null`. */
  activeDraft: FrameSequence | null;
  /** Pending split lineage pairs for the active draft preview (S1). */
  activeDraftInherit: readonly AssistInheritPair[] | null;
  busy: boolean;
  assistEnabled: boolean;
  blocked: boolean;
}

function noteForPlannerError(
  res: Extract<AssistClientResponse, { ok: false }>,
  chatCopy: StudioEditorChatCopy,
): { text: string; showExamples?: boolean } {
  switch (res.code) {
    case 'rate_limited':
      return {
        text:
          res.retryAfterSec !== undefined
            ? fill(chatCopy.noteRateLimited, { seconds: res.retryAfterSec })
            : chatCopy.noteRateLimitedNoWait,
      };
    case 'invalid':
      return { text: chatCopy.noteInvalid };
    case 'forbidden':
      return { text: chatCopy.noteForbidden };
    case 'closed':
      return { text: chatCopy.noteClosed };
    case 'malformed':
      return { text: chatCopy.noteCouldNotPlan, showExamples: true };
    case 'unsupported':
      return { text: chatCopy.noteUnmapped };
    case 'unavailable':
    default:
      return { text: chatCopy.noteUnavailable };
  }
}

function noteForCannotReason(
  reason: Extract<AssistClientResponse, { ok: true; kind: 'cannot' }>['reason'],
  chatCopy: StudioEditorChatCopy,
): { text: string; showExamples?: boolean } {
  switch (reason) {
    case 'not_timeline_edit':
      return { text: chatCopy.noteNotTimelineEdit, showExamples: true };
    case 'nothing_to_edit':
      return { text: chatCopy.noteNothingToEdit };
    case 'not_possible':
      return { text: chatCopy.noteNotPossible };
    case 'could_not_plan':
      return { text: chatCopy.noteCouldNotPlan, showExamples: true };
    case 'unavailable':
    default:
      return { text: chatCopy.noteUnavailable };
  }
}

/**
 * Thread, browser persistence, selection chips, and real `assist.plan` (or kill-switch fallback)
 * session for right-side chat (slice E-C).
 *
 * - Loads stored thread in `useIsoLayoutEffect` so the first painted frame already shows it (no 170ms flash,
 *   no storage read during SSR/render, no hydration mismatch).
 * - Never writes on initial mount/hydration; only persists after a real post-load change (`dirtyRef`).
 * - Aborts any in-flight `assist.plan` request on unmount or scope change; guards double-send while busy;
 *   marks late answers stale if `sequence` changed before arrival.
 * - Does not depend on `playhead`, so playback/scrubbing causes zero re-renders of the chat panel or thread.
 */
export function useEditorChatSession(input: EditorChatSessionInput): EditorChatSession | null {
  const {
    scope,
    scopePending = false,
    assistEnabled,
    locale,
    sequence,
    selection,
    canUndo,
    readOnly,
    status,
    copy,
    chatCopy,
    playheadBus,
    edit,
    undo,
    brandProjectId = null,
    sources = [],
    onAssetSaved,
    onInsertSource,
    uploadCopy = null,
    uploadClient,
    uploadMeasure,
  } = input;
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [draft, setDraftState] = useState('');
  const [busy, setBusy] = useState(false);
  const [hydratedScopeKey, setHydratedScopeKey] = useState<string | null>(null);
  const [dismissedChipKeys, setDismissedChipKeys] = useState<Set<string>>(() => new Set());
  const [attachments, setAttachments] = useState<ChatAttachmentChip[]>([]);
  const [attachNotice, setAttachNotice] = useState<string | null>(null);
  const [insertingAttachmentId, setInsertingAttachmentId] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const seqCounter = useRef(0);
  const appliedBaseByEntry = useRef<Map<string, FrameSequence>>(new Map());
  const removedAttachmentIdsRef = useRef<Set<string>>(new Set());
  const scopeKeyRef = useRef<string | null>(null);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const sequenceRef = useRef(sequence);
  sequenceRef.current = sequence;
  const canUndoRef = useRef(canUndo);
  canUndoRef.current = canUndo;
  const blockedRef = useRef(readOnly || status !== 'ready');
  blockedRef.current = readOnly || status !== 'ready';
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const copyRef = useRef(copy);
  copyRef.current = copy;
  const chatCopyRef = useRef(chatCopy);
  chatCopyRef.current = chatCopy;
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const onAssetSavedRef = useRef(onAssetSaved);
  onAssetSavedRef.current = onAssetSaved;
  const onInsertSourceRef = useRef(onInsertSource);
  onInsertSourceRef.current = onInsertSource;
  const uploadCopyRef = useRef(uploadCopy);
  uploadCopyRef.current = uploadCopy;
  const uploadClientRef = useRef(uploadClient);
  uploadClientRef.current = uploadClient;
  const uploadMeasureRef = useRef(uploadMeasure);
  uploadMeasureRef.current = uploadMeasure;
  const brandProjectIdRef = useRef(brandProjectId);
  brandProjectIdRef.current = brandProjectId;
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const activeUploadCountRef = useRef(0);
  const uploadQueueRef = useRef<
    Array<{ chipId: string; file: File; targetScope: EditorChatScope; expectedScopeKey: string }>
  >([]);
  const inFlightRef = useRef(false);
  const inFlightMetaRef = useRef<{
    scope: EditorChatScope;
    rawMessage: string;
    userEntryId: string | null;
    timeoutId: ReturnType<typeof setTimeout> | null;
  } | null>(null);
  const requestTokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const activeChat = Boolean(chatCopy && (scope || scopePending));
  const scopeKey = scope && chatCopy ? `${scope.organizationId}:${scope.userId}:${scope.filmId}` : null;
  scopeKeyRef.current = scopeKey;
  const threadReady = Boolean(scopeKey && hydratedScopeKey === scopeKey);
  const blocked = readOnly || status !== 'ready' || !scopeKey;
  const selectionKey = selection.join(',');

  /** Persists the current state; while a request is in flight, strips its pending/unanswered user turn and keeps its sentence as draft (W7). */
  const persistNow = useCallback((targetScope: EditorChatScope, list: readonly ChatEntry[], currentDraft: string) => {
    const inflight = inFlightMetaRef.current;
    const sameInflight =
      inflight &&
      inflight.scope.organizationId === targetScope.organizationId &&
      inflight.scope.userId === targetScope.userId &&
      inflight.scope.filmId === targetScope.filmId
        ? inflight
        : null;
    const persistable = list.filter(
      (entry) => entry.kind !== 'pending' && (!sameInflight?.userEntryId || entry.id !== sameInflight.userEntryId),
    );
    const savedDraft = currentDraft.trim() ? currentDraft : (sameInflight?.rawMessage ?? currentDraft);
    saveEditorChat(targetScope, { entries: persistable, draft: savedDraft });
  }, []);

  const abortInFlight = useCallback(
    (preserveDraftInStorage = false) => {
      const meta = inFlightMetaRef.current;
      if (meta?.timeoutId !== null && meta?.timeoutId !== undefined) {
        clearTimeout(meta.timeoutId);
      }
      if (preserveDraftInStorage && meta) {
        persistNow(meta.scope, entriesRef.current, draftRef.current);
      }
      inFlightMetaRef.current = null;
      requestTokenRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      inFlightRef.current = false;
      setBusy(false);
    },
    [persistNow],
  );

  // Preserve in-flight sentence as unsent draft on pagehide / unmount (W7) and abort cleanly.
  useEffect(() => {
    const onPageHide = () => {
      const meta = inFlightMetaRef.current;
      if (meta) persistNow(meta.scope, entriesRef.current, draftRef.current);
    };
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', onPageHide);
    }
    return () => {
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('pagehide', onPageHide);
      }
      const meta = inFlightMetaRef.current;
      if (meta?.timeoutId !== null && meta?.timeoutId !== undefined) {
        clearTimeout(meta.timeoutId);
      }
      if (meta) {
        persistNow(meta.scope, entriesRef.current, draftRef.current);
      }
      inFlightMetaRef.current = null;
      requestTokenRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      inFlightRef.current = false;
    };
  }, [persistNow]);

  // Hydrate persisted thread before first paint (`useIsoLayoutEffect`). Reset dirtyRef and abort stale requests on scope change.
  useIsoLayoutEffect(() => {
    abortInFlight(true);
    dirtyRef.current = false;
    appliedBaseByEntry.current.clear();
    removedAttachmentIdsRef.current.clear();
    uploadQueueRef.current = [];
    setAttachments([]);
    setAttachNotice(null);
    setInsertingAttachmentId(null);
    if (!scopeKey || !scopeRef.current) {
      setEntries([]);
      setDraftState('');
      setHydratedScopeKey(null);
      return;
    }
    const loaded = loadEditorChat(scopeRef.current);
    setEntries(hydrateStoredEntries(loaded.entries));
    setDraftState(loaded.draft);
    setHydratedScopeKey(scopeKey);
  }, [scopeKey, abortInFlight]);

  // Persist ONLY after a real post-load mutation (never on initial mount/hydration).
  useEffect(() => {
    if (!scopeKey || !scopeRef.current || !dirtyRef.current) return;
    persistNow(scopeRef.current, entries, draft);
  }, [scopeKey, entries, draft, persistNow]);

  // Reset dismissed selection chips when cut selection changes.
  useEffect(() => {
    setDismissedChipKeys((prev) => (prev.size === 0 ? prev : new Set()));
  }, [selectionKey]);

  // Sync open proposals (strict stale check) and applied cards (Undo -> undone, Redo -> restored).
  useEffect(() => {
    if (!scopeKey) return;
    setEntries((prev) => {
      const next = syncEntriesWithSequence(prev, sequence, appliedBaseByEntry.current);
      if (next !== prev) dirtyRef.current = true;
      return next;
    });
  }, [scopeKey, sequence]);

  const cutChips = useMemo(() => {
    if (!scopeKey || !chatCopy || sequence.clips.length === 0) return [];
    const built = buildSelectionChips({ sequence, selection, playhead: 0, chatCopy });
    const visible = visibleSelectionChips(built, dismissedChipKeys);
    return visible.filter((chip): chip is Extract<SelectionChip, { kind: 'cut' }> => chip.kind === 'cut');
  }, [scopeKey, chatCopy, sequence, selection, dismissedChipKeys]);

  const hasSelectedCutsInSequence = useMemo(() => {
    if (sequence.clips.length === 0 || selection.length === 0) return false;
    const selectedSet = new Set(selection);
    return sequence.clips.some((clip) => selectedSet.has(clip.id));
  }, [sequence, selection]);

  const showPlayheadChip = Boolean(
    scopeKey &&
      sequence.clips.length > 0 &&
      !hasSelectedCutsInSequence &&
      !dismissedChipKeys.has(PLAYHEAD_CHIP_KEY),
  );

  const visibleChipsNow = useCallback((): SelectionChip[] => {
    if (!scopeKey || !chatCopy) return [];
    const all = buildSelectionChips({
      sequence,
      selection,
      playhead: playheadBus.get(),
      chatCopy,
    });
    return visibleSelectionChips(all, dismissedChipKeys);
  }, [scopeKey, chatCopy, sequence, selection, playheadBus, dismissedChipKeys]);

  const getContextPayload = useCallback((): ChatContextPayload => chatContextFromChips(visibleChipsNow()), [visibleChipsNow]);

  const nextId = useCallback((prefix: string) => {
    seqCounter.current += 1;
    return `${prefix}-${Date.now()}-${seqCounter.current}`;
  }, []);

  const setDraft = useCallback((value: string) => {
    dirtyRef.current = true;
    setDraftState(value);
  }, []);

  const dismissChip = useCallback((key: string) => {
    setDismissedChipKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const runPlannerRequest = useCallback(
    (params: {
      rawMessage: string;
      activeChips: SelectionChip[];
      context: ChatContextPayload;
      answering?: { entryId: string; pickedLabel: string; answer: { about: AskAbout; value: AskChoice } };
      clearDraft: boolean;
    }) => {
      const currentScope = scopeRef.current;
      const cc = chatCopyRef.current;
      if (!scopeKey || !currentScope || !cc || blockedRef.current || inFlightRef.current) return;

      const { rawMessage, activeChips, context, answering, clearDraft } = params;
      const requestBase = sequenceRef.current;

      // Client-side pre-send checks (600s cut cap, 24-cut cap, 80-char id cap): emit honest note without sending.
      const precheck = validateSequenceForAssist(requestBase);
      if (!precheck.ok) {
        const noteText =
          precheck.reason === 'too_long_cut'
            ? fill(cc.noteTooLongCut, { minutes: Math.round(ASSIST_CUT_MAX_SEC / 60) })
            : precheck.reason === 'too_many_cuts'
              ? fill(cc.noteTooManyCuts, { max: MAX_COMPOSE_CLIPS })
              : cc.noteCouldNotPlan;
        const showExamples = precheck.reason === 'id_too_long';
        const userEntry: ChatEntry = {
          id: nextId('u'),
          kind: 'user',
          text: rawMessage.slice(0, EDITOR_CHAT_MAX_CHARS),
          ...(chipSummaries(activeChips) ? { chips: chipSummaries(activeChips) } : {}),
        };
        dirtyRef.current = true;
        setEntries((prev) => [
          ...startChatExchange(prev),
          ...(answering ? [] : [userEntry]),
          { id: nextId('n'), kind: 'note', text: noteText, ...(showExamples ? { showExamples: true } : {}) },
        ]);
        if (clearDraft) setDraftState('');
        setDismissedChipKeys(new Set());
        return;
      }

      // Build `recent` from history prior to this turn (for an ask answer, exclude the ask's own exchange).
      const before = entriesRef.current;
      let pastEnd = before.length;
      if (answering) {
        const askIdx = before.findIndex((e) => e.id === answering.entryId);
        if (askIdx >= 0) {
          pastEnd = askIdx;
          while (pastEnd > 0 && before[pastEnd - 1]!.kind !== 'user') pastEnd -= 1;
          pastEnd = Math.max(0, pastEnd - 1);
        }
      }
      const recent = buildChatRecentTurns(before.slice(0, pastEnd));

      const project = buildPlannerProject(requestBase);
      // S4: send ONLY what is on the visible chips (`selectedClipId` if a cut chip is visible, `playheadSec` ONLY if playhead chip is visible).
      const inputPayload = buildAssistPlanInput({
        organizationId: currentScope.organizationId,
        message: rawMessage,
        locale,
        project,
        ...(context.playheadSec !== undefined ? { playheadSec: context.playheadSec } : {}),
        selectedClipId: context.selectedClipId ?? null,
        recent,
        ...(answering ? { answer: answering.answer } : {}),
      });

      const pendingId = nextId('pending');
      const userEntryId = answering ? null : nextId('u');
      const userEntry: ChatEntry | null = userEntryId
        ? {
            id: userEntryId,
            kind: 'user',
            text: rawMessage.slice(0, EDITOR_CHAT_MAX_CHARS),
            ...(chipSummaries(activeChips) ? { chips: chipSummaries(activeChips) } : {}),
          }
        : null;

      const controller = new AbortController();
      let settled = false;
      let timedOut = false;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        controller.abort();
      }, ASSIST_CLIENT_TIMEOUT_MS);

      abortRef.current = controller;
      inFlightRef.current = true;
      inFlightMetaRef.current = { scope: currentScope, rawMessage, userEntryId, timeoutId };
      requestTokenRef.current += 1;
      const token = requestTokenRef.current;
      setBusy(true);
      dirtyRef.current = true;

      setEntries((prev) => {
        const closed = prev
          .filter((entry) => entry.kind !== 'pending')
          .map((entry) => {
            if (entry.kind === 'proposal' && entry.status === 'open') {
              return { id: entry.id, kind: 'proposal' as const, lines: entry.lines, status: 'dismissed' as const };
            }
            if (entry.kind === 'ask' && entry.status === 'open') {
              if (answering && entry.id === answering.entryId) {
                return { ...entry, status: 'answered' as const, picked: answering.pickedLabel };
              }
              return { ...entry, status: 'closed' as const };
            }
            return entry;
          });
        return [
          ...closed,
          ...(userEntry ? [userEntry] : []),
          { id: pendingId, kind: 'pending' as const, text: cc.sending },
        ];
      });
      if (clearDraft) setDraftState('');
      setDismissedChipKeys(new Set());

      void (async () => {
        const wasTimedOut = () => timedOut && controller.signal.aborted;
        const isSuperseded = () => (controller.signal.aborted && !wasTimedOut()) || token !== requestTokenRef.current;
        const clearPending = () => {
          setEntries((prev) => {
            const next = prev.filter((entry) => entry.id !== pendingId && entry.kind !== 'pending');
            return next.length === prev.length ? prev : next;
          });
        };
        const finishWith = (reply: ChatEntry) => {
          dirtyRef.current = true;
          setEntries((prev) => {
            const withoutPending = prev.filter((entry) => entry.id !== pendingId && entry.kind !== 'pending');
            return [...withoutPending, reply];
          });
        };

        try {
          let response: AssistClientResponse;
          try {
            response = await requestAssistPlan(inputPayload, controller.signal);
            // S3: clear timeout immediately upon resolution so a queued timer cannot discard a good answer.
            settled = true;
            clearTimeout(timeoutId);
          } catch {
            settled = true;
            clearTimeout(timeoutId);
            if (isSuperseded()) return;
            response = { ok: false, code: 'unavailable' };
          }
          if (isSuperseded()) return;

          inFlightMetaRef.current = null;
          inFlightRef.current = false;
          abortRef.current = null;
          setBusy(false);

          const latestCopy = copyRef.current;
          const latestChatCopy = chatCopyRef.current;
          if (!latestChatCopy) {
            clearPending();
            return;
          }
          const currentSeq = sequenceRef.current;

          // W1 + S3 + SMALL #2: only treat as timed out if timeout actually aborted the request.
          // If the box is empty, restore the sentence into the box; if the box already holds new text,
          // keep the new text and include the old sentence quoted in the timeout note so it can be copied.
          if (wasTimedOut()) {
            const existingDraft = draftRef.current.trim();
            if (clearDraft && !existingDraft) {
              setDraftState(rawMessage);
              finishWith({ id: nextId('n'), kind: 'note', text: latestChatCopy.noteUnavailable });
            } else {
              finishWith({
                id: nextId('n'),
                kind: 'note',
                text: fill(latestChatCopy.noteTimeoutQuoted, { message: rawMessage }),
              });
            }
            return;
          }

          if (!response.ok) {
            const note = noteForPlannerError(response, latestChatCopy);
            finishWith({
              id: nextId('n'),
              kind: 'note',
              text: note.text,
              ...(note.showExamples ? { showExamples: true } : {}),
            });
            return;
          }

          if (response.kind === 'cannot') {
            const note = noteForCannotReason(response.reason, latestChatCopy);
            finishWith({
              id: nextId('n'),
              kind: 'note',
              text: note.text,
              ...(note.showExamples ? { showExamples: true } : {}),
            });
            return;
          }

          if (response.kind === 'undo') {
            const open = hasOpenProposal(entriesRef.current);
            const topApplied = [...entriesRef.current]
              .reverse()
              .find((entry) => canUndoChatEntry(entry, currentSeq, canUndoRef.current, open, blockedRef.current));
            if (!topApplied) {
              finishWith({ id: nextId('n'), kind: 'note', text: latestChatCopy.noteNothingToUndo });
              return;
            }
            undo();
            dirtyRef.current = true;
            setEntries((prev) => {
              const cleaned = prev.filter((entry) => entry.id !== pendingId && entry.kind !== 'pending');
              return markAppliedEntryUndone(cleaned, topApplied.id);
            });
            return;
          }

          if (response.kind === 'ask') {
            const formatted = formatAskChoices(response.choices, currentSeq, latestChatCopy);
            if (formatted.length === 0) {
              finishWith({ id: nextId('n'), kind: 'note', text: latestChatCopy.noteTargetMissing });
              return;
            }
            finishWith({
              id: nextId('q'),
              kind: 'ask',
              about: response.about,
              message: formatAskQuestion(response.about, latestChatCopy),
              choices: formatted.map((c) => ({ value: c.key, label: c.label })),
              status: 'open',
              originalMessage: rawMessage,
              choiceValues: formatted.map((c) => c.value),
            });
            return;
          }

          // S1: Guard mapping + diff with try/catch so any unexpected error falls back to `noteCouldNotPlan`.
          let mapped: ReturnType<typeof applyResolvedStepsToSequence>;
          let lines: string[];
          try {
            mapped =
              response.kind === 'plan'
                ? applyResolvedStepsToSequence(requestBase, response.steps)
                : applyRulePatchesToSequence(requestBase, response.patches, requestBase);
            if (!mapped.ok) {
              finishWith({
                id: nextId('n'),
                kind: 'note',
                text: mapFailureNoteText(mapped.reason, latestChatCopy),
              });
              return;
            }
            lines = diffFrameSequences(requestBase, mapped.sequence, latestCopy, latestChatCopy, mapped.inherit);
          } catch {
            finishWith({
              id: nextId('n'),
              kind: 'note',
              text: latestChatCopy.noteCouldNotPlan,
              showExamples: true,
            });
            return;
          }

          if (lines.length === 0) {
            finishWith({ id: nextId('n'), kind: 'note', text: latestChatCopy.noteNoChange });
            return;
          }

          // Strict stale check on arrival: if timeline changed while waiting, mark stale immediately (never open preview).
          if (currentSeq !== requestBase) {
            finishWith({
              id: nextId('p'),
              kind: 'proposal',
              lines,
              status: 'stale',
            });
            return;
          }

          finishWith({
            id: nextId('p'),
            kind: 'proposal',
            lines,
            status: 'open',
            baseSequence: requestBase,
            nextSequence: mapped.sequence,
            ...(mapped.inherit.length > 0 ? { inherit: mapped.inherit } : {}),
          });
        } catch {
          if (!isSuperseded()) {
            const fallbackCopy = chatCopyRef.current;
            if (fallbackCopy) {
              finishWith({ id: nextId('n'), kind: 'note', text: fallbackCopy.noteCouldNotPlan, showExamples: true });
            } else {
              clearPending();
            }
          }
        } finally {
          clearTimeout(timeoutId);
          if (token === requestTokenRef.current) {
            inFlightMetaRef.current = null;
            inFlightRef.current = false;
            abortRef.current = null;
            setBusy(false);
          }
        }
      })();
    },
    [scopeKey, locale, playheadBus, nextId, undo],
  );

  const submit = useCallback(
    (overrideText?: string) => {
      if (!scopeKey || !chatCopy || blocked || inFlightRef.current) return;
      const raw = (overrideText ?? draftRef.current).trim();
      if (!raw) return;

      const activeChips = visibleChipsNow();
      const context = chatContextFromChips(activeChips);

      if (raw.length > EDITOR_CHAT_MAX_CHARS) {
        dirtyRef.current = true;
        setEntries((prev) => [
          ...startChatExchange(prev),
          { id: nextId('n'), kind: 'note', text: fill(chatCopy.noteTooLongMessage, { max: EDITOR_CHAT_MAX_CHARS }) },
        ]);
        return;
      }

      if (assistEnabled) {
        runPlannerRequest({
          rawMessage: raw,
          activeChips,
          context,
          clearDraft: overrideText === undefined,
        });
        return;
      }

      // Kill switch (`BRAND_STUDIO_EDIT_ASSIST` off) fallback: local sample parser, zero network calls.
      const userEntry: ChatEntry = {
        id: nextId('u'),
        kind: 'user',
        text: raw.slice(0, EDITOR_CHAT_MAX_CHARS),
        ...(chipSummaries(activeChips) ? { chips: chipSummaries(activeChips) } : {}),
      };
      const outcome = evaluateBatch1Utterance(raw, sequence, context, copy, chatCopy);
      const replyEntry: ChatEntry =
        outcome.kind === 'proposal'
          ? {
              id: nextId('p'),
              kind: 'proposal',
              lines: outcome.lines,
              status: 'open',
              baseSequence: outcome.baseSequence,
              nextSequence: outcome.nextSequence,
            }
          : {
              id: nextId('n'),
              kind: 'note',
              text: outcome.text,
              ...(outcome.showExamples ? { showExamples: true } : {}),
            };

      dirtyRef.current = true;
      setEntries((prev) => [...startChatExchange(prev), userEntry, replyEntry]);
      if (overrideText === undefined) setDraftState('');
      setDismissedChipKeys(new Set());
    },
    [scopeKey, chatCopy, blocked, assistEnabled, visibleChipsNow, runPlannerRequest, sequence, copy, nextId],
  );

  const answerAsk = useCallback(
    (entryId: string, choiceIndex: number) => {
      if (!scopeKey || !chatCopy || blocked || inFlightRef.current || !assistEnabled) return;
      const target = entriesRef.current.find((entry) => entry.id === entryId);
      if (!target || target.kind !== 'ask' || target.status !== 'open') return;
      const choice = target.choices[choiceIndex];
      const structured = target.choiceValues?.[choiceIndex];
      const original = target.originalMessage;
      if (!choice || structured === undefined || !original) return;

      const activeChips = visibleChipsNow();
      const context = chatContextFromChips(activeChips);
      runPlannerRequest({
        rawMessage: original,
        activeChips,
        context,
        answering: {
          entryId,
          pickedLabel: choice.label,
          answer: { about: target.about as AskAbout, value: structured },
        },
        clearDraft: false,
      });
    },
    [scopeKey, chatCopy, blocked, assistEnabled, visibleChipsNow, runPlannerRequest],
  );

  const applyProposal = useCallback(
    (entryId: string) => {
      if (!scopeKey || !chatCopy) return;
      if (blocked) {
        dirtyRef.current = true;
        setEntries((prev) => [...prev, { id: nextId('n'), kind: 'note', text: chatCopy.noteBlocked }]);
        return;
      }
      const target = entriesRef.current.find((entry) => entry.id === entryId);
      if (!target || target.kind !== 'proposal' || target.status !== 'open' || !target.nextSequence || !target.baseSequence) {
        return;
      }
      if (sequence !== target.baseSequence) {
        dirtyRef.current = true;
        setEntries((prev) =>
          prev.map((entry) =>
            entry.id === entryId && entry.kind === 'proposal'
              ? { id: entry.id, kind: 'proposal', lines: entry.lines, status: 'stale' }
              : entry,
          ),
        );
        return;
      }
      const nextSequence = target.nextSequence;
      const baseSequence = target.baseSequence;
      const inheritPairs = target.inherit;
      appliedBaseByEntry.current.set(entryId, baseSequence);
      dirtyRef.current = true;
      edit(() => nextSequence, inheritPairs);
      setEntries((prev) =>
        prev.map((entry) =>
          entry.id === entryId
            ? {
                id: entry.id,
                kind: 'applied',
                lines: target.lines,
                undone: false,
                historySequence: nextSequence,
              }
            : entry,
        ),
      );
    },
    [scopeKey, chatCopy, blocked, sequence, edit, nextId],
  );

  const dismissProposal = useCallback((entryId: string) => {
    dirtyRef.current = true;
    setEntries((prev) =>
      prev.map((entry) =>
        entry.id === entryId && entry.kind === 'proposal'
          ? { id: entry.id, kind: 'proposal', lines: entry.lines, status: 'dismissed' }
          : entry,
      ),
    );
  }, []);

  const undoEntry = useCallback(
    (entryId: string) => {
      if (!scopeKey || !chatCopy) return;
      const currentEntries = entriesRef.current;
      const target = currentEntries.find((entry) => entry.id === entryId);
      const open = hasOpenProposal(currentEntries);
      if (!target || !canUndoChatEntry(target, sequence, canUndo, open, blocked)) {
        dirtyRef.current = true;
        setEntries((prev) => [...prev, { id: nextId('n'), kind: 'note', text: chatCopy.noteNothingToUndo }]);
        return;
      }
      dirtyRef.current = true;
      undo();
      setEntries((prev) => markAppliedEntryUndone(prev, entryId));
    },
    [scopeKey, chatCopy, sequence, canUndo, blocked, undo, nextId],
  );

  const clearThread = useCallback(() => {
    if (!scopeKey || !scopeRef.current) return;
    abortInFlight();
    appliedBaseByEntry.current.clear();
    dirtyRef.current = false;
    setEntries([]);
    setDraftState('');
    clearEditorChat(scopeRef.current);
  }, [scopeKey, abortInFlight]);

  const drainUploadQueue = useCallback(() => {
    while (activeUploadCountRef.current < MAX_CONCURRENT_CHAT_UPLOADS && uploadQueueRef.current.length > 0) {
      const next = uploadQueueRef.current.shift()!;
      if (removedAttachmentIdsRef.current.has(next.chipId) || scopeKeyRef.current !== next.expectedScopeKey) {
        continue;
      }
      activeUploadCountRef.current += 1;
      setAttachments((prev) =>
        prev.map((item) => (item.id === next.chipId ? { ...item, status: 'uploading', error: undefined } : item)),
      );
      void (async () => {
        try {
          const result = await uploadChatAttachmentFile({
            organizationId: next.targetScope.organizationId,
            file: next.file,
            brandProjectId: brandProjectIdRef.current,
            client: uploadClientRef.current,
            measure: uploadMeasureRef.current,
          });
          if (result.ok) {
            // Consistent with the materials list: once the server completes the upload, register the asset in
            // the film's sources even if the customer removed the chat chip mid-upload.
            onAssetSavedRef.current?.(result.asset);
          }
          if (removedAttachmentIdsRef.current.has(next.chipId) || scopeKeyRef.current !== next.expectedScopeKey) {
            return;
          }
          const cc = chatCopyRef.current;
          if (!cc) return;
          if (!result.ok) {
            const line = formatChatUploadFailure(uploadCopyRef.current, cc, result);
            if (result.precheck) {
              setAttachments((prev) => prev.filter((item) => item.id !== next.chipId));
              setAttachNotice(line);
              return;
            }
            setAttachments((prev) =>
              prev.map((item) => (item.id === next.chipId ? { ...item, status: 'failed', error: line } : item)),
            );
            return;
          }
          const videoSource =
            result.kind === 'video' ? editorSources(next.targetScope.organizationId, [result.asset], [])[0] : undefined;
          setAttachments((prev) =>
            prev.map((item) =>
              item.id === next.chipId
                ? {
                    id: item.id,
                    name: result.asset.name || item.name,
                    kind: result.kind,
                    seconds: result.asset.seconds,
                    status: 'ready',
                    fileKey: item.fileKey,
                    assetId: result.asset.id,
                    ...(videoSource ? { source: videoSource } : {}),
                  }
                : item,
            ),
          );
        } finally {
          activeUploadCountRef.current = Math.max(0, activeUploadCountRef.current - 1);
          drainUploadQueue();
        }
      })();
    }
  }, []);

  const attachFiles = useCallback(
    (files: readonly File[]) => {
      const currentScope = scopeRef.current;
      const cc = chatCopyRef.current;
      if (!scopeKey || !currentScope || !cc || readOnlyRef.current || status !== 'ready' || files.length === 0) return;
      setAttachNotice(null);
      const activeKeys = new Set<string>();
      for (const existing of attachmentsRef.current) {
        if (
          existing.fileKey &&
          (existing.status === 'waiting' || existing.status === 'uploading' || existing.status === 'ready')
        ) {
          activeKeys.add(existing.fileKey);
        }
      }
      const addedChips: ChatAttachmentChip[] = [];
      let notice: string | null = null;
      for (const file of files) {
        const check = precheckChatUploadFile(file);
        if (!check.ok) {
          notice = formatChatUploadFailure(uploadCopyRef.current, cc, check);
          continue;
        }
        const fileKey = attachmentFileKey(file);
        if (activeKeys.has(fileKey)) {
          notice = cc.attachDuplicate;
          continue;
        }
        activeKeys.add(fileKey);
        const chipId = nextId('att');
        addedChips.push({
          id: chipId,
          name: file.name || check.kind,
          kind: check.kind,
          seconds: null,
          status: 'waiting',
          fileKey,
          file,
        });
        uploadQueueRef.current.push({ chipId, file, targetScope: currentScope, expectedScopeKey: scopeKey });
      }
      if (notice) setAttachNotice(notice);
      if (addedChips.length > 0) {
        setAttachments((prev) => [...prev, ...addedChips]);
        drainUploadQueue();
      }
    },
    [scopeKey, status, nextId, drainUploadQueue],
  );

  const attachDraggedSource = useCallback(
    (ref: RefSource): boolean => {
      const cc = chatCopyRef.current;
      if (!scopeKey || !cc || readOnlyRef.current || status !== 'ready') return false;
      const found = sourcesRef.current.find((s) =>
        'assetId' in ref ? s.kind === 'asset' && s.id === ref.assetId : s.kind === 'output' && s.id === ref.outputId,
      );
      if (!found) return false;
      setAttachNotice(null);
      const chipId = nextId('att');
      setAttachments((prev) => [
        ...prev,
        {
          id: chipId,
          name: found.label,
          kind: 'video',
          seconds: sourceSeconds(found),
          status: 'ready',
          source: found,
          ...(found.kind === 'asset' ? { assetId: found.id } : { outputId: found.id }),
        },
      ]);
      return true;
    },
    [scopeKey, status, nextId],
  );

  const retryAttachment = useCallback(
    (chipId: string) => {
      const currentScope = scopeRef.current;
      if (!scopeKey || !currentScope || readOnlyRef.current || status !== 'ready') return;
      const target = attachmentsRef.current.find((item) => item.id === chipId);
      if (!target || target.status !== 'failed' || !target.file) return;
      setAttachNotice(null);
      setAttachments((prev) =>
        prev.map((item) => (item.id === chipId ? { ...item, status: 'waiting', error: undefined } : item)),
      );
      uploadQueueRef.current.push({ chipId, file: target.file, targetScope: currentScope, expectedScopeKey: scopeKey });
      drainUploadQueue();
    },
    [scopeKey, status, drainUploadQueue],
  );

  const removeAttachment = useCallback((chipId: string) => {
    removedAttachmentIdsRef.current.add(chipId);
    uploadQueueRef.current = uploadQueueRef.current.filter((item) => item.chipId !== chipId);
    setAttachments((prev) => prev.filter((item) => item.id !== chipId));
  }, []);

  const insertAttachment = useCallback(
    (chipId: string, at: 'end' | 'playhead') => {
      const cc = chatCopyRef.current;
      const insertFn = onInsertSourceRef.current;
      if (
        !scopeKey ||
        !cc ||
        !insertFn ||
        blockedRef.current ||
        hasOpenProposal(entriesRef.current) ||
        sequenceRef.current.clips.length >= MAX_COMPOSE_CLIPS
      ) {
        return;
      }
      const target = attachmentsRef.current.find((item) => item.id === chipId);
      if (!target || target.status !== 'ready' || target.kind !== 'video' || !target.source) return;
      setInsertingAttachmentId(chipId);
      const currentPlayhead = playheadBus.get();
      void (async () => {
        try {
          const res = await insertFn(target.source!, { at, playhead: currentPlayhead });
          if (scopeKeyRef.current !== scopeKey) return;
          const latestChatCopy = chatCopyRef.current;
          if (!latestChatCopy || !res.ok) return;
          const length = formatFrameLength(res.frames, res.fps);
          const line =
            at === 'playhead' && res.index > 0
              ? fill(latestChatCopy.attachInsertedAfterCut, { name: res.label, n: res.index, length })
              : fill(latestChatCopy.attachInsertedEnd, { name: res.label, length });
          dirtyRef.current = true;
          setEntries((prev) => [...prev, { id: nextId('n'), kind: 'note', text: line }]);
        } finally {
          setInsertingAttachmentId((cur) => (cur === chipId ? null : cur));
        }
      })();
    },
    [scopeKey, playheadBus, nextId],
  );

  const focusEntryId = useMemo(() => focusEntryIdOf(entries), [entries]);
  const openProposal = useMemo(() => hasOpenProposal(entries), [entries]);
  const activeProposalEntry = useMemo(() => {
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i]!;
      if (entry.kind === 'proposal' && entry.status === 'open' && entry.nextSequence && entry.baseSequence === sequence) {
        return entry;
      }
    }
    return null;
  }, [entries, sequence]);
  const activeDraft = activeProposalEntry?.nextSequence ?? null;
  const activeDraftInherit = activeProposalEntry?.inherit ?? null;

  return useMemo(() => {
    if (!activeChat) return null;
    return {
      entries,
      draft,
      setDraft,
      threadReady,
      cutChips,
      showPlayheadChip,
      attachments,
      attachNotice,
      insertingAttachmentId,
      attachFiles,
      attachDraggedSource,
      retryAttachment,
      removeAttachment,
      insertAttachment,
      getContextPayload,
      dismissChip,
      submit,
      answerAsk,
      applyProposal,
      dismissProposal,
      undoEntry,
      clearThread,
      focusEntryId,
      openProposal,
      activeDraft,
      activeDraftInherit,
      busy,
      assistEnabled,
      blocked,
    };
  }, [
    activeChat,
    entries,
    draft,
    setDraft,
    threadReady,
    cutChips,
    showPlayheadChip,
    attachments,
    attachNotice,
    insertingAttachmentId,
    attachFiles,
    attachDraggedSource,
    retryAttachment,
    removeAttachment,
    insertAttachment,
    getContextPayload,
    dismissChip,
    submit,
    answerAsk,
    applyProposal,
    dismissProposal,
    undoEntry,
    clearThread,
    focusEntryId,
    openProposal,
    activeDraft,
    activeDraftInherit,
    busy,
    assistEnabled,
    blocked,
  ]);
}

function isImeComposing(event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean {
  const native = event.nativeEvent as KeyboardEvent | undefined;
  const ev = event as unknown as { isComposing?: boolean; keyCode?: number };
  return Boolean(native?.isComposing || ev.isComposing || ev.keyCode === 229 || native?.keyCode === 229);
}

/**
 * Tiny leaf component that subscribes to playhead updates so scrubbing/playback never re-renders
 * the chat panel or thread.
 */
const PlayheadChipLeaf = memo(function PlayheadChipLeaf({
  bus,
  fps,
  chatCopy,
  onDismiss,
}: {
  bus: PlayheadBus;
  fps: number;
  chatCopy: StudioEditorChatCopy;
  onDismiss: () => void;
}) {
  const frame = useSyncExternalStore(bus.subscribe, bus.getDisplay, bus.getDisplay);
  const label = fill(chatCopy.chipPlayhead, { time: formatTimecode(frame, fps) });
  return (
    <span className={styles.chatChip} data-editor-chat-chip="playhead">
      <span>{label}</span>
      <button
        type="button"
        className={styles.chatChipRemove}
        onClick={onDismiss}
        aria-label={fill(chatCopy.chipRemove, { label })}
        data-editor-chat-chip-remove={PLAYHEAD_CHIP_KEY}
      >
        <EditorIcon name="close" />
      </button>
    </span>
  );
});

interface ChatThreadProps {
  entries: ChatEntry[];
  threadReady: boolean;
  status: FilmStatus;
  focusEntryId: string | null;
  openProposal: boolean;
  blocked: boolean;
  busy: boolean;
  assistEnabled: boolean;
  canUndo: boolean;
  sequence: FrameSequence;
  chatCopy: StudioEditorChatCopy;
  examples: readonly ChatExampleChip[];
  onSubmitExample: (text: string) => void;
  onFillExample: (text: string) => void;
  onAnswerAsk: (entryId: string, choiceIndex: number) => void;
  onApply: (entryId: string) => void;
  onDismiss: (entryId: string) => void;
  onUndo: (entryId: string) => void;
  onReturnFocus: () => void;
}

const ChatThread = memo(function ChatThread({
  entries,
  threadReady,
  status,
  focusEntryId,
  openProposal,
  blocked,
  busy,
  assistEnabled,
  canUndo,
  sequence,
  chatCopy,
  examples,
  onSubmitExample,
  onFillExample,
  onAnswerAsk,
  onApply,
  onDismiss,
  onUndo,
  onReturnFocus,
}: ChatThreadProps) {
  const threadRef = useRef<HTMLDivElement | null>(null);
  const pinnedToBottomRef = useRef(true);
  const prevCountRef = useRef(entries.length);
  const focusRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const lastFocusedId = useRef<string | null>(null);

  // Move focus once onto a newly opened proposal/ask card so a stray Enter cannot apply it.
  useEffect(() => {
    if (!focusEntryId) {
      lastFocusedId.current = null;
      return;
    }
    if (lastFocusedId.current === focusEntryId) return;
    const node = focusRefs.current.get(focusEntryId);
    if (node) {
      lastFocusedId.current = focusEntryId;
      node.focus?.();
    }
  }, [focusEntryId]);

  // Scroll to newest turn when an entry is added, unless the customer has scrolled up.
  useEffect(() => {
    const grew = entries.length > prevCountRef.current;
    prevCountRef.current = entries.length;
    if (!grew || !pinnedToBottomRef.current) return;
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  const onThreadScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedToBottomRef.current = distance <= SCROLL_PIN_THRESHOLD_PX;
  };

  return (
    <div
      ref={threadRef}
      className={styles.chatThread}
      role="log"
      aria-live="polite"
      aria-label={chatCopy.threadLabel}
      onScroll={onThreadScroll}
      data-editor-chat-thread
    >
      {entries.length === 0 ? (
        threadReady && status === 'ready' ? (
          <div className={styles.chatEmpty} data-editor-chat-empty>
            <p className={styles.note} data-editor-chat-hint={assistEnabled ? 'planner' : 'fallback'}>
              {assistEnabled ? chatCopy.emptyHint : chatCopy.fallbackHint}
            </p>
            {examples.length > 0 && (
              <ul className={styles.examples}>
                {examples.map((ex) => (
                  <li key={ex.key}>
                    <button
                      type="button"
                      onClick={() => onSubmitExample(ex.text)}
                      disabled={blocked || busy}
                      data-editor-chat-example={ex.key}
                    >
                      {ex.text}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null
      ) : (
        entries.map((entry) => {
          if (entry.kind === 'pending') {
            return (
              <div key={entry.id} className={styles.chatPending} role="status" data-editor-chat-entry="pending" data-editor-chat-pending>
                <span>{entry.text}</span>
              </div>
            );
          }
          if (entry.kind === 'user') {
            return (
              <div key={entry.id} className={styles.chatUser} data-editor-chat-entry="user">
                {entry.chips && entry.chips.length > 0 && (
                  <div className={styles.chatChipBadges}>
                    {entry.chips.map((chip, idx) => (
                      <span key={`${chip.kind}-${idx}`}>{chip.label}</span>
                    ))}
                  </div>
                )}
                <p>{entry.text}</p>
              </div>
            );
          }
          if (entry.kind === 'proposal') {
            const isActionable = entry.status === 'open' && (!entry.baseSequence || entry.baseSequence === sequence);
            const displayStatus = entry.status === 'open' && !isActionable ? 'stale' : entry.status;
            return (
              <div
                key={entry.id}
                ref={(node) => {
                  if (node) focusRefs.current.set(entry.id, node);
                  else focusRefs.current.delete(entry.id);
                }}
                className={styles.chatProposal}
                role="group"
                aria-label={chatCopy.proposalTitle}
                tabIndex={isActionable ? -1 : undefined}
                data-editor-chat-entry="proposal"
                data-editor-chat-proposal={displayStatus}
              >
                <div className={styles.chatProposalHead}>
                  <strong>{chatCopy.proposalTitle}</strong>
                  {isActionable && (
                    <span className={styles.chatDraftBadge} data-editor-chat-draft-badge>
                      {chatCopy.draftBadge}
                    </span>
                  )}
                </div>
                <ul>
                  {entry.lines.map((line, i) => (
                    <li key={`${line}-${i}`}>{line}</li>
                  ))}
                </ul>
                {isActionable ? (
                  <>
                    <div className={styles.quickRow}>
                      <button
                        type="button"
                        className={styles.applyBtn}
                        disabled={blocked}
                        title={blocked ? chatCopy.noteBlocked : undefined}
                        onClick={() => {
                          onApply(entry.id);
                          onReturnFocus();
                        }}
                        data-editor-chat-apply
                      >
                        <EditorIcon name="check" />
                        {chatCopy.apply}
                      </button>
                      <button
                        type="button"
                        className={styles.fixBtn}
                        onClick={() => {
                          onDismiss(entry.id);
                          onReturnFocus();
                        }}
                        data-editor-chat-cancel
                      >
                        {chatCopy.cancel}
                      </button>
                    </div>
                    <p className={styles.chatStatusLine} data-editor-chat-draft-hint>
                      {blocked ? chatCopy.noteBlocked : chatCopy.draftLockedHint}
                    </p>
                  </>
                ) : (
                  <p className={styles.chatStatusLine}>
                    {displayStatus === 'stale'
                      ? chatCopy.proposalStale
                      : displayStatus === 'applied'
                        ? chatCopy.proposalApplied
                        : chatCopy.proposalDismissed}
                  </p>
                )}
              </div>
            );
          }
          if (entry.kind === 'ask') {
            return (
              <div
                key={entry.id}
                ref={(node) => {
                  if (node) focusRefs.current.set(entry.id, node);
                  else focusRefs.current.delete(entry.id);
                }}
                className={styles.chatAsk}
                role="group"
                aria-label={entry.message}
                tabIndex={entry.status === 'open' ? -1 : undefined}
                data-editor-chat-entry="ask"
                data-editor-chat-ask={entry.status}
              >
                <p>{entry.message}</p>
                {entry.status === 'open' ? (
                  <div className={styles.chatAskChoices}>
                    {entry.choices.map((choice, idx) => (
                      <button
                        key={`${choice.value}-${idx}`}
                        type="button"
                        disabled={blocked || busy}
                        onClick={() => {
                          onAnswerAsk(entry.id, idx);
                          onReturnFocus();
                        }}
                        data-editor-chat-ask-choice={idx}
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className={styles.chatStatusLine}>
                    {entry.status === 'answered' && entry.picked
                      ? fill(chatCopy.askAnswered, { label: entry.picked })
                      : chatCopy.askClosed}
                  </p>
                )}
              </div>
            );
          }
          if (entry.kind === 'applied') {
            const canUndoThis = canUndoChatEntry(entry, sequence, canUndo, openProposal, blocked);
            return (
              <div
                key={entry.id}
                className={styles.chatApplied}
                data-editor-chat-entry="applied"
                data-editor-chat-applied={entry.undone ? 'undone' : 'active'}
              >
                <div className={styles.chatAppliedHead}>
                  <strong>{entry.undone ? chatCopy.undone : chatCopy.proposalApplied}</strong>
                  {canUndoThis && (
                    <button
                      type="button"
                      className={styles.chatUndoBtn}
                      onClick={() => {
                        onUndo(entry.id);
                        onReturnFocus();
                      }}
                      data-editor-chat-undo
                    >
                      <EditorIcon name="undo" />
                      {chatCopy.undo}
                    </button>
                  )}
                </div>
                <ul>
                  {entry.lines.map((line, i) => (
                    <li key={`${line}-${i}`}>{line}</li>
                  ))}
                </ul>
              </div>
            );
          }
          if (entry.kind === 'note') {
            return (
              <div key={entry.id} className={styles.chatNote} data-editor-chat-entry="note" data-editor-chat-note>
                <p>{entry.text}</p>
                {entry.showExamples && examples.length > 0 && (
                  <div className={styles.chatNoteExamples} data-editor-chat-note-examples>
                    {examples.map((ex) => (
                      <button
                        key={ex.key}
                        type="button"
                        disabled={blocked}
                        onClick={() => onFillExample(ex.text)}
                        data-editor-chat-note-example={ex.key}
                      >
                        {ex.text}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          return null;
        })
      )}
    </div>
  );
});

export interface EditorChatPanelProps {
  session: EditorChatSession;
  sequence: FrameSequence;
  canUndo: boolean;
  readOnly: boolean;
  status: FilmStatus;
  chatCopy: StudioEditorChatCopy;
  examples: readonly ChatExampleChip[];
  playheadBus: PlayheadBus;
  placement: 'side' | 'bar';
  onSetDock: (dock: AssistDock) => void;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  onEscapeFocus?: () => boolean;
}

/**
 * Right-side chat panel (and compact folded bar) for Editing Studio v2 (slice E-C).
 * Memoized against narrow props so playhead ticks do not re-render the panel or thread.
 */
export const EditorChatPanel = memo(function EditorChatPanel({
  session,
  sequence,
  canUndo,
  readOnly,
  status,
  chatCopy,
  examples,
  playheadBus,
  placement,
  onSetDock,
  inputRef: externalInputRef,
  onEscapeFocus,
}: EditorChatPanelProps) {
  const internalInputRef = useRef<HTMLTextAreaElement | null>(null);
  const inputRef = externalInputRef ?? internalInputRef;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dropActive, setDropActive] = useState(false);

  // Grow textarea height up to ~5 lines in side placement.
  useEffect(() => {
    const el = inputRef.current;
    if (!el || placement !== 'side') return;
    el.style.height = 'auto';
    const scrollH = el.scrollHeight ?? 0;
    if (scrollH > 0) {
      el.style.height = `${Math.min(scrollH, 120)}px`;
    }
  }, [session.draft, placement, inputRef]);

  const placeholder = readOnly
    ? chatCopy.placeholderReadOnly
    : status !== 'ready'
      ? chatCopy.placeholderLoading
      : chatCopy.placeholder;

  const focusInput = useCallback(() => {
    inputRef.current?.focus?.();
  }, [inputRef]);

  const fillExample = useCallback(
    (text: string) => {
      session.setDraft(text);
      inputRef.current?.focus?.();
    },
    [session, inputRef],
  );

  const dismissPlayhead = useCallback(() => {
    session.dismissChip(PLAYHEAD_CHIP_KEY);
  }, [session]);

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!onEscapeFocus?.()) {
        event.currentTarget.blur?.();
      }
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      if (isImeComposing(event)) return;
      event.preventDefault();
      if (!session.busy) session.submit();
    }
  };

  const sendDisabled = !session.draft.trim() || session.blocked || session.busy;
  const sendTitle = session.busy ? chatCopy.sendingDisabled : chatCopy.send;

  if (placement === 'bar') {
    return (
      <div className={styles.assistBar} data-editor-assist="bar" data-editor-chat="bar">
        <span className={styles.assistLabel}>
          <EditorIcon name="spark" />
          {chatCopy.heading}
        </span>
        {session.entries.length > 0 && (
          <span className={styles.chatBarCount} data-editor-chat-bar-count>
            {fill(chatCopy.barSummary, { count: session.entries.length })}
          </span>
        )}
        <form
          className={styles.chatBarForm}
          onSubmit={(event) => {
            event.preventDefault();
            if (!session.busy) session.submit();
          }}
        >
          <textarea
            ref={inputRef}
            rows={1}
            className={styles.chatBarTextarea}
            value={session.draft}
            onChange={(event) => session.setDraft(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={placeholder}
            aria-label={chatCopy.heading}
            maxLength={EDITOR_CHAT_MAX_CHARS}
            disabled={session.blocked}
            data-editor-chat-input
          />
          <button
            type="submit"
            className={styles.iconBtn}
            aria-label={sendTitle}
            title={sendTitle}
            disabled={sendDisabled}
            data-editor-chat-send
          >
            <EditorIcon name="send" />
          </button>
        </form>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => onSetDock('side')}
          aria-label={chatCopy.openOnRight}
          title={chatCopy.openOnRight}
          data-editor-chat-expand
        >
          <EditorIcon name="dock" />
        </button>
      </div>
    );
  }

  const hasChips = session.cutChips.length > 0 || session.showPlayheadChip || session.attachments.length > 0;
  const canAttach = !readOnly && status === 'ready';
  const atCutLimit = sequence.clips.length >= MAX_COMPOSE_CLIPS;
  const insertDisabled = session.openProposal || session.blocked || atCutLimit || session.insertingAttachmentId !== null;
  const insertDisabledTitle = session.openProposal
    ? chatCopy.draftLockedHint
    : session.blocked
      ? chatCopy.noteBlocked
      : atCutLimit
        ? fill(chatCopy.attachCutLimit, { max: MAX_COMPOSE_CLIPS })
        : undefined;

  const onDragOverPanel = (event: ReactDragEvent<HTMLElement>) => {
    if (!canAttach || !acceptsDrag(event.dataTransfer?.types)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    setDropActive(true);
  };

  const onDragLeavePanel = (event: ReactDragEvent<HTMLElement>) => {
    if (event.currentTarget === event.target) setDropActive(false);
  };

  const onDropPanel = (event: ReactDragEvent<HTMLElement>) => {
    // Always prevent default & stop propagation on drops over the chat panel so timeline/page drop handlers never fire.
    event.preventDefault();
    event.stopPropagation();
    setDropActive(false);
    if (!canAttach) return;
    const rawRef = event.dataTransfer?.getData?.(REF_DRAG_TYPE);
    const refSource = decodeRefDrag(rawRef);
    if (refSource) {
      session.attachDraggedSource(refSource);
      return;
    }
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) {
      session.attachFiles(files);
    }
  };

  const kindLabel = (kind: StudioAssetKind) =>
    kind === 'video' ? chatCopy.attachKindVideo : kind === 'audio' ? chatCopy.attachKindAudio : chatCopy.attachKindImage;

  return (
    <aside
      className={styles.chatSide}
      aria-label={chatCopy.heading}
      data-editor-assist="side"
      data-editor-chat="side"
      data-drop-target={dropActive ? '' : undefined}
      onDragOver={onDragOverPanel}
      onDragLeave={onDragLeavePanel}
      onDrop={onDropPanel}
    >
      <header className={styles.panelHead}>
        <h2>
          <EditorIcon name="spark" />
          {chatCopy.heading}
        </h2>
        <div className={styles.chatHeadActions}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={session.clearThread}
            disabled={session.entries.length === 0 && !session.draft}
            aria-label={chatCopy.clear}
            title={chatCopy.clear}
            data-editor-chat-clear
          >
            <EditorIcon name="trash" />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => onSetDock('bar')}
            aria-label={chatCopy.foldToBar}
            title={chatCopy.foldToBar}
            data-editor-chat-fold
          >
            <EditorIcon name="bar" />
          </button>
        </div>
      </header>

      <ChatThread
        entries={session.entries}
        threadReady={session.threadReady}
        status={status}
        focusEntryId={session.focusEntryId}
        openProposal={session.openProposal}
        blocked={session.blocked}
        busy={session.busy}
        assistEnabled={session.assistEnabled}
        canUndo={canUndo}
        sequence={sequence}
        chatCopy={chatCopy}
        examples={examples}
        onSubmitExample={session.submit}
        onFillExample={fillExample}
        onAnswerAsk={session.answerAsk}
        onApply={session.applyProposal}
        onDismiss={session.dismissProposal}
        onUndo={session.undoEntry}
        onReturnFocus={focusInput}
      />

      {dropActive && (
        <p className={styles.chatDropBanner} data-editor-chat-drop-hint>
          {chatCopy.attachDropHint}
        </p>
      )}

      {session.attachNotice && (
        <p className={styles.chatAttachNotice} role="alert" data-editor-chat-attach-notice>
          {session.attachNotice}
        </p>
      )}

      {hasChips ? (
        <div className={styles.chatChips} role="group" aria-label={chatCopy.chipStripLabel} data-editor-chat-chips>
          {session.cutChips.map((chip) => (
            <span key={chip.key} className={styles.chatChip} data-editor-chat-chip="cut">
              <span>{chip.label}</span>
              <button
                type="button"
                className={styles.chatChipRemove}
                onClick={() => session.dismissChip(chip.key)}
                aria-label={fill(chatCopy.chipRemove, { label: chip.label })}
                data-editor-chat-chip-remove={chip.key}
              >
                <EditorIcon name="close" />
              </button>
            </span>
          ))}
          {session.showPlayheadChip && (
            <PlayheadChipLeaf bus={playheadBus} fps={sequence.fps} chatCopy={chatCopy} onDismiss={dismissPlayhead} />
          )}
          {session.attachments.map((att) => {
            const lenText =
              (att.kind === 'video' || att.kind === 'audio') && att.seconds !== null
                ? formatFrameLength(Math.round(att.seconds * Math.max(1, sequence.fps)), sequence.fps)
                : null;
            return (
              <div
                key={att.id}
                className={styles.chatAttachChip}
                data-editor-chat-attachment={att.status}
                data-attachment-kind={att.kind}
                data-attachment-id={att.id}
              >
                <div className={styles.chatAttachHead}>
                  <span className={styles.chatAttachName} title={att.name}>
                    {att.name}
                  </span>
                  <span className={styles.chatAttachMeta}>
                    {kindLabel(att.kind)}
                    {lenText ? ` · ${lenText}` : ''}
                  </span>
                  <button
                    type="button"
                    className={styles.chatChipRemove}
                    onClick={() => session.removeAttachment(att.id)}
                    aria-label={fill(chatCopy.chipRemove, { label: att.name })}
                    title={chatCopy.attachRemove}
                    data-editor-chat-attach-remove={att.id}
                  >
                    <EditorIcon name="close" />
                  </button>
                </div>
                {att.status === 'waiting' && (
                  <p className={styles.chatAttachNote} role="status">
                    {chatCopy.attachWaiting}
                  </p>
                )}
                {att.status === 'uploading' && (
                  <p className={styles.chatAttachNote} role="status">
                    {chatCopy.attachUploading}
                  </p>
                )}
                {att.status === 'failed' && (
                  <>
                    <p className={styles.chatAttachNote} role="alert">
                      {att.error ?? chatCopy.noteUnavailable}
                    </p>
                    <div className={styles.chatAttachActions}>
                      <button
                        type="button"
                        className={styles.chatAttachBtn}
                        onClick={() => session.retryAttachment(att.id)}
                        data-editor-chat-attach-retry={att.id}
                      >
                        {chatCopy.attachRetry}
                      </button>
                      <button
                        type="button"
                        className={styles.chatAttachBtn}
                        onClick={() => session.removeAttachment(att.id)}
                      >
                        {chatCopy.attachRemove}
                      </button>
                    </div>
                  </>
                )}
                {att.status === 'ready' && att.kind === 'video' && att.source && (
                  <div className={styles.chatAttachActions}>
                    <button
                      type="button"
                      className={styles.chatAttachBtn}
                      disabled={insertDisabled}
                      title={insertDisabledTitle}
                      aria-description={insertDisabledTitle}
                      onClick={() => session.insertAttachment(att.id, 'end')}
                      data-editor-chat-attach-end={att.id}
                    >
                      {chatCopy.attachInsertEnd}
                    </button>
                    <button
                      type="button"
                      className={styles.chatAttachBtn}
                      disabled={insertDisabled}
                      title={insertDisabledTitle}
                      aria-description={insertDisabledTitle}
                      onClick={() => session.insertAttachment(att.id, 'playhead')}
                      data-editor-chat-attach-playhead={att.id}
                    >
                      {chatCopy.attachInsertPlayhead}
                    </button>
                  </div>
                )}
                {att.status === 'ready' && att.kind !== 'video' && (
                  <p className={styles.chatAttachNote} data-editor-chat-attach-unsupported>
                    {chatCopy.attachNotTimelineYet}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ) : status === 'loading' ? (
        <div className={styles.chatChipsPlaceholder} aria-hidden="true" />
      ) : null}

      {session.attachments.length > 0 && (
        <p className={styles.chatAttachFootnote} data-editor-chat-attach-note>
          {chatCopy.attachNotSentHint}
        </p>
      )}

      <form
        className={styles.chatComposer}
        onSubmit={(event) => {
          event.preventDefault();
          if (!session.busy) session.submit();
        }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          className={styles.chatTextarea}
          value={session.draft}
          onChange={(event) => session.setDraft(event.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={placeholder}
          aria-label={chatCopy.heading}
          maxLength={EDITOR_CHAT_MAX_CHARS}
          disabled={session.blocked}
          data-editor-chat-input
        />
        <div className={styles.chatComposerBar}>
          {!readOnly ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept={CHAT_UPLOAD_ACCEPT}
                multiple
                hidden
                data-editor-chat-file-input
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = '';
                  if (files.length > 0) session.attachFiles(files);
                }}
              />
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => fileInputRef.current?.click()}
                disabled={!canAttach}
                aria-label={chatCopy.attachAdd}
                title={chatCopy.attachAdd}
                data-editor-chat-attach
              >
                <EditorIcon name="plus" />
              </button>
            </>
          ) : (
            <span aria-hidden="true" />
          )}
          <button
            type="submit"
            className={styles.iconBtn}
            aria-label={sendTitle}
            title={sendTitle}
            disabled={sendDisabled}
            data-editor-chat-send
          >
            <EditorIcon name="send" />
          </button>
        </div>
      </form>
    </aside>
  );
});
