"use client";
/**
 * The revise conversation in the viewer (flag `BRAND_STUDIO_REVISE_V2`, docs/BRAND-STUDIO-VIDEO-REMIX.md §3.5):
 * the customer's messages on the right, the studio's on the left as plain text, a question's choices as chips
 * under it, one change sheet pinned under the thread (what changes, what stays, what is left out) with the
 * only primary action, and the message box last. The logic is revise-talk-flow.ts; this file is the screen.
 *
 * Without the flag the viewer renders revise-form.tsx instead, untouched.
 */
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { STUDIO_LIMITS, STUDIO_REVISE_MATERIALS_MAX, STUDIO_UPLOAD_MIMES, type StudioJobCreated, type StudioReviseMarkRead } from "@/lib/brand-studio/contracts";
import { creditsOf } from "@/lib/brand-studio/credits";
import type { ReviseSheet } from "@/lib/brand-studio/revision/sheet";
import type { ApiResult } from "./api";
import { credits, errorLine, fill, type StudioCopy, type StudioLocale } from "./copy";
import { StudioIcon } from "./icons";
import type { TrayItem } from "./refs";
import { createFrameGrabber, type FrameGrabber } from "./revise-mark-frame";
import { MarkLayer } from "./revise-mark-layer";
import { MARKS_MAX, chipText, circled, insertDigit, wireGeometry, type MarkGeometry, type MarkState } from "./revise-marks";
import { createTalkFlow, initialTalkState, type TalkDeps, type TalkState } from "./revise-talk-flow";
import { browserTalkStore } from "./revise-talk-store";

export interface TalkSupport {
  organizationId: string;
  talk: TalkDeps["talk"];
  create: TalkDeps["create"];
  upload(files: File[]): Promise<TrayItem[]>;
  readMark?(input: { organizationId: string; outputId: string; frame: string } & ReturnType<typeof wireGeometry>): Promise<ApiResult<StudioReviseMarkRead>>;
  /** The editing studio with this clip ready (the way to shorten or cut, free there). */
  editStudioHref(outputId: string): string;
}

const REFS_MAX = STUDIO_LIMITS.referencesMax - 1;

/** The viewer's other actions behind one quiet control in the conversation's title row. */
export interface TalkMore {
  label: string;
  open: boolean;
  /** The id of the panel it opens. */
  controls: string;
  onToggle(): void;
}

export function MoreButton({ more }: { more: TalkMore }) {
  return (
    <button
      type="button"
      className="bs-btn bs-icon-btn bs-talk-more"
      data-variant="ghost"
      data-size="sm"
      aria-label={more.label}
      title={more.label}
      aria-expanded={more.open}
      aria-controls={more.controls}
      onClick={more.onToggle}
      data-talk-more
    >
      <StudioIcon name="more" />
    </button>
  );
}

