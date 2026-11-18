/**
 * What an edit changed, as values (docs/BRAND-EDITING-STUDIO.md §4.6).
 *
 * `diffTimelines(before, after)` is the single source for the lines the screen writes under an edit
 * ("2번 컷 길이 5초 → 2초"). It compares the two timelines themselves, never what a model said it did:
 * the screen shows no model prose, and a delta can only describe something that really changed. Every
 * value here is a number, an id-free position, a label or a code; the sentences come from the dictionary.
 *
 * Nothing changes silently: whatever difference no named kind explains is counted in `other`. The one
 * exception is a cut's scene markers (`cutMarkers`), which are analysis data and never compared.
 * Client-safe: no server imports, no Node APIs.
 */
import {
  applyTimelinePatches,
  clamp,
  clipPlayDuration,
  projectDurationSec,
  roundTenths,
  type ComposeAspect,
  type ComposeCaption,
  type ComposeClip,
  type ComposeColorPresetId,
  type ComposerProject,
  type TimelinePatch,
} from '../compose/timeline';

export type CaptionField = 'text' | 'time' | 'position' | 'size';

/** `cut` is the cut's 1-based position BEFORE the edit; `toPosition` its 1-based position after it. */
export type EditDelta =
  | { kind: 'clip_removed'; cut: number; label: string }
  | { kind: 'clip_split'; cut: number; atSec: number }
  /** One cut divided into three or more consecutive pieces that still play all of it (scene split). */
  | { kind: 'clip_split_many'; cut: number; pieces: number }
  | { kind: 'clip_trimmed'; cut: number; beforeSec: number; afterSec: number }
  | { kind: 'clip_moved'; cut: number; toPosition: number }
  | { kind: 'clip_sound'; cut: number | 'all'; muted?: boolean; volumePct?: number }
  | { kind: 'caption_removed'; text: string }
  | { kind: 'caption_changed'; text: string; changed: CaptionField[] }
  | { kind: 'caption_added'; text: string; fromSec: number; toSec: number }
  | { kind: 'music_removed' }
  | { kind: 'music_volume'; beforePct: number; afterPct: number }
  | { kind: 'aspect'; before: ComposeAspect; after: ComposeAspect }
  | { kind: 'look'; preset: ComposeColorPresetId | 'custom' | 'off'; strengthPct?: number }
  | { kind: 'other'; count: number }
  | { kind: 'total'; beforeSec: number; afterSec: number };

/**
 * What an edit step (or patch) was about, so the change lines can follow the order the user asked in:
 * a cut by its id BEFORE the edit (a split piece counts as its cut), a caption by id, every cut, every
 * caption, a new caption, the music, the aspect or the look.
 */
export type DeltaSubject =
  | { clip: string }
  | { caption: string }
  | 'clips'
  | 'captions'
  | 'new_caption'
  | 'music'
  | 'aspect'
  | 'look';

interface TaggedDelta {
  delta: EditDelta;
  subject: DeltaSubject | null;
}

function subjectMatches(asked: DeltaSubject, subject: DeltaSubject): boolean {
  if (typeof asked === 'object' && typeof subject === 'object') {
    if ('clip' in asked && 'clip' in subject) return asked.clip === subject.clip;
    if ('caption' in asked && 'caption' in subject) return asked.caption === subject.caption;
    return false;
  }
  if (asked === subject) return true;
  // "Every cut" covers each cut and the other way round (several per-cut steps can end as one "all cuts" line).
  if (asked === 'clips') return typeof subject === 'object' && 'clip' in subject;
  if (subject === 'clips') return typeof asked === 'object' && 'clip' in asked;
  if (asked === 'captions') return typeof subject === 'object' && 'caption' in subject;
  return false;
}

