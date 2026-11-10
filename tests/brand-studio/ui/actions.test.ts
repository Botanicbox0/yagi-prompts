import { describe, expect, it, vi } from "vitest";
import {
  AssetCompleteSchema,
  AssetFromOutputSchema,
  AssetReserveSchema,
  CampaignHandoffSchema,
  FilmAnalyzeSchema,
  StudioJobCreateSchema,
} from "@/lib/brand-studio/contracts";
import { createStudioApi, uploadProblem } from "@/components/brand-studio/api";
import { finalInput, initialDraft, regionEditInput, rerunInput, withModel } from "@/components/brand-studio/dock-model";
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
    for (const kind of ["region_edit", "video_remix", "video_final"] as const) {
      expect(canRerun(job(3, { kind }))).toBe(false);
      expect(rerunInput(job(3, { kind }), ids())).toBeNull();
    }
  });

  it("sends a partial edit on a result or a library picture with the edit model", () => {
    const box = { x: 0.2, y: 0.25, w: 0.3, h: 0.2 };
    const onOutput = regionEditInput({ ids: ids(), source: { outputId: output(1).id }, box, instruction: " 라벨을 또렷하게 ", draft: initialDraft() });
    const onAsset = regionEditInput({ ids: ids(), source: { assetId: asset(1).id }, box, instruction: "logo", draft: withModel(initialDraft(), "nano-banana-pro") });
    for (const input of [onOutput, onAsset]) expect(StudioJobCreateSchema.parse(input)).toMatchObject({ kind: "region_edit", model: "nano-banana-pro", box });
    expect(onOutput).toMatchObject({ prompt: "라벨을 또렷하게", source: { outputId: output(1).id } });
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
