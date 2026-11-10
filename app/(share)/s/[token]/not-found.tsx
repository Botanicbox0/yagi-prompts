import "@/components/brand-rooms/share/share.css";
import { getRequestLocale } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";

/** A link that does not open (unknown, turned off, expired, or the item is gone): one plain sentence, no way in. */
export default async function ShareNotFound() {
  const p = getDictionary(await getRequestLocale()).roomsReview.page;
  return (
    <div className="brh-page" data-share-missing>
      <main className="brh-gate" id="main">
        <h1>{p.notFoundTitle}</h1>
        <p>{p.notFoundLine}</p>
      </main>
    </div>
  );
}
