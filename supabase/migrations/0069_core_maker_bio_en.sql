-- CLOUD APPLICATION REQUIRED. docs/PLATFORM-2.0.md §7.5 — a maker's bio in English, next to the bio
-- (0060) they wrote for the Korean pages. Followers arrive from Instagram and TikTok on `/en/…` as
-- often as on `/ko/…`; `/en` pages show `bio_en` and fall back to `bio` when it is empty. Public only
-- under the same opt-in as `bio` (`public_profile`). platform_creators keeps 0131's deny-all posture,
-- which the new column inherits, so no glue file. Readers probe for the column
-- (lib/makers/profile.ts), so code deployed before this file keeps answering exactly as before.
alter table platform_creators
 add column if not exists bio_en text check(bio_en is null or char_length(bio_en) between 1 and 200);
