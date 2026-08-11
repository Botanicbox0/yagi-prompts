import {
  AssetRefSchema,
  BLOCK_KINDS,
  type AssetRef,
  type BlockKind,
  type Localized,
} from '@/lib/content/schemas';
import type { Visibility } from '@/lib/content/visibility';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { Markdown } from '@/components/playbook/markdown';
import { BUTTON, BUTTON_PRIMARY, Field, INPUT, LABEL, LocalePair, OpForm } from './chrome';
import { kindLabel, visibilityOptions } from './labels';

/**
 * PLAN §6.1 — "These schemas define the M4 form fields … verbatim — the executor invents nothing."
 *
 * One field set per kind, in the order the contract lists them. The same component renders the ADD
 * form and the EDIT form: a block is created complete (never as a placeholder that would happily
 * publish), and edited through the identical shape. `kind` is never editable — on edit it comes
 * from the row, so a forged field cannot reshape a block into another contract.
 */

type AdminDict = Dictionary['admin'];

// ---------------------------------------------------------------------------
// lenient readers — the editor must be able to open a row it cannot fully parse
// ---------------------------------------------------------------------------

function obj(content: unknown): Record<string, unknown> {
  return content !== null && typeof content === 'object' ? (content as Record<string, unknown>) : {};
}

function readString(content: unknown, key: string): string {
  const value = obj(content)[key];
  return typeof value === 'string' ? value : '';
}

function readLocalized(content: unknown, key: string): Localized | null {
  const value = obj(content)[key];
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return {
    en: typeof record.en === 'string' ? record.en : '',
    ko: typeof record.ko === 'string' ? record.ko : '',
  };
}

function readRows(content: unknown): Array<{ k: string; v: string }> {
  const value = obj(content).rows;
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (row === null || typeof row !== 'object') return [];
    const record = row as Record<string, unknown>;
    return [
      {
        k: typeof record.k === 'string' ? record.k : '',
        v: typeof record.v === 'string' ? record.v : '',
      },
    ];
  });
}

export function readAsset(content: unknown): AssetRef | null {
  const parsedRef = AssetRefSchema.safeParse(obj(content).asset);
  return parsedRef.success ? parsedRef.data : null;
}

/** `content/rev/{id}/{uuid}.png` → `{uuid}.png`; the whole key is noise on a staff screen. */
function keyTail(key: string): string {
  return key.split('/').pop() ?? key;
}

// ---------------------------------------------------------------------------
// per-kind fields
// ---------------------------------------------------------------------------

const PARAM_BLANKS = 3;

function FileField({ dict, asset }: { dict: AdminDict; asset: AssetRef | null }) {
  return (
    <div>
      <span className={LABEL}>{dict.fieldFile}</span>
      <input type="file" name="file" className={`${INPUT} mt-1.5`} />
      <p className="mt-1 font-mono text-[0.72rem] opacity-50">
        {asset === null
          ? dict.fileKeep
          : `${dict.fileCurrent}: ${keyTail(asset.staging_key)} · ${asset.mime} · sha256 ${asset.sha256.slice(0, 12)}…`}
      </p>
    </div>
  );
}

