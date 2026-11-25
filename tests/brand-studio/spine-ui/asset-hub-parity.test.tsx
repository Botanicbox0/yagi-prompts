import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BrandAssetHub, assetHubProjectHref } from "@/components/brand-studio/asset-hub";
import { createStudioApi } from "@/components/brand-studio/api";
import type { StudioLibrary } from "@/components/brand-studio/seams";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { ORG, asset, id, job, output, studioState } from "../ui/fixtures";

/**
 * Slice 2b parity lock (§2): without the `spine` prop, `BrandAssetHub` must emit the exact
 * markup of `main` and must never call `loadBrandProjectOverview` or `listBrandProjectFiles`.
 *
 * Snapshot files under `./__snapshots__/` were generated on the untouched branch before any
 * slice 2b edit and must NEVER be regenerated.
 */

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

const uploadsOnlyState = () =>
  studioState({
    assets: [
      asset(1, { name: "Perfume flacon", role: "product", tags: ["glass", "spring"] }),
      asset(2, { kind: "video", name: "Runway ref", seconds: 8, url: "https://media.example/st/ref.mp4" }),
    ],
  });

const uploadsAndRunsState = () =>
  studioState({
    assets: [
      asset(1, { name: "Perfume flacon", role: "product", tags: ["glass", "spring"] }),
      asset(2, { kind: "video", name: "Runway ref", seconds: 8, url: "https://media.example/st/ref.mp4" }),
    ],
    jobs: [job(1, { prompt: "Glass perfume bottle in morning light", outputs: [output(1)] })],
  });

const projectLinksState = () =>
  studioState({
    assets: [
      asset(1, { name: "Wordmark", role: "logo" }),
      asset(2, { kind: "video", name: "Runway reference", seconds: 8, url: "https://media.example/st/ref.mp4" }),
      asset(3, { name: "Moodboard scan" }),
    ],
    jobs: [
      job(1, { kind: "video", prompt: "Opening shot", outputs: [output(1, { kind: "video", seconds: 5 })] }),
      job(2, { prompt: "Loose picture", outputs: [output(2)] }),
    ],
  });

const projectLinksProps = () => ({
  projectLinks: {
    self: [
      { id: id(0x51), title: "Spring film", updatedAt: "2026-11-10T00:00:00Z", assetIds: [asset(2).id], outputIds: [output(1).id] },
      { id: id(0x52), title: "Teaser cut", updatedAt: "2026-11-09T00:00:00Z", assetIds: [], outputIds: [output(1).id] },
    ],
    team: [],
  },
  deliverables: [
    {
      id: id(0x61),
      projectId: id(0x71),
      projectTitle: "Winter campaign",
      title: "Creator cut",
      kind: "image" as const,
      url: "https://media.example/d.webp",
      createdAt: "2026-11-08T00:00:00Z",
    },
  ],
  deliverableCount: 1,
});

const viewerState = () =>
  studioState({
    canCreate: false,
    assets: [asset(1, { name: "Perfume flacon", role: "product" })],
    jobs: [job(1, { prompt: "Glass perfume bottle in morning light", outputs: [output(1)] })],
  });

