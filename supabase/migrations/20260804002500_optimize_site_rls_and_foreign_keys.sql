-- Cover site/CRM foreign keys and avoid per-row auth.uid() evaluation in RLS.
create index if not exists property_lead_notes_author_user_idx
  on public.property_lead_notes(author_user_id);
create index if not exists property_leads_customer_user_idx
  on public.property_leads(customer_user_id);
create index if not exists seller_invites_accepted_by_idx
  on public.seller_invites(accepted_by);
create index if not exists seller_invites_seller_id_idx
  on public.seller_invites(seller_id);
create index if not exists seller_unit_claims_seller_id_idx
  on public.seller_unit_claims(seller_id);

alter policy profiles_self_select on public.user_profiles
  using (id = (select auth.uid()));
alter policy profiles_self_insert on public.user_profiles
  with check (id = (select auth.uid()));
alter policy profiles_self_update on public.user_profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
alter policy favorites_self_all on public.user_favorites
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
alter policy claims_self_select on public.seller_unit_claims
  using (user_id = (select auth.uid()));
alter policy invites_none_direct on public.seller_invites
  using (accepted_by = (select auth.uid()));
alter policy user_roles_self_select on public.user_roles
  using (user_id = (select auth.uid()));
