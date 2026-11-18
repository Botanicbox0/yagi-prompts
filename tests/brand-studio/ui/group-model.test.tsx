import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Dock, type DockProps } from "@/components/brand-studio/dock";
import { fill } from "@/components/brand-studio/copy";
import { buildJob, initialDraft, withModel, type DockDraft } from "@/components/brand-studio/dock-model";
import { Wall } from "@/components/brand-studio/gallery/wall";
import {
  buildGroupJob,
  checkBlock,
  draftFor,
  groupControls,
  groupCredits,
  groupEnhanceInputs,
  groupProblem,
  groupQuotes,
  groupSiblings,
  isGroupDraft,
  nearestAspect,
  nearestResolution,
  orderGroups,
  pickedModels,
  readStoredPick,
  reconcileTabs,
  reusableModels,
  sharedLabel,
  toggledPick,
  withModels,
  writeStoredPick,
  type DesignTabs,
} from "@/components/brand-studio/group-model";
import { trayItemFromAsset, type TrayItem } from "@/components/brand-studio/refs";
import { planReuse } from "@/components/brand-studio/reuse-model";
import { movedLine } from "@/components/brand-studio/use-dock";
import { SiblingSwitcher } from "@/components/brand-studio/viewer";
import { ModelCompare, canCompareModels, compareEntries, resultCredits } from "@/components/brand-studio/gallery/model-compare";
import type { StudioJobView } from "@/lib/brand-studio/contracts";
import { creditsOf } from "@/lib/brand-studio/credits";
import { selectableModels, type StudioImageModel } from "@/lib/brand-studio/models";
import { imageRunKrw } from "@/lib/brand-studio/usage-rate";
import { ORG, allowance, asset, copyFor, job, output } from "./fixtures";

/**
 * One request on two or three image models (founder 2026-11-19): the pick, the shared options, the
 * credits, one Prompt Architect design per model in its own tab, the wall and the viewer.
 */
const ko = copyFor("ko");
const en = copyFor("en");
const image = (patch: Partial<DockDraft> = {}): DockDraft => ({ ...initialDraft("image"), prompt: "흰 대리석 위 유리병", ...patch });
const pick = (ids: string[], patch: Partial<DockDraft> = {}) => withModels(image(patch), ids).draft;
const refs = (n: number): TrayItem[] => Array.from({ length: n }, (_, i) => trayItemFromAsset(asset(i + 1)));

function render(patch: Partial<DockProps> = {}, locale: "ko" | "en" = "ko") {
  const props: DockProps = {
    mode: "image",
    draft: image(),
    tray: [],
    labels: [],
    copy: copyFor(locale),
    locale,
    allowance: allowance(),
    credits: 15,
    busy: false,
    message: null,
    film: null,
    uploading: [],
    onDraft: () => {},
    onTrayUpdate: () => {},
    onTrayRemove: () => {},
    onSubmit: () => {},
    onDropSource: () => {},
    onFiles: () => {},
    onBrowse: () => {},
    onEnhance: () => {},
    onUndoEnhance: () => {},
    onModels: () => {},
    ...patch,
  };
  return renderToStaticMarkup(<Dock {...props} />);
}
const optionsOf = (html: string, control: string) => {
  const block = html.match(new RegExp(`data-studio-pick-list="${control}"[\\s\\S]*?</div></div>`))?.[0] ?? "";
  return [...block.matchAll(/role="option"[^>]*data-value="([^"]*)"/g)].map((m) => m[1]);
};

