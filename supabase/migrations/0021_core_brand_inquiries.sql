-- PLAYBOOK · core migration 0021 — brand enquiries (founder, 2026-09-11: "브랜드 의뢰 폼").
--
-- Before: the only thing a brand could do on the campaigns page was open a mailto. Now the page
-- carries a form, and every enquiry is a row the studio works from: who, budget band, the format
-- they want, when, and the consent moment. Status is the studio's own bookkeeping (new →
-- contacted → closed); nothing here is public and nothing is ever read by the browser.
create table if not exists brand_inquiries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  locale text not null default 'ko' check (locale in ('en', 'ko')),
  company text not null check (char_length(company) between 1 and 120),
  contact_name text not null check (char_length(contact_name) between 1 and 80),
  email text not null check (char_length(email) between 3 and 254),
  phone text check (phone is null or char_length(phone) <= 40),
  budget_band text not null check (budget_band in ('under_3m', '3m_10m', '10m_30m', 'over_30m', 'undecided')),
  -- A published template slug, or the two words the form offers: 'new' (a brand-only scene) / 'undecided'.
  template_slug text check (template_slug is null or char_length(template_slug) <= 120),
  timing text check (timing is null or char_length(timing) <= 120),
  message text not null check (char_length(message) between 1 and 4000),
  -- The consent checkbox, as a moment: the privacy statement names what is kept and for how long.
  consent_at timestamptz not null,
  -- Signed-in brands leave a trail to their account; anonymous ones do not have to.
  user_id uuid references profiles on delete set null,
  status text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  contacted_at timestamptz,
  notes text
);

create index if not exists brand_inquiries_status_idx on brand_inquiries (status, created_at desc);
-- The per-address daily cap the service enforces reads this.
create index if not exists brand_inquiries_email_idx on brand_inquiries (email, created_at desc);
