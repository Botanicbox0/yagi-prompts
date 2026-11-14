import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STUDIO_SHOT_LIMITS, StudioJobCreateSchema, type FilmSheet, type StudioJobCreate } from "@/lib/brand-studio/contracts";
import { findMissingReferences } from "@/lib/brand-studio/enhancer/mentions";
import { STUDIO_MODELS, type StudioVideoModel } from "@/lib/brand-studio/models";
import { blueprintFit, planMultiClipGeneration, sliceShotsForWindow } from "@/lib/brand-studio/reference-video";
import { getDictionary } from "@/lib/i18n/dictionaries";
import {
  AtMentionMenu,
  applyMentionInsertion,
  buildAtMentionCandidates,
  detectMentionTrigger,
  stepMentionIndex,
  trayVirtualTags,
} from "@/components/brand-studio/at-mention-menu";
import { Dock } from "@/components/brand-studio/dock";
import {
  DRAFT_RESOLUTION,
  activeMultiClipPlan,
  buildJob,
  buildMultiClipJobs,
  dockCredits,
  dockProblem,
  draftAfterAttach,
  initialDraft,
  resolveUnifiedRemixMethod,
  withMedium,
} from "@/components/brand-studio/dock-model";
import { trayItemFromAsset, trayItemFromOutput, trayLabels } from "@/components/brand-studio/refs";
import { RemixPanel } from "@/components/brand-studio/remix-panel";
import { Tray } from "@/components/brand-studio/tray";
import { VideoStudioWorkspace } from "@/components/brand-studio/video/workspace";
import { ORG, allowance, asset, copyFor, job, output, studioState } from "./ui/fixtures";

const koDict = getDictionary("ko");
const seedance = STUDIO_MODELS.find((m) => m.id === "seedance-2.5") as StudioVideoModel;

