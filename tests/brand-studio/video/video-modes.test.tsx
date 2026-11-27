import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, useState, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STUDIO_LIMITS, STUDIO_SHOT_LIMITS, type StudioRemixMethod } from "@/lib/brand-studio/contracts";
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
  initialDraft,
  remixActive,
  type DockDraft,
} from "@/components/brand-studio/dock-model";
import { LibraryRail } from "@/components/brand-studio/rail";
import { RAIL_STORAGE_KEY } from "@/components/brand-studio/rail/text";
import { REF_DRAG_TYPE, acceptsDrag, decodeRefDrag, trayItemFromAsset, trayLabels, type TrayItem } from "@/components/brand-studio/refs";
import { Tray } from "@/components/brand-studio/tray";
import type { StudioLibrary } from "@/components/brand-studio/seams";
import { useDock, type DockController } from "@/components/brand-studio/use-dock";
import { useStudio, type StudioController } from "@/components/brand-studio/use-studio";
import type { StudioApi } from "@/components/brand-studio/api";
import { errorLine } from "@/components/brand-studio/copy";
import { RecentCreationsPanel } from "@/components/brand-studio/video/recent-creations-panel";
import { VideoModeExplainer } from "@/components/brand-studio/video/mode-explainer";
import {
  VIDEO_MODE_SEEN_KEY,
  isVideoModeSeen,
  markVideoModeSeen,
  readSeenVideoModes,
} from "@/components/brand-studio/video/mode-seen";
import { useVideoModes } from "@/components/brand-studio/video/use-video-modes";
import {
  INITIAL_VIDEO_MODES_STATE,
  applyVideoModeEditToggle,
  deriveVideoMode,
  draftAndStateAfterVideoAttach,
  formatVideoContainers,
  formatVideoModeTipLines,
  formatVideoWellLimits,
  isBlueprintUnreadableBlock,
  needsReferenceVideoForSubmit,
  selectVideoMode,
  stateAfterManualTrayRemove,
  undoRemovedVideo,
  videoModeAvailability,
  type VideoModesUiState,
} from "@/components/brand-studio/video/video-modes-model";
import { VideoModeBar, VideoModeWell, nextFocusedVideoMode } from "@/components/brand-studio/video/video-modes-ui";
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
const vid3s: TrayItem = trayItemFromAsset(
  asset(9, { kind: "video", name: "clip3s.mp4", url: "https://media.example/st/s3.mp4", thumbUrl: null, width: 720, height: 1280, seconds: 3 }),
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

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, String(value));
    },
  };
}

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

