/**
 * One request on two or three image models at once (founder 2026-11-19: "이미지 모델을 2개 이상을 동시
 * 선택해서 만드는 것도 가능하게 … 동일한 레퍼런스들 넣었을때 각 프롬프트별 로직이 따로 들어가서 이미지가 2장이
 * 나오게"). Pure functions only: the screen keeps the state (use-dock.ts) and draws it (dock.tsx).
 *
 *  - The pick: 1 to 3 image models in the order they were checked; the first is `draft.model`, so every
 *    single-model path keeps working when one is picked.
 *  - Options are the intersection: a ratio or a size is offered only when every picked model has it.
 *    Adding a model that lacks the current value moves it to the nearest common one (`withModels` says
 *    which). Quality belongs to the models that have one (GPT Image) and applies to them only.
 *  - References: the smallest limit among the picked models. A model whose limit the tray already exceeds
 *    cannot be added (the menu says why); nothing is dropped.
 *  - Credits: each model priced with the single run's arithmetic (usage-rate.ts `imageRunKrw`), the same
 *    figure the server reserves for that model's job; the button shows the sum.
 *  - Prompt Architect: one design per model (its own profile). The designed sentences live in tabs, one
 *    per model; a model sends its tab as `reviewedPrompt` when it differs from the typed words, exactly as
 *    the single bar sends its reviewed sentence.
 */
import {
  STUDIO_GROUP_MODELS,
  STUDIO_LIMITS,
  type StudioJobGroupCreate,
  type StudioJobView,
} from "@/lib/brand-studio/contracts";
import { creditsOf } from "@/lib/brand-studio/credits";
import { findMissingReferences, type MentionKind } from "@/lib/brand-studio/enhancer/mentions";
import { selectableModels, studioModel, type StudioImageModel, type StudioImageQuality } from "@/lib/brand-studio/models";
import { imageRunKrw } from "@/lib/brand-studio/usage-rate";
import { enhancePreviewInput, normalizeDraft, qualityOf, withModel, type DockDraft, type DockProblem, type EnhancePreviewInput } from "./dock-model";
import { toReferences, type TrayItem } from "./refs";

export const GROUP_MAX = STUDIO_GROUP_MODELS.max;

/** The image models a screen may pick for a new run (live and listed), by id. */
function offered(id: string): StudioImageModel | null {
  return (selectableModels("image").find((m) => m.id === id) as StudioImageModel | undefined) ?? null;
}

/** The models picked in the bar, in the order they were checked: one when nothing else was. */
export function pickedModels(draft: Pick<DockDraft, "model" | "models">): string[] {
  return draft.models && draft.models.length > 1 ? [...draft.models] : [draft.model];
}

/** True when the bar sends one request on several image models. */
export function isGroupDraft(draft: Pick<DockDraft, "medium" | "model" | "models">): boolean {
  return draft.medium === "image" && pickedModels(draft).length > 1;
}

export interface GroupControls {
  models: StudioImageModel[];
  /** Ratios every picked model has, in the first model's order. */
  aspects: string[];
  /** Sizes every picked model has, in the first model's order. */
  resolutions: string[];
  /** The quality choice of the picked models that have one (GPT Image), and which models those are. */
  qualities: string[];
  qualityModels: StudioImageModel[];
  counts: number[];
  /** The fewest references any picked model takes. */
  maxReferences: number;
}

export function groupControls(ids: readonly string[]): GroupControls {
  const models = ids.map(offered).filter((m): m is StudioImageModel => Boolean(m));
  const first = models[0];
  const every = (pick: (m: StudioImageModel) => readonly string[]) =>
    first ? pick(first).filter((value) => models.every((m) => pick(m).includes(value))) : [];
  const qualityModels = models.filter((m) => (m.qualities?.length ?? 0) > 0);
  const qualities = qualityModels.length ? [...qualityModels[0]!.qualities!].filter((q) => qualityModels.every((m) => m.qualities!.includes(q))) : [];
  return {
    models,
    aspects: every((m) => m.aspects),
    resolutions: every((m) => m.resolutions),
    qualities,
    qualityModels,
    counts: Array.from({ length: STUDIO_LIMITS.imageCountMax }, (_, i) => i + 1),
    maxReferences: models.length ? Math.min(...models.map((m) => m.maxReferences)) : 0,
  };
}

const ratioOf = (aspect: string): number | null => {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect);
  return m && Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : null;
};
const sizeOf = (resolution: string): number | null => {
  const m = /^(\d+(?:\.\d+)?)K$/i.exec(resolution);
  return m ? Number(m[1]) : null;
};

