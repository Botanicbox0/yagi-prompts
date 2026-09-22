import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  viewer: vi.fn(),
  sql: vi.fn(),
  session: vi.fn(),
  storage: vi.fn(),
  create: vi.fn(),
  accept: vi.fn(),
  reserve: vi.fn(),
  complete: vi.fn(),
  access: vi.fn(),
  uploadAccess: vi.fn(),
  signed: vi.fn(),
  read: vi.fn(),
  put: vi.fn(),
}));
vi.mock("@/lib/auth/viewer", () => ({
  getViewer: mocks.viewer,
  requireAdmin: async () => {
    const v = await mocks.viewer();
    if (!v.isAdmin) throw Error("forbidden");
    return v;
  },
}));
vi.mock("@/lib/db/connect", () => ({ getSqlRunner: mocks.sql }));
vi.mock("@/lib/supabase/auth-client", () => ({
  getSessionUser: mocks.session,
}));
vi.mock("@/lib/storage", () => ({
  getStorage: mocks.storage,
  STAGING_BUCKET: "content",
}));
vi.mock("@/lib/brands/workspace/service", () => ({
  createBrandOrganization: mocks.create,
  createBrandProject: vi.fn(),
  approveBrandContent: vi.fn(),
  sendBrandMessage: vi.fn(),
  createBrandInvitation: vi.fn(),
  acceptBrandInvitation: mocks.accept,
  revokeBrandMember: vi.fn(),
  reserveBrandAttachment: mocks.reserve,
  completeBrandAttachment: mocks.complete,
  loadBrandAttachmentAccess: mocks.access,
  loadBrandAttachmentUploadAccess: mocks.uploadAccess,
}));
import { POST } from "@/app/api/brand-workspace/route";
import {
  GET,
  HEAD,
  POST as upload,
} from "@/app/api/brand-workspace/attachments/[id]/route";
import { POST as adminTransport } from "@/app/api/admin/brand-workspace/route";
const id = "a0000000-0000-4000-8000-000000000001";
const req = (
  operation: string,
  input: unknown = {},
  origin = "https://brand.twings.app",
) =>
  new NextRequest("https://brand.twings.app/api/brand-workspace", {
    method: "POST",
    headers: {
      host: "brand.twings.app",
      origin,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    body: JSON.stringify({ operation, input }),
  });
const read = () =>
  new NextRequest(
    `https://brand.twings.app/api/brand-workspace/attachments/${id}`,
    { headers: { host: "brand.twings.app" } },
  );
const context = { params: Promise.resolve({ id }) };
describe("brand workspace API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.viewer.mockResolvedValue({
      userId: id,
      isAdmin: false,
      email: "member@example.com",
    });
    mocks.sql.mockResolvedValue({});
    mocks.session.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ ok: true, id });
    mocks.accept.mockResolvedValue({ ok: true, organizationId: id });
    mocks.reserve.mockResolvedValue({
      ok: true,
      id,
      storageKey: "private-key-never-project",
    });
    mocks.complete.mockResolvedValue({ ok: true, id });
    mocks.access.mockResolvedValue({
      key: "private-key-never-project",
      mime: "application/pdf",
      name: "brief.pdf",
      sizeBytes: 10,
    });
    mocks.uploadAccess.mockResolvedValue(null);
    mocks.signed.mockResolvedValue("https://storage.example/signed-download");
    mocks.storage.mockResolvedValue({
      servesSignedUrls: true,
      signedStagingUrl: mocks.signed,
      signedUploadUrl: async () => "https://storage.example/signed-upload",
      read: mocks.read,
      putStaging: mocks.put,
    });
  });
  it("requires authentication and checks Origin even when Sec-Fetch-Site claims same-origin", async () => {
    expect(
      (await POST(req("organization.create", {}, "https://evil.example")))
        .status,
    ).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.viewer.mockResolvedValue({ userId: null });
    expect((await POST(req("organization.create"))).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("never permits studio business commands through the brand endpoint", async () => {
    expect(
      (await POST(req("brandWorkspace.content", { isAdmin: true }))).status,
    ).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("passes the stable client request id to the service and keeps writes private", async () => {
    const input = { name: "Brand", requestId: id };
    const response = await POST(req("organization.create", input));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.create.mock.calls[0]?.[2]).toEqual(input);
  });
  it("ignores body email claims; invitation acceptance uses only confirmed same-user session email", async () => {
    await POST(
      req("invitation.accept", {
        token: "token",
        verifiedEmail: "attacker@example.com",
      }),
    );
    expect(mocks.accept.mock.calls[0]?.[0].verifiedEmail).toBeUndefined();
    mocks.session.mockResolvedValue({
      id,
      email: "member@example.com",
      email_confirmed_at: "2026-09-20",
    });
    await POST(req("invitation.accept", { token: "token" }));
    expect(mocks.accept.mock.calls[1]?.[0].verifiedEmail).toBe(
      "member@example.com",
    );
  });
  it("does not expose storage keys or exception details in JSON", async () => {
    const response = await POST(
      req("attachment.reserve", { mime: "application/pdf" }),
    );
    expect(await response.json()).toEqual({
      ok: true,
      id,
      direct: true,
      url: "https://storage.example/signed-upload",
    });
    mocks.create.mockRejectedValue(Error("private database credentials"));
    expect(await (await POST(req("organization.create"))).text()).not.toContain(
      "credentials",
    );
  });
  it("rejects oversized metadata before dispatch", async () => {
    expect(
      (await POST(req("organization.create", { name: "x".repeat(70000) })))
        .status,
    ).toBe(413);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("checks fresh attachment access before minting a short private download", async () => {
    const response = await GET(read(), context);
    expect(response.status).toBe(302);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.signed).toHaveBeenCalledWith("private-key-never-project", 60);
    mocks.access.mockResolvedValue(null);
    expect((await GET(read(), context)).status).toBe(404);
    expect(mocks.signed).toHaveBeenCalledOnce();
  });
  it("streams large private contracts through authorized downloads instead of issuing bearer URLs", async()=>{
    const bytes=new Uint8Array(6*1024*1024).fill(42);
    mocks.access.mockResolvedValue({contract:true,key:'private',mime:'application/pdf',name:'agreement.pdf',sizeBytes:bytes.length});
    mocks.read.mockResolvedValue(bytes);
    const response=await GET(read(),context);
    expect(response.status).toBe(200);expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.signed).not.toHaveBeenCalled();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });
  it("HEAD also checks access and does not mint URLs or load large bytes", async () => {
    const response = await HEAD(read(), context);
    expect(response.status).toBe(200);
    expect(mocks.signed).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("fails closed when a cloud driver cannot sign instead of streaming through Vercel", async () => {
    mocks.signed.mockResolvedValue(null);
    expect((await GET(read(), context)).status).toBe(503);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("refuses local byte transport in cloud and after owner revocation", async () => {
    const post = () =>
      new NextRequest(
        `https://brand.twings.app/api/brand-workspace/attachments/${id}`,
        {
          method: "POST",
          headers: {
            host: "brand.twings.app",
            origin: "https://brand.twings.app",
            "content-type": "application/pdf",
          },
          body: "%PDF-file!",
        },
      );
    expect((await upload(post(), context)).status).toBe(404);
    mocks.uploadAccess.mockResolvedValue({
      key: "private",
      mime: "application/pdf",
      sizeBytes: 10,
    });
    expect((await upload(post(), context)).status).toBe(405);
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it("studio transport independently requires admin and accepts attachment transport only", async () => {
    const post = (operation: string) =>
      new NextRequest("https://admin.twings.app/api/admin/brand-workspace", {
        method: "POST",
        headers: {
          host: "admin.twings.app",
          origin: "https://admin.twings.app",
        },
        body: JSON.stringify({ operation, input: { mime: "application/pdf" } }),
      });
    expect((await adminTransport(post("attachment.reserve"))).status).not.toBe(
      200,
    );
    expect(mocks.reserve).not.toHaveBeenCalled();
    mocks.viewer.mockResolvedValue({ userId: id, isAdmin: true });
    expect((await adminTransport(post("project.create"))).status).toBe(400);
    expect((await adminTransport(post("attachment.reserve"))).status).toBe(200);
  });
});
