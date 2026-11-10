-- Brand studio v2: a reference video is read once (docs/BRAND-STUDIO-V2.md §8.2).
--
-- The reading of a library video (lib/brand-studio/film-sheet, a `FilmSheet`) is kept on the asset per
-- language: {"ko": {...}, "en": {...}}. The remix panel, the prompt preview and the job that sends the
-- video reuse it instead of reading the same file again. A failed reading is not stored. The code
-- tolerates the column being absent (it simply reads afresh), so this can be applied after the deploy.
--
-- RLS: brand_studio_assets is already closed to anon/authenticated (0152); a new column changes nothing.

alter table brand_studio_assets add column if not exists film_sheets jsonb;
