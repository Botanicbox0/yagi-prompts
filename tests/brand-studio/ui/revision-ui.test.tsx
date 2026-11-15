import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudioJobView, StudioRevisePlan } from "@/lib/brand-studio/contracts";
import { creditsOf } from "@/lib/brand-studio/credits";
import { Wall, type WallProps } from "@/components/brand-studio/gallery/wall";
import { Viewer, shownVersion, type ViewerActions, type ViewerItem, type ViewerProps } from "@/components/brand-studio/viewer";
import { ReviseFormView, type ReviseSupport } from "@/components/brand-studio/revise-form";
import { createReviseFlow, initialReviseState, type ReviseState } from "@/components/brand-studio/revise-flow";
import { chainOf } from "@/components/brand-studio/revision-model";
import { credits, fill } from "@/components/brand-studio/copy";
import { trayItemFromAsset } from "@/components/brand-studio/refs";
import type { StudioLibrary } from "@/components/brand-studio/seams";
import { ORG, asset, copyFor, id, job, output } from "./fixtures";

/** docs/BRAND-STUDIO-V6-PLAN.md §4 — the wall's one tile per clip, the viewer's strip and the next-version form. */
type Revision = NonNullable<StudioJobView["revision"]>;
const NOW = new Date("2026-11-11T03:00:00Z");
const noop = () => {};
const clip = (n: number, patch: Partial<StudioJobView> = {}) =>
  job(n, { kind: "video", aspect: "9:16", resolution: "480p", seconds: 5, audio: "native", estimateKrw: 3000, outputs: [output(n, { kind: "video", jobId: id(0x2000 + n), width: 720, height: 1280 })], ...patch });
const ROOT = job(1).id;
const rev = (version: number, base: number, patch: Partial<Revision> = {}): Revision => ({ rootJobId: ROOT, version, baseOutputId: output(base).id, mode: "edit", added: 0, ...patch });
const v1 = clip(1);
const v2 = clip(2, { kind: "video_remix", prompt: "병을 더 크게", revision: rev(2, 1) });
const v3 = clip(3, { prompt: "배경을 밤으로", revision: rev(3, 2) });
const chainJobs = [v3, v2, v1];

const library: StudioLibrary = {
  ready: true, folders: [], liked: new Set<string>(), likedItems: [], folderItems: () => null, openFolder: noop,
  toggleLike: async () => true, createFolder: async () => null, renameFolder: async () => true, deleteFolder: async () => true,
  addToFolder: async () => true, removeFromFolder: async () => true,
};
function wall(jobs: StudioJobView[], patch: Partial<WallProps> = {}) {
  return renderToStaticMarkup(
    <Wall mode="video" jobs={jobs} copy={copyFor("ko")} locale="ko" canGenerate canEdit library={library} now={NOW} parentOf={() => null} onAction={noop} onRetry={noop} onNotice={noop} {...patch} />,
  );
}

const plan = (patch: Partial<StudioRevisePlan> = {}): StudioRevisePlan => ({
  ok: true,
  version: 4,
  methods: { edit: { available: true, estimateKrw: 1500 }, reshoot: { available: true, estimateKrw: 4500 } },
  recommended: "edit",
  reason: null,
  ...patch,
});

describe("the wall with clip versions", () => {
  it("shows one tile for a clip of three versions, marked v3", () => {
    const html = wall(chainJobs);
    expect(html.match(/data-studio-tile/g)).toHaveLength(1);
    expect(html).toContain(`data-revision-badge="3"`);
    expect(html).toContain(output(3).thumbUrl!);
    expect(html).not.toContain(output(1).thumbUrl!);
  });

  it("keeps a failed newer version on the wall so it can be tried again", () => {
    const failed = clip(4, { status: "failed", outputs: [], errorCode: "failed", revision: rev(4, 3) });
    const html = wall([failed, ...chainJobs]);
    expect(html.match(/data-studio-tile/g)).toHaveLength(1);
    expect(html).toContain(`data-state="failed" data-studio-job="${failed.id}"`);
    expect(html).toContain(`data-revision-badge="4"`);
  });

  it("leaves pictures and single clips exactly as before", () => {
    const html = wall([clip(7), job(8, { outputs: [output(8)] })], { mode: "image" });
    expect(html.match(/data-studio-tile/g)).toHaveLength(2);
    expect(html).not.toContain("data-revision-badge");
  });
});