export function BlockFields({
  dict,
  kind,
  content,
}: {
  dict: Dictionary;
  kind: BlockKind;
  content: unknown;
}) {
  const a = dict.admin;

  switch (kind) {
    case 'prompt':
      return (
        <div className="grid gap-4">
          <Field label={a.fieldPromptText} hint={a.promptHint}>
            <textarea
              name="text"
              rows={5}
              required
              defaultValue={readString(content, 'text')}
              className={INPUT}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={a.fieldPromptModel}>
              <input
                type="text"
                name="model"
                defaultValue={readString(content, 'model')}
                className={INPUT}
              />
            </Field>
            <Field label={a.fieldPromptNegative}>
              <input
                type="text"
                name="negative"
                defaultValue={readString(content, 'negative')}
                className={INPUT}
              />
            </Field>
          </div>
        </div>
      );

    case 'params': {
      const existing = readRows(content);
      const slots = [...existing, ...Array.from({ length: PARAM_BLANKS }, () => ({ k: '', v: '' }))];
      return (
        <div>
          <span className={LABEL}>{a.fieldParams}</span>
          <div className="mt-1.5 grid gap-2">
            {slots.map((row, index) => (
              <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
                <input
                  type="text"
                  name="paramKey"
                  defaultValue={row.k}
                  placeholder={a.paramKey}
                  className={INPUT}
                />
                <input
                  type="text"
                  name="paramValue"
                  defaultValue={row.v}
                  placeholder={a.paramValue}
                  className={INPUT}
                />
              </div>
            ))}
          </div>
          <p className="mt-1 font-mono text-[0.72rem] opacity-50">{a.paramsHint}</p>
        </div>
      );
    }

    case 'asset':
      return (
        <div className="grid gap-4">
          <FileField dict={a} asset={readAsset(content)} />
          <LocalePair label={a.fieldCaption} name="caption" value={readLocalized(content, 'caption')} />
        </div>
      );

    case 'note': {
      const md = readLocalized(content, 'md');
      return (
        <div className="grid gap-4">
          <LocalePair label={a.fieldMarkdown} name="md" value={md} multiline rows={6} />
          {md && (md.en !== '' || md.ko !== '') && (
            <div>
              <span className={LABEL}>{a.markdownPreview}</span>
              <div className="mt-1.5 grid gap-4 border border-hairline p-4 sm:grid-cols-2">
                <Markdown source={md.en} />
                <Markdown source={md.ko} />
              </div>
            </div>
          )}
        </div>
      );
    }

    case 'link':
      return (
        <div className="grid gap-4">
          <Field label={a.fieldUrl}>
            <input
              type="url"
              name="url"
              required
              defaultValue={readString(content, 'url')}
              className={INPUT}
            />
          </Field>
          <LocalePair label={a.fieldLabel} name="label" value={readLocalized(content, 'label')} />
        </div>
      );

    case 'workflow_file':
      return (
        <div className="grid gap-4">
          <FileField dict={a} asset={readAsset(content)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={a.fieldFilename}>
              <input
                type="text"
                name="filename"
                defaultValue={readString(content, 'filename')}
                className={INPUT}
              />
            </Field>
            <Field label={a.fieldFormat}>
              <input
                type="text"
                name="format"
                required
                defaultValue={readString(content, 'format')}
                className={INPUT}
              />
            </Field>
          </div>
        </div>
      );
  }
}

// ---------------------------------------------------------------------------
// visibility select (§3.8: inherit → effective default, or an explicit level)
// ---------------------------------------------------------------------------

export function VisibilitySelect({
  dict,
  value,
  name = 'visibility',
  effectiveDefault,
}: {
  dict: AdminDict;
  value: Visibility | null;
  name?: string;
  effectiveDefault?: Visibility;
}) {
  return (
    <select name={name} defaultValue={value ?? ''} className={INPUT}>
      <option value="">
        {effectiveDefault
          ? `${dict.inherit} → ${
              visibilityOptions(dict).find((o) => o.value === effectiveDefault)?.label ?? effectiveDefault
            }`
          : dict.inherit}
      </option>
      {visibilityOptions(dict).map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// add / edit forms
// ---------------------------------------------------------------------------

/** The kind picker is a GET form: it re-renders the page with the right add-form, no JS needed. */
export function AddBlockPicker({
  dict,
  stepId,
  back,
}: {
  dict: Dictionary;
  stepId: string;
  back: string;
}) {
  const a = dict.admin;
  return (
    <form method="get" action={back.split('?')[0]} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="add" value={stepId} />
      <label className="block">
        <span className={LABEL}>{a.addBlock}</span>
        <select name="kind" defaultValue="prompt" className={`${INPUT} mt-1.5`}>
          {BLOCK_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kindLabel(dict, kind)}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className={BUTTON}>
        {a.chooseKind}
      </button>
    </form>
  );
}

export function AddBlockForm({
  dict,
  stepId,
  kind,
  back,
}: {
  dict: Dictionary;
  stepId: string;
  kind: BlockKind;
  back: string;
}) {
  const a = dict.admin;
  return (
    <div className="mt-4 border border-accent p-4">
      <p className="font-label text-eyebrow uppercase text-accent">
        {a.addBlock} · {kindLabel(dict, kind)}
      </p>
      <OpForm op="block.create" back={back} className="mt-4 grid gap-4">
        <input type="hidden" name="stepId" value={stepId} />
        <input type="hidden" name="kind" value={kind} />
        <BlockFields dict={dict} kind={kind} content={null} />
        <Field label={a.colOverride}>
          <VisibilitySelect dict={a} value={null} />
        </Field>
        <div className="flex items-center gap-3">
          <button type="submit" className={BUTTON_PRIMARY}>
            {a.saveBlock}
          </button>
          <a href={back.split('?')[0]} className={BUTTON}>
            {a.cancel}
          </a>
        </div>
      </OpForm>
    </div>
  );
}
