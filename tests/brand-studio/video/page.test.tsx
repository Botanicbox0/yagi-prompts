import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { SANDBOXED_CLIENT_ORG_IDS } from "@/lib/brands/features";
import { getAvailableCommissionTracks } from "@/lib/brands/workspace/commission-tracks";
import { studioVideoEn, studioVideoKo } from "@/messages/studio-video";

/**
 * docs/BRAND-STUDIO-V3.md §6 and §9 — `/brand/studio/video` through the real page with the data layer
 * stubbed: the route context 404s every closed case before anything renders, and an ordinary brand
 * gets the three starts, the gallery in video mode, the road to a campaign, the three requests and,
 * only with a production contract, the small contract link. Nothing on it names a client, a supplier,
 * a won amount or the old "브랜드 전용 포맷 / 인하우스 패키지" framing.
 */
const ORG = "a0000000-0000-4000-8000-00000000000c";
const MORPHIC_ID = [...SANDBOXED_CLIENT_ORG_IDS][0]!;
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
  redirect: vi.fn(),
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
// The gallery is slice B1's; this page only has to hand it the video mode and the copy.
vi.mock("@/components/brand-studio/studio-app", () => ({
  StudioApp: (props: { mode: string; organizationId: string; libraryCopy?: unknown; layersCopy?: unknown }) => (
    <div data-mock-studio-app={props.mode} data-org={props.organizationId} data-has-library={props.libraryCopy ? "" : undefined} data-has-layers={props.layersCopy ? "" : undefined} />
  ),
}));

import StudioVideoPage from "@/app/(brand)/brand/studio/video/page";

type Query = { start?: string; asset?: string };
const page = async (query: Query = {}) =>
  renderToStaticMarkup(await (StudioVideoPage({ searchParams: Promise.resolve({ organizationId: state.org.id, ...query }) }) as Promise<ReactElement>));

const ORDINARY = { id: ORG, name: "Fixture brand", role: "owner", denied: undefined };

beforeEach(() => {
  vi.stubEnv("BRAND_STUDIO_V2", "on");
  state.locale = "ko";
  state.org = { ...ORDINARY };
  state.projectOrganizations = {};
  state.contracts = true;
});
afterEach(() => vi.unstubAllEnvs());

describe("/brand/studio/video for an ordinary brand", () => {
  it("has the three starts, the gallery in video mode, the road to a campaign and the three requests", async () => {
    const html = await page();
    expect(html).toContain("data-brand-studio-video");
    expect(html).toContain(`<h1 class="bs-title">${studioVideoKo.title}</h1>`);
    for (const start of ["prompt", "reverse", "request"]) expect(html).toContain(`data-studio-video-start="${start}"`);
    expect(html).toContain(`data-mock-studio-app="video" data-org="${ORG}" data-has-library="" data-has-layers=""`);
    expect(html).toContain("data-studio-video-path");
    expect(html.match(/data-studio-video-path-step="\d"/g)).toHaveLength(5);
    expect(html).toContain("data-studio-video-path-send");
    for (const track of ["creator_campaign", "template_build", "studio_film"]) {
      expect(html).toContain(`data-studio-video-request="${track}"`);
      expect(html).toContain(`href="/brand/projects/new?track=${track}&amp;organizationId=${ORG}"`);
    }
    expect(html).toContain('id="studio-video-requests"');
    expect(html).toContain("data-studio-reverse");
    expect(html).not.toContain("data-studio-reverse-panel");
  });

  it("shows the contract link only to a brand with a production contract", async () => {
    expect(await page()).toContain(`href="/brand/studio?tab=formats&amp;organizationId=${ORG}"`);
    state.contracts = false;
    const without = await page();
    expect(without).not.toContain("data-studio-video-contracts");
    expect(without).not.toContain("tab=formats");
  });

  it("opens the reference-video drawer from the address", async () => {
    const html = await page({ start: "reverse", asset: "not-a-uuid" });
    expect(html).toContain("data-studio-reverse-open");
    expect(html).toContain("data-studio-reverse-panel");
  });

  it("keeps requests and sending to viewers out, but not the explanation", async () => {
    state.org = { ...ORDINARY, role: "viewer" };
    const html = await page();
    expect(html).toContain("data-studio-video-path");
    expect(html).not.toContain("data-studio-video-path-send");
    expect(html).not.toContain("data-studio-video-requests");
    expect(html).not.toContain('data-studio-video-start="request"');
  });

  it.each(["ko", "en"] as const)("names no client, supplier, won amount or old framing (%s)", async (locale) => {
    state.locale = locale;
    const html = await page({ start: "reverse" });
    expect(html).toContain(locale === "ko" ? studioVideoKo.path.title : studioVideoEn.path.title);
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