describe("the pick", () => {
  it("is one model until a second is checked, in the order they were checked, at most three", () => {
    const one = image();
    expect(pickedModels(one)).toEqual(["seedream-5.5"]);
    expect(isGroupDraft(one)).toBe(false);
    const two = pick(["nano-banana-pro", "seedream-5.5"]);
    expect(two.model).toBe("nano-banana-pro");
    expect(pickedModels(two)).toEqual(["nano-banana-pro", "seedream-5.5"]);
    expect(isGroupDraft(two)).toBe(true);
    const four = withModels(image(), ["seedream-5.5", "nano-banana-pro", "nano-banana-2.1", "gpt-image-2.6-flare"]).draft;
    expect(pickedModels(four)).toHaveLength(3);
    // A model no screen offers never joins the pick.
    expect(pickedModels(withModels(image(), ["seedream-5.5", "seedream-5-flash"]).draft)).toEqual(["seedream-5.5"]);
  });

  it("adds a check at the end, takes one out, never the last, and closes checks when three are picked", () => {
    const one = image();
    expect(toggledPick(one, [], "seedream-5.5")).toEqual(["seedream-5.5"]);
    const two = pick(["seedream-5.5", "nano-banana-pro"]);
    expect(toggledPick(two, [], "gpt-image-2.6-flare")).toEqual(["seedream-5.5", "nano-banana-pro", "gpt-image-2.6-flare"]);
    expect(toggledPick(two, [], "seedream-5.5")).toEqual(["nano-banana-pro"]);
    const three = pick(["seedream-5.5", "nano-banana-pro", "nano-banana-2.1"]);
    expect(checkBlock(three, [], "gpt-image-2.6-flare")).toEqual({ kind: "full", max: 3 });
    expect(toggledPick(three, [], "gpt-image-2.6-flare")).toEqual(["seedream-5.5", "nano-banana-pro", "nano-banana-2.1"]);
    expect(checkBlock(three, [], "seedream-5.5")).toBeNull();
  });

  it("refuses a model whose reference limit the tray already exceeds, rather than dropping references", () => {
    // Every listed model takes at least the tray's own limit today, so the rule is checked on the numbers it reads.
    const lowest = Math.min(...(selectableModels("image") as StudioImageModel[]).map((m) => m.maxReferences));
    expect(checkBlock(image(), refs(lowest), "nano-banana-pro")).toBeNull();
    const fewer = selectableModels("image").find((m) => (m as StudioImageModel).maxReferences === lowest)!;
    const over = refs(lowest + 1);
    expect(checkBlock(pick(["gpt-image-2.6-flare"]), over, fewer.id)).toEqual({ kind: "references", max: lowest, have: lowest + 1 });
    expect(toggledPick(pick(["gpt-image-2.6-flare"]), over, fewer.id)).toEqual(["gpt-image-2.6-flare"]);
    expect(groupControls(["gpt-image-2.6-flare", "nano-banana-2.1"]).maxReferences).toBe(14);
    expect(groupControls(["gpt-image-2.6-flare", "seedream-5.5", "nano-banana-2.1"]).maxReferences).toBe(10);
  });
});

describe("shared options", () => {
  it("offers only what every picked model has", () => {
    const c = groupControls(["seedream-5.5", "gpt-image-2.6-flare"]);
    expect(c.aspects).toEqual(["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"]);
    expect(c.resolutions).toEqual(["1K", "2K"]);
    expect(c.qualities).toEqual(["low", "medium", "high"]);
    expect(c.qualityModels.map((m) => m.id)).toEqual(["gpt-image-2.6-flare"]);
    const nano = groupControls(["nano-banana-pro", "seedream-5.5"]);
    expect(nano.aspects).toEqual(["1:1", "3:4", "2:3", "9:16", "4:3", "3:2", "16:9", "21:9"]);
    expect(nano.resolutions).toEqual(["1K", "2K"]);
    expect(nano.qualities).toEqual([]);
  });

  it("moves a value a new model lacks to the nearest common one and says which", () => {
    expect(nearestAspect("21:9", ["1:1", "4:3", "16:9", "9:16"])).toBe("16:9");
    expect(nearestAspect("4:5", ["1:1", "3:4", "4:3"])).toBe("3:4");
    expect(nearestResolution("4K", ["1K", "2K"])).toBe("2K");
    expect(nearestResolution("1.5K", ["1K", "2K"])).toBe("2K");
    const wide = withModel(image(), "nano-banana-pro");
    // GPT Image has no 21:9 but has 4K: only the ratio moves.
    const { draft, moved } = withModels({ ...wide, aspect: "21:9", resolution: "4K" }, ["nano-banana-pro", "gpt-image-2.6-flare"]);
    expect(draft).toMatchObject({ aspect: "16:9", resolution: "4K", quality: "medium" });
    expect(moved).toEqual([{ key: "aspect", from: "21:9", to: "16:9" }]);
    // Seedream 5.5 stops at 2K: the size moves too.
    const both = withModels({ ...wide, aspect: "4:5", resolution: "4K" }, ["nano-banana-pro", "seedream-5.5"]);
    expect(both.draft).toMatchObject({ aspect: "3:4", resolution: "2K" });
    expect(both.moved).toEqual([
      { key: "aspect", from: "4:5", to: "3:4" },
      { key: "resolution", from: "4K", to: "2K" },
    ]);
    // Each change keeps together on one line (no-break spaces inside it).
    expect(movedLine(both.moved, ko)).toBe("고른 모델이 모두 지원하도록 바꿨어요. 비율 4:5 → 3:4, 해상도 4K → 2K");
    expect(movedLine(moved, en)).toBe("Changed to fit every model you picked: Ratio 21:9 → 16:9");
    expect(movedLine([], ko)).toBeNull();
    // Taking a model out only widens the choice: nothing moves.
    expect(withModels(draft, ["nano-banana-pro"]).moved).toEqual([]);
    expect(withModels(pick(["seedream-5.5", "nano-banana-pro"]), ["seedream-5.5", "nano-banana-pro", "nano-banana-2.1"]).moved).toEqual([]);
  });

  it("keeps the GPT Image quality for the models that have one and drops it for the others", () => {
    const g = pick(["seedream-5.5", "gpt-image-2.6-sunburst"], { quality: "high" });
    expect(draftFor(g, "gpt-image-2.6-sunburst").quality).toBe("high");
    expect(draftFor(g, "seedream-5.5").quality).toBe("");
    expect(sharedLabel(groupControls(["gpt-image-2.6-flare", "gpt-image-2.6-sunburst"]).qualityModels)).toBe("GPT Image 2.6");
    expect(sharedLabel(groupControls(["seedream-5.5", "gpt-image-2.6-flare"]).qualityModels)).toBe("GPT Image 2.6 Flare");
    expect(sharedLabel(groupControls(["seedream-5.5", "gpt-image-2.6-flare", "gpt-image-2.6-sunburst"]).qualityModels, true)).toBe("GPT");
  });
});

