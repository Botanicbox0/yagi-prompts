import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  BrandMaterialRole,
  BrandProjectFileItem,
  StudioAssetView,
  StudioBrandProjectCounts,
  StudioBrandProjectFiles,
  StudioBrandProjectGroup,
  StudioBrandProjectOverview,
} from "@/lib/brand-studio/contracts";
import type { VideoProjectSummary } from "@/lib/brand-studio/video-projects/contracts";
import {
  buildHubEntries,
  entryMatchesAsset,
  resolveHubEntry,
} from "@/components/brand-studio/asset-hub-model";
import {
  BRAND_MATERIALS_LINE_LIMIT,
  BRAND_MATERIALS_ROLE_ORDER,
  IDLE_OVERVIEW_RELOAD,
  brandMaterialsCountsWithLogo,
  buildAllViewOptions,
  buildKindChips,
  buildRoleChips,
  buildSpineTabs,
  classifyLibraryEntry,
  collectScopeMoveInput,
  deliverableCountsByProject,
  fallbackCovers,
  filmTileAspectRatio,
  filterOverviewProjects,
  filterTeamDeliverables,
  formatGroupCounts,
  freezeScopeMoveSnapshot,
  groupBrandMaterialsLine,
  initialScopePageState,
  initialSpineTab,
  mergeScopeTiles,
  planSpineRefresh,
  requestOverviewReload,
  scopeEmptyMessage,
  scopeMarker,
  scopePageReducer,
  settleOverviewReload,
  shouldCloseScopeOnFailure,
  shouldReadScopeFirstPage,
  singleEntryMoveInput,
  singleMoveReturnSelectors,
  sumProjectCounts,
  toggleScopeSelection,
  type ScopeTile,
} from "@/components/brand-studio/asset-hub-spine/model";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { ORG, asset, id, job, output } from "../ui/fixtures";

const P1 = id(0x91);
const P2 = id(0x92);

const emptyCounts = (patch: Partial<StudioBrandProjectCounts> = {}): StudioBrandProjectCounts => ({
  image: 0,
  video: 0,
  sound: 0,
  upload: 0,
  film: 0,
  ...patch,
});

