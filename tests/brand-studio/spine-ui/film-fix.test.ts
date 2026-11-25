/**
 * Junk 편집본 defect (production, spine on): opening the video studio in an empty brand project and pressing the
 * film switcher saved a film nobody made: title "새 편집본", ONE clip (an old unfiled `video_final` with an empty
 * prompt), `brand_project_id` NULL.
 *
 * Root cause pinned here: the video workspace treated every run id that was not in its FIRST list as "made in this
 * session" and put the run's video straight into the sequence, which lazily created a film. Any later list that
 * holds runs this page never started (another scope after a chip switch, another member, another tab, a reload)
 * therefore produced a film. The film create took its project from the render that ran the add, not from the
 * member's action.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { StudioJobView } from "@/lib/brand-studio/contracts";
import type { OpenProject } from "@/lib/brand-studio/open-project";
import { createStartedRuns } from "@/components/brand-studio/started-runs";
import { collectSessionRunAdds, createSessionRunBook } from "@/components/brand-studio/video/session-runs";
import { filmCreateTarget, videoFilmCreateBody } from "@/components/brand-studio/video/workspace";
import { ORG, id, job, output } from "../ui/fixtures";

const P = id(0xc1);
const OTHER = id(0xc2);
const PROJECT: OpenProject = { kind: "project", id: P };
const UNFILED: OpenProject = { kind: "unfiled" };
const UNTITLED = "새 편집본";

/** The production run: a 1080p final of an unfiled draft, empty prompt, 4.1 s, made days ago by the member. */
function oldUnfiledFinal(): StudioJobView {
  return job(1, {
    kind: "video_final",
    prompt: "",
    status: "succeeded",
    brandProjectId: null,
    outputs: [output(1, { kind: "video", seconds: 4.1, jobId: id(0x2001) })],
  });
}

function videoRun(n: number, patch: Partial<StudioJobView> = {}): StudioJobView {
  return job(n, {
    kind: "video",
    prompt: `영상 ${n}`,
    status: "succeeded",
    outputs: [output(n, { kind: "video", seconds: 5, jobId: id(0x2000 + n) })],
    ...patch,
  });
}

