import type { MakerLink, MakerLinkKind } from '@/lib/makers/fields';
import { countryName, linkLabel } from '@/lib/makers/fields';

/**
 * docs/PLATFORM-2.0.md §20 — the small pieces an AI creative's identity is drawn with, shared by the
 * profile page, the template page's creative card and the studio preview. Server components: no
 * state, no script — the two interactive bits (email, share) are islands in ./islands.tsx.
 */

export function CreativeAvatar({ handle, name, src, size = 96, className = '', eager = false }: { handle: string; name: string | null; src: string | null; size?: number; className?: string; eager?: boolean }) {
  const initial = [...(name ?? handle).trim()][0]?.toUpperCase() ?? '@';
  return (
    <span
      data-creative-avatar={src ? 'photo' : 'monogram'}
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-black/10 ${className}`}
      style={{ width: size, height: size, ...(src ? {} : { background: 'var(--color-blue)' }) }}
    >
      {src
        // eslint-disable-next-line @next/next/no-img-element -- gateway-served, already square and small
        ? <img src={src} alt="" width={size} height={size} loading={eager ? 'eager' : 'lazy'} decoding="async" className="h-full w-full object-cover" />
        : <span aria-hidden="true" className="font-display font-black text-white" style={{ fontSize: Math.round(size * 0.42) }}>{initial}</span>}
    </span>
  );
}

/**
 * "Seoul, 대한민국" in the page's language. No flag emoji: Windows has no glyphs for them and
 * prints the two letters instead ("KR Seoul").
 */
export function placeOf(country: string | null, city: string | null, locale: string): string | null {
  const name = country ? countryName(country, locale) : null;
  const place = [city, name].filter(Boolean).join(', ');
  return place || null;
}

const PATHS: Partial<Record<MakerLinkKind, string>> = {
  instagram: 'M12 2.2c3.2 0 3.6 0 4.8.1 1.2.1 1.8.2 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1.1.4 2.2.1 1.3.1 1.6.1 4.8s0 3.6-.1 4.8c-.1 1.2-.2 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1.1.4-2.2.4-1.3.1-1.6.1-4.8.1s-3.6 0-4.8-.1c-1.2-.1-1.8-.2-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1.1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.8c.1-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1.1-.4 2.2-.4C8.4 2.2 8.8 2.2 12 2.2zm0 4.6a5.2 5.2 0 1 0 0 10.4 5.2 5.2 0 0 0 0-10.4zm0 8.6a3.4 3.4 0 1 1 0-6.8 3.4 3.4 0 0 1 0 6.8zm5.4-9.9a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z',
  tiktok: 'M16.6 5.8A4.3 4.3 0 0 1 15.5 3h-3.1v12.4a2.6 2.6 0 1 1-1.8-2.5V9.7a5.7 5.7 0 1 0 4.9 5.7V9.1a7.4 7.4 0 0 0 4.3 1.4V7.4a4.3 4.3 0 0 1-3.2-1.6z',
  youtube: 'M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15V9l5.2 3L10 15z',
  x: 'M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z',
  threads: 'M16.7 11.1c-.1 0-.2-.1-.3-.1-.2-3-1.8-4.8-4.6-4.8-1.7 0-3.1.7-4 2l1.6 1.1c.6-.9 1.6-1.1 2.4-1.1 1 0 1.7.3 2.1.9.3.4.5 1 .6 1.7a11 11 0 0 0-2.5-.1c-2.5.1-4.1 1.6-4 3.6.1 1 .6 1.9 1.4 2.4.7.5 1.6.7 2.6.6 1.3-.1 2.3-.6 3-1.4.5-.7.9-1.5 1-2.6.6.4 1.1.9 1.3 1.5.4 1 .4 2.6-.9 3.9-1.2 1.2-2.6 1.7-4.7 1.7-2.4 0-4.2-.8-5.3-2.3C3.4 16.6 2.9 14.6 2.9 12s.5-4.6 1.6-6.2C5.6 4.3 7.4 3.5 9.8 3.5c2.4 0 4.3.8 5.5 2.3.6.7 1 1.7 1.3 2.7l1.9-.5c-.4-1.3-.9-2.4-1.7-3.4C15.3 2.7 12.9 1.6 9.8 1.6c-3.1 0-5.4 1-7 3C1.5 6.4.9 8.9.9 12s.6 5.6 1.9 7.4c1.6 2 3.9 3 7 3 2.7 0 4.6-.7 6.2-2.3 2.1-2.1 2-4.7 1.3-6.3-.4-1.1-1.3-2-2.6-2.7zm-4.3 4.6c-1.1.1-2.2-.4-2.3-1.4 0-.8.5-1.6 2.3-1.7h.6c.7 0 1.3.1 1.9.2-.2 2.4-1.4 2.8-2.5 2.9z',
};

export function LinkIcon({ kind }: { kind: MakerLinkKind }) {
  const path = PATHS[kind];
  if (path) return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[1.05rem] shrink-0" fill="currentColor"><path d={path} /></svg>;
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[1.05rem] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
    </svg>
  );
}

const KIND_NAME: Record<MakerLinkKind, string> = {
  instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', x: 'X', threads: 'Threads', higgsfield: 'Higgsfield', behance: 'Behance', vimeo: 'Vimeo', linkedin: 'LinkedIn', website: 'Web',
};

export function CreativeLinks({ links, className = '' }: { links: MakerLink[]; className?: string }) {
  if (!links.length) return null;
  return (
    <ul data-creative-links className={`flex flex-wrap gap-2 ${className}`}>
      {links.map((link) => (
        <li key={link.url}>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer nofollow me"
            data-creative-link={link.kind}
            className="inline-flex min-h-10 items-center gap-2 rounded-full border border-hairline bg-surface px-3.5 text-sm text-black/80 transition-colors hover:border-black/40 hover:text-black"
          >
            <LinkIcon kind={link.kind} />
            <span className="sr-only">{KIND_NAME[link.kind]} </span>
            <span className="max-w-[14rem] truncate">{linkLabel(link)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
