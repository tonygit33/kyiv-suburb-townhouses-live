-- Keep temporary schemas after trusted application schemas in SECURITY DEFINER RPCs.
alter function public.admin_assign_lead_seller(uuid, uuid)
  set search_path = public, pg_temp;
alter function public.admin_available_sellers()
  set search_path = public, pg_temp;
alter function public.admin_listing_review_queue()
  set search_path = public, pg_temp;
alter function public.admin_save_listing_review(uuid, jsonb, text, text, text[], text)
  set search_path = public, pg_temp;
alter function public.lead_add_note(uuid, text)
  set search_path = public, pg_temp;
alter function public.lead_notes(uuid)
  set search_path = public, pg_temp;
alter function public.my_seller_units()
  set search_path = public, pg_temp;
