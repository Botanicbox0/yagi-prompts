import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { BRAND_PROJECT_LIMITS, type StudioBrandProject } from "@/lib/brand-studio/contracts";
import type { StudioSpineProps } from "@/lib/brand-studio/open-project";
import { createStudioApi } from "@/components/brand-studio/api";
import { exportRecordInput } from "@/components/brand-studio/editor-v2/export-record";
import { EditorV2 } from "@/components/brand-studio/editor-v2/editor-v2";
import type { ComposerInput } from "@/components/brand-studio/sound/composer";
import {
  SoundStudio,
  clearSoundRequestId,
  resolveSoundRequestId,
  soundJobsInScope,
  soundMusicCreateInput,
} from "@/components/brand-studio/sound/sound-studio";
import { defaultStructure } from "@/lib/brand-studio/sound/lyrics";
import type { PressCache } from "@/components/brand-studio/use-dock";
import {
  MoveToProjectDialog,
  ProjectSpineProvider,
  collectMoveJobIds,
  createMoveToProjectController,
  moveDoneToast,
  moveFamilyLine,
  movedJobsLeavingScope,
} from "@/components/brand-studio/project-chip";
import { bulkActions, selectedMoveJobIds } from "@/components/brand-studio/gallery/selection";
import { Wall, tileMenuKeys } from "@/components/brand-studio/gallery/wall";
import { Menu } from "@/components/brand-studio/gallery/menu";
import type { StudioLibrary } from "@/components/brand-studio/seams";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { SqlRunner } from "@/lib/db/sql-runner";
import { ORG, asset, id, job, output, studioState } from "../ui/fixtures";

const P1 = id(0xc1);
const P2 = id(0xc2);
const P3 = id(0xc3);

const sampleProject = (pid: string, title = "봄 향수 론칭"): StudioBrandProject => ({
  id: pid,
  title,
  origin: "self",
  lastActivityAt: "2026-11-25T10:00:00.000Z",
});

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

