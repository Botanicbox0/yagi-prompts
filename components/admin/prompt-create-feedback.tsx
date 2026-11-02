'use client';

import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { USE_CASE_MAX, USE_CASE_MIN } from '@/lib/prompts/schemas';

type Labels = {
  useCase: string; poster: string; invalid: string; upload: string;
  session: string; uncertain: string; retained: string; publishing: string;
};

/** Keep field values, files and upload receipts on refusal, without browser storage.
 * Without JS, OpForm remains a normal POST through the same guarded registry.
 */
export function PromptCreateFeedback({ children, labels }: { children: ReactNode; labels: Labels }) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const alertRef = useRef<HTMLDivElement>(null);

  function showError(message: string) {
    setError(message);
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
        window.location.assign(result.to);
        return;
      }
      if (result.ok === false) {
        showError(result.field === 'useCase' ? labels.useCase : result.field === 'poster' ? labels.poster
          : result.code === 'upload' ? labels.upload : result.code === 'invalid' ? labels.invalid : labels.uncertain);
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
    <div onSubmit={submit}>
      {error && <div ref={alertRef} role="alert" tabIndex={-1} className="mb-4 border border-accent p-3 font-mono text-[0.75rem]">
        <p>{error}</p><p className="mt-1 opacity-60">{labels.retained}</p>
      </div>}
      {pending && <p role="status" className="mb-3 font-mono text-[0.75rem]">{labels.publishing}</p>}
      <fieldset disabled={pending} className="min-w-0 border-0 p-0" aria-busy={pending}>{children}</fieldset>
    </div>
  );
}
