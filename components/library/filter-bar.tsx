import { libraryHref, type LibraryFacets, type LibraryQuery } from '@/lib/content/library';
import { TextSwap } from '@/components/ui/text-swap';

/**
 * PLAN §3.2 — "Filters: category, difficulty, tool/model tag. Sort: newest only in v1.
 * Search: server-rendered query over title+summary."
 *
 * A plain GET form: the URL is the state, the server does the filtering, and the whole surface
 * works with JavaScript off. There is no sort control because there is no second sort order — §3.2
 * is explicit, and a select with one option is a lie about the product.
 */

export interface FilterLabels {
  search: string;
  searchPlaceholder: string;
  category: string;
  difficulty: string;
  tag: string;
  all: string;
  apply: string;
  clear: string;
  sortNewest: string;
  categoryLabel: (key: string) => string;
  difficultyLabel: (key: string) => string;
}

function Field({
  name,
  label,
  value,
  options,
  allLabel,
  render,
}: {
  name: string;
  label: string;
  value: string | null;
  options: string[];
  allLabel: string;
  render: (key: string) => string;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="font-label text-eyebrow uppercase opacity-60">{label}</span>
      <select
        name={name}
        defaultValue={value ?? ''}
        className="border border-hairline bg-surface px-3 py-2 font-mono text-code text-on-surface"
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {render(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FilterBar({
  query,
  facets,
  labels,
  filtered,
}: {
  query: LibraryQuery;
  facets: LibraryFacets;
  labels: FilterLabels;
  filtered: boolean;
}) {
  return (
    <form
      method="get"
      action="/library"
      className="grid gap-5 border-y border-hairline py-6 md:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] md:items-end"
    >
      <label className="flex flex-col gap-2">
        <span className="font-label text-eyebrow uppercase opacity-60">{labels.search}</span>
        <input
          type="search"
          name="q"
          defaultValue={query.q}
          placeholder={labels.searchPlaceholder}
          className="border border-hairline bg-surface px-3 py-2 font-mono text-code text-on-surface"
        />
      </label>

      <Field
        name="category"
        label={labels.category}
        value={query.category}
        options={facets.categories}
        allLabel={labels.all}
        render={labels.categoryLabel}
      />
      <Field
        name="difficulty"
        label={labels.difficulty}
        value={query.difficulty}
        options={facets.difficulties}
        allLabel={labels.all}
        render={labels.difficultyLabel}
      />
      <Field
        name="tag"
        label={labels.tag}
        value={query.tag}
        options={facets.tags}
        allLabel={labels.all}
        render={(key) => key}
      />

      <div className="flex items-center gap-5">
        <button
          type="submit"
          className="border border-current px-4 py-2 font-label text-eyebrow uppercase"
        >
          <TextSwap>{labels.apply}</TextSwap>
        </button>
        {filtered && (
          <a href={libraryHref({})} className="text-accent font-label text-eyebrow uppercase">
            <TextSwap>{labels.clear}</TextSwap>
          </a>
        )}
      </div>
    </form>
  );
}
