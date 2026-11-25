'use client';
/**
 * "영상 스튜디오에 넣기" (docs/BRAND-SOUND-STUDIO.md §4.5): pick a saved video studio project, or make a new
 * one, and the server puts the sound into its background-music slot (`bgm.set`) or onto its effects track
 * (`sfx.add`). A slot that already holds other music asks before replacing. Every check (seat, `sound`
 * policy, the asset being this brand's audio) is the server's; this is the picker.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { newRequestId } from '@/components/brand-studio/copy';
import { useProjectSpine, type ProjectSpineCopy } from '@/components/brand-studio/project-chip';
import { belongsToOpenProject, brandProjectIdOf, type OpenProject } from '@/lib/brand-studio/open-project';
import type { SoundSendTrack } from '@/lib/brand-studio/sound/send';
import type { VideoProjectSummary } from '@/lib/brand-studio/video-projects/contracts';
import { interpolate } from '@/lib/i18n/format';
import type { StudioSoundCopy } from '@/messages/studio-sound';
import s from './sound.module.css';

/** Swap every "프로젝트"/"project" string in SendToVideoDialog to "편집본"/"edit" while spine is open (G4). */
export function soundSendCopy(
  base: StudioSoundCopy['send'],
  spineCopy: ProjectSpineCopy,
): StudioSoundCopy['send'] {
  return {
    ...base,
    pickTitle: spineCopy.soundSendPickTitle,
    newProject: spineCopy.soundSendNewProject,
    noProjects: spineCopy.soundSendNoProjects,
    loading: spineCopy.soundSendLoading,
    sfxFull: spineCopy.soundSendSfxFull,
  };
}

/** Filter films shown in SendToVideoDialog to the open brand project scope while spine is open (G4). */
export function sendDialogFilmsInScope<T extends Pick<VideoProjectSummary, 'brandProjectId'>>(
  films: readonly T[],
  open: OpenProject | undefined,
): T[] {
  if (!open) return [...films];
  return films.filter((film) => belongsToOpenProject(film.brandProjectId, open));
}

/** Payload for `POST /api/brand-studio/video-projects` `{ op: 'create' }` from SendToVideoDialog (G4). */
export function sendDialogCreateBody(input: {
  organizationId: string;
  requestId: string;
  title: string;
  brandProjectId?: string | null;
}) {
  return {
    op: 'create' as const,
    organizationId: input.organizationId,
    requestId: input.requestId,
    title: input.title,
    ...(input.brandProjectId ? { brandProjectId: input.brandProjectId } : {}),
  };
}

export interface SendTarget {
  track: SoundSendTrack;
  kind: 'bgm' | 'sfx';
}

const ENDPOINT = '/api/brand-studio/video-projects';

type Answer = { ok: boolean; code?: string; project?: { id: string }; currentBgmLabel?: string; sfxFull?: boolean; projects?: VideoProjectSummary[] };

async function post(body: Record<string, unknown>): Promise<Answer> {
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await response.json()) as Answer;
  } catch {
    return { ok: false, code: 'failed' };
  }
}

/** The video studio's edit view of one project/film, keeping the brand in the address. */
export function videoProjectHref(videoHref: string, projectId: string, useFilmParam = false): string {
  const join = videoHref.includes('?') ? '&' : '?';
  const param = useFilmParam ? 'film' : 'project';
  return `${videoHref}${join}tab=edit&${param}=${encodeURIComponent(projectId)}`;
}

