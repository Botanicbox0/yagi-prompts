import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { SANDBOXED_CLIENT_ORG_IDS } from "@/lib/brands/features";

/**
 * docs/BRAND-STUDIO-V2.md §3 and §5.1–5.3 through the real pages with the data layer stubbed:
 * flag off renders today's pages, flag on gives an ordinary brand the v2 studio and the three doors,
 * and a sandboxed or generation-closed brand gets no page, no door and no studio link at all.
 */
const ORG = "a0000000-0000-4000-8000-00000000000a";
const MORPHIC_ID = [...SANDBOXED_CLIENT_ORG_IDS][0]!;
const state = vi.hoisted(() => ({
  locale: "ko" as "ko" | "en",
  org: { id: "", name: "Fixture brand", role: "owner", denied: undefined as string[] | undefined },
  projects: 0,
  contracts: true,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/brand/studio",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/components/brand-workspace/context", async () => {
  const { getDictionary } = await import("@/lib/i18n/dictionaries");
  return {
    brandContext: async () => {
      const dict = getDictionary(state.locale);
      return {
        viewer: { userId: "00000000-0000-4000-8000-000000000001", isAdmin: false },
        sql: { query: async () => ({ rows: [{ id: "selfie", replaced_at: null }] }) },
        verifiedEmail: undefined,
        brandHost: false,
        locale: state.locale,
        dict,
        b: dict.brandWorkspace,
      };
    },
  };
});
const project = (i: number) => ({
  id: `p${i}`, organizationId: state.org.id, organizationName: state.org.name, title: `Launch ${i}`, objective: "", audience: "",
  budgetKrw: null, budgetTaxBasis: "unspecified", productionMode: "studio", status: "active", revision: 1, createdAt: "2026-09-01", updatedAt: "2026-09-01",
  criteria: { platforms: ["instagram"], minFollowers: null, maxFollowers: null, primaryMetric: "views", targetValue: null }, startsOn: null, endsOn: null,
});
vi.mock("@/lib/brands/workspace/service", () => ({
  countPendingSharedCampaigns: async () => 0,
  loadBrandSupport: async () => [],
  loadBrandWorkspaceScope: async () => ({ choices: [{ ...state.org, logoUrl: null }], projectOrganizations: {} }),
  loadBrandWorkspace: async () => ({
    organizations: state.org.role === "guest" ? [] : [{ id: state.org.id, name: state.org.name, role: state.org.role }],
    projects: Array.from({ length: state.projects }, (_, i) => project(i)),
  }),
}));
vi.mock("@/lib/identity/service", () => ({ assetLibraryMode: () => "fixture", needsLiveness: () => false, identityStatusFor: async () => "active" }));
vi.mock("@/lib/brands/production/service", () => ({
  loadProductionWorkspace: async () => ({
    role: state.org.role,
    jobs: [],
    contracts: state.contracts
      ? [{ id: "contract", projectId: "project", title: "Fixture scope", startsAt: "2026-01-01T00:00:00Z", endsAt: "2099-01-01T00:00:00Z", limit: 3, used: 0, remaining: 3, enabled: true, active: true, revision: 0,
          templates: [{ id: "template", title: "Fixture format", titleKo: "픽스처 포맷", seconds: 8, aspect: "9:16", previewUrl: null, previewMime: null }] }]
      : [],
  }),
}));

import BrandStudio from "@/app/(brand)/brand/studio/page";
import BrandHome from "@/app/(brand)/brand/page";

type Query = { organizationId?: string; tab?: string; mode?: string };
const studio = async (query: Query = {}) =>
  renderToStaticMarkup(await (BrandStudio({ searchParams: Promise.resolve({ organizationId: state.org.id, ...query }) }) as Promise<ReactElement>));
const home = async () => renderToStaticMarkup(await (BrandHome({ searchParams: Promise.resolve({ organizationId: state.org.id }) }) as Promise<ReactElement>));

const ORDINARY = { id: ORG, name: "Fixture brand", role: "owner", denied: undefined };
const CLOSED: Array<[string, typeof state.org]> = [
  ["a sandboxed organization id", { id: MORPHIC_ID, name: "Renamed client", role: "owner", denied: undefined }],
  ["an organization named Morphic", { id: ORG, name: "Morphic Korea", role: "owner", denied: undefined }],
  ["an organization named 모픽", { id: ORG, name: "모픽 마케팅", role: "owner", denied: undefined }],
  ["a brand whose policy closes generative media", { id: ORG, name: "Fixture brand", role: "owner", denied: ["generative_media"] }],
];

beforeEach(() => {
  state.locale = "ko";
  state.org = { ...ORDINARY };
  state.projects = 0;
  state.contracts = true;
});
afterEach(() => vi.unstubAllEnvs());

describe("/brand/studio", () => {
  it("renders today's page while the flag is off", async () => {
    vi.stubEnv("BRAND_STUDIO_V2", "off");
    const html = await studio();
    expect(html).toContain("data-brand-brief-studio");
    expect(html).toContain("bw-production-contract");
    expect(html).not.toContain("data-brand-studio-v2");
    expect(html).not.toContain("data-studio-dock");
  });

  it.each(["ko", "en"] as const)("opens the image screen for an ordinary brand, with no tab bar (%s)", async (locale) => {
    vi.stubEnv("BRAND_STUDIO_V2", "on");
    state.locale = locale;
    const html = await studio();
    const { getDictionary } = await import("@/lib/i18n/dictionaries");
    expect(html).toContain("data-brand-studio-v2");
    expect(html).toContain('data-studio-screen="image"');
    expect(html).toContain(`<h1 class="bs-title">${getDictionary(locale).brandStudio.title}</h1>`);
    expect(html).toContain("data-studio-skeleton");
    expect(html).toContain("data-studio-head-slot");
    expect(html).not.toContain("data-brand-brief-studio");
    expect(html).not.toContain("bs-tabs");
    expect(html).not.toContain("tab=formats");
  });

  it("sends an old ?mode=video link to the video screen", async () => {
    vi.stubEnv("BRAND_STUDIO_V2", "on");
    await expect(studio({ mode: "video" })).rejects.toThrow(`NEXT_REDIRECT:/brand/studio/video?organizationId=${ORG}`);
  });

  it("keeps the contract templates on ?tab=formats for a brand with a contract, own-face checks untouched", async () => {
    vi.stubEnv("BRAND_STUDIO_V2", "on");
    const html = await studio({ tab: "formats" });
    expect(html).toContain('data-studio-formats="contracts"');
    expect(html).toContain("bw-production-contract");
    expect(html).toContain("픽스처 포맷");
    expect(html).toContain(`href="/brand/studio?organizationId=${ORG}"`);
    expect(html).not.toContain("data-studio-dock");
  });

  it("sends ?tab=formats back to the image screen when there is no contract", async () => {
    vi.stubEnv("BRAND_STUDIO_V2", "on");
    state.contracts = false;
    await expect(studio({ tab: "formats" })).rejects.toThrow(`NEXT_REDIRECT:/brand/studio?organizationId=${ORG}`);
  });

  it.each(CLOSED)("answers %s with notFound even with the flag on", async (_label, org) => {
    vi.stubEnv("BRAND_STUDIO_V2", "on");
    state.org = org;
    await expect(studio()).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(studio({ tab: "formats" })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("/brand home", () => {
  it("keeps the showcase and no doors while the flag is off", async () => {
    vi.stubEnv("BRAND_STUDIO_V2", "off");
    state.projects = 2;
    const html = await home();
    expect(html).toContain("data-brand-quick-dock");
    expect(html).not.toContain("data-brand-doors");
  });

  it.each(["ko", "en"] as const)("is the campaign list alone once the rail carries the studio: no doors, no showcase (%s)", async (locale) => {
    vi.stubEnv("BRAND_STUDIO_V2", "on");
    state.locale = locale;
    state.projects = 2;
    const html = await home();
    expect(html).not.toContain("data-brand-doors");
    expect(html).not.toContain("data-brand-door=");
    expect(html).not.toContain("data-brand-quick-dock");
    expect(html).toContain('id="brand-campaigns"');
  });

  it.each(CLOSED)("shows %s exactly today's home, with no door and no studio link", async (_label, org) => {
    state.org = org;
    state.projects = 1;
    vi.stubEnv("BRAND_STUDIO_V2", "off");
    const before = await home();
    vi.stubEnv("BRAND_STUDIO_V2", "on");
    const after = await home();
    expect(after).toBe(before);
    expect(after).not.toContain("data-brand-doors");
    expect(after).not.toContain("/brand/studio");
    expect(after).not.toMatch(/studio|스튜디오/i);
  });
});
