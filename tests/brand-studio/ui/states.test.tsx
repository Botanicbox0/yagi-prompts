import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { STUDIO_ERROR_CODES, type StudioJobView, type StudioState } from "@/lib/brand-studio/contracts";
import { STUDIO_MODELS } from "@/lib/brand-studio/models";
import { StudioApp } from "@/components/brand-studio/studio-app";
import { Board, canCancel, type BoardProps } from "@/components/brand-studio/board";
import { studioReducer } from "@/components/brand-studio/store";
import { errorLine } from "@/components/brand-studio/copy";
import { ORG, allowance, asset, copyFor, job, output, studioState } from "./fixtures";
import { ko } from "@/messages/ko";
import { en } from "@/messages/en";

/** docs/BRAND-STUDIO-V2.md §5.2, §9: who sees the dock, the closed-limit notice and the board. */
const render = (state: StudioState | null, locale: "ko" | "en" = "ko") =>
  renderToStaticMarkup(<StudioApp organizationId={ORG} locale={locale} copy={copyFor(locale)} initialState={state} />);

describe("studio states", () => {
  it("shows a skeleton until the state arrives", () => {
    const html = render(null);
    expect(html).toContain("data-studio-skeleton");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("data-studio-dock");
  });

  it("gives an owner or editor the board, the dock and the library", () => {
    const html = render(studioState({ assets: [asset(1)] }));
    expect(html).toContain("data-studio-board");
    expect(html).toContain("data-studio-dock");
    expect(html).toContain("data-studio-assets");
    expect(html).toContain("data-studio-upload");
    expect(html).toContain('draggable="true"');
    expect(html.match(/data-variant="solid"/g)).toHaveLength(1);
  });

  it("replaces the dock with one calm notice while the usage limit is closed", () => {
    const copy = copyFor("ko");
    const html = render(studioState({ allowance: allowance({ capKrw: 0, usedKrw: 0 }), assets: [asset(1)] }));
    expect(html).toContain("data-studio-allowance-closed");
    expect(html).toContain(copy.dock.closedTitle);
    expect(html).toContain(copy.dock.closedAction);
    expect(html).not.toContain("data-studio-dock");
    expect(html).toContain("data-studio-upload");
    expect(html.match(/data-variant="solid"/g)).toHaveLength(1);
  });

  it("lets viewers and guests look without a dock, an upload or a drag", () => {
    const copy = copyFor("en");
    const done = job(1, { outputs: [output(1)] });
    const html = render(studioState({ canCreate: false, jobs: [done], assets: [asset(1)] }), "en");
    expect(html).not.toContain("data-studio-dock");
    expect(html).not.toContain("data-studio-allowance-closed");
    expect(html).not.toContain("data-studio-upload");
    expect(html).not.toContain('draggable="true"');
    expect(html).toContain("data-studio-read-only");
    expect(html).toContain(copy.dock.readOnly);
    expect(html).toContain(`${copy.assets.view}: Asset 1`);
  });

  it("offers three example sentences on an empty board, as text only", () => {
    const copy = copyFor("ko");
    const html = render(studioState());
    const board = html.match(/data-studio-board[\s\S]*?<\/section>/)?.[0] ?? "";
    for (const key of ["one", "two", "three"] as const) expect(board).toContain(copy.board.examples[key]);
    expect(board).not.toMatch(/<img|<video/);
  });

  it("reserves each pending result at its final ratio with a stage line, and shows finished ones", () => {
    const copy = copyFor("ko");
    const html = render(
      studioState({
        jobs: [
          job(3, { status: "running", aspect: "9:16", expected: 2, outputs: [] }),
          job(2, { kind: "video", status: "held", aspect: "16:9", expected: 1, model: "seedance-2.5" }),
          job(1, { outputs: [output(1, { draft: true, kind: "video", width: 854, height: 480 })], estimateKrw: 1_300 }),
        ],
      }),
    );
    expect(html.match(/data-state="pending"/g)).toHaveLength(3);
    expect(html).toContain("aspect-ratio:9 / 16");
    expect(html).toContain("aspect-ratio:16 / 9");
    expect(html).toContain(copy.board.stage.running);
    expect(html).toContain(copy.board.stage.held);
    expect(html).toContain("aspect-ratio:854 / 480");
    expect(html).toContain(copy.board.draftBadge);
    expect(html).toContain("약 ₩1,300");
    expect(html.indexOf("Prompt 3")).toBeLessThan(html.indexOf("Prompt 1"));
  });

  it("explains a failed run in the customer's words and offers to try again", () => {
    const copy = copyFor("en");
    const html = render(studioState({ jobs: [job(1, { status: "failed", errorCode: "provider_rejected" })] }), "en");
    expect(html).toContain(copy.errors.provider_rejected);
    expect(html).toContain(copy.board.retry);
    expect(html).not.toContain("provider_rejected");
  });
});

describe("stopping and deleting", () => {
  const board = (jobs: StudioJobView[], patch: Partial<BoardProps> = {}) =>
    renderToStaticMarkup(
      <Board jobs={jobs} copy={copyFor("ko")} locale="ko" canCreate canStop parentOf={() => null} onOpen={() => {}} onRetry={() => {}} onCancel={() => {}} onExample={() => {}} {...patch} />,
    );

  it("offers a quiet cancel only while a run waits, and says why when it could not stop", () => {
    const copy = copyFor("ko");
    const html = board([job(3, { status: "held", outputs: [] }), job(2, { status: "queued", outputs: [] }), job(1, { status: "running", outputs: [] })], { notes: { [job(1).id]: copy.board.cancelLate } });
    expect(html.match(/data-studio-cancel/g)).toHaveLength(2);
    expect(html).toContain(`aria-label="${copy.board.cancelLabel}"`);
    expect(html).not.toMatch(/data-studio-cancel[^>]*data-variant="solid"|data-variant="solid"[^>]*data-studio-cancel/);
    expect(html).toContain(copy.board.cancelLate);
    expect(board([job(3, { status: "held" })], { canStop: false })).not.toContain("data-studio-cancel");
    expect(canCancel({ status: "running" })).toBe(false);
  });

  it("drops a deleted result from the board, and a finished run with nothing left", () => {
    const two = job(1, { outputs: [output(1), output(2)] });
    const state = studioState({ jobs: [two] });
    const after = studioReducer({ phase: "ready", state }, { type: "outputRemoved", outputId: output(1).id });
    expect(after.state!.jobs[0]!.outputs.map((o) => o.id)).toEqual([output(2).id]);
    expect(board([job(1, { outputs: [] })])).toContain('data-state="empty"');
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

  it("never names internal machinery, providers, engine ids or showcase claims", () => {
    const flat = (value: unknown): string[] =>
      typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(flat) : [];
    const ids = STUDIO_MODELS.map((m) => m.id.replace(/[.]/g, "\\.")).join("|");
    const banned = new RegExp(`\\b(lane|provider|queue|sunra|mcp|token|endpoint|draft_task_id|API|webhook|higgsfield|morphic|${ids})\\b|모픽|글로벌 AI 플랫폼|200만|레인|큐|토큰|엔드포인트`, "i");
    for (const dict of [ko, en]) for (const line of flat(dict.brandStudio)) expect(line).not.toMatch(banned);
  });
});
