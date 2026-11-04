import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { authReturnPath } from "@/lib/routing/surfaces";

/**
 * The brand self-serve studio page (audit P2-5, Q5 and the P3 label): the real page with the data
 * layer stubbed. Face setup links sign in on the consumer site without leaving local/preview hosts,
 * a template without a preview never names the video engine, and results keep the selected brand.
 */
const ORG = "a0000000-0000-4000-8000-00000000000a";
const state = vi.hoisted(() => ({ brandHost: false, locale: "ko" as "ko" | "en", identity: "active" as string, previewUrl: null as string | null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/brand/studio", useSearchParams: () => new URLSearchParams(), redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("@/components/brand-workspace/context", async () => {
  const { getDictionary } = await import("@/lib/i18n/dictionaries");
  return { brandContext: async () => { const dict = getDictionary(state.locale); return {
    viewer: { userId: "00000000-0000-4000-8000-000000000001", isAdmin: false },
    sql: { query: async () => ({ rows: [{ id: "selfie", replaced_at: null }] }) },
    verifiedEmail: undefined, brandHost: state.brandHost, locale: state.locale, dict, b: dict.brandWorkspace }; } };
});
vi.mock("@/lib/brands/workspace/service", () => ({
  loadBrandWorkspaceScope: async () => ({ choices: [{ id: ORG, name: "Fixture brand", role: "owner", logoUrl: null }], projectOrganizations: {} }),
}));
vi.mock("@/lib/identity/service", () => ({ assetLibraryMode: () => "fixture", needsLiveness: () => true, identityStatusFor: async () => state.identity }));
vi.mock("@/lib/brands/production/service", () => ({
  loadProductionWorkspace: async () => ({ role: "owner", jobs: [], contracts: [{
    id: "contract", projectId: "project", title: "Fixture scope", startsAt: "2026-01-01T00:00:00Z", endsAt: "2099-01-01T00:00:00Z",
    limit: 3, used: 0, remaining: 3, enabled: true, active: true, revision: 0,
    templates: [{ id: "template", title: "Fixture format", titleKo: "픽스처 포맷", seconds: 8, aspect: "9:16", previewUrl: state.previewUrl, previewMime: null }],
  }] }),
}));

import BrandStudio from "@/app/(brand)/brand/studio/page";
import { studioIdentityHref } from "@/lib/brands/workspace/links";
import { productionResultHref } from "@/components/brand-workspace/production-create";
import { getDictionary } from "@/lib/i18n/dictionaries";

const render = async () => renderToStaticMarkup(await (BrandStudio({ searchParams: Promise.resolve({ organizationId: ORG }) }) as Promise<ReactElement>));
beforeEach(() => { state.brandHost = false; state.locale = "ko"; state.identity = "active"; state.previewUrl = null; });

describe("brand studio page", () => {
  it.each(["ko", "en"] as const)("labels the studio and a missing preview from the dictionary, never the engine (%s)", async (locale) => {
    state.locale = locale;
    const t = getDictionary(locale).brandWorkspace.productionStudio;
    const html = await render();
    expect(html).toContain(`<p class="bw-kicker">${t.eyebrow}</p>`);
    expect(html).toContain(t.previewPending);
    expect(html).toContain("data-brand-brief-studio");
    expect(html).not.toMatch(/seedance|seedream|nano\s*banana|seedvr2|comfyui/i);
  });

  it("keeps the face setup link relative off the brand host, through sign-in with the workspace language", async () => {
    state.locale = "en";
    const html = await render();
    expect(html).toContain('href="/auth/signin?next=%2Fidentity%2Fselfie%3Flocale%3Den&amp;locale=en"');
    expect(html).not.toContain("https://twings.app/identity");
  });

  it("points at twings.app from brand.twings.app, and at verification when a camera check is due", async () => {
    state.brandHost = true; state.identity = "pending";
    const html = await render();
    expect(html).toContain('href="https://twings.app/auth/signin?next=%2Fidentity%2Fverify%3Flocale%3Dko&amp;locale=ko"');
  });

  it("builds links that the consumer sign-in accepts as its return path", () => {
    for (const kind of ["selfie", "verify"] as const) {
      const url = new URL(studioIdentityHref(kind, "ko", true));
      expect(url.origin).toBe("https://twings.app");
      const next = url.searchParams.get("next");
      expect(authReturnPath(next, "twings.app", "/ko/video")).toBe(`/identity/${kind}?locale=ko`);
    }
  });

  it("opens a started production with its brand selected", () => {
    expect(productionResultHref("job", ORG, "ko")).toBe(`/brand/studio/job?organizationId=${ORG}&locale=ko`);
    expect(productionResultHref("job", null, "en")).toBe("/brand/studio/job?locale=en");
  });
});
