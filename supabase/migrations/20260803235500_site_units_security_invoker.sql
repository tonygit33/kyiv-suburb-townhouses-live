-- Ensure the public catalog view applies the caller's grants and RLS policies.
alter view public.site_units set (security_invoker = true);