const pageStub = vi.hoisted(() => ({
  locale: "ko" as "ko" | "en",
  role: "owner" as "owner" | "editor" | "viewer" | "studio",
  staff: false,
  spine: null as StudioSpineProps | null,
  soundJobs: [] as ReturnType<typeof job>[],
  editorReal: true,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/brand/studio/sound",
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
    studioRouteContext: vi.fn(async () => ({
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
      deps: {
        sql: {
          query: async () => ({ rows: [] }),
          transaction: async <T,>(fn: (tx: SqlRunner) => Promise<T>) => fn({ query: async () => ({ rows: [] }) } as unknown as SqlRunner),
        } as unknown as SqlRunner,
      },
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

vi.mock("@/lib/brands/entitlements", () => ({
  assertBrandFeature: vi.fn(async () => {}),
  BrandFeatureDenied: class BrandFeatureDenied extends Error {},
}));

vi.mock("@/lib/flags", async () => {
  const actual = await vi.importActual<typeof import("@/lib/flags")>("@/lib/flags");
  return {
    ...actual,
    brandSoundStudioOpen: vi.fn(() => true),
    brandStudioEditorV2Open: vi.fn(() => true),
    brandStudioEditorV2DefaultFor: vi.fn(() => pageStub.editorReal),
    brandWorkspacePrototypeLayerOpen: vi.fn(() => true),
  };
});

vi.mock("@/lib/brand-studio/visibility", async () => {
  const actual = await vi.importActual<typeof import("@/lib/brand-studio/visibility")>("@/lib/brand-studio/visibility");
  return {
    ...actual,
    soundStudioVisible: vi.fn(() => true),
  };
});

vi.mock("@/lib/brand-studio/sound/load", () => ({
  loadSoundStudio: vi.fn(async () => ({
    tracks: [],
    jobs: pageStub.soundJobs,
    videos: [],
    allowance: studioState().allowance,
  })),
}));

vi.mock("@/lib/brand-studio/repo", async () => {
  const actual = await vi.importActual<typeof import("@/lib/brand-studio/repo")>("@/lib/brand-studio/repo");
  return {
    ...actual,
    assetsOf: vi.fn(async () => []),
    jobsOf: vi.fn(async () => []),
    viewsOf: vi.fn(async () => []),
  };
});

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
  };
});

import StudioSoundPage from "@/app/(brand)/brand/studio/sound/page";
import StudioEditorV2Page from "@/app/(brand)/brand/studio/editor/page";

beforeEach(() => {
  pageStub.locale = "ko";
  pageStub.role = "owner";
  pageStub.staff = false;
  pageStub.spine = null;
  pageStub.soundJobs = [];
  pageStub.editorReal = true;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("§4.4 Sound studio: filing, F1 press fingerprint, scope filtering, and page parity", () => {
  const composerInput: ComposerInput = {
    prompt: "minimal ambient synth for perfume launch",
    vocal: false,
    lyrics: "",
    careful: false,
    architect: false,
    structure: defaultStructure(60),
    targetSeconds: 60,
  };

  it("attaches brandProjectId on music job.create only when a project is open, and preserves F1 press keys across project switches", () => {
    const offInput = soundMusicCreateInput(composerInput, {
      organizationId: ORG,
      locale: "ko",
      requestId: "req_1",
      brandProjectId: null,
    });
    expect("brandProjectId" in offInput).toBe(false);

    const filedInput = soundMusicCreateInput(composerInput, {
      organizationId: ORG,
      locale: "ko",
      requestId: "req_2",
      brandProjectId: P1,
    });
    expect(filedInput.brandProjectId).toBe(P1);

    // H1: content-independent single slot per scope so A -> B -> A retains A's requestId on retry.
    const cache: PressCache = new Map();
    let n = 0;
    const makeId = () => `snd_${++n}`;
    const idA1 = resolveSoundRequestId(cache, P1, makeId);
    const idB = resolveSoundRequestId(cache, P2, makeId);
    expect(idB).not.toBe(idA1);
    expect(resolveSoundRequestId(cache, P1, makeId)).toBe(idA1);
    clearSoundRequestId(cache, P1);
    expect(resolveSoundRequestId(cache, P1, makeId)).not.toBe(idA1);
  });

  it("filters sound StudioJobViews to the open scope when spine is active, and keeps all runs when closed", () => {
    const m1 = job(1, { kind: "music", brandProjectId: P1 });
    const m2 = job(2, { kind: "music", brandProjectId: P2 });
    const mUnfiled = job(3, { kind: "music", brandProjectId: null });
    const all = [m1, m2, mUnfiled];

    expect(soundJobsInScope(all, undefined)).toBe(all);
    expect(soundJobsInScope(all, { kind: "project", id: P1 }).map((j) => j.id)).toEqual([m1.id]);
    expect(soundJobsInScope(all, { kind: "project", id: P2 }).map((j) => j.id)).toEqual([m2.id]);
    expect(soundJobsInScope(all, { kind: "unfiled" }).map((j) => j.id)).toEqual([mUnfiled.id]);
  });

  it("renders SoundStudio with exact flag-off parity, and mounts ProjectChip + scoped runs when spine is open", async () => {
    vi.stubEnv("BRAND_PROJECT_SPINE", "off");
    const m1 = job(1, { kind: "music", status: "running", prompt: "Track Alpha", brandProjectId: P1 });
    const m2 = job(2, { kind: "music", status: "running", prompt: "Track Beta", brandProjectId: P2 });
    pageStub.soundJobs = [m1, m2];

    const offHtml = renderToStaticMarkup(
      await (StudioSoundPage({ searchParams: Promise.resolve({ organizationId: ORG }) }) as Promise<ReactElement>),
    );
    expect(offHtml).not.toContain("data-project-chip");
    expect(offHtml).not.toContain("data-project-gone-notice");
    expect(offHtml).toContain("Track Alpha");
    expect(offHtml).toContain("Track Beta");

    // Spine open to P1: chip rendered beside title, only P1 run shown, P2 hidden.
    pageStub.spine = {
      projects: [sampleProject(P1, "봄 향수 론칭"), sampleProject(P2, "겨울 립")],
      open: { kind: "project", id: P1 },
      canCreate: true,
      notice: null,
      noticeSource: null,
    };
    const onHtml = renderToStaticMarkup(
      await (StudioSoundPage({ searchParams: Promise.resolve({ organizationId: ORG, project: P1 }) }) as Promise<ReactElement>),
    );
    expect(onHtml).toContain("data-project-chip");
    expect(onHtml).toContain(`data-project-open="${P1}"`);
    expect(onHtml).toContain("봄 향수 론칭");
    expect(onHtml).toContain("Track Alpha");
    expect(onHtml).not.toContain("Track Beta");

    // Staff never sees chip.
    pageStub.staff = true;
    pageStub.role = "studio";
    const staffHtml = renderToStaticMarkup(
      await (StudioSoundPage({ searchParams: Promise.resolve({ organizationId: ORG }) }) as Promise<ReactElement>),
    );
    expect(staffHtml).not.toContain("data-project-chip");
  });
});

describe("§4.4 Editing studio: header chip, explicit render.reserve/upload filing, and parity", () => {
  it("attaches brandProjectId on exportRecordInput only when explicitly passed", () => {
    const offRec = exportRecordInput(ORG, 240, 24);
    expect("brandProjectId" in offRec).toBe(false);
    const onRec = exportRecordInput(ORG, 240, 24, P1);
    expect(onRec.brandProjectId).toBe(P1);
  });

  it("attaches brandProjectId on api.upload only when caller passes it explicitly (no hidden registry)", async () => {
    const file = Object.assign(new Blob(["mp4"], { type: "video/mp4" }), { name: "cut.mp4" });
    const calls: Array<{ body: string }> = [];
    const fetchStub = vi.fn(async (_url: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ body: String(init.body ?? "") });
      const idx = calls.length % 3;
      if (idx === 1) return new Response(JSON.stringify({ ok: true, id: asset(1).id, direct: false }), { status: 200 });
      if (idx === 2) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, asset: asset(1, { kind: "video" }) }), { status: 200 });
    });
    const api = createStudioApi({ organizationId: ORG, fetch: fetchStub as unknown as typeof globalThis.fetch });

    // Omitted (flag off / unfiled): no brandProjectId key.
    await api.upload(file, { requestId: "ed_11111111" });
    expect("brandProjectId" in (JSON.parse(calls[0]!.body) as { input: Record<string, unknown> }).input).toBe(false);

    // Explicit open project P1: attaches brandProjectId.
    await api.upload(file, { requestId: "ed_22222222", brandProjectId: P1 });
    expect((JSON.parse(calls[3]!.body) as { input: Record<string, unknown> }).input.brandProjectId).toBe(P1);

    // Explicit undefined (unfiled): omitted again.
    await api.upload(file, { requestId: "ed_33333333", brandProjectId: undefined });
    expect("brandProjectId" in (JSON.parse(calls[6]!.body) as { input: Record<string, unknown> }).input).toBe(false);
  });

  it("renders EditorV2 with exact flag-off parity, shows chip on real film when open, and never mounts provider on sample film or staff", async () => {
    vi.stubEnv("BRAND_PROJECT_SPINE", "off");
    const offHtml = renderToStaticMarkup(
      await (StudioEditorV2Page({ searchParams: Promise.resolve({ organizationId: ORG }) }) as Promise<ReactElement>),
    );
    expect(offHtml).not.toContain("data-project-chip");
    expect(offHtml).not.toContain("data-project-gone-notice");

    // Spine open on real film -> chip beside title + gone notice when notice is 'gone'.
    pageStub.spine = {
      projects: [sampleProject(P1, "봄 향수 론칭")],
      open: { kind: "project", id: P1 },
      canCreate: true,
      notice: null,
      noticeSource: null,
    };
    const onHtml = renderToStaticMarkup(
      await (StudioEditorV2Page({ searchParams: Promise.resolve({ organizationId: ORG, project: P1 }) }) as Promise<ReactElement>),
    );
    expect(onHtml).toContain("data-project-chip");
    expect(onHtml).toContain(`data-project-open="${P1}"`);
    expect(onHtml).toContain("봄 향수 론칭");

    // H7: Sample film (?sample=1 and !ownFilm) never loads spine or mounts ProjectSpineProvider / gone notice.
    pageStub.spine = {
      projects: [sampleProject(P1, "봄 향수 론칭")],
      open: { kind: "unfiled" },
      canCreate: true,
      notice: "gone",
      noticeSource: "address",
    };
    const { loadStudioSpine } = await import("@/lib/brand-studio/open-project-server");
    vi.mocked(loadStudioSpine).mockClear();

    const sampleHtml = renderToStaticMarkup(
      await (StudioEditorV2Page({ searchParams: Promise.resolve({ organizationId: ORG, sample: "1", project: P3 }) }) as Promise<ReactElement>),
    );
    expect(sampleHtml).not.toContain("data-project-chip");
    expect(sampleHtml).not.toContain("data-project-gone-notice");
    expect(loadStudioSpine).not.toHaveBeenCalled();

    pageStub.editorReal = false;
    const nonOwnHtml = renderToStaticMarkup(
      await (StudioEditorV2Page({ searchParams: Promise.resolve({ organizationId: ORG, project: P3 }) }) as Promise<ReactElement>),
    );
    expect(nonOwnHtml).not.toContain("data-project-chip");
    expect(nonOwnHtml).not.toContain("data-project-gone-notice");
    expect(loadStudioSpine).not.toHaveBeenCalled();

    // Standalone EditorV2 without spine keeps exact parity.
    const dict = getDictionary("ko");
    const standalone = renderToStaticMarkup(
      <EditorV2 copy={dict.studioEditor} currentEditorHref="/brand/studio/compose?classic=1" real={null} />,
    );
    expect(standalone).not.toContain("data-project-chip");
  });
});

