-- PLAYBOOK · core migration 0011
-- Founder direction (2026-08-15): "단순히 brand뿐만 아니라 higgsfield나 플랫폼이나 다 관계없이
-- 콘테스트 열 수 있게 설계되었으면 좋겠음."
--
-- The table said `brand_name`, so the whole product said 브랜드: the card chip, the detail strip,
-- the listing's pitch. A PLATFORM running a credits contest, a STUDIO running a spec brief and a
-- CREATOR running a community jam all had to call themselves a brand in order to exist here. The
-- host is now a first-class thing with a kind, a mark and a link.
--
-- Renamed rather than aliased: `contests` was verified EMPTY before this ran, so there is no data
-- to preserve and no reason to carry two names for one concept. (Constraint expressions follow a
-- column rename automatically; the constraint NAMES are renamed here so the error mapper's
-- patterns keep matching what they describe.)
--
-- Prize gets the same treatment. It was ONE localized sentence — "$3,000 · 1st $1,500 / 2nd $1,000"
-- — that the surface took apart at a middle dot. A credits prize and a cash prize were therefore
-- indistinguishable to the code, and the card could not lead with the number. It becomes three
-- things: a KIND the dictionary translates, a TOTAL that stays the author's own string (localized,
-- because "₩500만" and "$3,500" are not a translation of each other), and up to three TIERS.

-- ---------------------------------------------------------------------------
-- brand → host
-- ---------------------------------------------------------------------------
alter table contests rename column brand_name to host_name;
alter table contests rename column brand_url to host_url;
alter table contests rename constraint contests_brand_name_present to contests_host_name_present;
alter table contests rename constraint contests_brand_url_http to contests_host_url_http;

/**
 * Who is asking. Five kinds, fixed, translated at the UI layer — a free-text "type" field would be
 * a filter that never converges, and a boolean `is_brand` would be the same mistake with fewer
 * options. `brand` is the default because every existing caller meant one.
 */
alter table contests add column if not exists host_kind text not null default 'brand';
-- The host's MARK is not a column: it rides in `media` as a third kind (`media.logo`), so it
-- inherits the lifecycle that already exists — staged private, copied to a content-addressed public
-- key on publish, served by the one `/api/contests/media/{id}:{kind}` route. A dedicated column
-- would have meant a second copier and a second route for the same kind of object.

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contests_host_kind_known') then
    alter table contests add constraint contests_host_kind_known
      check (host_kind in ('brand','platform','studio','creator','community'));
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- prize: one sentence → kind + total + tiers
-- ---------------------------------------------------------------------------
alter table contests rename column prize to prize_total;

alter table contests add column if not exists prize_kind text not null default 'cash';
alter table contests add column if not exists prize_tiers jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contests_prize_kind_known') then
    alter table contests add constraint contests_prize_kind_known
      check (prize_kind in ('cash','credits','subscription','gear','feature','mixed'));
  end if;

  -- Shape is zod's job at the boundary (the same doctrine `media` already follows); what SQL owns
  -- is the part a bad write could make unrenderable: it must be an array, and there are three
  -- places on a podium.
  if not exists (select 1 from pg_constraint where conname = 'contests_prize_tiers_shape') then
    alter table contests add constraint contests_prize_tiers_shape
      check (jsonb_typeof(prize_tiers) = 'array' and jsonb_array_length(prize_tiers) <= 3);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- announce_at — the question every entrant asks second
-- ---------------------------------------------------------------------------
--
-- "언제 발표해요?" was answerable only in the rules markdown, which meant it could not be a chip, a
-- countdown or a sort key. Nullable: a host who has not decided says nothing rather than a date it
-- will miss. It may equal the deadline (announced on the day) but never precede it.
alter table contests add column if not exists announce_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contests_announce_after_deadline') then
    alter table contests add constraint contests_announce_after_deadline
      check (announce_at is null or deadline_at is null or announce_at >= deadline_at);
  end if;
end
$$;
