'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createStudioApi, isFailure, measureInBrowser } from '@/components/brand-studio/api';
import { fill as interpolate } from '@/components/brand-studio/copy';
import {
  openShareReview,
  ShareReviewDialog,
  useShareReviewEvent,
  type ShareReviewTarget,
} from '@/components/brand-studio/share-review-dialog';
import type { StudioAllowanceView, StudioAssetView, StudioOutputView } from '@/lib/brand-studio/contracts';
import { creditsLeft, formatCredits } from '@/lib/brand-studio/credits';
import type { LibraryFolderWire, LibraryItemWire } from '@/lib/brand-studio/library-contracts';
import {
  COMPOSE_ASPECTS,
  DEFAULT_COLOR_REGION,
  GRADE_PRESETS,
  appendClip,
  applyTimelinePatches,
  clamp,
  clipPlayDuration,
  composeStorageKey,
  cssFilterForColorGrade,
  detectVideoSceneCutsInBrowser,
  emptyComposerProject,
  extractColorProfileInBrowser,
  frameStateAtTime,
  normalizeColorRegion,
  parseComposeChatCommand,
  parseStoredProject,
  playheadClipSplitTarget,
  projectDurationSec,
  roundHundredths,
  roundTenths,
  serializeProjectForStorage,
  splittableCutMediaSecs,
  timelineSpans,
  toColorGradeSpec,
  type CaptionPosition,
  type CaptionSize,
  type ColorGradeProfile,
  type ComposeAspect,
  type ComposeClip,
  type ComposeColorGradeState,
  type ComposeColorPresetId,
  type ComposeColorScope,
  type ComposerProject,
  type DetectedCut,
  type TimelinePatch,
} from '@/lib/brand-studio/compose';
import { exportCompositionMp4, type ComposeExportResult } from '@/lib/brand-studio/compose/export-client';
import { exportProjectNleBundleZip } from '@/lib/brand-studio/compose/nle-export';
import { musicCredits } from '@/lib/brand-studio/music/contracts';
import {
  UPSCALE_RESOLUTIONS,
  upscaleCredits,
  type UpscaleResolution,
} from '@/lib/brand-studio/upscale/contracts';
import type { StudioComposeCopy } from '@/messages/studio-compose';
import { AssistPanel, AssistPreviewBar } from './assist/assist-panel';
import { useEditAssist } from './assist/use-edit-assist';
import { commitHistory, initHistory, redoHistory, replaceHistory, undoHistory, type History } from './history';
import s from './video-composer.module.css';

export interface VideoComposerProps {
  organizationId: string;
  locale: 'ko' | 'en';
  canCreate: boolean;
  copy: StudioComposeCopy;
  videoStudioHref: string;
  initialAllowance: StudioAllowanceView;
  initialAssets: StudioAssetView[];
  initialVideoOutputs: Array<StudioOutputView & { label: string }>;
  initialImageOutputs?: Array<StudioOutputView & { label: string }>;
  initialFolders?: LibraryFolderWire[];
  initialLikedKeys?: string[];
  initialLikedItems?: LibraryItemWire[];
  initialFolderItems?: Record<string, LibraryItemWire[]>;
  initialToolTab?: 'clips' | 'color' | 'music' | 'captions' | 'upscale';
  initialBrowserFilter?: 'recent' | 'likes' | 'folders' | 'uploads';
  initialProject?: ComposerProject;
  /** `BRAND_STUDIO_EDIT_ASSIST`: the right panel becomes "말로 편집" (preview, apply, undo, redo). */
  editAssist?: boolean;
  /**
   * `BRAND_STUDIO_MUSIC_GENERATION`: shows the music generation card. Closed (default), the music tab keeps
   * only uploading and using your own audio; volume and removal stay on the timeline.
   */
  musicGeneration?: boolean;
}

type ToolTab = 'clips' | 'color' | 'music' | 'captions' | 'upscale';
type BrowserSourceFilter = 'recent' | 'likes' | 'folders' | 'uploads';
type MusicStyleKey = 'frenchHouse' | 'ambientCello' | 'marimbaPerc' | 'warmSynth';

interface ChatEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

interface BrowserMediaItem {
  key: string;
  id: string;
  kind: 'video' | 'image';
  sourceKind: 'output' | 'asset' | 'local';
  assetId?: string;
  outputId?: string;
  label: string;
  url: string;
  thumbUrl: string | null;
  seconds: number | null;
}

interface GeneratedMusicState {
  jobId: string;
  label: string;
  assetId: string | null;
  previewUrl: string;
  timelineUrl: string;
  durationSec: number;
  bpm: number;
  revealSec: number;
  nonCommercialOnly: boolean;
  creditsUsed: number;
}

const MUSIC_STYLE_SPECS: Record<
  MusicStyleKey,
  {
    presetId: string;
    leadInstrument:
      | 'mellow Rhodes lead melody'
      | 'warm cello lead melody'
      | 'glass marimba lead motif'
      | 'analog poly-synth lead melody';
    keySignature: 'Dm' | 'Em' | 'Am' | 'Fm';
    prompt: string;
  }
> = {
  frenchHouse: {
    presetId: 'french_house_runway_122',
    leadInstrument: 'mellow Rhodes lead melody',
    keySignature: 'Dm',
    prompt: 'refined French house runway groove, crisp sidechained bass',
  },
  ambientCello: {
    presetId: 'minimal_cello_editorial_96',
    leadInstrument: 'warm cello lead melody',
    keySignature: 'Em',
    prompt: 'minimal editorial ambient cello, warm acoustic air',
  },
  marimbaPerc: {
    presetId: 'architectural_marimba_112',
    leadInstrument: 'glass marimba lead motif',
    keySignature: 'Am',
    prompt: 'architectural glass marimba pulse, clean modern percussion',
  },
  warmSynth: {
    presetId: 'analog_synth_groove_124',
    leadInstrument: 'analog poly-synth lead melody',
    keySignature: 'Fm',
    prompt: 'warm analog poly-synth groove, clean editorial dynamics',
  },
};

function sameOriginComposeUrl(organizationId: string, source: 'asset' | 'output', id: string): string {
  const q = new URLSearchParams({ organizationId, source, id });
  return `/api/brand-studio/compose?${q.toString()}`;
}

function makeComposeRequestId(prefix = 'cmp'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

async function postComposeOperation(operation: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch('/api/brand-studio/compose', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation, input }),
  });
  return (await res.json()) as Record<string, unknown>;
}

