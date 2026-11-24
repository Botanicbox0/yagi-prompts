"use client";
/**
 * The reference-video (reverse) panel (docs/BRAND-STUDIO-V3.md §6): a large drawer that takes a clip,
 * reads it into a shot table the customer can correct, lets them choose how to use it (remake from the
 * blueprint / attach and follow / edit this video), what changes and what stays, and starts a 480p
 * draft. The 1080p final stays the result's own "1080p로 완성" action.
 *
 * Opened by the screen's start card, by `?start=reverse` (with `&asset=<id>` to preselect a clip) and by
 * the window event `STUDIO_OPEN_REVERSE` (`detail: { assetId? , jobId? }` — a job id sets the panel up as
 * that remix was sent). On start it fires `STUDIO_JOB_STARTED` and closes; the gallery picks the job up.
 *
 * Techniques (docs/design/TOOLBOX.md §1-3): frosted milky quartz on the drawer's sticky head and foot,
 * recessed wells for every cell of the shot table, tabular numerals on times and credits, concentric
 * radius (drawer 24 = section 16 + 8). The drawer slides in on a spring; reduced motion turns it off.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  STUDIO_AUDIO_MODES,
  STUDIO_KEEP_KEYS,
  STUDIO_LIMITS,
  STUDIO_UPLOAD_MIMES,
  type FilmShot,
  type StudioAssetView,
  type StudioState,
} from "@/lib/brand-studio/contracts";
import { windowText, type AllowanceWindowView } from "@/lib/brand-studio/allowance-window";
import { creditsLeft, formatCredits } from "@/lib/brand-studio/credits";
import { blueprintFit, remakeSeconds } from "@/lib/brand-studio/reference-video";
import type { StudioVideoCopy } from "@/messages/studio-video";
import { createStudioApi, isFailure, measureInBrowser, uploadProblem, type StudioApi } from "../api";
import { errorLine, newRequestId, type StudioCopy, type StudioLocale } from "../copy";
import { StudioIcon } from "../icons";
import { useModal } from "../modal";
import { STUDIO_JOB_STARTED, STUDIO_OPEN_REVERSE, announce } from "../seams";
import {
  CHANGE_SLOTS,
  REVERSE_METHODS,
  aspectFor,
  buildReverseJob,
  clipNotice,
  defaultKeep,
  draftCredits,
  draftFromJob,
  editShot,
  emptyDraft,
  fillText,
  imageNumbers,
  methodsFor,
  pickMethod,
  removeShot,
  reverseModel,
  setShotEnd,
  tableOf,
  type ChangeSlot,
  type ReadState,
  type ReverseDraft,
  type ReverseProblem,
} from "./reverse-model";
import s from "./video.module.css";

export interface ReversePanelProps {
  organizationId: string;
  locale: StudioLocale;
  /** `dict.brandStudio`: error sentences. */
  copy: StudioCopy;
  /** `dict.studioVideo`. */
  video: StudioVideoCopy;
  /** `?start=reverse`: open on arrival. */
  initialOpen?: boolean;
  /** `?asset=<id>`: the clip to start from. */
  initialAssetId?: string | null;
  /** Tests inject a stub client. */
  api?: StudioApi;
}

type Pending = { assetId?: string; jobId?: string } | null;

