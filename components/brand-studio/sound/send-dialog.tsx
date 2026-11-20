'use client';
/**
 * "영상 스튜디오에 넣기" (docs/BRAND-SOUND-STUDIO.md §4.5): pick a saved video studio project, or make a new
 * one, and the server puts the sound into its background-music slot (`bgm.set`) or onto its effects track
 * (`sfx.add`). A slot that already holds other music asks before replacing. Every check (seat, `sound`
 * policy, the asset being this brand's audio) is the server's; this is the picker.
 */
import { useEffect, useRef, useState } from 'react';
import { newRequestId } from '@/components/brand-studio/copy';
import type { SoundSendTrack } from '@/lib/brand-studio/sound/send';
import type { VideoProjectSummary } from '@/lib/brand-studio/video-projects/contracts';
import { interpolate } from '@/lib/i18n/format';
import type { StudioSoundCopy } from '@/messages/studio-sound';
import s from './sound.module.css';

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

/** The video studio's edit view of one project, keeping the brand in the address. */
export function videoProjectHref(videoHref: string, projectId: string): string {
  const join = videoHref.includes('?') ? '&' : '?';
  return `${videoHref}${join}tab=edit&project=${encodeURIComponent(projectId)}`;
}

export function SendToVideoDialog(props: {
  organizationId: string;
  target: SendTarget;
  copy: StudioSoundCopy;
  videoHref: string;
  onClose: () => void;
  onDone: (href: string) => void;
  onNotice: (text: string) => void;
}) {
  const { copy, organizationId, target } = props;
  const [projects, setProjects] = useState<VideoProjectSummary[] | null>(null);
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
  }, [projects, replaceIn]);

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
    if (answer.ok) return props.onDone(videoProjectHref(props.videoHref, projectId));
    if (answer.code === 'conflict' && answer.currentBgmLabel) return setReplaceIn({ projectId, current: answer.currentBgmLabel });
    props.onClose();
    props.onNotice(answer.sfxFull ? copy.send.sfxFull : copy.send.failed);
  };

  const placeInNew = async () => {
    setBusy(true);
    const created = await post({ op: 'create', organizationId, requestId: newRequestId(), title: target.track.label });
    if (!created.ok || !created.project) {
      setBusy(false);
      props.onClose();
      props.onNotice(copy.send.failed);
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
        aria-label={replaceIn ? interpolate(copy.send.replaceTitle, { current: replaceIn.current }) : copy.send.pickTitle}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) props.onClose();
        }}
        aria-busy={busy}
        data-sound-video-dialog
      >
        {replaceIn ? (
          <>
            <p className={s.dialogTitle}>{interpolate(copy.send.replaceTitle, { current: replaceIn.current })}</p>
            <div className={s.dialogActions}>
              <button type="button" className="bs-btn" data-variant="soft" data-size="sm" disabled={busy} onClick={() => setReplaceIn(null)}>
                {copy.send.cancel}
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
                {copy.send.replace}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className={s.dialogTitle}>{copy.send.pickTitle}</p>
            {projects === null ? (
              <p className={s.dialogNote}>{copy.send.loading}</p>
            ) : projects.length === 0 ? (
              <p className={s.dialogNote}>{copy.send.noProjects}</p>
            ) : (
              <ul className={s.projects}>
                {projects.map((project) => (
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
                {copy.send.cancel}
              </button>
              <button type="button" className="bs-btn" data-variant="soft" data-size="sm" disabled={busy || projects === null} onClick={() => void placeInNew()} data-sound-new-project>
                {copy.send.newProject}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
