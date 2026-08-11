import { TextSwap } from '@/components/ui/text-swap';
import { GoatMark } from '@/components/nav/goat-mark';

/**
 * PLAN §3.1 — "Footer carries the B2B lead CTA: 'Work with the studio →' (mailto + `hire_click`
 * event). The same strip appears at the bottom of playbook detail pages."
 *
 * The mailto ships now; the `hire_click` row into `events` is wired with the rest of the funnel
 * analytics in M3 (§8), where the events client lands.
 */
export interface FooterLabels {
  hireCta: string;
  hireLede: string;
  advertise: string;
  rights: string;
  builtIn: string;
  navHeading: string;
  contactHeading: string;
  library: string;
  pricing: string;
  brand: string;
  adContact: string;
}

export function SiteFooter({ locale, labels }: { locale: string; labels: FooterLabels }) {
  const year = 2026;

  return (
    <footer data-section data-theme="dark" className="section border-t border-hairline">
      <div className="band py-20 lg:py-24">
        <div className="max-w-detail">
          <a
            href="mailto:hello@yagiworkshop.xyz?subject=PLAYBOOK%20%E2%80%94%20studio%20enquiry"
            className="font-display text-title font-black uppercase"
          >
            {/* Non-breaking space: at display size the arrow must not wrap onto a line of its own. */}
            <TextSwap>{labels.hireCta}&nbsp;→</TextSwap>
          </a>
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
            <a href="/library" className="font-label text-eyebrow uppercase">
              <TextSwap>{labels.library}</TextSwap>
            </a>
            <a href={`/${locale}/pricing`} className="font-label text-eyebrow uppercase">
              <TextSwap>{labels.pricing}</TextSwap>
            </a>
          </nav>

          <div className="flex flex-col gap-3">
            <p className="font-label text-eyebrow uppercase opacity-60">{labels.contactHeading}</p>
            <a
              href="mailto:hello@yagiworkshop.xyz?subject=PLAYBOOK%20%E2%80%94%20studio%20enquiry"
              className="font-mono text-code"
            >
              hello@yagiworkshop.xyz
            </a>
            <a href={`mailto:${labels.adContact}`} className="text-accent font-mono text-code">
              {labels.advertise} · {labels.adContact}
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
