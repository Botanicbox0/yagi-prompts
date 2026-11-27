import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Wall, type WallProps } from "@/components/brand-studio/gallery/wall";
import { compareEntries } from "@/components/brand-studio/gallery/model-compare";
import { SiblingSwitcher } from "@/components/brand-studio/viewer";
import { errorLine, loadFailedLine, runFailedLine } from "@/components/brand-studio/copy";
import { designedSentence, tabsAfterMove } from "@/components/brand-studio/use-dock";
import {
  refKeyOf,
  removeFromTray,
  renumberAfterMove,
  trayItemFromAsset,
  trayItemFromOutput,
  updateTrayItem,
  type TrayItem,
} from "@/components/brand-studio/refs";
import { listReferenceMentions, renumberReferenceMentions } from "@/lib/brand-studio/enhancer/mentions";
import type { StudioLibrary } from "@/components/brand-studio/seams";
import { studioLayersEn, studioLayersKo } from "@/messages/studio-layers";
import { asset, copyFor, job, output } from "./fixtures";

/** Defects shared by the image and the video studio (walk findings I-D1, I-D2, V-D6, V-D4, I-D11, V-D15). */

const library = (): StudioLibrary => ({
  ready: true,
  folders: [],
  liked: new Set<string>(),
  likedItems: [],
  folderItems: () => null,
  openFolder: () => {},
  toggleLike: async () => true,
  createFolder: async () => null,
  renameFolder: async () => true,
  deleteFolder: async () => true,
  addToFolder: async () => true,
  removeFromFolder: async () => true,
});
function wall(patch: Partial<WallProps> = {}) {
  const props: WallProps = {
    mode: "image",
    jobs: [],
    copy: copyFor("ko"),
    locale: "ko",
    canGenerate: true,
    canEdit: true,
    canStop: true,
    library: library(),
    now: new Date("2026-11-11T03:00:00Z"),
    parentOf: () => null,
    onAction: () => {},
    onRetry: () => {},
    onCancel: () => {},
    onNotice: () => {},
    ...patch,
  };
  return renderToStaticMarkup(<Wall {...props} />);
}

const item = (key: string, kind: TrayItem["kind"] = "image", patch: Partial<TrayItem> = {}): TrayItem => ({
  key,
  kind,
  name: key,
  url: `https://media.example/${key}`,
  thumbUrl: null,
  seconds: null,
  ...patch,
});

describe("I-D1: a design answer that is the server's fallback is not a design", () => {
  it("takes only a real design (model, or the director keeping a structured prompt) as the designed sentence", () => {
    expect(designedSentence({ ok: true, prompt: "  A clear bottle on marble  ", notes: "", source: "model" })).toBe("A clear bottle on marble");
    expect(designedSentence({ ok: true, prompt: "Visual style: …", notes: "", source: "passthrough" })).toBe("Visual style: …");
    expect(designedSentence({ ok: true, prompt: "하얀 대리석 위 향수병, 부드러운 아침 빛.", notes: "", source: "fallback" })).toBeNull();
    expect(designedSentence({ ok: true, prompt: "   ", notes: "", source: "model" })).toBeNull();
    expect(designedSentence({ ok: false, code: "failed" })).toBeNull();
    expect(designedSentence(null)).toBeNull();
  });
});

