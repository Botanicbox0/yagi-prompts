import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { BrandMessage } from "@/lib/brands/workspace/types";
import type { BrandChoiceRole } from "@/lib/brands/workspace/selection";
import type { ProductionContractView } from "@/lib/brands/production/service";

/**
 * Self-serve studio onboarding (docs/reviews/STUDIO-ONBOARDING-20260924.md): the page layout by stage
 * and role, rendered from the real page with the data layer stubbed. Authorization is tested in the
 * service tests; here the page must explain the first step, never ask for a face before a template
 * exists, and never offer a button the account cannot use.
 */
const ORG = "a0000000-0000-4000-8000-00000000000b";
const state = vi.hoisted(() => ({
  role: "owner" as string,
  locale: "ko" as "ko" | "en",
  contracts: [] as unknown[],
  support: [] as unknown[],
  queries: 0,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/brand/studio", useSearchParams: () => new URLSearchParams(), redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("@/components/brand-workspace/context", async () => {
  const { getDictionary } = await import("@/lib/i18n/dictionaries");
  return { brandContext: async () => { const dict = getDictionary(state.locale); return {
    viewer: { userId: "00000000-0000-4000-8000-000000000001", isAdmin: false },
    sql: { query: async () => { state.queries++; return { rows: [{ attempt_id: "portrait" }] }; } },
    verifiedEmail: undefined, brandHost: false, locale: state.locale, dict, b: dict.brandWorkspace }; } };
});
vi.mock("@/lib/brands/workspace/service", () => ({
  loadBrandWorkspaceScope: async () => ({ choices: [{ id: ORG, name: "Fixture brand", role: state.role, logoUrl: null }], projectOrganizations: {} }),
  loadBrandSupport: async () => state.support,
}));
vi.mock("@/lib/identity/service", () => ({ assetLibraryMode: () => "fixture", needsLiveness: () => false, identityStatusFor: async () => "active" }));
vi.mock("@/lib/brands/production/service", () => ({
  loadProductionWorkspace: async () => ({ role: state.role === "studio" ? "studio" : state.role, jobs: [], contracts: state.contracts }),
}));

import BrandStudio from "@/app/(brand)/brand/studio/page";
import { studioRequestStatus, studioStage } from "@/lib/brands/production/stage";
import { getDictionary } from "@/lib/i18n/dictionaries";

const ko = getDictionary("ko").brandWorkspace;
const en = getDictionary("en").brandWorkspace;
const TITLES = [ko.studioInquiry.messageTitle, en.studioInquiry.messageTitle];
const template = { id: "t1", title: "Fixture format", titleKo: "픽스처 포맷", seconds: 8, aspect: "9:16", previewUrl: null, previewMime: null };
const contract = (over: Partial<ProductionContractView> = {}): ProductionContractView => ({
  id: "c1", projectId: "p1", title: "Fixture scope", startsAt: "2026-01-01T00:00:00Z", endsAt: "2099-01-01T00:00:00Z",
  limit: 3, used: 0, remaining: 3, enabled: true, active: true, revision: 0, templates: [template], ...over,
});
const message = (authorRole: BrandMessage["authorRole"], body: string, createdAt = "2026-09-20T01:00:00Z"): BrandMessage => ({ id: `${authorRole}-${createdAt}`, body, authorRole, createdAt });
const render = async () => renderToStaticMarkup(await (BrandStudio({ searchParams: Promise.resolve({ organizationId: ORG }) }) as Promise<ReactElement>));
const set = (role: BrandChoiceRole, contracts: ProductionContractView[] = [], support: BrandMessage[] = []) => {
  state.role = role; state.contracts = contracts; state.support = support;
};
/** The face setup link (`studioIdentityHref`), encoded inside the sign-in return path. */
const IDENTITY_LINK = "%2Fidentity%2Fselfie";

beforeEach(() => { set("owner"); state.locale = "ko"; state.queries = 0; });

describe("studio stage", () => {
  const usable = { active: true, remaining: 2, templates: [template] };
  it("follows the brand from first visit to used-up allowance", () => {
    expect(studioStage({ contracts: [], canRequest: true, request: null })).toBe("onboarding");
    expect(studioStage({ contracts: [], canRequest: false, request: null })).toBe("read-only");
    expect(studioStage({ contracts: [], canRequest: true, request: { sentAt: "x", answered: false } })).toBe("requested");
    expect(studioStage({ contracts: [{ ...usable, templates: [] }], canRequest: true, request: null })).toBe("templates-pending");
    expect(studioStage({ contracts: [usable], canRequest: true, request: null })).toBe("ready");
    expect(studioStage({ contracts: [{ ...usable, remaining: 0 }, { ...usable, active: false }], canRequest: true, request: null })).toBe("used-up");
    // One usable contract with templates is enough, whatever the others say.
    expect(studioStage({ contracts: [{ ...usable, remaining: 0 }, usable], canRequest: false, request: null })).toBe("ready");
  });

  it("finds the latest template request in either language and whether TWINGS answered since", () => {
    expect(studioRequestStatus([message("brand", "Hello")], TITLES)).toBeNull();
    // A studio message that quotes the heading is not a request from the brand.
    expect(studioRequestStatus([message("studio", `${ko.studioInquiry.messageTitle}\n…`)], TITLES)).toBeNull();
    expect(studioRequestStatus([message("brand", `${en.studioInquiry.messageTitle}\nBrief`)], TITLES)).toEqual({ sentAt: "2026-09-20T01:00:00Z", answered: false });
    expect(studioRequestStatus([
      message("brand", `${ko.studioInquiry.messageTitle}\n첫 의뢰`, "2026-09-01T00:00:00Z"),
      message("studio", "확인했습니다", "2026-09-02T00:00:00Z"),
      message("brand", `${ko.studioInquiry.messageTitle}\n두 번째`, "2026-09-03T00:00:00Z"),
    ], TITLES)).toEqual({ sentAt: "2026-09-03T00:00:00Z", answered: false });
    expect(studioRequestStatus([
      message("brand", `${ko.studioInquiry.messageTitle}\n의뢰`, "2026-09-01T00:00:00Z"),
      message("studio", "답변", "2026-09-02T00:00:00Z"),
    ], TITLES)?.answered).toBe(true);
  });
});

describe("first visit", () => {
  it.each(["ko", "en"] as const)("puts what the studio does and the template request in the heading (%s)", async (locale) => {
    state.locale = locale;
    const b = getDictionary(locale).brandWorkspace;
    const html = await render();
    expect(html).toContain('data-studio-stage="onboarding"');
    const hero = html.slice(html.indexOf("bw-studio-hero"), html.indexOf("data-studio-process"));
    expect(hero).toContain(b.productionStudio.onboarding.lead);
    expect(hero).toContain(b.productionStudio.onboarding.next);
    expect(hero).toMatch(new RegExp(`<button type="button" class="bw-button bw-primary"[^>]*aria-haspopup="dialog"[^>]*>${b.studioInquiry.action}</button>`));
    expect(hero).toContain(b.productionStudio.onboarding.noCommitment);
    // The request form opens with the selected brand.
    expect(html).toContain(`<option value="${ORG}" selected="">Fixture brand</option>`);
  });

  it("marks the request as the current step and asks for no face before a template exists", async () => {
    const html = await render();
    expect(html).toMatch(/<li data-step="request" data-state="current" aria-current="step">/);
    expect(html).not.toContain(IDENTITY_LINK);
    expect(html).not.toContain("bw-production-identity");
    // No portrait lookup at all without a template.
    expect(state.queries).toBe(0);
  });

  it("shows the two examples as poster play buttons that fetch no video until activated, and the reference photo", async () => {
    const o = ko.productionStudio.onboarding;
    const html = await render();
    // Nothing points at an MP4 before someone presses play.
    expect(html).not.toContain(".mp4");
    for (const name of [o.formatVideo, o.variantVideo])
      expect(html).toContain(`<button type="button" class="bw-studio-play" aria-label="${o.playVideo.replace("{name}", name)}">`);
    expect(html).toMatch(/<img src="\/reel\/studio-demo\/designed-format\.jpg"[^>]*alt=""/);
    const videos = html.match(/<video[^>]*>/g) ?? [];
    expect(videos).toHaveLength(2);
    for (const v of videos) {
      expect(v).toContain("hidden");
      expect(v).toContain("controls");
      expect(v).toContain("playsInline");
      expect(v).toContain('preload="none"');
      expect(v).not.toMatch(/autoPlay|autoplay|muted|loop/);
    }
    expect(html).toMatch(new RegExp(`<img src="/reel/studio-demo/reference-selfie.jpeg"[^>]*alt="${o.selfieAlt}"[^>]*loading="lazy"`));
    expect(html).toContain(o.showcaseNote);
    // Honest framing: the examples are the same format, not the same cut.
    expect(o.showcaseBody).toMatch(/길이/);
    expect(en.productionStudio.onboarding.showcaseBody).toMatch(/length/);
  });
});

describe("request pending", () => {
  it("says the request arrived, moves to the design step and demotes a second request", async () => {
    set("editor", [], [message("brand", `${ko.studioInquiry.messageTitle}\n브리프`)]);
    const html = await render();
    expect(html).toContain('data-studio-request="waiting"');
    expect(html).toContain(ko.productionStudio.onboarding.requestedTitle);
    expect(html).not.toContain("{date}");
    expect(html).toMatch(/<li data-step="request" data-state="done">/);
    expect(html).toMatch(/<li data-step="design" data-state="current" aria-current="step">/);
    expect(html).toContain(`<button type="button" class="bw-button" disabled="" aria-haspopup="dialog">${ko.studioInquiry.actionMore}</button>`);
    expect(html).not.toContain("data-studio-onboarding");
  });

  it("points at the reply once TWINGS has answered", async () => {
    set("owner", [], [message("brand", `${ko.studioInquiry.messageTitle}\n브리프`, "2026-09-01T00:00:00Z"), message("studio", "답변", "2026-09-02T00:00:00Z")]);
    const html = await render();
    expect(html).toContain('data-studio-request="answered"');
    expect(html).toContain(ko.productionStudio.onboarding.answeredTitle);
  });

  it("shows a viewer the same progress without a request button", async () => {
    set("viewer", [], [message("brand", `${ko.studioInquiry.messageTitle}\n브리프`)]);
    const html = await render();
    expect(html).toContain('data-studio-request="waiting"');
    expect(html).not.toContain("data-studio-inquiry");
  });
});

describe("read-only accounts without a contract", () => {
  it("explains the studio to a viewer with no button that cannot send", async () => {
    set("viewer");
    const html = await render();
    expect(html).toContain("data-brand-studio-read-only");
    expect(html).toContain("data-studio-showcase");
    expect(html).not.toContain("data-studio-inquiry");
    expect(html).not.toContain("<li data-step=\"request\" data-state=\"current\"");
  });

  it("keeps the TWINGS team view compact and read-only", async () => {
    set("studio");
    const html = await render();
    expect(html).toContain("data-brand-staff-view");
    expect(html).toContain("data-studio-help");
    expect(html).not.toContain("bw-studio-hero");
    expect(html).not.toContain("data-studio-inquiry");
  });
});

describe("returning brands", () => {
  it("keeps templates first: folded help, no hero, and a secondary request button", async () => {
    set("owner", [contract()]);
    const html = await render();
    expect(html).toContain('data-studio-stage="ready"');
    expect(html).toContain('<details class="bw-studio-help" data-studio-help="true">');
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(html).not.toContain("bw-studio-hero");
    expect(html).not.toContain("data-studio-onboarding");
    expect(html).toContain(`class="bw-button" disabled="" aria-haspopup="dialog">${ko.studioInquiry.actionMore}`);
    expect(html.indexOf("data-studio-help")).toBeLessThan(html.indexOf("bw-production-contract"));
    // The face is asked for now, because a template can use it.
    expect(html).toContain(IDENTITY_LINK);
    expect(html).toContain(ko.productionStudio.create);
  });

  it("does not ask for a face while templates are still being prepared", async () => {
    set("owner", [contract({ templates: [] })]);
    const html = await render();
    expect(html).toContain("data-studio-templates-pending");
    expect(html).not.toContain(IDENTITY_LINK);
    expect(html).toMatch(/<li data-step="design" data-state="current"/);
  });

  it("explains a used-up allowance and makes more production the main action", async () => {
    set("editor", [contract({ remaining: 0, used: 3 }), contract({ id: "c2", active: false })]);
    const html = await render();
    expect(html).toContain("data-studio-used-up");
    expect(html).toContain(ko.productionStudio.onboarding.usedUpBody);
    expect(html).toContain("data-contract-exhausted");
    expect(html).toContain(ko.productionStudio.inactive);
    expect(html).toContain(`class="bw-button bw-primary" disabled="" aria-haspopup="dialog">${ko.studioInquiry.actionMore}`);
    expect(html).not.toContain(IDENTITY_LINK);
  });

  it("does not claim an ended or used-up contract when it is only paused or not started", async () => {
    // Inactive with allowance left: paused, or its window has not opened yet.
    set("owner", [contract({ active: false, remaining: 3 })]);
    const html = await render();
    expect(html).toContain("data-studio-used-up");
    expect(html).not.toContain("data-contract-exhausted");
    for (const d of [ko, en]) {
      const o = d.productionStudio.onboarding;
      for (const body of [o.usedUpBody, o.usedUpReadOnly]) expect(body).toMatch(d === ko ? /시작 전.*중지/ : /not have started.*paused/);
    }
    // The library links here: the history section keeps its anchor.
    expect(html).toContain('<section class="bw-panel" id="studio-history">');
  });

  it("tells a viewer why creating is not theirs, without the face setup or a request button", async () => {
    set("viewer", [contract({ remaining: 0 })]);
    const html = await render();
    expect(html).toContain(ko.productionStudio.onboarding.usedUpReadOnly);
    set("viewer", [contract()]);
    const ready = await render();
    expect(ready).toContain("data-studio-viewer-note");
    expect(ready).not.toContain(IDENTITY_LINK);
    expect(ready).not.toContain("data-studio-inquiry");
  });
});
