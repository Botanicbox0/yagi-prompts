/**
 * PLAN §3.1 — FAQ.
 *
 * Native `<details>/<summary>`: keyboard- and screen-reader-correct out of the box, zero
 * JavaScript, and the answers are in the static HTML, which is where a crawler wants them.
 */
export interface FaqItem {
  q: string;
  a: string;
}

export function Faq({
  eyebrow,
  title,
  items,
}: {
  eyebrow: string;
  title: string;
  items: FaqItem[];
}) {
  return (
    <div className="band py-24 lg:py-32">
      <p className="text-accent font-label text-eyebrow uppercase">{eyebrow}</p>
      <h2 className="mt-6 max-w-detail font-display text-title font-black uppercase">{title}</h2>

      {/* A list of <details>, not a <dl>: `<dl>` may only contain dt/dd (optionally inside a
          single <div>), so wrapping a disclosure widget in one is invalid markup and axe flags it. */}
      <ul className="mt-14 list-none border-t border-hairline">
        {items.map((item) => (
          <li key={item.q} className="border-b border-hairline">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-6 py-6 [&::-webkit-details-marker]:hidden">
                <h3 className="text-[1.0625rem] leading-snug font-medium">{item.q}</h3>
                <span
                  aria-hidden
                  className="text-accent mt-1 shrink-0 font-mono text-code select-none group-open:hidden"
                >
                  +
                </span>
                <span
                  aria-hidden
                  className="text-accent mt-1 hidden shrink-0 font-mono text-code select-none group-open:block"
                >
                  −
                </span>
              </summary>
              <p className="max-w-detail pb-7 text-body opacity-70">{item.a}</p>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
