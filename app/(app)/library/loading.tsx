import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { LibrarySkeleton } from '@/components/library/grid';

/**
 * PLAN §3.2 — "Empty/loading states: skeletons (no spinners)."
 *
 * The route is dynamic, so this is what the reader sees while the catalog query runs. It mirrors
 * the real grid's geometry exactly, which is the whole point of a skeleton: no layout shift when
 * the content arrives, and no spinner pretending the wait is indeterminate.
 */
export default async function LibraryLoading() {
  const locale = await getLocaleFromHeaders();
  const dict = getDictionary(locale);

  return (
    <div data-theme="light" className="section min-h-screen">
      <div className="border-b border-hairline">
        <div className="mx-auto flex max-w-shell items-center px-gutter py-5">
          <div className="h-5 w-32 bg-hairline" />
        </div>
      </div>
      <main className="py-16 lg:py-20">
        <div className="band">
          <div className="h-3 w-24 bg-hairline" />
          <div className="mt-6 h-12 w-2/3 bg-hairline" />
          <div className="mt-12 h-20 w-full border-y border-hairline" />
          <div className="mt-10">
            <LibrarySkeleton label={dict.library.loading} />
          </div>
        </div>
      </main>
    </div>
  );
}
