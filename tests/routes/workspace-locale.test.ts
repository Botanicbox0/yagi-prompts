import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ viewer: vi.fn(), sql: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auth/viewer", () => ({ getViewer: m.viewer }));
vi.mock("@/lib/db/connect", () => ({ getSqlRunner: m.sql }));
import { POST } from "@/app/api/workspace-locale/route";
beforeEach(() => {
  vi.clearAllMocks();
  m.viewer.mockResolvedValue({ userId: "fixture-user" });
  m.sql.mockResolvedValue({ query: m.query });
});
function request(
  locale = "en",
  next = "/brand/studio?organizationId=fixture",
  origin = "https://brand.twings.app",
) {
  return new Request("https://brand.twings.app/api/workspace-locale", {
    method: "POST",
    headers: { Origin: origin },
    body: new URLSearchParams({ locale, next }),
  });
}
it("writes the language cookie, mirrors only the signed-in profile and preserves the workspace return path", async () => {
  const r = await POST(request());
  expect(r.status).toBe(303);
  expect(r.headers.get("Location")).toBe(
    "https://brand.twings.app/brand/studio?organizationId=fixture",
  );
  expect(r.headers.get("Set-Cookie")).toContain("playbook.locale=en");
  expect(m.query).toHaveBeenCalledWith(
    "update profiles set locale=$2 where id=$1",
    ["fixture-user", "en"],
  );
});
it("refuses cross-origin changes, unsupported languages and redirect escapes", async () => {
  expect(
    (await POST(request("en", "/brand", "https://evil.test"))).status,
  ).toBe(403);
  expect((await POST(request("xx"))).status).toBe(400);
  expect(
    (await POST(request("en", "https://evil.test"))).headers.get("Location"),
  ).toBe("https://brand.twings.app/brand");
  expect((await POST(request("en", "/admin"))).headers.get("Location")).toBe(
    "https://brand.twings.app/brand",
  );
});
