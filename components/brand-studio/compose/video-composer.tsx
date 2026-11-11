'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { createStudioApi, isFailure, measureInBrowser } from '@/components/brand-studio/api';
import { fill as interpolate } from '@/components/brand-studio/copy';
import type { StudioAssetView, StudioOutputView } from '@/lib/brand-studio/contracts';
import {
  COMPOSE_ASPECTS,
  appendClip,
  applyTimelinePatches,
  clipPlayDuration,
  composeStorageKey,
  emptyComposerProject,
  frameStateAtTime,
  parseStoredProject,
  projectDurationSec,
  roundTenths,
  serializeProjectForStorage,
  timelineSpans,
  type CaptionPosition,
  type CaptionSize,
  type ComposeAspect,
  type ComposerProject,
  type TimelinePatch,
} from '@/lib/brand-studio/compose';
import {
  parseComposeChatCommand,
  requestByokTimelinePatches,
  type ByokProvider,
} from '@/lib/brand-studio/compose/chat-intent';
import { exportCompositionMp4, type ComposeExportResult } from '@/lib/brand-studio/compose/export-client';
import type { StudioComposeCopy } from '@/messages/studio-compose';
import s from './video-composer.module.css';

export interface VideoComposerProps {
  organizationId: string;
  locale: 'ko' | 'en';
  canCreate: boolean;
  copy: StudioComposeCopy;
  videoStudioHref: string;
  initialAssets: StudioAssetView[];
  initialVideoOutputs: Array<StudioOutputView & { label: string }>;
}

interface ChatEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

function sameOriginComposeUrl(organizationId: string, source: 'asset' | 'output', id: string): string {
  const q = new URLSearchParams({ organizationId, source, id });
  return `/api/brand-studio/compose?${q.toString()}`;
}

