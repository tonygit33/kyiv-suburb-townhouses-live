create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('buyer','seller')),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

alter table public.user_roles enable row level security;

drop policy if exists user_roles_self_select on public.user_roles;
create policy user_roles_self_select
on public.user_roles for select
to authenticated
using (user_id = auth.uid());

revoke all on table public.user_roles from anon, authenticated;
grant select on table public.user_roles to authenticated;

insert into public.user_roles(user_id, role)
select id, 'buyer' from public.user_profiles
on conflict do nothing;

insert into public.user_roles(user_id, role)
select id, 'seller' from public.user_profiles where role in ('seller','admin')
on conflict do nothing;

create or replace function public.ensure_user_profile()
returns public.user_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare p public.user_profiles;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;

  insert into public.user_profiles(id, display_name)
  values (
    auth.uid(),
    coalesce(auth.jwt()->'user_metadata'->>'full_name', split_part(coalesce(auth.jwt()->>'email',''), '@', 1))
  )
  on conflict (id) do nothing;

  insert into public.user_roles(user_id, role)
  values (auth.uid(), 'buyer')
  on conflict do nothing;

  insert into public.user_roles(user_id, role)
  select id, 'seller' from public.user_profiles
  where id = auth.uid() and role in ('seller','admin')
  on conflict do nothing;

  select * into p from public.user_profiles where id = auth.uid();
  return p;
end;
$$;

create or replace function public.current_user_account()
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  p public.user_profiles;
  account_roles text[];
  admin_access boolean := false;
begin
  if auth.uid() is null then return null; end if;
  perform public.ensure_user_profile();
  select * into p from public.user_profiles where id = auth.uid();
  select coalesce(array_agg(role order by role), array[]::text[])
    into account_roles
    from public.user_roles where user_id = auth.uid();
  admin_access := private.current_user_is_site_admin();
  return jsonb_build_object(
    'id', p.id,
    'display_name', p.display_name,
    'phone', p.phone,
    'email', auth.jwt()->>'email',
    'roles', account_roles,
    'can_buy', 'buyer' = any(account_roles),
    'can_sell', 'seller' = any(account_roles),
    'is_admin', admin_access,
    'legacy_role', p.role,
    'created_at', p.created_at,
    'updated_at', p.updated_at
  );
end;
$$;

create or replace function public.update_my_profile(p_display_name text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare p public.user_profiles;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  perform public.ensure_user_profile();
  update public.user_profiles
     set display_name = nullif(btrim(p_display_name),''),
         phone = nullif(btrim(p_phone),''),
         updated_at = now()
   where id = auth.uid()
   returning * into p;
  return public.current_user_account();
end;
$$;

create or replace function public.accept_seller_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inv public.seller_invites;
  u uuid := auth.uid();
  unit uuid;
begin
  if u is null then raise exception 'authentication_required'; end if;
  if nullif(btrim(p_token),'') is null then raise exception 'invite_token_required'; end if;

  select * into inv from public.seller_invites
   where token_hash = encode(digest(btrim(p_token), 'sha256'), 'hex')
   for update;
  if inv.id is null then raise exception 'invite_not_found'; end if;
  if inv.status <> 'pending' then raise exception 'invite_not_pending'; end if;
  if inv.expires_at < now() then
    update public.seller_invites set status='expired' where id=inv.id;
    raise exception 'invite_expired';
  end if;
  if inv.email is not null and lower(inv.email) <> lower(coalesce(auth.jwt()->>'email','')) then
    raise exception 'invite_email_mismatch';
  end if;

  insert into public.user_profiles(id, role, display_name)
  values (u, 'seller', split_part(coalesce(auth.jwt()->>'email','seller'), '@', 1))
  on conflict (id) do update set role='seller', updated_at=now();

  insert into public.user_roles(user_id, role) values (u,'buyer') on conflict do nothing;
  insert into public.user_roles(user_id, role) values (u,'seller') on conflict do nothing;

  foreach unit in array inv.unit_ids loop
    insert into public.seller_unit_claims(user_id,seller_id,unit_id)
    values (u,inv.seller_id,unit)
    on conflict (user_id,unit_id) do update set seller_id=excluded.seller_id,status='active';
  end loop;

  update public.seller_invites
     set status='accepted', accepted_by=u, accepted_at=now()
   where id=inv.id;

  return jsonb_build_object(
    'accepted',true,
    'units',coalesce(array_length(inv.unit_ids,1),0),
    'seller_id',inv.seller_id,
    'roles',array['buyer','seller']
  );
end;
$$;

revoke all on function public.current_user_account() from public, anon;
revoke all on function public.update_my_profile(text,text) from public, anon;
grant execute on function public.current_user_account() to authenticated;
grant execute on function public.update_my_profile(text,text) to authenticated;
grant execute on function public.ensure_user_profile() to authenticated;
grant execute on function public.accept_seller_invite(text) to authenticated;
