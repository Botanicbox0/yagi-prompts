"use client";
/**
 * Inline name-only form inside the project picker popover (§4.2).
 * Generates one `requestId` per opened form instance so a double click creates a single project.
 */
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { BRAND_PROJECT_LIMITS } from "@/lib/brand-studio/contracts";
import type { CreateBrandProjectResult } from "./context";
import { createBrandProjectController, type ProjectSpineCopy } from "./model";
import s from "./project-chip.module.css";

export interface NewProjectFormProps {
  copy: ProjectSpineCopy;
  onCreate: (title: string, requestId: string) => Promise<CreateBrandProjectResult>;
  onCreated: () => void;
  onCancel: () => void;
  /** Test-only initial error string (for SSR markup assertions). */
  initialError?: string | null;
}

export function NewProjectForm({ copy, onCreate, onCreated, onCancel, initialError = null }: NewProjectFormProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const onCreateRef = useRef(onCreate);
  onCreateRef.current = onCreate;
  // H4: Use the tested `createBrandProjectController` directly (one requestId per form session, double-submit guard, error mapping).
  const controller = useMemo(
    () =>
      createBrandProjectController({
        initialProjects: [],
        copy,
        create: ({ title, requestId }) => onCreateRef.current(title, requestId),
      }),
    [copy],
  );
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    const outcome = await controller.submit(title);
    setSubmitting(false);
    if (outcome.ok) {
      onCreated();
      return;
    }
    if (!("ignored" in outcome)) {
      setError(outcome.error);
    }
  };

  return (
    <form className={s.form} data-project-new-form="" onSubmit={(e) => void handleSubmit(e)}>
      <div>
        <label className={s.fieldLabel} htmlFor={inputId}>
          {copy.createLabel}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          className={s.textInput}
          maxLength={BRAND_PROJECT_LIMITS.titleMax}
          placeholder={copy.createPlaceholder}
          value={title}
          disabled={submitting}
          onChange={(e) => {
            setTitle(e.target.value);
            if (error) setError(null);
          }}
        />
      </div>
      {error && (
        <p className={s.formError} role="alert" data-project-create-error="">
          {error}
        </p>
      )}
      <div className={s.formActions}>
        <button type="button" className={s.cancelBtn} disabled={submitting} onClick={onCancel}>
          {copy.cancel}
        </button>
        <button
          type="submit"
          className={s.submitBtn}
          data-variant="solid"
          disabled={submitting || title.trim().length === 0}
        >
          {copy.createSubmit}
        </button>
      </div>
    </form>
  );
}
