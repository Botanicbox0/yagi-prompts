'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  INTAKE_ASPECT_RATIOS,
  INTAKE_BUDGET_BANDS,
  INTAKE_CHANNELS,
  INTAKE_CONTACT_CHANNELS,
  INTAKE_TRACK_IDS,
  budgetKrwFromIntakeBand,
  extractIntakeSuggestions,
  extractTextFromBriefFile,
  normalizeClientHttpsUrl,
  objectiveFromIntakeBrief,
  productionModeForIntakeTrack,
  type IntakeAspectRatio,
  type IntakeBudgetBand,
  type IntakeBrief,
  type IntakeChannel,
  type IntakeContactChannel,
  type IntakeTrackId,
} from '@/lib/brands/workspace/intake-brief';
import type { IntakeBriefCopy } from '@/messages/intake-brief';
import { interpolate } from '@/lib/i18n/format';
import styles from './project-intake-wizard.module.css';

export const INTAKE_DRAFT_KEY_PREFIX = 'twings_project_intake_draft_v1:';

const UPLOADABLE_ATTACHMENT_CAPS: Record<string, number> = {
  'image/jpeg': 15 * 1024 * 1024,
  'image/png': 15 * 1024 * 1024,
  'image/webp': 15 * 1024 * 1024,
  'video/mp4': 50_000_000,
  'video/webm': 50_000_000,
  'application/pdf': 20 * 1024 * 1024,
};

type StepKey = 'what' | 'materials' | 'terms';
const STEP_ORDER: readonly StepKey[] = ['what', 'materials', 'terms'];

interface ReferenceRow {
  url: string;
  note: string;
}

interface StudioAssetPick {
  id: string;
  name: string;
  kind: 'image' | 'video' | 'audio';
  thumbUrl: string | null;
  url: string;
}

interface DraftState {
  step: StepKey;
  track: IntakeTrackId;
  title: string;
  summary: string;
  briefText: string;
  references: ReferenceRow[];
  studioAssetIds: string[];
  deliverableKind: string;
  duration: string;
  aspectRatios: IntakeAspectRatio[];
  quantity: string;
  channels: IntakeChannel[];
  startsOn: string;
  dueOn: string;
  budgetBand: IntakeBudgetBand;
  contactName: string;
  contactChannel: IntakeContactChannel;
  contactValue: string;
  approver: string;
}

function initialDraft(defaultTrack: IntakeTrackId): DraftState {
  return {
    step: 'what',
    track: defaultTrack,
    title: '',
    summary: '',
    briefText: '',
    references: [{ url: '', note: '' }],
    studioAssetIds: [],
    deliverableKind: '',
    duration: '',
    aspectRatios: ['9:16'],
    quantity: '',
    channels: [],
    startsOn: '',
    dueOn: '',
    budgetBand: 'undecided',
    contactName: '',
    contactChannel: 'email',
    contactValue: '',
    approver: '',
  };
}

function resolveInitialTrack(raw: string | undefined, allowTemplate: boolean): IntakeTrackId {
  if (raw === 'template_build' && allowTemplate) return 'template_build';
  if (raw === 'creator_campaign') return 'creator_campaign';
  if (raw === 'studio_film') return 'studio_film';
  if (raw === 'other') return 'other';
  return 'creator_campaign';
}

function ratioText(copy: IntakeBriefCopy, ratio: IntakeAspectRatio): string {
  if (ratio === '9:16') return copy.ratios.r9x16;
  if (ratio === '4:5') return copy.ratios.r4x5;
  if (ratio === '1:1') return copy.ratios.r1x1;
  return copy.ratios.r16x9;
}

