/**
 * PLAN §15.3 — the cookie table: 가입 3 · 주 1 · $4/5, as three cells in the §5 grid language.
 *
 * The same hairline-gap grid `PlanCards` used for Free/Pro, because the design system did not
 * change — the ECONOMY did. Each cell is a display-type figure over one plain sentence; the one
 * rule of the whole model (one cookie, one prompt, forever) sits under the grid in mono, where
 * the fine print lives on every other §5 surface. Pure and session-free by construction: the
 * pricing page is static (§3.1) and this component gives it no reason not to be.
 */

export interface CookieCell {
  title: string;
  value: string;
  note: string;
}

export function CookieTable({ cells, rule }: { cells: CookieCell[]; rule: string }) {
  return (
    <div data-cookie-table>
      <div className="grid gap-px border border-hairline bg-hairline sm:grid-cols-3">
        {cells.map((cell) => (
          <section key={cell.title} className="flex flex-col bg-surface p-7 lg:p-9">
            <p className="font-label text-eyebrow uppercase opacity-60">{cell.title}</p>
            <p className="mt-4 font-display text-[clamp(2.5rem,5vw,4rem)] leading-[0.85] font-black">
              {cell.value}
            </p>
            <p className="mt-4 text-[0.9375rem] leading-snug opacity-70">{cell.note}</p>
          </section>
        ))}
      </div>
      <p className="mt-5 font-mono text-code opacity-60">{rule}</p>
    </div>
  );
}
