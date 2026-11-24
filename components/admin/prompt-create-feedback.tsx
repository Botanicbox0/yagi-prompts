'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { USE_CASE_MAX, USE_CASE_MIN } from '@/lib/prompts/schemas';
import {
  clearPromptDraft,
  hasMeaningfulDraft,
  loadPromptDraft,
  savePromptDraft,
  type PromptDraft,
} from '@/lib/admin/prompt-draft';
import { lockRefusalLines, type LockRefusalCopy, type LockRefusalLines } from '@/lib/template-director/locks';

type Labels = {
  useCase: string;
  poster: string;
  invalid: string;
  upload: string;
  session: string;
  uncertain: string;
  retained: string;
  publishing: string;
  draftRestored?: string;
  draftDiscard?: string;
  draftSavedAt?: string;
  /** docs/PERSONAL-STUDIO.md §3.3 (C3): the sentences a lock-block refusal is said in (`lockRefusalCopy`). */
  lockCopy?: LockRefusalCopy;
};

/**
 * What a refused create says. A lock-block refusal (`/admin/do` hands its reason back on the prompt field) is said in
 * the same sentences as on the template's page; every other answer keeps its one line.
 */
export function refusalMessage(
  result: { ok?: unknown; code?: unknown; field?: unknown; detail?: unknown },
  labels: Labels,
): { message: string; lock: LockRefusalLines | null } {
  if (result.field === 'promptText' && typeof result.detail === 'string' && labels.lockCopy) {
    const lock = lockRefusalLines(result.detail, labels.lockCopy);
    if (lock !== null) return { message: lock.title, lock };
  }
  const message =
    result.field === 'useCase' ? labels.useCase
      : result.field === 'poster' ? labels.poster
        : result.code === 'upload' ? labels.upload
          : result.code === 'invalid' ? labels.invalid
            : labels.uncertain;
  return { message, lock: null };
}

/** A lock-block refusal: which lines, what is wrong, the first offending line, and how a block is written. */
export function LockRefusalNotice({ lines, className }: { lines: LockRefusalLines; className?: string }) {
  return (
    <div data-refused-field="promptText" data-lock-refusal className={className}>
      <p className="font-medium">{lines.title}</p>
      <ul className="mt-1.5 list-disc pl-5">
        {lines.items.map((item, index) => (
          <li key={`${index}-${item}`}>
            {item}
            {index === 0 && lines.text && <span className="block font-mono text-[12px] break-words opacity-80">{lines.text}</span>}
          </li>
        ))}
      </ul>
      <p className="mt-1.5">{lines.rules}</p>
    </div>
  );
}

function formatIsoTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('ko-KR', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function restoreFormFromDraft(form: HTMLFormElement, draft: PromptDraft) {
  const setVal = (name: string, val: string) => {
    const el = form.elements.namedItem(name);
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.value = val;
    }
  };

  if (draft.title) setVal('title', draft.title);
  if (draft.titleKo) setVal('titleKo', draft.titleKo);
  if (draft.promptText) setVal('promptText', draft.promptText);
  if (draft.sourceUrl) setVal('sourceUrl', draft.sourceUrl);
  if (draft.processMd) setVal('processMd', draft.processMd);
  if (draft.processMdKo) setVal('processMdKo', draft.processMdKo);

  if (draft.models && draft.models.length > 0) {
    const modelEls = form.querySelectorAll<HTMLInputElement>('input[name="models"]');
    modelEls.forEach((cb) => {
      cb.checked = draft.models.includes(cb.value);
    });
  }

  if (draft.useCase && draft.useCase.length > 0) {
    const useCaseEls = form.querySelectorAll<HTMLInputElement>('input[name="useCase"]');
    useCaseEls.forEach((cb) => {
      cb.checked = draft.useCase.includes(cb.value);
    });
  }

  if (draft.videoRef) setVal('videoRef', draft.videoRef);
  if (draft.posterRef) setVal('posterRef', draft.posterRef);
  if (draft.audioRef) setVal('audioRef', draft.audioRef);
}

