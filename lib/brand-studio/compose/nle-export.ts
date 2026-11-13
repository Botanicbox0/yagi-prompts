/**
 * Premiere Pro / DaVinci Resolve hand-off bundle for the Editing Studio timeline.
 *
 * One ZIP holds everything an editor needs to continue the cut in a desktop NLE:
 * - `project.xml`   FCP7 `xmeml` v4 sequence (both NLEs import it natively)
 * - `grade.cube`    33-point 3D LUT of the timeline grade (when a grade is on)
 * - `captions.srt`  subtitles (when captions exist)
 * - `README-KO.txt` how to open the bundle
 * - `media/…`       the source clips and the music track
 *
 * Client-safe and dependency-free: pure TypeScript over `Uint8Array`, runs in the browser and in Node.
 *
 * Frame math is integer-only. Every clip is converted to whole frames once and the timeline position is
 * a running integer cursor, so neighbouring cuts can never leave a one-frame gap or overlap.
 */

import { computeReinhardTransferMatrix, findGradePreset, type GradePreset } from './color-grade';
import {
  COMPOSE_DIMENSIONS,
  normalizeColorGradeState,
  normalizeColorRegion,
  type ComposeCaption,
  type ComposeClip,
  type ComposeColorGradeState,
  type ComposerProject,
} from './timeline';

/** Minimal caption shape the subtitle writer needs; every `ComposeCaption` satisfies it. */
export type TimelineCaption = Pick<ComposeCaption, 'text' | 'startSec' | 'endSec'>;

export interface NleExportOptions {
  projectTitle?: string;
  fps?: 24 | 25 | 30 | 60;
  /** Defaults to `true` — timeline BGM is exported by default for user convenience. */
  includeBgm?: boolean;
  width?: number;
  height?: number;
}

export interface NleBundleResult {
  filename: string;
  zipBytes: Uint8Array;
  xml: string;
  lutCube: string | null;
  srt: string | null;
  mediaFiles: string[];
}

export const NLE_LUT_SIZE = 33;
export const NLE_MEDIA_DIR = 'media';
export const NLE_DEFAULT_FPS = 30;

const DEFAULT_TITLE = 'TWINGS Edit';
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'mkv'] as const;
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] as const;
const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_BIT_DEPTH = 16;
const MEDIA_FETCH_CONCURRENCY = 4;

/* ------------------------------------------------------------------------------------------------ */
/* Text helpers                                                                                      */
/* ------------------------------------------------------------------------------------------------ */

/** Drops characters XML 1.0 cannot carry (C0 controls other than tab, LF, CR, and the two non-characters). */
function stripXmlInvalidChars(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    const isControl = code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d;
    if (isControl || code === 0xfffe || code === 0xffff) continue;
    out += value[i];
  }
  return out;
}

export function escapeXml(value: string): string {
  return stripXmlInvalidChars(String(value ?? ''))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fnv1aHex(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function asciiSlug(value: string, fallback: string, maxLength = 24): string {
  const withoutExt = value.replace(/\.[A-Za-z0-9]{2,5}$/, '');
  const decomposed = withoutExt.normalize('NFKD');
  let ascii = '';
  for (let i = 0; i < decomposed.length; i += 1) {
    ascii += decomposed.charCodeAt(i) < 0x80 ? decomposed[i] : ' ';
  }
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLength)
    .replace(/_+$/g, '');
  return slug || fallback;
}

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
};