function buildOpenDock(patch: Partial<DockProps> = {}, uiPatch: Partial<VideoModesUiState> = {}) {
  const draft = patch.draft ?? initialDraft("video");
  const tray = patch.tray ?? [];
  const film = patch.film ?? null;
  const ui: VideoModesUiState = { ...INITIAL_VIDEO_MODES_STATE, ...uiPatch };
  const availability = videoModeAvailability({
    draft,
    tray,
    film,
    copy: KO_COPY,
    videoCopy: KO_VIDEO,
  });
  const videoModes: VideoModesDockProp = {
    activeMode: deriveVideoMode(draft, tray, ui.pendingMode),
    pendingMode: ui.pendingMode,
    availability,
    copy: KO_MODES,
    undo: ui.undo !== null,
    forcedLimitMessage: ui.forcedLimitMessage,
    onSelectMode: noop,
    onUndoRemoveVideo: noop,
    onToggleEdit: noop,
    onRetryReadFilm: noop,
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

/** Main's exact RemixPanel method-card onChange patch (`components/brand-studio/remix-panel.tsx:326-331`). */
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

describe("1. BRAND_STUDIO_VIDEO_MODES flag & server page gating", () => {
  it("defaults off, respects org lists case-insensitively, and never opens for a blank org id", () => {
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
    expect(serialized).toContain(KO_MODES.well.title);

    pageState.org = { ...pageState.org, role: "viewer" };
    const viewerEl = (await StudioVideoPage({
      searchParams: Promise.resolve({ organizationId: pageState.org.id }),
    })) as ReactElement;
    const viewerHtml = renderToStaticMarkup(viewerEl);
    expect(viewerHtml).not.toContain("data-video-mode-switch");
  });
});

describe("2. State table (Rules 1–10) & Browser-walk faults W1–W4", () => {
  const avail = (draft: DockDraft, tray: readonly TrayItem[], film: DockProps["film"] = null) =>
    videoModeAvailability({ draft, tray, film, copy: KO_COPY, videoCopy: KO_VIDEO });

  it("R1: no video in tray, nothing picked -> basic", () => {
    const draft = initialDraft("video");
    expect(deriveVideoMode(draft, [], null)).toBe("basic");
    const html = buildOpenDock({ draft, tray: [] });
    expect(html).toContain('data-video-mode="basic" data-selected=""');
    expect(html).not.toContain("data-video-mode-well");
    expect(html).toContain(KO_COPY.tray.hintVideo);
  });

  it("R2a/R2b/R2c + W2 + Round 3 item 3: pending video mode disables Make, hides quote, and renders calm role=status guidance BEFORE click", () => {
    const draft = initialDraft("video");
    const a = avail(draft, []);
    for (const mode of ["re_architect", "motion_transfer"] as const) {
      const picked = selectVideoMode({ target: mode, draft, tray: [], ui: INITIAL_VIDEO_MODES_STATE, availability: a });
      expect(picked.ui.pendingMode).toBe(mode);
      expect(picked.ui.pickedVideoModeByHand).toBe(true);
      expect(needsReferenceVideoForSubmit(picked.ui.pendingMode, picked.tray)).toBe(true);

      const html = buildOpenDock({ draft: picked.draft, tray: [] }, picked.ui);
      expect(html).toContain(`data-video-mode-well="${mode}"`);
      // W2 + Round 3 item 3: disabled submit, NO quote, calm guidance (`role="status"`, `.bs-dock-guidance`, NOT alert/red)
      expect(html).toMatch(/disabled=""[^>]*data-studio-submit|data-studio-submit[^>]*disabled=""/);
      expect(html).not.toContain("data-studio-quote");
      expect(html).toContain('class="bs-dock-guidance"');
      expect(html).toContain('role="status"');
      expect(html).toContain('data-studio-dock-guidance="need-video"');
      expect(html).not.toContain('role="alert"');
      expect(html).not.toContain("data-studio-dock-message");
      expect(html).toContain(KO_MODES.status.needVideo);

      const back = selectVideoMode({ target: "basic", draft: picked.draft, tray: [], ui: picked.ui, availability: a });
      expect(back.ui.pendingMode).toBeNull();
      const basicHtml = buildOpenDock({ draft: back.draft, tray: [] }, back.ui);
      expect(basicHtml).toContain("data-studio-quote");
      expect(basicHtml).not.toContain(KO_MODES.status.needVideo);
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

    // Forbidden for Motion Transfer (>30s, small, large) -> forces Re-Architect WITH visible limit message
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
      expect(html).toContain('data-video-mode-disabled-reason="motion_transfer"');
    }

    // <2s clip forbidden for both -> filmLimit shown and submit disabled
    const tooShort = draftAndStateAfterVideoAttach({ draft: initialDraft("video"), nextTray: [vidTooShort], item: vidTooShort, ui: mtUi, copy: KO_COPY });
    const shortHtml = buildOpenDock({ draft: tooShort.draft, tray: [vidTooShort] }, tooShort.ui);
    expect(shortHtml).toContain("data-studio-film-limit");
    expect(shortHtml).toMatch(/disabled=""[^>]*data-studio-submit|data-studio-submit[^>]*disabled=""/);
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

  it("Item 2 + W1 + Round 3 item 1 + Round 5–6: loading keeps Make enabled with main's quote; unreadable keeps Re-Architect selectable, hides blueprint controls, and allows return from Motion Transfer to Read again", async () => {
    // 18s clip dropped on 기본 defaults to Re-Architect 30s/2-clips via draftAfterAttach
    const draft18 = draftAfterAttach({ ...initialDraft("video"), prompt: "Follow the walk", change: "Use blue coat" }, vid18, true, [vid18]);
    expect(draft18.clipCount).toBe(2);
    expect(draft18.method).toBe("blueprint");

    // 1) Round 6 — While analysis is RUNNING (`status: "loading"`):
    //    switch-open Re-Architect keeps existing loading presentation, no unreadable sentence, no guidance line,
    //    and Make stays ENABLED with the exact same credit quote as main's closed render for this draft.
    const loadingFilm = { status: "loading" as const };
    expect(isBlueprintUnreadableBlock({ draft: draft18, tray: [vid18], film: loadingFilm })).toBe(false);
    const loadingHtml = buildOpenDock({ draft: draft18, tray: [vid18], film: loadingFilm });
    const closedLoadingHtml = renderToStaticMarkup(
      <Dock
        mode="video"
        organizationId={ORG}
        draft={draft18}
        tray={[vid18]}
        labels={trayLabels([vid18], KO_COPY)}
        copy={KO_COPY}
        locale="ko"
        allowance={allowance()}
        credits={dockCredits(draft18, [vid18])}
        busy={false}
        message={null}
        film={loadingFilm}
        uploading={[]}
        videoCopy={KO_VIDEO}
        onDraft={noop}
        onTrayUpdate={noop}
        onTrayRemove={noop}
        onSubmit={noop}
        onDropSource={noop}
        onFiles={noop}
        onBrowse={noop}
      />,
    );
    const quoteOf = (markup: string) => markup.match(/data-studio-quote[^>]*>([^<]+)</)?.[1] ?? null;
    const mainQuote = quoteOf(closedLoadingHtml);
    expect(mainQuote).toBeTruthy();
    expect(loadingHtml).toContain('data-film-state="loading"');
    expect(loadingHtml).toContain(KO_COPY.remix.reading);
    expect(loadingHtml).not.toContain(KO_VIDEO.remix.unreadable);
    expect(loadingHtml).not.toContain("data-studio-dock-guidance");
    expect(quoteOf(loadingHtml)).toBe(mainQuote);
    expect(loadingHtml).not.toMatch(/disabled=""[^>]*data-studio-submit|data-studio-submit[^>]*disabled=""/);
    expect(closedLoadingHtml).toContain('data-film-state="loading"');
    expect(closedLoadingHtml).not.toMatch(/disabled=""[^>]*data-studio-submit|data-studio-submit[^>]*disabled=""/);

    // 2) Round 5 items 1 & 2 — Reading finished with no sheet (`status: "done", sheet: null`) in Re-Architect:
    //    Re-Architect is NOT disabled (normal selected pill, NOT greyed); blueprint controls are hidden (method-independent
    //    change field stays); unreadable sentence appears ONCE in neutral `role="status"` slot with `다시 읽기`; Make disabled.
    const unreadableFilm = { status: "done" as const, sheet: null };
    expect(isBlueprintUnreadableBlock({ draft: draft18, tray: [vid18], film: unreadableFilm })).toBe(true);
    const a18 = avail(draft18, [vid18], unreadableFilm);
    expect(a18.re_architect.disabled).toBe(false);
    expect(a18.re_architect.reason).toBeNull();
    expect(a18.motion_transfer.disabled).toBe(false);
    expect(a18.motion_transfer.reason).toBeNull();

    const html = buildOpenDock({ draft: draft18, tray: [vid18], film: unreadableFilm });
    const occurrences = html.split(KO_VIDEO.remix.unreadable).length - 1;
    expect(occurrences).toBe(1);
    expect(html).not.toContain("data-studio-remix-unreadable");
    expect(html).not.toContain('data-video-mode-disabled-reason="re_architect"');
    // Selected Re-Architect pill has data-selected="" and NO aria-disabled="true"
    const raButtonMatch = html.match(/<button[^>]*data-video-mode="re_architect"[^>]*>/)?.[0] ?? "";
    expect(raButtonMatch).toContain('aria-checked="true"');
    expect(raButtonMatch).toContain('data-selected=""');
    expect(raButtonMatch).not.toContain('aria-disabled="true"');
    // Blueprint controls hidden; method-independent change field stays
    expect(html).not.toContain("data-studio-director-banner");
    expect(html).not.toContain("data-studio-remix-open-panel");
    expect(html).not.toContain('class="bs-keep"');
    expect(html).not.toContain("data-studio-remix-sound");
    expect(html).not.toContain("data-studio-draft-note");
    expect(html).toContain(KO_COPY.remix.change);
    // Guidance slot + Read again + disabled Make without quote
    expect(html).toContain('class="bs-dock-guidance"');
    expect(html).toContain('role="status"');
    expect(html).toContain('data-studio-dock-guidance="unreadable"');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain("data-video-mode-read-again");
    expect(html).toContain(KO_MODES.status.readAgain);
    expect(html).toMatch(/disabled=""[^>]*data-studio-submit|data-studio-submit[^>]*disabled=""/);
    expect(html).not.toContain("data-studio-quote");

    // 3) Round 5 item 1 — Switching to Motion Transfer (18s <= 30s) and back to Re-Architect:
    //    Re-Architect option is NOT aria-disabled while in Motion Transfer; selecting it works and restores
    //    the blocked state with the unreadable sentence ONCE (in the slot only, never under the tab).
    const picked = selectVideoMode({ target: "motion_transfer", draft: draft18, tray: [vid18], ui: INITIAL_VIDEO_MODES_STATE, availability: a18 });
    expect(picked.draft.method).toBe("reference");
    expect(picked.draft.clipCount).toBe(1);
    expect(picked.draft.targetTotalSeconds).toBeNull();
    expect(isBlueprintUnreadableBlock({ draft: picked.draft, tray: [vid18], film: unreadableFilm })).toBe(false);
    const mtHtml = buildOpenDock({ draft: picked.draft, tray: [vid18], film: unreadableFilm }, picked.ui);
    const raWhileMt = mtHtml.match(/<button[^>]*data-video-mode="re_architect"[^>]*>/)?.[0] ?? "";
    expect(raWhileMt).not.toContain('aria-disabled="true"');
    expect(mtHtml).not.toContain('data-video-mode-disabled-reason="re_architect"');
    expect(mtHtml).not.toContain(KO_VIDEO.remix.unreadable);
    expect(mtHtml).not.toContain("data-studio-dock-guidance");
    expect(mtHtml).toContain("data-studio-quote");
    const built = buildMultiClipJobs(picked.draft, [vid18], { organizationId: ORG, requestIds: ["req-w1-0001"] });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.inputs).toHaveLength(1);
      expect(built.inputs[0]).toMatchObject({ kind: "video_remix", method: "reference" });
    }

    // Returning from Motion Transfer to Re-Architect works so `다시 읽기` is always reachable
    const backToRa = selectVideoMode({
      target: "re_architect",
      draft: picked.draft,
      tray: [vid18],
      ui: picked.ui,
      availability: avail(picked.draft, [vid18], unreadableFilm),
    });
    expect(backToRa.draft.method).toBe("blueprint");
    const returnedHtml = buildOpenDock({ draft: backToRa.draft, tray: [vid18], film: unreadableFilm }, backToRa.ui);
    expect(returnedHtml.split(KO_VIDEO.remix.unreadable).length - 1).toBe(1);
    expect(returnedHtml).toContain('data-studio-dock-guidance="unreadable"');
    expect(returnedHtml).toContain("data-video-mode-read-again");
    expect(returnedHtml).not.toContain('data-video-mode-disabled-reason="re_architect"');

    // 4) Mounted end-to-end flow: real `useStudio` + `useDock` + `useVideoModes` + `Dock`
    //    Verifies submit guard sends ZERO requests while unreadable, and `다시 읽기` runs `film.analyze` again
    //    (showing loading, surfacing rate-limit refusal, then unlocking on success).
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

    let submitAttempted: (() => Promise<boolean>) | null = null;
    let attachClip: (() => void) | null = null;
    let latestDockHtml = "";
    function UnreadableFlowHarness() {
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
      // Capture real `<Dock>` HTML at every state transition (RemixPanel's `<select>` needs full browser DOM;
      // the mounted buttons below exercise the live `useStudio` / `useDock` / `useVideoModes` callbacks).
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
          <button
            type="button"
            data-video-mode-read-again
            onClick={() => vm.dockProp?.onRetryReadFilm?.()}
          >
            {KO_MODES.status.readAgain}
          </button>
        </div>
      );
    }

    const dom = await mountDom(<UnreadableFlowHarness />);
    try {
      // Attach 18s clip -> analysis starts (`loading`), no early unreadable, Make stays enabled with quote (as on main)
      await act(async () => {
        attachClip!();
      });
      expect(apiCall).toHaveBeenCalledTimes(1);
      expect(apiCall).toHaveBeenLastCalledWith("film.analyze", { organizationId: ORG, assetId: vid18.assetId });
      expect(latestDockHtml).toContain('data-film-state="loading"');
      expect(latestDockHtml).not.toContain('data-studio-dock-guidance="unreadable"');
      expect(latestDockHtml).toContain("data-studio-quote");
      expect(latestDockHtml).not.toMatch(/disabled=""[^>]*data-studio-submit|data-studio-submit[^>]*disabled=""/);

      // First analysis completes with null sheet -> unreadable block active; submit guard blocks request!
      await act(async () => {
        resolveAnalyze!({ ok: true, sheet: null });
      });
      expect(latestDockHtml).toContain('data-studio-dock-guidance="unreadable"');
      expect(latestDockHtml).toContain("data-video-mode-read-again");
      expect(latestDockHtml).not.toContain("data-studio-quote");
      expect(latestDockHtml).toMatch(/disabled=""[^>]*data-studio-submit|data-studio-submit[^>]*disabled=""/);
      let started = true;
      await act(async () => {
        started = await submitAttempted!();
      });
      expect(started).toBe(false);
      expect(apiCall.mock.calls.filter(([op]) => op === "job.create")).toHaveLength(0);

      // Click `다시 읽기` -> calls same `film.analyze` again, flips to loading!
      await dom.click("[data-video-mode-read-again]");
      expect(apiCall).toHaveBeenCalledTimes(2);
      expect(apiCall).toHaveBeenLastCalledWith("film.analyze", { organizationId: ORG, assetId: vid18.assetId });
      expect(latestDockHtml).toContain('data-film-state="loading"');
      expect(latestDockHtml).not.toContain('data-studio-dock-guidance="unreadable"');

      // Server refuses with rate limit (`too_many_running`) -> shows existing refusal in alert slot, Make still disabled
      await act(async () => {
        resolveAnalyze!({ ok: false, code: "too_many_running" });
      });
      expect(latestDockHtml).toContain("data-studio-dock-message");
      expect(latestDockHtml).toContain(errorLine(KO_COPY, "too_many_running"));
      expect(latestDockHtml).toContain('data-studio-dock-guidance="unreadable"');
      expect(latestDockHtml).toMatch(/disabled=""[^>]*data-studio-submit|data-studio-submit[^>]*disabled=""/);

      // Click `다시 읽기` again -> succeeds with sheet -> unlocks Re-Architect & clears alert/guidance
      await dom.click("[data-video-mode-read-again]");
      expect(apiCall).toHaveBeenCalledTimes(3);
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
      expect(latestDockHtml).not.toContain("data-studio-dock-message");
      expect(latestDockHtml).not.toContain('data-studio-dock-guidance="unreadable"');
      expect(latestDockHtml).toContain("data-studio-quote");
      expect(latestDockHtml).not.toMatch(/disabled=""[^>]*data-studio-submit|data-studio-submit[^>]*disabled=""/);
    } finally {
      await dom.unmount();
    }

    // 5) Round 4 items 1–3: double-press guard, stale-asset suppression on detach, and rejected network error handling
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
    let latestErrorCode: string | null = null;

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
      latestErrorCode = dock.errorCode;
      return <div />;
    }

    const domEdge = await mountDom(<RetryEdgeHarness />);
    try {
      await act(async () => {
        attachClip!();
      });

      // Round 4 item 1: two presses in one tick -> ONLY ONE `film.analyze` call
      await act(async () => {
        triggerRetry!();
        triggerRetry!();
      });
      expect(retrySpy).toHaveBeenCalledTimes(1);

      // Round 4 item 3: rejected network error -> clears in-flight guard & shows `errorLine(copy, "failed")`
      await act(async () => {
        nextReject!(new Error("network down"));
      });
      expect(latestMessage).toBe(errorLine(KO_COPY, "failed"));
      expect(latestErrorCode).toBe("failed");

      // After settlement, a fresh retry press runs again; Round 4 item 2: detach clip before it resolves -> NO stale error shown
      await act(async () => {
        triggerRetry!();
      });
      expect(retrySpy).toHaveBeenCalledTimes(2);
      expect(latestMessage).toBeNull();

      await act(async () => {
        detachClip!();
      });
      await act(async () => {
        nextResolve!({ ok: false, code: "too_many_running" });
      });
      expect(latestMessage).toBeNull();
      expect(latestErrorCode).toBeNull();
    } finally {
      await domEdge.unmount();
    }
  });

  it("W4 + R5c: Motion Transfer hides AI director banner and 샷 표 보며 만들기; Re-Architect shows them; edit toggle works", () => {
    const base = draftAfterAttach(initialDraft("video"), vid8, true, [vid8]);
    const raHtml = buildOpenDock({ draft: { ...base, method: "blueprint", methodPinned: true }, tray: [vid8] });
    expect(raHtml).toContain("data-studio-director-banner");
    expect(raHtml).toContain("data-studio-remix-open-panel");
    expect(raHtml).not.toContain("data-studio-remix-method");
    expect(raHtml).not.toContain("data-video-mode-edit-toggle");

    const mtHtml = buildOpenDock({ draft: { ...base, method: "reference", methodPinned: true }, tray: [vid8] });
    expect(mtHtml).not.toContain("data-studio-director-banner");
    expect(mtHtml).not.toContain("data-studio-remix-open-panel");
    expect(mtHtml).toContain('data-video-mode-edit-toggle="edit"');
    expect(mtHtml).toContain(KO_MODES.status.switchToEdit);

    const editDraft = applyVideoModeEditToggle(base, "edit");
    const editHtml = buildOpenDock({ draft: editDraft, tray: [vid8] });
    expect(editHtml).not.toContain("data-studio-director-banner");
    expect(editHtml).not.toContain("data-studio-remix-open-panel");
    expect(editHtml).toContain('data-video-mode-edit-toggle="back"');
    expect(editHtml).toContain(KO_MODES.status.backToReference);

    // <4s editMin hides edit toggle
    const short3 = draftAfterAttach(initialDraft("video"), vid3s, true, [vid3s]);
    const short3Html = buildOpenDock({ draft: { ...short3, method: "reference", methodPinned: true }, tray: [vid3s] });
    expect(short3Html).not.toContain("data-video-mode-edit-toggle");
  });

  it("Items 4 & 5 (R6a/R6b): undo restores ALL removed videos in order and ONLY method/methodPinned (never seconds/clipCount)", () => {
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

    // Customer changes seconds/clipCount while in 기본 before clicking 되돌리기
    const editedInBasic: DockDraft = { ...removed.draft, seconds: 12, clipCount: 1, targetTotalSeconds: null };
    const restored = undoRemovedVideo(editedInBasic, removed.tray, removed.ui);
    expect(restored.tray).toEqual([img1, vid8, aud1, vid18]);
    expect(restored.draft.method).toBe("blueprint");
    expect(restored.draft.methodPinned).toBe(true);
    // Item 4: customer's changes while in 기본 are preserved (NOT silently reverted)
    expect(restored.draft.seconds).toBe(12);
    expect(restored.draft.clipCount).toBe(1);
    expect(restored.draft.targetTotalSeconds).toBeNull();
    expect(restored.ui.pickedVideoModeByHand).toBe(true);
  });

  it("W3 + R7a/R7b (mounted DOM): clicking ✕ keeps hand-picked video mode with well, and returns auto-inferred mode to 기본", async () => {
    function Harness({ initialTray = [] as TrayItem[] }: { initialTray?: TrayItem[] }) {
      const [studio] = useState(stubStudio);
      const dock = useDock({ studio, copy: KO_COPY, organizationId: ORG, initialMedium: "video", mode: "video" });
      const [seeded, setSeeded] = useState(false);
      if (!seeded && initialTray.length > 0) {
        setSeeded(true);
        dock.setTray(initialTray);
      }
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
          <button type="button" data-test-attach-vid8 onClick={() => vm.attachItem(vid8)} />
          {vm.dockProp && (
            <VideoModeBar
              activeMode={vm.dockProp.activeMode}
              availability={vm.dockProp.availability}
              model={seedance}
              copy={KO_MODES}
              disabled={false}
              onSelect={vm.dockProp.onSelectMode}
            />
          )}
          <Tray
            items={dock.tray}
            labels={trayLabels(dock.tray, KO_COPY)}
            medium="video"
            copy={KO_COPY}
            dropActive={false}
            uploading={[]}
            onUpdate={dock.update}
            onRemove={vm.removeTrayItem}
            onMove={dock.move}
            onBrowse={noop}
          />
          {!remixOn && vm.dockProp?.pendingMode && (
            <VideoModeWell
              mode={vm.dockProp.pendingMode}
              model={seedance}
              copy={KO_MODES.well}
              dropActive={false}
              dropReady={false}
              disabled={false}
              onFiles={noop}
              onBrowse={noop}
            />
          )}
        </div>
      );
    }

    // Case A: Hand-picked Re-Architect -> attach video -> click ✕ -> stays Re-Architect with well!
    const domHand = await mountDom(<Harness />);
    try {
      await domHand.click('[data-video-mode="re_architect"]');
      expect(domHand.query('[data-video-mode-well="re_architect"]')).not.toBeNull();
      await domHand.click("[data-test-attach-vid8]");
      expect(domHand.query('[data-video-mode="re_architect"]')?.getAttribute("aria-checked")).toBe("true");
      expect(domHand.query('[data-video-mode-well]')).toBeNull();

      // Remove video by hand (✕ button on thumbnail)
      await domHand.click(".bs-thumb-x");
      expect(domHand.query('[data-video-mode="re_architect"]')?.getAttribute("aria-checked")).toBe("true");
      expect(domHand.query('[data-video-mode-well="re_architect"]')).not.toBeNull();
    } finally {
      await domHand.unmount();
    }

    // Case B: Auto-inferred (dropped video on 기본 without hand-picking) -> click ✕ -> returns to 기본 (no well)
    const domInferred = await mountDom(<Harness />);
    try {
      await domInferred.click("[data-test-attach-vid8]");
      expect(domInferred.query('[data-video-mode="motion_transfer"]')?.getAttribute("aria-checked")).toBe("true");
      await domInferred.click(".bs-thumb-x");
      expect(domInferred.query('[data-video-mode="basic"]')?.getAttribute("aria-checked")).toBe("true");
      expect(domInferred.query("[data-video-mode-well]")).toBeNull();
    } finally {
      await domInferred.unmount();
    }
  });

  it("Item 6: paths changing tray outside attachItem (scene extend, ?from=, ?asset=, ?ref=) apply Rule 3 when a mode is pending", async () => {
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
          <button type="button" data-pick-ra onClick={() => vm.dockProp?.onSelectMode("re_architect")} />
          <button type="button" data-pick-mt onClick={() => vm.dockProp?.onSelectMode("motion_transfer")} />
        </div>
      );
    }

    // 1) Scene extend (`dock.setTray([vid8])`) while Re-Architect is pending -> pins blueprint & clears pendingMode
    const domExtend = await mountDom(<EntryHarness />);
    try {
      await domExtend.click("[data-pick-ra]");
      expect(domExtend.query("[data-pending-mode]")?.getAttribute("data-pending-mode")).toBe("re_architect");
      await act(async () => {
        controller!.setTray([vid8]);
      });
      expect(domExtend.query("[data-pending-mode]")?.getAttribute("data-pending-mode")).toBe("");
      expect(domExtend.query("[data-method]")?.getAttribute("data-method")).toBe("blueprint");
      expect(domExtend.query("[data-active-mode]")?.getAttribute("data-active-mode")).toBe("re_architect");
    } finally {
      await domExtend.unmount();
    }

    // 2) `?asset=` / `?ref=` (`dock.attach(vid42)`) while Motion Transfer is pending -> forces blueprint + forcedLimitMessage
    const domUrl = await mountDom(<EntryHarness />);
    try {
      await domUrl.click("[data-pick-mt]");
      await act(async () => {
        controller!.attach(vid42);
      });
      expect(domUrl.query("[data-pending-mode]")?.getAttribute("data-pending-mode")).toBe("");
      expect(domUrl.query("[data-active-mode]")?.getAttribute("data-active-mode")).toBe("re_architect");
      expect(domUrl.query("[data-forced]")?.getAttribute("data-forced")).toContain("30");
    } finally {
      await domUrl.unmount();
    }

    // 3) `?from=` start-frame image followed by `dock.attach(vid8)` while Motion Transfer is pending -> pins reference!
    const domFrom = await mountDom(<EntryHarness />);
    try {
      await domFrom.click("[data-pick-mt]");
      await act(async () => {
        controller!.setTray([{ ...img1, frame: "start" }]);
      });
      // Still pending after image-only ?from= attach
      expect(domFrom.query("[data-pending-mode]")?.getAttribute("data-pending-mode")).toBe("motion_transfer");
      await act(async () => {
        controller!.attach(vid8);
      });
      expect(domFrom.query("[data-pending-mode]")?.getAttribute("data-pending-mode")).toBe("");
      expect(domFrom.query("[data-method]")?.getAttribute("data-method")).toBe("reference");
      expect(domFrom.query("[data-active-mode]")?.getAttribute("data-active-mode")).toBe("motion_transfer");
    } finally {
      await domFrom.unmount();
    }
    // 4) Round 2 Item 2: after 기본 removes a video, a new video arriving outside attachItem (?ref= / scene extend)
    //    clears `ui.undo` so 되돌리기 disappears and pressing undo cannot add a second video.
    function UndoReconcileHarness() {
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
          <span data-undo={vm.dockProp?.undo ? "1" : "0"} />
          <span data-video-count={String(dock.tray.filter((t) => t.kind === "video").length)} />
          <button type="button" data-pick-basic onClick={() => vm.dockProp?.onSelectMode("basic")} />
          <button type="button" data-do-undo onClick={() => vm.dockProp?.onUndoRemoveVideo()} />
        </div>
      );
    }

    for (const via of ["setTray", "attach"] as const) {
      const domUndo = await mountDom(<UndoReconcileHarness />);
      try {
        await act(async () => {
          controller!.attach(vid8);
        });
        await domUndo.click("[data-pick-basic]");
        expect(domUndo.query("[data-undo]")?.getAttribute("data-undo")).toBe("1");
        expect(domUndo.query("[data-video-count]")?.getAttribute("data-video-count")).toBe("0");

        await act(async () => {
          if (via === "setTray") controller!.setTray([vid18]);
          else controller!.attach(vid18);
        });
        expect(domUndo.query("[data-undo]")?.getAttribute("data-undo")).toBe("0");
        expect(domUndo.query("[data-video-count]")?.getAttribute("data-video-count")).toBe("1");

        // Even if the stale undo handler is triggered, no second video is added.
        await domUndo.click("[data-do-undo]");
        expect(domUndo.query("[data-video-count]")?.getAttribute("data-video-count")).toBe("1");
      } finally {
        await domUndo.unmount();
      }
    }
  });

  it("R8/R9/R10: collapsed pill & viewer show no mode control; reverse panel renders with mode switch; reload resets to basic", () => {
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

    // R8: ?start=reverse mounts ReversePanel alongside the mode switch.
    const reverseHtml = renderToStaticMarkup(
      <VideoStudioWorkspace
        organizationId={ORG}
        locale="ko"
        copy={KO_COPY}
        libraryCopy={KO_DICT.studioLibrary}
        videoCopy={KO_VIDEO}
        videoModes
        videoModesCopy={KO_MODES}
        initialCreateMode="blueprint"
        initialAssetId={vid8.assetId}
        initialState={studioState({
          canCreate: true,
          assets: [asset(3, { id: vid8.assetId!, kind: "video", seconds: 8, width: 720, height: 1280 })],
          jobs: [],
        })}
      />,
    );
    expect(reverseHtml).toContain("data-studio-reverse");
    expect(reverseHtml).toContain("data-video-mode-switch");

    expect(INITIAL_VIDEO_MODES_STATE.pendingMode).toBeNull();
  });
});

