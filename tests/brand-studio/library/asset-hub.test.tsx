import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { SANDBOXED_CLIENT_ORG_IDS } from "@/lib/brands/features";
import type { BrandWorkspaceChoice } from "@/lib/brands/workspace/selection";
import { BrandAssetHub, buildHubEntries, filterHubEntries, hubActions, humanTitle, similarityScore } from "@/components/brand-studio/asset-hub";
import { HubDetail } from "@/components/brand-studio/asset-hub-tile";
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

function actionCopy(locale: "ko" | "en") {
  const dict = getDictionary(locale);
  const h = dict.studioLibrary.hub;
  return {
    useImage: h.openInImage,
    decorate: dict.brandStudio.gallery.menu.decorate,
    makeVideo: h.openInVideo,
    compose: h.openInCompose,
    reverse: h.reverseVideo,
    share: h.shareReview,
    similar: h.findSimilar,
    edit: dict.studioLibrary.uploads.edit,
  };
}

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
    // "참고 영상으로 만들기" moved off the tile into the uploaded film's "more" menu and sheet.
    const film = buildHubEntries(s.assets, s.jobs, dict.studioLibrary.hub.sourceGenerated).find((e) => e.key === `a:${asset(2).id}`)!;
    const reverse = hubActions(film, { organizationId: ORG, canOpenStudio: true, canCreate: true, copy: actionCopy(locale) }).more.find((a) => a.key === "reverse");
    expect(reverse).toMatchObject({ label: dict.studioLibrary.hub.reverseVideo, marker: "data-asset-hub-reverse" });
    expect(reverse?.href).toContain(`start=reverse&asset=${asset(2).id}`);
    expect(html).not.toMatch(/₩|KRW|\d[\d,]*\s*원(?!래)/);
  });

  it("shows a human name or nothing: export ids, hashes and camera-roll names never become a title", () => {
    for (const ugly of [
      "hf_20261109_095947_a9a77cc2-dbe1-4471-81ba-0c5a1d2e3f40.png",
      "f03b2fe9-a08c-4e29-abc0-2c5977594b27.mp4",
      "a98d50255f2a89f6934c04155b9de0c7.jpg",
      "IMG_4821.JPG",
      "KakaoTalk_20261109_123456789.jpg",
      "스크린샷 2026-11-09 153312.png",
      "2026-11-09 14.22.33.mov",
      "video.mp4",
      "",
      "   ",
    ]) {
      expect(humanTitle(ugly), ugly).toBeNull();
    }
    expect(humanTitle("봄 신제품 컷.jpg")).toBe("봄 신제품 컷");
    expect(humanTitle("Perfume flacon")).toBe("Perfume flacon");
    expect(humanTitle("product_shot_v2.png")).toBe("product shot v2");
    expect(humanTitle("logo.png")).toBe("logo");
    // A prompt gives its first line only.
    expect(humanTitle("A hand slowly places a round glass perfume bottle\nCamera: slow push in")).toBe("A hand slowly places a round glass perfume bottle");
  });

  it.each(["ko", "en"] as const)("draws the picture as the tile: no file name, no button row, one main action, a length on films (%s)", (locale) => {
    const dict = getDictionary(locale);
    const ugly = "hf_20261109_095947_a9a77cc2-dbe1-4471-81ba-0c5a1d2e3f40.png";
    const film = "f03b2fe9-a08c-4e29-abc0-2c5977594b27.mp4";
    const html = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        initialState={studioState({
          assets: [
            asset(1, { name: ugly, width: 1600, height: 2000 }),
            asset(2, { kind: "video", name: film, seconds: 42, url: "https://media.example/st/ref.mp4", width: 1080, height: 1920 }),
            asset(3, { name: "봄 신제품 컷.jpg", role: "product", tags: ["spring"] }),
          ],
          jobs: [job(1, { prompt: "Glass perfume bottle in morning light", outputs: [output(1)] })],
        })}
        injectedLibrary={stubLibrary()}
      />,
    );
    const tiles = html.split("data-asset-hub-card=").slice(1);
    expect(tiles).toHaveLength(4);
    // Raw file names are searchable, never drawn.
    expect(html).not.toContain("hf_20261109");
    expect(html).not.toContain("f03b2fe9-a08c-4e29");
    expect(html).toContain("봄 신제품 컷");
    expect(html).not.toContain("봄 신제품 컷.jpg");
    expect(html).toContain("Glass perfume bottle in morning light");
    // The old card's pill rows, role tag and tag chips are gone from the grid.
    for (const gone of ["data-asset-hub-open-canvas", "data-asset-hub-use-video", "data-asset-hub-reverse", "data-asset-hub-share-review", "data-asset-hub-similar", "data-asset-hub-edit", "data-asset-hub-edit-form"]) {
      expect(html, gone).not.toContain(gone);
    }
    for (const tile of tiles) {
      // One press target for the sheet, a heart, at most one main action and one "more" button.
      expect(tile.match(/data-asset-hub-open(?=[=\s>])/g)).toHaveLength(1);
      expect(tile.match(/data-asset-hub-like/g)).toHaveLength(1);
      expect((tile.match(/data-asset-hub-(use-image|open-compose)/g) ?? []).length).toBeLessThanOrEqual(1);
      expect(tile.match(/aria-haspopup="menu"/g)).toHaveLength(1);
    }
    // Only films and sounds carry a badge: their length.
    expect(html.match(/data-asset-hub-length/g)).toHaveLength(1);
    expect(html).toMatch(/data-asset-hub-length[^>]*>.*?0:42<\/span>/);
    // The tile is drawn at the picture's own ratio (4:5 and 9:16 here).
    expect(html).toContain("--r:0.8");
    expect(html).toContain("--r:0.5625");
    // The page no longer opens with a sentence describing itself.
    expect(html).not.toContain(dict.studioLibrary.hub.subtitle);
  });

  it("draws storage as one quiet line while there is room, and as the full card once there is something to act on", () => {
    const dict = getDictionary("ko");
    const GB = 1024 ** 3;
    const render = (storage: NonNullable<ReturnType<typeof studioState>["storage"]>) =>
      renderToStaticMarkup(
        <BrandAssetHub organizationId={ORG} studioCopy={dict.brandStudio} libraryCopy={dict.studioLibrary} initialState={studioState({ storage })} injectedLibrary={stubLibrary()} />,
      );
    const base = { usedBytes: 4 * 1024 ** 2, effectiveQuotaBytes: 50 * GB, usageRatio: 0.0001, usagePercent: 0, state: "ok" as const, uploadBlocked: false, retentionDays: null };

    const quiet = render(base);
    expect(quiet).toContain("data-storage-compact");
    expect(quiet.match(/data-brand-storage-meter/g)).toHaveLength(1);
    expect(quiet).toContain("data-storage-numbers");

    const near = render({ ...base, usedBytes: 42 * GB, usageRatio: 0.84, usagePercent: 84, state: "near_limit" });
    expect(near).not.toContain("data-storage-compact");
    expect(near).toContain('data-storage-badge="near_limit"');
    expect(near).toContain("data-storage-notice");

    const full = render({ ...base, usedBytes: 50 * GB, usageRatio: 1, usagePercent: 100, state: "exceeded", uploadBlocked: true });
    expect(full).not.toContain("data-storage-compact");
    expect(full).toContain('data-storage-upload-blocked="true"');

    // Project-only clients read how long delivered files are kept: that note is never folded away.
    const kept = render({ ...base, retentionDays: 90 });
    expect(kept).not.toContain("data-storage-compact");
    expect(kept).toContain("data-storage-retention");
  });

  it("keeps every action reachable without hover: the sheet lists them all, and project-only clients get no studio links", () => {
    const dict = getDictionary("ko");
    const entries = buildHubEntries(
      [asset(1, { name: "IMG_0001.JPG", role: "logo", tags: ["mono"] }), asset(2, { kind: "video", name: "Teaser", seconds: 8 }), asset(3, { kind: "audio", name: "Jingle", seconds: 12 })],
      [job(1, { prompt: "Blue glass serum bottle on marble", outputs: [output(1)] })],
      dict.studioLibrary.hub.sourceGenerated,
    );
    const pick = (key: string) => entries.find((e) => e.key === key)!;
    const keys = (key: string, opts: { canOpenStudio: boolean; canCreate: boolean }) => {
      const { main, more } = hubActions(pick(key), { organizationId: ORG, copy: actionCopy("ko"), ...opts });
      return { main: main?.key ?? null, more: more.map((a) => a.key) };
    };
    const open = { canOpenStudio: true, canCreate: true };
    expect(keys(`a:${asset(1).id}`, open)).toEqual({ main: "useImage", more: ["decorate", "makeVideo", "share", "similar", "edit"] });
    expect(keys(`a:${asset(2).id}`, open)).toEqual({ main: "compose", more: ["reverse", "share", "similar", "edit"] });
    expect(keys(`a:${asset(3).id}`, open)).toEqual({ main: null, more: ["similar", "edit"] });
    expect(keys(`o:${output(1).id}`, open)).toEqual({ main: "useImage", more: ["decorate", "makeVideo", "share", "similar"] });
    // Viewers cannot share or edit; project-only clients (`self_studio` denied) get no dead studio links.
    expect(keys(`a:${asset(1).id}`, { canOpenStudio: true, canCreate: false })).toEqual({ main: "useImage", more: ["decorate", "makeVideo", "similar"] });
    expect(keys(`a:${asset(2).id}`, { canOpenStudio: false, canCreate: true })).toEqual({ main: null, more: ["similar", "edit"] });

    const upload = pick(`a:${asset(1).id}`);
    const sheet = renderToStaticMarkup(
      <HubDetail
        entry={upload}
        copy={dict.studioLibrary}
        name={dict.studioLibrary.item.image}
        liked={false}
        {...hubActions(upload, { organizationId: ORG, copy: actionCopy("ko"), ...open })}
        onLike={() => {}}
        onAction={() => {}}
        onClose={() => {}}
      />,
    );
    for (const marker of ["data-asset-hub-use-image", "data-asset-hub-open-canvas", "data-asset-hub-use-video", "data-asset-hub-share-review", "data-asset-hub-similar", "data-asset-hub-edit", "data-asset-hub-like", "data-asset-hub-detail-close"]) {
      expect(sheet, marker).toContain(marker);
    }
    // The sheet is where a file's stored name may be read (it is the way to rename it), with its role and tags.
    expect(sheet).toContain("IMG_0001.JPG");
    expect(sheet).toContain(dict.studioLibrary.roles.logo);
    expect(sheet).toContain("mono");
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
