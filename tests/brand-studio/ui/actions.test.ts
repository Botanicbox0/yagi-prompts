import { describe, expect, it, vi } from "vitest";
import {
  AssetCompleteSchema,
  AssetFromOutputSchema,
  AssetReserveSchema,
  CampaignHandoffSchema,
  FilmAnalyzeSchema,
  RegionEditJobSchema,
  StudioJobCreateSchema,
} from "@/lib/brand-studio/contracts";
import { createStudioApi, uploadProblem } from "@/components/brand-studio/api";
import {
  finalInput,
  initialDraft,
  regionEditInput,
  regionInstructionForForm,
  regionInstructionForServer,
  regionProblem,
  rerunInput,
  withModel,
} from "@/components/brand-studio/dock-model";
import { trayItemFromAsset, trayItemFromOutput } from "@/components/brand-studio/refs";
import { handoffInput } from "@/components/brand-studio/handoff-dialog";
import { canRerun } from "@/components/brand-studio/viewer";
import { ORG, asset, id, job, output, studioState } from "./fixtures";

/** Viewer and dock actions send contract-valid bodies through the typed client (fetch mocked). */
type Call = { url: string; init: RequestInit };
function mockFetch(answers: Array<{ status?: number; body?: unknown } | Error>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = answers.shift() ?? { body: { ok: true } };
    if (next instanceof Error) throw next;
    const text = next.body === undefined ? "" : typeof next.body === "string" ? next.body : JSON.stringify(next.body);
    return new Response(text, { status: next.status ?? 200, headers: { "Content-Type": "application/json" } });
  });
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}
const sent = (call: Call) => JSON.parse(String(call.init.body)) as { operation: string; input: unknown };
const ids = () => ({ organizationId: ORG, requestId: crypto.randomUUID() });

