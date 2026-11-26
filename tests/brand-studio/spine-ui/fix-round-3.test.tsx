import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BRAND_PROJECT_LIMITS, type StudioBrandProject } from "@/lib/brand-studio/contracts";
import type { StudioSpineProps } from "@/lib/brand-studio/open-project";
import { createStudioApi } from "@/components/brand-studio/api";
import { exportRecordInput } from "@/components/brand-studio/editor-v2/export-record";
import { resolveSoundRequestId, clearSoundRequestId } from "@/components/brand-studio/sound/sound-studio";
import type { PressCache } from "@/components/brand-studio/use-dock";
import {
  MoveToProjectDialog,
  ProjectSpineProvider,
  handleNotFoundForOpenProject,
  removeProjectFromList,
} from "@/components/brand-studio/project-chip";
import { selectedMoveJobIds } from "@/components/brand-studio/gallery/selection";
import { Wall } from "@/components/brand-studio/gallery/wall";
import type { StudioLibrary } from "@/components/brand-studio/seams";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { ORG, asset, id, job, output } from "../ui/fixtures";

const P1 = id(0xf1);
const P2 = id(0xf2);

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

describe("H1 (cost path): sound studio press key is content-independent single slot without spine, one content-independent slot per scope with spine", () => {
  type SoundStep = { kind: "press" } | { kind: "ok" } | { kind: "refused" };

  // Reference implementation of `main`'s `draftRequest.current ??= newRequestId()`.
  function runOldSoundSlot(steps: readonly SoundStep[]): Array<string | null> {
    let slot: string | null = null;
    let seq = 0;
    const makeId = () => `snd_${++seq}`;
    return steps.map((step) => {
      if (step.kind === "ok" || step.kind === "refused") {
        slot = null;
        return null;
      }
      slot ??= makeId();
      return slot;
    });
  }

  function runNewSoundWithoutSpine(steps: readonly SoundStep[]): Array<string | null> {
    const cache: PressCache = new Map();
    let seq = 0;
    const makeId = () => `snd_${++seq}`;
    return steps.map((step) => {
      if (step.kind === "ok" || step.kind === "refused") {
        clearSoundRequestId(cache, undefined);
        return null;
      }
      return resolveSoundRequestId(cache, undefined, makeId);
    });
  }

  it("matches main's single ??= slot row-for-row without spine (including retry after typo edit)", () => {
    const steps: SoundStep[] = [
      { kind: "press" },
      { kind: "press" }, // answer lost -> fix typo -> retry keeps exact same id!
      { kind: "ok" },
      { kind: "press" },
      { kind: "refused" },
      { kind: "press" },
    ];
    expect(runNewSoundWithoutSpine(steps)).toEqual(runOldSoundSlot(steps));
  });

  it("keeps one content-independent slot per scope under the spine", () => {
    const cache: PressCache = new Map();
    let seq = 0;
    const makeId = () => `snd_${++seq}`;

    // Press in A (lost), fix typo and retry in A -> SAME id (content-independent!).
    expect(resolveSoundRequestId(cache, P1, makeId)).toBe("snd_1");
    expect(resolveSoundRequestId(cache, P1, makeId)).toBe("snd_1");
    // Switch to B -> B gets its own slot.
    expect(resolveSoundRequestId(cache, P2, makeId)).toBe("snd_2");
    // Switch to unfiled -> unfiled gets its own slot.
    expect(resolveSoundRequestId(cache, null, makeId)).toBe("snd_3");
    // Back to A -> still snd_1 until cleared!
    expect(resolveSoundRequestId(cache, P1, makeId)).toBe("snd_1");
    clearSoundRequestId(cache, P1);
    expect(resolveSoundRequestId(cache, P1, makeId)).toBe("snd_4");
    // B was unaffected.
    expect(resolveSoundRequestId(cache, P2, makeId)).toBe("snd_2");
  });
});

describe("H2: editor export captures brandProjectId explicitly without hidden module-scoped registries", () => {
  it("builds render.reserve input from the captured project id (kept even if open project changes later) and matches main's literal object without it", () => {
    // Without brandProjectId: exact main literal object.
    const capturedNone = exportRecordInput(ORG, 240, 24);
    expect(Object.keys(capturedNone).sort()).toEqual(["durationSec", "organizationId", "requestId"]);
    expect(capturedNone.organizationId).toBe(ORG);
    expect(capturedNone.durationSec).toBe(10);

    // Export started in project A captures A; switching open project to B before recording still files in A.
    const capturedA = P1;
    const inputForA = exportRecordInput(ORG, 240, 24, capturedA);
    expect(inputForA.brandProjectId).toBe(P1);
  });

  it("never falls back to any hidden registry in api.upload when caller omits brandProjectId", async () => {
    const file = Object.assign(new Blob(["mp4"], { type: "video/mp4" }), { name: "cut.mp4" });
    const calls: string[] = [];
    const fetchStub = vi.fn(async (_url: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push(String(init.body ?? ""));
      const idx = calls.length % 3;
      if (idx === 1) return new Response(JSON.stringify({ ok: true, id: asset(1).id, direct: false }), { status: 200 });
      if (idx === 2) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, asset: asset(1, { kind: "video" }) }), { status: 200 });
    });
    const api = createStudioApi({ organizationId: ORG, fetch: fetchStub as unknown as typeof globalThis.fetch });

    await api.upload(file, { requestId: "up_11111111" });
    expect("brandProjectId" in (JSON.parse(calls[0]!) as { input: Record<string, unknown> }).input).toBe(false);

    await api.upload(file, { requestId: "up_22222222", brandProjectId: P1 });
    expect((JSON.parse(calls[3]!) as { input: Record<string, unknown> }).input.brandProjectId).toBe(P1);
  });
});

