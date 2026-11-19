import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TalkView } from "@/components/brand-studio/revise-talk";
import { initialTalkState, type TalkState } from "@/components/brand-studio/revise-talk-flow";
import { copyFor } from "./fixtures";

/** The revise conversation's screen for fixed states (components/brand-studio/revise-talk.tsx). */
const ko = copyFor("ko");
const noop = () => {};
const view = (patch: Partial<TalkState>, draftClip = true) =>
  renderToStaticMarkup(
    <TalkView state={{ ...initialTalkState(), phase: "idle", ...patch }} copy={ko} locale="ko" draftClip={draftClip} editStudioHref="/brand/studio/compose?clip=o:x" uploading={false}
      marking={false} markable={false} onDraft={noop} onSend={noop} onChoose={noop} onResend={noop} onRemove={noop} onMake={noop} onStartOver={noop} onFiles={noop} onRemoveAttachment={noop} onMarkMode={noop} />,
  );
const look = (text: string) => ({ text, kind: "look" as const });
const said = (text: string) => ({ id: text, from: "customer" as const, text, references: [], materials: [], marks: [] });

describe("the conversation on screen", () => {
  it("announces the thread politely and shows the studio as plain text; no sheet, no button", () => {
    const html = view({ thread: [said("ㅇㅇ"), { id: "s", from: "studio", text: "무엇을 바꿀까요?", kind: "unreadable" }] });
    expect(html).toContain('role="log"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("무엇을 바꿀까요?");
    expect(html).not.toContain("data-talk-sheet");
    expect(html).not.toContain("data-talk-make");
  });

  it("shows the open question's options as chips with 'decide for me', and invites a typed answer", () => {
    const html = view({
      thread: [said("배경 바꿔줘"), { id: "s", from: "studio", text: "배경을 어떤 곳으로 바꿀까요?", kind: "change", question: 0 }],
      questions: [{ point: "bg", question: "배경을 어떤 곳으로 바꿀까요?", options: ["바다", "숲"], answer: null }],
      open: 0,
    });
    expect(html.match(/data-talk-option=/g)).toHaveLength(2);
    expect(html).toContain(ko.revise.talk.decide);
    expect(html).toContain(`placeholder="${ko.revise.talk.answerPlaceholder}"`);
  });

  it("pins one sheet with its groups (empty ones hidden), remove controls, and the one button with credits and the version line", () => {
    const html = view({
      thread: [said("배경을 바다로")],
      sheet: { change: [look("배경을 바다로"), look("꽃잎 빼기")], keep: ["병"], exclude: [] },
      canMake: true,
      way: "edit",
      estimateKrw: 970,
      version: 2,
      fresh: ["꽃잎 빼기"],
    });
    expect(html).toContain(ko.revise.talk.groupChange);
    expect(html).toContain(ko.revise.talk.groupKeep);
    expect(html).not.toContain(ko.revise.talk.groupExclude);
    expect(html.match(/data-talk-remove=/g)).toHaveLength(2);
    expect(html.match(/data-talk-make(?!-)/g)).toHaveLength(1);
    expect(html).toContain("97");
    expect(html).toContain("v2");
    expect(html).toMatch(/data-talk-line="1" data-fresh=""/);
    // The quiet line about finals: once, on the card, only when a draft is changed inside it.
    expect(html.split(ko.revise.talk.draftOnce).length - 1).toBe(1);
    expect(view({ sheet: { change: [look("배경")], keep: [], exclude: [] }, canMake: true, way: "reshoot", estimateKrw: 810 })).not.toContain(ko.revise.talk.draftOnce);
    expect(view({ sheet: { change: [look("배경")], keep: [], exclude: [] }, canMake: true, way: "edit", estimateKrw: 970 }, false)).not.toContain(ko.revise.talk.draftOnce);
  });

  it("keeps the sheet compact: what stays and what is left out are one line each that opens on press; one chat input", () => {
    const html = view({ sheet: { change: [look("배경을 바다로"), look("조명을 따뜻하게"), look("꽃잎 빼기"), look("카메라를 천천히")], keep: ["향수병", "카메라 움직임"], exclude: ["꽃잎"] }, canMake: true, way: "edit", estimateKrw: 970 });
    expect(html).toMatch(/data-talk-group="keep"><button type="button" class="bs-talk-oneline" aria-expanded="false" title="향수병 · 카메라 움직임">/);
    expect(html).toMatch(/data-talk-group="exclude"><button type="button" class="bs-talk-oneline" aria-expanded="false" title="꽃잎">/);
    expect(html.match(/data-talk-line=/g)).toHaveLength(4);
    // One chat input: the text one line tall, attach and mark as icon buttons with names inside the box, send at the end; no tool row.
    expect(html).toMatch(/<textarea[^>]*rows="1"/);
    const field = html.slice(html.indexOf('class="bs-talk-field"'));
    expect(field).toMatch(new RegExp(`aria-label="${ko.revise.addRefs}"[^>]*title="${ko.revise.addRefs}"[^>]*data-talk-attach`));
    expect(field.indexOf("data-talk-attach")).toBeLessThan(field.indexOf("data-talk-send"));
    expect(html).not.toContain("bs-revise-tools");
    // Changed inside a draft: the draft note shows; "saved as vN" becomes the button's description and tooltip.
    expect(html).toMatch(/aria-describedby="[^"]+-after" title="[^"]+" data-talk-make/);
    const described = /aria-describedby="([^"]+-after)"/.exec(html)![1]!;
    expect(html).toContain(`class="bs-sr" id="${described}"`);
    // The thread comes first, then the one sheet card with the button, then the box.
    expect(html.indexOf("data-talk-thread")).toBeLessThan(html.indexOf("data-talk-sheet"));
    expect(html.indexOf("data-talk-make")).toBeLessThan(html.indexOf("data-talk-box"));
  });

  it("says a failed reading out loud with 'send again', and 'taking a little longer' while slow", () => {
    expect(view({ phase: "failed", thread: [said("배경"), { id: "n", from: "note", note: "failed" }] })).toContain(ko.revise.talk.resend);
    expect(view({ phase: "slow", thread: [said("배경")] })).toContain(ko.revise.talk.slow);
    expect(view({ phase: "reading", thread: [said("배경")] })).toContain(ko.revise.talk.reading);
  });

  it("offers the editing studio when the answer points there, and nothing to make for it", () => {
    const html = view({ thread: [said("마지막 1초는 잘라줘"), { id: "s", from: "studio", text: "편집 스튜디오에서 무료로 자를 수 있어요.", kind: "not_possible", editStudio: true }] });
    expect(html).toContain('href="/brand/studio/compose?clip=o:x"');
    expect(html).not.toContain("data-talk-make");
  });
});