/** Stable: lines whose subject a step named come in step order, the rest keep their place after them. */
function inAskedOrder(tagged: readonly TaggedDelta[], asked: readonly DeltaSubject[]): TaggedDelta[] {
  const rank = (entry: TaggedDelta) => {
    if (!entry.subject) return Number.POSITIVE_INFINITY;
    const index = asked.findIndex((a) => subjectMatches(a, entry.subject!));
    return index < 0 ? Number.POSITIVE_INFINITY : index;
  };
  return tagged
    .map((entry, position) => ({ entry, position, rank: rank(entry) }))
    .sort((a, b) => a.rank - b.rank || a.position - b.position)
    .map((item) => item.entry);
}

/**
 * The subjects of index-based patches (rule answers), in patch order, with every index read on the timeline
 * as it is when that patch runs; a piece cut off by an earlier patch counts as the cut it came from.
 */
export function patchSubjects(project: ComposerProject, patches: readonly TimelinePatch[]): DeltaSubject[] {
  let state = applyTimelinePatches(project, []).project;
  const origin = new Map(state.clips.map((clip) => [clip.id, clip.id]));
  const clipAt = (index: number): string | null => {
    const clip = state.clips[index];
    return clip ? (origin.get(clip.id) ?? clip.id) : null;
  };
  const out: DeltaSubject[] = [];
  for (const patch of patches) {
    let parent: string | null = null;
    switch (patch.op) {
      case 'trim_clip':
      case 'split_clip_at':
      case 'split_clip_cuts':
      case 'remove_clip':
      case 'set_clip_speed':
      case 'slip_clip':
      case 'set_clip_audio_offset':
      case 'set_clip_transition':
        parent = clipAt(patch.clipIndex);
        break;
      case 'move_clip':
        parent = clipAt(patch.fromIndex);
        break;
      case 'swap_clips': {
        const other = clipAt(patch.indexB);
        parent = clipAt(patch.indexA);
        if (parent) out.push({ clip: parent });
        if (other) out.push({ clip: other });
        parent = null;
        break;
      }
      case 'set_clip_audio':
        if (patch.clipIndex === 'all') out.push('clips');
        else parent = clipAt(patch.clipIndex);
        break;
      case 'add_caption':
        out.push('new_caption');
        break;
      case 'update_caption': {
        const caption = state.captions[patch.captionIndex];
        if (caption) out.push({ caption: caption.id });
        break;
      }
      case 'remove_caption': {
        const caption = patch.captionIndex === 'all' ? null : state.captions[patch.captionIndex];
        if (patch.captionIndex === 'all') out.push('captions');
        else if (caption) out.push({ caption: caption.id });
        break;
      }
      case 'set_bgm_volume':
      case 'remove_bgm':
        out.push('music');
        break;
      case 'set_aspect':
        out.push('aspect');
        break;
      case 'set_color_grade':
        out.push('look');
        break;
      default:
        break;
    }
    if (parent) out.push({ clip: parent });
    const next = applyTimelinePatches(state, [patch]).project;
    for (const clip of next.clips) if (!origin.has(clip.id)) origin.set(clip.id, parent ?? clip.id);
    state = next;
  }
  return out;
}

/** Structural equality for plain JSON-like values; a key whose value is `undefined` counts as absent. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => sameValue(item, b[i]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter((key) => left[key] !== undefined);
  const otherKeys = Object.keys(right).filter((key) => right[key] !== undefined);
  return keys.length === otherKeys.length && keys.every((key) => sameValue(left[key], right[key]));
}

const pct = (volume: number) => Math.round(volume * 100);
const EPS = 1e-6;

function rateOf(clip: ComposeClip): number {
  return clip.playbackRate && Number.isFinite(clip.playbackRate) ? clamp(clip.playbackRate, 0.25, 4) : 1;
}

function sameSource(a: ComposeClip, b: ComposeClip): boolean {
  return (
    a.sourceKind === b.sourceKind &&
    a.srcUrl === b.srcUrl &&
    a.assetId === b.assetId &&
    a.outputId === b.outputId &&
    a.durationSec === b.durationSec &&
    rateOf(a) === rateOf(b)
  );
}

/**
 * A clip without what the named deltas explain: trims, volume, mute, the active take's trims (a trim
 * keeps it in step), and — for a cut that was split — its id. Scene cut markers are never compared: they
 * are analysis data stored by scene detection, not something that plays, so storing them (even an empty
 * list when no scene change was found) is not a change to show or to apply.
 */
