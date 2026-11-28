"use client";
/**
 * Client-only state hook for Video Studio modes (slice VM-2 Batch A + Batch B).
 * Kept in its own module so `components/brand-studio/video/workspace.tsx` stays at its exact
 * hook count and closed-switch path stays minimal.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { z } from "zod";
import {
  STUDIO_LIMITS,
  type StudioVideoCountingScheme,
  type StudioVideoUnderstand,
  type StudioVideoUnderstandKind,
  type VideoUnderstandCard,
  type VideoUnderstandQuestion,
  type VideoUnderstandSchema,
} from "@/lib/brand-studio/contracts";
import type { StudioVideoModel } from "@/lib/brand-studio/models";
import type { StudioVideoCopy } from "@/messages/studio-video";
import type { StudioVideoModesCopy } from "@/messages/studio-video-modes";
import { isFailure, type ApiResult, type StudioOps } from "../api";
import { errorLine, type StudioCopy } from "../copy";
import type { VideoModesDockProp } from "../dock";
import { dockControls, resolveUnifiedRemixMethod } from "../dock-model";
import { addToTray, removeFromTray, type TrayItem } from "../refs";
import type { DockController } from "../use-dock";
import type { FilmState } from "../use-studio";
import {
  INITIAL_VIDEO_MODES_STATE,
  applyUnderstandCardToDraftAndTray,
  buildUnderstandInput,
  clearUnderstandSession,
  confirmCardSignature,
  deriveVideoMode,
  draftAndStateAfterVideoAttach,
  hasUnderstandStandingChange,
  isBlueprintUnreadableBlock,
  isConfirmVideoMode,
  modeForRemixMethod,
  needsReferenceVideoForSubmit,
  readUnderstandSession,
  sanitizeClientUnderstandSwaps,
  selectVideoMode,
  snapshotTrayImages,
  stateAfterManualTrayRemove,
  stripClientCreditFigures,
  stripClientCreditOnly,
  undoRemovedVideo,
  updateTraySnapshotForHandEdit,
  videoModeAvailability,
  writeUnderstandSession,
  type TrayImageSnapshot,
  type VideoModesUiState,
  type VideoStudioMode,
} from "./video-modes-model";

export interface UseVideoModesArgs {
  enabled: boolean;
  organizationId?: string;
  modesCopy?: StudioVideoModesCopy;
  dock: DockController;
  copy: StudioCopy;
  videoCopy: StudioVideoCopy;
  remixOn: boolean;
  remixFilm: FilmState | null;
  remixVideoAssetId?: string | null;
  analyzeFilm?: (
    assetId: string,
    options?: { retry?: boolean },
  ) => Promise<ApiResult<StudioOps["film.analyze"][1]> | null> | void;
  /** Batch B: `video.understand` operation caller. When absent (e.g. Batch A local tests), card opens from draft directly. */
  understandVideo?: (
    input: z.input<typeof VideoUnderstandSchema>,
  ) => Promise<ApiResult<StudioVideoUnderstand>>;
}

interface UnderstandClientState {
  kind: StudioVideoUnderstandKind | null;
  reply: string | null;
  card: VideoUnderstandCard | null;
  questions: VideoUnderstandQuestion[];
  openQuestion: number | null;
  readyToMake: boolean;
  failed: boolean;
  timedOut: boolean;
  turns: Array<{ who: "customer" | "studio"; text: string }>;
  countingScheme: StudioVideoCountingScheme | null;
}

const EMPTY_UNDERSTAND: UnderstandClientState = {
  kind: null,
  reply: null,
  card: null,
  questions: [],
  openQuestion: null,
  readyToMake: false,
  failed: false,
  timedOut: false,
  turns: [],
  countingScheme: null,
};

const UNDERSTAND_CLIENT_TIMEOUT_MS = 30_000;

