-- Turn on row-level security for this app's tables only. The app connects as
-- the table owner, which bypasses RLS, so nothing changes for it. Hosts such
-- as Supabase also publish tables through a public Data API; with RLS on and
-- no policies, that API can neither read nor write them. Tables belonging to
-- anything else in the same database are left alone.
do $$
declare t text;
begin
  foreach t in array array[
    '_migrations', 'business_profiles', 'assets', 'registry_meta', 'model_registry', 'model_pins',
    'projects', 'storyboard_versions', 'scenes', 'router_decisions', 'render_jobs', 'qa_results',
    'final_videos', 'audit_events'
  ] loop
    if to_regclass(format('%I.%I', current_schema(), t)) is not null then
      execute format('alter table %I enable row level security', t);
    end if;
  end loop;
end $$;
