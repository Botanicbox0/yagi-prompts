import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PromptPreviewSchema, StudioJobCreateSchema } from "@/lib/brand-studio/contracts";
import { STUDIO_MODELS, selectableModels, type StudioImageModel, type StudioVideoModel } from "@/lib/brand-studio/models";
import { AllowanceLine, Dock, type DockProps } from "@/components/brand-studio/dock";
import {
  DRAFT_RESOLUTION,
  attachRefusal,
  buildJob,
  dockControls,
  dockCredits,
  dockProblem,
  dockEstimateKrw,
  draftAfterAttach,
  draftFromJob,
  enhancePreviewInput,
  imageCreditsFor,
  initialDraft,
  normalizeDraft,
  regionEstimateKrw,
  remixBlocking,
  rerunInput,
  withMedium,
  withModel,
} from "@/components/brand-studio/dock-model";
import { ownWordsOf } from "@/components/brand-studio/use-dock";
import { aspectBox } from "@/components/brand-studio/gallery/chip-select";
import { trayItemFromAsset, trayLabels } from "@/components/brand-studio/refs";
import { fill } from "@/components/brand-studio/copy";
import { referenceVideoFit } from "@/lib/brand-studio/reference-video";
import { ORG, allowance, asset, copyFor, id, job } from "./fixtures";

/** docs/BRAND-STUDIO-V3.md §4 (V2 §4–§5.2): every control comes from the model registry, amounts are credits. */
const awaiting = STUDIO_MODELS.filter((m) => m.availability !== "live");
const ids = { organizationId: ORG, requestId: "press-0001" };

function render(patch: Partial<DockProps> = {}, locale: "ko" | "en" = "ko") {
  const copy = copyFor(locale);
  const props: DockProps = {
    mode: "image",
    draft: initialDraft("image"),
    tray: [],
    labels: [],
    copy,
    locale,
    allowance: allowance(),
    credits: 15,
    busy: false,
    message: null,
    film: null,
    uploading: [],
    onDraft: () => {},
    onTrayUpdate: () => {},
    onTrayRemove: () => {},
    onSubmit: () => {},
    onDropSource: () => {},
    onFiles: () => {},
    onBrowse: () => {},
    onEnhance: () => {},
    onUndoEnhance: () => {},
    ...patch,
  };
  return renderToStaticMarkup(<Dock {...props} />);
}
/** The values a chip offers: the bar rendered with that chip's list open (a closed chip renders no list). */
const options = (patch: Partial<DockProps>, control: string) => {
  const html = render({ ...patch, initialOpenControl: control });
  const block = html.match(new RegExp(`data-studio-pick-list="${control}"[\\s\\S]*?</div></div>`))?.[0] ?? "";
  return [...block.matchAll(/role="option"[^>]*data-value="([^"]*)"/g)].map((m) => m[1]);
};
const modelOptions = (html: string) => [...html.matchAll(/role="option"[^>]*data-model="([^"]+)"/g)].map((m) => m[1]);

