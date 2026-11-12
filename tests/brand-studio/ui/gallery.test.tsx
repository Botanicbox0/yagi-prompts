import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudioState } from "@/lib/brand-studio/contracts";
import { StudioApp, imageScreenRefHref, parseFrom, recentPictures, videoScreenHref } from "@/components/brand-studio/studio-app";
import { Wall, tileMenuKeys, tileStyle, wallEntries, type WallProps } from "@/components/brand-studio/gallery/wall";
import { dayKey, dayLabel, groupByDay } from "@/components/brand-studio/gallery/days";
import { Dock } from "@/components/brand-studio/dock";
import { Viewer } from "@/components/brand-studio/viewer";
import { initialDraft, regionEditModels } from "@/components/brand-studio/dock-model";
import { jobsFor } from "@/components/brand-studio/board";
import { settledJobs } from "@/components/brand-studio/use-studio";
import { trayItemFromAsset } from "@/components/brand-studio/refs";
import type { StudioLibrary } from "@/components/brand-studio/seams";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { ORG, allowance, asset, copyFor, id, job, output, studioState } from "./fixtures";

/** docs/BRAND-STUDIO-V3.md §4 — the gallery wall, its tiles, the events it sends and credits everywhere. */
const NOW = new Date("2026-11-11T03:00:00Z");
const library = (patch: Partial<StudioLibrary> = {}): StudioLibrary => ({
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
  ...patch,
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
    now: NOW,
    parentOf: () => null,
    onAction: () => {},
    onRetry: () => {},
    onCancel: () => {},
    onNotice: () => {},
    ...patch,
  };
  return renderToStaticMarkup(<Wall {...props} />);
}

