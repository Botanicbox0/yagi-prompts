import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { StudioBrandProject } from "@/lib/brand-studio/contracts";
import type { StudioSpineProps } from "@/lib/brand-studio/open-project";
import { resolveOpenForFilm } from "@/lib/brand-studio/open-project";
import type { VideoProjectDetail, VideoProjectSummary } from "@/lib/brand-studio/video-projects";
import { emptyComposerProject } from "@/lib/brand-studio/compose";
import { BrandAssetHub, assetHubProjectHref } from "@/components/brand-studio/asset-hub";
import { videoProjectHref } from "@/components/brand-studio/sound/send-dialog";
import { VideoProjectBar, VideoProjectMenu, filmBarCopy } from "@/components/brand-studio/video/project-bar";
import { sequencePostProdInput } from "@/components/brand-studio/video/sequence-rail";
import {
  VideoStudioWorkspace,
  filmsInOpenScope,
  syncVideoFilmUrlParam,
  videoFilmCreateBody,
} from "@/components/brand-studio/video/workspace";
import type { StudioLibrary } from "@/components/brand-studio/seams";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { SqlRunner } from "@/lib/db/sql-runner";
import { ORG, asset, id, job, output, studioState } from "../ui/fixtures";

const P1 = id(0x71);
const P2 = id(0x72);
const FILM1 = id(0x81);
const FILM2 = id(0x82);
const FILM_UNFILED = id(0x83);
const GONE = id(0x99);

const sampleProject = (pid: string, title = "봄 향수 론칭"): StudioBrandProject => ({
  id: pid,
  title,
  origin: "self",
  lastActivityAt: "2026-11-25T10:00:00.000Z",
});

const sampleFilm = (fid: string, title: string, brandProjectId?: string | null): VideoProjectSummary => ({
  id: fid,
  organizationId: ORG,
  title,
  status: "active",
  aspect: "9:16",
  revision: 1,
  clipCount: 2,
  durationSec: 8,
  thumbUrl: null,
  completedAt: null,
  createdAt: "2026-11-25T09:00:00.000Z",
  updatedAt: "2026-11-25T10:00:00.000Z",
  ...(brandProjectId !== undefined ? { brandProjectId } : {}),
});

const sampleFilmDetail = (fid: string, title: string, brandProjectId?: string | null): VideoProjectDetail => ({
  ...sampleFilm(fid, title, brandProjectId),
  timeline: emptyComposerProject("9:16"),
});

const pageStub = vi.hoisted(() => ({
  locale: "ko" as "ko" | "en",
  role: "owner" as "owner" | "editor" | "viewer" | "studio",
  staff: false,
  spine: null as StudioSpineProps | null,
  films: [] as VideoProjectSummary[],
  filmDetail: null as VideoProjectDetail | null,
  extraFilmsById: {} as Record<string, VideoProjectDetail>,
  throwFilmList: false,
  loadedScope: null as unknown,
  studioStateValue: null as ReturnType<typeof studioState> | null,
  loadVideoProjectsCalls: 0,
  loadStudioStateCalls: 0,
  beyondCutProjectsById: {} as Record<string, { id: string; title: string; origin: "self" | "team"; lastActivityAt: string }>,
  includeFilmProjectCalls: 0,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/brand/studio/video",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/components/brand-studio/route-context", async () => {
  const { getDictionary: getDict } = await import("@/lib/i18n/dictionaries");
  return {
    studioRouteOrShowroom: vi.fn(async () => ({
      kind: "studio" as const,
      choice: { id: ORG, name: "Fixture brand", role: pageStub.role, logoUrl: null },
      access: {
        hasOrganization: true,
        isOwner: pageStub.role === "owner",
        staff: pageStub.staff,
        fresh: false,
        projectScopedOnly: false,
        canRequest: !pageStub.staff && (pageStub.role === "owner" || pageStub.role === "editor"),
      },
      locale: pageStub.locale,
      dict: getDict(pageStub.locale),
      deps: { sql: { query: async () => ({ rows: [] }) } as unknown as SqlRunner },
      viewer: {
        userId: "00000000-0000-4000-8000-000000000001",
        tier: "free" as const,
        isAdmin: false,
        email: "member@example.com",
        locale: pageStub.locale,
      },
    })),
  };
});

vi.mock("@/components/brand-studio/video/contracts-link", () => ({
  hasProductionContracts: vi.fn(async () => false),
}));

vi.mock("@/lib/brand-studio/open-project-server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/brand-studio/open-project-server")>(
    "@/lib/brand-studio/open-project-server",
  );
  return {
    ...actual,
    loadStudioSpine: vi.fn(async (input: Parameters<typeof actual.loadStudioSpine>[0]) => {
      if (pageStub.spine === null) return actual.loadStudioSpine(input);
      if (input.seat.staff === true || input.seat.role === "guest") return null;
      return pageStub.spine;
    }),
    includeSelectableProjectForFilm: vi.fn(async (input: Parameters<typeof actual.includeSelectableProjectForFilm>[0]) => {
      pageStub.includeFilmProjectCalls += 1;
      if (input.spine.projects.length < 100) return input.spine;
      const pid = input.projectId?.trim().toLowerCase();
      if (!pid || input.spine.projects.some((p) => p.id.toLowerCase() === pid)) return input.spine;
      const extra = pageStub.beyondCutProjectsById[pid] ?? null;
      return extra ? { ...input.spine, projects: [extra, ...input.spine.projects] } : input.spine;
    }),
  };
});

