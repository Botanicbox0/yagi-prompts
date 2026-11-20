'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fill } from '@/components/brand-studio/copy';
import {
  COMPOSE_DIMENSIONS,
  MAX_COMPOSE_CLIPS,
  frameStateAtTime,
  playheadClipSplitTarget,
  timelineSpans,
  type CaptionPosition,
  type ComposeAspect,
  type TimelinePatch,
} from '@/lib/brand-studio/compose/timeline';
import {
  FIXTURE_MATERIALS,
  FIXTURE_MEASURED_LUFS,
  FIXTURE_REFERENCES,
  FIXTURE_SPEECH,
  fixtureDoc,
  materialBySrc,
  type FixtureMaterial,
} from '@/lib/brand-studio/editor-v2/fixture';
import {
  DEFAULT_REFRAME,
  LOOK_DETAILS,
  NEUTRAL_DETAIL,
  PLATFORM_LUFS,
  applyDocPatches,
  balanceLooks,
  captionFindings,
  colorFindings,
  commit,
  filmTarget,
  interpretUtterance,
  redo as redoHistory,
  scopeClipIds,
  settleScope,
  soundFindings,
  statsFromPixels,
  undo as undoHistory,
  type AssistIntent,
  type CaptionSettings,
  type ClipLook,
  type EditorDoc,
  type EditorHistory,
  type EditorWorkspace,
  type FrameStats,
  type GradeDetail,
  type LookId,
  type MusicTrack,
  type Reframe,
  type ScopeMode,
  type SoundState,
  type TitlePreset,
} from '@/lib/brand-studio/editor-v2/model';
import type { StudioEditorCopy } from '@/messages/studio-editor';

export const ASPECT_KEYS: Readonly<Record<ComposeAspect, keyof StudioEditorCopy['aspectNames']>> = {
  '16:9': 'r16x9',
  '9:16': 'r9x16',
  '1:1': 'r1x1',
  '4:5': 'r4x5',
};

export interface Proposal {
  key: number;
  utterance: string;
  lines: string[];
  run: (() => void) | null;
  note: string | null;
}

export interface EditorTabs {
  cut: 'clips' | 'titles';
  color: 'looks' | 'references';
}

interface Stored {
  doc: EditorDoc;
  history: EditorHistory;
}

function loadStats(src: string): Promise<FrameStats | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 18;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return resolve(null);
        context.drawImage(image, 0, 0, 32, 18);
        resolve(statsFromPixels(context.getImageData(0, 0, 32, 18).data));
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

