import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, useState, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STUDIO_ASSET_ROLES,
  STUDIO_LIMITS,
  STUDIO_SHOT_LIMITS,
  type StudioRemixMethod,
} from "@/lib/brand-studio/contracts";
import { STUDIO_MODELS, type StudioVideoModel } from "@/lib/brand-studio/models";
import { brandStudioVideoModesOpenFor } from "@/lib/flags";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { studioVideoModesEn, studioVideoModesKo } from "@/messages/studio-video-modes";
import { Dock, type DockProps, type VideoModesDockProp } from "@/components/brand-studio/dock";
import {
  buildJob,
  buildMultiClipJobs,
  dockCredits,
  draftAfterAttach,
  draftFromJob,
  initialDraft,
  remixActive,
  type DockDraft,
} from "@/components/brand-studio/dock-model";
import { LibraryRail } from "@/components/brand-studio/rail";
import { RAIL_STORAGE_KEY } from "@/components/brand-studio/rail/text";
import {
  REF_DRAG_TYPE,
  acceptsDrag,
  decodeRefDrag,
  trayItemFromAsset,
  trayLabels,
  type TrayItem,
} from "@/components/brand-studio/refs";
import { Tray } from "@/components/brand-studio/tray";
import type { StudioLibrary } from "@/components/brand-studio/seams";
import { useDock, type DockController } from "@/components/brand-studio/use-dock";
import { useStudio, type StudioController } from "@/components/brand-studio/use-studio";
import { useViewer } from "@/components/brand-studio/use-viewer";
import { planReuse, stripMultiClipPromptHeaders } from "@/components/brand-studio/reuse-model";
import type { StudioApi } from "@/components/brand-studio/api";
import { errorLine } from "@/components/brand-studio/copy";
import { RecentCreationsPanel } from "@/components/brand-studio/video/recent-creations-panel";
import { emptyDraft as emptyReverseDraft } from "@/components/brand-studio/video/reverse-model";
import { defaultVideoEditDraft } from "@/components/brand-studio/video/workspace-model";
import { useVideoModes } from "@/components/brand-studio/video/use-video-modes";
import {
  INITIAL_VIDEO_MODES_STATE,
  VIDEO_UNDERSTAND_STORAGE_KEY,
  applyCardLengthPlan,
  applyUnderstandCardToDraftAndTray,
  buildUnderstandInput,
  clearUnderstandSession,
  confirmCardSignature,
  deriveVideoMode,
  draftAndStateAfterVideoAttach,
  formatVideoContainers,
  formatVideoModeTipLines,
  formatVideoWellLimits,
  isBlueprintUnreadableBlock,
  isConfirmVideoMode,
  multiLengthChoices,
  needsReferenceVideoForSubmit,
  readUnderstandSession,
  selectVideoMode,
  singleLengthChoices,
  snapshotTrayImages,
  stateAfterManualTrayRemove,
  stripClientCreditFigures,
  undoRemovedVideo,
  videoModeAvailability,
  writeUnderstandSession,
  type VideoModesUiState,
} from "@/components/brand-studio/video/video-modes-model";
import {
  VideoConfirmCard,
  VideoModeInfoPopover,
  VideoModeMenu,
  VideoTrayNeedVideo,
} from "@/components/brand-studio/video/video-modes-ui";
import { VideoStudioWorkspace } from "@/components/brand-studio/video/workspace";
import { mountDom } from "@/tests/brands/_dom-harness";
import { ORG, allowance, asset, copyFor, job, output, studioState } from "../ui/fixtures";

const noop = () => {};
const seedance = STUDIO_MODELS.find((m) => m.id === "seedance-2.5") as StudioVideoModel;
const KO_DICT = getDictionary("ko");
const EN_DICT = getDictionary("en");
const KO_COPY = copyFor("ko");
const KO_VIDEO = KO_DICT.studioVideo;
const KO_MODES = studioVideoModesKo;

const img1: TrayItem = trayItemFromAsset(asset(1, { kind: "image", name: "bottle.png", width: 1024, height: 1024 }));
const aud1: TrayItem = trayItemFromAsset(
  asset(2, { kind: "audio", name: "bgm.mp3", url: "https://media.example/st/bgm.mp3", thumbUrl: null, width: null, height: null, seconds: 10 }),
);
const vid8: TrayItem = trayItemFromAsset(
  asset(3, { kind: "video", name: "clip8.mp4", url: "https://media.example/st/c8.mp4", thumbUrl: "https://media.example/st/c8.webp", width: 720, height: 1280, seconds: 8 }),
);
const vid18: TrayItem = trayItemFromAsset(
  asset(4, { kind: "video", name: "clip18.mp4", url: "https://media.example/st/c18.mp4", thumbUrl: "https://media.example/st/c18.webp", width: 720, height: 1280, seconds: 18 }),
);
const vid42: TrayItem = trayItemFromAsset(
  asset(5, { kind: "video", name: "clip42.mp4", url: "https://media.example/st/c42.mp4", thumbUrl: "https://media.example/st/c42.webp", width: 720, height: 1280, seconds: 42 }),
);
const vidSmall: TrayItem = trayItemFromAsset(
  asset(6, { kind: "video", name: "tiny.mp4", url: "https://media.example/st/tiny.mp4", thumbUrl: null, width: 200, height: 200, seconds: 8 }),
);
const vidLarge: TrayItem = trayItemFromAsset(
  asset(7, { kind: "video", name: "huge.mp4", url: "https://media.example/st/huge.mp4", thumbUrl: null, width: 4000, height: 4000, seconds: 8 }),
);
const vidTooShort: TrayItem = trayItemFromAsset(
  asset(8, { kind: "video", name: "short1s.mp4", url: "https://media.example/st/s1.mp4", thumbUrl: null, width: 720, height: 1280, seconds: 1 }),
);

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

function stubLibrary(): StudioLibrary {
  return {
    ready: true,
    folders: [],
    liked: new Set(),
    likedItems: [],
    folderItems: () => null,
    openFolder: noop,
    toggleLike: async () => true,
    createFolder: async () => null,
    renameFolder: async () => true,
    deleteFolder: async () => true,
    addToFolder: async () => true,
    removeFromFolder: async () => true,
  };
}

function stubStudio(): StudioController {
  return {
    store: { phase: "ready", state: studioState() },
    films: {},
    uploads: [],
    load: async () => {},
    createJob: async () => ({ ok: false, code: "invalid" }),
    createGroup: async () => ({ ok: false, code: "invalid" }),
    cancelJob: async () => ({ ok: false, code: "invalid" }),
    deleteJob: async () => ({ ok: false, code: "invalid" }),
    upload: async () => ({ ok: false, code: "invalid" }),
    updateAsset: async () => ({ ok: false, code: "invalid" }),
    deleteAsset: async () => ({ ok: false, code: "invalid" }),
    handoff: async () => ({ ok: false, code: "invalid" }),
    analyzeFilm: () => {},
    enhancePrompt: async () => ({ ok: false, code: "invalid" }),
    moveToBrandProject: async () => ({ ok: false, code: "invalid" }),
    removeJobs: noop,
    wasStartedHere: () => false,
    onSourceDeleted: () => noop,
  } as unknown as StudioController;
}

function buildOpenDock(
  patch: Partial<DockProps> = {},
  uiPatch: Partial<VideoModesUiState> = {},
  vmPatch: Partial<VideoModesDockProp> = {},
) {
  const draft = patch.draft ?? initialDraft("video");
  const tray = patch.tray ?? [];
  const film = patch.film ?? null;
  const ui: VideoModesUiState = { ...INITIAL_VIDEO_MODES_STATE, ...uiPatch };
  const activeMode = deriveVideoMode(draft, tray, ui.pendingMode);
  const availability = videoModeAvailability({
    draft,
    tray,
    film,
    copy: KO_COPY,
    videoCopy: KO_VIDEO,
  });
  const videoModes: VideoModesDockProp = {
    activeMode,
    pendingMode: ui.pendingMode,
    availability,
    copy: KO_MODES,
    undo: ui.undo !== null,
    forcedLimitMessage: ui.forcedLimitMessage,
    confirmOpen: false,
    waitingForReading: activeMode === "re_architect" && remixActive(draft, tray) && film?.status === "loading",
    queuedConfirmOnRead: false,
    onSelectMode: noop,
    onUndoRemoveVideo: noop,
    onRetryReadFilm: noop,
    onOpenConfirm: noop,
    onCloseConfirm: noop,
    ...vmPatch,
  };
  return renderToStaticMarkup(
    <Dock
      mode="video"
      organizationId={ORG}
      draft={draft}
      tray={tray}
      labels={trayLabels(tray, KO_COPY)}
      copy={KO_COPY}
      locale="ko"
      allowance={allowance()}
      credits={dockCredits(draft, tray)}
      busy={false}
      message={null}
      film={film}
      uploading={[]}
      videoCopy={KO_VIDEO}
      videoModes={videoModes}
      onDraft={noop}
      onTrayUpdate={noop}
      onTrayRemove={noop}
      onSubmit={noop}
      onDropSource={noop}
      onFiles={noop}
      onBrowse={noop}
      onEnhance={noop}
      onUndoEnhance={noop}
      {...patch}
    />,
  );
}

/** Main's exact RemixPanel method-card onChange patch (`components/brand-studio/remix-panel.tsx`). */
function mainRemixMethodPatch(draft: DockDraft, method: StudioRemixMethod): DockDraft {
  return {
    ...draft,
    method,
    methodPinned: true,
    ...(method !== "blueprint" ? { clipCount: 1, targetTotalSeconds: null } : {}),
  };
}

