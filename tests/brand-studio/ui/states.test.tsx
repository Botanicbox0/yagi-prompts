import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { STUDIO_ERROR_CODES, type StudioState } from "@/lib/brand-studio/contracts";
import { STUDIO_MODELS } from "@/lib/brand-studio/models";
import { StudioApp } from "@/components/brand-studio/studio-app";
import { studioReducer } from "@/components/brand-studio/store";
import { errorLine } from "@/components/brand-studio/copy";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { ORG, allowance, asset, copyFor, job, output, studioState } from "./fixtures";
import { ko } from "@/messages/ko";
import { en } from "@/messages/en";

/** docs/BRAND-STUDIO-V3.md §4 (V2 §5.2, §9): who sees the prompt bar, the closed-limit notice and the wall. */
const render = (state: StudioState | null, locale: "ko" | "en" = "ko", mode: "image" | "video" = "image") => {
  const dict = getDictionary(locale);
  return renderToStaticMarkup(
    <StudioApp organizationId={ORG} locale={locale} copy={dict.brandStudio} mode={mode} libraryCopy={dict.studioLibrary} layersCopy={dict.studioLayers} initialState={state} />,
  );
};

describe("studio states", () => {
  it("shows a skeleton until the state arrives", () => {
    const html = render(null);
    expect(html).toContain("data-studio-skeleton");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("data-studio-dock");
  });

  it("gives an owner or editor the wall, the prompt bar and the library rail's place", () => {
    const html = render(studioState({ assets: [asset(1)], jobs: [job(1, { outputs: [output(1)] })] }));
    expect(html).toContain("data-studio-board");
    expect(html).toContain("data-studio-dock");
    expect(html).toContain("data-studio-rail-slot");
    expect(html).toContain('data-studio-mode="image"');
    expect(html).toMatch(/class="bs-tile-open" draggable="true"/);
    expect(html.match(/data-variant="solid"/g)).toHaveLength(1);
  });

  it("replaces the bar with one calm notice while the usage limit is closed", () => {
    const copy = copyFor("ko");
    const html = render(studioState({ allowance: allowance({ capKrw: 0, usedKrw: 0 }), assets: [asset(1)] }));
    expect(html).toContain("data-studio-allowance-closed");
    expect(html).toContain(copy.dock.closedTitle);
    expect(html).toContain(copy.dock.closedAction);
    expect(html).not.toContain("data-studio-dock");
    expect(html.match(/data-variant="solid"/g)).toHaveLength(1);
  });

  it("lets viewers and guests look without a bar or a drag", () => {
    const copy = copyFor("en");
    const done = job(1, { outputs: [output(1)] });
    const html = render(studioState({ canCreate: false, jobs: [done], assets: [asset(1)] }), "en");
    expect(html).not.toContain("data-studio-dock");
    expect(html).not.toContain("data-studio-allowance-closed");
    expect(html).not.toContain('draggable="true"');
    expect(html).not.toContain("data-studio-like");
    expect(html).toContain("data-studio-read-only");
    expect(html).toContain(copy.dock.readOnly);
  });

  it("offers the image screen's example sentences on an empty wall, as text only", () => {
    const copy = copyFor("ko");
    const html = render(studioState());
    const wall = html.slice(html.indexOf("data-studio-board"), html.indexOf("data-studio-dock"));
    expect(wall).toContain("data-studio-empty");
    for (const key of ["one", "two"] as const) expect(wall).toContain(copy.board.examples[key]);
    expect(wall).not.toContain(copy.board.examples.three);
    expect(wall).not.toMatch(/<img|<video/);
  });

  it("holds each place being made at its final ratio with the stage, inside the wall", () => {
    const copy = copyFor("ko");
    const html = render(
      studioState({
        jobs: [
          job(3, { status: "running", aspect: "9:16", expected: 2, outputs: [] }),
          job(2, { kind: "region_edit", status: "held", aspect: null, expected: 1, parentOutputId: output(1).id }),
          job(1, { outputs: [output(1, { width: 1600, height: 1200 })], estimateKrw: 1_300 }),
        ],
      }),
    );
    expect(html.match(/data-state="pending"/g)).toHaveLength(3);
    expect(html).toContain("aspect-ratio:9 / 16");
    expect(html).toContain("--r:0.5625");
    // The partial edit holds the shape of the picture it edits.
    expect(html).toContain("aspect-ratio:1600 / 1200");
    expect(html).toContain(copy.board.stage.running);
    expect(html).toContain(copy.board.stage.held);
    expect(html).toContain(copy.board.editBadge);
    expect(html).toContain("130 크레딧");
    expect(html).toContain("data-studio-day");
  });

  it("lists only the screen's medium", () => {
    const jobs = [
      job(4, { kind: "video", model: "seedance-2.5", outputs: [output(4, { kind: "video" })] }),
      job(3, { kind: "region_edit", outputs: [output(3)] }),
      job(2, { kind: "video_final", model: "seedance-2.5", outputs: [output(2, { kind: "video" })] }),
      job(1, { outputs: [output(1)] }),
    ];
    const image = render(studioState({ jobs }));
    expect(image.match(/data-studio-tile="true"/g)).toHaveLength(2);
    expect(image).not.toContain('data-kind="video"');
    const video = render(studioState({ jobs }), "ko", "video");
    expect(video.match(/data-studio-tile="true"/g)).toHaveLength(2);
    expect(video).not.toContain('data-kind="image"');
    expect(video).toContain(copyFor("ko").dock.placeholderVideo);
    expect(video).toContain('data-control="seconds"');
  });

  it("explains a failed run in one line and offers to try again", () => {
    const copy = copyFor("en");
    const html = render(studioState({ jobs: [job(1, { status: "failed", errorCode: "provider_rejected" })] }), "en");
    expect(html).toContain('data-state="failed"');
    expect(html).toContain(copy.errors.provider_rejected);
    expect(html).toContain(copy.board.retry);
    expect(html).not.toContain("provider_rejected");
  });

  it("offers a quiet cancel only while a run waits", () => {
    const copy = copyFor("ko");
    const html = render(studioState({ jobs: [job(3, { status: "held", outputs: [] }), job(2, { status: "queued", outputs: [] }), job(1, { status: "running", outputs: [] })] }));
    expect(html.match(/data-studio-cancel/g)).toHaveLength(2);
    expect(html).toContain(`aria-label="${copy.board.cancelLabel}"`);
  });

  it("drops a deleted result from the wall, and a finished run with nothing left", () => {
    const two = job(1, { outputs: [output(1), output(2)] });
    const state = studioState({ jobs: [two] });
    const after = studioReducer({ phase: "ready", state }, { type: "outputRemoved", outputId: output(1).id });
    expect(after.state!.jobs[0]!.outputs.map((o) => o.id)).toEqual([output(2).id]);
    expect(render(studioState({ jobs: [job(1, { outputs: [] })] }))).toContain('data-state="empty"');
  });
});

