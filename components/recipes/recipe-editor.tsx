'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { Dictionary } from '@/messages/en';
import { interpolate } from '@/lib/i18n/format';
import { isRoyalty, quoteRecipe, ROYALTY_MAX_KRW, ROYALTY_MIN_KRW, ROYALTY_STEP_KRW } from '@/lib/recipes/pricing';
import { exportRecipe, MAX_STEP_PROMPT_CHARS, parseRecipe, recipeMedium, SELFIE_SLOT, type Recipe, type RecipeIssue } from '@/lib/recipes/schema';
import { BUTTON, BUTTON_OUTLINE, FIELD, HINT, PANEL } from '@/components/creators/styles';

/**
 * The maker recipe editor (docs/PLATFORM-2.0.md §7.4): editor on the left, the template page preview
 * and the test renders on the right. The maker writes prompts with readable references —
 * `[내 사진]`, `[참조 1]`, `[1단계 결과]` — that the insert buttons put at the cursor; the recipe the
 * server receives is the §7.3 schema (`{{selfie}}`, `{{ref1}}`, `{{step1}}`), built here and checked
 * by the same `parseRecipe` the server and the render pass use. The server re-checks everything.
 */

type Copy = Dictionary['makerRecipe'];
export type EditorMedium = 'video' | 'image' | 'carousel';
export interface EngineOption { id: string; label: string; kind: 'image' | 'video'; minDuration?: number; maxDuration?: number; resolutions?: string[] }
export interface EditorFile { id: string; role: 'reference' | 'example'; kind: 'image' | 'video'; mime: string }
export interface EditorTest { id: string; status: string; errorCode: string | null; outputs: number; createdAt: string }
export interface EditorDraft {
  status: 'draft' | 'submitted' | 'accepted' | 'rejected'; title: string; titleKo: string | null; recipe: unknown; exampleUrl: string | null;
  disclosure: { prompts: boolean; assets: boolean }; presentation: 'make-first' | 'story-first'; royaltyKrw: number; testRendersUsed: number;
  files: EditorFile[]; tests: EditorTest[]; revisionOf: string | null;
}
interface StepState { kind: 'image' | 'video'; engine: string; text: string; aspect: string; duration: number; resolution: '720p' | '1080p' }

