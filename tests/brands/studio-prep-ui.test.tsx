import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { BrandProjectDetail } from "@/lib/brands/workspace/types";
import type { BrandWorkspaceChoice } from "@/lib/brands/workspace/selection";

/**
 * Who is offered the studio's campaign preparation on brand.twings.app (docs/BRAND-STAFF-ACCESS.md
 * "운영자 캠페인 준비"): DB admins in the TWINGS team view only. Real pages, data layer stubbed;
 * server authorization is covered by tests/brands/studio-prep.test.ts.
 */
const state = vi.hoisted(() => ({ isAdmin: true, choices: [] as BrandWorkspaceChoice[] }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/brand/projects/new",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("@/components/brand-workspace/context", async () => {
  const { getDictionary } = await import("@/lib/i18n/dictionaries");
  return {
    brandContext: async () => {
      const dict = getDictionary("ko");
      return { viewer: { userId: "00000000-0000-4000-8000-000000000001", isAdmin: state.isAdmin }, sql: { query: async () => ({ rows: [] }) }, locale: "ko", dict, b: dict.brandWorkspace };
    },
  };
});
vi.mock("@/lib/brands/workspace/service", () => ({
  countPendingSharedCampaigns: async () => 0,
  loadBrandWorkspaceScope: async () => ({ choices: state.choices, projectOrganizations: {} }),
  loadBrandWorkspace: async () => ({ organizations: [], projects: [] }),
}));
vi.mock("@/lib/prompts/catalog", () => ({ loadPromptCatalog: async () => ({ video: [] }) }));

import BrandHome from "@/app/(brand)/brand/page";
import NewBrandProject from "@/app/(brand)/brand/projects/new/page";
import { ProjectDetail } from "@/components/brand-workspace/project-detail";
import { ShortlistAdmin } from "@/components/brand-workspace/shortlist-admin";
import { BrandStatusForms } from "@/components/admin/brand-status";
import { getDictionary } from "@/lib/i18n/dictionaries";

const b = getDictionary("ko").brandWorkspace;
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const studio = (id: string, name: string): BrandWorkspaceChoice => ({ id, name, role: "studio", logoUrl: null });
const html = async (page: Promise<ReactElement> | ReactElement) => renderToStaticMarkup(await page);
const search = (organizationId?: string) => ({ searchParams: Promise.resolve(organizationId ? { organizationId } : {}) });

beforeEach(() => { state.isAdmin = true; state.choices = [studio(A, "Fixture brand A"), studio(B, "Fixture brand B")]; });

describe("the new-campaign page", () => {
  it("lets a DB admin pick any brand and prepare the campaign through the brand host's studio door", async () => {
    const page = await html(NewBrandProject(search(B)));
    expect(page).toContain('data-studio-prep="2"');
    expect(page).toContain('action="/api/brand-workspace/studio"');
    expect(page).toContain(`<option value="${B}" selected="">Fixture brand B</option>`);
    expect(page).toContain(`<option value="${A}">Fixture brand A</option>`);
    expect(page).toContain(b.studioPrep.next);
    expect(page).toContain("data-studio-prep-new-brand");
    expect(page).not.toContain("data-brand-new-project-read-only");
    expect(page).not.toContain("data-campaign-wizard");
  });

  it("opens brand registration when there is no brand to choose yet", async () => {
    state.choices = [];
    const page = await html(NewBrandProject(search()));
    expect(page).toContain('data-studio-prep="0"');
    expect(page).toContain(b.studioPrep.noBrands);
    expect(page).toMatch(/<details class="bw-contract-add" data-studio-prep-new-brand="true" open="">/);
  });

  it("keeps a team-domain reader (not a DB admin) read-only", async () => {
    state.isAdmin = false;
    const page = await html(NewBrandProject(search(A)));
    expect(page).toContain("data-brand-new-project-read-only");
    expect(page).toContain(b.access.staffReadOnly);
    expect(page).not.toContain("data-studio-prep");
    expect(page).not.toContain("/api/brand-workspace/studio");
  });

  it("leaves a DB admin's own brand on the customer wizard", async () => {
    state.choices = [{ id: A, name: "Fixture brand A", role: "owner", logoUrl: null }, studio(B, "Fixture brand B")];
    const page = await html(NewBrandProject(search(A)));
    expect(page).toContain("data-campaign-wizard");
    expect(page).not.toContain("data-studio-prep");
  });
});