describe("prompt bar controls from the registry", () => {
  it("offers exactly the live models per medium, never one awaiting its provider", () => {
    for (const medium of ["image", "video"] as const) {
      const offered = dockControls(initialDraft(medium)).models.map((m) => m.id);
      const liveIds = selectableModels(medium).map((m) => m.id);
      expect(offered).toEqual(liveIds);
      expect(offered.length).toBeGreaterThan(0);
      for (const m of dockControls(initialDraft(medium)).models) {
        expect(m.availability).toBe("live");
      }
      for (const model of awaiting) expect(offered).not.toContain(model.id);
    }
    const html = render({ initialModelMenu: true });
    expect(modelOptions(html)).toEqual(selectableModels("image").map((m) => m.id));
    for (const model of awaiting) expect(html).not.toContain(model.label);
    if (awaiting.length > 0) {
      expect(withModel(initialDraft("image"), awaiting[0]!.id).model).not.toBe(awaiting[0]!.id);
    }
    expect(withModel(initialDraft("image"), "seedream-5-pro").model).not.toBe("seedream-5-pro");
  });

  it("changes the legal ratios and qualities when the model changes", () => {
    for (const model of selectableModels("image") as StudioImageModel[]) {
      const draft = withModel(initialDraft("image"), model.id);
      const html = render({ draft });
      expect(html).toContain(`>${model.label}<`);
      expect(options({ draft }, "aspect")).toEqual([...model.aspects]);
      expect(options({ draft }, "resolution")).toEqual([...model.resolutions]);
      expect(options({ draft }, "count")).toEqual(["1", "2", "3", "4"]);
    }
    const nano = { ...withModel(initialDraft("image"), "nano-banana-pro"), aspect: "4:5", resolution: "4K" };
    const seedream = withModel(nano, "seedream-5.5");
    expect(seedream.aspect).not.toBe("4:5");
    expect((STUDIO_MODELS.find((m) => m.id === "seedream-5.5") as StudioImageModel).aspects).toContain(seedream.aspect);
    expect(seedream.resolution).toBe("2K");
  });

  it("lists each model with what it is good at and its credits per image at the bar's settings", () => {
    const copy = copyFor("ko");
    const draft = initialDraft("image");
    const html = render({ initialModelMenu: true, draft });
    expect(html).toContain('role="listbox"');
    for (const model of selectableModels("image") as StudioImageModel[]) {
      const perImage = imageCreditsFor(model, draft, 0);
      expect(perImage).toBeGreaterThan(0);
      expect(html).toContain(copy.models[model.hintKey as keyof typeof copy.models]);
      expect(html).toContain(fill(copy.dock.perImage, { n: perImage }));
    }
    expect(html).toMatch(/aria-selected="true"[^>]*data-model="seedream-5.5"/);
  });

  it("has no medium switch: the image screen never shows video controls", () => {
    const html = render();
    expect(html).not.toContain('data-studio-mode');
    expect(html).not.toContain('data-control="seconds"');
    expect(html).not.toContain('data-control="sound"');
    expect(html).toContain(copyFor("ko").dock.placeholder);
    expect(attachRefusal("image", { kind: "video" })).toBe(true);
    expect(attachRefusal("video", { kind: "video" })).toBe(false);
    const film = trayItemFromAsset(asset(2, { kind: "video" }));
    const typed = { ...initialDraft("image"), prompt: "병이 돈다" };
    expect(draftAfterAttach(typed, film, true)).toBe(typed);
  });

  it("offers the draft, the registry's qualities, lengths and sound on the video screen", () => {
    const draft = withMedium(initialDraft("image"), "video");
    const model = STUDIO_MODELS.find((m) => m.id === draft.model) as StudioVideoModel;
    const html = render({ draft, mode: "video" });
    expect(options({ draft, mode: "video" }, "resolution")).toEqual([DRAFT_RESOLUTION, ...model.resolutions]);
    expect(html).toContain(copyFor("ko").dock.draft);
    expect(options({ draft, mode: "video" }, "seconds")).toEqual(Array.from({ length: model.maxSeconds - model.minSeconds + 1 }, (_, i) => String(model.minSeconds + i)));
    expect(options({ draft, mode: "video" }, "sound")).toEqual(["native", "ambient", "silent"]);
    expect(options({ draft, mode: "video" }, "aspect")).toEqual([...model.aspects]);
    expect(html).not.toContain('data-control="count"');
    expect(html).toContain(copyFor("ko").dock.placeholderVideo);
  });

  it("clamps what a model cannot do", () => {
    const video = normalizeDraft({ ...withMedium(initialDraft(), "video"), seconds: 99, resolution: "4K" });
    const model = STUDIO_MODELS.find((m) => m.id === video.model) as StudioVideoModel;
    expect(video.seconds).toBe(model.maxSeconds);
    expect(video.resolution).toBe(model.supportsDraft ? "draft" : model.defaultResolution);
    expect(withMedium(initialDraft(), "video").resolution).toBe("draft");
    expect(normalizeDraft({ ...initialDraft(), count: 9 }).count).toBe(4);
  });
});