vi.mock("@/lib/brand-studio/video-projects", async () => {
  const actual = await vi.importActual<typeof import("@/lib/brand-studio/video-projects")>(
    "@/lib/brand-studio/video-projects",
  );
  return {
    ...actual,
    loadVideoProjects: vi.fn(async (_deps: unknown, _viewer: unknown, _org: string, filmId?: string | null) => {
      pageStub.loadVideoProjectsCalls += 1;
      if (pageStub.throwFilmList) throw new Error("db_down");
      if (filmId) {
        const found =
          pageStub.filmDetail?.id === filmId
            ? pageStub.filmDetail
            : pageStub.extraFilmsById[filmId] ??
              (pageStub.films.find((f) => f.id === filmId)
                ? { ...pageStub.films.find((f) => f.id === filmId)!, timeline: emptyComposerProject("9:16") }
                : null);
        if (!found) return { ok: false as const, code: "not_found" as const };
        return {
          ok: true as const,
          projects: pageStub.films,
          project: found,
          canCreate: !pageStub.staff && (pageStub.role === "owner" || pageStub.role === "editor"),
        };
      }
      return {
        ok: true as const,
        projects: pageStub.films,
        project: null,
        canCreate: !pageStub.staff && (pageStub.role === "owner" || pageStub.role === "editor"),
      };
    }),
  };
});

vi.mock("@/lib/brand-studio/runtime", () => ({
  studioRuntimeDeps: vi.fn(async (sql: SqlRunner) => ({ sql })),
}));

vi.mock("@/lib/brand-studio/service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/brand-studio/service")>("@/lib/brand-studio/service");
  return {
    ...actual,
    loadStudioState: vi.fn(async (_deps: unknown, _viewer: unknown, _org: string, opts?: { scope?: unknown }) => {
      pageStub.loadStudioStateCalls += 1;
      pageStub.loadedScope = opts?.scope ?? null;
      return pageStub.studioStateValue ?? studioState();
    }),
  };
});

import StudioVideoPage from "@/app/(brand)/brand/studio/video/page";

const stubLibrary: StudioLibrary = {
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
};

