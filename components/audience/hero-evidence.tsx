import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { EvidencePair } from '@/lib/content/slots';

type Copy = Pick<Dictionary['creatorJourney'], 'evidenceSelfie' | 'evidenceScene' | 'evidenceSelfieAlt' | 'evidenceSceneAlt' | 'evidenceLine'>;

/**
 * The selfie → scene pair (docs/PLATFORM-2.0.md §15.3-2): the one picture that proves "내 얼굴로
 * 트렌드 포맷의 주인공", shown before any sign-in. Left the photo a person would take, right the scene
 * with that face in it, then one line. Both pictures are 4:5 and fixed in size, so the hero does not
 * jump while they load. Nothing at all without a full pair (lib/content/slots.ts `heroEvidence`).
 */
export function HeroEvidence({ pair, copy }: { pair: EvidencePair | null; copy: Copy }) {
  if (pair === null) return null;
  return (
    <figure data-hero-evidence className="mt-8 max-w-md">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-3">
        <EvidenceFrame src={pair.before} alt={copy.evidenceSelfieAlt} label={copy.evidenceSelfie} />
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0 text-accent sm:size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
        <EvidenceFrame src={pair.after} alt={copy.evidenceSceneAlt} label={copy.evidenceScene} />
      </div>
      <figcaption className="mt-4 text-base font-semibold tracking-tight">{copy.evidenceLine}</figcaption>
    </figure>
  );
}

function EvidenceFrame({ src, alt, label }: { src: string; alt: string; label: string }) {
  return (
    <div className="min-w-0">
      <div className="aspect-[4/5] overflow-hidden rounded-2xl bg-black/5">
        {/* eslint-disable-next-line @next/next/no-img-element -- a content slot URL, any host */}
        <img src={src} alt={alt} width={400} height={500} decoding="async" fetchPriority="high" className="h-full w-full object-cover object-[50%_30%]" />
      </div>
      <p className="mt-2 text-xs text-black/70">{label}</p>
    </div>
  );
}
