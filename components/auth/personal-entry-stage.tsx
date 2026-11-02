'use client';

import type { CSSProperties } from 'react';
import { FilmPauseButton, useFilmWall } from './brand-entry-stage';
import styles from './brand-entry.module.css';

/** Three people from one film. The same world, a different lead in each: what the visitor signs up to do. */
const FACES = ['entry-fur', 'entry-lead', 'entry-zip'] as const;

/** Beside the personal sign-in door. Auth stays server-rendered; this island only plays the three short films. */
export function PersonalEntryStage({ title, playLabel, pauseLabel }: { title: string; playLabel: string; pauseLabel: string }) {
  const { wall, playing, toggle } = useFilmWall();
  return (
    <section data-personal-auth-stage className={styles.stage}>
      <div className={styles.stageHead}>
        <p className={styles.title}>{title}</p>
      </div>
      <FilmPauseButton playing={playing} playLabel={playLabel} pauseLabel={pauseLabel} onToggle={toggle} marker={{ 'data-personal-auth-pause': true }} />
      <div ref={wall} className={`${styles.wall} ${styles.faces}`} aria-hidden="true">
        {FACES.map((name, index) => (
          <div key={name} className={styles.tile} style={{ '--i': index } as CSSProperties}>
            <video src={`/reel/landing/${name}.mp4`} poster={`/reel/landing/${name}.jpg`} muted loop playsInline preload="metadata" />
          </div>
        ))}
      </div>
    </section>
  );
}