beforeEach(() => {
  vi.stubEnv("BRAND_STUDIO_V2", "on");
  pageState.org = { id: "a0000000-0000-4000-8000-00000000000c", name: "Fixture brand", role: "owner", denied: undefined };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("1. Global ambient sound default, flag gating & server page", () => {
  it("defaults new video drafts to ambient (음악 없이 현장음만) globally (dock + reverse) while preserving persisted native jobs & edit draft", () => {
    const fresh = initialDraft("video");
    expect(fresh.audio).toBe("ambient");
    expect(KO_COPY.sound[fresh.audio]).toBe("음악 없이 현장음만");
    // S3: ReversePanel emptyDraft also defaults to ambient
    expect(emptyReverseDraft().audio).toBe("ambient");
    // S3: VideoEditDraft stays native so AMBIENT_AUDIO_LINE does not strip existing clip soundtrack on edit
    expect(defaultVideoEditDraft().audio).toBe("native");

    const loadedNative = draftFromJob(
      job(99, { kind: "video", audio: "native" }),
      initialDraft("video"),
    );
    expect(loadedNative.audio).toBe("native");
  });

  it("defaults BRAND_STUDIO_VIDEO_MODES off, respects org lists case-insensitively, and never opens for blank org id", () => {
    expect(brandStudioVideoModesOpenFor(ORG, {})).toBe(false);
    expect(brandStudioVideoModesOpenFor(ORG, { BRAND_STUDIO_VIDEO_MODES: "off" })).toBe(false);
    expect(brandStudioVideoModesOpenFor(ORG, { BRAND_STUDIO_VIDEO_MODES_ORGS: ORG })).toBe(false);

    for (const blank of ["", "   ", null, undefined]) {
      expect(brandStudioVideoModesOpenFor(blank, { BRAND_STUDIO_VIDEO_MODES: "on" })).toBe(false);
      expect(brandStudioVideoModesOpenFor(blank, { BRAND_STUDIO_VIDEO_MODES: "on", BRAND_STUDIO_VIDEO_MODES_ORGS: "*" })).toBe(false);
      expect(brandStudioVideoModesOpenFor(blank, { BRAND_STUDIO_VIDEO_MODES: "on", BRAND_STUDIO_VIDEO_MODES_ORGS: "all" })).toBe(false);
    }

    expect(brandStudioVideoModesOpenFor(ORG, { BRAND_STUDIO_VIDEO_MODES: "on" })).toBe(true);
    expect(brandStudioVideoModesOpenFor(ORG, { BRAND_STUDIO_VIDEO_MODES: "on", BRAND_STUDIO_VIDEO_MODES_ORGS: " * " })).toBe(true);
    expect(brandStudioVideoModesOpenFor(ORG, { BRAND_STUDIO_VIDEO_MODES: "on", BRAND_STUDIO_VIDEO_MODES_ORGS: "ALL" })).toBe(true);

    const other = "b0000000-0000-4000-8000-000000000001";
    const env = { BRAND_STUDIO_VIDEO_MODES: "on", BRAND_STUDIO_VIDEO_MODES_ORGS: ` ${ORG.toUpperCase()} , ${other} ` };
    expect(brandStudioVideoModesOpenFor(ORG, env)).toBe(true);
    expect(brandStudioVideoModesOpenFor(other, env)).toBe(true);
    expect(brandStudioVideoModesOpenFor("c0000000-0000-4000-8000-000000000009", env)).toBe(false);
  });

  it("StudioVideoPage passes videoModes + videoModesCopy ONLY when open, and viewer seats see no mode control", async () => {
    vi.stubEnv("BRAND_STUDIO_VIDEO_MODES", "on");
    vi.stubEnv("BRAND_STUDIO_VIDEO_MODES_ORGS", pageState.org.id);

    const openEl = (await StudioVideoPage({
      searchParams: Promise.resolve({ organizationId: pageState.org.id }),
    })) as ReactElement;
    const serialized = JSON.stringify(openEl, (_k, v) => (typeof v === "function" ? "[fn]" : v));
    expect(serialized).toContain('"videoModes":true');
    expect(serialized).toContain("Re-Architect");
    expect(serialized).toContain("Motion Transfer");
    expect(serialized).toContain(KO_MODES.cta.review);

    pageState.org = { ...pageState.org, role: "viewer" };
    const viewerEl = (await StudioVideoPage({
      searchParams: Promise.resolve({ organizationId: pageState.org.id }),
    })) as ReactElement;
    const viewerHtml = renderToStaticMarkup(viewerEl);
    expect(viewerHtml).not.toContain("data-video-mode-switch");
  });
});

describe("2. Compact dock layout, settings-row order, and ReversePanel gating (VM-2 Batch A)", () => {
  it("places [모드 ▾] (i) BEFORE ModelMenu, keeps 길이 & 사운드 in every mode (W2), and removes all bulky VM-1 / RemixPanel chrome", () => {
    const base = draftAfterAttach(initialDraft("video"), vid8, true, [vid8]);
    const raHtml = buildOpenDock({ draft: { ...base, method: "blueprint", methodPinned: true }, tray: [vid8] });

    // W2: Order check in `.bs-controls-set`:
    // `[모드] (i) [모델] [비율] [해상도] [길이] [사운드]` stays intact even when a reference video is attached!
    const modeIdx = raHtml.indexOf('data-control="mode"');
    const infoIdx = raHtml.indexOf('data-video-mode-info="re_architect"');
    const modelIdx = raHtml.indexOf('data-control="model"');
    const aspectIdx = raHtml.indexOf('data-control="aspect"');
    const resIdx = raHtml.indexOf('data-control="resolution"');
    const secIdx = raHtml.indexOf('data-control="seconds"');
    const soundIdx = raHtml.indexOf('data-control="sound"');
    expect(modeIdx).toBeGreaterThan(-1);
    expect(infoIdx).toBeGreaterThan(modeIdx);
    expect(modelIdx).toBeGreaterThan(infoIdx);
    expect(aspectIdx).toBeGreaterThan(modelIdx);
    expect(resIdx).toBeGreaterThan(aspectIdx);
    expect(secIdx).toBeGreaterThan(resIdx);
    expect(soundIdx).toBeGreaterThan(secIdx);
    expect(raHtml).toContain("data-video-length-chip");
    expect(raHtml).toContain("data-video-sound-chip");

    // Multi-clip plan shows `30초 · 2클립` directly on the 길이 settings chip
    const multiDraft = applyCardLengthPlan({ ...base, method: "blueprint", methodPinned: true }, 30, 2, 18, seedance);
    const multiHtml = buildOpenDock({ draft: multiDraft, tray: [vid18] });
    expect(multiHtml).toContain("30초 · 2클립");
    expect(multiHtml).toContain("data-video-length-chip");
    expect(multiHtml).toContain("data-video-sound-chip");

    // Compact resting dock with video attached: ZERO RemixPanel, ZERO AI director banner, ZERO keep chips, ZERO VM-1 chrome
    for (const forbidden of [
      "data-studio-remix=",
      "data-studio-director-banner",
      "data-studio-remix-open-panel",
      'class="bs-keep"',
      "data-video-mode-bar",
      "data-video-mode-well",
      "data-video-mode-explainer",
      "data-video-mode-edit-toggle",
      "data-video-confirm-card",
    ]) {
      expect(raHtml, forbidden).not.toContain(forbidden);
    }

    // Primary trigger in resting Re-Architect is `확인하기` (NO credit quote on 확인하기)
    expect(raHtml).toContain("data-video-confirm-trigger");
    expect(raHtml).toContain(KO_MODES.cta.review);
    expect(raHtml).not.toContain("data-studio-quote");
  });

  it("W1: shows reading -> read (읽었어요) -> unreadable badge on the video thumbnail ONLY in Re-Architect", () => {
    const raDraft = { ...draftAfterAttach(initialDraft("video"), vid8, true, [vid8]), method: "blueprint" as const, methodPinned: true };
    const mtDraft = { ...draftAfterAttach(initialDraft("video"), vid8, true, [vid8]), method: "reference" as const, methodPinned: true };
    const sheet = {
      seconds: 8,
      aspect: "9:16",
      shots: [{ start: 0, end: 8, framing: "medium", camera: "pan", action: "walk" }],
      look: { lighting: "soft", palette: "cool", texture: "clean" },
      audio: { music: false, speech: false, effects: "" },
      summary: "8초 컷",
    };

    const loadingHtml = buildOpenDock({ draft: raDraft, tray: [vid8], film: { status: "loading" } });
    expect(loadingHtml).toContain('data-video-read-state="loading"');
    expect(loadingHtml).toContain('data-film-state="loading"');

    const readHtml = buildOpenDock({ draft: raDraft, tray: [vid8], film: { status: "done", sheet } });
    expect(readHtml).toContain('data-video-read-state="read"');
    expect(readHtml).toContain(KO_MODES.tray.read);

    const unreadableHtml = buildOpenDock({ draft: raDraft, tray: [vid8], film: { status: "done", sheet: null } });
    expect(unreadableHtml).toContain('data-video-read-state="unreadable"');
    expect(unreadableHtml).toContain(KO_MODES.tray.unreadable);

    // Motion Transfer: NO reading badge on thumbnail
    const mtHtml = buildOpenDock({ draft: mtDraft, tray: [vid8], film: { status: "done", sheet } });
    expect(mtHtml).not.toContain("data-video-read-state");
  });

  it("mounts ReversePanel for closed orgs and does NOT mount it for open orgs (?start=reverse&asset= attaches in Re-Architect)", async () => {
    const sharedProps = {
      organizationId: ORG,
      locale: "ko" as const,
      copy: KO_COPY,
      libraryCopy: KO_DICT.studioLibrary,
      videoCopy: KO_VIDEO,
      initialCreateMode: "blueprint" as const,
      initialAssetId: vid8.assetId,
      initialState: studioState({
        canCreate: true,
        assets: [asset(3, { id: vid8.assetId!, kind: "video", seconds: 8, width: 720, height: 1280 })],
        jobs: [],
      }),
    };

    const closedHtml = renderToStaticMarkup(<VideoStudioWorkspace {...sharedProps} />);
    expect(closedHtml).toContain("data-studio-reverse");

    const openHtml = renderToStaticMarkup(
      <VideoStudioWorkspace {...sharedProps} videoModes videoModesCopy={KO_MODES} />,
    );
    expect(openHtml).not.toContain("data-studio-reverse");
    expect(openHtml).toContain("data-video-mode-switch");
    // No auto-opening explainer dialog anywhere
    expect(openHtml).not.toContain("data-video-mode-explainer");

    // Mounted effect attaches `?start=reverse&asset=<id>` directly in Re-Architect without ReversePanel
    const prevLocation = (globalThis as Record<string, unknown>).location;
    (globalThis as Record<string, unknown>).location = new URL(
      `https://twings.app/brand/studio/video?start=reverse&asset=${vid8.assetId}`,
    );
    const dom = await mountDom(
      <VideoStudioWorkspace {...sharedProps} videoModes videoModesCopy={KO_MODES} />,
    );
    try {
      expect(dom.query("[data-studio-reverse]")).toBeNull();
      expect(dom.query("[data-video-mode-trigger]")?.getAttribute("aria-label")).toBe("모드: Re-Architect");
    } finally {
      await dom.unmount();
      if (prevLocation === undefined) delete (globalThis as Record<string, unknown>).location;
      else (globalThis as Record<string, unknown>).location = prevLocation;
    }
  });

  it("hides mode controls in collapsed rail-full pill and read-only viewer workspace", () => {
    const collapsedHtml = renderToStaticMarkup(
      <VideoStudioWorkspace
        organizationId={ORG}
        locale="ko"
        copy={KO_COPY}
        libraryCopy={KO_DICT.studioLibrary}
        videoCopy={KO_VIDEO}
        videoModes
        videoModesCopy={KO_MODES}
        initialRailHeight="full"
        initialState={studioState({ canCreate: true, assets: [], jobs: [] })}
      />,
    );
    expect(collapsedHtml).toContain("data-video-expand-dock");
    expect(collapsedHtml).not.toContain("data-video-mode-switch");

    const viewerHtml = renderToStaticMarkup(
      <VideoStudioWorkspace
        organizationId={ORG}
        locale="ko"
        copy={KO_COPY}
        libraryCopy={KO_DICT.studioLibrary}
        videoCopy={KO_VIDEO}
        videoModes
        videoModesCopy={KO_MODES}
        initialState={studioState({ canCreate: false, assets: [], jobs: [] })}
      />,
    );
    expect(viewerHtml).toContain("data-studio-read-only");
    expect(viewerHtml).not.toContain("data-video-mode-switch");
  });
});

describe("3. State table (Rules 1–10), compact tray pending line, and unreadable + retry flow", () => {
  const avail = (draft: DockDraft, tray: readonly TrayItem[], film: DockProps["film"] = null) =>
    videoModeAvailability({ draft, tray, film, copy: KO_COPY, videoCopy: KO_VIDEO });

  it("R1: no video in tray, nothing picked -> 기본 with live Make + credit quote", () => {
    const draft = initialDraft("video");
    expect(deriveVideoMode(draft, [], null)).toBe("basic");
    expect(isConfirmVideoMode("basic")).toBe(false);
    const html = buildOpenDock({ draft, tray: [] });
    expect(html).toContain('aria-label="모드: 기본"');
    expect(html).not.toContain("data-video-mode-tray-need");
    expect(html).toContain(KO_COPY.tray.hintVideo);
    expect(html).toContain("data-studio-submit");
    expect(html).toContain("data-studio-quote");
  });

  it("R2a/R2b/R2c + W5: pending video mode renders compact 1-line tray prompt WITHOUT duplicate guidance line below, disables 확인하기, hides quote", () => {
    const draft = initialDraft("video");
    const a = avail(draft, []);
    for (const mode of ["re_architect", "motion_transfer"] as const) {
      const picked = selectVideoMode({ target: mode, draft, tray: [], ui: INITIAL_VIDEO_MODES_STATE, availability: a });
      expect(picked.ui.pendingMode).toBe(mode);
      expect(picked.ui.pickedVideoModeByHand).toBe(true);
      expect(needsReferenceVideoForSubmit(picked.ui.pendingMode, picked.tray)).toBe(true);

      const html = buildOpenDock({ draft: picked.draft, tray: [] }, picked.ui);
      // Compact 1-line inside `.bs-tray-list` replaces `.bs-tray-hint`
      expect(html).toContain(`data-video-mode-tray-need="${mode}"`);
      expect(html).not.toContain("bs-tray-hint");
      expect(html).toContain("data-video-well-pick-file");
      expect(html).toContain("data-video-well-pick-library");
      expect(html).toContain("data-video-confirm-trigger");
      expect(html).toMatch(/disabled=""[^>]*data-video-confirm-trigger|data-video-confirm-trigger[^>]*disabled=""/);
      expect(html).not.toContain("data-studio-quote");
      // W5: NO duplicate need-video guidance line below the tray row
      expect(html).not.toContain('data-studio-dock-guidance="need-video"');
      expect(html).not.toContain(KO_MODES.status.needVideo);
      expect(html).not.toContain('role="alert"');

      const back = selectVideoMode({ target: "basic", draft: picked.draft, tray: [], ui: picked.ui, availability: a });
      expect(back.ui.pendingMode).toBeNull();
      const basicHtml = buildOpenDock({ draft: back.draft, tray: [] }, back.ui);
      expect(basicHtml).toContain("data-studio-quote");
      expect(basicHtml).not.toContain("data-video-mode-tray-need");
      expect(basicHtml).not.toContain("data-studio-dock-guidance");
    }
  });

  it("R3a/R3b/R3c/R3d: attach video while pending pins method or surfaces visible limit on fallback", () => {
    const raUi: VideoModesUiState = { pendingMode: "re_architect", pickedVideoModeByHand: true, undo: null, forcedLimitMessage: null };
    const raNext = draftAndStateAfterVideoAttach({ draft: initialDraft("video"), nextTray: [vid8], item: vid8, ui: raUi, copy: KO_COPY });
    expect(raNext.draft.method).toBe("blueprint");
    expect(raNext.draft.methodPinned).toBe(true);
    expect(deriveVideoMode(raNext.draft, [vid8], raNext.ui.pendingMode)).toBe("re_architect");

    const mtUi: VideoModesUiState = { pendingMode: "motion_transfer", pickedVideoModeByHand: true, undo: null, forcedLimitMessage: null };
    for (const clip of [vid8, vid18]) {
      const mtNext = draftAndStateAfterVideoAttach({ draft: initialDraft("video"), nextTray: [clip], item: clip, ui: mtUi, copy: KO_COPY });
      expect(mtNext.draft.method).toBe("reference");
      expect(mtNext.draft.methodPinned).toBe(true);
      expect(mtNext.draft.clipCount).toBe(1);
      expect(mtNext.draft.targetTotalSeconds).toBeNull();
      expect(deriveVideoMode(mtNext.draft, [clip], mtNext.ui.pendingMode)).toBe("motion_transfer");
    }

    for (const [clip, expectedSnippet] of [
      [vid42, "30"],
      [vidSmall, KO_COPY.remix.limitSmall],
      [vidLarge, KO_COPY.remix.limitLarge],
    ] as const) {
      const forced = draftAndStateAfterVideoAttach({ draft: initialDraft("video"), nextTray: [clip], item: clip, ui: mtUi, copy: KO_COPY });
      expect(forced.draft.method).toBe("blueprint");
      expect(deriveVideoMode(forced.draft, [clip], forced.ui.pendingMode)).toBe("re_architect");
      expect(forced.ui.forcedLimitMessage).toContain(expectedSnippet);
      const html = buildOpenDock({ draft: forced.draft, tray: [clip] }, forced.ui);
      expect(html).toContain("data-studio-film-limit");
      expect(html).toContain(expectedSnippet);
    }

    // <2s clip forbidden for both -> filmLimit shown and 확인하기 disabled
    const tooShort = draftAndStateAfterVideoAttach({ draft: initialDraft("video"), nextTray: [vidTooShort], item: vidTooShort, ui: mtUi, copy: KO_COPY });
    const shortHtml = buildOpenDock({ draft: tooShort.draft, tray: [vidTooShort] }, tooShort.ui);
    expect(shortHtml).toContain("data-studio-film-limit");
    expect(shortHtml).toMatch(/disabled=""[^>]*data-video-confirm-trigger|data-video-confirm-trigger[^>]*disabled=""/);
  });

  it("R4a/R4b: attach video with nothing pending (drop on 기본) -> exact automatic routing", () => {
    const solo = draftAndStateAfterVideoAttach({ draft: initialDraft("video"), nextTray: [vid8], item: vid8, ui: INITIAL_VIDEO_MODES_STATE, copy: KO_COPY });
    expect(solo.draft).toEqual(draftAfterAttach(initialDraft("video"), vid8, true, [vid8]));
    expect(deriveVideoMode(solo.draft, [vid8], solo.ui.pendingMode)).toBe("motion_transfer");

    const withImg = draftAndStateAfterVideoAttach({ draft: initialDraft("video"), nextTray: [img1, vid8], item: vid8, ui: INITIAL_VIDEO_MODES_STATE, copy: KO_COPY });
    expect(withImg.draft).toEqual(draftAfterAttach(initialDraft("video"), vid8, true, [img1, vid8]));
    expect(deriveVideoMode(withImg.draft, [img1, vid8], withImg.ui.pendingMode)).toBe("re_architect");

    const over30 = draftAndStateAfterVideoAttach({ draft: initialDraft("video"), nextTray: [vid42], item: vid42, ui: INITIAL_VIDEO_MODES_STATE, copy: KO_COPY });
    expect(over30.draft).toEqual(draftAfterAttach(initialDraft("video"), vid42, true, [vid42]));
    expect(deriveVideoMode(over30.draft, [vid42], over30.ui.pendingMode)).toBe("re_architect");
  });

  it("R6a/R6b: undo restores ALL removed videos in order and ONLY method/methodPinned (preserving seconds/clipCount)", () => {
    const tray = [img1, vid8, aud1, vid18];
    const draft: DockDraft = {
      ...draftAfterAttach(initialDraft("video"), vid8, true, tray),
      method: "blueprint",
      methodPinned: true,
      seconds: 8,
      clipCount: 2,
      targetTotalSeconds: 30,
    };
    const removed = selectVideoMode({
      target: "basic",
      draft,
      tray,
      ui: { ...INITIAL_VIDEO_MODES_STATE, pickedVideoModeByHand: true },
      availability: avail(draft, tray),
    });
    expect(removed.tray).toEqual([img1, aud1]);
    expect(removed.ui.undo?.items.map((e) => [e.index, e.item.key])).toEqual([
      [1, vid8.key],
      [3, vid18.key],
    ]);

    const editedInBasic: DockDraft = { ...removed.draft, seconds: 12, clipCount: 1, targetTotalSeconds: null };
    const restored = undoRemovedVideo(editedInBasic, removed.tray, removed.ui);
    expect(restored.tray).toEqual([img1, vid8, aud1, vid18]);
    expect(restored.draft.method).toBe("blueprint");
    expect(restored.draft.methodPinned).toBe(true);
    expect(restored.draft.seconds).toBe(12);
    expect(restored.draft.clipCount).toBe(1);
    expect(restored.draft.targetTotalSeconds).toBeNull();
    expect(restored.ui.pickedVideoModeByHand).toBe(true);
  });

  it("R7a/R7b (mounted DOM): clicking ✕ keeps hand-picked mode with tray prompt, and returns auto-inferred mode to 기본", async () => {
    function Harness() {
      const [studio] = useState(stubStudio);
      const dock = useDock({ studio, copy: KO_COPY, organizationId: ORG, initialMedium: "video", mode: "video" });
      const remixOn = remixActive(dock.draft, dock.tray);
      const vm = useVideoModes({
        enabled: true,
        modesCopy: KO_MODES,
        dock,
        copy: KO_COPY,
        videoCopy: KO_VIDEO,
        remixOn,
        remixFilm: null,
      });
      return (
        <div>
          <span data-active={vm.dockProp?.activeMode} />
          <button type="button" data-pick-ra onClick={() => vm.dockProp?.onSelectMode("re_architect")} />
          <button type="button" data-test-attach-vid8 onClick={() => vm.attachItem(vid8)} />
          <Tray
            items={dock.tray}
            labels={trayLabels(dock.tray, KO_COPY)}
            medium="video"
            copy={KO_COPY}
            dropActive={false}
            uploading={[]}
            needVideoSlot={
              !remixOn && vm.dockProp?.pendingMode ? (
                <VideoTrayNeedVideo
                  mode={vm.dockProp.pendingMode}
                  model={seedance}
                  copy={KO_MODES}
                  dropActive={false}
                  disabled={false}
                  onFiles={noop}
                  onBrowse={noop}
                />
              ) : undefined
            }
            onUpdate={dock.update}
            onRemove={vm.removeTrayItem}
            onMove={dock.move}
            onBrowse={noop}
          />
        </div>
      );
    }

    const domHand = await mountDom(<Harness />);
    try {
      await domHand.click("[data-pick-ra]");
      expect(domHand.query('[data-video-mode-tray-need="re_architect"]')).not.toBeNull();
      await domHand.click("[data-test-attach-vid8]");
      expect(domHand.query("[data-active]")?.getAttribute("data-active")).toBe("re_architect");
      expect(domHand.query("[data-video-mode-tray-need]")).toBeNull();

      await domHand.click(".bs-thumb-x");
      expect(domHand.query("[data-active]")?.getAttribute("data-active")).toBe("re_architect");
      expect(domHand.query('[data-video-mode-tray-need="re_architect"]')).not.toBeNull();
    } finally {
      await domHand.unmount();
    }

    const domInferred = await mountDom(<Harness />);
    try {
      await domInferred.click("[data-test-attach-vid8]");
      expect(domInferred.query("[data-active]")?.getAttribute("data-active")).toBe("motion_transfer");
      await domInferred.click(".bs-thumb-x");
      expect(domInferred.query("[data-active]")?.getAttribute("data-active")).toBe("basic");
      expect(domInferred.query("[data-video-mode-tray-need]")).toBeNull();
    } finally {
      await domInferred.unmount();
    }
  });

  it("reconciles external tray updates (scene extend, ?asset=, ?from=) and clears stale undo", async () => {
    let controller: DockController | null = null;
    function EntryHarness() {
      const [studio] = useState(stubStudio);
      const dock = useDock({ studio, copy: KO_COPY, organizationId: ORG, initialMedium: "video", mode: "video" });
      controller = dock;
      const remixOn = remixActive(dock.draft, dock.tray);
      const vm = useVideoModes({
        enabled: true,
        modesCopy: KO_MODES,
        dock,
        copy: KO_COPY,
        videoCopy: KO_VIDEO,
        remixOn,
        remixFilm: null,
      });
      return (
        <div>
          <span data-active-mode={vm.dockProp?.activeMode} />
          <span data-pending-mode={vm.dockProp?.pendingMode ?? ""} />
          <span data-method={dock.draft.method} />
          <span data-forced={vm.dockProp?.forcedLimitMessage ?? ""} />
          <span data-undo={vm.dockProp?.undo ? "1" : "0"} />
          <span data-video-count={String(dock.tray.filter((t) => t.kind === "video").length)} />
          <button type="button" data-pick-basic onClick={() => vm.dockProp?.onSelectMode("basic")} />
          <button type="button" data-pick-ra onClick={() => vm.dockProp?.onSelectMode("re_architect")} />
          <button type="button" data-pick-mt onClick={() => vm.dockProp?.onSelectMode("motion_transfer")} />
          <button type="button" data-do-undo onClick={() => vm.dockProp?.onUndoRemoveVideo()} />
        </div>
      );
    }

    const domExtend = await mountDom(<EntryHarness />);
    try {
      await domExtend.click("[data-pick-ra]");
      await act(async () => {
        controller!.setTray([vid8]);
      });
      expect(domExtend.query("[data-pending-mode]")?.getAttribute("data-pending-mode")).toBe("");
      expect(domExtend.query("[data-method]")?.getAttribute("data-method")).toBe("blueprint");
      expect(domExtend.query("[data-active-mode]")?.getAttribute("data-active-mode")).toBe("re_architect");
    } finally {
      await domExtend.unmount();
    }

    const domUrl = await mountDom(<EntryHarness />);
    try {
      await domUrl.click("[data-pick-mt]");
      await act(async () => {
        controller!.attach(vid42);
      });
      expect(domUrl.query("[data-active-mode]")?.getAttribute("data-active-mode")).toBe("re_architect");
      expect(domUrl.query("[data-forced]")?.getAttribute("data-forced")).toContain("30");
    } finally {
      await domUrl.unmount();
    }

    const domUndo = await mountDom(<EntryHarness />);
    try {
      await act(async () => {
        controller!.attach(vid8);
      });
      await domUndo.click("[data-pick-basic]");
      expect(domUndo.query("[data-undo]")?.getAttribute("data-undo")).toBe("1");
      await act(async () => {
        controller!.attach(vid18);
      });
      expect(domUndo.query("[data-undo]")?.getAttribute("data-undo")).toBe("0");
      await domUndo.click("[data-do-undo]");
      expect(domUndo.query("[data-video-count]")?.getAttribute("data-video-count")).toBe("1");
    } finally {
      await domUndo.unmount();
    }
  });

  it("Re-Architect reading wait queues confirm card without second request; unreadable blocks & supports retry edges", async () => {
    let resolveAnalyze: ((res: unknown) => void) | null = null;
    const apiCall = vi.fn((op: string) => {
      if (op === "film.analyze") {
        return new Promise((resolve) => {
          resolveAnalyze = resolve;
        });
      }
      return Promise.resolve({ ok: false as const, code: "failed" as const });
    });
    const fakeApi = {
      organizationId: ORG,
      loadState: vi.fn(async () => ({ ok: true as const, state: studioState({ canCreate: true, assets: [], jobs: [] }) })),
      poll: vi.fn(async () => ({ ok: true as const, jobs: [], allowance: allowance() })),
      call: apiCall,
      upload: vi.fn(async () => ({ ok: false as const, code: "failed" as const })),
      saveEditedImage: vi.fn(async () => ({ ok: false as const, code: "failed" as const })),
      listBrandProjects: vi.fn(async () => ({ ok: false as const, code: "failed" as const })),
      moveToBrandProject: vi.fn(async () => ({ ok: false as const, code: "failed" as const })),
    } as unknown as StudioApi;

    let attachClip: (() => void) | null = null;
    let submitAttempted: (() => Promise<boolean>) | null = null;
    let latestDockHtml = "";

    function ReadingFlowHarness() {
      const studio = useStudio({
        organizationId: ORG,
        initialState: studioState({ canCreate: true, assets: [], jobs: [] }),
        api: fakeApi,
      });
      const dock = useDock({ studio, copy: KO_COPY, organizationId: ORG, initialMedium: "video", mode: "video" });
      const remixOn = remixActive(dock.draft, dock.tray);
      const remixVideo = remixOn ? dock.tray.find((item) => item.kind === "video") : undefined;
      const remixFilm = remixVideo?.assetId ? (studio.films[remixVideo.assetId] ?? null) : null;
      const vm = useVideoModes({
        enabled: true,
        modesCopy: KO_MODES,
        dock,
        copy: KO_COPY,
        videoCopy: KO_VIDEO,
        remixOn,
        remixFilm,
        remixVideoAssetId: remixVideo?.assetId ?? null,
        analyzeFilm: studio.analyzeFilm,
      });
      attachClip = () => {
        vm.attachItem(vid18);
        dock.setDraft((cur) => ({ ...cur, prompt: "Follow the walk", change: "Blue coat" }));
        void studio.analyzeFilm(vid18.assetId!);
      };
      submitAttempted = async () => {
        if (vm.blockSubmitIfPending()) return false;
        return dock.submit();
      };
      latestDockHtml = renderToStaticMarkup(
        <Dock
          mode="video"
          organizationId={ORG}
          draft={dock.draft}
          tray={dock.tray}
          labels={trayLabels(dock.tray, KO_COPY)}
          copy={KO_COPY}
          locale="ko"
          allowance={allowance()}
          credits={dockCredits(dock.draft, dock.tray)}
          busy={dock.busy}
          message={dock.message}
          errorCode={dock.errorCode}
          film={remixFilm}
          uploading={[]}
          videoCopy={KO_VIDEO}
          videoModes={vm.dockProp}
          onDraft={dock.setDraft}
          onTrayUpdate={dock.update}
          onTrayRemove={vm.removeTrayItem}
          onSubmit={noop}
          onDropSource={noop}
          onFiles={noop}
          onBrowse={noop}
        />,
      );
      return (
        <div>
          <span data-confirm-open={vm.dockProp?.confirmOpen ? "1" : "0"} />
          <span data-queued={vm.dockProp?.queuedConfirmOnRead ? "1" : "0"} />
          <button type="button" data-open-confirm onClick={() => vm.dockProp?.onOpenConfirm()} />
          <button type="button" data-retry onClick={() => vm.dockProp?.onRetryReadFilm?.()} />
          <button type="button" data-pick-mt onClick={() => vm.dockProp?.onSelectMode("motion_transfer")} />
          <button type="button" data-add-img onClick={() => vm.attachItem(img1)} />
        </div>
      );
    }

    const dom = await mountDom(<ReadingFlowHarness />);
    try {
      // 1) Attach 18s clip -> analysis starts (`loading`). Press `확인하기` while loading:
      //    queues opening WITHOUT triggering a second `film.analyze` call!
      await act(async () => {
        attachClip!();
      });
      expect(apiCall).toHaveBeenCalledTimes(1);
      expect(latestDockHtml).toContain('data-film-state="loading"');
      expect(latestDockHtml).toContain(KO_MODES.cta.reading);

      await dom.click("[data-open-confirm]");
      expect(apiCall).toHaveBeenCalledTimes(1);
      expect(dom.query("[data-queued]")?.getAttribute("data-queued")).toBe("1");
      expect(dom.query("[data-confirm-open]")?.getAttribute("data-confirm-open")).toBe("0");

      // 2) Analysis completes with null sheet -> stays CLOSED, shows unreadable once + `다시 읽기`, blocks submit
      await act(async () => {
        resolveAnalyze!({ ok: true, sheet: null });
      });
      expect(dom.query("[data-queued]")?.getAttribute("data-queued")).toBe("0");
      expect(dom.query("[data-confirm-open]")?.getAttribute("data-confirm-open")).toBe("0");
      expect(latestDockHtml.split(KO_VIDEO.remix.unreadable).length - 1).toBe(1);
      expect(latestDockHtml).toContain('data-studio-dock-guidance="unreadable"');
      expect(latestDockHtml).toContain("data-video-mode-read-again");
      expect(latestDockHtml).toMatch(/disabled=""[^>]*data-video-confirm-trigger|data-video-confirm-trigger[^>]*disabled=""/);
      expect(isBlueprintUnreadableBlock({ draft: draftAfterAttach(initialDraft("video"), vid18, true, [vid18]), tray: [vid18], film: { status: "done", sheet: null } })).toBe(true);

      let started = true;
      await act(async () => {
        started = await submitAttempted!();
      });
      expect(started).toBe(false);

      // 3) Retry -> loading -> press `확인하기` while loading -> sheet lands -> opens confirm card automatically!
      await dom.click("[data-retry]");
      expect(apiCall).toHaveBeenCalledTimes(2);
      await dom.click("[data-open-confirm]");
      expect(apiCall).toHaveBeenCalledTimes(2);
      expect(dom.query("[data-queued]")?.getAttribute("data-queued")).toBe("1");

      await act(async () => {
        resolveAnalyze!({
          ok: true,
          sheet: {
            seconds: 18,
            aspect: "9:16",
            shots: [{ start: 0, end: 18, camera: "pan", action: "walk" }],
            look: { lighting: "soft", palette: "cool", texture: "clean" },
            audio: { music: false, speech: false, effects: "" },
            summary: "18초 워킹 컷",
          },
        });
      });
      expect(dom.query("[data-queued]")?.getAttribute("data-queued")).toBe("0");
      expect(dom.query("[data-confirm-open]")?.getAttribute("data-confirm-open")).toBe("1");
      expect(latestDockHtml).toContain('data-video-confirm-card="re_architect"');
      // Only ONE primary button when card is open (dock's 확인하기 trigger is hidden)
      expect(latestDockHtml).not.toContain("data-video-confirm-trigger");
      expect(latestDockHtml).toContain("data-confirm-make");

      // 4) Adding a new tray item invalidates & closes the open confirm card (`confirmCardSignature`)
      await dom.click("[data-add-img]");
      expect(dom.query("[data-confirm-open]")?.getAttribute("data-confirm-open")).toBe("0");

      // 5) Motion Transfer NEVER waits for film reading
      await dom.click("[data-pick-mt]");
      await dom.click("[data-open-confirm]");
      expect(dom.query("[data-confirm-open]")?.getAttribute("data-confirm-open")).toBe("1");
      expect(latestDockHtml).toContain('data-video-confirm-card="motion_transfer"');
    } finally {
      await dom.unmount();
    }

    // Retry edge guards: double-press, network rejection, detach stale suppression
    let nextResolve: ((res: unknown) => void) | null = null;
    let nextReject: ((err: unknown) => void) | null = null;
    const retrySpy = vi.fn(
      () =>
        new Promise((resolve, reject) => {
          nextResolve = resolve;
          nextReject = reject;
        }),
    );
    let triggerRetry: (() => void) | null = null;
    let detachClip: (() => void) | null = null;
    let latestMessage: string | null = null;

    function RetryEdgeHarness() {
      const [studio] = useState(stubStudio);
      const dock = useDock({ studio, copy: KO_COPY, organizationId: ORG, initialMedium: "video", mode: "video" });
      const remixOn = remixActive(dock.draft, dock.tray);
      const remixVideo = remixOn ? dock.tray.find((item) => item.kind === "video") : undefined;
      const vm = useVideoModes({
        enabled: true,
        modesCopy: KO_MODES,
        dock,
        copy: KO_COPY,
        videoCopy: KO_VIDEO,
        remixOn,
        remixFilm: remixVideo ? { status: "done", sheet: null } : null,
        remixVideoAssetId: remixVideo?.assetId ?? null,
        analyzeFilm: retrySpy as unknown as Parameters<typeof useVideoModes>[0]["analyzeFilm"],
      });
      attachClip = () => vm.attachItem(vid18);
      detachClip = () => vm.removeTrayItem(vid18.key);
      triggerRetry = () => vm.dockProp?.onRetryReadFilm?.();
      latestMessage = dock.message;
      return <div />;
    }

    const domEdge = await mountDom(<RetryEdgeHarness />);
    try {
      await act(async () => {
        attachClip!();
      });
      await act(async () => {
        triggerRetry!();
        triggerRetry!();
      });
      expect(retrySpy).toHaveBeenCalledTimes(1);

      await act(async () => {
        nextReject!(new Error("network down"));
      });
      expect(latestMessage).toBe(errorLine(KO_COPY, "failed"));

      await act(async () => {
        triggerRetry!();
      });
      expect(retrySpy).toHaveBeenCalledTimes(2);
      await act(async () => {
        detachClip!();
      });
      await act(async () => {
        nextResolve!({ ok: false, code: "too_many_running" });
      });
      expect(latestMessage).toBeNull();
    } finally {
      await domEdge.unmount();
    }
  });
});

describe("4. [모드 ▾] listbox and (i) info popover (keyboard, a11y, visuals)", () => {
  const mixedAvail = {
    basic: { mode: "basic" as const, disabled: false, reason: null },
    re_architect: { mode: "re_architect" as const, disabled: false, reason: null },
    motion_transfer: { mode: "motion_transfer" as const, disabled: true, reason: "30초 이하 영상만 가능해요." },
  };

  it("VideoModeMenu opens listbox with 1-line descriptions, supports arrow navigation & aria-disabled reason, ignores disabled click", async () => {
    const onSelect = vi.fn();
    const dom = await mountDom(
      <VideoModeMenu activeMode="re_architect" availability={mixedAvail} copy={KO_MODES} disabled={false} onSelect={onSelect} />,
    );
    try {
      const trigger = dom.query("[data-video-mode-trigger]")!;
      expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");

      await dom.click(trigger);
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      const options = dom.queryAll('[role="option"]');
      expect(options).toHaveLength(3);
      expect(options[1]!.getAttribute("aria-selected")).toBe("true");

      // Disabled option uses aria-disabled="true" with aria-describedby reason
      expect(options[2]!.getAttribute("aria-disabled")).toBe("true");
      const reasonId = options[2]!.getAttribute("aria-describedby");
      expect(reasonId).toBeTruthy();
      expect(dom.query('[data-video-mode-disabled-reason="motion_transfer"]')?.getAttribute("id")).toBe(reasonId);

      // Click disabled option -> ignored, menu stays open
      await dom.click(options[2]!);
      expect(onSelect).not.toHaveBeenCalled();

      // Click enabled option -> selects and closes
      await dom.click(options[0]!);
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith("basic");
      expect(dom.query('[role="listbox"]')).toBeNull();

      // ArrowDown on trigger opens, Escape closes
      await dom.keyDown("ArrowDown", { target: trigger });
      expect(dom.query('[role="listbox"]')).not.toBeNull();
      await dom.keyDown("Escape");
      expect(dom.query('[role="listbox"]')).toBeNull();
    } finally {
      await dom.unmount();
    }
  });

  it("VideoModeInfoPopover opens on click/keyboard, closes on Esc/outside click, and renders drawn visuals + honest notes", async () => {
    const allowed = new Set([
      "/reel/brands/city-fashion.jpg",
      "/reel/brands/tea-editorial.jpg",
      "/reel/brands/production-paris.jpg",
    ]);

    // Mounted click + Escape toggle
    const dom = await mountDom(<VideoModeInfoPopover activeMode="re_architect" model={seedance} copy={KO_MODES} />);
    try {
      const btn = dom.query("[data-video-mode-info-trigger]")!;
      expect(btn.getAttribute("aria-expanded")).toBe("false");
      expect(dom.query("[data-video-mode-info-popover]")).toBeNull();

      await dom.click(btn);
      expect(btn.getAttribute("aria-expanded")).toBe("true");
      const pop = dom.query('[data-video-mode-info-popover="re_architect"]')!;
      expect(pop.getAttribute("role")).toBe("dialog");

      await dom.keyDown("Escape");
      expect(dom.query("[data-video-mode-info-popover]")).toBeNull();
    } finally {
      await dom.unmount();
    }

    // Visual assertions across all 3 modes
    const basicHtml = renderToStaticMarkup(
      <VideoModeInfoPopover activeMode="basic" model={seedance} copy={KO_MODES} initialOpen />,
    );
    expect(basicHtml).toContain("최대 9장");
    expect(basicHtml).toContain("4~15초");
    expect(basicHtml).not.toContain("<img ");
    expect(basicHtml).not.toContain("data-video-mode-honest-notes");

    const raHtml = renderToStaticMarkup(
      <VideoModeInfoPopover activeMode="re_architect" model={seedance} copy={KO_MODES} initialOpen />,
    );
    const beforeBlock = raHtml.match(/data-rearchitect-strip="before"[\s\S]*?<\/div><p/)?.[0] ?? "";
    const afterBlock = raHtml.match(/data-rearchitect-strip="after"[\s\S]*?<\/div><p/)?.[0] ?? "";
    const beforeSrcs = [...beforeBlock.matchAll(/src="([^"]+)"/g)].map((m) => m[1]!);
    const afterSrcs = [...afterBlock.matchAll(/src="([^"]+)"/g)].map((m) => m[1]!);
    expect(beforeSrcs).toHaveLength(3);
    expect(new Set(beforeSrcs).size).toBe(3);
    expect(afterSrcs).toHaveLength(0);
    expect(afterBlock).toContain('data-rearchitect-drawn-tile="1"');
    expect(afterBlock).toContain("내 제품");
    expect(afterBlock).toContain("내 인물");
    expect(afterBlock).toContain("내 장소");
    expect(raHtml).toContain("최대 4개 클립");

    const mtHtml = renderToStaticMarkup(
      <VideoModeInfoPopover activeMode="motion_transfer" model={seedance} copy={KO_MODES} initialOpen />,
    );
    const mtBefore = mtHtml.match(/data-motion-strip="before"[\s\S]*?<\/div><p/)?.[0] ?? "";
    const mtAfter = mtHtml.match(/data-motion-strip="after"[\s\S]*?<\/div><p/)?.[0] ?? "";
    const mtBeforeSrcs = [...mtBefore.matchAll(/src="([^"]+)"/g)].map((m) => m[1]!);
    const mtAfterSrcs = [...mtAfter.matchAll(/src="([^"]+)"/g)].map((m) => m[1]!);
    expect(mtBeforeSrcs).toHaveLength(3);
    expect(mtAfterSrcs).toHaveLength(3);
    expect(mtAfterSrcs[0]).not.toBe(mtBeforeSrcs[0]);
    const outlineShifts = (block: string) =>
      [...block.matchAll(/<svg[^>]*viewBox="0 0 40 50"[^>]*>/g)].map((m) => m[0].match(/translateX\([^)]+\)/)?.[0] ?? "0");
    expect(outlineShifts(mtBefore)).toEqual(["translateX(-2px)", "0", "translateX(2px)"]);
    expect(outlineShifts(mtAfter)).toEqual(outlineShifts(mtBefore));
    expect(mtHtml).toContain("data-video-mode-honest-notes");
    expect(mtHtml).toContain(KO_MODES.tip.motionHonestNotes.faceColor);
    expect(mtHtml).toContain(KO_MODES.tip.motionHonestNotes.extraCredits);

    // Every `<img src>` across BOTH pictures is one of the 3 allowed stills
    const allRaImgs = [...raHtml.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1]!);
    const allMtImgs = [...mtHtml.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1]!);
    expect(allRaImgs).toHaveLength(3);
    expect(allMtImgs).toHaveLength(7);
    for (const src of [...allRaImgs, ...allMtImgs]) expect(allowed.has(src), src).toBe(true);
  });
});

