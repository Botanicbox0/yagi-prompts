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
    <figure data-hero-evidence className="mt-7 w-full max-w-[34rem]">
      <div className="grid grid-cols-[0.82fr_auto_1.18fr] items-center gap-2.5 sm:gap-3">
        <EvidenceFrame src={pair.before} alt={copy.evidenceSelfieAlt} label={copy.evidenceSelfie} />
        <span aria-hidden="true" className="-mt-6 text-sm text-[#676b75]">→</span>
        <EvidenceFrame src={pair.after} videoSrc={pair.afterVideo} alt={copy.evidenceSceneAlt} label={copy.evidenceScene} wide />
      </div>
      <figcaption className="mt-3 text-sm font-medium tracking-[-0.01em]">{copy.evidenceLine}</figcaption>
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
      <div className="relative h-44 w-full overflow-hidden rounded-[18px] bg-sky sm:h-52">
        {/* eslint-disable-next-line @next/next/no-img-element -- a content slot URL, any host */}
        <img
          src={src}
          alt={alt}
          width={wide ? 640 : 400}
          height={500}
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
      <p className="mt-2 text-xs text-[#676b75]">{label}</p>
    </div>
  );
}
