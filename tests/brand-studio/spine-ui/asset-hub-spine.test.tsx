import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type {
  StudioBrandProjectCounts,
  StudioBrandProjectFiles,
  StudioBrandProjectGroup,
  StudioBrandProjectOverview,
} from "@/lib/brand-studio/contracts";
import type { VideoProjectSummary } from "@/lib/brand-studio/video-projects/contracts";
import type { BrandWorkspaceChoice } from "@/lib/brands/workspace/selection";
import type { SqlRunner } from "@/lib/db/sql-runner";
import { createStudioApi } from "@/components/brand-studio/api";
import { BrandAssetHub, buildHubEntries, hubActions } from "@/components/brand-studio/asset-hub";
import { HubDetail, HubTile } from "@/components/brand-studio/asset-hub-tile";
import { errorLine, fill } from "@/components/brand-studio/copy";
import { MoveToProjectDialog, createMoveToProjectController } from "@/components/brand-studio/project-chip";
import { AssetHubSpine } from "@/components/brand-studio/asset-hub-spine";
import { ScopeView, type ScopeTileSelectOpts } from "@/components/brand-studio/asset-hub-spine/scope-view";
import type { ScopePageState } from "@/components/brand-studio/asset-hub-spine/model";
import type { StudioLibrary } from "@/components/brand-studio/seams";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { ORG, asset, id, job, output, studioState } from "../ui/fixtures";

const P1 = id(0x81);
const P2 = id(0x82);
const P3 = id(0x83);
const P4 = id(0x84);

const pageStub = vi.hoisted(() => ({
  locale: "ko" as "ko" | "en",
  org: { id: "", name: "Fixture brand", role: "owner", logoUrl: null, denied: undefined as string[] | undefined } as BrandWorkspaceChoice,
  spineOpen: false,
  runtimeThrow: false,
  overviewAnswer: null as StudioBrandProjectOverview | { ok: false; code: string } | "throw" | null,
  initialState: null as ReturnType<typeof studioState> | null,
  runOpSpy: vi.fn(),
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
      const dict = loadDict(pageStub.locale);
      return {
        viewer: { userId: "00000000-0000-4000-8000-000000000001", isAdmin: false },
        sql: {
          query: async () => ({ rows: [] }),
          transaction: async <T,>(fn: (tx: SqlRunner) => Promise<T>) => fn({ query: async () => ({ rows: [] }) } as unknown as SqlRunner),
        } as unknown as SqlRunner,
        verifiedEmail: undefined,
        brandHost: false,
        locale: pageStub.locale,
        dict,
        b: dict.brandWorkspace,
      };
    },
  };
});

vi.mock("@/lib/brands/workspace/service", () => ({
  loadBrandWorkspaceScope: async () => ({ choices: [pageStub.org], projectOrganizations: {} }),
  loadBrandWorkspace: async () => ({
    organizations: [{ id: pageStub.org.id, name: pageStub.org.name, role: pageStub.org.role }],
    projects: [],
  }),
}));

vi.mock("@/lib/brand-studio/asset-projects", () => ({
  loadAssetProjectLinks: vi.fn(async () => ({ ok: true, self: [], team: [] })),
}));

vi.mock("@/lib/brand-studio/brand-projects", async () => {
  const actual = await vi.importActual<typeof import("@/lib/brand-studio/brand-projects")>("@/lib/brand-studio/brand-projects");
  return {
    ...actual,
    brandProjectSpineOpen: vi.fn(async () => pageStub.spineOpen),
  };
});

vi.mock("@/lib/brand-studio/runtime", () => ({
  studioRuntimeDeps: vi.fn(async (sql: SqlRunner) => {
    if (pageStub.runtimeThrow) throw new Error("runtime init failed");
    return { sql };
  }),
}));

vi.mock("@/lib/brand-studio/service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/brand-studio/service")>("@/lib/brand-studio/service");
  return {
    ...actual,
    loadStudioState: vi.fn(async () => pageStub.initialState ?? studioState()),
    runStudioOperation: vi.fn(async (_deps: unknown, _viewer: unknown, op: unknown, input: unknown) => {
      pageStub.runOpSpy(op, input);
      if (pageStub.overviewAnswer === "throw") throw new Error("boom");
      return pageStub.overviewAnswer ?? { ok: false, code: "failed" };
    }),
  };
});

import ContentLibrary from "@/app/(brand)/brand/library/page";

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

function renderTestScopeTile(libraryCopy: ReturnType<typeof getDictionary>["studioLibrary"]) {
  return (
    entry: ReturnType<typeof buildHubEntries>[number],
    _scopeKey: string,
    selectOpts?: ScopeTileSelectOpts,
  ) => (
    <HubTile
      key={entry.key}
      entry={entry}
      copy={libraryCopy}
      name={entry.label ?? libraryCopy.item[entry.kind]}
      liked={false}
      soundMarker={entry.kind === "audio" && entry.origin === "generated"}
      selecting={selectOpts?.selecting}
      selected={selectOpts?.selected}
      onToggleSelect={selectOpts?.onToggleSelect}
      main={null}
      more={[]}
      moreLabel={libraryCopy.item[entry.kind]}
      menuOpen={false}
      onMenu={() => {}}
      onOpen={() => {}}
      onLike={() => {}}
      onAction={() => {}}
    />
  );
}

const emptyCounts = (patch: Partial<StudioBrandProjectCounts> = {}): StudioBrandProjectCounts => ({
  image: 0,
  video: 0,
  sound: 0,
  upload: 0,
  film: 0,
  ...patch,
});

const makeOverview = (patch: Partial<StudioBrandProjectOverview> = {}): StudioBrandProjectOverview => ({
  ok: true,
  projects: [],
  unfiled: { counts: emptyCounts(), covers: [] },
  brandMaterials: {
    count: 0,
    byRole: { product: 0, person: 0, logo: 0, style: 0, place: 0 },
    covers: [],
  },
  ...patch,
});

const sampleOverview = (): StudioBrandProjectOverview => {
  const selfGroup: StudioBrandProjectGroup = {
    project: { id: P1, title: "봄 향수 론칭", origin: "self", lastActivityAt: "2026-11-25T10:00:00Z" },
    counts: emptyCounts({ image: 24, video: 6, sound: 2, upload: 1, film: 1 }),
    covers: [
      {
        outputId: output(1).id,
        jobId: id(0x2001),
        kind: "image",
        url: "https://media.example/st/cover-1.png",
        thumbUrl: "https://media.example/st/cover-1-thumb.webp",
        width: 1080,
        height: 1350,
        createdAt: "2026-11-25T10:00:00Z",
      },
      {
        outputId: output(2).id,
        jobId: id(0x2002),
        kind: "video",
        url: "https://media.example/st/cover-2.mp4",
        thumbUrl: "https://media.example/st/cover-2-poster.webp",
        width: 1080,
        height: 1920,
        createdAt: "2026-11-25T09:00:00Z",
      },
    ],
  };
  const teamGroup: StudioBrandProjectGroup = {
    project: { id: P2, title: "겨울 립 컬렉션 필름", origin: "team", lastActivityAt: "2026-11-25T08:00:00Z" },
    counts: emptyCounts({ image: 3 }),
    covers: [
      {
        outputId: output(3).id,
        jobId: id(0x2003),
        kind: "video",
        url: "https://media.example/st/cover-3.mp4",
        thumbUrl: null, // null thumbUrl renders coverBlank in SSR (LazyVideoCover mounts <video> only in-view on client), never <img src="*.mp4">
        width: 1080,
        height: 1920,
        createdAt: "2026-11-25T08:00:00Z",
      },
    ],
  };
  const emptyGroup: StudioBrandProjectGroup = {
    project: { id: P3, title: "아직 비어 있는 프로젝트", origin: "self", lastActivityAt: "2026-11-25T07:00:00Z" },
    counts: emptyCounts(),
    covers: [],
  };
  return makeOverview({
    projects: [selfGroup, teamGroup, emptyGroup],
    unfiled: {
      counts: emptyCounts({ image: 10, upload: 4 }),
      covers: [
        {
          outputId: output(4).id,
          jobId: id(0x2004),
          kind: "image",
          url: "https://media.example/st/unfiled-1.png",
          thumbUrl: null,
          width: 1080,
          height: 1350,
          createdAt: "2026-11-25T06:00:00Z",
        },
      ],
    },
    brandMaterials: {
      count: 4,
      byRole: { logo: 1, product: 1, person: 1, style: 0, place: 1 },
      covers: [],
    },
  });
};

const sampleAssets = () => [
  // Project-filed logo must NOT show in 브랜드 자료 line
  asset(1, { name: "Project logo", role: "logo", brandProjectId: P1 }),
  asset(2, { name: "Place shot", role: "place", brandProjectId: null }),
  asset(3, { name: "Model face", role: "person", brandProjectId: null }),
  asset(4, { name: "Flacon", role: "product", brandProjectId: null }),
  asset(5, { name: "Main wordmark", role: "logo", brandProjectId: null }),
];

