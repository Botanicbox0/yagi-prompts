/**
 * "이 설정 다시 쓰기" as data (2026-11-19, founder: reusing an edited image only brought back the picture
 * and the words, "좋은 경험은 아닌 것 같아"). One pure mapping from a run to what comes back:
 *
 *  - an image run → the prompt bar with its whole setting: the words the member typed (never the sentence
 *    Prompt Architect wrote), the Architect switch as it was, model, ratio, resolution, quality, count and
 *    every reference in its order with its role and notes. A reference that no longer exists is left out
 *    and named in the bar's notice line;
 *  - a partial edit → the partial-edit tool on the picture it was made FROM, with the same box, the same
 *    instruction, the same references and the same switch ("같은 영역 다시 수정하기"). When that picture is
 *    gone, the tool opens on the result itself with the same words and a one-line notice;
 *  - a video run → the bar, as before (its reviewed sentence comes back in the field);
 *  - a blueprint → the reverse panel (the screen announces it).
 *
 * What comes back is also what is quoted: the bar and the form price it with the same arithmetic as a
 * fresh run with those settings (dock-model.ts `dockCredits`, `regionCredits`).
 */
import { STUDIO_LIMITS, type StudioAssetView, type StudioJobView, type StudioOutputView, type StudioReference } from "@/lib/brand-studio/contracts";
import type { MentionKind } from "@/lib/brand-studio/enhancer/mentions";
import { dockControls, draftFromJob, type DockDraft } from "./dock-model";
import { reusableModels, withModels } from "./group-model";
import { shieldedDesignFromJob, type ShieldedDockDesign } from "./prompt-pictures";
import { trayItemFromAsset, trayItemFromOutput, type RefSource, type TrayItem } from "./refs";
import type { LayerEditorRegionPreset } from "./seams";

export type ReuseLookup = { asset(id: string): StudioAssetView | null; output(id: string): StudioOutputView | null };

/** A reference of the original run that could not be found, by the number the member saw ("이미지 2"). */
export interface MissingReference {
  kind: MentionKind | "any";
  number: number;
}

/**
 * The tray of a run, in its order, with roles, notes and frames. Missing sources are left out and
 * reported by the number they had: per kind for an image run (every reference is a picture), by tray
 * position otherwise (the kind of a deleted file is not known).
 */
export function restoreTray(
  refs: readonly StudioReference[],
  lookup: ReuseLookup,
  outputName: string,
  numbering: "image" | "any" = "any",
): { items: TrayItem[]; missing: MissingReference[] } {
  const items: TrayItem[] = [];
  const missing: MissingReference[] = [];
  refs.forEach((ref, index) => {
    const asset = ref.assetId ? lookup.asset(ref.assetId) : null;
    const output = ref.outputId ? lookup.output(ref.outputId) : null;
    const base = asset ? trayItemFromAsset(asset) : output ? trayItemFromOutput(output, outputName) : null;
    if (!base) {
      missing.push({ kind: numbering, number: index + 1 });
      return;
    }
    items.push({
      ...base,
      ...(ref.role ? { role: ref.role } : {}),
      ...(ref.use ? { use: ref.use } : {}),
      ...(ref.avoid ? { avoid: ref.avoid } : {}),
      ...(ref.frame ? { frame: ref.frame } : {}),
    });
  });
  return { items: items.slice(0, STUDIO_LIMITS.referencesMax), missing };
}

/** The Architect switch a run was sent with: on when a sentence was written for it (automatically or read first). */
export function architectWasOn(job: Pick<StudioJobView, "finalPrompt" | "architect">): boolean {
  return job.architect ?? job.finalPrompt !== null;
}

export type ReusePlan =
  | {
      to: "dock";
      draft: DockDraft;
      tray: TrayItem[];
      missing: MissingReference[];
      /** A video run's reviewed sentence: it comes back in the field, the typed words kept for "원래 문장으로". */
      reviewed: { original: string; improved: string } | null;
      /** A shielded reviewed video run: the dock shows its pictures and sends `reviewedFrom`. */
      shieldedReviewed?: ShieldedDockDesign;
    }
  | {
      to: "region";
      source: RefSource;
      /** The tool opens on the result itself because the original is gone. */
      onResult: boolean;
      preset: LayerEditorRegionPreset;
      missing: MissingReference[];
      /** The viewer's own form (no layer editor): which list and key the picture is under. */
      open: { list: "outputs" | "assets"; key: string };
    }
  | { to: "reverse"; jobId: string }
  | { to: "none" };