function clipRest(clip: ComposeClip, split: boolean): Record<string, unknown> {
  const {
    trimStartSec: _start,
    trimEndSec: _end,
    volume: _volume,
    muted: _muted,
    cutMarkers: _cutMarkers,
    takes,
    ...rest
  } = clip;
  const out: Record<string, unknown> = { ...rest };
  if (split) delete out.id;
  if (takes) {
    const active = clip.activeTakeIndex ?? takes.length - 1;
    out.takes = takes.map((take, i) => (i === active ? { ...take, trimStartSec: undefined, trimEndSec: undefined } : take));
  }
  return out;
}

function soundDelta(cut: number, before: ComposeClip, after: ComposeClip): Extract<EditDelta, { kind: 'clip_sound' }> | null {
  const muted = before.muted !== after.muted ? { muted: after.muted } : {};
  const volume = pct(before.volume) !== pct(after.volume) ? { volumePct: pct(after.volume) } : {};
  return 'muted' in muted || 'volumePct' in volume ? { kind: 'clip_sound', cut, ...muted, ...volume } : null;
}

/**
 * Indices of `seq` (before positions in after order) that stay put: the longest increasing run, and
 * among those the one keeping the most cuts at their own rank, then the earliest. Everything else moved,
 * so a swap of neighbours reads as one move and a swap across a cut as two.
 */
function stationary(seq: readonly number[], fixed: readonly boolean[]): Set<number> {
  const n = seq.length;
  const length = new Array<number>(n).fill(1);
  const kept = new Array<number>(n).fill(0);
  const next = new Array<number>(n).fill(-1);
  for (let i = n - 1; i >= 0; i -= 1) {
    kept[i] = fixed[i] ? 1 : 0;
    for (let j = i + 1; j < n; j += 1) {
      if (seq[j]! <= seq[i]!) continue;
      const l = 1 + length[j]!;
      const k = (fixed[i] ? 1 : 0) + kept[j]!;
      if (l > length[i]! || (l === length[i]! && k > kept[i]!)) {
        length[i] = l;
        kept[i] = k;
        next[i] = j;
      }
    }
  }
  let start = -1;
  for (let i = 0; i < n; i += 1) {
    if (start < 0 || length[i]! > length[start]! || (length[i] === length[start] && kept[i]! > kept[start]!)) start = i;
  }
  const out = new Set<number>();
  for (let i = start; i >= 0; i = next[i]!) out.add(i);
  return out;
}

interface ClipDiff {
  removed: EditDelta[];
  split: EditDelta[];
  trimmed: EditDelta[];
  moved: EditDelta[];
  sound: EditDelta[];
  other: number;
}

