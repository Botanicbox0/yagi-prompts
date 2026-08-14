-- PLAYBOOK · core migration 0009
-- Founder direction (2026-08-14): "구체적인 제작 과정을 노션에 설명하듯이 아래 추가할 수 있어도
-- 좋을 것 같아. 특히 유저들이 이렇게 쓰고 싶어할 것 같아서."
--
-- A prompt is the input. What people actually want to read — and what a community submitter wants
-- room to write — is HOW the thing was made: the references, the passes, the settings that failed,
-- the edit that saved it. `prompt_items` grows one markdown column per locale for exactly that.
--
-- Why markdown and not a block table: §13.1 chose ATOMIC rows for prompts on purpose ("deliberately
-- NOT the revision machinery"). The playbook side already owns structured, revisioned, per-block
-- content; duplicating it here would buy nothing and cost the whole publish pipeline. Markdown is
-- rendered by the SAME server-side renderer the contests brief uses (components/playbook/markdown),
-- which is a strict subset — no raw HTML — so a community submission cannot inject markup.
--
-- Nullable and unconstrained at the database: an empty write-up is the norm (most prompts are just
-- a prompt), the length cap is a zod rule at the boundary, and the LOCALE rule is deliberately
-- looser than the title's: a Korean-only process note on a Korean prompt is honest content, not an
-- incomplete translation, so nothing here forces a pair.

alter table prompt_items add column if not exists process_md text;
alter table prompt_items add column if not exists process_md_ko text;
