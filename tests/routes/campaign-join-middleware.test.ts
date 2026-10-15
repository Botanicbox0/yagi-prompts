import { afterEach, it, expect, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: async (_r: NextRequest, headers: Headers) => ({
    user: null,
    response: NextResponse.next({ request: { headers } }),
  }),
  withCookies: (response: NextResponse) => response,
}));
vi.mock("@/lib/auth/dev-identity", () => ({ devIdentityUserId: () => null }));
import { middleware } from "@/middleware";
const request = (path: string, method = "GET") =>
  new NextRequest(`https://twings.app${path}`, {
    method,
    headers: { host: "twings.app" },
  });
afterEach(() => vi.unstubAllEnvs());
it("lets anonymous GET and HEAD invitation landings reach the page without redirect", async () => {
  for (const method of ["GET", "HEAD"]) {
    const r = await middleware(request("/campaigns/example/join", method));
    expect(r.headers.get("x-middleware-next")).toBe("1");
    expect(r.headers.get("location")).toBeNull();
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  }
});
it("retains the session gate on private participant and make pages", async () => {
  for (const path of [
    "/campaigns/participations/10000000-0000-4000-8000-000000000001",
    "/campaigns/example/make",
    "/campaigns/example/apply",
    "/campaigns/mine",
  ]) {
    const r = await middleware(request(path));
    expect(r.status).toBe(307);
    expect(r.headers.get("x-middleware-next")).toBeNull();
    expect(new URL(r.headers.get("location")!).searchParams.get("next")).toBe(
      path,
    );
  }
});
it("does not exempt POST or nested join-like paths", async () => {
  const r = await middleware(request("/campaigns/example/join", "POST"));
  expect(r.headers.get("x-middleware-next")).toBeNull();
  expect(r.status).toBe(307);
  const nested = await middleware(request("/campaigns/example/join/extra"));
  expect(nested.headers.get("location")).not.toBeNull();
});