function diffClips(before: readonly ComposeClip[], after: readonly ComposeClip[]): ClipDiff {
  const out: ClipDiff = { removed: [], split: [], trimmed: [], moved: [], sound: [], other: 0 };
  const beforeIds = new Set(before.map((clip) => clip.id));
  const afterIndex = new Map(after.map((clip, i) => [clip.id, i]));

  // A clip with a new id is a split piece when exactly one earlier cut shows the same media around it.
  const pieces = new Map<string, ComposeClip[]>();
  for (const clip of after) {
    if (beforeIds.has(clip.id)) continue;
    const parents = before.filter(
      (cut) => sameSource(cut, clip) && clip.trimStartSec >= cut.trimStartSec - EPS && clip.trimEndSec <= cut.trimEndSec + EPS,
    );
    if (parents.length === 1) pieces.set(parents[0]!.id, [...(pieces.get(parents[0]!.id) ?? []), clip]);
    else out.other += 1;
  }

  const survivors: Array<{ cut: number; at: number }> = [];
  const sounds: Array<Extract<EditDelta, { kind: 'clip_sound' }>> = [];
  before.forEach((cut, i) => {
    const position = i + 1;
    const index = afterIndex.get(cut.id);
    const kept = index !== undefined ? after[index] : undefined;
    const extra = pieces.get(cut.id) ?? [];

    if (!kept && extra.length === 0) {
      out.removed.push({ kind: 'clip_removed', cut: position, label: cut.label });
      return;
    }

    if (extra.length === 0 || (!kept && extra.length === 1)) {
      // Unchanged id, or the only piece left of a split cut: either way the cut now plays `now`.
      const now = kept ?? extra[0]!;
      survivors.push({ cut: position, at: afterIndex.get(now.id)! });
      if (now.trimStartSec !== cut.trimStartSec || now.trimEndSec !== cut.trimEndSec) {
        out.trimmed.push({ kind: 'clip_trimmed', cut: position, beforeSec: clipPlayDuration(cut), afterSec: clipPlayDuration(now) });
      }
      const sound = soundDelta(position, cut, now);
      if (sound) sounds.push(sound);
      if (!sameValue(clipRest(cut, !kept), clipRest(now, !kept))) out.other += 1;
      return;
    }

    if (kept && extra.length === 1) {
      const piece = extra[0]!;
      survivors.push({ cut: position, at: index! });
      const touching = kept.trimStartSec <= piece.trimStartSec && Math.abs(kept.trimEndSec - piece.trimStartSec) < EPS;
      if (!touching) {
        // The split point is somewhere in a gap: too ambiguous to describe.
        out.other += 1;
        return;
      }
      out.split.push({ kind: 'clip_split', cut: position, atSec: roundTenths((piece.trimStartSec - cut.trimStartSec) / rateOf(cut)) });
      if (kept.trimStartSec !== cut.trimStartSec || piece.trimEndSec !== cut.trimEndSec) {
        out.trimmed.push({
          kind: 'clip_trimmed',
          cut: position,
          beforeSec: clipPlayDuration(cut),
          afterSec: roundTenths(clipPlayDuration(kept) + clipPlayDuration(piece)),
        });
      }
      if (kept.volume === piece.volume && kept.muted === piece.muted) {
        const sound = soundDelta(position, cut, kept);
        if (sound) sounds.push(sound);
      } else {
        out.other += 1;
      }
      if (!sameValue(clipRest(cut, true), clipRest(kept, true)) || !sameValue(clipRest(cut, true), clipRest(piece, true))) {
        out.other += 1;
      }
      // The second piece went somewhere else on the timeline.
      if (afterIndex.get(piece.id) !== index! + 1) out.other += 1;
      return;
    }

    // Several new pieces. One reading is clean: the cut was divided into consecutive pieces that still
    // play the whole of it, in place (an automatic scene split). Anything else is too ambiguous to name.
    survivors.push({ cut: position, at: index ?? afterIndex.get(extra[0]!.id)! });
    const all = kept ? [kept, ...extra].sort((x, y) => x.trimStartSec - y.trimStartSec) : [];
    const whole =
      all.length >= 3 &&
      all[0]!.id === cut.id &&
      Math.abs(all[0]!.trimStartSec - cut.trimStartSec) < EPS &&
      Math.abs(all[all.length - 1]!.trimEndSec - cut.trimEndSec) < EPS &&
      all.every((piece, k) => k === 0 || Math.abs(all[k - 1]!.trimEndSec - piece.trimStartSec) < EPS) &&
      all.every((piece, k) => afterIndex.get(piece.id) === index! + k) &&
      all.every((piece) => piece.volume === cut.volume && piece.muted === cut.muted) &&
      all.every((piece) => sameValue(clipRest(cut, true), clipRest(piece, true)));
    if (whole) out.split.push({ kind: 'clip_split_many', cut: position, pieces: all.length });
    else out.other += 1;
  });

  const inAfterOrder = [...survivors].sort((a, b) => a.at - b.at);
  const beforeRank = new Map(survivors.map((s, rank) => [s.cut, rank]));
  const still = stationary(
    inAfterOrder.map((s) => s.cut),
    inAfterOrder.map((s, rank) => beforeRank.get(s.cut) === rank),
  );
  out.moved = inAfterOrder
    .filter((_, i) => !still.has(i))
    .sort((a, b) => a.cut - b.cut)
    .map((s) => ({ kind: 'clip_moved', cut: s.cut, toPosition: s.at + 1 }));

  // Several cuts that all ended in the same sound state read as one change to every cut.
  const mutedChanged = sounds.some((s) => s.muted !== undefined);
  const volumeChanged = sounds.some((s) => s.volumePct !== undefined);
  const first = after[0];
  if (
    sounds.length >= 2 &&
    first &&
    (!mutedChanged || after.every((clip) => clip.muted === first.muted)) &&
    (!volumeChanged || after.every((clip) => pct(clip.volume) === pct(first.volume)))
  ) {
    out.sound = [
      {
        kind: 'clip_sound',
        cut: 'all',
        ...(mutedChanged ? { muted: first.muted } : {}),
        ...(volumeChanged ? { volumePct: pct(first.volume) } : {}),
      },
    ];
  } else {
    out.sound = sounds;
  }
  return out;
}