describe("H3: MoveToProjectDialog uses native <dialog class='bs-dialog'> and native radios, no glass", () => {
  it("renders native <dialog class='bs-dialog'>, native radio inputs, family count, and one solid submit button", () => {
    const ko = getDictionary("ko").projectSpine;
    const html = renderToStaticMarkup(
      <MoveToProjectDialog
        projects={[sampleProject(P1, "봄 향수"), sampleProject(P2, "겨울 립")]}
        currentScope={{ kind: "project", id: P1 }}
        jobIds={[job(1).id]}
        locale="ko"
        copy={ko}
        initialFamilyCount={3}
        onMove={async () => ({ ok: true, projectId: P2, jobIds: [job(1).id], assetIds: [], filmIds: [] })}
        onMoved={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain('<dialog class="bs-dialog"');
    expect(html).toContain("data-project-move-dialog");
    expect(html).toContain('class="bs-dialog-body"');
    expect(html).toContain('type="radio"');
    expect(html).toContain("함께 만든 결과와 버전까지 3개가 옮겨져요.");
    expect(html.match(/data-variant="solid"/g)).toHaveLength(1);
    expect(html).not.toContain("scrim");
  });
});

describe("H5: making request answering not_found checks project.list once and marks project gone when missing", () => {
  it("calls markProjectGone and returns true when open project is absent from project.list", async () => {
    const onProjectGone = vi.fn();
    const listProjects = vi.fn(async () => ({ ok: true as const, projects: [sampleProject(P2)] }));

    const handled = await handleNotFoundForOpenProject({
      code: "not_found",
      openProjectId: P1,
      listProjects,
      onProjectGone,
    });
    expect(handled).toBe(true);
    expect(listProjects).toHaveBeenCalledTimes(1);
    expect(onProjectGone).toHaveBeenCalledWith(P1);

    // markProjectGone removes the closed project from the picker list so it cannot be picked again.
    const remaining = removeProjectFromList([sampleProject(P1), sampleProject(P2)], P1.toUpperCase());
    expect(remaining.map((p) => p.id)).toEqual([P2]);
  });

  it("returns false without calling markProjectGone when open project is still listed, code is not not_found, or no project is open", async () => {
    const onProjectGone = vi.fn();
    const listStillThere = vi.fn(async () => ({ ok: true as const, projects: [sampleProject(P1)] }));

    expect(
      await handleNotFoundForOpenProject({
        code: "not_found",
        openProjectId: P1,
        listProjects: listStillThere,
        onProjectGone,
      }),
    ).toBe(false);
    expect(listStillThere).toHaveBeenCalledTimes(1);
    expect(onProjectGone).not.toHaveBeenCalled();

    const listUnused = vi.fn(async () => ({ ok: true as const, projects: [] }));
    expect(
      await handleNotFoundForOpenProject({
        code: "failed",
        openProjectId: P1,
        listProjects: listUnused,
        onProjectGone,
      }),
    ).toBe(false);
    expect(
      await handleNotFoundForOpenProject({
        code: "not_found",
        openProjectId: null,
        listProjects: listUnused,
        onProjectGone,
      }),
    ).toBe(false);
    expect(listUnused).not.toHaveBeenCalled();
  });
});

describe("H6: more than 200 selected runs disables move button with moveTooMany hint and screen-reader text", () => {
  it("reports overLimit when more than 200 unique runs are selected and renders disabled move button with moveTooMany", () => {
    const ko = getDictionary("ko").projectSpine;
    const en = getDictionary("en").projectSpine;
    expect(ko.moveTooMany).toBe("한 번에 200개까지 옮길 수 있어요.");
    expect(en.moveTooMany).toBe("You can move up to 200 at a time.");

    const jobs201 = Array.from({ length: BRAND_PROJECT_LIMITS.moveMax + 1 }, (_, i) =>
      job(i + 1, { outputs: [output(i + 1)] }),
    );
    const targets = {
      items: jobs201.map((j, i) => ({ job: j, output: output(i + 1) })),
      failed: [],
    };
    const sel = selectedMoveJobIds(targets);
    expect(sel.overLimit).toBe(true);
    expect(sel.jobIds).toHaveLength(BRAND_PROJECT_LIMITS.moveMax + 1);

    const spine: StudioSpineProps = {
      projects: [sampleProject(P1)],
      open: { kind: "project", id: P1 },
      canCreate: true,
      notice: null,
      noticeSource: null,
    };
    const html = renderToStaticMarkup(
      <ProjectSpineProvider organizationId={ORG} locale="ko" copy={ko} initial={spine}>
        <Wall
          mode="image"
          jobs={jobs201}
          copy={getDictionary("ko").brandStudio}
          locale="ko"
          canGenerate
          canEdit
          library={stubLibrary}
          parentOf={() => null}
          onAction={() => {}}
          onRetry={() => {}}
          onNotice={() => {}}
          onMoveJobs={() => {}}
          initialSelection={jobs201.map((_, i) => `o:${output(i + 1).id}`)}
        />
      </ProjectSpineProvider>,
    );
    expect(html).toContain("data-project-move");
    expect(html).toContain(`title="${ko.moveTooMany}"`);
    expect(html).toContain(`>${ko.moveTooMany}</span>`);
    expect(html).toMatch(/data-bulk="project-move"[^>]*disabled=""/);
  });
});
