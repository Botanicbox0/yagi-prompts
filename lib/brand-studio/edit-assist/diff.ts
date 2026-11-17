/**
 * What an edit changed, as values (docs/BRAND-EDITING-STUDIO.md §4.6).
 *
 * `diffTimelines(before, after)` is the single source for the lines the screen writes under an edit
 * ("컷 2 길이 5.0초 → 2.0초"). It compares the two timelines themselves, never what a model said it did:
 * the screen shows no model prose, and a delta can only describe something that really changed. Every
 * value here is a number, an id-free position, a label or a code; the sentences come from the dictionary.
 *
 * Nothing changes silently: whatever difference no named kind explains is counted in `other`.
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
} from '../compose/timeline';

export type CaptionField = 'text' | 'time' | 'position' | 'size';

/** `cut` is the cut's 1-based position BEFORE the edit; `toPosition` its 1-based position after it. */
export type EditDelta =
  | { kind: 'clip_removed'; cut: number; label: string }
  | { kind: 'clip_split'; cut: number; atSec: number }
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
 * keeps it in step), and — for a cut that was split — its id and scene markers.
 */
function clipRest(clip: ComposeClip, split: boolean): Record<string, unknown> {
  const { trimStartSec: _start, trimEndSec: _end, volume: _volume, muted: _muted, takes, ...rest } = clip;
  const out: Record<string, unknown> = { ...rest };
  if (split) {
    delete out.id;
    delete out.cutMarkers;
  }
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

    // More than one new piece: too many ways to read it.
    survivors.push({ cut: position, at: index ?? afterIndex.get(extra[0]!.id)! });
    out.other += 1;
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
  const removed: EditDelta[] = [];
  const changed: EditDelta[] = [];
  let other = 0;
  for (const caption of before) {
    const now = afterById.get(caption.id);
    if (!now) {
      removed.push({ kind: 'caption_removed', text: caption.text });
      continue;
    }
    const fields: CaptionField[] = [];
    if (now.text !== caption.text) fields.push('text');
    if (now.startSec !== caption.startSec || now.endSec !== caption.endSec) fields.push('time');
    if (now.position !== caption.position) fields.push('position');
    if (now.size !== caption.size) fields.push('size');
    if (fields.length > 0) changed.push({ kind: 'caption_changed', text: now.text, changed: fields });
    if (!sameValue(captionRest(caption), captionRest(now))) other += 1;
  }
  const added: EditDelta[] = after
    .filter((c) => !beforeIds.has(c.id))
    .map((c) => ({ kind: 'caption_added', text: c.text, fromSec: c.startSec, toSec: c.endSec }));
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
 * Deltas from `before` to `after`, in a fixed order: cuts (removed, split, trimmed, moved, sound),
 * captions (removed, changed, added), music, aspect, look, other, total. Both sides are normalised the
 * way the timeline normalises them first, so a timeline is never "changed" by normalisation alone.
 */
export function diffTimelines(beforeProject: ComposerProject, afterProject: ComposerProject): EditDelta[] {
  const before = applyTimelinePatches(beforeProject, []).project;
  const after = applyTimelinePatches(afterProject, []).project;

  const clips = diffClips(before.clips, after.clips);
  const captions = diffCaptions(before.captions, after.captions);
  let other = clips.other + captions.other;

  const music: EditDelta[] = [];
  if (before.bgm && !after.bgm) {
    music.push({ kind: 'music_removed' });
  } else if (!before.bgm && after.bgm) {
    other += 1;
  } else if (before.bgm && after.bgm) {
    const { volume: beforeVolume, ...beforeRest } = before.bgm;
    const { volume: afterVolume, ...afterRest } = after.bgm;
    if (pct(beforeVolume) !== pct(afterVolume)) {
      music.push({ kind: 'music_volume', beforePct: pct(beforeVolume), afterPct: pct(afterVolume) });
    } else if (beforeVolume !== afterVolume) {
      other += 1;
    }
    if (!sameValue(beforeRest, afterRest)) other += 1;
  }

  const aspect: EditDelta[] =
    before.aspect !== after.aspect ? [{ kind: 'aspect', before: before.aspect, after: after.aspect }] : [];

  const look: EditDelta[] = [];
  const g0 = before.colorGrade ?? null;
  const g1 = after.colorGrade ?? null;
  const l0 = g0 ? split(g0, LOOK_TARGET_KEYS) : null;
  const l1 = g1 ? split(g1, LOOK_TARGET_KEYS) : null;
  if (!sameValue(l0?.rest ?? null, l1?.rest ?? null)) {
    look.push({
      kind: 'look',
      preset: g1 ? (g1.presetId ?? 'custom') : 'off',
      ...(g0 && g1 && pct(g0.intensity) !== pct(g1.intensity) ? { strengthPct: pct(g1.intensity) } : {}),
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

  const beforeSec = projectDurationSec(before);
  const afterSec = projectDurationSec(after);
  return [
    ...clips.removed,
    ...clips.split,
    ...clips.trimmed,
    ...clips.moved,
    ...clips.sound,
    ...captions.removed,
    ...captions.changed,
    ...captions.added,
    ...music,
    ...aspect,
    ...look,
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
