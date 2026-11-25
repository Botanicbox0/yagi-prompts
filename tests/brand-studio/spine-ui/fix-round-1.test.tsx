import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudioBrandProject, StudioJobCreate, StudioJobGroupCreate } from "@/lib/brand-studio/contracts";
import {
  parseOpenProjectCookie,
  planGoneNoticeCleanup,
  planProjectSelection,
  rememberedOpenProject,
  resolveOpenProject,
} from "@/lib/brand-studio/open-project";
import {
  clearPressIds,
  groupPressFingerprint,
  resolvePressIds,
  singlePressFingerprint,
  type PressCache,
} from "@/components/brand-studio/use-dock";
import {
  applyScopedStudioAction,
  decideScopedLoadFailure,
  filterJobsForScope,
  isCurrentLoadSeq,
  planStudioLoad,
} from "@/components/brand-studio/use-studio";
import { initialStore } from "@/components/brand-studio/store";
import {
  createBrandProjectController,
  handlePickerKey,
} from "@/components/brand-studio/project-chip/model";
import { ProjectChip, ProjectSpineProvider } from "@/components/brand-studio/project-chip";
import { scopedLazyRequestId } from "@/components/brand-studio/video/workspace";
import { VideoProjectMenu, filmBarCopy } from "@/components/brand-studio/video/project-bar";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { ORG, id, job, studioState } from "../ui/fixtures";

const P1 = id(0xa1);
const P2 = id(0xa2);
const OTHER_ORG = id(0xa9);
const GONE = id(0xaf);
const FILM1 = id(0xb1);

const proj = (pid: string, title = "Spring launch"): StudioBrandProject => ({
  id: pid,
  title,
  origin: "self",
  lastActivityAt: "2026-11-25T10:00:00.000Z",
});

const sampleImageInput: StudioJobCreate = {
  kind: "image",
  organizationId: ORG,
  requestId: "probe-0",
  model: "seedream-5.5",
  prompt: "glass serum bottle on travertine",
  enhance: true,
  references: [],
  aspect: "4:5",
  resolution: "2K",
  count: 1,
};

const sampleGroupInput: StudioJobGroupCreate = {
  kind: "image",
  organizationId: ORG,
  requestId: "probe-group",
  prompt: "glass serum bottle on travertine",
  enhance: true,
  references: [],
  aspect: "4:5",
  resolution: "2K",
  count: 1,
  runs: [{ model: "seedream-5.5" }, { model: "nano-banana-pro" }],
};

describe("F1 (cost path): press fingerprints and idempotency keys survive project switch", () => {
  it("keeps single and group fingerprints byte-identical to main when spine is absent (brandProjectId === undefined)", () => {
    const legacySingle = JSON.stringify([sampleImageInput].map((inp) => ({ ...inp, requestId: null })));
    const legacyGroup = JSON.stringify({ ...sampleGroupInput, requestId: null });

    expect(singlePressFingerprint([sampleImageInput])).toBe(legacySingle);
    expect(singlePressFingerprint([sampleImageInput], undefined)).toBe(legacySingle);
    expect(groupPressFingerprint(sampleGroupInput)).toBe(legacyGroup);
    expect(groupPressFingerprint(sampleGroupInput, undefined)).toBe(legacyGroup);
  });

  it("reuses request ids across switching away and back for the same project, and allocates distinct ids for another project", () => {
    const cache: PressCache = new Map();
    let seq = 0;
    const makeId = () => `req_${++seq}`;

    const fpA = singlePressFingerprint([sampleImageInput], P1);
    const fpB = singlePressFingerprint([sampleImageInput], P2);
    const fpUnfiled = singlePressFingerprint([sampleImageInput], null);
    expect(fpA).not.toBe(fpB);
    expect(fpA).not.toBe(fpUnfiled);
    expect(fpB).not.toBe(fpUnfiled);

    // 1. Press in project A (answer lost -> cache not cleared).
    const idsA1 = resolvePressIds(cache, fpA, 1, makeId, P1);
    expect(idsA1).toEqual(["req_1"]);

    // 2. Switch to project B and press -> different ids.
    const idsB = resolvePressIds(cache, fpB, 1, makeId, P2);
    expect(idsB).toEqual(["req_2"]);

    // 3. Switch back to project A and retry same draft -> exact same request id as first press!
    const idsA2 = resolvePressIds(cache, fpA, 1, makeId, P1);
    expect(idsA2).toEqual(["req_1"]);

    // 4. After A succeeds, clearPressIds releases the key so a brand-new run gets a fresh id.
    clearPressIds(cache, P1);
    expect(resolvePressIds(cache, fpA, 1, makeId, P1)).toEqual(["req_3"]);

    // Group press behaves identically.
    const gCache: PressCache = new Map();
    const gA = groupPressFingerprint(sampleGroupInput, P1);
    const gB = groupPressFingerprint(sampleGroupInput, P2);
    expect(gA).not.toBe(gB);
    const gIdsA = resolvePressIds(gCache, gA, 1, makeId, P1);
    const gIdsB = resolvePressIds(gCache, gB, 1, makeId, P2);
    expect(gIdsA).not.toEqual(gIdsB);
    expect(resolvePressIds(gCache, gA, 1, makeId, P1)).toEqual(gIdsA);
  });

  it("keeps video studio lazy film requestId keyed by open scope across project switches", () => {
    const cache = new Map<string, string>();
    let n = 0;
    const makeId = () => `vp_${++n}`;

    const idA = scopedLazyRequestId(cache, P1, makeId);
    const idB = scopedLazyRequestId(cache, P2, makeId);
    const idUnfiled = scopedLazyRequestId(cache, null, makeId);
    expect(idA).toBe("vp_1");
    expect(idB).toBe("vp_2");
    expect(idUnfiled).toBe("vp_3");
    // Switching back to P1 keeps P1's idempotency key.
    expect(scopedLazyRequestId(cache, P1, makeId)).toBe("vp_1");
  });
});

