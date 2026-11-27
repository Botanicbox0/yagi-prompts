'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { fill } from '@/components/brand-studio/copy';
import { startRefDrag } from '@/components/brand-studio/refs';
import { COMPOSE_ASPECTS, COMPOSE_DIMENSIONS, type CaptionPosition } from '@/lib/brand-studio/compose/timeline';
import {
  FIXTURE_MATERIALS,
  FIXTURE_MEASURED_LUFS,
  FIXTURE_REFERENCES,
  FIXTURE_TRACK_IDS,
  fixtureTrack,
  materialBySrc,
  materialSeconds,
} from '@/lib/brand-studio/editor-v2/fixture';
import { filmContents } from '@/lib/brand-studio/editor-v2/film-contents';
import { clipFrameAt, formatTimecode, type FrameCaption } from '@/lib/brand-studio/editor-v2/frames';
import { sourceSeconds } from '@/lib/brand-studio/editor-v2/sources';
import { everyCutMissing } from '@/lib/brand-studio/editor-v2/sources';
import { filmHasSpeedTheOldEditorChanges } from '@/lib/brand-studio/editor-v2/stored';
import { formatBinding, type ShortcutAction } from '@/lib/brand-studio/editor-v2/shortcuts';
import {
  CAPTION_OUTPUTS,
  CAPTION_STYLE_IDS,
  DEFAULT_REFRAME,
  DUCK_LEVELS,
  LOOK_DETAILS,
  LOOK_IDS,
  PLATFORM_LUFS,
  SAFE_AREAS,
  TITLE_PRESETS,
  formatClock,
  gradeMatrix,
  loudnessReadout,
  type GradeDetail,
  type ScopeMode,
} from '@/lib/brand-studio/editor-v2/model';
import { EditorIcon } from './icons';
import { FilmContentsList } from './film-contents-list';
import { ASPECT_KEYS, type EditorApi } from './use-editor';
import { SpeedPanel } from './speed-panel';
import styles from './editor-v2.module.css';

// ── Small shared controls ──────────────────────────────────────────────────────────────────────

