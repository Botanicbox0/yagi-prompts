/**
 * Browser-side 1080p video composition exporter (`docs/BRAND-VIDEO-COMPOSE-D.md` §3).
 *
 * Primary path: WebCodecs `VideoEncoder` (`avc1`) + optional `AudioEncoder` (`mp4a.40.2` via
 * `OfflineAudioContext` mix) -> `muxAvc1ToMp4` (~3.9s for 30s 1080p on workstation Chromium).
 * Automatic fallback: real-time `<canvas>.captureStream` + `MediaRecorder` when WebCodecs is unavailable.
 */
import { applyColorGradeToCanvasContext } from './color-grade';
import { muxAvc1ToMp4, type EncodedAudioSample, type EncodedVideoSample } from './mp4-muxer';
import {
  COMPOSE_DIMENSIONS,
  clipPlayDuration,
  frameStateAtTime,
  normalizeColorGradeState,
  projectDurationSec,
  toColorGradeSpec,
  type ComposeCaption,
  type ComposeClip,
  type ComposeOverlayClip,
  type ComposerProject,
} from './timeline';

export interface ComposeExportResult {
  blob: Blob;
  mime: 'video/mp4' | 'video/webm';
  filename: string;
  width: number;
  height: number;
  durationSec: number;
  elapsedMs: number;
}

const EXPORT_FPS = 30;
const VIDEO_CODEC_CANDIDATES = ['avc1.640028', 'avc1.4d0028', 'avc1.42E028', 'avc1.42001f'];

function drawVideoCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  canvasWidth: number,
  canvasHeight: number,
): void {
  ctx.fillStyle = '#0B0C0E';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  const vw = video.videoWidth || canvasWidth;
  const vh = video.videoHeight || canvasHeight;
  if (vw <= 0 || vh <= 0) return;

  // Contain inside frame if aspect differs wildly, otherwise clean cover fill.
  const videoRatio = vw / vh;
  const frameRatio = canvasWidth / canvasHeight;
  const ratioDiff = Math.abs(Math.log(videoRatio / frameRatio));
  if (ratioDiff > 0.35) {
    const scale = Math.min(canvasWidth / vw, canvasHeight / vh);
    const dw = Math.round(vw * scale);
    const dh = Math.round(vh * scale);
    ctx.drawImage(video, Math.round((canvasWidth - dw) / 2), Math.round((canvasHeight - dh) / 2), dw, dh);
  } else {
    const scale = Math.max(canvasWidth / vw, canvasHeight / vh);
    const dw = Math.round(vw * scale);
    const dh = Math.round(vh * scale);
    ctx.drawImage(video, Math.round((canvasWidth - dw) / 2), Math.round((canvasHeight - dh) / 2), dw, dh);
  }
}

function wrapCaptionLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [text.trim()];
  const lines: string[] = [];
  let current = words[0]!;
  for (let i = 1; i < words.length; i += 1) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i]!;
    }
  }
  lines.push(current);
  return lines.slice(0, 3);
}