describe("F2: late runs from another project do not land on the open scope's wall", () => {
  const jobA = job(1, { brandProjectId: P1, status: "succeeded" });
  const jobB = job(2, { brandProjectId: P2, status: "running" });
  const jobUnfiled = job(3, { brandProjectId: null, status: "succeeded" });

  it("filters jobs strictly by open scope when spine is active, and performs zero filtering when inactive", () => {
    const all = [jobA, jobB, jobUnfiled];
    expect(filterJobsForScope(all, undefined)).toBe(all);
    expect(filterJobsForScope(all, null)).toBe(all);
    expect(filterJobsForScope(all, { kind: "project", id: P1 }).map((j) => j.id)).toEqual([jobA.id]);
    expect(filterJobsForScope(all, { kind: "project", id: P2 }).map((j) => j.id)).toEqual([jobB.id]);
    expect(filterJobsForScope(all, { kind: "unfiled" }).map((j) => j.id)).toEqual([jobUnfiled.id]);
  });

  it("drops out-of-scope polled and jobAdded runs in the reducer path while keeping in-scope runs and allowance", () => {
    const baseState = studioState({ jobs: [jobB] });
    const store = initialStore(baseState);
    const openB = { kind: "project" as const, id: P2 };

    // Late poll for project A arrives while project B is open.
    const nextAllowance = { ...baseState.allowance, usedKrw: 1200 };
    const afterPoll = applyScopedStudioAction(
      store,
      { type: "polled", poll: { ok: true, jobs: [jobA, jobUnfiled], allowance: nextAllowance } },
      openB,
    );
    expect(afterPoll.phase).toBe("ready");
    if (afterPoll.phase === "ready") {
      expect(afterPoll.state.jobs.map((j) => j.id)).toEqual([jobB.id]);
      expect(afterPoll.state.allowance.usedKrw).toBe(1200);
    }

    // Late jobAdded from project A arrives while project B is open -> dropped completely.
    const afterLateAdd = applyScopedStudioAction(store, { type: "jobAdded", job: jobA }, openB);
    expect(afterLateAdd).toBe(store);

    // In-scope jobAdded for project B is accepted.
    const jobB2 = job(4, { brandProjectId: P2, status: "queued" });
    const afterInScopeAdd = applyScopedStudioAction(store, { type: "jobAdded", job: jobB2 }, openB);
    expect(afterInScopeAdd.phase).toBe("ready");
    if (afterInScopeAdd.phase === "ready") {
      expect(afterInScopeAdd.state.jobs.map((j) => j.id)).toContain(jobB2.id);
    }

    // Without spine (null): no filtering at all; jobA lands just like main.
    const withoutSpine = applyScopedStudioAction(store, { type: "jobAdded", job: jobA }, null);
    expect(withoutSpine.phase).toBe("ready");
    if (withoutSpine.phase === "ready") {
      expect(withoutSpine.state.jobs.map((j) => j.id)).toContain(jobA.id);
    }
  });
});

