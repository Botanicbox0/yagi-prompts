'use client';

import { useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { HomeNewsLine } from '@/components/brand-workspace/home/news-line';
import { ADMIN_ACTION_PATH, BACK_FIELD, OP_FIELD } from '@/lib/admin/form';
import {
  BRAND_NEWS_LIMITS,
  BRAND_NEWS_MODES,
  BRAND_NEWS_PLANS,
  BRAND_NEWS_SHAPES,
  charCount,
  type BrandNewsAdminItem,
  type BrandNewsMode,
  type BrandNewsPlan,
  type BrandNewsShape,
} from '@/lib/brand-news/contracts';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import s from './brand-news.module.css';
import {
  buildPreviewAnnouncement,
  formatPublishConfirmation,
  isDirty,
  normalizedOrgSet,
  validateDraftClient,
  type BrandNewsAdminCopy,
  type BrandNewsFormValues,
  type BrandNewsOutcomeField,
  type ResolvedBrandNewsOutcome,
} from './model';

export interface BrandNewsEditorProps {
  selected: BrandNewsAdminItem | null;
  liveItem: BrandNewsAdminItem | null;
  initialValues: BrandNewsFormValues;
  nowMs?: number;
  reach: { ok: true; organizations: number } | null;
  studioV2Enabled: boolean;
  outcome: ResolvedBrandNewsOutcome | null;
  copy: BrandNewsAdminCopy;
  homeCopyKo: Dictionary['brandNews'];
  homeCopyEn: Dictionary['brandNews'];
}

const BUTTON = 'admin-btn';
const BUTTON_PRIMARY = 'admin-btn admin-btn-primary';
const INPUT = 'admin-input w-full px-3 py-2 text-[13.5px] outline-none';
const LABEL = 'admin-field-label block text-[12px] font-semibold';

function PostOpForm({
  op,
  back,
  className,
  renderBody,
}: {
  op: string;
  back: string;
  className?: string;
  renderBody: (submitting: boolean) => ReactNode;
}) {
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  return (
    <form
      method="post"
      action={ADMIN_ACTION_PATH}
      encType="multipart/form-data"
      className={className}
      onSubmit={(event) => {
        if (submittingRef.current) {
          event.preventDefault();
          return;
        }
        submittingRef.current = true;
        setSubmitting(true);
      }}
    >
      <input type="hidden" name={OP_FIELD} value={op} />
      <input type="hidden" name={BACK_FIELD} value={back} />
      {renderBody(submitting)}
    </form>
  );
}

function ConfirmCheckbox({ label, disabled = false }: { label: string; disabled?: boolean }) {
  return (
    <label className="bw-check flex items-start gap-2 font-mono text-[0.75rem]" data-confirm-check="">
      <input type="checkbox" name="_confirm" value="1" required disabled={disabled} />
      <span>{label}</span>
    </label>
  );
}

function EditorPanel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="admin-panel mt-7 border border-hairline">
      <header className="admin-panel-head flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-3">
        <h2 className="admin-panel-title text-[14px] font-semibold">{title}</h2>
        {action}
      </header>
      <div className="admin-panel-body p-5">{children}</div>
    </section>
  );
}

function toggleIn<T extends string>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className={s.fieldError} role="alert">
      {message}
    </p>
  );
}

function Counter({ current, max, template }: { current: number; max: number; template: string }) {
  const over = current > max;
  return (
    <span className={`${s.counter}${over ? ` ${s.counterOver}` : ''}`} data-counter={`${current}/${max}`}>
      {interpolate(template, { current: String(current), max: String(max) })}
    </span>
  );
}