describe("(a)+(b) runs that merely arrive in the list are never put into the sequence (spine on)", () => {
  it("project open, no film, nothing added by the member: an unfiled run arriving later adds nothing", () => {
    const book = createSessionRunBook();
    const started = createStartedRuns();
    // First list: the empty project's runs.
    expect(collectSessionRunAdds(book, { jobs: [], selectedClipId: null, untitled: UNTITLED, startedHere: started.has, open: PROJECT })).toEqual([]);
    // Later list (any path: a reload, a stale answer, another scope) holding the old unfiled final.
    const adds = collectSessionRunAdds(book, {
      jobs: [oldUnfiledFinal()],
      selectedClipId: null,
      untitled: UNTITLED,
      startedHere: started.has,
      open: PROJECT,
    });
    expect(adds).toEqual([]);
  });

  it("a client-side switch to 미분류 (the reproduced path) loads unfiled runs the page never started: nothing is added", () => {
    const book = createSessionRunBook();
    const started = createStartedRuns();
    collectSessionRunAdds(book, { jobs: [], selectedClipId: null, untitled: UNTITLED, startedHere: started.has, open: PROJECT });
    const unfiled = [oldUnfiledFinal(), videoRun(2, { brandProjectId: null }), videoRun(3, { brandProjectId: null })];
    expect(
      collectSessionRunAdds(book, { jobs: unfiled, selectedClipId: null, untitled: UNTITLED, startedHere: started.has, open: UNFILED }),
    ).toEqual([]);
  });

  it("a run this page started in the open project joins the sequence once, when it lands", () => {
    const book = createSessionRunBook();
    const started = createStartedRuns();
    collectSessionRunAdds(book, { jobs: [], selectedClipId: null, untitled: UNTITLED, startedHere: started.has, open: PROJECT });
    const run = videoRun(4, { status: "running", outputs: [], brandProjectId: P });
    started.markJobs([run]);
    expect(collectSessionRunAdds(book, { jobs: [run], selectedClipId: null, untitled: UNTITLED, startedHere: started.has, open: PROJECT })).toEqual([]);
    const landed = videoRun(4, { brandProjectId: P });
    const adds = collectSessionRunAdds(book, { jobs: [landed], selectedClipId: null, untitled: UNTITLED, startedHere: started.has, open: PROJECT });
    expect(adds).toEqual([{ jobId: landed.id, output: landed.outputs[0], label: "영상 4", stackIntoClipId: null }]);
    // Later lists do not add it again.
    expect(collectSessionRunAdds(book, { jobs: [landed], selectedClipId: null, untitled: UNTITLED, startedHere: started.has, open: PROJECT })).toEqual([]);
  });

  it("a run the reverse panel announced (STUDIO_JOB_STARTED with its id) counts as started here", () => {
    const book = createSessionRunBook();
    const started = createStartedRuns();
    collectSessionRunAdds(book, { jobs: [], selectedClipId: null, untitled: UNTITLED, startedHere: started.has, open: UNFILED });
    const run = videoRun(5, { brandProjectId: null, prompt: "" });
    started.markAnnounced({ jobId: run.id });
    started.markAnnounced(undefined);
    started.markAnnounced({ jobId: 42 });
    const adds = collectSessionRunAdds(book, { jobs: [run], selectedClipId: null, untitled: UNTITLED, startedHere: started.has, open: UNFILED });
    expect(adds.map((a) => [a.jobId, a.label])).toEqual([[run.id, UNTITLED]]);
  });

  it("a run started here that the list already held before it was marked is still added when it lands", () => {
    const book = createSessionRunBook();
    const started = createStartedRuns();
    collectSessionRunAdds(book, { jobs: [], selectedClipId: null, untitled: UNTITLED, startedHere: started.has, open: PROJECT });
    const run = videoRun(6, { status: "queued", outputs: [], brandProjectId: P });
    // A reload answered before the create call returned: the run is in the list, not yet marked.
    collectSessionRunAdds(book, { jobs: [run], selectedClipId: null, untitled: UNTITLED, startedHere: started.has, open: PROJECT });
    started.markJobs([run]);
    const landed = videoRun(6, { brandProjectId: P });
    expect(
      collectSessionRunAdds(book, { jobs: [landed], selectedClipId: null, untitled: UNTITLED, startedHere: started.has, open: PROJECT }).length,
    ).toBe(1);
  });

  it("a run started here that belongs to another scope is never added to this scope's film", () => {
    const book = createSessionRunBook();
    const started = createStartedRuns();
    collectSessionRunAdds(book, { jobs: [], selectedClipId: null, untitled: UNTITLED, startedHere: started.has, open: PROJECT });
    const elsewhere = videoRun(7, { brandProjectId: OTHER });
    started.markJobs([elsewhere]);
    expect(
      collectSessionRunAdds(book, { jobs: [elsewhere], selectedClipId: null, untitled: UNTITLED, startedHere: started.has, open: PROJECT }),
    ).toEqual([]);
    // Back in its own project, it joins that project's sequence.
    expect(
      collectSessionRunAdds(book, {
        jobs: [elsewhere],
        selectedClipId: null,
        untitled: UNTITLED,
        startedHere: started.has,
        open: { kind: "project", id: OTHER },
      }).length,
    ).toBe(1);
  });

  it("stacks a started run onto the clip that was selected when the run first appeared", () => {
    const book = createSessionRunBook();
    const started = createStartedRuns();
    collectSessionRunAdds(book, { jobs: [], selectedClipId: "clip_a", untitled: UNTITLED, startedHere: started.has, open: PROJECT });
    const run = videoRun(8, { status: "running", outputs: [], brandProjectId: P });
    started.markJobs([run]);
    collectSessionRunAdds(book, { jobs: [run], selectedClipId: "clip_a", untitled: UNTITLED, startedHere: started.has, open: PROJECT });
    const adds = collectSessionRunAdds(book, {
      jobs: [videoRun(8, { brandProjectId: P })],
      selectedClipId: "clip_b",
      untitled: UNTITLED,
      startedHere: started.has,
      open: PROJECT,
    });
    expect(adds[0]?.stackIntoClipId).toBe("clip_a");
  });
});