describe("F8.3, F8.4, F7: useStudio load plan, stale sequence guard, and not_found fallback", () => {
  it("plans exactly one unscoped load when not preloaded and none when preloaded without spine", () => {
    expect(planStudioLoad({ scopeParam: undefined, preloaded: { done: false, scope: undefined } })).toEqual({
      load: true,
      options: undefined,
    });
    expect(planStudioLoad({ scopeParam: undefined, preloaded: { done: true, scope: undefined } })).toEqual({
      load: false,
    });
  });

  it("skips initial scoped load when server preloaded the same scope, and reloads when scope switches", () => {
    expect(planStudioLoad({ scopeParam: P1, preloaded: { done: true, scope: P1 } })).toEqual({ load: false });
    expect(planStudioLoad({ scopeParam: P2, preloaded: { done: true, scope: P1 } })).toEqual({
      load: true,
      options: { brandProject: P2 },
    });
    expect(planStudioLoad({ scopeParam: "unfiled", preloaded: { done: true, scope: P1 } })).toEqual({
      load: true,
      options: { brandProject: "unfiled" },
    });
  });

  it("drops results from an older load sequence", () => {
    expect(isCurrentLoadSeq(3, 2)).toBe(false);
    expect(isCurrentLoadSeq(3, 3)).toBe(true);
  });

  it("falls back to unfiled with gone notice only when a scoped project load answers not_found", () => {
    expect(decideScopedLoadFailure({ spineOpen: { kind: "project", id: P1 }, code: "not_found" })).toEqual({
      action: "fallback_unfiled",
    });
    expect(decideScopedLoadFailure({ spineOpen: { kind: "unfiled" }, code: "not_found" })).toEqual({
      action: "dispatch_failed",
      code: "not_found",
    });
    expect(decideScopedLoadFailure({ spineOpen: { kind: "project", id: P1 }, code: "failed" })).toEqual({
      action: "dispatch_failed",
      code: "failed",
    });
    expect(decideScopedLoadFailure({ spineOpen: null, code: "not_found" })).toEqual({
      action: "dispatch_failed",
      code: "not_found",
    });
  });
});

describe("F3 & F8.5: gone notice cleanup (address vs cookie) and project selection planning", () => {
  it("tracks noticeSource accurately in resolveOpenProject", () => {
    const projects = [proj(P1)];
    expect(resolveOpenProject({ projects, queryProject: GONE, remembered: { kind: "project", id: P1 } })).toEqual({
      open: { kind: "unfiled" },
      notice: "gone",
      noticeSource: "address",
    });
    expect(resolveOpenProject({ projects, remembered: { kind: "project", id: GONE } })).toEqual({
      open: { kind: "unfiled" },
      notice: "gone",
      noticeSource: "cookie",
    });
    expect(resolveOpenProject({ projects, queryProject: P1 })).toEqual({
      open: { kind: "project", id: P1 },
      notice: null,
      noticeSource: null,
    });
  });

  it("strips ?project= from address without overwriting cookie when noticeSource is 'address', and rewrites cookie only when noticeSource is 'cookie'", () => {
    expect(
      planGoneNoticeCleanup({
        notice: "gone",
        noticeSource: "address",
        href: `https://brand.twings.app/brand/studio?organizationId=${ORG}&project=${GONE}&tab=create`,
      }),
    ).toEqual({
      writeUnfiledCookie: false,
      nextUrl: `https://brand.twings.app/brand/studio?organizationId=${ORG}&tab=create`,
    });

    expect(
      planGoneNoticeCleanup({
        notice: "gone",
        noticeSource: "cookie",
        href: `https://brand.twings.app/brand/studio?organizationId=${ORG}`,
      }),
    ).toEqual({
      writeUnfiledCookie: true,
      nextUrl: null,
    });

    expect(
      planGoneNoticeCleanup({
        notice: null,
        noticeSource: null,
        href: `https://brand.twings.app/brand/studio?organizationId=${ORG}&project=${P1}`,
      }),
    ).toEqual({
      writeUnfiledCookie: false,
      nextUrl: null,
    });
  });

  it("computes cookie value and next address when selecting a project or unfiled (other params preserved)", () => {
    const existing = parseOpenProjectCookie(`${OTHER_ORG}:${P2}|${ORG}:${P1}`);

    const pickedP2 = planProjectSelection({
      memory: existing,
      organizationId: ORG,
      next: { kind: "project", id: P2 },
      href: `https://brand.twings.app/brand/studio?organizationId=${ORG}&tab=create#wall`,
    });
    const parsedP2 = parseOpenProjectCookie(pickedP2.cookieValue);
    expect(rememberedOpenProject(parsedP2, ORG)).toEqual({ kind: "project", id: P2 });
    expect(rememberedOpenProject(parsedP2, OTHER_ORG)).toEqual({ kind: "project", id: P2 });
    expect(pickedP2.nextUrl).toBe(`https://brand.twings.app/brand/studio?organizationId=${ORG}&tab=create&project=${P2}#wall`);

    const pickedUnfiled = planProjectSelection({
      memory: parsedP2,
      organizationId: ORG,
      next: { kind: "unfiled" },
      href: `https://brand.twings.app/brand/studio?organizationId=${ORG}&project=${P2}&tab=create`,
    });
    expect(rememberedOpenProject(parseOpenProjectCookie(pickedUnfiled.cookieValue), ORG)).toEqual({ kind: "unfiled" });
    expect(pickedUnfiled.nextUrl).toBe(`https://brand.twings.app/brand/studio?organizationId=${ORG}&tab=create`);
  });
});