/** The option whose value is closest to `value` on a log scale (ties go to the earlier option); `value` itself when unreadable. */
function nearest(value: string, options: readonly string[], measure: (v: string) => number | null): string {
  const target = measure(value);
  if (target === null || !options.length) return options[0] ?? value;
  let best = options[0]!;
  let gap = Infinity;
  for (const option of options) {
    const v = measure(option);
    if (v === null) continue;
    const d = Math.abs(Math.log(v / target));
    if (d < gap - 1e-9) {
      gap = d;
      best = option;
    }
  }
  return best;
}

/** The common ratio closest in shape to `aspect` ("21:9" with no 21:9 in common reads as "16:9"). */
export const nearestAspect = (aspect: string, options: readonly string[]) => nearest(aspect, options, ratioOf);
/** The common size closest to `resolution` ("4K" with Seedream in the pick reads as "2K"). */
export const nearestResolution = (resolution: string, options: readonly string[]) => nearest(resolution, options, sizeOf);

/** A shared option that changed because a model was added: which one, and from what to what. */
export interface MovedOption {
  key: "aspect" | "resolution";
  from: string;
  to: string;
}

/**
 * The bar on these models (1 to 3, in this order; unknown or no-longer-offered ids are left out). One model
 * is the ordinary single-model bar (`withModel`). Several keep every shared value all of them have and move
 * the rest to the nearest common value (`moved` names those); the quality stays for the models that have one.
 */
export function withModels(draft: DockDraft, ids: readonly string[]): { draft: DockDraft; moved: MovedOption[] } {
  const picked = [...new Set(ids)].filter((id) => offered(id)).slice(0, GROUP_MAX);
  if (picked.length <= 1) return { draft: withModel(draft, picked[0] ?? draft.model), moved: [] };
  const controls = groupControls(picked);
  const moved: MovedOption[] = [];
  const aspect = controls.aspects.includes(draft.aspect) ? draft.aspect : nearestAspect(draft.aspect, controls.aspects);
  if (draft.aspect && aspect !== draft.aspect) moved.push({ key: "aspect", from: draft.aspect, to: aspect });
  const resolution = controls.resolutions.includes(draft.resolution)
    ? draft.resolution
    : nearestResolution(draft.resolution || controls.models[0]!.defaultResolution, controls.resolutions);
  if (draft.resolution && resolution !== draft.resolution) moved.push({ key: "resolution", from: draft.resolution, to: resolution });
  const quality = controls.qualityModels.length ? qualityOf(controls.qualityModels[0]!, draft.quality) : draft.quality;
  const count = Math.min(STUDIO_LIMITS.imageCountMax, Math.max(1, Math.round(draft.count) || 1));
  return { draft: { ...draft, medium: "image", model: picked[0]!, models: picked, aspect, resolution, quality, count }, moved };
}

/** The bar as one model sees it (its own quality), for pricing and prompt design. */
export function draftFor(draft: DockDraft, id: string): DockDraft {
  const model = offered(id);
  const { models: _picked, ...bar } = draft;
  return normalizeDraft({ ...bar, model: id, quality: qualityOf(model, draft.quality) });
}

/* ------------------------------------------------------------------ menu */

/** Why a model's check cannot be ticked now: the pick is full, or the tray holds more than it takes. */
export type CheckBlock = { kind: "full"; max: number } | { kind: "references"; max: number; have: number };

export function checkBlock(draft: Pick<DockDraft, "model" | "models">, tray: readonly Pick<TrayItem, "kind">[], id: string): CheckBlock | null {
  const picked = pickedModels(draft);
  if (picked.includes(id)) return null;
  if (picked.length >= GROUP_MAX) return { kind: "full", max: GROUP_MAX };
  const model = offered(id);
  const have = tray.filter((item) => item.kind === "image").length;
  if (model && have > model.maxReferences) return { kind: "references", max: model.maxReferences, have };
  return null;
}

/** The pick after pressing one model's check: added at the end, or taken out (never the last one). */
export function toggledPick(draft: Pick<DockDraft, "model" | "models">, tray: readonly Pick<TrayItem, "kind">[], id: string): string[] {
  const picked = pickedModels(draft);
  if (picked.includes(id)) return picked.length > 1 ? picked.filter((m) => m !== id) : picked;
  return checkBlock(draft, tray, id) ? picked : [...picked, id];
}

/* --------------------------------------------------------------- credits */

export interface ModelQuote {
  model: StudioImageModel;
  /** This model's run, in KRW: the figure its job reserves. */
  krw: number;
  credits: number;
}

