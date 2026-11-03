import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { promptHarness, type PromptHarness } from "../helpers/prompts";
import { ADMIN_VIEWER } from "../helpers/admin";

const mocks = vi.hoisted(() => ({
  getViewer: vi.fn(),
  requireAdmin: vi.fn(),
  getSqlRunner: vi.fn(),
  getLocaleFromHeaders: vi.fn(),
}));

vi.mock("@/lib/auth/viewer", () => ({
  getViewer: mocks.getViewer,
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("@/lib/db/connect", () => ({ getSqlRunner: mocks.getSqlRunner }));
vi.mock("@/lib/i18n/server", () => ({ getLocaleFromHeaders: mocks.getLocaleFromHeaders }));
vi.mock("@/components/brand-workspace/language", () => ({
  WorkspaceLanguage: ({ label }: { label: string }) => <div data-lang>{label}</div>,
}));
vi.mock("@/components/admin/public-link", () => ({
  PublicLink: ({ href, children }: { href: string; children: unknown }) => (
    <a href={href}>{children as never}</a>
  ),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/admin/brand-workspace",
}));

import {
  COMMUNITY_SECTIONS,
  communitySectionHref,
  loadAdminCommunity,
  parseCommunitySection,
} from "@/lib/admin/community";
import PlatformAdminPage from "@/app/(admin)/admin/community/page";
import StudioBrands from "@/app/(admin)/admin/brand-workspace/page";
import AdminCampaignsPage from "@/app/(admin)/admin/campaigns/page";
import AdminPromptsPage from "@/app/(admin)/admin/prompts/page";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

describe("admin overhaul slice (d) — shared patterns & community read model", () => {
  let harness: PromptHarness;

  beforeAll(async () => {
    harness = await promptHarness();
    mocks.getViewer.mockResolvedValue(ADMIN_VIEWER);
    mocks.requireAdmin.mockResolvedValue(ADMIN_VIEWER);
    mocks.getSqlRunner.mockResolvedValue(harness.sql);
    mocks.getLocaleFromHeaders.mockResolvedValue("ko");
  });

  afterAll(async () => {
    await harness.close();
  });

  it("moves all SQL out of app/(admin)/admin/community/page.tsx into lib/admin/community.ts", () => {
    const pageSource = read("app", "(admin)", "admin", "community", "page.tsx");
    expect(pageSource).not.toContain("sql.query");
    expect(pageSource).toContain("loadAdminCommunity");
    expect(pageSource).toContain("dict.adminConsole.community");
    expect(pageSource).not.toContain("c.adminTitle");
    expect(pageSource).not.toContain("c.adminHint");
  });

  it("parses community section filter pills and builds canonical URLs", () => {
    expect(parseCommunitySection({})).toBe("all");
    expect(parseCommunitySection({ section: "unknown" })).toBe("all");
    for (const sec of COMMUNITY_SECTIONS) {
      expect(parseCommunitySection({ section: sec })).toBe(sec);
    }
    expect(communitySectionHref("all")).toBe("/admin/community");
    expect(communitySectionHref("intake")).toBe("/admin/community?section=intake");
  });

  it("loads the community board from PostgreSQL and renders section filter pills", async () => {
    const board = await loadAdminCommunity(harness.sql);
    expect(board.ready).toBe(true);
    if (board.ready) {
      expect(board.counts.totalWaiting).toBeGreaterThanOrEqual(0);
    }

    const allHtml = renderToStaticMarkup(
      await PlatformAdminPage({ searchParams: Promise.resolve({}) }),
    );
    expect(allHtml).toContain("data-admin-page-head");
    expect(allHtml).toContain("data-admin-community-nav");
    expect(allHtml).toContain("data-platform-admin");
    expect(allHtml).toContain('data-filter="all" aria-current="true"');
    expect(allHtml).toContain('data-filter="intake"');
    expect(allHtml).toContain('data-filter="social"');
    expect(allHtml).toContain('data-filter="feedback"');
    expect(allHtml).toContain('data-filter="policy"');
    // Default `all` view keeps every anchor present so redirects to #social or #format-* work.
    for (const id of ["threads", "formats", "ratings", "applications", "claims"]) {
      expect(allHtml).toContain(`id="${id}"`);
    }

    // Filtered `intake` view focuses only on applications & formats.
    const intakeHtml = renderToStaticMarkup(
      await PlatformAdminPage({ searchParams: Promise.resolve({ section: "intake" }) }),
    );
    expect(intakeHtml).toContain('data-filter="intake" aria-current="true"');
    expect(intakeHtml).toContain('id="applications"');
    expect(intakeHtml).toContain('id="formats"');
    expect(intakeHtml).not.toContain('id="threads"');
    expect(intakeHtml).not.toContain('id="claims"');
  });

  it("applies AdminPageHeader across brand-workspace, campaigns, and prompts boards", async () => {
    const brandHtml = renderToStaticMarkup(await StudioBrands());
    expect(brandHtml).toContain("data-admin-page-head");
    expect(brandHtml).toContain("data-studio-brand-queue");
    expect(brandHtml).toContain("data-usage-queue-link");

    const campaignsHtml = renderToStaticMarkup(
      await AdminCampaignsPage({ searchParams: Promise.resolve({}) }),
    );
    expect(campaignsHtml).toContain("data-admin-page-head");
    expect(campaignsHtml).toContain("data-new-campaign");

    const promptsHtml = renderToStaticMarkup(
      await AdminPromptsPage({ searchParams: Promise.resolve({}) }),
    );
    expect(promptsHtml).toContain("data-admin-page-head");
    expect(promptsHtml).toContain("data-prompt-new");
    expect(promptsHtml).toContain('data-tab="all"');
  });
});
