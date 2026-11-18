import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyButton, copyText, copyWithSelection, promptToCopy, sentPromptCopyable } from "@/components/brand-studio/copy-prompt";
import { tileMenuKeys } from "@/components/brand-studio/gallery/wall";
import { Menu } from "@/components/brand-studio/gallery/menu";
import { Viewer, type ViewerActions } from "@/components/brand-studio/viewer";
import type { StudioJobView } from "@/lib/brand-studio/contracts";
import { copyFor, job, output } from "./fixtures";

/** "이미지 프롬프트는 편하게 복사할 수 있어야 함" (2026-11-19): one press copies a result's prompt. */
const noop = () => {};
const actions: ViewerActions = { regionEdit: async () => true, rerun: noop, toVideo: noop, reference: noop, save: noop, campaign: noop, finalize: noop, reuse: noop, remove: async () => true };

function viewer(run: StudioJobView, locale: "ko" | "en" = "ko") {
  const out = run.outputs[0] ?? output(1, { kind: run.kind === "video" ? "video" : "image" });
  return renderToStaticMarkup(
    <Viewer items={[{ type: "output", output: out, job: { ...run, outputs: [out] } }]} index={0} copy={copyFor(locale)} locale={locale} canCreate canGenerate busy={null} notice={null}
      parentOf={() => null} onIndex={noop} onClose={noop} actions={{ ...actions, openRegionInLayers: noop }} />,
  );
}

describe("which words are copied", () => {
  it("copies the typed words of an image run, its sent sentence only when nothing was typed", () => {
    expect(promptToCopy(job(1, { kind: "image", prompt: "병을 얼음 위에", finalPrompt: "A bottle on ice" }))).toBe("병을 얼음 위에");
    expect(promptToCopy(job(1, { kind: "image", prompt: "   ", finalPrompt: "A bottle on ice" }))).toBe("A bottle on ice");
    expect(promptToCopy(job(1, { kind: "image", prompt: "", finalPrompt: null }))).toBeNull();
  });

  it("copies a partial edit's instruction as its prompt", () => {
    expect(promptToCopy(job(2, { kind: "region_edit", prompt: "선택한 부분의 마크를 이미지 1 로고로", finalPrompt: "In Figure 1, change only the boxed part" }))).toBe("선택한 부분의 마크를 이미지 1 로고로");
  });

  it("never falls back to a video run's sentence (it stays protected)", () => {
    expect(sentPromptCopyable({ kind: "video" })).toBe(false);
    expect(sentPromptCopyable({ kind: "video_remix" })).toBe(false);
    expect(promptToCopy(job(3, { kind: "video", prompt: "", finalPrompt: "Camera pushes in" }))).toBeNull();
    expect(promptToCopy(job(3, { kind: "video", prompt: "카메라가 다가간다", finalPrompt: "Camera pushes in" }))).toBe("카메라가 다가간다");
  });
});

describe("the clipboard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("writes with the async clipboard when it is there", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(copyText("Figure 1 그대로")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("Figure 1 그대로");
  });

  it("falls back to a hidden field and execCommand when the clipboard refuses, and never throws", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => { throw new Error("denied"); }) } });
    const appended: Array<{ value: string }> = [];
    const area = { value: "", style: { cssText: "" }, tabIndex: 0, setAttribute: noop, select: noop, setSelectionRange: noop, remove: noop };
    const execCommand = vi.fn(() => true);
    vi.stubGlobal("document", { createElement: () => area, body: { appendChild: (el: { value: string }) => appended.push(el) }, activeElement: null, execCommand });
    vi.stubGlobal("HTMLElement", class {});
    await expect(copyText("Render Figure 1 unredrawn")).resolves.toBe(true);
    expect(appended[0]?.value).toBe("Render Figure 1 unredrawn");
    expect(execCommand).toHaveBeenCalledWith("copy");
    execCommand.mockImplementation(() => { throw new Error("blocked"); });
    expect(copyWithSelection("x")).toBe(false);
    vi.stubGlobal("navigator", {});
    await expect(copyText("x")).resolves.toBe(false);
  });
});

