import { describe, expect, it } from "vitest";
import { ReviseMarkSchema, STUDIO_REVISE_MARKS_MAX } from "@/lib/brand-studio/contracts";
import {
  BOX_MIN,
  MARKS_MAX,
  boxFrom,
  chipText,
  circled,
  controlsInset,
  formatTime,
  frameSize,
  insertDigit,
  isDrag,
  markFromGesture,
  markPixels,
  nudge,
  pictureRect,
  removeDigit,
  toFraction,
  toWireMarks,
  visibleAt,
  type MarkState,
} from "@/components/brand-studio/revise-marks";

/** docs/BRAND-STUDIO-V6-PLAN.md §4.5 — pointing at what to fix on a clip, as pure data. */
const mark = (patch: Partial<MarkState> = {}): MarkState => ({ key: "m1", time: 2.4, x: 0.5, y: 0.5, label: null, what: null, reading: false, ...patch });

describe("where the picture sits in the video box", () => {
  it("pillarboxes a portrait clip in a landscape box", () => {
    const rect = pictureRect({ width: 1000, height: 500 }, { width: 720, height: 1280 });
    expect(rect.height).toBeCloseTo(500);
    expect(rect.width).toBeCloseTo(281.25);
    expect(rect.left).toBeCloseTo((1000 - 281.25) / 2);
    expect(rect.top).toBe(0);
  });

  it("letterboxes a landscape clip in a portrait box", () => {
    const rect = pictureRect({ width: 400, height: 800 }, { width: 1920, height: 1080 });
    expect(rect.width).toBeCloseTo(400);
    expect(rect.height).toBeCloseTo(225);
    expect(rect.top).toBeCloseTo((800 - 225) / 2);
    expect(rect.left).toBe(0);
  });

  it("takes the whole box before the clip's size is known", () => {
    expect(pictureRect({ width: 300, height: 150 }, null)).toEqual({ left: 0, top: 0, width: 300, height: 150 });
    expect(pictureRect({ width: 300, height: 150 }, { width: 0, height: 0 })).toEqual({ left: 0, top: 0, width: 300, height: 150 });
  });

  it("leaves the native controls strip free only where it covers the picture", () => {
    // Picture fills the box height: the bottom 48 px are the controls.
    expect(controlsInset({ left: 0, top: 0, width: 281, height: 500 }, 500)).toBe(48);
    // Letterboxed picture ends 287 px above the box bottom: nothing to leave free.
    expect(controlsInset({ left: 0, top: 287.5, width: 400, height: 225 }, 800)).toBe(0);
    // Never more than 40 % of a short picture.
    expect(controlsInset({ left: 0, top: 0, width: 200, height: 60 }, 60)).toBeCloseTo(24);
  });
});