beforeEach(() => {
  pageStub.locale = "ko";
  pageStub.role = "owner";
  pageStub.staff = false;
  pageStub.spine = null;
  pageStub.films = [];
  pageStub.filmDetail = null;
  pageStub.extraFilmsById = {};
  pageStub.throwFilmList = false;
  pageStub.loadedScope = null;
  pageStub.studioStateValue = null;
  pageStub.loadVideoProjectsCalls = 0;
  pageStub.loadStudioStateCalls = 0;
  pageStub.beyondCutProjectsById = {};
  pageStub.includeFilmProjectCalls = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Batch B pure rules: film noun, scope filter, film-wins, URL params, create payloads", () => {
  it.each(["ko", "en"] as const)("replaces every '프로젝트'/'project' string in VideoProjectBar with '편집본'/'edit' (%s)", (locale) => {
    const dict = getDictionary(locale);
    const original = dict.studioVideo.workspace.projects;
    const swapped = filmBarCopy(original, dict.projectSpine);

    if (locale === "ko") {
      expect(swapped.myProjects).toBe("내 편집본");
      expect(swapped.newProject).toBe("+ 새 편집본");
      expect(swapped.untitled).toBe("새 편집본");
      expect(swapped.renameLabel).toBe("편집본 제목");
      expect(swapped.renamePlaceholder).toBe("편집본 제목 입력…");
      expect(swapped.completeProject).toBe("편집본 완료");
      expect(swapped.deleteProject).toBe("편집본 삭제");
      expect(swapped.sendToProject).toBe("기존 편집본으로 보내기");
      expect(swapped.sendToProjectPick).toBe("보낼 편집본 선택");
      expect(swapped.sentToProject).toBe("{title} 편집본에 클립을 담았어요.");
      expect(swapped.emptyList).toContain("편집본");
      expect(swapped.emptyList).not.toContain("프로젝트");
      expect(swapped.projectCompletedNotice).toBe("편집본을 완료 처리했어요.");
      // No string left in the bar copy still contains "프로젝트".
      for (const [key, val] of Object.entries(swapped)) {
        expect(val, key).not.toContain("프로젝트");
      }
    } else {
      expect(swapped.myProjects).toBe("My edits");
      expect(swapped.newProject).toBe("+ New edit");
      expect(swapped.untitled).toBe("New edit");
      expect(swapped.renameLabel).toBe("Edit title");
      expect(swapped.completeProject).toBe("Complete edit");
      expect(swapped.reopenProject).toBe("Reopen edit");
      expect(swapped.deleteProject).toBe("Delete edit");
      expect(swapped.sendToProject).toBe("Send to existing edit");
      expect(swapped.sendToProjectPick).toBe("Choose target edit");
      expect(swapped.emptyList).not.toMatch(/project/i);
      expect(swapped.projectCompletedNotice).toBe("Marked edit as completed.");
      for (const [key, val] of Object.entries(swapped)) {
        expect(val, key).not.toMatch(/\bprojects?\b/i);
      }
    }
    // Non-project strings stay untouched.
    expect(swapped.exportMp4).toBe(original.exportMp4);
    expect(swapped.shareReview).toBe(original.shareReview);
  });

  it("filters films to the open scope when spine is open, and returns all films unchanged when closed", () => {
    const films = [
      sampleFilm(FILM1, "Cut A", P1),
      sampleFilm(FILM2, "Cut B", P2),
      sampleFilm(FILM_UNFILED, "Loose cut", null),
    ];
    expect(filmsInOpenScope(films, undefined)).toEqual(films);
    expect(filmsInOpenScope(films, { kind: "project", id: P1 }).map((f) => f.id)).toEqual([FILM1]);
    expect(filmsInOpenScope(films, { kind: "project", id: P2 }).map((f) => f.id)).toEqual([FILM2]);
    expect(filmsInOpenScope(films, { kind: "unfiled" }).map((f) => f.id)).toEqual([FILM_UNFILED]);
  });

  it("switches open scope to the film's brandProjectId when opened by ?film= (the film wins)", () => {
    const base: StudioSpineProps = {
      projects: [sampleProject(P1, "One"), sampleProject(P2, "Two")],
      open: { kind: "project", id: P1 },
      canCreate: true,
      notice: "gone",
      noticeSource: "cookie",
    };
    // Film belongs to P2 -> switches open to P2, clears notice.
    expect(resolveOpenForFilm(base, { brandProjectId: P2 })).toEqual({
      ...base,
      open: { kind: "project", id: P2 },
      notice: null,
      noticeSource: null,
    });
    // Film is unfiled -> switches open to unfiled, clears notice.
    expect(resolveOpenForFilm(base, { brandProjectId: null })).toEqual({
      ...base,
      open: { kind: "unfiled" },
      notice: null,
      noticeSource: null,
    });
    // Film already matches open -> keeps spine unchanged.
    expect(resolveOpenForFilm(base, { brandProjectId: P1 })).toBe(base);
  });

  it("switches film URL parameter to ?film= when spine is active while keeping ?project= untouched", () => {
    // Flag off: writes/removes ?project=
    expect(
      syncVideoFilmUrlParam(`https://brand.twings.app/brand/studio/video?organizationId=${ORG}`, FILM1, false),
    ).toBe(`/brand/studio/video?organizationId=${ORG}&project=${FILM1}`);
    expect(
      syncVideoFilmUrlParam(`https://brand.twings.app/brand/studio/video?organizationId=${ORG}&project=${FILM1}`, null, false),
    ).toBe(`/brand/studio/video?organizationId=${ORG}`);

    // Flag on: writes/removes ?film= and preserves ?project=<brandProjectId>
    expect(
      syncVideoFilmUrlParam(
        `https://brand.twings.app/brand/studio/video?organizationId=${ORG}&project=${P1}`,
        FILM1,
        true,
      ),
    ).toBe(`/brand/studio/video?organizationId=${ORG}&project=${P1}&film=${FILM1}`);
    expect(
      syncVideoFilmUrlParam(
        `https://brand.twings.app/brand/studio/video?organizationId=${ORG}&project=${P1}&film=${FILM1}`,
        null,
        true,
      ),
    ).toBe(`/brand/studio/video?organizationId=${ORG}&project=${P1}`);
  });

  it("builds sound send-dialog and asset-hub links with ?project= when closed and ?film= when open", () => {
    const base = `/brand/studio/video?organizationId=${ORG}`;
    expect(videoProjectHref(base, FILM1)).toBe(`${base}&tab=edit&project=${FILM1}`);
    expect(videoProjectHref(base, FILM1, false)).toBe(`${base}&tab=edit&project=${FILM1}`);
    expect(videoProjectHref(base, FILM1, true)).toBe(`${base}&tab=edit&film=${FILM1}`);

    // Asset hub project link helper: `?project=` when closed, `?film=` when spine is open, team projects untouched.
    expect(assetHubProjectHref(ORG, { id: FILM1, origin: "self" }, true)).toBe(
      `/brand/studio/video?organizationId=${ORG}&project=${FILM1}`,
    );
    expect(assetHubProjectHref(ORG, { id: FILM1, origin: "self" }, true, false)).toBe(
      `/brand/studio/video?organizationId=${ORG}&project=${FILM1}`,
    );
    expect(assetHubProjectHref(ORG, { id: FILM1, origin: "self" }, true, true)).toBe(
      `/brand/studio/video?organizationId=${ORG}&film=${FILM1}`,
    );
    expect(assetHubProjectHref(ORG, { id: P1, origin: "team" }, true, true)).toBe(`/brand/projects/${P1}`);
    expect(assetHubProjectHref(ORG, { id: FILM1, origin: "self" }, false, true)).toBeNull();

    // BrandAssetHub renders identically without useFilmParam.
    const dict = getDictionary("ko");
    const a1 = asset(1, { name: "Bottle" });
    const state = studioState({ assets: [a1], jobs: [job(1, { outputs: [output(1)] })] });
    const projectLinks = {
      self: [{ id: FILM1, title: "Spring cut", updatedAt: "2026-11-25T10:00:00.000Z", assetIds: [a1.id], outputIds: [] }],
      team: [],
    };
    const closedHub = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        initialState={state}
        projectLinks={projectLinks}
        injectedLibrary={stubLibrary}
      />,
    );
    const defaultHub = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        initialState={state}
        projectLinks={projectLinks}
        useFilmParam={false}
        injectedLibrary={stubLibrary}
      />,
    );
    expect(closedHub).toBe(defaultHub);
  });

  it("includes brandProjectId on film create and sequence post-production only when a project is open", () => {
    const timeline = emptyComposerProject("9:16");
    const closedCreate = videoFilmCreateBody({
      organizationId: ORG,
      requestId: "vp_1",
      locale: "ko",
      timeline,
      brandProjectId: null,
    });
    expect("brandProjectId" in closedCreate).toBe(false);

    const openCreate = videoFilmCreateBody({
      organizationId: ORG,
      requestId: "vp_2",
      locale: "ko",
      timeline,
      brandProjectId: P1,
    });
    expect(openCreate.brandProjectId).toBe(P1);

    const ppBase = { organizationId: ORG, requestId: "sfx_1", text: "whoosh", durationSec: 4 };
    expect(sequencePostProdInput(ppBase, null)).toBe(ppBase);
    expect("brandProjectId" in sequencePostProdInput(ppBase, undefined)).toBe(false);
    expect(sequencePostProdInput(ppBase, P1)).toEqual({ ...ppBase, brandProjectId: P1 });
  });
});

