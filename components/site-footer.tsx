import { TextSwap } from '@/components/ui/text-swap';
import { TwingsLogo } from '@/components/brand/twings-mark';
import { HireClickBeacon } from '@/components/analytics/beacon';

export interface FooterLabels {
  hireCta: string;
  hireLede: string;
  primaryHref: string;
  crossDoor: { href: string; label: string };
  advertise: string;
  rights: string;
  builtIn: string;
  navHeading: string;
  contactHeading: string;
  /** The contact mailto's subject line, in the page's language (audit P2-17). */
  mailSubject: string;
  brand: string;
  /** The house ad and the footer send brands to the same place: the enquiry form. */
  adHref: string;
  /** 전자상거래법 §21 — the seller identification lines, on every page (2026-09-11). */
  business: string[];
  /**
   * Audit P2-9: the way back to /account (내 작품, deletion) from every page. Static-safe — it goes
   * through `/auth/signin?next=/account`, which is a plain redirect for a signed-in reader.
   */
  account?: { href: string; label: string };
}

export interface FooterLink {
  href: string;
  label: string;
}

/** 전자상거래법 §21 / merchant review: terms, refund and privacy, reachable from every page. */
export interface LegalLink extends FooterLink {
  doc: string;
}

export function SiteFooter({
  locale: _locale,
  labels,
  links,
  legalLinks = [],
}: {
  locale: string;
  labels: FooterLabels;
  /** §13.2 — the same resolved list the nav uses, so a denavigated route stays denavigated here. */
  links: FooterLink[];
  legalLinks?: LegalLink[];
}) {
  const year = 2026;

  return (
    <footer data-section data-theme="dark" className="section border-t border-hairline">
      <div className="audience-shell py-16 lg:py-20">
        <div className="max-w-detail">
            <a
              href={labels.primaryHref}
              data-footer-primary
              className="audience-heading inline-block underline-offset-8 hover:underline"
            >
              {/* Non-breaking space: at display size the arrow must not wrap onto a line of its own. */}
              <TextSwap>{labels.hireCta}&nbsp;→</TextSwap>
            </a>
          <p className="mt-6 text-body opacity-70">{labels.hireLede}</p>
          <a href={labels.crossDoor.href} className="mt-6 inline-flex min-h-11 items-center text-sm underline underline-offset-4 opacity-70 hover:opacity-100">{labels.crossDoor.label} →</a>
        </div>

        <div className="mt-20 grid gap-10 border-t border-hairline pt-10 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto]">
          <div>
            {/* The wordmark IS the brand name (2026-08-16); the text beside it said the same word twice. */}
            <TwingsLogo size={16} />
            <p className="mt-3 font-mono text-code opacity-60">
              © {year} {labels.rights} · {labels.builtIn}
            </p>
          </div>

          <nav aria-label={labels.navHeading} className="flex flex-col gap-1">
            <p className="mb-1 font-label text-eyebrow uppercase opacity-60">{labels.navHeading}</p>
            {links.map((link) => (
              <a key={link.href} href={link.href} className="inline-flex min-h-9 items-center font-label text-eyebrow uppercase">
                <TextSwap>{link.label}</TextSwap>
              </a>
            ))}
            {labels.account && (
              <a href={labels.account.href} data-footer-account className="inline-flex min-h-9 items-center font-label text-eyebrow uppercase">
                <TextSwap>{labels.account.label}</TextSwap>
              </a>
            )}
          </nav>

          <div className="flex flex-col gap-1">
            <p className="mb-1 font-label text-eyebrow uppercase opacity-60">{labels.contactHeading}</p>
            <HireClickBeacon>
              <a
                href={`mailto:hello@yagiworkshop.xyz?subject=${encodeURIComponent(labels.mailSubject)}`}
                className="inline-flex min-h-9 items-center font-mono text-code"
              >
                hello@yagiworkshop.xyz
              </a>
            </HireClickBeacon>
            <a href={labels.adHref} data-footer-brands className="inline-flex min-h-9 items-center text-accent font-label text-eyebrow uppercase">
              <TextSwap>{labels.advertise} →</TextSwap>
            </a>
          </div>
        </div>

        {legalLinks.length > 0 && (
          <nav
            data-legal-nav
            className="mt-10 flex flex-wrap gap-x-6 gap-y-1 border-t border-hairline pt-6"
          >
            {legalLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                data-legal-link={link.doc}
                className="inline-flex min-h-9 items-center font-mono text-code opacity-60 underline-offset-4 hover:opacity-100 hover:underline"
              >
                {link.label}
              </a>
            ))}
          </nav>
        )}

        {/* 전자상거래법 §21: who sells this, on the page where it is sold — not only behind a policy link. */}
        {labels.business.length > 0 && (
          <address data-business-info className="mt-5 flex flex-col gap-1 font-mono text-[0.68rem] leading-relaxed not-italic opacity-50">
            {labels.business.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </address>
        )}
      </div>
    </footer>
  );
}