describe("the wall", () => {
  it("justifies rows by ratio in CSS: each tile grows by its own ratio from one row height", () => {
    expect(tileStyle("16 / 9")).toEqual({ "--r": 1.7778, aspectRatio: "16 / 9" });
    expect(tileStyle("3 / 4")).toEqual({ "--r": 0.75, aspectRatio: "3 / 4" });
    expect(tileStyle("nonsense")["--r"]).toBe(1);
    const html = wall({ jobs: [job(1, { outputs: [output(1, { width: 1920, height: 1080 }), output(2, { width: 1080, height: 1350 })] })] });
    expect(html).toContain("--r:1.7778;aspect-ratio:1920 / 1080");
    expect(html).toContain("--r:0.8;aspect-ratio:1080 / 1350");
    expect(html).toMatch(/<img[^>]*loading="lazy"/);
    expect(html).not.toMatch(/bs-job-head|bs-job-prompt/);
  });

  it("puts the results first and the places still being made after them, failed runs as one tile", () => {
    const entries = wallEntries(
      [job(3, { status: "running", expected: 3, outputs: [output(1)] }), job(2, { status: "failed", errorCode: "failed" }), job(1, { status: "succeeded", outputs: [] }), job(0, { status: "canceled" })],
      () => null,
    );
    expect(entries.map((e) => e.entries.map((x) => x.type))).toEqual([["result", "pending", "pending"], ["failed"]]);
  });

  it("splits days with thin dividers in Seoul time", () => {
    expect(dayKey("2026-11-10T16:30:00Z")).toBe("2026-11-11");
    const words = { today: "오늘", yesterday: "어제" };
    expect(dayLabel("2026-11-11", NOW, "ko", words)).toBe("오늘");
    expect(dayLabel("2026-11-10", NOW, "ko", words)).toBe("어제");
    expect(dayLabel("2026-11-02", NOW, "ko", words)).toBe("11월 2일");
    expect(dayLabel("2025-12-24", NOW, "en", words)).toBe("Dec 24, 2025");
    const groups = groupByDay(["2026-11-11T01:00:00Z", "2026-11-10T20:00:00Z", "2026-11-09T01:00:00Z"], (x) => x, NOW);
    expect(groups.map((g) => g.items.length)).toEqual([2, 1]);
    const html = wall({ jobs: [job(2, { createdAt: "2026-11-11T01:00:00Z", outputs: [output(2)] }), job(1, { createdAt: "2026-11-08T01:00:00Z", outputs: [output(1)] })] });
    expect(html.match(/class="bs-wall-divider"/g)).toHaveLength(2);
    expect(html).toContain(">오늘<");
    expect(html).toContain(">11월 8일<");
  });

  it("reveals like, folder, use-as-reference and more on each tile, labelled for the keyboard", () => {
    const copy = copyFor("ko");
    const liked = library({ liked: new Set([`o:${output(1).id}`]) });
    const html = wall({ library: liked, jobs: [job(1, { outputs: [output(1), output(2)] })] });
    expect(html).toContain(`aria-label="${copy.gallery.unlike}"`);
    expect(html).toMatch(/data-studio-like="true" aria-pressed="true"/);
    expect(html).toMatch(/data-studio-like="true" aria-pressed="false"/);
    expect(html.match(/data-studio-file/g)).toHaveLength(2);
    expect(html.match(/data-studio-use/g)).toHaveLength(2);
    expect(html.match(/aria-haspopup="menu"/g)).toHaveLength(2);
    expect(html).toContain('draggable="true"');
    // Until the library has answered, its buttons wait.
    expect(wall({ library: library({ ready: false }), jobs: [job(1, { outputs: [output(1)] })] })).toMatch(/data-studio-like="true"[^>]*disabled=""/);
  });

  it("orders the more-menu with studio review & share, and narrows it by role and limit", () => {
    const base = { kind: "image" as const, image: true, sized: true, saved: false };
    expect(tileMenuKeys({ ...base, canGenerate: true, canEdit: true })).toEqual([
      "open", "rerun", "reuse", "region", "decorate", "to-video", "folder", "review", "campaign", "save", "download", "delete",
    ]);
    expect(tileMenuKeys({ ...base, canGenerate: false, canEdit: true })).toEqual(["open", "decorate", "folder", "review", "campaign", "save", "download", "delete"]);
    expect(tileMenuKeys({ ...base, canGenerate: false, canEdit: false })).toEqual(["open", "download"]);
    expect(tileMenuKeys({ ...base, canGenerate: true, canEdit: true, sized: false, saved: true })).not.toContain("decorate");
    expect(tileMenuKeys({ kind: "video_final", image: false, sized: true, saved: false, canGenerate: true, canEdit: true })).toEqual(["open", "folder", "review", "campaign", "save", "download", "delete"]);
  });

  it("holds a place for a partial edit on its way", () => {
    const copy = copyFor("ko");
    const html = wall({ sending: [{ key: "k1", ratio: "4 / 3" }], jobs: [job(1, { outputs: [output(1)] })] });
    expect(html).toContain("data-studio-sending");
    expect(html).toContain(copy.gallery.sending);
    expect(wall({ sending: [{ key: "k1", ratio: "4 / 3" }] })).toContain("data-studio-sending");
  });

  it("lists the image screen's runs only, and the video screen's", () => {
    const jobs = [job(1, { kind: "image" }), job(2, { kind: "region_edit" }), job(3, { kind: "video" }), job(4, { kind: "video_remix" }), job(5, { kind: "video_final" })];
    expect(jobsFor(jobs, "image").map((j) => j.kind)).toEqual(["image", "region_edit"]);
    expect(jobsFor(jobs, "video").map((j) => j.kind)).toEqual(["video", "video_remix", "video_final"]);
  });
});

