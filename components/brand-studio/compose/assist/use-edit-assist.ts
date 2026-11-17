'use client';

/**
 * "말로 편집" state for the editing studio (docs/BRAND-EDITING-STUDIO.md §4.1, §4.6, §7).
 *
 * Holds the log, the one open proposal (`draft` + `deltas` + the `base` it was built on), the busy flag
 * and "show original". The composer keeps the real timeline and its history; this hook only reads them
 * (`project`, `undoStack`, `redoStack`) and changes them through `commit` / `undo`.
 *
 * While a proposal is open `lockedRef.current` is true: the composer's own edit paths refuse to run, so
 * what is applied is exactly what was previewed. The ref flips synchronously with the preview state.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { ComposeClip, ComposerProject } from '@/lib/brand-studio/compose';
import type { EditDelta } from '@/lib/brand-studio/edit-assist/diff';
import type { AskAbout, AskChoice } from '@/lib/brand-studio/edit-assist/plan';
import type { StudioComposeCopy } from '@/messages/studio-compose';
import {
  buildRecent,
  canUndoEntry,
  changedCutIds,
  decideAssist,
  draftFrom,
  entryHistory,
  needsSceneDetection,
  readAssistAnswer,
  resolveSceneSplitPatches,
  settleUndone,
  startExchange,
  withProposal,
  type AssistDecision,
  type AssistEntry,
  type AssistServerAnswer,
  type DraftSource,
  type HistoryView,
} from './assist-model';
import { deltaText } from './delta-lines';

export interface EditAssistOptions {
  enabled: boolean;
  organizationId: string;
  locale: 'ko' | 'en';
  canCreate: boolean;
  copy: StudioComposeCopy;
  /** The real timeline (never the draft). */
  project: ComposerProject;
  playheadSec: number;
  selectedClipId: string | null;
  undoStack: readonly ComposerProject[];
  redoStack: readonly ComposerProject[];
  /** Commits one timeline as one history step (the hook opens the lock first). */
  commit: (next: ComposerProject) => void;
  undo: () => void;
  detectCuts: (clip: ComposeClip) => Promise<number[]>;
}

export interface AssistPreview {
  entryId: string;
  draft: ComposerProject;
  deltas: EditDelta[];
  /** The real timeline the draft was built on. */
  base: ComposerProject;
  source: DraftSource;
}

/** What the panel needs (the composer passes the whole hook result). */
export interface AssistPanelModel {
  entries: readonly AssistEntry[];
  busy: boolean;
  previewOpen: boolean;
  /** True while "show original" is held. */
  comparing: boolean;
  /** `top` / `buried` / `undone` for applied entries, `null` for the rest. */
  historyOf: (entry: AssistEntry) => 'top' | 'buried' | 'undone' | null;
  canUndo: (entry: AssistEntry) => boolean;
  send: (text: string) => void;
  answer: (entryId: string, choiceIndex: number) => void;
  applyProposal: () => void;
  dismissProposal: () => void;
  setComparing: (on: boolean) => void;
  undoEntry: (entryId: string) => void;
}

export interface EditAssist extends AssistPanelModel {
  preview: AssistPreview | null;
  lockedRef: MutableRefObject<boolean>;
  /** Cut ids that differ from the real timeline while the preview shows the draft. */
  changedIds: ReadonlySet<string>;
}

const EMPTY_IDS: ReadonlySet<string> = new Set();

async function postAssistPlan(input: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const res = await fetch('/api/brand-studio/compose', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'assist.plan', input }),
    signal,
  });
  return (await res.json()) as unknown;
}