async function uploadWorkspaceAttachment(projectId: string, file: File): Promise<string | null> {
  const cap = UPLOADABLE_ATTACHMENT_CAPS[file.type];
  if (!cap || file.size <= 0 || file.size > cap) return null;
  const reserveRes = await fetch('/api/brand-workspace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operation: 'attachment.reserve',
      input: {
        projectId,
        purpose: 'workspace',
        requestId: crypto.randomUUID(),
        name: file.name.replace(/[\\/<>:"|?*]/g, '_').slice(0, 160),
        mime: file.type,
        sizeBytes: file.size,
      },
    }),
  });
  const reserved = (await reserveRes.json().catch(() => null)) as
    | { ok?: boolean; id?: string; direct?: boolean; url?: string }
    | null;
  if (!reserveRes.ok || !reserved?.ok || !reserved.id) return null;

  const putUrl = reserved.direct && reserved.url ? reserved.url : `/api/brand-workspace/attachments/${reserved.id}`;
  const putRes = await fetch(putUrl, {
    method: reserved.direct ? 'PUT' : 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!putRes.ok) return null;

  const completeRes = await fetch('/api/brand-workspace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operation: 'attachment.complete',
      input: { id: reserved.id },
    }),
  });
  const completed = (await completeRes.json().catch(() => null)) as { ok?: boolean } | null;
  return completeRes.ok && completed?.ok ? reserved.id : null;
}

