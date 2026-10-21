-- rls_auto_enable() is Supabase's event-trigger function behind the "Enable automatic RLS" setting.
-- Event triggers don't check EXECUTE when they fire, so revoking it only closes the Data API route.
-- The function only exists on projects with that setting on, so skip it elsewhere.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