describe("the viewer's versions", () => {
  const actions: ViewerActions = { regionEdit: async () => true, rerun: noop, toVideo: noop, reference: noop, save: noop, campaign: noop, finalize: noop, reuse: noop, remove: async () => true };
  const support = (jobs: StudioJobView[]): ReviseSupport => ({
    organizationId: ORG,
    jobs,
    recent: [trayItemFromAsset(asset(1))],
    resolve: () => null,
    upload: async () => [],
    plan: async () => plan(),
    create: async () => ({ ok: true, job: v3 }),
  });
  const render = (item: ViewerItem, jobs: StudioJobView[], patch: Partial<ViewerProps> = {}) =>
    renderToStaticMarkup(
      <Viewer items={[item]} index={0} copy={copyFor("ko")} locale="ko" canCreate canGenerate busy={null} notice={null}
        revise={support(jobs)} parentOf={() => null} onIndex={noop} onClose={noop} actions={actions} {...patch} />,
    );

  it("lists v1…vN with the open one pressed, the one being made disabled, and the form under it", () => {
    const making = clip(4, { status: "running", outputs: [], revision: rev(4, 3) });
    const html = render({ type: "output", output: v3.outputs[0]!, job: v3 }, [making, ...chainJobs]);
    const copy = copyFor("ko");
    expect(html).toContain("data-revision-strip");
    expect([...html.matchAll(/data-revision-version="(\d)"/g)].map((m) => m[1])).toEqual(["1", "2", "3", "4"]);
    expect(html).toMatch(/data-revision-version="3" aria-pressed="true"/);
    expect(html).toMatch(/data-revision-version="4" aria-pressed="false" disabled=""/);
    expect(html).toContain(copy.revise.making);
    expect(html).toContain(`data-revision-request="true">배경을 밤으로`);
    expect(html).toContain("data-revise-form");
    expect(html).toContain(`placeholder="${copy.revise.placeholder}"`);
    // What was sent is never hidden: a version keeps the "sent prompt" toggle like any other result.
    expect(html).toContain("data-studio-prompt-details");
  });

  it("shows no strip for a clip of one version, but still offers the next one; nothing for pictures or read-only members", () => {
    const single = clip(5);
    const html = render({ type: "output", output: single.outputs[0]!, job: single }, [single]);
    expect(html).not.toContain("data-revision-strip");
    expect(html).toContain("data-revise-form");
    expect(html).toContain(fill(copyFor("ko").revise.submit, { n: 2 }));
    const picture = job(6, { outputs: [output(6)] });
    expect(render({ type: "output", output: picture.outputs[0]!, job: picture }, [picture])).not.toContain("data-revise-form");
    expect(render({ type: "output", output: single.outputs[0]!, job: single }, [single], { canGenerate: false })).not.toContain("data-revise-form");
  });

  it("swaps the shown result to the picked version", () => {
    const opened: ViewerItem = { type: "output", output: v3.outputs[0]!, job: v3 };
    const chain = chainOf(chainJobs, v3);
    expect(shownVersion(opened, chain, 3, 3)).toBe(opened);
    const back = shownVersion(opened, chain, 3, 1);
    expect(back.type === "output" && back.output.id).toBe(output(1).id);
    expect(back.type === "output" && back.job.id).toBe(v1.id);
  });
});

