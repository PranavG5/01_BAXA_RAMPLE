-- Turn on row-level security for every app table. The app connects as the
-- table owner, which bypasses RLS, so nothing changes for it. Hosts such as
-- Supabase also publish tables through a public Data API; with RLS on and no
-- policies, that API can neither read nor write them.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = current_schema() loop
    execute format('alter table %I enable row level security', t.tablename);
  end loop;
end $$;
