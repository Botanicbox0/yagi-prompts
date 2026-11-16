import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudioJobCreate } from "@/lib/brand-studio/contracts";
import { BrandAssetHub, buildHubEntries, groupByProject, hubActions } from "@/components/brand-studio/asset-hub";
import { familySize, jobFamily } from "@/components/brand-studio/asset-hub-model";
import { ProjectPickDialog } from "@/components/brand-studio/asset-hub-project";
import type { StudioLibrary } from "@/components/brand-studio/seams";
import { initialStore, studioReducer } from "@/components/brand-studio/store";
import { StudioApp } from "@/components/brand-studio/studio-app";
import { jobInputForProject } from "@/components/brand-studio/use-studio";
import { ImageProjectBar } from "@/components/brand-studio/video/project-bar";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { ORG, asset, id, job, output, studioState } from "./fixtures";

/**
 * Runs in projects on the screens (`BRAND_STUDIO_PROJECTS`, docs/BRAND-STUDIO-V6-PLAN.md §7 C).
 * The server opens the feature by putting `projects` in the studio state; without that key every screen
 * and every request is what it was. These tests hold both halves.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/brand/studio",
  useSearchParams: () => new URLSearchParams(),
}));

const P1 = id(0x51);
const P2 = id(0x52);
const library: StudioLibrary = {
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
const imageInput = { kind: "image", organizationId: ORG, requestId: "req_1", model: "seedream-5.5", prompt: "a bottle", enhance: true, references: [], aspect: "4:5", resolution: "2K", count: 1 } as StudioJobCreate;

describe("closed: no `projects` in the studio state", () => {
  it("sends job.create exactly as before, and only fresh runs ever carry a project", () => {
    // Closed or nothing chosen: the same object, not a copy with an empty field.
    expect(jobInputForProject(imageInput, null)).toBe(imageInput);
    expect(jobInputForProject(imageInput, P1)).toEqual({ ...imageInput, projectId: P1 });
    // A 1080p finish and a new version name no project (the server gives them their source's).
    const final = { kind: "video_final", organizationId: ORG, requestId: "req_2", draftOutputId: output(1).id } as StudioJobCreate;
    const revise = { kind: "video_revise", organizationId: ORG, requestId: "req_3", outputId: output(1).id, mode: "edit", prompt: "bluer" } as StudioJobCreate;
    expect(jobInputForProject(final, P1)).toBe(final);
    expect(jobInputForProject(revise, P1)).toBe(revise);
  });

  it.each(["ko", "en"] as const)("draws the image studio exactly as before: no project bar, no chip in the prompt bar (%s)", (locale) => {
    const dict = getDictionary(locale);
    const base = { organizationId: ORG, locale, copy: dict.brandStudio, mode: "image" as const, libraryCopy: dict.studioLibrary, layersCopy: dict.studioLayers };
    const state0 = studioState({ canCreate: true, jobs: [job(1, { outputs: [output(1)] })] });
    const before = renderToStaticMarkup(<StudioApp {...base} initialState={state0} />);
    expect(before).not.toContain("data-studio-project-bar");
    expect(before).not.toContain("data-studio-dock-project");
    // The words alone open nothing: the server has to say projects are open.
    expect(renderToStaticMarkup(<StudioApp {...base} projectsCopy={dict.studioVideo.workspace.projects} initialState={state0} />)).toBe(before);
    // … and the server's list alone opens nothing on a page that was not handed the words (flag off at render).
    expect(renderToStaticMarkup(<StudioApp {...base} initialState={{ ...state0, projects: [{ id: P1, title: "Spring film" }] }} />)).toBe(before);
    // The video screen keeps its own bar and never gets this one.
    const video = renderToStaticMarkup(<StudioApp {...base} mode="video" projectsCopy={dict.studioVideo.workspace.projects} initialState={{ ...state0, projects: [{ id: P1, title: "Spring film" }] }} />);
    expect(video).not.toContain("data-studio-project-bar");
  });

  it("offers no 'put in a project' action and draws the assets page exactly as before", () => {
    const dict = getDictionary("ko");
    const state0 = studioState({ canCreate: true, assets: [asset(1, { name: "Wordmark", role: "logo" })], jobs: [job(1, { prompt: "Opening shot", outputs: [output(1)] })] });
    const entry = buildHubEntries(state0.assets, state0.jobs, "x").find((e) => e.jobId)!;
    const copy = { useImage: "a", decorate: "b", makeVideo: "c", compose: "d", reverse: "e", share: "f", similar: "g", edit: "h" };
    expect(hubActions(entry, { organizationId: ORG, canOpenStudio: true, canCreate: true, copy }).more.map((a) => a.key)).not.toContain("project");
    expect(hubActions(entry, { organizationId: ORG, canOpenStudio: true, canCreate: true, copy, projectLabel: null }).more.map((a) => a.key)).not.toContain("project");

    const hub = (state: typeof state0) =>
      renderToStaticMarkup(<BrandAssetHub organizationId={ORG} studioCopy={dict.brandStudio} libraryCopy={dict.studioLibrary} initialState={state} injectedLibrary={library} />);
    const closed = hub(state0);
    expect(closed).not.toContain('data-asset-hub-tab="projects"');
    // An empty list of projects changes nothing that is drawn (the action lives in the menu and the sheet).
    expect(hub({ ...state0, projects: [] })).toBe(closed);
  });
});

describe("open: the image studio", () => {
  it.each(["ko", "en"] as const)("shows the video studio's switcher with only what a picture needs, and starts in no project (%s)", (locale) => {
    const dict = getDictionary(locale);
    const html = renderToStaticMarkup(
      <StudioApp
        organizationId={ORG}
        locale={locale}
        copy={dict.brandStudio}
        mode="image"
        libraryCopy={dict.studioLibrary}
        layersCopy={dict.studioLayers}
        projectsCopy={dict.studioVideo.workspace.projects}
        initialState={studioState({ canCreate: true, jobs: [job(1, { outputs: [output(1)] })], projects: [{ id: P1, title: "Spring film" }, { id: P2, title: "Teaser cut" }] })}
      />,
    );
    expect(html).toContain("data-studio-project-bar");
    // The same words as the video studio: no new name for the list.
    expect(html).toContain(`>${dict.studioVideo.workspace.projects.myProjects}</span>`);
    expect(html).toMatch(/data-studio-project-bar="true" data-project=""/);
    // No project chosen is the default, and it draws nothing in the prompt bar.
    expect(html).not.toContain("data-studio-dock-project");
    expect(html).not.toContain("data-studio-project-title");
    // Nothing that belongs to a sequence.
    for (const videoOnly of ["data-video-project-bar", "data-video-layout-preset", "data-video-share-review", "data-video-export-nle", "data-video-export-mp4", "data-video-project-complete", "data-video-project-delete", "data-video-send-to-project"]) {
      expect(html, videoOnly).not.toContain(videoOnly);
    }
  });

  it("the bar names the chosen project and lists 'no project' first", () => {
    const dict = getDictionary("ko");
    const copy = dict.studioVideo.workspace.projects;
    const html = renderToStaticMarkup(
      <ImageProjectBar
        canEdit
        projectId={P2}
        projects={[{ id: P1, title: "Spring film" }, { id: P2, title: "Teaser cut" }]}
        copy={copy}
        noneLabel={dict.studioLibrary.projects.none}
        onSelectProject={() => {}}
        onCreateProject={async () => true}
      />,
    );
    expect(html).toContain(`data-project="${P2}"`);
    expect(html).toMatch(/data-studio-project-title="true">Teaser cut</);
    expect(html).toContain(">2</span>");
    // A project that is not in the list (deleted elsewhere) is simply no project.
    const gone = renderToStaticMarkup(
      <ImageProjectBar canEdit projectId={id(0x99)} projects={[{ id: P1, title: "Spring film" }]} copy={copy} noneLabel={dict.studioLibrary.projects.none} onSelectProject={() => {}} onCreateProject={async () => true} />,
    );
    expect(gone).toContain('data-project=""');
    expect(gone).not.toContain("data-studio-project-title");
  });
});

describe("open: the assets page", () => {
  const jobs = [
    job(1, { prompt: "Four at once", outputs: [output(1), output(2), output(3), output(4)] }),
    job(2, { kind: "region_edit", prompt: "Fix the label", parentOutputId: output(2).id, outputs: [output(5)] }),
    job(3, { kind: "region_edit", prompt: "And the cap", parentOutputId: output(5).id, outputs: [output(6)] }),
    job(4, { prompt: "On its own", outputs: [output(7)] }),
  ];

  it("a run and everything made from it is one family, found from any member", () => {
    for (const start of [job(1).id, job(2).id, job(3).id]) {
      expect(jobFamily(jobs, start).sort()).toEqual([job(1).id, job(2).id, job(3).id].sort());
      expect(familySize(jobs, start)).toBe(6);
    }
    expect(jobFamily(jobs, job(4).id)).toEqual([job(4).id]);
    expect(familySize(jobs, job(4).id)).toBe(1);
    // A parent that is not on the page ends the climb where it is.
    expect(jobFamily([job(9, { parentOutputId: id(0xdead), outputs: [output(9)] })], job(9).id)).toEqual([job(9).id]);
  });

  it("the menu says when several results move together, and the sheet repeats it before anything is sent", () => {
    const dict = getDictionary("ko");
    const p = dict.studioLibrary.projects;
    const entries = buildHubEntries([], jobs, "x");
    const copy = { useImage: "a", decorate: "b", makeVideo: "c", compose: "d", reverse: "e", share: "f", similar: "g", edit: "h" };
    const label = (key: string) =>
      hubActions(entries.find((e) => e.key === key)!, {
        organizationId: ORG,
        canOpenStudio: true,
        canCreate: true,
        copy,
        projectLabel: (entry) => (familySize(jobs, entry.jobId!) > 1 ? p.assignMany.replace("{n}", String(familySize(jobs, entry.jobId!))) : p.assign),
      }).more.find((a) => a.key === "project");
    expect(label(`o:${output(7).id}`)).toEqual({ key: "project", label: "프로젝트에 담기", marker: "data-asset-hub-project-assign" });
    expect(label(`o:${output(1).id}`)!.label).toBe("6개 함께 프로젝트에 담기");
    expect(label(`o:${output(6).id}`)!.label).toBe("6개 함께 프로젝트에 담기");
    // Viewers and project-only clients get no such action.
    const upload = buildHubEntries([asset(1)], [], "x")[0]!;
    expect(hubActions(upload, { organizationId: ORG, canOpenStudio: true, canCreate: true, copy, projectLabel: () => p.assign }).more.map((a) => a.key)).not.toContain("project");
    for (const closed of [{ canOpenStudio: false, canCreate: true }, { canOpenStudio: true, canCreate: false }]) {
      expect(hubActions(entries[0]!, { organizationId: ORG, copy, projectLabel: () => p.assign, ...closed }).more.map((a) => a.key)).not.toContain("project");
    }

    const sheet = renderToStaticMarkup(
      <ProjectPickDialog copy={dict.studioLibrary} projects={[{ id: P1, title: "Spring film" }, { id: P2, title: "Teaser cut" }]} current={P1} count={6} onPick={async () => null} onClose={() => {}} />,
    );
    expect(sheet).toContain(p.pickTitle);
    expect(sheet).toContain("함께 만든 결과 6개가 같이 움직여요.");
    // "프로젝트 없음" is a choice like any other (it is how a run is taken out), listed first.
    expect(sheet.indexOf('data-asset-hub-project-choice=""')).toBeLessThan(sheet.indexOf(`data-asset-hub-project-choice="${P1}"`));
    expect(sheet).toContain(`>${p.none}</span>`);
    expect(sheet).toMatch(new RegExp(`data-asset-hub-project-choice="${P1}"><input[^>]*checked`));
    // Nothing to send until the choice changes.
    expect(sheet).toMatch(/<button type="submit"[^>]*disabled/);
    const single = renderToStaticMarkup(<ProjectPickDialog copy={dict.studioLibrary} projects={[]} current={null} count={1} onPick={async () => null} onClose={() => {}} />);
    expect(single).not.toContain("data-asset-hub-project-family");
    expect(single).toContain(p.empty);
  });

  it("groups a run that was put in a project with that project, its saved copy included; a project the page does not know names nothing", () => {
    const state = studioState({
      assets: [asset(1, { name: "Saved still" })],
      jobs: [
        job(1, { prompt: "In the project", projectId: P1, outputs: [output(1, { savedAssetId: asset(1).id })] }),
        job(2, { prompt: "Project was deleted", projectId: id(0x99), outputs: [output(2)] }),
        job(3, { prompt: "Loose", outputs: [output(3)] }),
      ],
    });
    const entries = buildHubEntries(state.assets, state.jobs, "x");
    const view = groupByProject(entries, { self: [{ id: P1, title: "Spring film", updatedAt: "", assetIds: [], outputIds: [] }], team: [] });
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0]!.entries.map((e) => e.key).sort()).toEqual([`a:${asset(1).id}`, `o:${output(1).id}`].sort());
    expect(view.loose.map((e) => e.key).sort()).toEqual([`o:${output(2).id}`, `o:${output(3).id}`].sort());

    // On the page: a project from the studio state gets a group even though the server-rendered links never listed it.
    const dict = getDictionary("ko");
    const html = renderToStaticMarkup(
      <BrandAssetHub organizationId={ORG} studioCopy={dict.brandStudio} libraryCopy={dict.studioLibrary} initialState={{ ...state, projects: [{ id: P1, title: "Spring film" }] }} projectLinks={{ self: [], team: [] }} injectedLibrary={library} />,
    );
    expect(html).toMatch(/aria-selected="true" data-asset-hub-tab="projects"/);
    expect(html).toContain(`data-asset-hub-project="self:${P1}"`);
    expect(html).toContain("Spring film");
  });

  it("the store moves the runs the server says moved, in and out, and adds a new project only while projects are open", () => {
    const open = initialStore(studioState({ jobs: [job(1, { outputs: [output(1)] }), job(2, { outputs: [output(2)] })], projects: [{ id: P1, title: "Spring film" }] }));
    const placed = studioReducer(open, { type: "jobsProject", jobIds: [job(1).id], projectId: P1 });
    expect(placed.state!.jobs.find((j) => j.id === job(1).id)!.projectId).toBe(P1);
    expect("projectId" in placed.state!.jobs.find((j) => j.id === job(2).id)!).toBe(false);
    const out = studioReducer(placed, { type: "jobsProject", jobIds: [job(1).id], projectId: null });
    expect("projectId" in out.state!.jobs.find((j) => j.id === job(1).id)!).toBe(false);

    const added = studioReducer(open, { type: "projectAdded", project: { id: P2, title: "Teaser cut" } });
    expect(added.state!.projects).toEqual([{ id: P2, title: "Teaser cut" }, { id: P1, title: "Spring film" }]);
    const closed = initialStore(studioState({ jobs: [] }));
    expect("projects" in studioReducer(closed, { type: "projectAdded", project: { id: P2, title: "Teaser cut" } }).state!).toBe(false);
  });
});