describe("the next-version form", () => {
  const copy = copyFor("ko");
  const view = (state: Partial<ReviseState>) =>
    renderToStaticMarkup(
      <ReviseFormView state={{ ...initialReviseState(), phase: "ready", ...state }} version={4} copy={copy} locale="ko" recent={[]} uploading={false}
        onPrompt={noop} onReferences={noop} onFiles={noop} resolve={() => null} onPick={noop} onSubmit={noop} onAccept={noop} />,
    );

  it("shows each way with its credits and closes a way that cannot run, with its reason", () => {
    const html = view({ plan: plan({ methods: { edit: { available: false, estimateKrw: 1500, problem: "too_long" }, reshoot: { available: true, estimateKrw: 4500 } } }), mode: "reshoot" });
    expect(html).toContain(`data-revise-method="edit" data-disabled=""`);
    expect(html).toMatch(/data-revise-method="edit"[^>]*><input type="radio"[^>]*disabled=""/);
    expect(html).toContain(copy.revise.problems.too_long);
    expect(html).toContain(credits(copy.credits.amount, creditsOf(4500), "ko"));
    expect(html).toContain(copy.revise.edit);
    expect(html).toContain(copy.revise.reshoot);
    expect(html).toContain(fill(copy.revise.submit, { n: 4 }));
    expect(html).not.toContain("data-revise-suggestion");
    // No internal words on screen.
    expect(JSON.stringify(copyFor("en").revise)).not.toMatch(/revision|recipe|job|model/i);
  });

  it("shows the suggestion row with the reason and both buttons", () => {
    const html = view({ phase: "suggest", plan: plan({ recommended: "reshoot", reason: "motion" }), suggestion: { mode: "reshoot", reason: "motion" } });
    expect(html).toContain(`data-revise-suggestion="reshoot"`);
    expect(html).toContain(copy.revise.reasons.motion);
    expect(html).toContain(copy.revise.switchAndMake);
    expect(html).toContain(copy.revise.makeAsSelected);
  });

  function flowWith(answers: StudioRevisePlan[]) {
    const planCalls: Array<{ prompt: string }> = [];
    const created: unknown[] = [];
    const states: ReviseState[] = [];
    const flow = createReviseFlow({
      organizationId: ORG,
      outputId: output(3).id,
      plan: vi.fn(async (input) => {
        planCalls.push(input);
        return answers[Math.min(planCalls.length - 1, answers.length - 1)]!;
      }),
      create: vi.fn(async (input) => {
        created.push(input);
        return { ok: true as const, job: clip(9, { status: "queued", outputs: [], revision: rev(4, 3) }) };
      }),
      onChange: (state) => states.push(state),
    });
    return { flow, planCalls, created, states };
  }

  it("asks for the plan on open and selects the default way", async () => {
    const { flow, planCalls } = flowWith([plan({ recommended: "reshoot" })]);
    await flow.load();
    expect(planCalls).toEqual([{ organizationId: ORG, outputId: output(3).id, prompt: "", references: [] }]);
    expect(flow.state.mode).toBe("reshoot");
    expect(flow.state.plan?.version).toBe(4);
  });

  it("creates the version at once when the plan agrees, then clears the form", async () => {
    const { flow, planCalls, created } = flowWith([plan(), plan({ recommended: "edit", reason: "surface" })]);
    await flow.load();
    flow.setPrompt("  병 색을 빨강으로 ");
    flow.setReferences([trayItemFromAsset(asset(2)), { ...trayItemFromAsset(asset(3)), kind: "video" }]);
    await flow.submit();
    expect(planCalls[1]).toMatchObject({ prompt: "병 색을 빨강으로", references: [{ assetId: asset(2).id }] });
    expect(created).toEqual([
      expect.objectContaining({ kind: "video_revise", organizationId: ORG, outputId: output(3).id, mode: "edit", prompt: "병 색을 빨강으로", references: [{ assetId: asset(2).id }] }),
    ]);
    expect(flow.state).toMatchObject({ phase: "ready", prompt: "", references: [], suggestion: null });
  });

  it("stops on a suggestion when the server prefers the other way; both answers work", async () => {
    const answers = [plan(), plan({ recommended: "reshoot", reason: "motion" })];
    const one = flowWith(answers);
    await one.flow.load();
    one.flow.setPrompt("카메라를 왼쪽으로 돌려 줘");
    await one.flow.submit();
    expect(one.created).toHaveLength(0);
    expect(one.flow.state).toMatchObject({ phase: "suggest", suggestion: { mode: "reshoot", reason: "motion" } });
    await one.flow.accept(true);
    expect(one.created).toEqual([expect.objectContaining({ mode: "reshoot" })]);

    const two = flowWith(answers);
    await two.flow.load();
    two.flow.setPrompt("카메라를 왼쪽으로 돌려 줘");
    await two.flow.submit();
    await two.flow.accept(false);
    expect(two.created).toEqual([expect.objectContaining({ mode: "edit" })]);
  });

  it("does not second-guess a way picked by hand, and refuses an empty request", async () => {
    const { flow, created } = flowWith([plan(), plan({ recommended: "reshoot", reason: "structure" })]);
    await flow.load();
    await flow.submit();
    expect(flow.state.note).toBe("empty_prompt");
    flow.pick("edit");
    flow.setPrompt("컷 순서를 바꿔 줘");
    await flow.submit();
    expect(created).toEqual([expect.objectContaining({ mode: "edit" })]);
  });

  it("keeps the request and says why when the run could not start", async () => {
    const flow = createReviseFlow({
      organizationId: ORG,
      outputId: output(3).id,
      plan: async () => plan(),
      create: async () => ({ ok: false, code: "allowance_exhausted" }),
      onChange: noop,
    });
    await flow.load();
    flow.setPrompt("로고를 더 선명하게");
    await flow.submit();
    expect(flow.state).toMatchObject({ phase: "ready", note: "allowance_exhausted", prompt: "로고를 더 선명하게" });
  });
});