describe("quality (GPT Image only)", () => {
  const GPT = ["gpt-image-2.6-flare", "gpt-image-2.6-sunburst"];

  it("shows the quality chip only for models that have qualities, and sends it only for them", () => {
    for (const model of selectableModels("image") as StudioImageModel[]) {
      const draft = withModel({ ...initialDraft("image"), prompt: "x" }, model.id);
      const html = render({ draft });
      const built = buildJob(draft, [], ids);
      if (GPT.includes(model.id)) {
        expect(options({ draft }, "quality")).toEqual(["low", "medium", "high"]);
        expect(draft.quality).toBe("medium");
        expect(built.ok && built.input.kind === "image" && built.input.quality).toBe("medium");
        expect(built.ok && StudioJobCreateSchema.safeParse(built.input).success).toBe(true);
      } else {
        expect(html).not.toContain('data-control="quality"');
        expect(draft.quality).toBe("");
        expect(built.ok && built.input).not.toHaveProperty("quality");
      }
    }
    // Leaving a quality model drops the quality; coming back starts at its default.
    const high = { ...withModel(initialDraft("image"), GPT[0]!), quality: "high" };
    expect(withModel(high, "seedream-5.5").quality).toBe("");
    expect(withModel(withModel(high, "seedream-5.5"), GPT[1]!).quality).toBe("medium");
    expect(normalizeDraft({ ...high, quality: "ultra" }).quality).toBe("medium");
  });

  it("moves the credits with quality and resolution, and lists the two models' real difference", () => {
    const copy = copyFor("ko");
    const base = { ...withModel(initialDraft("image"), GPT[0]!), prompt: "x", resolution: "1K" };
    const low = dockCredits({ ...base, quality: "low" }, []);
    const high = dockCredits({ ...base, quality: "high" }, []);
    const high4k = dockCredits({ ...base, quality: "high", resolution: "4K" }, []);
    expect(low).toBeLessThan(high);
    expect(high).toBeLessThan(high4k);
    const flare = STUDIO_MODELS.find((m) => m.id === GPT[0]) as StudioImageModel;
    const sunburst = STUDIO_MODELS.find((m) => m.id === GPT[1]) as StudioImageModel;
    expect(imageCreditsFor(flare, { resolution: "2K", quality: "high" }, 0)).toBe(imageCreditsFor(sunburst, { resolution: "2K", quality: "high" }, 0));
    const menu = render({ draft: base, initialModelMenu: true });
    expect(menu).toContain(copy.models.gptImageFlare);
    expect(menu).toContain(copy.models.gptImageSunburst);
    expect(copy.models.gptImageSunburst).toMatch(/느/);
  });

  it("brings the quality back with 설정 다시 쓰기 and 다시 만들기", () => {
    const run = job(7, { model: GPT[1]!, aspect: "3:2", resolution: "2K", quality: "low" });
    expect(draftFromJob(run, initialDraft("image"))).toMatchObject({ model: GPT[1], aspect: "3:2", resolution: "2K", quality: "low" });
    expect(rerunInput(run, ids)).toMatchObject({ kind: "image", quality: "low" });
    expect(rerunInput(job(8), ids)).not.toHaveProperty("quality");
  });
});

describe("blueprint runs", () => {
  it("never stop for the clip's pixel size (the video is only read), only for its length", () => {
    const seedance = STUDIO_MODELS.find((m) => m.id === "seedance-2.5") as StudioVideoModel;
    const draft = { ...withMedium(initialDraft(), "video"), change: "병만 파랗게", method: "blueprint" as const };
    const tiny = trayItemFromAsset(asset(3, { kind: "video", seconds: 6, width: 400, height: 600 }));
    expect(remixBlocking(draft, referenceVideoFit(seedance, { seconds: 6, width: 400, height: 600 }))).toBeNull();
    expect(remixBlocking({ method: "reference" }, referenceVideoFit(seedance, { seconds: 6, width: 400, height: 600 }))).toBe("small");
    expect(remixBlocking(draft, referenceVideoFit(seedance, { seconds: 99, width: 720, height: 1280 }))).toBe("length");
    expect(dockProblem(draft, [tiny])).toBeNull();
    const html = render({ mode: "video", draft, tray: [tiny], labels: ["영상 1"] });
    expect(html).not.toMatch(/disabled=""[^>]*data-studio-submit/);
  });
});

