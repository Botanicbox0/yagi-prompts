import { BUTTON_PRIMARY, Field, INPUT, OpForm, Panel } from '@/components/admin/chrome';
import { readOriginalPostRefusal, type OriginalPostView } from '@/lib/creator-platform/original-post';
import type { Dictionary } from '@/lib/i18n/dictionaries';

function isSafeHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Admin template page panel for editing `platform_formats.example_url` on the studio's own
 * company-payout formats (`format.setOriginalPost`). Admin-only; never exposed on buyer surfaces.
 */
export function OriginalPostPanel({
  op,
  templateId,
  view,
  dict,
  back,
  detail,
}: {
  op: 'format.setOriginalPost';
  templateId: string;
  view: OriginalPostView;
  dict: Dictionary;
  back: string;
  detail?: string | null;
}) {
  const c = dict.admin.originalPost;
  const refusal = readOriginalPostRefusal(detail);
  const refusals = c.refusals as Readonly<Record<string, string>>;
  const sentence = refusal ? (refusals[refusal] ?? c.refusals.input) : null;

  return (
    <Panel title={c.heading}>
      <div data-original-post-panel className="flex flex-col gap-3">
        {sentence && (
          <div data-original-post-refusal={refusal!} role="status" className="font-mono text-[0.75rem]">
            <p>{sentence}</p>
          </div>
        )}
        <p data-original-post-current className="font-mono text-[0.75rem]">
          <span className="opacity-70">{c.current}: </span>
          {view.exampleUrl ? (
            isSafeHttpUrl(view.exampleUrl) ? (
              <a
                href={view.exampleUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-accent break-all underline underline-offset-4"
              >
                {view.exampleUrl} ↗
              </a>
            ) : (
              <span className="break-all">{view.exampleUrl}</span>
            )
          ) : (
            <span className="opacity-60">{c.currentEmpty}</span>
          )}
        </p>
        <p data-original-post-status={view.status} className="font-mono text-[0.72rem] opacity-70">
          {c.statusLabel}: {c.status[view.status]}
        </p>
        <OpForm op={op} back={back} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={templateId} />
          <Field label={c.fieldLabel} hint={c.fieldHint}>
            <input
              type="url"
              name="url"
              inputMode="url"
              maxLength={2048}
              defaultValue={view.exampleUrl ?? ''}
              placeholder={c.placeholder}
              className={INPUT}
            />
          </Field>
          <div>
            <button type="submit" className={BUTTON_PRIMARY} data-original-post-save>
              {c.save}
            </button>
          </div>
        </OpForm>
      </div>
    </Panel>
  );
}