function extractDraftFromForm(form: HTMLFormElement): PromptDraft {
  const getVal = (name: string) => {
    const el = form.elements.namedItem(name);
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return el.value;
    }
    return '';
  };
  const getChecked = (name: string) => {
    const els = form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`);
    return Array.from(els).map((el) => el.value);
  };

  return {
    version: 1,
    savedAt: new Date().toISOString(),
    title: getVal('title'),
    titleKo: getVal('titleKo'),
    promptText: getVal('promptText'),
    models: getChecked('models'),
    useCase: getChecked('useCase'),
    sourceUrl: getVal('sourceUrl'),
    processMd: getVal('processMd'),
    processMdKo: getVal('processMdKo'),
    videoRef: getVal('videoRef'),
    posterRef: getVal('posterRef'),
    audioRef: getVal('audioRef'),
  };
}

/** Keep field values, files and upload receipts on refusal and on accidental reload/leave.
 * Without JS, OpForm remains a normal POST through the same guarded registry.
 */
export function PromptCreateFeedback({ children, labels }: { children: ReactNode; labels: Labels }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [lock, setLock] = useState<LockRefusalLines | null>(null);
  const [restoredTime, setRestoredTime] = useState<string | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  // Restore saved draft on mount
  useEffect(() => {
    try {
      const draft = loadPromptDraft(window.localStorage);
      if (!draft || !hasMeaningfulDraft(draft)) return;
      const form = wrapperRef.current?.querySelector('form');
      if (!form) return;
      restoreFormFromDraft(form, draft);
      setRestoredTime(draft.savedAt ? formatIsoTime(draft.savedAt) : '');
    } catch {
      // private mode or storage blocked
    }
  }, []);

  // Autosave draft on input change
  useEffect(() => {
    const form = wrapperRef.current?.querySelector('form');
    if (!form) return;
    let timer: ReturnType<typeof setTimeout>;

    const handleFormChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          const draft = extractDraftFromForm(form);
          if (hasMeaningfulDraft(draft)) {
            savePromptDraft(window.localStorage, draft);
          }
        } catch {
          // ignore
        }
      }, 300);
    };

    form.addEventListener('input', handleFormChange);
    form.addEventListener('change', handleFormChange);
    return () => {
      clearTimeout(timer);
      form.removeEventListener('input', handleFormChange);
      form.removeEventListener('change', handleFormChange);
    };
  }, []);

  // Guard accidental page reload/back navigation when content exists
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (busy.current) return;
      const form = wrapperRef.current?.querySelector('form');
      if (!form) return;
      const draft = extractDraftFromForm(form);
      if (hasMeaningfulDraft(draft)) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  function discardDraft() {
    try {
      clearPromptDraft(window.localStorage);
      const form = wrapperRef.current?.querySelector('form');
      if (form) {
        form.reset();
        const setVal = (name: string) => {
          const el = form.elements.namedItem(name);
          if (el instanceof HTMLInputElement) el.value = '';
        };
        setVal('videoRef');
        setVal('posterRef');
        setVal('audioRef');
      }
      setRestoredTime(null);
      window.dispatchEvent(new CustomEvent('twings:prompt-draft-clear'));
    } catch {
      // ignore
    }
  }

  function showError(message: string, lockLines: LockRefusalLines | null = null) {
    setError(message);
    setLock(lockLines);
    requestAnimationFrame(() => {
      alertRef.current?.focus();
      alertRef.current?.scrollIntoView({ block: 'nearest' });
    });
  }

  async function submit(event: FormEvent<HTMLDivElement>) {
    // MediaDrop's native listener runs first and may block an unfinished upload.
    if (event.defaultPrevented || !(event.target instanceof HTMLFormElement)) return;
    event.preventDefault();
    if (busy.current) return;
    const form = event.target;
    const body = new FormData(form);
    const uses = body.getAll('useCase').length;
    if (uses < USE_CASE_MIN || uses > USE_CASE_MAX) return showError(labels.useCase);
    const poster = body.get('poster');
    if (!body.get('posterRef') && !(poster instanceof File && poster.size > 0)) return showError(labels.poster);
    busy.current = true;
    setPending(true);
    setError('');
    setLock(null);
    let navigating = false;
    try {
      const response = await fetch(form.action, {
        method: 'POST', body,
        headers: { accept: 'application/vnd.twings.admin-form+json' },
      });
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        showError(labels.session);
        return;
      }
      const result = await response.json();
      if (response.ok && result.ok === true && typeof result.to === 'string' && result.to.startsWith('/admin/')) {
        navigating = true;
        try {
          clearPromptDraft(window.localStorage);
        } catch {
          // ignore
        }
        window.location.assign(result.to);
        return;
      }
      if (result.ok === false) {
        const refusal = refusalMessage(result, labels);
        showError(refusal.message, refusal.lock);
      } else {
        showError(labels.uncertain);
      }
    } catch {
      // A lost response may follow a committed write. Never automatically retry this POST.
      showError(labels.uncertain);
    } finally {
      if (!navigating) {
        busy.current = false;
        setPending(false);
      }
    }
  }

  return (
    <div ref={wrapperRef} onSubmit={submit}>
      {restoredTime && (
        <div
          data-prompt-draft-banner
          className="mb-4 flex flex-wrap items-center justify-between gap-2 border border-accent/60 bg-accent/5 p-3 font-mono text-[0.75rem]"
        >
          <div>
            <p className="font-semibold text-accent">
              {labels.draftRestored ?? '작성 중이던 템플릿 임시저장 내용이 복원되었습니다.'}
            </p>
            <p className="mt-0.5 opacity-60">
              {(labels.draftSavedAt ?? '임시저장 시각: {time}').replace('{time}', restoredTime)}
            </p>
          </div>
          <button
            type="button"
            data-draft-discard
            onClick={discardDraft}
            className="rounded border border-hairline px-2.5 py-1 text-[0.7rem] opacity-75 transition-opacity hover:opacity-100"
          >
            {labels.draftDiscard ?? '임시저장 비우기'}
          </button>
        </div>
      )}
      {error && <div ref={alertRef} role="alert" tabIndex={-1} className="mb-4 border border-accent p-3 font-mono text-[0.75rem]">
        {lock ? <LockRefusalNotice lines={lock} /> : <p>{error}</p>}<p className="mt-1 opacity-60">{labels.retained}</p>
      </div>}
      {pending && <p role="status" className="mb-3 font-mono text-[0.75rem]">{labels.publishing}</p>}
      <fieldset disabled={pending} className="min-w-0 border-0 p-0" aria-busy={pending}>{children}</fieldset>
    </div>
  );
}
