import type { DefaultPolicy } from '@/lib/content/visibility';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { formatDate, interpolate, localize } from '@/lib/i18n/format';
import type { AdminEditor, AdminRevision } from '@/lib/admin/repo';
import { buildVisibilityTable } from '@/lib/admin/visibility-table';
import { adminMediaPath } from '@/lib/media/admin-authorize';
import { heroRef } from '@/lib/content/media-ref';
import { VisibilitySelect } from './block-forms';
import { BUTTON, BUTTON_PRIMARY, Field, INPUT, LABEL, LocalePair, OpForm, Panel } from './chrome';
import { CATEGORIES, DIFFICULTIES, categoryLabel, difficultyLabel, kindLabel, visibilityLabel } from './labels';

/**
 * The editor's panels: revision banner, metadata, hero, effective-visibility table, publish.
 * All server components; every mutation is a form posting to the one guarded action.
 */

type AdminDict = Dictionary['admin'];

// ---------------------------------------------------------------------------
// revision banner (§3.8 "which revision you're editing, its state, published pointer")
// ---------------------------------------------------------------------------

export function RevisionBanner({
  dict,
  editor,
  locale,
  back,
}: {
  dict: Dictionary;
  editor: AdminEditor;
  locale: string;
  back: string;
}) {
  const a = dict.admin;
  const stateLabel = (state: AdminRevision['state']) =>
    state === 'published' ? a.statePublished : state === 'superseded' ? a.stateSuperseded : a.stateDraft;

  return (
    <div className="mt-6 border border-accent px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="font-mono text-code">
          <p className="text-accent">
            {editor.draft === null
              ? a.noDraft
              : interpolate(a.revisionEditing, { n: editor.draft.revNo })}
            {editor.draft && (
              <span className="opacity-60">
                {' · '}
                {a.revisionState}: {stateLabel(editor.draft.state)}
              </span>
            )}
          </p>
          <p className="mt-1 opacity-60">
            {editor.published === null
              ? a.liveNone
              : `${interpolate(a.liveRevision, { n: editor.published.revNo })} · ${
                  formatDate(editor.published.publishedAt, locale) ?? '—'
                }`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {editor.draft === null && editor.published !== null && (
            <OpForm op="revision.openDraft" back={back}>
              <input type="hidden" name="playbookId" value={editor.playbook.id} />
              <button type="submit" className={BUTTON_PRIMARY}>
                {a.editPublished}
              </button>
            </OpForm>
          )}
          {editor.draft !== null && editor.published !== null && (
            <OpForm op="revision.discardDraft" back={back}>
              <input type="hidden" name="revisionId" value={editor.draft.id} />
              <button type="submit" className={BUTTON}>
                {a.discardDraft}
              </button>
            </OpForm>
          )}
        </div>
      </div>
      {editor.draft === null && editor.published !== null && (
        <p className="mt-2 font-mono text-[0.72rem] opacity-50">{a.editPublishedHint}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// metadata (§3.8 dual-locale side-by-side)
// ---------------------------------------------------------------------------

export function MetadataForm({
  dict,
  editor,
  revision,
  back,
}: {
  dict: Dictionary;
  editor: AdminEditor;
  revision: AdminRevision;
  back: string;
}) {
  const a = dict.admin;
  return (
    <Panel title={a.editorMetadata}>
      <OpForm op="revision.metadata" back={back} className="grid gap-5">
        <input type="hidden" name="revisionId" value={revision.id} />

        <LocalePair label={a.fieldTitle} name="title" value={revision.title} />
        <LocalePair label={a.fieldSummary} name="summary" value={revision.summary} multiline />
        <LocalePair
          label={a.fieldChangeNote}
          name="changeNote"
          value={revision.changeNote}
          hint={a.changeNoteHint}
          multiline
          rows={2}
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={a.fieldCategory}>
            <select name="category" defaultValue={editor.playbook.category} className={INPUT}>
              {CATEGORIES.map((key) => (
                <option key={key} value={key}>
                  {categoryLabel(dict, key)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={a.fieldDifficulty}>
            <select name="difficulty" defaultValue={revision.difficulty} className={INPUT}>
              {DIFFICULTIES.map((key) => (
                <option key={key} value={key}>
                  {difficultyLabel(dict, key)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={a.fieldEstTime}>
            <input
              type="number"
              min="1"
              name="estTimeMin"
              defaultValue={revision.estTimeMin ?? ''}
              className={INPUT}
            />
          </Field>
          <Field label={a.fieldEstCost}>
            <input
              type="number"
              min="0"
              step="0.01"
              name="estCostUsd"
              defaultValue={revision.estCostUsd ?? ''}
              className={INPUT}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={a.fieldTools} hint={a.tagsHint}>
            <input type="text" name="tools" defaultValue={revision.tools.join(', ')} className={INPUT} />
          </Field>
          <Field label={a.fieldModels} hint={a.tagsHint}>
            <input type="text" name="models" defaultValue={revision.models.join(', ')} className={INPUT} />
          </Field>
        </div>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="isShowcase"
            defaultChecked={revision.isShowcase}
            className="mt-1"
          />
          <span>
            <span className={LABEL}>{a.fieldShowcase}</span>
            {/* §6 disclosure doctrine, stated where the decision is made. */}
            <span className="mt-1 block max-w-detail font-mono text-[0.72rem] opacity-50">
              {a.showcaseHint}
            </span>
          </span>
        </label>

        <div>
          <button type="submit" className={BUTTON_PRIMARY}>
            {a.editorSave}
          </button>
        </div>
      </OpForm>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// hero
// ---------------------------------------------------------------------------

export function HeroPanel({
  dict,
  revision,
  back,
}: {
  dict: Dictionary;
  revision: AdminRevision;
  back: string;
}) {
  const a = dict.admin;
  const hero = revision.hero;
  return (
    <Panel title={a.heroHeading}>
      {hero === null ? (
        <p className="font-mono text-code opacity-60">{a.heroNone}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          {hero.mime.startsWith('video/') ? (
            <video
              src={adminMediaPath(heroRef(revision.id))}
              className="w-full border border-hairline"
              controls
              muted
              playsInline
              preload="metadata"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- admin preview path, no loader
            <img
              src={adminMediaPath(heroRef(revision.id))}
              alt=""
              className="aspect-16/9 w-full border border-hairline object-cover"
            />
          )}
          <dl className="font-mono text-[0.75rem] opacity-60">
            <dt className="opacity-70">mime</dt>
            <dd>{hero.mime}</dd>
            <dt className="mt-2 opacity-70">sha256</dt>
            <dd className="break-all">{hero.sha256}</dd>
            <dt className="mt-2 opacity-70">staging</dt>
            <dd className="break-all">{hero.staging_key}</dd>
          </dl>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-hairline pt-4">
        <OpForm op="revision.hero" back={back} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="revisionId" value={revision.id} />
          <label className="block">
            <span className={LABEL}>{hero === null ? a.heroUpload : a.heroReplace}</span>
            <input type="file" name="file" className={`${INPUT} mt-1.5`} />
          </label>
          <button type="submit" className={BUTTON_PRIMARY}>
            {a.editorSave}
          </button>
        </OpForm>
        {hero !== null && (
          <OpForm op="revision.heroClear" back={back}>
            <input type="hidden" name="revisionId" value={revision.id} />
            <button type="submit" className={BUTTON}>
              {a.heroClear}
            </button>
          </OpForm>
        )}
      </div>
      <p className="mt-2 font-mono text-[0.72rem] opacity-50">{a.heroHint}</p>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// effective-visibility table — THE §3.8 mechanic
// ---------------------------------------------------------------------------

export function VisibilityTable({
  dict,
  revision,
  policy,
  locale,
  back,
}: {
  dict: Dictionary;
  revision: AdminRevision;
  policy: DefaultPolicy;
  locale: string;
  back: string;
}) {
  const a = dict.admin;
  const rows = buildVisibilityTable(revision, policy);
  const anyStamped = rows.some((row) => row.stamped);

  return (
    <Panel title={a.visibilityHeading}>
      <p className="max-w-detail font-mono text-code opacity-60">{a.visibilityLede}</p>
      <p className="mt-1 font-mono text-[0.72rem] opacity-50">
        {anyStamped ? a.stampedNote : a.unstampedNote}
      </p>

      {rows.length === 0 ? (
        <p className="mt-4 font-mono text-code opacity-60">{a.visibilityEmpty}</p>
      ) : (
        <OpForm op="revision.overrides" back={back} className="mt-4">
          <input type="hidden" name="revisionId" value={revision.id} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-left">
              <thead>
                <tr className="font-label text-[0.68rem] uppercase tracking-[0.12em] opacity-50">
                  <th className="border-b border-hairline py-2 pr-4">{a.colBlock}</th>
                  <th className="border-b border-hairline py-2 pr-4">{a.colKind}</th>
                  <th className="border-b border-hairline py-2 pr-4">{a.colDefault}</th>
                  <th className="border-b border-hairline py-2 pr-4">{a.colOverride}</th>
                  <th className="border-b border-hairline py-2">{a.colEffective}</th>
                </tr>
              </thead>
              <tbody className="font-mono text-code">
                {rows.map((row) => (
                  <tr key={row.blockId} data-visibility-row={row.blockId}>
                    <td className="border-b border-hairline py-2 pr-4">
                      <a href={`#block-${row.blockId}`} className="text-accent">
                        {row.label}
                      </a>
                      <span className="ml-2 opacity-50">{localize(row.stepTitle, locale)}</span>
                    </td>
                    <td className="border-b border-hairline py-2 pr-4 opacity-70">
                      {kindLabel(dict, row.kind)}
                    </td>
                    <td className="border-b border-hairline py-2 pr-4 opacity-70">
                      {visibilityLabel(a, row.defaultVisibility)}
                    </td>
                    <td className="border-b border-hairline py-2 pr-4">
                      <VisibilitySelect
                        dict={a}
                        value={row.override}
                        name={`v:${row.blockId}`}
                        effectiveDefault={row.defaultVisibility}
                      />
                    </td>
                    <td
                      className="border-b border-hairline py-2"
                      data-effective={row.effective}
                      data-stamped={row.stamped ? 'true' : 'false'}
                    >
                      {visibilityLabel(a, row.effective)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4">
            <button type="submit" className={BUTTON_PRIMARY}>
              {a.applyOverrides}
            </button>
          </div>
        </OpForm>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// preview + publish
// ---------------------------------------------------------------------------

export function PreviewPanel({
  dict,
  playbookId,
  hasSteps,
}: {
  dict: AdminDict;
  playbookId: string;
  hasSteps: boolean;
}) {
  const tiers: Array<[string, string]> = [
    ['visitor', dict.previewVisitor],
    ['free', dict.previewFree],
    ['pro', dict.previewPro],
  ];
  return (
    <Panel title={dict.previewHeading}>
      {hasSteps ? (
        <div className="flex flex-wrap items-center gap-2">
          {tiers.map(([tier, label]) => (
            <a key={tier} href={`/admin/p/${playbookId}/preview?tier=${tier}`} className={BUTTON}>
              {label}
            </a>
          ))}
        </div>
      ) : (
        <p className="font-mono text-code opacity-60">{dict.previewMissing}</p>
      )}
      <p className="mt-3 max-w-detail font-mono text-[0.72rem] opacity-50">
        {dict.previewApproximation}
      </p>
    </Panel>
  );
}

export function PublishPanel({
  dict,
  editor,
  revision,
  back,
}: {
  dict: AdminDict;
  editor: AdminEditor;
  revision: AdminRevision;
  back: string;
}) {
  const { manifest } = editor;
  const manifestLine =
    manifest.total === 0
      ? dict.manifestEmpty
      : manifest.pending === 0
        ? interpolate(dict.manifestReady, { total: manifest.total })
        : interpolate(dict.manifestPending, {
            pending: manifest.pending,
            total: manifest.total,
          });
  const prepared = manifest.total > 0 && manifest.pending === 0;

  return (
    <Panel title={dict.publishHeading}>
      <p className="font-mono text-code opacity-60">{manifestLine}</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <OpForm op="revision.prepare" back={back}>
            <input type="hidden" name="revisionId" value={revision.id} />
            <button type="submit" className={BUTTON}>
              {dict.publishPrepare}
            </button>
          </OpForm>
          <p className="mt-2 font-mono text-[0.72rem] opacity-50">{dict.publishPrepareHint}</p>
        </div>

        <div>
          <OpForm op="revision.publish" back={back}>
            <input type="hidden" name="playbookId" value={editor.playbook.id} />
            <input type="hidden" name="revisionId" value={revision.id} />
            <input type="hidden" name="mode" value="full" />
            <button type="submit" className={BUTTON_PRIMARY}>
              {dict.publishRun}
            </button>
          </OpForm>
          <p className="mt-2 font-mono text-[0.72rem] opacity-50">{dict.publishRunHint}</p>
        </div>

        {prepared && (
          <div>
            <OpForm op="revision.publish" back={back}>
              <input type="hidden" name="playbookId" value={editor.playbook.id} />
              <input type="hidden" name="revisionId" value={revision.id} />
              <input type="hidden" name="mode" value="commit" />
              <button type="submit" className={BUTTON}>
                {dict.publishCommit}
              </button>
            </OpForm>
            <p className="mt-2 font-mono text-[0.72rem] opacity-50">{dict.publishCommitHint}</p>
          </div>
        )}
      </div>

      {/* §3.5: no notification control exists before M5, and the panel says why. */}
      <p className="mt-5 border-t border-hairline pt-3 font-mono text-[0.72rem] opacity-50">
        {dict.notificationsNote}
      </p>
    </Panel>
  );
}