describe("I-D2: moving a reference keeps every typed mention on the picture it named", () => {
  const before = [item("a:1"), item("a:2"), item("a:3")];
  const after = [before[2]!, before[0]!, before[1]!]; // 3 → 1

  it("renumbers @imageN mentions after a move", () => {
    expect(renumberAfterMove("@image1 병을 @image2 로고 옆에 두고 @image3 인물이 들고 있게", before, after)).toBe(
      "@image2 병을 @image3 로고 옆에 두고 @image1 인물이 들고 있게",
    );
  });

  it("keeps each spelling the matcher reads: Korean words, ordinals, lists, bare @N", () => {
    expect(renumberAfterMove("이미지 1의 병, 사진 2, 세 번째 이미지", before, after)).toBe("이미지 2의 병, 사진 3, 첫 번째 이미지");
    expect(renumberAfterMove("첫째 그림과 the third image", before, after)).toBe("둘째 그림과 the first image");
    expect(renumberAfterMove("이미지 1, 3을 합쳐", before, after)).toBe("이미지 2, 1을 합쳐");
    expect(renumberAfterMove("@1 and @3", before, after)).toBe("@2 and @1");
    // A range that no longer runs in order is spelled out as a list, which the matcher reads the same way.
    const ranged = renumberAfterMove("이미지 1~3", before, after);
    expect(listReferenceMentions(ranged).map((m) => m.number).sort()).toEqual([1, 2, 3]);
  });

  it("numbers by kind: images among images, videos among videos", () => {
    const mixed = [item("a:1"), item("a:v", "video"), item("a:2")];
    const moved = [mixed[2]!, mixed[0]!, mixed[1]!];
    expect(renumberAfterMove("@image1 그리고 @image2, 영상 1", mixed, moved)).toBe("@image2 그리고 @image1, 영상 1");
  });

  it("leaves text without mentions, counts, and mentions of nothing as typed", () => {
    expect(renumberAfterMove("하얀 대리석 위 향수병", before, after)).toBe("하얀 대리석 위 향수병");
    expect(renumberAfterMove("이미지 2장, 영상 15초, @image7", before, after)).toBe("이미지 2장, 영상 15초, @image7");
    expect(renumberAfterMove("@image1", before, before)).toBe("@image1");
  });

  it("never rewrites a range number by number", () => {
    // Two pictures swapped: "1~2" still names both (never "2~1", which reads as image 2 alone).
    const two = [item("a:A"), item("a:B")];
    const swapped = renumberAfterMove("이미지 1~2", two, [two[1]!, two[0]!]);
    expect(listReferenceMentions(swapped).map((m) => m.number).sort()).toEqual([1, 2]);
    // B moved to the end of three: the range meant A and B, now images 1 and 3 (never "1~3", which takes C in).
    const three = [item("a:A"), item("a:B"), item("a:C")];
    const moved = renumberAfterMove("이미지 1~2", three, [three[0]!, three[2]!, three[1]!]);
    expect(moved).toBe("이미지 1, 3");
    expect(listReferenceMentions(moved).map((m) => m.number).sort()).toEqual([1, 3]);
    expect(renumberAfterMove("image 1-2 and @image3", three, [three[0]!, three[2]!, three[1]!])).toBe("image 1, 3 and @image2");
  });

  it("drops a design still running when the references move: its tab is failed with the renumbered words", () => {
    const before = [item("a:1"), item("a:2")];
    const after = [before[1]!, before[0]!];
    const renumber = (text: string) => renumberAfterMove(text, before, after);
    const tabs = {
      "seedream-5.5": { status: "designing" as const, text: "@image1 병" },
      "nano-banana-pro": { status: "ready" as const, text: "@image2 로고" },
    };
    const { tabs: next, dropped } = tabsAfterMove(tabs, renumber);
    expect(dropped).toEqual(["seedream-5.5"]);
    expect(next).toEqual({
      "seedream-5.5": { status: "failed", text: "@image2 병" },
      "nano-banana-pro": { status: "ready", text: "@image1 로고" },
    });
  });

  it("renumbers through the shared matcher's own rewrite", () => {
    expect(renumberReferenceMentions("@image1 @video1", (kind, n) => (kind === "image" ? n + 1 : null))).toBe("@image2 @video1");
  });
});