describe("(review) a landed run joins only the film that was open, or being created, when it was started (spine on)", () => {
  const F = "film_f";
  const G = "film_g";
  const film = (id: string | null, context: number, creating = false) => ({ id, context, creating });
  const base = { untitled: UNTITLED, selectedClipId: null };

  it("started in A with F open, chip to B, run lands, back in A with no film open: nothing is added, nothing is created", () => {
    const book = createSessionRunBook();
    const started = createStartedRuns();
    collectSessionRunAdds(book, { ...base, jobs: [], startedHere: started.has, open: PROJECT, film: film(F, 1) });
    const run = videoRun(20, { status: "running", outputs: [], brandProjectId: P });
    started.markJobs([run]);
    collectSessionRunAdds(book, { ...base, jobs: [run], startedHere: started.has, open: PROJECT, film: film(F, 1) });
    // Chip to B: F leaves the screen (context bumped); the run is not in B's list and lands meanwhile.
    collectSessionRunAdds(book, { ...base, jobs: [], startedHere: started.has, open: { kind: "project", id: OTHER }, film: film(null, 2) });
    // Back in A, no film open.
    const landed = videoRun(20, { brandProjectId: P });
    expect(collectSessionRunAdds(book, { ...base, jobs: [landed], startedHere: started.has, open: PROJECT, film: film(null, 2) })).toEqual([]);
    // Dropped for good: a film opened later in A does not pick it up either.
    expect(collectSessionRunAdds(book, { ...base, jobs: [landed], startedHere: started.has, open: PROJECT, film: film(G, 3) })).toEqual([]);
    expect(book.targets.has(run.id)).toBe(false);
  });

  it("started in A with F open and F still open when it lands: added to F (as today)", () => {
    const book = createSessionRunBook();
    const started = createStartedRuns();
    collectSessionRunAdds(book, { ...base, jobs: [], startedHere: started.has, open: PROJECT, film: film(F, 1) });
    const run = videoRun(21, { status: "running", outputs: [], brandProjectId: P });
    started.markJobs([run]);
    collectSessionRunAdds(book, { ...base, jobs: [run], startedHere: started.has, open: PROJECT, film: film(F, 1) });
    const landed = videoRun(21, { brandProjectId: P });
    expect(collectSessionRunAdds(book, { ...base, jobs: [landed], startedHere: started.has, open: PROJECT, film: film(F, 1) }).length).toBe(1);
  });

  it("started while the film is being created: waits for the create, then joins the film it answered with", () => {
    const book = createSessionRunBook();
    const started = createStartedRuns();
    collectSessionRunAdds(book, { ...base, jobs: [], startedHere: started.has, open: PROJECT, film: film(null, 4) });
    const run = videoRun(22, { status: "queued", outputs: [], brandProjectId: P });
    started.markJobs([run]);
    // Claimed before the after-run create (no film, nothing in flight yet).
    collectSessionRunAdds(book, { ...base, jobs: [run], startedHere: started.has, open: PROJECT, film: film(null, 4) });
    const landed = videoRun(22, { brandProjectId: P });
    // Lands while the create is still in flight: it waits.
    expect(collectSessionRunAdds(book, { ...base, jobs: [landed], startedHere: started.has, open: PROJECT, film: film(null, 4, true) })).toEqual([]);
    // The create answered with F in the same context: added to F.
    expect(collectSessionRunAdds(book, { ...base, jobs: [landed], startedHere: started.has, open: PROJECT, film: film(F, 4) }).length).toBe(1);
  });

  it("started with no film whose create never became the open film (create failed or not adopted): dropped, no film", () => {
    const book = createSessionRunBook();
    const started = createStartedRuns();
    collectSessionRunAdds(book, { ...base, jobs: [], startedHere: started.has, open: PROJECT, film: film(null, 5) });
    const run = videoRun(23, { status: "running", outputs: [], brandProjectId: P });
    started.markJobs([run]);
    collectSessionRunAdds(book, { ...base, jobs: [run], startedHere: started.has, open: PROJECT, film: film(null, 5) });
    const landed = videoRun(23, { brandProjectId: P });
    expect(collectSessionRunAdds(book, { ...base, jobs: [landed], startedHere: started.has, open: PROJECT, film: film(null, 5) })).toEqual([]);
    expect(book.targets.has(run.id)).toBe(false);
  });

  it("a claimed run that ends failed, cancelled or with nothing drops its target", () => {
    for (const end of [
      { status: "failed" as const, outputs: [] },
      { status: "canceled" as const, outputs: [] },
      { status: "succeeded" as const, outputs: [] },
    ]) {
      const book = createSessionRunBook();
      const started = createStartedRuns();
      collectSessionRunAdds(book, { ...base, jobs: [], startedHere: started.has, open: PROJECT, film: film(F, 1) });
      const run = videoRun(24, { status: "running", outputs: [], brandProjectId: P });
      started.markJobs([run]);
      collectSessionRunAdds(book, { ...base, jobs: [run], startedHere: started.has, open: PROJECT, film: film(F, 1) });
      expect(book.targets.has(run.id)).toBe(true);
      collectSessionRunAdds(book, { ...base, jobs: [videoRun(24, { ...end, brandProjectId: P })], startedHere: started.has, open: PROJECT, film: film(F, 1) });
      expect(book.targets.has(run.id)).toBe(false);
    }
  });
});