describe("3. Request-body equality: mode functions vs main's path (Item 1 + W4)", () => {
  const ids = { organizationId: ORG, requestIds: ["req-00000001", "req-00000002", "req-00000003"] };
  const avail = (draft: DockDraft, tray: readonly TrayItem[]) =>
    videoModeAvailability({ draft, tray, film: null, copy: KO_COPY, videoCopy: KO_VIDEO });

  function assertIdenticalBuild(label: string, modeDraft: DockDraft, mainDraft: DockDraft, tray: TrayItem[]) {
    const fromModes = buildMultiClipJobs(modeDraft, tray, ids);
    const fromMain = buildMultiClipJobs(mainDraft, tray, ids);
    expect(fromModes.ok, label).toBe(true);
    expect(fromMain.ok, label).toBe(true);
    expect(fromModes, label).toEqual(fromMain);
    if (fromModes.ok && fromModes.inputs.length === 1) {
      const sMode = buildJob(modeDraft, tray, { organizationId: ORG, requestId: ids.requestIds[0]! });
      const sMain = buildJob(mainDraft, tray, { organizationId: ORG, requestId: ids.requestIds[0]! });
      expect(sMode, label).toEqual(sMain);
    }
  }

  it("matches main's path byte-for-byte for every mode x tray combination", () => {
    const typed = (prompt: string, change = ""): DockDraft => ({ ...initialDraft("video"), prompt, change });

    // 1) Empty tray (기본)
    const emptyBase = typed("Slow dolly over perfume bottle");
    const emptyMode = selectVideoMode({ target: "basic", draft: emptyBase, tray: [], ui: INITIAL_VIDEO_MODES_STATE, availability: avail(emptyBase, []) }).draft;
    assertIdenticalBuild("기본 + empty", emptyMode, emptyBase, []);

    // 2) Image only (기본 + image + audio)
    const imgBase = typed("@image1 slow push-in");
    const imgMode = draftAndStateAfterVideoAttach({ draft: imgBase, nextTray: [img1, aud1], item: img1, ui: INITIAL_VIDEO_MODES_STATE, copy: KO_COPY }).draft;
    const imgMain = draftAfterAttach(imgBase, img1, true, [img1, aud1]);
    assertIdenticalBuild("기본 + image + audio", imgMode, imgMain, [img1, aud1]);

    // 3) Video <= 30s — Re-Architect (picked before attach vs main attach + blueprint click)
    const sBase = typed("Clean studio remake", "Swap product");
    const raPick = selectVideoMode({ target: "re_architect", draft: sBase, tray: [], ui: INITIAL_VIDEO_MODES_STATE, availability: avail(sBase, []) });
    const raMode = draftAndStateAfterVideoAttach({ draft: raPick.draft, nextTray: [vid8], item: vid8, ui: raPick.ui, copy: KO_COPY }).draft;
    const raMain = mainRemixMethodPatch(draftAfterAttach(sBase, vid8, true, [vid8]), "blueprint");
    assertIdenticalBuild("Re-Architect + video <= 30s", raMode, raMain, [vid8]);

    // 4) Video <= 30s — Motion Transfer (picked before attach vs main attach + reference click)
    const mtPick = selectVideoMode({ target: "motion_transfer", draft: sBase, tray: [], ui: INITIAL_VIDEO_MODES_STATE, availability: avail(sBase, []) });
    const mtMode = draftAndStateAfterVideoAttach({ draft: mtPick.draft, nextTray: [vid8], item: vid8, ui: mtPick.ui, copy: KO_COPY }).draft;
    const mtMain = mainRemixMethodPatch(draftAfterAttach(sBase, vid8, true, [vid8]), "reference");
    assertIdenticalBuild("Motion Transfer + video <= 30s", mtMode, mtMain, [vid8]);

    // 5) Video > 30s — Re-Architect
    const longBase = typed("Long runway remake", "New cast");
    const longPick = selectVideoMode({ target: "re_architect", draft: longBase, tray: [], ui: INITIAL_VIDEO_MODES_STATE, availability: avail(longBase, []) });
    const longMode = draftAndStateAfterVideoAttach({ draft: longPick.draft, nextTray: [vid42], item: vid42, ui: longPick.ui, copy: KO_COPY }).draft;
    const longMain = mainRemixMethodPatch(draftAfterAttach(longBase, vid42, true, [vid42]), "blueprint");
    assertIdenticalBuild("Re-Architect + video > 30s", longMode, longMain, [vid42]);

    // 6) Video + Image — Re-Architect & Motion Transfer
    const viBase = typed("Swap subject with @image1", "Keep lighting");
    const viMainAttached = draftAfterAttach(draftAfterAttach(viBase, vid8, true, [vid8]), img1, true, [vid8, img1]);
    const viRaMode = selectVideoMode({ target: "re_architect", draft: viMainAttached, tray: [vid8, img1], ui: INITIAL_VIDEO_MODES_STATE, availability: avail(viMainAttached, [vid8, img1]) }).draft;
    assertIdenticalBuild("Re-Architect + video + image", viRaMode, mainRemixMethodPatch(viMainAttached, "blueprint"), [vid8, img1]);

    const viMtMode = selectVideoMode({ target: "motion_transfer", draft: viMainAttached, tray: [vid8, img1], ui: INITIAL_VIDEO_MODES_STATE, availability: avail(viMainAttached, [vid8, img1]) }).draft;
    assertIdenticalBuild("Motion Transfer + video + image", viMtMode, mainRemixMethodPatch(viMainAttached, "reference"), [vid8, img1]);

    // 7) Two clips (Re-Architect 2-clip plan, AND switching to Motion Transfer resets clipCount: 1)
    const twoClipBase: DockDraft = { ...draftAfterAttach(typed("Two-part cut", "New outfit"), vid18, true, [vid18]), clipCount: 2, targetTotalSeconds: 30, seconds: 15 };
    const twoClipRaMode = selectVideoMode({ target: "re_architect", draft: twoClipBase, tray: [vid18], ui: INITIAL_VIDEO_MODES_STATE, availability: avail(twoClipBase, [vid18]) }).draft;
    assertIdenticalBuild("Re-Architect two clips", twoClipRaMode, mainRemixMethodPatch(twoClipBase, "blueprint"), [vid18]);

    const twoClipToMtMode = selectVideoMode({ target: "motion_transfer", draft: twoClipRaMode, tray: [vid18], ui: INITIAL_VIDEO_MODES_STATE, availability: avail(twoClipRaMode, [vid18]) }).draft;
    assertIdenticalBuild("Two clips -> Motion Transfer resets clipCount=1", twoClipToMtMode, mainRemixMethodPatch(twoClipBase, "reference"), [vid18]);

    // 8) Edit toggle on and off inside Motion Transfer
    const editOnMode = applyVideoModeEditToggle(mtMode, "edit");
    const editOnMain = mainRemixMethodPatch(mtMain, "edit");
    assertIdenticalBuild("Motion Transfer edit toggle ON", editOnMode, editOnMain, [vid8]);

    const editOffMode = applyVideoModeEditToggle(editOnMode, "reference");
    const editOffMain = mainRemixMethodPatch(editOnMain, "reference");
    assertIdenticalBuild("Motion Transfer edit toggle OFF", editOffMode, editOffMain, [vid8]);
  });
});