export function planReuse(
  job: StudioJobView,
  ctx: {
    current: DockDraft;
    lookup: ReuseLookup;
    outputName: string;
    /** The result it was pressed on (a partial edit's fallback when its original is gone). */
    from?: StudioOutputView | null;
    /** The runs made with it on other models in one request (group-model.ts `groupSiblings`). */
    siblings?: readonly StudioJobView[];
  },
): ReusePlan {
  // A preset workflow run has no setting to bring back: its sent text is server-side and never shown.
  if (job.preset) return { to: "none" };
  if (job.kind === "video_remix" && job.method === "blueprint") return { to: "reverse", jobId: job.id };
  if (job.kind === "region_edit") return planRegionReuse(job, ctx);
  if (job.kind === "image") {
    const { items, missing } = restoreTray(job.references, ctx.lookup, ctx.outputName, "image");
    const base = draftFromJob(job, ctx.current);
    // The typed words, never the written sentence; the switch as it was when it was sent.
    const draft = { ...base, prompt: job.prompt.slice(0, STUDIO_LIMITS.promptMax), enhance: architectWasOn(job) };
    return { to: "dock", draft: job.group ? groupDraft(job, draft, ctx.siblings ?? []) : draft, tray: items, missing, reviewed: null };
  }
  // Video runs: as before ("설정 다시 쓰기" brings back the sentence that was read and the typed words).
  const reviewed = job.reviewed && job.finalPrompt ? job.finalPrompt.slice(0, STUDIO_LIMITS.promptMax) : null;
  const next = draftFromJob(job, ctx.current);
  const shieldedReviewed = !reviewed ? shieldedDesignFromJob(job, dockControls(next).model.id) : null;
  const { items, missing } = restoreTray(job.references, ctx.lookup, ctx.outputName, "any");
  return {
    to: "dock",
    draft: reviewed ? { ...next, prompt: reviewed } : next,
    tray: items,
    missing,
    reviewed: reviewed ? { original: job.prompt, improved: reviewed } : null,
    ...(shieldedReviewed ? { shieldedReviewed } : {}),
  };
}

/**
 * A run made on several models at once comes back as the whole pick: every model of its group still
 * offered, in its order, with the quality the group's GPT Image run had. The typed words come back, not
 * any model's designed sentence (2026-11-19, #266).
 */
function groupDraft(job: StudioJobView, draft: DockDraft, siblings: readonly StudioJobView[]): DockDraft {
  const ids = reusableModels(job);
  if (ids.length < 2) return draft;
  const quality = [job, ...siblings].find((run) => run.quality)?.quality ?? draft.quality;
  return withModels({ ...draft, quality }, ids).draft;
}

function planRegionReuse(job: StudioJobView, ctx: Parameters<typeof planReuse>[1]): ReusePlan {
  const parentOutput = job.parentOutputId ? ctx.lookup.output(job.parentOutputId) : null;
  const parentAsset = !parentOutput && job.parentAssetId ? ctx.lookup.asset(job.parentAssetId) : null;
  const result = ctx.from ?? job.outputs.find((o) => o.kind === "image") ?? null;
  const target: { source: RefSource; open: { list: "outputs" | "assets"; key: string }; onResult: boolean } | null = parentOutput
    ? { source: { outputId: parentOutput.id }, open: { list: "outputs", key: `o:${parentOutput.id}` }, onResult: false }
    : parentAsset
      ? { source: { assetId: parentAsset.id }, open: { list: "assets", key: `a:${parentAsset.id}` }, onResult: false }
      : result
        ? { source: { outputId: result.id }, open: { list: "outputs", key: `o:${result.id}` }, onResult: true }
        : null;
  if (!target) return { to: "none" };
  const { items, missing } = restoreTray(job.references, ctx.lookup, ctx.outputName, "image");
  // The stored words are numbered for the server (the cut-out is not counted) when the switch was on.
  const serverNumbered = architectWasOn(job);
  return {
    to: "region",
    source: target.source,
    onResult: target.onResult,
    open: target.open,
    missing,
    preset: {
      box: job.box,
      instruction: job.prompt,
      serverNumbered,
      enhance: serverNumbered,
      model: job.model,
      quality: job.quality ?? null,
      references: items,
    },
  };
}
