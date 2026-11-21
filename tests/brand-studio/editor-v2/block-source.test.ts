import { describe, expect, it } from 'vitest';
import { parseStoredProject, serializeProjectForStorage, type ComposeClip, type ComposerProject } from '@/lib/brand-studio/compose/timeline';
import { splitAtFrame, trimClipEdge } from '@/lib/brand-studio/editor-v2/frames';
import { frameBlockOf, fromStored, sourcesToMeasure, toStored, type MeasuredSources } from '@/lib/brand-studio/editor-v2/stored';

/**
 * Review round 1, item 4: frame data knows which file it was measured from.
 *
 * The current editor's upscale (and anything else that copies clip fields) can give a clip a new
 * `srcUrl` and keep its `frameV2`. A block whose file is not the clip's file describes other footage:
 * it is not used; the cut is rebuilt from its seconds and the new file is measured.
 */
const src = (id: string) => `/api/brand-studio/compose?organizationId=org&source=asset&id=${id}`;
const SRC = src('a24');
const UPSCALED = '/api/brand-studio/compose?organizationId=org&source=output&id=up4k';

function clip(id: string, trimStartSec: number, trimEndSec: number): ComposeClip {
  return { id, label: id, sourceKind: 'asset', assetId: 'a24', srcUrl: SRC, thumbUrl: null, durationSec: 10, trimStartSec, trimEndSec, volume: 1, muted: false };
}

const FILM: ComposerProject = parseStoredProject(JSON.stringify({ version: 1, aspect: '9:16', captions: [], bgm: null, clips: [clip('c1', 0.5, 3), clip('c2', 1, 4)] }))!;
const MEASURED: MeasuredSources = { [SRC]: { fps: 24, frames: 240 }, [UPSCALED]: { fps: 30, frames: 300 } };
const through = (project: ComposerProject) => parseStoredProject(serializeProjectForStorage(project))!;

/** A v2 film with frame-exact edits tenths cannot hold, as stored. */
function v2Film() {
  let seq = fromStored(FILM, MEASURED).sequence;
  seq = trimClipEdge(seq, 0, 'end', -1).seq;
  seq = splitAtFrame(seq, 31, 'piece');
  return { seq, stored: through(toStored(seq, FILM)) };
}

describe('frame data names the file it describes', () => {
  it('a block records the clip’s file and the footage length it was written for', () => {
    const { stored } = v2Film();
    for (const c of stored.clips) {
      const block = frameBlockOf(c)!;
      expect(block).not.toBeNull();
      expect(block.srcUrl).toBe(c.srcUrl);
      expect(block.durationSec).toBe(c.durationSec);
    }
  });

  it('a clip whose file changed (every other field the same) is rebuilt from seconds and its new file measured', () => {
    const { seq, stored } = v2Film();
    // The current editor's upscale: new address, the rest (frame data included) copied.
    const upscaled = through({ ...stored, clips: [{ ...stored.clips[0]!, srcUrl: UPSCALED }, ...stored.clips.slice(1)] });
    expect((upscaled.clips[0] as ComposeClip & { frameV2?: unknown }).frameV2).toEqual((stored.clips[0] as ComposeClip & { frameV2?: unknown }).frameV2);
    expect(frameBlockOf(upscaled.clips[0]!)).toBeNull();
    expect(sourcesToMeasure(upscaled)).toEqual([UPSCALED]);
    const film = fromStored(upscaled, MEASURED);
    expect(film.derived).toEqual([seq.clips[0]!.id]);
    expect(film.sequence.clips[0]!.sourceFps).toBe(30);
    expect(film.sequence.clips[0]!.srcUrl).toBe(UPSCALED);
    // The cuts whose file did not change stay exact.
    expect(film.exact).toEqual(seq.clips.slice(1).map((c) => c.id));
    expect(film.sequence.clips.slice(1)).toEqual(seq.clips.slice(1));
  });

  it('a clip whose footage length changed is not trusted either', () => {
    const { stored } = v2Film();
    const longer = through({ ...stored, clips: [{ ...stored.clips[0]!, durationSec: 12 }, ...stored.clips.slice(1)] });
    expect(frameBlockOf(longer.clips[0]!)).toBeNull();
  });

  it('a block that does not say which file it describes (written before this rule) is not trusted', () => {
    const { stored } = v2Film();
    const block = frameBlockOf(stored.clips[1]!)!;
    const { srcUrl: _src, durationSec: _length, ...older } = block;
    const old = through({ ...stored, clips: [stored.clips[0]!, { ...stored.clips[1]!, frameV2: older } as ComposeClip, ...stored.clips.slice(2)] });
    expect(frameBlockOf(old.clips[1]!)).toBeNull();
    expect(fromStored(old, MEASURED).derived).toEqual([stored.clips[1]!.id]);
  });
});
