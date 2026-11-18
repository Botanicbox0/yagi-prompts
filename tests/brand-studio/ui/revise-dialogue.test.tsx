import { describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudioJobView, StudioOutputView, StudioRevisePlan } from "@/lib/brand-studio/contracts";
import { creditsOf } from "@/lib/brand-studio/credits";
import { Viewer, type ViewerActions, type ViewerItem, type ViewerProps } from "@/components/brand-studio/viewer";
import { ReviseFormView, VersionPanel, type ReviseFormViewProps, type ReviseSupport } from "@/components/brand-studio/revise-form";
import { answerOf, createReviseFlow, fallbackAnswer, initialReviseState, type ReviseState } from "@/components/brand-studio/revise-flow";
import { chainOf, stageOf } from "@/components/brand-studio/revision-model";
import { credits, fill } from "@/components/brand-studio/copy";
import { trayItemFromAsset } from "@/components/brand-studio/refs";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { ORG, asset, copyFor, id, job, output } from "./fixtures";

/**
 * docs/BRAND-STUDIO-VIDEO-REMIX.md §3 (slice D1, flag `BRAND_STUDIO_REVISE_V2`): the clip edit panel as a
 * conversation. We pick the way; the customer sees how, why and the credits, and one button makes it.
 * Drafts and finals are named, the step to the final sits on a draft's version card, and versions show
 * where they came from. Flag off: the panel is exactly as before.
 */
type Revision = NonNullable<StudioJobView["revision"]>;
const noop = () => {};
const ko = copyFor("ko");
const en = copyFor("en");
const clip = (n: number, patch: Partial<StudioJobView> = {}, out: Partial<StudioOutputView> = {}) =>
  job(n, {
    kind: "video",
    aspect: "9:16",
    resolution: "draft",
    seconds: 5,
    audio: "native",
    estimateKrw: 3000,
    outputs: [output(n, { kind: "video", jobId: id(0x2000 + n), width: 720, height: 1280, draft: true, ...out })],
    ...patch,
  });
const ROOT = job(1).id;
const rev = (version: number, base: number, patch: Partial<Revision> = {}): Revision => ({ rootJobId: ROOT, version, baseOutputId: output(base).id, mode: "edit", added: 0, ...patch });
/** A 1080p final of draft output `draft` (its own result is output `n`). */
const finalOf = (n: number, draft: number, patch: Partial<StudioJobView> = {}) =>
  job(n, {
    kind: "video_final",
    resolution: "1080p",
    parentOutputId: output(draft).id,
    outputs: [output(n, { kind: "video", jobId: id(0x2000 + n), width: 1080, height: 1920 })],
    ...patch,
  });

const plan = (patch: Partial<StudioRevisePlan> = {}): StudioRevisePlan => ({
  ok: true,
  version: 2,
  methods: { edit: { available: true, estimateKrw: 1500 }, reshoot: { available: true, estimateKrw: 4500 } },
  recommended: "edit",
  reason: null,
  ...patch,
});

const actions: ViewerActions = { regionEdit: async () => true, rerun: noop, toVideo: noop, reference: noop, save: noop, campaign: noop, finalize: noop, reuse: noop, remove: async () => true };
const support = (jobs: StudioJobView[], dialogue: boolean): ReviseSupport => ({
  organizationId: ORG,
  jobs,
  recent: [],
  resolve: () => null,
  upload: async () => [],
  plan: async () => plan(),
  create: async () => ({ ok: true, job: jobs[0]! }),
  ...(dialogue ? { dialogue: true } : {}),
});
const viewer = (opened: StudioJobView, jobs: StudioJobView[], dialogue: boolean, patch: Partial<ViewerProps> = {}) =>
  renderToStaticMarkup(
    <Viewer items={[{ type: "output", output: opened.outputs[0]!, job: opened }]} index={0} copy={ko} locale="ko" canCreate canGenerate busy={null} notice={null}
      revise={support(jobs, dialogue)} parentOf={() => null} onIndex={noop} onClose={noop} actions={actions} {...patch} />,
  );