describe("BrandAssetHub with spine prop (§5.2, §5.3)", () => {
  it.each(["ko", "en"] as const)("renders the four tabs and regrouped 프로젝트별 view (%s)", (locale) => {
    const dict = getDictionary(locale);
    const overview = sampleOverview();
    const state = studioState({
      assets: sampleAssets(),
      jobs: [job(2, { kind: "video", outputs: [output(2, { kind: "video", seconds: 5 })] })],
    });
    const html = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        initialState={state}
        deliverables={[
          {
            id: id(0x701),
            projectId: P2,
            projectTitle: "겨울 립 컬렉션 필름",
            title: "Final cut",
            kind: "video",
            url: "https://media.example/d.mp4",
            createdAt: "2026-11-25T08:30:00Z",
          },
          {
            id: id(0x702),
            projectId: P2,
            projectTitle: "겨울 립 컬렉션 필름",
            title: "Look cut",
            kind: "image",
            url: "https://media.example/d.png",
            createdAt: "2026-11-25T08:35:00Z",
          },
        ]}
        deliverableCount={2}
        injectedLibrary={stubLibrary()}
        spine={{ overview, canMove: true, copy: dict.projectSpine, filmMeta: dict.studioVideo.workspace.projects.meta }}
      />,
    );

    // Tabs in exact order; only first three carry numeric counts; by_project selected.
    const tabMarkers = [...html.matchAll(/data-asset-hub-tab="([^"]+)"/g)].map((m) => m[1]);
    expect(tabMarkers).toEqual(["by_project", "brand_materials", "unfiled", "all"]);
    expect(html).toMatch(/aria-selected="true"[^>]*data-asset-hub-tab="by_project"/);
    expect(html).not.toMatch(/data-asset-hub-tab="all"[^>]*>\s*<span>[^<]+<\/span><span/);

    // Order inside data-asset-hub-spine: 브랜드 자료 -> projects -> 미분류.
    const materialsAt = html.indexOf("data-asset-hub-materials");
    const group1At = html.indexOf(`data-asset-hub-group="${P1}"`);
    const group2At = html.indexOf(`data-asset-hub-group="${P2}"`);
    const group3At = html.indexOf(`data-asset-hub-group="${P3}"`);
    const unfiledAt = html.indexOf("data-asset-hub-unfiled");
    expect(materialsAt).toBeGreaterThan(-1);
    expect(group1At).toBeGreaterThan(materialsAt);
    expect(group2At).toBeGreaterThan(group1At);
    expect(group3At).toBeGreaterThan(group2At);
    expect(unfiledAt).toBeGreaterThan(group3At);

    // 브랜드 자료 strip: role sub-groups in exact order logo -> product -> person -> place; project logo excluded.
    const materialsBlock = html.slice(materialsAt, group1At);
    const roleMarkers = [...materialsBlock.matchAll(/data-asset-hub-materials-role="([^"]+)"/g)].map((m) => m[1]);
    expect(roleMarkers).toEqual(["logo", "product", "person", "place"]);
    expect(materialsBlock).not.toContain(asset(1).url);
    expect(materialsBlock).toContain(asset(5).thumbUrl!);
    expect(materialsBlock).toContain(dict.studioLibrary.hub.spine.materialsDesc);

    // Own project: plain text title (no <a>), counts line in order, video duration badge, no menu/heart on covers, accessible names include group title.
    const p1Block = html.slice(group1At, group2At);
    expect(p1Block).toContain('data-origin="self"');
    expect(p1Block).not.toContain(`href="/brand/projects/${P1}"`);
    expect(p1Block).toContain(dict.studioLibrary.hub.projects.self);
    expect(p1Block).toContain("data-asset-hub-group-see-all");
    expect(p1Block).toContain(`aria-label="${dict.studioLibrary.hub.projects.seeAll} · 봄 향수 론칭"`);
    expect(p1Block).toContain('aria-label="봄 향수 론칭 1"');
    expect(p1Block).toContain('aria-label="봄 향수 론칭 2"');
    expect(p1Block).toContain("0:05");
    expect(p1Block).not.toContain('aria-haspopup="menu"');
    expect(p1Block).not.toContain("data-asset-hub-like");
    if (locale === "ko") {
      expect(p1Block).toContain("이미지 24 · 영상 6 · 사운드 2 · 올린 파일 1 · 편집본 1");
    } else {
      expect(p1Block).toContain("Images 24 · Videos 6 · Sound 2 · Uploaded 1 · Edit 1");
    }

    // Team project: title links to /brand/projects/<id>, counts include 납품본/Deliverables, neutral video cover block (NO <video>, NO audioStage).
    const p2Block = html.slice(group2At, group3At);
    expect(p2Block).toContain('data-origin="team"');
    expect(p2Block).toContain(`href="/brand/projects/${P2}"`);
    expect(p2Block).toContain(dict.studioLibrary.hub.projects.team);
    expect(p2Block).toContain(locale === "ko" ? "이미지 3 · 납품본 2" : "Images 3 · Deliverables 2");
    expect(p2Block).not.toContain("<video");
    expect(p2Block).not.toContain("audioStage");
    expect(p2Block).toContain("data-asset-hub-length");

    // Empty project without fallback upload images: header + empty string, NO cover list;
    // upload-only project shows fallback covers from state.assets opening the group (Fix 4-4).
    const p3Block = html.slice(group3At, unfiledAt);
    expect(p3Block).toContain(dict.studioLibrary.hub.spine.groupEmpty);
    expect(p3Block).not.toContain("<ul");

    const uploadOnlyId = id(0x88);
    const uploadOnlyOverview = makeOverview({
      projects: [
        { project: { id: uploadOnlyId, title: "업로드 전용", origin: "self", lastActivityAt: "2026-11-25T10:00:00Z" }, counts: emptyCounts({ upload: 2 }), covers: [] },
        { project: { id: P3, title: "편집본 전용", origin: "self", lastActivityAt: "2026-11-25T09:00:00Z" }, counts: emptyCounts({ film: 1 }), covers: [] },
      ],
    });
    const fallbackHtml = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        initialState={studioState({
          assets: [
            asset(61, { brandProjectId: uploadOnlyId, kind: "image", name: "Upload 1" }),
            asset(62, { brandProjectId: uploadOnlyId, kind: "video", name: "Upload Vid" }),
            asset(63, { brandProjectId: null, kind: "image", name: "Unfiled Img" }),
          ],
        })}
        injectedLibrary={stubLibrary()}
        spine={{ overview: uploadOnlyOverview, canMove: true, copy: dict.projectSpine, filmMeta: dict.studioVideo.workspace.projects.meta }}
      />,
    );
    const uploadOnlySection = fallbackHtml.slice(
      fallbackHtml.indexOf(`data-asset-hub-group="${uploadOnlyId}"`),
      fallbackHtml.indexOf(`data-asset-hub-group="${P3}"`),
    );
    expect(uploadOnlySection).toContain(asset(61).thumbUrl!);
    expect(uploadOnlySection).not.toContain(asset(62).url);
    expect(uploadOnlySection).not.toContain(asset(63).thumbUrl!);
    const filmOnlySection = fallbackHtml.slice(fallbackHtml.indexOf(`data-asset-hub-group="${P3}"`));
    expect(filmOnlySection).not.toContain("<ul");
    expect(filmOnlySection).not.toContain(dict.studioLibrary.hub.spine.groupEmpty);

    // 미분류 group: description + count + move button + dedicated see-all marker + cover + accessible names.
    const unfiledBlock = html.slice(unfiledAt);
    expect(unfiledBlock).toContain(dict.projectSpine.unfiled);
    expect(unfiledBlock).toContain(dict.studioLibrary.hub.spine.unfiledDesc);
    expect(unfiledBlock).toContain("data-asset-hub-unfiled-move");
    expect(unfiledBlock).toContain("data-asset-hub-unfiled-see-all");
    expect(unfiledBlock).not.toContain("data-asset-hub-group-see-all");
    expect(unfiledBlock).toContain(`aria-label="${dict.studioLibrary.hub.projects.seeAll} · ${dict.projectSpine.unfiled}"`);
    expect(unfiledBlock).toContain(`aria-label="${dict.projectSpine.unfiled} 1"`);
    expect(materialsBlock).toContain("data-asset-hub-materials-see-all");
    expect(materialsBlock).toContain(`aria-label="${dict.studioLibrary.hub.projects.seeAll} · ${dict.studioLibrary.hub.spine.tabMaterials}"`);
    expect(unfiledBlock).toContain(dict.projectSpine.move);
    expect(unfiledBlock).toContain("https://media.example/st/unfiled-1.png");
  });

  it("hides 프로젝트로 옮기기 for viewers (canMove: false)", () => {
    const dict = getDictionary("ko");
    const html = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        initialState={studioState({ canCreate: false, assets: sampleAssets() })}
        injectedLibrary={stubLibrary()}
        spine={{ overview: sampleOverview(), canMove: false, copy: dict.projectSpine, filmMeta: dict.studioVideo.workspace.projects.meta }}
      />,
    );
    expect(html).toContain("data-asset-hub-unfiled");
    expect(html).not.toContain("data-asset-hub-unfiled-move");
    expect(html).not.toContain(dict.projectSpine.move);
  });

  it("opens on 모든 파일 when there are 0 projects and 0 brand materials, and omits empty materials/unfiled groups", () => {
    const dict = getDictionary("ko");
    const emptyOverview = makeOverview({
      projects: [],
      unfiled: { counts: emptyCounts({ image: 2 }), covers: [] },
    });
    const onAll = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        initialState={studioState({ assets: [asset(1, { name: "Loose" })] })}
        // Even if legacy projectLinks are passed alongside spine, 모든 파일 still shows the flat grid.
        projectLinks={{
          self: [{ id: P1, title: "Legacy", updatedAt: "2026-11-25T00:00:00Z", assetIds: [asset(1).id], outputIds: [] }],
          team: [],
        }}
        injectedLibrary={stubLibrary()}
        spine={{ overview: emptyOverview, canMove: true, copy: dict.projectSpine, filmMeta: dict.studioVideo.workspace.projects.meta }}
      />,
    );
    expect(onAll).toMatch(/aria-selected="true"[^>]*data-asset-hub-tab="all"/);
    expect(onAll).not.toContain("data-asset-hub-spine");
    expect(onAll).not.toContain("data-asset-hub-projects");
    expect(onAll).toContain("data-asset-hub-grid");

    // Zero projects + brandMaterials.count > 0 opens on 프로젝트별 and hides 미분류 when unfiled is 0.
    const materialsOnly = makeOverview({
      projects: [],
      brandMaterials: {
        count: 1,
        byRole: { logo: 1, product: 0, person: 0, style: 0, place: 0 },
        covers: [asset(5, { role: "logo", brandProjectId: null })],
      },
    });
    const onByProject = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        initialState={studioState()}
        injectedLibrary={stubLibrary()}
        spine={{ overview: materialsOnly, canMove: true, copy: dict.projectSpine, filmMeta: dict.studioVideo.workspace.projects.meta }}
      />,
    );
    expect(onByProject).toMatch(/aria-selected="true"[^>]*data-asset-hub-tab="by_project"/);
    expect(onByProject).toContain("data-asset-hub-materials");
    expect(onByProject).not.toContain("data-asset-hub-unfiled");
  });

  it("caps 브랜드 자료 line at 8 tiles even when more assets exist in state", () => {
    const dict = getDictionary("ko");
    const many = Array.from({ length: 12 }, (_, i) => asset(i + 1, { role: i < 4 ? "logo" : i < 8 ? "product" : "person", brandProjectId: null }));
    const overview = makeOverview({
      brandMaterials: { count: 12, byRole: { logo: 4, product: 4, person: 4, style: 0, place: 0 }, covers: [] },
    });
    const html = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        initialState={studioState({ assets: many })}
        injectedLibrary={stubLibrary()}
        spine={{ overview, canMove: true, copy: dict.projectSpine, filmMeta: dict.studioVideo.workspace.projects.meta }}
      />,
    );
    const materialsHtml = html.slice(html.indexOf("data-asset-hub-materials"));
    expect(materialsHtml.match(/<button /g)).toHaveLength(1 + 8); // 1 see-all button + 8 tiles
  });

  it("filters project groups by initialQuery while keeping 브랜드 자료 and 미분류, and renders opened project scope", () => {
    const dict = getDictionary("ko");
    const overview = sampleOverview();
    const api = createStudioApi({ organizationId: ORG });

    const searched = renderToStaticMarkup(
      <AssetHubSpine
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        state={studioState({ assets: sampleAssets() })}
        loadFailed={false}
        notice={null}
        onRetryLoad={() => {}}
        onNotice={() => {}}
        deliverables={[]}
        canOpenStudio={true}
        api={api}
        likedKeys={new Set()}
        spine={{ overview, canMove: true, copy: dict.projectSpine, filmMeta: dict.studioVideo.workspace.projects.meta }}
        allSection={null}
        renderScopeTile={renderTestScopeTile(dict.studioLibrary)}
        initialQuery="데님없는봄"
      />,
    );
    expect(searched).toContain("data-asset-hub-materials");
    expect(searched).toContain("data-asset-hub-unfiled");
    expect(searched).not.toContain(`data-asset-hub-group="${P1}"`);
    // Search matching 0 projects while 브랜드 자료 or 미분류 show renders one no-match line where project groups belong (Fix 1-7).
    const betweenMaterialsAndUnfiled = searched.slice(
      searched.indexOf("data-asset-hub-materials"),
      searched.indexOf("data-asset-hub-unfiled"),
    );
    expect(betweenMaterialsAndUnfiled).toContain(dict.studioLibrary.uploads.noMatch);

    const matched = renderToStaticMarkup(
      <AssetHubSpine
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        state={studioState({ assets: sampleAssets() })}
        loadFailed={false}
        notice={null}
        onRetryLoad={() => {}}
        onNotice={() => {}}
        deliverables={[]}
        canOpenStudio={true}
        api={api}
        likedKeys={new Set()}
        spine={{ overview, canMove: true, copy: dict.projectSpine, filmMeta: dict.studioVideo.workspace.projects.meta }}
        allSection={null}
        renderScopeTile={renderTestScopeTile(dict.studioLibrary)}
        initialQuery="향수"
      />,
    );
    expect(matched).toContain(`data-asset-hub-group="${P1}"`);
    expect(matched).not.toContain(`data-asset-hub-group="${P2}"`);
    expect(matched).toContain("data-asset-hub-materials");
    expect(matched).toContain("data-asset-hub-unfiled");

    const opened = renderToStaticMarkup(
      <AssetHubSpine
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        state={studioState({ assets: sampleAssets() })}
        loadFailed={false}
        notice={null}
        onRetryLoad={() => {}}
        onNotice={() => {}}
        deliverables={[]}
        canOpenStudio={true}
        api={api}
        likedKeys={new Set()}
        spine={{ overview, canMove: true, copy: dict.projectSpine, filmMeta: dict.studioVideo.workspace.projects.meta }}
        allSection={null}
        renderScopeTile={renderTestScopeTile(dict.studioLibrary)}
        initialOpenedScope={{ kind: "project", brandProjectId: P1 }}
      />,
    );
    expect(opened).toContain(`data-asset-hub-scope="project:${P1}"`);
    expect(opened).toContain("data-asset-hub-scope-back");
    expect(opened).toContain(dict.studioLibrary.hub.spine.tabByProject);
    expect(opened).toContain("봄 향수 론칭");
  });

  it("renders opened scopes (project, brand_materials, unfiled) with non-zero chips and scope headers (§5.4)", () => {
    const dict = getDictionary("ko");
    const overview = sampleOverview();
    const api = createStudioApi({ organizationId: ORG });
    const renderTile = renderTestScopeTile(dict.studioLibrary);

    // Own project with counts across all 5 kinds renders all 6 kind chips with overview counts and plain text title.
    const ownProject = renderToStaticMarkup(
      <ScopeView
        organizationId={ORG}
        scope={{ kind: "project", brandProjectId: P1 }}
        overview={overview}
        libraryCopy={dict.studioLibrary}
        projectSpineCopy={dict.projectSpine}
        studioCopy={dict.brandStudio}
        filmMeta={dict.studioVideo.workspace.projects.meta}
        canOpenStudio={true}
        canMove={true}
        api={api}
        query=""
        onQueryChange={() => {}}
        likedKeys={new Set()}
        onBack={() => {}}
        onScopeGone={() => {}}
        renderTile={renderTile}
      />,
    );
    expect(ownProject).toContain(`data-asset-hub-scope="project:${P1}"`);
    expect(ownProject).toContain("data-asset-hub-scope-back");
    expect(ownProject).not.toContain(`href="/brand/projects/${P1}"`);
    expect([...ownProject.matchAll(/data-asset-hub-scope-kind="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "all",
      "image",
      "video",
      "sound",
      "upload",
      "film",
    ]);
    // Item 3: overview counts render alongside kind chip labels.
    expect([...ownProject.matchAll(/data-asset-hub-scope-kind="([^"]+)"[^>]*><span>[^<]+<\/span><span[^>]*>(\d+)<\/span>/g)].map((m) => [m[1], m[2]])).toEqual([
      ["all", "34"],
      ["image", "24"],
      ["video", "6"],
      ["sound", "2"],
      ["upload", "1"],
      ["film", "1"],
    ]);

    // Team project with images only links to project and hides zero-count kind chips.
    const teamProject = renderToStaticMarkup(
      <ScopeView
        organizationId={ORG}
        scope={{ kind: "project", brandProjectId: P2 }}
        overview={overview}
        libraryCopy={dict.studioLibrary}
        projectSpineCopy={dict.projectSpine}
        studioCopy={dict.brandStudio}
        filmMeta={dict.studioVideo.workspace.projects.meta}
        canOpenStudio={true}
        canMove={true}
        api={api}
        query=""
        onQueryChange={() => {}}
        likedKeys={new Set()}
        onBack={() => {}}
        onScopeGone={() => {}}
        renderTile={renderTile}
      />,
    );
    expect(teamProject).toContain(`href="/brand/projects/${P2}"`);
    expect([...teamProject.matchAll(/data-asset-hub-scope-kind="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "all",
      "image",
    ]);

    // 브랜드 자료 has no back button, hides zero-count role chip (`style` is 0), and renders overview counts on role chips.
    const materials = renderToStaticMarkup(
      <ScopeView
        organizationId={ORG}
        scope={{ kind: "brand_materials" }}
        overview={overview}
        libraryCopy={dict.studioLibrary}
        projectSpineCopy={dict.projectSpine}
        studioCopy={dict.brandStudio}
        filmMeta={dict.studioVideo.workspace.projects.meta}
        canOpenStudio={true}
        canMove={true}
        api={api}
        query=""
        onQueryChange={() => {}}
        likedKeys={new Set()}
        onScopeGone={() => {}}
        renderTile={renderTile}
      />,
    );
    expect(materials).toContain('data-asset-hub-scope="brand_materials"');
    expect(materials).not.toContain("data-asset-hub-scope-back");
    expect([...materials.matchAll(/data-asset-hub-scope-role="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "all",
      "logo",
      "product",
      "person",
      "place",
    ]);
    expect([...materials.matchAll(/data-asset-hub-scope-role="([^"]+)"[^>]*><span>[^<]+<\/span><span[^>]*>(\d+)<\/span>/g)].map((m) => [m[1], m[2]])).toEqual([
      ["all", "4"],
      ["logo", "1"],
      ["product", "1"],
      ["person", "1"],
      ["place", "1"],
    ]);

    // 미분류 has no back button and hides zero-count kind chips.
    const unfiled = renderToStaticMarkup(
      <ScopeView
        organizationId={ORG}
        scope={{ kind: "unfiled" }}
        overview={overview}
        libraryCopy={dict.studioLibrary}
        projectSpineCopy={dict.projectSpine}
        studioCopy={dict.brandStudio}
        filmMeta={dict.studioVideo.workspace.projects.meta}
        canOpenStudio={true}
        canMove={true}
        api={api}
        query=""
        onQueryChange={() => {}}
        likedKeys={new Set()}
        onScopeGone={() => {}}
        renderTile={renderTile}
      />,
    );
    expect(unfiled).toContain('data-asset-hub-scope="unfiled"');
    expect(unfiled).not.toContain("data-asset-hub-scope-back");
    expect([...unfiled.matchAll(/data-asset-hub-scope-kind="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "all",
      "image",
      "upload",
    ]);
  });

  it("renders sound tiles and 편집본 tiles inside BrandAssetHub ScopeView via renderTile, respecting canOpenStudio and search/paging states (Fix 2-4)", () => {
    const ko = getDictionary("ko");
    const en = getDictionary("en");
    const overview = sampleOverview();
    const api = createStudioApi({ organizationId: ORG });
    const filmOne: VideoProjectSummary = {
      id: id(0x501),
      organizationId: ORG,
      title: "봄 컬렉션 최종 컷",
      status: "active",
      aspect: "9:16",
      revision: 1,
      clipCount: 4,
      durationSec: 18,
      thumbUrl: null,
      completedAt: null,
      createdAt: "2026-11-25T10:02:00Z",
      updatedAt: "2026-11-25T10:02:00Z",
      brandProjectId: P1,
    };
    const soundJob = job(11, {
      kind: "music",
      prompt: "Spring jingle",
      outputs: [output(11, { kind: "audio", seconds: 30 })],
      createdAt: "2026-11-25T10:01:00Z",
    });
    const page1: StudioBrandProjectFiles = {
      ok: true,
      items: [
        { type: "film", id: filmOne.id },
        { type: "job", id: soundJob.id },
        { type: "asset", id: asset(5).id },
      ],
      films: [filmOne],
      jobs: [soundJob],
      assets: [asset(5, { name: "Main wordmark", role: "logo" })],
      next: "page-2",
    };

    const withStudioLink = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={ko.brandStudio}
        libraryCopy={ko.studioLibrary}
        initialState={studioState({ canCreate: true })}
        injectedLibrary={stubLibrary()}
        api={api}
        spine={{ overview, canMove: true, copy: ko.projectSpine, filmMeta: ko.studioVideo.workspace.projects.meta }}
        initialSpine={{
          tab: "by_project",
          openedScope: { kind: "project", brandProjectId: P1 },
          page: page1,
          menuKey: `project:${P1}|o:${soundJob.outputs[0]!.id}`,
          detailKey: `o:${soundJob.outputs[0]!.id}`,
        }}
      />,
    );
    expect(withStudioLink).toContain(`data-asset-hub-film="${filmOne.id}"`);
    expect(withStudioLink).toContain("봄 컬렉션 최종 컷");
    expect(withStudioLink).toContain("4컷 · 18초");
    expect(withStudioLink).toContain(`/brand/studio/video?organizationId=${ORG}&amp;film=${filmOne.id}`);
    expect(withStudioLink).toContain("data-asset-hub-sound");
    expect(withStudioLink).toContain('data-menu-open=""');
    expect(withStudioLink).toContain("data-project-move");
    expect(withStudioLink).toContain("0:30");
    expect(withStudioLink).toContain("data-asset-hub-more");
    expect(withStudioLink).toContain(ko.studioLibrary.hub.spine.loadMore);

    // canOpenStudio: false removes the studio film link href while keeping the tile and clip count.
    const viewerScope = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={en.brandStudio}
        libraryCopy={en.studioLibrary}
        initialState={studioState({ canCreate: false })}
        canOpenStudio={false}
        injectedLibrary={stubLibrary()}
        api={api}
        spine={{ overview, canMove: false, copy: en.projectSpine, filmMeta: en.studioVideo.workspace.projects.meta }}
        initialSpine={{
          tab: "by_project",
          openedScope: { kind: "project", brandProjectId: P1 },
          page: { ...page1, next: null },
        }}
      />,
    );
    expect(viewerScope).toContain(`data-asset-hub-film="${filmOne.id}"`);
    expect(viewerScope).toContain("4 clips · 18s");
    expect(viewerScope).not.toContain("/brand/studio/video");
    expect(viewerScope).not.toContain("data-asset-hub-more");

    // Searching filters loaded tiles while keeping 더 불러오기 visible when next !== null.
    const searched = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={ko.brandStudio}
        libraryCopy={ko.studioLibrary}
        initialState={studioState({ canCreate: true })}
        injectedLibrary={stubLibrary()}
        api={api}
        spine={{ overview, canMove: true, copy: ko.projectSpine, filmMeta: ko.studioVideo.workspace.projects.meta }}
        initialSpine={{
          tab: "by_project",
          openedScope: { kind: "project", brandProjectId: P1 },
          page: page1,
          scopeQuery: "최종",
        }}
      />,
    );
    expect(searched).toContain(`data-asset-hub-film="${filmOne.id}"`);
    expect(searched).not.toContain("data-asset-hub-sound");
    expect(searched).toContain("data-asset-hub-more");

    // loading_more disables 더 불러오기 while keeping loaded tiles.
    const loadingMoreState: ScopePageState = {
      phase: "loading_more",
      items: page1.items,
      jobs: page1.jobs,
      assets: page1.assets,
      films: page1.films,
      next: "page-2",
    };
    const loadingMoreHtml = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={ko.brandStudio}
        libraryCopy={ko.studioLibrary}
        initialState={studioState({ canCreate: true })}
        injectedLibrary={stubLibrary()}
        api={api}
        spine={{ overview, canMove: true, copy: ko.projectSpine, filmMeta: ko.studioVideo.workspace.projects.meta }}
        initialSpine={{
          tab: "by_project",
          openedScope: { kind: "project", brandProjectId: P1 },
          state: loadingMoreState,
        }}
      />,
    );
    expect(loadingMoreHtml).toMatch(/<button[^>]*disabled=""[^>]*data-asset-hub-more/);

    // Failed read on page 2 preserves already-loaded tiles and offers retry.
    const failedMoreState: ScopePageState = {
      ...loadingMoreState,
      phase: "failed",
    };
    const failedMoreHtml = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={ko.brandStudio}
        libraryCopy={ko.studioLibrary}
        initialState={studioState({ canCreate: true })}
        injectedLibrary={stubLibrary()}
        api={api}
        spine={{ overview, canMove: true, copy: ko.projectSpine, filmMeta: ko.studioVideo.workspace.projects.meta }}
        initialSpine={{
          tab: "by_project",
          openedScope: { kind: "project", brandProjectId: P1 },
          state: failedMoreState,
        }}
      />,
    );
    expect(failedMoreHtml).toContain(`data-asset-hub-film="${filmOne.id}"`);
    expect(failedMoreHtml).toContain(ko.studioLibrary.hub.spine.loadFailed);
    expect(failedMoreHtml).toContain(ko.studioLibrary.hub.spine.retry);
  });

  it("renders scope-specific empty messages, initial failure & not_found retry on fixed scopes, single notice on by_project, and soundMarker only when requested", () => {
    const ko = getDictionary("ko");
    const emptyOverview = makeOverview({ projects: [sampleOverview().projects[2]!] });
    const api = createStudioApi({ organizationId: ORG });
    const renderTile = renderTestScopeTile(ko.studioLibrary);
    const emptyPage: StudioBrandProjectFiles = {
      ok: true,
      items: [],
      jobs: [],
      assets: [],
      films: [],
      next: null,
    };

    const emptyProjectHtml = renderToStaticMarkup(
      <ScopeView
        organizationId={ORG}
        scope={{ kind: "project", brandProjectId: P3 }}
        overview={emptyOverview}
        libraryCopy={ko.studioLibrary}
        projectSpineCopy={ko.projectSpine}
        studioCopy={ko.brandStudio}
        filmMeta={ko.studioVideo.workspace.projects.meta}
        canOpenStudio={true}
        canMove={true}
        api={api}
        query=""
        onQueryChange={() => {}}
        likedKeys={new Set()}
        onBack={() => {}}
        onScopeGone={() => {}}
        renderTile={renderTile}
        initialPage={emptyPage}
      />,
    );
    expect(emptyProjectHtml).toContain(ko.studioLibrary.hub.spine.groupEmpty);

    const emptyUnfiledHtml = renderToStaticMarkup(
      <ScopeView
        organizationId={ORG}
        scope={{ kind: "unfiled" }}
        overview={emptyOverview}
        libraryCopy={ko.studioLibrary}
        projectSpineCopy={ko.projectSpine}
        studioCopy={ko.brandStudio}
        filmMeta={ko.studioVideo.workspace.projects.meta}
        canOpenStudio={true}
        canMove={true}
        api={api}
        query=""
        onQueryChange={() => {}}
        likedKeys={new Set()}
        onScopeGone={() => {}}
        renderTile={renderTile}
        initialPage={emptyPage}
      />,
    );
    expect(emptyUnfiledHtml).toContain(ko.studioLibrary.hub.spine.unfiledEmpty);

    const emptyMaterialsHtml = renderToStaticMarkup(
      <ScopeView
        organizationId={ORG}
        scope={{ kind: "brand_materials" }}
        overview={emptyOverview}
        libraryCopy={ko.studioLibrary}
        projectSpineCopy={ko.projectSpine}
        studioCopy={ko.brandStudio}
        filmMeta={ko.studioVideo.workspace.projects.meta}
        canOpenStudio={true}
        canMove={true}
        api={api}
        query=""
        onQueryChange={() => {}}
        likedKeys={new Set()}
        onScopeGone={() => {}}
        renderTile={renderTile}
        initialPage={emptyPage}
      />,
    );
    expect(emptyMaterialsHtml).toContain(ko.studioLibrary.hub.spine.materialsEmpty);

    const searchNoMatchMoreHtml = renderToStaticMarkup(
      <ScopeView
        organizationId={ORG}
        scope={{ kind: "unfiled" }}
        overview={sampleOverview()}
        libraryCopy={ko.studioLibrary}
        projectSpineCopy={ko.projectSpine}
        studioCopy={ko.brandStudio}
        filmMeta={ko.studioVideo.workspace.projects.meta}
        canOpenStudio={true}
        canMove={true}
        api={api}
        query="없는검색어"
        onQueryChange={() => {}}
        likedKeys={new Set()}
        onScopeGone={() => {}}
        renderTile={renderTile}
        initialPage={{ ...emptyPage, next: "page-2" }}
      />,
    );
    expect(searchNoMatchMoreHtml).toContain(ko.studioLibrary.uploads.noMatch);
    expect(searchNoMatchMoreHtml).toContain("data-asset-hub-more");

    const initialFailedHtml = renderToStaticMarkup(
      <ScopeView
        organizationId={ORG}
        scope={{ kind: "unfiled" }}
        overview={sampleOverview()}
        libraryCopy={ko.studioLibrary}
        projectSpineCopy={ko.projectSpine}
        studioCopy={ko.brandStudio}
        filmMeta={ko.studioVideo.workspace.projects.meta}
        canOpenStudio={true}
        canMove={true}
        api={api}
        query=""
        onQueryChange={() => {}}
        likedKeys={new Set()}
        onScopeGone={() => {}}
        renderTile={renderTile}
        initialState={{ phase: "failed", items: [], jobs: [], assets: [], films: [], next: null }}
      />,
    );
    expect(initialFailedHtml).toContain(ko.studioLibrary.hub.spine.loadFailed);
    expect(initialFailedHtml).toContain(ko.studioLibrary.hub.spine.retry);

    // Fix 2-6: not_found on fixed scopes (unfiled, brand_materials) renders loadFailed + retry, NEVER empty messages.
    const notFoundState: ScopePageState = { phase: "not_found", items: [], jobs: [], assets: [], films: [], next: null };
    const unfiledNotFoundHtml = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={ko.brandStudio}
        libraryCopy={ko.studioLibrary}
        initialState={studioState({ canCreate: true })}
        injectedLibrary={stubLibrary()}
        spine={{ overview: sampleOverview(), canMove: true, copy: ko.projectSpine, filmMeta: ko.studioVideo.workspace.projects.meta }}
        initialSpine={{ tab: "unfiled", state: notFoundState }}
      />,
    );
    expect(unfiledNotFoundHtml).toContain(ko.studioLibrary.hub.spine.loadFailed);
    expect(unfiledNotFoundHtml).toContain(ko.studioLibrary.hub.spine.retry);
    expect(unfiledNotFoundHtml).not.toContain(ko.studioLibrary.hub.spine.unfiledEmpty);

    const materialsNotFoundHtml = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={ko.brandStudio}
        libraryCopy={ko.studioLibrary}
        initialState={studioState({ canCreate: true })}
        injectedLibrary={stubLibrary()}
        spine={{ overview: sampleOverview(), canMove: true, copy: ko.projectSpine, filmMeta: ko.studioVideo.workspace.projects.meta }}
        initialSpine={{ tab: "brand_materials", state: notFoundState }}
      />,
    );
    expect(materialsNotFoundHtml).toContain(ko.studioLibrary.hub.spine.loadFailed);
    expect(materialsNotFoundHtml).toContain(ko.studioLibrary.hub.spine.retry);
    expect(materialsNotFoundHtml).not.toContain(ko.studioLibrary.hub.spine.materialsEmpty);

    // AssetHubSpine renders errorLine(studioCopy, "not_found") on by_project without duplicating on all.
    const goneMsg = errorLine(ko.brandStudio, "not_found");
    const byProjectWithNotice = renderToStaticMarkup(
      <AssetHubSpine
        organizationId={ORG}
        studioCopy={ko.brandStudio}
        libraryCopy={ko.studioLibrary}
        state={studioState({ assets: sampleAssets() })}
        loadFailed={false}
        notice={goneMsg}
        onRetryLoad={() => {}}
        onNotice={() => {}}
        deliverables={[]}
        canOpenStudio={true}
        api={api}
        likedKeys={new Set()}
        spine={{ overview: sampleOverview(), canMove: true, copy: ko.projectSpine, filmMeta: ko.studioVideo.workspace.projects.meta }}
        allSection={null}
        renderScopeTile={renderTile}
      />,
    );
    expect(byProjectWithNotice).toContain(goneMsg);

    const soundEntry = buildHubEntries(
      [],
      [job(99, { kind: "music", prompt: "Warm piano", outputs: [output(99, { kind: "audio", seconds: 22 })] })],
      ko.studioLibrary.hub.sourceGenerated,
    )[0]!;
    const tileWithMarker = renderToStaticMarkup(
      <HubTile
        entry={soundEntry}
        copy={ko.studioLibrary}
        name="Warm piano"
        liked={false}
        main={null}
        more={[]}
        moreLabel="More"
        soundMarker={true}
        menuOpen={false}
        onMenu={() => {}}
        onOpen={() => {}}
        onLike={() => {}}
        onAction={() => {}}
      />,
    );
    const tileWithoutMarker = renderToStaticMarkup(
      <HubTile
        entry={soundEntry}
        copy={ko.studioLibrary}
        name="Warm piano"
        liked={false}
        main={null}
        more={[]}
        moreLabel="More"
        menuOpen={false}
        onMenu={() => {}}
        onOpen={() => {}}
        onLike={() => {}}
        onAction={() => {}}
      />,
    );
    expect(tileWithMarker).toContain("data-asset-hub-sound");
    expect(tileWithoutMarker).not.toContain("data-asset-hub-sound");
  });

  it("renders selection bar, selected count, disabled >200 move, and hides selection controls for viewers (§5.5)", () => {
    const ko = getDictionary("ko");
    const overview = sampleOverview();
    const api = createStudioApi({ organizationId: ORG });
    const filmOne: VideoProjectSummary = {
      id: id(0x502),
      organizationId: ORG,
      title: "Select Cut",
      status: "active",
      aspect: "9:16",
      revision: 1,
      clipCount: 2,
      durationSec: 12,
      thumbUrl: null,
      completedAt: null,
      createdAt: "2026-11-25T10:02:00Z",
      updatedAt: "2026-11-25T10:02:00Z",
      brandProjectId: P1,
    };
    const a5 = asset(5, { name: "Main wordmark", role: "logo" });
    const j11 = job(11, { kind: "image", outputs: [output(11)] });
    const page1: StudioBrandProjectFiles = {
      ok: true,
      items: [
        { type: "film", id: filmOne.id },
        { type: "job", id: j11.id },
        { type: "asset", id: a5.id },
      ],
      films: [filmOne],
      jobs: [j11],
      assets: [a5],
      next: null,
    };

    const renderTile = renderTestScopeTile(ko.studioLibrary);

    const editorIdle = renderToStaticMarkup(
      <ScopeView
        organizationId={ORG}
        scope={{ kind: "project", brandProjectId: P1 }}
        overview={overview}
        libraryCopy={ko.studioLibrary}
        projectSpineCopy={ko.projectSpine}
        studioCopy={ko.brandStudio}
        filmMeta={ko.studioVideo.workspace.projects.meta}
        canOpenStudio={true}
        canMove={true}
        api={api}
        query=""
        onQueryChange={() => {}}
        likedKeys={new Set()}
        onBack={() => {}}
        onScopeGone={() => {}}
        renderTile={renderTile}
        initialPage={page1}
      />,
    );
    expect(editorIdle).toContain("data-asset-hub-select");
    expect(editorIdle).not.toContain("data-asset-hub-selected-count");

    const editorSelecting = renderToStaticMarkup(
      <ScopeView
        organizationId={ORG}
        scope={{ kind: "project", brandProjectId: P1 }}
        overview={overview}
        libraryCopy={ko.studioLibrary}
        projectSpineCopy={ko.projectSpine}
        studioCopy={ko.brandStudio}
        filmMeta={ko.studioVideo.workspace.projects.meta}
        canOpenStudio={true}
        canMove={true}
        api={api}
        query=""
        onQueryChange={() => {}}
        likedKeys={new Set()}
        onBack={() => {}}
        onScopeGone={() => {}}
        renderTile={renderTile}
        initialPage={page1}
        initialSelecting={true}
        initialSelectedKeys={[`f:${filmOne.id}`, `a:${a5.id}`]}
      />,
    );
    expect(editorSelecting).toContain("data-asset-hub-selected-count");
    expect(editorSelecting).toContain("2개를 선택했어요");
    expect(editorSelecting).toContain("data-asset-hub-move");
    expect(editorSelecting).toContain(ko.projectSpine.move);
    expect(editorSelecting).toContain(ko.projectSpine.cancel);
    expect(editorSelecting).toContain('data-selected=""');

    // Viewer never sees selection controls even if flags are passed.
    const viewerSelecting = renderToStaticMarkup(
      <ScopeView
        organizationId={ORG}
        scope={{ kind: "project", brandProjectId: P1 }}
        overview={overview}
        libraryCopy={ko.studioLibrary}
        projectSpineCopy={ko.projectSpine}
        studioCopy={ko.brandStudio}
        filmMeta={ko.studioVideo.workspace.projects.meta}
        canOpenStudio={false}
        canMove={false}
        api={api}
        query=""
        onQueryChange={() => {}}
        likedKeys={new Set()}
        onBack={() => {}}
        onScopeGone={() => {}}
        renderTile={renderTile}
        initialPage={page1}
        initialSelecting={true}
        initialSelectedKeys={[`a:${a5.id}`]}
      />,
    );
    expect(viewerSelecting).not.toContain("data-asset-hub-select");
    expect(viewerSelecting).not.toContain("data-asset-hub-selected-count");
    expect(viewerSelecting).not.toContain("data-asset-hub-move");

    // 201 targets disables move with moveTooMany text.
    const manyAssets = Array.from({ length: 201 }, (_, i) => asset(i + 10));
    const overLimitHtml = renderToStaticMarkup(
      <ScopeView
        organizationId={ORG}
        scope={{ kind: "unfiled" }}
        overview={overview}
        libraryCopy={ko.studioLibrary}
        projectSpineCopy={ko.projectSpine}
        studioCopy={ko.brandStudio}
        filmMeta={ko.studioVideo.workspace.projects.meta}
        canOpenStudio={true}
        canMove={true}
        api={api}
        query=""
        onQueryChange={() => {}}
        likedKeys={new Set()}
        onScopeGone={() => {}}
        renderTile={renderTile}
        initialPage={{
          ok: true,
          items: manyAssets.map((a) => ({ type: "asset", id: a.id })),
          assets: manyAssets,
          jobs: [],
          films: [],
          next: null,
        }}
        initialSelecting={true}
        initialSelectedKeys={manyAssets.map((a) => `a:${a.id}`)}
      />,
    );
    expect(overLimitHtml).toMatch(/disabled=""[^>]*data-asset-hub-move|data-asset-hub-move=""[^>]*disabled=""/);
    expect(overLimitHtml).toContain(ko.projectSpine.moveTooMany);
  });

  it("supports mixed jobIds + assetIds + filmIds in MoveToProjectDialog and createMoveToProjectController (§5.5)", async () => {
    const ko = getDictionary("ko");
    const calls: Array<{ projectId: string | null; jobIds?: string[]; assetIds?: string[]; filmIds?: string[]; preview?: boolean }> = [];
    const controller = createMoveToProjectController({
      jobIds: [job(1).id],
      assetIds: [asset(2).id],
      filmIds: [id(0x503)],
      projects: [{ id: P1, title: "봄 향수" }],
      openScope: { kind: "unfiled" },
      copy: ko.projectSpine,
      move: async (input) => {
        calls.push(input);
        return {
          ok: true,
          projectId: input.projectId,
          jobIds: [job(1).id, job(2).id],
          assetIds: input.assetIds ?? [],
          filmIds: input.filmIds ?? [],
        };
      },
    });

    const preview = await controller.preview(P1);
    expect(preview).toEqual({ familyCount: 2 });
    const submitted = await controller.submit(P1);
    expect(submitted).toEqual({
      ok: true,
      projectId: P1,
      toast: fill(ko.projectSpine.moveDone, { name: "봄 향수" }),
      removedJobIds: [job(1).id, job(2).id],
    });
    expect(calls[0]).toEqual({
      projectId: P1,
      jobIds: [job(1).id],
      assetIds: [asset(2).id],
      filmIds: [id(0x503)],
      preview: true,
    });

    // Dialog renders and keeps submit enabled for valid unfiled -> P1 move even when jobIds is empty.
    const dialogHtml = renderToStaticMarkup(
      <MoveToProjectDialog
        projects={[{ id: P1, title: "봄 향수", origin: "self", lastActivityAt: "2026-11-25T10:00:00Z" }]}
        currentScope={{ kind: "unfiled" }}
        jobIds={[]}
        assetIds={[asset(2).id]}
        filmIds={[id(0x503)]}
        locale="ko"
        copy={ko.projectSpine}
        onMove={async () => ({ ok: true, projectId: P1, jobIds: [], assetIds: [asset(2).id], filmIds: [id(0x503)] })}
        onMoved={() => {}}
        onClose={() => {}}
      />,
    );
    expect(dialogHtml).toContain("data-project-move-dialog");
  });

  it("renders 보기 view selector inside 모든 파일 tab and team deliverables inside team overview & opened team scope (§5.7)", () => {
    const ko = getDictionary("ko");
    const overview = sampleOverview();
    const api = createStudioApi({ organizationId: ORG });
    const teamDeliverables = [
      {
        id: id(0x701),
        projectId: P2,
        projectTitle: "겨울 립 컬렉션 필름",
        title: "Final Team Deliverable",
        kind: "video" as const,
        url: "https://media.example/d.mp4",
        createdAt: "2026-11-25T08:30:00Z",
      },
    ];

    const withDeliverables = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={ko.brandStudio}
        libraryCopy={ko.studioLibrary}
        initialState={studioState({ assets: sampleAssets() })}
        deliverables={teamDeliverables}
        deliverableCount={1}
        deliverablesNode={<p>Deliverables box</p>}
        injectedLibrary={stubLibrary()}
        spine={{ overview: makeOverview(), canMove: true, copy: ko.projectSpine, filmMeta: ko.studioVideo.workspace.projects.meta }}
      />,
    );
    expect(withDeliverables).toContain('data-asset-hub-view="all"');
    const viewSelectBlock = withDeliverables.match(/<select[^>]*data-asset-hub-view[^>]*>([\s\S]*?)<\/select>/)?.[1] ?? "";
    expect([...viewSelectBlock.matchAll(/value="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "all",
      "uploads",
      "generated",
      "liked",
      "folders",
      "deliverables",
    ]);

    const withoutDeliverables = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={ko.brandStudio}
        libraryCopy={ko.studioLibrary}
        initialState={studioState({ assets: sampleAssets() })}
        deliverableCount={0}
        injectedLibrary={stubLibrary()}
        spine={{ overview: makeOverview(), canMove: true, copy: ko.projectSpine, filmMeta: ko.studioVideo.workspace.projects.meta }}
      />,
    );
    const viewNoDelivBlock = withoutDeliverables.match(/<select[^>]*data-asset-hub-view[^>]*>([\s\S]*?)<\/select>/)?.[1] ?? "";
    expect([...viewNoDelivBlock.matchAll(/value="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "all",
      "uploads",
      "generated",
      "liked",
      "folders",
    ]);

    // Keeping 보기 selector visible even when folders or deliverables section is selected.
    const foldersViewHtml = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={ko.brandStudio}
        libraryCopy={ko.studioLibrary}
        initialState={studioState({ assets: sampleAssets() })}
        injectedLibrary={stubLibrary()}
        spine={{ overview: makeOverview(), canMove: true, copy: ko.projectSpine, filmMeta: ko.studioVideo.workspace.projects.meta }}
        initialAllView="folders"
      />,
    );
    expect(foldersViewHtml).toContain('data-asset-hub-view="folders"');
    expect(foldersViewHtml).toContain("data-asset-hub-folders");

    // Team deliverables appear in ByProjectView cover row and inside opened team ScopeView.
    const teamGroupOverview = renderToStaticMarkup(
      <AssetHubSpine
        organizationId={ORG}
        studioCopy={ko.brandStudio}
        libraryCopy={ko.studioLibrary}
        state={studioState({ assets: sampleAssets() })}
        loadFailed={false}
        notice={null}
        onRetryLoad={() => {}}
        onNotice={() => {}}
        deliverables={teamDeliverables}
        canOpenStudio={true}
        api={api}
        likedKeys={new Set()}
        spine={{ overview, canMove: true, copy: ko.projectSpine, filmMeta: ko.studioVideo.workspace.projects.meta }}
        allSection={null}
        renderScopeTile={renderTestScopeTile(ko.studioLibrary)}
      />,
    );
    const p2Slice = teamGroupOverview.slice(
      teamGroupOverview.indexOf(`data-asset-hub-group="${P2}"`),
      teamGroupOverview.indexOf(`data-asset-hub-group="${P3}"`),
    );
    expect(p2Slice).toContain("data-asset-hub-deliverable");
    expect(p2Slice).not.toContain("audioStage");

    const openedTeamScope = renderToStaticMarkup(
      <ScopeView
        organizationId={ORG}
        scope={{ kind: "project", brandProjectId: P2 }}
        overview={overview}
        libraryCopy={ko.studioLibrary}
        projectSpineCopy={ko.projectSpine}
        studioCopy={ko.brandStudio}
        filmMeta={ko.studioVideo.workspace.projects.meta}
        canOpenStudio={true}
        canMove={true}
        api={api}
        query=""
        onQueryChange={() => {}}
        likedKeys={new Set()}
        deliverables={teamDeliverables}
        onBack={() => {}}
        onScopeGone={() => {}}
        renderTile={renderTestScopeTile(ko.studioLibrary)}
        initialPage={{ ok: true, items: [], assets: [], jobs: [], films: [], next: null }}
      />,
    );
    expect(openedTeamScope).toContain("data-asset-hub-deliverable");
    expect(openedTeamScope).toContain("Final Team Deliverable");
  });

  it("shares one 모든 파일 body and filter toolbar in a single toolbar row with the legacy all view (Fix 0-2, Fix 2-7)", () => {
    const dict = getDictionary("ko");
    const state = studioState({
      assets: sampleAssets(),
      jobs: [job(1, { prompt: "Morning shot", outputs: [output(1)] })],
    });
    const emptyOverview = makeOverview();

    const spineHtml = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        initialState={state}
        injectedLibrary={stubLibrary()}
        spine={{ overview: emptyOverview, canMove: true, copy: dict.projectSpine, filmMeta: dict.studioVideo.workspace.projects.meta }}
      />,
    );
    const legacyHtml = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        initialState={state}
        injectedLibrary={stubLibrary()}
      />,
    );

    // Fix 2-7: one single toolbar holds tabs on the left and filters + 보기 on the right on 모든 파일.
    const toolbars = spineHtml.match(/<section class="[^"]*toolbar[^"]*"/g) ?? [];
    expect(toolbars).toHaveLength(1);
    expect(spineHtml.indexOf('data-asset-hub-tab="all"')).toBeLessThan(spineHtml.indexOf("data-asset-hub-view"));
    expect(spineHtml.indexOf("data-asset-hub-view")).toBeLessThan(spineHtml.indexOf("data-asset-hub-kind"));

    const spineWithoutTabBar = spineHtml
      .replace(/<div class="[^"]*segTrack[^"]*" role="tablist"[\s\S]*?<\/div>/, "")
      .replace(/<span class="[^"]*selectWrap[^"]*"[^>]*><select[^>]*data-asset-hub-view="[^"]*"[\s\S]*?<\/select><\/span>/, "");
    const legacyWithoutTabBar = legacyHtml.replace(/<div class="[^"]*segTrack[^"]*" role="tablist"[\s\S]*?<\/div>/, "");

    expect(spineHtml).toContain('data-asset-hub-view="all"');
    expect(legacyHtml).not.toContain("data-asset-hub-view");
    expect(spineWithoutTabBar).not.toBe(spineHtml);
    expect(legacyWithoutTabBar).not.toBe(legacyHtml);
    expect(spineWithoutTabBar).toBe(legacyWithoutTabBar);
  });

  it("excludes assets with omitted brandProjectId (unknown) from 브랜드 자료 line (Fix 1-5) and shows emptyAll + actions on empty 프로젝트별 (Fix 1-7)", () => {
    const dict = getDictionary("ko");
    const api = createStudioApi({ organizationId: ORG });
    const unknownRoleAsset = asset(50, { name: "Unknown filing", role: "logo" });
    delete (unknownRoleAsset as { brandProjectId?: string | null }).brandProjectId;

    const withUnknown = renderToStaticMarkup(
      <AssetHubSpine
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        state={studioState({ assets: [unknownRoleAsset] })}
        loadFailed={false}
        notice={null}
        onRetryLoad={() => {}}
        onNotice={() => {}}
        deliverables={[]}
        canOpenStudio={true}
        api={api}
        likedKeys={new Set()}
        spine={{
          overview: makeOverview({
            brandMaterials: { count: 1, byRole: { logo: 1, product: 0, person: 0, style: 0, place: 0 }, covers: [] },
          }),
          canMove: true,
          copy: dict.projectSpine,
          filmMeta: dict.studioVideo.workspace.projects.meta,
        }}
        allSection={null}
        renderScopeTile={renderTestScopeTile(dict.studioLibrary)}
      />,
    );
    expect(withUnknown).not.toContain("Unknown filing");

    // Empty org on 프로젝트별 shows emptyAll + upload & openStudio actions (NOT noMatch).
    const emptyByProject = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        initialState={studioState({ canCreate: true })}
        injectedLibrary={stubLibrary()}
        spine={{ overview: makeOverview(), canMove: true, copy: dict.projectSpine, filmMeta: dict.studioVideo.workspace.projects.meta }}
      />,
    );
    // Test AssetHubSpine directly switched to initialTab="by_project" with emptyActions from BrandAssetHub or standalone empty.
    const emptyTabDirect = renderToStaticMarkup(
      <AssetHubSpine
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        state={studioState({ canCreate: true })}
        loadFailed={false}
        notice={null}
        onRetryLoad={() => {}}
        onNotice={() => {}}
        deliverables={[]}
        canOpenStudio={true}
        api={api}
        likedKeys={new Set()}
        spine={{ overview: makeOverview(), canMove: true, copy: dict.projectSpine, filmMeta: dict.studioVideo.workspace.projects.meta }}
        allSection={null}
        renderScopeTile={renderTestScopeTile(dict.studioLibrary)}
        emptyActions={
          <>
            <button type="button" data-asset-hub-empty-upload="">{dict.studioLibrary.hub.uploadAction}</button>
            <a href={`/brand/studio?organizationId=${ORG}`}>{dict.studioLibrary.hub.openStudio}</a>
          </>
        }
        initialTab="by_project"
      />,
    );
    expect(emptyByProject).toContain(dict.studioLibrary.hub.emptyAll);
    expect(emptyTabDirect).toContain(dict.studioLibrary.hub.emptyAll);
    expect(emptyTabDirect).not.toContain(dict.studioLibrary.uploads.noMatch);
    expect(emptyTabDirect).toContain("data-asset-hub-empty-upload");
    expect(emptyTabDirect).toContain(dict.studioLibrary.hub.openStudio);
  });

  it("keeps asset-hub-spine.module.css free of color literals, copied badge/glyph, new color vars, horizontal scrollbars, and keeps scope wiring safe (Fix 1-3, Fix 1-6, Fix 2-1, Fix 2-4, Fix 2-8)", () => {
    const css = readFileSync(join(process.cwd(), "components", "brand-studio", "asset-hub-spine", "asset-hub-spine.module.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/--ys-accent|#ff58ae|#ff389f|#ed1e1e|transition\s*:\s*all/i);
    expect(css).not.toMatch(/rgba?\(|#[0-9a-f]{3,8}/i);
    expect(css).not.toMatch(/--spine-/);
    expect(css).not.toMatch(/^\s*\.(badge|glyph)\b/m);
    expect(css).not.toMatch(/overflow-x\s*:\s*auto|::-webkit-scrollbar|scrollbar-width/);
    expect(css).toContain("tabular-nums");
    expect(css).toContain("prefers-reduced-motion");

    const indexSrc = readFileSync(join(process.cwd(), "components", "brand-studio", "asset-hub-spine", "index.tsx"), "utf8");
    expect(indexSrc).not.toMatch(/\bscope\s*=\s*\{\s*\{/);

    const scopeViewSrc = readFileSync(join(process.cwd(), "components", "brand-studio", "asset-hub-spine", "scope-view.tsx"), "utf8");
    expect(scopeViewSrc).not.toContain("<HubTile");
    expect(scopeViewSrc).toContain("s.foot");
    expect(scopeViewSrc).toContain("s.footTitle");
    expect(scopeViewSrc).toContain("s.footNote");

    // Fix 4-1 source guard: `<video` appears ONLY inside `lazy-video-cover.tsx` under asset-hub-spine/,
    // using `preload="metadata"` and without `autoPlay`.
    const spineDir = join(process.cwd(), "components", "brand-studio", "asset-hub-spine");
    const spineFiles = readdirSync(spineDir).filter((f) => /\.(ts|tsx)$/.test(f));
    const filesWithVideoTag = spineFiles.filter((f) => readFileSync(join(spineDir, f), "utf8").includes("<video"));
    expect(filesWithVideoTag).toEqual(["lazy-video-cover.tsx"]);
    const lazyVideoSrc = readFileSync(join(spineDir, "lazy-video-cover.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    expect(lazyVideoSrc).toContain('preload="metadata"');
    expect(lazyVideoSrc).not.toMatch(/autoPlay|controls/i);
    expect(css).toContain("coverBadge");
    expect(css).toContain("scopeBack");
    expect(css).toContain("calc((100cqi - 7 * var(--mat-gap)) / 8)");
    expect(css).toMatch(/\.materialsStrip[\s\S]*gap:\s*var\(--mat-gap\)/);
    expect(css).toMatch(/\.materialTiles[\s\S]*gap:\s*var\(--mat-gap\)/);
  });

  it("replaces legacy project assign with 프로젝트로 옮기기 across tile menus and HubDetail when spine is set, respecting canMove and keeping !spine untouched (Fix 2-10)", () => {
    const ko = getDictionary("ko");
    const en = getDictionary("en");
    const overview = sampleOverview();
    const api = createStudioApi({ organizationId: ORG });
    const runItem = job(31, { kind: "image", prompt: "Glass bottle shot", outputs: [output(31)], projectId: P1, brandProjectId: P1 });
    const uploadItem = asset(31, { name: "Brand Product", role: "product", brandProjectId: null });
    const entries = buildHubEntries([uploadItem], [runItem], ko.studioLibrary.hub.sourceGenerated);
    const uploadEntry = entries.find((e) => e.asset?.id === uploadItem.id)!;
    const runEntry = entries.find((e) => e.jobId === runItem.id)!;

    const fullState = studioState({
      assets: [uploadItem],
      jobs: [runItem],
      projects: [{ id: id(0x901), title: "Legacy Studio Project" }],
      canCreate: true,
    });
    const pageForScopes: StudioBrandProjectFiles = {
      ok: true,
      items: [
        { type: "job", id: runItem.id },
        { type: "asset", id: uploadItem.id },
      ],
      jobs: [runItem],
      assets: [uploadItem],
      films: [],
      next: null,
    };

    // 1. Spine + canMove: true across 모든 파일, brand_materials, unfiled, project:<id> (tile menus + HubDetail).
    const allTabMenu = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={ko.brandStudio}
        libraryCopy={ko.studioLibrary}
        initialState={fullState}
        injectedLibrary={stubLibrary()}
        api={api}
        spine={{ overview: makeOverview(), canMove: true, copy: ko.projectSpine, filmMeta: ko.studioVideo.workspace.projects.meta }}
        initialSpine={{
          tab: "all",
          menuKey: `all|${runEntry.key}`,
          detailKey: uploadEntry.key,
        }}
      />,
    );
    // RailMenu portals its menu items to document.body only on client mount; verify both menuOpen state on the tile
    // and data-project-move on HubDetail, plus hubActions parity (shared between HubTile's RailMenu and HubDetail).
    expect(allTabMenu).toContain(`data-asset-hub-card="${runEntry.key}"`);
    expect(allTabMenu).toContain('data-menu-open=""');
    expect(allTabMenu).toContain("data-project-move");
    expect(allTabMenu).not.toContain("data-asset-hub-project-assign");
    expect(allTabMenu).toContain(ko.projectSpine.move);

    const actionCopy = {
      useImage: ko.studioLibrary.hub.openInImage,
      decorate: ko.brandStudio.gallery.menu.decorate,
      makeVideo: ko.studioLibrary.hub.openInVideo,
      compose: ko.studioLibrary.hub.openInCompose,
      reverse: ko.studioLibrary.hub.reverseVideo,
      share: ko.studioLibrary.hub.shareReview,
      similar: ko.studioLibrary.hub.findSimilar,
      edit: ko.studioLibrary.uploads.edit,
    };
    for (const candidate of [runEntry, uploadEntry]) {
      const spineActions = hubActions(candidate, {
        organizationId: ORG,
        canOpenStudio: true,
        canCreate: true,
        copy: actionCopy,
        projectLabel: null,
        moveProjectLabel: ko.projectSpine.move,
      });
      expect(spineActions.more.map((a) => a.key)).toContain("projectMove");
      expect(spineActions.more.map((a) => a.key)).not.toContain("project");
      expect(spineActions.more.find((a) => a.key === "projectMove")?.marker).toBe("data-project-move");

      const viewerActions = hubActions(candidate, {
        organizationId: ORG,
        canOpenStudio: false,
        canCreate: false,
        copy: actionCopy,
        projectLabel: null,
        moveProjectLabel: null,
      });
      expect(viewerActions.more.map((a) => a.key)).not.toContain("projectMove");
      expect(viewerActions.more.map((a) => a.key)).not.toContain("project");
    }

    for (const [label, tab, openedScope] of [
      ["brand_materials", "brand_materials", null],
      ["unfiled", "unfiled", null],
      ["project", "by_project", { kind: "project", brandProjectId: P1 }],
    ] as const) {
      const scopeHtml = renderToStaticMarkup(
        <BrandAssetHub
          organizationId={ORG}
          studioCopy={ko.brandStudio}
          libraryCopy={ko.studioLibrary}
          initialState={fullState}
          injectedLibrary={stubLibrary()}
          api={api}
          spine={{ overview, canMove: true, copy: ko.projectSpine, filmMeta: ko.studioVideo.workspace.projects.meta }}
          initialSpine={{
            tab,
            openedScope,
            page: pageForScopes,
            menuKey: `${openedScope ? `project:${P1}` : tab}|${uploadEntry.key}`,
            detailKey: runEntry.key,
          }}
        />,
      );
      expect(scopeHtml, label).toContain('data-menu-open=""');
      expect(scopeHtml, label).toContain("data-project-move");
      expect(scopeHtml, label).not.toContain("data-asset-hub-project-assign");
    }

    // Check upload detail under spine as well (detailKey = uploadEntry inside unfiled scope).
    const uploadScopeDetail = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={ko.brandStudio}
        libraryCopy={ko.studioLibrary}
        initialState={fullState}
        injectedLibrary={stubLibrary()}
        api={api}
        spine={{ overview, canMove: true, copy: ko.projectSpine, filmMeta: ko.studioVideo.workspace.projects.meta }}
        initialSpine={{
          tab: "unfiled",
          page: pageForScopes,
          detailKey: uploadEntry.key,
        }}
      />,
    );
    expect(uploadScopeDetail).toContain("data-project-move");
    expect(uploadScopeDetail).not.toContain("data-asset-hub-project-assign");

    // 2. Spine + canMove: false (viewer): neither projectMove nor legacy project assign renders in menu or HubDetail.
    const viewerHtml = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={en.brandStudio}
        libraryCopy={en.studioLibrary}
        initialState={{ ...fullState, canCreate: false }}
        injectedLibrary={stubLibrary()}
        api={api}
        spine={{ overview, canMove: false, copy: en.projectSpine, filmMeta: en.studioVideo.workspace.projects.meta }}
        initialSpine={{
          tab: "all",
          menuKey: `all|${runEntry.key}`,
          detailKey: uploadEntry.key,
        }}
      />,
    );
    expect(viewerHtml).not.toContain("data-project-move");
    expect(viewerHtml).not.toContain("data-asset-hub-project-assign");

    // 3. Without spine (!spine): legacy data-asset-hub-project-assign stays untouched on runs and no data-project-move appears.
    const legacyDetail = renderToStaticMarkup(
      <HubDetail
        entry={runEntry}
        copy={ko.studioLibrary}
        name={ko.studioLibrary.item.image}
        liked={false}
        {...hubActions(runEntry, {
          organizationId: ORG,
          canOpenStudio: true,
          canCreate: true,
          copy: {
            useImage: ko.studioLibrary.hub.openInImage,
            decorate: ko.brandStudio.gallery.menu.decorate,
            makeVideo: ko.studioLibrary.hub.openInVideo,
            compose: ko.studioLibrary.hub.openInCompose,
            reverse: ko.studioLibrary.hub.reverseVideo,
            share: ko.studioLibrary.hub.shareReview,
            similar: ko.studioLibrary.hub.findSimilar,
            edit: ko.studioLibrary.uploads.edit,
          },
          projectLabel: () => ko.studioLibrary.projects.assign,
        })}
        onLike={() => {}}
        onAction={() => {}}
        onClose={() => {}}
      />,
    );
    expect(legacyDetail).toContain("data-asset-hub-project-assign");
    expect(legacyDetail).not.toContain("data-project-move");

    const singleMoveDialog = renderToStaticMarkup(
      <MoveToProjectDialog
        projects={overview.projects.map((g) => g.project)}
        currentScope={{ kind: "project", id: P1 }}
        jobIds={[runItem.id]}
        assetIds={[]}
        filmIds={[]}
        locale="ko"
        copy={ko.projectSpine}
        onMove={async () => ({ ok: true, projectId: P2, jobIds: [runItem.id], assetIds: [], filmIds: [] })}
        onMoved={() => {}}
        onClose={() => {}}
      />,
    );
    expect(singleMoveDialog).toContain("data-project-move-dialog");
  });
});

describe("/brand/library page.tsx spine prop gating (§5.1)", () => {
  beforeEach(() => {
    pageStub.locale = "ko";
    pageStub.org = { id: ORG, name: "Fixture brand", role: "owner", logoUrl: null, denied: undefined };
    pageStub.spineOpen = false;
    pageStub.runtimeThrow = false;
    pageStub.overviewAnswer = null;
    pageStub.initialState = studioState({ assets: sampleAssets(), canCreate: true });
    pageStub.runOpSpy.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("never imports brand-project-files directly, avoids broad overview cast, and guards spine behind spineOpen (Fix 1-7)", () => {
    const src = readFileSync(join(process.cwd(), "app", "(brand)", "brand", "library", "page.tsx"), "utf8");
    expect(src).not.toMatch(/brand-project-files/);
    expect(src).not.toMatch(/as\s+StudioBrandProjectOverview/);
    expect(src).toContain("brandProjectSpineOpen");
    expect(src).toContain("project.overview");
  });

  it("does not call project.overview when spineOpen is false or when viewer is staff", async () => {
    vi.stubEnv("BRAND_STUDIO_V2", "on");

    pageStub.spineOpen = false;
    const closedHtml = renderToStaticMarkup(
      (await ContentLibrary({ searchParams: Promise.resolve({ organizationId: ORG }) })) as ReactElement,
    );
    expect(closedHtml).not.toContain("data-asset-hub-spine");
    expect(pageStub.runOpSpy).not.toHaveBeenCalled();

    // Even if brandProjectSpineOpen would return true, staff does not see the spine.
    pageStub.spineOpen = true;
    pageStub.org = { id: ORG, name: "Fixture brand", role: "studio", logoUrl: null };
    const staffHtml = renderToStaticMarkup(
      (await ContentLibrary({ searchParams: Promise.resolve({ organizationId: ORG }) })) as ReactElement,
    );
    expect(staffHtml).not.toContain("data-asset-hub-spine");
    expect(pageStub.runOpSpy).not.toHaveBeenCalled();
  });

  it("passes spine with canMove for owners/editors and canMove: false for viewers when project.overview succeeds", async () => {
    vi.stubEnv("BRAND_STUDIO_V2", "on");
    pageStub.spineOpen = true;
    pageStub.overviewAnswer = sampleOverview();

    pageStub.org = { id: ORG, name: "Fixture brand", role: "owner", logoUrl: null };
    pageStub.initialState = studioState({ assets: sampleAssets(), canCreate: true });
    const ownerHtml = renderToStaticMarkup(
      (await ContentLibrary({ searchParams: Promise.resolve({ organizationId: ORG }) })) as ReactElement,
    );
    expect(pageStub.runOpSpy).toHaveBeenCalledWith("project.overview", { organizationId: ORG });
    expect(ownerHtml).toContain("data-asset-hub-spine");
    expect(ownerHtml).toContain("data-asset-hub-unfiled-move");

    pageStub.org = { id: ORG, name: "Fixture brand", role: "viewer", logoUrl: null };
    pageStub.initialState = studioState({ assets: sampleAssets(), canCreate: false });
    const viewerHtml = renderToStaticMarkup(
      (await ContentLibrary({ searchParams: Promise.resolve({ organizationId: ORG }) })) as ReactElement,
    );
    expect(viewerHtml).toContain("data-asset-hub-spine");
    expect(viewerHtml).not.toContain("data-asset-hub-unfiled-move");
  });

  it("falls back to today's page without spine when project.overview fails or throws", async () => {
    vi.stubEnv("BRAND_STUDIO_V2", "on");
    pageStub.spineOpen = true;

    pageStub.overviewAnswer = { ok: false, code: "failed" };
    const failedHtml = renderToStaticMarkup(
      (await ContentLibrary({ searchParams: Promise.resolve({ organizationId: ORG }) })) as ReactElement,
    );
    expect(failedHtml).not.toContain("data-asset-hub-spine");
    expect(failedHtml).toContain('data-asset-hub-tab="uploads"');
    expect(failedHtml).not.toContain('data-asset-hub-tab="by_project"');

    pageStub.overviewAnswer = "throw";
    const threwHtml = renderToStaticMarkup(
      (await ContentLibrary({ searchParams: Promise.resolve({ organizationId: ORG }) })) as ReactElement,
    );
    expect(threwHtml).not.toContain("data-asset-hub-spine");
    expect(threwHtml).toContain('data-asset-hub-tab="uploads"');
    expect(threwHtml).not.toContain('data-asset-hub-tab="by_project"');
  });

  it("lets unexpected studioRuntimeDeps errors bubble instead of swallowing them (Fix 0-1, Fix 2-9)", async () => {
    vi.stubEnv("BRAND_STUDIO_V2", "on");
    pageStub.runtimeThrow = true;

    pageStub.spineOpen = true;
    await expect(ContentLibrary({ searchParams: Promise.resolve({ organizationId: ORG }) })).rejects.toThrow("runtime init failed");

    pageStub.spineOpen = false;
    await expect(ContentLibrary({ searchParams: Promise.resolve({ organizationId: ORG }) })).rejects.toThrow("runtime init failed");
  });

  it("renders orgLogo first under 로고 in 브랜드 자료 line and tab, with owner-only editHref, +1 counts, 8-tile cap, and selection/move exclusion (Batch D)", async () => {
    vi.stubEnv("BRAND_STUDIO_V2", "on");
    const ko = getDictionary("ko");
    const api = createStudioApi({ organizationId: ORG });
    const orgLogoEdit = { url: "https://media.example/org-logo.png", editHref: `/brand/settings?organizationId=${ORG}#brand-logo-heading` };
    const orgLogoReadonly = { url: "https://media.example/org-logo.png", editHref: null };

    // 1. Page wires orgLogo: null when logoUrl is null; editHref only for owner when logoUrl is present.
    pageStub.spineOpen = true;
    pageStub.overviewAnswer = makeOverview({
      projects: [],
      brandMaterials: { count: 0, byRole: { logo: 0, product: 0, person: 0, style: 0, place: 0 }, covers: [] },
    });
    pageStub.initialState = studioState({ assets: [], canCreate: true });

    pageStub.org = { id: ORG, name: "Fixture brand", role: "owner", logoUrl: null };
    const noLogoPage = renderToStaticMarkup(
      (await ContentLibrary({ searchParams: Promise.resolve({ organizationId: ORG }) })) as ReactElement,
    );
    expect(noLogoPage).not.toContain("data-asset-hub-org-logo");

    pageStub.org = { id: ORG, name: "Fixture brand", role: "owner", logoUrl: "https://media.example/org-logo.png" };
    const ownerOnlyLogoPage = renderToStaticMarkup(
      (await ContentLibrary({ searchParams: Promise.resolve({ organizationId: ORG }) })) as ReactElement,
    );
    // Only-logo case: 0 projects + 0 server brandMaterials opens on by_project because orgLogo is present!
    expect(ownerOnlyLogoPage).toMatch(/aria-selected="true"[^>]*data-asset-hub-tab="by_project"/);
    expect(ownerOnlyLogoPage).toContain("data-asset-hub-materials");
    expect(ownerOnlyLogoPage).toContain("data-asset-hub-org-logo");
    expect(ownerOnlyLogoPage).toContain(`href="/brand/settings?organizationId=${ORG}#brand-logo-heading"`);
    expect(ownerOnlyLogoPage).toContain(ko.studioLibrary.uploads.edit);
    expect(ownerOnlyLogoPage).toContain("1개");

    pageStub.org = { id: ORG, name: "Fixture brand", role: "editor", logoUrl: "https://media.example/org-logo.png" };
    const editorOnlyLogoPage = renderToStaticMarkup(
      (await ContentLibrary({ searchParams: Promise.resolve({ organizationId: ORG }) })) as ReactElement,
    );
    expect(editorOnlyLogoPage).toContain("data-asset-hub-org-logo");
    expect(editorOnlyLogoPage).not.toContain("#brand-logo-heading");

    // 2. ByProjectView line: orgLogo counts toward 8-tile cap (1 orgLogo + 7 uploaded = 8) and sits first under logo role.
    const many = Array.from({ length: 10 }, (_, i) =>
      asset(i + 1, { role: i < 4 ? "product" : "logo", brandProjectId: null }),
    );
    const cappedOverview = makeOverview({
      brandMaterials: { count: 10, byRole: { logo: 6, product: 4, person: 0, style: 0, place: 0 }, covers: [] },
    });
    const cappedHtml = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={ko.brandStudio}
        libraryCopy={ko.studioLibrary}
        initialState={studioState({ assets: many })}
        injectedLibrary={stubLibrary()}
        spine={{
          overview: cappedOverview,
          canMove: true,
          copy: ko.projectSpine,
          filmMeta: ko.studioVideo.workspace.projects.meta,
          orgLogo: orgLogoEdit,
        }}
      />,
    );
    const materialsStrip = cappedHtml.slice(cappedHtml.indexOf("data-asset-hub-materials"));
    // 1 see-all button + 7 uploaded tile buttons (+ 1 orgLogo <a> link, NOT a materialTile button) = 8 tiles total!
    expect(materialsStrip.match(/<button /g)).toHaveLength(1 + 7);
    expect(materialsStrip.indexOf("data-asset-hub-org-logo")).toBeLessThan(materialsStrip.indexOf(asset(5).thumbUrl!));
    expect(materialsStrip).toContain("11개");

    // 3. ScopeView on brand_materials (only-logo case): orgLogo visible, logo role chip visible, no materialsEmpty, no select button.
    const renderTile = renderTestScopeTile(ko.studioLibrary);
    const onlyLogoScope = renderToStaticMarkup(
      <ScopeView
        organizationId={ORG}
        scope={{ kind: "brand_materials" }}
        overview={makeOverview()}
        libraryCopy={ko.studioLibrary}
        projectSpineCopy={ko.projectSpine}
        studioCopy={ko.brandStudio}
        filmMeta={ko.studioVideo.workspace.projects.meta}
        canOpenStudio={true}
        canMove={true}
        orgLogo={orgLogoReadonly}
        api={api}
        query=""
        onQueryChange={() => {}}
        likedKeys={new Set()}
        onScopeGone={() => {}}
        renderTile={renderTile}
        initialPage={{ ok: true, items: [], jobs: [], assets: [], films: [], next: null }}
      />,
    );
    expect(onlyLogoScope).toContain("data-asset-hub-org-logo");
    expect(onlyLogoScope).not.toContain("#brand-logo-heading");
    expect(onlyLogoScope).toContain('data-asset-hub-scope-role="logo"');
    expect(onlyLogoScope).not.toContain(ko.studioLibrary.hub.spine.materialsEmpty);
    expect(onlyLogoScope).not.toContain("data-asset-hub-select");

    // 4. Selection mode on brand_materials excludes orgLogo completely from selection and project.move counts.
    const uploadedLogo = asset(55, { name: "Uploaded Logo", role: "logo", brandProjectId: null });
    const selectingScope = renderToStaticMarkup(
      <ScopeView
        organizationId={ORG}
        scope={{ kind: "brand_materials" }}
        overview={makeOverview({
          brandMaterials: { count: 1, byRole: { logo: 1, product: 0, person: 0, style: 0, place: 0 }, covers: [] },
        })}
        libraryCopy={ko.studioLibrary}
        projectSpineCopy={ko.projectSpine}
        studioCopy={ko.brandStudio}
        filmMeta={ko.studioVideo.workspace.projects.meta}
        canOpenStudio={true}
        canMove={true}
        orgLogo={orgLogoEdit}
        api={api}
        query=""
        onQueryChange={() => {}}
        likedKeys={new Set()}
        onScopeGone={() => {}}
        renderTile={renderTile}
        initialPage={{ ok: true, items: [{ type: "asset", id: uploadedLogo.id }], assets: [uploadedLogo], jobs: [], films: [], next: null }}
        initialSelecting={true}
        initialSelectedKeys={[`a:${uploadedLogo.id}`]}
      />,
    );
    expect(selectingScope).toContain("1개를 선택했어요");
    const orgLogoSlice = selectingScope.slice(
      selectingScope.indexOf("data-asset-hub-org-logo"),
      selectingScope.indexOf(`data-asset-hub-card="a:${uploadedLogo.id}"`),
    );
    expect(orgLogoSlice).not.toContain("data-selected");
    expect(orgLogoSlice).not.toContain("aria-pressed");
  });
});
