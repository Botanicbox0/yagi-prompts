import { TextSwap } from '@/components/ui/text-swap';
import { GoatMark } from '@/components/nav/goat-mark';
import { HireClickBeacon } from '@/components/analytics/beacon';

/**
 * PLAN §3.1 — "Footer carries the B2B lead CTA: 'Work with the studio →' (+ `hire_click` event).
 * The same strip appears at the bottom of playbook detail pages."
 *
 * Founder direction (2026-08-13): the big CTA opens the studio's Pitch deck in a new tab — a
 * deck sells the studio better than an empty compose window. The CONTACT email below stays a
 * mailto: the deck is the pitch, the address is the reply channel. `hire_click` beacons both.
 */

/** The studio intro deck the hire CTA opens. */
const HIRE_DECK_URL = 'https://pitch.com/v/yagi-workshop-intro-9nbwak';
export interface FooterLabels {
  hireCta: string;
  hireLede: string;
  advertise: string;
  rights: string;
  builtIn: string;
  navHeading: string;
  contactHeading: string;
  brand: string;
  adContact: string;
}

export interface FooterLink {
  href: string;
  label: string;
}

export function SiteFooter({
  locale: _locale,
  labels,
  links,
}: {
  locale: string;
  labels: FooterLabels;
  /** §13.2 — the same resolved list the nav uses, so a denavigated route stays denavigated here. */
  links: FooterLink[];
}) {
  const year = 2026;

  return (
    <footer data-section data-theme="dark" className="section border-t border-hairline">
      <div className="band py-20 lg:py-24">
        <div className="max-w-detail">
          <HireClickBeacon>
            <a
              href={HIRE_DECK_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-display text-title font-black uppercase"
            >
              {/* Non-breaking space: at display size the arrow must not wrap onto a line of its own. */}
              <TextSwap>{labels.hireCta}&nbsp;→</TextSwap>
            </a>
          </HireClickBeacon>
          <p className="mt-6 text-body opacity-70">{labels.hireLede}</p>
        </div>

        <div className="mt-20 grid gap-10 border-t border-hairline pt-10 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto]">
          <div className="flex items-start gap-2.5">
            <GoatMark className="mt-0.5 h-5 w-5" />
            <div>
              <p className="font-display text-[1.05rem] leading-none font-black uppercase">
                {labels.brand}
              </p>
              <p className="mt-2 font-mono text-code opacity-60">
                © {year} {labels.rights} · {labels.builtIn}
              </p>
            </div>
          </div>

          <nav aria-label={labels.navHeading} className="flex flex-col gap-3">
            <p className="font-label text-eyebrow uppercase opacity-60">{labels.navHeading}</p>
            {links.map((link) => (
              <a key={link.href} href={link.href} className="font-label text-eyebrow uppercase">
                <TextSwap>{link.label}</TextSwap>
              </a>
            ))}
          </nav>

          <div className="flex flex-col gap-3">
            <p className="font-label text-eyebrow uppercase opacity-60">{labels.contactHeading}</p>
            <HireClickBeacon>
              <a
                href="mailto:hello@yagiworkshop.xyz?subject=YAGI%20PROMPTS%20%E2%80%94%20studio%20enquiry"
                className="font-mono text-code"
              >
                hello@yagiworkshop.xyz
              </a>
            </HireClickBeacon>
            <a href={`mailto:${labels.adContact}`} className="text-accent font-mono text-code">
              {labels.advertise} · {labels.adContact}
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
