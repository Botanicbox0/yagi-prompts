-- docs/TEMPLATES-IA.md §7 (2026-09-06) — the engine a template renders on and the aspect it opens
-- in. Both are TEXT with the vocabulary in code (lib/images/engines.ts), like `models`: an engine is
-- added monthly and a CHECK would turn "the founder tried a new one" into a migration. NULL means
-- "the medium's default" (video → seedance-2.0 · 9:16, image → gpt-image-2 · 4:5).
alter table prompt_items
  add column if not exists engine text,
  add column if not exists aspect_default text;

-- The two founder-priced films name their engine explicitly: the 15 s interview renders on 2.0
-- (one task), the 30 s prom film needs 2.5 (2.0 tops out at 15 s per task).
update prompt_items set engine = 'seedance-2.0', aspect_default = '16:9' where slug = '90s-seoul-interview' and engine is null;
update prompt_items set engine = 'seedance-2.5', aspect_default = '9:16' where slug = 'you-are-a-prom-queen' and engine is null;