describe("§4.6 Moving: controller, 200-item cap, tile more-menu, multi-select bar, and MoveToProjectDialog", () => {
  const ko = getDictionary("ko").projectSpine;
  const projects = [sampleProject(P1, "봄 향수"), sampleProject(P2, "겨울 립")];

  it("deduplicates and caps move jobIds at BRAND_PROJECT_LIMITS.moveMax (200)", () => {
    const raw = Array.from({ length: 225 }, (_, i) => `job-${i}`);
    const res = collectMoveJobIds([...raw, "job-0", "job-1"]);
    expect(res.totalUnique).toBe(225);
    expect(res.overLimit).toBe(true);
    expect(res.jobIds).toHaveLength(BRAND_PROJECT_LIMITS.moveMax);
    expect(res.jobIds[0]).toBe("job-0");

    const j1 = job(1, { outputs: [output(1), output(2)] });
    const j2 = job(2, { status: "failed", outputs: [] });
    const selected = selectedMoveJobIds({
      items: [
        { job: j1, output: output(1) },
        { job: j1, output: output(2) },
      ],
      failed: [j2],
    });
    expect(selected).toEqual({ jobIds: [j1.id, j2.id], overLimit: false });
  });

  it("formats family line, done toast, and computes runs leaving the open scope", () => {
    expect(moveFamilyLine(1, ko)).toBeNull();
    expect(moveFamilyLine(3, ko)).toBe("함께 만든 결과와 버전까지 3개가 옮겨져요.");
    // Two chosen, two move: nothing came along, no line. Two chosen, five move: the line.
    expect(moveFamilyLine(2, ko, 2)).toBeNull();
    expect(moveFamilyLine(5, ko, 2)).toBe("함께 만든 결과와 버전까지 5개가 옮겨져요.");
    expect(moveDoneToast(P1, projects, ko)).toBe("'봄 향수' 프로젝트로 옮겼어요.");
    expect(moveDoneToast(null, projects, ko)).toBe("미분류로 옮겼어요.");

    expect(movedJobsLeavingScope(["j1", "j2"], P2, { kind: "project", id: P1 })).toEqual(["j1", "j2"]);
    expect(movedJobsLeavingScope(["j1", "j2"], P1, { kind: "project", id: P1 })).toEqual([]);
    expect(movedJobsLeavingScope(["j1"], null, { kind: "project", id: P1 })).toEqual(["j1"]);
    expect(movedJobsLeavingScope(["j1"], null, { kind: "unfiled" })).toEqual([]);
  });

  it("runs preview (dropping stale answers) and submit through createMoveToProjectController", async () => {
    let releaseFirstPreview: ((v: { ok: true; projectId: string | null; jobIds: string[]; assetIds: string[]; filmIds: string[] }) => void) | null = null;
    const calls: Array<{ projectId: string | null; jobIds?: string[]; preview?: boolean }> = [];
    const moveApi = vi.fn(async (input: { projectId: string | null; jobIds?: string[]; preview?: boolean }) => {
      calls.push(input);
      if (input.preview && calls.length === 1) {
        return new Promise<{ ok: true; projectId: string | null; jobIds: string[]; assetIds: string[]; filmIds: string[] }>((resolve) => {
          releaseFirstPreview = resolve;
        });
      }
      if (input.preview) {
        return { ok: true as const, projectId: input.projectId, jobIds: ["j1", "j2", "j3"], assetIds: [], filmIds: [] };
      }
      if (input.projectId === P3) {
        return { ok: false as const, code: "failed" as const };
      }
      return { ok: true as const, projectId: input.projectId, jobIds: ["j1", "j2", "j3"], assetIds: [], filmIds: [] };
    });

    const ctrl = createMoveToProjectController({
      jobIds: ["j1"],
      projects,
      openScope: { kind: "project", id: P1 },
      copy: ko,
      move: moveApi,
    });

    // Two overlapping previews: first resolves late -> must be dropped so latest count (3) stays.
    const slow = ctrl.preview(P2);
    const fast = ctrl.preview(null);
    expect(await fast).toEqual({ familyCount: 3 });
    releaseFirstPreview!({ ok: true, projectId: P2, jobIds: ["j1"], assetIds: [], filmIds: [] });
    expect(await slow).toEqual({ stale: true });
    expect(ctrl.getState().familyCount).toBe(3);

    // Failure returns moveFailed.
    const failed = await ctrl.submit(P3);
    expect(failed).toEqual({ ok: false, error: ko.moveFailed });

    // Success moving from P1 -> P2 returns toast + full moved family to remove from P1 wall.
    const ok = await ctrl.submit(P2);
    expect(ok).toEqual({
      ok: true,
      projectId: P2,
      toast: "'겨울 립' 프로젝트로 옮겼어요.",
      removedJobIds: ["j1", "j2", "j3"],
    });
  });

  it("keeps tileMenuKeys and bulkActions unchanged without spine/canMoveProject, and adds project-move when enabled", () => {
    const baseMenu = tileMenuKeys({ canGenerate: true, canEdit: true, kind: "image", image: true, sized: true, saved: false });
    expect(baseMenu).not.toContain("project-move");

    const spineMenu = tileMenuKeys({
      canGenerate: true,
      canEdit: true,
      kind: "image",
      image: true,
      sized: true,
      saved: false,
      canMoveProject: true,
    });
    expect(spineMenu).toContain("project-move");
    expect(spineMenu.indexOf("project-move")).toBe(spineMenu.indexOf("folder") + 1);

    // Viewer (canEdit: false) never sees project-move.
    expect(
      tileMenuKeys({ canGenerate: false, canEdit: false, kind: "image", image: true, sized: true, saved: false, canMoveProject: true }),
    ).not.toContain("project-move");

    const targets = { items: [{ job: job(1), output: output(1) }], failed: [] };
    expect(bulkActions(targets, { canGenerate: true, canEdit: true, canRemove: true })).not.toContain("project-move");
    expect(bulkActions(targets, { canGenerate: true, canEdit: true, canRemove: true, canMoveProject: true })).toContain("project-move");
    expect(bulkActions(targets, { canGenerate: false, canEdit: false, canRemove: false, canMoveProject: true })).not.toContain("project-move");
  });

  it("renders data-project-move on TileMoreMenu, multi-select SelectionBar, and MoveToProjectDialog only when spine + canCreate", () => {
    const dict = getDictionary("ko");
    const j1 = job(1, { outputs: [output(1)] });

    // Wall without spine -> zero data-project-move in multi-select bar.
    const wallOff = renderToStaticMarkup(
      <Wall
        mode="image"
        jobs={[j1]}
        copy={dict.brandStudio}
        locale="ko"
        canGenerate
        canEdit
        library={stubLibrary}
        parentOf={() => null}
        onAction={() => {}}
        onRetry={() => {}}
        onNotice={() => {}}
        initialSelection={[`o:${output(1).id}`]}
      />,
    );
    expect(wallOff).toContain("data-studio-selection-bar");
    expect(wallOff).not.toContain("data-project-move");

    // Wall with spine + canCreate + onMoveJobs -> multi-select bar has data-project-move.
    const spineOpen: StudioSpineProps = {
      projects,
      open: { kind: "project", id: P1 },
      canCreate: true,
      notice: null,
      noticeSource: null,
    };
    const wallOn = renderToStaticMarkup(
      <ProjectSpineProvider organizationId={ORG} locale="ko" copy={ko} initial={spineOpen}>
        <Wall
          mode="image"
          jobs={[j1]}
          copy={dict.brandStudio}
          locale="ko"
          canGenerate
          canEdit
          library={stubLibrary}
          parentOf={() => null}
          onAction={() => {}}
          onRetry={() => {}}
          onNotice={() => {}}
          onMoveJobs={() => {}}
          initialSelection={[`o:${output(1).id}`]}
        />
      </ProjectSpineProvider>,
    );
    expect(wallOn).toContain("data-project-move");
    expect(wallOn).toContain(ko.move);

    // Existing Menu renders data-menu-item="project-move" unchanged (H3: no TileMoreMenu copy).
    const menuHtml = renderToStaticMarkup(
      <Menu
        id="tile-1-panel"
        label="더 보기"
        entries={[
          { key: "open", label: "열기", run: () => {} },
          { key: "project-move", label: ko.move, icon: "folder-plus", run: () => {} },
        ]}
        onClose={() => {}}
      />,
    );
    expect(menuHtml).toContain('data-menu-item="project-move"');
    expect(menuHtml).not.toContain("data-project-move");

    // MoveToProjectDialog renders projects + 미분류, family count line, and one filled submit button.
    const dialogHtml = renderToStaticMarkup(
      <MoveToProjectDialog
        projects={projects}
        currentScope={{ kind: "project", id: P1 }}
        jobIds={[j1.id]}
        locale="ko"
        copy={ko}
        initialFamilyCount={4}
        onMove={async () => ({ ok: true, projectId: P2, jobIds: [j1.id], assetIds: [], filmIds: [] })}
        onMoved={() => {}}
        onClose={() => {}}
      />,
    );
    expect(dialogHtml).toContain("data-project-move-dialog");
    expect(dialogHtml).toContain(ko.move);
    expect(dialogHtml).toContain("봄 향수");
    expect(dialogHtml).toContain("겨울 립");
    expect(dialogHtml).toContain(ko.unfiled);
    expect(dialogHtml).toContain("함께 만든 결과와 버전까지 4개가 옮겨져요.");
    expect(dialogHtml).toContain(ko.moveSubmit);
    expect(dialogHtml).toContain(ko.cancel);
    expect(dialogHtml.match(/data-variant="solid"/g)).toHaveLength(1);
  });
});
