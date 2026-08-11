/**
 * PLAN §3.4 — the row-by-row Free vs Pro comparison.
 *
 * A real `<table>` with scoped headers rather than a grid of divs: it is tabular data, and the
 * "included / not included" cells carry visually-hidden text so a screen reader hears the answer
 * instead of a decorative glyph.
 */

export interface PlanRow {
  label: string;
  free: boolean;
  pro: boolean;
}

export function PlanTable({
  heading,
  columnFeature,
  freeLabel,
  proLabel,
  includedLabel,
  notIncludedLabel,
  rows,
}: {
  heading: string;
  columnFeature: string;
  freeLabel: string;
  proLabel: string;
  includedLabel: string;
  notIncludedLabel: string;
  rows: PlanRow[];
}) {
  const cell = (on: boolean) => (
    <td className="border-t border-hairline px-3 py-5 text-center">
      <span className="sr-only">{on ? includedLabel : notIncludedLabel}</span>
      {on ? (
        <span aria-hidden className="text-accent font-mono text-code">
          ●
        </span>
      ) : (
        <span aria-hidden className="font-mono text-code opacity-25">
          —
        </span>
      )}
    </td>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] border-collapse text-left">
        <caption className="sr-only">{heading}</caption>
        <thead>
          <tr>
            <th scope="col" className="pb-4 font-label text-eyebrow uppercase opacity-60">
              {columnFeature}
            </th>
            <th
              scope="col"
              className="w-28 pb-4 text-center font-label text-eyebrow uppercase opacity-60"
            >
              {freeLabel}
            </th>
            <th scope="col" className="text-accent w-28 pb-4 text-center font-label text-eyebrow uppercase">
              {proLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th
                scope="row"
                className="border-t border-hairline py-5 pr-6 text-[0.9375rem] leading-snug font-normal opacity-80"
              >
                {row.label}
              </th>
              {cell(row.free)}
              {cell(row.pro)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