/** Each picked model's run at the bar's settings, priced exactly as the server prices that model's job. */
export function groupQuotes(draft: DockDraft, tray: readonly Pick<TrayItem, "kind">[]): ModelQuote[] {
  return pickedModels(draft).flatMap((id) => {
    const model = offered(id);
    if (!model) return [];
    const clean = draftFor(draft, id);
    const krw = imageRunKrw({ model: id, resolution: clean.resolution, references: tray.length, count: clean.count, quality: clean.quality || null, aspect: clean.aspect });
    return [{ model, krw, credits: creditsOf(krw) }];
  });
}

/** What the press takes in credits: the sum of every model's run. */
export function groupCredits(draft: DockDraft, tray: readonly Pick<TrayItem, "kind">[]): number {
  return groupQuotes(draft, tray).reduce((sum, quote) => sum + quote.credits, 0);
}

/* ------------------------------------------------------- Prompt Architect */

/**
 * One model's tab after "설계하기": `designing` while its call is out, `ready` with its designed sentence,
 * `failed` (it keeps the typed words, as the single bar does), `pending` for a model added after designing.
 */
export type DesignStatus = "designing" | "ready" | "failed" | "pending";
export interface DesignTab {
  status: DesignStatus;
  text: string;
}
export type DesignTabs = Record<string, DesignTab>;

/** Tabs for a new pick: kept for models still picked, dropped for the others, `pending` for new ones. */
export function reconcileTabs(tabs: DesignTabs, own: string, ids: readonly string[]): DesignTabs {
  const next: DesignTabs = {};
  for (const id of ids) next[id] = tabs[id] ?? { status: "pending", text: own };
  return next;
}

/** The sentence one model would be sent: its tab, else the typed words. */
export function sentenceFor(tabs: DesignTabs | null, own: string, id: string): string {
  return tabs?.[id]?.text ?? own;
}

/** `prompt.enhance` inputs, one per picked model, each written for that model's own profile. */
export function groupEnhanceInputs(
  draft: DockDraft,
  tray: readonly TrayItem[],
  organizationId: string,
  ids: readonly string[] = pickedModels(draft),
): { ok: true; inputs: Array<{ model: string; input: EnhancePreviewInput }> } | { ok: false; problem: DockProblem } {
  const inputs: Array<{ model: string; input: EnhancePreviewInput }> = [];
  for (const id of ids) {
    const preview = enhancePreviewInput(draftFor(draft, id), tray, organizationId);
    if (!preview.ok) return preview;
    inputs.push({ model: id, input: preview.input });
  }
  return { ok: true, inputs };
}

/* ----------------------------------------------------------------- send */

/** What stops the group before it is sent (the server checks again). */
export function groupProblem(draft: DockDraft, tray: readonly TrayItem[], tabs: DesignTabs | null): DockProblem | null {
  const own = draft.prompt.trim();
  if (!own) return { kind: "empty_prompt" };
  if (tray.some((item) => item.kind !== "image")) return { kind: "image_only" };
  const max = groupControls(pickedModels(draft)).maxReferences;
  if (tray.length > max) return { kind: "too_many_images", max };
  const kinds = tray.map((item) => item.kind as MentionKind);
  for (const id of pickedModels(draft)) {
    const mentions = findMissingReferences(sentenceFor(tabs, draft.prompt, id), kinds);
    if (mentions.length) return { kind: "missing", mentions };
  }
  return null;
}

/**
 * One press of "만들기" with several models as one `job.create_group` request. Every model gets the typed
 * words as `prompt`; a model whose tab holds a sentence the customer read (different from those words)
 * sends it as `reviewedPrompt` and is not rewritten again, the others follow the Architect switch.
 */
export function buildGroupJob(
  draft: DockDraft,
  tray: readonly TrayItem[],
  ids: { organizationId: string; requestId: string },
  tabs: DesignTabs | null,
): { ok: true; input: StudioJobGroupCreate } | { ok: false; problem: DockProblem } {
  // Only values every picked model has go out (the chips offer nothing else; this keeps a stale bar honest).
  const clean = withModels(draft, pickedModels(draft)).draft;
  const problem = groupProblem(clean, tray, tabs);
  if (problem) return { ok: false, problem };
  const own = clean.prompt.trim();
  const runs = pickedModels(clean).map((id) => {
    const model = offered(id);
    const quality = qualityOf(model, clean.quality);
    const shown = sentenceFor(tabs, clean.prompt, id).trim().slice(0, STUDIO_LIMITS.promptMax);
    const reviewed = shown.length > 0 && shown !== own;
    return { model: id, ...(quality ? { quality: quality as StudioImageQuality } : {}), ...(reviewed ? { reviewedPrompt: shown } : {}) };
  });
  return {
    ok: true,
    input: {
      kind: "image",
      organizationId: ids.organizationId,
      requestId: ids.requestId,
      prompt: own,
      enhance: clean.enhance,
      references: toReferences(tray, "image"),
      aspect: clean.aspect,
      resolution: clean.resolution,
      count: clean.count,
      runs,
    },
  };
}

