import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StudioJobCreateSchema } from "@/lib/brand-studio/contracts";
import { STUDIO_MODELS, selectableModels, type StudioImageModel, type StudioVideoModel } from "@/lib/brand-studio/models";
import { Dock, type DockProps } from "@/components/brand-studio/dock";
import {
  DRAFT_RESOLUTION,
  buildJob,
  dockControls,
  initialDraft,
  knownEstimate,
  normalizeDraft,
  withMedium,
  withModel,
} from "@/components/brand-studio/dock-model";
import { trayItemFromAsset, trayLabels } from "@/components/brand-studio/refs";
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
    quoteKrw: null,
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

  it("shows the expected usage only when the server priced the same settings before", () => {
    const draft = { ...initialDraft(), prompt: "x" };
    expect(knownEstimate([], draft, [])).toBeNull();
    const priced = job(1, { model: draft.model, resolution: draft.resolution, expected: 1, estimateKrw: 1_300 });
    expect(knownEstimate([priced], draft, [])).toBe(1_300);
    expect(knownEstimate([priced], { ...draft, count: 2 }, [])).toBeNull();
    const html = render({ quoteKrw: 1_300 });
    expect(html).toContain("data-studio-quote");
    expect(html).toContain("₩1,300");
    expect(render()).not.toContain("data-studio-quote");
  });

  it("shows the month's usage the server returned, never a provider price", () => {
    const html = render({}, "en");
    expect(html).toContain("₩12,400 of ₩300,000");
    expect(html).toContain('aria-valuenow="12400"');
    expect(html).not.toMatch(/\$|USD/);
    expect(html.match(/data-variant="solid"/g)).toHaveLength(1);
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