describe("pin or box", () => {
  const picture = { width: 400, height: 200 };

  it("turns a pointer position into picture fractions, clamped to the picture", () => {
    expect(toFraction({ x: 100, y: 50 }, picture)).toEqual({ x: 0.25, y: 0.25 });
    expect(toFraction({ x: -20, y: 260 }, picture)).toEqual({ x: 0, y: 1 });
    expect(toFraction({ x: 500, y: -1 }, picture)).toEqual({ x: 1, y: 0 });
  });

  it("is a pin up to 6 px of movement and a box beyond", () => {
    expect(isDrag({ x: 10, y: 10 }, { x: 14, y: 14 })).toBe(false); // 5.66 px
    expect(isDrag({ x: 10, y: 10 }, { x: 16, y: 10 })).toBe(false); // exactly 6
    expect(isDrag({ x: 10, y: 10 }, { x: 17, y: 10 })).toBe(true);
    expect(markFromGesture({ x: 100, y: 50 }, { x: 103, y: 52 }, picture, 1.5)).toEqual({ time: 1.5, x: 0.25, y: 0.25 });
    expect(markFromGesture({ x: 300, y: 150 }, { x: 100, y: 50 }, picture, 1.5)).toEqual({ time: 1.5, x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  });

  it("gives a thin drag the minimum box size and keeps the box inside the picture", () => {
    const thin = markFromGesture({ x: 10, y: 100 }, { x: 390, y: 101 }, picture, 0);
    expect(thin.h).toBe(BOX_MIN);
    expect(thin.w).toBeCloseTo(0.95);
    const corner = boxFrom({ x: 0.995, y: 0.995 }, { x: 1, y: 1 });
    expect(corner).toEqual({ x: 1 - BOX_MIN, y: 1 - BOX_MIN, w: BOX_MIN, h: BOX_MIN });
    // A drag leaving the picture is clamped to its edge.
    const out = markFromGesture({ x: 200, y: 100 }, { x: 600, y: 400 }, picture, 0);
    expect(out).toMatchObject({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
  });

  it("moves a mark by the keyboard without leaving the picture", () => {
    expect(nudge(mark({ x: 0.995 }), 0.01, 0)).toMatchObject({ x: 1, y: 0.5 });
    expect(nudge(mark({ x: 0.7, y: 0.1, w: 0.3, h: 0.2 }), 0.05, -0.05)).toMatchObject({ x: 0.7, y: 0.05, w: 0.3, h: 0.2 });
  });
});

describe("digits in the request", () => {
  it("writes the circled digit and a space at the caret", () => {
    expect(circled(1) + circled(2) + circled(3)).toBe("①②③");
    expect(insertDigit("병 색을 바꿔", 0, 1)).toEqual({ text: "① 병 색을 바꿔", caret: 2 });
    expect(insertDigit("병 색을 바꿔", 2, 2)).toEqual({ text: "병 ② 색을 바꿔", caret: 4 });
  });

  it("appends at the end when the caret is unknown, with a space so it does not stick to a word", () => {
    expect(insertDigit("", null, 1)).toEqual({ text: "① ", caret: 2 });
    expect(insertDigit("로고를", null, 1)).toEqual({ text: "로고를 ① ", caret: 6 });
    expect(insertDigit("① ", null, 2)).toEqual({ text: "① ② ", caret: 4 });
  });

  it("takes a digit out and renumbers the later ones", () => {
    const text = "① 병을 크게, ② 로고 선명하게, ③ 하늘을 밤으로";
    expect(removeDigit(text, 2)).toBe("① 병을 크게, 로고 선명하게, ② 하늘을 밤으로");
    expect(removeDigit(text, 1)).toBe("병을 크게, ① 로고 선명하게, ② 하늘을 밤으로");
    expect(removeDigit("끝에 ①", 1)).toBe("끝에");
    // A digit the customer already deleted: only the renumbering happens.
    expect(removeDigit("① 병, ③ 하늘", 2)).toBe("① 병, ② 하늘");
  });
});

describe("chips, time and visibility", () => {
  it("formats the clip time as m:ss", () => {
    expect(formatTime(2.4)).toBe("0:02");
    expect(formatTime(65.9)).toBe("1:05");
    expect(formatTime(-1)).toBe("0:00");
    expect(formatTime(Number.NaN)).toBe("0:00");
  });

  it("shows the label once known, else the time", () => {
    expect(chipText(mark())).toBe("0:02");
    expect(chipText(mark({ label: "  병 뚜껑 " }))).toBe("병 뚜껑");
    expect(chipText({ time: 3, label: "" })).toBe("0:03");
  });

  it("draws a mark only within 0.15 s of its moment", () => {
    expect(visibleAt(mark({ time: 2 }), 2)).toBe(true);
    expect(visibleAt(mark({ time: 2 }), 2.15)).toBe(true);
    expect(visibleAt(mark({ time: 2 }), 1.85)).toBe(true);
    expect(visibleAt(mark({ time: 2 }), 2.2)).toBe(false);
    expect(visibleAt(mark({ time: 2 }), 0)).toBe(false);
  });

  it("allows at most the contract's three marks", () => {
    expect(MARKS_MAX).toBe(STUDIO_REVISE_MARKS_MAX);
    expect(MARKS_MAX).toBe(3);
  });
});

describe("what is sent", () => {
  it("sends contract-valid marks in order, with label and description only when read", () => {
    const wire = toWireMarks([
      mark({ key: "a", time: 1.23456, x: 0.333333, y: 0.666666, label: "병 뚜껑", what: "the bottle cap on the left" }),
      mark({ key: "b", time: 2, x: 0.98999, y: 0.5, w: 0.0100001 + 0.01, h: 0.3 }),
      mark({ key: "c", time: 3, label: "  ", what: null }),
    ]);
    expect(wire).toEqual([
      { time: 1.235, x: 0.3333, y: 0.6666, label: "병 뚜껑", what: "the bottle cap on the left" },
      { time: 2, x: expect.any(Number), y: 0.5, w: 0.02, h: 0.3 },
      { time: 3, x: 0.5, y: 0.5 },
    ]);
    for (const m of wire) expect(ReviseMarkSchema.safeParse(m).success).toBe(true);
    expect(wire[1]!.x + wire[1]!.w!).toBeLessThanOrEqual(1);
  });

  it("sizes the frame to a long side of 768 px and draws a pin of about 3 % of it", () => {
    expect(frameSize({ width: 1080, height: 1920 })).toEqual({ width: 432, height: 768 });
    expect(frameSize({ width: 640, height: 360 })).toEqual({ width: 640, height: 360 });
    expect(markPixels({ time: 0, x: 0.5, y: 0.25 }, 432, 768)).toEqual({ kind: "pin", cx: 216, cy: 192, r: 0.03 * 768 });
    expect(markPixels({ time: 0, x: 0.1, y: 0.2, w: 0.5, h: 0.25 }, 400, 800)).toEqual({ kind: "box", x: 40, y: 160, w: 200, h: 200 });
  });
});
