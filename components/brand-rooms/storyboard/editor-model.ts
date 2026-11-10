/**
 * The storyboard editor's working copy, as plain data (tested in tests/brand-rooms/storyboard/editor.test.ts).
 *
 * The editor keeps every change local until "임시 저장"; a save is then planned against the board as
 * the server last returned it. Text fields are edited as strings and become the contract's values
 * (empty -> null, length -> a number of seconds) only when they are sent.
 */
import { STORYBOARD_LIMITS, byFileName, splitParagraphs, type FrameTextInput, type StoryboardFrameDetail } from "@/lib/brand-rooms/storyboard-contracts";

export interface DraftCut {
  /** Stable key for React and drag-and-drop. */
  key: string;
  /** The saved cut this is, if any. */
  id?: string;
  /** A picture not yet uploaded. */
  file?: Blob & { name: string };
  /** What to show: the saved picture, or a local preview of `file`. */
  previewUrl: string;
  width: number | null;
  height: number | null;
  scene: string;
  shot: string;
  description: string;
  camera: string;
  audio: string;
  seconds: string;
}

let counter = 0;
export const draftKey = (): string => `cut-${Date.now().toString(36)}-${(counter += 1)}`;

export function cutsFromFrames(frames: readonly StoryboardFrameDetail[]): DraftCut[] {
  return frames.map((f) => ({
    key: f.id,
    id: f.id,
    previewUrl: f.thumbUrl ?? f.url,
    width: f.width,
    height: f.height,
    scene: f.scene ?? "",
    shot: f.shot ?? "",
    description: f.description ?? "",
    camera: f.camera ?? "",
    audio: f.audio ?? "",
    seconds: f.seconds == null ? "" : String(f.seconds),
  }));
}

/** New cuts for dropped pictures, in file-name order. `preview` makes the local address (URL.createObjectURL). */
export function cutsFromFiles<F extends Blob & { name: string }>(files: readonly F[], preview: (file: F) => string): DraftCut[] {
  return byFileName(files).map((file) => ({
    key: draftKey(),
    file,
    previewUrl: preview(file),
    width: null,
    height: null,
    scene: "",
    shot: "",
    description: "",
    camera: "",
    audio: "",
    seconds: "",
  }));
}

/** A length typed in the box: a number of seconds 0–600, or null when empty or not a number. */
export function parseSeconds(value: string): number | null {
  const trimmed = value.trim().replace(/(?:s|초)$/i, "").trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(STORYBOARD_LIMITS.secondsMax, Math.round(n * 10) / 10);
}

/** The cut's words as the contract takes them. */
export function cutText(cut: DraftCut): Required<FrameTextInput> {
  const opt = (v: string) => (v.trim() ? v.trim() : null);
  return {
    scene: opt(cut.scene),
    shot: opt(cut.shot),
    description: cut.description.trim(),
    camera: opt(cut.camera),
    audio: opt(cut.audio),
    seconds: parseSeconds(cut.seconds),
  };
}

function frameText(f: StoryboardFrameDetail): Required<FrameTextInput> {
  return {
    scene: f.scene,
    shot: f.shot,
    description: (f.description ?? "").trim(),
    camera: f.camera,
    audio: f.audio,
    seconds: f.seconds,
  };
}

const sameText = (a: Required<FrameTextInput>, b: Required<FrameTextInput>) =>
  a.scene === b.scene && a.shot === b.shot && a.description === b.description && a.camera === b.camera && a.audio === b.audio && a.seconds === b.seconds;

/** Pasted text, one paragraph per cut from the first: the cuts and how many paragraphs were left over. */
export function applyParagraphs(cuts: readonly DraftCut[], text: string): { cuts: DraftCut[]; leftover: number } {
  const paragraphs = splitParagraphs(text);
  const next = cuts.map((cut, i) => (i < paragraphs.length ? { ...cut, description: paragraphs[i]! } : cut));
  return { cuts: next, leftover: Math.max(0, paragraphs.length - cuts.length) };
}

export function moveCut<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item!);
  return next;
}

export interface SavePlan {
  /** Saved cuts the user removed. */
  deletes: string[];
  /** Saved cuts whose words changed. */
  updates: Array<Required<FrameTextInput> & { frameId: string }>;
  /** Cuts with a new picture, in board order. */
  uploads: DraftCut[];
  /** True when the order of saved cuts changed or a new cut was placed anywhere but the end. */
  reorder: boolean;
}

export function planSave(original: readonly StoryboardFrameDetail[], cuts: readonly DraftCut[]): SavePlan {
  const byId = new Map(original.map((f) => [f.id, f]));
  const kept = new Set(cuts.filter((c) => c.id).map((c) => c.id!));
  const deletes = original.filter((f) => !kept.has(f.id)).map((f) => f.id);
  const updates: SavePlan["updates"] = [];
  for (const cut of cuts) {
    if (!cut.id) continue;
    const before = byId.get(cut.id);
    if (!before) continue;
    const text = cutText(cut);
    if (!sameText(text, frameText(before))) updates.push({ ...text, frameId: cut.id });
  }
  const uploads = cuts.filter((c) => c.file);
  const keptOrder = cuts.filter((c) => c.id).map((c) => c.id!);
  const originalOrder = original.filter((f) => kept.has(f.id)).map((f) => f.id);
  const savedFirst = cuts.findIndex((c) => !c.id) === -1 || cuts.slice(cuts.findIndex((c) => !c.id)).every((c) => !c.id);
  const reorder = keptOrder.join() !== originalOrder.join() || !savedFirst;
  return { deletes, updates, uploads, reorder };
}

export function isDirty(original: readonly StoryboardFrameDetail[], cuts: readonly DraftCut[], title: string, originalTitle: string): boolean {
  if (title.trim() !== originalTitle.trim()) return true;
  const plan = planSave(original, cuts);
  return plan.deletes.length > 0 || plan.updates.length > 0 || plan.uploads.length > 0 || plan.reorder;
}