function Seg<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.seg} role="group" aria-label={label}>
      {options.map((option) => (
        <button key={String(option.value)} type="button" aria-pressed={option.value === value} disabled={option.disabled} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step = 1,
  display,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className={styles.range}>
      <span>{label}</span>
      <output>{display}</output>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function Toggle({ label, note, on, onChange, children }: { label: string; note: string; on: boolean; onChange: (on: boolean) => void; children?: ReactNode }) {
  return (
    <div className={styles.action} data-on={on ? '' : undefined}>
      <button type="button" className={styles.actionMain} role="switch" aria-checked={on} onClick={() => onChange(!on)}>
        <span className={styles.actionText}>
          <strong>{label}</strong>
          <small>{note}</small>
        </span>
        <span className={styles.switch} aria-hidden="true" />
      </button>
      {on && children}
    </div>
  );
}

function Finding({ text, fix, onFix }: { text: string; fix?: string; onFix?: () => void }) {
  return (
    <li className={styles.finding} data-editor-finding>
      <p>{text}</p>
      {fix && onFix && (
        <button type="button" className={styles.fixBtn} onClick={onFix}>
          {fix}
        </button>
      )}
    </li>
  );
}

function Section({ title, children, tag }: { title: string; children: ReactNode; tag?: string }) {
  return (
    <section className={styles.section}>
      <h3>
        {title}
        {tag && <span className={styles.sampleTag}>{tag}</span>}
      </h3>
      {children}
    </section>
  );
}

function ScopeSwitch({ api }: { api: EditorApi }) {
  const { copy } = api;
  const options: Array<{ value: ScopeMode; label: string; disabled?: boolean }> = [
    { value: 'all', label: copy.scope.all },
    { value: 'current', label: api.activeClip ? `${copy.scope.current} · ${api.activeClip.index + 1}` : copy.scope.current },
    {
      value: 'selected',
      label: api.selection.length === 0 ? copy.scope.selectedNone : fill(copy.scope.selected, { count: api.selection.length }),
      disabled: api.selection.length === 0,
    },
  ];
  return (
    <div className={styles.scope} data-editor-scope>
      <span>{copy.scope.label}</span>
      <Seg label={copy.scope.label} value={api.scopeMode} options={options} onChange={api.setScopeMode} />
    </div>
  );
}

// ── Left: materials ────────────────────────────────────────────────────────────────────────────

export function Materials({ api, draggableSources = false }: { api: EditorApi; draggableSources?: boolean }) {
  const { copy, workspace } = api;
  return (
    <aside className={styles.materials} aria-label={copy.panel.materials} data-editor-materials={workspace}>
      {api.locked ? (
        <p className={styles.note} data-editor-locked-materials>{copy.real.locked.materials}</p>
      ) : (
        <>
          {workspace === 'cut' && (api.real ? <RealBin api={api} draggableSources={draggableSources} /> : <CutMaterials api={api} />)}
          {workspace === 'color' && <ColorMaterials api={api} />}
          {workspace === 'sound' && <SoundMaterials api={api} />}
          {workspace === 'captions' && <CaptionMaterials api={api} />}
        </>
      )}
    </aside>
  );
}

/**
 * The organization's footage (V1): video assets and finished video-studio cuts. A card puts the whole
 * clip at the end of the film once its frame rate is read. When right-side chat is open (`draggableSources`),
 * cards also carry `REF_DRAG_TYPE` so they can be dragged into the chat panel.
 */
function RealBin({ api, draggableSources = false }: { api: EditorApi; draggableSources?: boolean }) {
  const { copy } = api;
  const c = copy.cut.materials;
  const closed = api.readOnly || api.status !== 'ready';
  return (
    <>
      <div className={styles.tabs} role="presentation">
        <span className={styles.tabStatic}>{c.clips}</span>
      </div>
      <p className={styles.note}>{copy.real.binNote}</p>
      {api.sources.length === 0 ? (
        <p className={styles.note} data-editor-bin-empty>{copy.real.binEmpty}</p>
      ) : (
        <ul className={styles.clipGrid}>
          {api.sources.map((source) => {
            const busy = api.busySource === source.key;
            const rate = api.rates[source.srcUrl];
            const seconds = sourceSeconds(source);
            const dragProps = draggableSources
              ? {
                  draggable: !closed,
                  onDragStart: (event: React.DragEvent<HTMLButtonElement>) => {
                    if (closed) return;
                    startRefDrag(event, source.kind === 'output' ? { outputId: source.id } : { assetId: source.id });
                  },
                }
              : {};
            return (
              <li key={source.key}>
                <button
                  type="button"
                  className={styles.materialCard}
                  onClick={() => void api.addSource(source)}
                  disabled={closed || busy}
                  title={c.add}
                  data-editor-source={source.key}
                  data-busy={busy ? '' : undefined}
                  {...dragProps}
                >
                  <span className={styles.materialThumb} style={source.thumbUrl ? { backgroundImage: `url(${source.thumbUrl})` } : undefined}>
                    {!source.thumbUrl && <video src={`${source.srcUrl}#t=0.1`} muted playsInline preload="metadata" aria-hidden="true" />}
                    {seconds !== null && <em>{formatClock(seconds)}</em>}
                    <i aria-hidden="true"><EditorIcon name="plus" /></i>
                  </span>
                  <span className={styles.materialMeta}>
                    <strong title={source.label}>{source.label}</strong>
                    <small>
                      {busy ? copy.real.adding : source.kind === 'output' ? c.fromVideoStudio : c.fromAssets}
                      {!busy && rate ? ` · ${rate} fps` : ''}
                    </small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/**
 * A workspace a real film cannot use yet: says so, and shows the way to the sample film when it is offered
 * (`BRAND_WORKSPACE_PROTOTYPE_LAYER=on`; otherwise neither the link nor a sentence about it).
 */
function LockedPanel({ api, classicHref }: { api: EditorApi; classicHref?: string }) {
  const { copy, workspace } = api;
  const name = copy.workspaces[workspace];
  const inClassic = workspace === 'color' ? copy.real.locked.classicColor : workspace === 'sound' ? copy.real.locked.classicSound : copy.real.locked.classicCaptions;
  // A cut the earlier editor plays at another speed: what is placed on it there may land elsewhere here (audit B5).
  const speedDiffers = filmHasSpeedTheOldEditorChanges(api.sequence);
  const sampleHref = api.sampleHref(workspace);
  return (
    <>
      <PanelHead title={name} />
      <section className={styles.lockedCard} data-editor-locked={workspace}>
        <strong>{fill(copy.real.locked.heading, { workspace: name })}</strong>
        <p className={styles.note}>{sampleHref ? copy.real.locked.body : copy.real.locked.bodyNoSample}</p>
        {workspace === 'captions' && <p className={styles.note}>{copy.real.locked.captionsKept}</p>}
        {sampleHref && (
          <a className={styles.sampleLink} href={sampleHref} data-editor-sample-link={workspace}>
            {copy.real.locked.open}
          </a>
        )}
      </section>
      {classicHref && workspace !== 'cut' && (
        <section className={styles.lockedCard} data-editor-locked-classic={workspace}>
          <p className={styles.note}>{inClassic}</p>
          {speedDiffers && (
            <p className={styles.note} data-editor-classic-speed>
              {copy.real.locked.classicSpeed}
            </p>
          )}
          <a className={styles.sampleLink} href={classicHref} data-editor-classic-link={workspace}>
            {copy.notice.current}
          </a>
        </section>
      )}
    </>
  );
}

function Tabs<T extends string>({ value, options, onChange }: { value: T; options: ReadonlyArray<{ value: T; label: string }>; onChange: (value: T) => void }) {
  return (
    <div className={styles.tabs} role="tablist">
      {options.map((option) => (
        <button key={option.value} type="button" role="tab" aria-selected={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function CutMaterials({ api }: { api: EditorApi }) {
  const { copy } = api;
  const tab = api.tabs.cut;
  const c = copy.cut;
  return (
    <>
      <Tabs value={tab} options={[{ value: 'clips', label: c.materials.clips }, { value: 'titles', label: c.materials.titles }]} onChange={(value) => api.setTab('cut', value)} />
      {tab === 'clips' ? (
        <>
          <p className={styles.note}>{c.materials.note}</p>
          <ul className={styles.clipGrid}>
            {FIXTURE_MATERIALS.map((material) => (
              <li key={material.id}>
                <button type="button" className={styles.materialCard} onClick={() => api.addMaterial(material)} title={c.materials.add} data-editor-material={material.id}>
                  <span className={styles.materialThumb} style={{ backgroundImage: `url(${material.poster})` }}>
                    <em>{formatClock(materialSeconds(material))}</em>
                    <i aria-hidden="true"><EditorIcon name="plus" /></i>
                  </span>
                  <span className={styles.materialMeta}>
                    <strong>{material.origin === 'sample' ? c.materials.frameClip : fill(c.materials.clipLabel, { number: material.id.replace(/\D/g, '') })}</strong>
                    <small>
                      {material.origin === 'video_studio' ? c.materials.fromVideoStudio : material.origin === 'sample' ? c.materials.fromSample : c.materials.fromAssets}
                      {` · ${material.fps} fps`}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className={styles.note}>{c.titles.note}</p>
          <ul className={styles.titleList}>
            {TITLE_PRESETS.map((preset) => (
              <li key={preset}>
                <button type="button" className={styles.titlePreset} data-preset={preset} onClick={() => api.addTitle(preset)}>
                  <span>{preset === 'big' ? c.titles.bigText : preset === 'lower' ? c.titles.lowerText : c.titles.endText}</span>
                  <small>{c.titles[preset]}</small>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function ColorMaterials({ api }: { api: EditorApi }) {
  const { copy, doc, sequence } = api;
  const tab = api.tabs.color;
  const c = copy.color;
  const poster = api.activeClip?.clip.thumbUrl ?? sequence.clips[0]?.thumbUrl ?? '';
  const uniformLook = api.targetIds.length > 0 ? doc.looks[api.targetIds[0]!]?.lookId : undefined;
  const lookOn = (id: string) => api.targetIds.every((target) => doc.looks[target]?.source === 'look' && doc.looks[target]?.lookId === id);
  return (
    <>
      <Tabs value={tab} options={[{ value: 'looks', label: c.materials.looks }, { value: 'references', label: c.materials.references }]} onChange={(value) => api.setTab('color', value)} />
      {tab === 'looks' ? (
        <>
          <p className={styles.note}>{c.materials.looksNote}</p>
          <svg className={styles.defs} aria-hidden="true" focusable="false">
            {LOOK_IDS.map((id) => (
              <filter key={id} id={`ev2-look-${id}`} colorInterpolationFilters="sRGB">
                <feColorMatrix type="matrix" values={gradeMatrix(LOOK_DETAILS[id], 0.85).join(' ')} />
              </filter>
            ))}
          </svg>
          <ul className={styles.lookGrid}>
            {LOOK_IDS.map((id) => (
              <li key={id}>
                <button type="button" className={styles.lookTile} aria-pressed={uniformLook === id && lookOn(id)} onClick={() => api.applyLook(id)} data-editor-look={id}>
                  <span style={{ backgroundImage: `url(${poster})`, filter: `url(#ev2-look-${id})` }} />
                  <strong>{c.looks[id]}</strong>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className={styles.note}>{c.materials.referencesNote}</p>
          <ul className={styles.lookGrid}>
            {sequence.clips.map((clip, index) => {
              const label = fill(c.materials.cut, { number: index + 1 });
              return (
                <li key={clip.id}>
                  <button type="button" className={styles.lookTile} onClick={() => api.applyMatch(clip.srcUrl, label, api.targetIds.filter((id) => id !== clip.id))} data-editor-reference={`cut-${index + 1}`}>
                    <span style={{ backgroundImage: `url(${clip.thumbUrl ?? ''})` }} />
                    <strong>{label}</strong>
                  </button>
                </li>
              );
            })}
            {FIXTURE_REFERENCES.map((reference, index) => {
              const label = fill(c.materials.brandImage, { number: index + 1 });
              return (
                <li key={reference.id}>
                  <button type="button" className={styles.lookTile} onClick={() => api.applyMatch(reference.src, label)} data-editor-reference={reference.id}>
                    <span style={{ backgroundImage: `url(${reference.src})` }} />
                    <strong>{label}</strong>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}

function SoundMaterials({ api }: { api: EditorApi }) {
  const { copy, doc } = api;
  const m = copy.sound.materials;
  const tracks = FIXTURE_TRACK_IDS.map((id) => fixtureTrack(id, m[id], m[`${id}Mood`]));
  return (
    <>
      <div className={styles.tabs} role="presentation">
        <span className={styles.tabStatic}>{m.music}</span>
        <span className={styles.sampleTag}>{copy.panel.sample}</span>
      </div>
      <p className={styles.note}>{m.note}</p>
      <ul className={styles.trackList}>
        {tracks.map((track) => {
          const using = doc.music?.id === track.id;
          return (
            <li key={track.id} data-on={using ? '' : undefined}>
              <span className={styles.trackMeta}>
                <strong>{track.label}</strong>
                <small>{track.mood} · {formatClock(track.durationSec)}</small>
              </span>
              <button type="button" className={styles.fixBtn} onClick={() => api.setMusic(using ? null : track)} data-editor-track={track.id}>
                {using ? m.remove : m.use}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function CaptionLine({ api, caption, number }: { api: EditorApi; caption: FrameCaption; number: number }) {
  const [draft, setDraft] = useState(caption.text);
  useEffect(() => setDraft(caption.text), [caption.text]);
  const save = () => {
    const text = draft.trim();
    if (text && text !== caption.text) api.updateCaptionText(caption.id, text);
    else setDraft(caption.text);
  };
  const active = api.playhead >= caption.start && api.playhead < caption.end;
  return (
    <li className={styles.scriptLine} data-active={active ? '' : undefined}>
      <button type="button" className={styles.scriptTime} onClick={() => api.seek(caption.start)}>
        {formatTimecode(caption.start, api.fps)}
      </button>
      <textarea
        value={draft}
        rows={2}
        aria-label={fill(api.copy.captions.materials.line, { number })}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => api.seek(caption.start)}
        onBlur={save}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        data-editor-caption-text={number}
      />
      <button type="button" className={styles.iconBtn} onClick={() => api.removeCaption(caption.id)} aria-label={api.copy.captions.materials.remove} title={api.copy.captions.materials.remove}>
        <EditorIcon name="trash" />
      </button>
    </li>
  );
}

function CaptionMaterials({ api }: { api: EditorApi }) {
  const { copy, sequence } = api;
  const order = [...sequence.captions].sort((a, b) => a.start - b.start);
  return (
    <>
      <div className={styles.tabs} role="presentation">
        <span className={styles.tabStatic}>{copy.captions.materials.script}</span>
      </div>
      {order.length === 0 ? (
        <p className={styles.note}>{copy.captions.materials.empty}</p>
      ) : (
        <ul className={styles.script}>
          {order.map((caption, index) => (
            <CaptionLine key={caption.id} api={api} caption={caption} number={index + 1} />
          ))}
        </ul>
      )}
    </>
  );
}

// ── Right: what you can do, following the selection ────────────────────────────────────────────

export function ActionPanel({ api, classicHref }: { api: EditorApi; classicHref?: string }) {
  const { copy, workspace } = api;
  return (
    <aside className={styles.panel} aria-label={copy.panel.actions} data-editor-panel={workspace}>
      {api.locked ? (
        <LockedPanel api={api} classicHref={classicHref} />
      ) : (
        <>
          {workspace === 'cut' && <CutPanel api={api} />}
          {workspace === 'color' && <ColorPanel api={api} />}
          {workspace === 'sound' && <SoundPanel api={api} />}
          {workspace === 'captions' && <CaptionsPanel api={api} />}
        </>
      )}
    </aside>
  );
}

/**
 * What the stored film carries besides the cuts (music, effects, colour, images, captions made in the
 * earlier editor), read-only, so nobody is surprised by the exported file (review round 1, item 6).
 */
function StoredContents({ api }: { api: EditorApi }) {
  const contents = filmContents(api.sequence, api.filmView?.film ?? null, api.filmView?.anchor ?? null);
  if (!contents.captions && !contents.grade && !contents.music && !contents.effects && !contents.stills) return null;
  return (
    <Section title={api.copy.real.contents.heading}>
      <div data-editor-film-contents>
        <FilmContentsList contents={contents} copy={api.copy} gradeNames={api.gradeNames} withCuts={false} />
        <p className={styles.note}>{api.copy.real.contents.note}</p>
      </div>
    </Section>
  );
}

function PanelHead({ title, meta }: { title: string; meta?: string }) {
  return (
    <header className={styles.panelHead}>
      <h2>{title}</h2>
      {meta && <span>{meta}</span>}
    </header>
  );
}

/** The keys a first-time person needs; the full list and rebinding live in the shortcut panel. */
const KEY_ROWS = ['play', 'split', 'trimStart', 'trimEnd', 'stepForward', 'stepForward10', 'nextCut', 'remove', 'undo', 'zoomFrames', 'magnet'] as const;

function KeyCaps({ api, action }: { api: EditorApi; action: ShortcutAction }) {
  const keys = api.shortcutMap[action];
  if (keys.length === 0) return <span className={styles.keyNone}>{api.copy.shortcuts.none}</span>;
  return (
    <>
      {keys.map((binding) => (
        <kbd key={binding}>{formatBinding(binding, api.mac).join(' ')}</kbd>
      ))}
    </>
  );
}

function CutPanel({ api }: { api: EditorApi }) {
  const { copy, doc, sequence, spans, fps } = api;
  const c = copy.cut;
  const title = doc.titles.find((item) => item.id === api.selectedTitleId);
  if (title) {
    return (
      <>
        <PanelHead title={c.titles[title.preset]} meta={`${formatTimecode(title.start, fps)} – ${formatTimecode(title.end, fps)}`} />
        <Section title={c.title.text}>
          <input className={styles.textInput} value={title.text} maxLength={40} onChange={(event) => api.updateTitle(title.id, event.target.value)} onKeyDown={(event) => event.stopPropagation()} />
        </Section>
        <button type="button" className={styles.quietBtn} onClick={() => api.removeTitle(title.id)}>
          <EditorIcon name="trash" />
          {c.title.remove}
        </button>
      </>
    );
  }
  if (api.selection.length === 1) {
    const span = spans.find((entry) => entry.clip.id === api.selection[0]);
    if (span) {
      const clip = span.clip;
      const reframe = doc.reframe[clip.id] ?? DEFAULT_REFRAME;
      const material = materialBySrc(clip.srcUrl);
      const dims = COMPOSE_DIMENSIONS[sequence.aspect];
      const outFrame = clipFrameAt(clip, clip.frames - 1, fps).mediaFrame + 1;
      const canSlide = !!material && material.ratio > dims.width / dims.height + 0.01 && reframe.fit === 'fill';
      // A file confirmed missing (a 404 the organization's record confirms) says so, before (and instead of) "the rate
      // has not been read yet" (audit A4). A 404 alone keeps the old line.
      const missing = api.real && !!api.missingSources[clip.srcUrl];
      const rateUnknown = api.real && !!api.unknownRates[clip.srcUrl];
      return (
        <>
          <PanelHead title={fill(copy.panel.cut, { number: span.index + 1 })} meta={formatTimecode(span.frames, fps)} />
          <Section title={c.clip.length}>
            <p className={styles.readout} data-editor-clip-readout>
              <span>{formatTimecode(clip.inFrame, fps)}</span>
              <i aria-hidden="true" />
              <span>{formatTimecode(outFrame, fps)}</span>
            </p>
            <p className={styles.note}>
              {fill(c.clip.frames, { count: span.frames, fps })} {c.clip.lengthHint}
            </p>
            {missing ? (
              <p className={styles.note} data-editor-source-missing>{copy.real.sourceMissing}</p>
            ) : rateUnknown ? (
              <p className={styles.note} data-editor-rate-unknown>{fill(copy.real.rateUnknown, { fps })}</p>
            ) : api.real && clip.sourceFps !== fps ? (
              <p className={styles.note} data-editor-source-rate>{fill(copy.real.sourceRate, { rate: clip.sourceFps, fps })}</p>
            ) : null}
            {!missing && api.real && api.variableRates[clip.srcUrl] && (
              <p className={styles.note} data-editor-rate-variable>{copy.real.rateVariable}</p>
            )}
          </Section>
          <Section title={c.clip.speed}>
            <SpeedPanel
              clip={clip}
              clipIndex={span.index}
              clipStart={span.start}
              playhead={api.playhead}
              fps={fps}
              readOnly={api.readOnly}
              copy={api.copy}
              onSetConstant={api.setConstantSpeed}
              onSetCurve={api.setSpeedCurve}
              onReset={api.resetSpeed}
            />
          </Section>
          {/* Framing is not stored or exported yet, so a real film does not offer it (V7). */}
          {!api.real && (
            <Section title={c.clip.framing}>
              <Seg
                label={c.clip.framing}
                value={reframe.fit}
                options={[{ value: 'fill', label: c.clip.fill }, { value: 'fit', label: c.clip.fit }]}
                onChange={(fit) => api.setReframe([clip.id], { fit })}
              />
              {canSlide && (
                <Range label={c.clip.position} value={reframe.x} min={0} max={100} display={`${Math.round(reframe.x)}`} onChange={(x) => api.setReframe([clip.id], { x })} />
              )}
            </Section>
          )}
          <Section title={c.clip.sound}>
            <Range
              label={c.clip.volume}
              value={Math.round((clip.muted ? 0 : clip.volume) * 100)}
              min={0}
              max={100}
              display={clip.muted ? c.clip.mute : `${Math.round(clip.volume * 100)}`}
              disabled={api.readOnly}
              onChange={(value) => api.setClipAudio(span.index, value === 0 ? clip.volume : value / 100, value === 0)}
            />
            {/* A real film's cut is heard in the preview while it plays; the sample footage has no sound. */}
            {!api.real && <p className={styles.note} data-editor-cut-sound-note>{copy.sound.listen.unavailable}</p>}
          </Section>
          <button type="button" className={styles.quietBtn} onClick={() => api.removeClips([clip.id])} disabled={api.readOnly}>
            <EditorIcon name="trash" />
            {c.clip.remove}
          </button>
        </>
      );
    }
  }
  if (api.selection.length > 1) {
    return (
      <>
        <PanelHead title={fill(copy.panel.cuts, { count: api.selection.length })} />
        <button type="button" className={styles.quietBtn} onClick={() => api.removeClips(api.selection)} disabled={api.readOnly}>
          <EditorIcon name="trash" />
          {c.clip.remove}
        </button>
      </>
    );
  }
  const cannotCut = api.readOnly || sequence.clips.length === 0;
  const filmGone = api.real ? everyCutMissing(sequence.clips, api.missingSources) : null;
  return (
    <>
      <PanelHead title={copy.panel.film} meta={fill(copy.panel.filmSummary, { count: sequence.clips.length, duration: formatTimecode(api.total, fps) })} />
      {api.real && api.tentative && (filmGone ? (
        // Every cut's file is confirmed missing: no rate will be read next time, so the film says why instead.
        <p className={styles.note} data-editor-film-missing>{fill(copy.export.sourceMissing, { clip: filmGone.label })}</p>
      ) : (
        <p className={styles.note} data-editor-rate-tentative>{fill(copy.real.rateTentative, { fps })}</p>
      ))}
      {api.real && <StoredContents api={api} />}
      <Section title={c.film.shape}>
        <div className={styles.shapeGrid} role="group" aria-label={c.film.shape}>
          {COMPOSE_ASPECTS.map((aspect) => {
            const dims = COMPOSE_DIMENSIONS[aspect];
            return (
              <button key={aspect} type="button" aria-pressed={sequence.aspect === aspect} onClick={() => api.setAspect(aspect)} disabled={api.readOnly} data-editor-aspect={aspect}>
                <i style={{ aspectRatio: `${dims.width} / ${dims.height}` }} aria-hidden="true" />
                <strong>{aspect}</strong>
                <small>{copy.aspectNames[ASPECT_KEYS[aspect]]}</small>
              </button>
            );
          })}
        </div>
      </Section>
      {api.findings.croppedIds.length > 0 && (
        <Section title={copy.panel.found}>
          <ul className={styles.findings}>
            <Finding text={fill(c.findings.cropped, { count: api.findings.croppedIds.length })} fix={c.findings.croppedFix} onFix={api.centerOnSubject} />
          </ul>
        </Section>
      )}
      <Section title={c.quick.heading}>
        <div className={styles.quickRow}>
          <button type="button" className={styles.fixBtn} onClick={api.splitAtPlayhead} disabled={cannotCut}>{c.quick.split}<KeyCaps api={api} action="split" /></button>
          <button type="button" className={styles.fixBtn} onClick={() => api.trimToPlayhead('start')} disabled={cannotCut}>{c.quick.trimStart}<KeyCaps api={api} action="trimStart" /></button>
          <button type="button" className={styles.fixBtn} onClick={() => api.trimToPlayhead('end')} disabled={cannotCut}>{c.quick.trimEnd}<KeyCaps api={api} action="trimEnd" /></button>
        </div>
      </Section>
      <details className={styles.fine} data-editor-keys>
        <summary>{copy.shortcuts.heading}<EditorIcon name="chevron" /></summary>
        <dl className={styles.keys}>
          {KEY_ROWS.map((action) => (
            <div key={action}>
              <dt>{copy.shortcuts.actions[action]}</dt>
              <dd><KeyCaps api={api} action={action} /></dd>
            </div>
          ))}
        </dl>
        <button type="button" className={styles.fixBtn} onClick={() => api.setShortcutsOpen(true)} data-editor-shortcuts-open>
          {copy.shortcuts.open}
        </button>
      </details>
    </>
  );
}

const DETAIL_KEYS: ReadonlyArray<keyof GradeDetail> = ['exposure', 'contrast', 'temperature', 'saturation'];

function ColorPanel({ api }: { api: EditorApi }) {
  const { copy, doc } = api;
  const c = copy.color;
  const looks = api.targetIds.map((id) => doc.looks[id]);
  const first = looks[0];
  const anyLook = looks.some(Boolean);
  const uniform = looks.every((look) => look?.source === first?.source && look?.lookId === first?.lookId && look?.reference === first?.reference);
  const appliedLabel = !anyLook
    ? c.applied.none
    : !uniform || !first
      ? c.applied.mixed
      : first.source === 'auto'
        ? c.applied.auto
        : first.source === 'match'
          ? fill(c.applied.match, { reference: first.reference ?? '' })
          : first.source === 'look' && first.lookId
            ? c.looks[first.lookId]
            : c.applied.manual;
  const detail = first?.detail ?? { exposure: 0, contrast: 0, temperature: 0, saturation: 0 };
  return (
    <>
      <PanelHead title={copy.workspaces.color} />
      <ScopeSwitch api={api} />
      <Section title={copy.panel.found}>
        {api.findings.color.length === 0 ? (
          <p className={styles.note}>{copy.panel.nothingFound}</p>
        ) : (
          <ul className={styles.findings}>
            {api.findings.color.map((finding) =>
              finding.kind === 'mixed_temperature' ? (
                <Finding key={finding.kind} text={c.findings.mixed} fix={c.findings.fixMixed} onFix={() => api.applyAuto(finding.clipIds)} />
              ) : (
                <Finding
                  key={finding.kind}
                  text={fill(finding.kind === 'dark_cut' ? c.findings.dark : c.findings.bright, { number: finding.clipNumber })}
                  fix={c.findings.fixBrightness}
                  onFix={() => api.applyAuto([finding.clipId])}
                />
              ),
            )}
          </ul>
        )}
      </Section>
      <Section title={copy.panel.actions}>
        <div className={styles.actions}>
          <button type="button" className={styles.actionBtn} onClick={() => api.applyAuto()} data-editor-action="auto">
            <strong>{c.actions.auto}</strong>
            <small>{c.actions.autoNote}</small>
          </button>
          <button type="button" className={styles.actionBtn} onClick={() => api.setTab('color', 'references')} data-editor-action="match">
            <strong>{c.actions.match}</strong>
            <small>{api.tabs.color === 'references' ? c.actions.matchPick : c.actions.matchNote}</small>
          </button>
          <button type="button" className={styles.actionBtn} onClick={() => api.applyLook('brand')} data-editor-action="brand">
            <strong>{c.actions.brand}</strong>
            <small>{c.actions.brandNote}</small>
          </button>
        </div>
      </Section>
      <Section title={copy.panel.applied}>
        <p className={styles.appliedLine} data-on={anyLook ? '' : undefined} data-editor-applied>{appliedLabel}</p>
        {anyLook && (
          <>
            <Range
              label={c.applied.strength}
              value={Math.round((first?.strength ?? 1) * 100)}
              min={0}
              max={100}
              display={`${Math.round((first?.strength ?? 1) * 100)}`}
              onChange={(value) => api.adjustLook({ strength: value / 100 })}
            />
            <div className={styles.quickRow}>
              <button type="button" className={styles.fixBtn} aria-pressed={api.compare} onClick={() => api.setCompare(!api.compare)}>
                <EditorIcon name="compare" />
                {c.applied.compare}
              </button>
              <button type="button" className={styles.fixBtn} onClick={api.resetLook}>{c.applied.reset}</button>
            </div>
          </>
        )}
      </Section>
      <details className={styles.fine}>
        <summary>{copy.panel.fineTune}<EditorIcon name="chevron" /></summary>
        {DETAIL_KEYS.map((key) => (
          <Range
            key={key}
            label={c.detail[key]}
            value={Math.round(detail[key] * 100)}
            min={-100}
            max={100}
            display={`${detail[key] > 0 ? '+' : ''}${Math.round(detail[key] * 100)}`}
            onChange={(value) => api.adjustLook({ detail: { [key]: value / 100 } })}
          />
        ))}
      </details>
    </>
  );
}

function SoundPanel({ api }: { api: EditorApi }) {
  const { copy, doc, spans } = api;
  const s = copy.sound;
  const meter = loudnessReadout(FIXTURE_MEASURED_LUFS, doc.sound);
  const selected = api.selection.length === 1 ? spans.find((span) => span.clip.id === api.selection[0]) : undefined;
  const lufs = (value: number) => value.toFixed(1).replace('-', '−');
  return (
    <>
      <PanelHead title={copy.workspaces.sound} meta={copy.panel.film} />
      <div className={styles.meter} data-on={meter.onTarget ? '' : undefined} data-editor-meter>
        <span>{s.meter.heading}<em className={styles.sampleTag}>{copy.panel.sample}</em></span>
        <strong>{lufs(meter.lufs)}<small>LUFS</small></strong>
        <span className={styles.meterBar} aria-hidden="true">
          <i style={{ width: `${Math.min(100, Math.max(6, ((meter.lufs + 30) / 20) * 100))}%` }} />
          <b style={{ left: `${((PLATFORM_LUFS + 30) / 20) * 100}%` }} />
        </span>
        <small>{meter.onTarget ? s.meter.onTarget : s.meter.off} · {s.meter.target} {lufs(PLATFORM_LUFS)}</small>
      </div>
      <Section title={copy.panel.found}>
        {api.findings.sound.length === 0 ? (
          <p className={styles.note}>{copy.panel.nothingFound}</p>
        ) : (
          <ul className={styles.findings}>
            {api.findings.sound.map((finding) =>
              finding.kind === 'loudness' ? (
                <Finding key={finding.kind} text={fill(s.findings.loudness, { measured: lufs(finding.measured), target: lufs(finding.target) })} fix={s.findings.fixLoudness} onFix={() => api.setSound({ loudness: true })} />
              ) : finding.kind === 'music_over_speech' ? (
                <Finding key={finding.kind} text={fill(s.findings.masked, { count: finding.count })} fix={s.findings.fixMasked} onFix={() => api.setSound({ duck: 'medium' })} />
              ) : (
                <Finding key={finding.kind} text={s.findings.noMusic} />
              ),
            )}
          </ul>
        )}
      </Section>
      <Section title={copy.panel.actions}>
        <div className={styles.actions}>
          <Toggle label={s.actions.speech} note={s.actions.speechNote} on={doc.sound.speechClear} onChange={(on) => api.setSound({ speechClear: on })} />
          <Toggle label={s.actions.duck} note={s.actions.duckNote} on={!!doc.sound.duck} onChange={(on) => api.setSound({ duck: on ? 'medium' : null })}>
            <Seg
              label={s.actions.duck}
              value={doc.sound.duck}
              options={DUCK_LEVELS.map((level) => ({ value: level, label: level === 'light' ? s.actions.duckLight : level === 'medium' ? s.actions.duckMedium : s.actions.duckStrong }))}
              onChange={(level) => api.setSound({ duck: level })}
            />
          </Toggle>
          <Toggle label={s.actions.loudness} note={fill(s.actions.loudnessNote, { target: lufs(PLATFORM_LUFS) })} on={doc.sound.loudness} onChange={(on) => api.setSound({ loudness: on })} />
          <Toggle label={s.actions.fades} note={s.actions.fadesNote} on={doc.sound.fades} onChange={(on) => api.setSound({ fades: on })} />
        </div>
      </Section>
      <div className={styles.listen}>
        <div className={styles.quickRow}>
          <button type="button" className={styles.fixBtn} disabled>{s.listen.before}</button>
          <button type="button" className={styles.fixBtn} disabled>{s.listen.after}</button>
        </div>
        <p className={styles.note}>{s.listen.unavailable}</p>
      </div>
      <details className={styles.fine}>
        <summary>{copy.panel.fineTune}<EditorIcon name="chevron" /></summary>
        <Range label={s.detail.musicVolume} value={Math.round(doc.sound.musicVolume * 100)} min={0} max={100} display={`${Math.round(doc.sound.musicVolume * 100)}`} onChange={(value) => api.setSound({ musicVolume: value / 100 })} />
        {selected && (
          <Range
            label={fill(s.detail.clipVolume, { number: selected.index + 1 })}
            value={Math.round((selected.clip.muted ? 0 : selected.clip.volume) * 100)}
            min={0}
            max={100}
            display={`${Math.round((selected.clip.muted ? 0 : selected.clip.volume) * 100)}`}
            onChange={(value) => api.setClipAudio(selected.index, value === 0 ? selected.clip.volume : value / 100, value === 0)}
          />
        )}
      </details>
    </>
  );
}

function CaptionsPanel({ api }: { api: EditorApi }) {
  const { copy, doc, sequence } = api;
  const c = copy.captions;
  const settings = doc.captionSettings;
  const has = sequence.captions.length > 0;
  const position: CaptionPosition | null = has && sequence.captions.every((caption) => caption.position === sequence.captions[0]!.position) ? sequence.captions[0]!.position : null;
  const poster = api.activeClip?.clip.thumbUrl ?? '';
  const platform = (id: 'reels' | 'shorts' | 'tiktok') => c.safe[id];
  return (
    <>
      <PanelHead title={copy.workspaces.captions} meta={copy.panel.film} />
      <Section title={copy.panel.found}>
        {api.captionsBusy ? (
          <p className={styles.progress} role="status" data-editor-progress>
            <span aria-hidden="true" />
            {c.making}
          </p>
        ) : api.findings.captions.length === 0 ? (
          <p className={styles.note}>{copy.panel.nothingFound}</p>
        ) : (
          <ul className={styles.findings}>
            {api.findings.captions.map((finding) =>
              finding.kind === 'no_captions' ? (
                <Finding key={finding.kind} text={fill(c.findings.none, { count: finding.spoken })} fix={c.findings.make} onFix={() => api.makeCaptions()} />
              ) : (
                <Finding key={finding.kind} text={fill(c.findings.covered, { count: finding.count, platform: platform(finding.platform) })} fix={c.findings.lift} onFix={() => api.setCaptionSettings({ lift: true })} />
              ),
            )}
          </ul>
        )}
      </Section>
      <Section title={c.style.heading}>
        <ul className={styles.styleGrid}>
          {CAPTION_STYLE_IDS.map((id) => (
            <li key={id}>
              <button type="button" className={styles.styleTile} aria-pressed={settings.styleId === id} onClick={() => api.setCaptionSettings({ styleId: id })} data-editor-caption-style={id}>
                <span style={{ backgroundImage: `url(${poster})` }}>
                  <em className={styles.caption} data-style={id} data-position="tile">{c.style.sample}</em>
                </span>
                <strong>{c.style[id]}</strong>
              </button>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={c.position.heading}>
        <Seg
          label={c.position.heading}
          value={position}
          options={(['bottom', 'center', 'top'] as const).map((value) => ({ value, label: c.position[value], disabled: !has }))}
          onChange={api.setCaptionPosition}
        />
      </Section>
      <Section title={c.safe.heading}>
        <Seg label={c.safe.heading} value={settings.safeArea} options={SAFE_AREAS.map((value) => ({ value, label: c.safe[value] }))} onChange={(safeArea) => api.setCaptionSettings({ safeArea, ...(safeArea === 'none' ? { lift: false } : {}) })} />
        <p className={styles.note}>{sequence.aspect === '9:16' ? c.safe.note : c.safe.verticalOnly}</p>
      </Section>
      <Section title={c.output.heading}>
        <Seg label={c.output.heading} value={settings.output} options={CAPTION_OUTPUTS.map((value) => ({ value, label: c.output[value] }))} onChange={(output) => api.setCaptionSettings({ output })} />
        {settings.output !== 'burn' && <p className={styles.note}>{c.output.fileNote}</p>}
      </Section>
      {has && (
        <button type="button" className={styles.quietBtn} onClick={() => api.removeCaption('all')}>
          <EditorIcon name="trash" />
          {c.removeAll}
        </button>
      )}
    </>
  );
}