describe("silent director, @ highlight and collapsed pill mode", () => {
  it("shows the rewrite switch (on by default) and the rewrite-now button with the bar's own wording", () => {
    const d = copyFor("ko").dock;
    expect(initialDraft("image").enhance).toBe(true);
    expect(initialDraft("video").enhance).toBe(true);
    const html = render({ draft: { ...initialDraft(), prompt: "병" } });
    expect(html).toMatch(/role="switch"[^>]*aria-checked="true"[^>]*data-studio-enhance(?!-)/);
    expect(html).toContain(`<span>${d.enhance}</span>`);
    expect(html).toMatch(new RegExp(`data-studio-enhance-now[^>]*>[\\s\\S]*?<span>${d.enhanceNow}</span>`));
    expect(html).not.toContain("data-studio-undo-enhance");
    expect(html).toContain("data-prompt-highlight");
    // Off: the switch says so; nothing to rewrite: the button is there but cannot be pressed.
    expect(render({ draft: { ...initialDraft(), prompt: "병", enhance: false } })).toMatch(/role="switch"[^>]*aria-checked="false"/);
    expect(render()).toMatch(/data-studio-enhance-now[^>]*disabled=""|disabled=""[^>]*data-studio-enhance-now/);
    // A rewritten sentence in the field: one press back to the customer's words, in place of the rewrite button.
    const rewritten = render({ draft: { ...initialDraft(), prompt: "A clear glass bottle" }, enhanced: true });
    expect(rewritten).toMatch(new RegExp(`data-studio-undo-enhance[^>]*>[\\s\\S]*?<span>${d.undoEnhance}</span>`));
    expect(rewritten).not.toContain("data-studio-enhance-now");
    expect(rewritten).toContain("data-enhanced");
    // Without a handler there is no dead button (a screen that cannot rewrite shows the switch only).
    expect(render({ onEnhance: undefined, draft: { ...initialDraft(), prompt: "병" } })).not.toContain("data-studio-enhance-now");
  });

  it("never renders a native select: every setting chip opens its own listbox", () => {
    for (const mode of ["image", "video"] as const) {
      const draft = withMedium(initialDraft("image"), mode);
      const closed = render({ draft, mode });
      expect(closed).not.toContain("<select");
      expect(closed).not.toContain("data-studio-pick-list");
      for (const control of mode === "image" ? ["aspect", "resolution", "count"] : ["aspect", "resolution", "seconds", "sound"]) {
        expect(closed).toMatch(new RegExp(`data-control="${control}"[^>]*>\\s*<button[^>]*aria-haspopup="listbox"[^>]*aria-expanded="false"`));
        const open = render({ draft, mode, initialOpenControl: control });
        expect(open).toMatch(new RegExp(`data-studio-pick-list="${control}"[^>]*><div[^>]*role="listbox"`));
        expect(open.match(/data-studio-pick-list=/g)).toHaveLength(1);
        // The current value is the selected option.
        const value = control === "count" ? String(draft.count) : control === "seconds" ? String(draft.seconds) : control === "sound" ? draft.audio : (draft[control as "aspect" | "resolution"] as string);
        expect(open).toMatch(new RegExp(`role="option" aria-selected="true" data-value="${value}"`));
      }
    }
  });

  it("draws each ratio as a small shape on the chip and in its list", () => {
    const draft = withModel(initialDraft("image"), "nano-banana-pro");
    const html = render({ draft, initialOpenControl: "aspect" });
    for (const ratio of ["1:1", "4:3", "3:4", "4:5", "9:16", "16:9", "21:9"]) expect(html).toContain(`data-shape="${ratio}"`);
    expect(aspectBox("1:1")).toEqual({ width: 16, height: 16 });
    expect(aspectBox("16:9")).toEqual({ width: 16, height: 9 });
    expect(aspectBox("9:16")).toEqual({ width: 9, height: 16 });
    expect(aspectBox("21:9").height).toBeLessThan(aspectBox("16:9").height);
    expect(aspectBox("4:5").width).toBeGreaterThan(aspectBox("3:4").width);
    expect(aspectBox("nonsense")).toEqual({ width: 16, height: 16 });
  });

  it("lists the image models as Seedream 5.5, GPT Image 2.6 Flare and Sunburst, Nano Banana Pro and 2.1, without Seedream 5.0 Flash", () => {
    const order = ["seedream-5.5", "gpt-image-2.6-flare", "gpt-image-2.6-sunburst", "nano-banana-pro", "nano-banana-2.1"];
    expect(selectableModels("image").map((m) => m.id)).toEqual(order);
    expect(modelOptions(render({ initialModelMenu: true }))).toEqual(order);
    // Still a live model: an earlier Flash run can be made again and its history reads as before.
    const flash = STUDIO_MODELS.find((m) => m.id === "seedream-5-flash")!;
    expect(flash.availability).toBe("live");
    const old = job(1, { model: "seedream-5-flash", prompt: "병", aspect: "1:1", resolution: "2K" });
    const again = rerunInput(old, ids);
    expect(again).toMatchObject({ kind: "image", model: "seedream-5-flash" });
    expect(StudioJobCreateSchema.safeParse(again).success).toBe(true);
    // "설정 다시 쓰기" brings its settings back on a model the bar offers.
    expect(order).toContain(draftFromJob(old, initialDraft("image")).model);
  });

  it("highlights bound @ mentions in the backdrop, lights up Tray data-mentioned, and marks unbound @ mentions false", () => {
    const pic = trayItemFromAsset(asset(1, { role: "product" }));
    const copy = copyFor("ko");
    const html = render({
      tray: [pic],
      labels: trayLabels([pic], copy),
      draft: { ...initialDraft(), prompt: "@image1 옆에 @image9 놓기\n" },
    });
    expect(html).toContain('<mark class="bs-mention-mark" data-mention-bound="true">@image1</mark>');
    expect(html).toContain('<mark class="bs-mention-mark" data-mention-bound="false">@image9</mark>');
    expect(html).toMatch(/class="bs-tray-item"[^>]*data-mentioned=""/);
    expect(html).toMatch(/class="bs-thumb" data-mentioned=""/);
  });

  it("renders a 1-line floating pill in collapsed mode with + icon, label, tray count and credits", () => {
    const pic = trayItemFromAsset(asset(1));
    const copy = copyFor("ko");
    const html = render({
      mode: "video",
      collapsed: true,
      collapsedLabel: "프롬프트 열기",
      tray: [pic],
      labels: trayLabels([pic], copy),
      draft: withMedium(initialDraft(), "video"),
    });
    expect(html).toContain('class="bs-dock bs-dock-collapsed"');
    expect(html).toContain("data-studio-dock");
    expect(html).toContain('data-collapsed=""');
    expect(html).toContain("프롬프트 열기");
    expect(html).toContain('data-collapsed-tray-count="1"');
    expect(html).toContain("참조 1");
    expect(html).toContain("남은 크레딧 28,760");
    expect(html).not.toContain('data-variant="solid"');
  });

  it("asks prompt.enhance with the run the bar would send, and sends an improved sentence as it is", () => {
    const draft = { ...initialDraft(), prompt: "흰 대리석 위 병", enhance: true };
    const pic = trayItemFromAsset(asset(1, { role: "product" }));
    const preview = enhancePreviewInput(draft, [pic], ORG);
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(PromptPreviewSchema.safeParse(preview.input).success).toBe(true);
      expect(preview.input).not.toHaveProperty("requestId");
      expect(preview.input).toMatchObject({ kind: "image", enhance: true, references: [{ assetId: asset(1).id, role: "product" }] });
    }
    expect(enhancePreviewInput(initialDraft(), [], ORG)).toEqual({ ok: false, problem: { kind: "empty_prompt" } });
    expect(buildJob(draft, [pic], ids).ok && (buildJob(draft, [pic], ids) as { input: { enhance: boolean } }).input.enhance).toBe(true);
  });

  it("keeps the customer's words when a rewritten sentence is sent: prompt stays theirs, the sentence goes as reviewedPrompt", () => {
    const own = "흰 대리석 위 병";
    const enhanced = { original: own, improved: "A clear glass bottle on white marble" };
    const pic = trayItemFromAsset(asset(1, { role: "product" }));
    // The sentence as written, and after the customer edits it: both keep the original and are never rewritten again.
    for (const shown of [enhanced.improved, `${enhanced.improved}, morning light`]) {
      expect(ownWordsOf(enhanced, shown)).toBe(own);
      const built = buildJob({ ...initialDraft(), prompt: shown }, [pic], ids, { ownWords: ownWordsOf(enhanced, shown) });
      expect(built.ok && built.input).toMatchObject({ kind: "image", prompt: own, reviewedPrompt: shown, enhance: false });
      expect(built.ok && StudioJobCreateSchema.safeParse(built.input).success).toBe(true);
    }
    const film = buildJob({ ...withMedium(initialDraft(), "video"), prompt: enhanced.improved }, [], ids, { ownWords: own });
    expect(film.ok && film.input).toMatchObject({ kind: "video", prompt: own, reviewedPrompt: enhanced.improved, enhance: false });
    // Nothing rewritten, typed back to the original, or emptied: an ordinary run.
    expect(ownWordsOf(null, enhanced.improved)).toBeNull();
    expect(ownWordsOf(enhanced, ` ${own} `)).toBeNull();
    expect(ownWordsOf(enhanced, "  ")).toBeNull();
    const plain = buildJob({ ...initialDraft(), prompt: own }, [pic], ids, { ownWords: null });
    expect(plain.ok && plain.input).not.toHaveProperty("reviewedPrompt");
    // The switch off sends the customer's words as they are.
    const off = buildJob({ ...initialDraft(), prompt: own, enhance: false }, [pic], ids);
    expect(off.ok && off.input).toMatchObject({ prompt: own, enhance: false });
    expect(off.ok && off.input).not.toHaveProperty("reviewedPrompt");
    // A reference-video run always writes its own sentence: no reviewedPrompt, enhancement on.
    const clip = trayItemFromAsset(asset(2, { kind: "video", seconds: 8, width: 1280, height: 720 }));
    const remix = buildJob({ ...withMedium(initialDraft(), "video"), prompt: enhanced.improved, change: "병을 바꿔요", enhance: false }, [clip], ids, { ownWords: own });
    expect(remix.ok && remix.input).toMatchObject({ kind: "video_remix", prompt: enhanced.improved, enhance: true });
    expect(remix.ok && remix.input).not.toHaveProperty("reviewedPrompt");
    // The switch is not offered while a reference video is attached.
    expect(render({ mode: "video", draft: { ...withMedium(initialDraft(), "video"), prompt: "x" }, tray: [clip], labels: ["영상 1"] })).not.toContain("data-studio-enhance-group");
  });

  it("makes a reviewed run again with the same sentence, and brings both back with 다시 만들기", () => {
    const reviewed = job(1, { prompt: "흰 대리석 위 병", finalPrompt: "A clear glass bottle on white marble", reviewed: true, aspect: "1:1", resolution: "2K" });
    expect(rerunInput(reviewed, ids)).toMatchObject({ prompt: "흰 대리석 위 병", reviewedPrompt: "A clear glass bottle on white marble", enhance: false });
    const auto = job(2, { prompt: "흰 대리석 위 병", finalPrompt: "A clear glass bottle on white marble", aspect: "1:1", resolution: "2K" });
    expect(rerunInput(auto, ids)).toMatchObject({ prompt: "흰 대리석 위 병", enhance: true });
    expect(rerunInput(auto, ids)).not.toHaveProperty("reviewedPrompt");
  });
});

