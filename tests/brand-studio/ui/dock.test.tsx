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
import { isPreEnhanced } from "@/components/brand-studio/use-dock";
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
const options = (html: string, control: string) => {
  const block = html.match(new RegExp(`data-control="${control}"[\\s\\S]*?</select>`))?.[0] ?? "";
  return [...block.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
};
const modelOptions = (html: string) => [...html.matchAll(/role="option"[^>]*data-model="([^"]+)"/g)].map((m) => m[1]);

describe("prompt bar controls from the registry", () => {
  it("offers exactly the live models per medium, never one awaiting its provider", () => {
    expect(awaiting.length).toBeGreaterThan(0);
    for (const medium of ["image", "video"] as const) {
      const offered = dockControls(initialDraft(medium)).models.map((m) => m.id);
      expect(offered).toEqual(selectableModels(medium).map((m) => m.id));
      for (const model of awaiting) expect(offered).not.toContain(model.id);
    }
    const html = render({ initialModelMenu: true });
    expect(modelOptions(html)).toEqual(selectableModels("image").map((m) => m.id));
    for (const model of awaiting) expect(html).not.toContain(model.label);
    expect(withModel(initialDraft("image"), awaiting[0]!.id).model).not.toBe(awaiting[0]!.id);
  });

  it("changes the legal ratios and qualities when the model changes", () => {
    for (const model of selectableModels("image") as StudioImageModel[]) {
      const draft = withModel(initialDraft("image"), model.id);
      const html = render({ draft });
      expect(html).toContain(`>${model.label}<`);
      expect(options(html, "aspect")).toEqual([...model.aspects]);
      expect(options(html, "resolution")).toEqual([...model.resolutions]);
      expect(options(html, "count")).toEqual(["1", "2", "3", "4"]);
    }
    const nano = { ...withModel(initialDraft("image"), "nano-banana-pro"), aspect: "4:5", resolution: "4K" };
    const seedream = withModel(nano, "seedream-5-pro");
    expect(seedream.aspect).not.toBe("4:5");
    expect((STUDIO_MODELS.find((m) => m.id === "seedream-5-pro") as StudioImageModel).aspects).toContain(seedream.aspect);
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
    expect(html).toMatch(/aria-selected="true"[^>]*data-model="seedream-5-pro"/);
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
    expect(options(html, "resolution")).toEqual([DRAFT_RESOLUTION, ...model.resolutions]);
    expect(html).toContain(copyFor("ko").dock.draft);
    expect(options(html, "seconds")).toEqual(Array.from({ length: model.maxSeconds - model.minSeconds + 1 }, (_, i) => String(model.minSeconds + i)));
    expect(options(html, "sound")).toEqual(["native", "ambient", "silent"]);
    expect(options(html, "aspect")).toEqual([...model.aspects]);
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
        expect(options(html, "quality")).toEqual(["low", "medium", "high"]);
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
    expect(withModel(high, "seedream-5-pro").quality).toBe("");
    expect(withModel(withModel(high, "seedream-5-pro"), GPT[1]!).quality).toBe("medium");
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

describe("prompt polishing", () => {
  it("explains auto-polish on the '!' in the founder's words, free, on hover and focus", () => {
    const copy = copyFor("ko");
    expect(copy.dock.enhanceTip).toBe("각 이미지 모델에 최적화 된 프롬프트가 생성됩니다.");
    const html = render();
    expect(html).toMatch(/<button type="button" class="bs-tip-btn" aria-label="[^"]+" aria-describedby="([^"]+)">/);
    const describedBy = /class="bs-tip-btn"[^>]*aria-describedby="([^"]+)"/.exec(html)![1];
    expect(html).toContain(`id="${describedBy}" role="tooltip"`);
    expect(html).toContain(copy.dock.enhanceTip);
    expect(html).toContain(copy.dock.enhanceTipFree);
    expect(html).toMatch(/role="switch"[^>]*aria-checked="true"/);
  });

  it("glows while waiting and offers the original sentence back once improved", () => {
    const copy = copyFor("ko");
    const waiting = render({ enhancing: true, draft: { ...initialDraft(), prompt: "병" } });
    expect(waiting).toMatch(/class="bs-prompt-wrap" data-enhancing=""/);
    expect(waiting).toMatch(/data-studio-submit[^>]*disabled|disabled=""[^>]*data-studio-submit/);
    const done = render({ enhanced: true, draft: { ...initialDraft(), prompt: "A clear glass bottle" } });
    expect(done).toContain("data-studio-undo-enhance");
    expect(done).toContain(copy.dock.undoEnhance);
    expect(render({ draft: initialDraft() })).toMatch(/data-studio-enhance-now[^>]*disabled=""|disabled=""[^>]*data-studio-enhance-now/);
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
    const improved = buildJob(draft, [pic], ids, { preEnhanced: true });
    expect(improved.ok && improved.input.kind === "image" && improved.input.enhance).toBe(false);
    expect(buildJob(draft, [pic], ids).ok && (buildJob(draft, [pic], ids) as { input: { enhance: boolean } }).input.enhance).toBe(true);
    const enhanced = { original: "흰 대리석 위 병", improved: "A clear glass bottle on white marble" };
    expect(isPreEnhanced(enhanced, enhanced.improved)).toBe(true);
    // Editing the improved sentence drops the state: it is enhanced again like any sentence.
    expect(isPreEnhanced(enhanced, `${enhanced.improved}, morning`)).toBe(false);
    expect(isPreEnhanced(null, enhanced.improved)).toBe(false);
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

  it("shows the credits left from the server's allowance, as a hairline and in the header line", () => {
    const html = render({}, "en");
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuenow="28760"');
    expect(html).toContain('aria-valuemax="30000"');
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
    expect(render({ mode: "video", draft, tray: [long], labels: ["영상 1"] })).toContain(fill(copy.remix.limitLength, { min, max }));
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
