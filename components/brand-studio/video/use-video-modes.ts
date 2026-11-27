"use client";
/**
 * Client-only state hook for Video Studio modes (slice VM-1).
 * Kept in its own module so `components/brand-studio/video/workspace.tsx` stays at its exact
 * hook count and closed-switch path stays minimal.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StudioVideoCopy } from "@/messages/studio-video";
import type { StudioVideoModesCopy } from "@/messages/studio-video-modes";
import { isFailure, type ApiResult, type StudioOps } from "../api";
import { errorLine, type StudioCopy } from "../copy";
import type { VideoModesDockProp } from "../dock";
import { addToTray, removeFromTray, type TrayItem } from "../refs";
import type { DockController } from "../use-dock";
import type { FilmState } from "../use-studio";
import { isVideoModeSeen, markVideoModeSeen } from "./mode-seen";
import {
  INITIAL_VIDEO_MODES_STATE,
  applyVideoModeEditToggle,
  deriveVideoMode,
  draftAndStateAfterVideoAttach,
  isBlueprintUnreadableBlock,
  modeForRemixMethod,
  needsReferenceVideoForSubmit,
  selectVideoMode,
  stateAfterManualTrayRemove,
  undoRemovedVideo,
  videoModeAvailability,
  type PendingVideoMode,
  type VideoModesUiState,
  type VideoStudioMode,
} from "./video-modes-model";
import { resolveUnifiedRemixMethod } from "../dock-model";

export interface UseVideoModesArgs {
  enabled: boolean;
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
}

export function useVideoModes({
  enabled,
  modesCopy,
  dock,
  copy,
  videoCopy,
  remixOn,
  remixFilm,
  remixVideoAssetId = null,
  analyzeFilm,
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
  const [explainerMode, setExplainerMode] = useState<PendingVideoMode | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [libraryOpenSignal, setLibraryOpenSignal] = useState(0);

  useEffect(() => {
    if (active) setHydrated(true);
  }, [active]);

  // Item 6 + W3: reconcile any tray transition that happened outside `attachItem` / `removeTrayItem`
  // (scene extend, `?from=`, `?asset=`, `?ref=`, external delete).
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

    // Item 6: tray gained a video while a mode was pending -> apply Rule 3 and clear pendingMode.
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

    // Round 2 Item 2: whenever the tray gains a video through any path (e.g. ?ref=, scene extend)
    // while an older Rule 6 undo snapshot is held, clear `ui.undo` so pressing 되돌리기 cannot add a second video.
    if (nextVideoCount > prevVideoCount && ui.undo) {
      const cleared: VideoModesUiState = { ...ui, undo: null };
      modesUiRef.current = cleared;
      setModesUi(cleared);
      return;
    }

    // W3 / Rule 7: tray lost its last video outside Rule 6 undo -> keep hand-picked mode pending with well.
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
      // Item 8: mark the mode seen as soon as the explainer opens so leaving without pressing 알겠어요 never reopens it.
      if (result.openedMode && !isVideoModeSeen(result.openedMode)) {
        markVideoModeSeen(result.openedMode);
        setExplainerMode(result.openedMode);
      } else {
        setExplainerMode(null);
      }
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

  const onToggleEdit = useCallback(
    (nextMethod: "edit" | "reference") => {
      if (!active) return;
      dock.setDraft((current) => applyVideoModeEditToggle(current, nextMethod));
    },
    [active, dock],
  );

  const clearForcedLimit = useCallback(() => {
    if (!active) return;
    setModesUi((cur) => {
      const next = cur.forcedLimitMessage ? { ...cur, forcedLimitMessage: null } : cur;
      modesUiRef.current = next;
      return next;
    });
  }, [active]);

  const dismissExplainer = useCallback(() => {
    if (explainerMode) markVideoModeSeen(explainerMode);
    setExplainerMode(null);
  }, [explainerMode]);

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

  const dockProp: VideoModesDockProp | null = useMemo(() => {
    if (!active || !modesCopy || !availability) return null;
    return {
      activeMode,
      pendingMode: modesUi.pendingMode,
      availability,
      copy: modesCopy,
      undo: modesUi.undo !== null,
      forcedLimitMessage: modesUi.forcedLimitMessage,
      onSelectMode,
      onUndoRemoveVideo,
      onToggleEdit,
      ...(remixVideoAssetId && analyzeFilm ? { onRetryReadFilm } : {}),
    };
  }, [
    active,
    activeMode,
    analyzeFilm,
    availability,
    modesCopy,
    modesUi.forcedLimitMessage,
    modesUi.pendingMode,
    modesUi.undo,
    onRetryReadFilm,
    onSelectMode,
    onToggleEdit,
    onUndoRemoveVideo,
    remixVideoAssetId,
  ]);

  return {
    active,
    dockProp,
    explainerMode,
    hydrated,
    libraryOpenSignal,
    attachItem,
    removeTrayItem,
    clearForcedLimit,
    dismissExplainer,
    openLibrary,
    blockSubmitIfPending,
  };
}