describe("the campaign home", () => {
  it("offers a DB admin a new campaign for the selected brand", async () => {
    const page = await html(BrandHome(search(B)));
    expect(page).toContain(`href="/brand/projects/new?organizationId=${B}" class="bw-button bw-primary" data-studio-prep-link="true"`);
    expect(page).toContain(b.studioPrep.cta);
  });

  it("offers nothing new to a team-domain reader", async () => {
    state.isAdmin = false;
    const page = await html(BrandHome(search(B)));
    expect(page).not.toContain("data-studio-prep-link");
  });
});

describe("the campaign page in the TWINGS team view", () => {
  const project = {
    id: B, organizationId: A, organizationName: "Fixture brand A", title: "Fixture launch", objective: "Fixture objective", audience: "",
    budgetKrw: null, budgetTaxBasis: "unspecified", criteria: { platforms: [], minFollowers: null, maxFollowers: null, primaryMetric: "views", targetValue: null },
    startsOn: null, endsOn: null, productionMode: "creator", status: "requested", revision: 0, clientVisible: false,
    createdAt: "2026-10-29T00:00:00Z", updatedAt: "2026-10-29T00:00:00Z", role: "studio", canComment: false, referenceLinks: [],
    contents: [], decisions: [], messages: [], attachments: [], posts: [], contracts: [], contractUploads: [], reports: [],
  } as BrandProjectDetail;
  const candidate = { id: A, handle: "fixture.creator", displayName: null, category: null, metrics: { followers: 12000 }, shared: false, picked: false, measuredOn: "2026-10-27" };
  const tools = <ShortlistAdmin projectId={B} view={{ candidates: [candidate] } as never} back={`/brand/projects/${B}#shortlist-admin`} copy={b.shortlistAdmin} locale="ko" brandHost />;

  it("shows the shortlist panel with the import campaign ID, posting to the brand host's door", () => {
    const page = renderToStaticMarkup(<ProjectDetail project={project} b={b} locale="ko" staffTools={tools} />);
    expect(page).toContain(`data-shortlist-project-id="true">${B}</code>`);
    expect(page).toContain(b.shortlistAdmin.projectId);
    const panel = page.slice(page.indexOf("data-shortlist-admin"));
    // Sharing only (all + one candidate); file import and removal are on the admin screen.
    expect([...panel.matchAll(/<form[^>]*\saction="([^"]+)"/g)].map((m) => m[1])).toEqual(["/api/brand-workspace/studio", "/api/brand-workspace/studio"]);
    expect(panel).not.toContain("brandWorkspace.shortlistImport");
    expect(panel).not.toContain("brandWorkspace.shortlistRemove");
    expect(panel).not.toContain('type="file"');
    expect(panel).toContain(b.shortlistAdmin.adminOnly);
    expect(page).not.toContain('action="/admin/do"');
    // Above the tabs, right under the team-view notice and the "not shared yet" line.
    expect(page.indexOf("data-project-unshared")).toBeLessThan(page.indexOf("data-shortlist-admin"));
    expect(page.indexOf("data-shortlist-admin")).toBeLessThan(page.indexOf('class="bw-tabs"'));
  });

  it("never renders the studio panel on a customer's own seat", () => {
    const page = renderToStaticMarkup(<ProjectDetail project={{ ...project, role: "owner" }} b={b} locale="ko" staffTools={tools} />);
    expect(page).not.toContain("data-shortlist-admin");
  });

  it("offers completion from the campaign page, posting to the brand host's door with a confirmation box", () => {
    const admin = getDictionary("ko").admin;
    const status = (brandHost: boolean) => renderToStaticMarkup(
      <BrandStatusForms brandHost={brandHost} back={`/brand/projects/${B}#studio-tools`} projectId={B} status="active" revision={3} b={b} admin={admin} />);
    const page = status(true);
    expect(page).toContain('data-brand-status-moves="completed cancelled"');
    expect([...page.matchAll(/<form[^>]*\saction="([^"]+)"/g)].map((m) => m[1])).toEqual(["/api/brand-workspace/studio", "/api/brand-workspace/studio"]);
    expect(page).toContain(`name="_back" value="/brand/projects/${B}#studio-tools"`);
    expect(page).toContain('name="status" value="completed"');
    expect(page).toContain(admin.confirmBrandComplete);
    expect(page).toContain(b.complete);
    // The admin screen keeps its own door.
    expect(status(false)).toContain('action="/admin/do"');
    expect(status(false)).not.toContain("/api/brand-workspace/studio");
  });
});
