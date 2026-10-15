import { beforeEach, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  viewer: { userId: "10000000-0000-4000-8000-000000000001", isAdmin: false },
  issue: vi.fn(),
  accept: vi.fn(),
  revoke: vi.fn(),
  message: vi.fn(),
  file: vi.fn(),
  sql: {},
  email: vi.fn(),
}));
vi.mock("@/lib/auth/viewer", () => ({ getViewer: async () => mocks.viewer }));
vi.mock("@/lib/auth/verified-email", () => ({ getVerifiedEmail: mocks.email }));
vi.mock("@/lib/db/connect", () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock("@/lib/storage", () => ({ getStorage: async () => ({}) }));
vi.mock("@/lib/campaigns/collaboration/service", () => ({
  issueInvitation: mocks.issue,
  acceptInvitation: mocks.accept,
  revokeInvitation: mocks.revoke,
  sendParticipantMessage: mocks.message,
  storeParticipantFile: mocks.file,
}));
import { POST } from "@/app/api/campaign-collaboration/route";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.viewer.isAdmin = false;
  mocks.issue.mockResolvedValue({
    ok: true,
    id: "invitation",
    token: "sensitive-token",
    slug: "campaign",
  });
  mocks.email.mockResolvedValue("verified@example.test");
  mocks.accept.mockResolvedValue({ ok: true, id: "application" });
});
it.each([
  ["invalid", 400],
  ["conflict", 409],
  ["invitation_retry", 409],
  ["rate_limited", 429],
  ["not_found", 404],
] as const)("maps %s domain refusal to HTTP %i", async (code, status) => {
  mocks.message.mockResolvedValue({ ok: false, code });
  expect(
    (await POST(request({ operation: "message.send", input: {} }))).status,
  ).toBe(status);
});
const request = (body: unknown, origin = "http://localhost:3000") =>
  new NextRequest("http://localhost:3000/api/campaign-collaboration", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
it("rejects cross-origin mutation before services", async () => {
  const r = await POST(
    request(
      { operation: "invitation.create", input: {} },
      "https://evil.example",
    ),
  );
  expect(r.status).toBe(403);
  expect(mocks.issue).not.toHaveBeenCalled();
});
it("refuses admin mutation bypasses outside the operation registry", async () => {
  mocks.viewer.isAdmin = true;
  const r = await POST(request({ operation: "message.send", input: {} }));
  expect(r.status).toBe(403);
  expect(mocks.message).not.toHaveBeenCalled();
});
it("keeps an issuing token inside a no-store response body without redirects", async () => {
  const r = await POST(
    request({
      operation: "invitation.create",
      input: { campaignId: "campaign" },
    }),
  );
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  expect(r.headers.get("referrer-policy")).toBe("no-referrer");
  expect(r.headers.get("location")).toBeNull();
  expect((await r.json()).token).toBe("sensitive-token");
});
it("passes auth-server verified email to invite acceptance only", async () => {
  await POST(
    request({ operation: "invitation.accept", input: { token: "token" } }),
  );
  expect(mocks.accept).toHaveBeenCalledWith(
    { sql: mocks.sql, verifiedEmail: "verified@example.test" },
    mocks.viewer,
    { token: "token" },
  );
});
it("refuses arbitrary operations and duplicate multipart ownership fields", async () => {
  expect(
    (await POST(request({ operation: "admin.override", input: {} }))).status,
  ).toBe(400);
  const f = new FormData();
  f.append("applicationId", "a");
  f.append("applicationId", "b");
  f.append("requestId", "r");
  f.append(
    "file",
    new File(["%PDF-test"], "test.pdf", { type: "application/pdf" }),
  );
  const req = new NextRequest(
    "http://localhost:3000/api/campaign-collaboration",
    { method: "POST", headers: { Origin: "http://localhost:3000" }, body: f },
  );
  expect((await POST(req)).status).toBe(400);
  expect(mocks.file).not.toHaveBeenCalled();
});