describe("flag off: the panel as it was", () => {
  it("keeps the two ways with their radios, the old button and the 1080p action on a draft", () => {
    const v1 = clip(1);
    const html = viewer(v1, [v1], false);
    expect(html).toContain(`data-revise-method="edit"`);
    expect(html).toContain(`data-revise-method="reshoot"`);
    expect(html).toMatch(/<input type="radio"/);
    expect(html).toContain("data-revise-submit");
    expect(html).toContain(`data-action="finalize"`);
    expect(html).toContain(ko.viewer.finalize);
    expect(html).not.toContain("data-revise-dialogue");
    expect(html).not.toContain("data-version-panel");
    expect(html).not.toContain("data-version-card");
  });
});

describe("flag on: the viewer", () => {
  it("shows no way to pick, a box with a send button, and the draft's card with the step to the final", () => {
    const v1 = clip(1);
    const html = viewer(v1, [v1], true);
    expect(html).toContain("data-revise-dialogue");
    expect(html).not.toContain("data-revise-method");
    expect(html).not.toMatch(/<input type="radio"/);
    expect(html).not.toContain(ko.revise.method);
    expect(html).not.toContain("data-revise-submit");
    expect(html).toContain("data-revise-send");
    // Nothing to make before anything was said.
    expect(html).not.toContain("data-revise-make");
    // The 1080p action left the actions and sits on the draft's card, named by the stage it leads to.
    expect(html).not.toContain(`data-action="finalize"`);
    expect(html).not.toContain(ko.viewer.finalize);
    expect(html).toMatch(/data-version-card="1" data-stage="draft"/);
    expect(html).toContain(`data-version-stage="draft">${ko.revise.stage.draft}`);
    expect(html).toMatch(new RegExp(`data-version-final="true"[^>]*>[^]*${ko.revise.toFinal}`));
  });

  it("offers no step to the final on a final, and none to a member who cannot make", () => {
    const v1 = clip(1);
    const fin = finalOf(5, 1);
    const finalHtml = viewer(fin, [fin, v1], true);
    expect(finalHtml).toMatch(/data-version-card="1" data-stage="final"/);
    expect(finalHtml).toContain(`data-version-stage="final">${ko.revise.stage.final}`);
    expect(finalHtml).not.toContain("data-version-final");
    const readOnly = viewer(v1, [v1], true, { canGenerate: false });
    expect(readOnly).toContain(`data-version-stage="draft"`);
    expect(readOnly).not.toContain("data-version-final");
    expect(readOnly).not.toContain("data-revise-form");
  });
});

