-- PLAYBOOK · core migration 0014 — a campaign's format is a studio style (2026-09-03)
--
-- 0013 required an uploaded, published poster before a campaign could recruit — the contest rule,
-- copied. But a campaign's poster is not its own: the FORMAT the creators reproduce is a studio
-- style (`style_slug` → a published prompt), and that prompt already owns a poster and a result
-- film the campaign page shows. Requiring a second upload would be a second copy of the same
-- image to keep in step. The `media` column stays for the day a campaign wants its own art; the
-- gate goes.
alter table campaigns drop constraint if exists campaigns_public_requires_poster;