describe("what the bar sends and what it costs", () => {
  it("builds contract-valid image, video and reference-video runs", () => {
    const pic = trayItemFromAsset(asset(1, { role: "product" }));
    const film = trayItemFromAsset(asset(2, { kind: "video", seconds: 6, thumbUrl: null }));
    const image = buildJob({ ...initialDraft(), prompt: "흰 대리석 위의 병" }, [pic], ids);
    const video = buildJob({ ...withMedium(initialDraft(), "video"), prompt: "다가가는 5초" }, [{ ...pic, frame: "start" }], ids);
    const remix = buildJob({ ...withMedium(initialDraft(), "video"), resolution: DRAFT_RESOLUTION, change: "병을 이미지 1로" }, [film, pic], ids);
    for (const built of [image, video, remix]) {
      expect(built.ok).toBe(true);
      if (built.ok) expect(StudioJobCreateSchema.safeParse(built.input).success).toBe(true);
    }
    expect(image.ok && image.input.kind).toBe("image");
    expect(video.ok && video.input.kind === "video" && video.input.references[0]?.frame).toBe("start");
    expect(remix.ok && remix.input.kind === "video_remix" && remix.input.resolution).toBe("draft");
  });

  it("stops an empty run, a picture-only run carrying a video, and a remix with nothing to change", () => {
    const film = trayItemFromAsset(asset(2, { kind: "video" }));
    expect(buildJob(initialDraft(), [], ids)).toEqual({ ok: false, problem: { kind: "empty_prompt" } });
    expect(buildJob({ ...initialDraft(), prompt: "x" }, [film], ids)).toEqual({ ok: false, problem: { kind: "image_only" } });
    expect(buildJob(withMedium(initialDraft(), "video"), [film], ids)).toEqual({ ok: false, problem: { kind: "need_change" } });
  });

  it("puts this run's credits on the one solid button, never money", () => {
    const draft = { ...initialDraft(), prompt: "x" };
    expect(dockCredits(draft, [])).toBeGreaterThan(0);
    expect(dockCredits({ ...draft, count: 2 }, [])).toBeGreaterThan(dockCredits(draft, []));
    expect(dockCredits(draft, [])).toBe(Math.ceil(dockEstimateKrw(draft, []) / 10));
    const html = render({ credits: 1_300 });
    expect(html).toMatch(/data-studio-submit[^>]*>[\s\S]*?만들기[\s\S]*?data-studio-quote[^>]*>1,300 크레딧</);
    expect(html).toContain('aria-label="만들기, 1,300 크레딧 사용"');
    expect(html).not.toMatch(/₩|KRW|\d\s*원/);
    expect(html.match(/data-variant="solid"/g)).toHaveLength(1);
  });

  it("shows the credits left from the server's allowance in the header line, and no meter on the bar", () => {
    const html = render({}, "en");
    expect(html).not.toContain('role="meter"');
    expect(html).not.toMatch(/\$|USD|₩/);
    const line = renderToStaticMarkup(<AllowanceLine allowance={allowance()} copy={copyFor("ko")} locale="ko" />);
    expect(line).toContain("남은 크레딧 28,760");
    expect(line).toMatch(/title="12월 1일에 다시 채워져요"/);
  });

  it("brings a reference-video run back with its method, keep, change and sound", () => {
    const remix = job(5, { kind: "video_remix", model: "seedance-2.5", aspect: null, resolution: "draft", audio: "ambient", method: "edit", keep: ["camera", "look"], change: "병만 파랗게" });
    const back = draftFromJob(remix, initialDraft("image"));
    expect(back).toMatchObject({ medium: "video", method: "edit", keep: ["camera", "look"], change: "병만 파랗게", audio: "ambient", resolution: DRAFT_RESOLUTION });
  });

  it("prices a partial edit as one edit call on the edit model", () => {
    expect(regionEstimateKrw(initialDraft("image"))).toBe(regionEstimateKrw(withModel(initialDraft("image"), "nano-banana-pro")));
    expect(regionEstimateKrw(initialDraft("image"))).toBeGreaterThan(0);
    expect(regionEstimateKrw(initialDraft("image"), 2)).toBeGreaterThanOrEqual(regionEstimateKrw(initialDraft("image")));
  });

  it("tells the customer, before they spend, when a reference video is outside the limits", () => {
    const seedance = STUDIO_MODELS.find((m) => m.id === "seedance-2.5") as StudioVideoModel;
    const { min, max, editMin } = seedance.referenceVideoSeconds;
    expect(referenceVideoFit(seedance, { seconds: min - 0.5, width: 720, height: 1280 }).problem).toBe("length");
    expect(referenceVideoFit(seedance, { seconds: max + 1, width: 720, height: 1280 }).problem).toBe("length");
    expect(referenceVideoFit(seedance, { seconds: 6, width: 400, height: 600 }).problem).toBe("small");
    expect(referenceVideoFit(seedance, { seconds: 6, width: 4096, height: 2160 }).problem).toBe("large");
    expect(referenceVideoFit(seedance, { seconds: editMin - 1, width: 720, height: 1280 })).toEqual({ problem: null, editable: false });
    expect(referenceVideoFit(seedance, { seconds: null, width: null, height: null })).toEqual({ problem: null, editable: true });

    const copy = copyFor("ko");
    const draft = { ...withMedium(initialDraft(), "video"), change: "병만 파랗게" };
    const short = trayItemFromAsset(asset(2, { kind: "video", seconds: editMin - 1, width: 720, height: 1280 }));
    expect(buildJob({ ...draft, method: "edit" }, [short], ids)).toEqual({ ok: false, problem: { kind: "film_edit_short", limits: seedance.referenceVideoSeconds } });
    expect(buildJob({ ...draft, method: "reference" }, [short], ids).ok).toBe(true);
    const shortHtml = render({ mode: "video", draft: { ...draft, method: "reference" }, tray: [short], labels: ["영상 1"] });
    expect(shortHtml).toContain(fill(copy.remix.limitEdit, { n: editMin, method: copy.remix.methods.reference }).replace(/'/g, "&#x27;"));
    expect(shortHtml).not.toMatch(/data-studio-submit[^>]*disabled|disabled=""[^>]*data-studio-submit/);

    const tiny = trayItemFromAsset(asset(3, { kind: "video", seconds: 6, width: 400, height: 600 }));
    expect(buildJob(draft, [tiny], ids)).toMatchObject({ ok: false, problem: { kind: "film_unusable", problem: "small" } });
    const tinyHtml = render({ mode: "video", draft, tray: [tiny], labels: ["영상 1"] });
    expect(tinyHtml).toContain(copy.remix.limitSmall);
    expect(tinyHtml).toMatch(/disabled=""[^>]*data-studio-submit/);
    const long = trayItemFromAsset(asset(4, { kind: "video", seconds: max + 5, width: 720, height: 1280 }));
    // >30s clips up to 600s auto-route to blueprint (never blocked by Seedance's 30s raw input cap).
    const longAutoHtml = render({ mode: "video", draft, tray: [long], labels: ["영상 1"] });
    expect(longAutoHtml).toContain("data-studio-over-limit-note");
    expect(longAutoHtml).not.toMatch(/disabled=""[^>]*data-studio-submit/);
    // Clips shorter than 2s (< min) or longer than 600s (> blueprint max) warn before spend.
    const tooShort = trayItemFromAsset(asset(7, { kind: "video", seconds: min - 0.5, width: 720, height: 1280 }));
    expect(render({ mode: "video", draft, tray: [tooShort], labels: ["영상 1"] })).toContain(
      fill(copy.remix.limitLength, { min, max }),
    );
    const overBlueprintMax = trayItemFromAsset(asset(6, { kind: "video", seconds: 605, width: 720, height: 1280 }));
    expect(render({ mode: "video", draft, tray: [overBlueprintMax], labels: ["영상 1"] })).toContain(
      fill(copy.remix.limitLength, { min, max: 600 }),
    );
    const unknown = trayItemFromAsset(asset(5, { kind: "video", seconds: null, width: null, height: null }));
    expect(buildJob({ ...draft, method: "edit" }, [unknown], ids).ok).toBe(true);
  });

  it("numbers the reference squares in order and keeps them in the bar", () => {
    const items = [trayItemFromAsset(asset(1)), trayItemFromAsset(asset(2, { kind: "video" })), trayItemFromAsset(asset(3))];
    const copy = copyFor("ko");
    const html = render({ mode: "video", tray: items, labels: trayLabels(items, copy), draft: withMedium(initialDraft(), "video") });
    expect(html.indexOf("이미지 1 설정")).toBeLessThan(html.indexOf("영상 1 설정"));
    expect(html.indexOf("영상 1 설정")).toBeLessThan(html.indexOf("이미지 2 설정"));
    expect(html).toContain("data-studio-remix");
    expect(html).toContain("data-studio-draft-note");
    expect(id(1)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
