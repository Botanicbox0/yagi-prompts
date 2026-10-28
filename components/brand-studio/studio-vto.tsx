'use client';

/**
 * Try-on (beta) demo for the brand landing (docs/PLATFORM-2.0.md §20.8): the lookbook mode keeps the
 * Americano cut set, the free mode opens scene, pose and ratio. Files live in /reel/studio/.
 */
import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { studioSrc, type LandingMedia } from '@/lib/content/landing-media';
import styles from './studio-vto.module.css';

type StudioCopy = Dictionary['brandLanding']['studio'];
type Vars = CSSProperties & Record<`--${string}`, string | number>;

const VTO_LOOK = ['vto-look-front', 'vto-look-upper', 'vto-look-side'] as const;
const VTO_FREE = [
  { name: 'vto-free-amber', ratio: '3 / 4' },
  { name: 'vto-free-alley', ratio: '9 / 16' },
  { name: 'vto-free-mirror', ratio: '9 / 16' },
  { name: 'vto-free-sofa', ratio: '3 / 4' },
  { name: 'vto-free-drape', ratio: '3 / 4' },
] as const;
const VTO_MODES = ['lookbook', 'free'] as const;

export function StudioVto({ copy, media }: { copy: StudioCopy; media?: LandingMedia }) {
  const t = copy.vto;
  const [mode, setMode] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = mode === 0 ? 1 : 0;
    setMode(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div data-vto className={styles.vto}>
      <aside className={styles.vtoInput}>
        <figure className={styles.vtoGarment}>
          <img src={studioSrc(media, 'vto-garment')} alt="" width={480} height={480} loading="lazy" decoding="async" />
          <figcaption><span>{t.garmentNote}</span>{t.garment}</figcaption>
        </figure>
        <div className={styles.vtoLists}>
          <div>
            <p className={styles.vtoListLabel}>{t.lockLabel}</p>
            <ul>{t.locks.map((item) => <li key={item}><span aria-hidden="true" className={styles.vtoLockMark} />{item}</li>)}</ul>
          </div>
          <div data-active={mode === 1 ? 'true' : 'false'} className={styles.vtoFrees}>
            <p className={styles.vtoListLabel}>{t.freeLabel}</p>
            <ul>{t.frees.map((item) => <li key={item}><span aria-hidden="true" className={styles.vtoFreeMark} />{item}</li>)}</ul>
          </div>
        </div>
      </aside>

      <div className={styles.vtoStage}>
        <div role="tablist" aria-label={t.eyebrow} className={styles.vtoModes}>
          {t.modes.map((item, index) => (
            <button
              key={VTO_MODES[index]}
              ref={(node) => { tabRefs.current[index] = node; }}
              type="button"
              role="tab"
              id={`vto-tab-${VTO_MODES[index]}`}
              aria-controls={`vto-panel-${VTO_MODES[index]}`}
              aria-selected={mode === index}
              tabIndex={mode === index ? 0 : -1}
              data-vto-mode={VTO_MODES[index]}
              className={styles.vtoMode}
              onClick={() => setMode(index)}
              onKeyDown={onKeyDown}
            >
              <span className={styles.vtoModeLabel}>{item.label}{index === 1 && <em>{copy.beta}</em>}</span>
              <span className={styles.vtoModeBody}>{item.body}</span>
            </button>
          ))}
        </div>

        <div role="tabpanel" id="vto-panel-lookbook" aria-labelledby="vto-tab-lookbook" hidden={mode !== 0} data-vto-panel="lookbook" className={styles.vtoLook}>
          {VTO_LOOK.map((name, index) => (
            <figure key={name} className={styles.appear} style={{ '--i': index } as Vars}>
              <img src={studioSrc(media, name)} alt="" width={420} height={560} loading="lazy" decoding="async" />
              <figcaption>{t.lookbookCuts[index]}</figcaption>
            </figure>
          ))}
        </div>
        <div role="tabpanel" id="vto-panel-free" aria-labelledby="vto-tab-free" hidden={mode !== 1} data-vto-panel="free" className={styles.vtoFree}>
          {VTO_FREE.map((cut, index) => (
            <figure key={cut.name} className={styles.appear} style={{ '--i': index, aspectRatio: cut.ratio } as Vars}>
              <img src={studioSrc(media, cut.name)} alt="" width={420} height={560} loading="lazy" decoding="async" />
              <figcaption>{t.freeCuts[index]}</figcaption>
            </figure>
          ))}
        </div>
        <p className={styles.vtoNote}>{t.note}</p>
      </div>
    </div>
  );
}
