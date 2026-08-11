import { TextSwap } from '@/components/ui/text-swap';

/**
 * PLAN §2 / §3.4 — Free vs Pro.
 *
 *   Free  structure, steps, free assets
 *   Pro   $9/month: every prompt/param, copy buttons, workflow files, notifications
 *
 * Shared by the landing's pricing summary and the pricing page so the two can never disagree
 * about what a plan is. The CTA is a plain sign-in link on both: checkout is M3.
 */

export interface PlanCopy {
  free: string;
  pro: string;
  freePrice: string;
  proPrice: string;
  perMonth: string;
  freeTagline: string;
  proTagline: string;
  cancelNote: string;
  startWithGoogle: string;
}

export function PlanCards({
  locale,
  copy,
  freeFeatures,
  proFeatures,
}: {
  locale: string;
  copy: PlanCopy;
  freeFeatures: string[];
  proFeatures: string[];
}) {
  const signInHref = `/auth/signin?next=%2Flibrary&locale=${locale}`;

  return (
    <div className="grid gap-px border border-hairline bg-hairline lg:grid-cols-2">
      <section aria-label={copy.free} className="flex flex-col gap-6 bg-surface p-7 lg:p-9">
        <div>
          <p className="font-label text-eyebrow uppercase opacity-60">{copy.free}</p>
          <p className="mt-4 font-display text-[clamp(3rem,6vw,4.5rem)] leading-[0.85] font-black">
            {copy.freePrice}
          </p>
          <p className="mt-4 text-body opacity-70">{copy.freeTagline}</p>
        </div>
        <ul className="mt-auto flex flex-col gap-3 border-t border-hairline pt-6">
          {freeFeatures.map((feature) => (
            <li key={feature} className="flex gap-3 text-[0.9375rem] leading-snug">
              <span aria-hidden className="text-accent font-mono">
                +
              </span>
              <span className="opacity-80">{feature}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label={copy.pro} data-theme="dark" className="flex flex-col gap-6 bg-surface p-7 text-on-surface lg:p-9">
        <div>
          <p className="font-label text-eyebrow uppercase opacity-60">{copy.pro}</p>
          <p className="mt-4 flex items-baseline gap-2 font-display text-[clamp(3rem,6vw,4.5rem)] leading-[0.85] font-black">
            {copy.proPrice}
            <span className="font-sans text-[0.9375rem] leading-none font-normal opacity-60">
              {copy.perMonth}
            </span>
          </p>
          <p className="mt-4 text-body opacity-70">{copy.proTagline}</p>
        </div>

        <ul className="flex flex-col gap-3 border-t border-hairline pt-6">
          {proFeatures.map((feature) => (
            <li key={feature} className="flex gap-3 text-[0.9375rem] leading-snug">
              <span aria-hidden className="text-accent font-mono">
                +
              </span>
              <span className="opacity-80">{feature}</span>
            </li>
          ))}
        </ul>

        <div className="mt-auto pt-4">
          <a
            href={signInHref}
            className="inline-block border border-current px-6 py-3 font-label text-label uppercase"
          >
            <TextSwap>{copy.startWithGoogle} →</TextSwap>
          </a>
          <p className="mt-4 font-mono text-code opacity-60">{copy.cancelNote}</p>
        </div>
      </section>
    </div>
  );
}