describe("viewer actions", () => {
  it("re-runs plain image and video jobs as they were and sends edits and remixes back to the dock", () => {
    const image = job(1, { references: [{ assetId: asset(1).id, role: "product" }], expected: 3 });
    const video = job(2, { kind: "video", model: "seedance-2.5", aspect: "9:16", resolution: "draft", seconds: 6, audio: "ambient" });
    for (const j of [image, video]) {
      expect(canRerun(j)).toBe(true);
      const input = rerunInput(j, ids());
      expect(StudioJobCreateSchema.safeParse(input).success).toBe(true);
    }
    expect(rerunInput(image, ids())).toMatchObject({ kind: "image", count: 3, enhance: true, references: image.references });
    // A partial edit reopens its box and a reference-video run goes back to the dock: no direct re-run body.
    for (const kind of ["region_edit", "video_remix", "video_final"] as const) expect(rerunInput(job(3, { kind }), ids())).toBeNull();
    expect(canRerun(job(3, { kind: "region_edit" }))).toBe(true);
    expect(canRerun(job(3, { kind: "video_remix" }))).toBe(true);
    expect(canRerun(job(3, { kind: "video_final" }))).toBe(false);
  });

  it("sends a partial edit on a result or a library picture with the edit model", () => {
    const box = { x: 0.2, y: 0.25, w: 0.3, h: 0.2 };
    const onOutput = regionEditInput({ ids: ids(), source: { outputId: output(1).id }, box, instruction: " 라벨을 또렷하게 ", draft: initialDraft() });
    const onAsset = regionEditInput({ ids: ids(), source: { assetId: asset(1).id }, box, instruction: "logo", draft: withModel(initialDraft(), "nano-banana-pro") });
    for (const input of [onOutput, onAsset]) expect(StudioJobCreateSchema.parse(input)).toMatchObject({ kind: "region_edit", model: "nano-banana-pro", box, references: [] });
    expect(onOutput).toMatchObject({ prompt: "라벨을 또렷하게", source: { outputId: output(1).id } });
  });

  it("sends the partial edit's references, numbered for the server (the cut-out is the form's 1)", () => {
    const box = { x: 0.2, y: 0.25, w: 0.3, h: 0.2 };
    const logo = { ...trayItemFromAsset(asset(2)), role: "logo" as const };
    const product = trayItemFromOutput(output(3), "결과");
    const input = regionEditInput({
      ids: ids(),
      source: { outputId: output(1).id },
      box,
      instruction: "2번 이미지 로고를 라벨 가운데에, 이미지 3의 병 모양은 그대로",
      draft: initialDraft(),
      model: "nano-banana-pro",
      references: [logo, { ...product, role: "product" }],
      locale: "ko",
    });
    expect(RegionEditJobSchema.parse(input)).toMatchObject({ references: [{ assetId: asset(2).id, role: "logo" }, { outputId: output(3).id, role: "product" }] });
    expect(input.kind === "region_edit" && input.prompt).toBe("이미지 1 로고를 라벨 가운데에, 이미지 2의 병 모양은 그대로");
    expect(regionInstructionForServer("이미지 1만 밝게", "ko")).toBe("선택한 부분만 밝게");
    expect(regionInstructionForForm("이미지 1 로고를", "ko")).toBe("이미지 2 로고를");
    expect(regionInstructionForServer("put image 2 here", "en")).toBe("put image 1 here");
    // A quality goes along only for an edit model that has one.
    expect(regionEditInput({ ids: ids(), source: { outputId: output(1).id }, box, instruction: "x", draft: initialDraft(), model: "gpt-image-2.6-flare", quality: "high" })).toMatchObject({ model: "gpt-image-2.6-flare", quality: "high" });
    expect(regionEditInput({ ids: ids(), source: { outputId: output(1).id }, box, instruction: "x", draft: initialDraft(), model: "nano-banana-pro", quality: "high" })).not.toHaveProperty("quality");
    // A model that cannot edit a part well never runs one: the default edit model does.
    expect(regionEditInput({ ids: ids(), source: { outputId: output(1).id }, box, instruction: "x", draft: initialDraft(), model: "seedream-5-pro" })).toMatchObject({ model: "nano-banana-pro" });
  });

  it("checks a partial edit before it leaves: a box, words, pictures only and numbers that exist", () => {
    const base = { box: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 }, instruction: "로고를 또렷하게", model: "nano-banana-pro", references: [trayItemFromAsset(asset(2))] };
    expect(regionProblem(base)).toBeNull();
    expect(regionProblem({ ...base, box: null })).toEqual({ kind: "need_box" });
    expect(regionProblem({ ...base, instruction: " " })).toEqual({ kind: "empty_prompt" });
    expect(regionProblem({ ...base, references: [trayItemFromAsset(asset(3, { kind: "video" }))] })).toEqual({ kind: "image_only" });
    expect(regionProblem({ ...base, instruction: "이미지 2 로고를" })).toBeNull();
    expect(regionProblem({ ...base, instruction: "이미지 3 로고를" })).toEqual({ kind: "missing", mentions: [{ kind: "image", number: 3 }] });
    const many = Array.from({ length: 10 }, (_, i) => trayItemFromAsset(asset(10 + i)));
    expect(regionProblem({ ...base, references: many })).toMatchObject({ kind: "too_many_images" });
  });

  it("finishes a draft at 1080p, saves a result and hands it to a campaign", async () => {
    expect(StudioJobCreateSchema.parse(finalInput(ids(), output(1).id))).toMatchObject({ kind: "video_final", draftOutputId: output(1).id });
    const existing = handoffInput({ outputId: output(1).id }, { projectId: id(77) }, ids());
    const fresh = handoffInput({ assetId: asset(1).id }, { newProject: { title: "가을 출시", objective: "새 향수를 알린다" } }, ids());
    expect(CampaignHandoffSchema.safeParse(existing).success).toBe(true);
    expect(CampaignHandoffSchema.safeParse(fresh).success).toBe(true);

    const { calls, fetch } = mockFetch([
      { body: { ok: true, asset: asset(5, { source: "generation" }) } },
      { body: { ok: true, projectId: id(77), href: `/brand/projects/${id(77)}` } },
    ]);
    const api = createStudioApi({ organizationId: ORG, fetch });
    await api.call("asset.from_output", { organizationId: ORG, outputId: output(1).id });
    const done = await api.call("handoff.campaign", existing);
    expect(done).toMatchObject({ ok: true, href: `/brand/projects/${id(77)}` });
    expect(calls.map((c) => [c.url, c.init.method])).toEqual([["/api/brand-studio", "POST"], ["/api/brand-studio", "POST"]]);
    expect(sent(calls[0]!).operation).toBe("asset.from_output");
    expect(AssetFromOutputSchema.safeParse(sent(calls[0]!).input).success).toBe(true);
    expect(sent(calls[1]!).operation).toBe("handoff.campaign");
    expect(CampaignHandoffSchema.safeParse(sent(calls[1]!).input).success).toBe(true);
  });
});

