import type { UpgradeIntent } from '@/lib/billing/links';
import { TextSwap } from '@/components/ui/text-swap';

/**
 * The one money CTA, rendered from a resolved `UpgradeIntent` (PLAN §3.4, §5.5).
 *
 * Why a component and not three call sites: the locked block, the bottom-of-page Pro strip and the
 * account panel must all send the same reader to the same place, and the *place* depends on the
 * viewer's tier. Resolving the intent once on the server (`upgradeIntent()`) and rendering it here
 * means there is exactly one answer to "what happens when someone clicks unlock".
 *
 * The checkout branch is a real `<form method="post">`, not a link with an onClick: creating a
 * Checkout Session is a side effect (so not a GET), and a form needs no client JavaScript — the
 * conversion path keeps working with scripts blocked.
 */

export function UpgradeCta({
  intent,
  label,
  className,
  arrow = '→',
}: {
  intent: UpgradeIntent;
  label: string;
  className?: string;
  arrow?: string;
}) {
  const content = (
    <TextSwap>
      {label} {arrow}
    </TextSwap>
  );

  if (intent.kind === 'checkout') {
    return (
      <form method="post" action={intent.action} data-upgrade="checkout" className="inline-block">
        <input type="hidden" name="locale" value={intent.locale} />
        {intent.slug !== null && <input type="hidden" name="slug" value={intent.slug} />}
        <button type="submit" className={className}>
          {content}
        </button>
      </form>
    );
  }

  return (
    <a href={intent.href} data-upgrade={intent.kind} className={className}>
      {content}
    </a>
  );
}

/**
 * §11's honest degradation, as a designed panel rather than a dead button.
 *
 * Shown wherever a purchase would otherwise start on a deployment with no Stripe configured. It is
 * a statement of fact, not an error state — the pricing is real, the checkout simply is not wired
 * here yet, and saying so is better than a 503 the reader has to interpret.
 */
export function BillingUnavailable({
  title,
  body,
  className,
}: {
  title: string;
  body: string;
  className?: string;
}) {
  return (
    <aside
      data-billing="unavailable"
      className={['border border-hairline p-6 sm:p-8', className].filter(Boolean).join(' ')}
    >
      <p className="font-display text-[clamp(1.35rem,2.2vw,1.75rem)] leading-[1] font-black uppercase">
        {title}
      </p>
      <p className="mt-4 max-w-detail text-body opacity-70">{body}</p>
    </aside>
  );
}
