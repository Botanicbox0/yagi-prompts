import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudioBrandProject, StudioJobCreate, StudioJobGroupCreate } from "@/lib/brand-studio/contracts";
import type { StudioSpineProps } from "@/lib/brand-studio/open-project";
import { createStudioApi } from "@/components/brand-studio/api";
import { ProjectChip, ProjectGoneNotice, ProjectSpineProvider } from "@/components/brand-studio/project-chip";
import { StudioApp } from "@/components/brand-studio/studio-app";
import { groupInputForBrandProject, jobInputForBrandProject } from "@/components/brand-studio/use-studio";
import { brandStudioV2 } from "@/components/brand-studio/v2-page";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { ORG, asset, id, job, output, studioState } from "../ui/fixtures";
import type { Viewer } from "@/lib/auth/identity";
import type { SqlRunner } from "@/lib/db/sql-runner";
import type { BrandWorkspaceChoice } from "@/lib/brands/workspace/selection";

const P1 = id(0x61);
const P2 = id(0x62);

const spineState = vi.hoisted(() => ({
  spine: null as StudioSpineProps | null,
  loadedScope: null as unknown,
  initialState: null as ReturnType<typeof studioState> | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/brand/studio",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/brand-studio/open-project-server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/brand-studio/open-project-server")>(
    "@/lib/brand-studio/open-project-server",
  );
  return {
    ...actual,
    loadStudioSpine: vi.fn(async (input: Parameters<typeof actual.loadStudioSpine>[0]) => {
      if (spineState.spine === null) return actual.loadStudioSpine(input);
      if (input.seat.staff === true || input.seat.role === "guest") return null;
      return spineState.spine;
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
      spineState.loadedScope = opts?.scope ?? null;
      return spineState.initialState ?? studioState();
    }),
  };
});