export function useEditAssist(options: EditAssistOptions): EditAssist {
  const { enabled, canCreate, project, undoStack, redoStack } = options;
  const [entries, setEntries] = useState<AssistEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<AssistPreview | null>(null);
  const [comparing, setComparingState] = useState(false);

  const lockedRef = useRef(false);
  const latest = useRef(options);
  const entriesRef = useRef(entries);
  const previewRef = useRef(preview);
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);

  // Async continuations and event handlers read the options of the last render, not of the one that sent.
  useLayoutEffect(() => {
    latest.current = options;
    entriesRef.current = entries;
    previewRef.current = preview;
  });

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const view: HistoryView = useMemo(
    () => ({ current: project, undo: undoStack, redo: redoStack }),
    [project, undoStack, redoStack],
  );

  // An applied edit that was undone stays "undone" after its timeline leaves the redo stack.
  useEffect(() => {
    if (!enabled) return;
    setEntries((prev) => {
      if (prev.length === 0) return prev;
      const next = settleUndone(prev, view);
      return next === prev ? prev : [...next];
    });
  }, [enabled, view]);

  const nextId = (prefix: string) => {
    idRef.current += 1;
    return `${prefix}${idRef.current}`;
  };

  const openPreview = (next: AssistPreview) => {
    lockedRef.current = true;
    previewRef.current = next;
    setPreview(next);
  };

  const closePreview = () => {
    lockedRef.current = false;
    previewRef.current = null;
    setPreview(null);
    setComparingState(false);
  };

  const push = (entry: AssistEntry) => setEntries((prev) => [...prev, entry]);

  const describe = (delta: EditDelta) => deltaText(delta, latest.current.copy);

  const handleDecision = (decision: AssistDecision, message: string) => {
    const opts = latest.current;
    switch (decision.type) {
      case 'instant': {
        opts.commit(decision.draft);
        push({ id: nextId('a'), type: 'applied', deltas: decision.deltas, historyMark: decision.draft, undone: false });
        return;
      }
      case 'proposal': {
        const entryId = nextId('p');
        push({ id: entryId, type: 'proposal', deltas: decision.deltas, status: 'open' });
        openPreview({ entryId, draft: decision.draft, deltas: decision.deltas, base: opts.project, source: decision.source });
        return;
      }
      case 'nothing':
        push({ id: nextId('n'), type: 'note', code: 'no_change' });
        return;
      case 'stale':
        push({ id: nextId('n'), type: 'note', code: 'stale' });
        return;
      case 'undo':
        if (opts.undoStack.length > 0) {
          opts.undo();
          push({ id: nextId('n'), type: 'note', code: 'undone' });
        } else {
          push({ id: nextId('n'), type: 'note', code: 'nothing_to_undo' });
        }
        return;
      case 'ask':
        push({ id: nextId('q'), type: 'ask', about: decision.about, choices: decision.choices, status: 'open', message });
        return;
      case 'note':
        push({
          id: nextId('n'),
          type: 'note',
          code: decision.code,
          ...(decision.seconds !== undefined ? { seconds: decision.seconds } : {}),
        });
        return;
    }
  };

  const run = (
    rawMessage: string,
    answering?: { entryId: string; picked: number; value: { about: AskAbout; value: AskChoice } },
  ) => {
    const opts = latest.current;
    const message = rawMessage.trim();
    if (!opts.enabled || !opts.canCreate || !message) return;

    // A newer instruction wins: the older request is cancelled and its answer ignored.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    seqRef.current += 1;
    const seq = seqRef.current;

    const before = entriesRef.current;
    // For an answer, the question's own exchange is the instruction being re-sent, not a past turn.
    const askIndex = answering ? before.findIndex((entry) => entry.id === answering.entryId) : -1;
    let pastEnd = before.length;
    if (askIndex >= 0) {
      pastEnd = askIndex;
      while (pastEnd > 0 && before[pastEnd - 1]!.type !== 'user') pastEnd -= 1;
      pastEnd = Math.max(0, pastEnd - 1);
    }
    const sent = opts.project;
    const recent = buildRecent(before.slice(0, pastEnd), describe, {
      current: sent,
      undo: opts.undoStack,
      redo: opts.redoStack,
    });

    if (previewRef.current) closePreview();
    const nextEntries = startExchange(before, {
      ...(answering ? { answering: { entryId: answering.entryId, picked: answering.picked } } : {}),
      ...(answering ? {} : { userEntry: { id: nextId('u'), text: message } }),
    });
    entriesRef.current = nextEntries;
    setEntries(nextEntries);
    setBusy(true);

    const input: Record<string, unknown> = {
      organizationId: opts.organizationId,
      message,
      locale: opts.locale,
      project: sent,
      playheadSec: Math.min(3600, Math.max(0, opts.playheadSec)),
      ...(opts.selectedClipId ? { selectedClipId: opts.selectedClipId } : {}),
      ...(recent.length > 0 ? { recent } : {}),
      ...(answering ? { answer: answering.value } : {}),
    };

    void (async () => {
      try {
        let answer: AssistServerAnswer = readAssistAnswer(await postAssistPlan(input, controller.signal));
        if (seq !== seqRef.current) return;
        if (answer.ok && answer.kind === 'patches' && needsSceneDetection(answer.patches)) {
          const patches = await resolveSceneSplitPatches(answer.patches, sent, latest.current.detectCuts);
          if (seq !== seqRef.current) return;
          answer = { ...answer, patches };
        }
        handleDecision(decideAssist(latest.current.project, answer, sent), message);
      } catch {
        if (controller.signal.aborted || seq !== seqRef.current) return;
        push({ id: nextId('n'), type: 'note', code: 'unavailable' });
      } finally {
        if (seq === seqRef.current) {
          setBusy(false);
          abortRef.current = null;
        }
      }
    })();
  };

  const send = (text: string) => run(text);

  const answer = (entryId: string, choiceIndex: number) => {
    const entry = entriesRef.current.find((e) => e.id === entryId);
    if (!entry || entry.type !== 'ask' || entry.status !== 'open') return;
    const choice = entry.choices[choiceIndex];
    if (choice === undefined) return;
    run(entry.message, { entryId, picked: choiceIndex, value: { about: entry.about, value: choice } });
  };

  const applyProposal = () => {
    const current = previewRef.current;
    if (!current) return;
    const opts = latest.current;
    // The timeline cannot change while locked; the draft is rebuilt anyway, from the real timeline now.
    const outcome = draftFrom(opts.project, current.source);
    closePreview();
    if (outcome.type !== 'draft') {
      setEntries((prev) => withProposal(prev, current.entryId, { status: 'stale' }));
      return;
    }
    opts.commit(outcome.draft);
    setEntries((prev) =>
      withProposal(prev, current.entryId, { status: 'applied', deltas: outcome.deltas, historyMark: outcome.draft }),
    );
  };

  const dismissProposal = () => {
    const current = previewRef.current;
    if (!current) return;
    closePreview();
    setEntries((prev) => withProposal(prev, current.entryId, { status: 'dismissed' }));
  };

  const setComparing = useCallback((on: boolean) => {
    setComparingState(on && previewRef.current !== null);
  }, []);

  const proposalOpen = preview !== null;
  const historyOf = (entry: AssistEntry) => entryHistory(entry, view);
  const canUndo = (entry: AssistEntry) => canUndoEntry(entry, view, { proposalOpen, canCreate });

  const undoEntry = (entryId: string) => {
    const entry = entriesRef.current.find((e) => e.id === entryId);
    const opts = latest.current;
    if (!entry || previewRef.current) return;
    const live: HistoryView = { current: opts.project, undo: opts.undoStack, redo: opts.redoStack };
    if (!canUndoEntry(entry, live, { proposalOpen: false, canCreate: opts.canCreate })) return;
    opts.undo();
  };

  const changedIds = useMemo(
    () => (preview && !comparing ? changedCutIds(preview.base, preview.draft, preview.deltas) : EMPTY_IDS),
    [comparing, preview],
  );

  return {
    entries,
    busy,
    previewOpen: proposalOpen,
    historyOf,
    canUndo,
    send,
    answer,
    applyProposal,
    dismissProposal,
    setComparing,
    undoEntry,
    preview,
    comparing,
    lockedRef,
    changedIds,
  };
}
