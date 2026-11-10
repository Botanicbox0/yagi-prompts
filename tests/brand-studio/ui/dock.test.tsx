import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StudioJobCreateSchema } from "@/lib/brand-studio/contracts";
import { STUDIO_MODELS, selectableModels, type StudioImageModel, type StudioVideoModel } from "@/lib/brand-studio/models";
import { Dock, type DockProps } from "@/components/brand-studio/dock";
import {
  DRAFT_RESOLUTION,
  buildJob,
  dockControls,
  dockEstimateKrw,
  draftAfterAttach,
  draftFromJob,
  initialDraft,
  normalizeDraft,
  regionEstimateKrw,
  withMedium,
  withModel,
} from "@/components/brand-studio/dock-model";
import { trayItemFromAsset, trayLabels } from "@/components/brand-studio/refs";
import { fill } from "@/components/brand-studio/copy";
import { referenceVideoFit } from "@/lib/brand-studio/reference-video";
import { ORG, allowance, asset, copyFor, id, job } from "./fixtures";

/** docs/BRAND-STUDIO-V2.md §4–§5.2: every control comes from the model registry, nothing else. */
const awaiting = STUDIO_MODELS.filter((m) => m.availability !== "live");
const ids = { organizationId: ORG, requestId: "press-0001" };