function captionRest(caption: ComposeCaption): Record<string, unknown> {
  const { text: _text, startSec: _start, endSec: _end, position: _position, size: _size, ...rest } = caption;
  return rest;
}

function diffCaptions(before: readonly ComposeCaption[], after: readonly ComposeCaption[]) {
  const afterById = new Map(after.map((c) => [c.id, c]));
  const beforeIds = new Set(before.map((c) => c.id));
  const removed: TaggedDelta[] = [];
  const changed: TaggedDelta[] = [];
  let other = 0;
  for (const caption of before) {
    const now = afterById.get(caption.id);
    if (!now) {
      removed.push({ delta: { kind: 'caption_removed', text: caption.text }, subject: { caption: caption.id } });
      continue;
    }
    const fields: CaptionField[] = [];
    if (now.text !== caption.text) fields.push('text');
    if (now.startSec !== caption.startSec || now.endSec !== caption.endSec) fields.push('time');
    if (now.position !== caption.position) fields.push('position');
    if (now.size !== caption.size) fields.push('size');
    if (fields.length > 0) {
      changed.push({ delta: { kind: 'caption_changed', text: now.text, changed: fields }, subject: { caption: caption.id } });
    }
    if (!sameValue(captionRest(caption), captionRest(now))) other += 1;
  }
  const added: TaggedDelta[] = after
    .filter((c) => !beforeIds.has(c.id))
    .map((c) => ({ delta: { kind: 'caption_added', text: c.text, fromSec: c.startSec, toSec: c.endSec }, subject: 'new_caption' }));
  return { removed, changed, added, other };
}

const LOOK_TARGET_KEYS = ['scope', 'clipId', 'clipIndex', 'region'] as const;

function split<T extends object>(value: T, keys: readonly string[]): { picked: Record<string, unknown>; rest: Record<string, unknown> } {
  const picked: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) (keys.includes(key) ? picked : rest)[key] = inner;
  return { picked, rest };
}

const KNOWN_PROJECT_KEYS = new Set(['aspect', 'clips', 'captions', 'bgm', 'colorGrade']);

/**
 * Deltas from `before` to `after`. Without `asked`, cuts come by cut number (for one cut: removed, split,
 * trimmed, moved, sound), then captions (removed, changed, added), music, aspect, look. With `asked` (the
 * subjects of the plan's steps or the patches, in order — `stepSubjects` / `patchSubjects`), the lines a
 * step named follow the step order and the rest keep that order after them. `other` and `total` always
 * come last. Both sides are normalised the way the timeline normalises them first, so a timeline is never
 * "changed" by normalisation alone.
 */
