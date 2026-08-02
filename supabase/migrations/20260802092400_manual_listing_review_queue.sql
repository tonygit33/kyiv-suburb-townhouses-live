create table if not exists public.listing_manual_reviews (
  unit_id uuid primary key references public.units(id) on delete cascade,
  source_url text,
  status text not null default 'pending' check (status in ('pending','in_progress','verified','blocked','retired')),
  source_access_status text not null default 'not_checked' check (source_access_status in ('not_checked','accessible','search_only','blocked','removed')),
  source_checked_at timestamptz,
  verified_fields jsonb not null default '{}'::jsonb,
  unresolved_fields text[] not null default '{}'::text[],
  evidence_urls text[] not null default '{}'::text[],
  source_photo_count integer,
  photo_target_count integer not null default 5 check (photo_target_count >= 5),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists listing_manual_reviews_status_idx
  on public.listing_manual_reviews(status, updated_at desc);

alter table public.listing_manual_reviews enable row level security;
revoke all on table public.listing_manual_reviews from public, anon, authenticated;

insert into public.listing_manual_reviews (
  unit_id, source_url, status, source_access_status, source_photo_count,
  photo_target_count, unresolved_fields, notes
)
select
  u.id,
  u.source_url,
  'pending',
  'not_checked',
  coalesce(p.photo_count, 0),
  5,
  array['source_text','all_source_photo_urls','street_or_address','seller_role','current_price']::text[],
  'Черга пооб’єктної ручної перевірки першоджерела.'
from public.units u
join public.developments dv on dv.id = u.development_id
left join lateral (
  select count(*)::integer as photo_count
  from public.unit_photos up
  where up.unit_id = u.id and up.status in ('external','ready')
) p on true
where u.publication = 'published' and dv.publication = 'published'
on conflict (unit_id) do update set
  source_url = excluded.source_url,
  source_photo_count = excluded.source_photo_count,
  photo_target_count = greatest(public.listing_manual_reviews.photo_target_count, 5),
  updated_at = now();

update public.units
set publication = 'review',
    inventory_label = 'Ручна перевірка першоджерела',
    inventory_confidence = 'manual_review',
    updated_at = now()
where publication = 'published'
  and slug <> 'llm-listing-olx-100ocb'
  and coalesce(description, '') ilike '%Дані автоматично витягнуті з оголошення%';

insert into public.developers (
  slug, name, description, verification, checked_at, business_scale,
  scale_reason, supplier_type, role_confidence, public_role_label,
  raw_data, updated_at
)
values (
  'olx-artem-100ocb',
  'Артем (OLX)',
  'Ім’я продавця взято з профілю джерела. Власник, рієлтор чи забудовник ще не підтверджено.',
  'review',
  date '2026-08-02',
  'micro',
  'Окремий профіль продавця маркетплейсу; юридична роль не встановлена.',
  'marketplace_seller',
  0.40,
  'Артем — продавець з OLX, роль не підтверджена',
  jsonb_build_object(
    'source_url', 'https://www.olx.ua/d/uk/obyavlenie/taunhaus-z-dokumentami-vorzel-ID100OcB.html',
    'source_profile_name', 'Артем',
    'verification_note', 'Ім’я підтверджене з імпортованих даних джерела; роль не підтверджена.'
  ),
  now()
)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  verification = excluded.verification,
  checked_at = excluded.checked_at,
  supplier_type = excluded.supplier_type,
  role_confidence = excluded.role_confidence,
  public_role_label = excluded.public_role_label,
  raw_data = public.developers.raw_data || excluded.raw_data,
  updated_at = now();

update public.developments
set developer_id = (select id from public.developers where slug = 'olx-artem-100ocb'),
    address = 'Ворзель, вул. Кленова',
    description = null,
    checked_at = date '2026-08-02',
    inventory_label = 'Перевірено частково: площа та вулиця',
    inventory_checked_at = date '2026-08-02',
    updated_at = now()
where slug = 'llm-listing-olx-100ocb';

update public.units
set area_m2 = 115,
    land_area_sotka = null,
    floors = null,
    bedrooms = null,
    address = 'Ворзель, вул. Кленова',
    description = null,
    checked_at = date '2026-08-02',
    publication = 'published',
    inventory_label = 'Перевірено частково: площа та вулиця',
    inventory_confidence = 'manual_review',
    latitude = 50.5468900,
    longitude = 30.1450500,
    coordinate_precision = 'street',
    coordinate_source = 'manual_web_review:olx_search+street_geocode',
    geocoded_at = now(),
    updated_at = now()
where slug = 'llm-listing-olx-100ocb';

update public.listing_manual_reviews r
set status = 'in_progress',
    source_access_status = 'search_only',
    source_checked_at = now(),
    verified_fields = jsonb_build_object(
      'title', 'source_search_result',
      'area_m2', 'source_search_result',
      'street', 'source_search_result',
      'coordinates', 'approximate_street_geocode',
      'seller_name', 'imported_source_profile'
    ),
    unresolved_fields = array['full_source_text','land_area_sotka','floors','bedrooms','exact_house_number','all_source_photo_urls','seller_role','current_price']::text[],
    evidence_urls = array['https://www.olx.ua/d/uk/obyavlenie/taunhaus-z-dokumentami-vorzel-ID100OcB.html']::text[],
    source_photo_count = (select count(*)::integer from public.unit_photos up where up.unit_id = r.unit_id and up.status in ('external','ready')),
    notes = 'Пряме відкриття OLX заблоковане інструментом. Площа 115 м² і вул. Кленова підтверджені пошуковою видачею; координати поставлені приблизно на рівні вулиці. Текст та повна галерея не вигадувалися.',
    updated_at = now()
where r.unit_id = (select id from public.units where slug = 'llm-listing-olx-100ocb');