function inferExtension(url: string, label: string, allowed: readonly string[], fallback: string): string {
  const dataMime = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)/i.exec(url);
  if (dataMime) {
    const fromMime = MIME_EXTENSIONS[dataMime[1]!.toLowerCase()];
    if (fromMime && allowed.includes(fromMime)) return fromMime;
  } else {
    const path = url.split(/[?#]/)[0] ?? '';
    const fromUrl = /\.([A-Za-z0-9]{2,5})$/.exec(path);
    if (fromUrl && allowed.includes(fromUrl[1]!.toLowerCase())) return fromUrl[1]!.toLowerCase();
  }
  const fromLabel = /\.([A-Za-z0-9]{2,5})$/.exec(label.trim());
  if (fromLabel && allowed.includes(fromLabel[1]!.toLowerCase())) return fromLabel[1]!.toLowerCase();
  return fallback;
}

function finiteOr(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function resolveTitle(opts?: NleExportOptions): string {
  const title = stripXmlInvalidChars(opts?.projectTitle ?? '').trim();
  return title || DEFAULT_TITLE;
}

function resolveTimebase(opts?: NleExportOptions): number {
  const fps = opts?.fps;
  return fps === 24 || fps === 25 || fps === 30 || fps === 60 ? fps : NLE_DEFAULT_FPS;
}

function resolveDimensions(project: ComposerProject, opts?: NleExportOptions): { width: number; height: number } {
  const base = COMPOSE_DIMENSIONS[project.aspect] ?? COMPOSE_DIMENSIONS['9:16'];
  const pick = (value: number | undefined, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 2 ? Math.round(value) : fallback;
  return { width: pick(opts?.width, base.width), height: pick(opts?.height, base.height) };
}

function shouldIncludeBgm(project: ComposerProject, opts?: NleExportOptions): boolean {
  return opts?.includeBgm !== false && project.bgm != null;
}

/* ------------------------------------------------------------------------------------------------ */
/* Media plan — shared by the XML and the ZIP so `<pathurl>` and the bundled files always agree       */
/* ------------------------------------------------------------------------------------------------ */

export interface NleMediaSource {
  /** `file-1`, `file-2`, … — the xmeml `<file id>`. */
  fileId: string;
  kind: 'clip' | 'bgm' | 'overlay' | 'sfx';
  url: string;
  label: string;
  /** ASCII-safe name inside `media/`. */
  filename: string;
  /** `media/<filename>` — the ZIP entry path. */
  path: string;
}

export interface NleMediaPlan {
  /** Unique clip sources in first-use order. */
  clipSources: NleMediaSource[];
  /** For each timeline clip, the index into `clipSources`. */
  clipSourceIndex: number[];
  bgm: NleMediaSource | null;
  /** Unique V2 overlay sources in first-use order (present when project has overlays). */
  overlaySources?: NleMediaSource[];
  overlaySourceIndex?: number[];
  /** Unique A2 SFX sources in first-use order (present when project has SFX clips). */
  sfxSources?: NleMediaSource[];
  sfxSourceIndex?: number[];
  /** Every file the bundle expects under `media/`, clips first, then music, overlays, SFX. */
  all: NleMediaSource[];
}

function clipSourceKey(clip: ComposeClip): string {
  if (clip.assetId) return `asset:${clip.assetId}`;
  if (clip.outputId) return `output:${clip.outputId}`;
  return `url:${clip.srcUrl}`;
}

/** Decides which source files the bundle carries and what each is called. Deterministic for a given project. */
export function planNleMedia(project: ComposerProject, opts?: NleExportOptions): NleMediaPlan {
  const clipSources: NleMediaSource[] = [];
  const clipSourceIndex: number[] = [];
  const byKey = new Map<string, number>();

  for (const clip of project.clips) {
    const key = clipSourceKey(clip);
    let index = byKey.get(key);
    if (index === undefined) {
      index = clipSources.length;
      byKey.set(key, index);
      const ordinal = String(index + 1).padStart(2, '0');
      const ext = inferExtension(clip.srcUrl, clip.label, VIDEO_EXTENSIONS, 'mp4');
      const filename = `${ordinal}_${asciiSlug(clip.label, 'clip')}_${fnv1aHex(key).slice(0, 6)}.${ext}`;
      clipSources.push({
        fileId: `file-${index + 1}`,
        kind: 'clip',
        url: clip.srcUrl,
        label: clip.label,
        filename,
        path: `${NLE_MEDIA_DIR}/${filename}`,
      });
    }
    clipSourceIndex.push(index);
  }

  let nextFileNum = clipSources.length + 1;
  let bgm: NleMediaSource | null = null;
  if (shouldIncludeBgm(project, opts) && project.bgm) {
    const ext = inferExtension(project.bgm.srcUrl, project.bgm.label, AUDIO_EXTENSIONS, 'mp3');
    const filename = `bgm_track.${ext}`;
    bgm = {
      fileId: `file-${nextFileNum++}`,
      kind: 'bgm',
      url: project.bgm.srcUrl,
      label: project.bgm.label,
      filename,
      path: `${NLE_MEDIA_DIR}/${filename}`,
    };
  }

  const all: NleMediaSource[] = bgm ? [...clipSources, bgm] : [...clipSources];
  const overlaySources: NleMediaSource[] = [];
  const overlaySourceIndex: number[] = [];
  const overlayByKey = new Map<string, number>();
  for (const ov of project.overlays ?? []) {
    const key = ov.assetId ? `asset:${ov.assetId}` : ov.outputId ? `output:${ov.outputId}` : `url:${ov.srcUrl}`;
    let idx = overlayByKey.get(key);
    if (idx === undefined) {
      idx = overlaySources.length;
      overlayByKey.set(key, idx);
      const ordinal = String(idx + 1).padStart(2, '0');
      const fallbackExt = ov.mediaKind === 'image' ? 'png' : 'mp4';
      const allowedExts = ov.mediaKind === 'image' ? ['png', 'jpg', 'jpeg', 'webp'] : VIDEO_EXTENSIONS;
      const ext = inferExtension(ov.srcUrl, ov.label, allowedExts, fallbackExt);
      const filename = `ovl_${ordinal}_${asciiSlug(ov.label, 'overlay')}_${fnv1aHex(key).slice(0, 6)}.${ext}`;
      const src: NleMediaSource = {
        fileId: `file-${nextFileNum++}`,
        kind: 'overlay',
        url: ov.srcUrl,
        label: ov.label,
        filename,
        path: `${NLE_MEDIA_DIR}/${filename}`,
      };
      overlaySources.push(src);
      all.push(src);
    }
    overlaySourceIndex.push(idx);
  }

  const sfxSources: NleMediaSource[] = [];
  const sfxSourceIndex: number[] = [];
  const sfxByKey = new Map<string, number>();
  for (const sfx of project.sfxClips ?? []) {
    const key = sfx.assetId ? `asset:${sfx.assetId}` : `url:${sfx.srcUrl}`;
    let idx = sfxByKey.get(key);
    if (idx === undefined) {
      idx = sfxSources.length;
      sfxByKey.set(key, idx);
      const ordinal = String(idx + 1).padStart(2, '0');
      const ext = inferExtension(sfx.srcUrl, sfx.label, AUDIO_EXTENSIONS, 'wav');
      const filename = `sfx_${ordinal}_${asciiSlug(sfx.label, 'sfx')}_${fnv1aHex(key).slice(0, 6)}.${ext}`;
      const src: NleMediaSource = {
        fileId: `file-${nextFileNum++}`,
        kind: 'sfx',
        url: sfx.srcUrl,
        label: sfx.label,
        filename,
        path: `${NLE_MEDIA_DIR}/${filename}`,
      };
      sfxSources.push(src);
      all.push(src);
    }
    sfxSourceIndex.push(idx);
  }

  return {
    clipSources,
    clipSourceIndex,
    bgm,
    ...(overlaySources.length > 0 ? { overlaySources, overlaySourceIndex } : {}),
    ...(sfxSources.length > 0 ? { sfxSources, sfxSourceIndex } : {}),
    all,
  };
}

/* ------------------------------------------------------------------------------------------------ */
/* Integer frame layout                                                                              */
/* ------------------------------------------------------------------------------------------------ */

export interface NleClipFrames {
  clipIndex: number;
  /** Source in-point, in frames. */
  inFrame: number;
  /** Source out-point (exclusive), in frames. */
  outFrame: number;
  /** Timeline start, in frames. */
  startFrame: number;
  /** Timeline end (exclusive), in frames. Always equals the next clip's `startFrame`. */
  endFrame: number;
}

function toFrames(sec: number, timebase: number): number {
  return Math.round(finiteOr(sec, 0) * timebase);
}

/** Converts every clip to whole frames and lays them end to end on an integer cursor. */
export function layoutNleFrames(
  project: ComposerProject,
  opts?: NleExportOptions,
): { timebase: number; clips: NleClipFrames[]; totalFrames: number } {
  const timebase = resolveTimebase(opts);
  let cursorFrame = 0;
  const clips = project.clips.map((clip, clipIndex) => {
    const inFrame = Math.max(0, toFrames(clip.trimStartSec, timebase));
    const outFrame = Math.max(inFrame + 1, toFrames(clip.trimEndSec, timebase));
    const rate =
      typeof clip.playbackRate === 'number' && Number.isFinite(clip.playbackRate)
        ? Math.min(4, Math.max(0.25, clip.playbackRate))
        : 1;
    const clipFrames = Math.max(1, Math.round((outFrame - inFrame) / rate));
    const startFrame = cursorFrame;
    cursorFrame += clipFrames;
    return { clipIndex, inFrame, outFrame, startFrame, endFrame: cursorFrame };
  });
  return { timebase, clips, totalFrames: cursorFrame };
}

/* ------------------------------------------------------------------------------------------------ */
/* FCP7 xmeml v4                                                                                     */
/* ------------------------------------------------------------------------------------------------ */

class XmlLines {
  private readonly lines: string[] = [];
  add(depth: number, text: string): void {
    this.lines.push(`${'  '.repeat(depth)}${text}`);
  }
  tag(depth: number, name: string, value: string | number): void {
    this.add(depth, `<${name}>${typeof value === 'number' ? String(value) : escapeXml(value)}</${name}>`);
  }
  toString(): string {
    return `${this.lines.join('\n')}\n`;
  }
}

interface SequenceMarker {
  frame: number;
  name: string;
  comment: string;
}

function formatLevel(volume: number): string {
  const clamped = Math.min(1, Math.max(0, finiteOr(volume, 1)));
  return String(Math.round(clamped * 10000) / 10000);
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function gradeTargetClipIndex(project: ComposerProject, grade: ComposeColorGradeState): number | null {
  if (grade.clipId) {
    const byId = project.clips.findIndex((clip) => clip.id === grade.clipId);
    if (byId >= 0) return byId;
  }
  if (typeof grade.clipIndex === 'number' && grade.clipIndex >= 0 && grade.clipIndex < project.clips.length) {
    return grade.clipIndex;
  }
  return null;
}

function collectMarkers(
  project: ComposerProject,
  layout: ReturnType<typeof layoutNleFrames>,
  bgmIncluded: boolean,
): SequenceMarker[] {
  const { timebase, clips, totalFrames } = layout;
  const markers: SequenceMarker[] = [];

  // Detected scene changes that are still inside a clip's trimmed span.
  for (const frames of clips) {
    const clip = project.clips[frames.clipIndex]!;
    const cuts = (clip as ComposeClip & { cutPointsSec?: number[] }).cutPointsSec ?? clip.cutMarkers ?? [];
    for (const cutSec of cuts) {
      if (!Number.isFinite(cutSec)) continue;
      const mediaFrame = toFrames(cutSec, timebase);
      if (mediaFrame <= frames.inFrame || mediaFrame >= frames.outFrame) continue;
      markers.push({
        frame: frames.startFrame + (mediaFrame - frames.inFrame),
        name: '장면 전환',
        comment: `${clip.label} 안에서 장면이 바뀌는 지점`,
      });
    }
  }

  const grade = normalizeColorGradeState(project.colorGrade);
  if (grade && grade.scope !== 'full_timeline') {
    const targetIndex = gradeTargetClipIndex(project, grade);
    const targetFrames = targetIndex === null ? null : (clips[targetIndex] ?? null);
    const frame = targetFrames ? targetFrames.startFrame : 0;
    if (grade.scope === 'region') {
      const region = normalizeColorRegion(grade.region);
      markers.push({
        frame,
        name: '부분 색보정 영역',
        comment:
          `왼쪽 ${percent(region.x)}, 위 ${percent(region.y)}, 너비 ${percent(region.w)}, 높이 ${percent(region.h)}. ` +
          'grade.cube는 화면 전체에 적용되므로 이 영역에 마스크를 씌워 주세요.',
      });
    } else if (targetFrames) {
      markers.push({
        frame,
        name: '색보정 대상 컷',
        comment: 'grade.cube는 이 컷에만 적용해 주세요.',
      });
    }
  }

  const dropSec = project.bgm?.dropSyncSec;
  if (bgmIncluded && typeof dropSec === 'number' && Number.isFinite(dropSec)) {
    const frame = toFrames(dropSec, timebase);
    if (frame >= 0 && frame < Math.max(1, totalFrames)) {
      markers.push({ frame, name: '비트 드롭', comment: '음악의 드롭을 맞춘 컷 지점' });
    }
  }

  return markers.sort((a, b) => a.frame - b.frame);
}

export function buildFcp7Xml(project: ComposerProject, opts?: NleExportOptions): string {
  const title = resolveTitle(opts);
  const { width, height } = resolveDimensions(project, opts);
  const plan = planNleMedia(project, opts);
  const layout = layoutNleFrames(project, opts);
  const { timebase, clips: frames, totalFrames } = layout;
  const rate = `<rate><timebase>${timebase}</timebase><ntsc>FALSE</ntsc></rate>`;

  // Full untrimmed length per source, so the editor keeps trim handles on both sides of every cut.
  const sourceDuration = plan.clipSources.map(() => 1);
  const sourceHasAudio = plan.clipSources.map(() => false);
  const clipHasAudio = project.clips.map((clip) => !clip.muted && finiteOr(clip.volume, 1) > 0);
  frames.forEach((f) => {
    const clip = project.clips[f.clipIndex]!;
    const sourceIndex = plan.clipSourceIndex[f.clipIndex]!;
    sourceDuration[sourceIndex] = Math.max(
      sourceDuration[sourceIndex]!,
      f.outFrame,
      toFrames(clip.durationSec, timebase),
    );
    if (clipHasAudio[f.clipIndex]) sourceHasAudio[sourceIndex] = true;
  });

  const emittedFiles = new Set<string>();
  const xml = new XmlLines();

  /** First reference carries the full `<file>`; later ones are id-only, as the xmeml spec requires. */
  const addClipFile = (depth: number, sourceIndex: number) => {
    const source = plan.clipSources[sourceIndex]!;
    if (emittedFiles.has(source.fileId)) {
      xml.add(depth, `<file id="${source.fileId}"/>`);
      return;
    }
    emittedFiles.add(source.fileId);
    xml.add(depth, `<file id="${source.fileId}">`);
    xml.tag(depth + 1, 'name', source.filename);
    xml.tag(depth + 1, 'pathurl', `./${source.path}`);
    xml.add(depth + 1, rate);
    xml.tag(depth + 1, 'duration', sourceDuration[sourceIndex]!);
    xml.add(depth + 1, '<media>');
    xml.add(depth + 2, '<video>');
    xml.add(depth + 3, '<samplecharacteristics>');
    xml.add(depth + 4, rate);
    xml.add(depth + 3, '</samplecharacteristics>');
    xml.add(depth + 2, '</video>');
    if (sourceHasAudio[sourceIndex]) {
      xml.add(depth + 2, '<audio>');
      xml.add(depth + 3, '<samplecharacteristics>');
      xml.tag(depth + 4, 'depth', AUDIO_BIT_DEPTH);
      xml.tag(depth + 4, 'samplerate', AUDIO_SAMPLE_RATE);
      xml.add(depth + 3, '</samplecharacteristics>');
      xml.tag(depth + 3, 'channelcount', 2);
      xml.add(depth + 2, '</audio>');
    }
    xml.add(depth + 1, '</media>');
    xml.add(depth, '</file>');
  };

  const addLevelFilter = (depth: number, volume: number) => {
    xml.add(depth, '<filter>');
    xml.add(depth + 1, '<effect>');
    xml.tag(depth + 2, 'name', 'Audio Levels');
    xml.tag(depth + 2, 'effectid', 'audiolevels');
    xml.tag(depth + 2, 'effectcategory', 'audiolevels');
    xml.tag(depth + 2, 'effecttype', 'audiolevels');
    xml.tag(depth + 2, 'mediatype', 'audio');
    xml.add(depth + 2, '<parameter>');
    xml.tag(depth + 3, 'name', 'Level');
    xml.tag(depth + 3, 'parameterid', 'level');
    xml.tag(depth + 3, 'valuemin', 0);
    xml.tag(depth + 3, 'valuemax', '3.98109');
    xml.tag(depth + 3, 'value', formatLevel(volume));
    xml.add(depth + 2, '</parameter>');
    xml.add(depth + 1, '</effect>');
    xml.add(depth, '</filter>');
  };

  const addTimeRemapFilter = (depth: number, playbackRate: number) => {
    const pct = Math.round(playbackRate * 100);
    xml.add(depth, '<filter>');
    xml.add(depth + 1, '<effect>');
    xml.tag(depth + 2, 'name', 'Time Remap');
    xml.tag(depth + 2, 'effectid', 'timeremap');
    xml.tag(depth + 2, 'effectcategory', 'motion');
    xml.tag(depth + 2, 'effecttype', 'motion');
    xml.tag(depth + 2, 'mediatype', 'video');
    xml.add(depth + 2, '<parameter>');
    xml.tag(depth + 3, 'name', 'speed');
    xml.tag(depth + 3, 'parameterid', 'speed');
    xml.tag(depth + 3, 'valuemin', 25);
    xml.tag(depth + 3, 'valuemax', 400);
    xml.tag(depth + 3, 'value', pct);
    xml.add(depth + 2, '</parameter>');
    xml.add(depth + 1, '</effect>');
    xml.add(depth, '</filter>');
  };

  const addTransitionItem = (
    depth: number,
    transitionIn: 'cross_dissolve' | 'dip_to_black',
    durationFrames: number,
    cutFrame: number,
  ) => {
    const half = Math.max(1, Math.floor(durationFrames / 2));
    const tStart = Math.max(0, cutFrame - half);
    const tEnd = Math.max(tStart + 1, cutFrame + Math.max(1, durationFrames - half));
    xml.add(depth, '<transitionitem>');
    xml.add(depth + 1, rate);
    xml.tag(depth + 1, 'start', tStart);
    xml.tag(depth + 1, 'end', tEnd);
    xml.tag(depth + 1, 'alignment', 'center');
    xml.add(depth + 1, '<effect>');
    xml.tag(depth + 2, 'name', transitionIn === 'dip_to_black' ? 'Dip to Color Dissolve' : 'Cross Dissolve');
    xml.tag(depth + 2, 'effectid', transitionIn === 'dip_to_black' ? 'Dip to Color Dissolve' : 'Cross Dissolve');
    xml.tag(depth + 2, 'effectcategory', 'Dissolve');
    xml.tag(depth + 2, 'effecttype', 'transition');
    xml.tag(depth + 2, 'mediatype', 'video');
    xml.add(depth + 1, '</effect>');
    xml.add(depth, '</transitionitem>');
  };

  const addLink = (
    depth: number,
    ref: string,
    mediatype: 'video' | 'audio',
    trackIndex: number,
    clipIndex: number,
  ) => {
    xml.add(depth, '<link>');
    xml.tag(depth + 1, 'linkclipref', ref);
    xml.tag(depth + 1, 'mediatype', mediatype);
    xml.tag(depth + 1, 'trackindex', trackIndex);
    xml.tag(depth + 1, 'clipindex', clipIndex);
    if (mediatype === 'audio') xml.tag(depth + 1, 'groupindex', 1);
    xml.add(depth, '</link>');
  };

  // Position of each audible clip inside the clip-audio tracks (muted clips leave no audio item).
  const audioClipOrdinal: number[] = [];
  let audibleCount = 0;
  clipHasAudio.forEach((audible, index) => {
    audioClipOrdinal[index] = audible ? (audibleCount += 1) : 0;
  });

  const addClipLinks = (depth: number, clipIndex: number) => {
    if (!clipHasAudio[clipIndex]) return;
    const n = clipIndex + 1;
    addLink(depth, `clipitem-${n}`, 'video', 1, n);
    addLink(depth, `clipitem-${n}-a1`, 'audio', 1, audioClipOrdinal[clipIndex]!);
    addLink(depth, `clipitem-${n}-a2`, 'audio', 2, audioClipOrdinal[clipIndex]!);
  };

  xml.add(0, '<?xml version="1.0" encoding="UTF-8"?>');
  xml.add(0, '<!DOCTYPE xmeml>');
  xml.add(0, '<xmeml version="4">');
  xml.add(1, '<sequence id="sequence-1">');
  xml.tag(2, 'name', title);
  xml.tag(2, 'duration', totalFrames);
  xml.add(2, rate);
  xml.tag(2, 'in', -1);
  xml.tag(2, 'out', -1);
  xml.add(2, '<timecode>');
  xml.add(3, rate);
  xml.tag(3, 'string', '00:00:00:00');
  xml.tag(3, 'frame', 0);
  xml.tag(3, 'displayformat', 'NDF');
  xml.add(2, '</timecode>');
  xml.add(2, '<media>');

  // ---- video ----
  xml.add(3, '<video>');
  xml.add(4, '<format>');
  xml.add(5, '<samplecharacteristics>');
  xml.add(6, rate);
  xml.tag(6, 'width', width);
  xml.tag(6, 'height', height);
  xml.tag(6, 'anamorphic', 'FALSE');
  xml.tag(6, 'pixelaspectratio', 'square');
  xml.tag(6, 'fielddominance', 'none');
  xml.add(5, '</samplecharacteristics>');
  xml.add(4, '</format>');
  xml.add(4, '<track>');
  for (const f of frames) {
    const clip = project.clips[f.clipIndex]!;
    const sourceIndex = plan.clipSourceIndex[f.clipIndex]!;
    if (clip.transitionIn === 'cross_dissolve' || clip.transitionIn === 'dip_to_black') {
      const tFrames = Math.max(2, toFrames(clip.transitionDurationSec ?? 0.4, timebase));
      addTransitionItem(5, clip.transitionIn, tFrames, f.startFrame);
    }
    xml.add(5, `<clipitem id="clipitem-${f.clipIndex + 1}">`);
    xml.tag(6, 'masterclipid', `masterclip-${sourceIndex + 1}`);
    xml.tag(6, 'name', clip.label);
    xml.tag(6, 'enabled', 'TRUE');
    xml.tag(6, 'duration', sourceDuration[sourceIndex]!);
    xml.add(6, rate);
    xml.tag(6, 'start', f.startFrame);
    xml.tag(6, 'end', f.endFrame);
    xml.tag(6, 'in', f.inFrame);
    xml.tag(6, 'out', f.outFrame);
    addClipFile(6, sourceIndex);
    if (typeof clip.playbackRate === 'number' && Math.abs(clip.playbackRate - 1) >= 0.01) {
      addTimeRemapFilter(6, clip.playbackRate);
    }
    addClipLinks(6, f.clipIndex);
    xml.add(5, '</clipitem>');
  }
  xml.tag(5, 'enabled', 'TRUE');
  xml.tag(5, 'locked', 'FALSE');
  xml.add(4, '</track>');
  if (project.overlays && project.overlays.length > 0 && plan.overlaySources && plan.overlaySourceIndex) {
    xml.add(4, '<track>');
    project.overlays.forEach((overlay, idx) => {
      const srcIdx = plan.overlaySourceIndex![idx]!;
      const source = plan.overlaySources![srcIdx]!;
      const startFrame = Math.max(0, toFrames(overlay.startSec, timebase));
      const endFrame = Math.max(startFrame + 1, toFrames(overlay.endSec, timebase));
      const durFrames = endFrame - startFrame;
      xml.add(5, `<clipitem id="clipitem-v2-${idx + 1}">`);
      xml.tag(6, 'masterclipid', `masterclip-v2-${srcIdx + 1}`);
      xml.tag(6, 'name', overlay.label || 'Overlay');
      xml.tag(6, 'enabled', 'TRUE');
      xml.tag(6, 'duration', durFrames);
      xml.add(6, rate);
      xml.tag(6, 'start', startFrame);
      xml.tag(6, 'end', endFrame);
      xml.tag(6, 'in', 0);
      xml.tag(6, 'out', durFrames);
      if (emittedFiles.has(source.fileId)) {
        xml.add(6, `<file id="${source.fileId}"/>`);
      } else {
        emittedFiles.add(source.fileId);
        xml.add(6, `<file id="${source.fileId}">`);
        xml.tag(7, 'name', source.filename);
        xml.tag(7, 'pathurl', `./${source.path}`);
        xml.add(7, rate);
        xml.tag(7, 'duration', durFrames);
        xml.add(7, '<media>');
        xml.add(8, '<video>');
        xml.add(9, '<samplecharacteristics>');
        xml.add(10, rate);
        xml.tag(10, 'width', width);
        xml.tag(10, 'height', height);
        xml.add(9, '</samplecharacteristics>');
        xml.add(8, '</video>');
        xml.add(7, '</media>');
        xml.add(6, '</file>');
      }
      xml.add(5, '</clipitem>');
    });
    xml.tag(5, 'enabled', 'TRUE');
    xml.tag(5, 'locked', 'FALSE');
    xml.add(4, '</track>');
  }
  xml.add(3, '</video>');

  // ---- audio ----
  xml.add(3, '<audio>');
  xml.tag(4, 'numOutputChannels', 2);
  xml.add(4, '<format>');
  xml.add(5, '<samplecharacteristics>');
  xml.tag(6, 'depth', AUDIO_BIT_DEPTH);
  xml.tag(6, 'samplerate', AUDIO_SAMPLE_RATE);
  xml.add(5, '</samplecharacteristics>');
  xml.add(4, '</format>');
  xml.add(4, '<outputs>');
  for (const channel of [1, 2]) {
    xml.add(5, '<group>');
    xml.tag(6, 'index', channel);
    xml.tag(6, 'numchannels', 1);
    xml.tag(6, 'downmix', 0);
    xml.add(6, `<channel><index>${channel}</index></channel>`);
    xml.add(5, '</group>');
  }
  xml.add(4, '</outputs>');

  // A1/A2: each clip's own sound as a linked stereo pair.
  if (frames.length > 0) {
    for (const channel of [1, 2] as const) {
      xml.add(4, '<track>');
      for (const f of frames) {
        if (!clipHasAudio[f.clipIndex]) continue;
        const clip = project.clips[f.clipIndex]!;
        const sourceIndex = plan.clipSourceIndex[f.clipIndex]!;
        const offsetFrames = toFrames(clip.audioOffsetSec ?? 0, timebase);
        const aStart = Math.max(0, f.startFrame + offsetFrames);
        const aEnd = Math.max(aStart + 1, f.endFrame + offsetFrames);
        xml.add(5, `<clipitem id="clipitem-${f.clipIndex + 1}-a${channel}">`);
        xml.tag(6, 'masterclipid', `masterclip-${sourceIndex + 1}`);
        xml.tag(6, 'name', clip.label);
        xml.tag(6, 'enabled', 'TRUE');
        xml.tag(6, 'duration', sourceDuration[sourceIndex]!);
        xml.add(6, rate);
        xml.tag(6, 'start', aStart);
        xml.tag(6, 'end', aEnd);
        xml.tag(6, 'in', f.inFrame);
        xml.tag(6, 'out', f.outFrame);
        addClipFile(6, sourceIndex);
        xml.add(6, `<sourcetrack><mediatype>audio</mediatype><trackindex>${channel}</trackindex></sourcetrack>`);
        if (finiteOr(clip.volume, 1) < 1) addLevelFilter(6, clip.volume);
        addClipLinks(6, f.clipIndex);
        xml.add(5, '</clipitem>');
      }
      xml.tag(5, 'enabled', 'TRUE');
      xml.tag(5, 'locked', 'FALSE');
      xml.tag(5, 'outputchannelindex', channel);
      xml.add(4, '</track>');
    }
  }

  // Music: its own stereo pair, cut to the timeline length. The editor loops a short track, so the
  // sequence repeats it the same way instead of leaving the tail silent.
  const bgm = plan.bgm && project.bgm ? { source: plan.bgm, state: project.bgm } : null;
  if (bgm && totalFrames > 0) {
    const bgmTotal = Math.max(1, toFrames(bgm.state.durationSec, timebase));
    const minPlayable = Math.min(bgmTotal, Math.max(1, Math.ceil(timebase / 2)));
    const bgmIn = Math.min(Math.max(0, toFrames(bgm.state.trimStartSec ?? 0, timebase)), bgmTotal - minPlayable);
    const playable = bgmTotal - bgmIn;
    const segments: Array<{ start: number; end: number }> = [];
    for (let cursor = 0; cursor < totalFrames; cursor += playable) {
      segments.push({ start: cursor, end: Math.min(totalFrames, cursor + playable) });
    }
    const baseTrack = frames.length > 0 ? 2 : 0;

    for (const channel of [1, 2] as const) {
      xml.add(4, '<track>');
      segments.forEach((segment, segmentIndex) => {
        const n = segmentIndex + 1;
        xml.add(5, `<clipitem id="clipitem-bgm-${n}-a${channel}">`);
        xml.tag(6, 'masterclipid', 'masterclip-bgm');
        xml.tag(6, 'name', bgm.state.label || 'Music');
        xml.tag(6, 'enabled', 'TRUE');
        xml.tag(6, 'duration', bgmTotal);
        xml.add(6, rate);
        xml.tag(6, 'start', segment.start);
        xml.tag(6, 'end', segment.end);
        xml.tag(6, 'in', bgmIn);
        xml.tag(6, 'out', bgmIn + (segment.end - segment.start));
        if (emittedFiles.has(bgm.source.fileId)) {
          xml.add(6, `<file id="${bgm.source.fileId}"/>`);
        } else {
          emittedFiles.add(bgm.source.fileId);
          xml.add(6, `<file id="${bgm.source.fileId}">`);
          xml.tag(7, 'name', bgm.source.filename);
          xml.tag(7, 'pathurl', `./${bgm.source.path}`);
          xml.add(7, rate);
          xml.tag(7, 'duration', bgmTotal);
          xml.add(7, '<media>');
          xml.add(8, '<audio>');
          xml.add(9, '<samplecharacteristics>');
          xml.tag(10, 'depth', AUDIO_BIT_DEPTH);
          xml.tag(10, 'samplerate', AUDIO_SAMPLE_RATE);
          xml.add(9, '</samplecharacteristics>');
          xml.tag(9, 'channelcount', 2);
          xml.add(8, '</audio>');
          xml.add(7, '</media>');
          xml.add(6, '</file>');
        }
        xml.add(6, `<sourcetrack><mediatype>audio</mediatype><trackindex>${channel}</trackindex></sourcetrack>`);
        if (finiteOr(bgm.state.volume, 1) < 1) addLevelFilter(6, bgm.state.volume);
        addLink(6, `clipitem-bgm-${n}-a1`, 'audio', baseTrack + 1, n);
        addLink(6, `clipitem-bgm-${n}-a2`, 'audio', baseTrack + 2, n);
        xml.add(5, '</clipitem>');
      });
      xml.tag(5, 'enabled', 'TRUE');
      xml.tag(5, 'locked', 'FALSE');
      xml.tag(5, 'outputchannelindex', channel);
      xml.add(4, '</track>');
    }
  }
  if (project.sfxClips && project.sfxClips.length > 0 && plan.sfxSources && plan.sfxSourceIndex) {
    const sfxBaseTrack = (frames.length > 0 ? 2 : 0) + (bgm && totalFrames > 0 ? 2 : 0);
    for (const channel of [1, 2] as const) {
      xml.add(4, '<track>');
      project.sfxClips.forEach((sfx, idx) => {
        const srcIdx = plan.sfxSourceIndex![idx]!;
        const source = plan.sfxSources![srcIdx]!;
        const n = idx + 1;
        const startFrame = Math.max(0, toFrames(sfx.startSec, timebase));
        const durFrames = Math.max(1, toFrames(sfx.durationSec, timebase));
        xml.add(5, `<clipitem id="clipitem-sfx-${n}-a${channel}">`);
        xml.tag(6, 'masterclipid', `masterclip-sfx-${srcIdx + 1}`);
        xml.tag(6, 'name', sfx.label || 'SFX');
        xml.tag(6, 'enabled', 'TRUE');
        xml.tag(6, 'duration', durFrames);
        xml.add(6, rate);
        xml.tag(6, 'start', startFrame);
        xml.tag(6, 'end', startFrame + durFrames);
        xml.tag(6, 'in', 0);
        xml.tag(6, 'out', durFrames);
        if (emittedFiles.has(source.fileId)) {
          xml.add(6, `<file id="${source.fileId}"/>`);
        } else {
          emittedFiles.add(source.fileId);
          xml.add(6, `<file id="${source.fileId}">`);
          xml.tag(7, 'name', source.filename);
          xml.tag(7, 'pathurl', `./${source.path}`);
          xml.add(7, rate);
          xml.tag(7, 'duration', durFrames);
          xml.add(7, '<media>');
          xml.add(8, '<audio>');
          xml.add(9, '<samplecharacteristics>');
          xml.tag(10, 'depth', AUDIO_BIT_DEPTH);
          xml.tag(10, 'samplerate', AUDIO_SAMPLE_RATE);
          xml.add(9, '</samplecharacteristics>');
          xml.tag(9, 'channelcount', 2);
          xml.add(8, '</audio>');
          xml.add(7, '</media>');
          xml.add(6, '</file>');
        }
        xml.add(6, `<sourcetrack><mediatype>audio</mediatype><trackindex>${channel}</trackindex></sourcetrack>`);
        if (finiteOr(sfx.volume, 1) < 1) addLevelFilter(6, sfx.volume);
        addLink(6, `clipitem-sfx-${n}-a1`, 'audio', sfxBaseTrack + 1, n);
        addLink(6, `clipitem-sfx-${n}-a2`, 'audio', sfxBaseTrack + 2, n);
        xml.add(5, '</clipitem>');
      });
      xml.tag(5, 'enabled', 'TRUE');
      xml.tag(5, 'locked', 'FALSE');
      xml.tag(5, 'outputchannelindex', channel);
      xml.add(4, '</track>');
    }
  }
  xml.add(3, '</audio>');
  xml.add(2, '</media>');

  for (const marker of collectMarkers(project, layout, bgm !== null)) {
    xml.add(2, '<marker>');
    xml.tag(3, 'name', marker.name);
    xml.tag(3, 'comment', marker.comment);
    xml.tag(3, 'in', marker.frame);
    xml.tag(3, 'out', -1);
    xml.add(2, '</marker>');
  }

  xml.add(1, '</sequence>');
  xml.add(0, '</xmeml>');
  return xml.toString();
}

/* ------------------------------------------------------------------------------------------------ */
/* 33-point 3D LUT                                                                                   */
/* ------------------------------------------------------------------------------------------------ */

function clamp01(value: number): number {
  if (!(value > 0)) return 0; // also catches NaN
  return value >= 1 ? 1 : value;
}

/**
 * Warm skin-band membership, the same `15°..45°` band (with `8°` ramps) the in-app grade protects.
 * The app cuts the band off hard at saturation 0.08 and 0.78; a 33-point lattice cannot hold a step,
 * so the LUT eases across those two edges instead of baking a contour into skin.
 */
function skinBandWeight(r: number, g: number, b: number): number {
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  const delta = maxC - minC;
  if (delta < 1e-5 || maxC < 1e-5) return 0;

  let hue = 0;
  if (maxC === r) hue = ((g - b) / delta) % 6;
  else if (maxC === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  let hueDeg = hue * 60;
  if (hueDeg < 0) hueDeg += 360;

  let hueWeight = 0;
  if (hueDeg >= 15 && hueDeg <= 45) hueWeight = 1;
  else if (hueDeg >= 7 && hueDeg < 15) hueWeight = (hueDeg - 7) / 8;
  else if (hueDeg > 45 && hueDeg <= 53) hueWeight = (53 - hueDeg) / 8;
  if (hueWeight <= 0) return 0;

  const sat = delta / maxC;
  const satWeight = Math.min(clamp01((sat - 0.04) / 0.04), clamp01((0.86 - sat) / 0.08));
  return hueWeight * satWeight;
}

interface LutGrade {
  intensity: number;
  skinProtect: number;
  halation: number;
  preset: GradePreset | null;
  hasReference: boolean;
  matrix: number[];
}

function resolveLutGrade(grade: ComposeColorGradeState): LutGrade {
  const intensity = clamp01(finiteOr(grade.intensity, 0.85));
  const preset = findGradePreset(grade.presetId);
  const reference = grade.referenceProfile ?? null;
  // A LUT has no frame to measure, so a reference look is transferred from a neutral source profile.
  const matrix = reference
    ? computeReinhardTransferMatrix(null, reference, intensity)
    : [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
  return {
    intensity,
    skinProtect: clamp01(finiteOr(grade.skinProtect, 0.7)),
    halation: Math.min(0.2, Math.max(0, finiteOr(grade.halation, 0))) * intensity,
    preset,
    hasReference: reference !== null,
    matrix,
  };
}

/** Per-colour grade, mirroring `applyColorGradeToCanvasContext` minus the spatial parts (grain, region feather). */
function gradeColor(r0: number, g0: number, b0: number, look: LutGrade): [number, number, number] {
  const { intensity, preset, matrix } = look;
  if (intensity <= 0) return [r0, g0, b0];

  let r1 = matrix[0]! * r0 + matrix[1]! * g0 + matrix[2]! * b0 + matrix[4]!;
  let g1 = matrix[5]! * r0 + matrix[6]! * g0 + matrix[7]! * b0 + matrix[9]!;
  let b1 = matrix[10]! * r0 + matrix[11]! * g0 + matrix[12]! * b0 + matrix[14]!;

  if (preset && look.hasReference) {
    const pMix = intensity * 0.35;
    r1 += pMix * (r0 * preset.gainR + preset.liftR - r0);
    g1 += pMix * (g0 * preset.gainG + preset.liftG - g0);
    b1 += pMix * (b0 * preset.gainB + preset.liftB - b0);
  } else if (preset) {
    const pr = 0.5 + (r0 * preset.gainR + preset.liftR - 0.5) * preset.contrast;
    const pg = 0.5 + (g0 * preset.gainG + preset.liftG - 0.5) * preset.contrast;
    const pb = 0.5 + (b0 * preset.gainB + preset.liftB - 0.5) * preset.contrast;
    const lum = 0.2126 * pr + 0.7152 * pg + 0.0722 * pb;
    r1 = r0 + intensity * (lum + (pr - lum) * preset.saturation - r0);
    g1 = g0 + intensity * (lum + (pg - lum) * preset.saturation - g0);
    b1 = b0 + intensity * (lum + (pb - lum) * preset.saturation - b0);
  }

  if (look.skinProtect > 0) {
    const skin = skinBandWeight(r0, g0, b0);
    if (skin > 0) {
      const protect = Math.min(0.9, Math.max(0, skin * look.skinProtect * 0.85));
      r1 = r1 * (1 - protect) + r0 * protect;
      g1 = g1 * (1 - protect) + g0 * protect;
      b1 = b1 * (1 - protect) + b0 * protect;
    }
  }

  if (look.halation > 0) {
    const luma = 0.2126 * r1 + 0.7152 * g1 + 0.0722 * b1;
    if (luma > 0.76) {
      const glow = ((luma - 0.76) / 0.24) * look.halation * 0.6;
      r1 += glow * 1.15;
      g1 += glow * 0.75;
      b1 += glow * 0.45;
    }
  }

  return [clamp01(r1), clamp01(g1), clamp01(b1)];
}

function cubeTitle(grade: ComposeColorGradeState, title?: string): string {
  const preset = findGradePreset(grade.presetId);
  const raw = title ?? preset?.titleEn ?? grade.referenceLabel ?? 'TWINGS Grade';
  let ascii = '';
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    if (code >= 0x20 && code < 0x7f && raw[i] !== '"') ascii += raw[i];
  }
  return ascii.replace(/\s+/g, ' ').trim().slice(0, 96) || 'TWINGS Grade';
}

/**
 * Adobe / Resolve `.cube` 3D LUT, 33 points per axis, red changing fastest.
 * `null` when no grade is on. Film grain is spatial noise and cannot live in a LUT, so it is left out.
 */
export function buildCubeLut33(grade: ComposeColorGradeState | null | undefined, title?: string): string | null {
  if (!grade || !grade.enabled) return null;
  const look = resolveLutGrade(grade);
  const size = NLE_LUT_SIZE;
  const last = size - 1;

  const lines: string[] = [
    `TITLE "${cubeTitle(grade, title)}"`,
    `LUT_3D_SIZE ${size}`,
    'DOMAIN_MIN 0.0 0.0 0.0',
    'DOMAIN_MAX 1.0 1.0 1.0',
    '',
  ];
  for (let bi = 0; bi < size; bi += 1) {
    for (let gi = 0; gi < size; gi += 1) {
      for (let ri = 0; ri < size; ri += 1) {
        const [r, g, b] = gradeColor(ri / last, gi / last, bi / last, look);
        lines.push(`${r.toFixed(6)} ${g.toFixed(6)} ${b.toFixed(6)}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

/* ------------------------------------------------------------------------------------------------ */
/* SRT                                                                                               */
/* ------------------------------------------------------------------------------------------------ */

export function formatSrtTimestamp(sec: number): string {
  const totalMs = Math.max(0, Math.round(finiteOr(sec, 0) * 1000));
  const ms = totalMs % 1000;
  const totalSec = (totalMs - ms) / 1000;
  const s = totalSec % 60;
  const totalMin = (totalSec - s) / 60;
  const m = totalMin % 60;
  const h = (totalMin - m) / 60;
  const pad = (value: number, width: number) => String(value).padStart(width, '0');
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`;
}

function cleanCaptionText(text: string): string {
  return stripXmlInvalidChars(String(text ?? ''))
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '') // a blank line would end the cue early
    .join('\n');
}

export function buildSrtSubtitles(captions: readonly TimelineCaption[]): string | null {
  if (captions.length === 0) return null;
  const cues = captions
    .map((caption) => ({
      text: cleanCaptionText(caption.text),
      startSec: Math.max(0, finiteOr(caption.startSec, 0)),
      endSec: Math.max(0, finiteOr(caption.endSec, 0)),
    }))
    .filter((cue) => cue.text !== '')
    .sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  if (cues.length === 0) return null;

  const blocks = cues.map((cue, index) => {
    const startMs = Math.round(cue.startSec * 1000);
    const endMs = Math.max(startMs + 1, Math.round(cue.endSec * 1000));
    return `${index + 1}\n${formatSrtTimestamp(startMs / 1000)} --> ${formatSrtTimestamp(endMs / 1000)}\n${cue.text}\n`;
  });
  return blocks.join('\n');
}

/* ------------------------------------------------------------------------------------------------ */
/* PKZIP (STORE)                                                                                     */
/* ------------------------------------------------------------------------------------------------ */

const ZIP_LOCAL_SIG = 0x04034b50;
const ZIP_CENTRAL_SIG = 0x02014b50;
const ZIP_EOCD_SIG = 0x06054b50;
const ZIP_VERSION = 20;
const ZIP_FLAG_UTF8 = 0x0800;
const ZIP_MAX_U32 = 0xffffffff;
const ZIP_MAX_ENTRIES = 0xffff;

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/** IEEE 802.3 CRC-32 (the checksum ZIP, PNG and gzip share). */
export function crc32(bytes: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = table[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function normalizeZipPath(path: string): string {
  const normalized = String(path).replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/');
  if (normalized === '' || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`nle_zip_invalid_path: ${path}`);
  }
  return normalized;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * Standard PKZIP archive with every entry stored uncompressed (video and audio are already compressed).
 * File names are UTF-8 (general purpose bit 11). No ZIP64: the archive must stay under 4 GB.
 */
export function buildZipArchive(
  entries: ReadonlyArray<{ path: string; bytes: Uint8Array }>,
  opts?: { modifiedAt?: Date },
): Uint8Array {
  if (entries.length > ZIP_MAX_ENTRIES) throw new Error('nle_zip_too_many_entries');
  const encoder = new TextEncoder();
  const stamp = dosDateTime(opts?.modifiedAt ?? new Date());
  const seen = new Set<string>();

  const prepared = entries.map((entry) => {
    const path = normalizeZipPath(entry.path);
    if (seen.has(path)) throw new Error(`nle_zip_duplicate_path: ${path}`);
    seen.add(path);
    return { name: encoder.encode(path), bytes: entry.bytes, crc: crc32(entry.bytes) };
  });

  let localSize = 0;
  let centralSize = 0;
  for (const entry of prepared) {
    localSize += 30 + entry.name.length + entry.bytes.length;
    centralSize += 46 + entry.name.length;
  }
  const totalSize = localSize + centralSize + 22;
  if (totalSize > ZIP_MAX_U32) throw new Error('nle_zip_too_large');

  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);
  const offsets: number[] = [];
  let pos = 0;

  for (const entry of prepared) {
    offsets.push(pos);
    view.setUint32(pos, ZIP_LOCAL_SIG, true);
    view.setUint16(pos + 4, ZIP_VERSION, true);
    view.setUint16(pos + 6, ZIP_FLAG_UTF8, true);
    view.setUint16(pos + 8, 0, true); // STORE
    view.setUint16(pos + 10, stamp.time, true);
    view.setUint16(pos + 12, stamp.date, true);
    view.setUint32(pos + 14, entry.crc, true);
    view.setUint32(pos + 18, entry.bytes.length, true);
    view.setUint32(pos + 22, entry.bytes.length, true);
    view.setUint16(pos + 26, entry.name.length, true);
    view.setUint16(pos + 28, 0, true);
    out.set(entry.name, pos + 30);
    out.set(entry.bytes, pos + 30 + entry.name.length);
    pos += 30 + entry.name.length + entry.bytes.length;
  }

  const centralOffset = pos;
  prepared.forEach((entry, index) => {
    view.setUint32(pos, ZIP_CENTRAL_SIG, true);
    view.setUint16(pos + 4, ZIP_VERSION, true); // version made by
    view.setUint16(pos + 6, ZIP_VERSION, true); // version needed
    view.setUint16(pos + 8, ZIP_FLAG_UTF8, true);
    view.setUint16(pos + 10, 0, true); // STORE
    view.setUint16(pos + 12, stamp.time, true);
    view.setUint16(pos + 14, stamp.date, true);
    view.setUint32(pos + 16, entry.crc, true);
    view.setUint32(pos + 20, entry.bytes.length, true);
    view.setUint32(pos + 24, entry.bytes.length, true);
    view.setUint16(pos + 28, entry.name.length, true);
    view.setUint16(pos + 30, 0, true); // extra
    view.setUint16(pos + 32, 0, true); // comment
    view.setUint16(pos + 34, 0, true); // disk number
    view.setUint16(pos + 36, 0, true); // internal attributes
    view.setUint32(pos + 38, 0, true); // external attributes
    view.setUint32(pos + 42, offsets[index]!, true);
    out.set(entry.name, pos + 46);
    pos += 46 + entry.name.length;
  });

  view.setUint32(pos, ZIP_EOCD_SIG, true);
  view.setUint16(pos + 4, 0, true);
  view.setUint16(pos + 6, 0, true);
  view.setUint16(pos + 8, prepared.length, true);
  view.setUint16(pos + 10, prepared.length, true);
  view.setUint32(pos + 12, centralSize, true);
  view.setUint32(pos + 16, centralOffset, true);
  view.setUint16(pos + 20, 0, true);
  return out;
}

/* ------------------------------------------------------------------------------------------------ */
/* Bundle                                                                                            */
/* ------------------------------------------------------------------------------------------------ */

function bundleFilename(opts?: NleExportOptions): string {
  const raw = stripXmlInvalidChars(opts?.projectTitle ?? '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/^\.+/, '')
    .slice(0, 60);
  return raw ? `${raw}-nle.zip` : 'project-nle.zip';
}

function toUint8Array(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

async function fetchBundleMedia(
  sources: readonly NleMediaSource[],
  fetchMedia: (url: string) => Promise<Uint8Array>,
): Promise<Array<Uint8Array | null>> {
  const results: Array<Uint8Array | null> = sources.map(() => null);
  let next = 0;
  const worker = async () => {
    while (next < sources.length) {
      const index = next;
      next += 1;
      try {
        const bytes = toUint8Array(await fetchMedia(sources[index]!.url));
        results[index] = bytes && bytes.byteLength > 0 ? bytes : null;
      } catch {
        results[index] = null; // one unreachable file must not sink the whole export
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MEDIA_FETCH_CONCURRENCY, sources.length) }, worker));
  return results;
}

interface ReadmeInput {
  title: string;
  timebase: number;
  width: number;
  height: number;
  hasLut: boolean;
  hasSrt: boolean;
  grade: ComposeColorGradeState | null;
  bundled: readonly NleMediaSource[];
  missing: readonly NleMediaSource[];
  mediaRequested: boolean;
  /** The music file itself made it into `media/`. */
  bgmBundled: boolean;
  /** The sequence carries a music track and that track is non-commercial guide audio. */
  bgmIsGuide: boolean;
}

function buildReadmeKo(input: ReadmeInput): string {
  const lines: string[] = [];
  lines.push(`${input.title} · 편집 프로젝트 묶음`);
  lines.push('');
  lines.push('들어 있는 파일');
  lines.push('- project.xml : 컷 순서와 길이, 오디오가 담긴 편집 프로젝트');
  if (input.bundled.length > 0) {
    lines.push(`- media 폴더 : 원본 영상${input.bgmBundled ? '과 음악' : ''} ${input.bundled.length}개`);
  }
  if (input.hasLut) lines.push('- grade.cube : 색보정 LUT');
  if (input.hasSrt) lines.push('- captions.srt : 자막');
  lines.push('');
  lines.push('먼저 압축을 풀고, 폴더 구조를 그대로 두세요.');
  lines.push('');
  lines.push('Premiere Pro');
  lines.push('1. 파일 > 가져오기에서 project.xml을 고릅니다.');
  lines.push('2. 미디어가 오프라인으로 보이면 미디어 연결에서 media 폴더를 지정합니다.');
  if (input.hasLut) {
    lines.push('3. 색보정: 조정 레이어를 올리고 Lumetri 색상 > 크리에이티브 > Look에서 grade.cube를 불러옵니다.');
  }
  if (input.hasSrt) {
    lines.push(`${input.hasLut ? 4 : 3}. 자막: captions.srt를 가져와 타임라인에 올립니다.`);
  }
  lines.push('');
  lines.push('DaVinci Resolve');
  lines.push('1. 파일 > 가져오기 > 타임라인에서 project.xml을 고릅니다.');
  lines.push('2. 미디어를 찾지 못하면 media 폴더를 지정합니다.');
  if (input.hasLut) {
    lines.push('3. 색보정: 프로젝트 설정 > 컬러 매니지먼트에서 LUT 폴더를 열어 grade.cube를 넣고, 목록을 새로 고친 뒤 컬러 페이지의 노드에 적용합니다.');
  }
  if (input.hasSrt) {
    lines.push(`${input.hasLut ? 4 : 3}. 자막: captions.srt를 미디어 풀에 넣고 자막 트랙으로 끌어 놓습니다.`);
  }
  lines.push('');
  lines.push('참고');
  lines.push(`- 타임라인은 ${input.width}×${input.height}, ${input.timebase}fps입니다.`);
  if (input.hasLut && input.grade) {
    if (input.grade.scope === 'region') {
      lines.push('- grade.cube는 화면 전체에 적용됩니다. 부분 색보정을 썼다면 타임라인 마커에 적힌 영역에 마스크를 씌워 주세요.');
    } else if (input.grade.scope === 'selected_clip') {
      lines.push('- 색보정은 컷 하나에만 걸려 있었습니다. 타임라인 마커가 가리키는 컷에만 grade.cube를 적용해 주세요.');
    }
    if (input.grade.referenceProfile) {
      lines.push('- 참고 영상의 톤은 LUT에 근사치로 담겼습니다. 화면을 보며 세기를 조절해 주세요.');
    }
    if (input.grade.grain > 0) {
      lines.push('- 필름 그레인은 LUT에 담기지 않습니다. 필요하면 편집 프로그램에서 더해 주세요.');
    }
  }
  if (input.bgmIsGuide) {
    lines.push('- 함께 담긴 음악은 비상업용 가이드 음악입니다. 게시하기 전에 사용할 음악으로 바꿔 주세요.');
  }
  if (!input.mediaRequested && (input.bundled.length > 0 || input.missing.length > 0)) {
    lines.push('- 이 묶음에는 원본 파일이 들어 있지 않습니다. 아래 이름으로 media 폴더에 넣어 주세요.');
    for (const source of input.missing) lines.push(`  · ${source.path} (${source.label})`);
  } else if (input.missing.length > 0) {
    lines.push('- 받지 못한 파일이 있습니다. 원본을 아래 이름으로 media 폴더에 넣어 주세요.');
    for (const source of input.missing) lines.push(`  · ${source.path} (${source.label})`);
  }
  return `${lines.join('\r\n')}\r\n`;
}

export async function exportProjectNleBundleZip(
  project: ComposerProject,
  fetchMedia?: (url: string) => Promise<Uint8Array>,
  opts?: NleExportOptions,
): Promise<NleBundleResult> {
  const encoder = new TextEncoder();
  const title = resolveTitle(opts);
  const { width, height } = resolveDimensions(project, opts);
  const plan = planNleMedia(project, opts);
  const grade = normalizeColorGradeState(project.colorGrade);

  const xml = buildFcp7Xml(project, opts);
  const lutCube = buildCubeLut33(project.colorGrade);
  const srt = buildSrtSubtitles(project.captions);

  const fetched = fetchMedia ? await fetchBundleMedia(plan.all, fetchMedia) : plan.all.map(() => null);
  const bundled: NleMediaSource[] = [];
  const missing: NleMediaSource[] = [];
  const mediaEntries: Array<{ path: string; bytes: Uint8Array }> = [];
  plan.all.forEach((source, index) => {
    const bytes = fetched[index];
    if (bytes) {
      bundled.push(source);
      mediaEntries.push({ path: source.path, bytes });
    } else {
      missing.push(source);
    }
  });

  const readme = buildReadmeKo({
    title,
    timebase: resolveTimebase(opts),
    width,
    height,
    hasLut: lutCube !== null,
    hasSrt: srt !== null,
    grade,
    bundled,
    missing,
    mediaRequested: fetchMedia !== undefined,
    bgmBundled: bundled.some((source) => source.kind === 'bgm'),
    bgmIsGuide: plan.bgm !== null && Boolean(project.bgm?.nonCommercialGuide),
  });

  const entries: Array<{ path: string; bytes: Uint8Array }> = [{ path: 'project.xml', bytes: encoder.encode(xml) }];
  if (lutCube !== null) entries.push({ path: 'grade.cube', bytes: encoder.encode(lutCube) });
  if (srt !== null) entries.push({ path: 'captions.srt', bytes: encoder.encode(srt) });
  entries.push({ path: 'README-KO.txt', bytes: encoder.encode(readme) });
  entries.push(...mediaEntries);

  return {
    filename: bundleFilename(opts),
    zipBytes: buildZipArchive(entries),
    xml,
    lutCube,
    srt,
    mediaFiles: mediaEntries.map((entry) => entry.path),
  };
}