describe("typed client", () => {
  it("loads state and polls open jobs with the organization, uncached", async () => {
    const { calls, fetch } = mockFetch([{ body: studioState() }, { body: { ok: true, jobs: [], allowance: studioState().allowance } }]);
    const api = createStudioApi({ organizationId: ORG, fetch });
    expect(await api.loadState()).toMatchObject({ ok: true, canCreate: true });
    await api.poll([id(1), id(2)]);
    expect(calls[0]!.url).toBe(`/api/brand-studio?organizationId=${ORG}`);
    expect(calls[1]!.url).toBe(`/api/brand-studio?organizationId=${ORG}&jobs=${id(1)},${id(2)}`);
    for (const c of calls) expect(c.init).toMatchObject({ method: "GET", cache: "no-store", credentials: "same-origin" });
  });

  it("returns contract codes and never a server message", async () => {
    const { fetch } = mockFetch([
      { status: 402, body: { ok: false, code: "allowance_exhausted", message: "internal detail" } },
      { status: 401, body: "<html>" },
      { status: 500, body: { ok: false, code: "provider_balance" } },
      new Error("offline"),
    ]);
    const api = createStudioApi({ organizationId: ORG, fetch });
    const film = { organizationId: ORG, assetId: asset(1).id };
    expect(FilmAnalyzeSchema.safeParse(film).success).toBe(true);
    expect(await api.call("film.analyze", film)).toEqual({ ok: false, code: "allowance_exhausted" });
    expect(await api.loadState()).toEqual({ ok: false, code: "sign_in_required" });
    expect(await api.loadState()).toEqual({ ok: false, code: "failed" });
    expect(await api.loadState()).toEqual({ ok: false, code: "failed" });
  });

  it("uploads through reserve, a direct PUT and complete", async () => {
    const reserved = { ok: true, id: asset(1).id, direct: true, url: "https://upload.example/signed" };
    const { calls, fetch } = mockFetch([{ body: reserved }, { body: "" }, { body: { ok: true, asset: asset(1) } }]);
    const api = createStudioApi({ organizationId: ORG, fetch });
    const file = new File([new Uint8Array(32)], "제품 정면.png", { type: "image/png" });
    const result = await api.upload(file, { requestId: "upload-0001", measure: async () => ({ width: 2048.4, height: 1536, seconds: undefined }) });
    expect(result).toMatchObject({ ok: true, asset: { id: asset(1).id } });
    expect(sent(calls[0]!).operation).toBe("asset.reserve");
    expect(AssetReserveSchema.parse(sent(calls[0]!).input)).toMatchObject({ name: "제품 정면.png", mime: "image/png", sizeBytes: 32 });
    expect(calls[1]).toMatchObject({ url: reserved.url, init: { method: "PUT" } });
    expect(sent(calls[2]!).operation).toBe("asset.complete");
    expect(AssetCompleteSchema.parse(sent(calls[2]!).input)).toMatchObject({ assetId: asset(1).id, width: 2048, height: 1536 });
  });

  it("posts the bytes to the studio when the upload is not direct, and checks files before sending", async () => {
    const { calls, fetch } = mockFetch([{ body: { ok: true, id: asset(2).id, direct: false } }, { body: { ok: true } }, { body: { ok: true, asset: asset(2) } }]);
    const api = createStudioApi({ organizationId: ORG, fetch });
    await api.upload(new File([new Uint8Array(8)], "clip.mp4", { type: "video/mp4" }));
    expect(calls[1]!.url).toBe(`/api/brand-studio/assets/${asset(2).id}?organizationId=${ORG}`);
    expect(calls[1]!.init.method).toBe("POST");
    expect(uploadProblem({ type: "image/gif", size: 10 })).toBe("unsupported_file");
    expect(uploadProblem({ type: "video/mp4", size: 60_000_000 })).toBe("file_too_large");
    expect(uploadProblem({ type: "audio/mpeg", size: 1_000 })).toBeNull();
    const before = calls.length;
    expect(await api.upload(new File([new Uint8Array(4)], "a.gif", { type: "image/gif" }))).toEqual({ ok: false, code: "unsupported_file" });
    expect(calls.length).toBe(before);
  });
});

describe("campaign handoff carries the format intent", () => {
  it("offers the format checkbox for a video only, checked, and sends it", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { HandoffDialog } = await import("@/components/brand-studio/handoff-dialog");
    const { copyFor } = await import("./fixtures");
    const copy = copyFor("ko");
    const props = { campaigns: [{ id: id(77), title: "가을 출시" }], copy, onSend: async () => ({ ok: true as const, projectId: id(77), href: "/" }), onDone: () => {}, onClose: () => {} };
    const forVideo = renderToStaticMarkup(createElement(HandoffDialog, { ...props, kind: "video" }));
    expect(forVideo).toContain("data-studio-handoff-format");
    expect(forVideo).toContain(copy.handoff.asFormat);
    expect(forVideo).toMatch(/type="checkbox" checked=""/);
    expect(renderToStaticMarkup(createElement(HandoffDialog, { ...props, kind: "image" }))).not.toContain("data-studio-handoff-format");
    expect(forVideo.match(/data-variant="solid"/g)).toHaveLength(1);
    const input = handoffInput({ outputId: output(1).id }, { projectId: id(77) }, ids(), true);
    expect(CampaignHandoffSchema.parse(input)).toMatchObject({ asFormat: true });
    expect(CampaignHandoffSchema.parse(handoffInput({ outputId: output(1).id }, { projectId: id(77) }, ids()))).toMatchObject({ asFormat: false });
  });
});