/** The sheet, read-only or with remove controls: what changes, what stays, what is left out (empty groups hidden). */
export function SheetCard({
  sheet,
  copy,
  marks,
  fresh = [],
  onRemove,
  busy = false,
  children,
}: {
  sheet: ReviseSheet;
  copy: StudioCopy;
  marks?: readonly MarkState[];
  fresh?: readonly string[];
  onRemove?(index: number): void;
  busy?: boolean;
  children?: React.ReactNode;
}) {
  const t = copy.revise.talk;
  if (!sheet.change.length && !sheet.keep.length && !sheet.exclude.length) return null;
  return (
    <div className="bs-talk-sheet" data-talk-sheet>
      {sheet.change.length > 0 && (
        <div className="bs-talk-group" data-talk-group="change">
          <p className="bs-talk-group-label">{t.groupChange}</p>
          <ul>
            {sheet.change.map((c, i) => (
              <li key={c.text} data-talk-line={i} data-fresh={fresh.includes(c.text) ? "" : undefined}>
                <span className="bs-talk-line-text">{c.text}</span>
                {(c.marks ?? []).map((n) => {
                  const mark = marks?.[n - 1];
                  return mark ? (
                    <span key={n} className="bs-mark-chip" data-static="" data-talk-line-mark={n}>
                      <span className="bs-mark-n" aria-hidden="true">
                        {circled(n)}
                      </span>
                      <span className="bs-mark-text">{chipText(mark)}</span>
                    </span>
                  ) : null;
                })}
                {onRemove && (
                  <button type="button" className="bs-talk-line-x" aria-label={fill(t.removeLine, { text: c.text })} title={fill(t.removeLine, { text: c.text })} disabled={busy} onClick={() => onRemove(i)} data-talk-remove={i}>
                    <StudioIcon name="close" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {sheet.keep.length > 0 && <OneLine group="keep" label={t.groupKeep} items={sheet.keep} />}
      {sheet.exclude.length > 0 && <OneLine group="exclude" label={t.groupExclude} items={sheet.exclude} />}
      {children}
    </div>
  );
}

/** "그대로 둘 것" and "넣지 않을 것": one muted line, cut short when long; pressing it shows all of it. */
function OneLine({ group, label, items }: { group: "keep" | "exclude"; label: string; items: readonly string[] }) {
  const [all, setAll] = useState(false);
  const text = items.join(" · ");
  return (
    <div className="bs-talk-group" data-talk-group={group}>
      <button type="button" className="bs-talk-oneline" aria-expanded={all} title={all ? undefined : text} onClick={() => setAll((v) => !v)}>
        <span className="bs-talk-group-label">{label}</span>
        <span className="bs-talk-group-text">{text}</span>
      </button>
    </div>
  );
}

/** The thread, the sheet card and the box, for one state (tests render it with a fixed state). */
export function TalkView({
  state,
  copy,
  locale,
  draftClip,
  editStudioHref,
  uploading,
  composer,
  marking,
  markable,
  onDraft,
  onSend,
  onChoose,
  onResend,
  onRemove,
  onMake,
  onStartOver,
  onFiles,
  onRemoveAttachment,
  onMarkMode,
  onCaret,
  more,
}: {
  state: TalkState;
  copy: StudioCopy;
  locale: StudioLocale;
  /** The clip on screen is a draft (the one quiet line about finals shows when the plan changes it inside). */
  draftClip: boolean;
  editStudioHref: string | null;
  uploading: boolean;
  composer?: RefObject<HTMLTextAreaElement | null>;
  marking: boolean;
  markable: boolean;
  onDraft(text: string): void;
  onSend(): void;
  onChoose(choice: number | "decide"): void;
  onResend(): void;
  onRemove(index: number): void;
  onMake(): void;
  onStartOver(): void;
  onFiles(files: File[]): void;
  onRemoveAttachment(key: string): void;
  onMarkMode(on: boolean): void;
  onCaret?(at: number): void;
  /** The viewer's other actions, folded behind one control while the conversation is open. */
  more?: TalkMore;
}) {
  const r = copy.revise;
  const t = r.talk;
  const id = useId();
  const files = useRef<HTMLInputElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const ownBox = useRef<HTMLTextAreaElement>(null);
  const box = composer ?? ownBox;
  // The thread is the one part that scrolls, and it keeps to the newest line.
  const lines = state.thread.length;
  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, state.phase]);
  // The box is two lines tall and grows with what is typed, up to about five (min and max are in the CSS;
  // while the viewer is still closed nothing is laid out, and the CSS height stands).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
    else el.style.removeProperty("height");
  }, [state.draft, box]);
  const reading = state.phase === "reading" || state.phase === "slow";
  const busy = reading || state.phase === "making" || state.phase === "loading";
  const open = state.open;
  const price = state.canMake && state.estimateKrw > 0 ? credits(copy.credits.amount, creditsOf(state.estimateKrw), locale) : null;
  const saidKeys = new Set(state.thread.flatMap((i) => (i.from === "customer" ? i.marks : [])));
  const draftMarks = state.marks.filter((m) => !saidKeys.has(m.key));
  const attachedCount = state.thread.reduce((n, i) => n + (i.from === "customer" ? i.references.length : 0), 0) + state.references.length;
  const placeholder = open !== null ? t.answerPlaceholder : state.thread.length ? t.placeholderMore : r.placeholder;
  return (
    <section className="bs-talk" data-revise-talk data-phase={state.phase} aria-label={r.title}>
      <div className="bs-talk-head">
        <h3 className="bs-revise-title">{r.title}</h3>
        <span className="bs-revise-next bs-num">{fill(r.version, { n: state.version })}</span>
        {state.thread.length > 0 && (
          <button type="button" className="bs-btn bs-talk-over" data-variant="ghost" data-size="sm" disabled={busy} onClick={onStartOver} data-talk-start-over>
            {t.startOver}
          </button>
        )}
        {more && <MoreButton more={more} />}
      </div>
      <div ref={thread} className="bs-talk-thread" role="log" aria-live="polite" aria-label={r.title} data-talk-thread>
        {state.thread.map((item) => {
          if (item.from === "customer") {
            return (
              <div key={item.id} className="bs-talk-me" data-talk-customer data-talk-answers={item.answers ?? undefined}>
                <p>{item.text}</p>
                {item.references.length + item.materials.length > 0 && (
                  <ul className="bs-region-ref-list bs-talk-refs">
                    {[...item.references, ...item.materials].map((ref) => (
                      <li key={ref.key} className="bs-region-ref">
                        <span className="bs-thumb" data-static data-kind={ref.kind}>
                          {ref.kind === "video" ? <video src={ref.url} muted playsInline preload="metadata" /> : <img src={ref.thumbUrl ?? ref.url} alt="" />}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          }
          if (item.from === "studio") {
            const asking = item.question !== undefined && item.question === open && !reading;
            const question = item.question !== undefined ? state.questions[item.question] : undefined;
            return (
              <div key={item.id} className="bs-talk-studio" data-talk-studio={item.kind}>
                <p>{item.text}</p>
                {asking && question && (
                  <div className="bs-talk-choices" role="group" aria-label={question.question} data-talk-choices>
                    {question.options.map((option, i) => (
                      <button key={option} type="button" className="bs-chip" data-size="sm" onClick={() => onChoose(i)} data-talk-option={i}>
                        {option}
                      </button>
                    ))}
                    <button type="button" className="bs-chip" data-size="sm" data-variant="quiet" onClick={() => onChoose("decide")} data-talk-decide>
                      {t.decide}
                    </button>
                  </div>
                )}
                {item.editStudio && editStudioHref && (
                  <a className="bs-btn bs-talk-link" data-variant="soft" data-size="sm" href={editStudioHref} data-talk-edit-studio>
                    {t.editStudio}
                  </a>
                )}
              </div>
            );
          }
          if (item.note === "removed") {
            return (
              <p key={item.id} className="bs-muted bs-talk-removed" data-talk-removed>
                {fill(t.removed, { text: item.text ?? "" })}
              </p>
            );
          }
          return (
            <div key={item.id} className="bs-talk-failed" role="alert" data-talk-failed>
              <p>{t.failed}</p>
              <button type="button" className="bs-btn" data-variant="soft" data-size="sm" disabled={busy} onClick={onResend} data-talk-resend>
                {t.resend}
              </button>
            </div>
          );
        })}
        {reading && (
          <p className="bs-muted bs-revise-reading" data-talk-typing={state.phase}>
            <span className="bs-mark-spin" aria-hidden="true" />
            {state.phase === "slow" ? t.slow : t.reading}
          </p>
        )}
      </div>
      <SheetCard sheet={state.sheet} copy={copy} marks={state.marks} fresh={state.fresh} onRemove={onRemove} busy={busy}>
        {state.canMake && state.way && (
          <div className="bs-talk-make" data-talk-make-row>
            {draftClip && state.way === "edit" && (
              <p className="bs-muted bs-talk-draft" data-talk-draft-note>
                {t.draftOnce}
              </p>
            )}
            <button type="button" className="bs-btn bs-submit" data-variant="solid" data-size="md" disabled={busy} aria-busy={state.phase === "making" || undefined} onClick={onMake} data-talk-make>
              <span>{t.make}</span>
              {price && <span className="bs-submit-cost bs-num">{price}</span>}
            </button>
            <p className="bs-muted bs-revise-after" title={fill(r.after, { n: state.version })}>
              {fill(r.after, { n: state.version })}
            </p>
          </div>
        )}
      </SheetCard>
      {state.note && (
        <p className="bs-dock-message" role="alert" data-talk-note>
          {errorLine(copy, state.note)}
        </p>
      )}
      <form
        className="bs-talk-box"
        data-talk-box
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
        onDragOver={(event) => {
          if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
        }}
        onDrop={(event) => {
          if (!event.dataTransfer?.files.length) return;
          event.preventDefault();
          onFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <label className="bs-sr" htmlFor={`${id}-box`}>
          {r.prompt}
        </label>
        <textarea
          id={`${id}-box`}
          ref={box}
          className="bs-field bs-revise-prompt bs-talk-input"
          rows={2}
          maxLength={STUDIO_LIMITS.promptMax}
          value={state.draft}
          placeholder={placeholder}
          disabled={state.phase === "making"}
          data-talk-input
          onSelect={(event) => onCaret?.(event.currentTarget.selectionStart)}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onSend();
            }
          }}
        />
        {(state.references.length > 0 || state.materials.length > 0 || draftMarks.length > 0) && (
          <ul className="bs-region-ref-list bs-talk-attached" data-talk-attached>
            {[...state.references, ...state.materials].map((ref) => (
              <li key={ref.key} className="bs-region-ref">
                <span className="bs-thumb" data-static data-kind={ref.kind}>
                  {ref.kind === "video" ? <video src={ref.url} muted playsInline preload="metadata" /> : <img src={ref.thumbUrl ?? ref.url} alt="" />}
                </span>
                <button type="button" className="bs-thumb-x" aria-label={fill(r.removeRef, { n: "" })} onClick={() => onRemoveAttachment(ref.key)}>
                  <StudioIcon name="close" />
                </button>
              </li>
            ))}
            {draftMarks.map((mark) => {
              const n = state.marks.indexOf(mark) + 1;
              return (
                <li key={mark.key} className="bs-mark-chip" data-reading={mark.reading ? "" : undefined}>
                  <span className="bs-mark-n" aria-hidden="true">
                    {circled(n)}
                  </span>
                  <span className="bs-mark-text">{chipText(mark)}</span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="bs-revise-tools">
          <button type="button" className="bs-btn" data-variant="soft" data-size="sm" disabled={uploading || busy || attachedCount >= REFS_MAX + STUDIO_REVISE_MATERIALS_MAX} onClick={() => files.current?.click()} data-talk-attach>
            <StudioIcon name={uploading ? "spark" : "plus"} />
            {r.addRefs}
          </button>
          <input
            ref={files}
            type="file"
            className="bs-sr"
            tabIndex={-1}
            accept={[...STUDIO_UPLOAD_MIMES.image, ...STUDIO_UPLOAD_MIMES.video].join(",")}
            multiple
            onChange={(event) => {
              const picked = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (picked.length) onFiles(picked);
            }}
          />
          {markable && (
            <button type="button" className="bs-btn bs-mark-toggle" data-variant="soft" data-size="sm" aria-pressed={marking} disabled={busy || (!marking && state.marks.length >= MARKS_MAX)} onClick={() => onMarkMode(!marking)}>
              <StudioIcon name="region" />
              {r.mark}
            </button>
          )}
          <button type="submit" className="bs-btn bs-icon-btn bs-revise-send" data-variant="soft" data-size="sm" aria-disabled={busy || !state.draft.trim() || undefined} aria-label={t.send} title={t.send} data-talk-send>
            <StudioIcon name="arrow" />
          </button>
        </div>
      </form>
    </section>
  );
}

/** The conversation wired to the server and the browser's storage, one per shown result. */
export function ReviseTalk({
  outputId,
  support,
  copy,
  locale,
  draftClip,
  fallbackVersion,
  stage = null,
  onCreated,
  onTalking,
  more,
  onSettled,
}: {
  outputId: string;
  support: TalkSupport;
  copy: StudioCopy;
  locale: StudioLocale;
  draftClip: boolean;
  /** The number the next version gets before the server answers (the viewer's chain + 1). */
  fallbackVersion: number;
  stage?: { video: RefObject<HTMLVideoElement | null>; host: HTMLElement | null; url: string } | null;
  onCreated?(created: StudioJobCreated, version: number, sheet: ReviseSheet): void;
  /** Whether a conversation is under way here (the viewer shortens the version card and marks the version). */
  onTalking?(outputId: string, open: boolean): void;
  more?: TalkMore;
  /** The conversation opened or a studio message arrived: the viewer puts its panel back at the top. */
  onSettled?(): void;
}) {
  const [state, setState] = useState<TalkState>(() => initialTalkState(fallbackVersion));
  const [uploading, setUploading] = useState(false);
  const [marking, setMarkingState] = useState(false);
  const live = useRef(support);
  live.current = support;
  const created = useRef(onCreated);
  created.current = onCreated;
  const composer = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);
  const flow = useMemo(
    () =>
      createTalkFlow({
        organizationId: support.organizationId,
        outputId,
        talk: (input) => live.current.talk(input),
        create: (input) => live.current.create(input),
        store: browserTalkStore(support.organizationId, outputId),
        onChange: setState,
        onCreated: (job, version, sheet) => created.current?.(job, version, sheet),
        decideText: copy.revise.talk.decide,
        fallbackVersion,
      }),
    // A flow per shown result; the support is read through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [outputId, support.organizationId],
  );
  useEffect(() => {
    void flow.load();
    return () => flow.dispose();
  }, [flow]);
  // A conversation under way: something was said and it has not become a version yet.
  const talking = state.phase !== "making" && state.thread.some((item) => item.from === "customer");
  const reportTalking = useRef(onTalking);
  reportTalking.current = onTalking;
  useEffect(() => {
    reportTalking.current?.(outputId, talking);
  }, [outputId, talking]);
  // The keyboard goes back to the box after every studio message, without moving the panel; the panel itself
  // goes back to the top of the conversation when it opens and on every studio message.
  const lastFrom = state.thread[state.thread.length - 1]?.from;
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const studioLines = state.thread.filter((item) => item.from === "studio").length;
  const loading = state.phase === "loading";
  useEffect(() => {
    settled.current?.();
  }, [studioLines, loading]);
  useEffect(() => {
    if (state.phase === "idle" && lastFrom === "studio") composer.current?.focus({ preventScroll: true });
  }, [state.phase, lastFrom]);

  // Marks: one offscreen copy of the clip per panel, loaded when the first mark is read.
  const grabber = useRef<FrameGrabber | null>(null);
  const url = stage?.url ?? null;
  useEffect(() => {
    if (!url) return;
    const instance = createFrameGrabber(url);
    grabber.current = instance;
    return () => {
      instance.dispose();
      if (grabber.current === instance) grabber.current = null;
    };
  }, [url]);
  const setMarking = (on: boolean) => {
    setMarkingState(on);
    if (on) stage?.video.current?.pause();
  };
  const readMark = async (mark: MarkState) => {
    const read = live.current.readMark;
    const frame = grabber.current ? await grabber.current.capture(mark, "#ff58ae").catch(() => null) : null;
    let label: string | null = null;
    let what: string | null = null;
    if (read && frame) {
      const answer = await read({ organizationId: support.organizationId, outputId, ...wireGeometry(mark), frame }).catch(() => null);
      if (answer && answer.ok) {
        label = answer.label?.trim() || null;
        what = answer.what?.trim() || null;
      }
    }
    flow.setMarks(flow.state.marks.map((m) => (m.key === mark.key ? { ...m, reading: false, label, what } : m)));
  };
  const place = (geometry: MarkGeometry) => {
    if (flow.state.marks.length >= MARKS_MAX) return;
    const key = `m${Date.now().toString(36)}`;
    const mark: MarkState = { key, ...geometry, label: null, what: null, reading: Boolean(support.readMark) };
    const written = insertDigit(flow.state.draft, caret.current, flow.state.marks.length + 1);
    flow.setMarks([...flow.state.marks, mark]);
    flow.setDraft(written.text);
    caret.current = written.caret;
    void readMark(mark);
  };
  const host = stage?.host ?? null;
  const said = new Set(state.thread.flatMap((i) => (i.from === "customer" ? i.marks : [])));

  return (
    <>
      {host && stage && (marking || state.marks.some((m) => !said.has(m.key))) && (
        <MarkLayer video={stage.video} host={host} marks={state.marks} active={marking} copy={copy} onPlace={place} onNudge={() => undefined} onLeave={() => setMarking(false)} />
      )}
      <TalkView
        state={state}
        copy={copy}
        locale={locale}
        draftClip={draftClip}
        editStudioHref={support.editStudioHref(outputId)}
        uploading={uploading}
        composer={composer}
        marking={marking}
        markable={Boolean(stage?.host)}
        onDraft={flow.setDraft}
        onSend={() => {
          setMarking(false);
          caret.current = null;
          void flow.send();
        }}
        onChoose={(choice) => void flow.choose(choice)}
        onResend={() => void flow.resend()}
        onRemove={(index) => void flow.remove(index)}
        onMake={() => void flow.make()}
        onStartOver={() => flow.startOver()}
        onFiles={(picked) => {
          setUploading(true);
          void support
            .upload(picked)
            .then((added) => {
              const images = added.filter((a) => a.kind === "image");
              const videos = added.filter((a) => a.kind === "video");
              if (images.length) flow.setReferences([...flow.state.references, ...images].slice(0, REFS_MAX));
              if (videos.length) flow.setMaterials([...flow.state.materials, ...videos].slice(0, STUDIO_REVISE_MATERIALS_MAX));
            })
            .finally(() => setUploading(false));
        }}
        onRemoveAttachment={(key) => {
          flow.setReferences(flow.state.references.filter((r) => r.key !== key));
          flow.setMaterials(flow.state.materials.filter((m) => m.key !== key));
        }}
        onMarkMode={setMarking}
        onCaret={(at) => {
          caret.current = at;
        }}
        more={more}
      />
    </>
  );
}