async function postPostProduction(operation: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch('/api/brand-studio/post-production', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation, input }),
  });
  return (await res.json()) as Record<string, unknown>;
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function VideoComposer({
  organizationId,
  locale,
  canCreate,
  copy,
  videoStudioHref,
  initialAllowance,
  initialAssets,
  initialVideoOutputs,
  initialImageOutputs = [],
  initialFolders = [],
  initialLikedKeys = [],
  initialLikedItems = [],
  initialFolderItems = {},
  initialToolTab = 'clips',
  initialBrowserFilter = 'recent',
  initialProject,
  editAssist = false,
  musicGeneration = false,
}: VideoComposerProps) {
  const api = useMemo(() => createStudioApi({ organizationId }), [organizationId]);
  const [allowance, setAllowance] = useState<StudioAllowanceView>(initialAllowance);
  const [assets, setAssets] = useState<StudioAssetView[]>(initialAssets);
  const [localMediaItems, setLocalMediaItems] = useState<BrowserMediaItem[]>([]);

  const [sourceTab, setSourceTab] = useState<ToolTab>(initialToolTab);
  const [browserFilter, setBrowserFilter] = useState<BrowserSourceFilter>(initialBrowserFilter);
  const [mediaSearch, setMediaSearch] = useState('');
  const [activeFolderId, setActiveFolderId] = useState<string>(() => initialFolders[0]?.id ?? '');
  const [folderItemsById, setFolderItemsById] = useState<Record<string, LibraryItemWire[]>>(initialFolderItems);
  const [loadingFolderId, setLoadingFolderId] = useState<string | null>(null);

  // The timeline and its undo / redo stacks are one value, changed only by the pure transitions in `history.ts`.
  const [history, setHistory] = useState<History<ComposerProject>>(() =>
    initHistory(initialProject ?? emptyComposerProject('9:16')),
  );
  const { present: project, past: undoStack, future: redoStack } = history;
  const [selectedClipIdx, setSelectedClipIdx] = useState<number>(0);

  // Playback & stage refs
  const [playing, setPlaying] = useState(false);
  const [playheadSec, setPlayheadSec] = useState(0);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const frameShellRef = useRef<HTMLDivElement | null>(null);
  const activeClipUrlRef = useRef<string>('');
  const localBlobUrlsRef = useRef<string[]>([]);

  // Scene-cut detection state
  const [detectingCuts, setDetectingCuts] = useState(false);

  // Color grading UI state
  const [analyzingRef, setAnalyzingRef] = useState(false);
  const [savingMaster, setSavingMaster] = useState(false);
  const dragRegionRef = useRef<{
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
    w: number;
    h: number;
  } | null>(null);
  const [liveDragRegion, setLiveDragRegion] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Upscale UI state
  const [upscaleRes, setUpscaleRes] = useState<UpscaleResolution>(1080);
  const [upscaleScope, setUpscaleScope] = useState<'selected_clip' | 'full_timeline'>('selected_clip');
  const [upscaleColorMode, setUpscaleColorMode] = useState<'lab' | 'wavelet'>('lab');
  const [upscaleBusy, setUpscaleBusy] = useState(false);
  const [upscalePollStatus, setUpscalePollStatus] = useState<string | null>(null);

  // Reference Music Generation UI state
  const [musicRefAudio, setMusicRefAudio] = useState<{ label: string; assetId?: string; url?: string } | null>(null);
  const [musicMode, setMusicMode] = useState<'instrumental' | 'vocal_guide'>('instrumental');
  const [musicBpm, setMusicBpm] = useState<number>(122);
  const [musicStyle, setMusicStyle] = useState<MusicStyleKey>('frenchHouse');
  const [musicDropSync, setMusicDropSync] = useState<boolean>(true);
  const [musicRevealSec, setMusicRevealSec] = useState<number>(3.6);
  const [musicRevealCustom, setMusicRevealCustom] = useState<boolean>(false);
  const [musicBusy, setMusicBusy] = useState(false);
  const [generatedMusic, setGeneratedMusic] = useState<GeneratedMusicState | null>(null);

  // Caption draft state
  const [captionDraft, setCaptionDraft] = useState('');
  const [captionPos, setCaptionPos] = useState<CaptionPosition>('bottom');
  const [captionSize, setCaptionSize] = useState<CaptionSize>('md');

  // Chat state (TWINGS built-in + server free chat with per-minute rate limit; zero BYOK)
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatEntry[]>(() => [
    { id: 'welcome', role: 'assistant', text: copy.chat.welcome },
  ]);

  // Export, save & share-review state
  const [exportingRatio, setExportingRatio] = useState<number | null>(null);
  const [exportingNle, setExportingNle] = useState(false);
  const [lastExport, setLastExport] = useState<(ComposeExportResult & { objectUrl: string }) | null>(null);
  const [savingAsset, setSavingAsset] = useState(false);
  const [savedAssetId, setSavedAssetId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [shareReviewTarget, setShareReviewTarget] = useState<ShareReviewTarget | null>(null);

  // "말로 편집": the player and the timeline cards show `shownProject`; every edit path keeps using `project`.
  const assist = useEditAssist({
    enabled: editAssist,
    organizationId,
    locale,
    canCreate,
    copy,
    project,
    playheadSec,
    selectedClipId: project.clips[Math.min(selectedClipIdx, Math.max(0, project.clips.length - 1))]?.id ?? null,
    undoStack,
    redoStack,
    commit: (next) => commitProject(next),
    undo: () => handleUndo(),
    detectCuts: (clip) => detectCutsForClip(clip),
  });
  const assistLockRef = assist.lockedRef;
  const shownProject = assist.preview && !assist.comparing ? assist.preview.draft : project;
  const lockAttrs = assist.preview ? ({ inert: true, 'aria-disabled': true } as const) : {};

  useShareReviewEvent(organizationId, setShareReviewTarget);

  const audioAssets = useMemo(() => assets.filter((a) => a.kind === 'audio'), [assets]);

  // Hydrate saved timeline for this organization
  useEffect(() => {
    try {
      const saved = parseStoredProject(window.localStorage.getItem(composeStorageKey(organizationId)));
      if (saved && (saved.clips.length > 0 || saved.captions.length > 0 || saved.bgm || saved.colorGrade)) {
        setHistory((h) => replaceHistory(h, saved));
      }
    } catch {
      // ignore storage errors
    }
  }, [organizationId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(composeStorageKey(organizationId), serializeProjectForStorage(project));
    } catch {
      // ignore storage errors
    }
  }, [organizationId, project]);

  useEffect(() => {
    const urls = localBlobUrlsRef.current;
    return () => {
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (lastExport?.objectUrl) URL.revokeObjectURL(lastExport.objectUrl);
    };
  }, [lastExport]);

  // Lazy-fetch folder items if user selects a folder not yet preloaded
  useEffect(() => {
    if (browserFilter !== 'folders' || !activeFolderId || activeFolderId in folderItemsById) return;
    let cancelled = false;
    setLoadingFolderId(activeFolderId);
    const q = new URLSearchParams({ organizationId, folder: activeFolderId });
    void fetch(`/api/brand-studio/library?${q.toString()}`, { credentials: 'same-origin' })
      .then((res) => res.json() as Promise<{ ok?: boolean; items?: LibraryItemWire[] }>)
      .then((data) => {
        if (cancelled) return;
        setFolderItemsById((prev) => ({
          ...prev,
          [activeFolderId]: data.ok && Array.isArray(data.items) ? data.items : [],
        }));
      })
      .catch(() => {
        if (cancelled) return;
        setFolderItemsById((prev) => ({ ...prev, [activeFolderId]: [] }));
      })
      .finally(() => {
        if (!cancelled) setLoadingFolderId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeFolderId, browserFilter, folderItemsById, organizationId]);

  const totalSec = useMemo(() => projectDurationSec(shownProject), [shownProject]);
  const spans = useMemo(() => timelineSpans(shownProject), [shownProject]);
  const frameAtPlayhead = useMemo(() => frameStateAtTime(shownProject, playheadSec), [shownProject, playheadSec]);
  const remainingCredits = useMemo(() => creditsLeft(allowance.capKrw, allowance.usedKrw), [allowance]);

  const safeSelectedIdx = useMemo(
    () => Math.min(selectedClipIdx, Math.max(0, project.clips.length - 1)),
    [project.clips.length, selectedClipIdx],
  );
  const selectedClip: ComposeClip | null = project.clips[safeSelectedIdx] ?? null;

  const detectedSplittableCuts = useMemo(
    () => (selectedClip?.cutMarkers ? splittableCutMediaSecs(selectedClip, selectedClip.cutMarkers) : []),
    [selectedClip],
  );

  // Auto-calculate active cut drop timestamp for music drop-sync (`0ms`)
  const suggestedDropSec = useMemo(() => {
    if (selectedClip) {
      const activeSpan = spans[safeSelectedIdx];
      const internalCut = (selectedClip.cutMarkers ?? []).find(
        (m) => m > selectedClip.trimStartSec + 0.2 && m < selectedClip.trimEndSec - 0.2,
      );
      if (activeSpan && internalCut !== undefined) {
        return roundTenths(activeSpan.timelineStartSec + (internalCut - selectedClip.trimStartSec));
      }
    }
    if (spans.length > 1) {
      return roundTenths(spans[0]!.timelineEndSec);
    }
    if (playheadSec >= 0.4) {
      return roundTenths(playheadSec);
    }
    const baseDur = totalSec > 0 ? totalSec : 15;
    return roundTenths(clamp(baseDur * 0.35, 0.8, 12));
  }, [playheadSec, safeSelectedIdx, selectedClip, spans, totalSec]);

  useEffect(() => {
    if (!musicRevealCustom) {
      setMusicRevealSec(suggestedDropSec);
    }
  }, [musicRevealCustom, suggestedDropSec]);

  // While a "말로 편집" proposal is previewed every edit path is a no-op (`assistLockRef`).
  const historyRef = useRef(history);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  const commitProject = useCallback((next: ComposerProject) => {
    if (assistLockRef.current) return;
    setHistory((h) => commitHistory(h, next));
    setSavedAssetId(null);
  }, [assistLockRef]);

  const applyPatches = useCallback(
    (patches: readonly TimelinePatch[]) => {
      if (assistLockRef.current) return 0;
      const { project: updated, appliedCount } = applyTimelinePatches(project, patches);
      if (appliedCount > 0) {
        commitProject(updated);
      }
      return appliedCount;
    },
    [assistLockRef, commitProject, project],
  );

  const handleUndo = useCallback(() => {
    if (assistLockRef.current) return;
    setHistory(undoHistory);
    if (historyRef.current.past.length > 0) setSavedAssetId(null);
  }, [assistLockRef]);

  const handleRedo = useCallback(() => {
    if (assistLockRef.current) return;
    setHistory(redoHistory);
    if (historyRef.current.future.length > 0) setSavedAssetId(null);
  }, [assistLockRef]);

  const handlePlayheadSplit = useCallback(() => {
    if (!canCreate || project.clips.length === 0) return;
    const target = playheadClipSplitTarget(project, playheadSec);
    if (!target) {
      setStatusMessage(copy.timeline.playheadSplitEdge);
      return;
    }
    const count = applyPatches([
      { op: 'split_clip_at', clipIndex: target.clipIndex, atMediaSec: target.atMediaSec },
    ]);
    if (count > 0) {
      setSelectedClipIdx(target.clipIndex + 1);
      setStatusMessage(interpolate(copy.timeline.playheadSplitDone, { seconds: target.atMediaSec }));
    }
  }, [applyPatches, canCreate, copy.timeline, playheadSec, project]);

  // Keyboard shortcut `S` to split at playhead when not typing in an input/textarea
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== 's' && event.key !== 'S') return;
      const el = event.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      ) {
        return;
      }
      if (project.clips.length === 0 || !canCreate || assistLockRef.current) return;
      event.preventDefault();
      handlePlayheadSplit();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [assistLockRef, canCreate, handlePlayheadSplit, project.clips.length]);

  // Synchronize preview <video> and <audio> with playheadSec
  useEffect(() => {
    const v = previewVideoRef.current;
    const active = frameAtPlayhead.activeClip;
    if (!v || !active) return;

    if (activeClipUrlRef.current !== active.clip.srcUrl) {
      activeClipUrlRef.current = active.clip.srcUrl;
      v.src = active.clip.srcUrl;
      v.load();
    }
    v.muted = active.clip.muted;
    v.volume = active.clip.muted ? 0 : active.clip.volume;
    if (Math.abs(v.currentTime - active.mediaTimeSec) > (playing ? 0.28 : 0.05)) {
      try {
        v.currentTime = active.mediaTimeSec;
      } catch {
        // Metadata still loading
      }
    }
    if (playing && v.paused) {
      void v.play().catch(() => {});
    } else if (!playing && !v.paused) {
      v.pause();
    }
  }, [frameAtPlayhead.activeClip, playing]);

  useEffect(() => {
    const a = previewAudioRef.current;
    const bgm = shownProject.bgm;
    if (!a) return;
    if (!bgm || !playing || totalSec <= 0) {
      if (!a.paused) a.pause();
      return;
    }
    if (a.getAttribute('data-bgm-src') !== bgm.srcUrl) {
      a.setAttribute('data-bgm-src', bgm.srcUrl);
      a.src = bgm.srcUrl;
      a.load();
    }
    a.volume = bgm.volume;
    if (frameAtPlayhead.bgmTimeSec !== null && Math.abs(a.currentTime - frameAtPlayhead.bgmTimeSec) > 0.35) {
      try {
        a.currentTime = frameAtPlayhead.bgmTimeSec;
      } catch {
        // ignore until loaded
      }
    }
    if (a.paused) void a.play().catch(() => {});
  }, [frameAtPlayhead.bgmTimeSec, playing, shownProject.bgm, totalSec]);

  useEffect(() => {
    if (!playing || totalSec <= 0) return;
    let raf = 0;
    let lastTick = performance.now();
    const step = (now: number) => {
      const dt = (now - lastTick) / 1000;
      lastTick = now;
      setPlayheadSec((prev) => {
        const next = prev + dt;
        if (next >= totalSec) {
          setPlaying(false);
          return 0;
        }
        return next;
      });
      raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [playing, totalSec]);

  // "말로 편집": when the timeline on screen gets shorter than the playhead (a proposal opens, "show original"
  // is released, apply, undo, redo), playback stops and the playhead goes back to the start so play works.
  useEffect(() => {
    if (!editAssist || playheadSec <= totalSec) return;
    setPlaying(false);
    setPlayheadSec(0);
  }, [editAssist, playheadSec, totalSec]);

  /* ---------------------------------------------------------------- Unified 4-Source Media Browser */

  const outputLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of initialVideoOutputs) map.set(o.id, o.label);
    for (const o of initialImageOutputs) map.set(o.id, o.label);
    return map;
  }, [initialImageOutputs, initialVideoOutputs]);

  const assetLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of assets) map.set(a.id, a.name);
    return map;
  }, [assets]);

  const mapLibraryWireToBrowserItem = useCallback(
    (item: LibraryItemWire): BrowserMediaItem | null => {
      if (item.kind !== 'video' && item.kind !== 'image') return null;
      if ('assetId' in item.ref) {
        const id = item.ref.assetId;
        return {
          key: item.key,
          id,
          kind: item.kind,
          sourceKind: 'asset',
          assetId: id,
          label: item.name || assetLabelMap.get(id) || id.slice(0, 8),
          url: item.url,
          thumbUrl: item.thumbUrl,
          seconds: item.seconds,
        };
      }
      const id = item.ref.outputId;
      return {
        key: item.key,
        id,
        kind: item.kind,
        sourceKind: 'output',
        outputId: id,
        label: item.name || outputLabelMap.get(id) || `${copy.sources.studioOutputs} ${id.slice(0, 6)}`,
        url: item.url,
        thumbUrl: item.thumbUrl,
        seconds: item.seconds,
      };
    },
    [assetLabelMap, copy.sources.studioOutputs, outputLabelMap],
  );

  const recentBrowserItems = useMemo<BrowserMediaItem[]>(() => {
    const vids: BrowserMediaItem[] = initialVideoOutputs.map((out) => ({
      key: `o:${out.id}`,
      id: out.id,
      kind: 'video',
      sourceKind: 'output',
      outputId: out.id,
      label: out.label,
      url: out.url,
      thumbUrl: out.thumbUrl,
      seconds: out.seconds,
    }));
    const imgs: BrowserMediaItem[] = initialImageOutputs.map((out) => ({
      key: `o:${out.id}`,
      id: out.id,
      kind: 'image',
      sourceKind: 'output',
      outputId: out.id,
      label: out.label,
      url: out.url,
      thumbUrl: out.thumbUrl ?? out.url,
      seconds: null,
    }));
    return [...vids, ...imgs];
  }, [initialImageOutputs, initialVideoOutputs]);

  const uploadBrowserItems = useMemo<BrowserMediaItem[]>(() => {
    const fromAssets: BrowserMediaItem[] = assets
      .filter((a): a is StudioAssetView & { kind: 'video' | 'image' } => a.kind === 'video' || a.kind === 'image')
      .map((a) => ({
        key: `a:${a.id}`,
        id: a.id,
        kind: a.kind,
        sourceKind: 'asset',
        assetId: a.id,
        label: a.name,
        url: a.url,
        thumbUrl: a.thumbUrl ?? (a.kind === 'image' ? a.url : null),
        seconds: a.seconds,
      }));
    return [...localMediaItems, ...fromAssets];
  }, [assets, localMediaItems]);

  const likedBrowserItems = useMemo<BrowserMediaItem[]>(() => {
    const seen = new Set<string>();
    const list: BrowserMediaItem[] = [];
    for (const wire of initialLikedItems) {
      const mapped = mapLibraryWireToBrowserItem(wire);
      if (mapped && !seen.has(mapped.key)) {
        seen.add(mapped.key);
        list.push(mapped);
      }
    }
    if (initialLikedKeys.length > 0) {
      const keySet = new Set(initialLikedKeys);
      for (const candidate of [...recentBrowserItems, ...uploadBrowserItems]) {
        if (keySet.has(candidate.key) && !seen.has(candidate.key)) {
          seen.add(candidate.key);
          list.push(candidate);
        }
      }
    }
    return list;
  }, [initialLikedItems, initialLikedKeys, mapLibraryWireToBrowserItem, recentBrowserItems, uploadBrowserItems]);

  const folderBrowserItems = useMemo<BrowserMediaItem[]>(() => {
    if (!activeFolderId) return [];
    const wires = folderItemsById[activeFolderId] ?? [];
    const list: BrowserMediaItem[] = [];
    for (const wire of wires) {
      const mapped = mapLibraryWireToBrowserItem(wire);
      if (mapped) list.push(mapped);
    }
    return list;
  }, [activeFolderId, folderItemsById, mapLibraryWireToBrowserItem]);

  const visibleBrowserItems = useMemo<BrowserMediaItem[]>(() => {
    const base =
      browserFilter === 'recent'
        ? recentBrowserItems
        : browserFilter === 'likes'
          ? likedBrowserItems
          : browserFilter === 'folders'
            ? folderBrowserItems
            : uploadBrowserItems;

    const q = mediaSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter((item) => item.label.toLowerCase().includes(q));
  }, [browserFilter, folderBrowserItems, likedBrowserItems, mediaSearch, recentBrowserItems, uploadBrowserItems]);

  const handleAddBrowserVideoToTimeline = (item: BrowserMediaItem) => {
    if (item.kind !== 'video') return;
    const dur = Math.max(1, item.seconds ?? 5);
    const streamUrl =
      item.sourceKind === 'output' && item.outputId
        ? sameOriginComposeUrl(organizationId, 'output', item.outputId)
        : item.sourceKind === 'asset' && item.assetId
          ? sameOriginComposeUrl(organizationId, 'asset', item.assetId)
          : item.url;

    const next = appendClip(project, {
      label: item.label,
      sourceKind: item.sourceKind,
      ...(item.assetId ? { assetId: item.assetId } : {}),
      ...(item.outputId ? { outputId: item.outputId } : {}),
      srcUrl: streamUrl,
      thumbUrl: item.thumbUrl,
      durationSec: dur,
      trimStartSec: 0,
      trimEndSec: dur,
      volume: 1,
      muted: false,
    });
    commitProject(next);
    setSelectedClipIdx(next.clips.length - 1);
  };

  const handleSelectAudioAsset = (asset: StudioAssetView) => {
    const dur = Math.max(1, asset.seconds ?? 15);
    commitProject({
      ...project,
      bgm: {
        label: asset.name,
        sourceKind: 'asset',
        assetId: asset.id,
        srcUrl: sameOriginComposeUrl(organizationId, 'asset', asset.id),
        durationSec: dur,
        trimStartSec: 0,
        volume: 0.4,
      },
    });
  };

  /* ---------------------------------------------------------------- Reference Color Grading */

  const currentGrade: ComposeColorGradeState = useMemo(
    () =>
      project.colorGrade ?? {
        enabled: false,
        scope: 'full_timeline',
        clipId: null,
        clipIndex: null,
        region: DEFAULT_COLOR_REGION,
        presetId: null,
        referenceLabel: null,
        referenceUrl: null,
        referenceAssetId: null,
        referenceOutputId: null,
        referenceProfile: null,
        intensity: 0.85,
        skinProtect: 0.7,
        grain: 2.0,
        halation: 0.04,
      },
    [project.colorGrade],
  );

  const activeFrameGradeSpec = useMemo(
    () => toColorGradeSpec(frameAtPlayhead.activeColorGrade),
    [frameAtPlayhead.activeColorGrade],
  );
  const liveCssFilter = useMemo(() => cssFilterForColorGrade(activeFrameGradeSpec), [activeFrameGradeSpec]);

  const displayedRegion = useMemo(
    () => liveDragRegion ?? normalizeColorRegion(currentGrade.region ?? DEFAULT_COLOR_REGION),
    [currentGrade.region, liveDragRegion],
  );

  const presetLabel = (presetId: ComposeColorPresetId): string => {
    switch (presetId) {
      case 'twings-french-blue':
        return copy.colorGrade.presets.frenchBlue;
      case 'clean-high-key':
        return copy.colorGrade.presets.cleanHighKey;
      case 'editorial-cool-porcelain':
        return copy.colorGrade.presets.coolPorcelain;
      case 'kodak-2383-warm':
        return copy.colorGrade.presets.filmWarm;
      case 'moody-teal-amber':
        return copy.colorGrade.presets.tealAmber;
      case 'pastel-airy-film':
        return copy.colorGrade.presets.pastelAiry;
    }
  };

  const handleSetGradeScope = (scope: ComposeColorScope) => {
    applyPatches([
      {
        op: 'set_color_grade',
        enabled: true,
        scope,
        clipIndex: scope === 'selected_clip' ? safeSelectedIdx : null,
        clipId: scope === 'selected_clip' ? (selectedClip?.id ?? null) : null,
        region: scope === 'region' ? normalizeColorRegion(currentGrade.region ?? DEFAULT_COLOR_REGION) : currentGrade.region,
        presetId: currentGrade.presetId ?? (currentGrade.referenceProfile ? null : 'twings-french-blue'),
        intensity: currentGrade.intensity,
        skinProtect: currentGrade.skinProtect,
        grain: currentGrade.grain,
        halation: currentGrade.halation,
      },
    ]);
  };

  const handleSelectGradePreset = (presetId: ComposeColorPresetId) => {
    applyPatches([
      {
        op: 'set_color_grade',
        enabled: true,
        scope: currentGrade.scope,
        clipIndex: currentGrade.scope === 'selected_clip' ? safeSelectedIdx : null,
        clipId: currentGrade.scope === 'selected_clip' ? (selectedClip?.id ?? null) : null,
        presetId,
        intensity: currentGrade.intensity,
        skinProtect: currentGrade.skinProtect,
        grain: currentGrade.grain,
        halation: currentGrade.halation,
      },
    ]);
  };

  const handleMatchColorReference = useCallback(
    async (item: {
      label: string;
      url: string;
      kind: 'image' | 'video';
      assetId?: string;
      outputId?: string;
    }) => {
      if (!canCreate) return;
      setAnalyzingRef(true);
      try {
        const analysisUrl =
          item.kind === 'video' && item.outputId
            ? sameOriginComposeUrl(organizationId, 'output', item.outputId)
            : item.kind === 'video' && item.assetId
              ? sameOriginComposeUrl(organizationId, 'asset', item.assetId)
              : item.url;

        let browserProfile: ColorGradeProfile | null = null;
        try {
          browserProfile = await extractColorProfileInBrowser(analysisUrl, item.kind);
        } catch {
          browserProfile = null;
        }

        let serverProfile: ColorGradeProfile | null = null;
        try {
          const res = await postPostProduction('grade.analyze', {
            organizationId,
            referenceProfile: browserProfile,
            referenceLabel: item.label,
            presetId: currentGrade.presetId ?? null,
            scope: currentGrade.scope,
            targetClipId: currentGrade.scope === 'selected_clip' ? (selectedClip?.id ?? null) : null,
            region: currentGrade.scope === 'region' ? displayedRegion : null,
            intensity: currentGrade.intensity,
            skinProtect: currentGrade.skinProtect,
            halation: currentGrade.halation,
            grain: currentGrade.grain,
          });
          if (res.ok === true && res.profile && typeof res.profile === 'object') {
            serverProfile = res.profile as ColorGradeProfile;
          }
        } catch {
          // Keep browserProfile when offline or in pure client mode
        }

        const finalProfile =
          serverProfile ??
          browserProfile ?? {
            lumaMean: 0.52,
            lumaStd: 0.24,
            rMean: 0.54,
            gMean: 0.51,
            bMean: 0.47,
            rStd: 0.24,
            gStd: 0.22,
            bStd: 0.21,
            warmth: 0.12,
            contrast: 1.09,
            saturation: 1.05,
          };

        applyPatches([
          {
            op: 'set_color_grade',
            enabled: true,
            scope: currentGrade.scope,
            clipIndex: currentGrade.scope === 'selected_clip' ? safeSelectedIdx : null,
            clipId: currentGrade.scope === 'selected_clip' ? (selectedClip?.id ?? null) : null,
            region: currentGrade.scope === 'region' ? displayedRegion : currentGrade.region,
            referenceLabel: item.label,
            referenceUrl: item.url,
            referenceAssetId: item.assetId ?? null,
            referenceOutputId: item.outputId ?? null,
            referenceProfile: finalProfile,
            intensity: currentGrade.intensity,
            skinProtect: currentGrade.skinProtect,
            grain: currentGrade.grain,
            halation: currentGrade.halation,
          },
        ]);
        setSourceTab('color');
      } finally {
        setAnalyzingRef(false);
      }
    },
    [applyPatches, canCreate, currentGrade, displayedRegion, organizationId, safeSelectedIdx, selectedClip?.id],
  );

  const handleSaveGradedMaster = async () => {
    if (!canCreate || savingMaster) return;
    setSavingMaster(true);
    try {
      const res = await postPostProduction('grade.master', {
        organizationId,
        presetId: currentGrade.presetId ?? 'twings-french-blue',
        settings: {
          intensity: currentGrade.intensity,
          skin_protect: currentGrade.skinProtect,
          halation: currentGrade.halation,
          grain: currentGrade.grain,
        },
        scope: currentGrade.scope,
        targetClipId: currentGrade.scope === 'selected_clip' ? (selectedClip?.id ?? null) : null,
        region: currentGrade.scope === 'region' ? displayedRegion : null,
        referenceProfile: currentGrade.referenceProfile ?? null,
      });

      if (res.ok === true) {
        const used = typeof res.creditsUsed === 'number' ? res.creditsUsed : 0;
        setStatusMessage(
          interpolate(copy.colorGrade.masterSaved, {
            credits: formatCredits(used, locale),
          }),
        );
      } else {
        setStatusMessage(copy.colorGrade.masterFailed);
      }
    } catch {
      setStatusMessage(copy.colorGrade.masterFailed);
    } finally {
      setSavingMaster(false);
    }
  };

  // Interactive pointer drag for Region Mask on preview monitor
  const handleRegionPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canCreate || !frameShellRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const reg = displayedRegion;
    dragRegionRef.current = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: reg.x,
      originY: reg.y,
      w: reg.w,
      h: reg.h,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events in unit tests may not implement setPointerCapture
    }
  };

  const handleRegionPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRegionRef.current;
    const shell = frameShellRef.current;
    if (!drag || !shell) return;
    const rect = shell.getBoundingClientRect();
    const width = Math.max(1, rect.width || 320);
    const height = Math.max(1, rect.height || 320);
    const dx = (event.clientX - drag.startClientX) / width;
    const dy = (event.clientY - drag.startClientY) / height;
    const next = normalizeColorRegion({
      x: clamp(drag.originX + dx, 0, Math.max(0, 1 - drag.w)),
      y: clamp(drag.originY + dy, 0, Math.max(0, 1 - drag.h)),
      w: drag.w,
      h: drag.h,
    });
    setLiveDragRegion(next);
  };

  const handleRegionPointerUp = () => {
    const drag = dragRegionRef.current;
    if (!drag) return;
    dragRegionRef.current = null;
    if (liveDragRegion) {
      const next = liveDragRegion;
      setLiveDragRegion(null);
      applyPatches([
        {
          op: 'set_color_grade',
          enabled: true,
          scope: 'region',
          region: next,
        },
      ]);
    }
  };

  /* ---------------------------------------------------------------- Automatic Scene Cut Detection */

  const detectCutsForClip = useCallback(
    async (clip: ComposeClip): Promise<number[]> => {
      let detected: DetectedCut[] = [];
      try {
        detected = await detectVideoSceneCutsInBrowser(clip.srcUrl, {
          minShotSec: 0.4,
          maxDurationSec: Math.min(120, clip.durationSec),
        });
      } catch {
        detected = [];
      }

      if (detected.length === 0) {
        try {
          const fallback = await postPostProduction('cuts.detect', {
            organizationId,
            ...(clip.assetId ? { assetId: clip.assetId } : {}),
            ...(clip.outputId ? { outputId: clip.outputId } : {}),
            minShotSec: 0.4,
          });
          if (fallback.ok === true && Array.isArray(fallback.cuts)) {
            detected = fallback.cuts as DetectedCut[];
          }
        } catch {
          detected = [];
        }
      }

      return detected
        .map((c) => Number(c.timeSec))
        .filter((n) => Number.isFinite(n) && n > 0.05 && n < clip.durationSec - 0.05);
    },
    [organizationId],
  );

  const handleDetectCuts = async () => {
    if (!canCreate || !selectedClip || detectingCuts) return;
    setDetectingCuts(true);
    try {
      const cutMarkers = await detectCutsForClip(selectedClip);
      applyPatches([{ op: 'set_clip_cuts', clipIndex: safeSelectedIdx, cutMarkers }]);
      const valid = splittableCutMediaSecs(selectedClip, cutMarkers);
      if (valid.length > 0) {
        setStatusMessage(interpolate(copy.timeline.detectedBadge, { count: valid.length }));
      } else {
        setStatusMessage(copy.timeline.noCutsDetected);
      }
    } finally {
      setDetectingCuts(false);
    }
  };

  const handleApplyDetectedAutoCuts = () => {
    if (!canCreate || !selectedClip || detectedSplittableCuts.length === 0) return;
    const pieces = detectedSplittableCuts.length + 1;
    const count = applyPatches([
      {
        op: 'split_clip_cuts',
        clipIndex: safeSelectedIdx,
        cutMediaSecs: detectedSplittableCuts,
      },
    ]);
    if (count > 0) {
      setStatusMessage(interpolate(copy.timeline.splitApplied, { count: pieces }));
    }
  };

  /* ---------------------------------------------------------------- Upscaling (`1080p` / `1440p` / `4K`) */

  const upscaleTargetDuration = useMemo(() => {
    if (upscaleScope === 'selected_clip') {
      return selectedClip ? clipPlayDuration(selectedClip) : 5;
    }
    return Math.max(1, totalSec || 5);
  }, [selectedClip, totalSec, upscaleScope]);

  const upscaleShotCuts = useMemo(() => {
    if (upscaleScope === 'selected_clip') {
      return (selectedClip?.cutMarkers ?? []).filter((t) => t > 0 && t < (selectedClip?.durationSec ?? 600));
    }
    const pts = new Set<number>();
    for (const sp of spans.slice(0, -1)) {
      pts.add(roundTenths(sp.timelineEndSec));
    }
    for (const sp of spans) {
      for (const m of sp.clip.cutMarkers ?? []) {
        if (m > sp.clip.trimStartSec + 0.2 && m < sp.clip.trimEndSec - 0.2) {
          pts.add(roundTenths(sp.timelineStartSec + (m - sp.clip.trimStartSec)));
        }
      }
    }
    return [...pts].sort((a, b) => a - b);
  }, [selectedClip, spans, upscaleScope]);

  const upscaleEstimateCredits = useMemo(
    () => upscaleCredits(upscaleRes, upscaleTargetDuration, 'video'),
    [upscaleRes, upscaleTargetDuration],
  );

  const handleRunUpscale = async () => {
    if (!canCreate || upscaleBusy || project.clips.length === 0) return;
    const targetClip = upscaleScope === 'selected_clip' ? selectedClip : (project.clips[0] ?? null);
    if (!targetClip) return;

    setUpscaleBusy(true);
    setUpscalePollStatus(null);
    try {
      const targetAssetId =
        upscaleScope === 'full_timeline' && savedAssetId ? savedAssetId : targetClip.assetId;
      const targetOutputId = !targetAssetId ? targetClip.outputId : undefined;

      let current = await postPostProduction('upscale.submit', {
        organizationId,
        requestId: makeComposeRequestId('ups'),
        kind: 'video',
        ...(targetAssetId ? { assetId: targetAssetId } : {}),
        ...(targetOutputId ? { outputId: targetOutputId } : {}),
        sourceUrl: targetClip.srcUrl,
        resolution: upscaleRes,
        durationSec: upscaleTargetDuration,
        shotCutSeconds: upscaleShotCuts,
        batchSize: 21,
        colorCorrection: upscaleColorMode,
      });

      let polls = 0;
      while (
        current.ok === true &&
        (current.status === 'running' || current.status === 'queued') &&
        typeof current.jobId === 'string' &&
        polls < 25
      ) {
        setUpscalePollStatus(String(current.status));
        await waitMs(350);
        current = await postPostProduction('upscale.status', {
          organizationId,
          jobId: current.jobId,
        });
        polls += 1;
      }

      if (current.ok !== true || current.status !== 'succeeded') {
        if (current.allowance && typeof current.allowance === 'object') {
          setAllowance(current.allowance as StudioAllowanceView);
        }
        setStatusMessage(copy.upscale.failed);
        return;
      }

      if (current.allowance && typeof current.allowance === 'object') {
        setAllowance(current.allowance as StudioAllowanceView);
      }

      const newAssetId = typeof current.assetId === 'string' ? current.assetId : null;
      const outputUrl = typeof current.outputUrl === 'string' ? current.outputUrl : null;
      const resNumber = typeof current.resolution === 'number' ? current.resolution : upscaleRes;
      const resBadge = resNumber === 2160 ? '4K UHD' : `${resNumber}p`;

      if (newAssetId && outputUrl) {
        const addedAsset: StudioAssetView = {
          id: newAssetId,
          kind: 'video',
          role: null,
          name: `${targetClip.label} (${resBadge})`,
          tags: [],
          width: typeof current.width === 'number' ? current.width : null,
          height: typeof current.height === 'number' ? current.height : null,
          seconds: upscaleTargetDuration,
          url: outputUrl,
          thumbUrl: targetClip.thumbUrl ?? null,
          source: 'generation',
          createdAt: new Date().toISOString(),
        };
        setAssets((prev) => (prev.some((a) => a.id === newAssetId) ? prev : [addedAsset, ...prev]));
      }

      const nextStreamUrl = newAssetId
        ? sameOriginComposeUrl(organizationId, 'asset', newAssetId)
        : (outputUrl ?? targetClip.srcUrl);

      if (upscaleScope === 'selected_clip' && selectedClip) {
        const nextClips = [...project.clips];
        nextClips[safeSelectedIdx] = {
          ...selectedClip,
          label: `${selectedClip.label.replace(/\s*\((1080p|1440p|4K UHD)\)$/i, '')} (${resBadge})`,
          sourceKind: newAssetId ? 'asset' : selectedClip.sourceKind,
          ...(newAssetId ? { assetId: newAssetId } : {}),
          srcUrl: nextStreamUrl,
        };
        commitProject({ ...project, clips: nextClips });
      } else if (newAssetId) {
        setSavedAssetId(newAssetId);
      }

      const used = typeof current.creditsUsed === 'number' ? current.creditsUsed : upscaleEstimateCredits;
      setStatusMessage(
        interpolate(copy.upscale.succeeded, {
          resolution: resBadge,
          credits: formatCredits(used, locale),
        }),
      );
    } catch {
      setStatusMessage(copy.upscale.failed);
    } finally {
      setUpscaleBusy(false);
      setUpscalePollStatus(null);
    }
  };

  /* ---------------------------------------------------------------- Reference Music Generation */

  const musicDurationSec = useMemo(
    () => clamp(Math.round(totalSec > 0 ? totalSec : 15), 5, 60),
    [totalSec],
  );
  const musicEstimateCredits = useMemo(() => musicCredits(musicDurationSec), [musicDurationSec]);

  const handleGenerateMusic = async () => {
    if (!canCreate || musicBusy) return;
    setMusicBusy(true);
    try {
      const spec = MUSIC_STYLE_SPECS[musicStyle];
      const revealSec = clamp(roundTenths(musicRevealSec), 0.2, Math.max(0.3, musicDurationSec - 0.3));
      const modeNote =
        musicMode === 'vocal_guide'
          ? 'airy vocal melody guide phrasing'
          : 'pure instrumental arrangement without vocals';

      let current = await postPostProduction('music.generate', {
        organizationId,
        requestId: makeComposeRequestId('mus'),
        presetId: spec.presetId,
        prompt: `${spec.prompt}, ${modeNote}`,
        bpm: musicBpm,
        keySignature: spec.keySignature,
        leadInstrument: spec.leadInstrument,
        durationSec: musicDurationSec,
        ...(musicDropSync ? { revealSec, videoRevealSec: revealSec } : {}),
        ...(musicRefAudio?.assetId ? { refAudioAssetId: musicRefAudio.assetId } : {}),
        ...(musicRefAudio?.url && !musicRefAudio.url.startsWith('blob:')
          ? { refAudioUrl: musicRefAudio.url }
          : {}),
        ...(musicRefAudio
          ? {
              ref_audio: {
                ...(musicRefAudio.assetId ? { assetId: musicRefAudio.assetId } : {}),
                ...(musicRefAudio.url && !musicRefAudio.url.startsWith('blob:')
                  ? { url: musicRefAudio.url }
                  : {}),
                label: musicRefAudio.label,
              },
            }
          : {}),
      });

      let polls = 0;
      while (
        current.ok === true &&
        (current.status === 'running' || current.status === 'queued') &&
        typeof current.jobId === 'string' &&
        polls < 20
      ) {
        await waitMs(350);
        current = await postPostProduction('music.status', {
          organizationId,
          jobId: current.jobId,
        });
        polls += 1;
      }

      if (current.ok !== true || current.status !== 'succeeded') {
        if (current.allowance && typeof current.allowance === 'object') {
          setAllowance(current.allowance as StudioAllowanceView);
        }
        setStatusMessage(copy.musicGen.generateFailed);
        return;
      }

      if (current.allowance && typeof current.allowance === 'object') {
        setAllowance(current.allowance as StudioAllowanceView);
      }

      const assetId = typeof current.assetId === 'string' ? current.assetId : null;
      const rawAudioUrl = typeof current.audioUrl === 'string' && current.audioUrl ? current.audioUrl : null;
      const dataUrl = typeof current.dataUrl === 'string' && current.dataUrl ? current.dataUrl : null;
      const previewUrl =
        dataUrl ??
        rawAudioUrl ??
        (assetId ? sameOriginComposeUrl(organizationId, 'asset', assetId) : '');
      const timelineUrl = assetId
        ? sameOriginComposeUrl(organizationId, 'asset', assetId)
        : (rawAudioUrl ?? dataUrl ?? '');
      const dur = typeof current.durationSec === 'number' ? current.durationSec : musicDurationSec;
      const bpm = typeof current.bpm === 'number' ? current.bpm : musicBpm;
      const trackLabel = `${copy.musicGen.styles[musicStyle]} (${bpm} BPM)`;

      if (assetId && (rawAudioUrl || previewUrl)) {
        const addedAudio: StudioAssetView = {
          id: assetId,
          kind: 'audio',
          role: null,
          name: trackLabel,
          tags: [],
          width: null,
          height: null,
          seconds: dur,
          url: rawAudioUrl ?? previewUrl,
          thumbUrl: null,
          source: 'generation',
          createdAt: new Date().toISOString(),
        };
        setAssets((prev) => (prev.some((a) => a.id === assetId) ? prev : [addedAudio, ...prev]));
      }

      const readyTrack: GeneratedMusicState = {
        jobId: String(current.jobId),
        label: trackLabel,
        assetId,
        previewUrl,
        timelineUrl,
        durationSec: dur,
        bpm,
        revealSec: typeof current.revealSec === 'number' ? current.revealSec : revealSec,
        nonCommercialOnly: current.nonCommercialOnly !== false,
        creditsUsed: typeof current.creditsUsed === 'number' ? current.creditsUsed : musicEstimateCredits,
      };
      setGeneratedMusic(readyTrack);
      setStatusMessage(interpolate(copy.musicGen.generatedReady, { seconds: dur }));
    } catch {
      setStatusMessage(copy.musicGen.generateFailed);
    } finally {
      setMusicBusy(false);
    }
  };

  const handlePlaceGeneratedMusicOnTimeline = () => {
    if (!generatedMusic || !generatedMusic.timelineUrl) return;
    commitProject({
      ...project,
      bgm: {
        label: generatedMusic.label,
        sourceKind: generatedMusic.assetId ? 'asset' : 'local',
        ...(generatedMusic.assetId ? { assetId: generatedMusic.assetId } : {}),
        srcUrl: generatedMusic.timelineUrl,
        durationSec: generatedMusic.durationSec,
        trimStartSec: 0,
        volume: 0.45,
        nonCommercialGuide: generatedMusic.nonCommercialOnly,
        dropSyncSec: musicDropSync ? generatedMusic.revealSec : null,
      },
    });
  };

  /* ---------------------------------------------------------------- Local File Uploads */

  const handleLocalFilePick = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;

    let current = project;
    let addedVideo = false;
    for (const file of files) {
      const isVideo = file.type === 'video/mp4' || file.type === 'video/quicktime' || /\.(mp4|mov)$/i.test(file.name);
      const isAudio = file.type === 'audio/mpeg' || file.type === 'audio/wav' || /\.(mp3|wav)$/i.test(file.name);
      const isImage =
        file.type === 'image/jpeg' ||
        file.type === 'image/png' ||
        file.type === 'image/webp' ||
        /\.(jpe?g|png|webp)$/i.test(file.name);

      if (!isVideo && !isAudio && !isImage) {
        setStatusMessage(copy.status.unsupportedFile);
        continue;
      }

      const objectUrl = URL.createObjectURL(file);
      localBlobUrlsRef.current.push(objectUrl);
      const cleanLabel = file.name.replace(/\.[^.]+$/, '') || 'Media';

      if (isImage) {
        const localItem: BrowserMediaItem = {
          key: `l:${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          id: `local_${Date.now()}`,
          kind: 'image',
          sourceKind: 'local',
          label: cleanLabel,
          url: objectUrl,
          thumbUrl: objectUrl,
          seconds: null,
        };
        setLocalMediaItems((prev) => [localItem, ...prev]);
        setStatusMessage(interpolate(copy.status.localClipAdded, { name: file.name }));
        if (sourceTab === 'color') {
          void handleMatchColorReference({ label: cleanLabel, url: objectUrl, kind: 'image' });
        }
        continue;
      }

      const measured = await measureInBrowser(file, isVideo ? 'video' : 'audio');
      const dur = Math.max(1, roundTenths(measured.seconds ?? (isVideo ? 5 : 15)));
      if (isVideo) {
        const localVideoItem: BrowserMediaItem = {
          key: `l:${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          id: `local_${Date.now()}`,
          kind: 'video',
          sourceKind: 'local',
          label: cleanLabel,
          url: objectUrl,
          thumbUrl: null,
          seconds: dur,
        };
        setLocalMediaItems((prev) => [localVideoItem, ...prev]);
        current = appendClip(current, {
          label: cleanLabel,
          sourceKind: 'local',
          srcUrl: objectUrl,
          thumbUrl: null,
          durationSec: dur,
          trimStartSec: 0,
          trimEndSec: dur,
          volume: 1,
          muted: false,
        });
        addedVideo = true;
      } else {
        current = {
          ...current,
          bgm: {
            label: cleanLabel,
            sourceKind: 'local',
            srcUrl: objectUrl,
            durationSec: dur,
            trimStartSec: 0,
            volume: 0.4,
          },
        };
      }
      setStatusMessage(interpolate(copy.status.localClipAdded, { name: file.name }));
    }
    if (current !== project) {
      commitProject(current);
      if (addedVideo) setSelectedClipIdx(Math.max(0, current.clips.length - 1));
    }
  };

  const handleGradeRefFilePick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const isVideo = file.type.startsWith('video/') || /\.(mp4|mov)$/i.test(file.name);
    const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(file.name);
    if (!isVideo && !isImage) {
      setStatusMessage(copy.status.unsupportedFile);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    localBlobUrlsRef.current.push(objectUrl);
    const label = file.name.replace(/\.[^.]+$/, '') || 'Reference';
    await handleMatchColorReference({
      label,
      url: objectUrl,
      kind: isVideo ? 'video' : 'image',
    });
  };

  const handleRefAudioFilePick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const label = file.name.replace(/\.[^.]+$/, '') || 'Reference Audio';
    const objectUrl = URL.createObjectURL(file);
    localBlobUrlsRef.current.push(objectUrl);

    // Attempt workspace asset upload so the server music engine can read it by assetId
    if (canCreate) {
      try {
        const measured = await measureInBrowser(file, 'audio');
        const uploaded = await api.upload(file, { measure: async () => measured });
        if (!isFailure(uploaded)) {
          setAssets((prev) => (prev.some((a) => a.id === uploaded.asset.id) ? prev : [uploaded.asset, ...prev]));
          setMusicRefAudio({
            label: uploaded.asset.name,
            assetId: uploaded.asset.id,
            url: uploaded.asset.url,
          });
          return;
        }
      } catch {
        // Fall through to local reference state
      }
    }
    setMusicRefAudio({ label, url: objectUrl });
  };

  /* ---------------------------------------------------------------- Captions & ChatCut */

  const handleAddManualCaption = (event: FormEvent) => {
    event.preventDefault();
    const text = captionDraft.trim();
    if (!text) return;
    applyPatches([
      {
        op: 'add_caption',
        text,
        startSec: roundTenths(playheadSec),
        durationSec: 2.5,
        position: captionPos,
        size: captionSize,
      },
    ]);
    setCaptionDraft('');
  };

  const runChatInstruction = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || chatBusy) return;
    const userMsg: ChatEntry = { id: `u_${Date.now()}`, role: 'user', text };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput('');

    if (!canCreate) {
      setChatMessages((prev) => [...prev, { id: `a_${Date.now()}`, role: 'assistant', text: copy.chat.readOnly }]);
      return;
    }

    const localCmd = parseComposeChatCommand(text, project, locale, {
      playheadSec,
      selectedClipIdx: safeSelectedIdx,
    });

    if (localCmd.kind === 'undo') {
      if (undoStack.length > 0) {
        handleUndo();
        setChatMessages((prev) => [...prev, { id: `a_${Date.now()}`, role: 'assistant', text: copy.chat.undone }]);
      } else {
        setChatMessages((prev) => [
          ...prev,
          { id: `a_${Date.now()}`, role: 'assistant', text: copy.chat.nothingToUndo },
        ]);
      }
      return;
    }

    if (localCmd.kind === 'patches') {
      setChatBusy(true);
      try {
        const resolvedPatches: TimelinePatch[] = [];
        for (const patch of localCmd.patches) {
          if (patch.op === 'split_clip_cuts' && patch.cutMediaSecs.length === 0) {
            const clip = project.clips[patch.clipIndex];
            if (clip) {
              const detected = await detectCutsForClip(clip);
              resolvedPatches.push({ op: 'set_clip_cuts', clipIndex: patch.clipIndex, cutMarkers: detected });
              resolvedPatches.push({ op: 'split_clip_cuts', clipIndex: patch.clipIndex, cutMediaSecs: detected });
              continue;
            }
          }
          resolvedPatches.push(patch);
        }
        const count = applyPatches(resolvedPatches);
        const reply =
          count > 0
            ? interpolate(copy.chat.appliedSummary, { count, detail: localCmd.detail })
            : copy.chat.unrecognized;
        setChatMessages((prev) => [...prev, { id: `a_${Date.now()}`, role: 'assistant', text: reply }]);
      } finally {
        setChatBusy(false);
      }
      return;
    }

    setChatBusy(true);
    try {
      const res = await postComposeOperation('chat.edit', {
        organizationId,
        message: text,
        locale,
        project,
      });

      if (res.ok === false) {
        const reply =
          res.code === 'rate_limited'
            ? interpolate(copy.chat.rateLimited, {
                seconds: typeof res.retryAfterSec === 'number' ? res.retryAfterSec : 60,
              })
            : copy.chat.unrecognized;
        setChatMessages((prev) => [...prev, { id: `a_${Date.now()}`, role: 'assistant', text: reply }]);
        return;
      }

      if (res.kind === 'undo') {
        if (undoStack.length > 0) {
          handleUndo();
          setChatMessages((prev) => [...prev, { id: `a_${Date.now()}`, role: 'assistant', text: copy.chat.undone }]);
        } else {
          setChatMessages((prev) => [
            ...prev,
            { id: `a_${Date.now()}`, role: 'assistant', text: copy.chat.nothingToUndo },
          ]);
        }
        return;
      }

      if (res.kind === 'patches' && Array.isArray(res.patches)) {
        const count = applyPatches(res.patches as TimelinePatch[]);
        const reply =
          count > 0
            ? interpolate(copy.chat.appliedSummary, {
                count,
                detail: typeof res.detail === 'string' ? res.detail : '',
              })
            : copy.chat.unrecognized;
        setChatMessages((prev) => [...prev, { id: `a_${Date.now()}`, role: 'assistant', text: reply }]);
        return;
      }

      setChatMessages((prev) => [...prev, { id: `a_${Date.now()}`, role: 'assistant', text: copy.chat.unrecognized }]);
    } catch {
      setChatMessages((prev) => [...prev, { id: `a_${Date.now()}`, role: 'assistant', text: copy.chat.unrecognized }]);
    } finally {
      setChatBusy(false);
    }
  };

  /* ---------------------------------------------------------------- Export, Save & Review/Share */

  const triggerDownload = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleExport = async () => {
    if (!canCreate || project.clips.length === 0 || exportingRatio !== null) return;
    setPlaying(false);
    setExportingRatio(0.02);
    setStatusMessage(null);
    setSavedAssetId(null);

    try {
      // Export is free (docs/BRAND-EDITING-STUDIO.md §8-3): the server only records the export, so there is
      // nothing to refund when the browser fails to encode.
      const reserve = await postComposeOperation('render.reserve', {
        organizationId,
        requestId: makeComposeRequestId(),
        durationSec: Math.max(0.3, totalSec),
      });

      if (reserve.ok !== true || typeof reserve.jobId !== 'string') {
        setStatusMessage(copy.status.exportFailed);
        return;
      }

      const result = await exportCompositionMp4(project, (ratio) => setExportingRatio(ratio));
      const objectUrl = URL.createObjectURL(result.blob);
      setLastExport((prev) => {
        if (prev?.objectUrl) URL.revokeObjectURL(prev.objectUrl);
        return { ...result, objectUrl };
      });
      triggerDownload(objectUrl, result.filename);
      const mb = (result.blob.size / (1024 * 1024)).toFixed(1);
      const elapsed = (result.elapsedMs / 1000).toFixed(1);
      setStatusMessage(
        result.mime === 'video/mp4'
          ? interpolate(copy.status.exportedReady, {
              seconds: result.durationSec,
              mb,
              elapsed,
            })
          : interpolate(copy.status.exportWebmFallback, {
              seconds: result.durationSec,
            }),
      );
    } catch {
      setStatusMessage(copy.status.exportFailed);
    } finally {
      setExportingRatio(null);
    }
  };

  const uploadLastExportToAssets = async (): Promise<string | null> => {
    if (!canCreate || !lastExport || lastExport.mime !== 'video/mp4') return null;
    setSavingAsset(true);
    try {
      const file = Object.assign(lastExport.blob, { name: lastExport.filename });
      const res = await api.upload(file, {
        measure: async () => ({
          width: lastExport.width,
          height: lastExport.height,
          seconds: lastExport.durationSec,
        }),
      });
      if (isFailure(res)) {
        setStatusMessage(
          res.code === 'asset_limit' || res.code === 'storage_quota_exceeded'
            ? copy.status.saveQuotaExceeded
            : copy.status.saveFailed,
        );
        return null;
      }
      setSavedAssetId(res.asset.id);
      setAssets((prev) => (prev.some((a) => a.id === res.asset.id) ? prev : [res.asset, ...prev]));
      return res.asset.id;
    } catch {
      setStatusMessage(copy.status.saveFailed);
      return null;
    } finally {
      setSavingAsset(false);
    }
  };

  const handleSaveToAssets = async () => {
    if (savingAsset || savedAssetId) return;
    await uploadLastExportToAssets();
  };

  const handleOpenShareReview = async () => {
    const fallbackClip = selectedClip ?? project.clips[0] ?? null;
    let targetAssetId = savedAssetId ?? fallbackClip?.assetId ?? null;
    const targetOutputId = !targetAssetId ? (fallbackClip?.outputId ?? null) : null;
    const title = fallbackClip?.label || copy.title;

    if (!targetAssetId && !targetOutputId && canCreate && lastExport?.mime === 'video/mp4') {
      const uploadedId = await uploadLastExportToAssets();
      if (uploadedId) targetAssetId = uploadedId;
    }

    openShareReview({
      organizationId,
      assetId: targetAssetId,
      outputId: targetOutputId,
      title,
    });

    if (targetAssetId || targetOutputId) {
      setStatusMessage(copy.status.reviewOpened);
    } else {
      setStatusMessage(copy.status.reviewNeedsSave);
    }
  };

  const handleExportNle = async () => {
    if (project.clips.length === 0 || exportingNle) return;
    setPlaying(false);
    setExportingNle(true);
    setStatusMessage(null);
    try {
      const fetchMedia = async (url: string): Promise<Uint8Array> => {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`media fetch ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      };
      const bundle = await exportProjectNleBundleZip(project, fetchMedia, {
        projectTitle: copy.title,
        includeBgm: true,
      });
      const blob = new Blob([bundle.zipBytes as BlobPart], { type: 'application/zip' });
      const objectUrl = URL.createObjectURL(blob);
      triggerDownload(objectUrl, bundle.filename);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      setStatusMessage(interpolate(copy.status.nleExported, { filename: bundle.filename }));
    } catch {
      setStatusMessage(copy.status.nleFailed);
    } finally {
      setExportingNle(false);
    }
  };

  const aspectLabel = (aspect: ComposeAspect): string => {
    switch (aspect) {
      case '9:16':
        return copy.aspects.r9x16;
      case '16:9':
        return copy.aspects.r16x9;
      case '4:5':
        return copy.aspects.r4x5;
      case '1:1':
        return copy.aspects.r1x1;
    }
  };

  const renderMediaBrowser = (mode: 'timeline' | 'reference') => (
    <div className={s.browserShell} data-compose-media-browser={mode}>
      <div className={s.filterPillRow} role="group" aria-label={copy.sources.browser.filterLabel}>
        {(['recent', 'likes', 'folders', 'uploads'] as const).map((filter) => (
          <button
            key={filter}
            type="button"
            className={s.filterPill}
            aria-pressed={browserFilter === filter}
            onClick={() => setBrowserFilter(filter)}
            data-compose-browser-filter={filter}
          >
            {filter === 'recent'
              ? copy.sources.browser.recent
              : filter === 'likes'
                ? copy.sources.browser.likes
                : filter === 'folders'
                  ? copy.sources.browser.folders
                  : copy.sources.browser.uploads}
          </button>
        ))}
      </div>

      {browserFilter === 'folders' ? (
        initialFolders.length > 0 ? (
          <div className={s.folderChipRow} data-compose-folder-list>
            {initialFolders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                className={s.folderChip}
                aria-pressed={activeFolderId === folder.id}
                onClick={() => setActiveFolderId(folder.id)}
                data-compose-folder-chip={folder.id}
              >
                <span>{folder.name}</span>
                <span className={s.folderCount}>{folder.count}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className={s.emptyNote}>{copy.sources.browser.emptyFolders}</p>
        )
      ) : null}

      {browserFilter === 'uploads' ? (
        <div className={s.uploadBox}>
          <label className={s.smallBtn}>
            <span>{copy.sources.browser.uploadBtn}</span>
            <input
              type="file"
              accept="video/mp4,video/quicktime,audio/mpeg,audio/wav,image/jpeg,image/png,image/webp,.mp4,.mov,.mp3,.wav,.jpg,.jpeg,.png,.webp"
              multiple
              hidden
              onChange={(e) => void handleLocalFilePick(e)}
              data-compose-local-input
            />
          </label>
          <p className={s.uploadHint}>{copy.sources.uploadHint}</p>
        </div>
      ) : null}

      <input
        type="search"
        className={s.searchInput}
        value={mediaSearch}
        onChange={(e) => setMediaSearch(e.target.value)}
        placeholder={copy.sources.browser.searchPlaceholder}
        aria-label={copy.sources.browser.searchPlaceholder}
        data-compose-media-search
      />

      {browserFilter === 'folders' && loadingFolderId === activeFolderId ? (
        <p className={s.emptyNote}>{copy.sources.browser.loadingFolder}</p>
      ) : visibleBrowserItems.length > 0 ? (
        <div className={s.sourceGrid}>
          {visibleBrowserItems.map((item) => (
            <div
              key={item.key}
              className={s.sourceCard}
              data-compose-media-card={item.key}
              data-compose-output-card={item.outputId}
              data-compose-asset-card={item.assetId}
            >
              <div className={s.sourceThumb}>
                {item.thumbUrl ? (
                  <img src={item.thumbUrl} alt={item.label} />
                ) : item.kind === 'image' ? (
                  <img src={item.url} alt={item.label} />
                ) : (
                  <video src={item.url} muted playsInline preload="metadata" />
                )}
                {item.kind === 'image' ? (
                  <span className={s.kindTag}>{copy.sources.browser.imageTag}</span>
                ) : item.seconds ? (
                  <span className={s.durationTag}>
                    {interpolate(copy.sources.clipMeta, { seconds: item.seconds })}
                  </span>
                ) : null}
              </div>
              <p className={s.sourceName} title={item.label}>
                {item.label}
              </p>
              <div className={s.cardActions}>
                {mode === 'timeline' && item.kind === 'video' ? (
                  <button
                    type="button"
                    className={s.smallBtn}
                    disabled={!canCreate}
                    onClick={() => handleAddBrowserVideoToTimeline(item)}
                    data-compose-add-output={item.outputId}
                    data-compose-add-asset={item.assetId}
                  >
                    {copy.sources.addClip}
                  </button>
                ) : null}
                {(mode === 'reference' || item.kind === 'image') ? (
                  <button
                    type="button"
                    className={s.smallBtn}
                    disabled={!canCreate || analyzingRef}
                    onClick={() =>
                      void handleMatchColorReference({
                        label: item.label,
                        url: item.url,
                        kind: item.kind,
                        assetId: item.assetId,
                        outputId: item.outputId,
                      })
                    }
                    data-compose-grade-ref={item.id}
                  >
                    {copy.colorGrade.matchBtn}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className={s.emptyNote}>
          {mediaSearch.trim()
            ? copy.sources.browser.emptySearch
            : browserFilter === 'likes'
              ? copy.sources.browser.emptyLikes
              : browserFilter === 'folders'
                ? initialFolders.length === 0
                  ? copy.sources.browser.emptyFolders
                  : copy.sources.browser.emptyFolderItems
                : copy.sources.emptyVideos}
        </p>
      )}
    </div>
  );

  return (
    <div className={`bs-page ${s.page}`} data-brand-studio-v2 data-brand-studio-compose>
      <header className={s.header}>
        <div className={s.titleGroup}>
          <div className={s.titleRow}>
            <h1 className="bs-title">{copy.title}</h1>
            <span className={s.summaryBadge} data-compose-summary>
              {shownProject.clips.length > 0
                ? interpolate(copy.summary, { clips: shownProject.clips.length, seconds: totalSec })
                : copy.emptySummary}
            </span>
          </div>
          <p className={s.subtitle}>{copy.subtitle}</p>
        </div>

        <div className={s.headerActions}>
          <span className={s.creditBadge} data-compose-credits>
            {interpolate(copy.credits.remaining, { credits: formatCredits(remainingCredits, locale) })}
          </span>
          <a className={s.pillBtn} href={videoStudioHref} data-compose-back-video>
            {copy.backToVideo}
          </a>
          <button
            type="button"
            className={s.pillBtn}
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            data-compose-undo
            {...lockAttrs}
          >
            {copy.actions.undo}
          </button>
          {editAssist ? (
            <button
              type="button"
              className={s.pillBtn}
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              data-compose-redo
              {...lockAttrs}
            >
              {copy.assist.redo}
            </button>
          ) : null}
          <button
            type="button"
            className={s.pillBtn}
            onClick={() => void handleOpenShareReview()}
            data-compose-share-review
          >
            {copy.actions.shareReview}
          </button>
          <button
            type="button"
            className={s.pillBtn}
            onClick={() => void handleExportNle()}
            disabled={project.clips.length === 0 || exportingNle}
            data-compose-export-nle
            {...lockAttrs}
          >
            {exportingNle ? copy.actions.exportingNle : copy.actions.exportNle}
          </button>
          {canCreate && lastExport?.mime === 'video/mp4' ? (
            <button
              type="button"
              className={s.pillBtn}
              onClick={() => void handleSaveToAssets()}
              disabled={savingAsset || Boolean(savedAssetId)}
              data-compose-save-asset
            >
              {savedAssetId
                ? copy.actions.savedToAssets
                : savingAsset
                  ? copy.actions.savingToAssets
                  : copy.actions.saveToAssets}
            </button>
          ) : null}
          <button
            type="button"
            className={s.primaryBtn}
            onClick={() => void handleExport()}
            disabled={!canCreate || project.clips.length === 0 || exportingRatio !== null}
            data-variant="solid"
            data-compose-export
            {...lockAttrs}
          >
            {exportingRatio !== null
              ? interpolate(copy.actions.exporting, { percent: Math.round(exportingRatio * 100) })
              : copy.actions.exportMp4}
          </button>
        </div>
      </header>

      {statusMessage ? (
        <div className={s.statusBanner} role="status" data-compose-status>
          <span>{statusMessage}</span>
          {lastExport ? (
            <button
              type="button"
              className={s.smallBtn}
              onClick={() => triggerDownload(lastExport.objectUrl, lastExport.filename)}
            >
              {copy.actions.downloadAgain}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className={s.workbench}>
        {/* -------------------------------------------------------- Left: 5-Tab Post-Production Tools */}
        <section className={s.panel} aria-label={copy.sources.tabsLabel} data-compose-sources {...lockAttrs}>
          <div className={s.toolTabStrip} role="tablist" aria-label={copy.sources.tabsLabel}>
            {(['clips', 'color', 'music', 'captions', 'upscale'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                className={s.segTab}
                aria-selected={sourceTab === tab}
                onClick={() => setSourceTab(tab)}
                data-compose-source-tab={tab}
              >
                {tab === 'clips'
                  ? copy.sources.clipsTab
                  : tab === 'color'
                    ? copy.sources.colorTab
                    : tab === 'music'
                      ? copy.sources.musicTab
                      : tab === 'captions'
                        ? copy.sources.captionsTab
                        : copy.sources.upscaleTab}
              </button>
            ))}
          </div>

          {/* TAB 1: CLIPS (4-Source Media Browser) */}
          {sourceTab === 'clips' ? renderMediaBrowser('timeline') : null}

          {/* TAB 2: REFERENCE COLOR GRADING */}
          {sourceTab === 'color' ? (
            <div className={s.sourceSection} data-compose-color-panel>
              <div className={s.toolCard}>
                <div className={s.panelHead}>
                  <p className={s.sectionLabel}>{copy.colorGrade.heading}</p>
                  {project.colorGrade?.enabled ? (
                    <button
                      type="button"
                      className={s.smallBtn}
                      disabled={!canCreate}
                      onClick={() => applyPatches([{ op: 'set_color_grade', enabled: false }])}
                      data-compose-grade-reset
                    >
                      {copy.colorGrade.resetBtn}
                    </button>
                  ) : null}
                </div>
                <p className={s.leadNote}>{copy.colorGrade.lead}</p>

                <p className={s.sectionLabel}>{copy.colorGrade.scopeLabel}</p>
                <div className={s.filterPillRow} role="group" aria-label={copy.colorGrade.scopeLabel}>
                  {(
                    [
                      ['full_timeline', copy.colorGrade.scopeFull],
                      ['selected_clip', copy.colorGrade.scopeClip],
                      ['region', copy.colorGrade.scopeRegion],
                    ] as const
                  ).map(([scopeKey, label]) => (
                    <button
                      key={scopeKey}
                      type="button"
                      className={s.filterPill}
                      aria-pressed={currentGrade.scope === scopeKey && Boolean(project.colorGrade?.enabled)}
                      disabled={!canCreate}
                      onClick={() => handleSetGradeScope(scopeKey)}
                      data-compose-color-scope={scopeKey}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {currentGrade.scope === 'region' ? (
                  <div className={s.sliderList} data-compose-region-controls>
                    <p className={s.uploadHint}>{copy.colorGrade.regionHint}</p>
                    {(
                      [
                        ['x', copy.colorGrade.regionX, displayedRegion.x, 0, 92],
                        ['y', copy.colorGrade.regionY, displayedRegion.y, 0, 92],
                        ['w', copy.colorGrade.regionW, displayedRegion.w, 8, 100],
                        ['h', copy.colorGrade.regionH, displayedRegion.h, 8, 100],
                      ] as const
                    ).map(([axis, label, val, minPct, maxPct]) => (
                      <label key={axis} className={s.sliderRow}>
                        <span className={s.sliderHead}>
                          <span>{label}</span>
                          <span className={s.monoValue}>{Math.round(val * 100)}%</span>
                        </span>
                        <input
                          type="range"
                          className={s.rangeSlider}
                          min={minPct}
                          max={maxPct}
                          value={Math.round(val * 100)}
                          disabled={!canCreate}
                          onChange={(e) => {
                            const pct = Number(e.target.value) / 100;
                            const nextReg = normalizeColorRegion({
                              ...displayedRegion,
                              [axis]: pct,
                            });
                            applyPatches([
                              {
                                op: 'set_color_grade',
                                enabled: true,
                                scope: 'region',
                                region: nextReg,
                              },
                            ]);
                          }}
                          data-compose-region-slider={axis}
                        />
                      </label>
                    ))}
                  </div>
                ) : null}

                <p className={s.sectionLabel}>{copy.colorGrade.presetsLabel}</p>
                <div className={s.presetGrid}>
                  {GRADE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={s.presetPill}
                      aria-pressed={Boolean(project.colorGrade?.enabled && currentGrade.presetId === preset.id)}
                      disabled={!canCreate}
                      onClick={() => handleSelectGradePreset(preset.id)}
                      data-compose-grade-preset={preset.id}
                    >
                      {presetLabel(preset.id)}
                    </button>
                  ))}
                </div>

                <div className={s.sliderList}>
                  <label className={s.sliderRow}>
                    <span className={s.sliderHead}>
                      <span>{copy.colorGrade.sliders.intensity}</span>
                      <span className={s.monoValue}>{Math.round(currentGrade.intensity * 100)}%</span>
                    </span>
                    <input
                      type="range"
                      className={s.rangeSlider}
                      min={0}
                      max={100}
                      value={Math.round(currentGrade.intensity * 100)}
                      disabled={!canCreate}
                      onChange={(e) =>
                        applyPatches([
                          {
                            op: 'set_color_grade',
                            enabled: true,
                            intensity: Number(e.target.value) / 100,
                          },
                        ])
                      }
                      data-compose-grade-intensity
                    />
                  </label>

                  <label className={s.sliderRow}>
                    <span className={s.sliderHead}>
                      <span>{copy.colorGrade.sliders.skinProtect}</span>
                      <span className={s.monoValue}>{Math.round(currentGrade.skinProtect * 100)}%</span>
                    </span>
                    <input
                      type="range"
                      className={s.rangeSlider}
                      min={0}
                      max={100}
                      value={Math.round(currentGrade.skinProtect * 100)}
                      disabled={!canCreate}
                      onChange={(e) =>
                        applyPatches([
                          {
                            op: 'set_color_grade',
                            enabled: true,
                            skinProtect: Number(e.target.value) / 100,
                          },
                        ])
                      }
                      data-compose-grade-skin
                    />
                  </label>

                  <label className={s.sliderRow}>
                    <span className={s.sliderHead}>
                      <span>{copy.colorGrade.sliders.grain}</span>
                      <span className={s.monoValue}>{currentGrade.grain.toFixed(1)}</span>
                    </span>
                    <input
                      type="range"
                      className={s.rangeSlider}
                      min={0}
                      max={100}
                      value={Math.round(currentGrade.grain * 10)}
                      disabled={!canCreate}
                      onChange={(e) =>
                        applyPatches([
                          {
                            op: 'set_color_grade',
                            enabled: true,
                            grain: roundHundredths(Number(e.target.value) / 10),
                          },
                        ])
                      }
                      data-compose-grade-grain
                    />
                  </label>

                  <label className={s.sliderRow}>
                    <span className={s.sliderHead}>
                      <span>{copy.colorGrade.sliders.halation}</span>
                      <span className={s.monoValue}>{Math.round(currentGrade.halation * 100)}%</span>
                    </span>
                    <input
                      type="range"
                      className={s.rangeSlider}
                      min={0}
                      max={20}
                      value={Math.round(currentGrade.halation * 100)}
                      disabled={!canCreate}
                      onChange={(e) =>
                        applyPatches([
                          {
                            op: 'set_color_grade',
                            enabled: true,
                            halation: Number(e.target.value) / 100,
                          },
                        ])
                      }
                      data-compose-grade-halation
                    />
                  </label>
                </div>

                <button
                  type="button"
                  className={s.smallDarkBtn}
                  disabled={!canCreate || savingMaster}
                  onClick={() => void handleSaveGradedMaster()}
                  data-compose-grade-master
                >
                  {savingMaster ? copy.colorGrade.savingMasterBtn : copy.colorGrade.saveMasterBtn}
                </button>
              </div>

              <div className={s.toolCard}>
                <div className={s.panelHead}>
                  <p className={s.sectionLabel}>{copy.colorGrade.refLabel}</p>
                  {analyzingRef ? <span className={s.monoValue}>{copy.colorGrade.analyzingRef}</span> : null}
                </div>
                {currentGrade.referenceLabel ? (
                  <span className={s.summaryBadge} data-compose-active-grade-ref>
                    {interpolate(copy.colorGrade.activeRef, { name: currentGrade.referenceLabel })}
                  </span>
                ) : null}
                <label className={s.smallBtn}>
                  <span>{copy.colorGrade.uploadRef}</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,.jpg,.jpeg,.png,.webp,.mp4,.mov"
                    hidden
                    onChange={(e) => void handleGradeRefFilePick(e)}
                    data-compose-grade-ref-input
                  />
                </label>
                <p className={s.uploadHint}>{copy.colorGrade.pickFromBrowser}</p>
                {renderMediaBrowser('reference')}
              </div>
            </div>
          ) : null}

          {/* TAB 3: MUSIC & SOUND (Library Audio + Non-Commercial Reference Guide Music) */}
          {sourceTab === 'music' ? (
            <div className={s.sourceSection} data-compose-music-panel>
              {/* Sub-section 1: Saved audio & local upload */}
              <div className={s.toolCard}>
                <div className={s.panelHead}>
                  <p className={s.sectionLabel}>{copy.musicGen.librarySection}</p>
                  <label className={s.smallBtn}>
                    <span>{copy.musicGen.uploadAudioBtn}</span>
                    <input
                      type="file"
                      accept="audio/mpeg,audio/wav,.mp3,.wav"
                      hidden
                      onChange={(e) => void handleLocalFilePick(e)}
                      data-compose-audio-upload-input
                    />
                  </label>
                </div>

                {audioAssets.length > 0 ? (
                  <div className={s.audioList}>
                    {audioAssets.map((audio) => {
                      const active = project.bgm?.assetId === audio.id;
                      const isRef = musicRefAudio?.assetId === audio.id;
                      return (
                        <div key={audio.id} className={s.audioRow}>
                          <div className={s.audioRowHead}>
                            <p className={s.sourceName} title={audio.name}>
                              {audio.name}
                            </p>
                            <div className={s.cardActions}>
                              {/* Only feeds music generation, so it goes with it when generation is closed. */}
                              {musicGeneration ? (
                                <button
                                  type="button"
                                  className={s.smallBtn}
                                  aria-pressed={isRef}
                                  onClick={() =>
                                    setMusicRefAudio({
                                      label: audio.name,
                                      assetId: audio.id,
                                      url: audio.url,
                                    })
                                  }
                                  data-compose-pick-ref-audio={audio.id}
                                >
                                  {copy.musicGen.pickLibraryRef}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className={s.smallBtn}
                                onClick={() => handleSelectAudioAsset(audio)}
                                disabled={active || !canCreate}
                                data-compose-use-audio={audio.id}
                              >
                                {active ? copy.sources.activeMusic : copy.sources.useMusic}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className={s.emptyNote}>{copy.sources.emptyAudio}</p>
                )}
              </div>

              {/* Sub-section 2: Reference-Based Non-Commercial Music Generation (BRAND_STUDIO_MUSIC_GENERATION) */}
              {musicGeneration ? (
                <div className={s.toolCard} data-compose-music-gen>
                  <p className={s.sectionLabel}>{copy.musicGen.genHeading}</p>

                  <div className={s.noticeCard} data-compose-music-license-notice>
                    <span className={s.noticePill}>{copy.musicGen.licenseBadge}</span>
                    <p className={s.noticeBody}>{copy.musicGen.licenseNotice}</p>
                  </div>

                  <div className={s.audioRowHead}>
                    <span className={s.sectionLabel}>{copy.musicGen.refAudioLabel}</span>
                    <div className={s.cardActions}>
                      <label className={s.smallBtn}>
                        <span>{copy.musicGen.uploadRefAudio}</span>
                        <input
                          type="file"
                          accept="audio/mpeg,audio/wav,.mp3,.wav"
                          hidden
                          onChange={(e) => void handleRefAudioFilePick(e)}
                          data-compose-ref-audio-input
                        />
                      </label>
                      {musicRefAudio ? (
                        <button
                          type="button"
                          className={s.smallBtn}
                          onClick={() => setMusicRefAudio(null)}
                        >
                          {copy.musicGen.clearRefAudio}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {musicRefAudio ? (
                    <span className={s.summaryBadge} data-compose-active-ref-audio>
                      {interpolate(copy.musicGen.activeRefAudio, { name: musicRefAudio.label })}
                    </span>
                  ) : null}

                  <p className={s.sectionLabel}>{copy.musicGen.modeLabel}</p>
                  <div className={s.filterPillRow} role="group" aria-label={copy.musicGen.modeLabel}>
                    {(
                      [
                        ['instrumental', copy.musicGen.modeInstrumental],
                        ['vocal_guide', copy.musicGen.modeVocalGuide],
                      ] as const
                    ).map(([modeKey, label]) => (
                      <button
                        key={modeKey}
                        type="button"
                        className={s.filterPill}
                        aria-pressed={musicMode === modeKey}
                        onClick={() => setMusicMode(modeKey)}
                        data-compose-music-mode={modeKey}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <label className={s.sliderRow}>
                    <span className={s.sliderHead}>
                      <span>{interpolate(copy.musicGen.bpmLabel, { bpm: musicBpm })}</span>
                      <span className={s.monoValue}>{musicBpm} BPM</span>
                    </span>
                    <input
                      type="range"
                      className={s.rangeSlider}
                      min={60}
                      max={180}
                      value={musicBpm}
                      onChange={(e) => setMusicBpm(Number(e.target.value))}
                      data-compose-music-bpm
                    />
                  </label>

                  <p className={s.sectionLabel}>{copy.musicGen.styleLabel}</p>
                  <div className={s.presetGrid}>
                    {(['frenchHouse', 'ambientCello', 'marimbaPerc', 'warmSynth'] as const).map((styleKey) => (
                      <button
                        key={styleKey}
                        type="button"
                        className={s.presetPill}
                        aria-pressed={musicStyle === styleKey}
                        onClick={() => setMusicStyle(styleKey)}
                        data-compose-music-style={styleKey}
                      >
                        {copy.musicGen.styles[styleKey]}
                      </button>
                    ))}
                  </div>

                  <div className={s.audioRowHead}>
                    <button
                      type="button"
                      className={s.filterPill}
                      aria-pressed={musicDropSync}
                      onClick={() => {
                        const next = !musicDropSync;
                        setMusicDropSync(next);
                        if (next) {
                          setMusicRevealCustom(false);
                          setMusicRevealSec(suggestedDropSec);
                        }
                      }}
                      data-compose-music-dropsync
                    >
                      {copy.musicGen.dropSyncToggle}
                    </button>
                    {musicDropSync ? (
                      <button
                        type="button"
                        className={s.smallBtn}
                        onClick={() => {
                          setMusicRevealCustom(true);
                          setMusicRevealSec(suggestedDropSec);
                        }}
                        data-compose-sync-cut-btn
                      >
                        {interpolate(copy.musicGen.syncFromCutBtn, { seconds: suggestedDropSec })}
                      </button>
                    ) : null}
                  </div>

                  {musicDropSync ? (
                    <p className={s.monoValue} data-compose-music-drop-readout>
                      {interpolate(copy.musicGen.dropSyncAt, { seconds: musicRevealSec })}
                    </p>
                  ) : null}

                  <button
                    type="button"
                    className={s.smallDarkBtn}
                    disabled={!canCreate || musicBusy}
                    onClick={() => void handleGenerateMusic()}
                    data-compose-music-submit
                  >
                    {musicBusy
                      ? copy.musicGen.generatingBtn
                      : interpolate(copy.musicGen.generateBtn, {
                          credits: formatCredits(musicEstimateCredits, locale),
                        })}
                  </button>

                  {generatedMusic ? (
                    <div className={s.audioPreviewCard} data-compose-generated-music-card>
                      <p className={s.sourceName}>{generatedMusic.label}</p>
                      <audio
                        controls
                        className={s.audioPlayer}
                        src={generatedMusic.previewUrl}
                        data-compose-music-preview
                      />
                      <button
                        type="button"
                        className={s.smallDarkBtn}
                        disabled={!canCreate}
                        onClick={handlePlaceGeneratedMusicOnTimeline}
                        data-compose-apply-generated-bgm
                      >
                        {copy.musicGen.placeOnTimelineBtn}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* TAB 4: CAPTIONS */}
          {sourceTab === 'captions' ? (
            <div className={s.sourceSection}>
              <form className={s.captionItem} onSubmit={handleAddManualCaption}>
                <input
                  type="text"
                  className={s.textInput}
                  value={captionDraft}
                  onChange={(e) => setCaptionDraft(e.target.value)}
                  placeholder={copy.captions.placeholder}
                  maxLength={120}
                  data-compose-caption-input
                />
                <div className={s.trimGrid}>
                  <label className={s.field}>
                    <span>{copy.captions.position}</span>
                    <select
                      className={s.selectInput}
                      value={captionPos}
                      onChange={(e) => setCaptionPos(e.target.value as CaptionPosition)}
                    >
                      <option value="bottom">{copy.captions.posBottom}</option>
                      <option value="center">{copy.captions.posCenter}</option>
                      <option value="top">{copy.captions.posTop}</option>
                    </select>
                  </label>
                  <label className={s.field}>
                    <span>{copy.captions.size}</span>
                    <select
                      className={s.selectInput}
                      value={captionSize}
                      onChange={(e) => setCaptionSize(e.target.value as CaptionSize)}
                    >
                      <option value="sm">{copy.captions.sizeSm}</option>
                      <option value="md">{copy.captions.sizeMd}</option>
                      <option value="lg">{copy.captions.sizeLg}</option>
                    </select>
                  </label>
                </div>
                <button type="submit" className={s.smallBtn} disabled={!captionDraft.trim()} data-compose-caption-add>
                  {copy.captions.addButton}
                </button>
              </form>

              {project.captions.length > 0 ? (
                <div className={s.captionList}>
                  {project.captions.map((cap, idx) => (
                    <div key={cap.id} className={s.captionItem} data-compose-caption-row={idx}>
                      <input
                        type="text"
                        className={s.textInput}
                        value={cap.text}
                        onChange={(e) => applyPatches([{ op: 'update_caption', captionIndex: idx, text: e.target.value }])}
                      />
                      <div className={s.trimGrid}>
                        <label className={s.field}>
                          <span>{copy.captions.startSec}</span>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            className={s.numInput}
                            value={cap.startSec}
                            onChange={(e) =>
                              applyPatches([{ op: 'update_caption', captionIndex: idx, startSec: Number(e.target.value) }])
                            }
                          />
                        </label>
                        <label className={s.field}>
                          <span>{copy.captions.endSec}</span>
                          <input
                            type="number"
                            step="0.1"
                            min="0.3"
                            className={s.numInput}
                            value={cap.endSec}
                            onChange={(e) =>
                              applyPatches([{ op: 'update_caption', captionIndex: idx, endSec: Number(e.target.value) }])
                            }
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        className={s.smallBtn}
                        onClick={() => applyPatches([{ op: 'remove_caption', captionIndex: idx }])}
                      >
                        {copy.captions.remove}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={s.emptyNote}>{copy.captions.empty}</p>
              )}
            </div>
          ) : null}

          {/* TAB 5: DETAIL UPSCALE (`1080p` / `1440p` / `4K UHD`) */}
          {sourceTab === 'upscale' ? (
            <div className={s.sourceSection} data-compose-upscale-panel>
              <div className={s.toolCard}>
                <p className={s.sectionLabel}>{copy.upscale.heading}</p>
                <p className={s.leadNote}>{copy.upscale.lead}</p>

                <p className={s.sectionLabel}>{copy.upscale.resolutionLabel}</p>
                <div className={s.filterPillRow} role="group" aria-label={copy.upscale.resolutionLabel}>
                  {UPSCALE_RESOLUTIONS.map((res) => (
                    <button
                      key={res}
                      type="button"
                      className={s.filterPill}
                      aria-pressed={upscaleRes === res}
                      onClick={() => setUpscaleRes(res)}
                      data-compose-upscale-res={res}
                    >
                      {res === 1080
                        ? copy.upscale.res1080p
                        : res === 1440
                          ? copy.upscale.res1440p
                          : copy.upscale.res2160p}
                    </button>
                  ))}
                </div>

                <p className={s.sectionLabel}>{copy.upscale.scopeLabel}</p>
                <div className={s.filterPillRow} role="group" aria-label={copy.upscale.scopeLabel}>
                  {(
                    [
                      ['selected_clip', copy.upscale.scopeClip],
                      ['full_timeline', copy.upscale.scopeTimeline],
                    ] as const
                  ).map(([scopeKey, label]) => (
                    <button
                      key={scopeKey}
                      type="button"
                      className={s.filterPill}
                      aria-pressed={upscaleScope === scopeKey}
                      onClick={() => setUpscaleScope(scopeKey)}
                      data-compose-upscale-scope={scopeKey}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <p className={s.sectionLabel}>{copy.upscale.colorModeLabel}</p>
                <div className={s.filterPillRow} role="group" aria-label={copy.upscale.colorModeLabel}>
                  {(
                    [
                      ['lab', copy.upscale.colorLab],
                      ['wavelet', copy.upscale.colorWavelet],
                    ] as const
                  ).map(([modeKey, label]) => (
                    <button
                      key={modeKey}
                      type="button"
                      className={s.filterPill}
                      aria-pressed={upscaleColorMode === modeKey}
                      onClick={() => setUpscaleColorMode(modeKey)}
                      data-compose-upscale-color={modeKey}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {upscaleRes === 2160 && upscaleTargetDuration > 8 ? (
                  <p className={s.uploadHint} data-compose-upscale-split-note>
                    {interpolate(copy.upscale.splitSafetyNote, { cuts: upscaleShotCuts.length })}
                  </p>
                ) : null}

                <span className={s.creditBadge} data-compose-upscale-cost>
                  {interpolate(copy.upscale.costBadge, {
                    credits: formatCredits(upscaleEstimateCredits, locale),
                  })}
                </span>

                {upscalePollStatus ? (
                  <p className={s.uploadHint}>
                    {interpolate(copy.upscale.queuedNote, { status: upscalePollStatus })}
                  </p>
                ) : null}

                <button
                  type="button"
                  className={s.smallDarkBtn}
                  disabled={!canCreate || upscaleBusy || project.clips.length === 0}
                  onClick={() => void handleRunUpscale()}
                  data-compose-upscale-submit
                >
                  {upscaleBusy
                    ? copy.upscale.runningBtn
                    : interpolate(copy.upscale.runBtn, {
                        credits: formatCredits(upscaleEstimateCredits, locale),
                      })}
                </button>
              </div>
            </div>
          ) : null}
        </section>

        {/* -------------------------------------------------------- Center: Stage & Timeline */}
        <div className={s.centerColumn}>
          <section className={s.stageCard} data-compose-stage>
            <div className={s.stageToolbar} {...lockAttrs}>
              <div className={s.aspectGroup} role="group" aria-label={copy.aspects.label}>
                {COMPOSE_ASPECTS.map((aspect) => (
                  <button
                    key={aspect}
                    type="button"
                    className={s.aspectPill}
                    aria-pressed={shownProject.aspect === aspect}
                    onClick={() => applyPatches([{ op: 'set_aspect', aspect }])}
                    data-compose-aspect={aspect}
                  >
                    {aspectLabel(aspect)}
                  </button>
                ))}
              </div>
              {project.clips.length > 0 ? (
                <button
                  type="button"
                  className={s.smallBtn}
                  onClick={() => {
                    setPlaying(false);
                    setPlayheadSec(0);
                    commitProject(emptyComposerProject(project.aspect));
                  }}
                >
                  {copy.actions.clearAll}
                </button>
              ) : null}
            </div>

            <div className={s.viewportWell}>
              {shownProject.clips.length > 0 ? (
                <div
                  ref={frameShellRef}
                  className={s.frameShell}
                  data-aspect={shownProject.aspect}
                  data-compose-preview-frame
                >
                  <video
                    ref={previewVideoRef}
                    className={s.stageVideo}
                    playsInline
                    preload="auto"
                    style={
                      frameAtPlayhead.activeColorGrade &&
                      frameAtPlayhead.activeColorGrade.scope !== 'region' &&
                      liveCssFilter !== 'none'
                        ? { filter: liveCssFilter }
                        : undefined
                    }
                    data-grade-filter={
                      frameAtPlayhead.activeColorGrade && frameAtPlayhead.activeColorGrade.scope !== 'region'
                        ? liveCssFilter
                        : 'none'
                    }
                  />
                  <audio ref={previewAudioRef} hidden preload="auto" />

                  {shownProject.colorGrade?.enabled && currentGrade.scope === 'region' ? (
                    <div
                      className={s.regionMaskBox}
                      style={{
                        left: `${displayedRegion.x * 100}%`,
                        top: `${displayedRegion.y * 100}%`,
                        width: `${displayedRegion.w * 100}%`,
                        height: `${displayedRegion.h * 100}%`,
                        ...(frameAtPlayhead.activeColorGrade && liveCssFilter !== 'none'
                          ? {
                              backdropFilter: liveCssFilter,
                              WebkitBackdropFilter: liveCssFilter,
                            }
                          : {}),
                      }}
                      onPointerDown={handleRegionPointerDown}
                      onPointerMove={handleRegionPointerMove}
                      onPointerUp={handleRegionPointerUp}
                      onPointerCancel={handleRegionPointerUp}
                      data-compose-grade-region-box
                      data-grade-filter={liveCssFilter}
                      {...lockAttrs}
                    >
                      <span className={s.regionMaskTag}>
                        {Math.round(displayedRegion.x * 100)}%, {Math.round(displayedRegion.y * 100)}% ·{' '}
                        {Math.round(displayedRegion.w * 100)}×{Math.round(displayedRegion.h * 100)}%
                      </span>
                    </div>
                  ) : null}

                  {frameAtPlayhead.activeCaptions.map((cap) => (
                    <div key={cap.id} className={s.captionOverlay} data-pos={cap.position} data-compose-active-caption>
                      <span className={s.captionBubble} data-size={cap.size}>
                        {cap.text}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={s.emptyStage}>
                  <h2>{copy.stage.emptyTitle}</h2>
                  <p>{copy.stage.emptyBody}</p>
                </div>
              )}
            </div>

            <div className={s.transportBar}>
              <button
                type="button"
                className={s.smallBtn}
                disabled={project.clips.length === 0}
                onClick={() => setPlaying((p) => !p)}
                data-compose-play-toggle
              >
                {playing ? copy.stage.pause : copy.stage.play}
              </button>
              <button
                type="button"
                className={s.smallBtn}
                disabled={project.clips.length === 0}
                onClick={() => {
                  setPlaying(false);
                  setPlayheadSec(0);
                }}
              >
                {copy.stage.restart}
              </button>
              <div className={s.scrubberWrap}>
                <input
                  type="range"
                  className={s.scrubber}
                  min={0}
                  max={Math.max(0.1, totalSec)}
                  step={0.1}
                  value={Math.min(playheadSec, totalSec)}
                  disabled={project.clips.length === 0}
                  onChange={(e) => {
                    setPlaying(false);
                    setPlayheadSec(Number(e.target.value));
                  }}
                  aria-label={copy.timeline.heading}
                />
              </div>
              <span className={s.timecode}>
                {interpolate(copy.stage.timecode, {
                  current: playheadSec.toFixed(1),
                  total: totalSec.toFixed(1),
                })}
              </span>
            </div>
          </section>

          {assist.preview ? <AssistPreviewBar text={copy.assist.proposal.previewBar} /> : null}

          <section className={s.timelineCard} aria-label={copy.timeline.heading} data-compose-timeline>
            <div className={s.timelineToolbar}>
              <div className={s.timelineToolsLeft}>
                <h2 className={s.panelTitle}>{copy.timeline.heading}</h2>
                {shownProject.captions.length > 0 ? (
                  <span className={s.summaryBadge}>
                    {interpolate(copy.timeline.captionsTrack, { count: shownProject.captions.length })}
                  </span>
                ) : null}
                {detectedSplittableCuts.length > 0 ? (
                  <span className={s.summaryBadge} data-compose-detected-cuts-badge>
                    {interpolate(copy.timeline.detectedBadge, { count: detectedSplittableCuts.length })}
                  </span>
                ) : null}
              </div>

              <div className={s.timelineToolsRight} {...lockAttrs}>
                <button
                  type="button"
                  className={s.smallBtn}
                  disabled={!canCreate || !selectedClip || detectingCuts}
                  onClick={() => void handleDetectCuts()}
                  data-compose-detect-cuts
                >
                  {detectingCuts ? copy.timeline.detectingCuts : copy.timeline.detectCuts}
                </button>
                <button
                  type="button"
                  className={s.smallBtn}
                  disabled={!canCreate || project.clips.length === 0}
                  onClick={handlePlayheadSplit}
                  data-compose-split-playhead
                >
                  {copy.timeline.splitPlayhead}
                </button>
                {detectedSplittableCuts.length > 0 ? (
                  <button
                    type="button"
                    className={s.smallDarkBtn}
                    disabled={!canCreate}
                    onClick={handleApplyDetectedAutoCuts}
                    data-compose-apply-auto-cuts
                  >
                    {interpolate(copy.timeline.autoSplitDetected, {
                      count: detectedSplittableCuts.length + 1,
                    })}
                  </button>
                ) : null}
              </div>
            </div>

            {spans.length > 0 ? (
              <div className={s.clipStrip}>
                {spans.map(({ clip, index, timelineStartSec }) => {
                  const playDur = clipPlayDuration(clip);
                  const visibleTicks = (clip.cutMarkers ?? []).filter(
                    (m) => m > clip.trimStartSec && m < clip.trimEndSec,
                  );
                  return (
                    <div
                      key={clip.id}
                      className={s.clipBlock}
                      data-selected={safeSelectedIdx === index}
                      data-compose-clip-card={index}
                      data-assist-changed={assist.changedIds.has(clip.id) || undefined}
                      onClick={() => {
                        setSelectedClipIdx(index);
                        setPlaying(false);
                        setPlayheadSec(timelineStartSec);
                      }}
                    >
                      <div className={s.clipBlockHead}>
                        <span className={s.cutBadge}>{interpolate(copy.timeline.clipBadge, { n: index + 1 })}</span>
                        <div className={s.clipOrderBtns} onClick={(e) => e.stopPropagation()} {...lockAttrs}>
                          <button
                            type="button"
                            className={s.iconBtn}
                            aria-label={copy.timeline.moveLeft}
                            disabled={index === 0}
                            onClick={() => applyPatches([{ op: 'move_clip', fromIndex: index, toIndex: index - 1 }])}
                          >
                            ←
                          </button>
                          <button
                            type="button"
                            className={s.iconBtn}
                            aria-label={copy.timeline.moveRight}
                            disabled={index === spans.length - 1}
                            onClick={() => applyPatches([{ op: 'move_clip', fromIndex: index, toIndex: index + 1 }])}
                          >
                            →
                          </button>
                          <button
                            type="button"
                            className={s.iconBtn}
                            aria-label={copy.timeline.removeClip}
                            onClick={() => applyPatches([{ op: 'remove_clip', clipIndex: index }])}
                          >
                            ×
                          </button>
                        </div>
                      </div>

                      <p className={s.sourceName} title={clip.label}>
                        {clip.label}
                      </p>

                      {visibleTicks.length > 0 ? (
                        <div className={s.cutTickTrack} data-compose-cut-ticks={index}>
                          {visibleTicks.map((tick) => {
                            const leftPct = clamp(((tick - clip.trimStartSec) / playDur) * 100, 2, 98);
                            return (
                              <span
                                key={tick}
                                className={s.cutTickMark}
                                style={{ left: `${leftPct}%` }}
                                title={`${tick}s`}
                                data-compose-cut-tick={tick}
                              />
                            );
                          })}
                        </div>
                      ) : null}

                      <div className={s.trimGrid} onClick={(e) => e.stopPropagation()} {...lockAttrs}>
                        <label className={s.field}>
                          <span>{copy.timeline.trimStart}</span>
                          <input
                            type="number"
                            step="0.1"
                            min={0}
                            max={Math.max(0, roundTenths(clip.trimEndSec - 0.3))}
                            className={s.numInput}
                            value={clip.trimStartSec}
                            onChange={(e) =>
                              applyPatches([{ op: 'trim_clip', clipIndex: index, trimStartSec: Number(e.target.value) }])
                            }
                            data-compose-trim-start={index}
                          />
                        </label>
                        <label className={s.field}>
                          <span>{copy.timeline.trimEnd}</span>
                          <input
                            type="number"
                            step="0.1"
                            min={roundTenths(clip.trimStartSec + 0.3)}
                            max={clip.durationSec}
                            className={s.numInput}
                            value={clip.trimEndSec}
                            onChange={(e) =>
                              applyPatches([{ op: 'trim_clip', clipIndex: index, trimEndSec: Number(e.target.value) }])
                            }
                            data-compose-trim-end={index}
                          />
                        </label>
                      </div>

                      <div className={s.clipFoot} onClick={(e) => e.stopPropagation()}>
                        <span>{interpolate(copy.timeline.clipLength, { seconds: playDur })}</span>
                        <button
                          type="button"
                          className={s.smallBtn}
                          onClick={() =>
                            applyPatches([{ op: 'set_clip_audio', clipIndex: index, muted: !clip.muted }])
                          }
                          {...lockAttrs}
                        >
                          {clip.muted ? copy.timeline.clipMuted : copy.timeline.clipSoundOn}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className={s.emptyNote}>{copy.emptySummary}</p>
            )}

            {shownProject.bgm ? (
              <div className={s.bgmStrip} data-compose-bgm-strip>
                <div className={s.bgmMetaGroup}>
                  <strong>
                    {copy.timeline.bgmLabel}: {shownProject.bgm.label}
                  </strong>
                  {shownProject.bgm.nonCommercialGuide ? (
                    <span className={s.summaryBadge}>CC BY-NC 4.0</span>
                  ) : null}
                </div>
                <label className={s.headerActions} {...lockAttrs}>
                  <span>{copy.timeline.bgmVolume}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(shownProject.bgm.volume * 100)}
                    onChange={(e) =>
                      applyPatches([{ op: 'set_bgm_volume', volume: Number(e.target.value) / 100 }])
                    }
                    data-compose-bgm-volume
                  />
                  <span className={s.monoValue}>{Math.round(shownProject.bgm.volume * 100)}%</span>
                </label>
                <button
                  type="button"
                  className={s.smallBtn}
                  onClick={() => applyPatches([{ op: 'remove_bgm' }])}
                  {...lockAttrs}
                >
                  {copy.timeline.removeBgm}
                </button>
              </div>
            ) : null}
          </section>
        </div>

        {/* -------------------------------------------------------- Right: "말로 편집" (flag) or the chat editor */}
        {editAssist ? (
          <AssistPanel assist={assist} copy={copy} canCreate={canCreate} project={project} />
        ) : (
          <aside className={s.panel} aria-label={copy.chat.heading} data-compose-chat>
            <div className={s.panelHead}>
              <h2 className={s.panelTitle}>{copy.chat.heading}</h2>
            </div>
            <p className={s.chatLead}>{copy.chat.lead}</p>

            <div className={s.sourceSection}>
              <p className={s.sectionLabel}>{copy.chat.examplesLabel}</p>
              <div className={s.exampleChips}>
                {(
                  [
                    copy.chat.examples.autoCut,
                    copy.chat.examples.colorGrade,
                    copy.chat.examples.trim,
                    copy.chat.examples.caption,
                    copy.chat.examples.swap,
                    copy.chat.examples.bgm,
                  ] as const
                ).map((example) => (
                  <button
                    key={example}
                    type="button"
                    className={s.exampleChip}
                    disabled={!canCreate || chatBusy}
                    onClick={() => void runChatInstruction(example)}
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>

            <div className={s.chatLog} role="log" aria-live="polite" data-compose-chat-log>
              {chatMessages.map((msg) => (
                <div key={msg.id} className={s.chatBubble} data-role={msg.role}>
                  {msg.text}
                </div>
              ))}
            </div>

            <form
              className={s.chatForm}
              onSubmit={(e) => {
                e.preventDefault();
                void runChatInstruction(chatInput);
              }}
            >
              <textarea
                className={s.chatInput}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={copy.chat.placeholder}
                rows={2}
                disabled={!canCreate}
                data-compose-chat-input
              />
              <button
                type="submit"
                className={s.chatApplyBtn}
                disabled={!canCreate || !chatInput.trim() || chatBusy}
                data-compose-chat-send
              >
                {chatBusy ? copy.chat.running : copy.chat.send}
              </button>
            </form>

            <p className={s.chatRateHint} data-compose-chat-policy>
              {copy.credits.chatFreeNotice}
            </p>
          </aside>
        )}
      </div>

      {shareReviewTarget ? (
        <ShareReviewDialog
          target={shareReviewTarget}
          locale={locale}
          onClose={() => setShareReviewTarget(null)}
        />
      ) : null}
    </div>
  );
}