describe("V-D6: one opening and one closing picture across the tray", () => {
  it("clears 시작 장면 (or 마지막 장면) from every other reference, like one radio group", () => {
    const tray = [item("a:1", "image", { frame: "start" }), item("a:2"), item("a:3", "image", { frame: "end" })];
    const start = updateTrayItem(tray, "a:2", { frame: "start" });
    expect(start.map((i) => i.frame)).toEqual([undefined, "start", "end"]);
    const end = updateTrayItem(start, "a:1", { frame: "end" });
    expect(end.map((i) => i.frame)).toEqual(["end", "start", undefined]);
    // Start on one and end on another stays as chosen; clearing one touches no other.
    expect(updateTrayItem(end, "a:2", { frame: undefined }).map((i) => i.frame)).toEqual(["end", undefined, undefined]);
    expect(updateTrayItem(tray, "a:2", { use: "병만" }).map((i) => i.frame)).toEqual(["start", undefined, "end"]);
  });
});

describe("I-D8: a source this member deletes leaves the prompt bar", () => {
  it("names the tray chip of a deleted asset or result, the way ✕ removes it", () => {
    const pic = trayItemFromAsset(asset(1));
    const made = trayItemFromOutput(output(9), "결과");
    expect(refKeyOf({ assetId: asset(1).id })).toBe(pic.key);
    expect(refKeyOf({ outputId: output(9).id })).toBe(made.key);
    const tray = [pic, made, trayItemFromAsset(asset(2))];
    expect(removeFromTray(tray, refKeyOf({ assetId: asset(1).id })).map((i) => i.key)).toEqual([made.key, `a:${asset(2).id}`]);
    expect(removeFromTray(tray, refKeyOf({ outputId: output(9).id })).map((i) => i.key)).toEqual([pic.key, `a:${asset(2).id}`]);
  });

  it("listens to the explicit delete, never to the difference between two loads", () => {
    const dock = readFileSync(join(process.cwd(), "components", "brand-studio", "use-dock.ts"), "utf8");
    const studio = readFileSync(join(process.cwd(), "components", "brand-studio", "use-studio.ts"), "utf8");
    expect(dock).toContain("onSourceDeleted");
    expect(dock).not.toMatch(/loadedSources|withoutDeletedSources/);
    // Both deletes tell the listeners only after the server said yes.
    expect(studio.match(/notifyDeleted\(/g)?.length).toBe(2);
  });
});

describe("V-D4: the generic failure sentence names no medium; a failed run's card names its own", () => {
  const ko = copyFor("ko");
  const en = copyFor("en");
  it("says 처리하지 못했어요 for any operation", () => {
    expect(ko.errors.failed).toBe("처리하지 못했어요. 다시 시도해 주세요.");
    expect(errorLine(ko, "failed")).not.toContain("이미지");
    expect(errorLine(ko, "something_new")).toBe("처리하지 못했어요. 다시 시도해 주세요.");
  });

  it("says image or video by the run's kind, and keeps other codes' own sentences", () => {
    expect(ko.board.failedImage).toBe("이미지를 생성하지 못했어요. 다시 시도해 주세요.");
    expect(ko.board.failedVideo).toBe("영상을 생성하지 못했어요. 다시 시도해 주세요.");
    expect(en.board.failedImage).toBe("This image could not be made. Please try again.");
    expect(en.board.failedVideo).toBe("This video could not be made. Please try again.");
    for (const kind of ["video", "video_remix", "video_final", "video_revise"]) expect(runFailedLine(ko, kind, "failed")).toBe(ko.board.failedVideo);
    for (const kind of ["image", "region_edit"]) expect(runFailedLine(ko, kind, null)).toBe(ko.board.failedImage);
    expect(runFailedLine(ko, "video", "provider_unavailable")).toBe(ko.errors.provider_unavailable);
    expect(runFailedLine(ko, "video", "made_up_code")).toBe(ko.board.failedVideo);
  });

  it("shows it on a failed card and in model compare", () => {
    const video = wall({ mode: "video", jobs: [job(1, { kind: "video", status: "failed", errorCode: "failed", model: "seedance-2.5", aspect: "9:16", resolution: "1080p", seconds: 5 })] });
    expect(video).toContain("영상을 생성하지 못했어요");
    expect(video).not.toContain("이미지를 생성하지 못했어요");
    const image = wall({ jobs: [job(2, { status: "failed", errorCode: "failed" })] });
    expect(image).toContain("이미지를 생성하지 못했어요");
    const run = job(3, { status: "failed", errorCode: "failed" });
    const shown = job(4, { outputs: [output(4)] });
    expect(compareEntries(shown, shown.outputs[0]!, [shown, run], ko).find((e) => e.run.id === run.id)?.reason).toBe(ko.board.failedImage);
    // "같이 만든 결과" in the viewer says the same as the card.
    const switcher = renderToStaticMarkup(<SiblingSwitcher job={shown} output={shown.outputs[0]!} siblings={[shown, run]} copy={ko} onOpen={() => {}} />);
    expect(switcher).toContain(ko.board.failedImage);
  });

  it("says a blueprint whose reference could not be read was not made and cost nothing", () => {
    expect(runFailedLine(ko, "video_remix", "reference_unreadable")).toBe("참고 영상을 읽지 못해 만들지 못했어요. 크레딧은 차감되지 않았으니 다시 시도해 주세요.");
    expect(runFailedLine(en, "video_remix", "reference_unreadable")).toBe(en.errors.reference_unreadable);
    const card = wall({ mode: "video", jobs: [job(5, { kind: "video_remix", method: "blueprint", status: "failed", errorCode: "reference_unreadable", model: "seedance-2.5", aspect: "9:16", resolution: "480p", seconds: 6 })] });
    expect(card).toContain(ko.errors.reference_unreadable);
    expect(card).not.toContain(ko.board.failedVideo);
  });

  it("says the load failed in one sentence when there is no more to say", () => {
    expect(loadFailedLine(ko, "failed")).toBe(ko.state.loadFailed);
    expect(loadFailedLine(ko, "made_up_code")).toBe(ko.state.loadFailed);
    expect(loadFailedLine(ko, "forbidden")).toBe(`${ko.state.loadFailed} ${ko.errors.forbidden}`);
  });
});

describe("I-D11: region edit calls Prompt Architect by its name and verb", () => {
  it("uses the prompt bar's words, never 다듬기 / refine / rewrite", () => {
    const ko = copyFor("ko");
    const en = copyFor("en");
    expect(studioLayersKo.region.enhanceLabel).toBe(ko.dock.enhance);
    expect(studioLayersEn.region.enhanceLabel).toBe(en.dock.enhance);
    expect(studioLayersKo.region.enhanceTipLabel).toBe(ko.dock.enhanceInfo);
    expect(studioLayersEn.region.enhanceTipLabel).toBe(en.dock.enhanceInfo);
    expect(studioLayersKo.region.previewEnhance).toBe(ko.dock.enhanceNow);
    expect(studioLayersEn.region.previewEnhance).toBe(en.dock.enhanceNow);
    const words = [studioLayersKo.region, studioLayersEn.region].flatMap((r) => [r.enhanceLabel, r.enhanceTipLabel, r.previewEnhance, r.enhancing]);
    for (const word of words) expect(word).not.toMatch(/다듬|refin|rewrite/i);
  });
});

describe("V-D15: a finished 완성본 tile says so", () => {
  const ko = copyFor("ko");
  const video = (n: number, kind: "video" | "video_final", draft = false) =>
    job(n, {
      kind,
      model: "seedance-2.5",
      aspect: "9:16",
      resolution: "1080p",
      seconds: 5,
      outputs: [output(n, { jobId: job(n).id, kind: "video", width: 1080, height: 1920, seconds: 5, draft })],
    });
  it("labels a video_final result with the version card's 완성본, a plain 1080p run with nothing", () => {
    const final = wall({ mode: "video", jobs: [video(1, "video_final")] });
    expect(final).toContain(`<span class="bs-tile-badge">${ko.revise.stage.final}</span>`);
    const plain = wall({ mode: "video", jobs: [video(2, "video")] });
    expect(plain).not.toContain(ko.revise.stage.final);
    const draft = wall({ mode: "video", jobs: [video(3, "video", true)] });
    expect(draft).toContain(ko.board.draftBadge);
  });
});
