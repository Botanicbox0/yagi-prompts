import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A submitted commission tells the YAGI team (docs/BRAND-CLIENT-WORK.md §4 B): once per successful
 * `project.create`, never on a failed one, and a failing alert never fails the client's request.
 */
const mocks = vi.hoisted(() => ({
  viewer: vi.fn(),
  sql: vi.fn(),
  createProject: vi.fn(),
  alert: vi.fn(),
  support: vi.fn(),
}));
vi.mock("@/lib/auth/viewer", () => ({ getViewer: mocks.viewer }));
vi.mock("@/lib/db/connect", () => ({ getSqlRunner: mocks.sql }));
vi.mock("@/lib/brands/workspace/service", () => ({ createBrandProject: mocks.createProject }));
vi.mock("@/lib/brands/concierge-slack", () => ({
  notifySlackBrandProjectRequest: mocks.alert,
  notifySlackBrandConcierge: mocks.support,
  syncSlackConciergeReplies: vi.fn(),
}));

import { POST } from "@/app/api/brand-workspace/route";

const ORG = "a0000000-0000-4000-8000-000000000001";
const USER = "a0000000-0000-4000-8000-000000000002";
const PROJECT = "a0000000-0000-4000-8000-000000000003";

const req = (input: unknown) =>
  new NextRequest("https://brand.twings.app/api/brand-workspace", {
    method: "POST",
    headers: { host: "brand.twings.app", origin: "https://brand.twings.app", "content-type": "application/json" },
    body: JSON.stringify({ operation: "project.create", input }),
  });

const input = {
  organizationId: ORG,
  title: "봄 신제품 영상",
  requestId: "a0000000-0000-4000-8000-000000000009",
  intakeBrief: {
    v: 1,
    track: "studio_film",
    schedule: { startsOn: null, dueOn: "2026-12-20" },
    budgetBand: "undecided",
  },
};

describe("project.create staff alert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.viewer.mockResolvedValue({ userId: USER, isAdmin: false });
    mocks.sql.mockResolvedValue({});
    mocks.createProject.mockResolvedValue({ ok: true, id: PROJECT });
    mocks.alert.mockResolvedValue({ sent: true });
  });

  it("alerts the team once with the organization, project and its id after a successful create", async () => {
    const response = await POST(req(input));
    expect(response.status).toBe(200);
    expect(mocks.alert).toHaveBeenCalledOnce();
    const [, payload] = mocks.alert.mock.calls[0]!;
    expect(payload).toMatchObject({ organizationId: ORG, projectId: PROJECT, title: "봄 신제품 영상" });
    expect(mocks.support).not.toHaveBeenCalled();
  });

  it("does not alert when the create fails", async () => {
    mocks.createProject.mockResolvedValue({ ok: false, code: "forbidden" });
    const response = await POST(req(input));
    expect(response.status).toBe(403);
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it("still answers 200 when the alert throws", async () => {
    mocks.alert.mockRejectedValue(new Error("slack down"));
    const response = await POST(req(input));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, id: PROJECT });
    expect(mocks.alert).toHaveBeenCalledOnce();
  });
});