describe("credits", () => {
  it("quotes each model with the single run's arithmetic and shows the sum (two and three models)", () => {
    const cases: Array<{ ids: string[]; patch: Partial<DockDraft>; tray: number }> = [
      { ids: ["seedream-5.5", "nano-banana-pro"], patch: { aspect: "4:3", resolution: "2K", count: 2 }, tray: 1 },
      { ids: ["gpt-image-2.6-flare", "seedream-5.5"], patch: { aspect: "16:9", resolution: "1K", count: 1, quality: "high" }, tray: 3 },
      { ids: ["nano-banana-2.1", "gpt-image-2.6-sunburst", "seedream-5.5"], patch: { aspect: "1:1", resolution: "2K", count: 3, quality: "low" }, tray: 2 },
    ];
    for (const { ids, patch, tray } of cases) {
      const draft = pick(ids, patch);
      const quotes = groupQuotes(draft, refs(tray));
      expect(quotes.map((q) => q.model.id)).toEqual(ids);
      for (const q of quotes) {
        const own = draftFor(draft, q.model.id);
        const krw = imageRunKrw({ model: q.model.id, resolution: own.resolution, references: tray, count: own.count, quality: own.quality || null, aspect: own.aspect });
        expect(q.krw).toBe(krw);
        expect(q.credits).toBe(creditsOf(krw));
      }
      expect(groupCredits(draft, refs(tray))).toBe(quotes.reduce((s, q) => s + q.credits, 0));
    }
  });
});

