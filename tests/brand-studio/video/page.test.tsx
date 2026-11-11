import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { SANDBOXED_CLIENT_ORG_IDS } from "@/lib/brands/features";
import { getAvailableCommissionTracks } from "@/lib/brands/workspace/commission-tracks";
import { studioVideoEn, studioVideoKo } from "@/messages/studio-video";

/**
 * Bundle C (`docs/BRAND-STUDIO-VIDEO-C.md`) — `/brand/studio/video` mounts the 2-column Video Studio
 * workspace (`영상 만들기` [`문장·참조로 만들기` | `설계도로 재현`] and `영상 편집`), redirects legacy `?view=request`
 * to `/brand/projects/new`, 404s every closed/sandboxed case before rendering, and leaks zero client names,
 * provider/model names, won amounts, or deprecated framing in SSR markup.
 */
const ORG = "a0000000-0000-4000-8000-00000000000c";
const ASSET = "b0000000-0000-4000-8000-00000000000d";
const MORPHIC_ID = [...SANDBOXED_CLIENT_ORG_IDS][0]!;
const redirectSpy = vi.hoisted(() =>
  vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  }),
);
const state = vi.hoisted(() => ({
  locale: "ko" as "ko" | "en",
  org: { id: "", name: "Fixture brand", role: "owner", denied: undefined as string[] | undefined },
  projectOrganizations: {} as Record<string, string>,
  contracts: true,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/brand/studio/video",
  useSearchParams: () => new URLSearchParams(),
  redirect: redirectSpy,
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
        sql: { query: async (text: string) => ({ rows: text.includes("brand_production_contracts") && state.contracts ? [{ one: 1 }] : [] }) },
        verifiedEmail: undefined,
        brandHost: false,
        locale: state.locale,
        dict,
        b: dict.brandWorkspace,
      };
    },
  };
});
vi.mock("@/lib/brands/workspace/service", () => ({
  countPendingSharedCampaigns: async () => 0,
  loadBrandSupport: async () => [],
  loadBrandWorkspaceScope: async () => ({ choices: [{ ...state.org, logoUrl: null }], projectOrganizations: state.projectOrganizations }),
  loadBrandWorkspace: async () => ({ organizations: [], projects: [] }),
}));

import StudioVideoPage from "@/app/(brand)/brand/studio/video/page";

type Query = { start?: string; asset?: string; view?: string; tab?: string };
const page = async (query: Query = {}) =>
  renderToStaticMarkup(await (StudioVideoPage({ searchParams: Promise.resolve({ organizationId: state.org.id, ...query }) }) as Promise<ReactElement>));

const ORDINARY = { id: ORG, name: "Fixture brand", role: "owner", denied: undefined };

beforeEach(() => {
  vi.stubEnv("BRAND_STUDIO_V2", "on");
  redirectSpy.mockClear();
  state.locale = "ko";
  state.org = { ...ORDINARY };
  state.projectOrganizations = {};
  state.contracts = true;
});
afterEach(() => vi.unstubAllEnvs());