export function BrandNewsEditor({
  selected,
  liveItem,
  initialValues,
  nowMs,
  reach,
  studioV2Enabled,
  outcome,
  copy,
  homeCopyKo,
  homeCopyEn,
}: BrandNewsEditorProps) {
  const [values, setValues] = useState<BrandNewsFormValues>(initialValues);
  const [localImageUrl, setLocalImageUrl] = useState<string | null>(null);
  const [hasPendingFile, setHasPendingFile] = useState(false);
  const [explicitAllSelected, setExplicitAllSelected] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [fallbackNowMs] = useState(() => Date.now());
  const baseId = useId();
  const effectiveNowMs = nowMs ?? fallbackNowMs;

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    return () => {
      if (localImageUrl && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(localImageUrl);
      }
    };
  }, [localImageUrl]);

  const isReadOnly = selected !== null && selected.status !== 'draft';
  const storedAudienceNull = selected !== null && selected.audience === null;
  const backHref = selected ? `/admin/brand-news?edit=${selected.id}` : '/admin/brand-news';
  const L = BRAND_NEWS_LIMITS;
  const uploadMb = String(Math.round(L.imageUploadMaxBytes / (1024 * 1024)));
  const maxKb = String(Math.round(L.image.maxBytes / 1024));

  const clientErrors = isReadOnly
    ? {}
    : validateDraftClient(values, copy, {
        hasPendingImage: hasPendingFile,
        storedAudienceNull,
        explicitAllSelected,
      });
  const saveBlocked = Object.keys(clientErrors).length > 0;
  const dirty =
    selected !== null &&
    isDirty(values, initialValues, {
      hasPendingImage: hasPendingFile,
      storedAudienceNull,
    });
  const publishBlocked = !hydrated || dirty || storedAudienceNull;

  const fieldError = (name: BrandNewsOutcomeField) => clientErrors[name] ?? outcome?.fieldMessages[name];
  const errorId = (name: BrandNewsOutcomeField) => `${baseId}-err-${name}`;

  const handleImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setHasPendingFile(Boolean(file));
    if (localImageUrl && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(localImageUrl);
    }
    if (!file || typeof URL.createObjectURL !== 'function') {
      setLocalImageUrl(null);
      return;
    }
    setLocalImageUrl(URL.createObjectURL(file));
  };

  const handleShapeChange = (nextShape: BrandNewsShape) => {
    if (nextShape === 'line') {
      setHasPendingFile(false);
      if (localImageUrl && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(localImageUrl);
      }
      setLocalImageUrl(null);
    }
    setValues((prev) => ({ ...prev, shape: nextShape }));
  };

  const previewKo = buildPreviewAnnouncement(values, 'ko', localImageUrl);
  const previewEn = buildPreviewAnnouncement(values, 'en', localImageUrl);

  const panelTitle =
    selected === null
      ? copy.newDraft
      : selected.status === 'draft'
        ? copy.editingDraft
        : copy.viewingAnnouncement;

  const confirmPublishLabel = selected
    ? formatPublishConfirmation({
        liveItem,
        selectedId: selected.id,
        startsAtIso: selected.startsAt,
        nowMs: effectiveNowMs,
        copy,
      })
    : copy.actions.confirmPublishLabel;

  const textField = (
    name: 'kickerKo' | 'kickerEn' | 'titleKo' | 'titleEn' | 'ctaLabelKo' | 'ctaLabelEn',
    label: string,
    max: number,
  ) => {
    const current = values[name];
    const count = charCount(current);
    const err = fieldError(name);
    const inputId = `${baseId}-${name}`;
    return (
      <div className="admin-field block" data-brand-news-field={name}>
        <div className={s.fieldHead}>
          <label htmlFor={inputId} className={LABEL}>
            {label}
          </label>
          <Counter current={count} max={max} template={copy.counter} />
        </div>
        <input
          id={inputId}
          type="text"
          name={name}
          value={current}
          readOnly={isReadOnly}
          aria-invalid={err ? 'true' : undefined}
          aria-describedby={err ? errorId(name) : undefined}
          onChange={(e) => setValues((prev) => ({ ...prev, [name]: e.target.value }))}
          className={`${INPUT} mt-1.5`}
        />
        <FieldError id={errorId(name)} message={err} />
      </div>
    );
  };

  const saveFields = (
    <>
      {selected ? <input type="hidden" name="id" value={selected.id} /> : null}

      <div className={s.twoCols}>
        {textField('kickerKo', copy.fields.kickerKo, L.kickerChars)}
        {textField('kickerEn', copy.fields.kickerEn, L.kickerChars)}
      </div>
      <p className="admin-field-hint">{copy.fields.kickerHint}</p>

      <div className={s.twoCols}>
        {textField('titleKo', copy.fields.titleKo, L.titleChars)}
        {textField('titleEn', copy.fields.titleEn, L.titleChars)}
      </div>
      <p className="admin-field-hint">{copy.fields.titleHint}</p>

      <div className={s.twoCols}>
        {textField('ctaLabelKo', copy.fields.ctaLabelKo, L.ctaLabelChars)}
        {textField('ctaLabelEn', copy.fields.ctaLabelEn, L.ctaLabelChars)}
      </div>
      <p className="admin-field-hint">{copy.fields.ctaLabelHint}</p>

      <div className="admin-field block" data-brand-news-field="ctaHref">
        <div className={s.fieldHead}>
          <label htmlFor={`${baseId}-ctaHref`} className={LABEL}>
            {copy.fields.ctaHref}
          </label>
          <Counter current={charCount(values.ctaHref)} max={L.hrefChars} template={copy.counter} />
        </div>
        <input
          id={`${baseId}-ctaHref`}
          type="text"
          name="ctaHref"
          value={values.ctaHref}
          readOnly={isReadOnly}
          placeholder="/brand/studio/video"
          aria-invalid={fieldError('ctaHref') ? 'true' : undefined}
          aria-describedby={fieldError('ctaHref') ? errorId('ctaHref') : undefined}
          onChange={(e) => setValues((prev) => ({ ...prev, ctaHref: e.target.value }))}
          className={`${INPUT} mt-1.5`}
        />
        <p className="admin-field-hint mt-1">{copy.fields.ctaHrefRule}</p>
        <FieldError id={errorId('ctaHref')} message={fieldError('ctaHref')} />
      </div>

      <fieldset className={s.fieldsetBox} data-brand-news-field="shape">
        <legend className={LABEL}>{copy.fields.shape}</legend>
        <div className={s.radioRow}>
          {BRAND_NEWS_SHAPES.map((shape) => (
            <label key={shape} className={s.checkItem}>
              <input
                type="radio"
                name="shape"
                value={shape}
                data-brand-news-shape={shape}
                checked={values.shape === shape}
                disabled={isReadOnly}
                onChange={() => handleShapeChange(shape)}
              />
              <span>{copy.shapes[shape]}</span>
            </label>
          ))}
        </div>
        <FieldError id={errorId('shape')} message={fieldError('shape')} />
      </fieldset>

      {values.shape === 'banner' ? (
        <div className={s.fieldsetBox} data-brand-news-field="image">
          <label htmlFor={`${baseId}-image`} className={LABEL}>
            {copy.fields.image}
          </label>
          {!isReadOnly ? (
            <input
              id={`${baseId}-image`}
              type="file"
              name="image"
              accept="image/jpeg,image/png,image/webp,image/avif"
              aria-invalid={fieldError('image') ? 'true' : undefined}
              aria-describedby={fieldError('image') ? errorId('image') : undefined}
              onChange={handleImageChange}
              className={INPUT}
            />
          ) : null}
          <p className="admin-field-hint">
            {interpolate(copy.fields.imageRule, {
              width: String(L.image.width),
              height: String(L.image.height),
              uploadMb,
              maxKb,
            })}
          </p>
          {values.storedImageUrl ? (
            <div>
              <p className="admin-field-hint">{copy.fields.imageKeepNote}</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={localImageUrl ?? values.storedImageUrl}
                alt=""
                width={L.image.width}
                height={L.image.height}
                className={s.existingThumb}
              />
            </div>
          ) : null}
          <FieldError id={errorId('image')} message={fieldError('image')} />
        </div>
      ) : fieldError('image') ? (
        <div className={s.fieldsetBox} data-brand-news-field="image">
          <FieldError id={errorId('image')} message={fieldError('image')} />
        </div>
      ) : null}

      <fieldset className={s.fieldsetBox} data-brand-news-field="period">
        <legend className={LABEL}>{copy.cols.period}</legend>
        <div className={s.twoCols}>
          <div className="admin-field block" data-brand-news-field="startsAt">
            <label htmlFor={`${baseId}-startsAt`} className={LABEL}>
              {copy.fields.startsAt}
            </label>
            <input
              id={`${baseId}-startsAt`}
              type="datetime-local"
              name="startsAt"
              value={values.startsAtLocal}
              readOnly={isReadOnly}
              required
              aria-invalid={fieldError('startsAt') ? 'true' : undefined}
              aria-describedby={fieldError('startsAt') ? errorId('startsAt') : undefined}
              onChange={(e) => setValues((prev) => ({ ...prev, startsAtLocal: e.target.value }))}
              className={`${INPUT} mt-1.5`}
            />
            <FieldError id={errorId('startsAt')} message={fieldError('startsAt')} />
          </div>

          <div className="admin-field block" data-brand-news-field="endsAt">
            <label htmlFor={`${baseId}-endsAt`} className={LABEL}>
              {copy.fields.endsAt}
            </label>
            <input
              id={`${baseId}-endsAt`}
              type="datetime-local"
              name="endsAt"
              value={values.endsAtLocal}
              readOnly={isReadOnly}
              required
              aria-invalid={fieldError('endsAt') ? 'true' : undefined}
              aria-describedby={fieldError('endsAt') ? errorId('endsAt') : undefined}
              onChange={(e) => setValues((prev) => ({ ...prev, endsAtLocal: e.target.value }))}
              className={`${INPUT} mt-1.5`}
            />
            <FieldError id={errorId('endsAt')} message={fieldError('endsAt')} />
          </div>
        </div>
        <p className="admin-field-hint">
          {interpolate(copy.fields.periodNote, { days: String(L.periodMaxDays) })}
        </p>
        <FieldError id={errorId('period')} message={fieldError('period')} />
      </fieldset>

      <fieldset className={s.fieldsetBox} data-brand-news-field="audience">
        <legend className={LABEL}>{copy.fields.audience}</legend>

        {storedAudienceNull ? (
          <div data-brand-news-audience-invalid="">
            <p className={s.fieldError} role="alert">
              {copy.audienceSummary.invalid}
            </p>
            <label className={`${s.checkItem} mt-2`}>
              <input
                type="checkbox"
                data-brand-news-audience-all=""
                checked={explicitAllSelected}
                disabled={isReadOnly}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setExplicitAllSelected(checked);
                  if (checked) {
                    setValues((prev) => ({ ...prev, modes: [], plans: [], orgsText: '' }));
                  }
                }}
              />
              <span>{copy.fields.audienceAllChoice}</span>
            </label>
            <p className="admin-field-hint mt-1">{copy.fields.audienceAllHint}</p>
          </div>
        ) : null}

        <div>
          <p className="admin-field-label">{copy.fields.audienceModesLabel}</p>
          <div className={`${s.checkRow} mt-1.5`}>
            {BRAND_NEWS_MODES.map((mode: BrandNewsMode) => (
              <label key={mode} className={s.checkItem}>
                <input
                  type="checkbox"
                  name="audienceModes"
                  value={mode}
                  data-brand-news-mode={mode}
                  checked={values.modes.includes(mode)}
                  disabled={isReadOnly}
                  onChange={() => {
                    setValues((prev) => ({ ...prev, modes: toggleIn(prev.modes, mode) }));
                  }}
                />
                <span>{copy.modeNames[mode]}</span>
              </label>
            ))}
          </div>
          <p className="admin-field-hint mt-1">{copy.fields.audienceModesNote}</p>
        </div>

        <div>
          <p className="admin-field-label">{copy.fields.audiencePlansLabel}</p>
          <div className={`${s.checkRow} mt-1.5`}>
            {BRAND_NEWS_PLANS.map((plan: BrandNewsPlan) => (
              <label key={plan} className={s.checkItem}>
                <input
                  type="checkbox"
                  name="audiencePlans"
                  value={plan}
                  checked={values.plans.includes(plan)}
                  disabled={isReadOnly}
                  onChange={() => {
                    setExplicitAllSelected(false);
                    setValues((prev) => ({ ...prev, plans: toggleIn(prev.plans, plan) }));
                  }}
                />
                <span>{copy.planNames[plan]}</span>
              </label>
            ))}
          </div>
          <p className="admin-field-hint mt-1">{copy.fields.audiencePlansNote}</p>
        </div>

        <div>
          <label htmlFor={`${baseId}-orgs`} className={LABEL}>
            {copy.fields.audienceOrgsLabel}
          </label>
          <textarea
            id={`${baseId}-orgs`}
            name="audienceOrgs"
            rows={3}
            value={values.orgsText}
            readOnly={isReadOnly}
            aria-invalid={fieldError('audience') ? 'true' : undefined}
            aria-describedby={fieldError('audience') ? errorId('audience') : undefined}
            onChange={(e) => {
              const nextOrgs = e.target.value;
              if (normalizedOrgSet(nextOrgs).size > 0) setExplicitAllSelected(false);
              setValues((prev) => ({ ...prev, orgsText: nextOrgs }));
            }}
            className={`${INPUT} mt-1.5 font-mono text-[12.5px]`}
          />
          <p className="admin-field-hint mt-1">
            {interpolate(copy.fields.audienceOrgsNote, { max: String(L.audienceOrgsMax) })}
          </p>
        </div>

        {storedAudienceNull ? (
          <FieldError id={errorId('audience')} message={outcome?.fieldMessages.audience} />
        ) : (
          <FieldError id={errorId('audience')} message={fieldError('audience')} />
        )}
      </fieldset>
    </>
  );

  return (
    <div className={s.stack}>
      {outcome?.bannerMessage ? (
        <div
          className="admin-outcome"
          data-outcome={outcome.kind === 'ok' ? 'ok' : 'error'}
          data-brand-news-outcome={outcome.kind}
          role={outcome.kind === 'err' ? 'alert' : 'status'}
        >
          <p className="admin-outcome-title">{outcome.bannerMessage}</p>
        </div>
      ) : null}

      <EditorPanel
        title={panelTitle}
        action={
          selected !== null ? (
            <a href="/admin/brand-news" className={BUTTON}>
              {copy.newDraft}
            </a>
          ) : undefined
        }
      >
        <div className={s.stack}>
          {isReadOnly ? (
            <p className="admin-field-hint" data-brand-news-readonly="">
              {copy.readOnlyNote}
            </p>
          ) : null}

          {selected?.status === 'draft' && reach?.ok ? (
            <div className={s.reachCard} data-brand-news-reach={String(reach.organizations)}>
              <span className="admin-field-label">{copy.reach.heading}</span>
              <p className={s.reachNumber}>
                {interpolate(copy.reach.count, { count: reach.organizations.toLocaleString('ko-KR') })}
              </p>
              <p className="admin-field-hint">{copy.reach.note}</p>
              {!studioV2Enabled ? <p className="admin-field-hint">{copy.reach.studioClosedNote}</p> : null}
            </div>
          ) : null}

          {selected?.status === 'draft' ? (
            <div className={s.readinessBox} data-brand-news-readiness={selected.publishable.ok ? 'ready' : 'blocked'}>
              <span className="admin-field-label">{copy.publishReadiness.heading}</span>
              {selected.publishable.ok ? (
                <p className="admin-field-hint">{copy.publishReadiness.ready}</p>
              ) : (
                <>
                  <p className="admin-field-hint">{copy.publishReadiness.blockedPrefix}</p>
                  <ul className={s.readinessList}>
                    {selected.publishable.reasons.map((reason) => (
                      <li key={reason}>{copy.publishReadiness.reasons[reason]}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : null}

          {isReadOnly ? (
            <div className={s.fieldGrid}>{saveFields}</div>
          ) : (
            <PostOpForm
              op="brandNews.save"
              back={backHref}
              className={s.fieldGrid}
              renderBody={(submitting) => (
                <>
                  {saveFields}
                  <div className={s.actionPanel}>
                    <button
                      type="submit"
                      className={BUTTON_PRIMARY}
                      disabled={saveBlocked || submitting}
                      data-brand-news-save=""
                    >
                      {selected ? copy.actions.saveEdit : copy.actions.saveNew}
                    </button>
                  </div>
                </>
              )}
            />
          )}

          {selected?.status === 'draft' ? (
            <div className={s.confirmBox} data-brand-news-publish-box="">
              {liveItem && liveItem.id !== selected.id ? (
                <p className="admin-field-hint" data-brand-news-publish-replaces={liveItem.id}>
                  {copy.liveBannerTitle}: {liveItem.titleKo || liveItem.titleEn || liveItem.id}
                </p>
              ) : null}
              {dirty ? (
                <p className={s.fieldError} role="status" data-brand-news-dirty-notice="">
                  {copy.actions.saveBeforePublish}
                </p>
              ) : null}
              <PostOpForm
                op="brandNews.publish"
                back={backHref}
                className={s.stack}
                renderBody={(submitting) => (
                  <>
                    <input type="hidden" name="id" value={selected.id} />
                    <ConfirmCheckbox label={confirmPublishLabel} disabled={publishBlocked || submitting} />
                    <div className={s.rowActions}>
                      <button
                        type="submit"
                        className={BUTTON_PRIMARY}
                        disabled={publishBlocked || submitting}
                        data-brand-news-publish=""
                      >
                        {copy.actions.publish}
                      </button>
                    </div>
                  </>
                )}
              />
            </div>
          ) : null}

          {selected?.status === 'live' ? (
            <div className={s.confirmBox} data-brand-news-end-box="">
              <PostOpForm
                op="brandNews.end"
                back={backHref}
                className={s.stack}
                renderBody={(submitting) => (
                  <>
                    <input type="hidden" name="id" value={selected.id} />
                    <ConfirmCheckbox label={copy.actions.confirmEndLabel} disabled={submitting} />
                    <div className={s.rowActions}>
                      <button
                        type="submit"
                        className={BUTTON}
                        disabled={submitting}
                        data-brand-news-end=""
                      >
                        {copy.actions.end}
                      </button>
                    </div>
                  </>
                )}
              />
            </div>
          ) : null}
        </div>
      </EditorPanel>

      <EditorPanel title={copy.preview.heading}>
        <div className={s.previewGroup} data-brand-news-preview-section="">
          <div>
            <p className={s.previewLangLabel}>{copy.preview.koLabel}</p>
            <div className={s.previewScroll} data-brand-news-preview="ko">
              <div className={`${s.previewCanvas} bw-main`} data-brand-workspace="" data-theme="dark" data-preview-width="1440">
                {previewKo ? (
                  <HomeNewsLine preview news={previewKo} copy={homeCopyKo} />
                ) : (
                  <p className={s.previewEmpty} data-brand-news-preview-empty="ko">
                    {copy.preview.incompleteNote}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div>
            <p className={s.previewLangLabel}>{copy.preview.enLabel}</p>
            <div className={s.previewScroll} data-brand-news-preview="en">
              <div className={`${s.previewCanvas} bw-main`} data-brand-workspace="" data-theme="dark" data-preview-width="1440">
                {previewEn ? (
                  <HomeNewsLine preview news={previewEn} copy={homeCopyEn} />
                ) : (
                  <p className={s.previewEmpty} data-brand-news-preview-empty="en">
                    {copy.preview.incompleteNote}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </EditorPanel>
    </div>
  );
}
