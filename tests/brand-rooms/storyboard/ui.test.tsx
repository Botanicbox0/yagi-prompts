import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { StoryboardView } from "@/components/brand-rooms/seams";
import type { StoryboardBoardView } from "@/lib/brand-rooms/storyboard-contracts";

/**
 * docs/BRAND-ROOMS.md §5 — the storyboard screens rendered on the server: the bare board a share link
 * shows (no writes, no thread), the three views with their markers and labels, the tab's first paint,
 * the editor's fields, and copy that names no internal tool. Interaction is checked in the browser.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
// The other slices' pieces are mounted through their seams; they are tested in their own folders.
vi.mock("@/components/brand-rooms/share", () => ({ ShareButton: () => null }));
vi.mock("@/components/brand-rooms/chat", () => ({ RoomThread: () => null, RoomChannel: () => null }));

const { StoryboardReadOnly, StoryboardTab } = await import("@/components/brand-rooms/storyboard");
const { Animatic, CutCards, ShotTable } = await import("@/components/brand-rooms/storyboard/views");
const { StoryboardEditor } = await import("@/components/brand-rooms/storyboard/editor");

const ID = "d0000000-0000-4000-8000-00000000000";
const frame = (n: number, extra: Partial<StoryboardBoardView["frames"][number]> = {}) => ({
  id: `${ID}${n}`,
  idx: n,
  scene: "1",
  shot: String(n + 1),
  url: `/api/brand-studio/media/st/${String(n).repeat(64).slice(0, 64)}.png`,
  thumbUrl: null,
  width: 1600,
  height: 900,
  description: `Cut ${n + 1} description`,
  camera: n === 0 ? "Slow push in" : null,
  audio: null,
  seconds: n === 1 ? 3.5 : null,
  threadCount: n === 0 ? 4 : 0,
  sourceAssetId: null,
  ...extra,
});
const board: StoryboardBoardView = {
  id: `${ID}9`,
  projectId: `${ID}8`,
  lineageId: `${ID}7`,
  title: "Spring launch",
  version: 2,
  status: "shared",
  createdRole: "studio",
  source: "cli",
  sharedAt: "2026-11-11T00:00:00.000Z",
  updatedAt: "2026-11-11T00:00:00.000Z",
  frames: [frame(0), frame(1), frame(2, { scene: null, shot: null, description: "" })],
};

describe("the shared-link board", () => {
  it("shows the cuts with their labels, lengths and words, and nothing that writes or talks", () => {
    const copy = getDictionary("ko").roomsStoryboard;
    const { lineageId: _l, source: _s, sharedAt: _a, ...plain } = board;
    const html = renderToStaticMarkup(<StoryboardReadOnly board={plain as StoryboardView} locale="ko" copy={copy} />);
    expect(html).toContain(`data-storyboard-readonly="${board.id}"`);
    expect(html).toContain("data-storyboard-cards");
    expect(html).toContain("S1 · 컷 1");
    expect(html).toContain("S1 · 컷 2");
    expect(html).toContain("컷 3");
    expect(html).toContain("3.5초");
    expect(html).toContain("2초");
    expect(html).toContain("아직 설명이 없어요");
    expect(html).toContain("2차");
    expect(html).toContain("전체 0:07.5");
    expect(html).toContain('style="aspect-ratio:1600 / 900"');
    for (const marker of ["data-storyboard-approve", "data-storyboard-edit", "data-storyboard-thread", "data-storyboard-create", "data-storyboard-delete"]) expect(html).not.toContain(marker);
  });
});

describe("the three views", () => {
  const copy = getDictionary("en").roomsStoryboard;

  it("marks changed cuts and the thread count on the cards", () => {
    const html = renderToStaticMarkup(<CutCards frames={board.frames} copy={copy} changed={new Set([board.frames[1]!.id])} onOpen={() => undefined} />);
    expect(html).toContain("S1 · Shot 1");
    expect(html).toContain("4 notes");
    expect(html).toContain('aria-label="4 messages about this shot"');
    expect(html).toContain(">Changed<");
    expect(html.match(/data-changed="true"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Open S1 · Shot 2"');
  });

  it("lists every cut in the shot list with the running time", () => {
    const html = renderToStaticMarkup(<ShotTable frames={board.frames} copy={copy} />);
    expect(html).toContain("data-storyboard-table");
    expect(html.match(/data-storyboard-row=/g)).toHaveLength(3);
    for (const head of ["No.", "Scene / shot", "Picture", "Description", "Camera", "Sound", "Length", "Running time"]) expect(html).toContain(head);
    expect(html).toContain("Slow push in");
    expect(html).toMatch(/data-storyboard-total="?"?[^>]*>0:07\.5</);
  });

  it("plays the animatic with labelled controls and the key hint", () => {
    const html = renderToStaticMarkup(<Animatic frames={board.frames} copy={copy} />);
    expect(html).toContain("data-storyboard-player");
    expect(html).toContain('aria-label="Play"');
    expect(html).toContain('aria-label="Previous shot"');
    expect(html).toContain('aria-label="Position"');
    expect(html).toContain('max="7500"');
    expect(html).toContain("Space plays and pauses");
    expect(html).toContain('tabindex="0"');
  });
});

describe("the tab and the editor", () => {
  it("paints a loading state first inside its marker", () => {
    const dict = getDictionary("ko");
    const html = renderToStaticMarkup(
      <StoryboardTab
        organizationId={`${ID}1`}
        projectId={`${ID}2`}
        locale="ko"
        copy={dict.roomsStoryboard}
        chatCopy={dict.roomsChat}
        shareCopy={dict.roomsReview}
        canEdit
        canTalk
      />,
    );
    expect(html).toContain("data-room-storyboard");
    expect(html).toContain('data-storyboard-state="loading"');
    expect(html).toContain("불러오는 중");
  });

  it("opens a draft with every cut editable, labelled fields and one share button", () => {
    const copy = getDictionary("ko").roomsStoryboard;
    const draft = { ...board, status: "draft" as const, createdRole: "brand" as const };
    const html = renderToStaticMarkup(
      <StoryboardEditor board={draft} copy={copy} writer={{ save: async () => ({ ok: true }), share: async () => ({ ok: true }) }} onSaved={() => undefined} onShared={() => undefined} />,
    );
    expect(html).toContain(`data-storyboard-editor="${draft.id}"`);
    expect(html.match(/data-storyboard-edit-cut=/g)).toHaveLength(3);
    expect(html.match(/data-storyboard-description/g)).toHaveLength(3);
    for (const label of ["장면", "컷", "설명", "카메라", "사운드·대사", "길이(초)", "사진 추가", "글 붙여 넣기", "임시 저장", "공유하기"]) expect(html).toContain(label);
    expect(html.match(/brs-btn-primary/g)).toHaveLength(1);
    expect(html).toContain('accept="image/png,image/jpeg,image/webp"');
  });
});

describe("copy", () => {
  it("names no internal tool, engine or supplier on the brand's screens", () => {
    for (const locale of ["ko", "en"] as const) {
      const { admin: _admin, ...brandSide } = getDictionary(locale).roomsStoryboard;
      const text = JSON.stringify(brandSide);
      expect(text).not.toMatch(/slack|슬랙|webhook|웹훅|\bcli\b|command line|sunra|higgsfield|morphic|모픽|seedance|r2\b|supabase/i);
    }
  });
});