describe("the copy buttons", () => {
  it("the viewer offers 프롬프트 복사 beside the folded prompt section, and one copy button per shown sentence", () => {
    const copy = copyFor("ko");
    const html = viewer(job(1, { kind: "image", prompt: "병을 얼음 위에", finalPrompt: "A bottle on ice", reviewed: true }));
    expect(html).toContain("data-copy-prompt");
    expect(html).toContain(copy.viewer.copyPrompt);
    expect(html).toContain("data-copy-typed");
    expect(html).toContain("data-copy-sent");
    // An image run's sentence is no longer blocked from selection once it can be copied.
    expect(html).not.toContain("data-no-copy");
    // Beside the folded section (pressable without opening it), after the details element.
    expect(html).toMatch(/<div class="bs-prompt-block" data-studio-prompt-block="true"><details[^>]*>.*<\/details><button[^>]*data-copy-prompt=""/s);
    // Both labels share one cell: the copied one is there but hidden, so nothing moves.
    expect(html).toContain(`<span class="bs-copy-label"><span>${copy.viewer.copyPrompt}</span><span aria-hidden="true">${copy.viewer.copied}</span></span>`);
    expect(html).toMatch(/aria-live="polite"/);
  });

  it("a partial edit's viewer copies its instruction and offers 같은 영역 다시 수정하기 apart from 부분 수정", () => {
    const copy = copyFor("ko");
    const html = viewer(job(2, { kind: "region_edit", prompt: "선택한 부분의 마크를 이미지 1 로고로", finalPrompt: "In Figure 1, change only the boxed part", parentOutputId: output(9).id }));
    expect(html).toContain("data-copy-prompt");
    expect(html).toContain("data-copy-sent");
    expect(html).toContain(copy.viewer.reuseRegion);
    expect(html).toContain(`data-action="region"`);
    expect(html).toContain('data-studio-reuse="region"');
    expect(html).not.toContain(copy.viewer.reuse);
  });

  it("a video run's sentence keeps its protection: no copy button, not selectable", () => {
    const html = viewer(job(3, { kind: "video", prompt: "카메라가 다가간다", finalPrompt: "Camera pushes in", outputs: [output(3, { kind: "video" })] }));
    expect(html).toContain("data-copy-prompt");
    expect(html).toContain("data-copy-typed");
    expect(html).not.toContain("data-copy-sent");
    expect(html).toContain('data-no-copy=""');
  });

  it("the compact copy button is named by its label and points at the sentence it copies", () => {
    const html = renderToStaticMarkup(<CopyButton text="x" label="복사" copiedLabel="복사했어요" compact describedBy="typed" marker="copy-typed" />);
    expect(html).toContain('aria-label="복사"');
    expect(html).toContain('aria-describedby="typed"');
    expect(html).toContain("data-copy-typed");
  });

  it("the tile menu puts 프롬프트 복사 right after 설정 다시 쓰기, also for a viewer", () => {
    const base = { kind: "image" as const, image: true, sized: true, saved: false, copyable: true };
    expect(tileMenuKeys({ ...base, canGenerate: true, canEdit: true }).slice(0, 5)).toEqual(["open", "rerun", "reuse", "copy-prompt", "region"]);
    expect(tileMenuKeys({ ...base, canGenerate: false, canEdit: false })).toEqual(["open", "copy-prompt", "download"]);
    expect(tileMenuKeys({ ...base, copyable: false, canGenerate: true, canEdit: true })).not.toContain("copy-prompt");
  });

  it("a partial edit's tile menu: 같은 영역 다시 수정하기 (no second 다시 만들기), then 프롬프트 복사, then 부분 수정", () => {
    const keys = tileMenuKeys({ kind: "region_edit", image: true, sized: true, saved: false, copyable: true, canGenerate: true, canEdit: true });
    expect(keys.slice(0, 4)).toEqual(["open", "reuse", "copy-prompt", "region"]);
    expect(keys).not.toContain("rerun");
  });

  it("a menu entry flips its label in place while done", () => {
    const entry = { key: "copy-prompt", label: "프롬프트 복사", doneLabel: "복사했어요", run: noop };
    const rest = renderToStaticMarkup(<Menu id="m" label="더보기" entries={[{ ...entry, done: false, icon: "copy" }]} onClose={noop} />);
    const done = renderToStaticMarkup(<Menu id="m" label="더보기" entries={[{ ...entry, done: true, icon: "check" }]} onClose={noop} />);
    expect(rest).toContain('<span class="bs-menu-swap"><span>프롬프트 복사</span><span>복사했어요</span></span>');
    expect(rest).not.toContain("data-copied");
    expect(done).toContain('data-copied=""');
  });
});
