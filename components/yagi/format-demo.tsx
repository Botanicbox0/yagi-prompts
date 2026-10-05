import type { Dictionary } from '@/lib/i18n/dictionaries';
import { FilmPlayer } from './film-player';

export function FormatDemo({ t }: { t: Dictionary['yagi'] }) {
  return <div className="yagi-demo" data-format-demo>
    <figure className="yagi-demo-source"><img src="/reel/studio-demo/reference-selfie.jpeg" alt={t.demoAlt} width="1206" height="2075" loading="lazy" />
      <figcaption>{t.demoSource}</figcaption></figure>
    {(['designed-format', 'different-person'] as const).map((name, i) => <figure className="yagi-demo-result" key={name}>
      <div className="yagi-demo-screen"><FilmPlayer src={`/reel/studio-demo/${name}.mp4`} poster={`/reel/studio-demo/${name}.jpg`}
        label={i === 0 ? t.demoFirst : t.demoSecond} labels={t} /></div>
      <figcaption>{i === 0 ? t.demoFirst : t.demoSecond}</figcaption>
    </figure>)}
  </div>;
}
