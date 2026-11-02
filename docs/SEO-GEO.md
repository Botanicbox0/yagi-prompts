# Public search and AI reading surface

Implemented against the public catalog and current product availability. The marketing layout emits the operator Organization and WebSite. The FAQ catalog selects the same localized question/answer pairs for visible HTML and FAQPage JSON-LD; no hidden answers are added for crawlers. `/ko/faq` and `/en/faq` group the catalog by usage, payment, rights, creator campaigns and brands. Existing reciprocal locale alternates are retained, including self-canonical and the English x-default.

## Deliberate eligibility rules

- **Template video:** emit VideoObject only with a real published public URL for the example video and thumbnail, plus a valid publication timestamp. The local `/api` media fallback is excluded because robots disallows it. Duration comes from the example media, never from the requested render length. Missing fields are omitted rather than inferred from the current date.
- **Template purchase:** emit Product/Offer only when public generation is enabled, the template is actually for sale and stored KRW pricing is positive. Current public generation is closed, so there is no public purchase Offer. English pages presently display USD; a KRW Offer must not appear there until the visible price and actual charge currency agree.
- **Campaign:** Service describes the studio campaign; a recruiting detail can carry a price-free Offer for that opportunity. It is not an Event, and creator compensation is not emitted as a product price. No ratings, individual creator payments, internal margin or projected views are invented.
- **Operator identity:** legal name/contact come from the existing public business record; logo is the shipped public asset. `sameAs` remains absent until an official external profile has been verified.
- **Sitemap:** include the FAQ and public catalog pages with reciprocal language alternatives. Use an actual catalog update/publication timestamp, or a supplied editorial modification timestamp. Omit unknown dates; generating a sitemap is not a page update. Do not list private workspaces.
- **LLM reading aids:** `/llms.txt` and `/llms-full.txt` provide public context and policy links. They make the limited generation rollout explicit and do not advertise planned subscriptions, social connections or native apps as released.

## Current official guidance, checked 2026-09-20

Google retired **FAQ rich results on May 7, 2026** and removed the feature documentation on June 15. FAQPage remains a Schema.org vocabulary type, but passing a Google FAQ Rich Results test is no longer a meaningful acceptance criterion. Use visible-answer parity, valid JSON and semantic validation for FAQ; use Google's current supported feature checks for VideoObject/Product where eligible. See [Google Search documentation updates](https://developers.google.com/search/updates) and [Schema.org FAQPage](https://schema.org/FAQPage).

Google says its AI search features do not require a special schema or an AI text file. `llms.txt` does not improve or harm Google ranking. This work improves explicit, accessible service information and machine-readable consistency; it does not guarantee ranking, traffic, rich results or inclusion in an AI answer. See [AI features and your website](https://developers.google.com/search/docs/appearance/ai-features) and the June 15 entry in the [official updates](https://developers.google.com/search/updates).

Other primary references:

- [VideoObject required and recommended fields](https://developers.google.com/search/docs/appearance/structured-data/video)
- [Product and Offer markup](https://developers.google.com/search/docs/appearance/structured-data/product-snippet)
- [Reciprocal locale URLs and x-default](https://developers.google.com/search/docs/specialty/international/localized-versions)
- [Accurate sitemap modification dates](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Schema.org Service](https://schema.org/Service)

## Verification boundary

`tests/seo/structured-data.test.ts` covers safe script serialization, actual video metadata, closed/invalid-price offers, campaign semantics, duplicate/empty FAQ answers and LLM-file disclosure limits. Sitemap tests cover FAQ inclusion, reciprocal alternates and real timestamps. `scripts/sweep-anon.ts` checks JSON-LD from actual HTML, locale canonicals/alternates, FAQ markers, sitemap entries and public reading aids during the full local validation loop.

Preview/live URL reachability, video crawlability and any current supported Rich Results diagnostics still require checks against the built deployment. Unit tests alone do not establish search-engine eligibility or public indexing.
