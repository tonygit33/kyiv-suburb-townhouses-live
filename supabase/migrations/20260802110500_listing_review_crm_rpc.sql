create or replace function public.admin_listing_review_queue()
returns table (
  unit_id uuid,title text,location_name text,address text,price numeric,currency text,
  area_m2 numeric,land_area_sotka numeric,floors integer,bedrooms integer,description text,
  source_url text,photo_urls text[],photo_count integer,coordinate_precision text,
  latitude numeric,longitude numeric,review_status text,source_access_status text,
  unresolved_fields text[],verified_fields jsonb,notes text,updated_at timestamptz
)
language plpgsql security definer set search_path=public as $$
begin
  if not public.is_site_admin() then raise exception 'admin_required'; end if;
  return query select u.id,u.title,l.settlement,coalesce(u.address,d.address),u.price,u.currency,
    u.area_m2,u.land_area_sotka,u.floors,u.bedrooms,u.description,u.source_url,
    coalesce(p.photo_urls,'{}'::text[]),coalesce(p.photo_count,0),u.coordinate_precision,
    coalesce(u.latitude,l.latitude),coalesce(u.longitude,l.longitude),r.status,
    r.source_access_status,r.unresolved_fields,r.verified_fields,r.notes,
    greatest(r.updated_at,u.updated_at)
  from public.listing_manual_reviews r join public.units u on u.id=r.unit_id
  left join public.developments d on d.id=u.development_id
  left join public.locations l on l.id=d.location_id
  left join lateral(select array_agg(up.photo_url order by up.position,up.created_at) filter(where up.photo_url is not null) photo_urls,count(*) filter(where up.photo_url is not null)::integer photo_count from public.unit_photos up where up.unit_id=u.id and up.status in('external','ready'))p on true
  order by case r.status when'in_progress'then 0 when'pending'then 1 when'blocked'then 2 when'verified'then 3 else 4 end,r.updated_at asc;
end;$$;

create or replace function public.admin_save_listing_review(p_unit_id uuid,p_patch jsonb,p_review_status text,p_source_access_status text,p_unresolved_fields text[],p_notes text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_source_url text;v_title text;v_photo_count integer;
begin
  if not public.is_site_admin() then raise exception 'admin_required'; end if;
  if p_review_status not in('pending','in_progress','verified','blocked','retired') then raise exception 'invalid_review_status'; end if;
  if p_source_access_status not in('not_checked','accessible','search_only','blocked','removed') then raise exception 'invalid_source_access_status'; end if;
  update public.units set title=coalesce(nullif(btrim(p_patch->>'title'),''),title),area_m2=case when p_patch?'area_m2' then nullif(p_patch->>'area_m2','')::numeric else area_m2 end,land_area_sotka=case when p_patch?'land_area_sotka' then nullif(p_patch->>'land_area_sotka','')::numeric else land_area_sotka end,floors=case when p_patch?'floors' then nullif(p_patch->>'floors','')::integer else floors end,bedrooms=case when p_patch?'bedrooms' then nullif(p_patch->>'bedrooms','')::integer else bedrooms end,price=case when p_patch?'price' then nullif(p_patch->>'price','')::numeric else price end,currency=case when p_patch?'currency' then nullif(upper(p_patch->>'currency'),'') else currency end,address=case when p_patch?'address' then nullif(btrim(p_patch->>'address'),'') else address end,description=case when p_patch?'description' then nullif(btrim(p_patch->>'description'),'') else description end,source_url=case when p_patch?'source_url' then nullif(btrim(p_patch->>'source_url'),'') else source_url end,latitude=case when p_patch?'latitude' then nullif(p_patch->>'latitude','')::numeric else latitude end,longitude=case when p_patch?'longitude' then nullif(p_patch->>'longitude','')::numeric else longitude end,coordinate_precision=case when p_patch?'coordinate_precision' then nullif(p_patch->>'coordinate_precision','') else coordinate_precision end,coordinate_source=case when p_patch?'coordinate_precision' then'manual_crm_review' else coordinate_source end,checked_at=current_date,inventory_label=case when p_review_status='verified' then'Перевірено вручну' else'Ручна перевірка першоджерела' end,inventory_confidence=case when p_review_status='verified' then'verified' else'manual_review' end,publication=case when p_review_status='verified' then'published' when p_review_status in('retired','blocked') then'archive' else'review' end,updated_at=now() where id=p_unit_id returning source_url,title into v_source_url,v_title;
  if not found then raise exception 'unit_not_found'; end if;
  select count(*)::integer into v_photo_count from public.unit_photos where unit_id=p_unit_id and status in('external','ready') and photo_url is not null;
  if p_review_status='verified' then if coalesce(v_title,'')='' or coalesce(v_source_url,'')!~'^https?://' then raise exception 'verified_listing_requires_title_and_source'; end if;if coalesce(array_length(p_unresolved_fields,1),0)>0 then raise exception 'verified_listing_has_unresolved_fields'; end if;end if;
  update public.listing_manual_reviews set status=p_review_status,source_access_status=p_source_access_status,source_checked_at=now(),unresolved_fields=coalesce(p_unresolved_fields,'{}'::text[]),verified_fields=coalesce(verified_fields,'{}'::jsonb)||coalesce(p_patch,'{}'::jsonb),source_url=v_source_url,source_photo_count=v_photo_count,notes=nullif(btrim(p_notes),''),updated_at=now() where unit_id=p_unit_id;
  return jsonb_build_object('unit_id',p_unit_id,'status',p_review_status,'photo_count',v_photo_count);
end;$$;
revoke all on function public.admin_listing_review_queue() from public,anon;
revoke all on function public.admin_save_listing_review(uuid,jsonb,text,text,text[],text) from public,anon;
grant execute on function public.admin_listing_review_queue() to authenticated;
grant execute on function public.admin_save_listing_review(uuid,jsonb,text,text,text[],text) to authenticated;