describe("what a press sends", () => {
  const ids = { organizationId: ORG, requestId: "grp0001press" };

  it("sends the typed words to every model, each with its own quality, as one group request", () => {
    const draft = pick(["seedream-5.5", "gpt-image-2.6-flare"], { quality: "high", count: 2, aspect: "3:2", resolution: "2K" });
    const built = buildGroupJob(draft, refs(2), ids, null);
    expect(built).toEqual({
      ok: true,
      input: {
        kind: "image",
        organizationId: ORG,
        requestId: "grp0001press",
        prompt: "흰 대리석 위 유리병",
        enhance: true,
        references: [{ assetId: asset(1).id }, { assetId: asset(2).id }],
        aspect: "3:2",
        resolution: "2K",
        count: 2,
        runs: [{ model: "seedream-5.5" }, { model: "gpt-image-2.6-flare", quality: "high" }],
      },
    });
  });

  it("sends a designed tab as that model's reviewed sentence; a tab left as typed follows the switch", () => {
    const draft = pick(["seedream-5.5", "nano-banana-pro", "nano-banana-2.1"]);
    const tabs: DesignTabs = {
      "seedream-5.5": { status: "ready", text: "Image 1 bottle on white marble, Seedream wording" },
      "nano-banana-pro": { status: "failed", text: draft.prompt },
      "nano-banana-2.1": { status: "pending", text: draft.prompt },
    };
    const built = buildGroupJob(draft, refs(1), ids, tabs);
    expect(built.ok && built.input.runs).toEqual([
      { model: "seedream-5.5", reviewedPrompt: "Image 1 bottle on white marble, Seedream wording" },
      { model: "nano-banana-pro" },
      { model: "nano-banana-2.1" },
    ]);
    expect(built.ok && built.input.enhance).toBe(true);
  });

  it("stops on what would stop each model: no words, a mention with nothing attached in any tab", () => {
    expect(groupProblem(pick(["seedream-5.5", "nano-banana-pro"], { prompt: " " }), [], null)).toEqual({ kind: "empty_prompt" });
    const draft = pick(["seedream-5.5", "nano-banana-pro"]);
    const tabs: DesignTabs = { "seedream-5.5": { status: "ready", text: "the bottle from Image 2" }, "nano-banana-pro": { status: "ready", text: "image 1" } };
    expect(groupProblem(draft, refs(1), tabs)).toMatchObject({ kind: "missing" });
    expect(buildGroupJob(draft, refs(1), ids, tabs).ok).toBe(false);
  });

  it("asks Prompt Architect once per model, each in its own model's request", () => {
    const draft = pick(["seedream-5.5", "gpt-image-2.6-sunburst"], { quality: "low" });
    const asked = groupEnhanceInputs(draft, refs(1), ORG);
    expect(asked.ok).toBe(true);
    if (!asked.ok) return;
    expect(asked.inputs.map((entry) => [entry.model, entry.input.model, "quality" in entry.input ? entry.input.quality : undefined])).toEqual([
      ["seedream-5.5", "seedream-5.5", undefined],
      ["gpt-image-2.6-sunburst", "gpt-image-2.6-sunburst", "low"],
    ]);
  });

  it("leaves the single bar's request exactly as it was", () => {
    const one = withModel(image({ quality: "high" }), "gpt-image-2.6-flare");
    expect(one.models).toBeUndefined();
    expect(withModels(one, ["gpt-image-2.6-flare"]).draft).toEqual(one);
    const built = buildJob(one, refs(1), ids);
    expect(built).toEqual({
      ok: true,
      input: {
        kind: "image",
        organizationId: ORG,
        requestId: "grp0001press",
        model: "gpt-image-2.6-flare",
        prompt: "흰 대리석 위 유리병",
        enhance: true,
        references: [{ assetId: asset(1).id }],
        aspect: "4:3",
        resolution: "2K",
        count: 1,
        quality: "high",
      },
    });
    // Back to one model from a group: the same single draft as a fresh pick of that model.
    expect(withModels(pick(["gpt-image-2.6-flare", "seedream-5.5"], { quality: "high" }), ["gpt-image-2.6-flare"]).draft).toEqual(withModel(pick(["gpt-image-2.6-flare", "seedream-5.5"], { quality: "high" }), "gpt-image-2.6-flare"));
  });
});

describe("tabs after a change of pick", () => {
  it("keeps designed tabs of models still picked, drops removed ones, adds a new one as not designed yet", () => {
    const tabs: DesignTabs = { a: { status: "ready", text: "A" }, b: { status: "ready", text: "B" } };
    expect(reconcileTabs(tabs, "own", ["a", "c"])).toEqual({ a: { status: "ready", text: "A" }, c: { status: "pending", text: "own" } });
  });
});

describe("remembering a pick of several models", () => {
  it("keeps 2 or 3 offered models per organization and forgets a single pick", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    writeStoredPick(storage, ORG, ["nano-banana-pro", "seedream-5.5"]);
    expect(readStoredPick(storage, ORG)).toEqual(["nano-banana-pro", "seedream-5.5"]);
    expect(readStoredPick(storage, "other-org")).toBeNull();
    writeStoredPick(storage, ORG, ["seedream-5.5"]);
    expect(readStoredPick(storage, ORG)).toBeNull();
    store.set(`twings.studio.models:${ORG}`, JSON.stringify(["seedream-5-flash", "seedream-5.5"]));
    expect(readStoredPick(storage, ORG)).toBeNull();
    store.set(`twings.studio.models:${ORG}`, "{not json");
    expect(readStoredPick(storage, ORG)).toBeNull();
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(readStoredPick(blocked, ORG)).toBeNull();
    expect(() => writeStoredPick(blocked, ORG, ["a", "b"])).not.toThrow();
  });
});

