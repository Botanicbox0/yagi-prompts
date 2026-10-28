"use client";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { BrandCopy } from "./action-form";
import { ActionForm } from "./action-form";
import { CampaignTermsSummary, PLATFORM_NAMES } from "./campaign-terms-summary";
import { PromptCardMedia, type CardMediaSource } from "@/components/prompts/card-media";
import { TypographicPoster } from "@/components/prompts/poster";
import { CARD_RATIO } from "@/components/prompts/card-frame";
import { formatKrw, interpolate } from "@/lib/i18n/format";
import { CAMPAIGN_PLATFORMS, PAYOUT_MODELS } from "@/lib/campaigns/schemas";
import {
  AUDIENCE_GENDERS, AUDIENCE_MODES, CAMPAIGN_TERMS_VERSION, TAX_BASES, WIZARD_STEPS,
  checkWizardStep, clearWizardDraft, firstIncompleteStep, kstToday, loadWizardDraft, saveWizardDraft, termsFromDraft,
  type CampaignTerms, type StepIssue, type WizardDraft, type WizardStep,
} from "@/lib/brands/workspace/campaign-terms";

/** A public format the brand may pick: the catalogue card's own media, nothing about its prompt. */
export interface WizardFormat {
  slug: string;
  title: string;
  source: "yagi" | "community";
  authorHandle: string | null;
  poster: CardMediaSource | null;
  video: CardMediaSource | null;
}

type Copy = BrandCopy["wizard"];
type Errors = Record<string, string>;
type Rec = Record<string, unknown>;
const empty = (): WizardDraft => ({ version: CAMPAIGN_TERMS_VERSION, step: "format" });
const words = (raw: string) => raw.split(/[\s,]+/).map((w) => w.trim()).filter(Boolean);
const list = (raw: string) => raw.split(",").map((w) => w.trim()).filter(Boolean);
const numberOrNull = (raw: string) => (raw.trim() === "" ? null : Number(raw));
const local = () => { try { return window.localStorage; } catch { return null; } };

function messageFor(issue: StepIssue, t: Copy): string {
  const known = t.fieldErrors as Record<string, string>;
  return known[issue.message] ?? t.fieldErrors.required;
}

/**
 * docs/PLATFORM-2.0.md §16.3 — the five-step campaign request. Every change is kept as a draft in
 * this browser (per workspace) and nothing reaches TWINGS until step ⑤ sends it through the
 * existing `project.create` operation, where the server checks the same schemas again.
 */