function render(patch: Partial<DockProps> = {}, locale: "ko" | "en" = "ko") {
  const copy = copyFor(locale);
  const props: DockProps = {
    draft: initialDraft("image"),
    tray: [],
    labels: [],
    copy,
    locale,
    allowance: allowance(),
    quoteKrw: 142,
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
    ...patch,
  };
  return renderToStaticMarkup(<Dock {...props} />);
}
const options = (html: string, control: string) => {
  const block = html.match(new RegExp(`data-control="${control}"[\\s\\S]*?</select>`))?.[0] ?? "";
  return [...block.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
};

describe("dock controls from the registry", () => {
  it("offers exactly the live models per medium, never one awaiting its provider", () => {
    expect(awaiting.length).toBeGreaterThan(0);
    for (const medium of ["image", "video"] as const) {
      const offered = dockControls(initialDraft(medium)).models.map((m) => m.id);
      expect(offered).toEqual(selectableModels(medium).map((m) => m.id));
      for (const model of awaiting) expect(offered).not.toContain(model.id);
    }
    const html = render();
    for (const model of awaiting) expect(html).not.toContain(model.label);
    expect(withModel(initialDraft("image"), awaiting[0]!.id).model).not.toBe(awaiting[0]!.id);
  });

  it("changes the legal ratios and qualities when the model changes", () => {
    for (const model of selectableModels("image") as StudioImageModel[]) {
      const draft = withModel(initialDraft("image"), model.id);
      const html = render({ draft });
      expect(options(html, "model")).toEqual(selectableModels("image").map((m) => m.id));
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

  it("offers the draft, the registry's qualities, lengths and sound for video", () => {
    const draft = withMedium(initialDraft("image"), "video");
    const model = STUDIO_MODELS.find((m) => m.id === draft.model) as StudioVideoModel;
    const html = render({ draft });
    expect(options(html, "resolution")).toEqual([DRAFT_RESOLUTION, ...model.resolutions]);
    expect(html).toContain(copyFor("ko").dock.draft);
    expect(options(html, "seconds")).toEqual(Array.from({ length: model.maxSeconds - model.minSeconds + 1 }, (_, i) => String(model.minSeconds + i)));
    expect(options(html, "sound")).toEqual(["native", "ambient", "silent"]);
    expect(options(html, "aspect")).toEqual([...model.aspects]);
    expect(html).not.toContain('data-control="count"');
  });

  it("clamps what a model cannot do", () => {
    const video = normalizeDraft({ ...withMedium(initialDraft(), "video"), seconds: 99, resolution: "4K" });
    const model = STUDIO_MODELS.find((m) => m.id === video.model) as StudioVideoModel;
    expect(video.seconds).toBe(model.maxSeconds);
    expect(video.resolution).toBe(model.defaultResolution);
    expect(normalizeDraft({ ...initialDraft(), count: 9 }).count).toBe(4);
  });
});

describe("what the dock sends", () => {
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

  it("always shows this run's expected usage next to the one solid button", () => {
    const draft = { ...initialDraft(), prompt: "x" };
    expect(dockEstimateKrw(draft, [])).toBeGreaterThan(0);
    expect(dockEstimateKrw({ ...draft, count: 2 }, [])).toBeGreaterThan(dockEstimateKrw(draft, []));
    const html = render({ quoteKrw: 1_300 });
    expect(html).toContain("data-studio-quote");
    expect(html).toContain("약 ₩1,300");
    expect(html.indexOf("data-studio-quote")).toBeLessThan(html.indexOf("data-studio-submit"));
  });

  it("shows the month's usage the server returned as a hairline and one line, never a provider price", () => {
    const html = render({}, "en");
    expect(html).toContain("This month ₩12,400 / ₩300,000");
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuenow="12400"');
    expect(html).toMatch(/data-studio-allowance[^>]*title="Refills on Dec 1"|title="Refills on Dec 1"[^>]*data-studio-allowance/);
    expect(html).not.toMatch(/\$|USD/);
    expect(html.match(/data-variant="solid"/g)).toHaveLength(1);
  });

  it("puts the model's strength in its menu, not on a line of its own", () => {
    const copy = copyFor("ko");
    const html = render();
    expect(html).toContain(`Seedream 5.0 Pro · ${copy.models.seedreamPro}`);
    expect(html).not.toContain("bs-model-hint");
  });

  it("turns a picture run into a video run when a video comes in, keeping what was typed", () => {
    const typed = { ...initialDraft("image"), prompt: "병이 천천히 돈다", enhance: false };
    const film = trayItemFromAsset(asset(2, { kind: "video", seconds: 6 }));
    const switched = draftAfterAttach(typed, film);
    expect(switched).toMatchObject({ medium: "video", prompt: "병이 천천히 돈다", enhance: false });
    expect(draftAfterAttach(typed, trayItemFromAsset(asset(1)))).toBe(typed);
    const video = withMedium(typed, "video");
    expect(draftAfterAttach(video, film)).toBe(video);
    const html = render({ draft: switched, tray: [film], labels: ["영상 1"], notice: copyFor("ko").dock.switchedToVideo });
    expect(html).toContain("data-studio-dock-notice");
  });

  it("brings a reference-video run back with its method, keep, change and sound", () => {
    const remix = job(5, { kind: "video_remix", model: "seedance-2.5", aspect: null, resolution: "draft", audio: "ambient", method: "edit", keep: ["camera", "look"], change: "병만 파랗게" });
    const back = draftFromJob(remix, initialDraft("image"));
    expect(back).toMatchObject({ medium: "video", method: "edit", keep: ["camera", "look"], change: "병만 파랗게", audio: "ambient", resolution: DRAFT_RESOLUTION });
  });

  it("prices a partial edit as one edit call on the edit model", () => {
    expect(regionEstimateKrw(initialDraft("image"))).toBe(regionEstimateKrw(withModel(initialDraft("image"), "nano-banana-pro")));
    expect(regionEstimateKrw(initialDraft("image"))).toBeGreaterThan(0);
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
    const shortHtml = render({ draft: { ...draft, method: "reference" }, tray: [short], labels: ["영상 1"] });
    expect(shortHtml).toContain(fill(copy.remix.limitEdit, { n: editMin, method: copy.remix.methods.reference }).replace(/'/g, "&#x27;"));
    expect(shortHtml).toMatch(/<input type="radio" disabled="" name="[^"]*" value="edit"\/>/);
    expect(shortHtml).not.toMatch(/data-studio-submit[^>]*disabled|disabled=""[^>]*data-studio-submit/);

    const tiny = trayItemFromAsset(asset(3, { kind: "video", seconds: 6, width: 400, height: 600 }));
    expect(buildJob(draft, [tiny], ids)).toMatchObject({ ok: false, problem: { kind: "film_unusable", problem: "small" } });
    const tinyHtml = render({ draft, tray: [tiny], labels: ["영상 1"] });
    expect(tinyHtml).toContain(copy.remix.limitSmall);
    expect(tinyHtml).toMatch(/disabled=""[^>]*data-studio-submit/);
    const long = trayItemFromAsset(asset(4, { kind: "video", seconds: max + 5, width: 720, height: 1280 }));
    expect(render({ draft, tray: [long], labels: ["영상 1"] })).toContain(fill(copy.remix.limitLength, { min, max }));
    // Unmeasured: never blocks.
    const unknown = trayItemFromAsset(asset(5, { kind: "video", seconds: null, width: null, height: null }));
    expect(buildJob({ ...draft, method: "edit" }, [unknown], ids).ok).toBe(true);
  });

  it("labels the tray chips in order and keeps them in the dock", () => {
    const items = [trayItemFromAsset(asset(1)), trayItemFromAsset(asset(2, { kind: "video" })), trayItemFromAsset(asset(3))];
    const copy = copyFor("ko");
    const html = render({ tray: items, labels: trayLabels(items, copy), draft: withMedium(initialDraft(), "video") });
    expect(html.indexOf("이미지 1")).toBeLessThan(html.indexOf("영상 1"));
    expect(html.indexOf("영상 1")).toBeLessThan(html.indexOf("이미지 2"));
    expect(html).toContain("data-studio-remix");
    expect(html).toContain("data-studio-draft-note");
    expect(id(1)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