export function VideoComposer({
  organizationId,
  locale,
  canCreate,
  copy,
  videoStudioHref,
  initialAssets,
  initialVideoOutputs,
}: VideoComposerProps) {
  const api = useMemo(() => createStudioApi({ organizationId }), [organizationId]);
  const [sourceTab, setSourceTab] = useState<'clips' | 'music' | 'captions'>('clips');
  const [project, setProject] = useState<ComposerProject>(() => emptyComposerProject('9:16'));
  const [undoStack, setUndoStack] = useState<ComposerProject[]>([]);
  const [selectedClipIdx, setSelectedClipIdx] = useState<number>(0);

  // Playback state
  const [playing, setPlaying] = useState(false);
  const [playheadSec, setPlayheadSec] = useState(0);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeClipUrlRef = useRef<string>('');
  const localBlobUrlsRef = useRef<string[]>([]);

  // Caption draft state
  const [captionDraft, setCaptionDraft] = useState('');
  const [captionPos, setCaptionPos] = useState<CaptionPosition>('bottom');
  const [captionSize, setCaptionSize] = useState<CaptionSize>('md');

  // Chat state
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatEntry[]>(() => [
    { id: 'welcome', role: 'assistant', text: copy.chat.welcome },
  ]);

  // Optional browser-memory BYOK state (never persisted to localStorage or server)
  const [byokOpen, setByokOpen] = useState(false);
  const [byokProvider, setByokProvider] = useState<ByokProvider>('openai');
  const [byokDraftKey, setByokDraftKey] = useState('');
  const [byokActiveKey, setByokActiveKey] = useState('');

  // Export & save state
  const [exportingRatio, setExportingRatio] = useState<number | null>(null);
  const [lastExport, setLastExport] = useState<(ComposeExportResult & { objectUrl: string }) | null>(null);
  const [savingAsset, setSavingAsset] = useState(false);
  const [savedAssetId, setSavedAssetId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const videoAssets = useMemo(() => initialAssets.filter((a) => a.kind === 'video'), [initialAssets]);
  const audioAssets = useMemo(() => initialAssets.filter((a) => a.kind === 'audio'), [initialAssets]);

  // Hydrate saved timeline for this organization
  useEffect(() => {
    try {
      const saved = parseStoredProject(window.localStorage.getItem(composeStorageKey(organizationId)));
      if (saved && (saved.clips.length > 0 || saved.captions.length > 0 || saved.bgm)) {
        setProject(saved);
      }
    } catch {
      // ignore storage errors
    }
  }, [organizationId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(composeStorageKey(organizationId), serializeProjectForStorage(project));
    } catch {
      // ignore storage errors
    }
  }, [organizationId, project]);

  useEffect(() => {
    const urls = localBlobUrlsRef.current;
    return () => {
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (lastExport?.objectUrl) URL.revokeObjectURL(lastExport.objectUrl);
    };
  }, [lastExport]);

  const totalSec = useMemo(() => projectDurationSec(project), [project]);
  const spans = useMemo(() => timelineSpans(project), [project]);
  const frameAtPlayhead = useMemo(() => frameStateAtTime(project, playheadSec), [project, playheadSec]);

  const commitProject = useCallback((next: ComposerProject) => {
    setProject((prev) => {
      setUndoStack((stack) => [...stack.slice(-24), prev]);
      return next;
    });
    setSavedAssetId(null);
  }, []);

  const applyPatches = useCallback(
    (patches: readonly TimelinePatch[]) => {
      const { project: updated, appliedCount } = applyTimelinePatches(project, patches);
      if (appliedCount > 0) {
        commitProject(updated);
      }
      return appliedCount;
    },
    [commitProject, project],
  );

  const handleUndo = useCallback(() => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const previous = stack[stack.length - 1]!;
      setProject(previous);
      setSavedAssetId(null);
      return stack.slice(0, -1);
    });
  }, []);

  // Synchronize preview <video> and <audio> with playheadSec
  useEffect(() => {
    const v = previewVideoRef.current;
    const active = frameAtPlayhead.activeClip;
    if (!v || !active) return;

    if (activeClipUrlRef.current !== active.clip.srcUrl) {
      activeClipUrlRef.current = active.clip.srcUrl;
      v.src = active.clip.srcUrl;
      v.load();
    }
    v.muted = active.clip.muted;
    v.volume = active.clip.muted ? 0 : active.clip.volume;
    if (Math.abs(v.currentTime - active.mediaTimeSec) > (playing ? 0.28 : 0.05)) {
      try {
        v.currentTime = active.mediaTimeSec;
      } catch {
        // Metadata still loading
      }
    }
    if (playing && v.paused) {
      void v.play().catch(() => {});
    } else if (!playing && !v.paused) {
      v.pause();
    }
  }, [frameAtPlayhead.activeClip, playing]);

  useEffect(() => {
    const a = previewAudioRef.current;
    if (!a) return;
    if (!project.bgm || !playing || totalSec <= 0) {
      if (!a.paused) a.pause();
      return;
    }
    if (a.getAttribute('data-bgm-src') !== project.bgm.srcUrl) {
      a.setAttribute('data-bgm-src', project.bgm.srcUrl);
      a.src = project.bgm.srcUrl;
      a.load();
    }
    a.volume = project.bgm.volume;
    if (frameAtPlayhead.bgmTimeSec !== null && Math.abs(a.currentTime - frameAtPlayhead.bgmTimeSec) > 0.35) {
      try {
        a.currentTime = frameAtPlayhead.bgmTimeSec;
      } catch {
        // ignore until loaded
      }
    }
    if (a.paused) void a.play().catch(() => {});
  }, [frameAtPlayhead.bgmTimeSec, playing, project.bgm, totalSec]);

  useEffect(() => {
    if (!playing || totalSec <= 0) return;
    let raf = 0;
    let lastTick = performance.now();
    const step = (now: number) => {
      const dt = (now - lastTick) / 1000;
      lastTick = now;
      setPlayheadSec((prev) => {
        const next = prev + dt;
        if (next >= totalSec) {
          setPlaying(false);
          return 0;
        }
        return next;
      });
      raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [playing, totalSec]);

  const handleAddStudioOutput = (output: StudioOutputView & { label: string }) => {
    const dur = Math.max(1, output.seconds ?? 5);
    const next = appendClip(project, {
      label: output.label,
      sourceKind: 'output',
      outputId: output.id,
      srcUrl: sameOriginComposeUrl(organizationId, 'output', output.id),
      thumbUrl: output.thumbUrl,
      durationSec: dur,
      trimStartSec: 0,
      trimEndSec: dur,
      volume: 1,
      muted: false,
    });
    commitProject(next);
    setSelectedClipIdx(next.clips.length - 1);
  };

  const handleAddVideoAsset = (asset: StudioAssetView) => {
    const dur = Math.max(1, asset.seconds ?? 5);
    const next = appendClip(project, {
      label: asset.name,
      sourceKind: 'asset',
      assetId: asset.id,
      srcUrl: sameOriginComposeUrl(organizationId, 'asset', asset.id),
      thumbUrl: asset.thumbUrl,
      durationSec: dur,
      trimStartSec: 0,
      trimEndSec: dur,
      volume: 1,
      muted: false,
    });
    commitProject(next);
    setSelectedClipIdx(next.clips.length - 1);
  };

  const handleSelectAudioAsset = (asset: StudioAssetView) => {
    const dur = Math.max(1, asset.seconds ?? 15);
    commitProject({
      ...project,
      bgm: {
        label: asset.name,
        sourceKind: 'asset',
        assetId: asset.id,
        srcUrl: sameOriginComposeUrl(organizationId, 'asset', asset.id),
        durationSec: dur,
        trimStartSec: 0,
        volume: 0.4,
      },
    });
  };

  const handleLocalFilePick = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;

    let current = project;
    let addedVideo = false;
    for (const file of files) {
      const isVideo = file.type === 'video/mp4' || file.type === 'video/quicktime' || /\.(mp4|mov)$/i.test(file.name);
      const isAudio = file.type === 'audio/mpeg' || file.type === 'audio/wav' || /\.(mp3|wav)$/i.test(file.name);
      if (!isVideo && !isAudio) {
        setStatusMessage(copy.status.unsupportedFile);
        continue;
      }
      const measured = await measureInBrowser(file, isVideo ? 'video' : 'audio');
      const objectUrl = URL.createObjectURL(file);
      localBlobUrlsRef.current.push(objectUrl);
      const dur = Math.max(1, roundTenths(measured.seconds ?? (isVideo ? 5 : 15)));
      if (isVideo) {
        current = appendClip(current, {
          label: file.name.replace(/\.[^.]+$/, '') || 'Clip',
          sourceKind: 'local',
          srcUrl: objectUrl,
          thumbUrl: null,
          durationSec: dur,
          trimStartSec: 0,
          trimEndSec: dur,
          volume: 1,
          muted: false,
        });
        addedVideo = true;
      } else {
        current = {
          ...current,
          bgm: {
            label: file.name.replace(/\.[^.]+$/, '') || 'Music',
            sourceKind: 'local',
            srcUrl: objectUrl,
            durationSec: dur,
            trimStartSec: 0,
            volume: 0.4,
          },
        };
      }
      setStatusMessage(interpolate(copy.status.localClipAdded, { name: file.name }));
    }
    commitProject(current);
    if (addedVideo) setSelectedClipIdx(Math.max(0, current.clips.length - 1));
  };

  const handleAddManualCaption = (event: FormEvent) => {
    event.preventDefault();
    const text = captionDraft.trim();
    if (!text) return;
    applyPatches([
      {
        op: 'add_caption',
        text,
        startSec: roundTenths(playheadSec),
        durationSec: 2.5,
        position: captionPos,
        size: captionSize,
      },
    ]);
    setCaptionDraft('');
  };

  const runChatInstruction = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || chatBusy) return;
    const userMsg: ChatEntry = { id: `u_${Date.now()}`, role: 'user', text };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput('');

    const parsed = parseComposeChatCommand(text, project, locale);
    if (parsed.kind === 'undo') {
      if (undoStack.length > 0) {
        handleUndo();
        setChatMessages((prev) => [...prev, { id: `a_${Date.now()}`, role: 'assistant', text: copy.chat.undone }]);
      } else {
        setChatMessages((prev) => [...prev, { id: `a_${Date.now()}`, role: 'assistant', text: copy.chat.nothingToUndo }]);
      }
      return;
    }

    if (parsed.kind === 'patches') {
      const count = applyPatches(parsed.patches);
      const reply =
        count > 0
          ? interpolate(copy.chat.appliedSummary, { count, detail: parsed.detail })
          : copy.chat.unrecognized;
      setChatMessages((prev) => [...prev, { id: `a_${Date.now()}`, role: 'assistant', text: reply }]);
      return;
    }

    // Fallback to optional browser-memory BYOK key when connected
    if (byokActiveKey) {
      setChatBusy(true);
      const byokResult = await requestByokTimelinePatches({
        provider: byokProvider,
        apiKey: byokActiveKey,
        message: text,
        project,
        locale,
      });
      setChatBusy(false);
      if (byokResult.ok) {
        const count = applyPatches(byokResult.patches);
        const reply =
          count > 0
            ? interpolate(copy.chat.appliedSummary, { count, detail: byokResult.detail })
            : copy.chat.unrecognized;
        setChatMessages((prev) => [...prev, { id: `a_${Date.now()}`, role: 'assistant', text: reply }]);
        return;
      }
      setChatMessages((prev) => [...prev, { id: `a_${Date.now()}`, role: 'assistant', text: copy.chat.byokFailed }]);
      return;
    }

    setChatMessages((prev) => [...prev, { id: `a_${Date.now()}`, role: 'assistant', text: copy.chat.unrecognized }]);
  };

  const triggerDownload = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleExport = async () => {
    if (project.clips.length === 0 || exportingRatio !== null) return;
    setPlaying(false);
    setExportingRatio(0.02);
    setStatusMessage(null);
    setSavedAssetId(null);
    try {
      const result = await exportCompositionMp4(project, (ratio) => setExportingRatio(ratio));
      const objectUrl = URL.createObjectURL(result.blob);
      setLastExport((prev) => {
        if (prev?.objectUrl) URL.revokeObjectURL(prev.objectUrl);
        return { ...result, objectUrl };
      });
      triggerDownload(objectUrl, result.filename);
      const mb = (result.blob.size / (1024 * 1024)).toFixed(1);
      const elapsed = (result.elapsedMs / 1000).toFixed(1);
      setStatusMessage(
        result.mime === 'video/mp4'
          ? interpolate(copy.status.exportedReady, { seconds: result.durationSec, mb, elapsed })
          : interpolate(copy.status.exportWebmFallback, { seconds: result.durationSec }),
      );
    } catch {
      setStatusMessage(copy.status.exportFailed);
    } finally {
      setExportingRatio(null);
    }
  };

  const handleSaveToAssets = async () => {
    if (!canCreate || !lastExport || lastExport.mime !== 'video/mp4' || savingAsset) return;
    setSavingAsset(true);
    try {
      const file = Object.assign(lastExport.blob, { name: lastExport.filename });
      const res = await api.upload(file, {
        measure: async () => ({
          width: lastExport.width,
          height: lastExport.height,
          seconds: lastExport.durationSec,
        }),
      });
      if (isFailure(res)) {
        setStatusMessage(res.code === 'asset_limit' ? copy.status.saveQuotaExceeded : copy.status.saveFailed);
      } else {
        setSavedAssetId(res.asset.id);
      }
    } catch {
      setStatusMessage(copy.status.saveFailed);
    } finally {
      setSavingAsset(false);
    }
  };

  const aspectLabel = (aspect: ComposeAspect): string => {
    switch (aspect) {
      case '9:16':
        return copy.aspects.r9x16;
      case '16:9':
        return copy.aspects.r16x9;
      case '4:5':
        return copy.aspects.r4x5;
      case '1:1':
        return copy.aspects.r1x1;
    }
  };

  return (
    <div className={`bs-page ${s.page}`} data-brand-studio-v2 data-brand-studio-compose>
      <header className={s.header}>
        <div className={s.titleGroup}>
          <div className={s.titleRow}>
            <h1 className="bs-title">{copy.title}</h1>
            <span className={s.summaryBadge} data-compose-summary>
              {project.clips.length > 0
                ? interpolate(copy.summary, { clips: project.clips.length, seconds: totalSec })
                : copy.emptySummary}
            </span>
          </div>
          <p className={s.subtitle}>{copy.subtitle}</p>
        </div>

        <div className={s.headerActions}>
          <a className={s.pillBtn} href={videoStudioHref} data-compose-back-video>
            {copy.backToVideo}
          </a>
          <button
            type="button"
            className={s.pillBtn}
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            data-compose-undo
          >
            {copy.actions.undo}
          </button>
          {canCreate && lastExport?.mime === 'video/mp4' ? (
            <button
              type="button"
              className={s.pillBtn}
              onClick={handleSaveToAssets}
              disabled={savingAsset || Boolean(savedAssetId)}
              data-compose-save-asset
            >
              {savedAssetId
                ? copy.actions.savedToAssets
                : savingAsset
                  ? copy.actions.savingToAssets
                  : copy.actions.saveToAssets}
            </button>
          ) : null}
          <button
            type="button"
            className={s.primaryBtn}
            onClick={handleExport}
            disabled={project.clips.length === 0 || exportingRatio !== null}
            data-compose-export
          >
            {exportingRatio !== null
              ? interpolate(copy.actions.exporting, { percent: Math.round(exportingRatio * 100) })
              : copy.actions.exportMp4}
          </button>
        </div>
      </header>

      {statusMessage ? (
        <div className={s.statusBanner} role="status" data-compose-status>
          <span>{statusMessage}</span>
          {lastExport ? (
            <button
              type="button"
              className={s.smallBtn}
              onClick={() => triggerDownload(lastExport.objectUrl, lastExport.filename)}
            >
              {copy.actions.downloadAgain}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className={s.workbench}>
        {/* -------------------------------------------------------- Left: Sources */}
        <section className={s.panel} aria-label={copy.sources.tabsLabel} data-compose-sources>
          <div className={s.segmented} role="tablist" aria-label={copy.sources.tabsLabel}>
            {(['clips', 'music', 'captions'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                className={s.segTab}
                aria-selected={sourceTab === tab}
                onClick={() => setSourceTab(tab)}
                data-compose-source-tab={tab}
              >
                {tab === 'clips'
                  ? copy.sources.clipsTab
                  : tab === 'music'
                    ? copy.sources.musicTab
                    : copy.sources.captionsTab}
              </button>
            ))}
          </div>

          {sourceTab !== 'captions' ? (
            <div className={s.uploadBox}>
              <label className={s.smallBtn}>
                <span>{copy.sources.uploadLocal}</span>
                <input
                  type="file"
                  accept="video/mp4,video/quicktime,audio/mpeg,audio/wav,.mp4,.mov,.mp3,.wav"
                  multiple
                  hidden
                  onChange={handleLocalFilePick}
                  data-compose-local-input
                />
              </label>
              <p className={s.uploadHint}>{copy.sources.uploadHint}</p>
            </div>
          ) : null}

          {sourceTab === 'clips' ? (
            <>
              {initialVideoOutputs.length > 0 ? (
                <div className={s.sourceSection}>
                  <p className={s.sectionLabel}>{copy.sources.studioOutputs}</p>
                  <div className={s.sourceGrid}>
                    {initialVideoOutputs.map((out) => (
                      <div key={out.id} className={s.sourceCard} data-compose-output-card={out.id}>
                        <div className={s.sourceThumb}>
                          {out.thumbUrl ? <img src={out.thumbUrl} alt={out.label} /> : <video src={out.url} muted playsInline preload="metadata" />}
                          {out.seconds ? (
                            <span className={s.durationTag}>{interpolate(copy.sources.clipMeta, { seconds: out.seconds })}</span>
                          ) : null}
                        </div>
                        <p className={s.sourceName} title={out.label}>
                          {out.label}
                        </p>
                        <button
                          type="button"
                          className={s.smallBtn}
                          onClick={() => handleAddStudioOutput(out)}
                          data-compose-add-output={out.id}
                        >
                          {copy.sources.addClip}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className={s.sourceSection}>
                <p className={s.sectionLabel}>{copy.sources.libraryVideos}</p>
                {videoAssets.length > 0 ? (
                  <div className={s.sourceGrid}>
                    {videoAssets.map((asset) => (
                      <div key={asset.id} className={s.sourceCard} data-compose-asset-card={asset.id}>
                        <div className={s.sourceThumb}>
                          {asset.thumbUrl ? <img src={asset.thumbUrl} alt={asset.name} /> : <video src={asset.url} muted playsInline preload="metadata" />}
                          {asset.seconds ? (
                            <span className={s.durationTag}>{interpolate(copy.sources.clipMeta, { seconds: asset.seconds })}</span>
                          ) : null}
                        </div>
                        <p className={s.sourceName} title={asset.name}>
                          {asset.name}
                        </p>
                        <button
                          type="button"
                          className={s.smallBtn}
                          onClick={() => handleAddVideoAsset(asset)}
                          data-compose-add-asset={asset.id}
                        >
                          {copy.sources.addClip}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : initialVideoOutputs.length === 0 ? (
                  <p className={s.emptyNote}>{copy.sources.emptyVideos}</p>
                ) : null}
              </div>
            </>
          ) : null}

          {sourceTab === 'music' ? (
            <div className={s.sourceSection}>
              <p className={s.sectionLabel}>{copy.sources.libraryAudio}</p>
              {audioAssets.length > 0 ? (
                <div className={s.audioList}>
                  {audioAssets.map((audio) => {
                    const active = project.bgm?.assetId === audio.id;
                    return (
                      <div key={audio.id} className={s.audioRow}>
                        <div className={s.audioRowHead}>
                          <p className={s.sourceName}>{audio.name}</p>
                          <button
                            type="button"
                            className={s.smallBtn}
                            onClick={() => handleSelectAudioAsset(audio)}
                            disabled={active}
                            data-compose-use-audio={audio.id}
                          >
                            {active ? copy.sources.activeMusic : copy.sources.useMusic}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className={s.emptyNote}>{copy.sources.emptyAudio}</p>
              )}
            </div>
          ) : null}

          {sourceTab === 'captions' ? (
            <div className={s.sourceSection}>
              <form className={s.captionItem} onSubmit={handleAddManualCaption}>
                <input
                  type="text"
                  className={s.textInput}
                  value={captionDraft}
                  onChange={(e) => setCaptionDraft(e.target.value)}
                  placeholder={copy.captions.placeholder}
                  maxLength={120}
                  data-compose-caption-input
                />
                <div className={s.trimGrid}>
                  <label className={s.field}>
                    <span>{copy.captions.position}</span>
                    <select
                      className={s.selectInput}
                      value={captionPos}
                      onChange={(e) => setCaptionPos(e.target.value as CaptionPosition)}
                    >
                      <option value="bottom">{copy.captions.posBottom}</option>
                      <option value="center">{copy.captions.posCenter}</option>
                      <option value="top">{copy.captions.posTop}</option>
                    </select>
                  </label>
                  <label className={s.field}>
                    <span>{copy.captions.size}</span>
                    <select
                      className={s.selectInput}
                      value={captionSize}
                      onChange={(e) => setCaptionSize(e.target.value as CaptionSize)}
                    >
                      <option value="sm">{copy.captions.sizeSm}</option>
                      <option value="md">{copy.captions.sizeMd}</option>
                      <option value="lg">{copy.captions.sizeLg}</option>
                    </select>
                  </label>
                </div>
                <button type="submit" className={s.smallBtn} disabled={!captionDraft.trim()} data-compose-caption-add>
                  {copy.captions.addButton}
                </button>
              </form>

              {project.captions.length > 0 ? (
                <div className={s.captionList}>
                  {project.captions.map((cap, idx) => (
                    <div key={cap.id} className={s.captionItem} data-compose-caption-row={idx}>
                      <input
                        type="text"
                        className={s.textInput}
                        value={cap.text}
                        onChange={(e) => applyPatches([{ op: 'update_caption', captionIndex: idx, text: e.target.value }])}
                      />
                      <div className={s.trimGrid}>
                        <label className={s.field}>
                          <span>{copy.captions.startSec}</span>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            className={s.numInput}
                            value={cap.startSec}
                            onChange={(e) =>
                              applyPatches([{ op: 'update_caption', captionIndex: idx, startSec: Number(e.target.value) }])
                            }
                          />
                        </label>
                        <label className={s.field}>
                          <span>{copy.captions.endSec}</span>
                          <input
                            type="number"
                            step="0.1"
                            min="0.3"
                            className={s.numInput}
                            value={cap.endSec}
                            onChange={(e) =>
                              applyPatches([{ op: 'update_caption', captionIndex: idx, endSec: Number(e.target.value) }])
                            }
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        className={s.smallBtn}
                        onClick={() => applyPatches([{ op: 'remove_caption', captionIndex: idx }])}
                      >
                        {copy.captions.remove}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={s.emptyNote}>{copy.captions.empty}</p>
              )}
            </div>
          ) : null}
        </section>

        {/* -------------------------------------------------------- Center: Stage & Timeline */}
        <div className={s.centerColumn}>
          <section className={s.stageCard} data-compose-stage>
            <div className={s.stageToolbar}>
              <div className={s.aspectGroup} role="group" aria-label={copy.aspects.label}>
                {COMPOSE_ASPECTS.map((aspect) => (
                  <button
                    key={aspect}
                    type="button"
                    className={s.aspectPill}
                    aria-pressed={project.aspect === aspect}
                    onClick={() => applyPatches([{ op: 'set_aspect', aspect }])}
                    data-compose-aspect={aspect}
                  >
                    {aspectLabel(aspect)}
                  </button>
                ))}
              </div>
              {project.clips.length > 0 ? (
                <button
                  type="button"
                  className={s.smallBtn}
                  onClick={() => {
                    setPlaying(false);
                    setPlayheadSec(0);
                    commitProject(emptyComposerProject(project.aspect));
                  }}
                >
                  {copy.actions.clearAll}
                </button>
              ) : null}
            </div>

            <div className={s.viewportWell}>
              {project.clips.length > 0 ? (
                <div className={s.frameShell} data-aspect={project.aspect} data-compose-preview-frame>
                  <video ref={previewVideoRef} className={s.stageVideo} playsInline preload="auto" />
                  <audio ref={previewAudioRef} hidden preload="auto" />
                  {frameAtPlayhead.activeCaptions.map((cap) => (
                    <div key={cap.id} className={s.captionOverlay} data-pos={cap.position} data-compose-active-caption>
                      <span className={s.captionBubble} data-size={cap.size}>
                        {cap.text}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={s.emptyStage}>
                  <h2>{copy.stage.emptyTitle}</h2>
                  <p>{copy.stage.emptyBody}</p>
                </div>
              )}
            </div>

            <div className={s.transportBar}>
              <button
                type="button"
                className={s.smallBtn}
                disabled={project.clips.length === 0}
                onClick={() => setPlaying((p) => !p)}
                data-compose-play-toggle
              >
                {playing ? copy.stage.pause : copy.stage.play}
              </button>
              <button
                type="button"
                className={s.smallBtn}
                disabled={project.clips.length === 0}
                onClick={() => {
                  setPlaying(false);
                  setPlayheadSec(0);
                }}
              >
                {copy.stage.restart}
              </button>
              <input
                type="range"
                className={s.scrubber}
                min={0}
                max={Math.max(0.1, totalSec)}
                step={0.1}
                value={Math.min(playheadSec, totalSec)}
                disabled={project.clips.length === 0}
                onChange={(e) => {
                  setPlaying(false);
                  setPlayheadSec(Number(e.target.value));
                }}
                aria-label={copy.timeline.heading}
              />
              <span className={s.timecode}>
                {interpolate(copy.stage.timecode, {
                  current: playheadSec.toFixed(1),
                  total: totalSec.toFixed(1),
                })}
              </span>
            </div>
          </section>

          <section className={s.timelineCard} aria-label={copy.timeline.heading} data-compose-timeline>
            <div className={s.panelHead}>
              <h2 className={s.panelTitle}>{copy.timeline.heading}</h2>
              {project.captions.length > 0 ? (
                <span className={s.summaryBadge}>
                  {interpolate(copy.timeline.captionsTrack, { count: project.captions.length })}
                </span>
              ) : null}
            </div>

            {spans.length > 0 ? (
              <div className={s.clipStrip}>
                {spans.map(({ clip, index, timelineStartSec }) => (
                  <div
                    key={clip.id}
                    className={s.clipBlock}
                    data-selected={selectedClipIdx === index}
                    data-compose-clip-card={index}
                    onClick={() => {
                      setSelectedClipIdx(index);
                      setPlaying(false);
                      setPlayheadSec(timelineStartSec);
                    }}
                  >
                    <div className={s.clipBlockHead}>
                      <span className={s.cutBadge}>{interpolate(copy.timeline.clipBadge, { n: index + 1 })}</span>
                      <div className={s.clipOrderBtns} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className={s.iconBtn}
                          aria-label={copy.timeline.moveLeft}
                          disabled={index === 0}
                          onClick={() => applyPatches([{ op: 'move_clip', fromIndex: index, toIndex: index - 1 }])}
                        >
                          ←
                        </button>
                        <button
                          type="button"
                          className={s.iconBtn}
                          aria-label={copy.timeline.moveRight}
                          disabled={index === spans.length - 1}
                          onClick={() => applyPatches([{ op: 'move_clip', fromIndex: index, toIndex: index + 1 }])}
                        >
                          →
                        </button>
                        <button
                          type="button"
                          className={s.iconBtn}
                          aria-label={copy.timeline.removeClip}
                          onClick={() => applyPatches([{ op: 'remove_clip', clipIndex: index }])}
                        >
                          ×
                        </button>
                      </div>
                    </div>

                    <p className={s.sourceName} title={clip.label}>
                      {clip.label}
                    </p>

                    <div className={s.trimGrid} onClick={(e) => e.stopPropagation()}>
                      <label className={s.field}>
                        <span>{copy.timeline.trimStart}</span>
                        <input
                          type="number"
                          step="0.1"
                          min={0}
                          max={Math.max(0, roundTenths(clip.trimEndSec - 0.3))}
                          className={s.numInput}
                          value={clip.trimStartSec}
                          onChange={(e) =>
                            applyPatches([{ op: 'trim_clip', clipIndex: index, trimStartSec: Number(e.target.value) }])
                          }
                          data-compose-trim-start={index}
                        />
                      </label>
                      <label className={s.field}>
                        <span>{copy.timeline.trimEnd}</span>
                        <input
                          type="number"
                          step="0.1"
                          min={roundTenths(clip.trimStartSec + 0.3)}
                          max={clip.durationSec}
                          className={s.numInput}
                          value={clip.trimEndSec}
                          onChange={(e) =>
                            applyPatches([{ op: 'trim_clip', clipIndex: index, trimEndSec: Number(e.target.value) }])
                          }
                          data-compose-trim-end={index}
                        />
                      </label>
                    </div>

                    <div className={s.clipFoot} onClick={(e) => e.stopPropagation()}>
                      <span>{interpolate(copy.timeline.clipLength, { seconds: clipPlayDuration(clip) })}</span>
                      <button
                        type="button"
                        className={s.smallBtn}
                        onClick={() =>
                          applyPatches([{ op: 'set_clip_audio', clipIndex: index, muted: !clip.muted }])
                        }
                      >
                        {clip.muted ? copy.timeline.clipMuted : copy.timeline.clipSoundOn}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className={s.emptyNote}>{copy.emptySummary}</p>
            )}

            {project.bgm ? (
              <div className={s.bgmStrip} data-compose-bgm-strip>
                <strong>
                  {copy.timeline.bgmLabel}: {project.bgm.label}
                </strong>
                <label className={s.headerActions}>
                  <span>{copy.timeline.bgmVolume}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(project.bgm.volume * 100)}
                    onChange={(e) =>
                      applyPatches([{ op: 'set_bgm_volume', volume: Number(e.target.value) / 100 }])
                    }
                    data-compose-bgm-volume
                  />
                  <span>{Math.round(project.bgm.volume * 100)}%</span>
                </label>
                <button
                  type="button"
                  className={s.smallBtn}
                  onClick={() => applyPatches([{ op: 'remove_bgm' }])}
                >
                  {copy.timeline.removeBgm}
                </button>
              </div>
            ) : null}
          </section>
        </div>

        {/* -------------------------------------------------------- Right: Chat Timeline Editor */}
        <aside className={s.panel} aria-label={copy.chat.heading} data-compose-chat>
          <div className={s.panelHead}>
            <h2 className={s.panelTitle}>{copy.chat.heading}</h2>
          </div>
          <p className={s.chatLead}>{copy.chat.lead}</p>

          <div className={s.sourceSection}>
            <p className={s.sectionLabel}>{copy.chat.examplesLabel}</p>
            <div className={s.exampleChips}>
              {(
                [
                  copy.chat.examples.trim,
                  copy.chat.examples.caption,
                  copy.chat.examples.swap,
                  copy.chat.examples.bgm,
                ] as const
              ).map((example) => (
                <button
                  key={example}
                  type="button"
                  className={s.exampleChip}
                  onClick={() => void runChatInstruction(example)}
                >
                  {example}
                </button>
              ))}
            </div>
          </div>

          <div className={s.chatLog} role="log" aria-live="polite" data-compose-chat-log>
            {chatMessages.map((msg) => (
              <div key={msg.id} className={s.chatBubble} data-role={msg.role}>
                {msg.text}
              </div>
            ))}
          </div>

          <form
            className={s.chatForm}
            onSubmit={(e) => {
              e.preventDefault();
              void runChatInstruction(chatInput);
            }}
          >
            <textarea
              className={s.chatInput}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={copy.chat.placeholder}
              rows={2}
              data-compose-chat-input
            />
            <button
              type="submit"
              className={s.primaryBtn}
              disabled={!chatInput.trim() || chatBusy}
              data-compose-chat-send
            >
              {chatBusy ? copy.chat.running : copy.chat.send}
            </button>
          </form>

          <div className={s.byokBox}>
            <button
              type="button"
              className={s.smallBtn}
              onClick={() => setByokOpen((open) => !open)}
              aria-expanded={byokOpen}
              data-compose-byok-toggle
            >
              {byokActiveKey ? copy.chat.byokConnected : copy.chat.byokToggle}
            </button>

            {byokOpen ? (
              <div className={s.captionItem} data-compose-byok-panel>
                <p className={s.sectionLabel}>{copy.chat.byokTitle}</p>
                <p className={s.byokNotice}>{copy.chat.byokNotice}</p>
                <select
                  className={s.selectInput}
                  value={byokProvider}
                  onChange={(e) => setByokProvider(e.target.value as ByokProvider)}
                >
                  <option value="openai">{copy.chat.byokProviderOpenai}</option>
                  <option value="anthropic">{copy.chat.byokProviderAnthropic}</option>
                </select>
                <input
                  type="password"
                  autoComplete="off"
                  className={s.textInput}
                  value={byokDraftKey}
                  onChange={(e) => setByokDraftKey(e.target.value)}
                  placeholder={copy.chat.byokPlaceholder}
                />
                <div className={s.headerActions}>
                  <button
                    type="button"
                    className={s.smallBtn}
                    disabled={!byokDraftKey.trim()}
                    onClick={() => {
                      setByokActiveKey(byokDraftKey.trim());
                      setByokDraftKey('');
                    }}
                  >
                    {copy.chat.byokSave}
                  </button>
                  {byokActiveKey ? (
                    <button
                      type="button"
                      className={s.smallBtn}
                      onClick={() => {
                        setByokActiveKey('');
                        setByokDraftKey('');
                      }}
                    >
                      {copy.chat.byokClear}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
