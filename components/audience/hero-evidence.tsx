import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { EvidencePair } from '@/lib/content/slots';

type Copy = Pick<Dictionary['creatorJourney'], 'evidenceSelfie' | 'evidenceScene' | 'evidenceSelfieAlt' | 'evidenceSceneAlt' | 'evidenceLine'>;

/**
 * The selfie → scene pair (docs/PLATFORM-2.0.md §15.3-2): the one picture that proves "내 얼굴로
 * 트렌드 포맷의 주인공", shown before any sign-in. Left the photo a person would take, right the scene
 * (or looping video output) with that face in it, then one line. Nothing at all without a full pair
 * (`lib/content/slots.ts` `heroEvidence`).
 */
export function HeroEvidence({
  pair,
  copy,
}: {
  pair: EvidencePair | null;
  copy: Copy;
}) {
  if (pair === null) return null;
  return (
    <figure data-hero-evidence className="mt-5 w-full max-w-[26rem] rounded-[16px] bg-[#F4F4F5] p-3 sm:mt-6">
      <div className="grid grid-cols-[0.8fr_auto_1.2fr] items-center gap-2.5">
        <EvidenceFrame src={pair.before} alt={copy.evidenceSelfieAlt} label={copy.evidenceSelfie} />
        <span aria-hidden="true" className="-mt-4 text-xs text-[#71717A]">→</span>
        <EvidenceFrame src={pair.after} videoSrc={pair.afterVideo} alt={copy.evidenceSceneAlt} label={copy.evidenceScene} wide />
      </div>
      <figcaption className="mt-2.5 border-t border-black/[0.06] pt-2 text-xs font-medium tracking-[-0.01em] text-[#09090B]">{copy.evidenceLine}</figcaption>
    </figure>
  );
}

function EvidenceFrame({
  src,
  videoSrc,
  alt,
  label,
  wide = false,
}: {
  src: string;
  videoSrc?: string;
  alt: string;
  label: string;
  wide?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className={`relative w-full overflow-hidden rounded-[12px] bg-white max-h-36 ${wide ? 'aspect-[4/3]' : 'aspect-[4/5]'}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a content slot URL, any host */}
        <img
          src={src}
          alt={alt}
          width={wide ? 640 : 400}
          height={wide ? 480 : 500}
          decoding="async"
          fetchPriority="high"
          className={`h-full w-full object-cover ${wide ? 'object-center' : 'object-[50%_22%]'}`}
        />
        {videoSrc && (
          <video
            src={videoSrc}
            poster={src}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-label={alt}
            className="absolute inset-0 h-full w-full object-cover object-center"
          />
        )}
      </div>
      <p className="mt-1.5 text-[11px] font-medium text-[#52525B]">{label}</p>
    </div>
  );
}
