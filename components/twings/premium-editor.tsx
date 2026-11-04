'use client';

import { useId, useState } from 'react';
import { EDIT_SCOPES, MAX_EDIT_REFERENCES, MAX_EDIT_REFERENCE_BYTES, MAX_EDIT_TEXT_LENGTH, type EditScope, type EditValue } from '@/lib/premium-editing/contract';

export interface PremiumEditorValue { editText: string; references: File[]; referencesConsent: boolean }
export interface PremiumEditorCopy {
  title: string; description: string; requestLabel: string; requestPlaceholder: string;
  referencesLabel: string; referencesHelp: string; rightsLabel: string; accuracyNote: string;
  identityNote: string; removeReference: string; limitsError: string;
  scopeLabels: Record<EditScope, string>; valueLabels: Record<EditValue, string>;
}

export function PremiumEditor({ copy, value, onChange, allowedFields = EDIT_SCOPES, disabled = false }: {
  copy: PremiumEditorCopy; value: PremiumEditorValue; onChange: (value: PremiumEditorValue) => void;
  allowedFields?: readonly EditScope[]; disabled?: boolean;
}) {
  const id = useId();
  const [fileError, setFileError] = useState(false);
  return <fieldset data-premium-editor disabled={disabled} className="space-y-4 rounded-[24px] border border-hairline bg-white p-5">
    <legend className="px-2 font-semibold">{copy.title}</legend>
    <p className="text-sm opacity-65">{copy.description}</p>
    <p className="text-sm" data-premium-edit-scopes>{allowedFields.map(scope => copy.scopeLabels[scope]).join(' · ')}</p>
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={`${id}-text`} className="block text-sm font-medium">{copy.requestLabel}</label>
      <span data-premium-char-count className="font-mono text-[11px] tabular-nums opacity-55">
        {value.editText.length}/{MAX_EDIT_TEXT_LENGTH}
      </span>
    </div>
    <textarea id={`${id}-text`} value={value.editText} placeholder={copy.requestPlaceholder} rows={3} maxLength={MAX_EDIT_TEXT_LENGTH}
      aria-describedby={`${id}-accuracy`} onChange={event => onChange({ ...value, editText: event.target.value })}
      className="w-full rounded-[18px] border border-hairline bg-[#F6F7F9]/85 p-3.5 text-sm transition-colors focus:border-[#3875C5] focus:bg-white focus:outline-none" />
    <p id={`${id}-accuracy`} className="text-sm opacity-65">{copy.accuracyNote}</p>
    <label htmlFor={`${id}-references`} className="block text-sm font-medium">{copy.referencesLabel}</label>
    <input id={`${id}-references`} type="file" accept="image/jpeg,image/png,image/webp" multiple aria-describedby={`${id}-reference-help`}
      onChange={event => {
        const files = Array.from(event.target.files ?? []);
        const invalid = files.length > MAX_EDIT_REFERENCES || files.reduce((total, file) => total + file.size, 0) > MAX_EDIT_REFERENCE_BYTES || files.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type));
        setFileError(invalid);
        if (!invalid) onChange({ ...value, references: files, referencesConsent: false });
        event.target.value = '';
      }} className="w-full text-sm" />
    <p id={`${id}-reference-help`} className="text-sm opacity-65">{copy.referencesHelp}</p>
    {fileError && <p role="alert" className="text-sm text-accent">{copy.limitsError}</p>}
    {value.references.length > 0 && <ul className="space-y-2">{value.references.map((file, index) => <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 text-sm">
      <span className="min-w-0 truncate">{file.name}</span>
      <button type="button" aria-label={copy.removeReference.replace('{number}', String(index + 1))} onClick={() => onChange({ ...value, references: value.references.filter((_, i) => i !== index), referencesConsent: false })} className="inline-flex min-h-9 shrink-0 items-center rounded-full border border-hairline px-3 text-xs font-medium underline-offset-4 hover:underline">{copy.removeReference.replace('{number}', String(index + 1))}</button>
    </li>)}</ul>}
    {value.references.length > 0 && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={value.referencesConsent}
      onChange={event => onChange({ ...value, referencesConsent: event.target.checked })} className="mt-1" />{copy.rightsLabel}</label>}
    <p className="text-sm opacity-65">{copy.identityNote}</p>
  </fieldset>;
}
