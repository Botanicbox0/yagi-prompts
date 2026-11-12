import { describe, expect, it } from 'vitest';
import { GRADE_PRESETS } from '@/lib/brand-studio/compose/color-grade';
import {
  NLE_LUT_SIZE,
  buildCubeLut33,
  buildFcp7Xml,
  buildSrtSubtitles,
  buildZipArchive,
  crc32,
  escapeXml,
  exportProjectNleBundleZip,
  formatSrtTimestamp,
  layoutNleFrames,
  planNleMedia,
} from '@/lib/brand-studio/compose/nle-export';
import type {
  ComposeBgm,
  ComposeCaption,
  ComposeClip,
  ComposeColorGradeState,
  ComposerProject,
} from '@/lib/brand-studio/compose/timeline';

/* ------------------------------------------------------------------------------------------------ */
/* Fixtures                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

function clip(partial: Partial<ComposeClip> & { id: string }): ComposeClip {
  return {
    label: `Shot ${partial.id}`,
    sourceKind: 'asset',
    assetId: `asset-${partial.id}`,
    srcUrl: `https://media.example.com/clips/${partial.id}.mp4?token=abc`,
    durationSec: 6,
    trimStartSec: 0,
    trimEndSec: 6,
    volume: 1,
    muted: true,
    ...partial,
  };
}

function bgm(partial: Partial<ComposeBgm> = {}): ComposeBgm {
  return {
    label: 'Night Drive',
    sourceKind: 'asset',
    assetId: 'asset-bgm',
    srcUrl: 'https://media.example.com/audio/night-drive.mp3',
    durationSec: 60,
    trimStartSec: 0,
    volume: 0.4,
    ...partial,
  };
}

function caption(partial: Partial<ComposeCaption> & { id: string; text: string }): ComposeCaption {
  return { startSec: 0, endSec: 2, position: 'bottom', size: 'md', ...partial };
}

function grade(partial: Partial<ComposeColorGradeState> = {}): ComposeColorGradeState {
  return {
    enabled: true,
    scope: 'full_timeline',
    presetId: 'kodak-2383-warm',
    intensity: 0.85,
    skinProtect: 0.7,
    grain: 0,
    halation: 0,
    ...partial,
  };
}

function project(partial: Partial<ComposerProject> = {}): ComposerProject {
  return { version: 1, aspect: '9:16', clips: [], captions: [], bgm: null, colorGrade: null, ...partial };
}

interface ParsedClipItem {
  id: string;
  start: number;
  end: number;
  inFrame: number;
  outFrame: number;
  duration: number;
  body: string;
}

function parseClipItems(xml: string, idPattern: string): ParsedClipItem[] {
  const re = new RegExp(`<clipitem id="(${idPattern})">([\\s\\S]*?)</clipitem>`, 'g');
  const num = (body: string, tag: string) => Number(new RegExp(`<${tag}>(-?\\d+)</${tag}>`).exec(body)![1]);
  const items: ParsedClipItem[] = [];
  for (let match = re.exec(xml); match; match = re.exec(xml)) {
    const body = match[2]!;
    items.push({
      id: match[1]!,
      start: num(body, 'start'),
      end: num(body, 'end'),
      inFrame: num(body, 'in'),
      outFrame: num(body, 'out'),
      duration: num(body, 'duration'),
      body,
    });
  }
  return items;
}

const videoItems = (xml: string) => parseClipItems(xml, 'clipitem-\\d+');
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;
const sequenceDuration = (xml: string) => Number(/<name>[^<]*<\/name>\s*<duration>(\d+)<\/duration>/.exec(xml)![1]);

interface ParsedZipEntry {
  path: string;
  flags: number;
  method: number;
  crc: number;
  size: number;
  compressedSize: number;
  localOffset: number;
  bytes: Uint8Array;
}

/** Independent reader: walks the EOCD → central directory → local headers, the way an unzipper does. */
function parseZip(zip: Uint8Array): { entries: ParsedZipEntry[]; eocdOffset: number; centralOffset: number } {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const eocdOffset = zip.length - 22;
  expect(view.getUint32(eocdOffset, true)).toBe(0x06054b50);
  const total = view.getUint16(eocdOffset + 10, true);
  expect(view.getUint16(eocdOffset + 8, true)).toBe(total);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  expect(centralOffset + centralSize).toBe(eocdOffset);

  const entries: ParsedZipEntry[] = [];
  let pos = centralOffset;
  for (let i = 0; i < total; i += 1) {
    expect(view.getUint32(pos, true)).toBe(0x02014b50);
    const flags = view.getUint16(pos + 8, true);
    const method = view.getUint16(pos + 10, true);
    const crc = view.getUint32(pos + 16, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const size = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const path = decoder.decode(zip.subarray(pos + 46, pos + 46 + nameLen));

    // The local header must repeat the same facts.
    expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
    expect(view.getUint16(localOffset + 6, true)).toBe(flags);
    expect(view.getUint16(localOffset + 8, true)).toBe(method);
    expect(view.getUint32(localOffset + 14, true)).toBe(crc);
    expect(view.getUint32(localOffset + 18, true)).toBe(compressedSize);
    expect(view.getUint32(localOffset + 22, true)).toBe(size);
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    expect(decoder.decode(zip.subarray(localOffset + 30, localOffset + 30 + localNameLen))).toBe(path);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;

    entries.push({
      path,
      flags,
      method,
      crc,
      size,
      compressedSize,
      localOffset,
      bytes: zip.subarray(dataStart, dataStart + compressedSize),
    });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  expect(pos).toBe(eocdOffset);
  return { entries, eocdOffset, centralOffset };
}

const utf8 = (text: string) => new TextEncoder().encode(text);
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/* ------------------------------------------------------------------------------------------------ */
/* FCP7 xmeml                                                                                        */
/* ------------------------------------------------------------------------------------------------ */

describe('buildFcp7Xml', () => {
  it('opens with the xmeml v4 prolog and escapes every XML special character', () => {
    const xml = buildFcp7Xml(
      project({ clips: [clip({ id: 'a', label: `Tom & "Jerry" <cut> 'one'` })] }),
      { projectTitle: 'Spring <Launch> & Co' },
    );
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4">')).toBe(true);
    expect(xml.trimEnd().endsWith('</xmeml>')).toBe(true);
    expect(xml).toContain('<name>Spring &lt;Launch&gt; &amp; Co</name>');
    expect(xml).toContain('<name>Tom &amp; &quot;Jerry&quot; &lt;cut&gt; &apos;one&apos;</name>');
    expect(xml).not.toContain('<cut>');
    expect(escapeXml(`a\u0000b\u0008c&<>"'`)).toBe('abc&amp;&lt;&gt;&quot;&apos;');
  });

  it('lays decimal trims end to end on whole frames with no gap or overlap', () => {
    const clips = [
      clip({ id: 'a', trimStartSec: 0.33, trimEndSec: 4.67 }),
      clip({ id: 'b', trimStartSec: 1.01, trimEndSec: 2.99 }),
      clip({ id: 'c', trimStartSec: 0, trimEndSec: 3.37 }),
      clip({ id: 'd', trimStartSec: 2.2, trimEndSec: 2.21 }), // rounds to a zero-length span → forced to 1 frame
    ];
    const xml = buildFcp7Xml(project({ clips }));
    const items = videoItems(xml);
    expect(items.map((item) => item.id)).toEqual(['clipitem-1', 'clipitem-2', 'clipitem-3', 'clipitem-4']);

    expect(items[0]).toMatchObject({ start: 0, end: 130, inFrame: 10, outFrame: 140 });
    expect(items[1]).toMatchObject({ start: 130, end: 190, inFrame: 30, outFrame: 90 });
    expect(items[2]).toMatchObject({ start: 190, end: 291, inFrame: 0, outFrame: 101 });
    expect(items[3]).toMatchObject({ start: 291, end: 292, inFrame: 66, outFrame: 67 });

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]!;
      expect(item.end - item.start).toBe(item.outFrame - item.inFrame);
      expect(item.end).toBeGreaterThan(item.start);
      if (i > 0) expect(item.start).toBe(items[i - 1]!.end);
    }
    expect(sequenceDuration(xml)).toBe(292);
    expect(xml).toContain('<rate><timebase>30</timebase><ntsc>FALSE</ntsc></rate>');
  });

  it('keeps cuts contiguous at every supported frame rate', () => {
    const clips = Array.from({ length: 24 }, (_, i) => {
      const start = ((i * 37) % 23) / 7; // awkward decimals on purpose
      return clip({ id: `c${i}`, durationSec: 12, trimStartSec: start, trimEndSec: start + 0.3 + ((i * 53) % 41) / 9 });
    });
    for (const fps of [24, 25, 30, 60] as const) {
      const layout = layoutNleFrames(project({ clips }), { fps });
      expect(layout.timebase).toBe(fps);
      let cursor = 0;
      for (const frames of layout.clips) {
        expect(Number.isInteger(frames.inFrame) && Number.isInteger(frames.outFrame)).toBe(true);
        expect(frames.startFrame).toBe(cursor);
        expect(frames.endFrame - frames.startFrame).toBe(frames.outFrame - frames.inFrame);
        expect(frames.outFrame).toBeGreaterThan(frames.inFrame);
        cursor = frames.endFrame;
      }
      expect(layout.totalFrames).toBe(cursor);

      const xml = buildFcp7Xml(project({ clips }), { fps });
      expect(xml).toContain(`<timebase>${fps}</timebase>`);
      expect(videoItems(xml).map((item) => [item.start, item.end])).toEqual(
        layout.clips.map((frames) => [frames.startFrame, frames.endFrame]),
      );
    }
  });

  it('defines a shared source once and references it by id afterwards', () => {
    const clips = [
      // Same asset behind two differently signed URLs — still one source.
      clip({ id: 'a', assetId: 'asset-shared', srcUrl: 'https://cdn.example.com/v/shared.mp4?sig=1', durationSec: 10, trimStartSec: 0, trimEndSec: 3, label: 'Hero take' }),
      clip({ id: 'b', assetId: 'asset-other', srcUrl: 'https://cdn.example.com/v/other.mov', durationSec: 4, trimStartSec: 0, trimEndSec: 4, label: '제품 클로즈업' }),
      clip({ id: 'c', assetId: 'asset-shared', srcUrl: 'https://cdn.example.com/v/shared.mp4?sig=2', durationSec: 10, trimStartSec: 5, trimEndSec: 8, label: 'Hero take' }),
    ];
    const plan = planNleMedia(project({ clips }));
    expect(plan.clipSources).toHaveLength(2);
    expect(plan.clipSourceIndex).toEqual([0, 1, 0]);
    expect(plan.clipSources[0]!.filename).toMatch(/^01_hero_take_[0-9a-f]{6}\.mp4$/);
    expect(plan.clipSources[1]!.filename).toMatch(/^02_clip_[0-9a-f]{6}\.mov$/); // Korean label → ASCII fallback
    for (const source of plan.all) expect(source.path).toMatch(/^media\/[\x21-\x7e]+$/);

    const xml = buildFcp7Xml(project({ clips }));
    const items = videoItems(xml);
    expect(count(xml, '<file id="file-1">')).toBe(1);
    expect(count(xml, '<file id="file-1"/>')).toBe(1);
    expect(count(xml, '<file id="file-2">')).toBe(1);
    expect(items[0]!.body).toContain('<file id="file-1">');
    expect(items[0]!.body).toContain(`<pathurl>./media/${plan.clipSources[0]!.filename}</pathurl>`);
    expect(items[2]!.body).toContain('<file id="file-1"/>');
    expect(items[2]!.body).not.toContain('<pathurl>');
    expect(count(xml, '<pathurl>')).toBe(2);

    // Full source length (10 s → 300 frames) is kept so the editor has trim handles.
    const fileDuration = /<file id="file-1">[\s\S]*?<duration>(\d+)<\/duration>/.exec(xml)![1];
    expect(Number(fileDuration)).toBe(300);
    expect(items[0]!.duration).toBe(300);
    expect(items[2]!.duration).toBe(300);
    expect(items[0]!.body).toContain('<masterclipid>masterclip-1</masterclipid>');
    expect(items[2]!.body).toContain('<masterclipid>masterclip-1</masterclipid>');
  });

  it('never reports a source shorter than the out-point it is cut at', () => {
    const xml = buildFcp7Xml(project({ clips: [clip({ id: 'a', durationSec: 2, trimStartSec: 0, trimEndSec: 3 })] }));
    expect(Number(/<file id="file-1">[\s\S]*?<duration>(\d+)<\/duration>/.exec(xml)![1])).toBe(90);
  });

  it('puts the music on its own stereo track by default', () => {
    const clips = [clip({ id: 'a', trimEndSec: 4 }), clip({ id: 'b', trimEndSec: 3.5 })];
    const base = project({ clips, bgm: bgm({ trimStartSec: 2.5, volume: 0.4 }) });

    const xml = buildFcp7Xml(base); // includeBgm omitted
    const explicit = buildFcp7Xml(base, { includeBgm: true });
    expect(explicit).toBe(xml);

    const left = parseClipItems(xml, 'clipitem-bgm-\\d+-a1');
    const right = parseClipItems(xml, 'clipitem-bgm-\\d+-a2');
    expect(left).toHaveLength(1);
    expect(right).toHaveLength(1);
    expect(left[0]).toMatchObject({ start: 0, end: 225, inFrame: 75, outFrame: 300, duration: 1800 });
    expect(right[0]).toMatchObject({ start: 0, end: 225, inFrame: 75, outFrame: 300 });
    expect(left[0]!.body).toContain('<pathurl>./media/bgm_track.mp3</pathurl>');
    expect(right[0]!.body).toContain('<file id="file-3"/>');
    expect(left[0]!.body).toContain('<value>0.4</value>');
    expect(left[0]!.body).toContain('<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>');
    expect(right[0]!.body).toContain('<sourcetrack><mediatype>audio</mediatype><trackindex>2</trackindex></sourcetrack>');
    expect(planNleMedia(base).bgm).toMatchObject({ fileId: 'file-3', path: 'media/bgm_track.mp3' });
  });

  it('leaves the music out only when asked to, or when there is none', () => {
    const clips = [clip({ id: 'a' })];
    const off = buildFcp7Xml(project({ clips, bgm: bgm() }), { includeBgm: false });
    expect(off).not.toContain('bgm');
    expect(planNleMedia(project({ clips, bgm: bgm() }), { includeBgm: false }).bgm).toBeNull();

    const none = buildFcp7Xml(project({ clips, bgm: null }));
    expect(none).not.toContain('bgm');
    expect(planNleMedia(project({ clips, bgm: null })).bgm).toBeNull();
  });

  it('repeats a short music track to cover the timeline, as the editor does', () => {
    const xml = buildFcp7Xml(
      project({
        clips: [clip({ id: 'a', durationSec: 10, trimEndSec: 10 })],
        bgm: bgm({ durationSec: 4, trimStartSec: 1, srcUrl: 'https://cdn.example.com/a/Loop.WAV?x=1#t' }),
      }),
    );
    const left = parseClipItems(xml, 'clipitem-bgm-\\d+-a1');
    expect(left.map((item) => [item.start, item.end, item.inFrame, item.outFrame])).toEqual([
      [0, 90, 30, 120],
      [90, 180, 30, 120],
      [180, 270, 30, 120],
      [270, 300, 30, 60],
    ]);
    expect(xml).toContain('<pathurl>./media/bgm_track.wav</pathurl>');
    expect(count(xml, '<pathurl>./media/bgm_track.wav</pathurl>')).toBe(1);
  });

  it('exports clip sound as a linked stereo pair with its level, and skips muted clips', () => {
    const clips = [
      clip({ id: 'a', muted: true, volume: 1, trimEndSec: 2 }),
      clip({ id: 'b', muted: false, volume: 0.5, trimEndSec: 2 }),
      clip({ id: 'c', muted: false, volume: 0, trimEndSec: 2 }),
      clip({ id: 'd', muted: false, volume: 1, trimEndSec: 2 }),
    ];
    const xml = buildFcp7Xml(project({ clips }));
    const a1 = parseClipItems(xml, 'clipitem-\\d+-a1');
    const a2 = parseClipItems(xml, 'clipitem-\\d+-a2');
    expect(a1.map((item) => item.id)).toEqual(['clipitem-2-a1', 'clipitem-4-a1']);
    expect(a2.map((item) => item.id)).toEqual(['clipitem-2-a2', 'clipitem-4-a2']);

    // Audio sits exactly under its picture.
    const video = videoItems(xml);
    expect(a1[0]).toMatchObject({ start: video[1]!.start, end: video[1]!.end, inFrame: video[1]!.inFrame, outFrame: video[1]!.outFrame });
    expect(a1[0]!.body).toContain('<value>0.5</value>');
    expect(a1[1]!.body).not.toContain('<filter>');
    expect(a1[0]!.body).toContain('<file id="file-2"/>');

    // Picture and both channels point at each other.
    for (const body of [video[1]!.body, a1[0]!.body, a2[0]!.body]) {
      expect(body).toContain('<linkclipref>clipitem-2</linkclipref>');
      expect(body).toContain('<linkclipref>clipitem-2-a1</linkclipref>');
      expect(body).toContain('<linkclipref>clipitem-2-a2</linkclipref>');
    }
    expect(video[0]!.body).not.toContain('<link>');

    // Only sources that are heard declare audio.
    expect(/<file id="file-1">[\s\S]*?<\/file>/.exec(xml)![0]).not.toContain('<audio>');
    expect(/<file id="file-2">[\s\S]*?<\/file>/.exec(xml)![0]).toContain('<channelcount>2</channelcount>');
  });

  it('sizes the sequence from the aspect unless overridden', () => {
    const clips = [clip({ id: 'a' })];
    const size = (xml: string) => [Number(/<width>(\d+)<\/width>/.exec(xml)![1]), Number(/<height>(\d+)<\/height>/.exec(xml)![1])];
    expect(size(buildFcp7Xml(project({ clips, aspect: '9:16' })))).toEqual([1080, 1920]);
    expect(size(buildFcp7Xml(project({ clips, aspect: '4:5' })))).toEqual([1080, 1350]);
    expect(size(buildFcp7Xml(project({ clips, aspect: '1:1' })))).toEqual([1080, 1080]);
    expect(size(buildFcp7Xml(project({ clips, aspect: '16:9' })))).toEqual([1920, 1080]);
    expect(size(buildFcp7Xml(project({ clips, aspect: '16:9' }), { width: 3840, height: 2160 }))).toEqual([3840, 2160]);
  });

  it('marks scene changes, a partial grade region and the beat drop on the sequence', () => {
    const clips = [
      clip({ id: 'a', trimStartSec: 0, trimEndSec: 2 }),
      clip({ id: 'b', durationSec: 8, trimStartSec: 1, trimEndSec: 5, cutMarkers: [0.5, 3, 7] }),
    ];
    const xml = buildFcp7Xml(
      project({
        clips,
        bgm: bgm({ dropSyncSec: 2 }),
        colorGrade: grade({ scope: 'region', clipId: 'b', region: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 } }),
      }),
    );
    const markers: Array<{ name: string; comment: string; frame: number }> = [];
    const re = /<marker>\s*<name>([^<]*)<\/name>\s*<comment>([^<]*)<\/comment>\s*<in>(\d+)<\/in>\s*<out>-1<\/out>\s*<\/marker>/g;
    for (let match = re.exec(xml); match; match = re.exec(xml)) {
      markers.push({ name: match[1]!, comment: match[2]!, frame: Number(match[3]) });
    }
    // Clip b starts at frame 60 with in-point 30; the 3 s scene change is media frame 90 → timeline 120.
    // 0.5 s and 7 s fall outside the trimmed span and are dropped.
    expect(markers.filter((marker) => marker.name === '장면 전환').map((marker) => marker.frame)).toEqual([120]);

    const region = markers.find((marker) => marker.name === '부분 색보정 영역')!;
    expect(region.frame).toBe(60);
    expect(region.comment).toContain('왼쪽 10%');
    expect(region.comment).toContain('위 20%');
    expect(region.comment).toContain('너비 50%');
    expect(region.comment).toContain('높이 40%');
    expect(region.comment).toContain('grade.cube');

    expect(markers.find((marker) => marker.name === '비트 드롭')!.frame).toBe(60);
    expect(markers.map((marker) => marker.frame)).toEqual([...markers.map((marker) => marker.frame)].sort((a, b) => a - b));

    // A full-timeline grade needs no note.
    expect(buildFcp7Xml(project({ clips: [clip({ id: 'a' })], colorGrade: grade() }))).not.toContain('<marker>');
  });

  it('still produces a valid empty sequence', () => {
    const xml = buildFcp7Xml(project());
    expect(xml).toContain('<xmeml version="4">');
    expect(sequenceDuration(xml)).toBe(0);
    expect(xml).not.toContain('<clipitem');
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* .cube LUT                                                                                         */
/* ------------------------------------------------------------------------------------------------ */

function parseCube(cube: string): { header: string[]; rows: number[][] } {
  const header: string[] = [];
  const rows: number[][] = [];
  for (const line of cube.split('\n')) {
    if (line === '') continue;
    if (/^-?\d/.test(line)) rows.push(line.split(' ').map(Number));
    else header.push(line);
  }
  return { header, rows };
}

const rowIndex = (ri: number, gi: number, bi: number) => bi * NLE_LUT_SIZE * NLE_LUT_SIZE + gi * NLE_LUT_SIZE + ri;

describe('buildCubeLut33', () => {
  it('returns null without an active grade', () => {
    expect(buildCubeLut33(null)).toBeNull();
    expect(buildCubeLut33(undefined)).toBeNull();
    expect(buildCubeLut33(grade({ enabled: false }))).toBeNull();
  });

  it('writes a 33-point header and exactly 35,937 rows of six-decimal triples', () => {
    const cube = buildCubeLut33(grade(), 'My "Warm" Look ✨')!;
    const { header, rows } = parseCube(cube);
    expect(header).toEqual([
      'TITLE "My Warm Look"',
      'LUT_3D_SIZE 33',
      'DOMAIN_MIN 0.0 0.0 0.0',
      'DOMAIN_MAX 1.0 1.0 1.0',
    ]);
    expect(rows).toHaveLength(35937);
    const dataLines = cube.split('\n').filter((line) => /^\d/.test(line));
    expect(dataLines).toHaveLength(35937);
    expect(dataLines.filter((line) => !/^[01]\.\d{6} [01]\.\d{6} [01]\.\d{6}$/.test(line))).toEqual([]);
    expect(buildCubeLut33(grade())!).toContain('TITLE "2383 Film Print Warm"');
  });

  it('is the identity at zero intensity, with red changing fastest', () => {
    const { rows } = parseCube(buildCubeLut33(grade({ intensity: 0, halation: 0.2, skinProtect: 1 }))!);
    const last = NLE_LUT_SIZE - 1;
    expect(rows).toHaveLength(35937);
    let worst = 0;
    let i = 0;
    for (let bi = 0; bi <= last; bi += 1) {
      for (let gi = 0; gi <= last; gi += 1) {
        for (let ri = 0; ri <= last; ri += 1) {
          const row = rows[i]!;
          worst = Math.max(worst, Math.abs(row[0]! - ri / last), Math.abs(row[1]! - gi / last), Math.abs(row[2]! - bi / last));
          i += 1;
        }
      }
    }
    expect(worst).toBeLessThan(1e-4);
    expect(rows[1]).toEqual([0.03125, 0, 0]); // second row steps red
    expect(rows[NLE_LUT_SIZE]).toEqual([0, 0.03125, 0]); // row 33 steps green
    expect(rows[NLE_LUT_SIZE * NLE_LUT_SIZE]).toEqual([0, 0, 0.03125]); // row 1089 steps blue
    expect(rows[rows.length - 1]).toEqual([1, 1, 1]);
  });

  it('keeps every preset finite, inside 0..1, different from identity and monotonic on the grey ramp', () => {
    const last = NLE_LUT_SIZE - 1;
    for (const preset of GRADE_PRESETS) {
      const { rows } = parseCube(buildCubeLut33(grade({ presetId: preset.id, halation: 0.04 }))!);
      expect(rows).toHaveLength(35937);
      let moved = 0;
      let outOfRange = 0;
      rows.forEach((row, index) => {
        for (const value of row) {
          if (!Number.isFinite(value) || value < 0 || value > 1) outOfRange += 1;
        }
        const ri = index % NLE_LUT_SIZE;
        if (Math.abs(row[0]! - ri / last) > 1e-3) moved += 1;
      });
      expect(outOfRange).toBe(0);
      expect(moved).toBeGreaterThan(1000);

      let prev = [-1, -1, -1];
      for (let step = 0; step <= last; step += 1) {
        const row = rows[rowIndex(step, step, step)]!;
        for (let channel = 0; channel < 3; channel += 1) {
          expect(row[channel]!).toBeGreaterThanOrEqual(prev[channel]! - 1e-6);
        }
        prev = row;
      }
    }
  });

  it('scales with intensity and follows the preset direction', () => {
    const mid = rowIndex(16, 16, 16);
    const strong = parseCube(buildCubeLut33(grade({ presetId: 'kodak-2383-warm', intensity: 1 }))!).rows[mid]!;
    const half = parseCube(buildCubeLut33(grade({ presetId: 'kodak-2383-warm', intensity: 0.5 }))!).rows[mid]!;
    const cool = parseCube(buildCubeLut33(grade({ presetId: 'twings-french-blue', intensity: 1 }))!).rows[mid]!;

    expect(strong[0]! - strong[2]!).toBeGreaterThan(0.03); // warm print: red above blue on neutral grey
    expect(cool[2]! - cool[0]!).toBeGreaterThan(0.03); // french blue: blue above red
    for (let channel = 0; channel < 3; channel += 1) {
      expect(half[channel]! - 0.5).toBeCloseTo((strong[channel]! - 0.5) / 2, 4);
    }
  });

  it('holds warm skin tones closer to the original when skin protection is on', () => {
    const skin = rowIndex(26, 19, 16); // (0.8125, 0.59375, 0.5): hue 18°, inside the protected band
    const sky = rowIndex(8, 16, 28); // blue: outside the band
    const original = [26 / 32, 19 / 32, 16 / 32];
    const distance = (row: number[], target: number[]) => Math.hypot(row[0]! - target[0]!, row[1]! - target[1]!, row[2]! - target[2]!);

    const open = parseCube(buildCubeLut33(grade({ presetId: 'moody-teal-amber', intensity: 1, skinProtect: 0 }))!).rows;
    const guarded = parseCube(buildCubeLut33(grade({ presetId: 'moody-teal-amber', intensity: 1, skinProtect: 1 }))!).rows;

    expect(distance(open[skin]!, original)).toBeGreaterThan(0.02);
    expect(distance(guarded[skin]!, original)).toBeLessThan(distance(open[skin]!, original) * 0.25);
    expect(guarded[sky]).toEqual(open[sky]);
  });

  it('transfers a reference look and stays clamped', () => {
    const referenceProfile = {
      lumaMean: 0.42,
      lumaStd: 0.26,
      rMean: 0.5,
      gMean: 0.41,
      bMean: 0.33,
      rStd: 0.27,
      gStd: 0.25,
      bStd: 0.2,
      warmth: 0.3,
      contrast: 1.18,
      saturation: 1.2,
    };
    const { rows } = parseCube(buildCubeLut33(grade({ presetId: null, referenceProfile, referenceLabel: '레퍼런스 A', intensity: 1 }))!);
    expect(rows).toHaveLength(35937);
    expect(rows.flat().filter((value) => !Number.isFinite(value) || value < 0 || value > 1)).toEqual([]);
    const mid = rows[rowIndex(16, 16, 16)]!;
    expect(mid[0]!).toBeGreaterThan(mid[2]!); // the warm reference pulls grey toward red
    expect(buildCubeLut33(grade({ presetId: null, referenceProfile, referenceLabel: '레퍼런스 A' }))!).toContain('TITLE "A"');
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* SRT                                                                                               */
/* ------------------------------------------------------------------------------------------------ */

describe('buildSrtSubtitles', () => {
  it('returns null when there is nothing to say', () => {
    expect(buildSrtSubtitles([])).toBeNull();
    expect(buildSrtSubtitles([caption({ id: 'x', text: '   ' })])).toBeNull();
  });

  it('formats timestamps as HH:MM:SS,mmm', () => {
    expect(formatSrtTimestamp(0)).toBe('00:00:00,000');
    expect(formatSrtTimestamp(1.5)).toBe('00:00:01,500');
    expect(formatSrtTimestamp(59.9996)).toBe('00:01:00,000');
    expect(formatSrtTimestamp(3661.789)).toBe('01:01:01,789');
    expect(formatSrtTimestamp(-3)).toBe('00:00:00,000');
  });

  it('sorts by start time, numbers from one and keeps UTF-8 text clean', () => {
    const srt = buildSrtSubtitles([
      caption({ id: 'b', text: '두 번째 자막\r\n\r\n  둘째 줄  ', startSec: 4.25, endSec: 6.5 }),
      caption({ id: 'a', text: '첫 번째 자막', startSec: 0.5, endSec: 2 }),
      caption({ id: 'c', text: 'Third & last', startSec: 3600, endSec: 3601.007 }),
    ])!;
    expect(srt).toBe(
      [
        '1',
        '00:00:00,500 --> 00:00:02,000',
        '첫 번째 자막',
        '',
        '2',
        '00:00:04,250 --> 00:00:06,500',
        '두 번째 자막',
        '둘째 줄',
        '',
        '3',
        '01:00:00,000 --> 01:00:01,007',
        'Third & last',
        '',
      ].join('\n'),
    );
  });

  it('never writes a cue that ends before it starts', () => {
    const srt = buildSrtSubtitles([caption({ id: 'a', text: 'Hi', startSec: 2, endSec: 2 })])!;
    expect(srt).toContain('00:00:02,000 --> 00:00:02,001');
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* PKZIP                                                                                             */
/* ------------------------------------------------------------------------------------------------ */

describe('buildZipArchive', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(utf8('123456789'))).toBe(0xcbf43926);
    expect(crc32(utf8('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('writes local headers, a central directory and the end record a reader can walk', () => {
    const binary = new Uint8Array(70000);
    for (let i = 0; i < binary.length; i += 1) binary[i] = (i * 31 + 7) & 0xff;
    const source = [
      { path: 'project.xml', bytes: utf8('<xmeml version="4"/>') },
      { path: 'media/01_shot_a1b2c3.mp4', bytes: binary },
      { path: '자막/한글 파일.txt', bytes: utf8('안녕하세요') },
      { path: 'empty.bin', bytes: new Uint8Array() },
    ];
    const zip = buildZipArchive(source, { modifiedAt: new Date(2026, 10, 13, 14, 30, 20) });

    expect(Array.from(zip.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04
    const { entries, eocdOffset, centralOffset } = parseZip(zip);
    expect(Array.from(zip.subarray(centralOffset, centralOffset + 4))).toEqual([0x50, 0x4b, 0x01, 0x02]); // PK\x01\x02
    expect(Array.from(zip.subarray(eocdOffset, eocdOffset + 4))).toEqual([0x50, 0x4b, 0x05, 0x06]); // PK\x05\x06

    expect(entries.map((entry) => entry.path)).toEqual(source.map((entry) => entry.path));
    entries.forEach((entry, index) => {
      expect(entry.flags & 0x0800).toBe(0x0800); // UTF-8 names
      expect(entry.flags & ~0x0800).toBe(0); // no encryption, no data descriptor
      expect(entry.method).toBe(0); // STORE
      expect(entry.size).toBe(source[index]!.bytes.length);
      expect(entry.compressedSize).toBe(entry.size);
      expect(entry.crc).toBe(crc32(source[index]!.bytes));
      expect(crc32(entry.bytes)).toBe(entry.crc);
      expect(Array.from(entry.bytes.subarray(0, 64))).toEqual(Array.from(source[index]!.bytes.subarray(0, 64)));
      expect(entry.bytes.length).toBe(source[index]!.bytes.length);
    });
    expect(text(entries[2]!.bytes)).toBe('안녕하세요');

    // Exact size: nothing but headers, names and payloads.
    const nameBytes = source.reduce((sum, entry) => sum + utf8(entry.path).length, 0);
    const payload = source.reduce((sum, entry) => sum + entry.bytes.length, 0);
    expect(zip.length).toBe(source.length * (30 + 46) + nameBytes * 2 + payload + 22);

    // DOS timestamp of the given local time.
    const view = new DataView(zip.buffer);
    expect(view.getUint16(10, true)).toBe((14 << 11) | (30 << 5) | 10);
    expect(view.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (11 << 5) | 13);
  });

  it('writes a bare end record for an empty archive', () => {
    const zip = buildZipArchive([]);
    expect(zip.length).toBe(22);
    expect(Array.from(zip.subarray(0, 4))).toEqual([0x50, 0x4b, 0x05, 0x06]);
    expect(parseZip(zip).entries).toEqual([]);
  });

  it('normalises separators and refuses unsafe or duplicate paths', () => {
    const zip = buildZipArchive([{ path: '\\media\\a.mp4', bytes: utf8('x') }]);
    expect(parseZip(zip).entries[0]!.path).toBe('media/a.mp4');
    expect(() => buildZipArchive([{ path: '../evil.txt', bytes: utf8('x') }])).toThrow(/nle_zip_invalid_path/);
    expect(() => buildZipArchive([{ path: '', bytes: utf8('x') }])).toThrow(/nle_zip_invalid_path/);
    expect(() =>
      buildZipArchive([
        { path: 'a.txt', bytes: utf8('1') },
        { path: 'a.txt', bytes: utf8('2') },
      ]),
    ).toThrow(/nle_zip_duplicate_path/);
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* Bundle                                                                                            */
/* ------------------------------------------------------------------------------------------------ */

describe('exportProjectNleBundleZip', () => {
  const fullProject = () =>
    project({
      aspect: '4:5',
      clips: [
        clip({ id: 'a', assetId: 'asset-shared', srcUrl: 'https://cdn.example.com/v/shared.mp4?sig=1', trimStartSec: 0.33, trimEndSec: 4.67, label: 'Hero take' }),
        clip({ id: 'b', assetId: 'asset-b', srcUrl: 'https://cdn.example.com/v/b.mp4', trimEndSec: 3, label: 'Detail' }),
        clip({ id: 'c', assetId: 'asset-shared', srcUrl: 'https://cdn.example.com/v/shared.mp4?sig=2', trimStartSec: 5, trimEndSec: 6, label: 'Hero take' }),
      ],
      captions: [caption({ id: 'cap', text: '봄 신제품', startSec: 0, endSec: 2.5 })],
      bgm: bgm(),
      colorGrade: grade({ scope: 'region', region: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, grain: 2 }),
    });

  const fakeFetch = (calls: string[], failing: (url: string) => boolean = () => false) => async (url: string) => {
    calls.push(url);
    if (failing(url)) throw new Error('network down');
    return utf8(`bytes:${url}`);
  };

  it('bundles the project, LUT, subtitles, guide and every source including the music by default', async () => {
    const calls: string[] = [];
    const result = await exportProjectNleBundleZip(fullProject(), fakeFetch(calls), { projectTitle: '봄 캠페인: 1차/편집' });

    expect(result.filename).toBe('봄-캠페인-1차-편집-nle.zip');
    expect(Array.from(result.zipBytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);

    const { entries } = parseZip(result.zipBytes);
    const paths = entries.map((entry) => entry.path);
    expect(paths.slice(0, 4)).toEqual(['project.xml', 'grade.cube', 'captions.srt', 'README-KO.txt']);
    expect(paths.slice(4)).toEqual(result.mediaFiles);
    expect(result.mediaFiles).toHaveLength(3); // two unique clip sources + music
    expect(result.mediaFiles[2]).toBe('media/bgm_track.mp3');
    for (const entry of entries) expect(crc32(entry.bytes)).toBe(entry.crc);

    // The shared source is fetched once, through its first URL.
    expect(calls.sort()).toEqual([
      'https://cdn.example.com/v/b.mp4',
      'https://cdn.example.com/v/shared.mp4?sig=1',
      'https://media.example.com/audio/night-drive.mp3',
    ]);

    const byPath = new Map(entries.map((entry) => [entry.path, entry]));
    expect(text(byPath.get('project.xml')!.bytes)).toBe(result.xml);
    expect(text(byPath.get('grade.cube')!.bytes)).toBe(result.lutCube);
    expect(text(byPath.get('captions.srt')!.bytes)).toBe(result.srt);
    expect(text(byPath.get('media/bgm_track.mp3')!.bytes)).toBe('bytes:https://media.example.com/audio/night-drive.mp3');

    // Every path the sequence points at exists in the archive, and nothing extra is shipped.
    const referenced = Array.from(result.xml.matchAll(/<pathurl>\.\/([^<]+)<\/pathurl>/g), (match) => match[1]!);
    expect(referenced.sort()).toEqual([...result.mediaFiles].sort());

    expect(result.xml).toContain('<width>1080</width>');
    expect(result.xml).toContain('<height>1350</height>');
    expect(result.lutCube).toContain('LUT_3D_SIZE 33');
    expect(result.srt).toContain('봄 신제품');

    const readme = text(byPath.get('README-KO.txt')!.bytes);
    expect(readme).toContain('Premiere Pro');
    expect(readme).toContain('DaVinci Resolve');
    expect(readme).toContain('project.xml');
    expect(readme).toContain('grade.cube');
    expect(readme).toContain('captions.srt');
    expect(readme).toContain('1080×1350, 30fps');
    expect(readme).toContain('마스크');
    expect(readme).toContain('그레인');
    expect(readme).not.toContain('받지 못한 파일');
    expect(readme).not.toContain('비상업용');
  });

  it('drops the music from the sequence and the archive when includeBgm is false', async () => {
    const calls: string[] = [];
    const result = await exportProjectNleBundleZip(fullProject(), fakeFetch(calls), { includeBgm: false });
    expect(result.mediaFiles).toHaveLength(2);
    expect(result.mediaFiles.some((path) => path.includes('bgm'))).toBe(false);
    expect(calls.some((url) => url.includes('night-drive'))).toBe(false);
    expect(result.xml).not.toContain('bgm_track');
    expect(result.filename).toBe('project-nle.zip');
  });

  it('survives a file that cannot be fetched and says which one is missing', async () => {
    const calls: string[] = [];
    const result = await exportProjectNleBundleZip(
      fullProject(),
      fakeFetch(calls, (url) => url.endsWith('/b.mp4')),
    );
    expect(result.mediaFiles).toHaveLength(2);
    const missingPath = planNleMedia(fullProject()).clipSources[1]!.path;
    expect(result.mediaFiles).not.toContain(missingPath);

    const { entries } = parseZip(result.zipBytes);
    expect(entries.map((entry) => entry.path)).not.toContain(missingPath);
    const readme = text(entries.find((entry) => entry.path === 'README-KO.txt')!.bytes);
    expect(readme).toContain('받지 못한 파일');
    expect(readme).toContain(`${missingPath} (Detail)`);
    // The sequence still points at it, so dropping the file in place relinks it.
    expect(result.xml).toContain(`<pathurl>./${missingPath}</pathurl>`);
  });

  it('treats an empty download as missing', async () => {
    const result = await exportProjectNleBundleZip(
      project({ clips: [clip({ id: 'a' })] }),
      async () => new Uint8Array(),
    );
    expect(result.mediaFiles).toEqual([]);
    expect(text(parseZip(result.zipBytes).entries.find((entry) => entry.path === 'README-KO.txt')!.bytes)).toContain('받지 못한 파일');
  });

  it('builds a media-less bundle when no fetcher is supplied', async () => {
    const result = await exportProjectNleBundleZip(
      project({ clips: [clip({ id: 'a' })], bgm: bgm({ nonCommercialGuide: true }) }),
    );
    expect(result.mediaFiles).toEqual([]);
    expect(result.lutCube).toBeNull();
    expect(result.srt).toBeNull();

    const { entries } = parseZip(result.zipBytes);
    expect(entries.map((entry) => entry.path)).toEqual(['project.xml', 'README-KO.txt']);
    const readme = text(entries[1]!.bytes);
    expect(readme).toContain('원본 파일이 들어 있지 않습니다');
    expect(readme).toContain('media/bgm_track.mp3');
    expect(readme).toContain('비상업용 가이드 음악');
    expect(readme).not.toContain('grade.cube');
    expect(readme).not.toContain('captions.srt');
    // The music track is still on the timeline by default.
    expect(result.xml).toContain('clipitem-bgm-1-a1');
  });
});
