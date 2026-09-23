import type { BrandCopy } from "./action-form";

/**
 * The URL named a brand this account cannot open (mistyped, forged or access removed). Said plainly,
 * with no other brand's data shown in its place; the sidebar selector lists what can be opened.
 */
export function BrandUnavailable({ b }: { b: BrandCopy }) {
  return (
    <section className="bw-empty" data-brand-unavailable>
      <h1>{b.identity.unavailable}</h1>
      <p>{b.identity.unavailableBody}</p>
      <a href="/brand" className="bw-button">{b.back}</a>
    </section>
  );
}