describe("flag-off parity: without the spine the rule stays main's (first list seeds, later ids are session runs)", () => {
  it("keeps a failed run's target and needs no open film, as main does", () => {
    const book = createSessionRunBook();
    collectSessionRunAdds(book, { jobs: [], selectedClipId: null, untitled: "새 프로젝트" });
    const failed = videoRun(30, { status: "failed", outputs: [] });
    collectSessionRunAdds(book, { jobs: [failed], selectedClipId: null, untitled: "새 프로젝트" });
    expect(book.targets.has(failed.id)).toBe(true);
    const landed = videoRun(31);
    expect(collectSessionRunAdds(book, { jobs: [landed], selectedClipId: null, untitled: "새 프로젝트" }).length).toBe(1);
  });

  it("never adds the first list's runs, and adds a run id that appears later, exactly as main does", () => {
    const book = createSessionRunBook();
    const first = [videoRun(1)];
    expect(collectSessionRunAdds(book, { jobs: first, selectedClipId: null, untitled: "새 프로젝트" })).toEqual([]);
    const later = videoRun(2, { prompt: "" });
    const adds = collectSessionRunAdds(book, { jobs: [later, ...first], selectedClipId: null, untitled: "새 프로젝트" });
    expect(adds.map((a) => [a.jobId, a.label, a.stackIntoClipId])).toEqual([[later.id, "새 프로젝트", null]]);
  });
});