describe("F8.6: createBrandProjectController async flow", () => {
  const ko = getDictionary("ko").projectSpine;

  it("uses one requestId across a double submit, maps too_many_running and other errors, and prepends + opens on success", async () => {
    const sent: Array<{ title: string; requestId: string }> = [];
    let releaseFirst: ((v: { ok: false; code: "too_many_running" }) => void) | null = null;
    let callCount = 0;

    const api = vi.fn(async (input: { title: string; requestId: string }) => {
      sent.push(input);
      callCount += 1;
      if (callCount === 1) {
        return new Promise<{ ok: false; code: "too_many_running" }>((resolve) => {
          releaseFirst = resolve;
        });
      }
      if (callCount === 2) {
        return { ok: false as const, code: "failed" as const };
      }
      return { ok: true as const, project: proj(P2, input.title) };
    });

    let seq = 0;
    const ctrl = createBrandProjectController({
      initialProjects: [proj(P1, "Existing")],
      copy: ko,
      create: api,
      makeRequestId: () => `cr_${++seq}`,
    });

    // Double submit while first call is in flight -> only one API call with cr_1.
    const first = ctrl.submit("  새 캠페인  ");
    const duplicate = ctrl.submit("  새 캠페인  ");
    expect(await duplicate).toEqual({ ok: false, ignored: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ title: "새 캠페인", requestId: "cr_1" });

    // First fails with too_many_running -> dedicated createLimit line.
    releaseFirst!({ ok: false, code: "too_many_running" });
    expect(await first).toEqual({ ok: false, error: ko.createLimit });

    // Retry fails with generic error -> createFailed, STILL reuses cr_1.
    const second = await ctrl.submit("새 캠페인");
    expect(second).toEqual({ ok: false, error: ko.createFailed });
    expect(sent[1]).toEqual({ title: "새 캠페인", requestId: "cr_1" });

    // Retry succeeds -> still cr_1, project is prepended first in list and opened, key cleared.
    const third = await ctrl.submit("새 캠페인");
    expect(third.ok).toBe(true);
    expect(sent[2]).toEqual({ title: "새 캠페인", requestId: "cr_1" });
    expect(ctrl.getState().projects.map((p) => p.id)).toEqual([P2, P1]);
    expect(ctrl.getState().open).toEqual({ kind: "project", id: P2 });

    // Next form session gets a fresh requestId cr_2.
    await ctrl.submit("두 번째 프로젝트");
    expect(sent[3]!.requestId).toBe("cr_2");
  });
});

