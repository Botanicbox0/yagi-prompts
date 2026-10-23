import type { Dictionary } from '@/messages/en';
import { SOCIAL_PATH } from '@/lib/influencers/rules';
import type { SocialAccountView } from '@/lib/influencers/service';

type Copy = Dictionary['social'];

/** The one-line door to `/identity/social` above a campaign list (§17.2): quiet, never a modal. */
export function SocialTeaser({ copy }: { copy: Copy }) {
  return (
    <p data-social-teaser className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-hairline bg-white px-4 py-3 text-sm">
      <span className="min-w-0 flex-1 leading-relaxed">{copy.teaser}</span>
      <a href={SOCIAL_PATH} className="inline-flex min-h-11 items-center font-semibold text-accent underline-offset-4 hover:underline">{copy.teaserCta} →</a>
    </p>
  );
}

/** `/account`'s "SNS 연결" card: where the member stands, and the way to the page. */
export function SocialAccountCard({ copy, influencer, items }: { copy: Copy; influencer: boolean; items: SocialAccountView[] }) {
  const checking = items.some(item => item.state === 'checking');
  const line = influencer ? copy.accountInfluencer : checking ? copy.accountChecking : copy.accountBody;
  return (
    <section data-social-account data-influencer={influencer ? 'true' : 'false'} aria-labelledby="account-social-title" className="mt-6 max-w-detail rounded-3xl border border-hairline bg-white p-5 sm:p-6">
      <h2 id="account-social-title" className="text-base font-semibold">{copy.accountTitle}</h2>
      <p className={['mt-2 text-sm leading-relaxed', influencer ? 'font-medium text-accent' : 'opacity-70'].join(' ')}>{line}</p>
      {items.length ? (
        <ul role="list" className="mt-3 flex flex-wrap gap-2">
          {items.map(item => (
            <li key={item.id} className="rounded-full border border-hairline px-3 py-1 text-xs">
              {copy.platforms[item.platform]} @{item.handle} · {copy.state[item.state]}
            </li>
          ))}
        </ul>
      ) : null}
      <a href={SOCIAL_PATH} data-social-account-link className="mt-4 inline-flex min-h-11 items-center bg-accent px-5 font-label text-eyebrow text-white uppercase transition-opacity hover:opacity-85">
        {items.length ? copy.accountManage : copy.accountCta} →
      </a>
    </section>
  );
}