describe("VideoStudioWorkspace & VideoProjectBar rendering parity", () => {
  it("renders exact flag-off markup without spine prop, and switches to 편집본 + scoped films with spine", () => {
    const dict = getDictionary("ko");
    const state = studioState({ jobs: [job(1, { kind: "video", outputs: [output(1, { kind: "video" })] })] });
    const films = [sampleFilm(FILM1, "Cut A", P1), sampleFilm(FILM2, "Cut B", P2)];

    const closed = renderToStaticMarkup(
      <VideoStudioWorkspace
        organizationId={ORG}
        locale="ko"
        copy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        videoCopy={dict.studioVideo}
        initialState={state}
      />,
    );
    expect(closed).toContain("data-video-project-bar");
    expect(closed).toContain(">내 프로젝트<");
    expect(closed).not.toContain("내 편집본");
    expect(closed).not.toContain("data-project-chip");

    const swappedCopy = filmBarCopy(dict.studioVideo.workspace.projects, dict.projectSpine);
    const scopedFilms = filmsInOpenScope(films, { kind: "project", id: P1 });
    const openBar = renderToStaticMarkup(
      <VideoProjectBar
        canEdit
        projectId={FILM1}
        projectTitle="Cut A"
        projectStatus="active"
        savingProject={false}
        projects={scopedFilms}
        clipCount={1}
        railHeight="compact"
        solidMp4Cta={false}
        exportingNle={false}
        exportingMp4Ratio={null}
        canSendClipToOtherProject={false}
        copy={swappedCopy}
        onSelectProject={() => {}}
        onStartNewProject={() => {}}
        onRenameTitle={() => {}}
        onToggleComplete={() => {}}
        onDeleteProject={() => {}}
        onSendClipToProject={() => {}}
        onSelectLayoutPreset={() => {}}
        onShareReview={() => {}}
        onExportNle={() => {}}
        onExportMp4={() => {}}
      />,
    );
    expect(openBar).toContain(">내 편집본<");
    expect(openBar).toContain(">편집본 완료<");

    const openMenu = renderToStaticMarkup(
      <VideoProjectMenu
        canEdit
        projectId={FILM1}
        projects={scopedFilms}
        copy={swappedCopy}
        onSelectProject={() => {}}
        onStartNewProject={() => {}}
        onDeleteProject={() => {}}
      />,
    );
    expect(openMenu).toContain(">+ 새 편집본<");
    expect(openMenu).toContain(">편집본 삭제<");
    expect(openMenu).toContain(`data-video-project-option="${FILM1}"`);
    expect(openMenu).not.toContain(`data-video-project-option="${FILM2}"`);
  });
});