export function diffTimelines(
  beforeProject: ComposerProject,
  afterProject: ComposerProject,
  asked?: readonly DeltaSubject[],
): EditDelta[] {
  const before = applyTimelinePatches(beforeProject, []).project;
  const after = applyTimelinePatches(afterProject, []).project;

  const clips = diffClips(before.clips, after.clips);
  const captions = diffCaptions(before.captions, after.captions);
  let other = clips.other + captions.other;

  const music: TaggedDelta[] = [];
  if (before.bgm && !after.bgm) {
    music.push({ delta: { kind: 'music_removed' }, subject: 'music' });
  } else if (!before.bgm && after.bgm) {
    other += 1;
  } else if (before.bgm && after.bgm) {
    const { volume: beforeVolume, ...beforeRest } = before.bgm;
    const { volume: afterVolume, ...afterRest } = after.bgm;
    if (pct(beforeVolume) !== pct(afterVolume)) {
      music.push({ delta: { kind: 'music_volume', beforePct: pct(beforeVolume), afterPct: pct(afterVolume) }, subject: 'music' });
    } else if (beforeVolume !== afterVolume) {
      other += 1;
    }
    if (!sameValue(beforeRest, afterRest)) other += 1;
  }

  const aspect: TaggedDelta[] =
    before.aspect !== after.aspect
      ? [{ delta: { kind: 'aspect', before: before.aspect, after: after.aspect }, subject: 'aspect' }]
      : [];

  const look: TaggedDelta[] = [];
  const g0 = before.colorGrade ?? null;
  const g1 = after.colorGrade ?? null;
  const l0 = g0 ? split(g0, LOOK_TARGET_KEYS) : null;
  const l1 = g1 ? split(g1, LOOK_TARGET_KEYS) : null;
  if (!sameValue(l0?.rest ?? null, l1?.rest ?? null)) {
    look.push({
      delta: {
        kind: 'look',
        preset: g1 ? (g1.presetId ?? 'custom') : 'off',
        ...(g0 && g1 && pct(g0.intensity) !== pct(g1.intensity) ? { strengthPct: pct(g1.intensity) } : {}),
      },
      subject: 'look',
    });
  }
  // The grade's target moved (e.g. its cut was removed): not a look change, still a change.
  if (l0 && l1 && !sameValue(l0.picked, l1.picked)) other += 1;

  const projectKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of projectKeys) {
    if (KNOWN_PROJECT_KEYS.has(key)) continue;
    if (!sameValue((before as unknown as Record<string, unknown>)[key], (after as unknown as Record<string, unknown>)[key])) {
      other += 1;
    }
  }

  // Cuts by cut number; within one cut the kinds keep the order above. "Every cut" sound goes last.
  const cutOf = (delta: EditDelta) => ('cut' in delta && typeof delta.cut === 'number' ? delta.cut : Number.POSITIVE_INFINITY);
  const clipLines: TaggedDelta[] = [...clips.removed, ...clips.split, ...clips.trimmed, ...clips.moved, ...clips.sound]
    .map((delta, position) => ({ delta, position }))
    .sort((a, b) => cutOf(a.delta) - cutOf(b.delta) || a.position - b.position)
    .map(({ delta }) => {
      const cut = cutOf(delta);
      const clip = Number.isFinite(cut) ? before.clips[cut - 1] : undefined;
      return { delta, subject: clip ? { clip: clip.id } : 'clips' };
    });

  const named: TaggedDelta[] = [...clipLines, ...captions.removed, ...captions.changed, ...captions.added, ...music, ...aspect, ...look];
  const beforeSec = projectDurationSec(before);
  const afterSec = projectDurationSec(after);
  return [
    ...(asked ? inAskedOrder(named, asked) : named).map((entry) => entry.delta),
    ...(other > 0 ? [{ kind: 'other' as const, count: other }] : []),
    ...(beforeSec !== afterSec ? [{ kind: 'total' as const, beforeSec, afterSec }] : []),
  ];
}

const NEVER_INSTANT = new Set<EditDelta['kind']>(['clip_removed', 'caption_removed', 'music_removed', 'other']);

/**
 * Design §4.6: an edit that changes one thing and deletes nothing applies at once (with an undo line);
 * everything else is previewed first. The new total length does not count as a second change.
 */
export function isInstantEdit(deltas: readonly EditDelta[]): boolean {
  const changes = deltas.filter((delta) => delta.kind !== 'total');
  return changes.length === 1 && !NEVER_INSTANT.has(changes[0]!.kind);
}
