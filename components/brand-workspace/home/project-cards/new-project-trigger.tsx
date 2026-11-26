'use client';
/**
 * "새 프로젝트 만들기" trigger button and modal dialog on the 직접 만들기 home (§5.2).
 * Imports slice 1b's `NewProjectForm` as-is inside `<dialog className="bs-dialog">`; on success,
 * keeps the trigger disabled and dialog locked until navigation leaves the page.
 */
import { useCallback, useEffect, useId, useReducer, useRef } from 'react';
import { createStudioApi } from '@/components/brand-studio/api';
import { useBackdropClose, useModal } from '@/components/brand-studio/modal';
import type { CreateBrandProjectResult } from '@/components/brand-studio/project-chip/context';
import type { ProjectSpineCopy } from '@/components/brand-studio/project-chip/model';
import { NewProjectForm } from '@/components/brand-studio/project-chip/new-project-form';
import {
  canCloseNewProjectDialog,
  canOpenNewProjectTrigger,
  newProjectTriggerReducer,
  studioProjectHref,
  type NewProjectTriggerState,
} from './model';
import pc from './project-cards.module.css';

export interface NewProjectTriggerProps {
  organizationId: string;
  copy: ProjectSpineCopy;
  /** Test-only hooks for SSR and unit checks. */
  initialOpen?: boolean;
  initialCreateError?: string | null;
  onCreateProject?: (title: string, requestId: string) => Promise<CreateBrandProjectResult>;
  onNavigate?: (href: string) => void;
}

function PlusIcon() {
  return (
    <svg className={pc.plusIcon} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

function NewProjectDialog({
  organizationId,
  copy,
  state,
  initialCreateError = null,
  onCreateProject,
  onNavigate,
  onStage,
  onClose,
}: {
  organizationId: string;
  copy: ProjectSpineCopy;
  state: NewProjectTriggerState;
  initialCreateError?: string | null;
  onCreateProject?: (title: string, requestId: string) => Promise<CreateBrandProjectResult>;
  onNavigate?: (href: string) => void;
  onStage: (event: 'submit' | 'fail' | 'succeed') => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const createdIdRef = useRef<string | null>(null);
  const dialogRef = useModal();
  const backdrop = useBackdropClose(onClose);
  const busy = state === 'submitting' || state === 'created';
  const prevStateRef = useRef<NewProjectTriggerState>(state);

  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (prev === 'submitting' && state === 'open') {
      const labelFor = dialogRef.current
        ?.querySelector<HTMLLabelElement>('[data-project-new-form] label[for]')
        ?.getAttribute('for');
      if (labelFor) {
        const escapedId = labelFor.replace(/"/g, '\\"');
        dialogRef.current?.querySelector<HTMLInputElement>(`[data-project-new-form] input[id="${escapedId}"]`)?.focus();
      }
    }
  }, [dialogRef, state]);

  const handleCreate = useCallback(
    async (title: string, requestId: string): Promise<CreateBrandProjectResult> => {
      onStage('submit');
      const result = onCreateProject
        ? await onCreateProject(title, requestId)
        : await createStudioApi({ organizationId }).createBrandProject({ title, requestId });
      if (result.ok) {
        createdIdRef.current = result.project.id;
        onStage('succeed');
        return { ok: true, project: result.project };
      }
      onStage('fail');
      return { ok: false, code: result.code };
    },
    [onCreateProject, onStage, organizationId],
  );

  const handleCreated = useCallback(() => {
    const projectId = createdIdRef.current;
    if (!projectId) return;
    const href = studioProjectHref(organizationId, projectId);
    if (onNavigate) onNavigate(href);
    else if (typeof window !== 'undefined') window.location.assign(href);
  }, [onNavigate, organizationId]);

  return (
    <dialog
      ref={dialogRef}
      className="bs-dialog"
      aria-labelledby={titleId}
      aria-busy={busy ? 'true' : undefined}
      data-home-new-project-dialog=""
      onCancel={(event) => {
        event.preventDefault();
        if (canCloseNewProjectDialog(state)) onClose();
      }}
      {...backdrop}
    >
      <div className="bs-dialog-body">
        <h2 id={titleId}>{copy.newProject}</h2>
        <fieldset className={pc.dialogFieldset} disabled={busy}>
          <NewProjectForm
            copy={copy}
            onCreate={handleCreate}
            onCreated={handleCreated}
            onCancel={onClose}
            initialError={initialCreateError}
          />
        </fieldset>
      </div>
    </dialog>
  );
}

export function NewProjectTrigger({
  organizationId,
  copy,
  initialOpen = false,
  initialCreateError = null,
  onCreateProject,
  onNavigate,
}: NewProjectTriggerProps) {
  const [state, dispatch] = useReducer(newProjectTriggerReducer, initialOpen ? 'open' : 'idle');
  const handleClose = useCallback(() => dispatch('close'), []);
  const handleStage = useCallback((event: 'submit' | 'fail' | 'succeed') => dispatch(event), []);
  const openAllowed = canOpenNewProjectTrigger(state);

  return (
    <>
      <button
        type="button"
        className="bs-btn"
        data-variant="soft"
        data-size="sm"
        data-home-new-project=""
        disabled={!openAllowed}
        onClick={() => dispatch('open')}
      >
        <PlusIcon />
        <span>{copy.newProject}</span>
      </button>
      {state !== 'idle' ? (
        <NewProjectDialog
          organizationId={organizationId}
          copy={copy}
          state={state}
          initialCreateError={initialCreateError}
          onCreateProject={onCreateProject}
          onNavigate={onNavigate}
          onStage={handleStage}
          onClose={handleClose}
        />
      ) : null}
    </>
  );
}
