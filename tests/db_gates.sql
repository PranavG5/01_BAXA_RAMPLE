-- Verifies the database-level approval gate and credit cap.
-- Run against a database with the migrations applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/db_gates.sql
begin;
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000001');
insert into business_profiles(id, owner_id, name) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000001', 'Test Barbers');
insert into assets(id, business_id, storage_path, consent_confirmed) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'x.jpg', true);
insert into projects(id, business_id, original_prompt, credit_cap) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', '$25 Tuesday Fade special', 30);
insert into storyboard_versions(id, project_id, version, state) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 1, 'draft');
insert into scenes(id, storyboard_version_id, scene_order, role, duration_s, background_asset_id, treatment, shot_type)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 1, 'hook', 3, '00000000-0000-0000-0000-0000000000a1', 'animate', 'close_up');

-- 1. Inserting a render job for an unapproved version must fail.
do $$ begin
  begin
    insert into render_jobs(project_id, storyboard_version_id, scene_id, provider, model_id, idempotency_key, est_credits)
      values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 'pika', 'm', 'k0', 10);
    raise exception 'TEST FAILED: gate allowed a job on a draft version';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    raise notice 'ok: gate rejected unapproved version';
  end;
end $$;

-- 2. After approval, jobs insert; the credit cap blocks the third 12-credit job (cap 30).
update storyboard_versions set state = 'approved', approved_at = now(), approved_by = '00000000-0000-0000-0000-000000000001' where id = '00000000-0000-0000-0000-0000000000d1';
insert into render_jobs(id, project_id, storyboard_version_id, scene_id, provider, model_id, idempotency_key, est_credits) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 'pika', 'm', 'k1', 12),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 'pika', 'm', 'k2', 12),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 'pika', 'm', 'k3', 12);
do $$ declare r jsonb; begin
  r := claim_render_job('00000000-0000-0000-0000-0000000000f1'); if not (r->>'ok')::boolean then raise exception 'TEST FAILED: first claim %', r; end if;
  r := claim_render_job('00000000-0000-0000-0000-0000000000f1'); if (r->>'ok')::boolean then raise exception 'TEST FAILED: double claim'; end if;
  r := claim_render_job('00000000-0000-0000-0000-0000000000f2'); if not (r->>'ok')::boolean then raise exception 'TEST FAILED: second claim %', r; end if;
  r := claim_render_job('00000000-0000-0000-0000-0000000000f3'); if (r->>'ok')::boolean or r->>'reason' <> 'credit_cap' then raise exception 'TEST FAILED: cap not enforced %', r; end if;
  raise notice 'ok: claim is single-use and credit cap enforced';
end $$;

-- 3. Approved scenes are frozen.
do $$ begin
  begin
    update scenes set voiceover = 'changed' where id = '00000000-0000-0000-0000-0000000000e1';
    raise exception 'TEST FAILED: approved scene was editable';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
    raise notice 'ok: approved scenes are frozen';
  end;
end $$;

-- 4. Project lock is exclusive.
do $$ begin
  if not try_lock_project('00000000-0000-0000-0000-0000000000c1') then raise exception 'TEST FAILED: first lock'; end if;
  if try_lock_project('00000000-0000-0000-0000-0000000000c1') then raise exception 'TEST FAILED: double lock'; end if;
  perform unlock_project('00000000-0000-0000-0000-0000000000c1');
  if not try_lock_project('00000000-0000-0000-0000-0000000000c1') then raise exception 'TEST FAILED: relock'; end if;
  raise notice 'ok: project lock';
end $$;
rollback;
