import { describe, expect, it, vi } from "vitest";
import { COVER_MAX_BYTES, COVER_TYPES, coverFileProblem, studioRequest, uploadStudioImage } from "@/lib/brands/workspace/studio-cover";
import { BRAND_ATTACHMENT_LIMITS, BRAND_COVER_MIMES } from "@/lib/brands/workspace/schemas";
import { STUDIO_REQUEST_HEADER } from "@/lib/admin/brand-host-studio";

/**
 * The browser side of a cover upload on brand.twings.app: the order of calls, what each one carries,
 * and that any failed step stops the chain. Network replaced by a recorded fake.
 */
const PROJECT = "11111111-1111-4111-8111-111111111111";
const ATTACHMENT = "22222222-2222-4222-8222-222222222222";
const png = (size = 64, name = "cover.png") => new File([new Uint8Array(size)], name, { type: "image/png" });
type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
function fake(responses: Array<{ status?: number; json?: unknown }>) {
  const calls: Call[] = [];
  const send = vi.fn(async (url: string, init: RequestInit = {}) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ url, method: init.method ?? "GET", headers, body });
    const next = responses.shift() ?? { status: 500 };
    return new Response(next.json === undefined ? null : JSON.stringify(next.json), { status: next.status ?? 200 });
  });
  return { calls, send: send as unknown as typeof fetch };
}

describe("cover file check", () => {
  it("states the server's own cover types and limit", () => {
    expect([...COVER_TYPES]).toEqual([...BRAND_COVER_MIMES]);
    for (const type of BRAND_COVER_MIMES) expect(COVER_MAX_BYTES).toBe(BRAND_ATTACHMENT_LIMITS[type]);
  });

  it("accepts JPEG, PNG and WebP up to the image limit only", () => {
    expect(coverFileProblem(png())).toBe(false);
    expect(coverFileProblem(new File([new Uint8Array(8)], "c.webp", { type: "image/webp" }))).toBe(false);
    expect(coverFileProblem(null)).toBe(false);
    expect(coverFileProblem(png(0))).toBe(true);
    expect(coverFileProblem(new File([new Uint8Array(8)], "c.gif", { type: "image/gif" }))).toBe(true);
    expect(coverFileProblem(new File([new Uint8Array(8)], "c.mp4", { type: "video/mp4" }))).toBe(true);
    expect(COVER_MAX_BYTES).toBe(15 * 1024 * 1024);
    expect(coverFileProblem({ type: "image/png", size: COVER_MAX_BYTES + 1, name: "big.png" } as File)).toBe(true);
  });
});

describe("uploading the image", () => {
  it("reserves, sends the bytes straight to storage, completes, and returns the attachment", async () => {
    const { calls, send } = fake([{ json: { ok: true, id: ATTACHMENT, direct: true, url: "https://storage.example.test/signed" } }, {}, { json: { ok: true, id: ATTACHMENT } }]);
    expect(await uploadStudioImage(PROJECT, png(64, 'my "cover"/1.png'), send)).toBe(ATTACHMENT);
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["POST", "/api/brand-workspace"], ["PUT", "https://storage.example.test/signed"], ["POST", "/api/brand-workspace"],
    ]);
    expect(calls[0]!.body).toMatchObject({ operation: "attachment.reserve", input: { projectId: PROJECT, purpose: "workspace", mime: "image/png", sizeBytes: 64, name: "my _cover__1.png" } });
    expect((calls[0]!.body as { input: { requestId: string } }).input.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[1]!.headers["content-type"]).toBe("image/png");
    expect(calls[2]!.body).toEqual({ operation: "attachment.complete", input: { id: ATTACHMENT } });
  });

  it("sends the bytes through the app when storage hands out no signed URL (local mode)", async () => {
    const { calls, send } = fake([{ json: { ok: true, id: ATTACHMENT, direct: false } }, {}, { json: { ok: true } }]);
    await uploadStudioImage(PROJECT, png(), send);
    expect(calls[1]).toMatchObject({ method: "POST", url: `/api/brand-workspace/attachments/${ATTACHMENT}` });
  });

  it.each([
    ["the reservation is refused", [{ status: 400, json: { ok: false, code: "invalid" } }]],
    ["the bytes do not arrive", [{ json: { ok: true, id: ATTACHMENT, direct: true, url: "https://storage.example.test/signed" } }, { status: 403 }]],
    ["the server rejects the real bytes", [{ json: { ok: true, id: ATTACHMENT, direct: true, url: "https://storage.example.test/signed" } }, {}, { status: 400, json: { ok: false, code: "invalid" } }]],
  ])("stops when %s", async (_label, responses) => {
    const { send } = fake(responses as Array<{ status?: number; json?: unknown }>);
    await expect(uploadStudioImage(PROJECT, png(), send)).rejects.toThrow("upload");
  });

  it("never starts with a file the check refuses", async () => {
    const { calls, send } = fake([]);
    await expect(uploadStudioImage(PROJECT, new File([new Uint8Array(8)], "c.gif", { type: "image/gif" }), send)).rejects.toThrow("upload");
    expect(calls).toEqual([]);
  });
});

describe("calling the studio door", () => {
  it("posts the fields with the JSON and studio headers and returns the answer", async () => {
    const { calls, send } = fake([{ json: { ok: true, to: `/brand/projects/${PROJECT}` } }]);
    expect(await studioRequest({ _op: "brandWorkspace.cover", projectId: PROJECT, expectedRevision: "0", attachmentId: ATTACHMENT }, send))
      .toEqual({ ok: true, to: `/brand/projects/${PROJECT}` });
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/brand-workspace/studio", headers: { accept: "application/json", [STUDIO_REQUEST_HEADER]: "1" } });
    const form = calls[0]!.body as FormData;
    expect(Object.fromEntries(form.entries())).toEqual({ _op: "brandWorkspace.cover", projectId: PROJECT, expectedRevision: "0", attachmentId: ATTACHMENT });
  });

  it("reads a refusal, and a bare 404 as notFound", async () => {
    expect(await studioRequest({ _op: "brandWorkspace.cover" }, fake([{ status: 400, json: { ok: false, code: "brandConflict" } }]).send)).toEqual({ ok: false, code: "brandConflict" });
    expect(await studioRequest({ _op: "brandWorkspace.cover" }, fake([{ status: 404 }]).send)).toEqual({ ok: false, code: "notFound" });
  });
});