/* --------------------------------------------------------------- results */

/**
 * The runs in wall order with each group's runs side by side in the order its models were picked. A group
 * takes the place of its newest run; runs of a group that is not fully in the list keep their own place.
 */
export function orderGroups<T extends Pick<StudioJobView, "id" | "model" | "group">>(jobs: readonly T[]): T[] {
  if (!jobs.some((job) => job.group)) return jobs as T[];
  const byGroup = new Map<string, T[]>();
  for (const job of jobs) if (job.group) byGroup.set(job.group.id, [...(byGroup.get(job.group.id) ?? []), job]);
  const placed = new Set<string>();
  const out: T[] = [];
  for (const job of jobs) {
    if (!job.group) {
      out.push(job);
      continue;
    }
    if (placed.has(job.group.id)) continue;
    placed.add(job.group.id);
    const order = job.group.models;
    const members = [...byGroup.get(job.group.id)!].sort((a, b) => rank(order, a.model) - rank(order, b.model));
    out.push(...members);
  }
  return out;
}

const rank = (order: readonly string[], id: string) => {
  const i = order.indexOf(id);
  return i < 0 ? order.length : i;
};

/** The runs made with `job` in one request (itself included), in the order the models were picked. */
export function groupSiblings<T extends Pick<StudioJobView, "id" | "model" | "group">>(job: T, jobs: readonly T[]): T[] {
  if (!job.group) return [job];
  const id = job.group.id;
  const members = jobs.filter((other) => other.group?.id === id);
  if (!members.some((other) => other.id === job.id)) members.push(job);
  return members.sort((a, b) => rank(job.group!.models, a.model) - rank(job.group!.models, b.model));
}

/** The models a group run can be set up again with: those of its group still offered, in its order. */
export function reusableModels(job: Pick<StudioJobView, "model" | "group">): string[] {
  const ids = job.group?.models ?? [job.model];
  const kept = ids.filter((id) => offered(id));
  return kept.length ? kept : [job.model];
}

/* ------------------------------------------------------------- memory */

/**
 * A pick of several models is remembered per organization in this browser, so the bar comes back with it
 * after a reload. One model is the ordinary bar, which has never been remembered: picking one forgets the
 * pick, so a reload of a single-model bar is exactly what it was.
 */
const STORAGE_PREFIX = "twings.studio.models:";

export function readStoredPick(storage: Pick<Storage, "getItem"> | null, organizationId: string): string[] | null {
  try {
    const raw = storage?.getItem(STORAGE_PREFIX + organizationId);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const ids = [...new Set(parsed.filter((v): v is string => typeof v === "string"))].filter((id) => offered(id)).slice(0, GROUP_MAX);
    return ids.length > 1 ? ids : null;
  } catch {
    return null;
  }
}

export function writeStoredPick(storage: Pick<Storage, "setItem" | "removeItem"> | null, organizationId: string, ids: readonly string[]): void {
  try {
    if (!storage) return;
    if (ids.length > 1) storage.setItem(STORAGE_PREFIX + organizationId, JSON.stringify(ids));
    else storage.removeItem(STORAGE_PREFIX + organizationId);
  } catch {
    // Blocked storage: the pick simply is not remembered.
  }
}

/**
 * The name a quality chip carries in a group ("GPT Image 2.6" for Flare and Sunburst together). `short`:
 * the family's first word only ("GPT"), for the chip itself; the list and the label name the models in full.
 */
export function sharedLabel(models: readonly Pick<StudioImageModel, "label">[], short = false): string {
  if (short && models.length) {
    const first = models[0]!.label.split(" ")[0]!;
    if (models.every((m) => m.label.split(" ")[0] === first)) return first;
  }
  if (models.length === 1) return models[0]!.label;
  const words = models.map((m) => m.label.split(" "));
  const common: string[] = [];
  for (let i = 0; i < words[0]!.length; i++) {
    const word = words[0]![i]!;
    if (words.every((w) => w[i] === word)) common.push(word);
    else break;
  }
  return common.length ? common.join(" ") : models.map((m) => m.label).join(", ");
}

/** The model a job ran on, by id, for labels. */
export function modelLabel(id: string): string {
  return studioModel(id)?.label ?? id;
}
