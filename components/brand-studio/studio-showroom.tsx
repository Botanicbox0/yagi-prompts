'use client';

import { useRef, useState, type FormEvent } from 'react';
import { interpolate } from '@/lib/i18n/format';
import type { StudioShellCopy } from '@/messages/studio-shell';
import s from './studio-showroom.module.css';

const STAGE_KEYS = ['region', 'editorial', 'video', 'handoff'] as const;
const PLAN_KEYS = ['b2b_29', 'b2b_49', 'b2b_69'] as const;

export interface StudioShowroomProps {
  focus: 'image' | 'video';
  organizationId: string;
  organizationName: string;
  canRequest: boolean;
  imageHref: string;
  videoHref: string;
  projectSpaceHref: string;
  newBriefHref: string;
  copy: StudioShellCopy['showroom'];
}

export function StudioShowroom({
  focus,
  organizationId,
  organizationName,
  canRequest,
  imageHref,
  videoHref,
  projectSpaceHref,
  newBriefHref,
  copy,
}: StudioShowroomProps) {
  const defaultStage = focus === 'video' ? 2 : 0;
  const [stageIndex, setStageIndex] = useState(defaultStage);
  const [formOpen, setFormOpen] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string>('demo');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef<{ fingerprint: string; id: string } | null>(null);

  const activeStage = copy.stages[stageIndex] ?? copy.stages[0]!;

  function openPlanForm(option = 'demo') {
    setSelectedOption(option);
    setFormOpen(true);
    setError('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const planIdx = PLAN_KEYS.indexOf(selectedOption as (typeof PLAN_KEYS)[number]);
    const planLabel =
      selectedOption === 'demo'
        ? copy.formPlanDemo
        : (planIdx !== -1 ? copy.plans[planIdx]?.name : undefined) ?? selectedOption;
    const lines = [
      `[Brand Studio Plan / Demo Inquiry]`,
      `${copy.formPlanLabel}: ${planLabel}`,
      ...(note.trim() ? [`${copy.formNoteLabel}:\n${note.trim()}`] : []),
    ];
    const body = lines.join('\n\n');
    const fingerprint = `${organizationId}:${body}`;
    if (requestRef.current?.fingerprint !== fingerprint) {
      requestRef.current = { fingerprint, id: crypto.randomUUID() };
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/brand-workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'support.send',
          input: { organizationId, body, requestId: requestRef.current.id },
        }),
      });
      const json = (await res.json()) as { ok?: boolean };
      if (!res.ok || !json.ok) {
        setError(copy.formError);
        return;
      }
      setSent(true);
    } catch {
      setError(copy.formError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.root} data-studio-showroom={focus}>
      <div className={s.topBar}>
        <span className={s.badge}>
          {interpolate(copy.currentBadge, { organization: organizationName })}
        </span>
        <nav className={s.focusSwitch} aria-label={copy.eyebrow}>
          <a
            href={imageHref}
            className={s.focusPill}
            aria-current={focus === 'image' ? 'page' : undefined}
            data-showroom-focus="image"
          >
            {copy.switchImage}
          </a>
          <a
            href={videoHref}
            className={s.focusPill}
            aria-current={focus === 'video' ? 'page' : undefined}
            data-showroom-focus="video"
          >
            {copy.switchVideo}
          </a>
        </nav>
      </div>

      <section className={s.hero}>
        <p className={s.eyebrow}>{copy.eyebrow}</p>
        <h1 className={s.title}>{focus === 'video' ? copy.videoTitle : copy.imageTitle}</h1>
        <p className={s.lead}>{focus === 'video' ? copy.videoLead : copy.imageLead}</p>
        <div className={s.ctaRow}>
          {canRequest ? (
            <button
              type="button"
              className={s.primaryBtn}
              data-showroom-request-cta
              onClick={() => openPlanForm('demo')}
            >
              {copy.primaryCta}
            </button>
          ) : null}
          <a href={projectSpaceHref} className={s.secondaryBtn} data-showroom-back-projects>
            {copy.secondaryCta}
          </a>
          {canRequest ? (
            <a href={newBriefHref} className={s.secondaryBtn} data-showroom-new-brief>
              {copy.newBriefCta}
            </a>
          ) : null}
        </div>
        {!canRequest ? <p className={s.viewerHint}>{copy.viewerHint}</p> : null}
      </section>

      {formOpen && canRequest ? (
        <section className={s.formPanel} data-showroom-inquiry-form aria-live="polite">
          {sent ? (
            <div className={s.sentBox} role="status">
              <strong className={s.formTitle}>{copy.formSentTitle}</strong>
              <p className={s.formLead}>{copy.formSentBody}</p>
              <div className={s.ctaRow}>
                <button
                  type="button"
                  className={s.secondaryBtn}
                  onClick={() => {
                    setFormOpen(false);
                    setSent(false);
                    setNote('');
                  }}
                >
                  {copy.formCancel}
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} aria-busy={busy}>
              <fieldset className={s.formFields} disabled={busy}>
                <div>
                  <h2 className={s.formTitle}>{copy.formTitle}</h2>
                  <p className={s.formLead}>{copy.formLead}</p>
                </div>
                <label className={s.fieldLabel}>
                  <span>{copy.formPlanLabel}</span>
                  <select
                    className={s.select}
                    value={selectedOption}
                    onChange={(e) => setSelectedOption(e.target.value)}
                  >
                    <option value="demo">{copy.formPlanDemo}</option>
                    {copy.plans.map((plan, idx) => {
                      const planKey = PLAN_KEYS[idx] ?? `plan_${idx}`;
                      return (
                        <option key={planKey} value={planKey}>
                          {plan.name} · {plan.price} ({plan.storage})
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label className={s.fieldLabel}>
                  <span>{copy.formNoteLabel}</span>
                  <textarea
                    className={s.textarea}
                    rows={3}
                    maxLength={1200}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={copy.formNotePlaceholder}
                  />
                </label>
                {error ? (
                  <p role="alert" className={s.error}>
                    {error}
                  </p>
                ) : null}
                <div className={s.ctaRow}>
                  <button type="submit" className={s.primaryBtn} disabled={busy}>
                    {busy ? copy.formSending : copy.formSubmit}
                  </button>
                  <button
                    type="button"
                    className={s.secondaryBtn}
                    onClick={() => setFormOpen(false)}
                    disabled={busy}
                  >
                    {copy.formCancel}
                  </button>
                </div>
              </fieldset>
            </form>
          )}
        </section>
      ) : null}

      <section aria-labelledby="showroom-stage-heading">
        <h2 id="showroom-stage-heading" className={s.sectionHead}>
          {copy.stageHeading}
        </h2>
        <div className={s.stageShell}>
          <div className={s.stageTabs} role="tablist" aria-label={copy.stageHeading}>
            {copy.stages.map((stage, idx) => {
              const stageKey = STAGE_KEYS[idx] ?? `stage_${idx}`;
              return (
                <button
                  key={stageKey}
                  type="button"
                  role="tab"
                  aria-selected={stageIndex === idx}
                  className={s.stageTab}
                  data-showroom-stage={stageKey}
                  onClick={() => setStageIndex(idx)}
                >
                  <span className={s.stageTag}>{stage.tag}</span>
                  <span className={s.stageTabTitle}>{stage.title}</span>
                </button>
              );
            })}
          </div>
          <div className={s.stagePreview} role="tabpanel">
            <div className={s.stageVisual}>
              <div className={s.stageMockRow}>
                <span className={s.stageChip}>{activeStage.tag}</span>
                <span className={s.stageChip}>{activeStage.previewHint}</span>
              </div>
              <h3 className={s.stageDetailTitle}>{activeStage.title}</h3>
              <p className={s.stageDetailBody}>{activeStage.detail}</p>
            </div>
            {canRequest ? (
              <div className={s.ctaRow}>
                <button
                  type="button"
                  className={s.secondaryBtn}
                  onClick={() => openPlanForm('demo')}
                >
                  {copy.primaryCta}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className={s.plansCard} aria-labelledby="showroom-plans-heading" data-showroom-plans>
        <h2 id="showroom-plans-heading" className={s.sectionHead}>
          {copy.plansHeading}
        </h2>
        <p className={s.plansSub}>{copy.plansNote}</p>
        <div className={s.plansGrid}>
          {copy.plans.map((plan, idx) => {
            const planKey = PLAN_KEYS[idx] ?? `plan_${idx}`;
            return (
              <article key={planKey} className={s.planItem} data-showroom-plan={planKey}>
                <p className={s.planName}>{plan.name}</p>
                <p className={s.planPrice}>{plan.price}</p>
                <span className={s.planStorage}>{plan.storage}</span>
                <p className={s.planSummary}>{plan.summary}</p>
                {canRequest ? (
                  <button
                    type="button"
                    className={s.secondaryBtn}
                    onClick={() => openPlanForm(planKey)}
                  >
                    {copy.primaryCta}
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
