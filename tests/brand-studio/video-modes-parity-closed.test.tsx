import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { Dock, type DockProps } from "@/components/brand-studio/dock";
import { dockCredits, draftAfterAttach, initialDraft } from "@/components/brand-studio/dock-model";
import { trayItemFromAsset, trayLabels, type TrayItem } from "@/components/brand-studio/refs";
import { VideoStudioWorkspace } from "@/components/brand-studio/video/workspace";
import { RecentCreationsPanel } from "@/components/brand-studio/video/recent-creations-panel";
import { ORG, allowance, asset, copyFor, job, output, studioState } from "./ui/fixtures";

/**
 * Step 0 of VM-1 (`BRAND_STUDIO_VIDEO_MODES`): with the switch closed (default), every video studio
 * dock state, workspace empty state, recent creations panel, image dock, and server page render is
 * byte-for-byte identical to the baseline snapshot captured on the untouched branch.
 * NEVER regenerate these snapshots after VM-1 edits begin.
 */
const snap = (name: string) => `./__snapshots__/video-modes-closed/${name}.html`;
const noop = () => {};

const pageState = vi.hoisted(() => ({
  org: { id: "a0000000-0000-4000-8000-00000000000c", name: "Fixture brand", role: "owner", denied: undefined as string[] | undefined },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/brand/studio/video",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/components/brand-workspace/context", async () => {
  const { getDictionary: getDict } = await import("@/lib/i18n/dictionaries");
  return {
    brandContext: async () => {
      const dict = getDict("ko");
      return {
        viewer: { userId: "00000000-0000-4000-8000-000000000001", isAdmin: false },
        sql: { query: async () => ({ rows: [] }) },
        verifiedEmail: undefined,
        brandHost: false,
        locale: "ko" as const,
        dict,
        b: dict.brandWorkspace,
      };
    },
  };
});

vi.mock("@/lib/brands/workspace/service", () => ({
  countPendingSharedCampaigns: async () => 0,
  loadBrandSupport: async () => [],
  loadBrandWorkspaceScope: async () => ({ choices: [{ ...pageState.org, logoUrl: null }], projectOrganizations: {} }),
  loadBrandWorkspace: async () => ({ organizations: [], projects: [] }),
}));

import StudioVideoPage from "@/app/(brand)/brand/studio/video/page";

function renderDock(patch: Partial<DockProps> = {}, mode: "video" | "image" = "video") {
  const dict = getDictionary("ko");
  const copy = copyFor("ko");
  const draft = patch.draft ?? initialDraft(mode);
  const tray = patch.tray ?? [];
  const props: DockProps = {
    mode,
    organizationId: ORG,
    draft,
    tray,
    labels: trayLabels(tray, copy),
    copy,
    locale: "ko",
    allowance: allowance(),
    credits: dockCredits(draft, tray),
    busy: false,
    message: null,
    film: null,
    uploading: [],
    videoCopy: dict.studioVideo,
    onDraft: noop,
    onTrayUpdate: noop,
    onTrayRemove: noop,
    onSubmit: noop,
    onDropSource: noop,
    onFiles: noop,
    onBrowse: noop,
    onEnhance: noop,
    onUndoEnhance: noop,
    ...patch,
  };
  return renderToStaticMarkup(<Dock {...props} />);
}

const img1: TrayItem = trayItemFromAsset(asset(1, { kind: "image", name: "bottle.png", width: 1024, height: 1024 }));
const vidShort: TrayItem = trayItemFromAsset(
  asset(2, { kind: "video", name: "short.mp4", url: "https://media.example/st/short.mp4", thumbUrl: "https://media.example/st/short.webp", width: 720, height: 1280, seconds: 8 }),
);
const vidLong: TrayItem = trayItemFromAsset(
  asset(3, { kind: "video", name: "long.mp4", url: "https://media.example/st/long.mp4", thumbUrl: "https://media.example/st/long.webp", width: 720, height: 1280, seconds: 42 }),
);

beforeEach(() => {
  vi.stubEnv("BRAND_STUDIO_V2", "on");
  vi.stubEnv("BRAND_STUDIO_VIDEO_MODES", undefined as unknown as string);
  vi.stubEnv("BRAND_STUDIO_VIDEO_MODES_ORGS", undefined as unknown as string);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("BRAND_STUDIO_VIDEO_MODES closed: parity with untouched baseline", () => {
  it("Dock mode=video: empty tray", async () => {
    await expect(renderDock()).toMatchFileSnapshot(snap("dock-video-empty"));
  });

  it("Dock mode=video: one image", async () => {
    const tray = [img1];
    const draft = draftAfterAttach(initialDraft("video"), img1, true, tray);
    await expect(renderDock({ draft, tray })).toMatchFileSnapshot(snap("dock-video-one-image"));
  });

  it("Dock mode=video: one video <= 30s", async () => {
    const tray = [vidShort];
    const draft = draftAfterAttach(initialDraft("video"), vidShort, true, tray);
    await expect(renderDock({ draft, tray })).toMatchFileSnapshot(snap("dock-video-short"));
  });

  it("Dock mode=video: one video > 30s", async () => {
    const tray = [vidLong];
    const draft = draftAfterAttach(initialDraft("video"), vidLong, true, tray);
    await expect(renderDock({ draft, tray })).toMatchFileSnapshot(snap("dock-video-long"));
  });

  it("Dock mode=video: video + image", async () => {
    const tray = [vidShort, img1];
    const draft = draftAfterAttach(draftAfterAttach(initialDraft("video"), vidShort, true, [vidShort]), img1, true, tray);
    await expect(renderDock({ draft, tray })).toMatchFileSnapshot(snap("dock-video-and-image"));
  });

  it("Dock mode=video: two clips", async () => {
    const tray = [vidShort];
    const draft = { ...draftAfterAttach(initialDraft("video"), vidShort, true, tray), method: "blueprint" as const, clipCount: 2, targetTotalSeconds: 30, seconds: 15 };
    await expect(renderDock({ draft, tray })).toMatchFileSnapshot(snap("dock-video-two-clips"));
  });

  it("Dock mode=image remains byte-identical", async () => {
    await expect(renderDock({}, "image")).toMatchFileSnapshot(snap("dock-image-empty"));
  });

  it("VideoStudioWorkspace empty state", async () => {
    const dict = getDictionary("ko");
    const html = renderToStaticMarkup(
      <VideoStudioWorkspace
        organizationId={ORG}
        locale="ko"
        copy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        videoCopy={dict.studioVideo}
        initialState={studioState({ canCreate: true, assets: [], jobs: [] })}
      />,
    );
    await expect(html).toMatchFileSnapshot(snap("workspace-empty"));
  });

  it("RecentCreationsPanel cards are not draggable when closed", async () => {
    const dict = getDictionary("ko");
    const vidOut = output(10, { kind: "video", url: "https://media.example/st/out-10.mp4", seconds: 6 });
    const imgOut = output(11, { kind: "image" });
    const allJobs = [
      job(10, { kind: "video", prompt: "City night walk", outputs: [vidOut] }),
      job(11, { kind: "image", prompt: "Glass perfume bottle", outputs: [imgOut] }),
    ];
    const html = renderToStaticMarkup(
      <RecentCreationsPanel
        allJobs={allJobs}
        canEdit
        copy={dict.studioVideo.workspace.drawer}
        onAttachOutput={noop}
        onAddVideoToSequence={noop}
      />,
    );
    expect(html).not.toContain('draggable="true"');
    await expect(html).toMatchFileSnapshot(snap("recent-creations-closed"));
  });

  it("StudioVideoPage passes no new keys or strings when switch is closed", async () => {
    const el = (await StudioVideoPage({
      searchParams: Promise.resolve({ organizationId: pageState.org.id }),
    })) as ReactElement<{ children?: unknown }>;
    const serialized = JSON.stringify(el, (_k, v) => (typeof v === "function" ? "[fn]" : v));
    expect(serialized).not.toContain("videoModes");
    expect(serialized).not.toContain("Re-Architect");
    expect(serialized).not.toContain("Motion Transfer");
    expect(serialized).not.toContain("참고할 영상을 여기에 놓으세요");
    await expect(renderToStaticMarkup(el)).toMatchFileSnapshot(snap("studio-video-page-closed"));
  });
});
