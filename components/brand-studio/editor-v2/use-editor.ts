'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fill } from '@/components/brand-studio/copy';
import { COMPOSE_DIMENSIONS, MAX_COMPOSE_CLIPS, type CaptionPosition, type ComposeAspect } from '@/lib/brand-studio/compose/timeline';
import {
  FIXTURE_MATERIALS,
  FIXTURE_MEASURED_LUFS,
  FIXTURE_REFERENCES,
  FIXTURE_SPEECH,
  clipOfMaterial,
  fixtureDoc,
  materialBySrc,
  type FixtureMaterial,
} from '@/lib/brand-studio/editor-v2/fixture';
import {
  addCaption,
  frameStateAt,
  insertClips,
  moveClip as moveClipInSequence,
  neighbourCut,
  removeCaption as removeCaptionFromSequence,
  removeClips as removeClipsFromSequence,
  setAspect as setSequenceAspect,
  setClipAudio as setSequenceClipAudio,
  setClipSpeed as setSequenceClipSpeed,
  spansOf,
  splitAtFrame,
  totalFrames,
  trimClipEdge,
  updateCaption as updateSequenceCaption,
  type FrameCaption,
  type FrameClip,
  type FrameSequence,
} from '@/lib/brand-studio/editor-v2/frames';
import {
  DEFAULT_REFRAME,
  LOOK_DETAILS,
  NEUTRAL_DETAIL,
  PLATFORM_LUFS,
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
  withSequence,
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
import {
  DEFAULT_SHORTCUT_PREFS,
  effectiveBindings,
  type ShortcutAction,
  type ShortcutPrefs,
} from '@/lib/brand-studio/editor-v2/shortcuts';
import type { StudioEditorCopy } from '@/messages/studio-editor';
import { loadShortcutPrefs, saveShortcutPrefs } from './shortcut-store';

export const ASPECT_KEYS: Readonly<Record<ComposeAspect, keyof StudioEditorCopy['aspectNames']>> = {
  '16:9': 'r16x9',
  '9:16': 'r9x16',
  '1:1': 'r1x1',
  '4:5': 'r4x5',
};

/** Speeds offered in the cut panel, as fractions so a retimed cut still cuts on whole frames. */
export const SPEEDS: ReadonlyArray<{ label: string; num: number; den: number }> = [
  { label: '0.5×', num: 1, den: 2 },
  { label: '1×', num: 1, den: 1 },
  { label: '1.5×', num: 3, den: 2 },
  { label: '2×', num: 2, den: 1 },
];

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

/** A request to the timeline, which owns the zoom because it knows its own width. */
export interface ZoomCommand {
  kind: 'in' | 'out' | 'fit' | 'frames';
  n: number;
}

interface Stored {
  doc: EditorDoc;
  history: EditorHistory;
}

interface Clipboard {
  clips: FrameClip[];
  looks: Record<string, ClipLook>;
  reframe: Record<string, Reframe>;
}

let idCounter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(idCounter += 1).toString(36)}`;

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
    (materialId: string) => (materialId === 'm7' ? copy.cut.materials.frameClip : fill(copy.cut.materials.clipLabel, { number: materialId.replace(/\D/g, '') })),
    [copy],
  );
  const [stored, setStored] = useState<Stored>(() => ({ doc: fixtureDoc(labelOf), history: { past: [], future: [] } }));
  const { doc, history } = stored;
  const [workspace, setWorkspace] = useState<EditorWorkspace>('cut');
  const [selection, setSelection] = useState<string[]>([]);
  const [selectedTitleId, setSelectedTitleId] = useState<string | null>(null);
  const [scopeMode, setScopeMode] = useState<ScopeMode>('all');
  const [playhead, setPlayhead] = useState(0);
  /** `0` stopped, `1` playing; `2`/`4` and the negatives are the shuttle (J · K · L). */
  const [rate, setRate] = useState(0);
  const [compare, setCompare] = useState(false);
  const [magnet, setMagnet] = useState(true);
  const [zoomCommand, setZoomCommand] = useState<ZoomCommand>({ kind: 'fit', n: 0 });
  const [assistDock, setAssistDock] = useState<'bar' | 'side'>('bar');
  const [exportOpen, setExportOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [shortcutPrefs, setShortcutPrefsState] = useState<ShortcutPrefs>(DEFAULT_SHORTCUT_PREFS);
  const [mac, setMac] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [captionsBusy, setCaptionsBusy] = useState(false);
  const [stats, setStats] = useState<Record<string, FrameStats>>({});
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [tabs, setTabs] = useState<EditorTabs>({ cut: 'clips', color: 'looks' });
  const setTab = useCallback(<K extends keyof EditorTabs>(key: K, value: EditorTabs[K]) => setTabs((current) => ({ ...current, [key]: value })), []);
  const proposalKey = useRef(0);
  const lastChange = useRef<{ key: string; at: number } | null>(null);
  const clipboard = useRef<Clipboard | null>(null);
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

  // A person's keys and their keyboard's modifier, read after mount so the first paint matches the server.
  useEffect(() => {
    setShortcutPrefsState(loadShortcutPrefs());
    setMac(/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent));
  }, []);
  const setShortcutPrefs = useCallback((next: ShortcutPrefs) => {
    setShortcutPrefsState(next);
    saveShortcutPrefs(next);
  }, []);
  const shortcutMap = useMemo(() => effectiveBindings(shortcutPrefs), [shortcutPrefs]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const say = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const sequence = doc.sequence;
  const fps = sequence.fps;
  const spans = useMemo(() => spansOf(sequence), [sequence]);
  const total = useMemo(() => totalFrames(sequence), [sequence]);
  const lastFrame = Math.max(0, total - 1);
  const frame = useMemo(() => frameStateAt(sequence, playhead), [sequence, playhead]);
  const activeClip = frame.active;
  const durationSec = total / fps;
  const playheadSec = frame.frame / fps;
  const settled = useMemo(() => settleScope(sequence, scopeMode, selection), [sequence, scopeMode, selection]);
  const targetIds = useMemo(() => scopeClipIds(sequence, settled.mode, settled.selection, playhead), [sequence, settled, playhead]);

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

  /** A change to the cuts. `inherit` pairs each new cut with the cut whose look and framing it keeps. */
  const edit = useCallback(
    (mutate: (current: FrameSequence) => FrameSequence, inherit?: ReadonlyArray<readonly [string, string]>, coalesce?: string) =>
      change((current) => withSequence(current, mutate(current.sequence), inherit), coalesce),
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

  // ── Moving through the film: always on a whole frame ──
  const seek = useCallback((target: number) => setPlayhead(Math.min(Math.max(0, Math.round(target)), lastFrame)), [lastFrame]);
  const step = useCallback(
    (frames: number) => {
      setRate(0);
      setPlayhead((current) => Math.min(Math.max(0, current + frames), lastFrame));
    },
    [lastFrame],
  );
  const toCut = useCallback(
    (direction: -1 | 1) => {
      setRate(0);
      setPlayhead((current) => neighbourCut(sequence, current, direction));
    },
    [sequence],
  );
  const setPlaying = useCallback((on: boolean) => setRate(on ? 1 : 0), []);
  const shuttle = useCallback((direction: -1 | 0 | 1) => {
    setRate((current) => {
      if (direction === 0) return 0;
      if (direction === 1) return current > 0 ? Math.min(4, current * 2) : 1;
      return current < 0 ? Math.max(-4, current * 2) : -1;
    });
  }, []);
  const zoom = useCallback((kind: ZoomCommand['kind']) => setZoomCommand((current) => ({ kind, n: current.n + 1 })), []);

  const select = useCallback((clipId: string, additive: boolean) => {
    setSelectedTitleId(null);
    setSelection((current) => {
      if (!additive) return current.length === 1 && current[0] === clipId ? [] : [clipId];
      return current.includes(clipId) ? current.filter((id) => id !== clipId) : [...current, clipId];
    });
    setScopeMode('selected');
  }, []);
  const selectAll = useCallback(() => {
    setSelectedTitleId(null);
    setSelection(sequence.clips.map((clip) => clip.id));
    setScopeMode('selected');
  }, [sequence]);
  const clearSelection = useCallback(() => {
    setSelection([]);
    setSelectedTitleId(null);
    setScopeMode((mode) => (mode === 'selected' ? 'all' : mode));
  }, []);

  // ── Cut ──
  const splitAtPlayhead = useCallback(() => {
    if (sequence.clips.length >= MAX_COMPOSE_CLIPS) return say(copy.toast.full);
    const parent = frameStateAt(sequence, playhead).active;
    if (!parent || parent.offset === 0) return say(copy.toast.splitNo);
    const id = newId('cut');
    edit((current) => splitAtFrame(current, playhead, id), [[id, parent.clip.id]]);
  }, [sequence, playhead, edit, say, copy]);

  const trimToPlayhead = useCallback(
    (edge: 'start' | 'end') => {
      const active = frameStateAt(sequence, playhead).active;
      if (!active || active.offset === 0) return;
      if (edge === 'start') {
        edit((current) => trimClipEdge(current, active.index, 'start', active.offset).seq);
        seek(active.start);
      } else {
        edit((current) => trimClipEdge(current, active.index, 'end', active.offset - active.clip.frames).seq);
      }
    },
    [sequence, playhead, edit, seek],
  );

  const trimEdge = useCallback(
    (index: number, edge: 'start' | 'end', delta: number) => edit((current) => trimClipEdge(current, index, edge, delta).seq),
    [edit],
  );
  const moveClip = useCallback((from: number, to: number) => edit((current) => moveClipInSequence(current, from, to)), [edit]);

  const removeClips = useCallback(
    (ids: readonly string[]) => {
      const hit = sequence.clips.filter((clip) => ids.includes(clip.id));
      if (hit.length === 0) return;
      if (hit.length >= sequence.clips.length) return say(copy.toast.lastCut);
      edit((current) => removeClipsFromSequence(current, ids));
      setSelection([]);
    },
    [sequence, edit, say, copy],
  );

  const addMaterial = useCallback(
    (material: FixtureMaterial) => {
      if (sequence.clips.length >= MAX_COMPOSE_CLIPS) return say(copy.toast.full);
      const clip = clipOfMaterial(material, newId('cut'), labelOf(material.id), sequence.fps);
      edit((current) => insertClips(current, current.clips.length, [clip]));
    },
    [sequence, edit, say, copy, labelOf],
  );

  const setSpeed = useCallback((index: number, num: number, den: number) => edit((current) => setSequenceClipSpeed(current, index, num, den)), [edit]);
  const setClipAudio = useCallback(
    (index: number, volume: number, muted: boolean) => edit((current) => setSequenceClipAudio(current, index, volume, muted), undefined, 'clip-volume'),
    [edit],
  );
  const setAspect = useCallback((aspect: ComposeAspect) => edit((current) => setSequenceAspect(current, aspect)), [edit]);

  // Copy, cut, paste, duplicate: whole cuts with their look and framing. Kept in memory, never on the system clipboard.
  const pick = useCallback(
    (): FrameClip[] => {
      const chosen = sequence.clips.filter((clip) => selection.includes(clip.id));
      if (chosen.length > 0) return chosen;
      const active = frameStateAt(sequence, playhead).active;
      return active ? [active.clip] : [];
    },
    [sequence, selection, playhead],
  );
  const copyClips = useCallback(() => {
    const clips = pick();
    if (clips.length === 0) return false;
    const looks: Record<string, ClipLook> = {};
    const reframe: Record<string, Reframe> = {};
    for (const clip of clips) {
      if (doc.looks[clip.id]) looks[clip.id] = doc.looks[clip.id]!;
      if (doc.reframe[clip.id]) reframe[clip.id] = doc.reframe[clip.id]!;
    }
    clipboard.current = { clips, looks, reframe };
    return true;
  }, [pick, doc]);
  const cutClips = useCallback(() => {
    const clips = pick();
    if (clips.length === 0 || clips.length >= sequence.clips.length) return clips.length > 0 ? say(copy.toast.lastCut) : undefined;
    copyClips();
    removeClips(clips.map((clip) => clip.id));
  }, [pick, sequence, copyClips, removeClips, say, copy]);
  const insertCopies = useCallback(
    (source: Clipboard, atIndex: number) => {
      if (sequence.clips.length + source.clips.length > MAX_COMPOSE_CLIPS) return say(copy.toast.full);
      const copies = source.clips.map((clip) => ({ ...clip, id: newId('cut') }));
      change((current) => {
        const next = withSequence(current, insertClips(current.sequence, atIndex, copies));
        const looks = { ...next.looks };
        const reframe = { ...next.reframe };
        copies.forEach((made, i) => {
          const from = source.clips[i]!.id;
          if (source.looks[from]) looks[made.id] = source.looks[from]!;
          if (source.reframe[from]) reframe[made.id] = source.reframe[from]!;
        });
        return { ...next, looks, reframe };
      });
      setSelectedTitleId(null);
      setSelection(copies.map((clip) => clip.id));
      setScopeMode('selected');
    },
    [sequence, change, say, copy],
  );
  const pasteClips = useCallback(() => {
    if (!clipboard.current) return;
    const active = frameStateAt(sequence, playhead).active;
    insertCopies(clipboard.current, active ? active.index + 1 : sequence.clips.length);
  }, [sequence, playhead, insertCopies]);
  const duplicateClips = useCallback(() => {
    const clips = pick();
    if (clips.length === 0) return;
    const looks: Record<string, ClipLook> = {};
    const reframe: Record<string, Reframe> = {};
    for (const clip of clips) {
      if (doc.looks[clip.id]) looks[clip.id] = doc.looks[clip.id]!;
      if (doc.reframe[clip.id]) reframe[clip.id] = doc.reframe[clip.id]!;
    }
    const last = Math.max(...clips.map((clip) => sequence.clips.findIndex((entry) => entry.id === clip.id)));
    insertCopies({ clips, looks, reframe }, last + 1);
  }, [pick, doc, sequence, insertCopies]);

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

  const frameRatio = COMPOSE_DIMENSIONS[sequence.aspect].width / COMPOSE_DIMENSIONS[sequence.aspect].height;
  const croppedIds = useMemo(
    () =>
      sequence.clips
        .filter((clip) => {
          const material = materialBySrc(clip.srcUrl);
          return !!material && material.ratio > frameRatio * 1.2 && !doc.reframe[clip.id];
        })
        .map((clip) => clip.id),
    [sequence, frameRatio, doc.reframe],
  );
  const centerOnSubject = useCallback(() => {
    change((current) => {
      const reframe = { ...current.reframe };
      for (const clip of current.sequence.clips) {
        if (!croppedIds.includes(clip.id)) continue;
        reframe[clip.id] = { fit: 'fill', x: materialBySrc(clip.srcUrl)?.focusX ?? 50 };
      }
      return { ...current, reframe };
    });
  }, [change, croppedIds]);

  const addTitle = useCallback(
    (preset: TitlePreset) => {
      const text = preset === 'big' ? copy.cut.titles.bigText : preset === 'lower' ? copy.cut.titles.lowerText : copy.cut.titles.endText;
      const length = Math.round(fps * 2.5);
      const start = preset === 'end' ? Math.max(0, total - length) : Math.min(playhead, Math.max(0, total - fps));
      const id = newId('title');
      change((current) => ({ ...current, titles: [...current.titles, { id, text, preset, start, end: Math.min(total, start + length) }] }));
      setSelection([]);
      setSelectedTitleId(id);
    },
    [change, copy, fps, total, playhead],
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
    () => sequence.clips.map((clip) => stats[clip.srcUrl]).filter((value): value is FrameStats => !!value),
    [sequence, stats],
  );
  const applyAuto = useCallback(
    (ids: readonly string[] = targetIds) => setLooks(balanceLooks(sequence, ids, stats, filmTarget(filmStats), 'auto')),
    [sequence, targetIds, stats, filmStats, setLooks],
  );
  const applyMatch = useCallback(
    (referenceKey: string, label: string, ids: readonly string[] = targetIds) => {
      const target = stats[referenceKey];
      if (!target) return;
      setLooks(balanceLooks(sequence, ids, stats, target, 'match', label));
    },
    [sequence, targetIds, stats, setLooks],
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
  const captionDrafts = useMemo(
    () =>
      FIXTURE_SPEECH.map((region, index): FrameCaption => ({
        id: `cap-${index + 1}`,
        text: transcript[index] ?? '',
        start: Math.round(region.startSec * fps),
        end: Math.round(region.endSec * fps),
        position: 'bottom',
        size: 'md',
      })).filter((caption) => caption.start < total),
    [transcript, fps, total],
  );
  const makeCaptions = useCallback(
    (immediate = false) => {
      if (sequence.captions.length > 0 || captionsBusy) return;
      const run = () => {
        edit((current) => captionDrafts.reduce((next, caption) => addCaption(next, { ...caption, id: newId('cap') }), current));
        setCaptionsBusy(false);
        say(fill(copy.captions.made, { count: captionDrafts.length }));
      };
      if (immediate) return run();
      setCaptionsBusy(true);
      setTimeout(run, 1400);
    },
    [sequence, captionsBusy, edit, captionDrafts, say, copy],
  );
  const updateCaptionText = useCallback((id: string, text: string) => edit((current) => updateSequenceCaption(current, id, { text })), [edit]);
  const removeCaption = useCallback((id: string | 'all') => edit((current) => removeCaptionFromSequence(current, id)), [edit]);
  const setCaptionSettings = useCallback(
    (next: Partial<CaptionSettings>) => change((current) => ({ ...current, captionSettings: { ...current.captionSettings, ...next } })),
    [change],
  );
  const setCaptionPosition = useCallback(
    (position: CaptionPosition) =>
      edit((current) => current.captions.reduce((next, caption) => updateSequenceCaption(next, caption.id, { position }), current)),
    [edit],
  );

  // ── Findings: what each workspace says before anyone touches a control ──
  const findings = useMemo(
    () => ({
      color: colorFindings(sequence, stats, doc.looks),
      sound: soundFindings(doc, FIXTURE_MEASURED_LUFS, FIXTURE_SPEECH),
      captions: captionFindings(doc, FIXTURE_SPEECH),
      croppedIds,
    }),
    [sequence, stats, doc, croppedIds],
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
      const all = sequence.clips.map((clip) => clip.id);
      switch (intent.kind) {
        case 'aspect':
          if (intent.aspect === sequence.aspect) return none();
          return setProposal({
            ...base,
            note: null,
            lines: [fill(lines.aspect, { aspect: copy.aspectNames[ASPECT_KEYS[intent.aspect]] })],
            run: () => setAspect(intent.aspect),
          });
        case 'trim': {
          const clip = sequence.clips[intent.clipNumber - 1];
          const want = Math.max(1, Math.round(intent.seconds * fps));
          if (!clip || want === clip.frames) return none();
          return setProposal({
            ...base,
            note: null,
            lines: [fill(lines.trim, { number: intent.clipNumber, seconds: intent.seconds })],
            run: () => trimEdge(intent.clipNumber - 1, 'end', want - clip.frames),
          });
        }
        case 'remove_last':
          if (sequence.clips.length < 2) return none();
          return setProposal({
            ...base,
            note: null,
            lines: [fill(lines.removeLast, { number: sequence.clips.length })],
            run: () => removeClips([sequence.clips[sequence.clips.length - 1]!.id]),
          });
        case 'auto_balance':
          return setProposal({ ...base, note: null, lines: [fill(lines.autoBalance, { count: all.length })], run: () => applyAuto(all) });
        case 'match_first': {
          const first = sequence.clips[0];
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
          if (sequence.captions.length > 0) return none();
          return setProposal({ ...base, note: null, lines: [fill(lines.makeCaptions, { count: captionDrafts.length })], run: () => makeCaptions(true) });
        case 'lift_captions':
          if (sequence.captions.length === 0 || doc.captionSettings.lift) return none();
          return setProposal({ ...base, note: null, lines: [lines.lift], run: () => setCaptionSettings({ lift: true }) });
      }
    },
    [copy, sequence, fps, doc, setAspect, trimEdge, removeClips, applyAuto, applyMatch, setSound, makeCaptions, setCaptionSettings, captionDrafts],
  );

  /** Every keyboard action, by id. The key that means it comes from the person's shortcut map. */
  const runAction = (action: ShortcutAction) => {
    switch (action) {
      case 'play': return setRate(rate === 0 ? 1 : 0);
      case 'stepBack': return step(-1);
      case 'stepForward': return step(1);
      case 'stepBack10': return step(-10);
      case 'stepForward10': return step(10);
      case 'prevCut': return toCut(-1);
      case 'nextCut': return toCut(1);
      case 'toStart': return step(-total);
      case 'toEnd': return step(total);
      case 'shuttleBack': return shuttle(-1);
      case 'shuttleStop': return shuttle(0);
      case 'shuttleForward': return shuttle(1);
      case 'split': return splitAtPlayhead();
      case 'trimStart': return trimToPlayhead('start');
      case 'trimEnd': return trimToPlayhead('end');
      case 'remove':
        if (selectedTitleId) return removeTitle(selectedTitleId);
        return settled.selection.length > 0 ? removeClips(settled.selection) : undefined;
      case 'magnet': return setMagnet((on) => !on);
      case 'undo': return undo();
      case 'redo': return redo();
      case 'copy': return void copyClips();
      case 'cut': return cutClips();
      case 'paste': return pasteClips();
      case 'duplicate': return duplicateClips();
      case 'selectAll': return selectAll();
      case 'deselect':
        if (shortcutsOpen) return setShortcutsOpen(false);
        if (exportOpen) return setExportOpen(false);
        return clearSelection();
      case 'zoomIn': return zoom('in');
      case 'zoomOut': return zoom('out');
      case 'zoomFit': return zoom('fit');
      case 'zoomFrames': return zoom('frames');
      case 'workspaceCut': return setWorkspace('cut');
      case 'workspaceColor': return setWorkspace('color');
      case 'workspaceSound': return setWorkspace('sound');
      case 'workspaceCaptions': return setWorkspace('captions');
      case 'shortcuts': return setShortcutsOpen((open) => !open);
    }
  };

  return {
    copy,
    doc,
    sequence,
    fps,
    spans,
    total,
    lastFrame,
    durationSec,
    frame,
    activeClip,
    playhead: frame.frame,
    playheadSec,
    seek,
    step,
    toCut,
    rate,
    setRate,
    playing: rate !== 0,
    setPlaying,
    shuttle,
    magnet,
    setMagnet,
    zoom,
    zoomCommand,
    stats,
    findings,
    openCount,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo,
    redo,
    change,
    edit,
    tabs,
    setTab,
    workspace,
    setWorkspace,
    selection: settled.selection,
    selectedTitleId,
    setSelectedTitleId,
    select,
    selectAll,
    clearSelection,
    scopeMode: settled.mode,
    setScopeMode,
    targetIds,
    compare,
    setCompare,
    assistDock,
    setAssistDock,
    exportOpen,
    setExportOpen,
    shortcutsOpen,
    setShortcutsOpen,
    shortcutPrefs,
    setShortcutPrefs,
    shortcutMap,
    mac,
    runAction,
    toast,
    say,
    captionsBusy,
    proposal,
    setProposal,
    propose,
    splitAtPlayhead,
    trimToPlayhead,
    trimEdge,
    moveClip,
    removeClips,
    addMaterial,
    setSpeed,
    setClipAudio,
    setAspect,
    copyClips,
    cutClips,
    pasteClips,
    duplicateClips,
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
    updateCaptionText,
    removeCaption,
    setCaptionSettings,
    setCaptionPosition,
  };
}

export type EditorApi = ReturnType<typeof useEditor>;
