-- Harden the public, passwordless property inquiry flow without requiring sign-in.
create table if not exists private.property_lead_rate_limits (
  fingerprint_hash text not null,
  window_started_at timestamptz not null,
  submission_count integer not null default 0 check (submission_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (fingerprint_hash, window_started_at)
);

revoke all on table private.property_lead_rate_limits from public, anon, authenticated;

alter table public.property_leads alter column unit_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.property_leads'::regclass
      and conname = 'property_leads_unit_id_fkey'
  ) then
    alter table public.property_leads
      add constraint property_leads_unit_id_fkey
      foreign key (unit_id) references public.units(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.property_leads'::regclass
      and conname = 'property_leads_phone_length_check'
  ) then
    alter table public.property_leads
      add constraint property_leads_phone_length_check
      check (phone is null or char_length(phone) <= 40);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.property_leads'::regclass
      and conname = 'property_leads_email_length_check'
  ) then
    alter table public.property_leads
      add constraint property_leads_email_length_check
      check (email is null or char_length(email) <= 254);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.property_leads'::regclass
      and conname = 'property_leads_message_length_check'
  ) then
    alter table public.property_leads
      add constraint property_leads_message_length_check
      check (message is null or char_length(message) <= 2000);
  end if;
end
$$;

create index if not exists property_leads_recent_contact_idx
  on public.property_leads (unit_id, created_at desc)
  include (phone, email);

create or replace function public.submit_property_lead(
  p_unit_id uuid,
  p_customer_name text,
  p_phone text default null,
  p_email text default null,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_seller uuid;
  v_id uuid;
  v_existing_id uuid;
  v_name text := btrim(coalesce(p_customer_name, ''));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_phone_digits text;
  v_fingerprint text;
  v_window timestamptz;
  v_count integer;
begin
  if p_unit_id is null then
    raise exception 'Оберіть об’єкт';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'Ім’я має містити від 2 до 120 символів';
  end if;

  if v_phone is null and v_email is null then
    raise exception 'Вкажіть телефон або email';
  end if;

  if v_phone is not null then
    if char_length(v_phone) > 40 then
      raise exception 'Телефон надто довгий';
    end if;
    v_phone_digits := regexp_replace(v_phone, '\D', '', 'g');
    if char_length(v_phone_digits) < 7 or char_length(v_phone_digits) > 15 then
      raise exception 'Перевірте номер телефону';
    end if;
  end if;

  if v_email is not null then
    if char_length(v_email) > 254
       or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'Перевірте email';
    end if;
  end if;

  if v_message is not null and char_length(v_message) > 2000 then
    raise exception 'Повідомлення надто довге';
  end if;

  if not exists (select 1 from public.site_units where id = p_unit_id) then
    raise exception 'Об’єкт не знайдено';
  end if;

  select pl.id
    into v_existing_id
    from public.property_leads pl
   where pl.unit_id = p_unit_id
     and pl.created_at > now() - interval '30 minutes'
     and (
       (v_phone is not null and pl.phone = v_phone)
       or (v_email is not null and lower(pl.email) = v_email)
     )
   order by pl.created_at desc
   limit 1;

  if v_existing_id is not null then
    return jsonb_build_object(
      'id', v_existing_id,
      'assigned', true,
      'duplicate', true
    );
  end if;

  v_fingerprint := encode(
    extensions.digest(coalesce(v_phone, '') || '|' || coalesce(v_email, ''), 'sha256'),
    'hex'
  );
  v_window := date_bin(
    interval '15 minutes',
    clock_timestamp(),
    timestamptz '2001-01-01 00:00:00+00'
  );

  insert into private.property_lead_rate_limits(
    fingerprint_hash, window_started_at, submission_count
  ) values (v_fingerprint, v_window, 0)
  on conflict (fingerprint_hash, window_started_at) do nothing;

  select submission_count
    into v_count
    from private.property_lead_rate_limits
   where fingerprint_hash = v_fingerprint
     and window_started_at = v_window
   for update;

  if v_count >= 3 then
    raise exception 'Забагато заявок. Спробуйте пізніше';
  end if;

  update private.property_lead_rate_limits
     set submission_count = submission_count + 1,
         updated_at = now()
   where fingerprint_hash = v_fingerprint
     and window_started_at = v_window;

  select suc.user_id
    into v_seller
    from public.seller_unit_claims suc
   where suc.unit_id = p_unit_id
     and suc.status = 'active'
   order by suc.created_at desc
   limit 1;

  insert into public.property_leads(
    unit_id,
    customer_user_id,
    assigned_seller_user_id,
    customer_name,
    phone,
    email,
    message
  ) values (
    p_unit_id,
    auth.uid(),
    v_seller,
    v_name,
    v_phone,
    v_email,
    v_message
  )
  returning id into v_id;

  delete from private.property_lead_rate_limits
   where window_started_at < now() - interval '2 days';

  return jsonb_build_object(
    'id', v_id,
    'assigned', v_seller is not null,
    'duplicate', false
  );
end
$$;

revoke all on function public.submit_property_lead(uuid,text,text,text,text) from public;
grant execute on function public.submit_property_lead(uuid,text,text,text,text) to anon, authenticated;