const projectGroup = (
  pid: string,
  title: string,
  origin: "self" | "team" = "self",
  counts: Partial<StudioBrandProjectCounts> = {},
): StudioBrandProjectGroup => ({
  project: {
    id: pid,
    title,
    origin,
    lastActivityAt: "2026-11-25T10:00:00Z",
  },
  counts: emptyCounts(counts),
  covers: [],
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

describe("asset-hub-spine/model pure decisions (§5.2, §5.3, §6)", () => {
  it("sumProjectCounts sums all five file kinds", () => {
    expect(sumProjectCounts(emptyCounts())).toBe(0);
    expect(sumProjectCounts(emptyCounts({ image: 24, video: 6, sound: 2, upload: 3, film: 1 }))).toBe(36);
  });

  it("buildSpineTabs produces the exact four tabs in order with counts on the first three only", () => {
    const ko = getDictionary("ko");
    const spine = ko.studioLibrary.hub.spine;
    const overview = makeOverview({
      projects: [projectGroup(P1, "Spring"), projectGroup(P2, "Winter", "team")],
      unfiled: { counts: emptyCounts({ image: 10, upload: 4 }), covers: [] },
      brandMaterials: {
        count: 9,
        byRole: { logo: 2, product: 4, person: 3, style: 0, place: 0 },
        covers: [],
      },
    });
    expect(
      buildSpineTabs(overview, {
        byProject: spine.tabByProject,
        brandMaterials: spine.tabMaterials,
        unfiled: ko.projectSpine.unfiled,
        all: spine.tabAll,
      }),
    ).toEqual([
      { id: "by_project", label: "프로젝트별", count: 2 },
      { id: "brand_materials", label: "브랜드 자료", count: 9 },
      { id: "unfiled", label: "미분류", count: 14 },
      { id: "all", label: "모든 파일" },
    ]);
  });

  it("initialSpineTab opens on by_project when projects or brandMaterials exist, else all", () => {
    expect(initialSpineTab(makeOverview({ projects: [projectGroup(P1, "Spring")] }))).toBe("by_project");
    expect(
      initialSpineTab(
        makeOverview({
          projects: [],
          brandMaterials: { count: 1, byRole: { product: 1, person: 0, logo: 0, style: 0, place: 0 }, covers: [] },
        }),
      ),
    ).toBe("by_project");
    // Even with unfiled items, zero projects + zero brand materials opens on all.
    expect(
      initialSpineTab(
        makeOverview({
          projects: [],
          unfiled: { counts: emptyCounts({ image: 5 }), covers: [] },
          brandMaterials: { count: 0, byRole: { product: 0, person: 0, logo: 0, style: 0, place: 0 }, covers: [] },
        }),
      ),
    ).toBe("all");
  });

  it("classifyLibraryEntry treats missing brandProjectId as unknown, never unfiled or brand_materials (Fix 1-5)", () => {
    // Role-tagged entry inside an active project belongs to that project, NOT brand materials.
    expect(classifyLibraryEntry({ brandProjectId: P1, role: "logo" })).toEqual({
      scope: "project",
      brandProjectId: P1,
    });
    // Explicit null with a brand-material role is brand_materials.
    for (const role of BRAND_MATERIALS_ROLE_ORDER) {
      expect(classifyLibraryEntry({ brandProjectId: null, role })).toEqual({
        scope: "brand_materials",
        role,
      });
    }
    // Missing key (undefined) means server did not state filing -> unknown, shown in no group.
    expect(classifyLibraryEntry({ brandProjectId: undefined, role: "product" })).toEqual({
      scope: "unknown",
    });
    expect(classifyLibraryEntry({ role: null })).toEqual({ scope: "unknown" });
    // Explicit null with role null or 'other' is unfiled.
    expect(classifyLibraryEntry({ brandProjectId: null, role: null })).toEqual({ scope: "unfiled" });
    expect(classifyLibraryEntry({ brandProjectId: null, role: "other" })).toEqual({ scope: "unfiled" });
  });

  it("groupBrandMaterialsLine orders logo -> product -> person -> style -> place, drops non-material entries, and caps at 8 balanced across roles", () => {
    expect(BRAND_MATERIALS_ROLE_ORDER).toEqual(["logo", "product", "person", "style", "place"]);
    expect(BRAND_MATERIALS_LINE_LIMIT).toBe(8);

    const assets: StudioAssetView[] = [
      // Filed in project: must be excluded even though role=logo.
      asset(1, { role: "logo", brandProjectId: P1 }),
      // Role 'other' and null: must be excluded.
      asset(2, { role: "other", brandProjectId: null }),
      asset(3, { role: null, brandProjectId: null }),
      // Unfiled brand materials in mixed order: 2 logos, 5 products, 4 people.
      asset(10, { role: "person", brandProjectId: null }),
      asset(11, { role: "product", brandProjectId: null }),
      asset(12, { role: "logo", brandProjectId: null }),
      asset(13, { role: "product", brandProjectId: null }),
      asset(14, { role: "person", brandProjectId: null }),
      asset(15, { role: "logo", brandProjectId: null }),
      asset(16, { role: "product", brandProjectId: null }),
      asset(17, { role: "person", brandProjectId: null }),
      asset(18, { role: "product", brandProjectId: null }),
      asset(19, { role: "product", brandProjectId: null }),
      asset(20, { role: "person", brandProjectId: null }),
    ];

    const grouped = groupBrandMaterialsLine(assets);
    expect(grouped.map((g) => g.role)).toEqual(["logo", "product", "person"]);
    const total = grouped.reduce((sum, g) => sum + g.assets.length, 0);
    expect(total).toBe(8);
    expect(grouped[0]!.assets.map((a) => a.id)).toEqual([asset(12).id, asset(15).id]);
    expect(grouped[1]!.assets).toHaveLength(3);
    expect(grouped[2]!.assets).toHaveLength(3);
  });

  it("formatGroupCounts formats non-zero counts in fixed order and includes deliverables for team projects only", () => {
    const ko = getDictionary("ko");
    const en = getDictionary("en");
    const labels = (d: typeof ko) => ({
      image: d.studioLibrary.hub.kinds.image,
      video: d.studioLibrary.hub.kinds.video,
      sound: d.studioLibrary.hub.spine.kindSound,
      upload: d.studioLibrary.hub.spine.kindUploads,
      film: d.projectSpine.film,
      deliverables: d.studioLibrary.hub.spine.kindDeliverables,
    });

    expect(formatGroupCounts(emptyCounts(), "self", labels(ko))).toBe("");
    expect(
      formatGroupCounts(emptyCounts({ image: 24, video: 6, sound: 2, upload: 3, film: 1 }), "self", labels(ko), 5),
    ).toBe("이미지 24 · 영상 6 · 사운드 2 · 올린 파일 3 · 편집본 1");
    expect(formatGroupCounts(emptyCounts({ image: 4, film: 1 }), "team", labels(ko), 5)).toBe(
      "이미지 4 · 편집본 1 · 납품본 5",
    );
    expect(formatGroupCounts(emptyCounts({ image: 4, sound: 2 }), "team", labels(en), 3)).toBe(
      "Images 4 · Sound 2 · Deliverables 3",
    );
  });

  it("filterOverviewProjects filters by trimmed case-insensitive title substring", () => {
    const groups = [projectGroup(P1, "봄 향수 론칭"), projectGroup(P2, "Denim Lookbook 26SS")];
    expect(filterOverviewProjects(groups, "   ")).toHaveLength(2);
    expect(filterOverviewProjects(groups, "  denim ").map((g) => g.project.id)).toEqual([P2]);
    expect(filterOverviewProjects(groups, "향수").map((g) => g.project.id)).toEqual([P1]);
    expect(filterOverviewProjects(groups, "없는")).toEqual([]);
  });

  it("deliverableCountsByProject counts deliverables per projectId", () => {
    const counts = deliverableCountsByProject([
      { projectId: P1 },
      { projectId: P2 },
      { projectId: P1 },
    ]);
    expect(counts.get(P1)).toBe(2);
    expect(counts.get(P2)).toBe(1);
    expect(counts.get(id(0x99))).toBeUndefined();
  });

  it("scopeMarker formats deterministic data-asset-hub-scope values", () => {
    expect(scopeMarker({ kind: "project", brandProjectId: P1 })).toBe(`project:${P1}`);
    expect(scopeMarker({ kind: "unfiled" })).toBe("unfiled");
    expect(scopeMarker({ kind: "brand_materials" })).toBe("brand_materials");
  });

  it("buildKindChips lists exact six kinds in order and hides zero-count options", () => {
    const ko = getDictionary("ko");
    const labels = {
      all: ko.studioLibrary.hub.spine.kindAll,
      image: ko.studioLibrary.hub.kinds.image,
      video: ko.studioLibrary.hub.kinds.video,
      sound: ko.studioLibrary.hub.spine.kindSound,
      upload: ko.studioLibrary.hub.spine.kindUploads,
      film: ko.projectSpine.film,
    };

    expect(buildKindChips(emptyCounts(), labels)).toEqual([]);
    expect(
      buildKindChips(emptyCounts({ image: 3, sound: 1, film: 2 }), labels).map((c) => c.id),
    ).toEqual(["all", "image", "sound", "film"]);
    // Active filter stays visible even if its count dropped to 0.
    expect(buildKindChips(emptyCounts({ image: 2 }), labels, "sound").map((c) => c.id)).toEqual([
      "all",
      "image",
      "sound",
    ]);
  });

  it("buildRoleChips lists exact roles after roleAll and hides zero-count roles", () => {
    const ko = getDictionary("ko");
    const labels = {
      all: ko.studioLibrary.hub.roleAll,
      ...ko.studioLibrary.roles,
    };
    const zeroRoles: Record<BrandMaterialRole, number> = {
      logo: 0,
      product: 0,
      person: 0,
      style: 0,
      place: 0,
    };

    expect(buildRoleChips(zeroRoles, labels)).toEqual([]);
    expect(
      buildRoleChips({ ...zeroRoles, logo: 2, place: 1, product: 3 }, labels).map((c) => c.id),
    ).toEqual(["all", "logo", "product", "place"]);
    expect(buildRoleChips({ ...zeroRoles, logo: 1 }, labels, "style").map((c) => c.id)).toEqual([
      "all",
      "logo",
      "style",
    ]);
  });

  it("scopeEmptyMessage chooses filter/search noMatch first, then scope-specific empty copy", () => {
    const ko = getDictionary("ko");
    const sp = ko.studioLibrary.hub.spine;
    const noMatch = ko.studioLibrary.uploads.noMatch;

    expect(scopeEmptyMessage({ kind: "project", brandProjectId: P1 }, sp, true, noMatch)).toBe(noMatch);
    expect(scopeEmptyMessage({ kind: "project", brandProjectId: P1 }, sp, false, noMatch)).toBe(sp.groupEmpty);
    expect(scopeEmptyMessage({ kind: "unfiled" }, sp, false, noMatch)).toBe(sp.unfiledEmpty);
    expect(scopeEmptyMessage({ kind: "brand_materials" }, sp, false, noMatch)).toBe(sp.materialsEmpty);
  });

  it("scopePageReducer handles first page, append without duplicates, failed read preservation, and not_found", () => {
    const filmOne: VideoProjectSummary = {
      id: id(0x601),
      organizationId: ORG,
      title: "Spring Cut",
      status: "active",
      aspect: "9:16",
      revision: 1,
      clipCount: 3,
      durationSec: 12,
      thumbUrl: null,
      completedAt: null,
      createdAt: "2026-11-25T10:00:00Z",
      updatedAt: "2026-11-25T10:00:00Z",
      brandProjectId: P1,
    };
    const page1: StudioBrandProjectFiles = {
      ok: true,
      items: [
        { type: "asset", id: asset(1).id },
        { type: "job", id: job(1).id },
      ],
      assets: [asset(1)],
      jobs: [job(1, { outputs: [output(1)] })],
      films: [],
      next: "cursor-2",
    };
    const page2: StudioBrandProjectFiles = {
      ok: true,
      items: [
        { type: "job", id: job(1).id }, // duplicate item must be ignored
        { type: "film", id: filmOne.id },
        { type: "asset", id: asset(2).id },
      ],
      assets: [asset(1), asset(2)],
      jobs: [job(1, { outputs: [output(1)] })],
      films: [filmOne],
      next: null,
    };

    const s0 = initialScopePageState();
    expect(s0.phase).toBe("loading");

    const s1 = scopePageReducer(s0, { type: "loaded", mode: "replace", page: page1 });
    expect(s1.phase).toBe("ready");
    expect(s1.next).toBe("cursor-2");
    expect(s1.items).toHaveLength(2);

    const sLoadingMore = scopePageReducer(s1, { type: "start_more" });
    expect(sLoadingMore.phase).toBe("loading_more");

    // Failed page-2 read preserves already-loaded items and next cursor so retry works.
    const sFailMore = scopePageReducer(sLoadingMore, { type: "failed", code: "failed" });
    expect(sFailMore.phase).toBe("failed");
    expect(sFailMore.items).toHaveLength(2);
    expect(sFailMore.next).toBe("cursor-2");

    const s2 = scopePageReducer(sLoadingMore, { type: "loaded", mode: "append", page: page2 });
    expect(s2.phase).toBe("ready");
    expect(s2.next).toBeNull();
    expect(s2.items.map((i: BrandProjectFileItem) => `${i.type}:${i.id}`)).toEqual([
      `asset:${asset(1).id}`,
      `job:${job(1).id}`,
      `film:${filmOne.id}`,
      `asset:${asset(2).id}`,
    ]);
    expect(s2.assets.map((a) => a.id)).toEqual([asset(1).id, asset(2).id]);
    expect(s2.jobs.map((j) => j.id)).toEqual([job(1).id]);
    expect(s2.films.map((f) => f.id)).toEqual([filmOne.id]);

    const sRestart = scopePageReducer(s2, { type: "restart" });
    expect(sRestart).toEqual(initialScopePageState());

    const sGone = scopePageReducer(s1, { type: "failed", code: "not_found" });
    expect(sGone.phase).toBe("not_found");
    expect(shouldCloseScopeOnFailure({ kind: "project", brandProjectId: P1 }, sGone.phase)).toBe(true);
    expect(shouldCloseScopeOnFailure({ kind: "unfiled" }, sGone.phase)).toBe(false);
    expect(shouldCloseScopeOnFailure({ kind: "brand_materials" }, sGone.phase)).toBe(false);
  });

  it("mergeScopeTiles preserves newest-first interleaved item order and applies query and role filtering", () => {
    const ko = getDictionary("ko");
    const filmOne: VideoProjectSummary = {
      id: id(0x602),
      organizationId: ORG,
      title: "봄 향수 편집본",
      status: "active",
      aspect: "16:9",
      revision: 1,
      clipCount: 4,
      durationSec: 18,
      thumbUrl: null,
      completedAt: null,
      createdAt: "2026-11-25T10:02:00Z",
      updatedAt: "2026-11-25T10:02:00Z",
      brandProjectId: P1,
    };
    const soundJob = job(10, {
      kind: "music",
      prompt: "Sparkling piano",
      outputs: [output(10, { kind: "audio", seconds: 30 })],
      createdAt: "2026-11-25T10:01:00Z",
    });
    const logoAsset = asset(20, { name: "Brand Mark", role: "logo", createdAt: "2026-11-25T10:00:00Z" });
    const prodAsset = asset(21, { name: "Perfume Bottle", role: "product", createdAt: "2026-11-25T09:59:00Z" });

    const pageState = scopePageReducer(initialScopePageState(), {
      type: "loaded",
      mode: "replace",
      page: {
        ok: true,
        items: [
          { type: "film", id: filmOne.id },
          { type: "job", id: soundJob.id },
          { type: "asset", id: logoAsset.id },
          { type: "asset", id: prodAsset.id },
        ],
        films: [filmOne],
        jobs: [soundJob],
        assets: [logoAsset, prodAsset],
        next: null,
      },
    });

    const allTiles = mergeScopeTiles(pageState, {
      sourceGeneratedLabel: ko.studioLibrary.hub.sourceGenerated,
      liked: new Set(),
      query: "",
      role: "all",
    });
    expect(allTiles.map((t) => `${t.kind}:${t.key}`)).toEqual([
      `film:f:${filmOne.id}`,
      `entry:o:${output(10).id}`,
      `entry:a:${logoAsset.id}`,
      `entry:a:${prodAsset.id}`,
    ]);

    const searched = mergeScopeTiles(pageState, {
      sourceGeneratedLabel: ko.studioLibrary.hub.sourceGenerated,
      liked: new Set(),
      query: "향수",
      role: "all",
    });
    expect(searched.map((t) => t.key)).toEqual([`f:${filmOne.id}`]);

    const logoOnly = mergeScopeTiles(pageState, {
      sourceGeneratedLabel: ko.studioLibrary.hub.sourceGenerated,
      liked: new Set(),
      query: "",
      role: "logo",
    });
    expect(logoOnly.map((t) => t.key)).toEqual([`a:${logoAsset.id}`]);
  });

  it("filmTileAspectRatio converts compose aspects to numeric tile CSS ratios", () => {
    expect(filmTileAspectRatio("9:16")).toBeCloseTo(9 / 16, 4);
    expect(filmTileAspectRatio("16:9")).toBeCloseTo(16 / 9, 4);
    expect(filmTileAspectRatio("4:5")).toBeCloseTo(0.8, 4);
    expect(filmTileAspectRatio("1:1")).toBe(1);
  });

  it("collectScopeMoveInput maps a mixed selection of runs, uploads, and films cleanly and enforces the 200-item limit (§5.5)", () => {
    const ko = getDictionary("ko");
    const j1 = job(1, { outputs: [output(1), output(2)] });
    const a1 = asset(10, { role: null, brandProjectId: null });
    const filmOne: VideoProjectSummary = {
      id: id(0x603),
      organizationId: ORG,
      title: "Teaser Film",
      status: "active",
      aspect: "9:16",
      revision: 1,
      clipCount: 2,
      durationSec: 10,
      thumbUrl: null,
      completedAt: null,
      createdAt: "2026-11-25T10:02:00Z",
      updatedAt: "2026-11-25T10:02:00Z",
      brandProjectId: P1,
    };

    const pageState = scopePageReducer(initialScopePageState(), {
      type: "loaded",
      mode: "replace",
      page: {
        ok: true,
        items: [
          { type: "job", id: j1.id },
          { type: "asset", id: a1.id },
          { type: "film", id: filmOne.id },
        ],
        jobs: [j1],
        assets: [a1],
        films: [filmOne],
        next: null,
      },
    });
    const tiles = mergeScopeTiles(pageState, {
      sourceGeneratedLabel: ko.studioLibrary.hub.sourceGenerated,
      liked: new Set(),
      query: "",
      role: "all",
    });

    // Selecting both outputs of j1 + upload + film deduplicates j1 once in jobIds.
    let sel = new Set<string>();
    sel = toggleScopeSelection(sel, tiles[0]!.key);
    sel = toggleScopeSelection(sel, tiles[1]!.key);
    sel = toggleScopeSelection(sel, tiles[2]!.key);
    sel = toggleScopeSelection(sel, tiles[3]!.key);

    const mixed = collectScopeMoveInput(tiles, sel);
    expect(mixed).toEqual({
      jobIds: [j1.id],
      assetIds: [a1.id],
      filmIds: [filmOne.id],
      selectedCount: 4,
      totalTargets: 3,
      overLimit: false,
    });

    // Toggling off removes cleanly.
    sel = toggleScopeSelection(sel, tiles[3]!.key);
    expect(collectScopeMoveInput(tiles, sel).filmIds).toEqual([]);

    // 201 distinct targets flags overLimit.
    const manyAssets = Array.from({ length: 201 }, (_, i) => asset(i + 100));
    const manyState = scopePageReducer(initialScopePageState(), {
      type: "loaded",
      mode: "replace",
      page: {
        ok: true,
        items: manyAssets.map((a) => ({ type: "asset" as const, id: a.id })),
        assets: manyAssets,
        jobs: [],
        films: [],
        next: null,
      },
    });
    const manyTiles = mergeScopeTiles(manyState, {
      sourceGeneratedLabel: ko.studioLibrary.hub.sourceGenerated,
      liked: new Set(),
      query: "",
      role: "all",
    });
    const over = collectScopeMoveInput(manyTiles, new Set(manyTiles.map((t) => t.key)));
    expect(over.totalTargets).toBe(201);
    expect(over.overLimit).toBe(true);
  });

  it("planSpineRefresh reloads studio state only for move/role and skips it for upload/delete where useStudio calls refreshSilently (Fix 4-7, Fix 5-2)", () => {
    for (const kind of ["move", "role"] as const) {
      expect(planSpineRefresh(kind, true)).toEqual({
        reloadOverview: true,
        reloadStudioState: true,
        restartOpenScope: true,
      });
      expect(planSpineRefresh(kind, false)).toEqual({
        reloadOverview: true,
        reloadStudioState: true,
        restartOpenScope: false,
      });
    }
    // `studio.deleteAsset` and `studio.upload` both call `refreshSilently()` to reload studio state once.
    for (const kind of ["upload", "delete"] as const) {
      expect(planSpineRefresh(kind, true)).toEqual({
        reloadOverview: true,
        reloadStudioState: false,
        restartOpenScope: true,
      });
      expect(planSpineRefresh(kind, false)).toEqual({
        reloadOverview: true,
        reloadStudioState: false,
        restartOpenScope: false,
      });
    }
  });

  it("buildAllViewOptions returns sections in §5.7 order using only sections present in today's hub", () => {
    const ko = getDictionary("ko").studioLibrary.hub;
    expect(
      buildAllViewOptions(
        {
          all: ko.spine.viewAll,
          uploads: ko.spine.viewUploaded,
          generated: ko.spine.viewMade,
          liked: ko.sections.liked,
          folders: ko.sections.folders,
          deliverables: ko.sections.deliverables,
        },
        ["projects", "all", "uploads", "generated", "folders", "liked", "deliverables"],
      ).map((o) => o.id),
    ).toEqual(["all", "uploads", "generated", "liked", "folders", "deliverables"]);

    expect(
      buildAllViewOptions(
        {
          all: ko.spine.viewAll,
          uploads: ko.spine.viewUploaded,
          generated: ko.spine.viewMade,
          liked: ko.sections.liked,
          folders: ko.sections.folders,
          deliverables: ko.sections.deliverables,
        },
        ["all", "uploads", "generated", "folders", "liked"],
      ).map((o) => o.id),
    ).toEqual(["all", "uploads", "generated", "liked", "folders"]);
  });

  it("filterTeamDeliverables filters deliverables for one team project with trimmed substring query", () => {
    const list = [
      { id: "d1", projectId: P1, projectTitle: "Winter", title: "Final Hero Cut", kind: "video" as const, url: "u1", createdAt: "" },
      { id: "d2", projectId: P2, projectTitle: "Other", title: "Banner", kind: "image" as const, url: "u2", createdAt: "" },
    ];
    expect(filterTeamDeliverables(list, P1, "").map((d) => d.id)).toEqual(["d1"]);
    expect(filterTeamDeliverables(list, P1, "hero").map((d) => d.id)).toEqual(["d1"]);
    expect(filterTeamDeliverables(list, P1, "banner")).toEqual([]);
  });

  it("brandMaterialsCountsWithLogo adds +1 to total and logo role, drives buildSpineTabs and initialSpineTab when orgLogo is present (Batch D)", () => {
    const ko = getDictionary("ko");
    const spine = ko.studioLibrary.hub.spine;
    const base = {
      count: 2,
      byRole: { logo: 0, product: 2, person: 0, style: 0, place: 0 },
      covers: [],
    };
    expect(brandMaterialsCountsWithLogo(base, false)).toEqual(base);
    expect(brandMaterialsCountsWithLogo(base, true)).toEqual({
      count: 3,
      byRole: { logo: 1, product: 2, person: 0, style: 0, place: 0 },
      covers: [],
    });

    const emptyOverview = makeOverview();
    expect(initialSpineTab(emptyOverview, false)).toBe("all");
    expect(initialSpineTab(emptyOverview, true)).toBe("by_project");

    expect(
      buildSpineTabs(
        makeOverview({ brandMaterials: base }),
        {
          byProject: spine.tabByProject,
          brandMaterials: spine.tabMaterials,
          unfiled: ko.projectSpine.unfiled,
          all: spine.tabAll,
        },
        true,
      ).find((t) => t.id === "brand_materials")?.count,
    ).toBe(3);
  });

  it("every exported function in model.ts is imported and called by at least one component in asset-hub-spine (§6)", () => {
    const dir = join(process.cwd(), "components", "brand-studio", "asset-hub-spine");
    const modelSrc = readFileSync(join(dir, "model.ts"), "utf8");
    const exportedFns = [...modelSrc.matchAll(/^export function (\w+)\s*\(/gm)].map((m) => m[1]!);
    expect(exportedFns.length).toBeGreaterThan(0);

    const componentSrc = readdirSync(dir)
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");

    for (const fn of exportedFns) {
      expect(componentSrc, `exported helper '${fn}' must be called by a component`).toMatch(new RegExp(`\\b${fn}\\b`));
    }
  });

  it("shouldReadScopeFirstPage re-reads only on mount, scopeId change, kind change, or refreshNonce change (Fix 2-1)", () => {
    expect(shouldReadScopeFirstPage(null, { scopeId: "brand_materials", kind: "all", refreshNonce: 0 })).toBe(true);
    const cursor = { scopeId: "brand_materials", kind: "all" as const, refreshNonce: 0 };
    expect(shouldReadScopeFirstPage(cursor, { scopeId: "brand_materials", kind: "all", refreshNonce: 0 })).toBe(false);
    expect(shouldReadScopeFirstPage(cursor, { scopeId: "unfiled", kind: "all", refreshNonce: 0 })).toBe(true);
    expect(shouldReadScopeFirstPage(cursor, { scopeId: "brand_materials", kind: "image", refreshNonce: 0 })).toBe(true);
    expect(shouldReadScopeFirstPage(cursor, { scopeId: "brand_materials", kind: "all", refreshNonce: 1 })).toBe(true);
  });

  it("resolveHubEntry returns null for deleted keys when spine is off and falls back to stored when spine is on (Fix 2-2, Fix 2-5)", () => {
    const a1 = asset(1, { name: "One" });
    const a1Edited = asset(1, { name: "One Edited", role: "logo" });
    const a2 = asset(2, { name: "Two" });
    const [e1] = buildHubEntries([a1], [], "Made");
    const [e1Edited] = buildHubEntries([a1Edited], [], "Made");
    const [e2] = buildHubEntries([a2], [], "Made");

    expect(resolveHubEntry([e1!], e2!.key, e2!, false)).toBeNull();
    expect(resolveHubEntry([e1Edited!], e1!.key, e1!, false)).toEqual(e1Edited);
    expect(resolveHubEntry([e1!], e2!.key, e2!, true)).toEqual(e2);
    expect(resolveHubEntry([e1!], null, e1!, true)).toBeNull();

    expect(entryMatchesAsset(e1!, a1.id)).toBe(true);
    expect(entryMatchesAsset(e1!, a2.id)).toBe(false);
    expect(entryMatchesAsset(null, a1.id)).toBe(false);

    const hubSrc = readFileSync(join(process.cwd(), "components", "brand-studio", "asset-hub.tsx"), "utf8");
    expect(hubSrc).toContain("resolveHubEntry(");
    expect(hubSrc).toContain("entryMatchesAsset(");
    expect(hubSrc).toContain('triggerSpineMutation("upload")');
    expect(hubSrc).toContain('triggerSpineMutation("delete")');
    expect(hubSrc).toContain('triggerSpineMutation("role")');
    const spineIndexSrc = readFileSync(join(process.cwd(), "components", "brand-studio", "asset-hub-spine", "index.tsx"), "utf8");
    expect(spineIndexSrc).toContain('runRefreshPlan("move")');
  });

  it("singleEntryMoveInput prepares project.move inputs for a single run or upload with current scope (Fix 2-10)", () => {
    const a = asset(10);
    const j = job(20, { outputs: [output(20)] });
    const entries = buildHubEntries([a], [j], "Made");
    const uploadEntry = entries.find((e) => e.asset?.id === a.id);
    const jobEntry = entries.find((e) => e.jobId === j.id);

    expect(singleEntryMoveInput(uploadEntry!, P1)).toEqual({
      jobIds: [],
      assetIds: [a.id],
      currentScope: { kind: "project", id: P1 },
    });
    expect(singleEntryMoveInput(jobEntry!, null)).toEqual({
      jobIds: [j.id],
      assetIds: [],
      currentScope: { kind: "unfiled" },
    });

    // Unknown filing (absent brandProjectId -> undefined) passes { kind: "unknown" }, never unfiled (Fix 4-10).
    expect(singleEntryMoveInput(jobEntry!, undefined)).toEqual({
      jobIds: [j.id],
      assetIds: [],
      currentScope: { kind: "unknown" },
    });

    const brandMaterial = asset(11, { role: "logo", brandProjectId: null });
    const [materialEntry] = buildHubEntries([brandMaterial], [], "Made");
    expect(singleEntryMoveInput(materialEntry!, null)).toEqual({
      jobIds: [],
      assetIds: [brandMaterial.id],
      currentScope: { kind: "brand_materials" },
    });
  });

  it("freezeScopeMoveSnapshot isolates confirmed multi-page selection against later tile/filter restarts (Fix 3-2)", () => {
    const sixtyAssets = Array.from({ length: 60 }, (_, i) => asset(i + 1));
    const page1And2Tiles: ScopeTile[] = buildHubEntries(sixtyAssets, [], "Made").map((entry) => ({
      kind: "entry" as const,
      key: entry.key,
      entry,
    }));
    const selected60 = new Set(page1And2Tiles.map((t) => t.key));
    const liveAtConfirm = collectScopeMoveInput(page1And2Tiles, selected60);
    const confirmed = freezeScopeMoveSnapshot(liveAtConfirm);

    // Later page restart to 20 page-1 tiles or mutation of live array must NEVER alter the snapshot.
    liveAtConfirm.assetIds.length = 0;
    const afterPage1Restart = collectScopeMoveInput(page1And2Tiles.slice(0, 20), selected60);
    expect(afterPage1Restart.assetIds).toHaveLength(20);
    expect(confirmed.assetIds).toHaveLength(60);
    expect(confirmed.selectedCount).toBe(60);
    expect(Object.isFrozen(confirmed)).toBe(true);
    expect(Object.isFrozen(confirmed.assetIds)).toBe(true);

    const scopeViewSrc = readFileSync(
      join(process.cwd(), "components", "brand-studio", "asset-hub-spine", "scope-view.tsx"),
      "utf8",
    );
    expect(scopeViewSrc).toContain("freezeScopeMoveSnapshot(");
    expect(scopeViewSrc).not.toContain("projects={overview.projects.map(");
  });

  it("requestOverviewReload and settleOverviewReload coalesce concurrent reads to at most one follow-up without looping (Fix 3-3)", () => {
    // 1. Idle + request -> starts read immediately.
    const step1 = requestOverviewReload({ inFlight: false, queued: false });
    expect(step1).toEqual({ next: { inFlight: true, queued: false }, startRead: true });

    // 2. In flight + request -> queued, no extra read yet.
    const step2 = requestOverviewReload(step1.next);
    expect(step2).toEqual({ next: { inFlight: true, queued: true }, startRead: false });

    // 3. Another request while already queued stays at one queued read.
    const step3 = requestOverviewReload(step2.next);
    expect(step3).toEqual({ next: { inFlight: true, queued: true }, startRead: false });

    // 4. First settles while queued -> runs exactly one follow-up read, clearing queued.
    const step4 = settleOverviewReload(step3.next);
    expect(step4).toEqual({ next: { inFlight: true, queued: false }, startRead: true });

    // 5. Follow-up settles without queued -> returns idle with no further reads.
    const step5 = settleOverviewReload(step4.next);
    expect(step5).toEqual({ next: { inFlight: false, queued: false }, startRead: false });
  });

  it("counts visible search subset only in collectScopeMoveInput and clears selection on filter/restart in ScopeView (Fix 3-5)", () => {
    const a1 = asset(1, { name: "Bottle alpha", role: "product", brandProjectId: null });
    const a2 = asset(2, { name: "Model beta", role: "person", brandProjectId: null });
    const visibleAfterSearch = mergeScopeTiles(
      { items: [{ type: "asset", id: a1.id }, { type: "asset", id: a2.id }], jobs: [], assets: [a1, a2], films: [] },
      { sourceGeneratedLabel: "Made", liked: new Set(), query: "Bottle", role: "all" },
    );
    const selectedBoth = new Set([`a:${a1.id}`, `a:${a2.id}`]);
    const filteredMove = collectScopeMoveInput(visibleAfterSearch, selectedBoth);
    expect(filteredMove.selectedCount).toBe(1);
    expect(filteredMove.assetIds).toEqual([a1.id]);

    const scopeViewSrc = readFileSync(
      join(process.cwd(), "components", "brand-studio", "asset-hub-spine", "scope-view.tsx"),
      "utf8",
    );
    expect(scopeViewSrc).toMatch(/fetchFirstPage[\s\S]*?setSelectedKeys\(new Set\(\)\)/);
    expect(scopeViewSrc).toMatch(/changeKindFilter[\s\S]*?setSelectedKeys\(new Set\(\)\)/);
    expect(scopeViewSrc).toMatch(/changeRoleFilter[\s\S]*?setSelectedKeys\(new Set\(\)\)/);
    expect(scopeViewSrc).toContain('scope.kind === "brand_materials"');
  });

  // Note: this simulates the component refresh wiring inside the test; it proves the pure model functions
  // (`planSpineRefresh`, `shouldReadScopeFirstPage`, `requestOverviewReload`, `settleOverviewReload`), not live hook wiring (Fix 4-10, Fix 5-2).
  it("refresh plan + shouldReadScopeFirstPage + overview reload perform expected reads per move, upload, delete, and role on unfiled or brand_materials (Fix 3-7, Fix 4-7, Fix 5-2)", () => {
    for (const scopeId of ["unfiled", "brand_materials"] as const) {
      for (const trigger of ["move", "upload", "delete", "role"] as const) {
        let firstPageReads = 0;
        let overviewReads = 0;
        let planStudioReads = 0;
        let cursor: { scopeId: string; kind: "all"; refreshNonce: number } | null = null;
        let reloadState = IDLE_OVERVIEW_RELOAD;
        let nonce = 0;

        const renderCycle = (newNonce: number) => {
          const next = { scopeId, kind: "all" as const, refreshNonce: newNonce };
          if (shouldReadScopeFirstPage(cursor, next)) {
            cursor = next;
            firstPageReads += 1;
          }
        };

        renderCycle(nonce);
        renderCycle(nonce);
        renderCycle(nonce);
        expect(firstPageReads).toBe(1);

        firstPageReads = 0;
        const plan = planSpineRefresh(trigger, true);
        if (plan.reloadOverview) {
          const req = requestOverviewReload(reloadState);
          reloadState = req.next;
          if (req.startRead) overviewReads += 1;
        }
        if (plan.reloadStudioState) planStudioReads += 1;
        if (plan.restartOpenScope) nonce += 1;

        renderCycle(nonce);
        renderCycle(nonce);
        expect({ firstPageReads, overviewReads, planStudioReads }).toEqual({
          firstPageReads: 1,
          overviewReads: 1,
          planStudioReads: trigger === "delete" || trigger === "upload" ? 0 : 1,
        });

        const settled = settleOverviewReload(reloadState);
        expect(settled.startRead).toBe(false);
      }
    }
  });

  it("fallbackCovers selects newest image uploads of one project only (never other project, missing key, or video) (Fix 4-4)", () => {
    const missingKey = asset(1, { kind: "image", createdAt: "2026-11-26T01:00:00Z" });
    delete (missingKey as { brandProjectId?: string | null }).brandProjectId;
    const unfiledImg = asset(2, { kind: "image", brandProjectId: null, createdAt: "2026-11-26T02:00:00Z" });
    const otherProjImg = asset(3, { kind: "image", brandProjectId: P2, createdAt: "2026-11-26T03:00:00Z" });
    const p1Video = asset(4, { kind: "video", brandProjectId: P1, createdAt: "2026-11-26T04:00:00Z" });
    const p1Older = asset(5, { kind: "image", brandProjectId: P1, createdAt: "2026-11-26T01:00:00Z" });
    const p1Newest = asset(6, { kind: "image", brandProjectId: P1, createdAt: "2026-11-26T05:00:00Z" });
    const extras = Array.from({ length: 6 }, (_, i) =>
      asset(20 + i, { kind: "image", brandProjectId: P1, createdAt: `2026-11-25T0${i}:00:00Z` }),
    );

    const selected = fallbackCovers([missingKey, unfiledImg, otherProjImg, p1Video, p1Older, p1Newest, ...extras], P1, 6);
    expect(selected).toHaveLength(6);
    expect(selected[0]!.id).toBe(p1Newest.id);
    expect(selected[1]!.id).toBe(p1Older.id);
    expect(selected.every((a) => a.brandProjectId === P1 && a.kind === "image")).toBe(true);
    expect(selected.map((a) => a.id)).not.toContain(p1Video.id);
    expect(selected.map((a) => a.id)).not.toContain(otherProjImg.id);
    expect(selected.map((a) => a.id)).not.toContain(missingKey.id);
    expect(selected.map((a) => a.id)).not.toContain(unfiledImg.id);
  });

  it("singleMoveReturnSelectors targets the tile menu button and falls back to open, and freezes module constants (Fix 4-5, Fix 4-10)", () => {
    expect(singleMoveReturnSelectors("a:123")).toEqual({
      menu: '[data-asset-hub-card="a:123"] [aria-haspopup="menu"]',
      open: '[data-asset-hub-card="a:123"] [data-asset-hub-open]',
    });
    expect(Object.isFrozen(IDLE_OVERVIEW_RELOAD)).toBe(true);

    const indexSrc = readFileSync(join(process.cwd(), "components", "brand-studio", "asset-hub-spine", "index.tsx"), "utf8");
    expect(indexSrc).toContain("Object.freeze({ kind: \"brand_materials\" })");
    expect(indexSrc).toContain("Object.freeze({ kind: \"unfiled\" })");
    expect(indexSrc).toContain("returnFocus=");
  });
});