export function ProjectIntakeWizard({
  copy,
  organizations,
  initialTrack,
  selfStudioClosed = false,
  initialAssets,
}: {
  copy: IntakeBriefCopy;
  organizations: Array<{ id: string; name: string }>;
  initialTrack?: string;
  /** True for non-subscribing commissioned clients (`self_studio` denied): hides `template_build`. */
  selfStudioClosed?: boolean;
  initialAssets?: StudioAssetPick[];
}) {
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? '');
  const availableTracks = useMemo(
    () => INTAKE_TRACK_IDS.filter((t) => (selfStudioClosed ? t !== 'template_build' : true)),
    [selfStudioClosed],
  );
  const defaultTrack = resolveInitialTrack(initialTrack, !selfStudioClosed);
  const [draft, setDraft] = useState<DraftState>(() => initialDraft(defaultTrack));
  const [files, setFiles] = useState<File[]>([]);
  const [extractedFileTexts, setExtractedFileTexts] = useState<Record<string, string>>({});
  const [hasSavedDraft, setHasSavedDraft] = useState(false);
  const [autofillBusy, setAutofillBusy] = useState(false);
  const [autofillMessage, setAutofillMessage] = useState<string | null>(null);
  const [studioAssets, setStudioAssets] = useState<StudioAssetPick[]>(initialAssets ?? []);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef<string | null>(null);

  const storageKey = `${INTAKE_DRAFT_KEY_PREFIX}${organizationId}`;

  // Restore saved browser draft for this organization on mount / org switch.
  useEffect(() => {
    if (!organizationId || typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        setHasSavedDraft(false);
        return;
      }
      const parsed = JSON.parse(raw) as Partial<DraftState>;
      if (parsed && typeof parsed === 'object') {
        setDraft((prev) => ({
          ...prev,
          ...parsed,
          track:
            parsed.track && availableTracks.includes(parsed.track)
              ? parsed.track
              : prev.track,
        }));
        setHasSavedDraft(true);
      }
    } catch {
      // Ignore corrupt storage entries.
    }
  }, [organizationId, storageKey, availableTracks]);

  // Persist draft edits automatically.
  useEffect(() => {
    if (!organizationId || typeof window === 'undefined') return;
    const meaningful = Boolean(
      draft.title.trim() ||
        draft.summary.trim() ||
        draft.briefText.trim() ||
        draft.contactName.trim() ||
        draft.contactValue.trim(),
    );
    if (!meaningful) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(draft));
      setHasSavedDraft(true);
    } catch {
      // Ignore storage quota errors.
    }
  }, [draft, organizationId, storageKey]);

  // Load Brand Asset Hub items so the client can pick existing packshots/logos in Step 2.
  useEffect(() => {
    if (initialAssets !== undefined || !organizationId || typeof window === 'undefined') return;
    let active = true;
    void fetch(`/api/brand-studio?organizationId=${encodeURIComponent(organizationId)}`, {
      headers: { Accept: 'application/json' },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { ok?: boolean; assets?: StudioAssetPick[] } | null) => {
        if (active && data?.ok && Array.isArray(data.assets)) {
          setStudioAssets(data.assets);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [initialAssets, organizationId]);

  const update = useCallback(<K extends keyof DraftState>(key: K, value: DraftState[K]) => {
    requestIdRef.current = null;
    setError(null);
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const clearSavedDraft = () => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {}
    }
    setDraft(initialDraft(defaultTrack));
    setFiles([]);
    setExtractedFileTexts({});
    setHasSavedDraft(false);
    setAutofillMessage(null);
    setError(null);
  };

  const applySuggestionsFromText = useCallback(
    (combinedText: string) => {
      const found = extractIntakeSuggestions(combinedText);
      if (found.matchedFields.length === 0) {
        setAutofillMessage(copy.fields.autofillNone);
        return;
      }
      setDraft((prev) => ({
        ...prev,
        title: prev.title.trim() ? prev.title : (found.title ?? prev.title),
        summary: prev.summary.trim() ? prev.summary : (found.summary ?? prev.summary),
        duration: prev.duration.trim() ? prev.duration : (found.duration ?? prev.duration),
        aspectRatios: found.aspectRatios && found.aspectRatios.length > 0 ? found.aspectRatios : prev.aspectRatios,
        quantity: prev.quantity.trim() ? prev.quantity : found.quantity !== undefined ? String(found.quantity) : prev.quantity,
        channels: found.channels && found.channels.length > 0 ? [...new Set([...prev.channels, ...found.channels])] : prev.channels,
        startsOn: prev.startsOn || found.startsOn || '',
        dueOn: prev.dueOn || found.dueOn || '',
        budgetBand: prev.budgetBand !== 'undecided' ? prev.budgetBand : (found.budgetBand ?? prev.budgetBand),
        contactChannel: prev.contactValue.trim() ? prev.contactChannel : (found.contactChannel ?? prev.contactChannel),
        contactValue: prev.contactValue.trim() ? prev.contactValue : (found.contactValue ?? prev.contactValue),
      }));
      setAutofillMessage(interpolate(copy.fields.autofillDone, { count: found.matchedFields.length }));
    },
    [copy.fields.autofillDone, copy.fields.autofillNone],
  );

  const handlePickedFiles = async (picked: File[]) => {
    if (!picked.length) return;
    setError(null);
    const nextFiles = [...files, ...picked].slice(0, 10);
    setFiles(nextFiles);
    setAutofillBusy(true);
    try {
      const texts: Record<string, string> = { ...extractedFileTexts };
      for (const file of picked) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const extracted = await extractTextFromBriefFile(file.name, file.type, bytes);
        if (extracted) texts[file.name] = extracted;
      }
      setExtractedFileTexts(texts);
      const mergedText = [draft.briefText, ...Object.values(texts)].filter(Boolean).join('\n\n');
      if (mergedText.trim()) {
        // If briefText was empty and we extracted text from a non-PDF doc (e.g. DOCX/PPTX/TXT), populate briefText too so nothing is lost.
        const docOnlyText = Object.values(texts).filter(Boolean).join('\n\n').slice(0, 8000);
        if (!draft.briefText.trim() && docOnlyText) {
          setDraft((prev) => ({ ...prev, briefText: docOnlyText }));
        }
        applySuggestionsFromText(mergedText);
      }
    } finally {
      setAutofillBusy(false);
    }
  };

  const runManualAutofill = () => {
    const mergedText = [draft.briefText, ...Object.values(extractedFileTexts)].filter(Boolean).join('\n\n');
    applySuggestionsFromText(mergedText);
  };

  const validateStep = (target: StepKey): string | null => {
    if (target === 'what') {
      if (draft.title.trim().length < 3) return copy.errors.titleShort;
      if (draft.summary.trim().length < 3) return copy.errors.summaryShort;
    }
    if (target === 'materials') {
      for (const ref of draft.references) {
        if (ref.url.trim() && !normalizeClientHttpsUrl(ref.url.trim())) {
          return copy.errors.badReferenceUrl;
        }
      }
    }
    if (target === 'terms') {
      if (draft.startsOn && draft.dueOn && draft.dueOn < draft.startsOn) {
        return copy.errors.dueBeforeStart;
      }
      if (!draft.contactName.trim() || !draft.contactValue.trim()) {
        return copy.errors.contactRequired;
      }
    }
    return null;
  };

  const goStep = (next: StepKey) => {
    const currentIdx = STEP_ORDER.indexOf(draft.step);
    const nextIdx = STEP_ORDER.indexOf(next);
    if (nextIdx > currentIdx) {
      for (let i = currentIdx; i < nextIdx; i += 1) {
        const problem = validateStep(STEP_ORDER[i]!);
        if (problem) {
          setError(problem);
          return;
        }
      }
    }
    setError(null);
    update('step', next);
  };

  const submitBrief = async () => {
    if (submitting) return;
    for (const step of STEP_ORDER) {
      const problem = validateStep(step);
      if (problem) {
        update('step', step);
        setError(problem);
        return;
      }
    }
    const cleanReferences = draft.references
      .filter((r) => r.url.trim().length > 0)
      .map((r) => ({ url: normalizeClientHttpsUrl(r.url.trim())!, note: r.note.trim().slice(0, 500) }));

    const qtyNum = draft.quantity.trim() ? Number(draft.quantity.trim()) : null;
    const parsedQty = qtyNum !== null && Number.isInteger(qtyNum) && qtyNum >= 1 && qtyNum <= 500 ? qtyNum : null;

    const mergedNotes = [
      draft.briefText.trim(),
      ...Object.entries(extractedFileTexts)
        .filter(([name]) => !UPLOADABLE_ATTACHMENT_CAPS[files.find((f) => f.name === name)?.type ?? ''])
        .map(([, content]) => content.trim()),
    ]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 8000);

    const intakeBrief: IntakeBrief = {
      version: 1,
      track: draft.track,
      summary: draft.summary.trim().slice(0, 500),
      briefText: mergedNotes,
      briefFileNames: files.map((f) => f.name.slice(0, 160)).slice(0, 10),
      briefAttachmentIds: [],
      studioAssetIds: draft.studioAssetIds.slice(0, 20),
      deliverables: {
        kind: draft.deliverableKind.trim().slice(0, 120),
        duration: draft.duration.trim().slice(0, 60),
        aspectRatios: draft.aspectRatios,
        quantity: parsedQty,
        channels: draft.channels,
      },
      schedule: {
        startsOn: draft.startsOn || null,
        dueOn: draft.dueOn || null,
      },
      budgetBand: draft.budgetBand,
      contact: {
        name: draft.contactName.trim().slice(0, 80),
        channel: draft.contactChannel,
        value: draft.contactValue.trim().slice(0, 160),
        approver: draft.approver.trim().slice(0, 120),
      },
    };

    if (!requestIdRef.current) requestIdRef.current = crypto.randomUUID();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/brand-workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'project.create',
          input: {
            organizationId,
            requestId: requestIdRef.current,
            title: draft.title.trim().slice(0, 120),
            objective: objectiveFromIntakeBrief(intakeBrief),
            audience: '',
            budgetKrw: budgetKrwFromIntakeBand(intakeBrief.budgetBand),
            budgetTaxBasis: 'unspecified',
            startsOn: intakeBrief.schedule.startsOn,
            endsOn: intakeBrief.schedule.dueOn,
            productionMode: productionModeForIntakeTrack(intakeBrief.track),
            referenceLinks: cleanReferences,
            intakeBrief,
          },
        }),
      });
      const result = (await response.json().catch(() => null)) as { ok?: boolean; id?: string } | null;
      if (!response.ok || !result?.ok || !result.id) {
        setError(copy.errors.submitFailed);
        setSubmitting(false);
        return;
      }

      const projectId = result.id;
      const uploadedIds: string[] = [];
      for (const file of files) {
        const attId = await uploadWorkspaceAttachment(projectId, file).catch(() => null);
        if (attId) uploadedIds.push(attId);
      }
      if (uploadedIds.length > 0) {
        await fetch('/api/brand-workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'intake.attachFiles',
            input: { projectId, attachmentIds: uploadedIds },
          }),
        }).catch(() => {});
      }

      if (typeof window !== 'undefined') {
        try {
          window.localStorage.removeItem(storageKey);
        } catch {}
      }
      router.push(`/brand/rooms/${projectId}?organizationId=${encodeURIComponent(organizationId)}`);
      router.refresh();
    } catch {
      setError(copy.errors.submitFailed);
      setSubmitting(false);
    }
  };

  const toggleRatio = (ratio: IntakeAspectRatio) => {
    update(
      'aspectRatios',
      draft.aspectRatios.includes(ratio)
        ? draft.aspectRatios.filter((r) => r !== ratio)
        : [...draft.aspectRatios, ratio],
    );
  };

  const toggleChannel = (channel: IntakeChannel) => {
    update(
      'channels',
      draft.channels.includes(channel)
        ? draft.channels.filter((c) => c !== channel)
        : [...draft.channels, channel],
    );
  };

  const toggleAsset = (assetId: string) => {
    update(
      'studioAssetIds',
      draft.studioAssetIds.includes(assetId)
        ? draft.studioAssetIds.filter((id) => id !== assetId)
        : [...draft.studioAssetIds, assetId],
    );
  };

  return (
    <div className={styles.wizard} data-project-intake data-intake-step={draft.step} data-wizard-organization={organizationId}>
      <div className={styles.topBar}>
        <nav className={styles.stepNav} aria-label={copy.stepsLabel}>
          <ol className={styles.stepList}>
            {STEP_ORDER.map((key) => {
              const active = draft.step === key;
              return (
                <li key={key} data-current={active ? 'true' : undefined}>
                  <button
                    type="button"
                    className={`${styles.stepButton}${active ? ` ${styles.stepButtonActive}` : ''}`}
                    aria-current={active ? 'step' : undefined}
                    onClick={() => goStep(key)}
                    data-intake-step-tab={key}
                  >
                    {copy.steps[key]}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        {hasSavedDraft ? (
          <div className="bw-row" data-intake-draft-status>
            <span className="bw-muted">{copy.draftSaved}</span>
            <button type="button" className="bw-button" onClick={clearSavedDraft} data-intake-clear-draft>
              {copy.clearDraft}
            </button>
          </div>
        ) : null}
      </div>

      {organizations.length > 1 ? (
        <div className="bw-panel bw-form">
          <label>
            {copy.fields.organization}
            <select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {draft.step === 'what' ? (
        <section className="bw-panel bw-form" data-intake-panel="what">
          <fieldset className="bw-fieldset">
            <legend>{copy.tracksLabel}</legend>
            <div className={styles.trackGrid} role="radiogroup" aria-label={copy.tracksLabel}>
              {availableTracks.map((trackId) => {
                const active = draft.track === trackId;
                return (
                  <button
                    key={trackId}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`${styles.trackCard}${active ? ` ${styles.trackCardActive}` : ''}`}
                    data-active={active ? 'true' : undefined}
                    data-intake-track={trackId}
                    onClick={() => update('track', trackId)}
                  >
                    <h3 className={styles.trackCardTitle}>{copy.tracks[trackId].title}</h3>
                    <p className={styles.trackCardLine}>{copy.tracks[trackId].line}</p>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <label>
            {copy.fields.projectTitle}
            <input
              value={draft.title}
              minLength={3}
              maxLength={120}
              placeholder={copy.fields.projectTitlePlaceholder}
              onChange={(e) => update('title', e.target.value)}
              data-intake-title
            />
          </label>

          <label>
            {copy.fields.summary}
            <textarea
              rows={3}
              maxLength={500}
              value={draft.summary}
              placeholder={copy.fields.summaryPlaceholder}
              onChange={(e) => update('summary', e.target.value)}
              data-intake-summary
            />
          </label>

          <div className={styles.actions}>
            <span />
            <button type="button" className="bw-button bw-primary" onClick={() => goStep('materials')} data-intake-next>
              {copy.actions.next}
            </button>
          </div>
        </section>
      ) : null}

      {draft.step === 'materials' ? (
        <section className="bw-panel bw-form" data-intake-panel="materials">
          <div
            className={styles.dropzone}
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              const dropped = Array.from(e.dataTransfer.files);
              if (dropped.length) void handlePickedFiles(dropped);
            }}
            data-intake-dropzone
          >
            <strong>{copy.fields.briefFiles}</strong>
            <p className="bw-muted">{copy.fields.briefFilesHint}</p>
            <div className="bw-row" style={{ marginTop: '0.75rem' }}>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                accept=".pdf,.pptx,.docx,.hwpx,.txt,.md,.csv,image/png,image/jpeg,image/webp,video/mp4,application/pdf"
                onChange={(e) => {
                  const picked = e.target.files ? Array.from(e.target.files) : [];
                  e.target.value = '';
                  if (picked.length) void handlePickedFiles(picked);
                }}
                data-intake-file-input
              />
              <button type="button" className="bw-button" onClick={() => fileInputRef.current?.click()}>
                {copy.fields.chooseFiles}
              </button>
              {(files.length > 0 || draft.briefText.trim().length > 0) ? (
                <button
                  type="button"
                  className="bw-button bw-primary"
                  disabled={autofillBusy}
                  onClick={runManualAutofill}
                  data-intake-autofill
                >
                  {autofillBusy ? copy.fields.autofilling : copy.fields.autofillFromBrief}
                </button>
              ) : null}
            </div>

            {files.length > 0 ? (
              <ul className="bw-list" style={{ marginTop: '0.75rem' }} data-intake-file-list>
                {files.map((file, idx) => (
                  <li key={`${file.name}-${idx}`} className="bw-row">
                    <span>{file.name}</span>
                    <button
                      type="button"
                      className="bw-button"
                      onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      {copy.fields.removeFile}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {autofillMessage ? (
              <p className="bw-note" role="status" style={{ marginTop: '0.75rem' }} data-intake-autofill-notice>
                {autofillMessage}
              </p>
            ) : null}
          </div>

          <label>
            {copy.fields.briefText}
            <textarea
              rows={6}
              maxLength={8000}
              value={draft.briefText}
              placeholder={copy.fields.briefTextPlaceholder}
              onChange={(e) => update('briefText', e.target.value)}
              data-intake-brief-text
            />
          </label>

          <fieldset className="bw-fieldset">
            <legend>{copy.fields.referenceLinks}</legend>
            {draft.references.map((ref, idx) => (
              <div key={idx} className="bw-grid" style={{ marginBottom: '0.5rem' }}>
                <input
                  type="url"
                  value={ref.url}
                  placeholder={copy.fields.referenceUrlPlaceholder}
                  onChange={(e) => {
                    const next = [...draft.references];
                    next[idx] = { ...next[idx]!, url: e.target.value };
                    update('references', next);
                  }}
                  data-intake-ref-url={idx}
                />
                <input
                  value={ref.note}
                  maxLength={500}
                  placeholder={copy.fields.referenceNotePlaceholder}
                  onChange={(e) => {
                    const next = [...draft.references];
                    next[idx] = { ...next[idx]!, note: e.target.value };
                    update('references', next);
                  }}
                />
              </div>
            ))}
            {draft.references.length < 10 ? (
              <button
                type="button"
                className="bw-button"
                onClick={() => update('references', [...draft.references, { url: '', note: '' }])}
              >
                {copy.fields.addReference}
              </button>
            ) : null}
          </fieldset>

          <fieldset className="bw-fieldset" data-intake-studio-assets>
            <legend>{copy.fields.studioAssets}</legend>
            <p className="bw-muted">{copy.fields.studioAssetsHint}</p>
            {studioAssets.length === 0 ? (
              <p className="bw-muted">{copy.fields.studioAssetsEmpty}</p>
            ) : (
              <div className={styles.chipGroup} role="group" aria-label={copy.fields.studioAssets}>
                {studioAssets.slice(0, 24).map((asset) => {
                  const selected = draft.studioAssetIds.includes(asset.id);
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      className={`${styles.chip}${selected ? ` ${styles.chipSelected}` : ''}`}
                      aria-pressed={selected}
                      onClick={() => toggleAsset(asset.id)}
                      data-intake-asset-pick={asset.id}
                    >
                      {asset.name}
                    </button>
                  );
                })}
              </div>
            )}
          </fieldset>

          <div className={styles.actions}>
            <button type="button" className="bw-button" onClick={() => goStep('what')}>
              {copy.actions.prev}
            </button>
            <button type="button" className="bw-button bw-primary" onClick={() => goStep('terms')} data-intake-next>
              {copy.actions.next}
            </button>
          </div>
        </section>
      ) : null}

      {draft.step === 'terms' ? (
        <section className="bw-panel bw-form" data-intake-panel="terms">
          <div className="bw-grid">
            <label>
              {copy.fields.deliverableKind}
              <input
                value={draft.deliverableKind}
                maxLength={120}
                placeholder={copy.fields.deliverableKindPlaceholder}
                onChange={(e) => update('deliverableKind', e.target.value)}
                data-intake-deliverable-kind
              />
            </label>
            <label>
              {copy.fields.duration}
              <input
                value={draft.duration}
                maxLength={60}
                placeholder={copy.fields.durationPlaceholder}
                onChange={(e) => update('duration', e.target.value)}
                data-intake-duration
              />
            </label>
            <label>
              {copy.fields.quantity}
              <input
                type="number"
                min={1}
                max={500}
                value={draft.quantity}
                placeholder={copy.fields.quantityPlaceholder}
                onChange={(e) => update('quantity', e.target.value)}
                data-intake-quantity
              />
            </label>
          </div>

          <fieldset className="bw-fieldset">
            <legend>{copy.fields.aspectRatios}</legend>
            <div className={styles.chipGroup}>
              {INTAKE_ASPECT_RATIOS.map((ratio) => {
                const selected = draft.aspectRatios.includes(ratio);
                return (
                  <button
                    key={ratio}
                    type="button"
                    className={`${styles.chip}${selected ? ` ${styles.chipSelected}` : ''}`}
                    aria-pressed={selected}
                    onClick={() => toggleRatio(ratio)}
                    data-intake-ratio={ratio}
                  >
                    {ratioText(copy, ratio)}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="bw-fieldset">
            <legend>{copy.fields.channels}</legend>
            <div className={styles.chipGroup}>
              {INTAKE_CHANNELS.map((channel) => {
                const selected = draft.channels.includes(channel);
                return (
                  <button
                    key={channel}
                    type="button"
                    className={`${styles.chip}${selected ? ` ${styles.chipSelected}` : ''}`}
                    aria-pressed={selected}
                    onClick={() => toggleChannel(channel)}
                    data-intake-channel={channel}
                  >
                    {copy.channels[channel]}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="bw-grid">
            <label>
              {copy.fields.startsOn}
              <input
                type="date"
                value={draft.startsOn}
                onChange={(e) => update('startsOn', e.target.value)}
                data-intake-starts-on
              />
            </label>
            <label>
              {copy.fields.dueOn}
              <input
                type="date"
                value={draft.dueOn}
                onChange={(e) => update('dueOn', e.target.value)}
                data-intake-due-on
              />
            </label>
          </div>

          <fieldset className="bw-fieldset" data-intake-budget-group>
            <legend>{copy.fields.budgetBand}</legend>
            <div className={styles.chipGroup} role="radiogroup" aria-label={copy.fields.budgetBand}>
              {INTAKE_BUDGET_BANDS.map((band) => {
                const active = draft.budgetBand === band;
                return (
                  <button
                    key={band}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`${styles.chip}${active ? ` ${styles.chipSelected}` : ''}`}
                    aria-pressed={active}
                    onClick={() => update('budgetBand', band)}
                    data-intake-budget={band}
                  >
                    {copy.budgets[band]}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="bw-grid">
            <label>
              {copy.fields.contactName}
              <input
                value={draft.contactName}
                maxLength={80}
                placeholder={copy.fields.contactNamePlaceholder}
                onChange={(e) => update('contactName', e.target.value)}
                data-intake-contact-name
              />
            </label>
            <label>
              {copy.fields.contactChannel}
              <select
                value={draft.contactChannel}
                onChange={(e) => update('contactChannel', e.target.value as IntakeContactChannel)}
                data-intake-contact-channel
              >
                {INTAKE_CONTACT_CHANNELS.map((ch) => (
                  <option key={ch} value={ch}>
                    {copy.contactChannels[ch]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {copy.fields.contactValue}
              <input
                value={draft.contactValue}
                maxLength={160}
                placeholder={copy.fields.contactValuePlaceholder}
                onChange={(e) => update('contactValue', e.target.value)}
                data-intake-contact-value
              />
            </label>
            <label>
              {copy.fields.approver}
              <input
                value={draft.approver}
                maxLength={120}
                placeholder={copy.fields.approverPlaceholder}
                onChange={(e) => update('approver', e.target.value)}
                data-intake-approver
              />
            </label>
          </div>

          <div className={styles.actions}>
            <button type="button" className="bw-button" onClick={() => goStep('materials')}>
              {copy.actions.prev}
            </button>
            <button
              type="button"
              className="bw-button bw-primary"
              disabled={submitting}
              onClick={() => void submitBrief()}
              data-intake-submit
            >
              {submitting ? copy.actions.submitting : copy.actions.submit}
            </button>
          </div>
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="bw-error" data-intake-error>
          {error}
        </p>
      ) : null}
    </div>
  );
}