const ACTIONS = '/api/makers/formats';
const PENDING = new Set(['held', 'queued', 'running']);
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function RecipeEditor({ copy, formatId, draft, engines, aspects, hasSelfie, selfieHref, workspaceHref, testLimit, revisionOf, locale }: {
  copy: Copy; formatId: string; draft: EditorDraft | null; engines: EngineOption[]; aspects: { image: string[]; video: string[] };
  hasSelfie: boolean; selfieHref: string; workspaceHref: string; testLimit: number; revisionOf?: string; locale: string;
}) {
  const imageEngines = engines.filter((e) => e.kind === 'image'), videoEngines = engines.filter((e) => e.kind === 'video');
  const label = useMemo(() => ({
    selfie: `[${copy.selfieLabel}]`,
    reference: (n: number) => `[${interpolate(copy.referenceLabel, { n: String(n) })}]`,
    step: (n: number) => `[${interpolate(copy.stepResultLabel, { n: String(n) })}]`,
  }), [copy]);
  const newStep = useCallback((kind: 'image' | 'video'): StepState => {
    const engine = (kind === 'image' ? imageEngines : videoEngines)[0]!;
    return { kind, engine: engine.id, text: '', aspect: kind === 'image' ? aspects.image[0]! : aspects.video[0]!, duration: Math.min(10, engine.maxDuration ?? 10), resolution: '720p' };
  }, [imageEngines, videoEngines, aspects]);

  const [files, setFiles] = useState<EditorFile[]>(draft?.files ?? []);
  const references = files.filter((f) => f.role === 'reference');
  const exampleFile = files.find((f) => f.role === 'example') ?? null;

  // Load: tokens → readable labels (by file and step position).
  const [initial] = useState(() => fromRecipe(draft?.recipe, draft?.files ?? [], label));
  const [medium, setMedium] = useState<EditorMedium>(initial?.medium ?? 'video');
  const [steps, setSteps] = useState<StepState[]>(initial?.steps ?? [newStep('video')]);
  const [title, setTitle] = useState(draft?.title ?? '');
  const [titleKo, setTitleKo] = useState(draft?.titleKo ?? '');
  const [example, setExample] = useState(draft?.exampleUrl ?? '');
  const [disclosure, setDisclosure] = useState(draft?.disclosure ?? { prompts: false, assets: false });
  const [presentation, setPresentation] = useState<'make-first' | 'story-first'>(draft?.presentation ?? 'make-first');
  const [royalty, setRoyalty] = useState(draft?.royaltyKrw ?? 1500);
  const [rights, setRights] = useState(false);
  const [status, setStatus] = useState<EditorDraft['status'] | null>(draft?.status ?? null);
  const [tests, setTests] = useState<EditorTest[]>(draft?.tests ?? []);
  const [used, setUsed] = useState(draft?.testRendersUsed ?? 0);
  const [busy, setBusy] = useState<null | 'save' | 'upload' | 'test' | 'submit'>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(initial?.missingFile ? { tone: 'error', text: copy.importMissingFile } : null);
  const [ready, setReady] = useState(false);
  const textareas = useRef<Array<HTMLTextAreaElement | null>>([]);
  useEffect(() => setReady(true), []);
  const editable = status === null || status === 'draft';

  const recipe = useMemo(() => toRecipe(steps, medium, references, label), [steps, medium, references, label]);
  const checked = useMemo(() => parseRecipe(recipe), [recipe]);
  const quote = checked.ok && isRoyalty(royalty) ? quoteRecipe(checked.recipe, royalty) : null;
  const won = (n: number) => interpolate(copy.royaltyValue, { amount: n.toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US') });

  const errorText = (code: unknown) => copy.errors[(typeof code === 'string' ? code : 'unavailable') as keyof Copy['errors']] ?? copy.errors.unavailable;
  async function post(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    try {
      const response = await fetch(ACTIONS, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (response.ok) return result;
      setNotice({ tone: 'error', text: errorText(result.code) });
    } catch { setNotice({ tone: 'error', text: copy.errors.unavailable }); }
    return null;
  }
  async function save(quiet = false): Promise<boolean> {
    if (!editable) return true;
    if (title.trim().length < 3) { setNotice({ tone: 'error', text: copy.errors.title_required }); return false; }
    const ok = await post({ action: 'save', id: formatId, title: title.trim(), titleKo: titleKo.trim(), recipe, example: example.trim(), disclosure, presentation, royalty, ...(revisionOf ?? draft?.revisionOf ? { revisionOf: revisionOf ?? draft?.revisionOf } : {}) });
    if (!ok) return false;
    setStatus('draft');
    if (!quiet) setNotice({ tone: 'ok', text: copy.saved });
    return true;
  }
  async function run<T>(kind: NonNullable<typeof busy>, task: () => Promise<T>) {
    if (busy) return;
    setBusy(kind); setNotice(null);
    try { await task(); } finally { setBusy(null); }
  }
  async function upload(role: 'reference' | 'example', event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await run('upload', async () => {
      if (!await save(true)) return;
      try {
        const response = await fetch(`${ACTIONS}/${formatId}/files?role=${role}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
        const result = await response.json().catch(() => ({})) as { file?: EditorFile; code?: string };
        if (!response.ok || !result.file) { setNotice({ tone: 'error', text: errorText(result.code) }); return; }
        setFiles((current) => [...current.filter((f) => role === 'reference' || f.role !== 'example'), result.file!].filter((f, i, all) => all.findIndex((g) => g.id === f.id) === i));
      } catch { setNotice({ tone: 'error', text: copy.errors.unavailable }); }
    });
  }
  async function removeFile(id: string) {
    await run('upload', async () => {
      if (await post({ action: 'deleteFile', id: formatId, file: id })) setFiles((current) => current.filter((f) => f.id !== id));
    });
  }
  const refreshTests = useCallback(async () => {
    try {
      const response = await fetch(`${ACTIONS}?id=${formatId}`, { cache: 'no-store' });
      if (!response.ok) return;
      const result = await response.json() as { tests?: EditorTest[]; testRendersUsed?: number; status?: EditorDraft['status'] };
      if (result.tests) setTests(result.tests);
      if (typeof result.testRendersUsed === 'number') setUsed(result.testRendersUsed);
      if (result.status) setStatus(result.status);
    } catch { /* The next tick asks again. */ }
  }, [formatId]);
  useEffect(() => {
    if (!tests.some((t) => PENDING.has(t.status))) return;
    const timer = window.setInterval(() => void refreshTests(), 8000);
    return () => window.clearInterval(timer);
  }, [tests, refreshTests]);
  async function testRender() {
    await run('test', async () => {
      if (!await save(true)) return;
      if (await post({ action: 'test', id: formatId })) await refreshTests();
    });
  }
  async function submit() {
    await run('submit', async () => {
      if (!await save(true)) return;
      if (await post({ action: 'submit', id: formatId, rights: true })) window.location.assign(`${workspaceHref}?ok=format`);
    });
  }
  function exportJson() {
    const blob = new Blob([exportRecipe(recipe)], { type: 'application/json' });
    const href = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = href; a.download = `twings-recipe-${formatId.slice(0, 8)}.json`; a.click();
    URL.revokeObjectURL(href);
  }
  async function importJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || file.size > 24_000) { if (file) setNotice({ tone: 'error', text: copy.importFailed }); return; }
    const loaded = fromRecipe(await file.text(), files, label);
    if (!loaded) { setNotice({ tone: 'error', text: copy.importFailed }); return; }
    setMedium(loaded.medium); setSteps(loaded.steps);
    setNotice(loaded.missingFile ? { tone: 'error', text: copy.importMissingFile } : null);
  }

  function changeMedium(next: EditorMedium) {
    setMedium(next);
    setSteps((current) => {
      if (next === 'video') return [...current.filter((s) => s.kind === 'image').slice(0, 1), current.find((s) => s.kind === 'video') ?? newStep('video')];
      const images = current.filter((s) => s.kind === 'image');
      return next === 'image' ? [images[0] ?? newStep('image')] : images.length ? images.slice(0, 6) : [newStep('image')];
    });
  }
  const update = (index: number, patch: Partial<StepState>) => setSteps((current) => current.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  function insert(index: number, token: string) {
    const area = textareas.current[index];
    const text = steps[index]!.text;
    const start = area?.selectionStart ?? text.length, end = area?.selectionEnd ?? text.length;
    update(index, { text: `${text.slice(0, start)}${token}${text.slice(end)}` });
    requestAnimationFrame(() => { area?.focus(); area?.setSelectionRange(start + token.length, start + token.length); });
  }
  const issueText = (issue: RecipeIssue) => {
    const at = issue.step ? steps.findIndex((_, i) => `step${i + 1}` === issue.step) : -1;
    const where = at >= 0 ? `${interpolate(copy.stepLabel, { n: String(at + 1) })} · ` : '';
    return `${where}${copy.issues[issue.code] ?? copy.errors.invalid}`;
  };
  const testsLeft = Math.max(0, testLimit - used);
  const disabled = !ready || !editable;

  const howBlock = <section data-preview-how className="space-y-3 rounded-2xl border border-hairline p-4">
    <p className="text-sm font-semibold">{copy.previewHow}</p>
    {disclosure.prompts ? steps.map((step, i) => <div key={i} className="space-y-1">
      <p className="text-xs opacity-60">{interpolate(copy.stepLabel, { n: String(i + 1) })} · {step.kind === 'image' ? copy.stepImage : copy.stepVideo}</p>
      <p className="whitespace-pre-wrap break-words rounded-lg bg-on-surface/5 p-3 text-xs leading-relaxed">{step.text || '…'}</p>
    </div>) : null}
    {disclosure.assets && references.length ? <ul className="flex flex-wrap gap-2">{references.map((f, i) => <li key={f.id}><FileThumb file={f} alt={label.reference(i + 1)} /></li>)}</ul> : null}
    {!disclosure.prompts && !disclosure.assets ? <p className="text-xs opacity-60">{copy.previewPrivate}</p> : null}
  </section>;
  const exampleBlock = <section data-preview-example className="space-y-2">
    <p className="text-xs opacity-60">{copy.previewExample}</p>
    {exampleFile ? <FileThumb file={exampleFile} alt={copy.previewExample} large /> : example ? <a href={example} target="_blank" rel="noopener noreferrer nofollow" className="block break-all rounded-2xl border border-hairline p-4 text-sm underline underline-offset-4">{example} ↗</a> : <p className="rounded-2xl border border-dashed border-hairline p-6 text-center text-xs opacity-60">{copy.previewNoExample}</p>}
  </section>;
  const makeBlock = <section data-preview-make className="space-y-3 rounded-2xl border border-hairline p-4">
    <p className="font-display text-[1.6rem] leading-none font-black">{quote ? won(quote.proposedKrw) : '—'}</p>
    <span className={`${BUTTON} w-full`} aria-disabled="true">{copy.previewMake}</span>
  </section>;

  return <div data-recipe-editor data-recipe-status={status ?? 'new'} className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
    <noscript><p className="rounded-xl border border-hairline p-4 text-sm">{copy.needsScript}</p></noscript>
    <div className="space-y-6">
      {notice ? <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border p-4 text-sm ${notice.tone === 'error' ? 'border-accent' : 'border-hairline'}`}>{notice.text}</p> : null}
      {!editable ? <p role="status" className="rounded-xl bg-on-surface/5 p-4 text-sm">{copy.readOnly}</p> : null}
      <fieldset disabled={disabled} className="space-y-6">
        <section className={PANEL}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">{copy.titleEn}<input value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} maxLength={120} className={FIELD} /></label>
            <label className="block text-sm">{copy.titleKo}<input value={titleKo} onChange={(e) => setTitleKo(e.target.value)} maxLength={120} className={FIELD} /><span className={HINT}>{copy.titleKoHint}</span></label>
          </div>
          <div role="radiogroup" aria-label={copy.medium} className="space-y-2">
            <p className="text-sm">{copy.medium}</p>
            <div className="flex flex-wrap gap-2">{(['video', 'image', 'carousel'] as const).map((m) => <label key={m} data-recipe-medium={m} className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm ${medium === m ? 'border-accent text-accent' : 'border-hairline'}`}>
              <input type="radio" name="medium" value={m} checked={medium === m} onChange={() => changeMedium(m)} className="sr-only" />{m === 'video' ? copy.mediumVideo : m === 'image' ? copy.mediumImage : copy.mediumCarousel}
            </label>)}</div>
          </div>
        </section>

        <section data-recipe-files className={PANEL}>
          <h2 className="text-lg font-semibold">{copy.files}</h2>
          <p className="text-xs leading-relaxed opacity-60">{copy.filesHint}</p>
          {references.length ? <ul className="flex flex-wrap gap-3">{references.map((f, i) => <li key={f.id} data-recipe-file={f.id} className="space-y-1 text-xs">
            <FileThumb file={f} alt={label.reference(i + 1)} />
            <p>{label.reference(i + 1)} · {f.kind === 'image' ? copy.fileImage : copy.fileVideo}</p>
            <button type="button" onClick={() => void removeFile(f.id)} className="underline underline-offset-4">{copy.removeFile}</button>
          </li>)}</ul> : null}
          <label className={`${BUTTON_OUTLINE} cursor-pointer`}>{busy === 'upload' ? copy.uploading : copy.upload}<input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" className="sr-only" onChange={(e) => void upload('reference', e)} /></label>
        </section>

        <section className={PANEL}>
          <h2 className="text-lg font-semibold">{copy.steps}</h2>
          {steps.map((step, index) => {
            const options = step.kind === 'image' ? imageEngines : videoEngines;
            const engine = options.find((e) => e.id === step.engine) ?? options[0]!;
            const durations = Array.from({ length: (engine.maxDuration ?? 15) - (engine.minDuration ?? 4) + 1 }, (_, i) => (engine.minDuration ?? 4) + i);
            const removable = (medium === 'carousel' && steps.length > 1) || (medium === 'video' && step.kind === 'image');
            return <div key={index} data-recipe-step={`step${index + 1}`} data-step-kind={step.kind} className="space-y-3 border-t border-hairline pt-4 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold">{interpolate(copy.stepLabel, { n: String(index + 1) })} · {step.kind === 'image' ? copy.stepImage : copy.stepVideo}</h3>
                {removable ? <button type="button" onClick={() => setSteps((current) => current.filter((_, i) => i !== index))} className="text-xs underline underline-offset-4">{copy.removeStep}</button> : null}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">{copy.engine}<select value={engine.id} onChange={(e) => update(index, { engine: e.target.value })} className={FIELD}>{options.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}</select></label>
                <label className="block text-sm">{copy.aspect}<select value={step.aspect} onChange={(e) => update(index, { aspect: e.target.value })} className={FIELD}>{(step.kind === 'image' ? aspects.image : aspects.video).map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
                {step.kind === 'video' ? <>
                  <label className="block text-sm">{copy.duration}<select value={step.duration} onChange={(e) => update(index, { duration: Number(e.target.value) })} className={FIELD}>{durations.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
                  <label className="block text-sm">{copy.resolution}<select value={step.resolution} onChange={(e) => update(index, { resolution: e.target.value as '720p' | '1080p' })} className={FIELD}>{(engine.resolutions ?? ['720p']).map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
                </> : null}
              </div>
              <div className="space-y-2">
                <p className="text-sm">{copy.prompt}</p>
                <div className="flex flex-wrap gap-2" aria-label={copy.insert}>
                  {[label.selfie, ...references.map((_, i) => label.reference(i + 1)), ...steps.slice(0, index).filter((s) => s.kind === 'image').map((_, i) => label.step(i + 1))].map((token) =>
                    <button key={token} type="button" data-insert-token={token} onClick={() => insert(index, token)} className="inline-flex min-h-9 items-center rounded-full border border-hairline px-3 text-xs">{token}</button>)}
                </div>
                <textarea ref={(node) => { textareas.current[index] = node; }} value={step.text} onChange={(e) => update(index, { text: e.target.value })} rows={6} maxLength={MAX_STEP_PROMPT_CHARS} aria-label={`${interpolate(copy.stepLabel, { n: String(index + 1) })} ${copy.prompt}`} className={FIELD} autoComplete="off" spellCheck={false} />
                <span className={HINT}>{copy.promptHint}</span>
              </div>
            </div>;
          })}
          {medium === 'video' && !steps.some((s) => s.kind === 'image') ? <button type="button" onClick={() => setSteps((current) => [newStep('image'), ...current])} className={BUTTON_OUTLINE}>{copy.addImageStep}</button> : null}
          {medium === 'carousel' && steps.length < 6 ? <button type="button" onClick={() => setSteps((current) => [...current, newStep('image')])} className={BUTTON_OUTLINE}>{copy.addFrame}</button> : null}
        </section>

        <section className={PANEL}>
          <h2 className="text-lg font-semibold">{copy.example}</h2>
          <p className="text-xs leading-relaxed opacity-60">{copy.exampleHint}</p>
          <label className="block text-sm">{copy.exampleUrl}<input type="url" inputMode="url" value={example} onChange={(e) => setExample(e.target.value)} maxLength={2048} className={FIELD} /></label>
          {exampleFile ? <div className="flex items-center gap-3 text-xs"><FileThumb file={exampleFile} alt={copy.exampleUploaded} /><span>{copy.exampleUploaded}</span><button type="button" onClick={() => void removeFile(exampleFile.id)} className="underline underline-offset-4">{copy.removeFile}</button></div> : null}
          <label className={`${BUTTON_OUTLINE} cursor-pointer`}>{busy === 'upload' ? copy.uploading : copy.exampleUpload}<input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" className="sr-only" onChange={(e) => void upload('example', e)} /></label>
        </section>

        <section className={PANEL}>
          <fieldset className="space-y-2"><legend className="text-sm">{copy.disclosure}</legend>
            <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={disclosure.prompts} onChange={(e) => setDisclosure({ ...disclosure, prompts: e.target.checked })} />{copy.disclosurePrompts}</label>
            <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={disclosure.assets} onChange={(e) => setDisclosure({ ...disclosure, assets: e.target.checked })} />{copy.disclosureAssets}</label>
            <span className={HINT}>{copy.disclosureHint}</span>
          </fieldset>
          <fieldset className="space-y-2"><legend className="text-sm">{copy.presentation}</legend>
            {(['make-first', 'story-first'] as const).map((p) => <label key={p} className="flex items-center gap-3 text-sm"><input type="radio" name="presentation" checked={presentation === p} onChange={() => setPresentation(p)} />{p === 'make-first' ? copy.makeFirst : copy.storyFirst}</label>)}
          </fieldset>
          <label className="block text-sm" data-recipe-royalty>{copy.royalty} <strong className="ml-2 tabular-nums">{won(royalty)}</strong>
            <input type="range" min={ROYALTY_MIN_KRW} max={ROYALTY_MAX_KRW} step={ROYALTY_STEP_KRW} value={royalty} onChange={(e) => setRoyalty(Number(e.target.value))} className="mt-3 w-full accent-[var(--color-accent)]" />
            <span className={HINT}>{copy.royaltyHint}</span>
          </label>
          <p data-recipe-price className="text-sm tabular-nums">{quote ? interpolate(copy.priceLine, { price: won(quote.proposedKrw), floor: won(quote.floorKrw), royalty: won(royalty) }) : copy.priceUnknown}</p>
        </section>
      </fieldset>

      <section data-recipe-issues className={PANEL}>
        <h2 className="text-lg font-semibold">{copy.checks}</h2>
        {checked.ok ? <p className="text-sm">{copy.checksOk}</p> : <ul className="list-disc space-y-1 pl-5 text-sm">{[...new Set(checked.issues.map(issueText))].map((text) => <li key={text}>{text}</li>)}</ul>}
        <div className="flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
          <span className="text-sm opacity-70">{copy.json}</span>
          <button type="button" onClick={exportJson} className={BUTTON_OUTLINE}>{copy.exportJson}</button>
          <label className={`${BUTTON_OUTLINE} cursor-pointer ${disabled ? 'pointer-events-none opacity-40' : ''}`}>{copy.importJson}<input type="file" accept="application/json,.json" className="sr-only" disabled={disabled} onChange={(e) => void importJson(e)} /></label>
        </div>
      </section>

      {editable ? <section className={PANEL}>
        <label className="flex items-start gap-3 text-sm leading-relaxed"><input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-1" disabled={!ready} />{copy.rights}</label>
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={!ready || !!busy} onClick={() => void run('save', () => save())} className={BUTTON_OUTLINE}>{busy === 'save' ? copy.saving : copy.save}</button>
          <button type="button" data-recipe-submit disabled={!ready || !!busy || !rights || !checked.ok} onClick={() => void submit()} className={BUTTON}>{busy === 'submit' ? copy.submitting : copy.submit}</button>
        </div>
      </section> : null}
    </div>

    <aside className="space-y-6 lg:sticky lg:top-24">
      <section data-recipe-preview data-presentation={presentation} className={PANEL}>
        <h2 className="text-lg font-semibold">{copy.preview}</h2>
        <p className="text-xs opacity-60">{copy.previewHint}</p>
        <p className="font-display text-[1.6rem] leading-[0.95] font-black uppercase">{(locale === 'ko' && titleKo) || title || '—'}</p>
        {presentation === 'story-first' ? <>{howBlock}{exampleBlock}{makeBlock}</> : <>{exampleBlock}{makeBlock}{howBlock}</>}
      </section>
      <section data-recipe-test className={PANEL}>
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-semibold">{copy.test}</h2><span className="text-xs tabular-nums opacity-70">{interpolate(copy.testLeft, { n: String(testsLeft) })}</span></div>
        <p className="text-xs leading-relaxed opacity-60">{interpolate(copy.testHint, { limit: String(testLimit) })}</p>
        {!hasSelfie ? <p className="text-sm">{copy.testNeedsSelfie} <a href={selfieHref} className="underline underline-offset-4">{copy.selfieLink}</a></p> : null}
        <button type="button" data-recipe-test-start disabled={!ready || !!busy || !hasSelfie || !testsLeft || !checked.ok || (status !== null && status !== 'draft' && status !== 'submitted')} onClick={() => void testRender()} className={BUTTON}>{busy === 'test' ? copy.saving : copy.testCta}</button>
        {tests.length ? <ul className="space-y-3">{tests.map((test) => <li key={test.id} data-recipe-test-render={test.id} data-status={test.status} className="space-y-2 border-t border-hairline pt-3 text-sm">
          <p className="flex flex-wrap items-baseline justify-between gap-2"><span>{copy.testStatus[test.status as keyof Copy['testStatus']] ?? test.status}</span><a href={`/renders/${test.id}`} className="text-xs underline underline-offset-4">{copy.testOpen}</a></p>
          {test.status === 'succeeded' && test.outputs ? <ul className="flex flex-wrap gap-2">{Array.from({ length: test.outputs }, (_, n) => <li key={n}><a href={`/api/makers/renders/${test.id}/${n}`} target="_blank" rel="noopener noreferrer" className="text-xs underline underline-offset-4">{interpolate(copy.testFrame, { n: String(n + 1) })}</a></li>)}</ul> : null}
        </li>)}</ul> : <p className="text-xs opacity-60">{copy.testNone}</p>}
      </section>
    </aside>
  </div>;
}

function FileThumb({ file, alt, large = false }: { file: EditorFile; alt: string; large?: boolean }) {
  const src = `/api/makers/files/${file.id}`;
  const size = large ? 'w-full max-h-80' : 'h-20 w-20';
  return file.kind === 'image'
    ? <img src={src} alt={alt} className={`${size} rounded-xl border border-hairline object-cover`} loading="lazy" />
    : <video src={src} aria-label={alt} className={`${size} rounded-xl border border-hairline object-cover`} muted playsInline preload="metadata" controls={large} />;
}

type Labels = { selfie: string; reference: (n: number) => string; step: (n: number) => string };

/** Editor state → the §7.3 recipe. Inputs are the references a prompt mentions, in order of first mention. */
export function toRecipe(steps: StepState[], medium: EditorMedium, references: EditorFile[], label: Labels): Recipe {
  const pairs: Array<[string, string]> = [[label.selfie, SELFIE_SLOT], ...references.map((_, i) => [label.reference(i + 1), `ref${i + 1}`] as [string, string])];
  let images = 0;
  steps.forEach((step, i) => { if (step.kind === 'image') pairs.push([label.step(++images), `step${i + 1}`]); });
  const pattern = new RegExp(pairs.map(([text]) => escape(text)).sort((a, b) => b.length - a.length).join('|'), 'g');
  const names = new Map(pairs);
  const used = new Set<string>();
  const built = steps.map((step, i) => {
    const inputs: string[] = [];
    const prompt = step.text.replace(pattern, (match) => {
      const name = names.get(match)!;
      if (!inputs.includes(name)) inputs.push(name);
      used.add(name);
      return `{{${name}}}`;
    });
    const params = step.kind === 'image' ? { aspect: step.aspect } : { aspect: step.aspect, duration: step.duration, resolution: step.resolution };
    return { id: `step${i + 1}`, kind: step.kind, engine: step.engine, inputs, prompt, params };
  });
  const slots: Record<string, unknown> = { [SELFIE_SLOT]: { kind: 'image', source: 'user', required: true } };
  references.forEach((file, i) => { if (used.has(`ref${i + 1}`)) slots[`ref${i + 1}`] = { kind: file.kind, source: 'creator', asset: file.id }; });
  const output = medium === 'carousel' ? { frames: built.map((s) => s.id) } : { from: built[built.length - 1]?.id ?? 'step1' };
  return { version: 2, slots, steps: built, output } as unknown as Recipe;
}

/** A stored or imported recipe → editor state, naming each maker file by its place in this draft's files. */
export function fromRecipe(raw: unknown, files: EditorFile[], label: Labels): { medium: EditorMedium; steps: StepState[]; missingFile: boolean } | null {
  if (raw === null || raw === undefined) return null;
  const checked = parseRecipe(raw);
  // A draft may be saved mid-edit; read what parses and let the checks list say the rest.
  const recipe = checked.ok ? checked.recipe : lenient(raw);
  if (!recipe) return null;
  const references = files.filter((f) => f.role === 'reference');
  let missingFile = false;
  const imageIndex = new Map<string, number>();
  let images = 0;
  recipe.steps.forEach((step) => { if (step.kind === 'image') imageIndex.set(step.id, ++images); });
  const steps = recipe.steps.map((step) => ({
    kind: step.kind, engine: step.engine,
    aspect: step.params.aspect, duration: step.kind === 'video' ? step.params.duration : 10, resolution: step.kind === 'video' ? step.params.resolution : '720p' as const,
    text: step.prompt.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, (_m, name: string) => {
      if (name === SELFIE_SLOT) return label.selfie;
      const slot = recipe.slots[name];
      if (slot?.source === 'creator') {
        const at = references.findIndex((f) => f.id === slot.asset);
        if (at < 0) { missingFile = true; return `[?]`; }
        return label.reference(at + 1);
      }
      const n = imageIndex.get(name);
      return n ? label.step(n) : `[?]`;
    }),
  }));
  return { medium: checked.ok ? recipeMedium(recipe) : 'frames' in recipe.output ? 'carousel' : recipe.steps.some((s) => s.kind === 'video') ? 'video' : 'image', steps, missingFile };
}

function lenient(raw: unknown): Recipe | null {
  try {
    const value = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Recipe;
    if (value?.version !== 2 || !Array.isArray(value.steps) || !value.steps.length || typeof value.slots !== 'object' || !value.output) return null;
    if (value.steps.some((s) => (s.kind !== 'image' && s.kind !== 'video') || typeof s.prompt !== 'string' || !s.params || typeof s.engine !== 'string')) return null;
    return value;
  } catch { return null; }
}