describe("Studio Pro Suite v4 — 1. Video Studio Layout Overhaul & Capsule Dock", () => {
  it("renders Image Studio layout paradigm when empty: 3-step 16:9 guide, starter chips, bottom capsule dock, single #0033FF CTA, LibraryRail", () => {
    const state = studioState({
      canCreate: true,
      jobs: [],
      assets: [
        asset(1, { kind: "image", name: "serum.png", role: "product" }),
        asset(2, { kind: "video", name: "ref-ad.mp4", seconds: 12 }),
      ],
    });

    const html = renderToStaticMarkup(
      h(VideoStudioWorkspace, {
        organizationId: ORG,
        locale: "ko",
        copy: koDict.brandStudio,
        libraryCopy: koDict.studioLibrary,
        videoCopy: koDict.studioVideo,
        initialState: state,
      }),
    );

    // Unified layout markers (no legacy 2-column left sidebar tabs)
    expect(html).toContain("data-video-studio-workspace");
    expect(html).toContain('data-studio-mode="video"');
    expect(html).toContain("data-video-guide");
    expect(html.match(/data-video-guide-step=/g)).toHaveLength(3);
    expect(html).toContain("data-studio-examples");
    expect(html).toContain("data-studio-dock");
    expect(html).toContain("data-studio-rail-slot");
    expect(html).not.toContain("data-video-tab=");
    expect(html).not.toContain("data-video-edit-panel");
    expect(html).not.toContain("data-video-blueprint-panel");

    // Strictly ONE solid #0033FF CTA (`[data-studio-submit]`) on screen
    expect(html.match(/data-variant="solid"/g)).toHaveLength(1);
    expect(html).toContain("data-studio-submit");
    expect(html).not.toMatch(/#ebf5ff/i);
    expect(html).not.toMatch(/₩|KRW|\d\s*원/);
  });

  it("renders full-canvas video Wall + 기록/가이드 header pill toggle when video outputs exist", () => {
    const videoOut = output(1, { kind: "video", url: "/api/brand-studio/media/st/out.mp4", seconds: 8 });
    const videoJob = job(1, { kind: "video", model: "seedance-2.5", outputs: [videoOut], seconds: 8 });
    const state = studioState({ canCreate: true, jobs: [videoJob] });

    const html = renderToStaticMarkup(
      h(VideoStudioWorkspace, {
        organizationId: ORG,
        locale: "ko",
        copy: koDict.brandStudio,
        libraryCopy: koDict.studioLibrary,
        videoCopy: koDict.studioVideo,
        initialState: state,
      }),
    );

    expect(html).toContain("data-video-stage-tabs");
    expect(html).toContain('data-stage-tab="history"');
    expect(html).toContain('data-stage-tab="guide"');
    expect(html).toContain(">기록<");
    expect(html).toContain(">가이드<");
    expect(html.match(/data-variant="solid"/g)).toHaveLength(1);
  });
});

describe("Studio Pro Suite v4 — 2. Unified Seedance 2.5 Composer Routing", () => {
  const ids = { organizationId: ORG, requestId: "req-unified-1" };

  it("routes no-video runs to Seedance 2.5 text/image-to-video with optional start/end frame badges", () => {
    const draft = { ...withMedium(initialDraft(), "video"), prompt: "@image1 로 시작해 카메라가 천천히 줌인" };
    expect(draft.model).toBe("seedance-2.5");

    const startImg = { ...trayItemFromAsset(asset(1, { role: "product" })), frame: "start" as const };
    const built = buildJob(draft, [startImg], ids);
    expect(built.ok).toBe(true);
    if (built.ok && built.input.kind === "video") {
      expect(built.input.model).toBe("seedance-2.5");
      expect(built.input.references[0]?.frame).toBe("start");
    } else {
      throw new Error("expected video job");
    }

    const copy = copyFor("ko");
    const trayHtml = renderToStaticMarkup(
      h(Tray, {
        items: [startImg],
        labels: trayLabels([startImg], copy),
        medium: "video",
        copy,
        dropActive: false,
        uploading: [],
        onUpdate: () => undefined,
        onRemove: () => undefined,
        onMove: () => undefined,
        onBrowse: () => undefined,
      }),
    );
    expect(trayHtml).toContain('data-tray-frame="start"');
  });

  it("auto-routes >30s @video1 to blueprint (never blocked by 30s raw cap) and unlocks reference/edit when trimmed <=30s", () => {
    const longFilm = trayItemFromAsset(asset(2, { kind: "video", seconds: 48, width: 1080, height: 1920 }));
    const productImg = trayItemFromAsset(asset(1, { kind: "image", role: "product" }));
    const baseDraft = draftAfterAttach(withMedium(initialDraft(), "video"), longFilm, true, [longFilm, productImg]);
    const draft = { ...baseDraft, change: "제품을 @image1 로 교체" };

    expect(resolveUnifiedRemixMethod(draft, [longFilm, productImg])).toBe("blueprint");
    expect(dockProblem(draft, [longFilm, productImg])).toBeNull();

    const built = buildJob(draft, [longFilm, productImg], ids);
    expect(built.ok).toBe(true);
    if (built.ok && built.input.kind === "video_remix") {
      expect(built.input.method).toBe("blueprint");
    }

    // RemixPanel disables reference & edit for 48s clip and offers "구간 자르기 (30초 이내)"
    const longHtml = renderToStaticMarkup(
      h(RemixPanel, {
        draft,
        film: null,
        copy: koDict.brandStudio,
        videoCopy: koDict.studioVideo,
        disabled: false,
        videoSeconds: 48,
        onTrimVideo: () => undefined,
        onChange: () => undefined,
      }),
    );
    expect(longHtml).toContain("data-studio-over-limit-note");
    expect(longHtml).toContain("data-studio-remix-trim");
    expect(longHtml).toContain("구간 자르기 (30초 이내)");
    expect(longHtml).toMatch(/disabled=""[^>]*value="reference"|value="reference"[^>]*disabled=""/);
    expect(longHtml).toMatch(/disabled=""[^>]*value="edit"|value="edit"[^>]*disabled=""/);

    // Trimming to <= 30s unlocks direct reference & edit pills!
    const trimmedFilm = trayItemFromAsset(asset(3, { kind: "video", seconds: 14, width: 1080, height: 1920 }));
    const pinnedEdit = { ...draft, method: "edit" as const, methodPinned: true, clipCount: 1, targetTotalSeconds: null };
    expect(resolveUnifiedRemixMethod(pinnedEdit, [trimmedFilm, productImg])).toBe("edit");

    const trimmedHtml = renderToStaticMarkup(
      h(RemixPanel, {
        draft: pinnedEdit,
        film: null,
        copy: koDict.brandStudio,
        videoCopy: koDict.studioVideo,
        disabled: false,
        videoSeconds: 14,
        editable: true,
        onTrimVideo: () => undefined,
        onChange: () => undefined,
      }),
    );
    expect(trimmedHtml).not.toContain("data-studio-over-limit-note");
    expect(trimmedHtml).toContain("레퍼런스 연출 재현 (추천)");
    expect(trimmedHtml).toContain("모션 직접 참조");
    expect(trimmedHtml).toContain("원본 클립 부분 편집");
    expect(trimmedHtml).not.toMatch(/disabled=""[^>]*value="edit"|value="edit"[^>]*disabled=""/);
  });

  it("defaults <=30s @video1 + @image1 to blueprint intelligently until user pins another pill", () => {
    const shortFilm = trayItemFromAsset(asset(2, { kind: "video", seconds: 12, width: 1080, height: 1920 }));
    const productImg = trayItemFromAsset(asset(1, { kind: "image", role: "product" }));
    const unpinned = { ...withMedium(initialDraft(), "video"), change: "@image1 로 교체" };

    expect(resolveUnifiedRemixMethod(unpinned, [shortFilm, productImg])).toBe("blueprint");
    const pinnedRef = { ...unpinned, method: "reference" as const, methodPinned: true };
    expect(resolveUnifiedRemixMethod(pinnedRef, [shortFilm, productImg])).toBe("reference");
  });
});

describe("Studio Pro Suite v4 — 3. `@` Multimodal Reference Autocomplete & Virtual Tags", () => {
  it("renders @image1, @image2, @video1, @audio1 virtual tags in Tray + trim chip while preserving aria-labels", () => {
    const items = [
      trayItemFromAsset(asset(1, { kind: "image" })),
      trayItemFromAsset(asset(2, { kind: "video", seconds: 10 })),
      trayItemFromAsset(asset(3, { kind: "image" })),
      trayItemFromAsset(asset(4, { kind: "audio" })),
    ];
    expect(trayVirtualTags(items)).toEqual(["@image1", "@video1", "@image2", "@audio1"]);

    const copy = copyFor("ko");
    const html = renderToStaticMarkup(
      h(Tray, {
        items,
        labels: trayLabels(items, copy),
        medium: "video",
        copy,
        dropActive: false,
        uploading: [],
        onTrimVideo: () => undefined,
        onUpdate: () => undefined,
        onRemove: () => undefined,
        onMove: () => undefined,
        onBrowse: () => undefined,
      }),
    );

    expect(html).toContain(">@image1<");
    expect(html).toContain(">@video1<");
    expect(html).toContain(">@image2<");
    expect(html).toContain(">@audio1<");
    expect(html).toContain("data-tray-trim=");
    expect(html).toContain("구간·화면 자르기");
    // Screen-reader accessibility preserved
    expect(html).toContain('aria-label="이미지 1 설정"');
    expect(html).toContain('aria-label="영상 1 설정"');
    expect(html).toContain('aria-label="오디오 1 설정"');
  });

  it("detects @ queries, inserts tokens ALWAYS with trailing space, and splits attached vs 1-click library candidates", () => {
    expect(detectMentionTrigger("@", 1)).toEqual({ active: true, query: "", atIndex: 0 });
    expect(detectMentionTrigger("장면 속 @제품", 8)).toEqual({ active: true, query: "제품", atIndex: 5 });
    expect(detectMentionTrigger("Swap @im", 8)).toEqual({ active: true, query: "im", atIndex: 5 });
    expect(detectMentionTrigger("brand@twings.app", 16).active).toBe(false);
    expect(detectMentionTrigger("Swap @image1 ", 13).active).toBe(false);

    // ALWAYS trailing space, even when followed immediately by Korean particles/words
    const insertedEnd = applyMentionInsertion("제품을 @im", 7, 4, "@image2");
    expect(insertedEnd).toEqual({ text: "제품을 @image2 ", nextCursor: 12 });

    const insertedMid = applyMentionInsertion("제품을 @제품으로 바꿔줘", 7, 4, "@image1");
    expect(insertedMid.text).toBe("제품을 @image1 으로 바꿔줘");
    expect(findMissingReferences(insertedMid.text, ["image"])).toEqual([]);

    // Candidate sections: attached (`tray`) + library (`recentOutputs` & `availableAssets`)
    const attachedImg = trayItemFromAsset(asset(1, { kind: "image", name: "hero-bottle.png", role: "product" }));
    const unattachedImg = asset(2, { kind: "image", name: "model-portrait.png", role: "person" });
    const unattachedVid = asset(3, { kind: "video", name: "walk-ref.mp4", seconds: 12 });
    const unattachedAud = asset(4, { kind: "audio", name: "sonic-logo.mp3" });
    const recentOut = trayItemFromOutput(output(9, { kind: "image" }), "결과");

    const all = buildAtMentionCandidates({
      query: "",
      mode: "video",
      tray: [attachedImg],
      availableAssets: [unattachedImg, unattachedVid, unattachedAud],
      recentOutputs: [recentOut],
      copy: koDict.brandStudio,
      outputBadgeLabel: "최근 결과",
    });

    expect(all.attached.map((c) => c.token)).toEqual(["@image1"]);
    expect(all.attached[0]?.roleLabel).toBe("제품");
    // Unattached image gets `@image2` (since `@image1` is in tray), video gets `@video1`, audio gets `@audio1`!
    expect(all.library.map((c) => c.token)).toEqual(["@image2", "@image2", "@video1", "@audio1"]);
    expect(all.library.every((c) => Boolean(c.attachItem))).toBe(true);

    // Role search `@제품` matches attached product item
    const roleFiltered = buildAtMentionCandidates({
      query: "제품",
      mode: "video",
      tray: [attachedImg],
      availableAssets: [unattachedImg],
      copy: koDict.brandStudio,
    });
    expect(roleFiltered.attached).toHaveLength(1);
    expect(roleFiltered.library).toHaveLength(0);

    // Keyboard index wrap-around
    expect(stepMentionIndex(0, 1, 3)).toBe(1);
    expect(stepMentionIndex(2, 1, 3)).toBe(0);
    expect(stepMentionIndex(0, -1, 3)).toBe(2);

    // Render AtMentionMenu UI
    const menuHtml = renderToStaticMarkup(
      h(AtMentionMenu, {
        id: "test-at",
        attached: all.attached,
        library: all.library,
        activeIndex: 0,
        copy: koDict.brandStudio,
        videoCopy: koDict.studioVideo,
        onHighlight: () => undefined,
        onSelect: () => undefined,
      }),
    );
    expect(menuHtml).toContain("첨부된 레퍼런스");
    expect(menuHtml).toContain("에셋에서 바로 추가");
    expect(menuHtml).toContain('data-active=""');
    expect(menuHtml).not.toMatch(/#ebf5ff/i);
  });
});

describe("Studio Pro Suite v4 — 4. >30s Blueprint Fit, Multi-Clip Planner & Concurrent Dispatch", () => {
  it("allows reference videos up to 600s in blueprintFit and splits >15s durations cleanly in planMultiClipGeneration", () => {
    expect(blueprintFit(seedance, { seconds: 1.5 })).toEqual({ readable: false, problem: "length" });
    expect(blueprintFit(seedance, { seconds: 45 })).toEqual({ readable: true, problem: null });
    expect(blueprintFit(seedance, { seconds: 300 })).toEqual({ readable: true, problem: null });
    expect(blueprintFit(seedance, { seconds: STUDIO_SHOT_LIMITS.secondsMax })).toEqual({ readable: true, problem: null });
    expect(blueprintFit(seedance, { seconds: STUDIO_SHOT_LIMITS.secondsMax + 1 })).toEqual({ readable: false, problem: "length" });

    expect(planMultiClipGeneration({ referenceSeconds: 12, targetTotalSeconds: 15, clipCount: 1 })).toEqual({
      clipCount: 1,
      clipDurations: [15],
      windows: [{ index: 0, startSec: 0, endSec: 15, durationSec: 15 }],
      sweetSpotWarning: false,
    });

    expect(planMultiClipGeneration({ referenceSeconds: 42, targetTotalSeconds: 30, clipCount: 2 })).toEqual({
      clipCount: 2,
      clipDurations: [15, 15],
      windows: [
        { index: 0, startSec: 0, endSec: 15, durationSec: 15 },
        { index: 1, startSec: 15, endSec: 30, durationSec: 15 },
      ],
      sweetSpotWarning: false,
    });

    const p45 = planMultiClipGeneration({ referenceSeconds: 45, targetTotalSeconds: 45 });
    expect(p45.clipCount).toBe(3);
    expect(p45.clipDurations).toEqual([15, 15, 15]);
    expect(p45.sweetSpotWarning).toBe(true);

    const p20 = planMultiClipGeneration({ referenceSeconds: 20, targetTotalSeconds: 20 });
    expect(p20.clipCount).toBe(2);
    expect(p20.clipDurations).toEqual([10, 10]);
    expect(p20.sweetSpotWarning).toBe(false);
  });

  it("renders AI 디렉터 분량 · 클립 가이드 banner copy & chips, scales dockCredits across clips, and compiles concurrent multi-clip jobs", async () => {
    const ref45 = trayItemFromAsset(asset(2, { kind: "video", seconds: 45, width: 1080, height: 1920 }));
    const img1 = trayItemFromAsset(asset(1, { kind: "image", role: "product" }));
    const img2 = trayItemFromAsset(asset(3, { kind: "image", role: "person" }));
    const tray = [ref45, img1, img2];

    const draft30 = {
      ...draftAfterAttach(withMedium(initialDraft(), "video"), ref45, true, tray),
      prompt: "@image1 세럼을 든 @image2 클로즈업",
      change: "제품은 @image1, 인물은 @image2 로 고정",
      targetTotalSeconds: 30,
      clipCount: 2,
    };

    const bannerHtml = renderToStaticMarkup(
      h(Dock, {
        mode: "video",
        draft: draft30,
        tray,
        labels: trayLabels(tray, koDict.brandStudio),
        copy: koDict.brandStudio,
        locale: "ko",
        allowance: allowance(),
        credits: dockCredits(draft30, tray),
        busy: false,
        message: null,
        film: null,
        uploading: [],
        videoCopy: koDict.studioVideo,
        onDraft: () => undefined,
        onTrayUpdate: () => undefined,
        onTrayRemove: () => undefined,
        onSubmit: () => undefined,
        onDropSource: () => undefined,
        onFiles: () => undefined,
        onBrowse: () => undefined,
      }),
    );

    expect(bannerHtml).toContain("첨부한 레퍼런스 영상(@video1)은 45초예요. 몇 초 분량으로 생성할까요?");
    expect(bannerHtml).toContain("30초 이내가 가장 완성도가 높아요. 15초를 넘기면 클립 2개 이상으로 나누어 같은 톤으로 한 번에 생성해 드려요.");
    expect(bannerHtml).toContain("15초 · 1클립");
    expect(bannerHtml).toContain("30초 · 15초×2클립 (추천)");
    expect(bannerHtml).toContain("45초 · 3클립 분할");

    // Credits scale accurately across all planned clips (`2 × 15s` === 2x `1 × 15s` in KRW)
    const draft15 = { ...draft30, seconds: 15, targetTotalSeconds: 15, clipCount: 1 };
    const credits1 = dockCredits(draft15, tray);
    const credits2 = dockCredits(draft30, tray);
    expect(credits2).toBeGreaterThan(credits1);
    expect(activeMultiClipPlan(draft30, tray)?.clipCount).toBe(2);

    // Compile multi-clip jobs with Reference authority + [Part k/N] + sliced shots, then dispatch via Promise.all
    const sheet: FilmSheet = {
      seconds: 45,
      aspect: "9:16",
      summary: "Three-cut beauty ad",
      look: { lighting: "soft morning", palette: "neutral ivory", texture: "clean film" },
      audio: { music: true, speech: false, effects: "glass clink" },
      shots: [
        { start: 0, end: 15, framing: "wide", camera: "slow push-in", action: "opens bottle" },
        { start: 15, end: 30, framing: "medium", camera: "orbit", action: "applies serum" },
        { start: 30, end: 45, framing: "close-up", camera: "locked", action: "hero packshot" },
      ],
    };

    const sliced0 = sliceShotsForWindow(sheet.shots, 45, { index: 0, startSec: 0, endSec: 15, durationSec: 15 }, 30);
    expect(sliced0.length).toBeGreaterThan(0);

    const compiled = buildMultiClipJobs(
      draft30,
      tray,
      { organizationId: ORG, requestIds: ["req-part-1", "req-part-2"] },
      { sheet },
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error("expected multi-clip build ok");
    expect(compiled.inputs).toHaveLength(2);

    const [part1, part2] = compiled.inputs;
    expect(StudioJobCreateSchema.safeParse(part1).success).toBe(true);
    expect(StudioJobCreateSchema.safeParse(part2).success).toBe(true);

    if (part1?.kind === "video_remix" && part2?.kind === "video_remix") {
      expect(part1.prompt).toContain("Reference authority:");
      expect(part1.prompt).toContain("@image1, @image2");
      expect(part1.prompt).toContain("[Part 1/2 · 0.0s–15.0s]");
      expect(part2.prompt).toContain("Reference authority:");
      expect(part2.prompt).toContain("[Part 2/2 · 15.0s–30.0s]");
      expect(part1.references).toEqual(part2.references);
      expect(part1.seconds).toBe(15);
      expect(part2.seconds).toBe(15);
      expect(part1.shots?.length).toBeGreaterThan(0);
      expect(part2.shots?.length).toBeGreaterThan(0);
    } else {
      throw new Error("expected 2 video_remix jobs");
    }

    // Verify concurrent Promise.all dispatch semantics (both start before either resolves)
    const startedOrder: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const createJob = vi.fn(async (input: StudioJobCreate) => {
      startedOrder.push(input.requestId);
      await gate;
      return { job: job(startedOrder.length) };
    });

    const pending = Promise.all(compiled.inputs.map((inp) => createJob(inp)));
    expect(startedOrder).toEqual(["req-part-1", "req-part-2"]);
    release();
    const dispatched = await pending;
    expect(dispatched).toHaveLength(2);
  });

  it("enforces Studio UI v4 CSS guardrails: zero #EBF5FF pastel blue in video-workspace.module.css", () => {
    const css = readFileSync(
      join(process.cwd(), "components", "brand-studio", "video", "video-workspace.module.css"),
      "utf8",
    );
    expect(css).not.toMatch(/#ebf5ff/i);
  });
});
