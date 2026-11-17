-- Club API uses the service role client. New media tables need DML grants.
-- Public pages already use security-definer RPCs, which bypass this.

grant select, insert, update, delete on public.site_media to service_role;
grant select, insert, update, delete on public.athletes to service_role;

grant select on public.site_media to anon, authenticated;
grant select on public.athletes to anon, authenticated;
