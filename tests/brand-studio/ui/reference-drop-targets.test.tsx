import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Tray, type TrayProps } from "@/components/brand-studio/tray";
import { trayItemFromAsset, trayLabels, type TrayItem } from "@/components/brand-studio/refs";
import { createTalkFlow, type TalkDeps } from "@/components/brand-studio/revise-talk-flow";
import { memoryTalkStore } from "@/components/brand-studio/revise-talk-store";
import { asset, copyFor } from "./fixtures";

/**
 * Founder review 2026-11-25: in the video studio it was unclear whether a picture or a file could be dragged
 * onto the prompt bar or into a version's revise conversation. While something droppable is dragged over the
 * page, the target says what it takes; a file the conversation does not take is refused out loud.
 */

const pic = (n: number) => trayItemFromAsset(asset(n));
const film = (n: number) => trayItemFromAsset(asset(n, { kind: "video", thumbUrl: null }));
const noop = () => {};

function tray(patch: Partial<TrayProps> & { dropReady?: boolean } = {}, locale: "ko" | "en" = "ko") {
  const copy = copyFor(locale);
  const items = patch.items ?? [pic(1), film(2)];
  return renderToStaticMarkup(
    <Tray items={items} labels={trayLabels(items, copy)} medium="video" copy={copy} dropActive={false} uploading={[]} onUpdate={noop} onRemove={noop} onMove={noop} onBrowse={noop} {...patch} />,
  );
}

describe("video prompt bar: the reference row says what it takes", () => {
  for (const locale of ["ko", "en"] as const) {
    const t = copyFor(locale).tray;
    it(`${locale}: while a drag is on the page the row shows what it takes, even with references already in it`, () => {
      const html = tray({ dropReady: true }, locale);
      expect(html).toContain("data-tray-drop-hint");
      expect(html).toContain(t.hintVideo);
      expect(html).toContain("data-drop-ready");
    });
    it(`${locale}: over the bar itself it says the drop lands`, () => {
      const html = tray({ dropReady: true, dropActive: true }, locale);
      expect(html).toContain(t.drop);
    });
    it(`${locale}: an empty row in a video run names images, videos and audio, not pictures only`, () => {
      const html = tray({ items: [] }, locale);
      expect(html).toContain(t.hintVideo);
      expect(html).not.toContain(t.hint);
    });
    it(`${locale}: with no drag and references in it, no hint row`, () => {
      expect(tray({}, locale)).not.toContain("data-tray-drop-hint");
    });
  }
  it("the image studio's row keeps its own hint", () => {
    const html = tray({ items: [], medium: "image" });
    expect(html).toContain(copyFor("ko").tray.hint);
  });
});

describe("revise conversation: uploads land, and what it does not take is refused", () => {
  function flow() {
    const deps: TalkDeps = {
      organizationId: "00000000-0000-4000-8000-000000000001",
      outputId: "00000000-0000-4000-8000-000000000002",
      talk: vi.fn() as unknown as TalkDeps["talk"],
      create: vi.fn() as unknown as TalkDeps["create"],
      store: memoryTalkStore(),
      onChange: () => undefined,
      onCreated: () => undefined,
      decideText: "",
      setTimer: () => 0,
      clearTimer: () => undefined,
    };
    return createTalkFlow(deps);
  }
  const key = (item: TrayItem) => item.key;

  it("pictures become references and clips become materials", () => {
    const f = flow();
    f.attachUploads({ added: [pic(1), film(2)], failure: null });
    expect(f.state.references.map(key)).toEqual([pic(1).key]);
    expect(f.state.materials.map(key)).toEqual([film(2).key]);
    expect(f.state.uploadNote).toBeNull();
  });

  it("an audio file (or anything else it does not take) dropped alone gives the refusal line, not silence", () => {
    const f = flow();
    f.attachUploads({ added: [], failure: { code: "unsupported_file" } });
    expect(f.state.uploadNote).toEqual({ code: "unsupported_file" });
  });

  it("a mixed drop keeps what it takes and still says one file was refused", () => {
    const f = flow();
    f.attachUploads({ added: [pic(3)], failure: { code: "unsupported_file" } });
    expect(f.state.references.map(key)).toEqual([pic(3).key]);
    expect(f.state.uploadNote).toEqual({ code: "unsupported_file" });
  });
});