describe("events and addresses", () => {
  it("announces a run as settled only when this screen watched it open", () => {
    const now = [job(1, { status: "succeeded" }), job(2, { status: "failed", kind: "region_edit" }), job(3, { status: "running" }), job(4, { status: "succeeded" })];
    const before = new Map([[job(1).id, "running" as const], [job(2).id, "queued" as const], [job(3).id, "queued" as const], [job(4).id, "succeeded" as const]]);
    expect(settledJobs(null, now)).toEqual([]);
    expect(settledJobs(before, now)).toEqual([
      { jobId: job(1).id, status: "succeeded", kind: "image" },
      { jobId: job(2).id, status: "failed", kind: "region_edit" },
    ]);
  });

  it("sends 영상으로 만들기 to the video screen with the picture as its opening frame", () => {
    expect(videoScreenHref(ORG, { outputId: id(5) })).toBe(`/brand/studio/video?organizationId=${ORG}&from=o%3A${id(5)}`);
    expect(parseFrom(`o:${id(5)}`)).toEqual({ outputId: id(5) });
    expect(parseFrom(`a:${id(6)}`)).toEqual({ assetId: id(6) });
    expect(parseFrom("o:nope")).toBeNull();
    expect(parseFrom(null)).toBeNull();
  });

  it("offers recent pictures (results, then uploads) to the partial-edit form", () => {
    const items = recentPictures([job(1, { outputs: [output(1), output(2, { kind: "video" })] })], [asset(1), asset(2, { kind: "video" })], "결과");
    expect(items.map((i) => i.key)).toEqual([`o:${output(1).id}`, `a:${asset(1).id}`]);
  });
});

describe("credits everywhere, never money", () => {
  const MONEY = /₩|KRW|\d[\d,]*\s*원(?!래)/;
  const states: StudioState[] = [
    studioState({
      assets: [asset(1)],
      allowance: allowance({ capKrw: 300_000, usedKrw: 123_456 }),
      jobs: [
        job(3, { status: "running", expected: 2, estimateKrw: 2_000 }),
        job(2, { kind: "region_edit", outputs: [output(2)], estimateKrw: 300, parentOutputId: output(1).id }),
        job(1, { outputs: [output(1)], estimateKrw: 1_300 }),
      ],
    }),
    studioState(),
  ];

  it.each(["ko", "en"] as const)("shows no won amount anywhere on the image and video screens (%s)", (locale) => {
    const dict = getDictionary(locale);
    for (const state of states)
      for (const mode of ["image", "video"] as const) {
        const html = renderToStaticMarkup(
          <StudioApp organizationId={ORG} locale={locale} copy={dict.brandStudio} mode={mode} libraryCopy={dict.studioLibrary} layersCopy={dict.studioLayers} initialState={state} />,
        );
        expect(html).not.toMatch(MONEY);
      }
    const copy = dict.brandStudio;
    const dock = renderToStaticMarkup(
      <Dock mode="image" draft={{ ...initialDraft(), prompt: "x" }} tray={[]} labels={[]} copy={copy} locale={locale} allowance={allowance()} credits={1234} busy={false} message={null} film={null} uploading={[]}
        initialModelMenu onDraft={() => {}} onTrayUpdate={() => {}} onTrayRemove={() => {}} onSubmit={() => {}} onDropSource={() => {}} onFiles={() => {}} onBrowse={() => {}} />,
    );
    expect(dock).not.toMatch(MONEY);
    expect(dock).toMatch(locale === "ko" ? /1,234 크레딧/ : /1,234 credits/);
    const picture = output(1);
    const viewer = renderToStaticMarkup(
      <Viewer items={[{ type: "output", output: picture, job: job(1, { outputs: [picture], estimateKrw: 1_300 }) }]} index={0} copy={copy} locale={locale} canCreate canGenerate busy={null} notice={null}
        regionPreset={{ key: `o:${picture.id}`, box: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 }, instruction: "", references: [trayItemFromAsset(asset(2))] }}
        region={{ models: regionEditModels(), defaultModel: "nano-banana-pro", recent: [], resolve: () => null, upload: async () => [] }}
        parentOf={() => null} onIndex={() => {}} onClose={() => {}}
        actions={{ regionEdit: async () => true, rerun: () => {}, toVideo: () => {}, reference: () => {}, save: () => {}, campaign: () => {}, finalize: () => {}, reuse: () => {}, remove: async () => true }} />,
    );
    expect(viewer).not.toMatch(MONEY);
    expect(viewer).toContain(locale === "ko" ? "크레딧" : "credits");
  });
});