describe("BrandAssetHub parity without spine prop (§2)", () => {
  it("matches main markup snapshot for empty state", async () => {
    const dict = getDictionary("ko");
    const html = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        initialState={studioState()}
        injectedLibrary={stubLibrary()}
      />,
    );
    await expect(html).toMatchFileSnapshot("./__snapshots__/asset-hub-empty.html");
  });

  it("matches main markup snapshot for uploads only", async () => {
    const dict = getDictionary("ko");
    const html = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        initialState={uploadsOnlyState()}
        injectedLibrary={stubLibrary()}
      />,
    );
    await expect(html).toMatchFileSnapshot("./__snapshots__/asset-hub-uploads-only.html");
  });

  it("matches main markup snapshot for uploads and runs", async () => {
    const dict = getDictionary("ko");
    const html = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        initialState={uploadsAndRunsState()}
        deliverableCount={2}
        injectedLibrary={stubLibrary({ liked: new Set([`a:${asset(1).id}`]) })}
      />,
    );
    await expect(html).toMatchFileSnapshot("./__snapshots__/asset-hub-uploads-and-runs.html");
  });

  it.each(["ko", "en"] as const)("matches main markup snapshot with project links (%s)", async (locale) => {
    const dict = getDictionary(locale);
    const html = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        initialState={projectLinksState()}
        {...projectLinksProps()}
        injectedLibrary={stubLibrary()}
      />,
    );
    const file = locale === "ko" ? "./__snapshots__/asset-hub-with-project-links.html" : "./__snapshots__/asset-hub-with-project-links-en.html";
    await expect(html).toMatchFileSnapshot(file);
  });

  it("matches main markup snapshot for viewer (canCreate: false)", async () => {
    const dict = getDictionary("ko");
    const html = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        initialState={viewerState()}
        injectedLibrary={stubLibrary()}
      />,
    );
    await expect(html).toMatchFileSnapshot("./__snapshots__/asset-hub-viewer.html");
  });

  it("matches main markup snapshot for project-only client (canOpenStudio: false)", async () => {
    const dict = getDictionary("ko");
    const html = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        initialState={uploadsAndRunsState()}
        canOpenStudio={false}
        injectedLibrary={stubLibrary()}
      />,
    );
    await expect(html).toMatchFileSnapshot("./__snapshots__/asset-hub-project-only-client.html");
  });

  it("matches main markup snapshot with a team project in projectLinks.team", async () => {
    const dict = getDictionary("ko");
    const html = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        initialState={projectLinksState()}
        projectLinks={{
          self: projectLinksProps().projectLinks.self,
          team: [
            {
              id: id(0x55),
              title: "Team autumn shoot",
              updatedAt: "2026-11-11T00:00:00Z",
              assetIds: [asset(1).id],
              outputIds: [output(2).id],
            },
          ],
        }}
        deliverables={projectLinksProps().deliverables}
        deliverableCount={projectLinksProps().deliverableCount}
        injectedLibrary={stubLibrary()}
      />,
    );
    expect(html).not.toContain("by_project");
    await expect(html).toMatchFileSnapshot("./__snapshots__/asset-hub-team-project.html");
  });

  // Proven here:
  //  - `assetHubProjectHref` produces `?film=` when `useFilmParam` is true vs `?project=` when false for self projects,
  //    `/brand/projects/<id>` for team projects, and `null` when `canOpenStudio` is false.
  //  - Initial SSR of legacy `BrandAssetHub` with `useFilmParam: true` keeps the exact same markup as
  //    `asset-hub-with-project-links.html`.
  // Not proven in static SSR:
  //  - Opened-group link markup (`data-asset-hub-project-link`) requires client `openGroup` state inside legacy
  //    `BrandAssetHub`, so clicking into a group is outside static SSR without adding test props to the legacy path.
  it("switches self-project href between ?project= and ?film= via assetHubProjectHref while keeping initial legacy markup unchanged (Fix 3-4)", async () => {
    const selfGroup = { id: id(0x51), origin: "self" as const };
    const teamGroup = { id: id(0x71), origin: "team" as const };
    expect(assetHubProjectHref(ORG, selfGroup, true, false)).toBe(
      `/brand/studio/video?organizationId=${ORG}&project=${id(0x51)}`,
    );
    expect(assetHubProjectHref(ORG, selfGroup, true, true)).toBe(
      `/brand/studio/video?organizationId=${ORG}&film=${id(0x51)}`,
    );
    expect(assetHubProjectHref(ORG, teamGroup, true, true)).toBe(`/brand/projects/${id(0x71)}`);
    expect(assetHubProjectHref(ORG, selfGroup, false, true)).toBeNull();

    const dict = getDictionary("ko");
    const html = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        initialState={projectLinksState()}
        {...projectLinksProps()}
        useFilmParam={true}
        injectedLibrary={stubLibrary()}
      />,
    );
    await expect(html).toMatchFileSnapshot("./__snapshots__/asset-hub-with-project-links.html");
  });

  // Note: `renderToStaticMarkup` runs no client effect, so this test only observes calls made during render.
  // Source-level containment below guarantees `asset-hub.tsx` never imports or calls the spine client endpoints.
  it("never calls loadBrandProjectOverview or listBrandProjectFiles without the spine prop", () => {
    const dict = getDictionary("ko");
    const fetchSpy = vi.fn<typeof globalThis.fetch>(async () => new Response("{}", { status: 200 }));
    const api = createStudioApi({ organizationId: ORG, fetch: fetchSpy });
    const overviewSpy = vi.spyOn(api, "loadBrandProjectOverview");
    const filesSpy = vi.spyOn(api, "listBrandProjectFiles");

    const states = [
      { initialState: studioState() },
      { initialState: uploadsOnlyState() },
      { initialState: uploadsAndRunsState(), deliverableCount: 2 },
      { initialState: projectLinksState(), ...projectLinksProps() },
      { initialState: viewerState() },
      { initialState: uploadsAndRunsState(), canOpenStudio: false },
    ];

    for (const props of states) {
      renderToStaticMarkup(
        <BrandAssetHub
          organizationId={ORG}
          studioCopy={dict.brandStudio}
          libraryCopy={dict.studioLibrary}
          injectedLibrary={stubLibrary()}
          api={api}
          {...props}
        />,
      );
    }

    expect(overviewSpy).not.toHaveBeenCalled();
    expect(filesSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("source guard: only api.ts and asset-hub-spine/* name loadBrandProjectOverview or listBrandProjectFiles across components and app", () => {
    const walkTs = (dir: string): string[] => {
      const files: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) files.push(...walkTs(full));
        else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
      }
      return files;
    };

    const root = process.cwd();
    const candidates = [...walkTs(join(root, "components")), ...walkTs(join(root, "app"))];
    const assetHubSrc = readFileSync(join(root, "components", "brand-studio", "asset-hub.tsx"), "utf8");
    expect(assetHubSrc).not.toMatch(/loadBrandProjectOverview|listBrandProjectFiles/);

    const offenders: string[] = [];
    for (const file of candidates) {
      const rel = file.slice(root.length + 1).replace(/\\/g, "/");
      const allowed = rel === "components/brand-studio/api.ts" || rel.startsWith("components/brand-studio/asset-hub-spine/");
      if (allowed) continue;
      const src = readFileSync(file, "utf8");
      if (/loadBrandProjectOverview|listBrandProjectFiles/.test(src)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
