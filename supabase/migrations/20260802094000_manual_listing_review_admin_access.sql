grant select, update on table public.listing_manual_reviews to authenticated;

create policy listing_manual_reviews_admin_select
on public.listing_manual_reviews
for select
to authenticated
using (public.is_site_admin());

create policy listing_manual_reviews_admin_update
on public.listing_manual_reviews
for update
to authenticated
using (public.is_site_admin())
with check (public.is_site_admin());
