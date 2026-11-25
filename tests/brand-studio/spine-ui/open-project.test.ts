import { afterEach, describe, expect, it, vi } from "vitest";
import type { StudioBrandProject } from "@/lib/brand-studio/contracts";
import {
  OPEN_PROJECT_COOKIE,
  OPEN_PROJECT_MAX,
  belongsToOpenProject,
  brandProjectIdOf,
  openProjectCookieString,
  parseOpenProjectCookie,
  queryParamOfOpenProject,
  rememberOpenProject,
  rememberedOpenProject,
  replaceProjectUrlParam,
  resolveOpenProject,
  resolveVideoStudioAddress,
  scopeOfOpenProject,
  searchParamEntries,
  serializeOpenProjectCookie,
  type OpenProject,
} from "@/lib/brand-studio/open-project";
import { loadStudioSpine } from "@/lib/brand-studio/open-project-server";
import { resetSpineProbe } from "@/lib/brand-studio/brand-projects";
import type { Viewer } from "@/lib/auth/identity";
import type { SqlRunner } from "@/lib/db/sql-runner";
import type { StudioDeps } from "@/lib/brand-studio/types";

const ORG = "a0000000-0000-4000-8000-00000000000a";
const OTHER_ORG = "b0000000-0000-4000-8000-00000000000b";
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const GONE = "99999999-9999-4999-8999-999999999999";
const FILM1 = "f1111111-1111-4111-8111-111111111111";

const project = (id: string, title = "Spring launch"): StudioBrandProject => ({
  id,
  title,
  origin: "self",
  lastActivityAt: "2026-11-25T10:00:00.000Z",
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetSpineProbe();
});