export function ReversePanel({ organizationId, locale, copy, video: t, initialOpen = false, initialAssetId = null, api: injected }: ReversePanelProps) {
  const api = useMemo(() => injected ?? createStudioApi({ organizationId }), [injected, organizationId]);
  const model = useMemo(() => reverseModel(), []);
  const [open, setOpen] = useState(initialOpen);
  const [state, setState] = useState<StudioState | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [draft, setDraft] = useState<ReverseDraft>(() => emptyDraft(model));
  const [reads, setReads] = useState<Record<string, ReadState>>({});
  const [pending, setPending] = useState<Pending>(initialAssetId ? { assetId: initialAssetId } : null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<"video" | ChangeSlot | null>(null);
  const press = useRef<{ fingerprint: string; id: string } | null>(null);

  // Opened from anywhere on the page: the start card, the explainer, the rail's "+" menu, the dock.
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      const ask = detail && typeof detail === "object" ? (detail as Record<string, unknown>) : {};
      setPending({
        ...(typeof ask.assetId === "string" ? { assetId: ask.assetId } : {}),
        ...(typeof ask.jobId === "string" ? { jobId: ask.jobId } : {}),
      });
      setNotice(null);
      setOpen(true);
    };
    window.addEventListener(STUDIO_OPEN_REVERSE, onOpen);
    return () => window.removeEventListener(STUDIO_OPEN_REVERSE, onOpen);
  }, []);

  const load = useCallback(async () => {
    setPhase("loading");
    const result = await api.loadState();
    if (isFailure(result)) return setPhase("failed");
    setState(result);
    setPhase("ready");
  }, [api]);

  useEffect(() => {
    if (open && phase === "idle") void load();
  }, [open, phase, load]);

  const assets = useMemo(() => state?.assets ?? [], [state?.assets]);
  const videos = useMemo(() => assets.filter((a) => a.kind === "video"), [assets]);
  const images = useMemo(() => assets.filter((a) => a.kind === "image"), [assets]);
  const clip = draft.videoId ? (assets.find((a) => a.id === draft.videoId) ?? null) : null;
  const read: ReadState = clip ? (reads[clip.id] ?? { status: "idle" }) : { status: "idle" };
  const sheet = read.status === "done" ? read.sheet : null;
  const table = useMemo(() => tableOf(draft, sheet), [draft, sheet]);
  const allowed = useMemo(() => methodsFor(model, clip, table), [model, clip, table]);

  const readClip = useCallback(
    async (assetId: string, again = false) => {
      if (!again && reads[assetId]) return;
      setReads((current) => ({ ...current, [assetId]: { status: "loading" } }));
      const result = await api.call("film.analyze", { organizationId, assetId, depth: "blueprint" });
      setReads((current) => ({ ...current, [assetId]: { status: "done", sheet: isFailure(result) ? null : result.sheet } }));
    },
    [api, organizationId, reads],
  );

  const choose = useCallback(
    (asset: StudioAssetView) => {
      setNotice(null);
      // A new clip starts from the remake; the check below steps down when the clip cannot be remade.
      setDraft((current) => ({
        ...current,
        videoId: asset.id,
        shots: null,
        method: "blueprint",
        keep: defaultKeep("blueprint"),
        aspect: aspectFor(model, asset),
        seconds: remakeSeconds(model, asset.seconds),
      }));
      void readClip(asset.id);
    },
    [model, readClip],
  );

  // What the opener asked for, once the library is here.
  useEffect(() => {
    if (!pending || phase !== "ready" || !state) return;
    if (pending.jobId) {
      const job = state.jobs.find((j) => j.id === pending.jobId);
      const rebuilt = job ? draftFromJob(job, state.assets, model) : null;
      if (rebuilt) {
        setDraft(rebuilt);
        if (rebuilt.videoId) void readClip(rebuilt.videoId);
      }
    } else if (pending.assetId) {
      const asset = state.assets.find((a) => a.id === pending.assetId && a.kind === "video");
      if (asset) choose(asset);
    }
    setPending(null);
  }, [pending, phase, state, model, choose, readClip]);

  // A way the clip does not allow is never left selected, decided once the reading has answered (a clip
  // too long or short to read has nothing to wait for).
  useEffect(() => {
    if (!clip) return;
    if (read.status !== "done" && blueprintFit(model, clip).readable) return;
    const next = pickMethod(draft.method, allowed);
    if (next !== draft.method) setDraft((current) => ({ ...current, method: next, keep: defaultKeep(next) }));
  }, [clip, model, read.status, allowed, draft.method]);

  const imageCount = draft.images.length;
  const addImage = useCallback(
    (asset: StudioAssetView, slot: ChangeSlot) => {
      if (imageCount >= model.maxReferenceImages) return setNotice(fillText(t.reverse.change.tooManyImages, { n: model.maxReferenceImages }));
      setDraft((current) =>
        current.images.some((i) => i.assetId === asset.id)
          ? current
          : { ...current, images: [...current.images, { assetId: asset.id, url: asset.url, thumbUrl: asset.thumbUrl, name: asset.name, slot }] },
      );
    },
    [imageCount, model, t],
  );

  const upload = useCallback(
    async (file: File, slot: "video" | ChangeSlot) => {
      setNotice(null);
      const problem = uploadProblem(file);
      if (problem) return setNotice(errorLine(copy, problem));
      setUploading(slot);
      const result = await api.upload(file, { measure: measureInBrowser, ...(slot === "video" ? {} : { role: slot }) });
      setUploading(null);
      if (isFailure(result)) return setNotice(errorLine(copy, result.code));
      setState((current) => (current ? { ...current, assets: [result.asset, ...current.assets.filter((a) => a.id !== result.asset.id)] } : current));
      const wanted = slot === "video" ? "video" : "image";
      if (result.asset.kind !== wanted) return setNotice(errorLine(copy, "unsupported_file"));
      if (slot === "video") choose(result.asset);
      else addImage(result.asset, slot);
    },
    [api, copy, choose, addImage],
  );

  const canCreate = state?.canCreate ?? false;
  const open4Run = canCreate && (state?.allowance.capKrw ?? 0) > 0;
  const credits = draftCredits(draft, clip, model);
  const left = state ? creditsLeft(state.allowance.capKrw, state.allowance.usedKrw) : 0;
  const words = { product: t.reverse.change.product, person: t.reverse.change.person, place: t.reverse.change.place, imageWord: t.reverse.change.imageWord };
  const problemLine: Record<ReverseProblem, string> = {
    video: t.reverse.run.needVideo,
    reading: t.reverse.run.needReading,
    change: t.reverse.run.needChange,
    images: fillText(t.reverse.change.tooManyImages, { n: model.maxReferenceImages }),
    method: t.reverse.method.unavailable,
  };

  async function start() {
    if (busy) return;
    const built = buildReverseJob(draft, { video: clip, sheet, words }, { organizationId, requestId: "pending" }, model);
    if (!built.ok) return setNotice(problemLine[built.problem]);
    const fingerprint = JSON.stringify({ ...built.input, requestId: null });
    if (press.current?.fingerprint !== fingerprint) press.current = { fingerprint, id: newRequestId() };
    setBusy(true);
    setNotice(null);
    const result = await api.call("job.create", { ...built.input, requestId: press.current.id });
    setBusy(false);
    if (isFailure(result)) return setNotice(errorLine(copy, result.code, state?.allowance.window));
    press.current = null;
    announce(STUDIO_JOB_STARTED, { jobId: result.job.id });
    setOpen(false);
  }

  return (
    <div data-studio-reverse="" data-studio-reverse-open={open ? "" : undefined}>
      {open && (
        <ReverseDrawer
          t={t}
          copy={copy}
          locale={locale}
          phase={phase}
          onRetryLoad={() => void load()}
          videos={videos}
          images={images}
          draft={draft}
          setDraft={setDraft}
          clip={clip}
          read={read}
          table={table}
          allowed={allowed}
          uploading={uploading}
          canCreate={canCreate}
          runOpen={open4Run}
          allowanceWindow={state?.allowance.window ?? null}
          credits={credits}
          left={left}
          busy={busy}
          notice={notice}
          onChoose={choose}
          onReadAgain={() => clip && void readClip(clip.id, true)}
          onUpload={(file, slot) => void upload(file, slot)}
          onAddImage={addImage}
          onStart={() => void start()}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Why the run button is off, or null when it is on: viewers cannot make anything; a team without credits sees the
 * closed line — "this month" on the calendar month, without it on a billing cycle (R1).
 */
export function reverseRunLine(
  run: Pick<StudioVideoCopy["reverse"]["run"], "readOnly" | "closed" | "closedCycle">,
  input: { canCreate: boolean; runOpen: boolean; window?: Pick<AllowanceWindowView, "kind"> | null },
): string | null {
  if (!input.canCreate) return run.readOnly;
  return input.runOpen ? null : windowText(input.window, run.closed, run.closedCycle);
}

interface DrawerProps {
  t: StudioVideoCopy;
  copy: StudioCopy;
  locale: StudioLocale;
  phase: "idle" | "loading" | "ready" | "failed";
  onRetryLoad(): void;
  videos: StudioAssetView[];
  images: StudioAssetView[];
  draft: ReverseDraft;
  setDraft: Dispatch<SetStateAction<ReverseDraft>>;
  clip: StudioAssetView | null;
  read: ReadState;
  table: FilmShot[];
  allowed: Record<ReverseDraft["method"], boolean>;
  uploading: "video" | ChangeSlot | null;
  canCreate: boolean;
  runOpen: boolean;
  /** R1: the allowance window; a billing cycle drops "this month" from the closed line. */
  allowanceWindow: AllowanceWindowView | null;
  credits: number;
  left: number;
  busy: boolean;
  notice: string | null;
  onChoose(asset: StudioAssetView): void;
  onReadAgain(): void;
  onUpload(file: File, slot: "video" | ChangeSlot): void;
  onAddImage(asset: StudioAssetView, slot: ChangeSlot): void;
  onStart(): void;
  onClose(): void;
}

function ReverseDrawer(props: DrawerProps) {
  const { t, locale, draft, setDraft, clip, read, table, allowed } = props;
  const r = t.reverse;
  const ref = useModal();
  const id = useId();
  const model = useMemo(() => reverseModel(), []);
  const disabled = !props.canCreate || props.busy;
  const notice = clip ? clipNotice(model, clip) : null;
  const limits = model.referenceVideoSeconds;
  const noticeLine =
    notice === "tooShort"
      ? fillText(r.pick.tooShort, { min: limits.min })
      : notice === "tooLong"
        ? fillText(r.pick.tooLong, { max: limits.max })
        : notice === "small"
          ? r.pick.small
          : notice === "large"
            ? r.pick.large
            : notice === "editShort"
              ? fillText(r.pick.editShort, { n: limits.editMin })
              : null;
  const sheet = read.status === "done" ? read.sheet : null;
  const remake = draft.method !== "edit";
  const numbers = imageNumbers(draft.images);
  const total = sheet?.seconds && sheet.seconds > 0 ? sheet.seconds : (clip?.seconds ?? table[table.length - 1]?.end ?? 0);
  const setTable = (next: FilmShot[]) => setDraft((current) => ({ ...current, shots: next }));
  const runLine = reverseRunLine(r.run, { canCreate: props.canCreate, runOpen: props.runOpen, window: props.allowanceWindow });

  return (
    <dialog
      ref={ref}
      className={s.drawer}
      aria-labelledby={`${id}-title`}
      data-studio-reverse-panel
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
    >
      <div className={s.drawerInner}>
        <header className={s.drawerHead}>
          <h2 id={`${id}-title`}>{r.title}</h2>
          <button type="button" className="bs-btn bs-icon-btn" data-variant="ghost" data-size="sm" aria-label={r.close} onClick={props.onClose}>
            <StudioIcon name="close" />
          </button>
        </header>

        <div className={s.drawerBody}>
          {props.phase === "loading" && (
            <p className={s.quiet} role="status">
              {r.loading}
            </p>
          )}
          {props.phase === "failed" && (
            <div className={s.inlineAlert} role="alert">
              <p>{r.loadFailed}</p>
              <button type="button" className="bs-btn" data-variant="soft" data-size="sm" onClick={props.onRetryLoad}>
                {r.retry}
              </button>
            </div>
          )}

          {/* 1. The clip */}
          <section className={s.section} aria-labelledby={`${id}-video`} data-reverse-step="video">
            <h3 id={`${id}-video`} className={s.sectionTitle}>
              {r.sections.video}
            </h3>
            {clip ? (
              <div className={s.clip} data-reverse-clip={clip.id}>
                <video className={s.clipMedia} src={clip.url} poster={clip.thumbUrl ?? undefined} muted loop playsInline controls preload="metadata" />
                <div className={s.clipText}>
                  <p className={s.clipName}>{clip.name}</p>
                  <p className={`${s.quiet} bs-num`}>
                    {clip.width && clip.height
                      ? fillText(r.pick.meta, { seconds: (clip.seconds ?? 0).toFixed(1), width: clip.width, height: clip.height })
                      : fillText(r.pick.metaShort, { seconds: (clip.seconds ?? 0).toFixed(1) })}
                  </p>
                  {noticeLine && (
                    <p className={s.limit} role="status" data-reverse-limit={notice ?? undefined}>
                      {noticeLine}
                    </p>
                  )}
                  <button
                    type="button"
                    className="bs-btn"
                    data-variant="soft"
                    data-size="sm"
                    onClick={() => setDraft((current) => ({ ...current, videoId: null, shots: null }))}
                    disabled={props.busy}
                  >
                    {r.pick.replace}
                  </button>
                </div>
              </div>
            ) : (
              <ClipPicker t={t} videos={props.videos} uploading={props.uploading === "video"} disabled={!props.canCreate} onChoose={props.onChoose} onUpload={(file) => props.onUpload(file, "video")} />
            )}
          </section>

          {/* 2. What was read */}
          {clip && (
            <section className={s.section} aria-labelledby={`${id}-read`} data-reverse-step="read" data-film-state={read.status === "done" ? (sheet ? "read" : "unread") : read.status}>
              <div className={s.sectionHead}>
                <h3 id={`${id}-read`} className={s.sectionTitle}>
                  {r.sections.read}
                </h3>
                {read.status === "done" && !sheet && (
                  <button type="button" className="bs-btn" data-variant="soft" data-size="sm" onClick={props.onReadAgain}>
                    {r.read.retry}
                  </button>
                )}
                {draft.shots && (
                  <button type="button" className="bs-btn" data-variant="ghost" data-size="sm" onClick={() => setDraft((current) => ({ ...current, shots: null }))}>
                    {r.read.reset}
                  </button>
                )}
              </div>
              {read.status === "loading" && (
                <p className={`${s.quiet} ${s.reading}`} role="status" aria-live="polite">
                  {r.read.reading}
                </p>
              )}
              {read.status === "done" && !sheet && (
                <p className={s.quiet} role="status">
                  {r.read.failed}
                </p>
              )}
              {sheet && (
                <>
                  <p className={s.summary}>{sheet.summary}</p>
                  <ShotTable t={t} table={table} total={total} edited={Boolean(draft.shots)} disabled={disabled} onChange={setTable} />
                  <dl className={s.facts}>
                    {(sheet.look.lighting || sheet.look.palette || sheet.look.texture) && (
                      <div>
                        <dt>{r.read.look}</dt>
                        <dd>
                          {[
                            sheet.look.lighting && `${r.read.lighting}: ${sheet.look.lighting}`,
                            sheet.look.palette && `${r.read.palette}: ${sheet.look.palette}`,
                            sheet.look.texture && `${r.read.texture}: ${sheet.look.texture}`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt>{r.read.sound}</dt>
                      <dd>
                        {`${r.read.music} ${sheet.audio.music ? r.read.yes : r.read.no} · ${r.read.speech} ${sheet.audio.speech ? r.read.yes : r.read.no}`}
                        {sheet.audio.effects ? ` · ${r.read.effects}: ${sheet.audio.effects}` : ""}
                      </dd>
                    </div>
                    {sheet.subjects?.length ? (
                      <div>
                        <dt>{r.read.subjects}</dt>
                        <dd>{sheet.subjects.map((x) => `${x.what} ×${x.count}`).join(" · ")}</dd>
                      </div>
                    ) : null}
                    {sheet.setting ? (
                      <div>
                        <dt>{r.read.setting}</dt>
                        <dd>{sheet.setting}</dd>
                      </div>
                    ) : null}
                  </dl>
                </>
              )}
            </section>
          )}

          {/* 3. How */}
          {clip && (
            <section className={s.section} aria-labelledby={`${id}-method`} data-reverse-step="method">
              <h3 id={`${id}-method`} className={s.sectionTitle}>
                {r.method.label}
              </h3>
              <div className={s.methods} role="radiogroup" aria-labelledby={`${id}-method`}>
                {REVERSE_METHODS.map((method) => {
                  const off = !allowed[method];
                  const why = method === "blueprint" && read.status !== "done" ? r.method.needsReading : off ? r.method.unavailable : null;
                  return (
                    <label key={method} className={s.method} data-reverse-method={method} data-selected={draft.method === method ? "" : undefined} data-off={off ? "" : undefined}>
                      <input
                        type="radio"
                        name={`${id}-method-choice`}
                        value={method}
                        checked={draft.method === method}
                        disabled={disabled || off}
                        onChange={() => setDraft((current) => ({ ...current, method, keep: defaultKeep(method) }))}
                      />
                      <span className={s.methodTitle}>{r.method[method].title}</span>
                      <span className={s.methodLine}>{r.method[method].line}</span>
                      {why && <span className={s.methodWhy}>{why}</span>}
                    </label>
                  );
                })}
              </div>
            </section>
          )}

          {/* 4. What changes, what stays, sound */}
          {clip && (
            <section className={s.section} aria-labelledby={`${id}-change`} data-reverse-step="change">
              <h3 id={`${id}-change`} className={s.sectionTitle}>
                {r.change.label}
              </h3>
              <div className={s.slots}>
                {CHANGE_SLOTS.map((slot) => (
                  <ChangeRow
                    key={slot}
                    slot={slot}
                    t={t}
                    value={draft.change[slot]}
                    images={draft.images.filter((i) => i.slot === slot)}
                    numbers={numbers}
                    library={props.images}
                    uploading={props.uploading === slot}
                    disabled={disabled}
                    onText={(text) => setDraft((current) => ({ ...current, change: { ...current.change, [slot]: text } }))}
                    onAdd={(asset) => props.onAddImage(asset, slot)}
                    onRemove={(assetId) => setDraft((current) => ({ ...current, images: current.images.filter((i) => i.assetId !== assetId) }))}
                    onUpload={(file) => props.onUpload(file, slot)}
                  />
                ))}
              </div>
              <label className={s.fieldLabel} htmlFor={`${id}-note`}>
                {r.change.note}
              </label>
              <textarea
                id={`${id}-note`}
                className="bs-field"
                rows={2}
                maxLength={STUDIO_LIMITS.promptMax}
                value={draft.note}
                placeholder={r.change.notePlaceholder}
                disabled={disabled}
                onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
              />
              {remake ? (
                <>
                  <div className={s.row}>
                    <span className={s.fieldLabel} id={`${id}-keep`}>
                      {r.change.keep}
                    </span>
                    <div className={s.chips} role="group" aria-labelledby={`${id}-keep`}>
                      {STUDIO_KEEP_KEYS.map((key) => {
                        const on = draft.keep.includes(key);
                        return (
                          <button
                            key={key}
                            type="button"
                            className="bs-chip"
                            data-size="sm"
                            data-selected={on ? "" : undefined}
                            aria-pressed={on}
                            disabled={disabled}
                            onClick={() =>
                              setDraft((current) => ({ ...current, keep: on ? current.keep.filter((k) => k !== key) : [...current.keep, key] }))
                            }
                          >
                            {r.change.keepKeys[key]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className={s.row}>
                    <label className={s.fieldLabel} htmlFor={`${id}-length`}>
                      {r.change.length}
                    </label>
                    <select
                      id={`${id}-length`}
                      className={`bs-field ${s.select}`}
                      value={draft.seconds}
                      disabled={disabled}
                      onChange={(event) => setDraft((current) => ({ ...current, seconds: Number(event.target.value) }))}
                    >
                      {Array.from({ length: model.maxSeconds - model.minSeconds + 1 }, (_, i) => model.minSeconds + i).map((n) => (
                        <option key={n} value={n}>
                          {fillText(r.change.seconds, { n })}
                        </option>
                      ))}
                    </select>
                    {clip.seconds ? <span className={`${s.quiet} bs-num`}>{fillText(r.change.lengthHint, { n: clip.seconds.toFixed(1) })}</span> : null}
                    <label className={s.fieldLabel} htmlFor={`${id}-aspect`}>
                      {r.change.aspect}
                    </label>
                    <select
                      id={`${id}-aspect`}
                      className={`bs-field ${s.select}`}
                      value={draft.aspect}
                      disabled={disabled}
                      onChange={(event) => setDraft((current) => ({ ...current, aspect: event.target.value }))}
                    >
                      {model.aspects.map((aspect) => (
                        <option key={aspect} value={aspect}>
                          {aspect}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : (
                <p className={s.quiet}>{r.change.editNote}</p>
              )}
              <div className={s.row}>
                <span className={s.fieldLabel} id={`${id}-sound`}>
                  {r.change.sound}
                </span>
                <div className="bs-seg" role="radiogroup" aria-labelledby={`${id}-sound`}>
                  {STUDIO_AUDIO_MODES.map((mode) => (
                    <label key={mode} className="bs-seg-option">
                      <input
                        type="radio"
                        name={`${id}-sound-choice`}
                        value={mode}
                        checked={draft.audio === mode}
                        disabled={disabled}
                        onChange={() => setDraft((current) => ({ ...current, audio: mode }))}
                      />
                      <span>{r.change.soundModes[mode]}</span>
                    </label>
                  ))}
                </div>
              </div>
            </section>
          )}
        </div>

        {/* 5. Run */}
        <footer className={s.drawerFoot} data-reverse-step="run">
          <div className={s.footText}>
            {props.notice && (
              <p className={s.alert} role="alert">
                {props.notice}
              </p>
            )}
            {runLine ? (
              <p className={s.quiet}>{runLine}</p>
            ) : (
              <p className={s.quiet}>
                <span className="bs-num">{fillText(r.run.left, { n: formatCredits(props.left, locale) })}</span>
                {" · "}
                {r.run.finalNote}
              </p>
            )}
          </div>
          <button
            type="button"
            className="bs-btn"
            data-variant="solid"
            data-size="md"
            disabled={props.busy || !props.runOpen || !clip}
            onClick={props.onStart}
            data-reverse-start
          >
            {props.busy ? r.run.starting : r.run.draft}
            {clip && !props.busy && <span className={`${s.cost} bs-num`}>{fillText(r.run.cost, { n: formatCredits(props.credits, locale) })}</span>}
          </button>
        </footer>
      </div>
    </dialog>
  );
}

function ClipPicker({
  t,
  videos,
  uploading,
  disabled,
  onChoose,
  onUpload,
}: {
  t: StudioVideoCopy;
  videos: StudioAssetView[];
  uploading: boolean;
  disabled: boolean;
  onChoose(asset: StudioAssetView): void;
  onUpload(file: File): void;
}) {
  const r = t.reverse;
  const model = reverseModel();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={s.picker} data-reverse-picker>
      <div className={s.uploadRow}>
        <button type="button" className="bs-btn" data-variant="soft" data-size="md" disabled={disabled || uploading} onClick={() => input.current?.click()}>
          <StudioIcon name="upload" />
          {uploading ? r.pick.uploading : r.pick.upload}
        </button>
        <input
          ref={input}
          type="file"
          hidden
          accept={STUDIO_UPLOAD_MIMES.video.join(",")}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onUpload(file);
          }}
        />
        <p className={s.quiet}>
          {fillText(r.pick.hint, { mb: Math.round(STUDIO_LIMITS.videoBytesMax / 1_000_000), min: model.referenceVideoSeconds.min, max: model.referenceVideoSeconds.max })}
        </p>
      </div>
      <p className={s.fieldLabel}>{r.pick.library}</p>
      {videos.length === 0 ? (
        <p className={s.quiet}>{r.pick.empty}</p>
      ) : (
        <ul className={s.clipGrid}>
          {videos.map((asset) => (
            <li key={asset.id}>
              <button type="button" className={s.clipTile} aria-label={fillText(r.pick.choose, { name: asset.name })} onClick={() => onChoose(asset)} data-reverse-library-clip={asset.id}>
                {asset.thumbUrl ? <img src={asset.thumbUrl} alt="" loading="lazy" /> : <video src={`${asset.url}#t=0.1`} muted playsInline preload="metadata" aria-hidden="true" />}
                {asset.seconds ? <span className={`${s.tileBadge} bs-num`}>{fillText(r.pick.metaShort, { seconds: asset.seconds.toFixed(1) })}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ShotTable({
  t,
  table,
  total,
  edited,
  disabled,
  onChange,
}: {
  t: StudioVideoCopy;
  table: FilmShot[];
  total: number;
  edited: boolean;
  disabled: boolean;
  onChange(next: FilmShot[]): void;
}) {
  const r = t.reverse.read;
  const c = r.columns;
  return (
    <div className={s.tableWrap} data-reverse-shots={table.length} data-reverse-shots-edited={edited ? "" : undefined}>
      <p className={s.fieldLabel}>
        {r.shots}
        {edited && <span className={s.editedTag}>{r.edited}</span>}
      </p>
      <p className={s.quiet}>{r.shotsHint}</p>
      <table className={s.table}>
        <thead>
          <tr>
            <th scope="col">{c.time}</th>
            <th scope="col">{c.framing}</th>
            <th scope="col">{c.camera}</th>
            <th scope="col">{c.action}</th>
            <th scope="col">{c.transition}</th>
            <td aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {table.map((shot, i) => {
            const n = i + 1;
            const last = i === table.length - 1;
            const cell = (field: "framing" | "camera" | "action" | "transition", label: string) => (
              <td data-label={label}>
                <textarea
                  className={s.cell}
                  rows={2}
                  maxLength={200}
                  aria-label={`${fillText(r.shot, { n })} · ${label}`}
                  value={shot[field] ?? ""}
                  disabled={disabled || (field === "transition" && last)}
                  onChange={(event) => onChange(editShot(table, i, { [field]: event.target.value }))}
                />
              </td>
            );
            return (
              <tr key={i} data-reverse-shot={n}>
                <th scope="row" data-label={c.time}>
                  <span className={`${s.time} bs-num`}>{shot.start.toFixed(1)}–</span>
                  {last ? (
                    <span className={`${s.time} bs-num`}>{(total || shot.end).toFixed(1)}</span>
                  ) : (
                    <input
                      className={`${s.timeInput} bs-num`}
                      type="number"
                      inputMode="decimal"
                      step={0.1}
                      min={shot.start + 0.1}
                      max={table[i + 1]!.end - 0.1}
                      aria-label={fillText(r.ends, { n })}
                      value={shot.end}
                      disabled={disabled}
                      onChange={(event) => onChange(setShotEnd(table, i, Number(event.target.value), total))}
                    />
                  )}
                </th>
                {cell("framing", c.framing)}
                {cell("camera", c.camera)}
                {cell("action", c.action)}
                {cell("transition", c.transition)}
                <td>
                  <button
                    type="button"
                    className="bs-btn bs-icon-btn"
                    data-variant="ghost"
                    data-size="sm"
                    aria-label={fillText(r.remove, { n })}
                    disabled={disabled || table.length <= 1}
                    onClick={() => onChange(removeShot(table, i))}
                  >
                    <StudioIcon name="trash" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ChangeRow({
  slot,
  t,
  value,
  images,
  numbers,
  library,
  uploading,
  disabled,
  onText,
  onAdd,
  onRemove,
  onUpload,
}: {
  slot: ChangeSlot;
  t: StudioVideoCopy;
  value: string;
  images: ReverseDraft["images"];
  numbers: Map<string, number>;
  library: StudioAssetView[];
  uploading: boolean;
  disabled: boolean;
  onText(text: string): void;
  onAdd(asset: StudioAssetView): void;
  onRemove(assetId: string): void;
  onUpload(file: File): void;
}) {
  const c = t.reverse.change;
  const id = useId();
  const [picking, setPicking] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const label = c[slot];
  const placeholder = slot === "product" ? c.productPlaceholder : slot === "person" ? c.personPlaceholder : c.placePlaceholder;
  return (
    <div className={s.slot} data-reverse-slot={slot}>
      <label className={s.fieldLabel} htmlFor={`${id}-text`}>
        {label}
      </label>
      <div className={s.slotBody}>
        <input
          id={`${id}-text`}
          className="bs-field"
          value={value}
          maxLength={400}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => onText(event.target.value)}
        />
        <ul className={s.refs} aria-label={label}>
          {images.map((image) => {
            const n = numbers.get(image.assetId) ?? 0;
            return (
              <li key={image.assetId} className={s.ref} data-reverse-ref={n}>
                <img src={image.thumbUrl ?? image.url} alt={image.name} />
                <span className={`${s.refNumber} bs-num`}>{n}</span>
                <button type="button" className={s.refRemove} aria-label={fillText(c.removeImage, { n })} disabled={disabled} onClick={() => onRemove(image.assetId)}>
                  <StudioIcon name="close" />
                </button>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              className={s.refAdd}
              aria-label={fillText(c.addImage, { slot: label })}
              aria-expanded={picking}
              disabled={disabled}
              onClick={() => setPicking((p) => !p)}
            >
              <StudioIcon name="plus" />
            </button>
          </li>
        </ul>
      </div>
      {picking && (
        <div className={s.slotPicker} data-reverse-slot-picker={slot}>
          <div className={s.uploadRow}>
            <button type="button" className="bs-btn" data-variant="soft" data-size="sm" disabled={disabled || uploading} onClick={() => input.current?.click()}>
              <StudioIcon name="upload" />
              {uploading ? t.reverse.pick.uploading : c.upload}
            </button>
            <input
              ref={input}
              type="file"
              hidden
              accept={STUDIO_UPLOAD_MIMES.image.join(",")}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) {
                  onUpload(file);
                  setPicking(false);
                }
              }}
            />
          </div>
          <p className={s.fieldLabel}>{c.library}</p>
          {library.length === 0 ? (
            <p className={s.quiet}>{c.libraryEmpty}</p>
          ) : (
            <ul className={s.thumbGrid}>
              {library.map((asset) => (
                <li key={asset.id}>
                  <button
                    type="button"
                    className={s.thumb}
                    aria-label={fillText(c.pick, { name: asset.name })}
                    onClick={() => {
                      onAdd(asset);
                      setPicking(false);
                    }}
                  >
                    <img src={asset.thumbUrl ?? asset.url} alt="" loading="lazy" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