describe("(c) a film created while a project is open carries that project", () => {
  it("takes the project from the member's action, not from the render that runs the save", () => {
    const target = filmCreateTarget({ spineActive: true, actionScope: PROJECT });
    expect(target).toEqual({ brandProjectId: P, scopeKey: P.toLowerCase(), sentScope: PROJECT });
    const body = videoFilmCreateBody({
      organizationId: ORG,
      requestId: "vp_test",
      locale: "ko",
      timeline: { version: 1, aspect: "9:16", clips: [] } as never,
      brandProjectId: target.brandProjectId,
    });
    expect(body).toMatchObject({ op: "create", brandProjectId: P });
  });

  it("files 미분류 only when 미분류 was open at the action", () => {
    const target = filmCreateTarget({ spineActive: true, actionScope: UNFILED });
    expect(target).toEqual({ brandProjectId: null, scopeKey: "__unfiled__", sentScope: UNFILED });
  });

  it("without the spine the create body is main's (no brandProjectId key, legacy request-id slot)", () => {
    const target = filmCreateTarget({ spineActive: false, actionScope: undefined });
    expect(target).toEqual({ brandProjectId: undefined, scopeKey: "__legacy__", sentScope: undefined });
    const body = videoFilmCreateBody({
      organizationId: ORG,
      requestId: "vp_test",
      locale: "ko",
      timeline: { version: 1, aspect: "9:16", clips: [] } as never,
      brandProjectId: target.brandProjectId ?? null,
    });
    expect("brandProjectId" in body).toBe(false);
  });
});

describe("wiring (no DOM here: the workspace and useStudio sources are read)", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
  const between = (src: string, from: string, to: string) => {
    const start = src.indexOf(from);
    const end = src.indexOf(to, start + from.length);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  };
  const workspace = read("components/brand-studio/video/workspace.tsx");
  const useStudio = read("components/brand-studio/use-studio.ts");

  it("the lazy film create files the film by the captured action scope, never by the render's open project", () => {
    const create = between(workspace, "const ensureLazyProjectCreated = useCallback(", "const sendFilmSave = useCallback(");
    expect(create).toContain("filmCreateTarget({ spineActive, actionScope: opts.actionScope ?? spineOpenRef.current })");
    expect(create).toContain("brandProjectId: targetBrandProjectId");
    expect(create).not.toContain("openBrandProjectId");
  });

  it("a clip add, a dropped file and an accepted run pass the scope they were made in", () => {
    const add = between(workspace, "const addVideoOutputToSequence = useCallback(", "// Detect newly started");
    expect(add).toContain("const actionScope = spineOpenRef.current;");
    expect(add).toContain("scheduleProjectSave(next, undefined, actionScope)");
    const drop = between(workspace, "const handleLocalSequenceFiles = useCallback(", "// Allow Ctrl+V");
    expect(drop).toContain("scheduleProjectSave(next, undefined, actionScope)");
    expect(workspace).toContain("const actionScope = spineOpenRef.current;\n");
    expect(workspace).toContain("setAfterRun({ firstPrompt: submittedPrompt, context, refsChanged, ...(actionScope ? { actionScope } : {}) })");
  });

  it("the landed-run effect asks which runs this page started only with the spine (main's rule without it)", () => {
    const effect = between(workspace, "// Detect newly started", "// Refresh gallery when a job starts");
    expect(effect).toContain("collectSessionRunAdds(sessionRunsRef.current");
    expect(effect).toContain(
      "...(spineActive ? { startedHere: wasStartedHere, open: spineOpenRef.current, film: filmForLandedRuns() } : {})",
    );
    // Re-read when the film a waiting run belongs to is answered (spine only; a constant without it).
    expect(effect).toContain("const landedRunsFilmId = spineActive ? projectId : null;");
    expect(effect).toMatch(/\[addVideoOutputToSequence, filmForLandedRuns, jobs, landedRunsFilmId,/);
  });

  it("useStudio marks its own create answers and announced runs, before the run reaches the list", () => {
    expect(useStudio).toMatch(/started\.markJobs\(\[result\.job\]\);\s*dispatch\(\{ type: "jobAdded"/);
    expect(useStudio).toMatch(/started\.markJobs\(result\.jobs\);\s*for \(const job of result\.jobs\) dispatch/);
    expect(useStudio).toMatch(/started\.markAnnounced\(\(event as CustomEvent\)\.detail\);\s*void load\(\);/);
  });
});