describe("F4, F6 & F7: picker keyboard function, accessibility markup, viewer 0-project state, VideoProjectMenu", () => {
  it("handles Escape, arrows, Home/End, and ignores Enter on empty search match", () => {
    // Escape in create form returns to list and focuses new-project row.
    expect(
      handlePickerKey(
        { creating: true, activeIndex: 0, entryCount: 3, inSearchInput: false, searchHasText: false, visibleProjectCount: 1, newRowIndex: 2 },
        "Escape",
      ),
    ).toEqual({ type: "exit_create", focusIndex: 2 });

    // Escape in list closes picker.
    expect(
      handlePickerKey(
        { creating: false, activeIndex: 1, entryCount: 3, inSearchInput: false, searchHasText: false, visibleProjectCount: 1, newRowIndex: 2 },
        "Escape",
      ),
    ).toEqual({ type: "close_picker" });

    // F4: Enter in search with text and 0 matching projects does NOTHING (never selects 미분류).
    expect(
      handlePickerKey(
        { creating: false, activeIndex: 0, entryCount: 2, inSearchInput: true, searchHasText: true, visibleProjectCount: 0, newRowIndex: 1 },
        "Enter",
      ),
    ).toEqual({ type: "none" });

    // Enter in search with matches activates the highlighted row.
    expect(
      handlePickerKey(
        { creating: false, activeIndex: 0, entryCount: 3, inSearchInput: true, searchHasText: true, visibleProjectCount: 1, newRowIndex: 2 },
        "Enter",
      ),
    ).toEqual({ type: "activate", index: 0 });

    // Arrows cycle; Home/End are ignored inside search input so text cursor still works.
    expect(
      handlePickerKey(
        { creating: false, activeIndex: 2, entryCount: 3, inSearchInput: false, searchHasText: false, visibleProjectCount: 1, newRowIndex: 2 },
        "ArrowDown",
      ),
    ).toEqual({ type: "move", nextIndex: 0 });
    expect(
      handlePickerKey(
        { creating: false, activeIndex: 1, entryCount: 3, inSearchInput: true, searchHasText: true, visibleProjectCount: 1, newRowIndex: 2 },
        "Home",
      ),
    ).toEqual({ type: "none" });
    expect(
      handlePickerKey(
        { creating: false, activeIndex: 1, entryCount: 3, inSearchInput: false, searchHasText: false, visibleProjectCount: 1, newRowIndex: 2 },
        "End",
      ),
    ).toEqual({ type: "move", nextIndex: 2 });
  });

  it("sets aria-controls only while listbox is rendered, uses roving tabIndex, and hides pickerEmpty for viewers with 0 projects", () => {
    const ko = getDictionary("ko").projectSpine;

    // Listbox open: aria-controls present; active row tabIndex=0, others tabIndex=-1.
    const openList = renderToStaticMarkup(
      <ProjectSpineProvider
        organizationId={ORG}
        locale="ko"
        copy={ko}
        initial={{ projects: [proj(P1), proj(P2)], open: { kind: "project", id: P1 }, canCreate: true, notice: null, noticeSource: null }}
      >
        <ProjectChip initialOpen />
      </ProjectSpineProvider>,
    );
    expect(openList).toContain("aria-controls=");
    expect(openList.match(/tabindex="0"/gi)).toHaveLength(1);
    expect((openList.match(/tabindex="-1"/gi) ?? []).length).toBe(3);

    // Create form replacing listbox: aria-controls MUST NOT be set.
    const openForm = renderToStaticMarkup(
      <ProjectSpineProvider
        organizationId={ORG}
        locale="ko"
        copy={ko}
        initial={{ projects: [proj(P1)], open: { kind: "project", id: P1 }, canCreate: true, notice: null, noticeSource: null }}
      >
        <ProjectChip initialOpen initialCreating />
      </ProjectSpineProvider>,
    );
    expect(openForm).toContain("data-project-new-form");
    expect(openForm).not.toContain("aria-controls=");

    // F7: Viewer with 0 projects -> no pickerEmpty, only viewerHint.
    const viewerZero = renderToStaticMarkup(
      <ProjectSpineProvider
        organizationId={ORG}
        locale="ko"
        copy={ko}
        initial={{ projects: [], open: { kind: "unfiled" }, canCreate: false, notice: null, noticeSource: null }}
      >
        <ProjectChip initialOpen />
      </ProjectSpineProvider>,
    );
    expect(viewerZero).not.toContain(ko.pickerEmpty);
    expect(viewerZero).toContain(ko.viewerHint);
    expect(viewerZero).not.toContain("data-project-new");
  });

  it("renders VideoProjectMenu directly with filmBarCopy without any test-only prop on VideoProjectBar", () => {
    const dict = getDictionary("ko");
    const copy = filmBarCopy(dict.studioVideo.workspace.projects, dict.projectSpine);
    const html = renderToStaticMarkup(
      <VideoProjectMenu
        canEdit
        projectId={FILM1}
        projects={[
          {
            id: FILM1,
            organizationId: ORG,
            title: "Cut A",
            status: "active",
            aspect: "9:16",
            revision: 1,
            clipCount: 2,
            durationSec: 8,
            thumbUrl: null,
            completedAt: null,
            createdAt: "2026-11-25T09:00:00.000Z",
            updatedAt: "2026-11-25T10:00:00.000Z",
            brandProjectId: P1,
          },
        ]}
        copy={copy}
        onSelectProject={() => {}}
        onStartNewProject={() => {}}
        onDeleteProject={() => {}}
      />,
    );
    expect(html).toContain(">내 편집본<");
    expect(html).toContain(">+ 새 편집본<");
    expect(html).toContain(">편집본 삭제<");
    expect(html).toContain(`data-video-project-option="${FILM1}"`);
  });
});