type Call = { url: string; init: RequestInit };
function mockFetch(answers: Array<{ status?: number; body?: unknown }>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = answers.shift() ?? { body: { ok: true } };
    return new Response(JSON.stringify(next.body ?? { ok: true }), {
      status: next.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

const sampleProject = (pid: string, title = "봄 향수 론칭"): StudioBrandProject => ({
  id: pid,
  title,
  origin: "self",
  lastActivityAt: "2026-11-25T10:00:00.000Z",
});

const imageJobInput: StudioJobCreate = {
  kind: "image",
  organizationId: ORG,
  requestId: "req_12345678",
  model: "seedream-5.5",
  prompt: "perfume bottle on ice",
  enhance: true,
  references: [],
  aspect: "4:5",
  resolution: "2K",
  count: 1,
};

const groupJobInput: StudioJobGroupCreate = {
  kind: "image",
  organizationId: ORG,
  requestId: "grp_12345678",
  prompt: "perfume bottle on ice",
  enhance: true,
  references: [],
  aspect: "4:5",
  resolution: "2K",
  count: 1,
  runs: [{ model: "seedream-5.5" }, { model: "nano-banana-pro" }],
};

afterEach(() => {
  spineState.spine = null;
  spineState.loadedScope = null;
  spineState.initialState = null;
  vi.unstubAllEnvs();
});

describe("wire contract: flag-off parity and flag-on brandProjectId / brandProject", () => {
  it("attaches brandProjectId only on fresh runs when a project is open, and omits it for unfiled or child runs", () => {
    // Flag off or 미분류: returns the exact same object without adding a brandProjectId key.
    expect(jobInputForBrandProject(imageJobInput, null)).toBe(imageJobInput);
    expect("brandProjectId" in jobInputForBrandProject(imageJobInput, null)).toBe(false);
    expect(groupInputForBrandProject(groupJobInput, null)).toBe(groupJobInput);
    expect("brandProjectId" in groupInputForBrandProject(groupJobInput, null)).toBe(false);

    // Open project: attaches brandProjectId without old projectId.
    const filedJob = jobInputForBrandProject(imageJobInput, P1);
    expect(filedJob).toEqual({ ...imageJobInput, brandProjectId: P1 });
    expect("projectId" in filedJob).toBe(false);

    const filedGroup = groupInputForBrandProject(groupJobInput, P1);
    expect(filedGroup).toEqual({ ...groupJobInput, brandProjectId: P1 });
    expect("projectId" in filedGroup).toBe(false);

    // Child runs (1080p final, revision) never carry brandProjectId (server inherits from parent).
    const finalJob: StudioJobCreate = {
      kind: "video_final",
      organizationId: ORG,
      requestId: "req_22345678",
      draftOutputId: output(1).id,
    };
    const reviseJob: StudioJobCreate = {
      kind: "video_revise",
      organizationId: ORG,
      requestId: "req_32345678",
      outputId: output(1).id,
      mode: "edit",
      prompt: "warmer light",
      references: [],
      marks: [],
      materials: [],
    };
    expect(jobInputForBrandProject(finalJob, P1)).toBe(finalJob);
    expect(jobInputForBrandProject(reviseJob, P1)).toBe(reviseJob);
  });

  it("sends GET /api/brand-studio without brandProject when omitted, and with &brandProject= when scoped", async () => {
    const { calls, fetch } = mockFetch([
      { body: studioState() },
      { body: studioState() },
      { body: studioState() },
    ]);
    const api = createStudioApi({ organizationId: ORG, fetch });

    await api.loadState();
    await api.loadState({ brandProject: P1 });
    await api.loadState({ brandProject: "unfiled" });

    expect(calls[0]!.url).toBe(`/api/brand-studio?organizationId=${encodeURIComponent(ORG)}`);
    expect(calls[1]!.url).toBe(`/api/brand-studio?organizationId=${encodeURIComponent(ORG)}&brandProject=${encodeURIComponent(P1)}`);
    expect(calls[2]!.url).toBe(`/api/brand-studio?organizationId=${encodeURIComponent(ORG)}&brandProject=unfiled`);
  });

  it("sends asset.reserve without brandProjectId when omitted, and with brandProjectId when a project is open", async () => {
    const file = Object.assign(new Blob(["img"], { type: "image/png" }), { name: "bottle.png" });
    const { calls, fetch } = mockFetch([
      { body: { ok: true, id: asset(1).id, direct: false } },
      { body: { ok: true } },
      { body: { ok: true, asset: asset(1) } },
      { body: { ok: true, id: asset(2).id, direct: false } },
      { body: { ok: true } },
      { body: { ok: true, asset: asset(2) } },
    ]);
    const api = createStudioApi({ organizationId: ORG, fetch });

    // Unfiled / flag off
    await api.upload(file, { requestId: "up_11111111" });
    const reserveOff = JSON.parse(String(calls[0]!.init.body)) as { operation: string; input: Record<string, unknown> };
    expect(reserveOff.operation).toBe("asset.reserve");
    expect("brandProjectId" in reserveOff.input).toBe(false);

    // Open project
    await api.upload(file, { requestId: "up_22222222", brandProjectId: P1 });
    const reserveOn = JSON.parse(String(calls[3]!.init.body)) as { operation: string; input: Record<string, unknown> };
    expect(reserveOn.operation).toBe("asset.reserve");
    expect(reserveOn.input.brandProjectId).toBe(P1);
  });

  it("calls project.create and project.move through POST /api/brand-studio", async () => {
    const { calls, fetch } = mockFetch([
      { body: { ok: true, project: sampleProject(P1) } },
      { status: 429, body: { ok: false, code: "too_many_running" } },
      { body: { ok: true, projectId: P2, jobIds: [job(1).id], assetIds: [], filmIds: [] } },
    ]);
    const api = createStudioApi({ organizationId: ORG, fetch });

    const created = await api.createBrandProject({ requestId: "cr_11111111", title: "봄 향수 론칭" });
    expect(created).toEqual({ ok: true, project: sampleProject(P1) });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      operation: "project.create",
      input: { organizationId: ORG, requestId: "cr_11111111", title: "봄 향수 론칭" },
    });

    const limited = await api.createBrandProject({ requestId: "cr_22222222", title: "또 하나" });
    expect(limited).toEqual({ ok: false, code: "too_many_running" });

    const moved = await api.moveToBrandProject({ projectId: P2, jobIds: [job(1).id], preview: true });
    expect(moved).toEqual({ ok: true, projectId: P2, jobIds: [job(1).id], assetIds: [], filmIds: [] });
  });
});

describe("Image studio parity and spine rendering (§4.3)", () => {
  const choice: BrandWorkspaceChoice = {
    id: ORG,
    name: "Fixture brand",
    role: "owner",
    logoUrl: null,
  };
  const sql = { query: async () => ({ rows: [] }) } as unknown as SqlRunner;
  const viewer: Viewer = {
    userId: "00000000-0000-4000-8000-000000000001",
    tier: "free",
    isAdmin: false,
    email: "member@example.com",
    locale: "ko",
  };
  const baseAccess = {
    hasOrganization: true,
    isOwner: true,
    staff: false,
    fresh: false,
    projectScopedOnly: false,
    canRequest: true,
  };

  it("StudioApp without spine prop keeps exact DOM parity (including old ImageProjectBar when BRAND_STUDIO_PROJECTS is on)", () => {
    const dict = getDictionary("ko");
    const state = studioState({
      canCreate: true,
      jobs: [job(1, { outputs: [output(1)] })],
      projects: [{ id: P1, title: "Old film project" }],
    });

    const withoutSpine = renderToStaticMarkup(
      <StudioApp
        organizationId={ORG}
        locale="ko"
        copy={dict.brandStudio}
        mode="image"
        libraryCopy={dict.studioLibrary}
        layersCopy={dict.studioLayers}
        projectsCopy={dict.studioVideo.workspace.projects}
        initialState={state}
      />,
    );
    expect(withoutSpine).toContain("data-studio-project-bar");
    expect(withoutSpine).not.toContain("data-project-chip");

    // With spine prop: old ImageProjectBar is NOT drawn even if projectsCopy and state.projects are present.
    const spine: StudioSpineProps = {
      projects: [sampleProject(P1)],
      open: { kind: "project", id: P1 },
      canCreate: true,
      notice: null,
      noticeSource: null,
    };
    const withSpine = renderToStaticMarkup(
      <ProjectSpineProvider organizationId={ORG} locale="ko" copy={dict.projectSpine} initial={spine}>
        <ProjectChip />
        <ProjectGoneNotice />
        <StudioApp
          organizationId={ORG}
          locale="ko"
          copy={dict.brandStudio}
          mode="image"
          libraryCopy={dict.studioLibrary}
          layersCopy={dict.studioLayers}
          projectsCopy={dict.studioVideo.workspace.projects}
          initialState={state}
          spine={spine}
        />
      </ProjectSpineProvider>,
    );
    expect(withSpine).toContain("data-project-chip");
    expect(withSpine).toContain(`data-project-open="${P1}"`);
    expect(withSpine).not.toContain("data-studio-project-bar");
    expect(withSpine).not.toContain("data-studio-dock-project");
  });

  it("brandStudioV2 with flag off renders identical markup with no chip, no notice and no scoped state call", async () => {
    vi.stubEnv("BRAND_PROJECT_SPINE", "off");
    const html = renderToStaticMarkup(
      await brandStudioV2({
        deps: { sql },
        viewer,
        choice,
        access: baseAccess,
        locale: "ko",
        brandHost: false,
        tab: undefined,
        mode: undefined,
      }),
    );
    expect(html).toContain('<h1 class="bs-title">이미지 스튜디오</h1><div class="bs-head-slot"');
    expect(html).toContain("data-studio-skeleton");
    expect(html).not.toContain("data-project-chip");
    expect(html).not.toContain("data-project-gone-notice");
    expect(spineState.loadedScope).toBeNull();
  });

  it("brandStudioV2 with spine open renders the chip beside the title, loads the scoped state, and shows gone notice when needed", async () => {
    vi.stubEnv("BRAND_STUDIO_PROJECTS", "on");
    spineState.spine = {
      projects: [sampleProject(P1, "봄 향수 론칭")],
      open: { kind: "project", id: P1 },
      canCreate: true,
      notice: null,
      noticeSource: null,
    };
    spineState.initialState = studioState({
      canCreate: true,
      jobs: [job(1, { brandProjectId: P1, outputs: [output(1)] })],
      projects: [{ id: P2, title: "Legacy project" }],
    });

    const html = renderToStaticMarkup(
      await brandStudioV2({
        deps: { sql },
        viewer,
        choice,
        access: baseAccess,
        locale: "ko",
        brandHost: false,
        tab: undefined,
        mode: undefined,
        project: P1,
      }),
    );
    expect(spineState.loadedScope).toEqual({ kind: "project", brandProjectId: P1 });
    expect(html).toContain("data-project-chip");
    expect(html).toContain(`data-project-open="${P1}"`);
    expect(html).toContain("봄 향수 론칭");
    expect(html).toContain("data-studio-board");
    expect(html).not.toContain("data-studio-project-bar");
    expect(html).not.toContain("data-project-gone-notice");

    // Gone notice + unfiled scope
    spineState.spine = {
      projects: [sampleProject(P1, "봄 향수 론칭")],
      open: { kind: "unfiled" },
      canCreate: true,
      notice: "gone",
      noticeSource: "cookie",
    };
    const goneHtml = renderToStaticMarkup(
      await brandStudioV2({
        deps: { sql },
        viewer,
        choice,
        access: baseAccess,
        locale: "ko",
        brandHost: false,
        tab: undefined,
        mode: undefined,
      }),
    );
    expect(spineState.loadedScope).toEqual({ kind: "unfiled" });
    expect(goneHtml).toContain('data-project-open="unfiled"');
    expect(goneHtml).toContain("data-project-gone-notice");
  });

  it("brandStudioV2 never shows the chip to staff browsing another brand", async () => {
    spineState.spine = {
      projects: [sampleProject(P1)],
      open: { kind: "project", id: P1 },
      canCreate: true,
      notice: null,
      noticeSource: null,
    };
    const html = renderToStaticMarkup(
      await brandStudioV2({
        deps: { sql },
        viewer,
        choice: { ...choice, role: "studio" },
        access: { ...baseAccess, staff: true },
        locale: "ko",
        brandHost: false,
        tab: undefined,
        mode: undefined,
      }),
    );
    expect(html).not.toContain("data-project-chip");
    expect(html).toContain("data-studio-skeleton");
  });
});