describe("5. Inline Confirm Card (truthful non-editable 따라갈 것, image-only 바꿀 것, live credits, request-body equality)", () => {
  const ids = { organizationId: ORG, requestIds: ["req-00000001", "req-00000002", "req-00000003"] };

  it("renders non-editable 따라갈 것 (zero keep chips/popovers) and editable 바꿀 것 (images only, never audio), 길이, 사운드 with live credits", async () => {
    const initial = draftAfterAttach(
      draftAfterAttach({ ...initialDraft("video"), prompt: "Studio remake", change: "Warm light" }, vid8, true, [vid8]),
      img1,
      true,
      [vid8, img1, aud1],
    );
    const onMake = vi.fn();
    const onEditWords = vi.fn();
    let latestDraft: DockDraft = initial;
    let latestTray: TrayItem[] = [vid8, img1, aud1];

    function CardHarness() {
      const [draft, setDraft] = useState<DockDraft>(initial);
      const [tray, setTray] = useState<TrayItem[]>([vid8, img1, aud1]);
      latestDraft = draft;
      latestTray = tray;
      const credits = dockCredits(draft, tray);
      return (
        <VideoConfirmCard
          mode="re_architect"
          draft={draft}
          tray={tray}
          model={seedance}
          copy={KO_COPY}
          modesCopy={KO_MODES}
          cost={`${credits} 크레딧`}
          busy={false}
          disabled={false}
          videoSeconds={vid8.seconds ?? null}
          onDraft={setDraft}
          onTrayUpdate={(key, patch) => setTray((cur) => cur.map((t) => (t.key === key ? { ...t, ...patch } : t)))}
          onEditWords={onEditWords}
          onMake={onMake}
          onClose={noop}
        />
      );
    }

    const dom = await mountDom(<CardHarness />);
    try {
      // W3: compact single-row structure (4 rows, full-row pressable buttons, 1-line footer)
      expect(dom.query("[data-confirm-compact-rows]")).not.toBeNull();
      expect(dom.queryAll(".bs-vmode-card-row-btn")).toHaveLength(3);

      // 1) `따라갈 것` is fixed truthful text — NO button, NO popover, NO keep chips
      const keepRow = dom.query('[data-confirm-row="keep"]')!;
      expect(keepRow.querySelector("button")).toBeNull();
      expect(keepRow.textContent).toContain(KO_MODES.card.followReArchitect);

      // W7: unassigned picture is NOT shown as `@image1 · 역할 고르기` in the summary line (lives in popover)
      const changeBtn = dom.query('[data-confirm-line-btn="change"]')!;
      expect(changeBtn.textContent).not.toContain("역할 고르기");
      expect(changeBtn.textContent).not.toContain("역할 미지정");
      expect(changeBtn.textContent).toContain("Warm light");

      // 2) Open `바꿀 것` popover -> shows ONLY `img1` (NOT `aud1` or `vid8`), visible labels reusing
      //    `copy.tray.use` / `copy.tray.avoid`, `STUDIO_ASSET_ROLES` chips, length caps.
      await dom.click(changeBtn);
      expect(dom.query(`[data-confirm-ref-key="${img1.key}"]`)).not.toBeNull();
      expect(dom.query(`[data-confirm-ref-key="${aud1.key}"]`)).toBeNull();
      expect(dom.query(`[data-confirm-ref-key="${vid8.key}"]`)).toBeNull();

      const useInput = dom.query(`[data-confirm-ref-use="${img1.key}"]`)!;
      const avoidInput = dom.query(`[data-confirm-ref-avoid="${img1.key}"]`)!;
      const changeInput = dom.query("[data-confirm-change-input]")!;
      expect(useInput.getAttribute("maxLength")).toBe(String(STUDIO_LIMITS.noteMax));
      expect(avoidInput.getAttribute("maxLength")).toBe(String(STUDIO_LIMITS.noteMax));
      expect(changeInput.getAttribute("maxLength")).toBe(String(STUDIO_LIMITS.promptMax));

      // W9: distinct labels on `use` and `avoid` (`이 이미지에서 가져올 것` / `이 이미지에서 피할 것`)
      const refLabels = dom.queryAll(`[data-confirm-ref-key="${img1.key}"] label`).map((l) => l.textContent);
      expect(refLabels).toContain(KO_MODES.card.refUseLabel);
      expect(refLabels).toContain(KO_MODES.card.refAvoidLabel);

      // W6: Pressing Escape inside a text field of the line popover closes it AND restores focus to the line button!
      useInput.focus();
      expect(document.activeElement).toBe(useInput);
      await dom.keyDown("Escape", { target: useInput });
      expect(dom.query("[data-confirm-line-popover]")).toBeNull();
      expect(document.activeElement).toBe(changeBtn);

      // Re-open `바꿀 것` and edit role + use + avoid + change
      await dom.click(changeBtn);
      const useInput2 = dom.query(`[data-confirm-ref-use="${img1.key}"]`)!;
      const avoidInput2 = dom.query(`[data-confirm-ref-avoid="${img1.key}"]`)!;
      const changeInput2 = dom.query("[data-confirm-change-input]")!;

      // Verify all STUDIO_ASSET_ROLES are rendered in RoleChips
      const roleGroupText = dom.query(`[data-confirm-ref-key="${img1.key}"]`)?.textContent ?? "";
      for (const role of STUDIO_ASSET_ROLES) {
        expect(roleGroupText).toContain(KO_COPY.roles[role]);
      }

      const productRoleBtn = dom.queryAll(`[data-confirm-ref-key="${img1.key}"] button`).find((b) => b.textContent === KO_COPY.roles.product)!;
      await dom.click(productRoleBtn);
      await dom.setValue(useInput2, "glass bottle shape");
      await dom.setValue(avoidInput2, "plastic glare");
      await dom.setValue(changeInput2, "Swap in my perfume bottle");
      expect(latestTray.find((t) => t.key === img1.key)).toMatchObject({
        role: "product",
        use: "glass bottle shape",
        avoid: "plastic glare",
      });
      expect(latestDraft.change).toBe("Swap in my perfume bottle");

      // 3) Open `길이` popover -> change to 30초 · 2클립 -> live credit quote updates immediately!
      const costBefore = dom.query("[data-confirm-make] [data-studio-quote]")?.textContent;
      await dom.click('[data-confirm-line-btn="length"]');
      await dom.click('[data-length-option="2x30"]');
      const costAfter = dom.query("[data-confirm-make] [data-studio-quote]")?.textContent;
      expect(latestDraft.clipCount).toBe(2);
      expect(latestDraft.targetTotalSeconds).toBe(30);
      expect(costAfter).toBe(`${dockCredits(latestDraft, latestTray)} 크레딧`);
      expect(costAfter).not.toBe(costBefore);

      // 4) Open `사운드` popover -> switch from default `ambient` to `silent`
      await dom.click('[data-confirm-line-btn="sound"]');
      const silentRadio = dom.query('[data-confirm-sound-option="silent"] input')!;
      await dom.click(silentRadio);
      expect(latestDraft.audio).toBe("silent");

      // 5) `draft.keep` was NEVER touched
      expect(latestDraft.keep).toEqual(initial.keep);

      // 6) `고쳐 말하기` & `이대로 만들기` fire callbacks
      await dom.click("[data-confirm-edit-words]");
      expect(onEditWords).toHaveBeenCalledTimes(1);
      await dom.click("[data-confirm-make]");
      expect(onMake).toHaveBeenCalledTimes(1);

      // 7) Request-body equality after card popover edits: matches main's payload byte-for-byte!
      const mainEquivalentTray: TrayItem[] = [
        vid8,
        { ...img1, role: "product", use: "glass bottle shape", avoid: "plastic glare" },
        aud1,
      ];
      const mainEquivalentDraft: DockDraft = {
        ...mainRemixMethodPatch(initial, "blueprint"),
        change: "Swap in my perfume bottle",
        seconds: 15,
        clipCount: 2,
        targetTotalSeconds: 30,
        audio: "silent",
      };
      expect(buildMultiClipJobs(latestDraft, latestTray, ids)).toEqual(
        buildMultiClipJobs(mainEquivalentDraft, mainEquivalentTray, ids),
      );
    } finally {
      await dom.unmount();
    }

    // Motion Transfer confirm card shows truthful Motion Transfer sentence & single-clip lengths only
    const mtDraft = mainRemixMethodPatch(draftAfterAttach(initialDraft("video"), vid8, true, [vid8]), "reference");
    const mtCardHtml = renderToStaticMarkup(
      <VideoConfirmCard
        mode="motion_transfer"
        draft={mtDraft}
        tray={[vid8]}
        model={seedance}
        copy={KO_COPY}
        modesCopy={KO_MODES}
        cost={`${dockCredits(mtDraft, [vid8])} 크레딧`}
        busy={false}
        disabled={false}
        videoSeconds={8}
        initialOpenLine="length"
        onDraft={noop}
        onTrayUpdate={noop}
        onEditWords={noop}
        onMake={noop}
        onClose={noop}
      />,
    );
    expect(mtCardHtml).toContain(KO_MODES.card.followMotionTransfer);
    expect(mtCardHtml).not.toContain('data-length-option="2x30"');
    expect(mtCardHtml).toContain('data-length-option="1x8"');

    // SMALL 2: Motion Transfer request-body equality through card popovers (single length, sound, image role)
    const mtStartDraft = mainRemixMethodPatch(
      draftAfterAttach({ ...initialDraft("video"), prompt: "Follow the walk", change: "" }, vid8, true, [vid8, img1]),
      "reference",
    );
    let mtEditedDraft: DockDraft = mtStartDraft;
    let mtEditedTray: TrayItem[] = [vid8, img1];
    function MtCardHarness() {
      const [draft, setDraft] = useState<DockDraft>(mtStartDraft);
      const [tray, setTray] = useState<TrayItem[]>([vid8, img1]);
      mtEditedDraft = draft;
      mtEditedTray = tray;
      return (
        <VideoConfirmCard
          mode="motion_transfer"
          draft={draft}
          tray={tray}
          model={seedance}
          copy={KO_COPY}
          modesCopy={KO_MODES}
          cost={`${dockCredits(draft, tray)} 크레딧`}
          busy={false}
          disabled={false}
          videoSeconds={8}
          onDraft={setDraft}
          onTrayUpdate={(key, patch) => setTray((cur) => cur.map((t) => (t.key === key ? { ...t, ...patch } : t)))}
          onEditWords={noop}
          onMake={noop}
          onClose={noop}
        />
      );
    }
    const mtDom = await mountDom(<MtCardHarness />);
    try {
      await mtDom.click('[data-confirm-line-btn="change"]');
      const personBtn = mtDom.queryAll(`[data-confirm-ref-key="${img1.key}"] button`).find((b) => b.textContent === KO_COPY.roles.person)!;
      await mtDom.click(personBtn);
      await mtDom.click('[data-confirm-line-btn="length"]');
      await mtDom.click('[data-length-option="1x10"]');
      await mtDom.click('[data-confirm-line-btn="sound"]');
      await mtDom.click('[data-confirm-sound-option="native"] input');

      const mainMtDraft: DockDraft = {
        ...mainRemixMethodPatch(mtStartDraft, "reference"),
        seconds: 10,
        targetTotalSeconds: 10,
        clipCount: 1,
        audio: "native",
      };
      const mainMtTray: TrayItem[] = [vid8, { ...img1, role: "person" }];
      expect(buildMultiClipJobs(mtEditedDraft, mtEditedTray, ids)).toEqual(
        buildMultiClipJobs(mainMtDraft, mainMtTray, ids),
      );
      expect(buildJob(mtEditedDraft, mtEditedTray, { organizationId: ORG, requestId: ids.requestIds[0]! })).toEqual(
        buildJob(mainMtDraft, mainMtTray, { organizationId: ORG, requestId: ids.requestIds[0]! }),
      );
    } finally {
      await mtDom.unmount();
    }
  });

  it("B1 + S4: Enter in prompt field NEVER submits a paid run in video modes; closed org & 기본 preserve main submit path", async () => {
    const baseRa = { ...draftAfterAttach(initialDraft("video"), vid8, true, [vid8]), prompt: "Remake it", method: "blueprint" as const, methodPinned: true };
    const sheet = {
      seconds: 8,
      aspect: "9:16",
      shots: [{ start: 0, end: 8, framing: "medium", camera: "pan", action: "walk" }],
      look: { lighting: "soft", palette: "cool", texture: "clean" },
      audio: { music: false, speech: false, effects: "" },
      summary: "8초 컷",
    };

    const mountDock = async (opts: {
      mode?: "video" | "image";
      draft: DockDraft;
      tray: TrayItem[];
      busy?: boolean;
      openModes?: boolean;
      confirmOpen?: boolean;
      onSubmit: () => void;
      onOpenConfirm?: () => void;
    }) => {
      const m = opts.mode ?? "video";
      const availability = videoModeAvailability({ draft: opts.draft, tray: opts.tray, film: { status: "done", sheet }, copy: KO_COPY, videoCopy: KO_VIDEO });
      const vm: VideoModesDockProp | undefined = opts.openModes
        ? {
            activeMode: deriveVideoMode(opts.draft, opts.tray, null),
            pendingMode: null,
            availability,
            copy: KO_MODES,
            undo: false,
            forcedLimitMessage: null,
            confirmOpen: Boolean(opts.confirmOpen),
            waitingForReading: false,
            queuedConfirmOnRead: false,
            onSelectMode: noop,
            onUndoRemoveVideo: noop,
            onOpenConfirm: opts.onOpenConfirm ?? noop,
            onCloseConfirm: noop,
          }
        : undefined;
      return mountDom(
        <Dock
          mode={m}
          organizationId={ORG}
          draft={opts.draft}
          tray={opts.tray}
          labels={trayLabels(opts.tray, KO_COPY)}
          copy={KO_COPY}
          locale="ko"
          allowance={allowance()}
          credits={dockCredits(opts.draft, opts.tray)}
          busy={Boolean(opts.busy)}
          message={null}
          film={{ status: "done", sheet }}
          uploading={[]}
          videoCopy={KO_VIDEO}
          videoModes={vm}
          onDraft={noop}
          onTrayUpdate={noop}
          onTrayRemove={noop}
          onSubmit={opts.onSubmit}
          onDropSource={noop}
          onFiles={noop}
          onBrowse={noop}
        />,
      );
    };

    // B1 Case 1: Card OPEN -> Enter in field -> onSubmit NOT called! ONLY [data-confirm-make] calls onSubmit.
    const onSubmitOpen = vi.fn();
    const domOpen = await mountDock({ draft: baseRa, tray: [vid8], openModes: true, confirmOpen: true, onSubmit: onSubmitOpen });
    try {
      const formEl = domOpen.query("form")!;
      (formEl as unknown as { requestSubmit: () => void }).requestSubmit = () => void domOpen.submit(formEl);
      const ta = domOpen.query("textarea.bs-prompt")!;
      ta.focus();
      await domOpen.keyDown("Enter", { target: ta });
      await domOpen.submit(formEl);
      expect(onSubmitOpen).not.toHaveBeenCalled();

      await domOpen.click("[data-confirm-make]");
      expect(onSubmitOpen).toHaveBeenCalledTimes(1);
    } finally {
      await domOpen.unmount();
    }

    // B1 Case 2: Card CLOSED in Re-Architect -> Enter opens card, onSubmit NOT called!
    const onSubmitClosedCard = vi.fn();
    const onOpenConfirm = vi.fn();
    const domClosedCard = await mountDock({
      draft: baseRa,
      tray: [vid8],
      openModes: true,
      confirmOpen: false,
      onSubmit: onSubmitClosedCard,
      onOpenConfirm,
    });
    try {
      await domClosedCard.submit("form");
      expect(onOpenConfirm).toHaveBeenCalledTimes(1);
      expect(onSubmitClosedCard).not.toHaveBeenCalled();
    } finally {
      await domClosedCard.unmount();
    }

    // B1 Case 3: 기본 mode -> form submit calls onSubmit once (unchanged)
    const onSubmitBasic = vi.fn();
    const domBasic = await mountDock({
      draft: { ...initialDraft("video"), prompt: "Dolly over bottle" },
      tray: [],
      openModes: true,
      onSubmit: onSubmitBasic,
    });
    try {
      await domBasic.submit("form");
      expect(onSubmitBasic).toHaveBeenCalledTimes(1);
    } finally {
      await domBasic.unmount();
    }

    // S4: Closed org & image studio busy form submit STILL calls props.onSubmit (same as main)
    const onSubmitClosedBusy = vi.fn();
    const domClosedBusy = await mountDock({
      mode: "image",
      draft: { ...initialDraft("image"), prompt: "Studio bottle" },
      tray: [],
      busy: true,
      openModes: false,
      onSubmit: onSubmitClosedBusy,
    });
    try {
      await domClosedBusy.submit("form");
      expect(onSubmitClosedBusy).toHaveBeenCalledTimes(1);
    } finally {
      await domClosedBusy.unmount();
    }
  });

  it("S1 + S2: blueprint reuse restores dock + opens confirm card when switch is open (reverse when closed); ?tab=edit never pins edit when open", async () => {
    const vidAsset = asset(3, { id: vid8.assetId!, kind: "video", seconds: 8, width: 720, height: 1280 });
    const imgAsset = asset(1, { id: img1.assetId!, kind: "image", name: "bottle.png", width: 1024, height: 1024 });
    const bpJob = job(40, {
      kind: "video_remix",
      method: "blueprint",
      prompt: "Studio commercial remake",
      change: "Swap product bottle",
      seconds: 10,
      audio: "silent",
      references: [
        { assetId: vidAsset.id },
        { assetId: imgAsset.id, role: "product", use: "bottle silhouette" },
      ],
    });
    const lookup = {
      asset: (id: string) => (id === vidAsset.id ? vidAsset : id === imgAsset.id ? imgAsset : null),
      output: () => null,
    };

    // Closed switch -> reverse panel (unchanged)
    expect(planReuse(bpJob, { current: initialDraft("video"), lookup, outputName: "결과" })).toEqual({
      to: "reverse",
      jobId: bpJob.id,
    });

    // Open switch -> restores dock (video + image with role/use, method: blueprint pinned, change, seconds, sound) + openConfirm
    const openPlan = planReuse(bpJob, { current: initialDraft("video"), lookup, outputName: "결과", blueprintToDock: true });
    expect(openPlan.to).toBe("dock");
    if (openPlan.to === "dock") {
      expect(openPlan.openConfirm).toBe(true);
      expect(openPlan.draft).toMatchObject({
        method: "blueprint",
        methodPinned: true,
        change: "Swap product bottle",
        seconds: 10,
        audio: "silent",
      });
      expect(openPlan.tray.map((t) => [t.kind, t.assetId, t.role, t.use])).toEqual([
        ["video", vidAsset.id, undefined, undefined],
        ["image", imgAsset.id, "product", "bottle silhouette"],
      ]);
    }

    // Mounted useViewer + useVideoModes: reusing blueprint job restores dock AND keeps confirm card open!
    let triggerReuse: (() => void) | null = null;
    function ReuseHarness() {
      const [studio] = useState(stubStudio);
      const dock = useDock({ studio, copy: KO_COPY, organizationId: ORG, initialMedium: "video", mode: "video" });
      const remixOn = remixActive(dock.draft, dock.tray);
      const vm = useVideoModes({
        enabled: true,
        modesCopy: KO_MODES,
        dock,
        copy: KO_COPY,
        videoCopy: KO_VIDEO,
        remixOn,
        remixFilm: null,
      });
      const viewer = useViewer({
        studio,
        dock,
        copy: KO_COPY,
        locale: "ko",
        mode: "video",
        organizationId: ORG,
        jobs: [bpJob],
        assets: [vidAsset, imgAsset],
        lookup,
        onCampaign: noop,
        onDecorate: noop,
        onReview: noop,
        onToVideoScreen: noop,
        onRegionSending: noop,
        focusPrompt: noop,
        blueprintToDock: true,
        onReuseOpenConfirm: vm.openConfirmForReuse,
      });
      triggerReuse = () => viewer.actions.reuse(bpJob);
      return (
        <div>
          <span data-reuse-confirm-open={vm.dockProp?.confirmOpen ? "1" : "0"} />
          <span data-reuse-mode={vm.dockProp?.activeMode} />
          <span data-reuse-tray-len={String(dock.tray.length)} />
          <span data-reuse-change={dock.draft.change} />
        </div>
      );
    }
    const domReuse = await mountDom(<ReuseHarness />);
    try {
      await act(async () => {
        triggerReuse!();
      });
      expect(domReuse.query("[data-reuse-confirm-open]")?.getAttribute("data-reuse-confirm-open")).toBe("1");
      expect(domReuse.query("[data-reuse-mode]")?.getAttribute("data-reuse-mode")).toBe("re_architect");
      expect(domReuse.query("[data-reuse-tray-len]")?.getAttribute("data-reuse-tray-len")).toBe("2");
      expect(domReuse.query("[data-reuse-change]")?.getAttribute("data-reuse-change")).toBe("Swap product bottle");
    } finally {
      await domReuse.unmount();
    }

    // S2: `?tab=edit&asset=` with switch OPEN attaches video & lets automatic routing choose (NEVER pins `method: "edit"`).
    //     With switch CLOSED it still pins `method: "edit"` (unchanged).
    const prevLocation = (globalThis as Record<string, unknown>).location;
    (globalThis as Record<string, unknown>).location = new URL(
      `https://twings.app/brand/studio/video?tab=edit&asset=${vidAsset.id}`,
    );
    const editProps = {
      organizationId: ORG,
      locale: "ko" as const,
      copy: KO_COPY,
      libraryCopy: KO_DICT.studioLibrary,
      videoCopy: KO_VIDEO,
      initialTab: "edit" as const,
      initialAssetId: vidAsset.id,
      initialState: studioState({ canCreate: true, assets: [vidAsset], jobs: [] }),
    };
    const domEditOpen = await mountDom(<VideoStudioWorkspace {...editProps} videoModes videoModesCopy={KO_MODES} />);
    try {
      expect(domEditOpen.query("[data-video-mode-trigger]")?.getAttribute("aria-label")).toBe("모드: Motion Transfer");
      expect(domEditOpen.query('[data-studio-remix-method="edit"]')).toBeNull();
    } finally {
      await domEditOpen.unmount();
      if (prevLocation === undefined) delete (globalThis as Record<string, unknown>).location;
      else (globalThis as Record<string, unknown>).location = prevLocation;
    }
  });

  it("matches main's request body byte-for-byte across every mode x tray combination and applyCardLengthPlan", () => {
    const avail = (draft: DockDraft, tray: readonly TrayItem[]) =>
      videoModeAvailability({ draft, tray, film: null, copy: KO_COPY, videoCopy: KO_VIDEO });

    function assertIdenticalBuild(label: string, modeDraft: DockDraft, mainDraft: DockDraft, tray: TrayItem[]) {
      const fromModes = buildMultiClipJobs(modeDraft, tray, ids);
      const fromMain = buildMultiClipJobs(mainDraft, tray, ids);
      expect(fromModes.ok, label).toBe(true);
      expect(fromMain.ok, label).toBe(true);
      expect(fromModes, label).toEqual(fromMain);
      if (fromModes.ok && fromModes.inputs.length === 1) {
        expect(buildJob(modeDraft, tray, { organizationId: ORG, requestId: ids.requestIds[0]! }), label).toEqual(
          buildJob(mainDraft, tray, { organizationId: ORG, requestId: ids.requestIds[0]! }),
        );
      }
    }

    const typed = (prompt: string, change = ""): DockDraft => ({ ...initialDraft("video"), prompt, change });

    // Empty tray (기본)
    const emptyBase = typed("Slow dolly over perfume bottle");
    const emptyMode = selectVideoMode({ target: "basic", draft: emptyBase, tray: [], ui: INITIAL_VIDEO_MODES_STATE, availability: avail(emptyBase, []) }).draft;
    assertIdenticalBuild("기본 + empty", emptyMode, emptyBase, []);

    // Image + audio (기본)
    const imgBase = typed("@image1 slow push-in");
    const imgMode = draftAndStateAfterVideoAttach({ draft: imgBase, nextTray: [img1, aud1], item: img1, ui: INITIAL_VIDEO_MODES_STATE, copy: KO_COPY }).draft;
    assertIdenticalBuild("기본 + image + audio", imgMode, draftAfterAttach(imgBase, img1, true, [img1, aud1]), [img1, aud1]);

    // Video <= 30s — Re-Architect & Motion Transfer
    const sBase = typed("Clean studio remake", "Swap product");
    const raPick = selectVideoMode({ target: "re_architect", draft: sBase, tray: [], ui: INITIAL_VIDEO_MODES_STATE, availability: avail(sBase, []) });
    const raMode = draftAndStateAfterVideoAttach({ draft: raPick.draft, nextTray: [vid8], item: vid8, ui: raPick.ui, copy: KO_COPY }).draft;
    assertIdenticalBuild("Re-Architect + video <= 30s", raMode, mainRemixMethodPatch(draftAfterAttach(sBase, vid8, true, [vid8]), "blueprint"), [vid8]);

    const mtPick = selectVideoMode({ target: "motion_transfer", draft: sBase, tray: [], ui: INITIAL_VIDEO_MODES_STATE, availability: avail(sBase, []) });
    const mtMode = draftAndStateAfterVideoAttach({ draft: mtPick.draft, nextTray: [vid8], item: vid8, ui: mtPick.ui, copy: KO_COPY }).draft;
    assertIdenticalBuild("Motion Transfer + video <= 30s", mtMode, mainRemixMethodPatch(draftAfterAttach(sBase, vid8, true, [vid8]), "reference"), [vid8]);

    // Video > 30s — Re-Architect
    const longBase = typed("Long runway remake", "New cast");
    const longPick = selectVideoMode({ target: "re_architect", draft: longBase, tray: [], ui: INITIAL_VIDEO_MODES_STATE, availability: avail(longBase, []) });
    const longMode = draftAndStateAfterVideoAttach({ draft: longPick.draft, nextTray: [vid42], item: vid42, ui: longPick.ui, copy: KO_COPY }).draft;
    assertIdenticalBuild("Re-Architect + video > 30s", longMode, mainRemixMethodPatch(draftAfterAttach(longBase, vid42, true, [vid42]), "blueprint"), [vid42]);

    // SMALL 1: singleLengthChoices, multiLengthChoices & applyCardLengthPlan derive from model bounds (no hardcoded 15)
    const customModel = { minSeconds: 3, maxSeconds: 12, defaultSeconds: 4 };
    expect(singleLengthChoices(customModel)).toEqual([3, 4, 5, 8, 10, 12]);
    expect(multiLengthChoices(customModel, 3)).toEqual([
      { clips: 2, total: 24 },
      { clips: 3, total: 36 },
    ]);
    expect(applyCardLengthPlan(raMode, 24, 2, 18, customModel)).toMatchObject({
      seconds: 12,
      clipCount: 2,
      targetTotalSeconds: 24,
    });

    // Two clips via applyCardLengthPlan (Seedance 15s max)
    const twoClip = applyCardLengthPlan(raMode, 30, 2, 18, seedance);
    expect(twoClip).toMatchObject({ seconds: 15, clipCount: 2, targetTotalSeconds: 30 });
    expect(confirmCardSignature("re_architect", [vid8, img1])).not.toBe(confirmCardSignature("motion_transfer", [vid8, img1]));
    // Role/note edits do NOT invalidate confirmCardSignature
    const editedImg: TrayItem = { ...img1, role: "product", use: "bottle" };
    expect(confirmCardSignature("re_architect", [vid8, editedImg])).toBe(
      confirmCardSignature("re_architect", [vid8, img1]),
    );
  });
});