describe("the version card", () => {
  const card = (versions: ReturnType<typeof chainOf>, selected: number, shown: StudioJobView, patch: Partial<Parameters<typeof VersionPanel>[0]> = {}) =>
    VersionPanel({ versions, selected, shown: { job: shown, output: shown.outputs[0]! }, copy: ko, locale: "ko", canFinish: true, finishing: false, onSelect: noop, onFinal: noop, ...patch });

  it("names the stage of what is on screen", () => {
    const draft = clip(1);
    const straight = clip(2, { resolution: "720p" }, { draft: false });
    expect(stageOf(draft, draft.outputs[0]!)).toBe("draft");
    expect(stageOf(finalOf(5, 1), finalOf(5, 1).outputs[0]!)).toBe("final");
    expect(stageOf(straight, straight.outputs[0]!)).toBeNull();
    // A single clip made straight at another quality has nothing to say: no card.
    expect(card(chainOf([straight], straight), 1, straight)).toBeNull();
  });

  it("keys the stage off the draft flag only: a plain 480p version made from a draft is neither, with no step to the final", () => {
    const v1 = clip(1);
    // An edit of a draft that came out as a plain 480p video (not a draft: no usable id), and a run that asked
    // for a draft but has no usable id: no stage, no step to the final, whatever the resolution says.
    const plain = clip(2, { kind: "video_remix", resolution: "480p", prompt: "배경을 밤으로", revision: rev(2, 1) }, { draft: false });
    const noId = clip(3, { resolution: "draft" }, { draft: false });
    expect(stageOf(plain, plain.outputs[0]!)).toBeNull();
    expect(stageOf(noId, noId.outputs[0]!)).toBeNull();
    const html = renderToStaticMarkup(card(chainOf([plain, v1], plain), 2, plain)!);
    expect(html).toMatch(/data-version-card="2">/);
    expect(html).not.toContain("data-version-stage");
    expect(html).not.toContain(ko.revise.stage.draft);
    expect(html).not.toContain("data-version-final");
    expect(html).toContain(`data-version-from="1"`);
    // The viewer offers no step to the final for it either, and the 1080p action stays off the actions.
    const viewerHtml = viewer(plain, [plain, v1], true);
    expect(viewerHtml).not.toContain("data-version-final");
    expect(viewerHtml).not.toContain(`data-action="finalize"`);
    expect(viewerHtml).not.toContain("data-version-stage");
  });

  it("shows on the step to the final the credits its final takes, as the server prices it", () => {
    const v1 = clip(1, {}, { finalEstimateKrw: 5_320 });
    const html = renderToStaticMarkup(card(chainOf([v1], v1), 1, v1)!);
    expect(html).toMatch(new RegExp(`data-version-final="true"[^>]*>[^]*<span>${ko.revise.toFinal}</span><span class="bs-version-final-cost bs-num">${credits(ko.credits.amount, creditsOf(5_320), "ko")}</span>`));
    // Without a figure (an older answer) the button still works and claims no number.
    const bare = renderToStaticMarkup(card(chainOf([clip(1)], clip(1)), 1, clip(1))!);
    expect(bare).toContain("data-version-final");
    expect(bare).not.toContain("bs-version-final-cost");
  });

  it("offers the step to the final only on a draft with no final yet, and hands that draft over", () => {
    const v1 = clip(1);
    const onFinal = vi.fn();
    const element = card(chainOf([v1], v1), 1, v1, { onFinal });
    const button = findProp(element, "data-version-final");
    expect(button).not.toBeNull();
    (button!.props as { onClick(): void }).onClick();
    expect(onFinal).toHaveBeenCalledWith(v1.outputs[0]);

    // Its final is being made: a status line, no button.
    const making = finalOf(5, 1, { status: "running", outputs: [] });
    const busy = renderToStaticMarkup(card(chainOf([making, v1], v1), 1, v1)!);
    expect(busy).toContain(`data-version-finishing="true"`);
    expect(busy).toContain(ko.revise.finalMaking);
    expect(busy).not.toContain("data-version-final");
    // Its final exists, even when the draft itself is what is on screen.
    const done = finalOf(5, 1);
    expect(renderToStaticMarkup(card(chainOf([done, v1], v1), 1, v1)!)).not.toContain("data-version-final");
    // Not allowed to make, or the press is on its way.
    expect(renderToStaticMarkup(card(chainOf([v1], v1), 1, v1, { canFinish: false })!)).not.toContain("data-version-final");
    expect(renderToStaticMarkup(card(chainOf([v1], v1), 1, v1, { finishing: true })!)).toMatch(/data-version-final="true" disabled="" aria-busy="true"/);
  });

  it("shows a version made from an earlier one as coming from it, in the strip and on its card", () => {
    const v1 = clip(1);
    const v2 = clip(2, { prompt: "병을 더 크게", revision: rev(2, 1) });
    const v3 = clip(3, { prompt: "배경을 밤으로", revision: rev(3, 1) });
    const chain = chainOf([v3, v2, v1], v3);
    expect(chain.map((v) => [v.version, v.base])).toEqual([[1, null], [2, 1], [3, 1]]);
    const html = renderToStaticMarkup(card(chain, 3, v3)!);
    expect(html).toMatch(/data-revision-version="3"[^>]*>[^]*?data-revision-from="1"[^>]*>← v1/);
    expect(html).toContain(`<span class="bs-sr">${fill(ko.revise.from, { n: 1 })}</span>`);
    expect(html).not.toMatch(/data-revision-version="2"[^>]*><span class="bs-num">v2<\/span><span class="bs-revise-from/);
    expect(html).toContain(`data-version-from="1">${fill(ko.revise.from, { n: 1 })}`);
    expect(html).toContain(`data-revision-request="true">배경을 밤으로`);
    // A straight line reads as before in the strip; the card still says where the version came from.
    const straight = renderToStaticMarkup(card(chainOf([v2, v1], v2), 2, v2)!);
    expect(straight).toContain(`data-revision-version="2"`);
    expect(straight).not.toContain(`data-revision-from="`);
    expect(straight).toContain(`data-version-from="1"`);
    // A final made from a draft counts as that draft's version.
    const fin = finalOf(6, 1);
    const v4 = clip(4, { prompt: "더 밝게", revision: rev(4, 6) });
    expect(chainOf([v4, fin, v3, v2, v1], v4).find((v) => v.version === 4)?.base).toBe(1);
  });
});

describe("flag on: the conversation", () => {
  const view = (state: Partial<ReviseState>, props: Partial<ReviseFormViewProps> = {}, locale: "ko" | "en" = "ko") =>
    renderToStaticMarkup(
      <ReviseFormView state={{ ...initialReviseState(), phase: "ready", ...state }} version={2} copy={copyFor(locale)} locale={locale} recent={[]} uploading={false}
        onPrompt={noop} onReferences={noop} onFiles={noop} resolve={() => null} onPick={noop} onSubmit={noop} onAccept={noop} dialogue onSend={noop} onMake={noop} {...props} />,
    );
  const said = (text: string) => ({ text, marks: [], references: [], materials: [] });

  it("shows the request, our answer with how, why and the credits the server reserves, and one button", () => {
    const answer = answerOf(plan({ recommended: "edit", reason: "surface" }))!;
    const html = view({ plan: plan(), said: [said("병 색을 빨강으로")], answer, mode: "edit" });
    const price = credits(ko.credits.amount, creditsOf(1500), "ko");
    expect(html).toMatch(/data-revise-said="1"[^]*병 색을 빨강으로[^]*data-revise-answer="edit"/);
    expect(html).toContain(`data-revise-answer-line="true">${ko.revise.talk.answer.surface}`);
    // The credits sit on the button only: the answer line says how and why.
    expect(html.split(price).length - 1).toBe(1);
    expect(html).toContain(`data-revise-answer-line="true">${ko.revise.talk.answer.surface}</p>`);
    expect(html.match(/data-revise-make/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`data-revise-make="true"[^>]*><span>${ko.revise.talk.make}</span><span class="bs-submit-cost bs-num">${price}</span>`));
    expect(html).not.toContain("data-revise-method");
    expect(html).not.toContain("data-revise-submit");
    expect(html).toContain(`data-revise-after="true">${fill(ko.revise.after, { n: 2 })}`);
    // The answer sits above the box, which is last.
    expect(html.indexOf("data-revise-answer")).toBeLessThan(html.indexOf("data-revise-box"));
    expect(html).toMatch(/role="log" aria-live="polite"/);
    // The other way's line when the server picks it, and the plain line when the request was not read.
    expect(view({ said: [said("카메라를 돌려")], answer: answerOf(plan({ recommended: "reshoot", reason: "motion" }))! })).toContain(ko.revise.talk.answer.motion);
    const unread = view({ said: [said("병 색")], answer: answerOf(plan())! });
    expect(unread).toContain(`data-revise-answer-line="true">${ko.revise.talk.answer.edit}`);
  });

  it("opens with only the title and the box; the send button waits for words", () => {
    const html = view({});
    expect(html).toContain(`data-revise-title="true">${ko.revise.title}`);
    expect(html).toContain(`data-revise-thread="true" data-empty=""`);
    expect(html).not.toContain("data-revise-answer");
    expect(html).toMatch(/data-revise-send="true" aria-disabled="true"/);
    expect(html).toContain(`placeholder="${ko.revise.placeholder}"`);
    expect(view({ prompt: "배경을 밤으로" })).not.toMatch(/data-revise-send="true" aria-disabled/);
    // After something was said the box asks for more.
    expect(view({ said: [said("배경을 밤으로")], answer: answerOf(plan()) })).toContain(`placeholder="${ko.revise.talk.placeholderMore}"`);
    expect(view({ said: [said("배경을 밤으로")], phase: "checking" })).toContain(`data-revise-reading="true"`);
  });

  it("asks the one question in the thread; its reply stays there once given", () => {
    const html = view({ said: [said("병 색을 바꿔 줘")], phase: "clarify", plan: plan(), clarify: { question: "어느 병을 바꿀까요?", options: ["왼쪽 병", "오른쪽 병"] }, clarifiedAt: 1 });
    expect(html).toMatch(/data-revise-said="1"[^]*data-revise-clarify="true"/);
    expect(html).toContain(`data-revise-choice="1"`);
    expect(html).toContain(`data-revise-choice="as-written">${ko.revise.talk.asWritten}`);
    expect(html).not.toContain("data-revise-make");
    const answered = view({ said: [said("병 색을 바꿔 줘")], clarified: { question: "어느 병을 바꿀까요?", answer: "왼쪽 병" }, clarifiedAt: 1, answer: answerOf(plan()) });
    expect(answered).toMatch(/data-revise-asked="true"[^]*어느 병을 바꿀까요\?[^]*data-revise-said-answer="true">왼쪽 병/);
  });

  it("says the new version keeps this one's quality when the version on screen is not a draft", () => {
    const answer = answerOf(plan({ recommended: "edit", reason: "surface" }))!;
    const kept = view({ said: [said("배경을 밤으로")], answer }, { sameQuality: true });
    expect(kept).toContain(`data-revise-answer-line="true">${ko.revise.talk.answer.surface} ${ko.revise.talk.sameQuality}</p>`);
    expect(view({ said: [said("배경을 밤으로")], answer })).not.toContain(ko.revise.talk.sameQuality);
    expect(view({ said: [said("Make it night")], answer }, { sameQuality: true }, "en")).toContain(`${en.revise.talk.answer.surface} ${en.revise.talk.sameQuality}`);
  });

  it("says why the fitting way is closed when we go the other way", () => {
    const answer = answerOf(plan({ recommended: "edit", reason: "motion", methods: { edit: { available: true, estimateKrw: 1500 }, reshoot: { available: false, estimateKrw: 0, problem: "references_gone" } } }))!;
    expect(answer).toEqual({ mode: "edit", reason: null, estimateKrw: 1500, blocked: "references_gone" });
    expect(view({ said: [said("카메라를 돌려")], answer })).toContain(`data-revise-blocked="references_gone">${ko.revise.problems.references_gone}`);
  });

  it("uses no internal words for the new lines", () => {
    for (const locale of ["ko", "en"] as const) {
      const r = copyFor(locale).revise;
      const lines = [r.talk.send, r.talk.placeholderMore, r.talk.reading, r.talk.make, r.talk.sameQuality, r.talk.draftEditNote, r.talk.asWritten, ...Object.values(r.talk.answer), r.stage.draft, r.stage.final, r.toFinal, r.finalMaking, r.from];
      // Upscaling is its own feature: never named by the draft/final words or the step to the final. The plain
      // English verb "edit" is the customer's own word here (the panel is "Edit this video"), so it is allowed;
      // the internal names of the two ways are not.
      for (const line of lines) expect(line).not.toMatch(/reshoot|revise|recipe|job|model|lane|provider|seedance|sunra|1080p|720p|480p|draft_|mode|upscal|업스케일|해상도/i);
    }
    expect(en.revise.stage).toEqual({ draft: "Draft", final: "Final" });
    expect(ko.revise.stage).toEqual({ draft: "초안", final: "완성본" });
  });

  it("calls the customer's own 480p version 초안 across the studio; 시안 is left to the team's room deliveries", () => {
    const d = getDictionary("ko");
    const v = d.studioVideo;
    const own = [
      d.brandStudio.board.draftBadge,
      d.brandStudio.dock.draft,
      d.brandStudio.dock.draftNote,
      v.intro.steps[3]!.title,
      v.intro.steps[3]!.line,
      v.reverse.sections.run,
      v.reverse.run.draft,
      v.reverse.run.finalNote,
      v.path.pickEmpty,
      v.path.draft,
      v.workspace.specs.draftOption,
      v.workspace.specs.draftHint,
      v.workspace.cta.blueprint,
      v.workspace.guide.steps[2]!.title,
      v.workspace.guide.steps[2]!.body,
      v.workspace.guide.steps[2]!.tag,
      d.studioShell.showroom.stages[3]!.title,
    ];
    for (const line of own) {
      expect(line).toContain("초안");
      expect(line).not.toContain("시안");
    }
    expect(getDictionary("en").studioVideo.workspace.guide.steps[2]!.title).not.toMatch(/preview/i);
  });
});

describe("flag on: the flow", () => {
  function flowWith(answers: Array<StudioRevisePlan | { ok: false; code: string }>, opts: { dialogue?: boolean } = { dialogue: true }) {
    const planCalls: Array<Record<string, unknown>> = [];
    const created: Array<Record<string, unknown>> = [];
    const flow = createReviseFlow({
      organizationId: ORG,
      outputId: output(1).id,
      plan: vi.fn(async (input) => {
        planCalls.push(input as unknown as Record<string, unknown>);
        return answers[Math.min(planCalls.length - 1, answers.length - 1)]! as StudioRevisePlan;
      }),
      create: vi.fn(async (input) => {
        created.push(input as unknown as Record<string, unknown>);
        return { ok: true as const, job: clip(9, { status: "queued", outputs: [] }) };
      }),
      onChange: noop,
      ...(opts.dialogue ? { dialogue: true } : {}),
    });
    return { flow, planCalls, created };
  }

  it("sending only asks; the answer is the server's way and credits; the button makes exactly that", async () => {
    const { flow, planCalls, created } = flowWith([plan(), plan({ recommended: "reshoot", reason: "motion" })]);
    await flow.load();
    flow.setPrompt("  카메라를 왼쪽으로 돌려 줘 ");
    flow.setReferences([trayItemFromAsset(asset(2))]);
    await flow.send();
    expect(created).toHaveLength(0);
    expect(planCalls[1]).toMatchObject({ prompt: "카메라를 왼쪽으로 돌려 줘", references: [{ assetId: asset(2).id }] });
    expect(flow.state).toMatchObject({ phase: "ready", prompt: "", references: [], answer: { mode: "reshoot", reason: "motion", estimateKrw: 4500, blocked: null } });
    expect(flow.state.said).toEqual([expect.objectContaining({ text: "카메라를 왼쪽으로 돌려 줘", references: [expect.objectContaining({ assetId: asset(2).id })] })]);
    await flow.make();
    expect(created).toEqual([
      expect.objectContaining({ kind: "video_revise", outputId: output(1).id, mode: "reshoot", prompt: "카메라를 왼쪽으로 돌려 줘", references: [{ assetId: asset(2).id }] }),
    ]);
    expect(flow.state).toMatchObject({ phase: "ready", said: [], answer: null, plan: expect.objectContaining({ version: 3 }) });
  });

  it("refuses an empty send, and a later message joins the request; what is typed but not sent stays", async () => {
    const { flow, planCalls, created } = flowWith([plan(), plan({ reason: "surface" }), plan({ reason: "surface" })]);
    await flow.load();
    await flow.send();
    expect(flow.state.note).toBe("empty_prompt");
    flow.setPrompt("병 색을 빨강으로");
    await flow.send();
    flow.setPrompt("라벨은 그대로");
    await flow.send();
    expect(planCalls[2]).toMatchObject({ prompt: "병 색을 빨강으로\n라벨은 그대로" });
    flow.setPrompt("그리고 더 밝게");
    await flow.make();
    expect(created).toEqual([expect.objectContaining({ mode: "edit", prompt: "병 색을 빨강으로\n라벨은 그대로" })]);
    expect(flow.state.prompt).toBe("그리고 더 밝게");
  });

  it("falls back to the server's own rule when the plan cannot be had, and never blocks", async () => {
    // The opening plan is known: edit when open, no reason, the credits that plan gives for edit.
    const one = flowWith([plan(), { ok: false, code: "too_many_running" }]);
    await one.flow.load();
    one.flow.setPrompt("카메라를 돌려");
    await one.flow.send();
    expect(one.flow.state).toMatchObject({ phase: "ready", note: null, answer: { mode: "edit", reason: null, estimateKrw: 1500 } });
    await one.flow.make();
    expect(one.created).toEqual([expect.objectContaining({ mode: "edit" })]);
    // Edit closed: reshoot.
    expect(fallbackAnswer(plan({ methods: { edit: { available: false, estimateKrw: 0, problem: "too_long" }, reshoot: { available: true, estimateKrw: 4500 } } }))).toEqual({ mode: "reshoot", reason: null, estimateKrw: 4500, blocked: null });
    // Not even the opening plan: the error shows, the request stays, and sending again asks again.
    const two = flowWith([{ ok: false, code: "failed" }, { ok: false, code: "failed" }, plan({ reason: "surface" })]);
    await two.flow.load();
    // The opening plan is only something to fall back on: its failure says nothing before anything was asked.
    expect(two.flow.state).toMatchObject({ phase: "ready", note: null });
    two.flow.setPrompt("병 색");
    await two.flow.send();
    expect(two.flow.state).toMatchObject({ note: "failed", answer: null, said: [expect.objectContaining({ text: "병 색" })] });
    await two.flow.send();
    expect(two.planCalls).toHaveLength(3);
    expect(two.flow.state.answer).toMatchObject({ mode: "edit", reason: "surface" });
  });

  it("does not wait for the opening plan, and a late one never undoes the answer", async () => {
    let open!: (value: StudioRevisePlan) => void;
    const calls: string[] = [];
    const flow = createReviseFlow({
      organizationId: ORG,
      outputId: output(1).id,
      plan: (input) => {
        calls.push(input.prompt);
        return input.prompt ? Promise.resolve(plan({ recommended: "reshoot", reason: "length" })) : new Promise((resolve) => (open = resolve));
      },
      create: async () => ({ ok: true as const, job: clip(9) }),
      onChange: noop,
      dialogue: true,
    });
    const loading = flow.load();
    flow.setPrompt("10초로 늘려 줘");
    await flow.send();
    expect(flow.state.answer).toMatchObject({ mode: "reshoot", reason: "length" });
    open(plan());
    await loading;
    expect(flow.state).toMatchObject({ phase: "ready", answer: { mode: "reshoot", reason: "length" }, plan: expect.objectContaining({ reason: "length" }) });
    expect(calls).toEqual(["", "10초로 늘려 줘"]);
  });

  it("keeps the one question: a choice re-reads with the answer, as written uses the plan that asked", async () => {
    const QUESTION = { question: "어느 병을 바꿀까요?", options: ["왼쪽 병", "오른쪽 병"] };
    const one = flowWith([plan(), plan({ reason: "surface", clarify: QUESTION }), plan({ recommended: "edit", reason: "surface" })]);
    await one.flow.load();
    one.flow.setPrompt("병 색을 초록색으로");
    await one.flow.send();
    expect(one.flow.state).toMatchObject({ phase: "clarify", clarify: QUESTION, clarifiedAt: 1, answer: null });
    expect(one.created).toHaveLength(0);
    await one.flow.answer("왼쪽 병");
    expect(one.planCalls[2]).toMatchObject({ prompt: "병 색을 초록색으로", clarified: { question: QUESTION.question, answer: "왼쪽 병" } });
    expect(one.created).toHaveLength(0);
    expect(one.flow.state.answer).toMatchObject({ mode: "edit", reason: "surface" });
    await one.flow.make();
    expect(one.created).toEqual([expect.objectContaining({ prompt: "병 색을 초록색으로", clarified: { question: QUESTION.question, answer: "왼쪽 병" } })]);

    const two = flowWith([plan(), plan({ recommended: "reshoot", reason: "structure", clarify: QUESTION })]);
    await two.flow.load();
    two.flow.setPrompt("병을 바꿔 줘");
    await two.flow.send();
    await two.flow.answer(null);
    expect(two.planCalls).toHaveLength(2);
    expect(two.flow.state.answer).toMatchObject({ mode: "reshoot", reason: "structure" });
    await two.flow.make();
    expect(two.created[0]).not.toHaveProperty("clarified");

    // Saying something new instead of answering ends the question for this version; it is not asked again.
    const three = flowWith([plan(), plan({ clarify: QUESTION }), plan({ clarify: QUESTION })]);
    await three.flow.load();
    three.flow.setPrompt("병을 바꿔 줘");
    await three.flow.send();
    three.flow.setPrompt("왼쪽 병이요");
    // Typing alone leaves the question on screen.
    expect(three.flow.state.phase).toBe("clarify");
    await three.flow.send();
    expect(three.planCalls[2]).toMatchObject({ prompt: "병을 바꿔 줘\n왼쪽 병이요", clarified: { question: QUESTION.question, answer: null } });
    expect(three.flow.state).toMatchObject({ phase: "ready", clarify: null, answer: { mode: "edit" } });
  });

  it("numbers marks across what was said; a said mark stays, and what is left is renumbered after making", async () => {
    const { flow, planCalls, created } = flowWith([plan(), plan({ reason: "surface" })]);
    await flow.load();
    flow.setPrompt("색을 빨강으로");
    const first = flow.addMark({ time: 1, x: 0.2, y: 0.3 }, null)!;
    await flow.send();
    expect(planCalls[1]).toMatchObject({ prompt: "색을 빨강으로 ①", marks: [{ time: 1, x: 0.2, y: 0.3 }] });
    flow.removeMark(first.key);
    expect(flow.state.marks).toHaveLength(1);
    flow.addMark({ time: 2, x: 0.5, y: 0.5 }, null);
    expect(flow.state.prompt).toBe("② ");
    await flow.make();
    expect(created).toEqual([expect.objectContaining({ prompt: "색을 빨강으로 ①", marks: [{ time: 1, x: 0.2, y: 0.3 }] })]);
    expect(flow.state.marks.map((m) => m.time)).toEqual([2]);
    expect(flow.state.prompt).toBe("① ");
  });

  it("leaves the flag-off flow alone: submit still creates at once, and typing still ends a question", async () => {
    const { flow, created } = flowWith([plan(), plan({ reason: "surface" })], {});
    await flow.load();
    flow.setPrompt("병 색");
    await flow.submit();
    expect(created).toHaveLength(1);
    expect(flow.state).toMatchObject({ said: [], answer: null });
  });
});

/** The first element in a React tree whose props carry `prop` (VersionPanel has no hooks, so it can be called). */
function findProp(node: ReactNode, prop: string): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findProp(child, prop);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = node.props as Record<string, unknown> & { children?: ReactNode };
  if (prop in props) return node;
  return findProp(props.children, prop);
}