export function useEditor(copy: StudioEditorCopy) {
  const labelOf = useCallback(
    (materialId: string) => fill(copy.cut.materials.clipLabel, { number: materialId.replace(/\D/g, '') }),
    [copy],
  );
  const [stored, setStored] = useState<Stored>(() => ({ doc: fixtureDoc(labelOf), history: { past: [], future: [] } }));
  const { doc, history } = stored;
  const [workspace, setWorkspace] = useState<EditorWorkspace>('cut');
  const [selection, setSelection] = useState<string[]>([]);
  const [selectedTitleId, setSelectedTitleId] = useState<string | null>(null);
  const [scopeMode, setScopeMode] = useState<ScopeMode>('all');
  const [playheadSec, setPlayheadSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [compare, setCompare] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [assistDock, setAssistDock] = useState<'bar' | 'side'>('bar');
  const [exportOpen, setExportOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [captionsBusy, setCaptionsBusy] = useState(false);
  const [stats, setStats] = useState<Record<string, FrameStats>>({});
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [tabs, setTabs] = useState<EditorTabs>({ cut: 'clips', color: 'looks' });
  const setTab = useCallback(<K extends keyof EditorTabs>(key: K, value: EditorTabs[K]) => setTabs((current) => ({ ...current, [key]: value })), []);
  const proposalKey = useRef(0);
  const lastChange = useRef<{ key: string; at: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Frame averages of every material and reference: what the colour outcomes compute from. On the device.
  useEffect(() => {
    let alive = true;
    const sources: Array<[string, string]> = [
      ...FIXTURE_MATERIALS.map((material): [string, string] => [material.src, material.poster]),
      ...FIXTURE_REFERENCES.map((reference): [string, string] => [reference.src, reference.src]),
    ];
    void Promise.all(sources.map(async ([key, poster]) => [key, await loadStats(poster)] as const)).then((entries) => {
      if (!alive) return;
      const next: Record<string, FrameStats> = {};
      for (const [key, value] of entries) if (value) next[key] = value;
      setStats(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const say = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const project = doc.project;
  const spans = useMemo(() => timelineSpans(project), [project]);
  const durationSec = spans.length > 0 ? spans[spans.length - 1]!.timelineEndSec : 0;
  const frame = useMemo(() => frameStateAtTime(project, playheadSec), [project, playheadSec]);
  const activeClip = frame.activeClip;
  const settled = useMemo(() => settleScope(project, scopeMode, selection), [project, scopeMode, selection]);
  const targetIds = useMemo(
    () => scopeClipIds(project, settled.mode, settled.selection, playheadSec),
    [project, settled, playheadSec],
  );

  /**
   * One undo step: `mutate` returns the next document, or `null` when nothing changes. A slider passes
   * `coalesce` so one drag is one step, not one per pixel.
   */
  const change = useCallback((mutate: (current: EditorDoc) => EditorDoc | null, coalesce?: string) => {
    const now = Date.now();
    const merge = !!coalesce && lastChange.current?.key === coalesce && now - lastChange.current.at < 900;
    lastChange.current = coalesce ? { key: coalesce, at: now } : null;
    setStored((current) => {
      const next = mutate(current.doc);
      if (!next || next === current.doc) return current;
      return { doc: next, history: merge ? current.history : commit(current.history, current.doc) };
    });
  }, []);

  const patch = useCallback(
    (patches: readonly TimelinePatch[], coalesce?: string) => {
      change((current) => {
        const result = applyDocPatches(current, patches);
        return result.appliedCount > 0 ? result.doc : null;
      }, coalesce);
    },
    [change],
  );

  const undo = useCallback(() => {
    setStored((current) => {
      const result = undoHistory(current.history, current.doc);
      return result ? { doc: result.doc, history: result.history } : current;
    });
  }, []);
  const redo = useCallback(() => {
    setStored((current) => {
      const result = redoHistory(current.history, current.doc);
      return result ? { doc: result.doc, history: result.history } : current;
    });
  }, []);

  const seek = useCallback(
    (sec: number) => setPlayheadSec(Math.min(Math.max(0, Math.round(sec * 100) / 100), durationSec)),
    [durationSec],
  );

  const select = useCallback((clipId: string, additive: boolean) => {
    setSelectedTitleId(null);
    setSelection((current) => {
      if (!additive) return current.length === 1 && current[0] === clipId ? [] : [clipId];
      return current.includes(clipId) ? current.filter((id) => id !== clipId) : [...current, clipId];
    });
    setScopeMode('selected');
  }, []);
  const clearSelection = useCallback(() => {
    setSelection([]);
    setSelectedTitleId(null);
    setScopeMode((mode) => (mode === 'selected' ? 'all' : mode));
  }, []);

  // ── Cut ──
  const splitAtPlayhead = useCallback(() => {
    const target = playheadClipSplitTarget(project, playheadSec);
    if (!target) return say(copy.toast.splitNo);
    if (project.clips.length >= MAX_COMPOSE_CLIPS) return say(copy.toast.full);
    patch([{ op: 'split_clip_at', clipIndex: target.clipIndex, atMediaSec: target.atMediaSec }]);
  }, [project, playheadSec, patch, say, copy]);

  const trimToPlayhead = useCallback(
    (edge: 'start' | 'end') => {
      if (!activeClip) return;
      const at = Math.round(activeClip.mediaTimeSec * 10) / 10;
      patch([{ op: 'trim_clip', clipIndex: activeClip.index, ...(edge === 'start' ? { trimStartSec: at } : { trimEndSec: at }) }]);
      if (edge === 'start') seek(spans[activeClip.index]?.timelineStartSec ?? 0);
    },
    [activeClip, patch, seek, spans],
  );

  const removeClips = useCallback(
    (ids: readonly string[]) => {
      const indexes = project.clips.map((clip, index) => (ids.includes(clip.id) ? index : -1)).filter((index) => index >= 0);
      if (indexes.length === 0) return;
      if (indexes.length >= project.clips.length) return say(copy.toast.lastCut);
      patch(indexes.reverse().map((clipIndex): TimelinePatch => ({ op: 'remove_clip', clipIndex })));
      setSelection([]);
    },
    [project, patch, say, copy],
  );

  const addMaterial = useCallback(
    (material: FixtureMaterial) => {
      if (project.clips.length >= MAX_COMPOSE_CLIPS) return say(copy.toast.full);
      change((current) => ({
        ...current,
        project: {
          ...current.project,
          clips: [
            ...current.project.clips,
            {
              id: `cut-${Date.now().toString(36)}`,
              label: labelOf(material.id),
              sourceKind: 'local',
              srcUrl: material.src,
              thumbUrl: material.poster,
              durationSec: material.durationSec,
              trimStartSec: 0,
              trimEndSec: Math.min(material.durationSec, 5),
              volume: 1,
              muted: false,
            },
          ],
        },
      }));
    },
    [project, change, say, copy, labelOf],
  );

  const setReframe = useCallback(
    (ids: readonly string[], next: Partial<Reframe>) => {
      change((current) => {
        const reframe = { ...current.reframe };
        for (const id of ids) reframe[id] = { ...(reframe[id] ?? DEFAULT_REFRAME), ...next };
        return { ...current, reframe };
      }, next.x !== undefined ? 'reframe' : undefined);
    },
    [change],
  );

  const frameRatio = COMPOSE_DIMENSIONS[project.aspect].width / COMPOSE_DIMENSIONS[project.aspect].height;
  const croppedIds = useMemo(
    () =>
      project.clips
        .filter((clip) => {
          const material = materialBySrc(clip.srcUrl);
          return !!material && material.ratio > frameRatio * 1.2 && !doc.reframe[clip.id];
        })
        .map((clip) => clip.id),
    [project, frameRatio, doc.reframe],
  );
  const centerOnSubject = useCallback(() => {
    change((current) => {
      const reframe = { ...current.reframe };
      for (const clip of current.project.clips) {
        if (!croppedIds.includes(clip.id)) continue;
        reframe[clip.id] = { fit: 'fill', x: materialBySrc(clip.srcUrl)?.focusX ?? 50 };
      }
      return { ...current, reframe };
    });
  }, [change, croppedIds]);

  const addTitle = useCallback(
    (preset: TitlePreset) => {
      const text = preset === 'big' ? copy.cut.titles.bigText : preset === 'lower' ? copy.cut.titles.lowerText : copy.cut.titles.endText;
      const startSec = preset === 'end' ? Math.max(0, durationSec - 2.5) : Math.min(playheadSec, Math.max(0, durationSec - 1));
      const id = `title-${Date.now().toString(36)}`;
      change((current) => ({
        ...current,
        titles: [...current.titles, { id, text, preset, startSec, endSec: Math.min(durationSec, startSec + 2.5) }],
      }));
      setSelection([]);
      setSelectedTitleId(id);
    },
    [change, copy, durationSec, playheadSec],
  );
  const updateTitle = useCallback(
    (id: string, text: string) => change((current) => ({ ...current, titles: current.titles.map((t) => (t.id === id ? { ...t, text } : t)) }), 'title'),
    [change],
  );
  const removeTitle = useCallback(
    (id: string) => {
      change((current) => ({ ...current, titles: current.titles.filter((t) => t.id !== id) }));
      setSelectedTitleId(null);
    },
    [change],
  );

  // ── Colour ──
  const setLooks = useCallback(
    (looks: Record<string, ClipLook | null>) => {
      change((current) => {
        const next = { ...current.looks };
        for (const [id, look] of Object.entries(looks)) {
          if (look) next[id] = look;
          else delete next[id];
        }
        return { ...current, looks: next };
      });
    },
    [change],
  );

  const filmStats = useMemo(
    () => project.clips.map((clip) => stats[clip.srcUrl]).filter((value): value is FrameStats => !!value),
    [project, stats],
  );
  const applyAuto = useCallback(
    (ids: readonly string[] = targetIds) => setLooks(balanceLooks(project, ids, stats, filmTarget(filmStats), 'auto')),
    [project, targetIds, stats, filmStats, setLooks],
  );
  const applyMatch = useCallback(
    (referenceKey: string, label: string, ids: readonly string[] = targetIds) => {
      const target = stats[referenceKey];
      if (!target) return;
      setLooks(balanceLooks(project, ids, stats, target, 'match', label));
    },
    [project, targetIds, stats, setLooks],
  );
  const applyLook = useCallback(
    (lookId: LookId) => {
      const looks: Record<string, ClipLook> = {};
      for (const id of targetIds) looks[id] = { source: 'look', lookId, detail: LOOK_DETAILS[lookId], strength: 0.85 };
      setLooks(looks);
    },
    [targetIds, setLooks],
  );
  const adjustLook = useCallback(
    (next: { strength?: number; detail?: Partial<GradeDetail> }) => {
      change((current) => {
        const looks = { ...current.looks };
        for (const id of targetIds) {
          const base = looks[id] ?? { source: 'manual' as const, detail: NEUTRAL_DETAIL, strength: 1 };
          looks[id] = {
            ...base,
            ...(next.detail ? { source: base.source === 'look' || base.source === 'manual' ? base.source : 'manual', detail: { ...base.detail, ...next.detail } } : {}),
            ...(next.strength !== undefined ? { strength: next.strength } : {}),
          };
        }
        return { ...current, looks };
      }, 'look');
    },
    [change, targetIds],
  );
  const resetLook = useCallback(() => {
    const looks: Record<string, null> = {};
    for (const id of targetIds) looks[id] = null;
    setLooks(looks);
  }, [targetIds, setLooks]);

  // ── Sound ──
  const setSound = useCallback(
    (next: Partial<SoundState>) =>
      change((current) => ({ ...current, sound: { ...current.sound, ...next } }), next.musicVolume !== undefined ? 'music-volume' : undefined),
    [change],
  );
  const setMusic = useCallback((track: MusicTrack | null) => change((current) => ({ ...current, music: track })), [change]);

  // ── Captions ──
  const transcript = useMemo(
    () => [copy.captions.transcript.l1, copy.captions.transcript.l2, copy.captions.transcript.l3],
    [copy],
  );
  const captionPatches = useMemo(
    () =>
      FIXTURE_SPEECH.map((region, index): TimelinePatch => ({
        op: 'add_caption',
        text: transcript[index] ?? '',
        startSec: region.startSec,
        endSec: Math.min(region.endSec, Math.max(durationSec, 1)),
        position: 'bottom',
        size: 'md',
      })).filter((entry) => entry.op === 'add_caption' && (entry.startSec ?? 0) < durationSec),
    [transcript, durationSec],
  );
  const makeCaptions = useCallback(
    (immediate = false) => {
      if (project.captions.length > 0 || captionsBusy) return;
      const run = () => {
        patch(captionPatches);
        setCaptionsBusy(false);
        say(fill(copy.captions.made, { count: captionPatches.length }));
      };
      if (immediate) return run();
      setCaptionsBusy(true);
      setTimeout(run, 1400);
    },
    [project, captionsBusy, patch, captionPatches, say, copy],
  );
  const setCaptionSettings = useCallback(
    (next: Partial<CaptionSettings>) => change((current) => ({ ...current, captionSettings: { ...current.captionSettings, ...next } })),
    [change],
  );
  const setCaptionPosition = useCallback(
    (position: CaptionPosition) =>
      patch(project.captions.map((_, captionIndex): TimelinePatch => ({ op: 'update_caption', captionIndex, position }))),
    [project, patch],
  );

  // ── Findings: what each workspace says before anyone touches a control ──
  const findings = useMemo(
    () => ({
      color: colorFindings(project, stats, doc.looks),
      sound: soundFindings(doc, FIXTURE_MEASURED_LUFS, FIXTURE_SPEECH),
      captions: captionFindings(doc, FIXTURE_SPEECH),
      croppedIds,
    }),
    [project, stats, doc, croppedIds],
  );
  const openCount: Record<EditorWorkspace, number> = {
    cut: croppedIds.length > 0 ? 1 : 0,
    color: findings.color.length,
    sound: findings.sound.filter((finding) => finding.kind !== 'no_music').length,
    captions: findings.captions.length,
  };

  // ── Words → the same actions the buttons run ──
  const propose = useCallback(
    (utterance: string) => {
      const intent: AssistIntent | null = interpretUtterance(utterance);
      proposalKey.current += 1;
      const base = { key: proposalKey.current, utterance };
      if (!intent) return setProposal({ ...base, lines: [], run: null, note: copy.assist.unknown });
      const none = () => setProposal({ ...base, lines: [], run: null, note: copy.assist.nothing });
      const lines = copy.assist.lines;
      const all = project.clips.map((clip) => clip.id);
      switch (intent.kind) {
        case 'aspect':
          if (intent.aspect === project.aspect) return none();
          return setProposal({
            ...base,
            note: null,
            lines: [fill(lines.aspect, { aspect: copy.aspectNames[ASPECT_KEYS[intent.aspect]] })],
            run: () => patch([{ op: 'set_aspect', aspect: intent.aspect }]),
          });
        case 'trim': {
          const clip = project.clips[intent.clipNumber - 1];
          if (!clip) return none();
          return setProposal({
            ...base,
            note: null,
            lines: [fill(lines.trim, { number: intent.clipNumber, seconds: intent.seconds })],
            run: () => patch([{ op: 'trim_clip', clipIndex: intent.clipNumber - 1, targetDurationSec: intent.seconds }]),
          });
        }
        case 'remove_last':
          if (project.clips.length < 2) return none();
          return setProposal({
            ...base,
            note: null,
            lines: [fill(lines.removeLast, { number: project.clips.length })],
            run: () => patch([{ op: 'remove_clip', clipIndex: project.clips.length - 1 }]),
          });
        case 'auto_balance':
          return setProposal({ ...base, note: null, lines: [fill(lines.autoBalance, { count: all.length })], run: () => applyAuto(all) });
        case 'match_first': {
          const first = project.clips[0];
          if (!first || all.length < 2) return none();
          return setProposal({
            ...base,
            note: null,
            lines: [fill(lines.matchFirst, { count: all.length - 1 })],
            run: () => applyMatch(first.srcUrl, fill(copy.panel.cut, { number: 1 }), all.slice(1)),
          });
        }
        case 'duck':
          if (!doc.music || doc.sound.duck) return none();
          return setProposal({ ...base, note: null, lines: [fill(lines.duck, { count: FIXTURE_SPEECH.length })], run: () => setSound({ duck: 'medium' }) });
        case 'loudness':
          if (doc.sound.loudness) return none();
          return setProposal({ ...base, note: null, lines: [fill(lines.loudness, { target: PLATFORM_LUFS })], run: () => setSound({ loudness: true }) });
        case 'speech_clear':
          if (doc.sound.speechClear) return none();
          return setProposal({ ...base, note: null, lines: [lines.speech], run: () => setSound({ speechClear: true }) });
        case 'make_captions':
          if (project.captions.length > 0) return none();
          return setProposal({ ...base, note: null, lines: [fill(lines.makeCaptions, { count: captionPatches.length })], run: () => makeCaptions(true) });
        case 'lift_captions':
          if (project.captions.length === 0 || doc.captionSettings.lift) return none();
          return setProposal({ ...base, note: null, lines: [lines.lift], run: () => setCaptionSettings({ lift: true }) });
      }
    },
    [copy, project, doc, patch, applyAuto, applyMatch, setSound, makeCaptions, setCaptionSettings, captionPatches],
  );

  return {
    copy,
    doc,
    project,
    spans,
    durationSec,
    frame,
    activeClip,
    stats,
    findings,
    openCount,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo,
    redo,
    change,
    patch,
    tabs,
    setTab,
    workspace,
    setWorkspace,
    selection: settled.selection,
    selectedTitleId,
    setSelectedTitleId,
    select,
    clearSelection,
    scopeMode: settled.mode,
    setScopeMode,
    targetIds,
    playheadSec,
    seek,
    playing,
    setPlaying,
    compare,
    setCompare,
    zoom,
    setZoom,
    assistDock,
    setAssistDock,
    exportOpen,
    setExportOpen,
    toast,
    say,
    captionsBusy,
    proposal,
    setProposal,
    propose,
    splitAtPlayhead,
    trimToPlayhead,
    removeClips,
    addMaterial,
    setReframe,
    centerOnSubject,
    addTitle,
    updateTitle,
    removeTitle,
    applyAuto,
    applyMatch,
    applyLook,
    adjustLook,
    resetLook,
    setSound,
    setMusic,
    makeCaptions,
    setCaptionSettings,
    setCaptionPosition,
  };
}

export type EditorApi = ReturnType<typeof useEditor>;