const G = { id: "g-1", models: ["nano-banana-pro", "seedream-5.5", "gpt-image-2.6-flare"] };
const groupRuns = (): StudioJobView[] => [
  job(3, { model: "seedream-5.5", group: G, createdAt: "2026-11-19T05:00:00Z", outputs: [output(31, { jobId: "j3" })] }),
  job(4, { model: "gpt-image-2.6-flare", group: G, quality: "high", createdAt: "2026-11-19T05:00:00Z", status: "failed", errorCode: "provider_rejected", outputs: [] }),
  job(5, { model: "nano-banana-pro", group: G, createdAt: "2026-11-19T05:00:00Z", outputs: [output(51, { jobId: "j5" })] }),
];

describe("results", () => {
  it("puts a group's runs side by side in the order the models were picked", () => {
    const lone = job(9, { createdAt: "2026-11-19T06:00:00Z" });
    const older = job(1, { createdAt: "2026-11-18T01:00:00Z" });
    const ordered = orderGroups([lone, ...groupRuns(), older]);
    expect(ordered.map((j) => j.model)).toEqual(["seedream-5.5", "nano-banana-pro", "seedream-5.5", "gpt-image-2.6-flare", "seedream-5.5"]);
    expect(ordered[0]).toBe(lone);
    expect(ordered[4]).toBe(older);
    const runs = groupRuns();
    expect(groupSiblings(runs[0]!, runs).map((j) => j.model)).toEqual(G.models);
  });

  it("marks each result of a group with its model on the wall", () => {
    const html = renderToStaticMarkup(
      <Wall
        mode="image"
        jobs={orderGroups(groupRuns())}
        copy={ko}
        locale="ko"
        canGenerate
        canEdit
        library={{ ready: true, liked: new Set(), folders: [], toggleLike: async () => true, addToFolder: async () => true, createFolder: async () => null } as never}
        parentOf={() => null}
        onAction={() => {}}
        onRetry={() => {}}
        onNotice={() => {}}
        now={new Date("2026-11-19T07:00:00Z")}
      />,
    );
    expect([...html.matchAll(/data-studio-tile-model="([^"]+)"/g)].map((m) => m[1])).toEqual(["nano-banana-pro", "seedream-5.5", "gpt-image-2.6-flare"]);
    // Every tile of the group (results and the failed one) can be outlined together; none is lit at rest.
    expect([...html.matchAll(/class="bs-tile"[^>]*data-group="([^"]+)"/g)].map((m) => m[1])).toEqual(["g-1", "g-1", "g-1"]);
    expect(html).not.toContain("data-group-lit");
    // A lone run carries no model badge and nothing to outline.
    const lone = renderToStaticMarkup(<Wall mode="image" jobs={[job(1, { outputs: [output(1)] })]} copy={ko} locale="ko" canGenerate canEdit library={{ ready: true, liked: new Set(), folders: [] } as never} parentOf={() => null} onAction={() => {}} onRetry={() => {}} onNotice={() => {}} />);
    expect(lone).not.toContain("data-studio-tile-model");
    expect(lone).not.toContain("data-group");
  });

  it("switches between results made together, keeping a failed one in the row with its reason", () => {
    const runs = orderGroups(groupRuns());
    const shown = runs[0]!;
    const html = renderToStaticMarkup(<SiblingSwitcher job={shown} output={shown.outputs[0]!} siblings={groupSiblings(shown, runs)} copy={ko} onOpen={() => {}} />);
    expect(html).toContain(ko.viewer.siblings);
    expect([...html.matchAll(/data-sibling="([^"]+)"/g)].map((m) => m[1])).toEqual(G.models);
    expect(html).toMatch(/aria-current="true"[^>]*>Nano Banana Pro</);
    expect(html).toContain('aria-label="Seedream 5.5 결과 보기"');
    expect(html).toMatch(/data-sibling="gpt-image-2.6-flare" data-state="failed"/);
    expect(html).toContain(ko.errors.provider_rejected);
    expect(html).toContain('data-studio-sibling-note="failed"');
    // A run made alone has no switcher.
    expect(renderToStaticMarkup(<SiblingSwitcher job={job(1)} output={null} siblings={[job(1)]} copy={ko} onOpen={() => {}} />)).toBe("");
  });

  it("lays every model side by side in 모델 비교, a failed one as a quiet tile, never a wipe line", () => {
    const runs = orderGroups(groupRuns()).map((run) => (run.outputs.length ? { ...run, estimateKrw: 220, countedOutputs: 1 } : run));
    const [nano, seedream] = runs;
    // Different shapes on purpose: each keeps its own ratio (a portrait and a landscape at one height).
    const portrait = { ...seedream!, outputs: [{ ...seedream!.outputs[0]!, width: 768, height: 1024 }] };
    const set = [nano!, portrait, runs[2]!];
    const entries = compareEntries(nano!, nano!.outputs[0]!, set, ko);
    expect(entries.map((e) => [e.run.model, Boolean(e.output), e.current, e.credits, e.reason])).toEqual([
      ["nano-banana-pro", true, true, 22, null],
      ["seedream-5.5", true, false, 22, null],
      ["gpt-image-2.6-flare", false, false, null, ko.errors.provider_rejected],
    ]);
    expect(canCompareModels(entries)).toBe(true);
    expect(resultCredits(nano!)).toBe(22);
    const html = renderToStaticMarkup(<ModelCompare entries={entries} copy={ko} locale="ko" onOpen={() => {}} />);
    expect(html).not.toContain('type="range"');
    expect([...html.matchAll(/data-compare-model="([^"]+)"/g)].map((m) => m[1])).toEqual(["nano-banana-pro", "seedream-5.5", "gpt-image-2.6-flare"]);
    // Each picture's own shape drives its width at the shared height.
    expect(html).toMatch(/data-compare-model="nano-banana-pro" data-current="" style="--r:1.3333"/);
    expect(html).toMatch(/data-compare-model="seedream-5.5" style="--r:0.7500"/);
    expect(html).toContain('aria-label="Seedream 5.5 결과 보기"');
    expect(html).toContain(`<span class="bs-mcompare-credits bs-num">22 크레딧</span>`);
    expect(html).toMatch(/class="bs-mcompare-empty" data-state="failed"><span class="bs-mcompare-empty-why">[^<]+<\/span><\/div><figcaption class="bs-mcompare-caption"><span class="bs-mcompare-name">GPT Image 2.6 Flare<\/span><\/figcaption>/);
    expect(html).toContain('data-studio-compare-at="true">1 / 3</span>');
    // One model with a picture is nothing to compare.
    expect(canCompareModels(compareEntries(nano!, nano!.outputs[0]!, [nano!, runs[2]!], ko))).toBe(false);
    const off = renderToStaticMarkup(<SiblingSwitcher job={nano!} output={nano!.outputs[0]!} siblings={groupSiblings(nano!, runs)} copy={ko} onOpen={() => {}} onCompare={() => {}} />);
    expect(off).toMatch(/aria-pressed="false" data-studio-compare-models="true">[\s\S]*모델 비교/);
    const on = renderToStaticMarkup(<SiblingSwitcher job={nano!} output={nano!.outputs[0]!} siblings={groupSiblings(nano!, runs)} copy={ko} onOpen={() => {}} onCompare={() => {}} comparing />);
    expect(on).toContain('aria-pressed="true"');
    // Nothing to compare with: no toggle.
    const alone = groupSiblings(nano!, runs).map((run) => (run.id === nano!.id ? run : { ...run, outputs: [], status: "failed" as const }));
    expect(renderToStaticMarkup(<SiblingSwitcher job={nano!} output={nano!.outputs[0]!} siblings={alone} copy={ko} onOpen={() => {}} onCompare={() => {}} />)).not.toContain("data-studio-compare-models");
  });

  it("brings the whole pick back on 이 설정 다시 쓰기, with the typed words and the group's quality", () => {
    const runs = groupRuns();
    const pressed = runs[0]!;
    const plan = planReuse({ ...pressed, prompt: "흰 대리석 위 유리병", finalPrompt: "ENHANCED", aspect: "3:2" }, {
      current: image({ prompt: "" }),
      lookup: { asset: () => null, output: () => null },
      outputName: "결과",
      siblings: groupSiblings(pressed, runs),
    });
    expect(plan.to).toBe("dock");
    if (plan.to !== "dock") return;
    expect(pickedModels(plan.draft)).toEqual(G.models);
    expect(plan.draft).toMatchObject({ model: "nano-banana-pro", prompt: "흰 대리석 위 유리병", enhance: true, aspect: "3:2", quality: "high" });
    expect(plan.reviewed).toBeNull();
    // A model that is no longer offered is left out; one model left is the single bar.
    expect(reusableModels({ model: "seedream-5.5", group: { id: "g", models: ["seedream-5-flash", "seedream-5.5"] } })).toEqual(["seedream-5.5"]);
    const lone = planReuse({ ...pressed, group: { id: "g", models: ["seedream-5-flash", "seedream-5.5"] } }, { current: pick(["seedream-5.5", "nano-banana-pro"]), lookup: { asset: () => null, output: () => null }, outputName: "결과" });
    expect(lone.to === "dock" && lone.draft.models).toBeUndefined();
    // A single run reused over a bar with several models brings back that one model.
    const single = planReuse(job(7, { model: "nano-banana-2.1" }), { current: pick(["seedream-5.5", "nano-banana-pro"]), lookup: { asset: () => null, output: () => null }, outputName: "결과" });
    expect(single.to === "dock" && pickedModels(single.draft)).toEqual(["nano-banana-2.1"]);
  });
});

describe("the bar", () => {
  it("keeps the single chip and list of one model with checks only on the image screen", () => {
    const single = render({ initialModelMenu: true, onModels: undefined });
    expect(single).not.toContain("data-model-check");
    expect(single).not.toContain("aria-multiselectable");
    const multi = render({ initialModelMenu: true });
    expect(multi).toContain('aria-multiselectable="true"');
    expect([...multi.matchAll(/data-model-check="([^"]+)"/g)].map((m) => m[1])).toEqual(selectableModels("image").map((m) => m.id));
    expect(multi).toContain(ko.dock.modelMenuHint);
    // The only picked model cannot be unchecked.
    expect(multi).toMatch(/data-model-check="seedream-5.5" data-checked="" data-closed=""/);
    const video = render({ mode: "video", draft: initialDraft("video"), initialModelMenu: true });
    expect(video).not.toContain("data-model-check");
  });

  it("shows the first model and +N on the chip, and the reason when three are picked", () => {
    const two = render({ draft: pick(["nano-banana-pro", "seedream-5.5"]) });
    expect(two).toMatch(/aria-label="모델: Nano Banana Pro, Seedream 5.5"/);
    expect(two).toMatch(/<span class="bs-chip-value">Nano Banana Pro<\/span><span class="bs-chip-more bs-num" data-studio-model-more="true" aria-hidden="true">\+1<\/span>/);
    const three = render({ draft: pick(["nano-banana-pro", "seedream-5.5", "nano-banana-2.1"]), initialModelMenu: true });
    expect(three).toContain("+2");
    expect(three).toContain(`data-studio-model-limit="true">${ko.dock.modelLimit.replace("{n}", "3")}`);
    expect(three).toMatch(/data-model-check="gpt-image-2.6-flare" data-closed=""/);
  });

  it("offers only shared ratios and sizes, counts per model, and quality for the GPT model only", () => {
    const draft = pick(["seedream-5.5", "gpt-image-2.6-flare"]);
    expect(optionsOf(render({ draft, initialOpenControl: "aspect" }), "aspect")).toEqual(groupControls(["seedream-5.5", "gpt-image-2.6-flare"]).aspects);
    expect(optionsOf(render({ draft, initialOpenControl: "resolution" }), "resolution")).toEqual(["1K", "2K"]);
    const html = render({ draft, initialOpenControl: "quality" });
    expect(optionsOf(html, "quality")).toEqual(["low", "medium", "high"]);
    expect(html).toContain('<span class="bs-chip-tag" aria-hidden="true">GPT</span>');
    expect(html).toContain('aria-label="GPT Image 2.6 Flare 품질: ');
    expect(html).toContain(`data-studio-pick-note="true">${fill(ko.dock.qualityOnly, { model: "GPT Image 2.6 Flare" })}`);
    expect(render({ draft })).toContain(">모델당 1장<");
    expect(render({ draft }, "en")).toContain(">1 per model<");
    expect(render({ draft: pick(["seedream-5.5", "nano-banana-pro"]) })).not.toContain('data-control="quality"');
  });

  it("shows each model's credits under the button, which shows their sum", () => {
    const draft = pick(["seedream-5.5", "nano-banana-pro"], { count: 2 });
    const quotes = groupQuotes(draft, []);
    const html = render({ draft, credits: groupCredits(draft, []) });
    const line = html.match(/data-studio-breakdown[\s\S]*?<\/p>/)?.[0] ?? "";
    for (const q of quotes) expect(line).toContain(`data-model="${q.model.id}"><span class="bs-breakdown-name">${q.model.label}</span><span class="bs-breakdown-cost">${q.credits} 크레딧</span>`);
    expect(html).toContain(`data-studio-quote="true">${groupCredits(draft, [])} 크레딧`);
    expect(render({ draft: image() })).not.toContain("data-studio-breakdown");
  });

  it("shows one tab per model after designing, with the field and its reference marks on the active tab", () => {
    const draft = pick(["seedream-5.5", "nano-banana-pro", "nano-banana-2.1"]);
    const tray = refs(2);
    const tabs: DesignTabs = {
      "seedream-5.5": { status: "ready", text: "The bottle from Image 1 on the stone from Image 2" },
      "nano-banana-pro": { status: "ready", text: "Place the bottle from image 1 on image 2" },
      "nano-banana-2.1": { status: "pending", text: draft.prompt },
    };
    const html = render({ draft, tray, tabs: { tabs, active: "nano-banana-pro" }, enhanced: true });
    expect([...html.matchAll(/role="tab"[^>]*data-tab="([^"]+)"/g)].map((m) => m[1])).toEqual(["seedream-5.5", "nano-banana-pro", "nano-banana-2.1"]);
    expect(html).toMatch(/aria-selected="true"[^>]*data-tab="nano-banana-pro"/);
    expect(html).toMatch(/data-tab="nano-banana-2.1" data-status="pending"/);
    // The field and the painted layer both hold the active tab's sentence, and its mentions bind to the tray.
    expect(html).toContain(">Place the bottle from image 1 on image 2</textarea>");
    expect(html).toMatch(/<mark[^>]*data-mention-bound="true"[^>]*data-mention-keys="a:[^"]+"[^>]*>image 1<\/mark>/);
    expect(html).toMatch(/<mark[^>]*data-mention-bound="true"[^>]*>image 2<\/mark>/);
    expect(html).toContain("Nano Banana Pro 프롬프트");
    // A tab not designed yet says so and offers to design just that model.
    const pending = render({ draft, tray, tabs: { tabs, active: "nano-banana-2.1" }, enhanced: true });
    expect(pending).toContain(`data-studio-tab-state="pending"><span>${ko.dock.tabPending}</span>`);
    expect(pending).toContain(`data-studio-design-one="nano-banana-2.1"`);
    expect(pending).toContain(`>${draft.prompt}</textarea>`);
    const failed = render({ draft, tray, tabs: { tabs: { ...tabs, "seedream-5.5": { status: "failed", text: draft.prompt } }, active: "seedream-5.5" }, enhanced: true });
    expect(failed).toContain(`data-studio-tab-state="failed"><span>${ko.dock.enhanceFailed}</span>`);
    expect(failed).toContain(`>${ko.dock.designAgain}<`);
    // English names the tabs by model too.
    expect(render({ draft, tray, tabs: { tabs, active: "seedream-5.5" }, enhanced: true }, "en")).toContain("Prompt for Seedream 5.5");
  });

  it("names every new string in both languages, and never the same words in both", () => {
    const keys = ["modelMenuHint", "modelLimit", "modelRefLimit", "countEachLabel", "countEach", "qualityFor", "qualityOnly", "moved", "breakdown", "tabsLabel", "tabPrompt", "tabPending", "tabFailed", "designOne", "designAgain"] as const;
    for (const key of keys) {
      expect(ko.dock[key], key).toBeTruthy();
      expect(en.dock[key], key).toBeTruthy();
      expect(ko.dock[key], key).not.toBe(en.dock[key]);
    }
    expect(ko.viewer.siblings).not.toBe(en.viewer.siblings);
    expect(ko.errors.model_unavailable).not.toBe(en.errors.model_unavailable);
  });
});