describe("/brand/studio/video server page (§4.5)", () => {
  const renderVideoPage = async (query: Record<string, string> = {}) =>
    renderToStaticMarkup(
      await (StudioVideoPage({
        searchParams: Promise.resolve({ organizationId: ORG, ...query }),
      }) as Promise<ReactElement>),
    );

  it("preserves exact flag-off parity when BRAND_PROJECT_SPINE is off (no chip, no redirect on ?project=<film>)", async () => {
    vi.stubEnv("BRAND_PROJECT_SPINE", "off");
    const html = await renderVideoPage({ project: FILM1 });
    expect(html).toContain('<h1 class="bs-title">영상 스튜디오</h1>');
    expect(html).not.toContain("data-project-chip");
    expect(html).not.toContain("data-project-gone-notice");
    expect(html).toContain("data-studio-skeleton");
    expect(pageStub.loadVideoProjectsCalls).toBe(0);
    expect(pageStub.loadStudioStateCalls).toBe(0);
  });

  it("opens ?project=<brandProjectId> as the brand project and scopes wall + films", async () => {
    pageStub.spine = {
      projects: [sampleProject(P1, "봄 향수 론칭"), sampleProject(P2, "데님 룩북")],
      open: { kind: "project", id: P1 },
      canCreate: true,
      notice: null,
      noticeSource: null,
    };
    pageStub.films = [sampleFilm(FILM1, "P1 Cut", P1), sampleFilm(FILM2, "P2 Cut", P2)];
    pageStub.studioStateValue = studioState({
      jobs: [job(1, { kind: "video", brandProjectId: P1, outputs: [output(1, { kind: "video" })] })],
    });

    const html = await renderVideoPage({ project: P1 });
    expect(pageStub.loadedScope).toEqual({ kind: "project", brandProjectId: P1 });
    expect(html).toContain("data-project-chip");
    expect(html).toContain(`data-project-open="${P1}"`);
    expect(html).toContain("봄 향수 론칭");
    expect(html).toContain(">내 편집본<");
    expect(html).toContain(">1</span>");
    expect(html).not.toContain("data-project-gone-notice");
  });

  it("redirects legacy ?project=<filmId> to ?film=<filmId>, preserving every other query param in order", async () => {
    pageStub.spine = {
      projects: [sampleProject(P1, "봄 향수 론칭")],
      open: { kind: "unfiled" },
      canCreate: true,
      notice: "gone",
      noticeSource: "address",
    };
    pageStub.films = [sampleFilm(FILM1, "Legacy Film", P1)];

    await expect(
      renderVideoPage({ start: "reverse", project: FILM1, tab: "edit" }),
    ).rejects.toThrow(
      `NEXT_REDIRECT:/brand/studio/video?organizationId=${ORG}&start=reverse&film=${FILM1}&tab=edit`,
    );
  });

  it("falls back to 미분류 with gone notice when ?project=<unknown> is neither a project nor a film", async () => {
    pageStub.spine = {
      projects: [sampleProject(P1, "봄 향수 론칭")],
      open: { kind: "unfiled" },
      canCreate: true,
      notice: "gone",
      noticeSource: "address",
    };
    pageStub.films = [sampleFilm(FILM1, "Cut A", P1)];
    pageStub.studioStateValue = studioState();

    const html = await renderVideoPage({ project: GONE });
    expect(pageStub.loadedScope).toEqual({ kind: "unfiled" });
    expect(html).toContain('data-project-open="unfiled"');
    expect(html).toContain("data-project-gone-notice");
  });

  it("switches the open scope to the film's brandProjectId when opened via ?film= (the film wins)", async () => {
    // Remembered/resolved scope starts as P1, but ?film=FILM2 belongs to P2.
    pageStub.spine = {
      projects: [sampleProject(P1, "봄 향수 론칭"), sampleProject(P2, "데님 룩북")],
      open: { kind: "project", id: P1 },
      canCreate: true,
      notice: null,
      noticeSource: null,
    };
    pageStub.films = [sampleFilm(FILM1, "P1 Cut", P1), sampleFilm(FILM2, "P2 Cut", P2)];
    pageStub.filmDetail = sampleFilmDetail(FILM2, "P2 Cut", P2);
    pageStub.studioStateValue = studioState();

    const html = await renderVideoPage({ film: FILM2 });
    expect(pageStub.loadedScope).toEqual({ kind: "project", brandProjectId: P2 });
    expect(html).toContain(`data-project-open="${P2}"`);
    expect(html).toContain("데님 룩북");
    expect(html).toContain("P2 Cut");
  });

  it("never shows the chip or redirects for staff browsing another brand", async () => {
    pageStub.staff = true;
    pageStub.role = "studio";
    pageStub.spine = {
      projects: [sampleProject(P1)],
      open: { kind: "project", id: P1 },
      canCreate: true,
      notice: null,
      noticeSource: null,
    };
    pageStub.films = [sampleFilm(FILM1, "Cut A", P1)];

    const html = await renderVideoPage({ project: FILM1 });
    expect(html).not.toContain("data-project-chip");
    expect(html).toContain("data-studio-skeleton");
  });

  it("G1: recovers the film switcher list when ?film=<stale> answers not_found, and shows no gone notice when DB throws", async () => {
    pageStub.spine = {
      projects: [sampleProject(P1, "봄 향수 론칭")],
      open: { kind: "project", id: P1 },
      canCreate: true,
      notice: null,
      noticeSource: null,
    };
    pageStub.films = [sampleFilm(FILM1, "P1 Cut", P1)];
    pageStub.studioStateValue = studioState();

    // Stale ?film=<GONE> answers not_found on first call -> server retries list without filmId -> switcher keeps count 1.
    const html = await renderVideoPage({ film: GONE });
    expect(pageStub.loadVideoProjectsCalls).toBe(2);
    expect(html).toContain(">내 편집본<");
    expect(html).toContain(">1</span>");

    // DB throw on film list load -> no redirect, no gone notice.
    pageStub.throwFilmList = true;
    pageStub.spine = {
      projects: [sampleProject(P1, "봄 향수 론칭")],
      open: { kind: "unfiled" },
      canCreate: true,
      notice: "gone",
      noticeSource: "address",
    };
    const dbErrHtml = await renderVideoPage({ project: GONE });
    expect(dbErrHtml).not.toContain("data-project-gone-notice");
  });

  it("G2: redirects legacy ?project=<olderFilmId> beyond the first 100 via single-id lookup", async () => {
    const OLD_FILM = id(0x88);
    pageStub.spine = {
      projects: [sampleProject(P1, "봄 향수 론칭")],
      open: { kind: "unfiled" },
      canCreate: true,
      notice: "gone",
      noticeSource: "address",
    };
    pageStub.films = [sampleFilm(FILM1, "Recent Cut", P1)];
    pageStub.extraFilmsById = { [OLD_FILM]: sampleFilmDetail(OLD_FILM, "Older Cut #105", P1) };

    await expect(renderVideoPage({ project: OLD_FILM, tab: "edit" })).rejects.toThrow(
      `NEXT_REDIRECT:/brand/studio/video?organizationId=${ORG}&film=${OLD_FILM}&tab=edit`,
    );
  });

  it("opens a film's selectable beyond-100 project cleanly via ?film= (without ?project= or with non-matching ?project=)", async () => {
    const P105 = id(0x95);
    const P_DONE = id(0x96);
    const top100 = Array.from({ length: 100 }, (_, i) => sampleProject(id(0x100 + i), `Top ${i}`));
    pageStub.spine = {
      projects: top100,
      open: { kind: "project", id: top100[0]!.id },
      canCreate: true,
      notice: null,
      noticeSource: null,
    };
    pageStub.beyondCutProjectsById = { [P105]: sampleProject(P105, "Beyond Cut Campaign") };
    pageStub.films = [sampleFilm(FILM1, "Beyond Cut Film", P105)];
    pageStub.filmDetail = sampleFilmDetail(FILM1, "Beyond Cut Film", P105);
    pageStub.studioStateValue = studioState();

    const html = await renderVideoPage({ film: FILM1 });
    expect(pageStub.includeFilmProjectCalls).toBe(1);
    expect(pageStub.loadedScope).toEqual({ kind: "project", brandProjectId: P105 });
    expect(html).toContain(`data-project-open="${P105}"`);
    expect(html).toContain("Beyond Cut Campaign");

    // Non-matching ?project=<top0> alongside ?film= still opens the film's beyond-100 project
    const mismatchHtml = await renderVideoPage({ project: top100[0]!.id, film: FILM1 });
    expect(pageStub.loadedScope).toEqual({ kind: "project", brandProjectId: P105 });
    expect(mismatchHtml).toContain(`data-project-open="${P105}"`);

    // Finished beyond-100 project (not returned by beyondCutProjectsById / SELECTABLE_PROJECTS) stays unfiled
    pageStub.filmDetail = sampleFilmDetail(FILM2, "Archived Film", P_DONE);
    const archivedHtml = await renderVideoPage({ film: FILM2 });
    expect(pageStub.loadedScope).toEqual({ kind: "unfiled" });
    expect(archivedHtml).toContain('data-project-open="unfiled"');
  });
});