describe("twings_brand_project cookie map", () => {
  it("uses the expected cookie name, attributes and cap matching twings_brand_mode", () => {
    expect(OPEN_PROJECT_COOKIE).toBe("twings_brand_project");
    expect(OPEN_PROJECT_MAX).toBe(12);
    expect(openProjectCookieString(`${ORG}:${P1}`, false)).toBe(
      `${OPEN_PROJECT_COOKIE}=${encodeURIComponent(`${ORG}:${P1}`)}; Path=/; Max-Age=31536000; SameSite=Lax`,
    );
    expect(openProjectCookieString(`${ORG}:unfiled`, true)).toBe(
      `${OPEN_PROJECT_COOKIE}=${encodeURIComponent(`${ORG}:unfiled`)}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
    );
  });

  it("remembers both project ids and explicit unfiled per organization, most recent first", () => {
    let memory = parseOpenProjectCookie(rememberOpenProject({}, ORG, { kind: "project", id: P1 }));
    memory = parseOpenProjectCookie(rememberOpenProject(memory, OTHER_ORG, { kind: "unfiled" }));
    expect(rememberedOpenProject(memory, ORG)).toEqual({ kind: "project", id: P1 });
    expect(rememberedOpenProject(memory, OTHER_ORG)).toEqual({ kind: "unfiled" });
    expect(rememberedOpenProject(memory, ORG.toUpperCase())).toEqual({ kind: "project", id: P1 });
    expect(rememberedOpenProject(memory, null)).toBeNull();

    // Switching ORG to unfiled moves ORG to the front and preserves unfiled explicitly.
    const raw = rememberOpenProject(memory, ORG, { kind: "unfiled" });
    const next = parseOpenProjectCookie(raw);
    expect(Object.keys(next)).toEqual([ORG, OTHER_ORG]);
    expect(rememberedOpenProject(next, ORG)).toEqual({ kind: "unfiled" });
    expect(serializeOpenProjectCookie(next)).toBe(`${ORG}:unfiled|${OTHER_ORG}:unfiled`);
  });

  it("caps stored organizations at OPEN_PROJECT_MAX, dropping oldest entries", () => {
    let raw = "";
    for (let i = 0; i < OPEN_PROJECT_MAX + 5; i += 1) {
      const orgId = `c0000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      raw = rememberOpenProject(parseOpenProjectCookie(raw), orgId, { kind: "project", id: P1 });
    }
    const memory = parseOpenProjectCookie(raw);
    expect(Object.keys(memory)).toHaveLength(OPEN_PROJECT_MAX);
    expect(rememberedOpenProject(memory, `c0000000-0000-4000-8000-${String(OPEN_PROJECT_MAX + 4).padStart(12, "0")}`)).toEqual({
      kind: "project",
      id: P1,
    });
    expect(rememberedOpenProject(memory, "c0000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("ignores malformed, non-uuid, or corrupted cookie values safely", () => {
    for (const raw of [undefined, null, "", "garbage", `${ORG}:not-a-uuid`, `nope:${P1}`, "%E0%A4%A", `${ORG}:`]) {
      expect(rememberedOpenProject(parseOpenProjectCookie(raw), ORG), String(raw)).toBeNull();
    }
    // Keeps valid entries alongside invalid ones.
    const mixed = parseOpenProjectCookie(`bad:entry|${ORG}:${P1}|${OTHER_ORG}:invalid`);
    expect(rememberedOpenProject(mixed, ORG)).toEqual({ kind: "project", id: P1 });
    expect(rememberedOpenProject(mixed, OTHER_ORG)).toBeNull();
  });
});

describe("resolveOpenProject", () => {
  const projects = [project(P1, "First"), project(P2, "Second")];

  it("prefers ?project=<id> over the remembered cookie when it is in projects", () => {
    expect(resolveOpenProject({ projects, queryProject: P2, remembered: { kind: "project", id: P1 } })).toEqual({
      open: { kind: "project", id: P2 },
      notice: null,
      noticeSource: null,
    });
    // Case-insensitive UUID match returns the canonical project id.
    expect(resolveOpenProject({ projects, queryProject: P1.toUpperCase(), remembered: null })).toEqual({
      open: { kind: "project", id: P1 },
      notice: null,
      noticeSource: null,
    });
  });

  it("uses the cookie value (project or unfiled) when ?project= is absent", () => {
    expect(resolveOpenProject({ projects, remembered: { kind: "project", id: P1 } })).toEqual({
      open: { kind: "project", id: P1 },
      notice: null,
      noticeSource: null,
    });
    expect(resolveOpenProject({ projects, remembered: { kind: "unfiled" } })).toEqual({
      open: { kind: "unfiled" },
      notice: null,
      noticeSource: null,
    });
  });

  it("falls back to unfiled with notice: null when neither query nor cookie is set", () => {
    expect(resolveOpenProject({ projects })).toEqual({ open: { kind: "unfiled" }, notice: null, noticeSource: null });
    expect(resolveOpenProject({ projects: [] })).toEqual({ open: { kind: "unfiled" }, notice: null, noticeSource: null });
  });

  it("returns unfiled with notice: 'gone' when ?project= names a project not in projects", () => {
    expect(resolveOpenProject({ projects, queryProject: GONE, remembered: { kind: "project", id: P1 } })).toEqual({
      open: { kind: "unfiled" },
      notice: "gone",
      noticeSource: "address",
    });
    expect(resolveOpenProject({ projects: [], queryProject: P1, remembered: null })).toEqual({
      open: { kind: "unfiled" },
      notice: "gone",
      noticeSource: "address",
    });
  });

  it("returns unfiled with notice: 'gone' when the remembered cookie project is no longer in projects", () => {
    expect(resolveOpenProject({ projects, remembered: { kind: "project", id: GONE } })).toEqual({
      open: { kind: "unfiled" },
      notice: "gone",
      noticeSource: "cookie",
    });
  });
});

describe("resolveVideoStudioAddress (§4.5)", () => {
  const pathname = "/brand/studio/video";

  it("recognizes ?project=<id> as a brand project when it is in projects", () => {
    const decision = resolveVideoStudioAddress({
      pathname,
      searchParams: [
        ["organizationId", ORG],
        ["project", P1],
        ["tab", "edit"],
      ],
      projectIds: [P1, P2],
      filmIds: [FILM1],
    });
    expect(decision).toEqual({ kind: "project", id: P1 });
  });

  it("redirects ?project=<filmId> to ?film=<filmId> keeping all other parameters in exact order", () => {
    const decision = resolveVideoStudioAddress({
      pathname,
      searchParams: [
        ["organizationId", ORG],
        ["start", "reverse"],
        ["project", FILM1],
        ["tab", "edit"],
      ],
      projectIds: [P1],
      filmIds: [FILM1],
    });
    expect(decision).toEqual({
      kind: "redirect_film",
      filmId: FILM1,
      href: `/brand/studio/video?organizationId=${ORG}&start=reverse&film=${FILM1}&tab=edit`,
    });
  });

  it("returns gone when ?project=<id> is neither a project nor a film", () => {
    const decision = resolveVideoStudioAddress({
      pathname,
      searchParams: [
        ["organizationId", ORG],
        ["project", GONE],
      ],
      projectIds: [P1],
      filmIds: [FILM1],
    });
    expect(decision).toEqual({ kind: "gone" });
  });

  it("returns none when there is no ?project= parameter", () => {
    const decision = resolveVideoStudioAddress({
      pathname,
      searchParams: [
        ["organizationId", ORG],
        ["film", FILM1],
      ],
      projectIds: [P1],
      filmIds: [FILM1],
    });
    expect(decision).toEqual({ kind: "none" });
  });

  it("extracts searchParamEntries preserving order and array values", () => {
    expect(
      searchParamEntries({
        organizationId: ORG,
        tag: ["a", "b"],
        empty: undefined,
        project: FILM1,
      }),
    ).toEqual([
      ["organizationId", ORG],
      ["tag", "a"],
      ["tag", "b"],
      ["project", FILM1],
    ]);
  });
});

describe("scope, URL and membership helpers", () => {
  it("converts OpenProject to scope, query param, brandProjectId and URL", () => {
    const openProj: OpenProject = { kind: "project", id: P1 };
    const openUnfiled: OpenProject = { kind: "unfiled" };
    expect(scopeOfOpenProject(openProj)).toEqual({ kind: "project", brandProjectId: P1 });
    expect(scopeOfOpenProject(openUnfiled)).toEqual({ kind: "unfiled" });
    expect(queryParamOfOpenProject(openProj)).toBe(P1);
    expect(queryParamOfOpenProject(openUnfiled)).toBe("unfiled");
    expect(brandProjectIdOf(openProj)).toBe(P1);
    expect(brandProjectIdOf(openUnfiled)).toBeNull();
    expect(brandProjectIdOf(null)).toBeNull();

    expect(belongsToOpenProject(P1, openProj)).toBe(true);
    expect(belongsToOpenProject(P1.toUpperCase(), openProj)).toBe(true);
    expect(belongsToOpenProject(P2, openProj)).toBe(false);
    expect(belongsToOpenProject(null, openProj)).toBe(false);
    expect(belongsToOpenProject(undefined, openUnfiled)).toBe(true);
    expect(belongsToOpenProject(null, openUnfiled)).toBe(true);
    expect(belongsToOpenProject(P1, openUnfiled)).toBe(false);

    expect(replaceProjectUrlParam(`https://brand.twings.app/brand/studio?organizationId=${ORG}#wall`, openProj)).toBe(
      `https://brand.twings.app/brand/studio?organizationId=${ORG}&project=${P1}#wall`,
    );
    expect(replaceProjectUrlParam(`https://brand.twings.app/brand/studio?organizationId=${ORG}&project=${P1}#wall`, openUnfiled)).toBe(
      `https://brand.twings.app/brand/studio?organizationId=${ORG}#wall`,
    );
  });
});

describe("loadStudioSpine (server helper)", () => {
  const viewer: Viewer = {
    userId: "00000000-0000-4000-8000-000000000001",
    tier: "free",
    isAdmin: false,
    email: "member@example.com",
    locale: "ko",
  };

  function stubSql(rows: unknown[] = []): SqlRunner & { queryCalls: number } {
    const runner: SqlRunner & { queryCalls: number } = {
      queryCalls: 0,
      query: async <T = Record<string, unknown>>() => {
        runner.queryCalls += 1;
        return { rows: rows as T[] };
      },
      transaction: async <T,>(fn: (tx: SqlRunner) => Promise<T>) => fn(runner),
    };
    return runner;
  }

  it("returns null without querying the database when BRAND_PROJECT_SPINE is off", async () => {
    vi.stubEnv("BRAND_PROJECT_SPINE", "off");
    const sql = stubSql();
    const res = await loadStudioSpine({
      sql,
      viewer,
      organizationId: ORG,
      seat: { staff: false, role: "owner" },
      cookieRaw: `${ORG}:${P1}`,
    });
    expect(res).toBeNull();
    expect(sql.queryCalls).toBe(0);
  });

  it("returns null for staff or project guests even when BRAND_PROJECT_SPINE is on", async () => {
    vi.stubEnv("BRAND_PROJECT_SPINE", "on");
    vi.stubEnv("BRAND_PROJECT_SPINE_ORGS", ORG);
    const sql = stubSql();
    for (const seat of [
      { staff: true, role: "studio" },
      { staff: true, role: "owner" },
      { staff: false, role: "guest" },
    ]) {
      const res = await loadStudioSpine({
        sql,
        viewer,
        organizationId: ORG,
        seat,
        cookieRaw: null,
      });
      expect(res, JSON.stringify(seat)).toBeNull();
    }
    expect(sql.queryCalls).toBe(0);
  });

  it("returns null when the organization is not in BRAND_PROJECT_SPINE_ORGS", async () => {
    vi.stubEnv("BRAND_PROJECT_SPINE", "on");
    vi.stubEnv("BRAND_PROJECT_SPINE_ORGS", OTHER_ORG);
    const sql = stubSql();
    const res = await loadStudioSpine({
      sql,
      viewer,
      organizationId: ORG,
      seat: { staff: false, role: "owner" },
      cookieRaw: `${ORG}:${P1}`,
    });
    expect(res).toBeNull();
    expect(sql.queryCalls).toBe(0);
  });

  it("returns StudioSpineProps with resolved project, notice and role-based canCreate when open", async () => {
    vi.stubEnv("BRAND_PROJECT_SPINE", "on");
    vi.stubEnv("BRAND_PROJECT_SPINE_ORGS", ORG);
    const projectRow = {
      id: P1,
      title: "Spring campaign",
      origin: "self",
      last_activity_at: "2026-11-25T10:00:00.000Z",
      cover_kind: "image",
      cover_key: "org/a/cover.png",
      cover_thumb_key: "org/a/cover-thumb.webp",
    };
    const sql: SqlRunner = {
      query: async <T = Record<string, unknown>>(text: string) => {
        if (text.includes("information_schema.columns")) return { rows: [{ n: 4 }] as unknown as T[] };
        if (text.includes("brand_memberships")) return { rows: [{ role: "owner" }] as unknown as T[] };
        if (text.includes("brand_organizations")) return { rows: [{ id: ORG, name: "Fixture", slug: "fixture" }] as unknown as T[] };
        if (text.includes("brand_feature_policies")) return { rows: [] as T[] };
        if (text.includes("from brand_projects p")) return { rows: [projectRow] as unknown as T[] };
        return { rows: [] as T[] };
      },
      transaction: async <T,>(fn: (tx: SqlRunner) => Promise<T>) => fn(sql),
    };
    const deps = {
      sql,
      media: { url: (key: string) => `https://media.example/${key}` },
    } as unknown as StudioDeps;

    const fromCookie = await loadStudioSpine({
      sql,
      viewer,
      organizationId: ORG,
      seat: { staff: false, role: "owner" },
      cookieRaw: `${ORG}:${P1}`,
      deps,
      listProjects: async () => ({ ok: true, projects: [project(P1, "Spring campaign")] }),
    });
    expect(fromCookie).toEqual({
      projects: [project(P1, "Spring campaign")],
      open: { kind: "project", id: P1 },
      canCreate: true,
      notice: null,
      noticeSource: null,
    });

    const viewerGone = await loadStudioSpine({
      sql,
      viewer,
      organizationId: ORG,
      seat: { staff: false, role: "viewer" },
      queryProject: GONE,
      cookieRaw: `${ORG}:${P1}`,
      deps,
      listProjects: async () => ({ ok: true, projects: [project(P1, "Spring campaign")] }),
    });
    expect(viewerGone).toEqual({
      projects: [project(P1, "Spring campaign")],
      open: { kind: "unfiled" },
      canCreate: false,
      notice: "gone",
      noticeSource: "address",
    });

    const failedList = await loadStudioSpine({
      sql,
      viewer,
      organizationId: ORG,
      seat: { staff: false, role: "owner" },
      cookieRaw: null,
      deps,
      listProjects: async () => ({ ok: false, code: "not_found" }),
    });
    expect(failedList).toBeNull();
  });
});

describe('rememberOpenedProject', () => {
  it('remembers a project the page opened without a notice, and nothing else', async () => {
    const { rememberOpenedProject } = await import('@/lib/brand-studio/open-project');
    const project = { kind: 'project' as const, id: '11111111-1111-4111-8111-111111111111' };
    expect(rememberOpenedProject({ open: project, notice: null })).toEqual(project);
    expect(rememberOpenedProject({ open: { kind: 'unfiled' }, notice: null })).toBeNull();
    expect(rememberOpenedProject({ open: { kind: 'unfiled' }, notice: 'gone' })).toBeNull();
  });
});
