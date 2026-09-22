import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  viewer: vi.fn(),
  sql: vi.fn(),
  create: vi.fn(),
  output: vi.fn(),
  read: vi.fn(),
  pass: vi.fn(),
  after: vi.fn(),
}));
vi.mock("@/lib/auth/viewer", () => ({ getViewer: m.viewer }));
vi.mock("@/lib/db/connect", () => ({ getSqlRunner: m.sql }));
vi.mock("@/lib/renders/service", () => ({ createBrandRenderJob: m.create }));
vi.mock("@/lib/brands/production/service", () => ({
  loadProductionOutput: m.output,
}));
vi.mock("@/lib/renders/store", () => ({
  getRenderStore: async () => ({ read: m.read }),
}));
vi.mock("@/lib/renders/runtime", () => ({ runLiveRenderPass: m.pass }));
vi.mock("next/server", async () => ({
  ...(await vi.importActual("next/server")),
  after: m.after,
}));
import { POST } from "@/app/api/brand-production/route";
import { GET } from "@/app/api/brand-production/[id]/route";
import {
  GET as media,
  HEAD,
} from "@/app/api/brand-production/[id]/media/route";
const ctx = { params: Promise.resolve({ id: "fake-render" }) };
beforeEach(() => {
  vi.clearAllMocks();
  m.viewer.mockResolvedValue({ userId: "fixture", isAdmin: false });
  m.sql.mockResolvedValue({});
  m.output.mockResolvedValue(null);
});
it("blocks cross-origin creation and anonymous creation before the service", async () => {
  expect(
    (
      await POST(
        new Request("https://brand.twings.app/api/brand-production", {
          method: "POST",
          headers: { Origin: "https://evil.test" },
        }),
      )
    ).status,
  ).toBe(403);
  m.viewer.mockResolvedValue({ userId: null });
  expect(
    (
      await POST(
        new Request("https://brand.twings.app/api/brand-production", {
          method: "POST",
        }),
      )
    ).status,
  ).toBe(401);
  expect(m.create).not.toHaveBeenCalled();
});
it("does not schedule or leak storage details for inaccessible jobs", async () => {
  const r = await GET(
    new Request("https://brand.twings.app/api/brand-production/id"),
    ctx,
  );
  expect(r.status).toBe(404);
  expect(m.after).not.toHaveBeenCalled();
  expect(
    (
      await media(
        new Request("https://brand.twings.app/api/brand-production/id/media"),
        ctx,
      )
    ).status,
  ).toBe(404);
  expect(m.read).not.toHaveBeenCalled();
});
it("projects status fields only, excluding internal storage keys and costs", async () => {
  m.output.mockResolvedValue({
    id: "fixture",
    status: "running",
    released: false,
    resultKey: "private-key",
    costUsd: 100,
  });
  const r = await GET(
    new Request("https://brand.twings.app/api/brand-production/id"),
    ctx,
  );
  expect(await r.json()).toEqual({
    id: "fixture",
    status: "running",
    released: false,
  });
  expect(r.headers.get("Cache-Control")).toContain("no-store");
  expect(m.after).toHaveBeenCalledOnce();
});
it("streams large private video responses, supports seeking and validates ranges", async () => {
  const bytes = new Uint8Array(6 * 1024 * 1024).fill(7);
  m.read.mockResolvedValue(bytes);
  m.output.mockResolvedValue({
    id: "fixture",
    status: "succeeded",
    resultKey: "fixture/result.mp4",
    resultMime: "video/mp4",
  });
  const url = "https://brand.twings.app/api/brand-production/id/media";
  const full = await media(new Request(url), ctx);
  expect(full.status).toBe(200);
  expect(full.headers.has("Location")).toBe(false);
  expect((await full.arrayBuffer()).byteLength).toBe(bytes.length);
  const partial = await media(
    new Request(url, { headers: { Range: "bytes=100-199" } }),
    ctx,
  );
  expect(partial.status).toBe(206);
  expect(partial.headers.get("Content-Range")).toBe(
    `bytes 100-199/${bytes.length}`,
  );
  expect((await partial.arrayBuffer()).byteLength).toBe(100);
  expect(
    (
      await media(
        new Request(url, { headers: { Range: "bytes=99999999-" } }),
        ctx,
      )
    ).status,
  ).toBe(416);
  expect(
    (await HEAD(new Request(url, { method: "HEAD" }), ctx)).body,
  ).toBeNull();
});