export function useVideoModes({
  enabled,
  organizationId = "",
  modesCopy,
  dock,
  copy,
  videoCopy,
  remixOn,
  remixFilm,
  remixVideoAssetId = null,
  analyzeFilm,
  understandVideo,
}: UseVideoModesArgs) {
  const active = Boolean(enabled && modesCopy);
  const [modesUi, setModesUi] = useState<VideoModesUiState>(INITIAL_VIDEO_MODES_STATE);
  const modesUiRef = useRef<VideoModesUiState>(modesUi);
  modesUiRef.current = modesUi;
  const trayRef = useRef(dock.tray);
  trayRef.current = dock.tray;
  const draftRef = useRef(dock.draft);
  draftRef.current = dock.draft;
  const remixFilmRef = useRef(remixFilm);
  remixFilmRef.current = remixFilm;
  const remixVideoAssetIdRef = useRef<string | null>(remixVideoAssetId);
  remixVideoAssetIdRef.current = remixVideoAssetId;
  const retryInFlightRef = useRef(false);
  const [libraryOpenSignal, setLibraryOpenSignal] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [queuedConfirmOnRead, setQueuedConfirmOnRead] = useState(false);
  const [shotsNotCarried, setShotsNotCarried] = useState(false);

  // Batch B (`video.understand`) state & guards
  const [checking, setChecking] = useState(false);
  const [understandState, setUnderstandState] = useState<UnderstandClientState | null>(null);
  const understandRef = useRef<UnderstandClientState | null>(understandState);
  understandRef.current = understandState;
  const settledPromptRef = useRef<string | null>(null);
  // S1 + A3: Snapshot of each attached image's role/use/avoid before the first card (updated on customer hand edits)
  // plus the exact set of image keys written by previous cards so restore touches ONLY card-written images.
  const traySnapshotRef = useRef<TrayImageSnapshot | null>(null);
  const cardTouchedKeysRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef(false);
  const reqSeqRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      reqSeqRef.current += 1;
      inFlightRef.current = false;
    };
  }, []);

  // Reconcile any tray transition outside `attachItem` / `removeTrayItem`
  // (scene extend, `?from=`, `?asset=`, `?ref=`, `?start=reverse&asset=`, external delete).
  const prevTrayRef = useRef(dock.tray);
  const prevDraftRef = useRef(dock.draft);
  useEffect(() => {
    const prevTray = prevTrayRef.current;
    const prevDraft = prevDraftRef.current;
    prevTrayRef.current = dock.tray;
    prevDraftRef.current = dock.draft;
    if (!active) return;

    const hadVideo = prevTray.some((t) => t.kind === "video");
    const firstVideo = dock.tray.find((t) => t.kind === "video") ?? null;
    const hasVideo = firstVideo !== null;
    const prevVideoCount = prevTray.filter((t) => t.kind === "video").length;
    const nextVideoCount = dock.tray.filter((t) => t.kind === "video").length;
    const ui = modesUiRef.current;

    if (!hadVideo && hasVideo && ui.pendingMode) {
      const resolved = draftAndStateAfterVideoAttach({
        draft: dock.draft,
        nextTray: dock.tray,
        item: firstVideo,
        ui,
        copy,
      });
      modesUiRef.current = resolved.ui;
      setModesUi(resolved.ui);
      dock.setDraft((current) =>
        draftAndStateAfterVideoAttach({
          draft: current,
          nextTray: dock.tray,
          item: firstVideo,
          ui,
          copy,
        }).draft,
      );
      return;
    }

    if (nextVideoCount > prevVideoCount && ui.undo) {
      const cleared: VideoModesUiState = { ...ui, undo: null };
      modesUiRef.current = cleared;
      setModesUi(cleared);
      return;
    }

    if (hadVideo && !hasVideo && !ui.undo && !ui.pendingMode && ui.pickedVideoModeByHand) {
      const nextUi: VideoModesUiState = {
        pendingMode: modeForRemixMethod(resolveUnifiedRemixMethod(prevDraft, prevTray)),
        pickedVideoModeByHand: true,
        undo: null,
        forcedLimitMessage: null,
      };
      modesUiRef.current = nextUi;
      setModesUi(nextUi);
    }
  }, [active, copy, dock, remixOn]);

  const activeMode: VideoStudioMode = active
    ? deriveVideoMode(dock.draft, dock.tray, modesUi.pendingMode)
    : "basic";

  // Close/invalidate an open confirm card, in-flight request, or queued reading wait whenever mode or tray changes.
  const cardSig = active ? confirmCardSignature(activeMode, dock.tray) : "";
  const sessionSig = organizationId && cardSig ? `${organizationId}|${cardSig}` : cardSig;
  const prevCardSigRef = useRef(cardSig);
  useEffect(() => {
    if (prevCardSigRef.current === cardSig) return;
    prevCardSigRef.current = cardSig;
    reqSeqRef.current += 1;
    inFlightRef.current = false;
    setChecking(false);
    setConfirmOpen(false);
    setQueuedConfirmOnRead(false);
    setShotsNotCarried(false);
    setUnderstandState(null);
    settledPromptRef.current = null;
    traySnapshotRef.current = null;
    cardTouchedKeysRef.current = new Set();
    clearUnderstandSession();
  }, [cardSig]);

  // Restore saved sessionStorage card for this exact signature (refresh resilience; guarded in try/catch).
  const restoredSigRef = useRef<string>("");
  useEffect(() => {
    if (!active || !remixOn || !isConfirmVideoMode(activeMode) || !understandVideo || !sessionSig) return;
    if (restoredSigRef.current === sessionSig) return;
    restoredSigRef.current = sessionSig;
    const saved = readUnderstandSession(sessionSig);
    if (!saved) return;
    settledPromptRef.current = saved.settledPrompt;
    traySnapshotRef.current = saved.traySnapshot ?? null;
    cardTouchedKeysRef.current = new Set(saved.touchedKeys ?? []);
    setUnderstandState({
      kind: null,
      reply: saved.reply,
      card: saved.card,
      questions: saved.questions,
      openQuestion: saved.openQuestion,
      readyToMake: saved.readyToMake,
      failed: false,
      timedOut: false,
      turns: saved.turns,
      countingScheme: saved.countingScheme ?? null,
    });
    setConfirmOpen(true);
  }, [active, activeMode, remixOn, sessionSig, understandVideo]);

  const runUnderstand = useCallback(
    async (opts?: { message?: string; answering?: { option?: number }; resetPrevious?: boolean }) => {
      if (!active || !remixOn || !understandVideo) return;
      if (inFlightRef.current) return;
      const mode = deriveVideoMode(draftRef.current, trayRef.current, modesUiRef.current.pendingMode);
      if (!isConfirmVideoMode(mode)) return;

      const sigAtStart = confirmCardSignature(mode, trayRef.current);
      const seq = ++reqSeqRef.current;
      inFlightRef.current = true;
      setChecking(true);

      const prevState = opts?.resetPrevious ? null : understandRef.current;
      const previous =
        prevState && prevState.card
          ? {
              card: prevState.card,
              questions: prevState.questions,
              turns: prevState.turns.slice(-10),
              ...(prevState.countingScheme ? { countingScheme: prevState.countingScheme } : {}),
            }
          : null;
      const rawMessage = (opts?.message ?? draftRef.current.prompt).trim();

      const payload = buildUnderstandInput({
        organizationId,
        mode,
        draft: draftRef.current,
        tray: trayRef.current,
        message: rawMessage,
        videoAssetId: remixVideoAssetIdRef.current,
        previous,
        answering: opts?.answering ?? null,
      });

      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let result: ApiResult<StudioVideoUnderstand>;
      try {
        const timeoutPromise = new Promise<ApiResult<StudioVideoUnderstand>>((resolve) => {
          timer = setTimeout(() => {
            timedOut = true;
            resolve({ ok: false, code: "failed" });
          }, UNDERSTAND_CLIENT_TIMEOUT_MS);
        });
        result = await Promise.race([understandVideo(payload), timeoutPromise]);
      } catch {
        result = { ok: false, code: "failed" };
      } finally {
        if (timer !== null) clearTimeout(timer);
      }

      // Drop late answer if unmounted, superseded by a newer request, or inputs changed while in-flight.
      const currentMode = deriveVideoMode(draftRef.current, trayRef.current, modesUiRef.current.pendingMode);
      const sigNow = confirmCardSignature(currentMode, trayRef.current);
      if (!mountedRef.current || seq !== reqSeqRef.current || sigNow !== sigAtStart) {
        if (seq === reqSeqRef.current) {
          inFlightRef.current = false;
          if (mountedRef.current) setChecking(false);
        }
        return;
      }

      inFlightRef.current = false;
      setChecking(false);

      if (isFailure(result)) {
        const failedState: UnderstandClientState = {
          ...(understandRef.current ?? EMPTY_UNDERSTAND),
          failed: true,
          timedOut,
          readyToMake: false,
          reply: null,
          kind: null,
        };
        understandRef.current = failedState;
        setUnderstandState(failedState);
        setConfirmOpen(true);
        return;
      }

      // B1: Cold film cache on Re-Architect (library assets only): wait for `remixFilm` to finish, then auto-retry.
      // If there is no library asset id (customer result video), never wait for a reading that can never come.
      if (result.kind === "reading") {
        if (remixVideoAssetIdRef.current) {
          setQueuedConfirmOnRead(true);
          setConfirmOpen(false);
          return;
        }
        const failedState: UnderstandClientState = {
          ...(understandRef.current ?? EMPTY_UNDERSTAND),
          kind: null,
          reply: null,
          readyToMake: false,
          failed: true,
          timedOut: false,
        };
        understandRef.current = failedState;
        setUnderstandState(failedState);
        setConfirmOpen(true);
        return;
      }

      if (result.failed) {
        const failedState: UnderstandClientState = {
          ...(understandRef.current ?? EMPTY_UNDERSTAND),
          kind: null,
          reply: null,
          card: result.card,
          questions: result.questions,
          openQuestion: result.openQuestion,
          readyToMake: false,
          failed: true,
          timedOut: false,
        };
        understandRef.current = failedState;
        setUnderstandState(failedState);
        setConfirmOpen(true);
        return;
      }

      // W1 + S1 + W2 + W5: Sanitize swaps BEFORE applying OR storing/drawing; snapshot original image roles/notes
      // once per session before applying; preserve hand-set fields per field; clear prompt when withdrawn to empty.
      const currentDraft = draftRef.current;
      const currentTray = trayRef.current;
      if (traySnapshotRef.current === null) {
        traySnapshotRef.current = snapshotTrayImages(currentTray);
      }
      const sanitizedCard: VideoUnderstandCard = {
        ...result.card,
        swaps: sanitizeClientUnderstandSwaps(result.card.swaps, currentTray),
        changeText: stripClientCreditOnly(result.card.changeText).slice(0, STUDIO_LIMITS.promptMax),
        requestText: stripClientCreditOnly(result.card.requestText).slice(0, STUDIO_LIMITS.promptMax),
      };
      const videoModel = dockControls(currentDraft).model as StudioVideoModel;
      const videoSeconds = currentTray.find((t) => t.kind === "video")?.seconds ?? null;
      const withdrawnToEmpty = result.kind === "withdraw" && !hasUnderstandStandingChange(sanitizedCard);
      const applied = applyUnderstandCardToDraftAndTray({
        card: sanitizedCard,
        draft: currentDraft,
        tray: currentTray,
        mode,
        snapshot: traySnapshotRef.current,
        touchedKeys: cardTouchedKeysRef.current,
        clearPromptWhenEmpty: withdrawnToEmpty,
        model: videoModel,
        videoSeconds,
      });
      // A3: Track ONLY keys written by cards (keys left out of `card.swaps` were restored and are no longer card-owned).
      cardTouchedKeysRef.current = new Set(applied.writtenKeys);

      // Keep prevCardSigRef aligned (role/use/avoid edits don't change confirmCardSignature).
      dock.setTray(applied.tray);
      dock.setDraft(applied.draft);
      settledPromptRef.current = applied.draft.prompt;

      // W3 + W4: Drop whole sentences containing credit figures; if reply becomes empty, fall back to the card's own summary line.
      const cleanQuestions: VideoUnderstandQuestion[] = result.questions.map((q) => ({
        ...q,
        text: stripClientCreditFigures(q.text),
        options: q.options
          .map((o) => ({ ...o, label: stripClientCreditFigures(o.label) }))
          .filter((o) => o.label.length > 0),
      }));
      const rawStrippedReply = result.reply ? stripClientCreditFigures(result.reply) : "";
      const fallbackSummary =
        sanitizedCard.changeText.trim() ||
        sanitizedCard.swaps.map((s) => s.label).join(", ").trim() ||
        (result.openQuestion !== null ? (cleanQuestions[result.openQuestion]?.text ?? "") : "");
      const cleanReply = rawStrippedReply || (result.reply ? fallbackSummary : "") || null;

      const nextTurns: Array<{ who: "customer" | "studio"; text: string }> = [
        ...(prevState?.turns ?? []),
        ...(rawMessage ? [{ who: "customer" as const, text: rawMessage }] : []),
        ...(cleanReply ? [{ who: "studio" as const, text: cleanReply }] : []),
      ].slice(-12);

      const nextCountingScheme = result.countingScheme ?? prevState?.countingScheme ?? null;
      const nextState: UnderstandClientState = {
        kind: result.kind,
        reply: cleanReply,
        card: sanitizedCard,
        questions: cleanQuestions,
        openQuestion: result.openQuestion,
        readyToMake: result.readyToMake,
        failed: false,
        timedOut: false,
        turns: nextTurns,
        countingScheme: nextCountingScheme,
      };
      understandRef.current = nextState;
      setUnderstandState(nextState);
      setConfirmOpen(true);

      const nextSessionSig = organizationId ? `${organizationId}|${sigAtStart}` : sigAtStart;
      writeUnderstandSession({
        sig: nextSessionSig,
        card: sanitizedCard,
        questions: cleanQuestions,
        openQuestion: result.openQuestion,
        reply: cleanReply,
        readyToMake: result.readyToMake,
        turns: nextTurns,
        settledPrompt: applied.draft.prompt,
        countingScheme: nextCountingScheme,
        traySnapshot: traySnapshotRef.current,
        touchedKeys: [...cardTouchedKeysRef.current],
      });
    },
    [active, dock, organizationId, remixOn, understandVideo],
  );

  // Re-Architect reading wait: if customer pressed `확인하기` while `film.status === "loading"` (or `video.understand`
  // answered `kind: 'reading'`), proceed automatically once a readable sheet arrives (no second film.analyze request).
  useEffect(() => {
    if (!active || !queuedConfirmOnRead) return;
    if (activeMode !== "re_architect" || !remixOn) {
      setQueuedConfirmOnRead(false);
      return;
    }
    if (remixFilm?.status === "done") {
      setQueuedConfirmOnRead(false);
      if (remixFilm.sheet) {
        if (understandVideo) {
          void runUnderstand();
        } else {
          setConfirmOpen(true);
        }
      }
    }
  }, [active, activeMode, queuedConfirmOnRead, remixFilm, remixOn, runUnderstand, understandVideo]);

  const availability = useMemo(
    () =>
      active
        ? videoModeAvailability({
            draft: dock.draft,
            tray: dock.tray,
            film: remixFilm,
            copy,
            videoCopy,
          })
        : null,
    [active, copy, dock.draft, dock.tray, remixFilm, videoCopy],
  );

  const attachItem = useCallback(
    (item: TrayItem, first = false) => {
      const currentUi = modesUiRef.current;
      const currentTray = trayRef.current;
      const currentDraft = draftRef.current;
      const nextPreview = addToTray(currentTray, item, first);
      dock.attach(item, first);
      if (!active || nextPreview.full) return;
      const resolved = draftAndStateAfterVideoAttach({
        draft: currentDraft,
        nextTray: nextPreview.items,
        item,
        ui: currentUi,
        copy,
      });
      modesUiRef.current = resolved.ui;
      setModesUi(resolved.ui);
      if (item.kind === "video" && currentUi.pendingMode) {
        dock.setDraft((current) =>
          draftAndStateAfterVideoAttach({
            draft: current,
            nextTray: nextPreview.items,
            item,
            ui: currentUi,
            copy,
          }).draft,
        );
      }
    },
    [active, copy, dock],
  );

  // A3: Customer hand edits (via card line popover OR tray popover) update the image's snapshot entry
  // and release card ownership so later correction/withdraw turns never revert what the customer chose by hand.
  const updateTrayItem = useCallback(
    (key: string, patch: Partial<Pick<TrayItem, "role" | "use" | "avoid" | "frame">>) => {
      dock.update(key, patch);
      if (!active) return;
      if (traySnapshotRef.current !== null) {
        const currentItem = trayRef.current.find((t) => t.key === key) ?? null;
        traySnapshotRef.current = updateTraySnapshotForHandEdit(traySnapshotRef.current, key, patch, currentItem);
      }
      cardTouchedKeysRef.current.delete(key);
    },
    [active, dock],
  );

  const removeTrayItem = useCallback(
    (key: string) => {
      const prevTray = trayRef.current;
      const currentDraft = draftRef.current;
      const nextTray = removeFromTray(prevTray, key);
      dock.remove(key);
      if (!active) return;
      const nextUi = stateAfterManualTrayRemove({
        draft: currentDraft,
        prevTray,
        nextTray,
        removedKey: key,
        ui: modesUiRef.current,
      });
      modesUiRef.current = nextUi;
      setModesUi(nextUi);
    },
    [active, dock],
  );

  const onSelectMode = useCallback(
    (target: VideoStudioMode) => {
      if (!active || !availability) return;
      const result = selectVideoMode({
        target,
        draft: draftRef.current,
        tray: trayRef.current,
        ui: modesUiRef.current,
        availability,
      });
      if (result.tray !== trayRef.current) dock.setTray(result.tray);
      if (result.draft !== draftRef.current) dock.setDraft(result.draft);
      modesUiRef.current = result.ui;
      setModesUi(result.ui);
      if (result.clearedMessage) dock.setMessage(null);
      reqSeqRef.current += 1;
      inFlightRef.current = false;
      setChecking(false);
      setConfirmOpen(false);
      setQueuedConfirmOnRead(false);
      setShotsNotCarried(false);
      setUnderstandState(null);
      settledPromptRef.current = null;
      traySnapshotRef.current = null;
      cardTouchedKeysRef.current = new Set();
      clearUnderstandSession();
    },
    [active, availability, dock],
  );

  const onUndoRemoveVideo = useCallback(() => {
    if (!active) return;
    const restored = undoRemovedVideo(draftRef.current, trayRef.current, modesUiRef.current);
    dock.setTray(restored.tray);
    dock.setDraft(restored.draft);
    modesUiRef.current = restored.ui;
    setModesUi(restored.ui);
  }, [active, dock]);

  const clearForcedLimit = useCallback(() => {
    if (!active) return;
    setModesUi((cur) => {
      const next = cur.forcedLimitMessage ? { ...cur, forcedLimitMessage: null } : cur;
      modesUiRef.current = next;
      return next;
    });
  }, [active]);

  const openLibrary = useCallback(() => {
    if (!active) return;
    setLibraryOpenSignal((n) => n + 1);
  }, [active]);

  const onRetryReadFilm = useCallback(() => {
    if (!active || !remixVideoAssetId || !analyzeFilm || retryInFlightRef.current) return;
    const requestedAssetId = remixVideoAssetId;
    retryInFlightRef.current = true;
    dock.setMessage(null);
    let pending: ReturnType<NonNullable<UseVideoModesArgs["analyzeFilm"]>>;
    try {
      pending = analyzeFilm(requestedAssetId, { retry: true });
    } catch {
      retryInFlightRef.current = false;
      if (remixVideoAssetIdRef.current === requestedAssetId) {
        dock.setMessage(errorLine(copy, "failed"), "failed");
      }
      return;
    }
    void Promise.resolve(pending)
      .then((result) => {
        retryInFlightRef.current = false;
        if (remixVideoAssetIdRef.current !== requestedAssetId) return;
        if (result && isFailure(result)) {
          dock.setMessage(errorLine(copy, result.code), result.code);
        }
      })
      .catch(() => {
        retryInFlightRef.current = false;
        if (remixVideoAssetIdRef.current !== requestedAssetId) return;
        dock.setMessage(errorLine(copy, "failed"), "failed");
      });
  }, [active, analyzeFilm, copy, dock, remixVideoAssetId]);

  const onOpenConfirm = useCallback(() => {
    if (!active || !remixOn) return;
    const mode = deriveVideoMode(draftRef.current, trayRef.current, modesUiRef.current.pendingMode);
    if (mode === "basic") return;
    // B1: Only wait on a library asset's film reading (`remixVideoAssetIdRef.current !== null`).
    // Customer RESULT videos (`outputId`, no `assetId`) run understanding immediately without a film summary.
    if (mode === "re_architect" && remixVideoAssetIdRef.current) {
      if (remixFilmRef.current?.status === "loading") {
        // Queue opening until the in-flight reading finishes (no second request).
        setQueuedConfirmOnRead(true);
        return;
      }
      if (remixFilmRef.current?.status === "done" && !remixFilmRef.current.sheet) {
        return;
      }
    }
    if (understandVideo) {
      void runUnderstand();
      return;
    }
    setConfirmOpen(true);
  }, [active, remixOn, runUnderstand, understandVideo]);

  const onReunderstand = useCallback(() => {
    if (!active || !remixOn || !understandVideo) return;
    void runUnderstand();
  }, [active, remixOn, runUnderstand, understandVideo]);

  const onPickOption = useCallback(
    (optionIndex: number) => {
      if (!active || !remixOn || !understandVideo) return;
      const cur = understandRef.current;
      const q = cur && cur.openQuestion !== null ? cur.questions[cur.openQuestion] : null;
      const opt = q?.options[optionIndex];
      const label = opt?.label ?? "";
      void runUnderstand({ message: label, answering: { option: optionIndex } });
    },
    [active, remixOn, runUnderstand, understandVideo],
  );

  const onCloseConfirm = useCallback(() => {
    reqSeqRef.current += 1;
    inFlightRef.current = false;
    setChecking(false);
    setConfirmOpen(false);
    setQueuedConfirmOnRead(false);
    setShotsNotCarried(false);
    setUnderstandState(null);
    settledPromptRef.current = null;
    traySnapshotRef.current = null;
    cardTouchedKeysRef.current = new Set();
    clearUnderstandSession();
  }, []);

  const onSubmitted = useCallback(() => {
    reqSeqRef.current += 1;
    inFlightRef.current = false;
    setChecking(false);
    setConfirmOpen(false);
    setQueuedConfirmOnRead(false);
    setShotsNotCarried(false);
    setUnderstandState(null);
    settledPromptRef.current = null;
    traySnapshotRef.current = null;
    cardTouchedKeysRef.current = new Set();
    clearUnderstandSession();
  }, []);

  /**
   * Opens the inline confirm card after "이 설정 다시 쓰기" restores a Re-Architect blueprint
   * directly into the dock (Fix round 1, S1 + Leftover 2b). Updates `prevCardSigRef` ahead of the
   * next render so the staleness guard does not immediately dismiss the card we just asked to open.
   */
  const openConfirmForReuse = useCallback(
    (plan: { draft: DockController["draft"]; tray: readonly TrayItem[]; shotsNotCarried?: boolean }) => {
      if (!active) return;
      const nextUi: VideoModesUiState = {
        pendingMode: null,
        pickedVideoModeByHand: true,
        undo: null,
        forcedLimitMessage: null,
      };
      modesUiRef.current = nextUi;
      setModesUi(nextUi);
      const nextMode = deriveVideoMode(plan.draft, plan.tray, null);
      prevCardSigRef.current = confirmCardSignature(nextMode, plan.tray);
      setQueuedConfirmOnRead(false);
      setUnderstandState(null);
      settledPromptRef.current = null;
      traySnapshotRef.current = null;
      cardTouchedKeysRef.current = new Set();
      setShotsNotCarried(Boolean(plan.shotsNotCarried));
      setConfirmOpen(nextMode !== "basic" && plan.tray.some((t) => t.kind === "video"));
    },
    [active],
  );

  const blockSubmitIfPending = useCallback((): boolean => {
    if (!active || !modesCopy) return false;
    if (needsReferenceVideoForSubmit(modesUiRef.current.pendingMode, trayRef.current)) return true;
    if (
      isBlueprintUnreadableBlock({
        draft: draftRef.current,
        tray: trayRef.current,
        film: remixFilmRef.current,
      })
    ) {
      return true;
    }
    return false;
  }, [active, modesCopy]);

  const waitingForReading =
    active &&
    activeMode === "re_architect" &&
    remixOn &&
    Boolean(remixVideoAssetId) &&
    (remixFilm?.status === "loading" || queuedConfirmOnRead);

  // Manual edit of the settled sentence marks the understand card stale until re-checked.
  const stalePrompt = Boolean(
    confirmOpen &&
      understandState &&
      !understandState.failed &&
      settledPromptRef.current !== null &&
      dock.draft.prompt !== settledPromptRef.current,
  );

  const understandView = useMemo(() => {
    if (!understandState) return null;
    const activeQuestion =
      understandState.openQuestion !== null
        ? (understandState.questions[understandState.openQuestion] ?? null)
        : null;
    return {
      kind: understandState.kind,
      reply: understandState.reply,
      swaps: understandState.card?.swaps ?? [],
      question: activeQuestion,
      readyToMake: understandState.readyToMake && !stalePrompt && !understandState.failed,
      failed: understandState.failed,
      timedOut: understandState.timedOut,
      stale: stalePrompt,
      checking,
    };
  }, [checking, stalePrompt, understandState]);

  const hasReviewed = Boolean(understandState);

  const dockProp: VideoModesDockProp | null = useMemo(() => {
    if (!active || !modesCopy || !availability) return null;
    return {
      activeMode,
      pendingMode: modesUi.pendingMode,
      availability,
      copy: modesCopy,
      undo: modesUi.undo !== null,
      forcedLimitMessage: modesUi.forcedLimitMessage,
      confirmOpen,
      waitingForReading,
      queuedConfirmOnRead,
      checking,
      shotsNotCarried,
      hasReviewed,
      understand: understandView,
      onSelectMode,
      onUndoRemoveVideo,
      onOpenConfirm,
      onCloseConfirm,
      ...(understandVideo ? { onReunderstand, onPickOption, onRetryUnderstand: onReunderstand } : {}),
      ...(remixVideoAssetId && analyzeFilm ? { onRetryReadFilm } : {}),
    };
  }, [
    active,
    activeMode,
    analyzeFilm,
    availability,
    checking,
    confirmOpen,
    hasReviewed,
    modesCopy,
    modesUi.forcedLimitMessage,
    modesUi.pendingMode,
    modesUi.undo,
    onCloseConfirm,
    onOpenConfirm,
    onPickOption,
    onRetryReadFilm,
    onReunderstand,
    onSelectMode,
    onUndoRemoveVideo,
    queuedConfirmOnRead,
    remixVideoAssetId,
    shotsNotCarried,
    understandVideo,
    understandView,
    waitingForReading,
  ]);

  return {
    active,
    dockProp,
    libraryOpenSignal,
    attachItem,
    updateTrayItem,
    removeTrayItem,
    clearForcedLimit,
    openLibrary,
    onSubmitted,
    openConfirmForReuse,
    blockSubmitIfPending,
  };
}