export function drawCaptionsOverlay(
  ctx: CanvasRenderingContext2D,
  captions: readonly ComposeCaption[],
  canvasWidth: number,
  canvasHeight: number,
): void {
  if (captions.length === 0) return;
  const shortSide = Math.min(canvasWidth, canvasHeight);
  for (const caption of captions) {
    const fontPx =
      caption.size === 'lg'
        ? Math.round(shortSide * 0.056)
        : caption.size === 'sm'
          ? Math.round(shortSide * 0.034)
          : Math.round(shortSide * 0.044);
    ctx.save();
    ctx.font = `600 ${fontPx}px "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const maxTextWidth = canvasWidth * 0.82;
    const lines = wrapCaptionLines(ctx, caption.text, maxTextWidth);
    const lineHeight = Math.round(fontPx * 1.34);
    let widest = 0;
    for (const line of lines) widest = Math.max(widest, ctx.measureText(line).width);

    const padX = Math.round(fontPx * 0.72);
    const padY = Math.round(fontPx * 0.46);
    const boxW = Math.min(canvasWidth * 0.9, widest + padX * 2);
    const boxH = lines.length * lineHeight + padY * 2;
    const boxX = (canvasWidth - boxW) / 2;
    const boxY =
      caption.position === 'top'
        ? Math.round(canvasHeight * 0.09)
        : caption.position === 'center'
          ? Math.round((canvasHeight - boxH) / 2)
          : Math.round(canvasHeight - boxH - canvasHeight * 0.1);

    const radius = Math.round(fontPx * 0.36);
    ctx.fillStyle = 'rgba(11, 12, 14, 0.76)';
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, radius);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    lines.forEach((line, idx) => {
      const y = boxY + padY + lineHeight * idx + lineHeight / 2;
      ctx.fillText(line, canvasWidth / 2, y);
    });
    ctx.restore();
  }
}

export function applyProjectColorGradeFrame(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  project: ComposerProject,
  activeClip: { clip: ComposeClip; index: number } | null,
): boolean {
  const grade = normalizeColorGradeState(project.colorGrade);
  const spec = toColorGradeSpec(grade);
  if (!grade || !spec || !spec.enabled) return false;

  const isSelectedClip = Boolean(
    activeClip &&
      (grade.clipId
        ? activeClip.clip.id === grade.clipId
        : grade.clipIndex !== null && grade.clipIndex !== undefined
          ? activeClip.index === grade.clipIndex
          : grade.scope === 'selected_clip'
            ? activeClip.index === 0
            : true),
  );

  if (spec.scope === 'selected_clip' && !isSelectedClip) return false;
  if (
    spec.scope === 'region' &&
    (grade.clipId || (grade.clipIndex !== null && grade.clipIndex !== undefined)) &&
    !isSelectedClip
  ) {
    return false;
  }

  const effectiveSpec = {
    ...spec,
    targetClipId:
      spec.targetClipId ??
      (grade.clipIndex !== null && grade.clipIndex !== undefined && activeClip
        ? isSelectedClip
          ? activeClip.clip.id
          : '__other_clip__'
        : null),
  };
  applyColorGradeToCanvasContext(ctx, canvasWidth, canvasHeight, effectiveSpec, isSelectedClip);
  return true;
}

async function loadReadyVideo(srcUrl: string): Promise<HTMLVideoElement> {
  return await new Promise<HTMLVideoElement>((resolve, reject) => {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    const done = () => {
      v.onloadeddata = null;
      v.onerror = null;
      resolve(v);
    };
    v.onloadeddata = done;
    v.onerror = () => reject(new Error('video_load_failed'));
    v.src = srcUrl;
    v.load();
  });
}

async function seekVideoTo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  const target = Math.max(0, Math.min(Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.01) : timeSec, timeSec));
  if (Math.abs(video.currentTime - target) < 0.012 && video.readyState >= 2) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', finish);
      resolve();
    };
    const timer = window.setTimeout(finish, 350);
    video.addEventListener(
      'seeked',
      () => {
        window.clearTimeout(timer);
        finish();
      },
      { once: true },
    );
    try {
      video.currentTime = target;
    } catch {
      window.clearTimeout(timer);
      finish();
    }
  });
}

async function loadReadyImage(srcUrl: string): Promise<HTMLImageElement | null> {
  return await new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = srcUrl;
  });
}

function drawActiveOverlays(
  ctx: CanvasRenderingContext2D,
  activeOverlays: readonly ComposeOverlayClip[],
  overlayMedia: ReadonlyMap<string, HTMLImageElement | HTMLVideoElement>,
  canvasWidth: number,
  canvasHeight: number,
): void {
  if (activeOverlays.length === 0) return;
  for (const ov of activeOverlays) {
    const media = overlayMedia.get(ov.id);
    if (!media) continue;
    const natW = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
    const natH = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
    if (natW <= 0 || natH <= 0) continue;
    const drawW = Math.max(8, Math.round(canvasWidth * ov.scale));
    const drawH = Math.max(8, Math.round((drawW * natH) / natW));
    const dx = Math.round(ov.x * canvasWidth - drawW / 2);
    const dy = Math.round(ov.y * canvasHeight - drawH / 2);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, ov.opacity));
    ctx.drawImage(media, dx, dy, drawW, drawH);
    ctx.restore();
  }
}

async function encodeMixedAudioAac(
  project: ComposerProject,
  totalSec: number,
): Promise<{
  sampleRate: number;
  channelCount: number;
  samples: EncodedAudioSample[];
  audioSpecificConfig: Uint8Array | null;
} | null> {
  const wantsClipAudio = project.clips.some((c) => !c.muted && c.volume > 0);
  const wantsBgm = Boolean(project.bgm && project.bgm.volume > 0);
  const wantsSfx = Boolean(project.sfxClips && project.sfxClips.some((s) => s.volume > 0));
  if ((!wantsClipAudio && !wantsBgm && !wantsSfx) || typeof AudioEncoder === 'undefined' || typeof OfflineAudioContext === 'undefined') {
    return null;
  }

  const sampleRate = 48_000;
  const channelCount = 2;
  try {
    const support = await AudioEncoder.isConfigSupported({
      codec: 'mp4a.40.2',
      sampleRate,
      numberOfChannels: channelCount,
      bitrate: 128_000,
    });
    if (!support.supported) return null;

    const frameLength = Math.max(1024, Math.ceil(totalSec * sampleRate));
    const offline = new OfflineAudioContext(channelCount, frameLength, sampleRate);
    let anySourceConnected = false;

    const decodeBuffer = async (url: string): Promise<AudioBuffer | null> => {
      try {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) return null;
        const ab = await res.arrayBuffer();
        return await offline.decodeAudioData(ab.slice(0));
      } catch {
        return null;
      }
    };

    if (wantsClipAudio) {
      let cursor = 0;
      for (const clip of project.clips) {
        const rate =
          typeof clip.playbackRate === 'number' && Number.isFinite(clip.playbackRate)
            ? Math.min(4, Math.max(0.25, clip.playbackRate))
            : 1;
        const sourceSpanSec = Math.max(0.3, clip.trimEndSec - clip.trimStartSec);
        const timelineDur = clipPlayDuration(clip);
        if (!clip.muted && clip.volume > 0) {
          const decoded = await decodeBuffer(clip.srcUrl);
          if (decoded) {
            const src = offline.createBufferSource();
            src.buffer = decoded;
            src.playbackRate.value = rate;
            const gain = offline.createGain();
            gain.gain.value = clip.volume;
            src.connect(gain).connect(offline.destination);
            const when = Math.max(0, cursor + (clip.audioOffsetSec ?? 0));
            src.start(when, clip.trimStartSec, sourceSpanSec);
            anySourceConnected = true;
          }
        }
        cursor += timelineDur;
      }
    }

    if (wantsBgm && project.bgm) {
      const decoded = await decodeBuffer(project.bgm.srcUrl);
      if (decoded) {
        const src = offline.createBufferSource();
        src.buffer = decoded;
        src.loop = true;
        src.loopStart = project.bgm.trimStartSec;
        src.loopEnd = decoded.duration;
        const gain = offline.createGain();
        gain.gain.value = project.bgm.volume;
        src.connect(gain).connect(offline.destination);
        src.start(0, project.bgm.trimStartSec, totalSec);
        anySourceConnected = true;
      }
    }

    if (wantsSfx && project.sfxClips) {
      for (const sfx of project.sfxClips) {
        if (sfx.volume <= 0 || !sfx.srcUrl) continue;
        const decoded = await decodeBuffer(sfx.srcUrl);
        if (decoded) {
          const src = offline.createBufferSource();
          src.buffer = decoded;
          const gain = offline.createGain();
          gain.gain.value = sfx.volume;
          src.connect(gain).connect(offline.destination);
          src.start(Math.max(0, sfx.startSec), 0, Math.min(decoded.duration, sfx.durationSec));
          anySourceConnected = true;
        }
      }
    }

    if (!anySourceConnected) return null;

    const rendered = await offline.startRendering();
    const samples: EncodedAudioSample[] = [];
    let asc: Uint8Array | null = null;

    const encoder = new AudioEncoder({
      output: (chunk, meta) => {
        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        samples.push({ data: bytes, sampleCount: 1024 });
        if (!asc && meta?.decoderConfig?.description) {
          const desc = meta.decoderConfig.description;
          asc =
            desc instanceof ArrayBuffer
              ? new Uint8Array(desc)
              : ArrayBuffer.isView(desc)
                ? new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength)
                : null;
        }
      },
      error: () => {
        // Handled by empty check below.
      },
    });
    encoder.configure({
      codec: 'mp4a.40.2',
      sampleRate,
      numberOfChannels: channelCount,
      bitrate: 128_000,
    });

    const left = rendered.getChannelData(0);
    const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : left;
    const chunkFrames = 1024;
    for (let offset = 0; offset < rendered.length; offset += chunkFrames) {
      const frames = Math.min(chunkFrames, rendered.length - offset);
      const planar = new Float32Array(frames * 2);
      planar.set(left.subarray(offset, offset + frames), 0);
      planar.set(right.subarray(offset, offset + frames), frames);
      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: frames,
        numberOfChannels: 2,
        timestamp: Math.round((offset / sampleRate) * 1_000_000),
        data: planar,
      });
      encoder.encode(audioData);
      audioData.close();
    }
    await encoder.flush();
    encoder.close();

    return samples.length > 0 ? { sampleRate, channelCount, samples, audioSpecificConfig: asc } : null;
  } catch {
    return null;
  }
}

async function pickSupportedAvcCodec(width: number, height: number): Promise<string | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  for (const codec of VIDEO_CODEC_CANDIDATES) {
    try {
      const check = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate: 6_000_000,
        framerate: EXPORT_FPS,
        avc: { format: 'avc' },
      });
      if (check.supported) return codec;
    } catch {
      // Try next profile.
    }
  }
  return null;
}

export async function exportCompositionMp4(
  project: ComposerProject,
  onProgress?: (ratio: number) => void,
): Promise<ComposeExportResult> {
  const startedAt = performance.now();
  const totalSec = projectDurationSec(project);
  if (project.clips.length === 0 || totalSec <= 0) {
    throw new Error('empty_timeline');
  }

  const { width, height } = COMPOSE_DIMENSIONS[project.aspect];
  const videoElements = await Promise.all(project.clips.map((c) => loadReadyVideo(c.srcUrl)));
  const overlayMedia = new Map<string, HTMLImageElement | HTMLVideoElement>();
  if (project.overlays && project.overlays.length > 0) {
    await Promise.all(
      project.overlays.map(async (ov) => {
        try {
          if (ov.mediaKind === 'image') {
            const img = await loadReadyImage(ov.srcUrl);
            if (img) overlayMedia.set(ov.id, img);
          } else {
            const vid = await loadReadyVideo(ov.srcUrl);
            overlayMedia.set(ov.id, vid);
          }
        } catch {
          // Skip broken overlay cleanly so primary export succeeds
        }
      }),
    );
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('canvas_unavailable');

  const avcCodec = await pickSupportedAvcCodec(width, height);
  if (avcCodec) {
    const totalFrames = Math.max(1, Math.round(totalSec * EXPORT_FPS));
    const frameDurationUs = Math.round(1_000_000 / EXPORT_FPS);
    const videoSamples: EncodedVideoSample[] = [];
    let avcConfig: Uint8Array | null = null;
    let encoderError: unknown = null;

    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        videoSamples.push({
          data,
          isKeyFrame: chunk.type === 'key',
          durationUs: frameDurationUs,
        });
        if (!avcConfig && meta?.decoderConfig?.description) {
          const desc = meta.decoderConfig.description;
          avcConfig =
            desc instanceof ArrayBuffer
              ? new Uint8Array(desc)
              : ArrayBuffer.isView(desc)
                ? new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength)
                : null;
        }
      },
      error: (err) => {
        encoderError = err;
      },
    });

    encoder.configure({
      codec: avcCodec,
      width,
      height,
      bitrate: 6_000_000,
      framerate: EXPORT_FPS,
      avc: { format: 'avc' },
    });

    for (let frameIdx = 0; frameIdx < totalFrames; frameIdx += 1) {
      if (encoderError) throw encoderError;
      const tSec = Math.min(totalSec - 0.001, frameIdx / EXPORT_FPS);
      const state = frameStateAtTime(project, tSec);
      if (state.activeClip) {
        const videoEl = videoElements[state.activeClip.index];
        if (videoEl) {
          await seekVideoTo(videoEl, state.activeClip.mediaTimeSec);
          drawVideoCover(ctx, videoEl, width, height);
        }
      }
      applyProjectColorGradeFrame(ctx, width, height, project, state.activeClip);
      for (const ov of state.activeOverlays) {
        const media = overlayMedia.get(ov.id);
        if (media instanceof HTMLVideoElement) {
          await seekVideoTo(media, Math.max(0, tSec - ov.startSec));
        }
      }
      drawActiveOverlays(ctx, state.activeOverlays, overlayMedia, width, height);
      drawCaptionsOverlay(ctx, state.activeCaptions, width, height);

      const frame = new VideoFrame(canvas, {
        timestamp: frameIdx * frameDurationUs,
        duration: frameDurationUs,
      });
      encoder.encode(frame, { keyFrame: frameIdx % EXPORT_FPS === 0 });
      frame.close();

      if (encoder.encodeQueueSize > 12) {
        await encoder.flush();
      }
      if (frameIdx % 4 === 0 || frameIdx === totalFrames - 1) {
        onProgress?.(Math.min(0.88, ((frameIdx + 1) / totalFrames) * 0.88));
      }
    }

    await encoder.flush();
    encoder.close();
    if (encoderError || videoSamples.length === 0) {
      throw encoderError ?? new Error('encode_empty');
    }

    onProgress?.(0.92);
    const audioTrack = await encodeMixedAudioAac(project, totalSec);
    onProgress?.(0.97);

    const mp4Bytes = muxAvc1ToMp4({
      width,
      height,
      fps: EXPORT_FPS,
      videoSamples,
      avcDecoderConfigRecord: avcConfig,
      audio: audioTrack,
    });

    onProgress?.(1);
    const stamp = new Date().toISOString().slice(0, 10);
    return {
      blob: new Blob([mp4Bytes.buffer as ArrayBuffer], { type: 'video/mp4' }),
      mime: 'video/mp4',
      filename: `twings-compose-${stamp}.mp4`,
      width,
      height,
      durationSec: totalSec,
      elapsedMs: Math.round(performance.now() - startedAt),
    };
  }

  // Fallback path: real-time MediaRecorder
  const stream = canvas.captureStream(EXPORT_FPS);
  const mp4Supported = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4');
  const mime: 'video/mp4' | 'video/webm' = mp4Supported ? 'video/mp4' : 'video/webm';
  const recorder = new MediaRecorder(stream, {
    mimeType: mp4Supported ? 'video/mp4' : 'video/webm;codecs=vp8',
    videoBitsPerSecond: 5_000_000,
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (ev) => {
    if (ev.data.size > 0) chunks.push(ev.data);
  };
  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
    recorder.onerror = () => reject(new Error('recorder_failed'));
  });

  recorder.start(250);
  const totalFrames = Math.max(1, Math.round(totalSec * EXPORT_FPS));
  for (let frameIdx = 0; frameIdx < totalFrames; frameIdx += 1) {
    const tSec = Math.min(totalSec - 0.001, frameIdx / EXPORT_FPS);
    const state = frameStateAtTime(project, tSec);
    if (state.activeClip) {
      const videoEl = videoElements[state.activeClip.index];
      if (videoEl) {
        await seekVideoTo(videoEl, state.activeClip.mediaTimeSec);
        drawVideoCover(ctx, videoEl, width, height);
      }
    }
    applyProjectColorGradeFrame(ctx, width, height, project, state.activeClip);
    for (const ov of state.activeOverlays) {
      const media = overlayMedia.get(ov.id);
      if (media instanceof HTMLVideoElement) {
        await seekVideoTo(media, Math.max(0, tSec - ov.startSec));
      }
    }
    drawActiveOverlays(ctx, state.activeOverlays, overlayMedia, width, height);
    drawCaptionsOverlay(ctx, state.activeCaptions, width, height);
    onProgress?.((frameIdx + 1) / totalFrames);
    await new Promise((r) => window.setTimeout(r, Math.round(1000 / EXPORT_FPS)));
  }
  recorder.stop();
  const blob = await finished;
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    blob,
    mime,
    filename: `twings-compose-${stamp}.${mime === 'video/mp4' ? 'mp4' : 'webm'}`,
    width,
    height,
    durationSec: totalSec,
    elapsedMs: Math.round(performance.now() - startedAt),
  };
}