export function SendToVideoDialog(props: {
  organizationId: string;
  target: SendTarget;
  copy: StudioSoundCopy;
  videoHref: string;
  /** Brand project spine open: video studio film links use `?film=` instead of `?project=` (§4.5). */
  useFilmParam?: boolean;
  onClose: () => void;
  onDone: (href: string) => void;
  onNotice: (text: string) => void;
}) {
  const { copy, organizationId, target } = props;
  const spineCtx = useProjectSpine();
  const useFilmParam = Boolean(props.useFilmParam || spineCtx);
  const sendCopy = useMemo(
    () => (spineCtx ? soundSendCopy(copy.send, spineCtx.copy) : copy.send),
    [copy.send, spineCtx],
  );
  const openBrandProjectId = spineCtx ? brandProjectIdOf(spineCtx.open) : null;
  const [projects, setProjects] = useState<VideoProjectSummary[] | null>(null);
  const visibleProjects = useMemo(
    () => (projects === null ? null : sendDialogFilmsInScope(projects, spineCtx?.open)),
    [projects, spineCtx?.open],
  );
  const [busy, setBusy] = useState(false);
  const [replaceIn, setReplaceIn] = useState<{ projectId: string; current: string } | null>(null);
  const dialog = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${ENDPOINT}?organizationId=${encodeURIComponent(organizationId)}`, { credentials: 'same-origin', cache: 'no-store' })
      .then((response) => response.json() as Promise<Answer>)
      .then((answer) => {
        if (alive) setProjects(answer.ok && Array.isArray(answer.projects) ? answer.projects : []);
      })
      .catch(() => {
        if (alive) setProjects([]);
      });
    return () => {
      alive = false;
    };
  }, [organizationId]);

  useEffect(() => {
    dialog.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
  }, [visibleProjects, replaceIn]);

  const place = async (projectId: string, replace: boolean) => {
    setBusy(true);
    const answer = await post({
      op: target.kind === 'bgm' ? 'bgm.set' : 'sfx.add',
      organizationId,
      projectId,
      assetId: target.track.assetId,
      label: target.track.label,
      ...(replace ? { replace: true } : {}),
    });
    setBusy(false);
    if (answer.ok) return props.onDone(videoProjectHref(props.videoHref, projectId, useFilmParam));
    if (answer.code === 'conflict' && answer.currentBgmLabel) return setReplaceIn({ projectId, current: answer.currentBgmLabel });
    props.onClose();
    props.onNotice(answer.sfxFull ? sendCopy.sfxFull : sendCopy.failed);
  };

  const placeInNew = async () => {
    setBusy(true);
    const created = await post(
      sendDialogCreateBody({
        organizationId,
        requestId: newRequestId(),
        title: target.track.label,
        brandProjectId: openBrandProjectId,
      }),
    );
    if (!created.ok || !created.project) {
      setBusy(false);
      props.onClose();
      props.onNotice(sendCopy.failed);
      return;
    }
    await place(created.project.id, false);
  };

  return (
    <div className={s.scrim} role="presentation" onClick={busy ? undefined : props.onClose}>
      <div
        ref={dialog}
        className={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={replaceIn ? interpolate(sendCopy.replaceTitle, { current: replaceIn.current }) : sendCopy.pickTitle}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) props.onClose();
        }}
        aria-busy={busy}
        data-sound-video-dialog
      >
        {replaceIn ? (
          <>
            <p className={s.dialogTitle}>{interpolate(sendCopy.replaceTitle, { current: replaceIn.current })}</p>
            <div className={s.dialogActions}>
              <button type="button" className="bs-btn" data-variant="soft" data-size="sm" disabled={busy} onClick={() => setReplaceIn(null)}>
                {sendCopy.cancel}
              </button>
              <button
                type="button"
                className="bs-btn"
                data-variant="solid"
                data-size="sm"
                disabled={busy}
                onClick={() => void place(replaceIn.projectId, true)}
                data-sound-replace-yes
              >
                {sendCopy.replace}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className={s.dialogTitle}>{sendCopy.pickTitle}</p>
            {visibleProjects === null ? (
              <p className={s.dialogNote}>{sendCopy.loading}</p>
            ) : visibleProjects.length === 0 ? (
              <p className={s.dialogNote}>{sendCopy.noProjects}</p>
            ) : (
              <ul className={s.projects}>
                {visibleProjects.map((project) => (
                  <li key={project.id}>
                    <button type="button" className={s.project} disabled={busy} onClick={() => void place(project.id, false)} data-sound-project={project.id}>
                      {project.thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={project.thumbUrl} alt="" className={s.projectThumb} loading="lazy" />
                      ) : (
                        <span className={s.projectThumb} aria-hidden="true" />
                      )}
                      <span className={s.projectName}>{project.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className={s.dialogActions}>
              <button type="button" className="bs-btn" data-variant="ghost" data-size="sm" disabled={busy} onClick={props.onClose}>
                {sendCopy.cancel}
              </button>
              <button type="button" className="bs-btn" data-variant="soft" data-size="sm" disabled={busy || visibleProjects === null} onClick={() => void placeInNew()} data-sound-new-project>
                {sendCopy.newProject}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