describe("6. Dynamic constants, tray need-video actions, W6 LibraryRail browse & RecentCreationsPanel drag", () => {
  it("tip and tray need-video limits & container formats follow constants dynamically", () => {
    expect(formatVideoContainers()).toBe("MP4 · MOV");
    expect(formatVideoContainers(["video/mp4", "video/webm"])).toBe("MP4 · WEBM");

    const customModel = {
      maxReferenceImages: 6,
      minSeconds: 3,
      maxSeconds: 12,
      referenceVideoSeconds: { min: 4, max: 25, editMin: 5 },
    };
    const basicTip = formatVideoModeTipLines({ mode: "basic", model: customModel, copy: KO_MODES.tip });
    expect(basicTip.give).toContain("6장");
    expect(basicTip.get).toContain("3~12초");

    const raTip = formatVideoModeTipLines({ mode: "re_architect", model: customModel, shotLimits: { secondsMax: 900 }, maxClips: 6, copy: KO_MODES.tip });
    expect(raTip.give).toContain("4초~15분");
    expect(raTip.get).toContain("6개 클립");

    expect(formatVideoWellLimits({ mode: "re_architect", model: seedance, copy: KO_MODES.well })).toBe("2초~10분 · 최대 50MB · MP4 · MOV");
    expect(
      formatVideoWellLimits({
        mode: "motion_transfer",
        model: customModel,
        limits: { videoBytesMax: 25_000_000 },
        videoMimes: ["video/mp4", "video/webm"],
        copy: KO_MODES.well,
      }),
    ).toBe("4~25초 · 최대 25MB · MP4 · WEBM");
  });

  it("VideoTrayNeedVideo file picker and library button forward callbacks", async () => {
    const onFiles = vi.fn();
    const onBrowse = vi.fn();
    const dom = await mountDom(
      <ul>
        <VideoTrayNeedVideo
          mode="re_architect"
          model={seedance}
          limits={STUDIO_LIMITS}
          shotLimits={STUDIO_SHOT_LIMITS}
          copy={KO_MODES}
          dropActive={false}
          disabled={false}
          onFiles={onFiles}
          onBrowse={onBrowse}
        />
      </ul>,
    );
    try {
      await dom.click("[data-video-well-pick-library]");
      expect(onBrowse).toHaveBeenCalledTimes(1);

      const input = dom.query("[data-video-well-file-input]") as unknown as {
        files: File[];
        value: string;
        dispatchEvent(ev: unknown): void;
      };
      const file = new File(["video-bytes"], "ref.mp4", { type: "video/mp4" });
      input.files = [file];
      await act(async () => {
        input.dispatchEvent({ type: "change", bubbles: true, cancelable: true, target: input, currentTarget: input, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
      });
      expect(onFiles).toHaveBeenCalledWith([file]);
    } finally {
      await dom.unmount();
    }
  });

  it("W6: 보관함에서 고르기 opens folded desktop LibraryRail AND focuses search", async () => {
    function RailHarness({ startCollapsed }: { startCollapsed: boolean }) {
      const [signal, setSignal] = useState(0);
      return (
        <div>
          <button type="button" data-trigger-browse onClick={() => setSignal((n) => n + 1)} />
          <LibraryRail
            id="rail-w6"
            organizationId={ORG}
            locale="ko"
            library={stubLibrary()}
            assets={[asset(1, { kind: "video", name: "sample.mp4" })]}
            outputOf={() => null}
            canCreate
            attachOnPress
            open={false}
            notice={null}
            uploading={[]}
            searchId="rail-search-w6"
            initialTab={startCollapsed ? "folders" : "uploads"}
            openSignal={signal}
            onClose={noop}
            onAttach={noop}
            onView={noop}
            onFiles={noop}
            onUpdate={async () => {}}
            onDelete={async () => {}}
            copy={KO_DICT.studioLibrary}
          />
        </div>
      );
    }

    const domClosed = await mountDom(<RailHarness startCollapsed />);
    try {
      await domClosed.click(".bsr-fold");
      expect(domClosed.query("[data-library-rail]")?.getAttribute("data-collapsed")).toBe("");
      await domClosed.click("[data-trigger-browse]");
      expect(domClosed.query("[data-library-rail]")?.getAttribute("data-collapsed")).toBeNull();
      expect(domClosed.query("[data-library-rail]")?.getAttribute("data-library-tab")).toBe("uploads");
      expect(document.activeElement?.getAttribute("id")).toBe("rail-search-w6");
    } finally {
      try {
        window.localStorage.removeItem(RAIL_STORAGE_KEY);
      } catch {}
      await domClosed.unmount();
    }
  });

  it("RecentCreationsPanel cards are draggable ONLY when draggableRefs && canEdit", async () => {
    const vidOut = output(20, { kind: "video", url: "https://media.example/st/out-20.mp4", seconds: 6 });
    const imgOut = output(21, { kind: "image" });
    const allJobs = [
      job(20, { kind: "video", prompt: "Night walk", outputs: [vidOut] }),
      job(21, { kind: "image", prompt: "Glass flacon", outputs: [imgOut] }),
    ];

    expect(
      renderToStaticMarkup(
        <RecentCreationsPanel allJobs={allJobs} canEdit copy={KO_VIDEO.workspace.drawer} onAttachOutput={noop} onAddVideoToSequence={noop} />,
      ),
    ).not.toContain('draggable="true"');

    const dom = await mountDom(
      <RecentCreationsPanel allJobs={allJobs} canEdit draggableRefs copy={KO_VIDEO.workspace.drawer} onAttachOutput={noop} onAddVideoToSequence={noop} />,
    );
    try {
      const card = dom.query(`[data-recent-output="${vidOut.id}"]`)!;
      expect(card.getAttribute("draggable")).toBe("true");
      const setData = vi.fn();
      const dt = { setData, effectAllowed: "" };
      await act(async () => {
        (card as unknown as { dispatchEvent(ev: unknown): void }).dispatchEvent({
          type: "dragstart",
          bubbles: true,
          cancelable: true,
          target: card,
          currentTarget: card,
          dataTransfer: dt,
          preventDefault() {},
          stopPropagation() {},
          stopImmediatePropagation() {},
        });
      });
      expect(setData).toHaveBeenCalledWith(REF_DRAG_TYPE, JSON.stringify({ outputId: vidOut.id }));
      expect(acceptsDrag([REF_DRAG_TYPE])).toBe(true);
      expect(decodeRefDrag(JSON.stringify({ assetId: vid8.assetId }))).toEqual({ assetId: vid8.assetId });
    } finally {
      await dom.unmount();
    }
  });
});

describe("7. Copy hygiene, CSS tokens, reduced motion & zero-hex guard", () => {
  it("has zero vendor/engine/won strings and no hardcoded numbers in tip copy", () => {
    expect(studioVideoModesKo.cta.review).toBe("확인하기");
    expect(studioVideoModesKo.card.make).toBe("이대로 만들기");
    expect(studioVideoModesKo.card.editWords).toBe("고쳐 말하기");
    expect(studioVideoModesKo.status.readAgain).toBe("다시 읽기");
    // Final round exact Korean strings + pruned unused keys
    expect(studioVideoModesKo.card.followReArchitect).toBe("참고 영상의 컷 구성과 카메라 움직임을 따라가요");
    expect(studioVideoModesKo.card.changeEmpty).toBe("설명한 내용을 반영해요");
    expect(studioVideoModesKo.card.shotsNotCarried).toBe("수정했던 샷 표는 유지되지 않아요. 영상을 다시 읽어 새로 만들게요.");
    expect(studioVideoModesKo.explainer.reArchitect.step2).toBe("연출 읽기");
    expect("buttonLabel" in studioVideoModesKo.tip).toBe(false);
    expect("refSwap" in studioVideoModesKo.card).toBe(false);
    expect("refPickRole" in studioVideoModesKo.card).toBe(false);

    const all = JSON.stringify([studioVideoModesKo, studioVideoModesEn, EN_DICT.studioVideoModes]);
    for (const banned of [/seedance/i, /gemini/i, /sunra/i, /kling/i, /higgsfield/i, /morphic|모픽/i, /₩|\d원\b/]) {
      expect(all).not.toMatch(banned);
    }
    expect(JSON.stringify([studioVideoModesKo.tip, studioVideoModesEn.tip])).not.toMatch(/\d/);
    expect(JSON.stringify([studioVideoModesEn.oneLiners, studioVideoModesEn.tip])).not.toMatch(/\b(exactly|keeps|preserves)\b/i);
  });

  it("uses existing studio CSS tokens only, supports reduced motion, and keeps neutral guidance", () => {
    const studioCss = readFileSync(resolve(process.cwd(), "app/(brand)/studio-v2.css"), "utf8");
    const vmodeSection = studioCss.slice(studioCss.indexOf("/* Video studio modes (slice VM-2"));
    expect(vmodeSection).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(vmodeSection).toContain("prefers-reduced-motion: reduce");
    expect(vmodeSection).toContain(".bs-vmode-info-pop");
    expect(vmodeSection).toContain(".bs-vmode-tray-need");
    expect(vmodeSection).toContain(".bs-vmode-card");
    expect(vmodeSection).toContain(".bs-dock[data-confirm-open]");
    expect(vmodeSection).toContain(".bs-thumb-read");
    expect(vmodeSection).toContain(".bs-vmode-card-row-btn");
    expect(vmodeSection).toContain(".bs-dock-guidance");
    expect(vmodeSection).not.toContain("--ys-danger");
    // W2 + W3: Pin compact dock/card CSS height budget & 28px rounded card thumbnails + 2-line reply clamp
    expect(vmodeSection).toContain(".bs-dock[data-confirm-open] { gap: 4px; padding: 6px 12px; }");
    expect(vmodeSection).toContain(".bs-dock[data-confirm-open] .bs-thumb { width: 36px; height: 36px; border-radius: 8px; }");
    expect(vmodeSection).toContain(".bs-vmode-card-reply[data-clamped] { display: -webkit-box; -webkit-line-clamp: 2;");
    expect(vmodeSection).toContain(".bs-vmode-card-thumb { display: block; width: 28px; height: 28px; border-radius: 8px;");
    expect(vmodeSection).toContain("min-height: 20px; height: 20px;");
    expect(vmodeSection).toContain("min-height: 30px; height: 30px;");
    expect(vmodeSection).toContain(".bs-vmode-card-qopt { display: inline-flex; align-items: center; gap: 5px; min-height: 28px; height: 28px;");
    expect(vmodeSection).toContain(".bs-vmode-card-edit-btn, .bs-vmode-card-make-btn { min-height: 24px; height: 24px;");

    const explainerCss = readFileSync(resolve(process.cwd(), "components/brand-studio/video/mode-explainer.module.css"), "utf8");
    expect(explainerCss).toContain("prefers-reduced-motion: reduce");
    expect(explainerCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("8. Fix Round 1 leftovers & Batch B client (`video.understand`)", () => {
  const ids = { organizationId: ORG, requestIds: ["req-b-0001", "req-b-0002"] };
  const img2: TrayItem = trayItemFromAsset(asset(11, { kind: "image", name: "mood.jpg", width: 1024, height: 1024 }));
  const img3: TrayItem = trayItemFromAsset(asset(12, { kind: "image", name: "model.jpg", width: 1024, height: 1024 }));

  it("Fix round 1 leftover 1: reusing an old partial-edit run maps to Motion Transfer (`reference`) when open; stays `edit` when closed", () => {
    const vidAsset = asset(3, { id: vid8.assetId!, kind: "video", seconds: 8, width: 720, height: 1280 });
    const editJob = job(41, {
      kind: "video_remix",
      method: "edit",
      prompt: "Change bottle cap to silver",
      change: "Silver cap",
      seconds: 8,
      audio: "native",
      references: [{ assetId: vidAsset.id }],
    });
    const lookup = { asset: (id: string) => (id === vidAsset.id ? vidAsset : null), output: () => null };

    // Closed org -> keeps `method: "edit"` as on main
    const closedPlan = planReuse(editJob, { current: initialDraft("video"), lookup, outputName: "결과" });
    expect(closedPlan.to).toBe("dock");
    if (closedPlan.to === "dock") {
      expect(closedPlan.draft.method).toBe("edit");
      const builtClosed = buildJob(closedPlan.draft, closedPlan.tray, { organizationId: ORG, requestId: ids.requestIds[0]! });
      expect(builtClosed.ok).toBe(true);
      if (builtClosed.ok) expect(builtClosed.input).toMatchObject({ kind: "video_remix", method: "edit" });
    }

    // Open org -> maps to `reference` (Motion Transfer) with clipCount=1, targetTotalSeconds=null
    const openPlan = planReuse(editJob, { current: initialDraft("video"), lookup, outputName: "결과", blueprintToDock: true });
    expect(openPlan.to).toBe("dock");
    if (openPlan.to === "dock") {
      expect(openPlan.draft).toMatchObject({
        method: "reference",
        methodPinned: true,
        clipCount: 1,
        targetTotalSeconds: null,
      });
      const builtOpen = buildJob(openPlan.draft, openPlan.tray, { organizationId: ORG, requestId: ids.requestIds[0]! });
      expect(builtOpen.ok).toBe(true);
      if (builtOpen.ok) expect(builtOpen.input).toMatchObject({ kind: "video_remix", method: "reference" });
    }
  });

  it("Fix round 1 leftover 2a & 2b: strips multi-clip headers on blueprint reuse and surfaces shotsNotCarried quiet line for edited shot tables", () => {
    const multiPrompt = [
      "Reference authority: keep @image1 identity, product details, wardrobe, camera world, lighting, and color tone locked across all 2 parts.",
      "[Part 1/2 · 0.0s–15.0s]",
      "Swap in our cobalt bottle",
    ].join("\n");
    expect(stripMultiClipPromptHeaders(multiPrompt)).toBe("Swap in our cobalt bottle");

    const vidAsset = asset(3, { id: vid8.assetId!, kind: "video", seconds: 8, width: 720, height: 1280 });
    const bpJob = job(42, {
      kind: "video_remix",
      method: "blueprint",
      prompt: multiPrompt,
      change: "Cobalt bottle",
      seconds: 15,
      audio: "ambient",
      shots: [{ start: 0, end: 8, framing: "medium", camera: "pan", action: "custom shot" }],
      references: [{ assetId: vidAsset.id }],
    });
    const lookup = { asset: (id: string) => (id === vidAsset.id ? vidAsset : null), output: () => null };
    const plan = planReuse(bpJob, { current: initialDraft("video"), lookup, outputName: "결과", blueprintToDock: true });
    expect(plan.to).toBe("dock");
    if (plan.to === "dock") {
      expect(plan.draft.prompt).toBe("Swap in our cobalt bottle");
      expect(plan.shotsNotCarried).toBe(true);
      const html = renderToStaticMarkup(
        <VideoConfirmCard
          mode="re_architect"
          draft={plan.draft}
          tray={plan.tray}
          model={seedance}
          copy={KO_COPY}
          modesCopy={KO_MODES}
          cost="81 크레딧"
          busy={false}
          disabled={false}
          videoSeconds={8}
          shotsNotCarried
          onDraft={noop}
          onTrayUpdate={noop}
          onEditWords={noop}
          onMake={noop}
          onClose={noop}
        />,
      );
      expect(html).toContain("data-confirm-shots-note");
      expect(html).toContain(KO_MODES.card.shotsNotCarried);
    }
  });

  it("Batch B: applyUnderstandCardToDraftAndTray re-checks refIndex against client tray, writes settled requestText, and matches main builders byte-for-byte", () => {
    const startDraft: DockDraft = {
      ...draftAfterAttach(initialDraft("video"), vid8, true, [vid8, img1, img2, img3]),
      method: "blueprint",
      methodPinned: true,
      prompt: "원본 영상 1번에서 2번 이미지의 미감대로 3번 이미지의 인물로 교체해서 생성",
    };
    const card = {
      swaps: [
        { refIndex: 2, role: "style" as const, label: "미감 반영", use: "색감과 조명", avoid: "과도한 대비" },
        { refIndex: 3, role: "person" as const, label: "인물 교체", use: "얼굴과 헤어", avoid: "" },
        // Out-of-bounds refIndex=9 must be DROPPED by client re-check!
        { refIndex: 9, role: "product" as const, label: "없는 이미지", use: "", avoid: "" },
      ],
      changeText: "2번 이미지 미감 반영, 3번 이미지 인물로 교체",
      requestText: "참고 영상 연출을 따라가며 2번 이미지 미감을 반영하고 3번 이미지 인물로 교체합니다.",
      seconds: 10,
      clipCount: 1,
      targetTotalSeconds: 10,
      audio: "silent" as const,
    };
    const applied = applyUnderstandCardToDraftAndTray({
      card,
      draft: startDraft,
      tray: [vid8, img1, img2, img3, aud1],
      model: seedance,
      videoSeconds: 8,
    });
    expect(applied.appliedSwaps).toBe(2);
    expect(applied.droppedSwaps).toBe(1);
    expect(applied.draft.prompt).toBe(card.requestText);
    expect(applied.draft.change).toBe(card.changeText);
    expect(applied.draft.seconds).toBe(10);
    expect(applied.draft.audio).toBe("silent");
    expect(applied.tray.find((t) => t.key === img2.key)).toMatchObject({ role: "style", use: "색감과 조명", avoid: "과도한 대비" });
    expect(applied.tray.find((t) => t.key === img3.key)).toMatchObject({ role: "person", use: "얼굴과 헤어", avoid: "" });
    expect(applied.tray.find((t) => t.key === aud1.key)?.role).toBeUndefined();

    // Request-body equality vs main builders fed the same field values
    const mainDraft: DockDraft = {
      ...startDraft,
      prompt: card.requestText,
      change: card.changeText,
      seconds: 10,
      targetTotalSeconds: 10,
      clipCount: 1,
      audio: "silent",
    };
    const mainTray: TrayItem[] = [
      vid8,
      img1,
      { ...img2, role: "style", use: "색감과 조명", avoid: "과도한 대비" },
      { ...img3, role: "person", use: "얼굴과 헤어", avoid: "" },
      aud1,
    ];
    expect(buildMultiClipJobs(applied.draft, applied.tray, ids)).toEqual(buildMultiClipJobs(mainDraft, mainTray, ids));
    expect(buildJob(applied.draft, applied.tray, { organizationId: ORG, requestId: ids.requestIds[0]! })).toEqual(
      buildJob(mainDraft, mainTray, { organizationId: ORG, requestId: ids.requestIds[0]! }),
    );

    // Payload builder + sessionStorage roundtrip
    const input = buildUnderstandInput({
      organizationId: ORG,
      mode: "re_architect",
      draft: startDraft,
      tray: [vid8, img1, img2, img3],
      message: startDraft.prompt,
      videoAssetId: vid8.assetId,
    });
    expect((input.references ?? []).map((r) => [r.kind, r.index])).toEqual([
      ["video", 1],
      ["image", 1],
      ["image", 2],
      ["image", 3],
    ]);

    const store = (() => {
      const m = new Map<string, string>();
      return {
        get length() { return m.size; },
        clear: () => m.clear(),
        getItem: (k: string) => m.get(k) ?? null,
        key: (i: number) => [...m.keys()][i] ?? null,
        removeItem: (k: string) => { m.delete(k); },
        setItem: (k: string, v: string) => { m.set(k, v); },
      } as Storage;
    })();
    writeUnderstandSession(
      { sig: "s1", card, questions: [], openQuestion: null, reply: "정리했어요.", readyToMake: true, turns: [], settledPrompt: card.requestText },
      store,
    );
    expect(store.getItem(VIDEO_UNDERSTAND_STORAGE_KEY)).toBeTruthy();
    expect(readUnderstandSession("s1", store)?.reply).toBe("정리했어요.");
    expect(readUnderstandSession("other-sig", store)).toBeNull();
    clearUnderstandSession(store);
    expect(readUnderstandSession("s1", store)).toBeNull();
  });

  it("Batch B client flow: checking/double-press, question chips, ㅇㅇ never auto-makes, credit/cancel hide make, reading retry, late answer dropped, manual edit stale, failure retry", async () => {
    let resolveUnderstand: ((res: unknown) => void) | null = null;
    const understandSpy = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveUnderstand = resolve;
        }),
    );
    const submitSpy = vi.fn();
    const sheet = {
      seconds: 8,
      aspect: "9:16",
      shots: [{ start: 0, end: 8, framing: "medium", camera: "pan", action: "walk" }],
      look: { lighting: "soft", palette: "cool", texture: "clean" },
      audio: { music: false, speech: false, effects: "" },
      summary: "8초 컷",
    };

    let setFilmState: ((f: { status: "loading" } | { status: "done"; sheet: typeof sheet | null } | null) => void) | null = null;
    let editPrompt: ((txt: string) => void) | null = null;
    let attachNewImg: (() => void) | null = null;
    let latestHtml = "";

    let triggerOpen: (() => void) | null = null;
    function BatchBHarness() {
      const [studio] = useState(stubStudio);
      const dock = useDock({ studio, copy: KO_COPY, organizationId: ORG, initialMedium: "video", mode: "video" });
      const [film, setFilm] = useState<{ status: "loading" } | { status: "done"; sheet: typeof sheet | null } | null>({ status: "done", sheet });
      setFilmState = setFilm;
      const remixOn = remixActive(dock.draft, dock.tray);
      const vm = useVideoModes({
        enabled: true,
        organizationId: ORG,
        modesCopy: KO_MODES,
        dock,
        copy: KO_COPY,
        videoCopy: KO_VIDEO,
        remixOn,
        remixFilm: film,
        remixVideoAssetId: vid8.assetId ?? null,
        understandVideo: understandSpy as unknown as NonNullable<Parameters<typeof useVideoModes>[0]["understandVideo"]>,
      });
      triggerOpen = () => vm.dockProp?.onOpenConfirm();
      editPrompt = (txt: string) => dock.setDraft((c) => ({ ...c, prompt: txt }));
      attachNewImg = () => vm.attachItem(img2);
      latestHtml = renderToStaticMarkup(
        <Dock
          mode="video"
          organizationId={ORG}
          draft={dock.draft}
          tray={dock.tray}
          labels={trayLabels(dock.tray, KO_COPY)}
          copy={KO_COPY}
          locale="ko"
          allowance={allowance()}
          credits={dockCredits(dock.draft, dock.tray)}
          busy={false}
          message={null}
          film={film}
          uploading={[]}
          videoCopy={KO_VIDEO}
          videoModes={vm.dockProp}
          onDraft={dock.setDraft}
          onTrayUpdate={dock.update}
          onTrayRemove={vm.removeTrayItem}
          onSubmit={submitSpy}
          onDropSource={noop}
          onFiles={noop}
          onBrowse={noop}
        />,
      );
      return (
        <div>
          <button type="button" data-seed onClick={() => { vm.attachItem(vid8); vm.attachItem(img1); dock.setDraft((c) => ({ ...c, prompt: "바꿔줘", method: "blueprint", methodPinned: true })); }} />
          <button type="button" data-open onClick={() => vm.dockProp?.onOpenConfirm()} />
          <button type="button" data-pick-opt0 onClick={() => vm.dockProp?.onPickOption?.(0)} />
          <button type="button" data-reunderstand onClick={() => vm.dockProp?.onReunderstand?.()} />
          <span data-checking={vm.dockProp?.checking ? "1" : "0"} />
          <span data-confirm={vm.dockProp?.confirmOpen ? "1" : "0"} />
          <span data-prompt={dock.draft.prompt} />
        </div>
      );
    }

    const dom = await mountDom(<BatchBHarness />);
    try {
      await dom.click("[data-seed]");

      // 1) Double-press `확인하기` -> ONLY ONE `video.understand` request; button shows `정리하는 중…`
      await act(async () => {
        triggerOpen!();
        triggerOpen!();
      });
      expect(understandSpy).toHaveBeenCalledTimes(1);
      expect(dom.query("[data-checking]")?.getAttribute("data-checking")).toBe("1");
      expect(latestHtml).toContain(KO_MODES.cta.checking);

      // 2) Model answers with an open question -> card opens with option chips, NO `[data-confirm-make]` button!
      await act(async () => {
        resolveUnderstand!({
          ok: true,
          kind: "plan",
          reply: "어떤 부분을 바꿀까요?",
          card: { swaps: [], changeText: "", requestText: "", seconds: 8, clipCount: 1, targetTotalSeconds: 8, audio: "ambient" },
          questions: [{ point: "target", text: "바꿀 대상을 골라 주세요.", options: [{ label: "1번 제품으로 교체" }, { label: "배경만 변경" }], answer: null }],
          openQuestion: 0,
          readyToMake: false,
        });
      });
      expect(dom.query("[data-confirm]")?.getAttribute("data-confirm")).toBe("1");
      expect(latestHtml).toContain("data-confirm-question");
      expect(latestHtml).toContain('data-confirm-option="0"');
      expect(latestHtml).not.toContain("data-confirm-make");

      // 3) Click option 0 -> answers question -> settled card fills prompt & enables `[data-confirm-make]`!
      await dom.click("[data-pick-opt0]");
      expect(understandSpy).toHaveBeenCalledTimes(2);
      await act(async () => {
        resolveUnderstand!({
          ok: true,
          kind: "answer",
          reply: "1번 이미지 제품으로 교체해 만들게요.",
          card: {
            swaps: [{ refIndex: 1, role: "product", label: "제품 교체", use: "", avoid: "" }],
            changeText: "1번 제품 교체",
            requestText: "참고 영상 연출대로 1번 이미지 제품으로 교체합니다.",
            seconds: 8,
            clipCount: 1,
            targetTotalSeconds: 8,
            audio: "ambient",
          },
          questions: [{ point: "target", text: "바꿀 대상을 골라 주세요.", options: [{ label: "1번 제품으로 교체" }], answer: "1번 제품으로 교체" }],
          openQuestion: null,
          readyToMake: true,
        });
      });
      expect(dom.query("[data-prompt]")?.getAttribute("data-prompt")).toBe("참고 영상 연출대로 1번 이미지 제품으로 교체합니다.");
      expect(latestHtml).toContain("data-confirm-make");
      expect(submitSpy).not.toHaveBeenCalled();

      // 4) Manual edit of settled sentence marks card stale and hides `[data-confirm-make]`!
      await act(async () => {
        editPrompt!("ㅇㅇ");
      });
      expect(latestHtml).toContain("data-confirm-stale");
      expect(latestHtml).not.toContain("data-confirm-make");

      // 5) Re-understand with "ㅇㅇ" (`kind: "confirm"`) -> card stays ready, STILL never calls `onSubmit`!
      await dom.click("[data-reunderstand]");
      await act(async () => {
        resolveUnderstand!({
          ok: true,
          kind: "confirm",
          reply: "이대로 진행할 준비가 되었어요.",
          card: {
            swaps: [{ refIndex: 1, role: "product", label: "제품 교체", use: "", avoid: "" }],
            changeText: "1번 제품 교체",
            requestText: "참고 영상 연출대로 1번 이미지 제품으로 교체합니다.",
            seconds: 8,
            clipCount: 1,
            targetTotalSeconds: 8,
            audio: "ambient",
          },
          questions: [],
          openQuestion: null,
          readyToMake: true,
        });
      });
      expect(latestHtml).toContain("data-confirm-make");
      expect(submitSpy).not.toHaveBeenCalled();

      // 6) Cold cache `kind: "reading"` -> keeps button in reading state, auto-retries when film lands!
      await act(async () => {
        setFilmState!({ status: "loading" });
      });
      await dom.click("[data-reunderstand]");
      await act(async () => {
        resolveUnderstand!({
          ok: true,
          kind: "reading",
          reply: null,
          card: { swaps: [], changeText: "", requestText: "", seconds: 8, clipCount: 1, targetTotalSeconds: 8, audio: "ambient" },
          questions: [],
          openQuestion: null,
          readyToMake: false,
        });
      });
      expect(dom.query("[data-confirm]")?.getAttribute("data-confirm")).toBe("0");
      expect(latestHtml).toContain(KO_MODES.cta.reading);
      const callsBeforeLand = understandSpy.mock.calls.length;
      await act(async () => {
        setFilmState!({ status: "done", sheet });
      });
      expect(understandSpy.mock.calls.length).toBe(callsBeforeLand + 1);

      // 7) Late answer after tray changes is DROPPED!
      await act(async () => {
        attachNewImg!();
      });
      await act(async () => {
        resolveUnderstand!({
          ok: true,
          kind: "plan",
          reply: "늦은 응답",
          card: { swaps: [], changeText: "stale", requestText: "stale", seconds: 8, clipCount: 1, targetTotalSeconds: 8, audio: "ambient" },
          questions: [],
          openQuestion: null,
          readyToMake: true,
        });
      });
      expect(dom.query("[data-confirm]")?.getAttribute("data-confirm")).toBe("0");
      expect(latestHtml).not.toContain("늦은 응답");

      // 8) Server failure -> shows `data-confirm-failed` + `data-confirm-retry`, NO make button!
      await dom.click("[data-open]");
      await act(async () => {
        resolveUnderstand!({ ok: false, code: "failed" });
      });
      expect(latestHtml).toContain("data-confirm-failed");
      expect(latestHtml).toContain("data-confirm-retry");
      expect(latestHtml).not.toContain("data-confirm-make");
    } finally {
      clearUnderstandSession();
      await dom.unmount();
    }
  });

  it("Fix round 1 (B1, S1, W1-W8): result video opens card without remixFilm, withdraw restores snapshot & clears prompt, Motion Transfer clamps cheating cards, credit strip, thumbnails, layout, unified reading word", async () => {
    const resultVid: TrayItem = {
      key: "out:res-vid-1",
      outputId: "33333333-3333-4333-8333-333333333333",
      kind: "video",
      name: "result.mp4",
      url: "https://cdn.example/res.mp4",
      thumbUrl: "https://cdn.example/res.jpg",
      seconds: 8,
    };
    const origImg1: TrayItem = { ...img1, role: "logo", use: "기존 로고", avoid: "기존 배경" };
    const origImg2: TrayItem = { ...img2, role: undefined, use: "", avoid: "" };

    // S1: Plan with 2 swaps -> withdraw image 2 -> image 2 restored to ORIGINAL role/notes (matches main's buildJob)
    const snap = {
      [origImg1.key]: { role: origImg1.role, use: origImg1.use ?? "", avoid: origImg1.avoid ?? "" },
      [origImg2.key]: { role: origImg2.role, use: origImg2.use ?? "", avoid: origImg2.avoid ?? "" },
    };
    const baseDraft: DockDraft = {
      ...initialDraft("video"),
      method: "blueprint",
      methodPinned: true,
      seconds: 8,
      prompt: "원본 영상 1번에서 2번 이미지의 미감대로 3번 이미지의 인물로",
    };
    const afterPlan = applyUnderstandCardToDraftAndTray({
      mode: "re_architect",
      snapshot: snap,
      draft: baseDraft,
      tray: [resultVid, origImg1, origImg2],
      card: {
        swaps: [
          { refIndex: 1, role: "style", label: "미감", use: "색감만", avoid: "" },
          { refIndex: 2, role: "person", label: "인물", use: "얼굴", avoid: "옷" },
        ],
        changeText: "@image1 미감, @image2 인물",
        requestText: "@video1 연출에 @image1 미감과 @image2 인물을 반영해요.",
        seconds: 8,
        clipCount: 1,
        targetTotalSeconds: 8,
        audio: "ambient",
      },
      model: seedance,
      videoSeconds: 8,
    });
    expect(afterPlan.tray[1]!.role).toBe("style");
    expect(afterPlan.tray[2]!.role).toBe("person");

    // Withdraw image 2 -> image 2 reverts to original undefined role & empty notes!
    const afterWithdrawOne = applyUnderstandCardToDraftAndTray({
      mode: "re_architect",
      snapshot: snap,
      draft: afterPlan.draft,
      tray: afterPlan.tray,
      card: {
        swaps: [{ refIndex: 1, role: "style", label: "미감", use: "색감만", avoid: "" }],
        changeText: "@image1 미감",
        requestText: "@video1 연출에 @image1 미감만 반영해요.",
        seconds: 8,
        clipCount: 1,
        targetTotalSeconds: 8,
        audio: "ambient",
      },
      model: seedance,
      videoSeconds: 8,
    });
    expect(afterWithdrawOne.tray[2]!.role).toBeUndefined();
    expect(afterWithdrawOne.tray[2]!.use).toBe("");
    expect(afterWithdrawOne.tray[2]!.avoid).toBe("");
    const mainTrayAfterWithdraw: TrayItem[] = [
      resultVid,
      { ...origImg1, role: "style", use: "색감만", avoid: "기존 배경" },
      origImg2,
    ];
    expect(
      buildJob(afterWithdrawOne.draft, afterWithdrawOne.tray, { organizationId: ORG, requestId: "req_s1_withdraw_1" }),
    ).toEqual(
      buildJob(afterWithdrawOne.draft, mainTrayAfterWithdraw, { organizationId: ORG, requestId: "req_s1_withdraw_1" }),
    );

    // W2: Motion Transfer with cheating answers (`seconds: 40, clipCount: 1` and `seconds: 40, clipCount: 3`) NEVER flips to Re-Architect!
    const mtDraft: DockDraft = {
      ...initialDraft("video"),
      method: "reference",
      methodPinned: true,
      seconds: 8,
      clipCount: 1,
      targetTotalSeconds: null,
      prompt: "40초로 만들어줘",
    };
    for (const cheatingClips of [1, 3]) {
      const clampedMt = applyUnderstandCardToDraftAndTray({
        mode: "motion_transfer",
        draft: mtDraft,
        tray: [resultVid, origImg1],
        card: {
          swaps: [{ refIndex: 1, role: "product", label: "제품", use: "", avoid: "" }],
          changeText: "@image1 제품",
          requestText: "@image1 제품으로 바꿔요.",
          seconds: 40,
          clipCount: cheatingClips,
          targetTotalSeconds: 40,
          audio: "ambient",
        },
        model: seedance,
        videoSeconds: 8,
      });
      expect(clampedMt.draft.method, `clips=${cheatingClips}`).toBe("reference");
      expect(clampedMt.draft.clipCount, `clips=${cheatingClips}`).toBe(1);
      expect(clampedMt.draft.targetTotalSeconds, `clips=${cheatingClips}`).toBeNull();
      expect(clampedMt.draft.seconds, `clips=${cheatingClips}`).toBe(seedance.maxSeconds);
      expect(deriveVideoMode(clampedMt.draft, clampedMt.tray, null)).toBe("motion_transfer");
    }

    // W1 payload carries BOTH `position` (tray order) and `index` (per-kind) and `mention`
    const w1Payload = buildUnderstandInput({
      organizationId: ORG,
      mode: "re_architect",
      draft: baseDraft,
      tray: [resultVid, origImg1, origImg2],
      message: baseDraft.prompt,
      videoAssetId: null,
    });
    expect((w1Payload.references ?? []).map((r) => [r.position, r.index, r.mention])).toEqual([
      [1, 1, "@video1"],
      [2, 1, "@image1"],
      [3, 2, "@image2"],
    ]);

    // B1 + W1 + W3 + W4 + W5 + W6 + W8 in mounted hook + Dock
    let resolveCall: ((res: unknown) => void) | null = null;
    const understandSpy = vi.fn(
      () => new Promise<unknown>((resolve) => { resolveCall = resolve; }),
    );
    const submitSpy = vi.fn();
    let latestHtml = "";

    function FixRound1Harness() {
      const [studio] = useState(stubStudio);
      const dock = useDock({ studio, copy: KO_COPY, organizationId: ORG, initialMedium: "video", mode: "video" });
      const remixOn = remixActive(dock.draft, dock.tray);
      // B1: result video has NO `remixVideoAssetId` (null) and `remixFilm` is null!
      const vm = useVideoModes({
        enabled: true,
        organizationId: ORG,
        modesCopy: KO_MODES,
        dock,
        copy: KO_COPY,
        videoCopy: KO_VIDEO,
        remixOn,
        remixFilm: null,
        remixVideoAssetId: null,
        understandVideo: understandSpy as unknown as NonNullable<Parameters<typeof useVideoModes>[0]["understandVideo"]>,
      });
      latestHtml = renderToStaticMarkup(
        <Dock
          mode="video"
          organizationId={ORG}
          draft={dock.draft}
          tray={dock.tray}
          labels={trayLabels(dock.tray, KO_COPY)}
          copy={KO_COPY}
          locale="ko"
          allowance={allowance()}
          credits={dockCredits(dock.draft, dock.tray)}
          busy={false}
          message={null}
          film={null}
          uploading={[]}
          videoCopy={KO_VIDEO}
          videoModes={vm.dockProp}
          onDraft={dock.setDraft}
          onTrayUpdate={dock.update}
          onTrayRemove={vm.removeTrayItem}
          onSubmit={submitSpy}
          onDropSource={noop}
          onFiles={noop}
          onBrowse={noop}
        />,
      );
      return (
        <div>
          <button
            type="button"
            data-seed-result
            onClick={() => {
              vm.attachItem(resultVid);
              vm.attachItem(origImg1);
              vm.attachItem(origImg2);
              dock.setDraft((c) => ({ ...c, prompt: "2번 이미지의 미감대로 3번 이미지의 인물로", method: "blueprint", methodPinned: true }));
            }}
          />
          <button type="button" data-open onClick={() => vm.dockProp?.onOpenConfirm()} />
          <button type="button" data-withdraw-all onClick={() => { dock.setDraft((c) => ({ ...c, prompt: "취소" })); vm.dockProp?.onReunderstand?.(); }} />
          <span data-prompt={dock.draft.prompt} />
          <span data-waiting={vm.dockProp?.waitingForReading ? "1" : "0"} />
        </div>
      );
    }

    const dom = await mountDom(<FixRound1Harness />);
    try {
      await dom.click("[data-seed-result]");
      // B1: Re-Architect with result video (no assetId, film=null) is NOT waitingForReading and calls understand immediately!
      expect(dom.query("[data-waiting]")?.getAttribute("data-waiting")).toBe("0");
      await dom.click("[data-open]");
      expect(understandSpy).toHaveBeenCalledTimes(1);

      // W1 + W3 + W6: Canned answer with credit figure in reply, customer nouns in swaps, thumbnail options
      await act(async () => {
        resolveCall!({
          ok: true,
          kind: "plan",
          reply: "총 241 크레딧이 들어요. @image1 미감과 @image2 인물로 만들게요.",
          card: {
            swaps: [
              { refIndex: 1, role: "style", label: "미감", use: "", avoid: "" },
              { refIndex: 2, role: "person", label: "인물", use: "", avoid: "" },
            ],
            changeText: "@image1 미감, @image2 인물",
            requestText: "@video1 연출대로 @image1 미감과 @image2 인물로 만들어요.",
            seconds: 8,
            clipCount: 1,
            targetTotalSeconds: 8,
            audio: "ambient",
          },
          questions: [],
          openQuestion: null,
          readyToMake: true,
        });
      });

      // W3: Credit figure stripped from displayed reply!
      expect(latestHtml).not.toContain("241 크레딧");
      expect(latestHtml).toContain("@image1 미감과 @image2 인물로 만들게요.");
      // W1: Card shows customer nouns (`미감`, `인물`) + thumbnails (`bs-vmode-card-thumb`), NOT catalogue role `스타일`!
      expect(latestHtml).toContain("data-confirm-swaps");
      expect(latestHtml).toContain("bs-vmode-card-thumb");
      expect(latestHtml).toContain("미감");
      expect(latestHtml).toContain("인물");
      // W6: Title `이렇게 만들게요` is at the TOP (`.bs-vmode-card-head`), before reply and rows!
      const headIdx = latestHtml.indexOf("bs-vmode-card-head");
      const replyIdx = latestHtml.indexOf("data-confirm-reply");
      const rowsIdx = latestHtml.indexOf("data-confirm-compact-rows");
      const footIdx = latestHtml.indexOf("bs-vmode-card-foot");
      expect(headIdx).toBeGreaterThan(-1);
      expect(headIdx).toBeLessThan(replyIdx);
      expect(replyIdx).toBeLessThan(rowsIdx);
      expect(rowsIdx).toBeLessThan(footIdx);

      // W5: Withdraw to nothing clears the text box (does NOT keep `취소`)!
      await dom.click("[data-withdraw-all]");
      await act(async () => {
        resolveCall!({
          ok: true,
          kind: "withdraw",
          reply: "설정을 모두 비웠어요.",
          card: { swaps: [], changeText: "", requestText: "", seconds: 8, clipCount: 1, targetTotalSeconds: 8, audio: "ambient" },
          questions: [],
          openQuestion: null,
          readyToMake: false,
        });
      });
      expect(dom.query("[data-prompt]")?.getAttribute("data-prompt")).toBe("");
      expect(submitSpy).not.toHaveBeenCalled();

      // W4 + W8: Unified button & reading copy
      expect(KO_MODES.cta.review).toBe("확인하기");
      expect(KO_MODES.cta.reviewAgain).toBe("다시 확인하기");
      expect(KO_MODES.card.staleNote).toContain(KO_MODES.cta.reviewAgain);
      expect(KO_MODES.tray.reading).toBe("읽는 중");
      expect(KO_MODES.tray.read).toBe("읽었어요");
      expect(KO_MODES.tray.unreadable).toBe("읽지 못했어요");
      expect(KO_MODES.cta.reading).toBe("읽는 중…");
    } finally {
      clearUnderstandSession();
      await dom.unmount();
    }
  });

  it("Fix round 2 (A3): hand edits on an image outside the card survive a later correction turn and are sent in buildJob", async () => {
    let resolveCall: ((res: unknown) => void) | null = null;
    const understandSpy = vi.fn(() => new Promise<unknown>((resolve) => { resolveCall = resolve; }));
    let latestTray: TrayItem[] = [];
    let latestDraft: DockDraft = initialDraft("video");

    function A3Harness() {
      const [studio] = useState(stubStudio);
      const dock = useDock({ studio, copy: KO_COPY, organizationId: ORG, initialMedium: "video", mode: "video" });
      const remixOn = remixActive(dock.draft, dock.tray);
      const vm = useVideoModes({
        enabled: true,
        organizationId: ORG,
        modesCopy: KO_MODES,
        dock,
        copy: KO_COPY,
        videoCopy: KO_VIDEO,
        remixOn,
        remixFilm: null,
        remixVideoAssetId: null,
        understandVideo: understandSpy as unknown as NonNullable<Parameters<typeof useVideoModes>[0]["understandVideo"]>,
      });
      latestTray = dock.tray;
      latestDraft = dock.draft;
      return (
        <div>
          <button
            type="button"
            data-seed
            onClick={() => {
              vm.attachItem(vid8);
              vm.attachItem(img1);
              vm.attachItem(img2);
              dock.setDraft((c) => ({ ...c, prompt: "@image1 미감으로", method: "reference", methodPinned: true }));
            }}
          />
          <button type="button" data-open onClick={() => vm.dockProp?.onOpenConfirm()} />
          <button
            type="button"
            data-hand-edit-img2
            onClick={() => vm.updateTrayItem(img2.key, { role: "logo", use: "로고만 선명하게", avoid: "배경" })}
          />
          <button
            type="button"
            data-correct
            onClick={() => {
              dock.setDraft((c) => ({ ...c, prompt: "@image1 제품으로 바꿔줘" }));
              vm.dockProp?.onReunderstand?.();
            }}
          />
        </div>
      );
    }

    const dom = await mountDom(<A3Harness />);
    try {
      await dom.click("[data-seed]");
      await dom.click("[data-open]");
      // Turn 1: Card sets ONLY image 1 (`style`), leaves image 2 untouched
      await act(async () => {
        resolveCall!({
          ok: true,
          kind: "plan",
          reply: "@image1 미감으로 정리했어요.",
          card: {
            swaps: [{ refIndex: 1, role: "style", label: "미감", use: "", avoid: "" }],
            changeText: "@image1 미감",
            requestText: "@video1에 @image1 미감을 반영해요.",
            seconds: 8,
            clipCount: 1,
            targetTotalSeconds: 8,
            audio: "ambient",
          },
          questions: [],
          openQuestion: null,
          readyToMake: true,
        });
      });

      // Customer hand-edits image 2 (via card line popover or tray popover -> `vm.updateTrayItem`)
      await dom.click("[data-hand-edit-img2]");
      expect(latestTray.find((t) => t.key === img2.key)).toMatchObject({
        role: "logo",
        use: "로고만 선명하게",
        avoid: "배경",
      });

      // Turn 2: Correction turn changes image 1 to `product` (does not mention image 2)
      await dom.click("[data-correct]");
      await act(async () => {
        resolveCall!({
          ok: true,
          kind: "correction",
          reply: "@image1 제품으로 바꿨어요.",
          card: {
            swaps: [{ refIndex: 1, role: "product", label: "제품", use: "", avoid: "" }],
            changeText: "@image1 제품",
            requestText: "@video1에 @image1 제품을 넣어요.",
            seconds: 8,
            clipCount: 1,
            targetTotalSeconds: 8,
            audio: "ambient",
          },
          questions: [],
          openQuestion: null,
          readyToMake: true,
        });
      });

      // Hand edit on image 2 MUST still be there AND be sent in `buildJob`!
      expect(latestTray.find((t) => t.key === img2.key)).toMatchObject({
        role: "logo",
        use: "로고만 선명하게",
        avoid: "배경",
      });
      const built = buildJob(latestDraft, latestTray, { organizationId: ORG, requestId: "req_a3_hand_edit" });
      expect(built.ok).toBe(true);
      if (built.ok && "references" in built.input && Array.isArray(built.input.references)) {
        const sentImg2 = built.input.references.find((r) => r.assetId === img2.assetId);
        expect(sentImg2).toMatchObject({ role: "logo", use: "로고만 선명하게", avoid: "배경" });
      }
    } finally {
      clearUnderstandSession();
      await dom.unmount();
    }
  });

  it("Fix round 3 (#2/#4): client stores and sends countingScheme with previous across corrections, and clears it on tray change", async () => {
    let resolveCall: ((res: unknown) => void) | null = null;
    const sentPayloads: Array<Record<string, unknown>> = [];
    const understandSpy = vi.fn((payload: Record<string, unknown>) => {
      sentPayloads.push(payload);
      return new Promise<unknown>((resolve) => { resolveCall = resolve; });
    });

    function SchemeHarness() {
      const [studio] = useState(stubStudio);
      const dock = useDock({ studio, copy: KO_COPY, organizationId: ORG, initialMedium: "video", mode: "video" });
      const remixOn = remixActive(dock.draft, dock.tray);
      const vm = useVideoModes({
        enabled: true,
        organizationId: ORG,
        modesCopy: KO_MODES,
        dock,
        copy: KO_COPY,
        videoCopy: KO_VIDEO,
        remixOn,
        remixFilm: null,
        remixVideoAssetId: null,
        understandVideo: understandSpy as unknown as NonNullable<Parameters<typeof useVideoModes>[0]["understandVideo"]>,
      });
      return (
        <div>
          <button
            type="button"
            data-seed
            onClick={() => {
              vm.attachItem(vid8);
              vm.attachItem(img1);
              vm.attachItem(img2);
              dock.setDraft((c) => ({ ...c, prompt: "1번 이미지 인물로 교체해줘", method: "reference", methodPinned: true }));
            }}
          />
          <button type="button" data-open onClick={() => vm.dockProp?.onOpenConfirm()} />
          <button
            type="button"
            data-correct
            onClick={() => {
              dock.setDraft((c) => ({ ...c, prompt: "아니, 2번 인물로" }));
              vm.dockProp?.onReunderstand?.();
            }}
          />
          <button type="button" data-add-img3 onClick={() => vm.attachItem(img3)} />
        </div>
      );
    }

    const dom = await mountDom(<SchemeHarness />);
    try {
      await dom.click("[data-seed]");
      await dom.click("[data-open]");
      // Turn 1 establishes `countingScheme: "perKind"`
      await act(async () => {
        resolveCall!({
          ok: true,
          kind: "plan",
          reply: "@image1 인물로 정리했어요.",
          countingScheme: "perKind",
          card: {
            swaps: [{ refIndex: 1, role: "person", label: "인물", use: "", avoid: "" }],
            changeText: "@image1 인물",
            requestText: "@video1에 @image1 인물을 넣어요.",
            seconds: 8,
            clipCount: 1,
            targetTotalSeconds: 8,
            audio: "ambient",
          },
          questions: [],
          openQuestion: null,
          readyToMake: true,
        });
      });

      // Turn 2 (correction) MUST carry `previous.countingScheme === "perKind"`
      await dom.click("[data-correct]");
      expect((sentPayloads[1]!.previous as { countingScheme?: string } | null)?.countingScheme).toBe("perKind");
      await act(async () => {
        resolveCall!({
          ok: true,
          kind: "correction",
          reply: "@image2 인물로 바꿨어요.",
          countingScheme: "perKind",
          card: {
            swaps: [{ refIndex: 2, role: "person", label: "인물", use: "", avoid: "" }],
            changeText: "@image2 인물",
            requestText: "@video1에 @image2 인물을 넣어요.",
            seconds: 8,
            clipCount: 1,
            targetTotalSeconds: 8,
            audio: "ambient",
          },
          questions: [],
          openQuestion: null,
          readyToMake: true,
        });
      });

      // Tray changes (attach img3) -> card & scheme discarded -> next turn sends `previous: null`!
      await dom.click("[data-add-img3]");
      await dom.click("[data-open]");
      expect(sentPayloads[2]!.previous).toBeNull();
    } finally {
      clearUnderstandSession();
      await dom.unmount();
    }
  });

  it("Final round (W1-W9): drops cheating invalid-role/over-limit swaps before draw & apply, 28px shared thumbs, whole-sentence credit drop + summary fallback, per-field hand-note preservation, full-withdraw placeholder, hand-set role merged in summary, result-video name, distinct popover labels", () => {
    const model = seedance;
    const baseDraft = { ...initialDraft("video"), prompt: "", change: "" };
    const handImg1: TrayItem = { ...img1, role: "product", use: "무광 유리 질감", avoid: "반사광" };
    const handImg2: TrayItem = { ...img2, role: "place", use: "", avoid: "" };
    const trayWithHand: TrayItem[] = [vid8, handImg1, handImg2];

    // W1: Cheating answer with invalid role `악당`, out-of-tray refIndex 9, and over-limit label/use
    const cheatingSwaps = [
      { refIndex: 1, role: "악당" as unknown as "product", label: "악당", use: "", avoid: "" },
      { refIndex: 9, role: "person" as const, label: "없는 이미지", use: "", avoid: "" },
      { refIndex: 2, role: "place" as const, label: "x".repeat(81), use: "", avoid: "" },
      { refIndex: 2, role: "place" as const, label: "배경", use: "y".repeat(STUDIO_LIMITS.noteMax + 1), avoid: "" },
    ];
    const appliedCheat = applyUnderstandCardToDraftAndTray({
      card: {
        swaps: cheatingSwaps,
        changeText: "",
        requestText: "",
        seconds: 5,
        clipCount: 1,
        targetTotalSeconds: 5,
        audio: "ambient",
      },
      draft: baseDraft,
      tray: [vid8, img1, img2],
      mode: "re_architect",
      model,
    });
    expect(appliedCheat.appliedSwaps).toBe(0);
    expect(appliedCheat.droppedSwaps).toBe(4);
    expect(appliedCheat.tray[1]!.role).toBeUndefined();

    // Card NEVER draws the cheating invalid-role swap (`악당`)!
    const cheatHtml = renderToStaticMarkup(
      <VideoConfirmCard
        mode="re_architect"
        draft={baseDraft}
        tray={[vid8, img1, img2]}
        model={model}
        copy={KO_COPY}
        modesCopy={KO_MODES}
        cost="81 크레딧"
        busy={false}
        disabled={false}
        videoSeconds={8}
        understand={{
          kind: "plan",
          reply: "총 241 크레딧이 들어요. 바로 진행해요.",
          swaps: cheatingSwaps,
          question: null,
          readyToMake: false,
          failed: false,
          timedOut: false,
          stale: false,
          checking: false,
        }}
        onDraft={() => {}}
        onTrayUpdate={() => {}}
        onEditWords={() => {}}
        onMake={() => {}}
        onClose={() => {}}
      />,
    );
    expect(cheatHtml).not.toContain("악당");
    // W4: Whole credit sentence dropped (`총 241 크레딧이 들어요.` gone, NO `총 이 들어요.` fragment!)
    expect(cheatHtml).not.toContain("241");
    expect(cheatHtml).not.toContain("총 이 들어요");
    expect(cheatHtml).toContain("바로 진행해요.");
    // W6: Empty prompt + nothing standing shows `바꿀 내용을 알려 주세요`, NOT `설명한 내용을 반영해요`
    expect(cheatHtml).toContain(KO_MODES.card.changeNeedInput);
    expect(cheatHtml).not.toContain(KO_MODES.card.changeEmpty);

    // W4: When reply is ONLY a credit sentence, card falls back to its own summary line!
    expect(stripClientCreditFigures("총 241 크레딧이 들어요.")).toBe("");
    const fallbackHtml = renderToStaticMarkup(
      <VideoConfirmCard
        mode="re_architect"
        draft={{ ...baseDraft, prompt: "제품 교체", change: "@image1 제품으로 교체" }}
        tray={trayWithHand}
        model={model}
        copy={KO_COPY}
        modesCopy={KO_MODES}
        cost="81 크레딧"
        busy={false}
        disabled={false}
        videoSeconds={8}
        initialOpenLine="change"
        understand={{
          kind: "plan",
          reply: "총 241 크레딧이 들어요.",
          swaps: [{ refIndex: 1, role: "product", label: "제품 병", use: "", avoid: "" }],
          question: null,
          readyToMake: true,
          failed: false,
          timedOut: false,
          stale: false,
          checking: false,
        }}
        onDraft={() => {}}
        onTrayUpdate={() => {}}
        onEditWords={() => {}}
        onMake={() => {}}
        onClose={() => {}}
      />,
    );
    expect(fallbackHtml).toContain('data-confirm-reply="true">@image1 제품으로 교체</p>');
    // W2: Reply starts clamped (`data-clamped`)
    expect(fallbackHtml).toContain('data-clamped=""');
    // W3: Card thumbnails are 28x28 using the exact same source as tray (`thumbUrl ?? url`) with `decoding="sync"`
    expect(fallbackHtml).toContain(`src="${handImg1.thumbUrl ?? handImg1.url}"`);
    expect(fallbackHtml).toContain('width="28" height="28"');
    expect(fallbackHtml).toContain('decoding="sync"');
    // W7: Hand-set role on Image 2 (`장소`) is shown in the summary line alongside card's Image 1 (`제품 병`)!
    expect(fallbackHtml).toContain("제품 병");
    expect(fallbackHtml).toContain(KO_COPY.roles.place);
    expect(fallbackHtml).toContain('data-confirm-swap="1"');
    expect(fallbackHtml).toContain('data-confirm-swap="2"');
    // W9: Distinct popover labels (`이 이미지에서 가져올 것`, `이 이미지에서 피할 것`, `바꿀 내용`)
    expect(fallbackHtml).toContain(KO_MODES.card.refUseLabel);
    expect(fallbackHtml).toContain(KO_MODES.card.refAvoidLabel);
    expect(fallbackHtml).toContain(KO_MODES.card.changeFieldLabel);

    // W5: Per-field hand-edit preservation: correction sending empty `use`/`avoid` NEVER erases hand-written notes!
    const snap = snapshotTrayImages(trayWithHand);
    const afterEmptyModelNote = applyUnderstandCardToDraftAndTray({
      card: {
        swaps: [{ refIndex: 1, role: "product", label: "제품", use: "", avoid: "" }],
        changeText: "@image1 제품",
        requestText: "@video1의 제품을 @image1로 교체해요.",
        seconds: 8,
        clipCount: 1,
        targetTotalSeconds: 8,
        audio: "ambient",
      },
      draft: baseDraft,
      tray: trayWithHand,
      mode: "re_architect",
      snapshot: snap,
      model,
    });
    expect(afterEmptyModelNote.tray[1]!.use).toBe("무광 유리 질감");
    expect(afterEmptyModelNote.tray[1]!.avoid).toBe("반사광");

    // Non-empty model value DOES update that field while preserving untouched hand fields
    const afterNonEmptyModelNote = applyUnderstandCardToDraftAndTray({
      card: {
        swaps: [{ refIndex: 1, role: "product", label: "제품", use: "라벨 강조", avoid: "" }],
        changeText: "@image1 제품",
        requestText: "@video1의 제품을 @image1로 교체해요.",
        seconds: 8,
        clipCount: 1,
        targetTotalSeconds: 8,
        audio: "ambient",
      },
      draft: baseDraft,
      tray: afterEmptyModelNote.tray,
      mode: "re_architect",
      snapshot: snap,
      model,
    });
    expect(afterNonEmptyModelNote.tray[1]!.use).toBe("라벨 강조");
    expect(afterNonEmptyModelNote.tray[1]!.avoid).toBe("반사광");

    // W8: Result video never sends UI label `결과 보기` / `View result` to `video.understand`; sends real job title if present
    const resultVideoUiLabel: TrayItem = {
      key: "o:out-vid-1",
      outputId: "out-vid-1",
      kind: "video",
      name: "결과 보기",
      url: "https://cdn.example/out.mp4",
      thumbUrl: "https://cdn.example/out.jpg",
      seconds: 8,
      width: 720,
      height: 1280,
    };
    const resultVideoTitled: TrayItem = { ...resultVideoUiLabel, name: "향수 런칭 컷" };
    const payloadUiLabel = buildUnderstandInput({
      organizationId: ORG,
      mode: "re_architect",
      draft: baseDraft,
      tray: [resultVideoUiLabel, img1],
      message: "1번 제품으로",
    });
    expect(payloadUiLabel.references![0]!.name).toBe("");
    const payloadTitled = buildUnderstandInput({
      organizationId: ORG,
      mode: "re_architect",
      draft: baseDraft,
      tray: [resultVideoTitled, img1],
      message: "1번 제품으로",
    });
    expect(payloadTitled.references![0]!.name).toBe("향수 런칭 컷");

    // Last-three #2 (client): Customer won price (`9,900원`) & percentages survive in `requestText`/`changeText`
    // and in the card's `바꿀 것` row, while credit figures (`120 크레딧`) are removed and model `reply` still drops whole credit sentences!
    const wonAdApplied = applyUnderstandCardToDraftAndTray({
      card: {
        swaps: [],
        changeText: "자막에 9,900원 특가 (120 크레딧) 추가",
        requestText: "@video1 자막에 9,900원 특가와 30% 할인을 넣어요.",
        seconds: 5,
        clipCount: 1,
        targetTotalSeconds: 5,
        audio: "ambient",
      },
      draft: baseDraft,
      tray: [vid8, img1],
      mode: "re_architect",
      model,
    });
    expect(wonAdApplied.draft.change).toBe("자막에 9,900원 특가 추가");
    expect(wonAdApplied.draft.prompt).toBe("@video1 자막에 9,900원 특가와 30% 할인을 넣어요.");
    const wonAdHtml = renderToStaticMarkup(
      <VideoConfirmCard
        mode="re_architect"
        draft={wonAdApplied.draft}
        tray={[vid8, img1]}
        model={model}
        copy={KO_COPY}
        modesCopy={KO_MODES}
        cost="81 크레딧"
        busy={false}
        disabled={false}
        videoSeconds={8}
        understand={{
          kind: "plan",
          reply: "총 241 크레딧이 들어요. 자막에 특가 문구를 반영해요.",
          swaps: [],
          question: null,
          readyToMake: true,
          failed: false,
          timedOut: false,
          stale: false,
          checking: false,
        }}
        onDraft={() => {}}
        onTrayUpdate={() => {}}
        onEditWords={() => {}}
        onMake={() => {}}
        onClose={() => {}}
      />,
    );
    expect(wonAdHtml).toContain("자막에 9,900원 특가 추가");
    expect(wonAdHtml).not.toContain("241");
    expect(wonAdHtml).toContain("자막에 특가 문구를 반영해요.");

    // Last-three #3: Result-video renaming in workspace.tsx is strictly gated on `videoModesOn` (closed orgs keep `copy.viewer.label`)
    const workspaceSrc = readFileSync(resolve(process.cwd(), "components/brand-studio/video/workspace.tsx"), "utf8");
    expect(workspaceSrc).toContain("if (!videoModesOn) return trayItemFromOutput(output, copy.viewer.label);");
    expect(workspaceSrc).toContain(": copy.viewer.label;");
  });
});