describe("customer copy", () => {
  it("has a sentence for every error code in both languages", () => {
    for (const dict of [ko, en]) {
      for (const code of STUDIO_ERROR_CODES) {
        expect(dict.brandStudio.errors[code], code).toBeTruthy();
        expect(errorLine(dict.brandStudio, code)).toBe(dict.brandStudio.errors[code]);
      }
      expect(Object.keys(dict.brandStudio.errors).sort()).toEqual([...STUDIO_ERROR_CODES].sort());
      expect(errorLine(dict.brandStudio, "something_new")).toBe(dict.brandStudio.errors.failed);
    }
    expect(STUDIO_ERROR_CODES.filter((code) => ko.brandStudio.errors[code] === en.brandStudio.errors[code])).toEqual([]);
  });

  it("has a hint for every model the registry declares", () => {
    for (const dict of [ko, en]) for (const model of STUDIO_MODELS) expect(dict.brandStudio.models[model.hintKey as keyof typeof dict.brandStudio.models], model.id).toBeTruthy();
  });

  it("never names internal machinery, providers, engine ids or showcase claims, and never money", () => {
    const flat = (value: unknown): string[] =>
      typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(flat) : [];
    const ids = STUDIO_MODELS.map((m) => m.id.replace(/[.]/g, "\\.")).join("|");
    const banned = new RegExp(`\\b(lane|provider|queue|sunra|mcp|token|endpoint|draft_task_id|API|webhook|higgsfield|morphic|openai|fal|gemini|${ids})\\b|모픽|글로벌 AI 플랫폼|200만|레인|큐|토큰|엔드포인트|₩|KRW|\\{amount\\}`, "i");
    for (const dict of [ko, en]) for (const line of flat(dict.brandStudio)) expect(line).not.toMatch(banned);
  });
});
