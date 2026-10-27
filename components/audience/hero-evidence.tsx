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
    <figure
      data-hero-evidence
      className="mt-7 w-full max-w-[34rem] rounded-2xl border border-black/10 bg-[#FAF9F6] p-3.5 shadow-[0_14px_38px_-18px_rgba(0,0,0,0.1)] sm:p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-black/[0.07] pb-2.5">
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-[0.14em] text-black/55 uppercase">
          <span className="size-1.5 rounded-full bg-[#ED1E1E]" aria-hidden="true" />
          SELFIE TO SCENE · LIVE OUTPUT
        </span>
        <span className="font-mono text-[10px] tracking-[0.08em] text-black/45 uppercase">
          1 PHOTO INPUT → VIDEO
        </span>
      </div>

      <div className="grid grid-cols-[0.82fr_auto_1.18fr] items-stretch gap-2.5 sm:gap-3">
        <EvidenceFrame src={pair.before} alt={copy.evidenceSelfieAlt} label={copy.evidenceSelfie} step="01" />
        <div className="flex items-center justify-center">
          <span className="inline-flex size-7 items-center justify-center rounded-full border border-black/10 bg-white text-black/80 shadow-xs sm:size-8">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3.5 sm:size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </span>
        </div>
        <EvidenceFrame
          src={pair.after}
          videoSrc={pair.afterVideo}
          alt={copy.evidenceSceneAlt}
          label={copy.evidenceScene}
          step="02 · VIDEO"
          wide
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-black/[0.07] pt-2.5">
        <figcaption className="text-sm font-semibold tracking-tight text-black/90">{copy.evidenceLine}</figcaption>
        <span className="font-mono text-[10px] tracking-[0.08em] text-black/45 uppercase">YAGI STUDIO ENGINE</span>
      </div>
    </figure>
  );
}

function EvidenceFrame({
  src,
  videoSrc,
  alt,
  label,
  step,
  wide = false,
}: {
  src: string;
  videoSrc?: string;
  alt: string;
  label: string;
  step: string;
  wide?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="relative h-44 w-full overflow-hidden rounded-xl bg-black/5 ring-1 ring-black/8 sm:h-52">
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
        <span className="pointer-events-none absolute top-2 left-2 z-10 rounded-md bg-black/65 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white backdrop-blur-xs">
          {step}
        </span>
      </div>
      <p className="mt-2 text-xs font-medium text-black/75">{label}</p>
    </div>
  );
}