describe("4. Dynamic constants in ! tip & video well + W5 drop states + W6 LibraryRail browse", () => {
  it("Item 3: tip and well numbers & container formats follow constants dynamically", () => {
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

    const mtTip = formatVideoModeTipLines({ mode: "motion_transfer", model: customModel, copy: KO_MODES.tip });
    expect(mtTip.give).toContain("4~25초");

    // Well limits follow constants & videoMimes
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

  it("W5: well distinguishes rest, data-drop-ready (page drag), and data-drop-target (over well)", () => {
    const rest = renderToStaticMarkup(
      <VideoModeWell mode="re_architect" model={seedance} copy={KO_MODES.well} dropActive={false} dropReady={false} disabled={false} onFiles={noop} onBrowse={noop} />,
    );
    expect(rest).not.toContain("data-drop-ready");
    expect(rest).not.toContain("data-drop-target");
    expect(rest).toContain(KO_MODES.well.title);
    expect(rest).toContain("data-video-well-open-reverse");

    const ready = renderToStaticMarkup(
      <VideoModeWell mode="re_architect" model={seedance} copy={KO_MODES.well} dropActive={false} dropReady={true} disabled={false} onFiles={noop} onBrowse={noop} />,
    );
    expect(ready).toContain('data-drop-ready=""');
    expect(ready).not.toContain("data-drop-target");
    expect(ready).toContain(KO_MODES.well.title);

    const target = renderToStaticMarkup(
      <VideoModeWell mode="motion_transfer" model={seedance} copy={KO_MODES.well} dropActive={true} dropReady={true} disabled={false} onFiles={noop} onBrowse={noop} />,
    );
    expect(target).toContain('data-drop-target=""');
    expect(target).not.toContain("data-drop-ready");
    expect(target).toContain(KO_MODES.well.dropNow);
    expect(target).not.toContain("data-video-well-open-reverse");
  });

  it("file picker forwards chosen files to onFiles and browse calls onBrowse", async () => {
    const onFiles = vi.fn();
    const onBrowse = vi.fn();
    const dom = await mountDom(
      <VideoModeWell
        mode="re_architect"
        model={seedance}
        limits={STUDIO_LIMITS}
        shotLimits={STUDIO_SHOT_LIMITS}
        copy={KO_MODES.well}
        dropActive={false}
        dropReady={false}
        disabled={false}
        onFiles={onFiles}
        onBrowse={onBrowse}
      />,
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

  it("W6: 보관함에서 고르기 opens folded desktop LibraryRail AND focuses search whether closed or already open", async () => {
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

    // 1) Drawer starts folded/closed on folders tab -> trigger unfolds, switches to uploads, focuses search
    const domClosed = await mountDom(<RailHarness startCollapsed />);
    try {
      // Fold the rail via its collapse button first
      await domClosed.click(".bsr-fold");
      expect(domClosed.query("[data-library-rail]")?.getAttribute("data-collapsed")).toBe("");
      expect(domClosed.query("#rail-search-w6")).toBeNull();

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

    // 2) Drawer already open -> trigger focuses search immediately
    const domOpen = await mountDom(<RailHarness startCollapsed={false} />);
    try {
      expect(domOpen.query("[data-library-rail]")?.getAttribute("data-collapsed")).toBeNull();
      await domOpen.click("[data-trigger-browse]");
      expect(document.activeElement?.getAttribute("id")).toBe("rail-search-w6");
    } finally {
      await domOpen.unmount();
    }
  });

  it("Dock drop machinery accepts image, audio, and video drops", () => {
    expect(acceptsDrag([REF_DRAG_TYPE])).toBe(true);
    expect(acceptsDrag(["Files"])).toBe(true);
    expect(acceptsDrag(["text/plain"])).toBe(false);
    expect(decodeRefDrag(JSON.stringify({ assetId: img1.assetId }))).toEqual({ assetId: img1.assetId });
    expect(decodeRefDrag(JSON.stringify({ assetId: aud1.assetId }))).toEqual({ assetId: aud1.assetId });
    expect(decodeRefDrag(JSON.stringify({ assetId: vid8.assetId }))).toEqual({ assetId: vid8.assetId });
  });
});

describe("5. Seen store (`twings_studio_video_mode_seen_v1`) & Item 8 mark-seen-on-open", () => {
  it("handles first open, never again, corrupt JSON, blocked storage, and independent modes", () => {
    const store = memoryStorage();
    expect(isVideoModeSeen("basic", store)).toBe(true);
    expect(isVideoModeSeen("re_architect", store)).toBe(false);
    expect(isVideoModeSeen("motion_transfer", store)).toBe(false);

    markVideoModeSeen("re_architect", store);
    expect(isVideoModeSeen("re_architect", store)).toBe(true);
    expect(isVideoModeSeen("motion_transfer", store)).toBe(false);
    expect(JSON.parse(store.getItem(VIDEO_MODE_SEEN_KEY)!)).toEqual({ re_architect: true });

    markVideoModeSeen("motion_transfer", store);
    expect(isVideoModeSeen("motion_transfer", store)).toBe(true);

    store.setItem(VIDEO_MODE_SEEN_KEY, "{not valid json");
    expect(readSeenVideoModes(store)).toEqual({});
    store.setItem(VIDEO_MODE_SEEN_KEY, '["re_architect"]');
    expect(readSeenVideoModes(store)).toEqual({});

    const blocked: Storage = {
      length: 0,
      clear: () => { throw new Error("blocked"); },
      getItem: () => { throw new Error("blocked"); },
      key: () => null,
      removeItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(readSeenVideoModes(blocked)).toEqual({});
    expect(isVideoModeSeen("re_architect", blocked)).toBe(false);
    expect(markVideoModeSeen("re_architect", blocked)).toEqual({ re_architect: true });
  });

  it("Item 8: marks a mode seen when the explainer OPENS so leaving without clicking 알겠어요 never reopens it", async () => {
    function SeenHarness() {
      const [studio] = useState(stubStudio);
      const dock = useDock({ studio, copy: KO_COPY, organizationId: ORG, initialMedium: "video", mode: "video" });
      const vm = useVideoModes({
        enabled: true,
        modesCopy: KO_MODES,
        dock,
        copy: KO_COPY,
        videoCopy: KO_VIDEO,
        remixOn: false,
        remixFilm: null,
      });
      return (
        <div>
          <span data-explainer-open={vm.explainerMode ?? ""} />
          <button type="button" data-pick-basic onClick={() => vm.dockProp?.onSelectMode("basic")} />
          <button type="button" data-pick-ra onClick={() => vm.dockProp?.onSelectMode("re_architect")} />
          <button type="button" data-pick-mt onClick={() => vm.dockProp?.onSelectMode("motion_transfer")} />
        </div>
      );
    }

    const dom = await mountDom(<SeenHarness />);
    try {
      window.localStorage.removeItem(VIDEO_MODE_SEEN_KEY);
      // Pick Re-Architect -> explainer opens AND immediately marks re_architect seen
      await dom.click("[data-pick-ra]");
      expect(dom.query("[data-explainer-open]")?.getAttribute("data-explainer-open")).toBe("re_architect");
      expect(isVideoModeSeen("re_architect")).toBe(true);
      expect(isVideoModeSeen("motion_transfer")).toBe(false);

      // Leave to 기본 without pressing 알겠어요, then pick Re-Architect again -> never reopens
      await dom.click("[data-pick-basic]");
      expect(dom.query("[data-explainer-open]")?.getAttribute("data-explainer-open")).toBe("");
      await dom.click("[data-pick-ra]");
      expect(dom.query("[data-explainer-open]")?.getAttribute("data-explainer-open")).toBe("");

      // Motion Transfer is independent -> opens on first pick
      await dom.click("[data-pick-mt]");
      expect(dom.query("[data-explainer-open]")?.getAttribute("data-explainer-open")).toBe("motion_transfer");
    } finally {
      try {
        window.localStorage.removeItem(VIDEO_MODE_SEEN_KEY);
      } catch {}
      await dom.unmount();
    }
  });
});

describe("6. Items 7 & 9 + W7 + W8: focus-only arrows, focusable aria-disabled, ! circle tip, & 3-still explainer", () => {
  it("Items 7 & 9: arrow/Home/End move focus ONLY (never select); disabled option is focusable via aria-disabled and Space/Enter selects enabled only", async () => {
    const availability = {
      basic: { mode: "basic" as const, disabled: false, reason: null },
      re_architect: { mode: "re_architect" as const, disabled: false, reason: null },
      motion_transfer: { mode: "motion_transfer" as const, disabled: true, reason: "30초 이하 영상만 가능해요." },
    };

    expect(nextFocusedVideoMode("basic", 1)).toBe("re_architect");
    expect(nextFocusedVideoMode("re_architect", 1)).toBe("motion_transfer");
    expect(nextFocusedVideoMode("motion_transfer", 1)).toBe("basic");
    expect(nextFocusedVideoMode("basic", -1)).toBe("motion_transfer");
    expect(nextFocusedVideoMode("re_architect", "first")).toBe("basic");
    expect(nextFocusedVideoMode("basic", "last")).toBe("motion_transfer");

    const onSelect = vi.fn();
    const dom = await mountDom(
      <VideoModeBar activeMode="re_architect" availability={availability} model={seedance} copy={KO_MODES} disabled={false} onSelect={onSelect} />,
    );
    try {
      const radios = dom.queryAll('[role="radio"]');
      expect(radios).toHaveLength(3);
      // Single tab stop on activeMode (`re_architect`)
      expect(radios[0]!.getAttribute("tabindex")).toBe("-1");
      expect(radios[1]!.getAttribute("tabindex")).toBe("0");
      expect(radios[2]!.getAttribute("tabindex")).toBe("-1");

      // Item 9: disabled option uses aria-disabled="true" (NOT native disabled) so it can take focus & announce reason
      expect(radios[2]!.getAttribute("disabled")).toBeNull();
      expect(radios[2]!.getAttribute("aria-disabled")).toBe("true");
      const describedBy = radios[2]!.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      expect(dom.query('[data-video-mode-disabled-reason="motion_transfer"]')?.getAttribute("id")).toBe(describedBy);

      // Item 7: ArrowLeft onto 기본 moves focus ONLY (does NOT trigger onSelect -> video stays safe!)
      radios[1]!.focus();
      await dom.keyDown("ArrowLeft", { target: radios[1]! });
      expect(onSelect).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(radios[0]);

      // ArrowLeft again wraps onto disabled motion_transfer -> focus lands there so reason is announced;
      // Enter/Space + native click on aria-disabled button are ignored.
      await dom.keyDown("ArrowLeft", { target: radios[0]! });
      expect(document.activeElement).toBe(radios[2]);
      await dom.keyDown("Enter", { target: radios[2]! });
      await dom.click(radios[2]!);
      await dom.keyDown(" ", { target: radios[2]! });
      await dom.click(radios[2]!);
      expect(onSelect).not.toHaveBeenCalled();

      // Home moves focus to 기본; Round 2 item 3: Space press (keydown + browser's native keyup click)
      // selects ONCE only (onClick handles selection, never double-firing via keydown).
      await dom.keyDown("Home", { target: radios[2]! });
      expect(document.activeElement).toBe(radios[0]);
      expect(onSelect).not.toHaveBeenCalled();
      await dom.keyDown(" ", { target: radios[0]! });
      expect(onSelect).not.toHaveBeenCalled();
      await dom.click(radios[0]!);
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith("basic");
    } finally {
      await dom.unmount();
    }
  });

  it("W7: ! control renders Tip circle with aria-describedby tooltip, dynamic numbers, and honest notes for Motion Transfer", () => {
    const allOpen = {
      basic: { mode: "basic" as const, disabled: false, reason: null },
      re_architect: { mode: "re_architect" as const, disabled: false, reason: null },
      motion_transfer: { mode: "motion_transfer" as const, disabled: false, reason: null },
    };
    const basicHtml = renderToStaticMarkup(
      <VideoModeBar activeMode="basic" availability={allOpen} model={seedance} copy={KO_MODES} disabled={false} onSelect={noop} />,
    );
    expect(basicHtml).toContain("bs-tip bs-vmode-tip");
    expect(basicHtml).toContain("bs-tip-btn");
    expect(basicHtml).toContain('role="tooltip"');
    expect(basicHtml).toContain("최대 9장");
    expect(basicHtml).toContain("4~15초");
    expect(basicHtml).not.toContain(KO_MODES.tip.motionHonestNotes.faceColor);

    const mtHtml = renderToStaticMarkup(
      <VideoModeBar activeMode="motion_transfer" availability={allOpen} model={seedance} copy={KO_MODES} disabled={false} onSelect={noop} />,
    );
    expect(mtHtml).toContain("2~30초");
    expect(mtHtml).toContain(KO_MODES.tip.motionHonestNotes.faceColor);
    expect(mtHtml).toContain(KO_MODES.tip.motionHonestNotes.extraCredits);
  });

  it("W8 + Round 3 item 2: Re-Architect after-row uses 3 drawn accent tiles (no photos); Motion Transfer uses a different allowed still with identical outlines", () => {
    const allowed = new Set([
      "/reel/brands/city-fashion.jpg",
      "/reel/brands/tea-editorial.jpg",
      "/reel/brands/production-paris.jpg",
    ]);
    const raHtml = renderToStaticMarkup(<VideoModeExplainer mode="re_architect" copy={KO_MODES} model={seedance} onDismiss={noop} />);
    const beforeBlock = raHtml.match(/data-rearchitect-strip="before"[\s\S]*?<\/div><p/)?.[0] ?? "";
    const afterBlock = raHtml.match(/data-rearchitect-strip="after"[\s\S]*?<\/div><p/)?.[0] ?? "";
    const beforeSrcs = [...beforeBlock.matchAll(/src="([^"]+)"/g)].map((m) => m[1]!);
    const afterSrcs = [...afterBlock.matchAll(/src="([^"]+)"/g)].map((m) => m[1]!);

    expect(beforeSrcs).toHaveLength(3);
    expect(new Set(beforeSrcs).size).toBe(3); // 3 distinct allowed stills in before-row
    for (const src of beforeSrcs) expect(allowed.has(src), src).toBe(true);
    // Round 3 item 2: after-row has ZERO photos and THREE drawn accent tiles with labels
    expect(afterSrcs).toHaveLength(0);
    expect(afterBlock).toContain('data-rearchitect-drawn-tile="1"');
    expect(afterBlock).toContain('data-rearchitect-drawn-tile="2"');
    expect(afterBlock).toContain('data-rearchitect-drawn-tile="3"');
    expect(afterBlock).toContain("내 제품");
    expect(afterBlock).toContain("내 인물");
    expect(afterBlock).toContain("내 장소");
    expect(raHtml).toContain('loading="lazy"');
    expect(raHtml).toContain('decoding="async"');
    expect(raHtml).toContain("최대 4개 클립");

    const raEnHtml = renderToStaticMarkup(<VideoModeExplainer mode="re_architect" copy={studioVideoModesEn} model={seedance} onDismiss={noop} />);
    expect(raEnHtml).toContain("Your product");
    expect(raEnHtml).toContain("Your cast");
    expect(raEnHtml).toContain("Your place");

    // Motion Transfer: before strip = 1 still x3 with 3 outlines; after strip = DIFFERENT allowed still x3 with SAME 3 outlines
    const mtHtml = renderToStaticMarkup(<VideoModeExplainer mode="motion_transfer" copy={KO_MODES} model={seedance} onDismiss={noop} />);
    const mtBefore = mtHtml.match(/data-motion-strip="before"[\s\S]*?<\/div><p/)?.[0] ?? "";
    const mtAfter = mtHtml.match(/data-motion-strip="after"[\s\S]*?<\/div><p/)?.[0] ?? "";
    const mtBeforeSrcs = [...mtBefore.matchAll(/src="([^"]+)"/g)].map((m) => m[1]!);
    const mtAfterSrcs = [...mtAfter.matchAll(/src="([^"]+)"/g)].map((m) => m[1]!);
    expect(mtBeforeSrcs).toHaveLength(3);
    expect(new Set(mtBeforeSrcs).size).toBe(1);
    expect(mtAfterSrcs).toHaveLength(3);
    expect(new Set(mtAfterSrcs).size).toBe(1);
    expect(mtAfterSrcs[0]).not.toBe(mtBeforeSrcs[0]);
    expect(allowed.has(mtBeforeSrcs[0]!)).toBe(true);
    expect(allowed.has(mtAfterSrcs[0]!)).toBe(true);
    // Same outline positions on before & after strips (`translateX(-2px)`, none, `translateX(2px)`)
    const outlineShifts = (block: string) => [...block.matchAll(/<svg[^>]*viewBox="0 0 40 50"[^>]*>/g)].map((m) => m[0].match(/translateX\([^)]+\)/)?.[0] ?? "0");
    expect(outlineShifts(mtBefore)).toEqual(["translateX(-2px)", "0", "translateX(2px)"]);
    expect(outlineShifts(mtAfter)).toEqual(outlineShifts(mtBefore));
    // Round 4 item 4: every `<img src>` across BOTH explainers (Re-Architect + Motion Transfer) is one of the 3 allowed stills.
    const allRaImgs = [...raHtml.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1]!);
    const allMtImgs = [...mtHtml.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1]!);
    expect(allRaImgs).toHaveLength(3);
    expect(allMtImgs).toHaveLength(7); // 3 before + 1 carry tile + 3 after
    for (const src of [...allRaImgs, ...allMtImgs]) expect(allowed.has(src), src).toBe(true);
    expect(mtHtml).toContain(KO_MODES.tip.motionHonestNotes.faceColor);
    expect(mtHtml).toContain(KO_MODES.tip.motionHonestNotes.extraCredits);
  });
});

describe("7. RecentCreationsPanel draggable only when open", () => {
  const vidOut = output(20, { kind: "video", url: "https://media.example/st/out-20.mp4", seconds: 6 });
  const imgOut = output(21, { kind: "image" });
  const allJobs = [
    job(20, { kind: "video", prompt: "Night walk", outputs: [vidOut] }),
    job(21, { kind: "image", prompt: "Glass flacon", outputs: [imgOut] }),
  ];

  it("enables draggable + startRefDrag payload ONLY when draggableRefs && canEdit", async () => {
    expect(
      renderToStaticMarkup(
        <RecentCreationsPanel allJobs={allJobs} canEdit copy={KO_VIDEO.workspace.drawer} onAttachOutput={noop} onAddVideoToSequence={noop} />,
      ),
    ).not.toContain('draggable="true"');

    expect(
      renderToStaticMarkup(
        <RecentCreationsPanel allJobs={allJobs} canEdit={false} draggableRefs copy={KO_VIDEO.workspace.drawer} onAttachOutput={noop} onAddVideoToSequence={noop} />,
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
      expect(dt.effectAllowed).toBe("copy");
    } finally {
      await dom.unmount();
    }
  });
});

describe("8. Final copy hygiene, tokens, W5/W7 CSS, reduced motion & desktop layout structure", () => {
  it("matches final Korean strings, has zero vendor/engine/won strings, and has no hardcoded limits in tip copy", () => {
    expect(studioVideoModesKo.well.title).toBe("참고할 영상을 넣어 주세요");
    expect(studioVideoModesKo.well.dropNow).toBe("여기에 놓으면 참고 영상으로 등록돼요");
    expect(studioVideoModesKo.status.needVideo).toBe("참고 영상을 먼저 넣어 주세요");
    expect(studioVideoModesKo.status.videoRemoved).toBe("참고 영상을 제거했어요");
    expect(studioVideoModesKo.status.readAgain).toBe("다시 읽기");
    expect(studioVideoModesEn.status.readAgain).toBe("Read again");
    expect(studioVideoModesKo.explainer.reArchitect.mine1).toBe("내 제품");
    expect(studioVideoModesKo.explainer.reArchitect.mine2).toBe("내 인물");
    expect(studioVideoModesKo.explainer.reArchitect.mine3).toBe("내 장소");
    expect(studioVideoModesEn.explainer.reArchitect.mine1).toBe("Your product");
    expect(studioVideoModesEn.explainer.reArchitect.mine2).toBe("Your cast");
    expect(studioVideoModesEn.explainer.reArchitect.mine3).toBe("Your place");
    expect(studioVideoModesKo.tip.giveLabel).toBe("입력 항목");
    expect(studioVideoModesKo.tip.keepLabel).toBe("반영되는 것");
    expect(studioVideoModesKo.tip.getLabel).toBe("결과물");

    const all = JSON.stringify([studioVideoModesKo, studioVideoModesEn, EN_DICT.studioVideoModes]);
    for (const banned of [/seedance/i, /gemini/i, /sunra/i, /kling/i, /higgsfield/i, /morphic|모픽/i, /₩|\d원\b/]) {
      expect(all).not.toMatch(banned);
    }
    // No raw numbers in tip strings (only placeholders)
    expect(JSON.stringify([studioVideoModesKo.tip, studioVideoModesEn.tip])).not.toMatch(/\d/);
    // No promise words in English tip/oneLiners
    expect(JSON.stringify([studioVideoModesEn.oneLiners, studioVideoModesEn.tip])).not.toMatch(/\b(exactly|keeps|preserves)\b/i);
  });

  it("uses existing studio CSS tokens only, distinct W5 well states, W7 Tip circle/focus, and prefers-reduced-motion", () => {
    const studioCss = readFileSync(resolve(process.cwd(), "app/(brand)/studio-v2.css"), "utf8");
    const vmodeSection = studioCss.slice(studioCss.indexOf("/* Video studio modes (slice VM-1)"));
    expect(vmodeSection).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(vmodeSection).toContain("prefers-reduced-motion: reduce");
    expect(vmodeSection).toContain('.bs-vmode-option[aria-disabled="true"]');
    expect(vmodeSection).toContain(".bs-vmode-tip .bs-tip-btn");
    expect(vmodeSection).toContain("1.5px dashed var(--ys-accent)");
    expect(vmodeSection).toContain("1.5px solid var(--ys-accent)");
    expect(vmodeSection).toContain(".bs-dock-guidance");
    expect(vmodeSection).toContain("color: var(--ys-ink-muted)");
    expect(vmodeSection).not.toContain("--ys-danger");
    expect(studioCss).toContain(".bs-dock-message { margin: 0; padding: 0 4px; font-size: 13px; color: var(--ys-danger); }");
    expect(studioCss).toContain(".bs-tip:hover .bs-tip-body, .bs-tip:focus-within .bs-tip-body");

    const explainerCss = readFileSync(resolve(process.cwd(), "components/brand-studio/video/mode-explainer.module.css"), "utf8");
    expect(explainerCss).toContain("prefers-reduced-motion: reduce");
    expect(explainerCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);

    for (const rel of [
      "components/brand-studio/video/mode-explainer.tsx",
      "components/brand-studio/video/video-modes-ui.tsx",
      "components/brand-studio/video/video-modes-model.ts",
      "components/brand-studio/video/mode-seen.ts",
      "components/brand-studio/video/use-video-modes.ts",
    ]) {
      const src = readFileSync(resolve(process.cwd(), rel), "utf8");
      expect(src).not.toMatch(/from\s+["'][^"']*(campaign-ops|process-stage)/);
    }
  });
});