export function CampaignWizard({
  b,
  locale,
  organizations,
  formats,
  initial,
}: {
  b: BrandCopy;
  locale: string;
  organizations: Array<{ id: string; name: string }>;
  formats: WizardFormat[];
  /** Where to start when this browser has no saved draft (tests and QA captures). */
  initial?: WizardDraft;
}) {
  const t = b.wizard;
  const [draft, setDraft] = useState<WizardDraft>(() => initial ?? empty());
  const [organizationId, setOrganizationId] = useState(organizations[0]!.id);
  const [errors, setErrors] = useState<Errors>({});
  const [notice, setNotice] = useState<"" | "saved" | "restored" | "unavailable">("");
  const [ready, setReady] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const stepper = useRef<HTMLOListElement>(null);
  const step = draft.step;
  const index = WIZARD_STEPS.indexOf(step);

  // Restore after hydration, so server and first client render agree.
  useEffect(() => {
    const restored = loadWizardDraft(local(), organizationId);
    if (restored) {
      // Reopen where the brand left off, but never past the first step that is still incomplete.
      const open = Math.min(WIZARD_STEPS.indexOf(restored.step), WIZARD_STEPS.indexOf(firstIncompleteStep(restored)));
      setDraft({ ...restored, step: WIZARD_STEPS[open]! });
      setNotice("restored");
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!ready) return;
    const ok = saveWizardDraft(local(), organizationId, draft);
    setNotice((n) => (!ok ? "unavailable" : n === "restored" ? n : "saved"));
  }, [draft, organizationId, ready]);
  // Moving between steps puts focus on the new step's heading, so a screen reader announces it.
  useEffect(() => {
    if (!moved.current) return;
    heading.current?.focus();
    heading.current?.scrollIntoView({ block: "start" });
  }, [step]);
  // On a narrow screen the step bar scrolls sideways: keep the current step in it, without moving the page.
  useEffect(() => {
    const bar = stepper.current, current = bar?.querySelector<HTMLElement>('[aria-current="step"]');
    if (bar && current) bar.scrollLeft = Math.max(0, current.offsetLeft - bar.offsetLeft - 16);
  }, [step]);

  // After a refused "Next", focus the first field the errors name (its own control, or its group's).
  const focusError = useRef(false);
  useEffect(() => {
    if (!focusError.current) return;
    focusError.current = false;
    const first = Object.keys(errors)[0];
    if (!first) return;
    const within = (name: string) => document.querySelector<HTMLElement>(`[data-wizard-field="${name}"] :is(input:not([disabled]),textarea,select)`);
    (within(first) ?? within(first.split(".").slice(0, 2).join(".")) ?? within(first.split(".")[0]!))?.focus();
  }, [errors]);
  // Once a step has been refused, its messages follow the fields: a fixed field loses its message.
  useEffect(() => {
    setErrors((shown) => {
      if (!Object.keys(shown).length || step === "review") return shown;
      const now = validate(step);
      const kept = Object.fromEntries(Object.entries(now).filter(([path]) => path in shown));
      return Object.keys(kept).length === Object.keys(shown).length ? shown : kept;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  const update = (patch: Partial<WizardDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const part = (key: "format" | "reward" | "audience" | "schedule") => (draft[key] ?? {}) as Rec;
  const patchPart = (key: "format" | "reward" | "audience" | "schedule", patch: Rec) =>
    setDraft((d) => ({ ...d, [key]: { ...((d[key] ?? {}) as Rec), ...patch } }));

  function go(next: WizardStep) {
    moved.current = true;
    setErrors({});
    update({ step: next });
  }
  function validate(current: WizardStep): Errors {
    const result = checkWizardStep(current, draft);
    const found: Errors = {};
    if (!result.ok) for (const issue of result.issues) found[issue.path] ??= messageFor(issue, t);
    if (current === "schedule") {
      const close = (draft.schedule as Rec | undefined)?.applicationsCloseOn;
      if (typeof close === "string" && close < kstToday()) found["schedule.applicationsCloseOn"] = t.fieldErrors.past;
    }
    return found;
  }
  function advance(event: FormEvent) {
    event.preventDefault();
    const found = validate(step);
    if (Object.keys(found).length) {
      setErrors(found);
      focusError.current = true;
      return;
    }
    go(WIZARD_STEPS[index + 1]!);
  }
  function startOver() {
    clearWizardDraft(local(), organizationId);
    moved.current = true;
    setErrors({});
    setDraft(empty());
    setNotice("");
  }

  const terms = step === "review" ? termsFromDraft(draft) : null;
  return (
    <div className="bw-wizard" data-campaign-wizard={step} data-wizard-organization={organizationId}>
      <ol ref={stepper} className="bw-wizard-steps" aria-label={t.stepsLabel}>
        {WIZARD_STEPS.map((s, i) => (
          <li key={s} data-wizard-step-state={i < index ? "done" : i === index ? "current" : "upcoming"} aria-current={i === index ? "step" : undefined}>
            {i < index ? (
              <button type="button" className="bw-wizard-step" onClick={() => go(s)}>
                <span aria-hidden="true">{i + 1}</span>{t.steps[s]}
              </button>
            ) : (
              <span className="bw-wizard-step"><span aria-hidden="true">{i + 1}</span>{t.steps[s]}</span>
            )}
          </li>
        ))}
      </ol>
      <p className="bw-muted bw-wizard-draft" role="status" data-wizard-draft={notice || undefined}>
        {notice === "saved" ? t.draftSaved : notice === "restored" ? t.draftRestored : notice === "unavailable" ? t.draftUnavailable : ""}
      </p>

      <section className="bw-panel bw-wizard-panel" aria-labelledby="wizard-heading">
        <p className="bw-kicker">{interpolate(t.stepOf, { number: index + 1 })}</p>
        <h2 id="wizard-heading" ref={heading} tabIndex={-1}>{step === "review" ? t.review.heading : t[step].heading}</h2>
        {Object.keys(errors).length > 0 && <p className="bw-error" role="alert" data-wizard-errors>{t.fixFields}</p>}

        {step === "review" ? (
          <Review t={t} b={b} locale={locale} draft={draft} terms={terms} formatTitle={terms?.format.kind === "template" ? formats.find((f) => f.slug === (terms.format as { slug: string }).slug)?.title ?? null : null} organizationName={organizations.find((o) => o.id === organizationId)?.name ?? ""} onEdit={go}>
            {terms && (
              <ActionForm
                operation="project.create"
                b={b}
                submit={t.review.send}
                successNotice={t.review.sent}
                onSuccess={() => clearWizardDraft(local(), organizationId)}
                fixed={{
                  organizationId, title: draft.title, objective: draft.objective, audience: "",
                  budgetKrw: terms.reward.totalBudgetKrw, budgetTaxBasis: terms.reward.taxBasis,
                  startsOn: null, endsOn: terms.schedule.postDeadlineOn, productionMode: "creator",
                  campaignTerms: terms,
                }}
              >
                <p className="bw-note">{t.review.after}</p>
              </ActionForm>
            )}
          </Review>
        ) : (
          <form className="bw-form" onSubmit={advance} noValidate>
            <fieldset disabled={!ready}>
              {step === "format" && <FormatStep t={t} draft={draft} errors={errors} update={update} part={part("format")} patch={(p) => patchPart("format", p)} formats={formats} organizations={organizations} organizationId={organizationId} setOrganizationId={setOrganizationId} />}
              {step === "reward" && <RewardStep t={t} locale={locale} errors={errors} part={part("reward")} patch={(p) => patchPart("reward", p)} />}
              {step === "audience" && <AudienceStep t={t} errors={errors} part={part("audience")} set={(p) => update({ audience: p })} patch={(p) => patchPart("audience", p)} />}
              {step === "schedule" && <ScheduleStep t={t} errors={errors} part={part("schedule")} patch={(p) => patchPart("schedule", p)} />}
            </fieldset>
            <div className="bw-form-actions bw-wizard-actions">
              {index > 0 && <button type="button" className="bw-button" onClick={() => go(WIZARD_STEPS[index - 1]!)}>← {t.previous}</button>}
              <button type="submit" className="bw-button bw-primary" disabled={!ready} data-wizard-next>{t.next} →</button>
            </div>
          </form>
        )}
      </section>
      <button type="button" className="bw-button bw-wizard-reset" onClick={startOver}>{t.startOver}</button>
    </div>
  );
}

function Field({ name, label, hint, error, children }: { name: string; label: string; hint?: string; error?: string; children: (props: { id: string; "aria-invalid"?: true; "aria-describedby"?: string }) => ReactNode }) {
  const id = useId();
  const described = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="bw-wizard-field" data-wizard-field={name}>
      <label htmlFor={id}>{label}</label>
      {children({ id, ...(error ? { "aria-invalid": true as const } : {}), ...(described ? { "aria-describedby": described } : {}) })}
      {hint && <span id={`${id}-hint`} className="bw-muted">{hint}</span>}
      {error && <span id={`${id}-error`} className="bw-error">{error}</span>}
    </div>
  );
}

function FormatStep({ t, draft, errors, update, part, patch, formats, organizations, organizationId, setOrganizationId }: {
  t: Copy; draft: WizardDraft; errors: Errors; update: (p: Partial<WizardDraft>) => void; part: Rec; patch: (p: Rec) => void;
  formats: WizardFormat[]; organizations: Array<{ id: string; name: string }>; organizationId: string; setOrganizationId: (id: string) => void;
}) {
  const groups = [
    { key: "yagi", label: t.format.originals, items: formats.filter((f) => f.source === "yagi") },
    { key: "community", label: t.format.creators, items: formats.filter((f) => f.source === "community") },
  ].filter((g) => g.items.length > 0);
  const formatError = errors["format"] ?? errors["format.kind"] ?? errors["format.slug"];
  return (
    <>
      {organizations.length > 1 && (
        <Field name="organizationId" label={t.review.organization}>
          {(p) => <select {...p} value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}>{organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
        </Field>
      )}
      <Field name="title" label={t.format.name} error={errors.title}>
        {(p) => <input {...p} value={draft.title ?? ""} maxLength={120} required onChange={(e) => update({ title: e.target.value })} />}
      </Field>
      <Field name="objective" label={t.format.objective} hint={t.format.objectiveHint} error={errors.objective}>
        {(p) => <textarea {...p} value={draft.objective ?? ""} maxLength={2000} rows={3} required onChange={(e) => update({ objective: e.target.value })} />}
      </Field>
      <fieldset className="bw-wizard-choice" data-wizard-field="format" aria-invalid={formatError ? true : undefined}>
        <legend>{t.format.choose}</legend>
        {formatError && <span className="bw-error">{formatError}</span>}
        {groups.length === 0 && <p className="bw-note">{t.format.noFormats}</p>}
        {groups.map((g) => (
          <div key={g.key}>
            <h3>{g.label}</h3>
            <div className="bw-format-grid" data-wizard-formats={g.key}>
              {g.items.map((f) => {
                const checked = part.kind === "template" && part.slug === f.slug;
                return (
                  <label key={f.slug} className="bw-format-card" data-wizard-format={f.slug} data-selected={checked || undefined}>
                    <input type="radio" name="format" value={f.slug} aria-label={f.title} checked={checked} onChange={() => patchFormat({ kind: "template", slug: f.slug, source: f.source })} />
                    <PromptCardMedia poster={f.poster} video={f.video} alt={f.title} ratio={CARD_RATIO} fit="cover"
                      fallback={<TypographicPoster title={f.title} slug={f.slug} kicker="" ratio={CARD_RATIO} />} />
                    <span className="bw-format-title">{f.title}</span>
                    {f.authorHandle && <span className="bw-muted">@{f.authorHandle}</span>}
                    {checked && <span className="bw-format-selected">{t.format.selected}</span>}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
        <label className="bw-check bw-wizard-option" data-wizard-format="custom">
          <input type="radio" name="format" value="custom" checked={part.kind === "custom"} onChange={() => patchFormat({ kind: "custom", note: typeof part.note === "string" ? part.note : "" })} />
          <span><strong>{t.format.custom}</strong><br /><span className="bw-muted">{t.format.customHint}</span></span>
        </label>
        {part.kind === "custom" && (
          <Field name="format.note" label={t.format.customNote} error={errors["format.note"]}>
            {(p) => <textarea {...p} value={String(part.note ?? "")} maxLength={1000} rows={3} onChange={(e) => patch({ note: e.target.value })} />}
          </Field>
        )}
      </fieldset>
    </>
  );
  function patchFormat(next: Rec) { update({ format: next }); }
}

function RewardStep({ t, locale, errors, part, patch }: { t: Copy; locale: string; errors: Errors; part: Rec; patch: (p: Rec) => void }) {
  const model = (part.model as string) ?? "";
  const num = (key: string) => (typeof part[key] === "number" ? String(part[key]) : "");
  const n = (key: string) => (typeof part[key] === "number" ? (part[key] as number) : null);
  const slots = n("slots"), min = n("rewardMinKrw");
  return (
    <>
      <fieldset className="bw-wizard-choice" data-wizard-field="reward.model">
        <legend>{t.reward.model}</legend>
        {errors["reward.model"] && <span className="bw-error">{errors["reward.model"]}</span>}
        {PAYOUT_MODELS.map((m) => (
          <label key={m} className="bw-check bw-wizard-option">
            <input type="radio" name="model" value={m} checked={model === m} onChange={() => patch({ model: m, perThousandViewsKrw: m === "flat" ? null : (part.perThousandViewsKrw ?? null) })} />
            <span><strong>{t.reward.models[m]}</strong><br /><span className="bw-muted">{t.reward.modelHints[m]}</span></span>
          </label>
        ))}
      </fieldset>
      <div className="bw-grid">
        <Field name="reward.rewardMinKrw" label={t.reward.min} error={errors["reward.rewardMinKrw"]}>
          {(p) => <input {...p} type="number" inputMode="numeric" min={0} step={1000} value={num("rewardMinKrw")} onChange={(e) => patch({ rewardMinKrw: numberOrNull(e.target.value) })} />}
        </Field>
        <Field name="reward.rewardMaxKrw" label={t.reward.max} error={errors["reward.rewardMaxKrw"]}>
          {(p) => <input {...p} type="number" inputMode="numeric" min={0} step={1000} value={num("rewardMaxKrw")} onChange={(e) => patch({ rewardMaxKrw: numberOrNull(e.target.value) })} />}
        </Field>
      </div>
      {model !== "flat" && model !== "" && (
        <Field name="reward.perThousandViewsKrw" label={t.reward.perK} error={errors["reward.perThousandViewsKrw"]}>
          {(p) => <input {...p} type="number" inputMode="numeric" min={0} step={100} value={num("perThousandViewsKrw")} onChange={(e) => patch({ perThousandViewsKrw: numberOrNull(e.target.value) })} />}
        </Field>
      )}
      <div className="bw-grid">
        <Field name="reward.slots" label={t.reward.slots} error={errors["reward.slots"]}>
          {(p) => <input {...p} type="number" inputMode="numeric" min={1} max={500} step={1} value={num("slots")} onChange={(e) => patch({ slots: numberOrNull(e.target.value) })} />}
        </Field>
        <Field name="reward.totalBudgetKrw" label={t.reward.budget} error={errors["reward.totalBudgetKrw"]}>
          {(p) => <input {...p} type="number" inputMode="numeric" min={1} step={10000} value={num("totalBudgetKrw")} onChange={(e) => patch({ totalBudgetKrw: numberOrNull(e.target.value) })} />}
        </Field>
      </div>
      <fieldset className="bw-wizard-choice bw-wizard-inline" data-wizard-field="reward.taxBasis">
        <legend>{t.reward.taxBasis}</legend>
        {errors["reward.taxBasis"] && <span className="bw-error">{errors["reward.taxBasis"]}</span>}
        {TAX_BASES.map((x) => (
          <label key={x} className="bw-check"><input type="radio" name="taxBasis" value={x} checked={part.taxBasis === x} onChange={() => patch({ taxBasis: x })} />{t.reward.tax[x]}</label>
        ))}
      </fieldset>
      {slots !== null && min !== null && slots > 0 && (
        <p className="bw-note" data-wizard-budget-check>{interpolate(t.reward.check, { slots, min: formatKrw(min, locale), total: formatKrw(slots * min, locale) })}</p>
      )}
      <p className="bw-muted">{t.reward.note}</p>
    </>
  );
}

function AudienceStep({ t, errors, part, set, patch }: { t: Copy; errors: Errors; part: Rec; set: (p: Rec) => void; patch: (p: Rec) => void }) {
  const mode = part.mode as string | undefined;
  const platforms = Array.isArray(part.platforms) ? (part.platforms as string[]) : [];
  const [regions, setRegions] = useState(Array.isArray(part.regions) ? (part.regions as string[]).join(", ") : "");
  return (
    <>
      <fieldset className="bw-wizard-choice" data-wizard-field="audience.mode">
        <legend>{t.steps.audience}</legend>
        {(errors["audience.mode"] ?? errors.audience) && <span className="bw-error">{errors["audience.mode"] ?? errors.audience}</span>}
        {AUDIENCE_MODES.map((m) => (
          <label key={m} className="bw-check bw-wizard-option" data-wizard-audience={m}>
            <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => set(m === "criteria" ? { mode: m, platforms: [], minFollowers: null, gender: "any", regions: [] } : { mode: m })} />
            <span><strong>{t.audience.modes[m]}</strong><br /><span className="bw-muted">{t.audience.modeHints[m]}</span></span>
          </label>
        ))}
      </fieldset>
      {mode === "criteria" && (
        <>
          <fieldset className="bw-wizard-choice bw-wizard-inline" data-wizard-field="audience.platforms">
            <legend>{t.audience.platforms}</legend>
            {errors["audience.platforms"] && <span className="bw-error">{errors["audience.platforms"]}</span>}
            {CAMPAIGN_PLATFORMS.map((x) => (
              <label key={x} className="bw-check"><input type="checkbox" name="platforms" value={x} checked={platforms.includes(x)} onChange={(e) => patch({ platforms: e.target.checked ? [...platforms, x] : platforms.filter((y) => y !== x) })} />{PLATFORM_NAMES[x]}</label>
            ))}
          </fieldset>
          <div className="bw-grid">
            <Field name="audience.minFollowers" label={t.audience.minFollowers} error={errors["audience.minFollowers"]}>
              {(p) => <input {...p} type="number" inputMode="numeric" min={0} step={1000} value={typeof part.minFollowers === "number" ? String(part.minFollowers) : ""} onChange={(e) => patch({ minFollowers: numberOrNull(e.target.value) })} />}
            </Field>
            <Field name="audience.gender" label={t.audience.gender} error={errors["audience.gender"]}>
              {(p) => <select {...p} value={String(part.gender ?? "any")} onChange={(e) => patch({ gender: e.target.value })}>{AUDIENCE_GENDERS.map((g) => <option key={g} value={g}>{t.audience.genders[g]}</option>)}</select>}
            </Field>
          </div>
          <Field name="audience.regions" label={t.audience.regions} hint={t.audience.regionsHint} error={errors["audience.regions"]}>
            {(p) => <input {...p} value={regions} onChange={(e) => { setRegions(e.target.value); patch({ regions: list(e.target.value) }); }} />}
          </Field>
        </>
      )}
    </>
  );
}

function ScheduleStep({ t, errors, part, patch }: { t: Copy; errors: Errors; part: Rec; patch: (p: Rec) => void }) {
  const [hashtags, setHashtags] = useState(Array.isArray(part.hashtags) ? (part.hashtags as string[]).map((h) => `#${h.replace(/^#/, "")}`).join(" ") : "");
  const [mentions, setMentions] = useState(Array.isArray(part.mentions) ? (part.mentions as string[]).map((m) => `@${m.replace(/^@/, "")}`).join(" ") : "");
  // The ad label is not a choice: it is written into the draft as soon as this step opens.
  useEffect(() => { if (part.disclosure !== true) patch({ disclosure: true }); }, [part.disclosure, patch]);
  return (
    <>
      <div className="bw-grid">
        <Field name="schedule.applicationsCloseOn" label={t.schedule.closeOn} hint={t.schedule.kst} error={errors["schedule.applicationsCloseOn"]}>
          {(p) => <input {...p} type="date" min={kstToday()} value={String(part.applicationsCloseOn ?? "")} onChange={(e) => patch({ applicationsCloseOn: e.target.value })} />}
        </Field>
        <Field name="schedule.postDeadlineOn" label={t.schedule.postBy} hint={t.schedule.kst} error={errors["schedule.postDeadlineOn"]}>
          {(p) => <input {...p} type="date" min={String(part.applicationsCloseOn ?? kstToday())} value={String(part.postDeadlineOn ?? "")} onChange={(e) => patch({ postDeadlineOn: e.target.value })} />}
        </Field>
      </div>
      <div className="bw-grid">
        <Field name="schedule.hashtags" label={t.schedule.hashtags} hint={t.schedule.listHint} error={errors["schedule.hashtags"] ?? Object.entries(errors).find(([k]) => k.startsWith("schedule.hashtags."))?.[1]}>
          {(p) => <input {...p} value={hashtags} placeholder="#twings" onChange={(e) => { setHashtags(e.target.value); patch({ hashtags: words(e.target.value) }); }} />}
        </Field>
        <Field name="schedule.mentions" label={t.schedule.mentions} hint={t.schedule.listHint} error={errors["schedule.mentions"] ?? Object.entries(errors).find(([k]) => k.startsWith("schedule.mentions."))?.[1]}>
          {(p) => <input {...p} value={mentions} placeholder="@twings.app" onChange={(e) => { setMentions(e.target.value); patch({ mentions: words(e.target.value) }); }} />}
        </Field>
      </div>
      <div className="bw-note bw-wizard-fixed" data-wizard-disclosure="fixed">
        <label className="bw-check">
          <input type="checkbox" checked disabled aria-describedby="wizard-disclosure-hint" />
          <strong>{t.schedule.disclosure}</strong>
        </label>
        <p id="wizard-disclosure-hint">{t.schedule.disclosureFixed}</p>
      </div>
      <Field name="schedule.prohibited" label={t.schedule.prohibited} hint={t.schedule.prohibitedHint} error={errors["schedule.prohibited"]}>
        {(p) => <textarea {...p} rows={3} maxLength={1000} value={String(part.prohibited ?? "")} onChange={(e) => patch({ prohibited: e.target.value })} />}
      </Field>
    </>
  );
}

/** Step ⑤: everything on one screen, each part with its own "change" link back to its step. */
function Review({ t, b, locale, draft, terms, formatTitle, organizationName, onEdit, children }: {
  t: Copy; b: BrandCopy; locale: string; draft: WizardDraft; terms: CampaignTerms | null; formatTitle: string | null; organizationName: string; onEdit: (s: WizardStep) => void; children: ReactNode;
}) {
  if (!terms) return null;
  return (
    <div data-wizard-review>
      <CampaignTermsSummary t={t} b={b} locale={locale} title={draft.title ?? ""} objective={draft.objective ?? ""} organizationName={organizationName} terms={terms} onEdit={onEdit} formatTitle={formatTitle} />
      {children}
    </div>
  );
}
