-- docs/TEMPLATES-IA.md §1 (2026-09-05) — a prompt item IS a template. Three columns make it
-- sellable and sortable as one: the medium it produces, the price of one render, and the runtime
-- of a film. The prompt text stays where it is and becomes server-only: the catalogue is split by
-- what comes OUT (video / image), never by what went in.
alter table prompt_items
  add column if not exists medium text not null default 'video'
    constraint prompt_items_medium_known check (medium in ('video', 'image')),
  add column if not exists price_cents integer not null default 0
    constraint prompt_items_price_non_negative check (price_cents >= 0),
  add column if not exists runtime_seconds integer
    constraint prompt_items_runtime_positive check (runtime_seconds is null or runtime_seconds > 0);

-- An image has no runtime; a row that claims one is a video mislabelled.
alter table prompt_items
  add constraint prompt_items_image_has_no_runtime
    check (medium <> 'image' or runtime_seconds is null);

-- The two tabs read by medium and status; the rail order underneath is unchanged.
create index if not exists prompt_items_medium_status_idx on prompt_items (medium, status);

-- The founder's prices (2026-08-16) move from lib/twings/products.ts into the rows they price.
-- `price_cents = 0` means "not for sale yet" — the detail page says so instead of showing a button.
update prompt_items set price_cents = 400, runtime_seconds = 15 where slug = '90s-seoul-interview';
update prompt_items set price_cents = 700, runtime_seconds = 30 where slug = 'you-are-a-prom-queen';
