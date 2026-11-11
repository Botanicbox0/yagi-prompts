import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { SANDBOXED_CLIENT_ORG_IDS } from "@/lib/brands/features";
import type { BrandWorkspaceChoice } from "@/lib/brands/workspace/selection";
import { BrandAssetHub, buildHubEntries, filterHubEntries, similarityScore } from "@/components/brand-studio/asset-hub";
import { Viewer } from "@/components/brand-studio/viewer";
import { regionEditModels } from "@/components/brand-studio/dock-model";
import { imageScreenRefHref } from "@/components/brand-studio/studio-app";
import type { StudioLibrary } from "@/components/brand-studio/seams";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { ORG, asset, id, job, output, studioState } from "../ui/fixtures";

/**
 * 묶음 B (docs/BRAND-STUDIO-CLEANUP-B.md) — unified `에셋` (`/brand/library`), closed `/brand/identity`
 * and viewer `"리뷰에 올리기"`, plus Morphic sandbox byte-for-byte isolation.
 */
const MORPHIC_ID = [...SANDBOXED_CLIENT_ORG_IDS][0]!;

const state = vi.hoisted(() => ({
  locale: "ko" as "ko" | "en",
  org: { id: "", name: "Fixture brand", role: "owner", logoUrl: null, denied: undefined as string[] | undefined } as BrandWorkspaceChoice,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/brand/library",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/components/brand-workspace/context", async () => {
  const { getDictionary: loadDict } = await import("@/lib/i18n/dictionaries");
  return {
    brandContext: async () => {
      const dict = loadDict(state.locale);
      return {
        viewer: { userId: "00000000-0000-4000-8000-000000000001", isAdmin: false },
        sql: {},
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
  loadBrandWorkspaceScope: async () => ({ choices: [state.org], projectOrganizations: {} }),
  loadBrandWorkspace: async () => ({ organizations: [{ id: state.org.id, name: state.org.name, role: state.org.role }], projects: [] }),
  loadBrandSettings: async (_d: unknown, _v: unknown, orgId: string) => ({
    id: orgId,
    name: state.org.name,
    website: "",
    description: "",
    contactEmail: "",
    revision: 0,
    role: state.org.role,
    logoUrl: null,
    logoRevision: 0,
  }),
}));

import ContentLibrary from "@/app/(brand)/brand/library/page";
import BrandIdentityPage from "@/app/(brand)/brand/identity/page";
import BrandSettings from "@/app/(brand)/brand/settings/page";

function stubLibrary(patch: Partial<StudioLibrary> = {}): StudioLibrary {
  return {
    ready: true,
    folders: [],
    liked: new Set(),
    likedItems: [],
    folderItems: () => null,
    openFolder: () => {},
    toggleLike: async () => true,
    createFolder: async () => null,
    renameFolder: async () => true,
    deleteFolder: async () => true,
    addToFolder: async () => true,
    removeFromFolder: async () => true,
    ...patch,
  };
}

describe("unified BrandAssetHub & similarity lens", () => {
  beforeEach(() => {
    state.locale = "ko";
    state.org = { id: ORG, name: "Fixture brand", role: "owner", logoUrl: null, denied: undefined };
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["ko", "en"] as const)("renders unified 에셋 / Assets hub with studio launchers and zero won amounts (%s)", (locale) => {
    const dict = getDictionary(locale);
    const s = studioState({
      assets: [
        asset(1, { name: "Perfume flacon", role: "product", tags: ["glass", "spring"] }),
        asset(2, { kind: "video", name: "Runway ref", seconds: 8, url: "https://media.example/st/ref.mp4" }),
      ],
      jobs: [job(1, { prompt: "Glass perfume bottle in morning light", outputs: [output(1)] })],
    });
    const html = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        initialState={s}
        deliverableCount={2}
        injectedLibrary={stubLibrary({ liked: new Set([`a:${asset(1).id}`]) })}
      />,
    );
    expect(html).toContain("data-brand-asset-hub");
    expect(html).toContain(`>${dict.studioLibrary.label}</h1>`);
    for (const tab of ["all", "uploads", "generated", "folders", "liked", "deliverables"]) {
      expect(html).toContain(`data-asset-hub-tab="${tab}"`);
    }
    expect(html).toContain(imageScreenRefHref(ORG, { assetId: asset(1).id }).replace("&", "&amp;"));
    expect(html).toContain(`start=reverse&amp;asset=${asset(2).id}`);
    expect(html).not.toMatch(/₩|KRW|\d[\d,]*\s*원(?!래)/);
  });

  it("filters by prompt/tag/role/kind and ranks related items via similarityScore", () => {
    const entries = buildHubEntries(
      [
        asset(1, { name: "Serum bottle", role: "product", tags: ["glass", "blue"], createdAt: "2026-11-11T01:00:00Z" }),
        asset(2, { name: "Brand wordmark", role: "logo", tags: ["monochrome"], createdAt: "2026-11-11T02:00:00Z" }),
      ],
      [
        job(1, { prompt: "Blue glass serum bottle on marble", outputs: [output(1, { createdAt: "2026-11-11T03:00:00Z" })] }),
        job(2, {
          kind: "region_edit",
          parentOutputId: output(1).id,
          prompt: "Add subtle water droplets",
          outputs: [output(2, { createdAt: "2026-11-11T04:00:00Z" })],
        }),
      ],
      "생성 결과",
    );
    expect(entries).toHaveLength(4);

    // Search matches generation prompt as well as upload name/tag
    const byPrompt = filterHubEntries(entries, {
      section: "all",
      liked: new Set(),
      query: "marble",
      kind: "all",
      role: "all",
      similarTo: null,
    });
    expect(byPrompt.map((e) => e.key)).toEqual([`o:${output(1).id}`]);

    // Similarity connects parent output -> region_edit child AND matching product asset
    const anchor = entries.find((e) => e.key === `o:${output(1).id}`)!;
    const child = entries.find((e) => e.key === `o:${output(2).id}`)!;
    const prod = entries.find((e) => e.key === `a:${asset(1).id}`)!;
    const logo = entries.find((e) => e.key === `a:${asset(2).id}`)!;
    expect(similarityScore(anchor, child)).toBeGreaterThan(similarityScore(anchor, logo));
    expect(similarityScore(anchor, prod)).toBeGreaterThan(0);
    expect(similarityScore(anchor, logo)).toBe(0);
  });

  it("switches /brand/library to BrandAssetHub for ordinary brands, while keeping Morphic & closed brands byte-for-byte on legacy ContentLibrary", async () => {
    const renderLib = async () =>
      renderToStaticMarkup(await (ContentLibrary({ searchParams: Promise.resolve({ organizationId: state.org.id }) }) as Promise<ReactElement>));

    vi.stubEnv("BRAND_STUDIO_V2", "on");
    const ordinaryHtml = await renderLib();
    expect(ordinaryHtml).toContain("data-brand-asset-hub");

    for (const closed of [
      { id: MORPHIC_ID, name: "Client", role: "owner" as const, logoUrl: null },
      { id: ORG, name: "Morphic Studio", role: "owner" as const, logoUrl: null },
      { id: ORG, name: "모픽", role: "editor" as const, logoUrl: null },
      { id: ORG, name: "Denied", role: "owner" as const, logoUrl: null, denied: ["generative_media"] as const },
      { id: ORG, name: "Guest", role: "guest" as const, logoUrl: null },
    ]) {
      state.org = closed;
      vi.stubEnv("BRAND_STUDIO_V2", "off");
      const offHtml = await renderLib();
      vi.stubEnv("BRAND_STUDIO_V2", "on");
      const onHtml = await renderLib();
      expect(onHtml).toBe(offHtml);
      expect(onHtml).not.toContain("data-brand-asset-hub");
    }
  });

  it("closes /brand/identity, hides the Brand Kit bridge on /brand/settings, and omits review from Viewer", async () => {
    vi.stubEnv("BRAND_STUDIO_V2", "on");
    await expect(
      BrandIdentityPage({ searchParams: Promise.resolve({ organizationId: ORG }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    const settingsHtml = renderToStaticMarkup(
      await (BrandSettings({ searchParams: Promise.resolve({ organizationId: ORG }) }) as Promise<ReactElement>),
    );
    expect(settingsHtml).not.toContain("data-settings-identity-bridge");
    expect(settingsHtml).not.toContain("data-settings-identity-callout");
    expect(settingsHtml).not.toContain("/brand/identity");

    const copy = getDictionary("ko").brandStudio;
    const pic = output(1);
    const viewerHtml = renderToStaticMarkup(
      <Viewer
        items={[{ type: "output", output: pic, job: job(1, { outputs: [pic] }) }]}
        index={0}
        copy={copy}
        locale="ko"
        canCreate
        canGenerate
        busy={null}
        notice={null}
        regionPreset={null}
        region={{ models: regionEditModels(), defaultModel: "nano-banana-pro", recent: [], resolve: () => null, upload: async () => [] }}
        parentOf={() => null}
        onIndex={() => {}}
        onClose={() => {}}
        actions={{
          regionEdit: async () => true,
          rerun: () => {},
          toVideo: () => {},
          review: () => {},
          reference: () => {},
          save: () => {},
          campaign: () => {},
          finalize: () => {},
          reuse: () => {},
          remove: async () => true,
        }}
      />,
    );
    expect(viewerHtml).not.toContain('data-viewer-action="review"');
    expect(viewerHtml).not.toContain(copy.viewer.review);
  });
});
