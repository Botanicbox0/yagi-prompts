import type { Dictionary } from '@/lib/i18n/dictionaries';
import { FilmPlayer } from './film-player';

export function FormatDemo({ t }: { t: Dictionary['yagi'] }) {
  return <div className="yagi-demo" data-format-demo>
    {(['designed-format', 'different-person'] as const).map((name, i) => <figure className="yagi-demo-result" key={name}>
      <div className="yagi-demo-reference" data-format-reference={name}>
        <img src={i === 0 ? '/reel/studio-demo/designed-reference.png' : '/reel/studio-demo/reference-selfie.jpeg'}
          alt={`${i === 0 ? t.demoFirst : t.demoSecond}: ${t.demoAlt}`} width={i === 0 ? 256 : 1206} height={i === 0 ? 240 : 2075} loading="lazy" />
        <div><p>{t.demoSource}</p><span aria-hidden="true">↓</span></div>
      </div>
      <div className="yagi-demo-screen"><FilmPlayer src={`/reel/studio-demo/${name}.mp4`} poster={`/reel/studio-demo/${name}.jpg`}
        label={i === 0 ? t.demoFirst : t.demoSecond} labels={t} /></div>
      <figcaption>{i === 0 ? t.demoFirst : t.demoSecond}</figcaption>
    </figure>)}
  </div>;
}