describe("/brand/studio/video for an ordinary brand", () => {
  it("renders the 2-column Video Studio workspace with create/edit tabs, frames, prompt dock, and history/guide tabs", async () => {
    const html = await page();
    expect(html).toContain("data-brand-studio-video");
    expect(html).toContain(`<h1 class="bs-title">${studioVideoKo.title}</h1>`);
    expect(html).toContain("data-video-studio-workspace");
    expect(html).toContain('data-video-tab="create"');
    expect(html).toContain('data-video-tab="edit"');
    expect(html).toContain('data-video-create-mode="prompt"');
    expect(html).toContain('data-video-create-mode="blueprint"');
    expect(html).toContain("data-video-start-frame");
    expect(html).toContain("data-video-end-frame");
    expect(html).toContain('data-video-stage-tab="history"');
    expect(html).toContain('data-video-stage-tab="guide"');
    expect(html).toContain(`href="/brand/projects/new?organizationId=${ORG}"`);
    expect(html).toContain("data-studio-video-request-link");
  });

  it("redirects legacy ?view=request to /brand/projects/new (Bundle E project intake)", async () => {
    await expect(page({ view: "request" })).rejects.toThrow(`NEXT_REDIRECT:/brand/projects/new?organizationId=${ORG}`);
    expect(redirectSpy).toHaveBeenCalledWith(`/brand/projects/new?organizationId=${ORG}`);
  });

  it("opens blueprint remake mode on ?start=reverse (winning over ?view=request) and edit mode on ?tab=edit", async () => {
    const blueprintHtml = await page({ start: "reverse", asset: ASSET, view: "request" });
    expect(blueprintHtml).toContain("data-video-blueprint-panel");
    expect(redirectSpy).not.toHaveBeenCalled();

    const editHtml = await page({ tab: "edit" });
    expect(editHtml).toContain("data-video-edit-panel");
  });

  it("shows the contract link only to a brand with a production contract", async () => {
    expect(await page()).toContain(`href="/brand/studio?tab=formats&amp;organizationId=${ORG}"`);
    state.contracts = false;
    const without = await page();
    expect(without).not.toContain("data-studio-video-contracts");
    expect(without).not.toContain("tab=formats");
  });

  it("hides the project request link from viewers while keeping the workspace readable", async () => {
    state.org = { ...ORDINARY, role: "viewer" };
    const html = await page();
    expect(html).toContain("data-video-studio-workspace");
    expect(html).not.toContain("data-studio-video-request-link");
  });

  it.each(["ko", "en"] as const)("names no client, supplier, won amount or old framing (%s)", async (locale) => {
    state.locale = locale;
    const html = (await page()) + (await page({ start: "reverse" })) + (await page({ tab: "edit" }));
    expect(html).toContain(locale === "ko" ? studioVideoKo.workspace.tabs.create : studioVideoEn.workspace.tabs.create);
    for (const banned of [/9편|200만|2M\+? views/i, /morphic|모픽/i, /sunra|higgsfield|seedance|gemini/i, /브랜드 전용 포맷|인하우스 패키지/, /₩|\d원\b/]) {
      expect(html).not.toMatch(banned);
    }
  });
});

describe("/brand/studio/video is not there for", () => {
  const CLOSED: Array<[string, Partial<typeof state.org>]> = [
    ["a sandboxed organization id", { id: MORPHIC_ID, name: "Renamed client" }],
    ["an organization named Morphic", { name: "Morphic Korea" }],
    ["an organization named 모픽", { name: "모픽 마케팅" }],
    ["a brand whose policy closes generative media", { denied: ["generative_media"] }],
  ];
  it.each(CLOSED)("%s", async (_label, patch) => {
    state.org = { ...ORDINARY, ...patch };
    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a campaign-only invitee", async () => {
    state.org = { ...ORDINARY, role: "guest" };
    state.projectOrganizations = { p1: ORG };
    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("anyone while the flag is off", async () => {
    vi.stubEnv("BRAND_STUDIO_V2", "off");
    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("the request tracks say what the video screen says", () => {
  it.each(["ko", "en"] as const)("in %s, without the old framing, and template_build stays hidden where generation is closed", (locale) => {
    const words = (locale === "ko" ? studioVideoKo : studioVideoEn).requests.tracks;
    const tracks = getAvailableCommissionTracks({ locale });
    expect(tracks.map((t) => t.id)).toEqual(["creator_campaign", "template_build", "studio_film"]);
    for (const track of tracks) {
      expect(track.title).toBe(words[track.id].title);
      expect(track.subtitle).toBe(words[track.id].line);
      expect(track.summary).toBe(words[track.id].summary);
    }
    expect(getAvailableCommissionTracks({ locale, generativeClosed: true }).map((t) => t.id)).toEqual(["creator_campaign", "studio_film"]);
    const all = JSON.stringify([tracks, words]);
    expect(all).not.toMatch(/브랜드 전용 포맷|인하우스 패키지|셀프 스튜디오|9편|200만|모픽|morphic/i);
    expect(JSON.stringify(words)).toMatch(locale === "ko" ? /한국과 일본/ : /Korea and Japan/);
  });
});
