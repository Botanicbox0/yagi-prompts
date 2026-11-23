import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as speedPanelMod from '@/components/brand-studio/editor-v2/speed-panel';
import {
  SpeedPanel,
  applyCurvePointKeyDown,
  applySpeedNumberCommit,
  speedFromTrackOffset,
} from '@/components/brand-studio/editor-v2/speed-panel';
import { setClipConstantSpeed, setClipSpeedCurve, trimClipEdge, type FrameClip, type FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import { SPEED_PRESETS, nextSpeedOnSliderKey } from '@/lib/brand-studio/editor-v2/speed-curve';
import { studioEditorEn, studioEditorKo } from '@/messages/studio-editor';

function makeClip(overrides: Partial<FrameClip> = {}): FrameClip {
  return {
    id: 'cut-1',
    label: 'Scene 1',
    srcUrl: 'https://example.com/a.mp4',
    thumbUrl: null,
    sourceFps: 30,
    sourceFrames: 300,
    inFrame: 0,
    phase: 0,
    frames: 90,
    speedNum: 1,
    speedDen: 1,
    volume: 1,
    muted: false,
    ...overrides,
  };
}

function makeSeq(clips: FrameClip[], fps = 30): FrameSequence {
  return { fps, aspect: '9:16', clips, captions: [] };
}

describe('SpeedPanel UI rendering and interactions', () => {
  it('renders constant speed controls with accessible log slider, numeric input, and quick preset group in KO and EN', () => {
    const seq = setClipConstantSpeed(makeSeq([makeClip()]), 0, 1.11);
    const clip = seq.clips[0]!;

    const htmlKo = renderToStaticMarkup(
      <SpeedPanel
        clip={clip}
        clipIndex={0}
        clipStart={0}
        playhead={10}
        fps={30}
        readOnly={false}
        copy={studioEditorKo}
        onSetConstant={() => undefined}
        onSetCurve={() => undefined}
        onReset={() => undefined}
      />,
    );
    expect(htmlKo).toContain('role="group"');
    expect(htmlKo).toContain('aria-label="속도"');
    expect(htmlKo).toContain('0.5×');
    expect(htmlKo).toContain('1.5×');
    expect(htmlKo).toContain('value="1.11"');
    expect(htmlKo).toContain('role="slider"');
    expect(htmlKo).toContain('aria-valuenow="1.11"');
    expect(htmlKo).toContain(studioEditorKo.cut.clip.speedModeConstant);
    expect(htmlKo).toContain(studioEditorKo.cut.clip.speedModeCurve);

    const htmlEn = renderToStaticMarkup(
      <SpeedPanel
        clip={clip}
        clipIndex={0}
        clipStart={0}
        playhead={10}
        fps={30}
        readOnly={false}
        copy={studioEditorEn}
        onSetConstant={() => undefined}
        onSetCurve={() => undefined}
        onReset={() => undefined}
      />,
    );
    expect(htmlEn).toContain('aria-label="Speed"');
    expect(htmlEn).toContain(studioEditorEn.cut.clip.speedModeConstant);
    expect(htmlEn).toContain(studioEditorEn.cut.clip.speedModeCurve);
  });

  it('renders interactive speed curve SVG, presets, live playhead marker, and slow-section frame-repeat note', () => {
    const seq = setClipSpeedCurve(
      makeSeq([makeClip()]),
      0,
      SPEED_PRESETS.find((p) => p.id === 'slowMiddle')!.points,
    );
    const clip = seq.clips[0]!;

    const html = renderToStaticMarkup(
      <SpeedPanel
        clip={clip}
        clipIndex={0}
        clipStart={0}
        playhead={Math.floor(clip.frames / 2)}
        fps={30}
        readOnly={false}
        copy={studioEditorKo}
        onSetConstant={() => undefined}
        onSetCurve={() => undefined}
        onReset={() => undefined}
      />,
    );
    expect(html).toContain('<svg');
    expect(html).toContain('data-testid="speed-curve-svg"');
    expect(html).toContain('data-testid="speed-curve-playhead"');
    expect(html).toContain(studioEditorKo.cut.clip.speedSlowNote);
    expect(html).toContain(studioEditorKo.cut.clip.speedPresetSlowMiddle);
    expect(html).toContain(studioEditorKo.cut.clip.speedPresetFastMiddle);
    expect(html).not.toMatch(/bezier|hermite|fritsch|monotone|interpolat|\bNLE\b/i);
  });

  it('S2 & S3: handles slider keyboard steps without stalling, parses comma/0/99 inputs accurately, and prevents Delete propagation on curve points', () => {
    // Slider keyboard navigation: ArrowRight from 1.00 -> 1.01, PageUp -> 1.10, all 991 values reachable
    expect(nextSpeedOnSliderKey(1.0, 'ArrowRight')).toBe(1.01);
    expect(nextSpeedOnSliderKey(1.0, 'ArrowUp')).toBe(1.01);
    expect(nextSpeedOnSliderKey(1.0, 'ArrowLeft')).toBe(0.99);
    expect(nextSpeedOnSliderKey(1.0, 'PageUp')).toBe(1.1);
    expect(nextSpeedOnSliderKey(1.0, 'PageDown')).toBe(0.9);
    expect(speedFromTrackOffset(0, 200)).toBe(0.1);
    expect(speedFromTrackOffset(100, 200)).toBe(1);
    expect(speedFromTrackOffset(200, 200)).toBe(10);

    // Number input commit rules: "1,11" -> 1.11, "1.115" -> 1.12, "0" -> clamp 0.10, "99" -> clamp 10.00, "" -> revert current
    expect(applySpeedNumberCommit('1,11', 1)).toBe(1.11);
    expect(applySpeedNumberCommit('1.115', 1)).toBe(1.12);
    expect(applySpeedNumberCommit('0', 1.11)).toBe(0.1);
    expect(applySpeedNumberCommit('99', 1)).toBe(10);
    expect(applySpeedNumberCommit('', 1.25)).toBe(1.25);

    // Delete on interior curve point stops propagation so cut is not deleted
    const pts = SPEED_PRESETS.find((p) => p.id === 'slowMiddle')!.points;
    const stopPropagation = vi.fn();
    const preventDefault = vi.fn();
    const onSetCurve = vi.fn();
    const nextSelected = applyCurvePointKeyDown(
      { key: 'Delete', shiftKey: false, preventDefault, stopPropagation },
      pts,
      1,
      false,
      (nextPts) => onSetCurve(0, nextPts),
    );
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(onSetCurve).toHaveBeenCalledTimes(1);
    expect(onSetCurve.mock.calls[0]![1]).toHaveLength(pts.length - 1);
    expect(nextSelected).toBe(0);
  });

  it('omits slow-section note when curve minimum speed is >= 1.0x', () => {
    const seq = setClipSpeedCurve(makeSequenceWith([makeClip()]), 0, [
      { pos: 0, speed: 1.0 },
      { pos: 0.5, speed: 2.5 },
      { pos: 1, speed: 1.0 },
    ]);
    const clip = seq.clips[0]!;

    const html = renderToStaticMarkup(
      <SpeedPanel
        clip={clip}
        clipIndex={0}
        clipStart={0}
        playhead={5}
        fps={30}
        readOnly={false}
        copy={studioEditorEn}
        onSetConstant={() => undefined}
        onSetCurve={() => undefined}
        onReset={() => undefined}
      />,
    );
    expect(html).not.toContain(studioEditorEn.cut.clip.speedSlowNote);
  });

  it('Round 2 R3 & S5: renders all 10 trimmed points with clear add-limit hint at >=8 points and attaches onPointerCancel to slider', () => {
    // S5: extracted hook-free slider view renders role="slider" with working onPointerCancel that cancels capture/drag
    const SliderView = (speedPanelMod as Record<string, unknown>).SpeedSliderTrack as
      | ((props: {
          label: string;
          constantRate: number;
          readOnly: boolean;
          trackRef: { current: HTMLDivElement | null };
          dragging: boolean;
          onCommit: (rate: number, coalesce?: boolean) => void;
          onDraggingChange: (dragging: boolean) => void;
        }) => { props: Record<string, unknown> })
      | undefined;
    expect(typeof SliderView).toBe('function');
    if (SliderView) {
      let dragging = false;
      const commits: Array<{ rate: number; coalesce?: boolean }> = [];
      const released: number[] = [];
      const tree = SliderView({
        label: 'Speed slider',
        constantRate: 1.0,
        readOnly: false,
        trackRef: { current: { getBoundingClientRect: () => ({ left: 0, width: 200 }) } as unknown as HTMLDivElement },
        dragging,
        onCommit: (rate, coalesce) => commits.push({ rate, coalesce }),
        onDraggingChange: (next) => {
          dragging = next;
        },
      });
      expect(typeof tree.props.onPointerCancel).toBe('function');
      const captured = new Set<number>();
      const fakeTarget = {
        focus: () => undefined,
        setPointerCapture: (id: number) => captured.add(id),
        hasPointerCapture: (id: number) => captured.has(id),
        releasePointerCapture: (id: number) => {
          captured.delete(id);
          released.push(id);
        },
      };
      (tree.props.onPointerDown as (e: unknown) => void)({ clientX: 100, pointerId: 7, currentTarget: fakeTarget });
      expect(dragging).toBe(true);
      const treeDuringDrag = SliderView({
        label: 'Speed slider',
        constantRate: 1.0,
        readOnly: false,
        trackRef: { current: { getBoundingClientRect: () => ({ left: 0, width: 200 }) } as unknown as HTMLDivElement },
        dragging,
        onCommit: (rate, coalesce) => commits.push({ rate, coalesce }),
        onDraggingChange: (next) => {
          dragging = next;
        },
      });
      (treeDuringDrag.props.onPointerCancel as (e: unknown) => void)({ pointerId: 7, currentTarget: fakeTarget });
      expect(dragging).toBe(false);
      expect(released).toEqual([7]);
    }

    // R3: 8-point curve extended at both ends -> renders all 10 point handles + clear limit hint in EN/KO
    const pts8 = Array.from({ length: 8 }, (_, i) => ({ pos: i / 7, speed: i % 2 === 0 ? 1.5 : 0.7 }));
    let seq10 = setClipSpeedCurve(makeSequenceWith([makeClip({ sourceFrames: 1200, inFrame: 200, frames: 120 })]), 0, pts8);
    seq10 = trimClipEdge(seq10, 0, 'start', -10).seq;
    seq10 = trimClipEdge(seq10, 0, 'end', 10).seq;
    const htmlEn = renderToStaticMarkup(
      <SpeedPanel
        clip={seq10.clips[0]!}
        clipIndex={0}
        clipStart={0}
        playhead={0}
        fps={30}
        readOnly={false}
        copy={studioEditorEn}
        onSetConstant={() => undefined}
        onSetCurve={() => undefined}
        onReset={() => undefined}
      />,
    );
    expect(htmlEn.match(/data-curve-point="/g)?.length).toBe(10);
    const enHint = (studioEditorEn.cut.clip as Record<string, string>).speedCurveLimitHint;
    expect(typeof enHint).toBe('string');
    expect(htmlEn).toContain(enHint);

    const htmlKo = renderToStaticMarkup(
      <SpeedPanel
        clip={seq10.clips[0]!}
        clipIndex={0}
        clipStart={0}
        playhead={0}
        fps={30}
        readOnly={false}
        copy={studioEditorKo}
        onSetConstant={() => undefined}
        onSetCurve={() => undefined}
        onReset={() => undefined}
      />,
    );
    const koHint = (studioEditorKo.cut.clip as Record<string, string>).speedCurveLimitHint;
    expect(typeof koHint).toBe('string');
    expect(htmlKo).toContain(koHint);
  });

  it('Round 3 B1: renders all 64 points selectable with clear delete/reset cap hint at 64 points', () => {
    const pts64 = Array.from({ length: 64 }, (_, i) => ({ pos: i / 63, speed: i % 2 === 0 ? 1.5 : 0.8 }));
    const seq64 = setClipSpeedCurve(makeSequenceWith([makeClip({ sourceFrames: 1200, inFrame: 100, frames: 200 })]), 0, pts64);
    const htmlEn = renderToStaticMarkup(
      <SpeedPanel
        clip={seq64.clips[0]!}
        clipIndex={0}
        clipStart={0}
        playhead={0}
        fps={30}
        readOnly={false}
        copy={studioEditorEn}
        onSetConstant={() => undefined}
        onSetCurve={() => undefined}
        onReset={() => undefined}
      />,
    );
    expect(htmlEn.match(/data-curve-point="/g)?.length).toBe(64);
    const capHintEn = (studioEditorEn.cut.clip as Record<string, string>).speedCurveCapHint;
    expect(typeof capHintEn).toBe('string');
    expect(htmlEn).toContain(capHintEn);

    const htmlKo = renderToStaticMarkup(
      <SpeedPanel
        clip={seq64.clips[0]!}
        clipIndex={0}
        clipStart={0}
        playhead={0}
        fps={30}
        readOnly={false}
        copy={studioEditorKo}
        onSetConstant={() => undefined}
        onSetCurve={() => undefined}
        onReset={() => undefined}
      />,
    );
    const capHintKo = (studioEditorKo.cut.clip as Record<string, string>).speedCurveCapHint;
    expect(typeof capHintKo).toBe('string');
    expect(htmlKo).toContain(capHintKo);
  });
});

function makeSequenceWith(clips: FrameClip[]): FrameSequence {
  return makeSeq(clips);
}
